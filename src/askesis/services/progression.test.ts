/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state, Habit, HABIT_STATE, TimeOfDay, bumpStateGeneration } from '../state';
import { HabitService } from './HabitService';
import { clearTestState } from '../tests/test-utils';
import { resetTodayCache, getTodayUTCIso, parseUTCIsoDate, toUTCIsoDateString, addDays } from '../utils';
import { QUEST_CATALOG, QUEST_TIERS } from '../data/quests';
import {
    GRADE_XP_BASE, GRADE_XP_STEP, MAX_GRADE,
    XP_PER_COMPLETION, XP_PER_OVERACHIEVEMENT,
    QUEST_MAX_ACTIVE, QUEST_MASTERY_BONUS, QUEST_MIN_STEP_XP,
    CUSTOM_QUEST_MAX_TARGET
} from '../constants';
import {
    gradeFromXp, xpToAdvanceFrom, getRankTier, RANK_TIERS,
    getProgression,
    activateQuest, toggleQuestProgress, abandonQuest, createCustomQuest,
    getActiveQuests, getQuestUnlockStatus, getQuestTarget, getQuestTotalXp,
    getQuestNetProgress, getQuestProgress, isQuestExpired, isQuestRegisteredForCycleOf
} from './progression';

/** Data ISO de N dias atrás, para montar objetivos com passado. */
function daysAgo(n: number): string {
    return toUTCIsoDateString(addDays(parseUTCIsoDate(getTodayUTCIso()), -n));
}

/** XP de hábitos suficiente para qualquer grau da tabela, sem concluir objetivo. */
function grantHighGrade() {
    for (let day = 1; day <= 28; day++) {
        for (let month = 1; month <= 12; month++) {
            markDone(`h${month}`, `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
    }
}

/** Marca uma instância concluída sem passar pela camada de ações. */
function markDone(habitId: string, dateISO: string, status: number = HABIT_STATE.DONE) {
    // `setStatus` avança a geração do estado, que é a chave do cache do grau.
    HabitService.setStatus(habitId, dateISO, 'Morning', status);
}

beforeEach(() => {
    clearTestState();
});

describe('curva de grau', () => {
    it('começa no grau 1 sem nenhum XP', () => {
        const info = gradeFromXp(0);
        expect(info.grade).toBe(1);
        expect(info.xpInGrade).toBe(0);
        expect(info.xpForNext).toBe(GRADE_XP_BASE);
    });

    it('sobe exatamente no limiar, não antes', () => {
        expect(gradeFromXp(GRADE_XP_BASE - 1).grade).toBe(1);
        expect(gradeFromXp(GRADE_XP_BASE).grade).toBe(2);
    });

    it('cobra mais caro a cada grau', () => {
        expect(xpToAdvanceFrom(1)).toBe(GRADE_XP_BASE);
        expect(xpToAdvanceFrom(2)).toBe(GRADE_XP_BASE + GRADE_XP_STEP);
        expect(xpToAdvanceFrom(10)).toBe(GRADE_XP_BASE + 9 * GRADE_XP_STEP);
    });

    it('nunca passa do grau máximo, por maior que seja o XP', () => {
        const info = gradeFromXp(Number.MAX_SAFE_INTEGER);
        expect(info.grade).toBe(MAX_GRADE);
        expect(info.xpForNext).toBe(0);
    });

    it('é monotônica: mais XP nunca dá um grau menor', () => {
        let previous = 0;
        for (let xp = 0; xp < 60000; xp += 137) {
            const { grade } = gradeFromXp(xp);
            expect(grade).toBeGreaterThanOrEqual(previous);
            previous = grade;
        }
    });

    it('mantém o XP restante dentro do custo do grau atual', () => {
        for (let xp = 0; xp < 20000; xp += 91) {
            const { xpInGrade, xpForNext } = gradeFromXp(xp);
            if (xpForNext > 0) expect(xpInGrade).toBeLessThan(xpForNext);
        }
    });
});

describe('patentes', () => {
    it('cobre todos os graus de 1 ao máximo sem buraco', () => {
        for (let grade = 1; grade <= MAX_GRADE; grade++) {
            const tier = getRankTier(grade);
            expect(grade).toBeGreaterThanOrEqual(tier.minGrade);
            expect(grade).toBeLessThanOrEqual(tier.maxGrade);
        }
    });

    it('todas as patentes são alcançáveis dentro da escada', () => {
        // A falha do protótipo era esta: as duas faixas mais altas ficavam acima
        // do teto de XP que o jogo conseguia produzir.
        for (const tier of RANK_TIERS) {
            expect(tier.minGrade).toBeLessThanOrEqual(MAX_GRADE);
        }
        expect(RANK_TIERS[RANK_TIERS.length - 1].maxGrade).toBe(MAX_GRADE);
    });
});

describe('XP derivado dos hábitos', () => {
    it('conta cada instância concluída', () => {
        markDone('h1', '2026-08-03');
        markDone('h1', '2026-08-04');
        expect(getProgression().totalXp).toBe(2 * XP_PER_COMPLETION);
    });

    it('paga o extra da superação', () => {
        markDone('h1', '2026-08-03', HABIT_STATE.DONE_PLUS);
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION + XP_PER_OVERACHIEVEMENT);
    });

    it('não paga por hábito adiado', () => {
        markDone('h1', '2026-08-03', HABIT_STATE.DEFERRED);
        expect(getProgression().totalXp).toBe(0);
    });

    it('não paga por instância desmarcada (lápide)', () => {
        markDone('h1', '2026-08-03');
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);

        markDone('h1', '2026-08-03', HABIT_STATE.NULL);
        expect(getProgression().totalXp).toBe(0);
    });

    it('soma através de vários meses e hábitos', () => {
        markDone('h1', '2026-06-15');
        markDone('h2', '2026-07-20');
        markDone('h3', '2026-08-01');
        expect(getProgression().totalXp).toBe(3 * XP_PER_COMPLETION);
    });

    it('memoiza enquanto o estado não muda', () => {
        markDone('h1', '2026-08-03');
        const first = getProgression();
        expect(getProgression()).toBe(first);
    });
});

/**
 * Os testes acima marcam ids que não existem em `state.habits` — logs órfãos,
 * que valem o que renderam e não têm agenda para cobrar. Aqui os hábitos existem
 * de verdade, que é onde a regra da falta vive.
 */
describe('XP dos hábitos: a falta cobra', () => {
    /** Hábito diário começando N dias atrás. */
    function seedHabit(id: string, startedDaysAgo: number, times: TimeOfDay[] = ['Morning']): Habit {
        const start = daysAgo(startedDaysAgo);
        const habit: Habit = {
            id,
            createdOn: start,
            scheduleHistory: [{
                startDate: start,
                icon: '⭐',
                color: '#ffffff',
                goal: { type: 'check' },
                times,
                frequency: { type: 'daily' },
                scheduleAnchor: start
            }]
        };
        state.habits.push(habit);
        bumpStateGeneration();
        return habit;
    }

    it('o dia em branco devolve o preço de um dia cumprido', () => {
        seedHabit('h1', 3);
        markDone('h1', daysAgo(3));
        markDone('h1', daysAgo(2));
        // daysAgo(1) fechou vazio: dois ganhos menos uma falta.
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);
    });

    it('adiar protege: o motor cobra o silêncio, não a falha assumida', () => {
        seedHabit('h1', 3);
        markDone('h1', daysAgo(3));
        markDone('h1', daysAgo(2));
        markDone('h1', daysAgo(1), HABIT_STATE.DEFERRED);
        expect(getProgression().totalXp).toBe(2 * XP_PER_COMPLETION);
    });

    it('hoje não cobra: o dia só fecha à meia-noite', () => {
        seedHabit('h1', 2);
        markDone('h1', daysAgo(2));
        markDone('h1', daysAgo(1));
        expect(getProgression().totalXp).toBe(2 * XP_PER_COMPLETION);
    });

    it('nenhum hábito devolve mais do que deu', () => {
        seedHabit('h1', 10);
        markDone('h1', daysAgo(10));
        // Nove dias em branco valeriam -90 sobre 10 ganhos; o piso é zero.
        expect(getProgression().totalXp).toBe(0);
    });

    it('volta a conceder XP imediatamente após muitos dias sem saldo', () => {
        seedHabit('h1', 60);
        markDone('h1', daysAgo(60));
        expect(getProgression().totalXp).toBe(0);
        markDone('h1', daysAgo(0));
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);
        markDone('h1', daysAgo(0), HABIT_STATE.NULL);
        expect(getProgression().totalXp).toBe(0);
    });

    it('faltas anteriores à primeira marcação não criam dívida', () => {
        seedHabit('h1', 30);
        markDone('h1', daysAgo(1));
        markDone('h1', daysAgo(0));
        expect(getProgression().totalXp).toBe(2 * XP_PER_COMPLETION);
    });

    it('uma falta de manhã não consome o XP obtido à noite no mesmo dia', () => {
        seedHabit('h1', 1, ['Morning', 'Evening']);
        HabitService.setStatus('h1', daysAgo(1), 'Evening', HABIT_STATE.DONE);
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);
    });

    it('desconta só o saldo restante do bônus e preserva o próximo ganho', () => {
        seedHabit('h1', 4);
        markDone('h1', daysAgo(4), HABIT_STATE.DONE_PLUS);
        markDone('h1', daysAgo(0), HABIT_STATE.DONE_PLUS);
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION + XP_PER_OVERACHIEVEMENT);
    });

    it('não cobra horários adiados, fora da agenda ou removidos por exceção diária', () => {
        const habit = seedHabit('h1', 3);
        habit.scheduleHistory[0] = { ...habit.scheduleHistory[0], frequency: { type: 'interval', unit: 'days', amount: 2 } };
        state.dailyData[daysAgo(2)] = {
            h1: { dailySchedule: [], instances: {} }
        };
        markDone('h1', daysAgo(3));
        markDone('h1', daysAgo(1), HABIT_STATE.DEFERRED);
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);
    });

    it('a falta de um hábito não come o XP do outro', () => {
        seedHabit('faltoso', 10);
        markDone('faltoso', daysAgo(10));

        seedHabit('fiel', 10);
        for (let d = 10; d >= 0; d--) markDone('fiel', daysAgo(d));

        expect(getProgression().totalXp).toBe(11 * XP_PER_COMPLETION);
    });

    it('marcar o dia esquecido devolve o XP na hora', () => {
        seedHabit('h1', 3);
        markDone('h1', daysAgo(3));
        markDone('h1', daysAgo(2));
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);

        // Fez e esqueceu de marcar: volta no calendário e marca.
        markDone('h1', daysAgo(1));
        expect(getProgression().totalXp).toBe(3 * XP_PER_COMPLETION);
    });

    it('hábito graduado não cobra: ele saiu do calendário', () => {
        const habit = seedHabit('h1', 30);
        markDone('h1', daysAgo(30));
        habit.graduatedOn = daysAgo(29);
        bumpStateGeneration();
        expect(getProgression().totalXp).toBe(XP_PER_COMPLETION);
    });

    it('cobra por instância, não por dia: dois períodos são duas cobranças', () => {
        seedHabit('h1', 2, ['Morning', 'Evening']);
        markDone('h1', daysAgo(2));
        markDone('h1', daysAgo(1));
        // Quatro instâncias pedidas nos dois dias fechados, duas cumpridas.
        expect(getProgression().totalXp).toBe(0);
    });
});

describe('ciclo de vida de um objetivo', () => {
    const shortQuest = QUEST_CATALOG.find(q => q.reqGrade === 1 && q.target === 1)!;
    const weekQuest = QUEST_CATALOG.find(q => q.reqGrade === 1 && q.target > 1)!;

    it('ativa e ocupa um slot', () => {
        expect(activateQuest(shortQuest.id).ok).toBe(true);
        expect(getActiveQuests()).toHaveLength(1);
    });

    it('recusa um id que não existe no catálogo', () => {
        const result = activateQuest('nao-existe');
        expect(result).toEqual({ ok: false, reason: 'unknownQuest' });
    });

    it('para nos três slots', () => {
        const candidates = QUEST_CATALOG.filter(q => q.reqGrade === 1).slice(0, QUEST_MAX_ACTIVE + 1);
        candidates.slice(0, QUEST_MAX_ACTIVE).forEach(q => expect(activateQuest(q.id).ok).toBe(true));

        const overflow = activateQuest(candidates[QUEST_MAX_ACTIVE].id);
        expect(overflow).toEqual({ ok: false, reason: 'slotsFull' });
    });

    it('marca e desmarca o dia de hoje, como o cartão de hábito', () => {
        activateQuest(weekQuest.id);

        expect(toggleQuestProgress(weekQuest.id).ok).toBe(true);
        expect(state.quests.find(q => q.id === weekQuest.id)!.days).toHaveLength(1);

        // Segundo toque desfaz: dois estados, sem "adiado" e sem recusa.
        expect(toggleQuestProgress(weekQuest.id).ok).toBe(true);
        expect(state.quests.find(q => q.id === weekQuest.id)!.days).toHaveLength(0);
    });

    it('desmarcar devolve o XP daquele dia', () => {
        activateQuest(weekQuest.id);
        toggleQuestProgress(weekQuest.id);
        expect(getProgression().totalXp).toBeGreaterThan(0);

        toggleQuestProgress(weekQuest.id);
        expect(getProgression().totalXp).toBe(0);
    });

    it('conclui ao atingir o alvo e paga o prêmio de maestria', () => {
        activateQuest(shortQuest.id);
        const result = toggleQuestProgress(shortQuest.id);

        expect(result.ok && result.completed).toBe(true);
        const quest = state.quests.find(q => q.id === shortQuest.id)!;
        expect(quest.completedOn).toBeTruthy();

        const stepXp = Math.max(10, Math.round(shortQuest.xp / shortQuest.target));
        const bonus = Math.round(shortQuest.xp * QUEST_MASTERY_BONUS);
        expect(getProgression().totalXp).toBe(stepXp + bonus);
    });

    it('libera o slot ao concluir', () => {
        activateQuest(shortQuest.id);
        toggleQuestProgress(shortQuest.id);
        expect(getActiveQuests()).toHaveLength(0);
    });

    it('guarda datas, e não um contador', () => {
        activateQuest(weekQuest.id);
        toggleQuestProgress(weekQuest.id);

        const quest = state.quests.find(q => q.id === weekQuest.id)!;
        expect(quest.days).toHaveLength(1);
        expect(quest.days[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('usa a data do calendário local, não a UTC', () => {
        // 23:30 em São Paulo é o dia seguinte em UTC. Um
        // `toISOString().slice(0,10)` gravaria amanhã e o botão nunca reabriria.
        const tz = process.env.TZ;
        process.env.TZ = 'America/Sao_Paulo';
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-13T02:30:00Z')); // 23:30 de 12/03 em BRT
        // getTodayUTCIso memoiza por 60s e clearTestState já o esquentou com a
        // data real; sem este reset o teste leria hoje, não o dia fingido.
        resetTodayCache();

        try {
            activateQuest(weekQuest.id);
            toggleQuestProgress(weekQuest.id);
            const quest = state.quests.find(q => q.id === weekQuest.id)!;
            expect(quest.days[0]).toBe('2026-03-12');
        } finally {
            vi.useRealTimers();
            process.env.TZ = tz;
            resetTodayCache();
        }
    });

    it('mostra todos os ativos mesmo acima do teto, para o excedente ser desfeito', () => {
        // Cenário de merge: dois aparelhos com dois slots ocupados, cada um
        // ativando um objetivo diferente offline, chegam a quatro ativos. Cortar
        // a lista em três prenderia o quarto num limbo sem registrar nem abandonar.
        state.quests = QUEST_CATALOG.filter(q => q.reqGrade === 1)
            .slice(0, QUEST_MAX_ACTIVE + 1)
            .map(q => ({ id: q.id, startedOn: getTodayUTCIso(), days: [] }));

        expect(getActiveQuests()).toHaveLength(QUEST_MAX_ACTIVE + 1);
        expect(abandonQuest(state.quests[QUEST_MAX_ACTIVE].id).ok).toBe(true);
        expect(getActiveQuests()).toHaveLength(QUEST_MAX_ACTIVE);
    });

    it('abandona com lápide, sem apagar o registro', () => {
        activateQuest(weekQuest.id);
        toggleQuestProgress(weekQuest.id);
        expect(abandonQuest(weekQuest.id).ok).toBe(true);

        const quest = state.quests.find(q => q.id === weekQuest.id)!;
        expect(quest.abandonedOn).toBeTruthy();
        expect(getActiveQuests()).toHaveLength(0);
    });

    it('abandonar não zera na hora: o XP derrete com os dias, não com o gesto', () => {
        activateQuest(weekQuest.id);
        toggleQuestProgress(weekQuest.id);
        const earned = getProgression().totalXp;
        expect(earned).toBeGreaterThan(0);

        abandonQuest(weekQuest.id);
        expect(getProgression().totalXp).toBe(earned);
    });

    it('o objetivo largado derrete sozinho até zero', () => {
        // Um avanço no primeiro dia e mais nada: os ciclos vazios seguem correndo
        // depois da lápide, e o líquido chega ao chão.
        state.quests = [{
            id: weekQuest.id,
            startedOn: daysAgo(10),
            days: [daysAgo(10)],
            abandonedOn: daysAgo(9)
        }];
        bumpStateGeneration();

        expect(getProgression().totalXp).toBe(0);
    });

    it('reativar recupera o progresso em vez de duplicar o registro', () => {
        activateQuest(weekQuest.id);
        toggleQuestProgress(weekQuest.id);
        abandonQuest(weekQuest.id);

        expect(activateQuest(weekQuest.id).ok).toBe(true);
        expect(state.quests.filter(q => q.id === weekQuest.id)).toHaveLength(1);
        expect(state.quests.find(q => q.id === weekQuest.id)!.days).toHaveLength(1);
    });
});

describe('objetivo personalizado', () => {
    it('deriva o XP do alvo em vez de aceitá-lo pronto', () => {
        expect(createCustomQuest('Tocar violão', 10).ok).toBe(true);

        const quest = state.quests[0];
        expect(getQuestTarget(quest)).toBe(10);
        // O protótipo recebia o XP por argumento, o que deixava qualquer um
        // cunhar o próprio grau. Aqui ele é função do alvo.
        expect(getQuestTotalXp(quest)).toBe(10 * 25);
    });

    it('prende o alvo dentro da faixa', () => {
        createCustomQuest('Exagerado', 99999);
        expect(getQuestTarget(state.quests[0])).toBe(CUSTOM_QUEST_MAX_TARGET);

        clearTestState();
        createCustomQuest('Zerado', 0);
        expect(getQuestTarget(state.quests[0])).toBe(1);
    });

    it('recusa título vazio', () => {
        expect(createCustomQuest('   ', 7)).toEqual({ ok: false, reason: 'invalidTitle' });
        expect(state.quests).toHaveLength(0);
    });

    it('sanitiza o título', () => {
        createCustomQuest('<script>alerta</script>', 5);
        expect(state.quests[0].customTitle).not.toContain('<');
        expect(state.quests[0].customTitle).not.toContain('>');
    });

    it('respeita o limite de slots', () => {
        for (let i = 0; i < QUEST_MAX_ACTIVE; i++) createCustomQuest(`Objetivo ${i}`, 3);
        expect(createCustomQuest('Sobrando', 3)).toEqual({ ok: false, reason: 'slotsFull' });
    });
});

describe('desbloqueio de levas', () => {
    it('deriva as levas do catálogo, em ordem', () => {
        expect(QUEST_TIERS.length).toBeGreaterThan(1);
        expect([...QUEST_TIERS]).toEqual([...QUEST_TIERS].sort((a, b) => a - b));
        expect(QUEST_TIERS[0]).toBe(1);
    });

    it('a primeira leva está sempre aberta', () => {
        expect(getQuestUnlockStatus(QUEST_TIERS[0]).unlocked).toBe(true);
    });

    it('barra por grau insuficiente', () => {
        const highTier = QUEST_TIERS[QUEST_TIERS.length - 1];
        expect(getQuestUnlockStatus(highTier)).toEqual({
            unlocked: false, reason: 'grade', requiredGrade: highTier
        });
    });

    it('barra a leva seguinte enquanto a atual ainda enche os slots', () => {
        grantHighGrade();

        const secondTier = QUEST_TIERS[1];
        expect(getProgression().grade).toBeGreaterThanOrEqual(secondTier);

        const status = getQuestUnlockStatus(secondTier);
        expect(status.unlocked).toBe(false);
        expect(status.unlocked === false && status.reason).toBe('slots');
    });

    it('abre a leva seguinte quando sobra um slot sem candidato da leva atual', () => {
        const [firstTier, secondTier] = QUEST_TIERS;
        const firstTierQuests = QUEST_CATALOG.filter(q => q.reqGrade === firstTier);
        // Deixa exatamente QUEST_MAX_ACTIVE - 1 pendentes: um slot fica sem
        // candidato da leva atual, e é dele que a leva seguinte toma posse.
        const completed = firstTierQuests.length - (QUEST_MAX_ACTIVE - 1);

        state.quests = firstTierQuests.slice(0, completed).map(q => ({
            id: q.id, startedOn: '2026-01-01', days: ['2026-01-01'], completedOn: '2026-01-01'
        }));
        grantHighGrade();

        expect(getQuestUnlockStatus(secondTier).unlocked).toBe(true);
    });

    it('ainda barra quando falta um só para desocupar o slot', () => {
        const [firstTier, secondTier] = QUEST_TIERS;
        const firstTierQuests = QUEST_CATALOG.filter(q => q.reqGrade === firstTier);
        const completed = firstTierQuests.length - QUEST_MAX_ACTIVE;

        state.quests = firstTierQuests.slice(0, completed).map(q => ({
            id: q.id, startedOn: '2026-01-01', days: ['2026-01-01'], completedOn: '2026-01-01'
        }));
        grantHighGrade();

        const status = getQuestUnlockStatus(secondTier);
        expect(status.unlocked).toBe(false);
        expect(status.unlocked === false && status.reason === 'slots' && status.pending).toBe(QUEST_MAX_ACTIVE);
    });

    it('objetivo em curso ocupa slot: guardá-lo num slot não abre a leva seguinte', () => {
        const [firstTier, secondTier] = QUEST_TIERS;
        const firstTierQuests = QUEST_CATALOG.filter(q => q.reqGrade === firstTier);
        const completed = firstTierQuests.length - QUEST_MAX_ACTIVE;

        state.quests = firstTierQuests.slice(0, completed).map(q => ({
            id: q.id, startedOn: '2026-01-01', days: ['2026-01-01'], completedOn: '2026-01-01'
        }));
        grantHighGrade();
        // Um dos três que faltam vai para um slot: pendentes caem a 2, mas o
        // ativo ocupa o lugar que ele desocupou. A soma não muda.
        expect(activateQuest(firstTierQuests[completed].id).ok).toBe(true);

        expect(getQuestUnlockStatus(secondTier).unlocked).toBe(false);
    });

    it('nenhuma leva além da seguinte abre de uma vez', () => {
        grantHighGrade();
        const thirdTier = QUEST_TIERS[2];

        const status = getQuestUnlockStatus(thirdTier);
        expect(status.unlocked).toBe(false);
        expect(status.unlocked === false && status.reason).toBe('later');
    });

    it('caducar não conta como cumprir: o objetivo continua disputando o slot', () => {
        const [firstTier, secondTier] = QUEST_TIERS;
        const firstTierQuests = QUEST_CATALOG.filter(q => q.reqGrade === firstTier);
        const completed = firstTierQuests.length - QUEST_MAX_ACTIVE;

        // Todos concluídos menos três; os três restantes foram ativados e
        // deixados morrer. Se caducar tirasse da conta, a leva seguinte abriria.
        state.quests = [
            ...firstTierQuests.slice(0, completed).map(q => ({
                id: q.id, startedOn: '2026-01-01', days: ['2026-01-01'], completedOn: '2026-01-01'
            })),
            ...firstTierQuests.slice(completed).map(q => ({
                id: q.id, startedOn: '2026-01-01', days: []
            }))
        ];
        grantHighGrade();

        expect(getActiveQuests()).toHaveLength(0);
        expect(getQuestUnlockStatus(secondTier).unlocked).toBe(false);
    });
});

describe('regressão e caducidade', () => {
    const dailyQuest = QUEST_CATALOG.find(q => q.reqGrade === 1 && q.target === 3 && !q.cadence)!;
    const weeklyQuest = QUEST_CATALOG.find(q => q.cadence === 7)!;

    /** Objetivo em curso com um passado montado à mão. */
    function seed(id: string, startedOn: string, days: string[]) {
        state.quests = [{ id, startedOn, days }];
        return state.quests[0];
    }

    it('não cobra o dia de hoje: o avanço só regride quando o dia fecha', () => {
        // Marcou os três últimos dias, incluindo anteontem e ontem; hoje ainda
        // está em aberto, então nada foi perdido.
        const quest = seed(dailyQuest.id, daysAgo(3), [daysAgo(3), daysAgo(2), daysAgo(1)]);
        expect(getQuestNetProgress(quest)).toBe(3);
    });

    it('desconta um por dia perdido', () => {
        // Três dias marcados, o quarto passou em branco: 3 - 1 = 2.
        const quest = seed(dailyQuest.id, daysAgo(4), [daysAgo(4), daysAgo(3), daysAgo(2)]);
        expect(getQuestNetProgress(quest)).toBe(2);
    });

    it('desconta cada dia perdido, um a um', () => {
        const quest = seed(dailyQuest.id, daysAgo(5), [daysAgo(5), daysAgo(4), daysAgo(3)]);
        expect(getQuestNetProgress(quest)).toBe(1);
    });

    it('a barra nunca mostra número negativo', () => {
        const quest = seed(dailyQuest.id, daysAgo(3), []);
        expect(getQuestNetProgress(quest)).toBe(0);
        expect(getQuestProgress(quest)).toBe(0);
    });

    it('sobrevive ao dia da ativação sem nenhuma marca', () => {
        const quest = seed(dailyQuest.id, getTodayUTCIso(), []);
        expect(getQuestNetProgress(quest)).toBe(0);
        expect(isQuestExpired(quest)).toBe(false);
        expect(getActiveQuests()).toHaveLength(1);
    });

    it('caduca e sai da lista ao chegar no piso', () => {
        const quest = seed(dailyQuest.id, daysAgo(1), []);
        expect(getQuestNetProgress(quest)).toBe(0);
        expect(isQuestExpired(quest)).toBe(true);
        expect(getActiveQuests()).toHaveLength(0);
    });

    it('permite recuperar no dia em que zera e concede o passo inteiro', () => {
        const quest = seed(dailyQuest.id, daysAgo(2), [daysAgo(2)]);
        expect(getQuestNetProgress(quest)).toBe(0);
        expect(isQuestExpired(quest)).toBe(false);
        expect(toggleQuestProgress(quest.id).ok).toBe(true);
        expect(getQuestNetProgress(quest)).toBe(1);
        expect(getProgression().totalXp).toBe(Math.max(QUEST_MIN_STEP_XP, Math.round(dailyQuest.xp / dailyQuest.target)));
    });

    it('sai dos ativos no dia seguinte ao dia em que zerou', () => {
        const quest = seed(dailyQuest.id, daysAgo(3), [daysAgo(3)]);
        expect(getQuestNetProgress(quest)).toBe(0);
        expect(isQuestExpired(quest)).toBe(true);
        expect(getActiveQuests()).toEqual([]);
        expect(activateQuest(quest.id).ok).toBe(true);
        expect(toggleQuestProgress(quest.id).ok).toBe(true);
        expect(getQuestNetProgress(quest)).toBe(1);
    });

    it('objetivo semanal também sai no dia seguinte ao zero, sem esperar outra semana', () => {
        const quest = seed(weeklyQuest.id, daysAgo(14), [daysAgo(14)]);
        expect(isQuestExpired(quest)).toBe(false);
        const expired = seed(weeklyQuest.id, daysAgo(15), [daysAgo(15)]);
        expect(isQuestExpired(expired)).toBe(true);
    });

    it('reativa personalizado expirado preservando título, alvo e histórico', () => {
        const quest = seed('custom:retomar', daysAgo(30), [daysAgo(30)]);
        Object.assign(quest, { customTitle: 'Praticar', customTarget: 10 });
        expect(isQuestExpired(quest)).toBe(true);
        expect(activateQuest(quest.id).ok).toBe(true);
        expect(toggleQuestProgress(quest.id).ok).toBe(true);
        expect(getQuestProgress(quest)).toBe(1);
        expect(getQuestTarget(quest)).toBe(10);
        expect(quest.days).toContain(daysAgo(30));
        expect(state.quests).toHaveLength(1);
    });

    it('ativar um objetivo já ativo não reinicia o saldo', () => {
        const quest = seed(dailyQuest.id, daysAgo(1), [daysAgo(1)]);
        expect(activateQuest(quest.id).ok).toBe(true);
        expect(quest.attemptFrom).toBeUndefined();
        expect(getQuestProgress(quest)).toBe(1);
    });

    it('caducado não aceita mais avanço', () => {
        seed(dailyQuest.id, daysAgo(1), []);
        expect(toggleQuestProgress(dailyQuest.id)).toEqual({ ok: false, reason: 'unknownQuest' });
    });

    it('ritmo semanal não é cobrado todo dia', () => {
        const almost = seed(weeklyQuest.id, daysAgo(6), []);
        expect(isQuestExpired(almost)).toBe(false);

        const late = seed(weeklyQuest.id, daysAgo(7), []);
        expect(isQuestExpired(late)).toBe(true);
    });

    it('ritmo semanal não fecha em dias seguidos', () => {
        // REGRESSÃO: o líquido creditava cada DIA marcado e cobrava por CICLO,
        // então marcar quatro dias seguidos fechava um objetivo de quatro
        // semanas — e uma mentoria de doze semanas caía em doze dias, com o XP
        // inteiro mais o bônus de maestria.
        const dias = Array.from({ length: weeklyQuest.target }, (_, i) => daysAgo(weeklyQuest.target - 1 - i));
        const quest = seed(weeklyQuest.id, dias[0], dias);

        expect(getQuestNetProgress(quest)).toBe(1);
        expect(getQuestProgress(quest)).toBeLessThan(weeklyQuest.target);
    });

    it('um crédito por ciclo, tanto na barra quanto no XP', () => {
        const cadencia = weeklyQuest.cadence!;
        // Duas semanas de fato, com um avanço repetido dentro da primeira.
        const quest = seed(weeklyQuest.id, daysAgo(cadencia + 1), [
            daysAgo(cadencia + 1), daysAgo(cadencia), daysAgo(1)
        ]);
        const stepXp = Math.max(QUEST_MIN_STEP_XP, Math.round(weeklyQuest.xp / weeklyQuest.target));

        expect(getQuestNetProgress(quest)).toBe(2);
        expect(getProgression().totalXp).toBe(2 * stepXp);
    });

    it('registrado num ciclo vale o ciclo inteiro', () => {
        // O cartão reabria no dia seguinte e aceitava uma marca que não rendia
        // nada — a tela dizia "disponível" para um avanço já creditado.
        const quest = seed(weeklyQuest.id, daysAgo(1), [daysAgo(1)]);
        expect(isQuestRegisteredForCycleOf(quest, getTodayUTCIso())).toBe(true);

        // E tocar de novo desfaz o avanço do ciclo, não só o dia de hoje.
        expect(toggleQuestProgress(weeklyQuest.id)).toEqual({ ok: true, completed: false });
        expect(state.quests[0].days).toEqual([]);
    });

    it('dia no futuro não conta como avanço', () => {
        // Um aparelho com o relógio adiantado (ou um backup editado) gravava
        // datas à frente de hoje; elas entravam na contagem sem nenhum ciclo
        // fechado correspondente e fechavam o objetivo sem trabalho nenhum.
        const amanha = toUTCIsoDateString(addDays(parseUTCIsoDate(getTodayUTCIso()), 1));
        const depois = toUTCIsoDateString(addDays(parseUTCIsoDate(getTodayUTCIso()), 2));
        const quest = seed(dailyQuest.id, getTodayUTCIso(), [amanha, depois]);

        expect(getQuestNetProgress(quest)).toBe(0);
        expect(getQuestProgress(quest)).toBe(0);
        expect(getProgression().totalXp).toBe(0);
    });

    it('o grau memoizado não atravessa a meia-noite', () => {
        // REGRESSÃO: a chave do memo era só a geração do estado, e a virada do
        // dia não escreve nada — a leitura ficava congelada no valor de ontem
        // até que alguma outra ação bumpasse a geração.
        //
        // A sonda é um dia marcado à frente (chega assim de um aparelho com o
        // relógio adiantado): hoje ele não conta, amanhã conta, e nada no estado
        // muda entre os dois momentos.
        const tz = process.env.TZ;
        process.env.TZ = 'UTC';
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
            resetTodayCache();
            state.quests = [{ id: dailyQuest.id, startedOn: '2026-03-10', days: ['2026-03-10'] }];
            const stepXp = Math.max(QUEST_MIN_STEP_XP, Math.round(dailyQuest.xp / dailyQuest.target));
            expect(getProgression().totalXp).toBe(stepXp);

            // Dois dias à frente, com o mesmo estado: o ciclo do dia 11 venceu
            // vazio, o líquido caiu a zero e o XP foi junto.
            vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));
            resetTodayCache();
            expect(getProgression().totalXp).toBe(0);
        } finally {
            vi.useRealTimers();
            process.env.TZ = tz;
            resetTodayCache();
        }
    });

    it('concluído e abandonado não caducam depois', () => {
        state.quests = [
            { id: dailyQuest.id, startedOn: daysAgo(30), days: [daysAgo(30)], completedOn: daysAgo(28) },
            { id: weeklyQuest.id, startedOn: daysAgo(30), days: [], abandonedOn: daysAgo(29) }
        ];
        expect(state.quests.every(q => !isQuestExpired(q))).toBe(true);
    });

    it('a regressão leva o XP junto: barra e grau são a mesma conta', () => {
        // Dois dias marcados, dois perdidos: a barra zera e o XP zera com ela.
        const quest = seed(dailyQuest.id, daysAgo(4), [daysAgo(4), daysAgo(3)]);

        expect(getQuestProgress(quest)).toBe(0);
        expect(getProgression().totalXp).toBe(0);
    });

    it('repor o dia esquecido devolve o XP do objetivo', () => {
        // O caso de quem fez e não marcou. Nada aqui é acumulado, então voltar no
        // calendário não "credita de novo": recalcula, e o valor volta sozinho.
        const quest = seed(dailyQuest.id, daysAgo(2), [daysAgo(2)]);
        const stepXp = Math.max(QUEST_MIN_STEP_XP, Math.round(dailyQuest.xp / dailyQuest.target));

        expect(getProgression().totalXp).toBe(0);

        quest.days.push(daysAgo(1));
        bumpStateGeneration();

        expect(getQuestProgress(quest)).toBe(2);
        expect(getProgression().totalXp).toBe(2 * stepXp);
    });

    it('retomar reabre a janela sem apagar os dias já ganhos', () => {
        seed(dailyQuest.id, daysAgo(10), [daysAgo(10)]);
        expect(isQuestExpired(state.quests[0])).toBe(true);

        expect(activateQuest(dailyQuest.id).ok).toBe(true);
        const quest = state.quests[0];

        expect(quest.attemptFrom).toBe(getTodayUTCIso());
        expect(quest.days).toEqual([daysAgo(10)]);
        expect(getQuestNetProgress(quest)).toBe(0);
        expect(isQuestExpired(quest)).toBe(false);
    });

    it('fecha pelo líquido: o dia perdido tem de ser reposto', () => {
        // Alvo 3, dois marcados e um perdido (líquido 1). Registrar hoje leva o
        // líquido a 2, não ao alvo — o objetivo continua em curso.
        seed(dailyQuest.id, daysAgo(3), [daysAgo(3), daysAgo(2)]);
        const result = toggleQuestProgress(dailyQuest.id);

        expect(result).toEqual({ ok: true, completed: false });
        expect(getQuestNetProgress(state.quests[0])).toBe(2);
    });

    it('caducado volta a contar como pendente para os slots', () => {
        // Caducar não é cumprir: o objetivo continua disputando o slot e pode ser
        // retomado do catálogo.
        seed(dailyQuest.id, daysAgo(10), []);
        expect(getActiveQuests()).toHaveLength(0);
        expect(activateQuest(dailyQuest.id).ok).toBe(true);
    });
});

describe('teto de XP por leva', () => {
    const tierQuests = (tier: number) => QUEST_CATALOG.filter(q => q.reqGrade === tier);

    /** Conclui toda uma leva direto no estado, com os dias de cada objetivo. */
    function completeTier(tier: number) {
        state.quests = [
            ...state.quests,
            ...tierQuests(tier).map(q => ({
                id: q.id,
                startedOn: '2026-01-01',
                days: Array.from({ length: q.target }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`),
                completedOn: '2026-02-01'
            }))
        ];
        // Atribuir a `state.quests` não avança a geração, e o grau é memoizado.
        bumpStateGeneration();
    }

    /** XP acumulado para estar no começo de um grau. */
    const xpToReach = (grade: number) => {
        let total = 0;
        for (let g = 1; g < grade; g++) total += xpToAdvanceFrom(g);
        return total;
    };

    it('limpar a primeira leva para no grau anterior ao da leva seguinte', () => {
        completeTier(QUEST_TIERS[0]);

        const ceiling = QUEST_TIERS[1] - 1;
        const info = getProgression();

        expect(info.grade).toBe(ceiling);
        expect(info.totalXp).toBe(xpToReach(ceiling));
        // Exatamente no começo do grau: o último passo é dos hábitos.
        expect(info.xpInGrade).toBe(0);
    });

    it('o excedente é descartado, não guardado para a leva seguinte', () => {
        completeTier(QUEST_TIERS[0]);
        completeTier(QUEST_TIERS[1]);

        const ceiling = QUEST_TIERS[2] - 1;
        expect(getProgression().totalXp).toBe(xpToReach(ceiling));
    });

    it('nunca entrega o grau exigido pela leva seguinte', () => {
        completeTier(QUEST_TIERS[0]);
        expect(getProgression().grade).toBeLessThan(QUEST_TIERS[1]);
    });

    it('hábito não tem teto: o XP diário passa por cima do corte', () => {
        completeTier(QUEST_TIERS[0]);
        const semHabitos = getProgression().totalXp;

        grantHighGrade();
        expect(getProgression().totalXp).toBeGreaterThan(semHabitos);
        expect(getProgression().grade).toBeGreaterThan(QUEST_TIERS[1]);
    });

    it('objetivo personalizado também entra no teto', () => {
        // Sem isto, 365 dias de um objetivo inventado renderiam 9.125 XP soltos.
        expect(createCustomQuest('Mina de XP', CUSTOM_QUEST_MAX_TARGET).ok).toBe(true);
        const quest = state.quests[0] as { startedOn: string; days: string[] };
        // 120 dias SEGUIDOS até hoje: sem buraco, o líquido é 120 e o bruto
        // (120 x 25 = 3.000 XP) fica muito acima do teto da leva.
        quest.startedOn = daysAgo(119);
        quest.days = Array.from({ length: 120 }, (_, i) => daysAgo(119 - i));
        bumpStateGeneration();

        expect(getProgression().totalXp).toBe(xpToReach(QUEST_TIERS[1] - 1));
    });
});

afterEach(() => {
    vi.useRealTimers();
});
