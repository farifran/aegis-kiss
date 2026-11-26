/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/hydration.ts
 * @description Hidratação de dados: rehidrata Maps, sanitiza dailyData.
 */

import type { AppState, HabitDailyInfo } from '../../state';
import { logger } from '../../utils';
import { safeBigIntFromUnknown, isUnsafeObjectKey } from './validation';

export function hydrateLogs(appState: AppState) {
    if (appState.monthlyLogs && !(appState.monthlyLogs instanceof Map)) {
        const entries = Array.isArray(appState.monthlyLogs)
            ? appState.monthlyLogs
            : Object.entries(appState.monthlyLogs);

        const map = new Map<string, bigint>();
        entries.forEach((item: any) => {
            const [key, val] = item as [string, any];
            try {
                const hydrated = safeBigIntFromUnknown(val);
                if (hydrated !== null) map.set(key, hydrated);
                else logger.warn(`[Merge] Invalid bigint value for ${key}`);
            } catch(e) {
                logger.warn(`[Merge] Failed to hydrate bitmask for ${key}`, e);
            }
        });
        (appState as any).monthlyLogs = map;
    }
}

export function sanitizeDailyData(appState: AppState): void {
    const sourceDailyData = appState.dailyData ?? {};
    const sanitizedDailyData: Record<string, Record<string, HabitDailyInfo>> = {};

    for (const date of Object.keys(sourceDailyData)) {
        if (isUnsafeObjectKey(date)) continue;

        const dayRecord = sourceDailyData[date];
        if (!dayRecord || typeof dayRecord !== 'object') continue;

        const sanitizedDayRecord: Record<string, HabitDailyInfo> = {};
        for (const habitId of Object.keys(dayRecord)) {
            if (isUnsafeObjectKey(habitId)) continue;
            sanitizedDayRecord[habitId] = dayRecord[habitId];
        }

        sanitizedDailyData[date] = sanitizedDayRecord;
    }

    (appState as any).dailyData = sanitizedDailyData;
}
