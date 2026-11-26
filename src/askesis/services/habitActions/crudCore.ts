/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/crudCore.ts
 * @description Criação, atualização e ressurreição de hábitos via modal.
 */

import {
    state, Habit, HabitSchedule, TimeOfDay, HabitMode,
    ensureHabitDailyInfo, MAX_HABIT_NAME_LENGTH
} from '../../state';
import type { HabitTemplate } from '../../state';
import { generateUUID, sanitizeText } from '../../utils';
import { getEffectiveScheduleForHabitOnDate, getHabitDisplayInfo } from '../selectors';
import { closeModal } from '../../render';
import { ui } from '../../render/ui';
import { t } from '../../i18n';
import { normalizeHabitMode, normalizeTimesByMode, normalizeFrequencyByMode } from './normalization';
import { _notifyChanges, _requestFutureScheduleChange } from './shared';

type CleanFormData = Omit<HabitTemplate, 'times' | 'goal' | 'frequency'> & {
    mode: HabitMode;
    times: readonly TimeOfDay[];
    goal: HabitTemplate['goal'];
    frequency: HabitTemplate['frequency'];
};

function _normalizeFormDataForSave(formData: HabitTemplate): { clean: CleanFormData; nameToUse: string } | null {
    const normalizedName = formData.name ? sanitizeText(formData.name, MAX_HABIT_NAME_LENGTH) : formData.name;
    const nameToUse = formData.nameKey ? t(formData.nameKey) : (normalizedName || '');
    if (!nameToUse) return null;
    const mode = normalizeHabitMode(formData.mode);

    const clean: CleanFormData = {
        ...formData,
        mode,
        name: normalizedName,
        times: normalizeTimesByMode(mode, formData.times),
        goal: { ...formData.goal },
        frequency: normalizeFrequencyByMode(mode, formData.frequency)
    };

    return { clean, nameToUse };
}

function _findActiveHabitByName(nameToUse: string, targetDate: string): Habit | undefined {
    const normalizedTarget = nameToUse.trim().toLowerCase();
    return state.habits.find(h => {
        if (h.deletedOn || h.graduatedOn) return false;
        const info = getHabitDisplayInfo(h, targetDate);
        const lastName = h.scheduleHistory[h.scheduleHistory.length - 1]?.name || info.name;
        if ((lastName || '').trim().toLowerCase() !== normalizedTarget) return false;
        const lastSchedule = h.scheduleHistory[h.scheduleHistory.length - 1];
        return !!lastSchedule && (!lastSchedule.endDate || lastSchedule.endDate > targetDate);
    });
}

function _handleEmptyTimesSave(isNew: boolean, habitId: string | undefined, targetDate: string, nameToUse: string) {
    if (isNew) {
        const activeHabit = _findActiveHabitByName(nameToUse, targetDate);
        if (activeHabit) {
            _requestFutureScheduleChange(activeHabit.id, targetDate, s => ({ ...s, endDate: targetDate }), true);
        }
        return;
    }

    const h = state.habits.find(x => x.id === habitId);
    if (h) {
        _requestFutureScheduleChange(h.id, targetDate, s => ({ ...s, endDate: targetDate }), true);
    }
}

function _findResurrectionCandidates(nameToUse: string, targetDate: string): Habit[] {
    const normalizedTarget = nameToUse.trim().toLowerCase();
    return state.habits.filter(h => {
        const info = getHabitDisplayInfo(h, targetDate);
        const lastName = h.scheduleHistory[h.scheduleHistory.length - 1]?.name || h.deletedName || info.name;
        return (lastName || '').trim().toLowerCase() === normalizedTarget;
    });
}

function _pickExistingHabitCandidate(candidates: Habit[], targetDate: string): Habit | undefined {
    const active = candidates.find(h =>
        !h.deletedOn && !h.graduatedOn &&
        (!h.scheduleHistory[h.scheduleHistory.length - 1].endDate || h.scheduleHistory[h.scheduleHistory.length - 1].endDate! > targetDate)
    );
    if (active) return active;

    if (candidates.length === 0) return undefined;
    const sorted = [...candidates].sort((a, b) => {
        const aLast = a.scheduleHistory[a.scheduleHistory.length - 1];
        const bLast = b.scheduleHistory[b.scheduleHistory.length - 1];
        const aKey = aLast?.startDate || a.createdOn;
        const bKey = bLast?.startDate || b.createdOn;
        return bKey.localeCompare(aKey);
    });
    return sorted[0];
}

function _buildScheduleFromForm(targetDate: string, cleanFormData: CleanFormData): HabitSchedule {
    return {
        startDate: targetDate,
        mode: cleanFormData.mode,
        times: cleanFormData.times,
        frequency: cleanFormData.frequency,
        name: cleanFormData.name,
        nameKey: cleanFormData.nameKey,
        subtitleKey: cleanFormData.subtitleKey,
        scheduleAnchor: targetDate,
        icon: cleanFormData.icon,
        color: cleanFormData.color,
        goal: cleanFormData.goal,
        philosophy: cleanFormData.philosophy
    };
}

function _applyResurrection(existingHabit: Habit, targetDate: string, cleanFormData: CleanFormData) {
    const wasDeleted = !!existingHabit.deletedOn;
    if (existingHabit.deletedOn) existingHabit.deletedOn = undefined;
    if (existingHabit.graduatedOn) existingHabit.graduatedOn = undefined;
    if (existingHabit.deletedName) existingHabit.deletedName = undefined;
    if (targetDate < existingHabit.createdOn) existingHabit.createdOn = targetDate;

    if (wasDeleted) {
        existingHabit.scheduleHistory = [];
    }

    if (existingHabit.scheduleHistory.length === 0) {
        existingHabit.scheduleHistory.push(_buildScheduleFromForm(targetDate, cleanFormData));
        existingHabit.createdOn = targetDate;
        _notifyChanges(true);
        return;
    }

    _requestFutureScheduleChange(existingHabit.id, targetDate, (s) => ({
        ...s,
        icon: cleanFormData.icon,
        color: cleanFormData.color,
        goal: cleanFormData.goal,
        philosophy: cleanFormData.philosophy ?? s.philosophy,
        name: cleanFormData.name,
        nameKey: cleanFormData.nameKey,
        subtitleKey: cleanFormData.subtitleKey,
        times: cleanFormData.times,
        frequency: cleanFormData.frequency,
        endDate: undefined
    }), false);

    existingHabit.scheduleHistory = existingHabit.scheduleHistory.filter(s => {
        if (s.startDate > targetDate) return false;
        if (s.startDate === targetDate && s.endDate) return false;
        return true;
    });
}

function _createHabitFromForm(targetDate: string, cleanFormData: CleanFormData) {
    state.habits.push({ id: generateUUID(), createdOn: targetDate, scheduleHistory: [_buildScheduleFromForm(targetDate, cleanFormData)] });
    _notifyChanges(true);
}

function _updateExistingHabitFromForm(h: Habit, targetDate: string, cleanFormData: CleanFormData) {
    ensureHabitDailyInfo(targetDate, h.id).dailySchedule = undefined;
    if (targetDate < h.createdOn) h.createdOn = targetDate;
    _requestFutureScheduleChange(h.id, targetDate, (s) => ({
        ...s,
        icon: cleanFormData.icon,
        color: cleanFormData.color,
        goal: cleanFormData.goal,
        philosophy: cleanFormData.philosophy ?? s.philosophy,
        name: cleanFormData.name,
        nameKey: cleanFormData.nameKey,
        subtitleKey: cleanFormData.subtitleKey,
        times: cleanFormData.times,
        frequency: cleanFormData.frequency
    }), false);
}

export function saveHabitFromModal() {
    if (!state.editingHabit) return;
    const { isNew, habitId, formData, targetDate } = state.editingHabit;
    const normalized = _normalizeFormDataForSave(formData);
    if (!normalized) return;
    const { clean: cleanFormData, nameToUse } = normalized;

    // NAVIGATION FIX [2025-06-14]: Suppress onClose callback (reopen Explore) on successful save.
    closeModal(ui.editHabitModal, true);

    // EMPTY TIMES FIX [2025-02-07]: Se nenhum horário foi selecionado, não adicionar/ressuscitar.
    if (cleanFormData.times.length === 0) {
        _handleEmptyTimesSave(isNew, habitId, targetDate, nameToUse);
        return;
    }

    if (isNew) {
        const candidates = _findResurrectionCandidates(nameToUse, targetDate);
        const existingHabit = _pickExistingHabitCandidate(candidates, targetDate);
        if (existingHabit) _applyResurrection(existingHabit, targetDate, cleanFormData);
        else _createHabitFromForm(targetDate, cleanFormData);
    } else {
        const h = state.habits.find(x => x.id === habitId);
        if (!h) return;
        _updateExistingHabitFromForm(h, targetDate, cleanFormData);
    }
}
