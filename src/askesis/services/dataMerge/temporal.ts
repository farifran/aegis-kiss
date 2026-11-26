/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/temporal.ts
 * @description Operações temporais: parsing de datas, range, gap, overlap.
 */

import type { HabitDailyInfo, Habit } from '../../state';

export function parseUtcDate(date: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function getDateRange(dates: Set<string>): { min: Date; max: Date } | null {
    let min: Date | null = null;
    let max: Date | null = null;

    for (const value of dates) {
        const parsed = parseUtcDate(value);
        if (!parsed) continue;
        if (!min || parsed < min) min = parsed;
        if (!max || parsed > max) max = parsed;
    }

    if (!min || !max) return null;
    return { min, max };
}

export function dayGapBetweenRanges(
    rangeA: { min: Date; max: Date },
    rangeB: { min: Date; max: Date }
): number {
    const msPerDay = 24 * 60 * 60 * 1000;

    if (rangeA.max < rangeB.min) {
        return Math.floor((rangeB.min.getTime() - rangeA.max.getTime()) / msPerDay);
    }

    if (rangeB.max < rangeA.min) {
        return Math.floor((rangeA.min.getTime() - rangeB.max.getTime()) / msPerDay);
    }

    return 0;
}

/**
 * Extrai datas onde o hábito tem registros em dailyData.
 */
export function getHabitDataDates(habitId: string, dailyData: Record<string, Record<string, HabitDailyInfo>>): Set<string> {
    const dates = new Set<string>();
    for (const date in dailyData) {
        if (dailyData[date]?.[habitId]) {
            dates.add(date);
        }
    }
    return dates;
}

/**
 * Verifica se dois conjuntos de datas têm interseção (uso simultâneo).
 */
export function hasDateOverlap(dates1: Set<string>, dates2: Set<string>): boolean {
    for (const date of dates1) {
        if (dates2.has(date)) return true;
    }
    return false;
}

/**
 * Verifica se períodos de agenda dos hábitos se sobrepõem temporalmente.
 */
export function hasScheduleOverlap(habit1: Habit, habit2: Habit): boolean {
    if (!habit1.deletedOn && !habit2.deletedOn) return true;

    if (habit1.deletedOn && habit2.deletedOn) {
        const h1Start = habit1.createdOn || '0000-01-01';
        const h1End = habit1.deletedOn;
        const h2Start = habit2.createdOn || '0000-01-01';
        const h2End = habit2.deletedOn;
        return h1Start <= h2End && h2Start <= h1End;
    }

    const deleted = habit1.deletedOn ? habit1 : habit2;
    const active = habit1.deletedOn ? habit2 : habit1;

    if (!deleted.deletedOn || !active.createdOn) return true;

    if (deleted.deletedOn < active.createdOn) return false;

    return true;
}
