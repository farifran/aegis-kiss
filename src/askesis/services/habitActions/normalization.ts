/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/normalization.ts
 * @description Funções puras de normalização de dados de hábitos.
 */

import type { HabitSchedule, TimeOfDay, HabitMode } from '../../state';
import type { HabitTemplate } from '../../state';

export function deduplicateTimeOfDay(times: readonly TimeOfDay[]): readonly TimeOfDay[] {
    if (!times || times.length === 0) return times;
    const seen = new Set<TimeOfDay>();
    const result: TimeOfDay[] = [];
    for (const time of times) {
        if (!seen.has(time)) {
            seen.add(time);
            result.push(time);
        }
    }
    return result;
}

export function normalizeHabitMode(mode: HabitTemplate['mode'] | HabitSchedule['mode'] | undefined): HabitMode {
    return mode === 'attitudinal' ? 'attitudinal' : 'scheduled';
}

export function normalizeTimesByMode(mode: HabitMode, times: readonly TimeOfDay[]): readonly TimeOfDay[] {
    const deduped = deduplicateTimeOfDay(times || []);
    if (mode !== 'attitudinal') return deduped;
    return deduped.length > 0 ? [deduped[0]] : [];
}

export function normalizeFrequencyByMode(mode: HabitMode, frequency: HabitTemplate['frequency']): HabitTemplate['frequency'] {
    if (mode === 'attitudinal') return { type: 'daily' };
    if (frequency.type === 'specific_days_of_week') {
        return { ...frequency, days: [...frequency.days] };
    }
    return { ...frequency };
}
