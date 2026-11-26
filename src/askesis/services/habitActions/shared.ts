/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/shared.ts
 * @description Estado interno e utilidades compartilhadas entre sub-módulos de habitActions.
 */

import {
    state, HabitSchedule, Habit, TimeOfDay,
    clearScheduleCache, clearActiveHabitsCache, invalidateCachesForDateChange,
    HabitDailyInfo
} from '../../state';
import { saveState } from '../persistence';
import { clearSelectorInternalCaches } from '../selectors';
import { clearHabitDomCache, updateDayVisuals } from '../../render';
import { emitRenderApp, emitHabitsChanged } from '../../events';

// ══════════ Module-level state ══════════

export const BATCH_IDS_POOL: string[] = [];
export const BATCH_HABITS_POOL: Habit[] = [];

let _isBatchOpActive = false;
export function isBatchOpActive() { return _isBatchOpActive; }
export function setBatchOpActive(v: boolean) { _isBatchOpActive = v; }

// ══════════ Action Context State Machine ══════════

export type HabitReorderInfo = { id: string; pos: 'before' | 'after' };
export type ActionDropContext = { habitId: string; fromTime: TimeOfDay; toTime: TimeOfDay; reorderInfo?: HabitReorderInfo };
export type ActionRemovalContext = { habitId: string; time: TimeOfDay; targetDate: string };
export type ActionEndingContext = { habitId: string; targetDate: string };
export type ActionDeletionContext = { habitId: string };

type ActionContextState = {
    isLocked: boolean;
    drop: ActionDropContext | null;
    removal: ActionRemovalContext | null;
    ending: ActionEndingContext | null;
    deletion: ActionDeletionContext | null;
    reset: () => void;
};

export const ActionContext: ActionContextState = {
    isLocked: false,
    drop: null,
    removal: null,
    ending: null,
    deletion: null,
    reset() {
        this.isLocked = false;
        this.drop = this.removal = this.ending = this.deletion = null;
    }
};

// ══════════ Shared Helpers ══════════

/**
 * BOOT LOCK PROTECTION: Durante o boot, usamos timestamp incremental simples.
 * Após o sync, usamos o relógio real para garantir LWW.
 */
export function _bumpLastModified() {
    if (!state.initialSyncDone) {
        state.lastModified = state.lastModified + 1;
    } else {
        state.lastModified = Math.max(Date.now(), (state.lastModified || 0) + 1);
    }
}

export function _notifyChanges(fullRebuild = false, immediate = false) {
    if (fullRebuild) {
        clearScheduleCache();
        clearHabitDomCache();
        clearSelectorInternalCaches();
        // FIX [2025-06-13]: Limpa cache de sumário diário (anéis) em mudanças estruturais.
        state.daySummaryCache.clear();
        state.uiDirtyState.chartData = true;
    }
    clearActiveHabitsCache();
    state.uiDirtyState.habitListStructure = state.uiDirtyState.calendarVisuals = true;

    _bumpLastModified();

    document.body.classList.remove('is-interaction-active', 'is-dragging-active');
    saveState(immediate);
    requestAnimationFrame(() => {
        emitRenderApp();
        emitHabitsChanged();
    });
}

export function _notifyPartialUIRefresh(date: string) {
    invalidateCachesForDateChange(date);

    _bumpLastModified();
    saveState();

    requestAnimationFrame(() => {
        updateDayVisuals(date);
        emitRenderApp();
        emitHabitsChanged();
    });
}

export function _lockActionHabit(habitId: string): Habit | null {
    if (ActionContext.isLocked) return null;
    ActionContext.isLocked = true;
    const h = state.habits.find(x => x.id === habitId);
    if (!h) ActionContext.reset();
    return h ?? null;
}

export function _requestFutureScheduleChange(habitId: string, targetDate: string, updateFn: (s: HabitSchedule) => HabitSchedule, immediate = false) {
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return;

    state.habitAppearanceCache.delete(habitId);
    state.streaksCache.delete(habitId);

    const history = habit.scheduleHistory;
    if (history.length === 0) return;

    const earliest = history.reduce((min, s) => (s.startDate < min.startDate ? s : min), history[0]);
    if (targetDate < earliest.startDate) {
        const newEntry = updateFn({
            ...earliest,
            startDate: targetDate,
            endDate: earliest.startDate,
            scheduleAnchor: targetDate
        });
        history.push(newEntry);
        history.sort((a, b) => a.startDate.localeCompare(b.startDate));
        habit.graduatedOn = undefined;
        _notifyChanges(true, immediate);
        return;
    }
    const idx = history.findIndex(s => targetDate >= s.startDate && (!s.endDate || targetDate < s.endDate));

    if (idx !== -1) {
        const cur = history[idx];
        if (cur.startDate === targetDate) history[idx] = updateFn({ ...cur });
        else { cur.endDate = targetDate; history.push(updateFn({ ...cur, startDate: targetDate, endDate: undefined })); }
    } else {
        const last = history[history.length - 1];
        if (last) { if (last.endDate && last.endDate > targetDate) last.endDate = targetDate; history.push(updateFn({ ...last, startDate: targetDate, endDate: undefined })); }
    }
    history.sort((a, b) => a.startDate.localeCompare(b.startDate));
    habit.graduatedOn = undefined;
    _notifyChanges(true, immediate);
}
