/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/statusTracking.ts
 * @description Rastreamento de status de hábitos: toggle, batch, goal override, milestones.
 */

import {
    state, TimeOfDay, HABIT_STATE, Habit,
    ensureHabitDailyInfo, ensureHabitInstanceData,
    invalidateCachesForDateChange, STREAK_SEMI_CONSOLIDATED, STREAK_CONSOLIDATED,
    HabitDayData
} from '../../state';
import {
    getEffectiveScheduleForHabitOnDate, shouldHabitAppearOnDate,
    calculateHabitStreak, getHabitPropertiesForDate
} from '../selectors';
import { parseUTCIsoDate, triggerHaptic, logger, sanitizeText } from '../../utils';
import { renderAINotificationState, updateDayVisuals } from '../../render';
import { ui } from '../../render/ui';
import { closeModal } from '../../render';
import { saveState } from '../persistence';
import { HabitService } from '../HabitService';
import { emitCardGoalChanged, emitCardStatusChanged, emitRenderApp } from '../../events';
import {
    _notifyChanges, _notifyPartialUIRefresh,
    BATCH_IDS_POOL, BATCH_HABITS_POOL, isBatchOpActive, setBatchOpActive
} from './shared';

function _checkStreakMilestones(habit: Habit, dateISO: string) {
    const streak = calculateHabitStreak(habit, dateISO);
    const m = streak === STREAK_SEMI_CONSOLIDATED ? state.pending21DayHabitIds : (streak === STREAK_CONSOLIDATED ? state.pendingConsolidationHabitIds : null);
    if (m && !state.notificationsShown.includes(`${habit.id}-${streak}`) && !m.includes(habit.id)) {
        m.push(habit.id);
        renderAINotificationState();
    }
}

export function toggleHabitStatus(habitId: string, time: TimeOfDay, dateISO: string) {
    // BOOT LOCK: Previne escrita até que o sync inicial (se houver) termine
    if (!state.initialSyncDone) return;
    if (!state.habits.some(h => h.id === habitId)) return;

    const currentStatus = HabitService.getStatus(habitId, dateISO, time);
    let nextStatus: number = HABIT_STATE.DONE;
    if (currentStatus === HABIT_STATE.DONE || currentStatus === HABIT_STATE.DONE_PLUS) nextStatus = HABIT_STATE.DEFERRED;
    else if (currentStatus === HABIT_STATE.DEFERRED) nextStatus = HABIT_STATE.NULL;
    HabitService.setStatus(habitId, dateISO, time, nextStatus);
    const h = state.habits.find(x => x.id === habitId);
    if (nextStatus === HABIT_STATE.DONE) { if (h) _checkStreakMilestones(h, dateISO); triggerHaptic('light'); }
    else if (nextStatus === HABIT_STATE.DEFERRED) triggerHaptic('medium');
    else triggerHaptic('selection');
    emitCardStatusChanged({ habitId, time, date: dateISO });
    _notifyPartialUIRefresh(dateISO);
}

export function markAllHabitsForDate(dateISO: string, status: 'completed' | 'snoozed'): boolean {
    if (isBatchOpActive()) return false;
    // BOOT LOCK
    if (!state.initialSyncDone) return false;

    setBatchOpActive(true);
    const dateObj = parseUTCIsoDate(dateISO);
    let changed = false; BATCH_IDS_POOL.length = BATCH_HABITS_POOL.length = 0;
    try {
        state.habits.forEach(h => {
            if (!shouldHabitAppearOnDate(h, dateISO, dateObj)) return;
            const sch = getEffectiveScheduleForHabitOnDate(h, dateISO);
            if (!sch.length) return;
            let bitStatus: number = (status === 'completed') ? HABIT_STATE.DONE : HABIT_STATE.DEFERRED;
            let habitChanged = false;
            sch.forEach(t => { if (HabitService.getStatus(h.id, dateISO, t) !== bitStatus) { HabitService.setStatus(h.id, dateISO, t, bitStatus); habitChanged = true; } });
            if (habitChanged) { changed = true; BATCH_IDS_POOL.push(h.id); BATCH_HABITS_POOL.push(h); }
        });
        if (changed) {
            invalidateCachesForDateChange(dateISO);
            if (status === 'completed') BATCH_HABITS_POOL.forEach(h => _checkStreakMilestones(h, dateISO));
            requestAnimationFrame(() => updateDayVisuals(dateISO));
            _notifyChanges(false);
        }
    } finally { setBatchOpActive(false); }
    return changed;
}

export function setGoalOverride(habitId: string, d: string, t: TimeOfDay, v: number) {
    // BOOT LOCK
    if (!state.initialSyncDone) return;

    try {
        const h = state.habits.find(x => x.id === habitId); if (!h) return;
        ensureHabitInstanceData(d, habitId, t).goalOverride = v;
        const currentStatus = HabitService.getStatus(habitId, d, t);
        if (currentStatus === HABIT_STATE.DONE || currentStatus === HABIT_STATE.DONE_PLUS) {
            const props = getHabitPropertiesForDate(h, d);
            if (props?.goal?.total && v > props.goal.total) { if (currentStatus !== HABIT_STATE.DONE_PLUS) HabitService.setStatus(habitId, d, t, HABIT_STATE.DONE_PLUS); }
            else { if (currentStatus !== HABIT_STATE.DONE) HabitService.setStatus(habitId, d, t, HABIT_STATE.DONE); }
        }
        saveState(); emitCardGoalChanged({ habitId, time: t, date: d }); _notifyPartialUIRefresh(d);
    } catch (e) { logger.error('setGoalOverride failed', e); }
}

export function handleSaveNote() {
    if (!state.editingNoteFor) return;
    const { habitId, date, time } = state.editingNoteFor;
    const val = sanitizeText(ui.notesTextarea.value);
    const inst = ensureHabitInstanceData(date, habitId, time);
    if ((inst.note || '') !== val) {
        inst.note = val || undefined;
        state.uiDirtyState.habitListStructure = true;
        saveState();
        emitRenderApp();
    }
    closeModal(ui.notesModal);
}
