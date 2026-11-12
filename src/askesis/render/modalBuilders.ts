/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file render/modalBuilders.ts
 * @description Helpers puros para construcao de elementos de modal.
 */

import { el, sanitizeHtmlToFragment } from './dom';
import { sanitizeHabitIcon, getTimeOfDayIcon } from './icons';
import { t, getTimeOfDayName } from '../i18n';
import { PredefinedHabit, TimeOfDay, TIMES_OF_DAY } from '../state';
import { EXPLORE_STAGGER_DELAY_MS } from './constants';

type FrequencyTypeOption = 'daily' | 'specific_days_of_week' | 'interval';

export function replaceWithHtmlFragment(target: HTMLElement, html: string) {
    target.replaceChildren(sanitizeHtmlToFragment(html));
}

/** Nó cujo conteúdo é markup confiável (ícones do app), sempre sanitizado antes. */
function withIcon<T extends HTMLElement>(node: T, iconHtml: string): T {
    replaceWithHtmlFragment(node, iconHtml);
    return node;
}

export function buildManageActionButton(className: string, ariaLabel: string, iconHtml: string): HTMLButtonElement {
    const btn = el('button', className);
    btn.setAttribute('aria-label', ariaLabel);
    return withIcon(btn, iconHtml);
}

export function buildIconPickerItem(svg: string): HTMLButtonElement {
    const btn = el('button', 'icon-picker-item');
    btn.type = 'button';
    btn.dataset.iconSvg = svg;
    return withIcon(btn, svg);
}

export function buildColorSwatch(color: string, selected: boolean): HTMLButtonElement {
    const btn = el('button', `color-swatch${selected ? ' selected' : ''}`);
    btn.type = 'button';
    btn.style.backgroundColor = color;
    btn.dataset.color = color;
    return btn;
}

export function buildFrequencyTypeLabel(type: FrequencyTypeOption, checked: boolean, label: string): HTMLLabelElement {
    const input = el('input');
    input.type = 'radio';
    input.name = 'frequency-type';
    input.value = type;
    input.checked = checked;
    return el('label', undefined, input, label);
}

export function buildExploreHabitItem(h: PredefinedHabit, index: number): HTMLElement {
    const icon = withIcon(el('div', 'explore-habit-icon'), sanitizeHabitIcon(h.icon, '❓'));
    icon.style.backgroundColor = `${h.color}30`;
    icon.style.color = h.color;

    const details = el('div', 'explore-habit-details',
        el('div', 'name', t(h.nameKey)),
        el('div', 'subtitle', t(h.subtitleKey))
    );

    const item = el('div', 'explore-habit-item', icon, details);
    item.dataset.index = String(index);
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.style.setProperty('--delay', `${index * EXPLORE_STAGGER_DELAY_MS}ms`);
    return item;
}

export function buildTimeSegmentedButton(time: TimeOfDay, isSelected: boolean): HTMLButtonElement {
    const btn = el('button', `segmented-control-option${isSelected ? ' selected' : ''}`,
        withIcon(el('span', 'segmented-control-option-icon'), getTimeOfDayIcon(time)),
        el('span', 'segmented-control-option-label', getTimeOfDayName(time))
    );
    btn.type = 'button';
    btn.dataset.time = time;
    return btn;
}

export function buildTimeSegmentedControl(selectedTimes: readonly TimeOfDay[]): HTMLElement {
    return el('div', 'segmented-control',
        ...TIMES_OF_DAY.map(time => buildTimeSegmentedButton(time, selectedTimes.includes(time)))
    );
}
