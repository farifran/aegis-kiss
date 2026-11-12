
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file services/migration.ts
 * @description Inicializador de Estado e Sanitizador de Schema.
 */

import { logger, getTodayUTCIso, sanitizeText } from '../utils';
import { AppState, SyncLog, QuestRecord } from '../state';
import { normalizeHabitMode, normalizeTimesByMode, normalizeFrequencyByMode } from './habitActions';
import { HabitService } from './HabitService';
import { CUSTOM_QUEST_MAX_TITLE_LENGTH, CUSTOM_QUEST_MAX_TARGET, QUEST_NOTE_MAX_LENGTH } from '../constants';

/**
 * Migra os bitmasks mensais de 6 bits/dia (v8) para 9 bits/dia (v9).
 */
function migrateBitmasksV8toV9(logs: Map<string, bigint>): Map<string, bigint> {
    const newMap = new Map<string, bigint>();
    
    for (const [key, oldLog] of logs.entries()) {
        let newLog = 0n;
        // Processa cada um dos 31 dias possíveis no log mensal
        for (let day = 1; day <= 31; day++) {
            // Offsets antigos (V8): Manhã=0, Tarde=2, Noite=4
            // Offsets novos (V9): Manhã=0, Tarde=3, Noite=6
            const oldDayBase = BigInt((day - 1) * 6);
            const newDayBase = BigInt((day - 1) * 9);

            for (let pIdx = 0; pIdx < 3; pIdx++) {
                const oldBitPos = oldDayBase + BigInt(pIdx * 2);
                const status = (oldLog >> oldBitPos) & 3n;
                
                const newBitPos = newDayBase + BigInt(pIdx * 3);
                newLog |= (status << newBitPos);
                // O bit de lápide (newBitPos + 2) é inicializado como 0 automaticamente
            }
        }
        newMap.set(key, newLog);
    }
    
    return newMap;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Aceita apenas registros de objetivo com forma reconhecível e descarta o resto.
 *
 * Roda contra dados que podem vir da nuvem de outro aparelho ou de um import
 * manual, então trata tudo como hostil: `days` é deduplicado e ordenado aqui
 * para que `days.length` seja de fato o progresso, e não a contagem de um dia
 * gravado duas vezes por um merge malfeito.
 */
/**
 * Notas de objetivo vindas de um JSON importado: só chaves de data válida e texto
 * saneado, e nada de `__proto__` — é o mesmo cuidado que `dailyData` recebe.
 */
function sanitizeQuestNotes(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object') return undefined;

    const notes: Record<string, string> = Object.create(null);
    let found = false;
    for (const [date, text] of Object.entries(raw as Record<string, unknown>)) {
        if (!ISO_DATE.test(date) || typeof text !== 'string') continue;
        const clean = sanitizeText(text, QUEST_NOTE_MAX_LENGTH);
        if (!clean) continue;
        notes[date] = clean;
        found = true;
    }
    return found ? { ...notes } : undefined;
}

/**
 * Alvo de objetivo personalizado vindo de fora, preso na mesma faixa que o
 * formulário impõe em `createCustomQuest`.
 *
 * Aceitar "qualquer número finito" abria dois buracos: `0` fazia `getQuestStepXp`
 * dividir por zero, e o NaN resultante atravessava a soma de XP até
 * `gradeFromXp`, cujo laço não sai enquanto a comparação for falsa — o usuário
 * saía promovido ao grau máximo. Um alvo enorme cunhava grau pelo outro lado,
 * via bônus de maestria proporcional ao total.
 */
function sanitizeQuestTarget(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.min(CUSTOM_QUEST_MAX_TARGET, Math.max(1, Math.floor(raw)));
}

function sanitizeQuests(raw: unknown): QuestRecord[] {
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const result: QuestRecord[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const quest = entry as Partial<QuestRecord>;
        if (typeof quest.id !== 'string' || !quest.id || seen.has(quest.id)) continue;
        seen.add(quest.id);

        const days = Array.isArray(quest.days)
            ? Array.from(new Set(quest.days.filter((d): d is string => typeof d === 'string' && ISO_DATE.test(d)))).sort()
            : [];

        result.push({
            id: quest.id,
            startedOn: typeof quest.startedOn === 'string' && ISO_DATE.test(quest.startedOn) ? quest.startedOn : getTodayUTCIso(),
            days,
            attemptFrom: typeof quest.attemptFrom === 'string' && ISO_DATE.test(quest.attemptFrom) ? quest.attemptFrom : undefined,
            notes: sanitizeQuestNotes(quest.notes),
            completedOn: typeof quest.completedOn === 'string' && ISO_DATE.test(quest.completedOn) ? quest.completedOn : undefined,
            abandonedOn: typeof quest.abandonedOn === 'string' && ISO_DATE.test(quest.abandonedOn) ? quest.abandonedOn : undefined,
            // O título de objetivo personalizado é o único texto livre daqui, e
            // pode chegar de um JSON importado — mesmo tratamento do nome de hábito.
            customTitle: typeof quest.customTitle === 'string' ? sanitizeText(quest.customTitle, CUSTOM_QUEST_MAX_TITLE_LENGTH) : undefined,
            customTarget: sanitizeQuestTarget(quest.customTarget)
        });
    }

    return result;
}

export function migrateState(loadedState: unknown, targetVersion: number): AppState {
    // 1. FRESH INSTALL / NULL STATE
    if (!loadedState) {
        return { 
            version: targetVersion, 
            habits: [], 
            dailyData: {}, 
            archives: {}, 
            dailyDiagnoses: {}, 
            lastModified: Date.now(), 
            notificationsShown: [], 
            pending21DayHabitIds: [], 
            pendingConsolidationHabitIds: [], 
            hasOnboarded: true,
            syncLogs: [],
            quests: [],
            monthlyLogs: new Map(),
            aiDailyCount: 0,
            aiQuotaDate: getTodayUTCIso(),
            lastAIContextHash: null
        } as AppState;
    }

    const state = loadedState as AppState;
    const currentVersion = state.version || 0;

    // 2. SCHEMA HYDRATION (Map/BigInt Reconstruction)
    if (state.monthlyLogs && !(state.monthlyLogs instanceof Map)) {
        state.monthlyLogs = HabitService.deserializeLogs(state.monthlyLogs);
    } else if (!state.monthlyLogs) {
        state.monthlyLogs = new Map();
    }

    // 3. SCHEMA UPGRADE: V8 -> V9 (9-bit Bitmask Expansion)
    if (currentVersion < 9 && state.monthlyLogs.size > 0) {
        logger.info(`[Migration] Upgrading bitmasks from v${currentVersion} to v9...`);
        try {
            state.monthlyLogs = migrateBitmasksV8toV9(state.monthlyLogs);
            logger.info("[Migration] Bitmask expansion successful.");
        } catch (err) {
            logger.error("[Migration] Bitmask expansion failed!", err);
        }
    }

    // 4. SCHEMA UPGRADE: V9 -> V10 (AI Quota & Hash)
    // Inicializa campos de quota se não existirem
    if (state.aiDailyCount === undefined) {
        state.aiDailyCount = 0;
        state.aiQuotaDate = getTodayUTCIso();
        state.lastAIContextHash = null;
    }

    if (state.hasOnboarded === undefined) {
        Object.assign(state, { hasOnboarded: true });
    }

    // 5. SCHEMA UPGRADE: V11 -> V12 (Progressão e Objetivos Secundários)
    // Estado anterior à v12 não tem `quests`; o sanitizador devolve [] e o grau
    // passa a ser derivado apenas do histórico de hábitos, que já existe.
    Object.assign(state, { quests: sanitizeQuests(state.quests) });

    if (!state.syncLogs) {
        Object.assign(state, { syncLogs: [] });
    } else {
        Object.assign(state, { syncLogs: state.syncLogs.map((log: SyncLog) => ({
            time: log.time,
            msg: log.msg,
            type: log.type
        })) });
    }

    // Sanitize scheduleHistory mode/times to avoid duplicate TimeOfDay entries
    // e garantir regra de unicidade para hábitos atitudinais.
    if (state.habits && state.habits.length > 0) {
        for (const habit of state.habits) {
            for (let i = 0; i < habit.scheduleHistory.length; i++) {
                const schedule = habit.scheduleHistory[i];
                const normalizedMode = normalizeHabitMode(schedule.mode);
                const normalizedTimes = normalizeTimesByMode(normalizedMode, schedule.times);
                const normalizedFrequency = normalizeFrequencyByMode(normalizedMode, schedule.frequency);
                const hadModeChange = schedule.mode !== normalizedMode;
                const hadTimesChange =
                    normalizedTimes.length !== schedule.times.length
                    || normalizedTimes.some((time, idx) => time !== schedule.times[idx]);
                const hadFrequencyChange = JSON.stringify(normalizedFrequency) !== JSON.stringify(schedule.frequency);

                if (hadModeChange) {
                    Object.assign(habit.scheduleHistory[i], { mode: normalizedMode });
                }

                if (hadTimesChange) {
                    logger.warn(`[Migration] Habit "${schedule.name}": normalized times for mode=${normalizedMode}`);
                    Object.assign(habit.scheduleHistory[i], { times: normalizedTimes });
                }

                if (hadFrequencyChange) {
                    logger.warn(`[Migration] Habit "${schedule.name}": normalized frequency for mode=${normalizedMode}`);
                    Object.assign(habit.scheduleHistory[i], { frequency: normalizedFrequency });
                }
            }
        }
    }

    // Force target version
    Object.assign(state, { version: targetVersion });
    
    return state;
}
