/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/merge.ts
 * @description Algoritmo principal de merge CRDT-lite: mergeStates, mergeHabitHistories, mergeDayRecord.
 */

import type { AppState, HabitDailyInfo, Habit, HabitSchedule } from '../../state';
import { logger } from '../../utils';
import { HabitService } from '../HabitService';
import { normalizeHabitMode, normalizeTimesByMode, normalizeFrequencyByMode } from '../habitActions';
import type { MergeOptions } from './types';
import { isUnsafeObjectKey, isHabitInstanceKey } from './validation';
import { hydrateLogs, sanitizeDailyData } from './hydration';
import { getHabitIdentity, getLatestSchedule, schedulesEquivalent } from './identity';
import { evaluateIdentityDedupStrategy, findFuzzyIdentityMatchId } from './dedupStrategy';

type HabitInstanceMap = NonNullable<HabitDailyInfo['instances']>;

export function mergeHabitHistories(winnerHistory: HabitSchedule[], loserHistory: HabitSchedule[]): HabitSchedule[] {
    const historyMap = new Map<string, HabitSchedule>();
    loserHistory.forEach(s => historyMap.set(s.startDate, { ...s }));
    winnerHistory.forEach(s => historyMap.set(s.startDate, { ...s }));
    // Use stable string comparison to avoid locale-dependent ordering
    return Array.from(historyMap.values()).sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

function mergeDayRecord(source: Record<string, HabitDailyInfo>, target: Record<string, HabitDailyInfo>) {
    for (const habitId of Object.keys(source)) {
        if (isUnsafeObjectKey(habitId)) continue;

        const sourceHabit = source[habitId];
        const targetHabit = target[habitId];

        if (!targetHabit) {
            target[habitId] = structuredClone(sourceHabit);
            continue;
        }

        const sourceInstances: HabitInstanceMap = sourceHabit.instances ?? {};
        const targetInstances: HabitInstanceMap = targetHabit.instances ?? {};

        for (const time of Object.keys(sourceInstances)) {
            if (!isHabitInstanceKey(time)) continue;

            const srcInst = sourceInstances[time];
            const tgtInst = targetInstances[time];
            if (!srcInst) continue;

            if (!tgtInst) {
                targetInstances[time] = { ...srcInst };
            } else {
                if ((srcInst.note?.length || 0) > (tgtInst.note?.length || 0)) {
                    tgtInst.note = srcInst.note;
                }
                if (srcInst.goalOverride !== undefined) {
                    tgtInst.goalOverride = srcInst.goalOverride;
                }
            }
        }

        targetHabit.instances = targetInstances;
        if (sourceHabit.dailySchedule) {
            targetHabit.dailySchedule = sourceHabit.dailySchedule;
        }
    }
}

export async function mergeStates(local: AppState, incoming: AppState, options?: MergeOptions): Promise<AppState> {
    [local, incoming].forEach(hydrateLogs);
    [local, incoming].forEach(sanitizeDailyData);

    const localTs = local.lastModified || 0;
    const incomingTs = incoming.lastModified || 0;

    let winner: AppState;
    let loser: AppState;

    if (local.habits.length === 0 && incoming.habits.length > 0) {
        winner = incoming;
        loser = local;
    } else if (incoming.habits.length === 0 && local.habits.length > 0) {
        winner = local;
        loser = incoming;
    } else {
        winner = localTs >= incomingTs ? local : incoming;
        loser = localTs >= incomingTs ? incoming : local;
    }

    const merged: AppState = structuredClone(winner);
    const mergedHabitsMap = new Map<string, Habit>();

    // MAPA DE IDENTIDADE PARA DEDUPLICAÇÃO
    const winnerIdentityMap = new Map<string, string>();
    const idRemap = new Map<string, string>();
    const blockedIdentities = new Set<string>();
    const confirmedIdentities = new Set<string>();

    // Contexto de dados históricos para validação de dedup
    const mergedDailyData = structuredClone(winner.dailyData || {});
    for (const date in loser.dailyData || {}) {
        if (!mergedDailyData[date]) {
            mergedDailyData[date] = {};
        }
        Object.assign(mergedDailyData[date], loser.dailyData[date]);
    }

    // Popula mapa inicial com hábitos do vencedor
    merged.habits.forEach(h => {
        mergedHabitsMap.set(h.id, h);
        const identity = getHabitIdentity(h);
        if (identity) {
            winnerIdentityMap.set(identity, h.id);
        }
    });

    for (const loserHabit of loser.habits) {
        let winnerHabit = mergedHabitsMap.get(loserHabit.id);

        // --- SMART DEDUPLICATION ---
        if (!winnerHabit) {
            const identity = getHabitIdentity(loserHabit);
            if (identity) {
                if (blockedIdentities.has(identity)) {
                    winnerHabit = undefined;
                } else {
                    const matchedId = winnerIdentityMap.get(identity) || findFuzzyIdentityMatchId(identity, winnerIdentityMap);
                    if (matchedId) {
                        winnerHabit = mergedHabitsMap.get(matchedId);
                        if (winnerHabit) {
                            if (!confirmedIdentities.has(identity)) {
                                const strategy = evaluateIdentityDedupStrategy(identity, winnerHabit, loserHabit, mergedDailyData);
                                if (strategy === 'auto_keep_separate') {
                                    blockedIdentities.add(identity);
                                    winnerHabit = undefined;
                                    logger.warn(`[Merge] Dedup candidate "${identity}" auto-blocked as ambiguous.`);
                                } else if (strategy === 'ask_confirmation') {
                                    if (options?.onDedupCandidate) {
                                        try {
                                            const decision = await options.onDedupCandidate({ identity, winnerHabit, loserHabit });
                                            if (decision === 'keep_separate') {
                                                blockedIdentities.add(identity);
                                                winnerHabit = undefined;
                                            } else {
                                                confirmedIdentities.add(identity);
                                            }
                                        } catch (e) {
                                            blockedIdentities.add(identity);
                                            winnerHabit = undefined;
                                            logger.warn('[Merge] Dedup confirmation callback failed; keeping habits separate.', e);
                                        }
                                    } else {
                                        blockedIdentities.add(identity);
                                        winnerHabit = undefined;
                                        logger.warn(`[Merge] Dedup candidate "${identity}" requires confirmation; keeping habits separate.`);
                                    }
                                } else {
                                    confirmedIdentities.add(identity);
                                }
                            }

                            if (winnerHabit) {
                                idRemap.set(loserHabit.id, winnerHabit.id);
                                logger.info(`[Merge] Deduplicated habit "${identity}" (${loserHabit.id} -> ${winnerHabit.id})`);
                            }
                        }
                    }
                }
            }
        }

        if (!winnerHabit) {
            mergedHabitsMap.set(loserHabit.id, structuredClone(loserHabit));
        } else {
            winnerHabit.scheduleHistory = mergeHabitHistories(winnerHabit.scheduleHistory, loserHabit.scheduleHistory);

            const isDeduplicatedByIdentity = winnerHabit.id !== loserHabit.id;

            if (isDeduplicatedByIdentity && winnerHabit.deletedOn && !loserHabit.deletedOn) {
                winnerHabit.deletedOn = undefined;
                winnerHabit.deletedName = undefined;
            }

            if (schedulesEquivalent(getLatestSchedule(winnerHabit), getLatestSchedule(loserHabit))) {
                const winnerCreated = winnerHabit.createdOn || '9999-12-31';
                const loserCreated = loserHabit.createdOn || '9999-12-31';
                if (loserCreated < winnerCreated) {
                    const tempHistory = winnerHabit.scheduleHistory;
                    winnerHabit.scheduleHistory = mergeHabitHistories(loserHabit.scheduleHistory, tempHistory);
                }
            }

            if (loserHabit.deletedOn) {
                if (!isDeduplicatedByIdentity || winnerHabit.deletedOn) {
                    if (!winnerHabit.deletedOn || loserHabit.deletedOn > winnerHabit.deletedOn) {
                        winnerHabit.deletedOn = loserHabit.deletedOn;
                    }
                }
            }

            if (winnerHabit.deletedOn) {
                if (!winnerHabit.deletedName && loserHabit.deletedName) {
                    winnerHabit.deletedName = loserHabit.deletedName;
                }
            } else if (winnerHabit.deletedName) {
                winnerHabit.deletedName = undefined;
            }

            if (loserHabit.graduatedOn) {
                if (!winnerHabit.graduatedOn || loserHabit.graduatedOn < winnerHabit.graduatedOn) {
                    winnerHabit.graduatedOn = loserHabit.graduatedOn;
                }
            }
        }
    }

    (merged as any).habits = Array.from(mergedHabitsMap.values());

    // Sanitize merged mode/times to ensure consistency
    for (const habit of merged.habits) {
        for (let i = 0; i < habit.scheduleHistory.length; i++) {
            const schedule = habit.scheduleHistory[i];
            const normalizedMode = normalizeHabitMode(schedule.mode);
            const normalizedTimes = normalizeTimesByMode(normalizedMode, schedule.times);
            const normalizedFrequency = normalizeFrequencyByMode(normalizedMode, schedule.frequency as any);
            const hadModeChange = schedule.mode !== normalizedMode;
            const hadTimesChange =
                normalizedTimes.length !== schedule.times.length
                || normalizedTimes.some((time, idx) => time !== schedule.times[idx]);
            const hadFrequencyChange = JSON.stringify(normalizedFrequency) !== JSON.stringify(schedule.frequency);

            if (hadModeChange) {
                (habit.scheduleHistory[i] as any).mode = normalizedMode;
            }

            if (hadTimesChange) {
                logger.warn(`[Merge] Habit "${schedule.name}": normalized times for mode=${normalizedMode}`);
                (habit.scheduleHistory[i] as any).times = normalizedTimes;
            }

            if (hadFrequencyChange) {
                logger.warn(`[Merge] Habit "${schedule.name}": normalized frequency for mode=${normalizedMode}`);
                (habit.scheduleHistory[i] as any).frequency = normalizedFrequency;
            }
        }
    }

    // MERGE DAILY DATA COM REMAP
    for (const date of Object.keys(loser.dailyData ?? {})) {
        if (isUnsafeObjectKey(date)) continue;

        const remappedDailyData: Record<string, HabitDailyInfo> = Object.create(null);
        const sourceDayData = loser.dailyData[date];
        if (!sourceDayData) continue;

        for (const habitId of Object.keys(sourceDayData)) {
            if (isUnsafeObjectKey(habitId)) continue;
            const targetId = idRemap.get(habitId) || habitId;
            if (isUnsafeObjectKey(targetId)) continue;
            remappedDailyData[targetId] = sourceDayData[habitId];
        }

        if (!merged.dailyData[date]) {
            (merged.dailyData as any)[date] = structuredClone(remappedDailyData);
        } else {
            mergeDayRecord(remappedDailyData, (merged.dailyData as any)[date]);
        }
    }

    // MERGE BITMASKS (LOGS) COM REMAP
    const remappedLoserLogs = new Map<string, bigint>();
    if (loser.monthlyLogs) {
        for (const [key, value] of loser.monthlyLogs.entries()) {
            const parts = key.split('_');
            const suffix = parts.pop(); // YYYY-MM
            const habitId = parts.join('_');

            const targetId = idRemap.get(habitId) || habitId;
            const newKey = `${targetId}_${suffix}`;

            const existingVal = remappedLoserLogs.get(newKey);
            if (existingVal !== undefined) {
                remappedLoserLogs.set(newKey, existingVal | value);
            } else {
                remappedLoserLogs.set(newKey, value);
            }
        }
    }

    merged.monthlyLogs = HabitService.mergeLogs(winner.monthlyLogs, remappedLoserLogs);

    merged.lastModified = Math.max(localTs, incomingTs, Date.now()) + 1;

    return merged;
}
