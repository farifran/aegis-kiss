/**
 * @license
 * SPDX-License-Identifier: MIT
*/

import { state, Habit, TimeOfDay, HabitSchedule, getHabitDailyInfoForDate, STREAK_LOOKBACK_DAYS, PredefinedHabit, HABIT_STATE } from '../state';
import { toUTCIsoDateString, parseUTCIsoDate, MS_PER_DAY, getTodayUTCIso } from '../utils';
import { t } from '../i18n';
import { HabitService } from './HabitService';

const _anchorDateCache = new Map<string, Date>();
const MAX_ANCHOR_CACHE_SIZE = 2048;
const MAX_CACHE_SIZE = 4096;

function _getMemoizedDate(dateISO: string): Date {
    let date = _anchorDateCache.get(dateISO);
    if (!date) {
        if (_anchorDateCache.size > MAX_ANCHOR_CACHE_SIZE) _anchorDateCache.clear();
        date = parseUTCIsoDate(dateISO);
        _anchorDateCache.set(dateISO, date);
    }
    return date;
}

export const clearSelectorInternalCaches = () => _anchorDateCache.clear();

/**
 * Cache de dois níveis (hábito → data). Ao estourar o teto, descarta o sub-cache
 * inteiro: é derivável do estado, então recomputar é sempre seguro.
 */
function memoizeByHabitDate<T>(cache: Map<string, Map<string, T>>, habitId: string, dateISO: string, compute: () => T): T {
    let subCache = cache.get(habitId);
    if (!subCache) cache.set(habitId, subCache = new Map());

    const cached = subCache.get(dateISO);
    if (cached !== undefined) return cached;

    const value = compute();
    if (subCache.size > MAX_CACHE_SIZE) subCache.clear();
    subCache.set(dateISO, value);
    return value;
}

export function getScheduleForDate(habit: Habit, dateISO: string): HabitSchedule | null {
    return memoizeByHabitDate(state.scheduleCache, habit.id, dateISO, () => {
        const history = habit.scheduleHistory;
        if (!Array.isArray(history)) return null;

        // Do mais recente para o mais antigo: a primeira versão que já começou é a
        // vigente — a menos que já tenha terminado, e aí o hábito não vale no dia.
        for (let i = history.length - 1; i >= 0; i--) {
            const s = history[i];
            if (dateISO >= s.startDate) return !s.endDate || dateISO < s.endDate ? s : null;
        }
        return null;
    });
}

export function getEffectiveScheduleForHabitOnDate(habit: Habit, dateISO: string): readonly TimeOfDay[] {
    const dailyInfo = getHabitDailyInfoForDate(dateISO)[habit.id];
    if (dailyInfo?.dailySchedule) {
        return dailyInfo.dailySchedule;
    }
    const schedule = getScheduleForDate(habit, dateISO);
    return schedule?.times || [];
}

export function getHabitPropertiesForDate(habit: Habit, dateISO: string): HabitSchedule | null {
    if (!habit?.scheduleHistory || habit.scheduleHistory.length === 0) return null;
    const schedule = getScheduleForDate(habit, dateISO);
    return schedule || habit.scheduleHistory[habit.scheduleHistory.length - 1];
}

export function getHabitDisplayInfo(habit: Habit | PredefinedHabit, dateISO?: string, time?: TimeOfDay): { name: string, subtitle: string, status?: number, isCompleted?: boolean, note?: string, value?: number } {
    let source: any = habit;
    const effectiveDate = dateISO || getTodayUTCIso();

    if ('scheduleHistory' in habit && habit.scheduleHistory.length > 0) {
        source = getHabitPropertiesForDate(habit as Habit, effectiveDate);
    }
    
    const baseInfo = {
        name: source.nameKey ? t(source.nameKey) : (source.name || ''),
        subtitle: source.subtitleKey ? t(source.subtitleKey) : (source.subtitle || '')
    };

    if (time && 'id' in habit) {
        const h = habit as Habit;
        const status = HabitService.getStatus(h.id, effectiveDate, time);
        const dayInfo = getHabitDailyInfoForDate(effectiveDate);
        const instanceData = dayInfo[h.id]?.instances[time];
        
        return {
            ...baseInfo,
            status,
            isCompleted: status === HABIT_STATE.DONE || status === HABIT_STATE.DONE_PLUS,
            note: instanceData?.note,
            value: instanceData?.goalOverride || 0
        };
    }

    return baseInfo;
}

export function shouldHabitAppearOnDate(habit: Habit, dateISO: string, preParsedDate?: Date): boolean {
    // TOMBSTONE CHECK: Se o hábito foi deletado antes ou nesta data, ele não aparece.
    if (habit.deletedOn && dateISO >= habit.deletedOn) return false;

    return memoizeByHabitDate(state.habitAppearanceCache, habit.id, dateISO, () => {
        const schedule = getScheduleForDate(habit, dateISO);
        if (!schedule || habit.graduatedOn) return false;

        const { frequency } = schedule;
        const date = preParsedDate || parseUTCIsoDate(dateISO);

        switch (frequency.type) {
            case 'daily':
                return true;
            case 'specific_days_of_week':
                return frequency.days.includes(date.getUTCDay());
            case 'interval': {
                const anchorDate = _getMemoizedDate(schedule.scheduleAnchor || schedule.startDate);
                const diffDays = Math.round((date.getTime() - anchorDate.getTime()) / MS_PER_DAY);
                if (diffDays < 0) return false;
                return frequency.unit === 'days'
                    ? diffDays % frequency.amount === 0
                    : date.getUTCDay() === anchorDate.getUTCDay() && Math.floor(diffDays / 7) % frequency.amount === 0;
            }
        }
    });
}

function _isHabitConsistentlyDone(habit: Habit, dateISO: string): boolean {
    const schedule = getEffectiveScheduleForHabitOnDate(habit, dateISO);
    if (schedule.length === 0) return true;
    
    for (let i = 0; i < schedule.length; i++) {
        const time = schedule[i];
        const status = HabitService.getStatus(habit.id, dateISO, time);
        if (status !== HABIT_STATE.DONE && status !== HABIT_STATE.DONE_PLUS) return false;
    }
    return true;
}

export function calculateHabitStreak(habitOrId: string | Habit, endDateISO: string): number {
    const habit = typeof habitOrId === 'string' ? state.habits.find(h => h.id === habitOrId) : habitOrId;
    if (!habit) return 0;

    return memoizeByHabitDate(state.streaksCache, habit.id, endDateISO, () => {
        const endDateObj = parseUTCIsoDate(endDateISO);
        if (isNaN(endDateObj.getTime())) return 0;

        let streak = 0;
        let currentTs = endDateObj.getTime();
        const iterDate = new Date();

        // Anda para trás enquanto os dias agendados estiverem cumpridos.
        for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
            iterDate.setTime(currentTs);
            const iso = toUTCIsoDateString(iterDate);
            if (iso < habit.createdOn) break;
            if (shouldHabitAppearOnDate(habit, iso, iterDate)) {
                if (!_isHabitConsistentlyDone(habit, iso)) break;
                streak++;
            }
            currentTs -= MS_PER_DAY;
        }
        return streak;
    });
}

export function getSmartGoalForHabit(habit: Habit, dateISO: string, time: TimeOfDay): number {
    const schedule = getHabitPropertiesForDate(habit, dateISO);
    if (!schedule || schedule.goal.type === 'check' || !schedule.goal.total) return 1;
    
    const dailyInfo = getHabitDailyInfoForDate(dateISO)[habit.id];
    if (dailyInfo?.instances[time]?.goalOverride !== undefined) return dailyInfo.instances[time].goalOverride!;
    
    const baseGoal = schedule.goal.total;
    const targetTs = parseUTCIsoDate(dateISO).getTime();
    const todayTs = parseUTCIsoDate(getTodayUTCIso()).getTime();
    let searchTs = (targetTs > todayTs) ? todayTs : (targetTs - MS_PER_DAY);
    let iterDate = new Date(searchTs);
    
    let consistentValue: number | null = null;
    let matchesFound = 0;
    
    for (let i = 0; i < 14; i++) {
        const iterISO = toUTCIsoDateString(iterDate);
        if (iterISO < habit.createdOn) break;
        if (shouldHabitAppearOnDate(habit, iterISO, iterDate)) {
            const status = HabitService.getStatus(habit.id, iterISO, time);
            if (status === HABIT_STATE.DONE || status === HABIT_STATE.DONE_PLUS) {
                const pastInfo = getHabitDailyInfoForDate(iterISO)[habit.id];
                const instance = pastInfo?.instances?.[time];
                if (instance && instance.goalOverride !== undefined) {
                    if (consistentValue === null) { consistentValue = instance.goalOverride; matchesFound++; }
                    else if (consistentValue === instance.goalOverride) matchesFound++;
                    else break;
                } else break;
            }
        }
        if (matchesFound >= 2) return consistentValue!;
        iterDate.setTime(iterDate.getTime() - MS_PER_DAY);
    }

    const streak = calculateHabitStreak(habit, toUTCIsoDateString(new Date(targetTs - MS_PER_DAY)));
    return Math.min(baseGoal * 4, Math.max(5, baseGoal + (Math.floor(streak / 7) * 5)));
}

export function getCurrentGoalForInstance(habit: Habit, dateISO: string, time: TimeOfDay): number {
    return getHabitDailyInfoForDate(dateISO)[habit.id]?.instances[time]?.goalOverride ?? getSmartGoalForHabit(habit, dateISO, time);
}

export function getActiveHabitsForDate(dateISO: string, preParsedDate?: Date): Array<{ habit: Habit, schedule: TimeOfDay[] }> {
    const cached = state.activeHabitsCache.get(dateISO);
    if (cached) return cached;
    const dateObj = preParsedDate || parseUTCIsoDate(dateISO);
    const active: Array<{ habit: Habit, schedule: TimeOfDay[] }> = [];
    for (let i = 0; i < state.habits.length; i++) {
        const h = state.habits[i];
        if (shouldHabitAppearOnDate(h, dateISO, dateObj)) {
            const sch = getEffectiveScheduleForHabitOnDate(h, dateISO);
            if (sch.length > 0) active.push({ habit: h, schedule: sch as TimeOfDay[] });
        }
    }
    if (state.activeHabitsCache.size > MAX_CACHE_SIZE) state.activeHabitsCache.clear();
    state.activeHabitsCache.set(dateISO, active);
    return active;
}

export function calculateDaySummary(dateISO: string, preParsedDate?: Date) {
    const cached = state.daySummaryCache.get(dateISO);
    if (cached) return cached;

    let total = 0, completed = 0, snoozed = 0, pending = 0;
    const dateObj = preParsedDate || parseUTCIsoDate(dateISO);
    const activeHabitsForPlusCheck: { habit: Habit, time: TimeOfDay, status: number }[] = [];
    const activeHabits = getActiveHabitsForDate(dateISO, dateObj);

    for (let i = 0; i < activeHabits.length; i++) {
        const { habit: h, schedule: sch } = activeHabits[i];
        const scheduleProps = getHabitPropertiesForDate(h, dateISO);
        
        for (let j = 0; j < sch.length; j++) {
            const t = sch[j];
            const status = HabitService.getStatus(h.id, dateISO, t);
            total++;
            if (status === HABIT_STATE.DONE || status === HABIT_STATE.DONE_PLUS) {
                completed++;
                if (scheduleProps && scheduleProps.goal.type !== 'check' && scheduleProps.goal.total) {
                    activeHabitsForPlusCheck.push({ habit: h, time: t, status });
                }
            } else if (status === HABIT_STATE.DEFERRED) snoozed++;
            else pending++;
        }
    }
    
    let hasPlus = false;
    if (total > 0 && completed === total) {
        const d1 = toUTCIsoDateString(new Date(dateObj.getTime() - MS_PER_DAY));
        const d2 = toUTCIsoDateString(new Date(dateObj.getTime() - MS_PER_DAY * 2));
        const sum1 = calculateDaySummary(d1), sum2 = calculateDaySummary(d2);

        if (sum1.total > 0 && sum1.completed === sum1.total && sum2.total > 0 && sum2.completed === sum2.total) {
            for (const item of activeHabitsForPlusCheck) {
                if (item.status === HABIT_STATE.DONE_PLUS) {
                    const { habit, time } = item;
                    const valToday = getCurrentGoalForInstance(habit, dateISO, time);
                    const valD1 = getCurrentGoalForInstance(habit, d1, time);
                    const valD2 = getCurrentGoalForInstance(habit, d2, time);
                    if (valToday > valD1 && valToday > valD2) { hasPlus = true; break; }
                }
            }
        }
    }
    
    const res = { total, completed, snoozed, pending, completedPercent: total ? (completed / total) * 100 : 0, snoozedPercent: total ? (snoozed / total) * 100 : 0, showPlusIndicator: hasPlus };
    if (state.daySummaryCache.size > MAX_CACHE_SIZE) state.daySummaryCache.clear();
    state.daySummaryCache.set(dateISO, res);
    return res;
}
