/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/hydration.ts
 * @description Hidratação de dados: rehidrata Maps, sanitiza dailyData.
 */

import type { AppState, HabitDailyInfo } from '../../state';
import { HabitService } from '../HabitService';
import { isUnsafeObjectKey } from './validation';

export function hydrateLogs(appState: AppState) {
    if (appState.monthlyLogs && !(appState.monthlyLogs instanceof Map)) {
        (appState as any).monthlyLogs = HabitService.deserializeLogs(appState.monthlyLogs);
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
