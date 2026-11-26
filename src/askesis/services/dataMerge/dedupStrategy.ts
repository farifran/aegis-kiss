/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/dedupStrategy.ts
 * @description Motor de decisão de deduplicação: avalia estratégias e busca fuzzy.
 */

import type { Habit, HabitDailyInfo } from '../../state';
import type { IdentityDedupStrategy } from './types';
import { areNamesFuzzySimilar } from './textMatching';
import { getHabitDataDates, hasDateOverlap, getDateRange, dayGapBetweenRanges, hasScheduleOverlap } from './temporal';
import { getHabitIdentity, getLatestSchedule, schedulesEquivalent } from './identity';

const GENERIC_HABIT_IDENTITIES = new Set([
    'habit',
    'habito',
    'novo habito',
    'new habit',
    'nuevo habito',
    'teste',
    'test'
]);

export { GENERIC_HABIT_IDENTITIES };

export function evaluateIdentityDedupStrategy(
    identity: string,
    winnerHabit: Habit,
    loserHabit: Habit,
    dailyDataContext?: Record<string, Record<string, HabitDailyInfo>>
): IdentityDedupStrategy {
    if (identity.length < 5 || GENERIC_HABIT_IDENTITIES.has(identity)) {
        return 'auto_keep_separate';
    }

    if (dailyDataContext) {
        const winnerDates = getHabitDataDates(winnerHabit.id, dailyDataContext);
        const loserDates = getHabitDataDates(loserHabit.id, dailyDataContext);

        if (winnerDates.size > 0 && loserDates.size > 0 && !hasDateOverlap(winnerDates, loserDates)) {
            const winnerRange = getDateRange(winnerDates);
            const loserRange = getDateRange(loserDates);

            if (winnerRange && loserRange) {
                const gapDays = dayGapBetweenRanges(winnerRange, loserRange);
                if (gapDays >= 30) {
                    return 'auto_keep_separate';
                }
            }
        }
    }

    if (!hasScheduleOverlap(winnerHabit, loserHabit)) {
        return 'auto_keep_separate';
    }

    const wLast = getLatestSchedule(winnerHabit);
    const lLast = getLatestSchedule(loserHabit);
    const wName = wLast?.name || wLast?.nameKey || '';
    const lName = lLast?.name || lLast?.nameKey || '';

    if (schedulesEquivalent(wLast, lLast)) {
        return 'auto_deduplicate';
    }

    if (areNamesFuzzySimilar(wName, lName, 2)) {
        if (wLast?.mode === lLast?.mode && JSON.stringify(wLast?.frequency) === JSON.stringify(lLast?.frequency)) {
            return 'auto_deduplicate';
        }
    }

    const winnerActive = !winnerHabit.deletedOn;
    const loserActive = !loserHabit.deletedOn;
    if (winnerActive !== loserActive) {
        const activeHabit = winnerActive ? winnerHabit : loserHabit;
        const activeIdentity = getHabitIdentity(activeHabit);
        if (activeIdentity === identity && areNamesFuzzySimilar(wName, lName, 1)) {
            return 'auto_deduplicate';
        }
    }

    return 'ask_confirmation';
}

export function findFuzzyIdentityMatchId(
    loserIdentity: string,
    winnerIdentityMap: Map<string, string>
): string | undefined {
    if (loserIdentity.length < 5 || GENERIC_HABIT_IDENTITIES.has(loserIdentity)) {
        return undefined;
    }

    const fuzzyMatches: string[] = [];
    for (const [winnerIdentity, winnerId] of winnerIdentityMap.entries()) {
        if (winnerIdentity.length < 5 || GENERIC_HABIT_IDENTITIES.has(winnerIdentity)) {
            continue;
        }

        if (areNamesFuzzySimilar(loserIdentity, winnerIdentity, 1)) {
            fuzzyMatches.push(winnerId);
        }
    }

    return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined;
}
