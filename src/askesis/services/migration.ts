
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file services/migration.ts
 * @description Inicializador de Estado e Sanitizador de Schema.
 */

import { logger, getTodayUTCIso } from '../utils';
import { AppState, SyncLog } from '../state';
import { normalizeHabitMode, normalizeTimesByMode, normalizeFrequencyByMode } from './habitActions';

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
        try {
            const entries = Array.isArray(state.monthlyLogs) 
                ? state.monthlyLogs 
                : Object.entries(state.monthlyLogs);
                
            state.monthlyLogs = new Map(entries.map(([k, v]: [string, unknown]) => {
                let bigVal: bigint;
                const obj = (v !== null && typeof v === 'object') ? v as Record<string, unknown> : null;
                if (obj && obj['__type'] === 'bigint') {
                    bigVal = BigInt(obj['val'] as string);
                } else if (typeof v === 'bigint') {
                    bigVal = v;
                } else {
                    bigVal = BigInt(v as string);
                }
                return [k, bigVal] as [string, bigint];
            }));
        } catch (e) {
            logger.warn("[Migration] Failed to hydrate monthlyLogs", e);
            state.monthlyLogs = new Map();
        }
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
