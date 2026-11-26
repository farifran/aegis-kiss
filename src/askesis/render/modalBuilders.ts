/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file render/modalBuilders.ts
 * @description Helpers puros para construcao de elementos de modal.
 */

import { sanitizeHtmlToFragment, setTextContent } from './dom';
import { sanitizeHabitIcon, getTimeOfDayIcon } from './icons';
import { t, getTimeOfDayName } from '../i18n';
import { PredefinedHabit, TimeOfDay, TIMES_OF_DAY } from '../state';
import { EXPLORE_STAGGER_DELAY_MS } from './constants';

export type FrequencyTypeOption = 'daily' | 'specific_days_of_week' | 'interval';

export function replaceWithHtmlFragment(target: HTMLElement, html: string) {
    target.replaceChildren(sanitizeHtmlToFragment(html));
}

export function buildManageActionButton(className: string, ariaLabel: string, iconHtml: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.setAttribute('aria-label', ariaLabel);
    replaceWithHtmlFragment(btn, iconHtml);
    return btn;
}

export function buildIconPickerItem(svg: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-picker-item';
    btn.dataset.iconSvg = svg;
    replaceWithHtmlFragment(btn, svg);
    return btn;
}

export function buildColorSwatch(color: string, selected: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `color-swatch${selected ? ' selected' : ''}`;
    btn.style.backgroundColor = color;
    btn.dataset.color = color;
    return btn;
}

export function buildFrequencyTypeLabel(type: FrequencyTypeOption, checked: boolean, label: string): HTMLLabelElement {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'frequency-type';
    input.value = type;
    input.checked = checked;
    wrap.append(input, label);
    return wrap;
}

export function buildExploreHabitItem(h: PredefinedHabit, index: number): HTMLElement {
    const item = document.createElement('div');
    item.className = 'explore-habit-item';
    item.dataset.index = String(index);
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.style.setProperty('--delay', `${index * EXPLORE_STAGGER_DELAY_MS}ms`);

    const icon = document.createElement('div');
    icon.className = 'explore-habit-icon';
    icon.style.backgroundColor = `${h.color}30`;
    icon.style.color = h.color;
    replaceWithHtmlFragment(icon, sanitizeHabitIcon(h.icon, '❓'));

    const details = document.createElement('div');
    details.className = 'explore-habit-details';

    const name = document.createElement('div');
    name.className = 'name';
    setTextContent(name, t(h.nameKey));

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    setTextContent(subtitle, t(h.subtitleKey));

    details.append(name, subtitle);
    item.append(icon, details);
    return item;
}

export function buildTimeSegmentedButton(time: TimeOfDay, isSelected: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `segmented-control-option${isSelected ? ' selected' : ''}`;
    btn.dataset.time = time;
    const icon = document.createElement('span');
    icon.className = 'segmented-control-option-icon';
    replaceWithHtmlFragment(icon, getTimeOfDayIcon(time));
    const label = document.createElement('span');
    label.className = 'segmented-control-option-label';
    setTextContent(label, getTimeOfDayName(time));
    btn.append(icon, label);
    return btn;
}

export function buildTimeSegmentedControl(selectedTimes: readonly TimeOfDay[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'segmented-control';
    wrap.replaceChildren(...TIMES_OF_DAY.map(time => buildTimeSegmentedButton(time, selectedTimes.includes(time))));
    return wrap;
}
