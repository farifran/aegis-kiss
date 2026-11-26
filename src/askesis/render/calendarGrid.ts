/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file render/calendarGrid.ts
 * @description Renderização da grade do almanaque (Full Calendar / modal de calendário completo).
 *              Separado de calendar.ts para isolar as responsabilidades de strip vs. grid.
 */

import { state } from '../state';
import { calculateDaySummary } from '../services/selectors';
import { ui } from './ui';
import { toUTCIsoDateString, parseUTCIsoDate, pad2, getTodayUTCIso } from '../utils';
import { formatInteger } from '../i18n';
import { setTextContent } from './dom';
import { CSS_CLASSES } from './constants';

const OPTS_ARIA = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' } as const;

let fullCalendarDayTemplate: HTMLElement | null = null;

const getFullCalendarDayTemplate = () =>
    fullCalendarDayTemplate || (fullCalendarDayTemplate = (() => {
        const el = document.createElement('div');
        el.className = 'full-calendar-day';
        el.setAttribute('role', 'button');

        const ring = document.createElement('div');
        ring.className = CSS_CLASSES.DAY_PROGRESS_RING;
        const dayNumber = document.createElement('span');
        dayNumber.className = CSS_CLASSES.DAY_NUMBER;
        ring.appendChild(dayNumber);

        el.appendChild(ring);
        return el;
    })());

export function renderFullCalendar() {
    if (!ui.fullCalendarGrid || !state.fullCalendar) return;

    const { year, month } = state.fullCalendar;

    ui.fullCalendarMonthYear.textContent = new Date(Date.UTC(year, month, 1))
        .toLocaleDateString(state.activeLanguageCode, { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const frag = document.createDocumentFragment();
    const first = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const startDayOfWeek = first.getUTCDay(); // 0 = Domingo
    const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Dias do mês anterior (cinza)
    for (let i = 0; i < startDayOfWeek; i++) {
        const d = prevMonthDays - startDayOfWeek + 1 + i;
        const el = getFullCalendarDayTemplate().cloneNode(true) as HTMLElement;
        el.classList.add('other-month');
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('tabindex', '-1');
        const prevDayNum = el.firstElementChild?.firstElementChild ?? null;
        setTextContent(prevDayNum, formatInteger(d));
        frag.appendChild(el);
    }

    // Dias do mês atual
    const todayISO = getTodayUTCIso();
    const prefix = `${year}-${pad2(month + 1)}-`;

    for (let i = 1; i <= daysInMonth; i++) {
        const iso = prefix + pad2(i);
        const dateObj = parseUTCIsoDate(iso);
        const el = getFullCalendarDayTemplate().cloneNode(true) as HTMLElement;
        const ring = el.firstElementChild as HTMLElement;
        const num = ring.firstElementChild as HTMLElement;

        setTextContent(num, formatInteger(i));
        el.dataset.date = iso;
        el.setAttribute('aria-label', dateObj.toLocaleDateString(state.activeLanguageCode, OPTS_ARIA));

        const { completedPercent, snoozedPercent, showPlusIndicator } = calculateDaySummary(iso, dateObj);

        if (completedPercent > 0) ring.style.setProperty('--completed-percent', `${completedPercent}%`);
        if (snoozedPercent > 0) ring.style.setProperty('--snoozed-percent', `${snoozedPercent}%`);
        if (showPlusIndicator) num.classList.add('has-plus');

        if (iso === state.selectedDate) {
            el.classList.add(CSS_CLASSES.SELECTED);
            el.setAttribute('aria-current', 'date');
            el.setAttribute('tabindex', '0');
        } else {
            el.setAttribute('tabindex', '-1');
        }
        if (iso === todayISO) el.classList.add(CSS_CLASSES.TODAY);

        frag.appendChild(el);
    }

    ui.fullCalendarGrid.replaceChildren();
    ui.fullCalendarGrid.appendChild(frag);
}
