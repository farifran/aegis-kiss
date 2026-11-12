/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/progression.ts
 * @description Motor de Grau, XP e Objetivos Secundários.
 *
 * ARQUITETURA (Derivar, não acumular):
 * O XP NÃO é um contador guardado. Ele é recalculado a partir de
 * `state.monthlyLogs` e das datas dos objetivos, que o merge da nuvem já une bit
 * a bit e por união de conjuntos. Um saldo escalar teria o destino oposto: o
 * merge escolhe um vencedor por `lastModified` e o outro lado seria descartado
 * inteiro — dois aparelhos usados offline no mesmo dia perderiam o XP de um
 * deles. Derivar custa uma varredura; guardar custaria dados do usuário.
 *
 * O GRAU ACOMPANHA O PRESENTE, não o passado acumulado. O dia deixado em branco
 * devolve o XP de um dia cumprido, e o objetivo largado devolve o que rendeu:
 * quem para de manter, para de contar com o que manteve. Duas regras seguram a
 * queda para que ela seja justa em vez de cruel:
 *
 *   1. NADA DEVOLVE MAIS DO QUE DEU. O piso é por hábito e por objetivo — um
 *      hábito nunca come o XP de outro, e nenhum dos dois desce de zero.
 *   2. TUDO É REVERSÍVEL. Como o XP é derivado e não acumulado, voltar no
 *      calendário e marcar o dia que de fato foi cumprido devolve o XP na hora.
 *      A cobrança é do silêncio, não do esquecimento — e adiar já basta para
 *      não perder nada.
 *
 * O único jeito de travar o XP de um objetivo é CONCLUÍ-LO: alvo cheio, nenhum
 * ciclo por vencer, nada mais a regredir.
 *
 * [PUREZA]: este módulo não conhece i18n nem DOM. Devolve dados estruturados
 * (chaves e números); quem traduz e desenha é `render/progression.ts`.
 */

import { state, HABIT_STATE, QuestRecord, TIMES_OF_DAY, bumpLastModified, getStateGeneration } from '../state';
import { HabitService } from './HabitService';
import { getScheduleForDate, shouldHabitAppearOnDate } from './selectors';
import { QUEST_CATALOG, QUEST_TIERS, getQuestCatalogItem, type QuestCatalogItem } from '../data/quests';
import { getTodayUTCIso, generateUUID, sanitizeText, parseUTCIsoDate, toUTCIsoDateString, MS_PER_DAY } from '../utils';
import { saveState } from './persistence';
import { emitRenderApp } from '../events';
import {
    GRADE_XP_BASE, GRADE_XP_STEP, MAX_GRADE,
    XP_PER_COMPLETION, XP_PER_OVERACHIEVEMENT,
    QUEST_MAX_ACTIVE, QUEST_MASTERY_BONUS, QUEST_MIN_STEP_XP,
    CUSTOM_QUEST_XP_PER_DAY, CUSTOM_QUEST_MAX_TARGET, CUSTOM_QUEST_MAX_TITLE_LENGTH,
    QUEST_NOTE_MAX_LENGTH
} from '../constants';

// --- PATENTES ---

export interface RankTier {
    readonly minGrade: number;
    readonly maxGrade: number;
    readonly key: string;
}

/** As seis faixas cobrem 1..MAX_GRADE sem buraco; `getRankTier` conta com isso. */
export const RANK_TIERS: readonly RankTier[] = [
    { minGrade: 1, maxGrade: 5, key: 'rankInitiate' },
    { minGrade: 6, maxGrade: 15, key: 'rankPractitioner' },
    { minGrade: 16, maxGrade: 30, key: 'rankGuardian' },
    { minGrade: 31, maxGrade: 50, key: 'rankForger' },
    { minGrade: 51, maxGrade: 75, key: 'rankMaster' },
    { minGrade: 76, maxGrade: MAX_GRADE, key: 'rankSovereign' }
] as const;

export function getRankTier(grade: number): RankTier {
    return RANK_TIERS.find(tier => grade >= tier.minGrade && grade <= tier.maxGrade) ?? RANK_TIERS[0];
}

// --- CURVA DE GRAU ---

export interface GradeInfo {
    grade: number;
    /** XP acumulado dentro do grau atual. */
    xpInGrade: number;
    /** Custo total do grau atual; 0 quando já se está no topo. */
    xpForNext: number;
    totalXp: number;
}

/** Custo em XP para sair deste grau e entrar no seguinte. */
export function xpToAdvanceFrom(grade: number): number {
    return GRADE_XP_BASE + (grade - 1) * GRADE_XP_STEP;
}

export function gradeFromXp(totalXp: number): GradeInfo {
    let grade = 1;
    let remaining = Math.max(0, totalXp);

    while (grade < MAX_GRADE) {
        const cost = xpToAdvanceFrom(grade);
        if (remaining < cost) break;
        remaining -= cost;
        grade++;
    }

    return {
        grade,
        xpInGrade: remaining,
        xpForNext: grade >= MAX_GRADE ? 0 : xpToAdvanceFrom(grade),
        totalXp
    };
}

// --- XP DE HÁBITOS (derivado dos bitmasks) ---

interface HabitTally {
    done: number;
    overachieved: number;
    deferred: number;
    firstEarnedMonth?: string;
}

/**
 * Instâncias marcadas, separadas POR HÁBITO.
 *
 * Separadas porque a perda tem piso próprio: um hábito só desconta o XP que ele
 * mesmo deu. Num balde só, um hábito esquecido comeria o ganho dos outros, e um
 * mês de descuido zeraria a disciplina inteira.
 *
 * A chave do log é `<habitId>_<YYYY-MM>` e o id pode conter `_`, por isso o
 * corte é no ÚLTIMO — que é sempre o separador do mês.
 *
 * O deslocamento é progressivo (`v >>= 3n`) em vez de indexado por dia: um mês
 * pouco preenchido termina no primeiro bloco zerado à esquerda, em vez de varrer
 * os 93 blocos sempre. O layout é o de `HabitService`: bits 0-1 são o status,
 * bit 2 é a lápide, e bloco com lápide vale NULL.
 */
function tallyByHabit(): Map<string, HabitTally> {
    const byHabit = new Map<string, HabitTally>();

    const logs = state.monthlyLogs;
    if (!logs) return byHabit;

    for (const [key, log] of logs) {
        const cut = key.lastIndexOf('_');
        const habitId = cut > 0 ? key.slice(0, cut) : key;

        let tally = byHabit.get(habitId);
        if (!tally) byHabit.set(habitId, tally = { done: 0, overachieved: 0, deferred: 0 });

        let remaining = log;
        let earnedInMonth = false;
        while (remaining > 0n) {
            const block = remaining & 7n;
            if (block === 1n) {
                tally.done++;
                earnedInMonth = true;
            } else if (block === 3n) {
                tally.overachieved++;
                earnedInMonth = true;
            } else if (block === 2n) {
                tally.deferred++;
            }
            remaining >>= 3n;
        }

        // Logs que só guardam adiamentos ou lápides nunca produziram saldo. Ignorá-
        // los evita varrer anos de calendário por uma marcação desfeita.
        if (earnedInMonth && cut > 0) {
            const monthStart = `${key.slice(cut + 1)}-01`;
            if (!tally.firstEarnedMonth || monthStart < tally.firstEarnedMonth) {
                tally.firstEarnedMonth = monthStart;
            }
        }
    }

    return byHabit;
}

/** O que as marcações renderam, antes de qualquer desconto. */
function tallyXp(tally: HabitTally): number {
    return tally.done * XP_PER_COMPLETION
        + tally.overachieved * (XP_PER_COMPLETION + XP_PER_OVERACHIEVEMENT);
}

const EMPTY_TIMES: readonly (typeof TIMES_OF_DAY)[number][] = [];

/**
 * Resolve os períodos agendados de um hábito numa data fechada sem alocar closures
 * nem poluir `habitAppearanceCache` / `scheduleCache` com milhares de datas históricas
 * visitadas apenas uma vez durante a varredura linear de XP.
 */
function scheduledTimesForXp(
    habit: (typeof state.habits)[number],
    dateISO: string,
    cursor: Date
): readonly (typeof TIMES_OF_DAY)[number][] {
    if ((habit.deletedOn && dateISO >= habit.deletedOn) || habit.graduatedOn) return EMPTY_TIMES;

    const history = habit.scheduleHistory;
    if (!Array.isArray(history) || history.length === 0) return EMPTY_TIMES;

    let schedule: (typeof history)[number] | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const s = history[i];
        if (dateISO >= s.startDate) {
            if (!s.endDate || dateISO < s.endDate) schedule = s;
            break;
        }
    }
    if (!schedule) return EMPTY_TIMES;

    const { frequency } = schedule;
    let appears = false;
    if (frequency.type === 'daily') {
        appears = true;
    } else if (frequency.type === 'specific_days_of_week') {
        appears = frequency.days.includes(cursor.getUTCDay());
    } else if (frequency.type === 'interval') {
        const anchorMs = dayEpoch(schedule.scheduleAnchor || schedule.startDate);
        const diffDays = Math.round((cursor.getTime() - anchorMs) / MS_PER_DAY);
        if (diffDays >= 0) {
            appears = frequency.unit === 'days'
                ? diffDays % frequency.amount === 0
                : cursor.getUTCDay() === new Date(anchorMs).getUTCDay() && Math.floor(diffDays / 7) % frequency.amount === 0;
        }
    }

    if (!appears) return EMPTY_TIMES;
    return state.dailyData[dateISO]?.[habit.id]?.dailySchedule ?? schedule.times ?? EMPTY_TIMES;
}

/**
 * Saldo de XP por hábito, reconstruído na ordem do calendário.
 *
 * Uma falta só pode consumir o saldo que já existia naquele dia. Isto evita
 * que uma sequência longa sem marcações vire uma dívida que bloqueie ganhos
 * futuros. O cálculo começa no primeiro mês que realmente concedeu XP: antes
 * disso o saldo era zero, portanto não há trabalho nem resultado a preservar.
 */
function habitXp(): number {
    const byHabit = tallyByHabit();
    if (byHabit.size === 0) return 0;

    const today = getTodayUTCIso();
    const todayYm = today.slice(0, 7);
    const habits = new Map(state.habits.map(habit => [habit.id, habit]));

    let total = 0;
    for (const [id, tally] of byHabit) {
        const habit = habits.get(id);
        if (!habit || habit.graduatedOn) {
            total += tallyXp(tally);
            continue;
        }

        const start = tally.firstEarnedMonth;
        if (!start || start > today) continue;

        let balance = 0;
        const cursor = parseUTCIsoDate(start);
        let currentYm = '';
        let monthLog = 0n;

        for (let date = start; date <= today;) {
            const ym = date.slice(0, 7);
            if (ym !== currentYm) {
                currentYm = ym;
                monthLog = state.monthlyLogs?.get(`${id}_${ym}`) ?? 0n;
                // Mês inteiro sem nenhuma marcação e sem saldo acumulado a perder:
                // salta direto para o 1º dia do mês seguinte sem varrer dia a dia.
                if (monthLog === 0n && balance === 0 && ym < todayYm) {
                    cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
                    date = toUTCIsoDateString(cursor);
                    continue;
                }
            }

            const dayIndex = cursor.getUTCDate() - 1;
            const dayBits = Number((monthLog >> BigInt(dayIndex * 9)) & 511n);

            // Se o dia está zerado no bitmask e o saldo já é zero, nenhuma falta
            // pode reduzir abaixo de zero — evita consultar agenda/seletores à toa.
            if (dayBits !== 0 || balance > 0) {
                let scheduled: readonly (typeof TIMES_OF_DAY)[number][] | undefined;
                for (let p = 0; p < TIMES_OF_DAY.length; p++) {
                    const block = (dayBits >> (p * 3)) & 7;
                    const status = (block & 4) ? 0 : (block & 3);
                    if (status === HABIT_STATE.DONE) balance += XP_PER_COMPLETION;
                    else if (status === HABIT_STATE.DONE_PLUS) balance += XP_PER_COMPLETION + XP_PER_OVERACHIEVEMENT;
                    else if (status === HABIT_STATE.NULL && balance > 0 && date < today) {
                        // A agenda só importa quando há saldo positivo e período vazio
                        // em dia já fechado (antes de hoje).
                        if (scheduled === undefined) {
                            scheduled = scheduledTimesForXp(habit, date, cursor);
                        }
                        if (scheduled.includes(TIMES_OF_DAY[p])) {
                            // O período vazio só pode consumir o saldo que já existia
                            // antes dele; nunca o ganho de uma noite que ainda virá.
                            balance = Math.max(0, balance - XP_PER_COMPLETION);
                        }
                    }
                }
            }

            cursor.setUTCDate(cursor.getUTCDate() + 1);
            date = toUTCIsoDateString(cursor);
        }
        total += balance;
    }

    return total;
}

// --- OBJETIVOS: LEITURA ---

export function getQuestTarget(quest: QuestRecord): number {
    return getQuestCatalogItem(quest.id)?.target ?? quest.customTarget ?? 1;
}

export function getQuestTotalXp(quest: QuestRecord): number {
    const item = getQuestCatalogItem(quest.id);
    if (item) return item.xp;
    return (quest.customTarget ?? 1) * CUSTOM_QUEST_XP_PER_DAY;
}

/** XP creditado a cada avanço diário registrado. */
export function getQuestStepXp(quest: QuestRecord): number {
    return Math.max(QUEST_MIN_STEP_XP, Math.round(getQuestTotalXp(quest) / getQuestTarget(quest)));
}

/** Mesma conta, para um item de catálogo ainda não ativado. */
export function getCatalogStepXp(target: number, xp: number): number {
    return Math.max(QUEST_MIN_STEP_XP, Math.round(xp / target));
}

/**
 * Data ISO → epoch, memoizado.
 *
 * `parseUTCIsoDate` constrói um `Date` e valida o overflow a cada chamada, e o
 * motor pergunta a mesma data dezenas de vezes por render — um objetivo de 365
 * dias custava 365 parses por chamada, e são várias por repintura. Memoizar o
 * número (e não o `Date`, que é mutável) é seguro por construção: a mesma
 * string devolve sempre o mesmo instante, então não há o que invalidar.
 */
const dayEpochCache = new Map<string, number>();
function dayEpoch(dateISO: string): number {
    let ms = dayEpochCache.get(dateISO);
    if (ms === undefined) {
        ms = parseUTCIsoDate(dateISO).getTime();
        dayEpochCache.set(dateISO, ms);
    }
    return ms;
}

/** Cadência esperada, em dias, entre um avanço e o seguinte (1 = diário). */
function getQuestCadence(quest: QuestRecord): number {
    return getQuestCatalogItem(quest.id)?.cadence ?? 1;
}

/**
 * Dias marcados agrupados no ciclo a que pertencem.
 *
 * UM CRÉDITO POR CICLO é a regra em todo o motor: a cadência diz de quanto em
 * quanto tempo se espera um avanço, e marcar duas vezes dentro da mesma janela
 * não adianta o objetivo. Sem isso, creditar cada dia enquanto se cobrava por
 * ciclo deixava uma mentoria de doze semanas fechar em doze dias, com o XP
 * inteiro mais o bônus de maestria.
 *
 * Com cadência 1 — a maioria — cada dia é o seu próprio ciclo e nada muda.
 */
function markedCycles(quest: QuestRecord, anchorISO: string): Map<number, string[]> {
    const cadence = getQuestCadence(quest);
    const from = dayEpoch(anchorISO);
    const today = getTodayUTCIso();
    const cycles = new Map<number, string[]>();

    for (const day of quest.days) {
        // Dia à frente de hoje não é avanço: um aparelho com o relógio adiantado
        // (ou um backup editado) fecharia o objetivo sem nenhum ciclo cumprido.
        // Filtrar na leitura se corrige sozinho quando a data enfim chega.
        if (day > today) continue;
        const offset = Math.round((dayEpoch(day) - from) / MS_PER_DAY);
        const index = Math.floor(offset / cadence);
        const existing = cycles.get(index);
        if (existing) existing.push(day);
        else cycles.set(index, [day]);
    }
    return cycles;
}

/** Começo da tentativa em curso; sem retomada, é o dia da ativação. */
function attemptStart(quest: QuestRecord): string {
    return quest.attemptFrom ?? quest.startedOn;
}

/**
 * Reconstitui a tentativa por ciclo, sem dívida. Ao perder o último avanço,
 * o objetivo permanece disponível no dia em que zerou e expira no seguinte.
 * A data de expiração é derivada dos registros, então permanece igual após a
 * sincronização entre aparelhos.
 */
function questAttemptState(quest: QuestRecord): { progress: number; expired: boolean } {
    const from = dayEpoch(attemptStart(quest));
    const today = dayEpoch(getTodayUTCIso());
    const cadence = getQuestCadence(quest);
    const closedCycles = Math.floor(Math.max(0, (today - from) / MS_PER_DAY) / cadence);
    const marked = markedCycles(quest, attemptStart(quest));
    let progress = 0;
    let expiresAt = Infinity;

    for (let cycle = 0; cycle <= closedCycles; cycle++) {
        const start = from + cycle * cadence * MS_PER_DAY;
        const days = marked.get(cycle);
        const markedAt = days?.length ? Math.min(...days.map(dayEpoch)) : Infinity;
        if (expiresAt <= Math.min(today, markedAt)) return { progress: 0, expired: true };

        if (days?.length) {
            progress++;
            expiresAt = Infinity;
        } else if (cycle < closedCycles) {
            const hadProgress = progress > 0;
            progress = Math.max(0, progress - 1);
            if (progress === 0 && expiresAt === Infinity) {
                expiresAt = start + (cadence + (hadProgress ? 1 : 0)) * MS_PER_DAY;
            }
        }
    }
    return { progress, expired: expiresAt <= today };
}

/** Avanço disponível na tentativa atual; nunca fica negativo. */
export function getQuestNetProgress(quest: QuestRecord): number {
    return questAttemptState(quest).progress;
}

/** O que a barra mostra: saldo disponível, limitado ao alvo. */
export function getQuestProgress(quest: QuestRecord): number {
    return Math.min(getQuestTarget(quest), getQuestNetProgress(quest));
}

/** Objetivo zerado continua no dia do zero e expira no dia seguinte. */
export function isQuestExpired(quest: QuestRecord): boolean {
    if (quest.completedOn || quest.abandonedOn) return false;
    return questAttemptState(quest).expired;
}

function isQuestActive(quest: QuestRecord): boolean {
    return !quest.completedOn && !quest.abandonedOn && !isQuestExpired(quest);
}

/**
 * Todos os objetivos em curso — deliberadamente SEM cortar em QUEST_MAX_ACTIVE.
 *
 * A união da nuvem pode devolver mais de três: dois aparelhos com dois slots
 * ocupados, cada um ativando um objetivo diferente offline, somam quatro. Cortar
 * aqui esconderia o excedente numa posição de onde ele não poderia ser
 * registrado nem abandonado — perda silenciosa de dado, justamente o que o
 * modelo de dados foi desenhado para evitar. O teto vale para ATIVAR; passar
 * dele é um estado visível, que o usuário desfaz abandonando.
 */
export function getActiveQuests(): QuestRecord[] {
    return state.quests.filter(isQuestActive);
}

export function getCompletedQuestIds(): Set<string> {
    const ids = new Set<string>();
    for (const quest of state.quests) {
        if (quest.completedOn) ids.add(quest.id);
    }
    return ids;
}

/**
 * Já houve avanço no ciclo a que esta data pertence?
 *
 * O cartão pergunta isto, e não "marquei hoje": num objetivo de ritmo semanal,
 * registrado na segunda significa registrado a semana toda. Antes o cartão
 * reabria no dia seguinte e aceitava uma marcação que não rendia nada.
 */
export function isQuestRegisteredForCycleOf(quest: QuestRecord, dateISO: string): boolean {
    const from = dayEpoch(attemptStart(quest));
    const offset = Math.round((dayEpoch(dateISO) - from) / MS_PER_DAY);
    return markedCycles(quest, attemptStart(quest)).has(Math.floor(offset / getQuestCadence(quest)));
}

/**
 * XP rendido por um objetivo — o LÍQUIDO, o mesmo número que a barra mostra.
 *
 * XP e barra são a mesma conta de propósito: o ciclo perdido tira o avanço e
 * tira o XP junto. Enquanto o objetivo está em curso, o que se tem é um
 * empréstimo contra uma promessa — e concluir é o que o quita.
 *
 * CONCLUÍDO É O ÚNICO ESTADO ESTÁVEL, e por isso ele curto-circuita a conta: sem
 * isso o líquido continuaria caindo depois da conclusão e o prêmio derreteria
 * junto. Alvo cheio, nada mais a vencer, valor congelado.
 *
 * Largar tem o caminho oposto: caducado ou abandonado, os ciclos vazios seguem
 * correndo, o líquido desce até o piso e o objetivo se apaga sozinho. Não é
 * castigo — é a mesma regra vista do outro lado.
 *
 * A base é `alvo × passo`, e não `getQuestTotalXp`, para não haver degrau no
 * instante da conclusão: é exatamente onde a barra cheia já estava. Hoje as duas
 * contas batem em todo o catálogo; o piso de `QUEST_MIN_STEP_XP` poderia
 * separá-las num item futuro, e aí quem manda é a barra que o usuário viu.
 */
function questEarnedXp(quest: QuestRecord): number {
    const stepXp = getQuestStepXp(quest);
    if (quest.completedOn) {
        return getQuestTarget(quest) * stepXp + Math.round(getQuestTotalXp(quest) * QUEST_MASTERY_BONUS);
    }
    return getQuestProgress(quest) * stepXp;
}

// --- TETO DE XP POR LEVA ---

/** XP acumulado para estar no COMEÇO de um grau (zero de avanço dentro dele). */
function xpToReachGrade(grade: number): number {
    let total = 0;
    for (let g = 1; g < grade; g++) total += xpToAdvanceFrom(g);
    return total;
}

/**
 * Teto acumulado que os objetivos podem somar, leva por leva.
 *
 * Limpar uma leva leva no máximo ao grau imediatamente ANTERIOR ao exigido pela
 * leva seguinte: os objetivos nunca entregam de graça a chave da porta de cima.
 * O último grau que falta é sempre dos hábitos, que é onde a disciplina de fato
 * mora — sem isto, uma sequência de desafios curtos abriria a escada inteira.
 *
 * O excedente é DESCARTADO, não guardado para depois: se transbordasse para a
 * leva seguinte, o teto seria apenas um atraso, e limpar a leva 1 continuaria
 * abrindo a leva 3 com um dia de diferença. A última leva não tem teto — dali
 * para cima não há porta nenhuma a proteger.
 */
const TIER_XP_CEILINGS: readonly number[] = QUEST_TIERS.map((tier, index) => {
    const nextTier = QUEST_TIERS[index + 1];
    return nextTier === undefined ? Infinity : xpToReachGrade(nextTier - 1);
});

/**
 * XP dos objetivos, somado por leva e cortado no teto de cada uma.
 *
 * Objetivo personalizado entra na leva em que a pessoa está trabalhando: é
 * trabalho dela, e o mesmo teto vale. Deixá-lo fora daria a volta em toda a
 * regra — um objetivo de 365 dias renderia 9.125 XP e cunharia o grau à vontade.
 */
function cappedQuestXp(): number {
    const fallbackTier = currentTierState().tier;
    const byTier = new Map<number, number>();

    for (const quest of state.quests) {
        const tier = getQuestCatalogItem(quest.id)?.reqGrade ?? fallbackTier;
        byTier.set(tier, (byTier.get(tier) ?? 0) + questEarnedXp(quest));
    }

    let total = 0;
    QUEST_TIERS.forEach((tier, index) => {
        total = Math.min(total + (byTier.get(tier) ?? 0), TIER_XP_CEILINGS[index]);
    });
    return total;
}

// --- AGREGADO (memoizado) ---

let cachedGrade: GradeInfo | null = null;
let cachedTierState: { tier: number; pending: number } | null = null;
let cachedEpoch = '';

/**
 * Chave dos memos deste módulo: geração do estado MAIS o dia corrente.
 *
 * A geração sozinha não bastava. Caducidade e avanço líquido saem da comparação
 * com a data de hoje, e a virada do dia não escreve nada no estado — o grau
 * memoizado atravessava a meia-noite com o valor de ontem até que alguma outra
 * ação bumpasse a geração. A geração continua na chave porque reset, import e
 * volta da nuvem podem reinstalar um `lastModified` já visto.
 */
function currentEpoch(): string {
    const epoch = `${getStateGeneration()}:${getTodayUTCIso()}`;
    if (epoch !== cachedEpoch) {
        cachedEpoch = epoch;
        cachedGrade = null;
        cachedTierState = null;
    }
    return epoch;
}

/**
 * Grau e XP atuais.
 *
 * A varredura dos bitmasks é barata mas não é de graça, e `renderApp` chega aqui
 * a cada frame de navegação entre dias.
 */
export function getProgression(): GradeInfo {
    currentEpoch();
    if (cachedGrade) return cachedGrade;

    // Hábito não tem teto; objetivo tem, por leva. Somar depois do corte é o que
    // garante que o teto limite os objetivos e não a disciplina diária.
    cachedGrade = gradeFromXp(habitXp() + cappedQuestXp());
    return cachedGrade;
}

// --- DESBLOQUEIO ---

export type UnlockStatus =
    | { unlocked: true }
    | { unlocked: false; reason: 'grade'; requiredGrade: number }
    | { unlocked: false; reason: 'slots'; tierGrade: number; pending: number }
    | { unlocked: false; reason: 'later'; tierGrade: number };

/**
 * A leva em que a pessoa está e quantos objetivos dela ainda esperam por um slot.
 *
 * "Está" não é a leva do grau atual: é a primeira que ainda tem o que oferecer.
 * Quem chegou ao grau 10 sem tocar nos objetivos do grau 1 continua no 1 — e é o
 * que mantém o catálogo apontando para o que destrava o caminho, em vez de
 * esconder os fáceis justamente de quem precisa deles.
 *
 * Concluído sai da conta para sempre. Ativo sai porque já está num slot. Tudo o
 * mais conta, inclusive o que caducou: caducar não é cumprir, e se tirasse da
 * conta, ativar a leva inteira e abandoná-la ao relento seria o caminho mais
 * rápido para a leva seguinte.
 *
 * Devolve os dois números juntos porque quem pergunta um quase sempre precisa do
 * outro, e separá-los custava cinco varreduras do catálogo em vez de uma.
 */
function currentTierState(): { tier: number; pending: number } {
    // Memoizado porque o catálogo pergunta uma vez por LINHA, e cada resposta
    // custava uma varredura das 54 entradas mais duas da lista de objetivos.
    currentEpoch();
    if (cachedTierState) return cachedTierState;

    cachedTierState = computeTierState();
    return cachedTierState;
}

function computeTierState(): { tier: number; pending: number } {
    const completedIds = getCompletedQuestIds();
    const activeIds = new Set(getActiveQuests().map(quest => quest.id));

    const pendingByTier = new Map<number, number>();
    for (const item of QUEST_CATALOG) {
        if (completedIds.has(item.id) || activeIds.has(item.id)) continue;
        pendingByTier.set(item.reqGrade, (pendingByTier.get(item.reqGrade) ?? 0) + 1);
    }

    for (const tier of QUEST_TIERS) {
        const pending = pendingByTier.get(tier) ?? 0;
        if (pending > 0) return { tier, pending };
    }

    // Catálogo esgotado: a última leva é o fim da escada.
    return { tier: QUEST_TIERS[QUEST_TIERS.length - 1], pending: 0 };
}

/**
 * Regra dos SLOTS: a leva seguinte abre quando a atual já não tem com que
 * encher os seus três slots.
 *
 * Com três slots e dois objetivos de grau 1 sobrando, um slot fica sem
 * candidato da leva atual — e é esse slot que a leva seguinte pode ocupar. A
 * conta é `ativos + pendentes da leva atual < QUEST_MAX_ACTIVE`, então o slot
 * excedente continua disponível indefinidamente: quem nunca fizer aqueles dois
 * segue evoluindo naquele slot, um objetivo da leva de cima após o outro.
 *
 * A regra anterior era "conclua todos menos dois da leva anterior", que dizia a
 * mesma coisa por acidente quando nada estava ativo, e mentia no resto do tempo:
 * ignorava o que já ocupava slot e cobrava conclusão de quem só precisava sair
 * do caminho. Nenhuma leva além da seguinte abre — pular graus tiraria o sentido
 * da escada.
 */
export function getQuestUnlockStatus(reqGrade: number): UnlockStatus {
    const { grade } = getProgression();
    if (grade < reqGrade) return { unlocked: false, reason: 'grade', requiredGrade: reqGrade };

    const { tier: currentTier, pending } = currentTierState();
    if (reqGrade <= currentTier) return { unlocked: true };

    const nextTier = QUEST_TIERS[QUEST_TIERS.indexOf(currentTier) + 1];
    if (reqGrade !== nextTier) return { unlocked: false, reason: 'later', tierGrade: nextTier ?? currentTier };

    if (getActiveQuests().length + pending < QUEST_MAX_ACTIVE) return { unlocked: true };

    return { unlocked: false, reason: 'slots', tierGrade: currentTier, pending };
}

// --- OBJETIVOS: MUTAÇÕES ---

export type QuestFailure =
    | 'slotsFull'
    | 'locked'
    | 'unknownQuest'
    | 'invalidTitle';

/**
 * `completed` é o único dado que o resultado carrega: XP não vem por aqui.
 *
 * Havia um `gainedXp` calculado a cada registro para alimentar um aviso de "+N
 * XP" que já não existe. Além de morto, repetia a fórmula do prêmio de maestria
 * que `questEarnedXp` também aplica — duas contas para o mesmo valor, livres
 * para divergir. O saldo é sempre derivado; ninguém o anuncia.
 */
export type QuestActionResult =
    | { ok: true; completed: boolean }
    | { ok: false; reason: QuestFailure };

/**
 * Persiste e repinta após uma mudança em objetivos.
 *
 * `saveState(true)` grava na hora em vez de esperar o debounce de 800ms: o
 * registro de avanço é uma ação por dia, e fechar o app logo depois não pode
 * desfazê-la — mesma razão do toggle de status do hábito.
 */
function notifyQuestChange() {
    bumpLastModified();
    void saveState(true);
    requestAnimationFrame(() => emitRenderApp());
}

export function activateQuest(questId: string): QuestActionResult {
    const item = getQuestCatalogItem(questId);
    const existing = state.quests.find(q => q.id === questId);
    if (!item && !existing?.customTitle) return { ok: false, reason: 'unknownQuest' };
    // Reabrir pelo catálogo um objetivo que ainda está ativo não pode criar uma
    // tentativa nova nem apagar o saldo em curso.
    if (existing && isQuestActive(existing)) return { ok: true, completed: false };
    if (getActiveQuests().length >= QUEST_MAX_ACTIVE) return { ok: false, reason: 'slotsFull' };
    if (item && !getQuestUnlockStatus(item.reqGrade).unlocked) return { ok: false, reason: 'locked' };

    // Retomada: um só registro por id, sempre. Nasce uma TENTATIVA nova — a
    // lápide sai e a janela do avanço passa a contar de hoje, senão os dias
    // perdidos da tentativa anterior matariam o objetivo no mesmo instante em
    // que ele volta ao slot. Os dias antigos ficam em `days`: são XP ganho, e
    // apagá-los faria o grau andar para trás.
    if (existing) {
        if (existing.completedOn) return { ok: false, reason: 'unknownQuest' };
        existing.abandonedOn = undefined;
        existing.attemptFrom = getTodayUTCIso();
    } else {
        state.quests.push({ id: questId, startedOn: getTodayUTCIso(), days: [] });
    }

    notifyQuestChange();
    return { ok: true, completed: false };
}

export function createCustomQuest(rawTitle: string, rawTarget: number): QuestActionResult {
    if (getActiveQuests().length >= QUEST_MAX_ACTIVE) return { ok: false, reason: 'slotsFull' };

    const title = sanitizeText(rawTitle, CUSTOM_QUEST_MAX_TITLE_LENGTH);
    if (!title) return { ok: false, reason: 'invalidTitle' };

    // O alvo vem de um campo de formulário, então é preso na faixa aqui. O XP
    // sai do alvo e não do usuário: no protótipo `createCustomQuest` recebia o
    // XP como argumento, o que deixava qualquer um cunhar o próprio grau.
    const target = Math.min(CUSTOM_QUEST_MAX_TARGET, Math.max(1, Math.floor(rawTarget) || 1));

    state.quests.push({
        id: `custom:${generateUUID()}`,
        startedOn: getTodayUTCIso(),
        days: [],
        customTitle: title,
        customTarget: target
    });

    notifyQuestChange();
    return { ok: true, completed: false };
}

/**
 * Marca ou desmarca o avanço de hoje — dois estados, como o cartão de hábito.
 *
 * Não existe "adiado" aqui: um objetivo secundário foi feito hoje ou não foi. E
 * como no hábito, tocar de novo desfaz — o toque errado se corrige onde
 * aconteceu, sem menu.
 *
 * Desmarcar DEVOLVE o XP daquele ciclo, como desmarcar um hábito já fazia. Não
 * é a única coisa que baixa o grau — o ciclo vencido em branco faz o mesmo, sem
 * ninguém tocar em nada —, mas é a única que o usuário provoca de propósito, e
 * a que ele desfaz tocando de novo.
 *
 * `getTodayUTCIso` devolve a data do calendário LOCAL. Um
 * `toISOString().slice(0,10)` cru daria a data UTC e, a leste ou a oeste de
 * Greenwich, marcaria o avanço no dia errado.
 */
export function toggleQuestProgress(questId: string): QuestActionResult {
    const quest = state.quests.find(q => q.id === questId);
    if (!quest || !isQuestActive(quest)) return { ok: false, reason: 'unknownQuest' };

    const today = getTodayUTCIso();

    if (isQuestRegisteredForCycleOf(quest, today)) {
        // Desfaz o avanço DESTE ciclo, que num objetivo diário é o dia de hoje e
        // num semanal é o dia em que a semana foi registrada.
        const from = dayEpoch(attemptStart(quest));
        const cycleOfToday = Math.floor(Math.round((dayEpoch(today) - from) / MS_PER_DAY) / getQuestCadence(quest));
        const desfeitos = new Set(markedCycles(quest, attemptStart(quest)).get(cycleOfToday) ?? []);

        quest.days = quest.days.filter(day => !desfeitos.has(day));
        // Conclusão do ciclo se desfaz junto; a de um ciclo anterior já tirou o
        // objetivo da lista e não há cartão para tocar.
        if (quest.completedOn && desfeitos.has(quest.completedOn)) quest.completedOn = undefined;
        notifyQuestChange();
        return { ok: true, completed: false };
    }

    quest.days.push(today);
    quest.days.sort();

    // Fecha pelo LÍQUIDO da tentativa em curso, não pelo total de dias marcados:
    // um dia perdido pelo caminho tem de ser reposto antes de o objetivo fechar.
    const completed = getQuestNetProgress(quest) >= getQuestTarget(quest);
    if (completed) quest.completedOn = today;

    notifyQuestChange();
    return { ok: true, completed };
}

/** Nota do dia num objetivo, como a nota do cartão de hábito. */
export function getQuestNote(quest: QuestRecord, dateISO: string): string {
    return quest.notes?.[dateISO] ?? '';
}

/**
 * Grava (ou apaga) a nota de um dia.
 *
 * Texto vazio remove a chave em vez de guardar `''`: um dia sem nota não deve
 * ocupar espaço no payload da nuvem nem contar como escrita no merge.
 */
export function setQuestNote(questId: string, dateISO: string, rawText: string): void {
    const quest = state.quests.find(q => q.id === questId);
    if (!quest) return;

    const text = sanitizeText(rawText, QUEST_NOTE_MAX_LENGTH);
    if (getQuestNote(quest, dateISO) === text) return;

    if (!text) {
        if (quest.notes) delete quest.notes[dateISO];
    } else {
        quest.notes = { ...quest.notes, [dateISO]: text };
    }

    notifyQuestChange();
}

export function abandonQuest(questId: string): QuestActionResult {
    const quest = state.quests.find(q => q.id === questId);
    if (!quest || !isQuestActive(quest)) return { ok: false, reason: 'unknownQuest' };

    quest.abandonedOn = getTodayUTCIso();
    notifyQuestChange();
    return { ok: true, completed: false };
}

/**
 * O que o catálogo mostra: a leva atual e a seguinte.
 *
 * Objetivos em curso entram sempre, de qualquer leva — sem isso, um objetivo
 * ativado antes de avançar sairia da lista e ficaria impossível de abandonar,
 * já que abandonar só existe aqui.
 */
export function getVisibleCatalog(): readonly QuestCatalogItem[] {
    const current = currentTierState().tier;
    const next = QUEST_TIERS[QUEST_TIERS.indexOf(current) + 1];
    const tiers = new Set(next === undefined ? [current] : [current, next]);
    const activeIds = new Set(getActiveQuests().map(q => q.id));

    return QUEST_CATALOG.filter(item => tiers.has(item.reqGrade) || activeIds.has(item.id));
}

/**
 * Existe leva além das duas que o catálogo mostra?
 *
 * Serve para o aviso do fim da lista aparecer só quando há de fato mais coisa
 * guardada — no topo da escada ele seria uma promessa falsa.
 */
export function hasHiddenQuestTiers(): boolean {
    return QUEST_TIERS.indexOf(currentTierState().tier) + 2 < QUEST_TIERS.length;
}
