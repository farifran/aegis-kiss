/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/ui.ts
 * @description Coordenação de UI: reordenação, transição de dia, celebrações.
 */

import {
    state, STREAK_SEMI_CONSOLIDATED, STREAK_CONSOLIDATED,
    clearActiveHabitsCache, pruneHabitAppearanceCache, pruneStreaksCache
} from '../../state';
import { getTodayUTCIso } from '../../utils';
import { saveState } from '../persistence';
import { getHabitDisplayInfo } from '../selectors';
import { t, formatList } from '../../i18n';
import { emitRenderApp } from '../../events';
import { _notifyChanges } from './shared';

export function reorderHabit(movedHabitId: string, targetHabitId: string, pos: 'before' | 'after', skip = false) {
    const h = state.habits, mIdx = h.findIndex(x => x.id === movedHabitId), tIdx = h.findIndex(x => x.id === targetHabitId);
    if (mIdx === -1 || tIdx === -1) return;
    const [item] = h.splice(mIdx, 1);
    h.splice(pos === 'before' ? (mIdx < tIdx ? tIdx - 1 : tIdx) : (mIdx < tIdx ? tIdx : tIdx + 1), 0, item);
    if (!skip) _notifyChanges(false);
}

export function handleDayTransition() {
    const today = getTodayUTCIso();
    clearActiveHabitsCache();

    pruneHabitAppearanceCache();
    pruneStreaksCache();

    state.uiDirtyState.calendarVisuals = state.uiDirtyState.habitListStructure = state.uiDirtyState.chartData = true;
    state.calendarDates = [];
    if (state.selectedDate !== today) state.selectedDate = today;
    emitRenderApp();
}

function _processAndFormatCelebrations(pendingIds: string[], translationKey: 'aiCelebration21Day' | 'aiCelebration66Day', streakMilestone: number): string {
    if (pendingIds.length === 0) return '';
    const habitNamesList = pendingIds.map(id => state.habits.find(h => h.id === id)).filter(Boolean).map(h => getHabitDisplayInfo(h!).name);
    const habitNames = formatList(habitNamesList);
    pendingIds.forEach(id => {
        const celebrationId = `${id}-${streakMilestone}`;
        if (!state.notificationsShown.includes(celebrationId)) state.notificationsShown.push(celebrationId);
    });
    return t(translationKey, { count: pendingIds.length, habitNames });
}

export function consumeAndFormatCelebrations(): string {
    const celebration21DayText = _processAndFormatCelebrations(state.pending21DayHabitIds, 'aiCelebration21Day', STREAK_SEMI_CONSOLIDATED);
    const celebration66DayText = _processAndFormatCelebrations(state.pendingConsolidationHabitIds, 'aiCelebration66Day', STREAK_CONSOLIDATED);
    const allCelebrations = [celebration66DayText, celebration21DayText].filter(Boolean).join('\n\n');
    if (allCelebrations) { state.pending21DayHabitIds = []; state.pendingConsolidationHabitIds = []; saveState(); }
    return allCelebrations;
}
