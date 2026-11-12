/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/identity.ts
 * @description Extração e comparação de identidade de hábitos para deduplicação.
 */

import type { Habit, HabitSchedule } from '../../state';
import { normalizeIdentityText } from './textMatching';

/**
 * Obtém uma identidade normalizada para o hábito (Nome ou Chave de Tradução).
 */
export function getHabitIdentity(h: Habit): string | null {
    if (!h.scheduleHistory || h.scheduleHistory.length === 0) {
        const deletedRaw = normalizeIdentityText(h.deletedName || '');
        return deletedRaw.length > 0 ? deletedRaw : null;
    }
    const lastSchedule = h.scheduleHistory.reduce((prev, curr) =>
        (curr.startDate > prev.startDate ? curr : prev), h.scheduleHistory[0]);

    const raw = lastSchedule.name || lastSchedule.nameKey || '';
    const normalized = normalizeIdentityText(raw);

    return normalized.length > 0 ? normalized : null;
}

export function getLatestSchedule(h: Habit): HabitSchedule | null {
    if (!h.scheduleHistory || h.scheduleHistory.length === 0) return null;
    return h.scheduleHistory.reduce((prev, curr) => (curr.startDate > prev.startDate ? curr : prev), h.scheduleHistory[0]);
}

export function schedulesEquivalent(a: HabitSchedule | null, b: HabitSchedule | null): boolean {
    if (!a || !b) return false;
    if (normalizeIdentityText(a.name || '') !== normalizeIdentityText(b.name || '')) return false;
    if (normalizeIdentityText(a.nameKey || '') !== normalizeIdentityText(b.nameKey || '')) return false;
    if ((a.mode || '') !== (b.mode || '')) return false;

    const aTimes = Array.from(new Set(a.times || [])).sort();
    const bTimes = Array.from(new Set(b.times || [])).sort();
    if (aTimes.length !== bTimes.length) return false;
    for (let i = 0; i < aTimes.length; i++) {
        if (aTimes[i] !== bTimes[i]) return false;
    }

    if (JSON.stringify(a.frequency) !== JSON.stringify(b.frequency)) return false;
    if (JSON.stringify(a.goal) !== JSON.stringify(b.goal)) return false;

    return true;
}
