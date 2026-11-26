/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file listeners/modals/fullCalendarHandlers.ts
 * @description Handlers do calendário completo (almanac modal).
 */

import { state, invalidateChartCache } from '../../state';
import { ui } from '../../render/ui';
import { closeModal, renderFullCalendar, viewTransitionRender } from '../../render';
import { addDays, parseUTCIsoDate, toUTCIsoDateString, triggerHaptic, getNormalizedKeyboardKey } from '../../utils';

function navigateToDateFromAlmanac(dateISO: string) {
    const flipDir = dateISO < state.selectedDate ? 'forward' : 'back';
    state.selectedDate = dateISO;

    closeModal(ui.fullCalendarModal);

    state.uiDirtyState.calendarVisuals = true;
    state.uiDirtyState.habitListStructure = true;
    invalidateChartCache();

    viewTransitionRender(flipDir);

    requestAnimationFrame(() => {
        const selectedEl = ui.calendarStrip.querySelector('.day-item.selected');
        selectedEl?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    });
}

export const handleFullCalendarPrevClick = () => {
    if (!state.fullCalendar) return;
    let { month, year } = state.fullCalendar;
    month--;
    if (month < 0) { month = 11; year--; }
    state.fullCalendar = { month, year };
    renderFullCalendar();
    triggerHaptic('light');
};

export const handleFullCalendarNextClick = () => {
    if (!state.fullCalendar) return;
    let { month, year } = state.fullCalendar;
    month++;
    if (month > 11) { month = 0; year++; }
    state.fullCalendar = { month, year };
    renderFullCalendar();
    triggerHaptic('light');
};

export const handleFullCalendarGridClick = (e: MouseEvent) => {
    const dayEl = (e.target as HTMLElement).closest<HTMLElement>('.full-calendar-day');
    if (dayEl && dayEl.dataset.date && !dayEl.classList.contains('other-month')) {
        triggerHaptic('selection');
        navigateToDateFromAlmanac(dayEl.dataset.date);
    }
};

export const handleFullCalendarGridKeydown = (e: KeyboardEvent) => {
    const key = getNormalizedKeyboardKey(e);

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'].includes(key)) {
        return;
    }
    e.preventDefault();

    if (key === 'Enter' || key === 'Space') {
        navigateToDateFromAlmanac(state.selectedDate);
        return;
    }

    const currentSelectedDate = parseUTCIsoDate(state.selectedDate);
    let newDate: Date;

    switch (key) {
        case 'ArrowRight': newDate = addDays(currentSelectedDate, 1); break;
        case 'ArrowLeft': newDate = addDays(currentSelectedDate, -1); break;
        case 'ArrowUp': newDate = addDays(currentSelectedDate, -7); break;
        case 'ArrowDown': newDate = addDays(currentSelectedDate, 7); break;
        default: return;
    }

    state.selectedDate = toUTCIsoDateString(newDate);

    if (newDate.getUTCMonth() !== state.fullCalendar.month || newDate.getUTCFullYear() !== state.fullCalendar.year) {
        state.fullCalendar.month = newDate.getUTCMonth();
        state.fullCalendar.year = newDate.getUTCFullYear();
    }

    renderFullCalendar();

    requestAnimationFrame(() => {
        const newSelectedEl = ui.fullCalendarGrid.querySelector<HTMLElement>(`.full-calendar-day[data-date="${state.selectedDate}"]`);
        newSelectedEl?.focus();
    });
};
