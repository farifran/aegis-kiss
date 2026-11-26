/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/scheduleManagement.ts
 * @description Mudanças de agendamento: drag & drop de horário, encerramento, remoção de período.
 */

import { state, TimeOfDay, HABIT_STATE, ensureHabitDailyInfo } from '../../state';
import { getEffectiveScheduleForHabitOnDate, getHabitDisplayInfo, getHabitPropertiesForDate } from '../selectors';
import { getSafeDate, parseUTCIsoDate, toUTCIsoDateString } from '../../utils';
import { showConfirmationModal } from '../../render';
import { HabitService } from '../HabitService';
import { t, getTimeOfDayName, formatDate } from '../../i18n';
import { emitRenderApp } from '../../events';
import { normalizeHabitMode } from './normalization';
import { reorderHabit } from './ui';
import {
    ActionContext, _lockActionHabit, _notifyChanges, _requestFutureScheduleChange,
    type HabitReorderInfo
} from './shared';

const _applyDropJustToday = () => {
    const ctx = ActionContext.drop, target = getSafeDate(state.selectedDate);
    if (!ctx) return ActionContext.reset();
    const habit = state.habits.find(h => h.id === ctx.habitId);
    if (habit) {
        const info = ensureHabitDailyInfo(target, ctx.habitId);
        const scheduleProps = getHabitPropertiesForDate(habit, target);
        const mode = normalizeHabitMode(scheduleProps?.mode);
        const sch = [...getEffectiveScheduleForHabitOnDate(habit, target)];
        const fIdx = sch.indexOf(ctx.fromTime);
        if (fIdx > -1) sch.splice(fIdx, 1);
        if (mode === 'attitudinal') {
            sch.splice(0, sch.length, ctx.toTime);
        } else if (!sch.includes(ctx.toTime)) {
            sch.push(ctx.toTime);
        }
        const currentBit = HabitService.getStatus(ctx.habitId, target, ctx.fromTime);
        if (currentBit !== HABIT_STATE.NULL) { HabitService.setStatus(ctx.habitId, target, ctx.toTime, currentBit); HabitService.setStatus(ctx.habitId, target, ctx.fromTime, HABIT_STATE.NULL); }
        if (info.instances[ctx.fromTime as TimeOfDay]) { info.instances[ctx.toTime as TimeOfDay] = info.instances[ctx.fromTime as TimeOfDay]; delete info.instances[ctx.fromTime as TimeOfDay]; }
        info.dailySchedule = sch;
        if (ctx.reorderInfo) reorderHabit(ctx.habitId, ctx.reorderInfo.id, ctx.reorderInfo.pos, true);
        _notifyChanges(false);
    }
    ActionContext.reset();
};

const _applyDropFromNowOn = () => {
    const ctx = ActionContext.drop, target = getSafeDate(state.selectedDate);
    if (!ctx) return ActionContext.reset();
    const info = ensureHabitDailyInfo(target, ctx.habitId);
    info.dailySchedule = undefined;
    const currentBit = HabitService.getStatus(ctx.habitId, target, ctx.fromTime);
    if (currentBit !== HABIT_STATE.NULL) { HabitService.setStatus(ctx.habitId, target, ctx.toTime, currentBit); HabitService.setStatus(ctx.habitId, target, ctx.fromTime, HABIT_STATE.NULL); }
    if (info.instances[ctx.fromTime as TimeOfDay]) { info.instances[ctx.toTime as TimeOfDay] = info.instances[ctx.fromTime as TimeOfDay]; delete info.instances[ctx.fromTime as TimeOfDay]; }
    if (ctx.reorderInfo) reorderHabit(ctx.habitId, ctx.reorderInfo.id, ctx.reorderInfo.pos, true);
    _requestFutureScheduleChange(ctx.habitId, target, (s) => {
        const mode = normalizeHabitMode(s.mode);
        const times = mode === 'attitudinal'
            ? [ctx.toTime]
            : (() => {
                const nextTimes = [...s.times];
                const fIdx = nextTimes.indexOf(ctx.fromTime);
                if (fIdx > -1) nextTimes.splice(fIdx, 1);
                if (!nextTimes.includes(ctx.toTime)) nextTimes.push(ctx.toTime);
                return nextTimes;
            })();
        return { ...s, times: times as readonly TimeOfDay[] };
    });
    ActionContext.reset();
};

export function handleHabitDrop(habitId: string, fromTime: TimeOfDay, toTime: TimeOfDay, reorderInfo?: HabitReorderInfo) {
    // BOOT LOCK
    if (!state.initialSyncDone) return;

    const h = _lockActionHabit(habitId); if (!h) return;
    ActionContext.drop = { habitId, fromTime, toTime, reorderInfo };

    const onCancel = () => {
        ActionContext.reset();
        state.uiDirtyState.habitListStructure = true;
        emitRenderApp();
    };

    showConfirmationModal(
        t('confirmHabitMove', { habitName: getHabitDisplayInfo(h, state.selectedDate).name, oldTime: getTimeOfDayName(fromTime), newTime: getTimeOfDayName(toTime) }),
        _applyDropFromNowOn,
        {
            title: t('modalMoveHabitTitle'),
            confirmText: t('buttonFromNowOn'),
            editText: t('buttonJustToday'),
            onEdit: _applyDropJustToday,
            onCancel
        }
    );
}

export function requestHabitEndingFromModal(habitId: string, targetDateOverride?: string) {
    if (!state.initialSyncDone) return;
    const h = _lockActionHabit(habitId), target = getSafeDate(targetDateOverride || state.selectedDate); if (!h) return;
    ActionContext.ending = { habitId, targetDate: target };
    showConfirmationModal(t('confirmEndHabit', { habitName: getHabitDisplayInfo(h, target).name, date: formatDate(parseUTCIsoDate(target), { day: 'numeric', month: 'long', timeZone: 'UTC' }) }),
        () => { _requestFutureScheduleChange(habitId, target, s => ({ ...s, endDate: target }), true); ActionContext.reset(); }, { confirmButtonStyle: 'danger', confirmText: t('endButton'), onCancel: () => ActionContext.reset() });
}

export function requestHabitTimeRemoval(habitId: string, time: TimeOfDay, targetDateOverride?: string) {
    if (!state.initialSyncDone) return;
    const h = _lockActionHabit(habitId), target = getSafeDate(targetDateOverride || state.selectedDate); if (!h) return;
    ActionContext.removal = { habitId, time, targetDate: target };
    showConfirmationModal(t('confirmRemoveTimePermanent', { habitName: getHabitDisplayInfo(h, target).name, time: getTimeOfDayName(time) }), () => { ensureHabitDailyInfo(target, habitId).dailySchedule = undefined; _requestFutureScheduleChange(habitId, target, s => ({ ...s, times: s.times.filter(x => x !== time) as readonly TimeOfDay[] }), true); ActionContext.reset(); }, { title: t('modalRemoveTimeTitle'), confirmText: t('deleteButton'), confirmButtonStyle: 'danger', onCancel: () => ActionContext.reset() });
}
