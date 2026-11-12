/**
 * @file render/modalBuilders.test.ts
 * @description Testes de caracterização: congelam o DOM que cada builder produz.
 *
 * Foram escritos ANTES de reescrever a construção imperativa destes nós, para que
 * qualquer diferença de estrutura, classe, atributo ou ordem de filhos apareça
 * como falha. O módulo estava com 0% de cobertura.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n', () => ({
    t: (key: string) => `t:${key}`,
    getTimeOfDayName: (time: string) => `name:${time}`
}));

vi.mock('./icons', () => ({
    sanitizeHabitIcon: (icon: string) => icon,
    getTimeOfDayIcon: (time: string) => `<svg aria-hidden="true"><title>${time}</title></svg>`
}));

import {
    replaceWithHtmlFragment,
    buildManageActionButton,
    buildIconPickerItem,
    buildColorSwatch,
    buildFrequencyTypeLabel,
    buildExploreHabitItem,
    buildTimeSegmentedButton,
    buildTimeSegmentedControl
} from './modalBuilders';
import type { PredefinedHabit } from '../state';

const HABIT = {
    icon: '<svg><path d="M0 0"/></svg>',
    color: '#ff8800',
    nameKey: 'habitFoo',
    subtitleKey: 'habitFooSub',
    times: ['Morning'],
    goal: { type: 'check' },
    frequency: { type: 'daily' }
} as unknown as PredefinedHabit;

/** Serializa com atributos ordenados: a ordem de inserção não afeta render nem CSS. */
function html(node: Element): string {
    const attrs = Array.from(node.attributes)
        .map(a => `${a.name}="${a.value}"`)
        .sort()
        .join(' ');
    return `<${node.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${node.innerHTML}</${node.tagName.toLowerCase()}>`;
}

describe('builders de modal — estrutura do DOM', () => {
    it('replaceWithHtmlFragment substitui o conteúdo e sanitiza', () => {
        const target = document.createElement('div');
        target.textContent = 'antigo';
        replaceWithHtmlFragment(target, '<span class="x">novo</span><script>alert(1)</script>');
        expect(target.innerHTML).toBe('<span class="x">novo</span>');
    });

    it('buildManageActionButton', () => {
        const btn = buildManageActionButton('end-habit-btn', 'Encerrar Foo', '<svg><path d="M1 1"/></svg>');
        expect(html(btn)).toBe(
            '<button aria-label="Encerrar Foo" class="end-habit-btn"><svg><path d="M1 1"></path></svg></button>'
        );
    });

    it('buildIconPickerItem guarda o svg no dataset e o renderiza', () => {
        const svg = '<svg><path d="M2 2"/></svg>';
        const btn = buildIconPickerItem(svg);
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.type).toBe('button');
        expect(btn.className).toBe('icon-picker-item');
        expect(btn.dataset.iconSvg).toBe(svg);
        expect(btn.querySelector('path')?.getAttribute('d')).toBe('M2 2');
    });

    it('buildColorSwatch marca selecionado e guarda a cor', () => {
        expect(html(buildColorSwatch('#123456', false))).toBe(
            '<button class="color-swatch" data-color="#123456" style="background-color: rgb(18, 52, 86);" type="button"></button>'
        );
        expect(buildColorSwatch('#123456', true).className).toBe('color-swatch selected');
    });

    it('buildFrequencyTypeLabel', () => {
        expect(html(buildFrequencyTypeLabel('interval', true, 'A cada'))).toBe(
            '<label><input type="radio" name="frequency-type" value="interval">A cada</label>'
        );
        expect(buildFrequencyTypeLabel('daily', true, 'x').querySelector('input')!.checked).toBe(true);
        expect(buildFrequencyTypeLabel('daily', false, 'x').querySelector('input')!.checked).toBe(false);
    });

    it('buildExploreHabitItem', () => {
        const item = buildExploreHabitItem(HABIT, 3);
        expect(item.className).toBe('explore-habit-item');
        expect(item.dataset.index).toBe('3');
        expect(item.getAttribute('role')).toBe('button');
        expect(item.tabIndex).toBe(0);
        expect(item.style.getPropertyValue('--delay')).not.toBe('');

        const icon = item.children[0] as HTMLElement;
        expect(icon.className).toBe('explore-habit-icon');
        expect(icon.style.color).toBe('rgb(255, 136, 0)');
        expect(icon.querySelector('path')).not.toBeNull();

        const details = item.children[1] as HTMLElement;
        expect(details.className).toBe('explore-habit-details');
        expect((details.children[0] as HTMLElement).className).toBe('name');
        expect(details.children[0].textContent).toBe('t:habitFoo');
        expect((details.children[1] as HTMLElement).className).toBe('subtitle');
        expect(details.children[1].textContent).toBe('t:habitFooSub');
    });

    it('buildTimeSegmentedButton', () => {
        const btn = buildTimeSegmentedButton('Evening', true);
        expect(btn.className).toBe('segmented-control-option selected');
        expect(btn.dataset.time).toBe('Evening');
        expect((btn.children[0] as HTMLElement).className).toBe('segmented-control-option-icon');
        expect(btn.children[0].querySelector('title')?.textContent).toBe('Evening');
        expect((btn.children[1] as HTMLElement).className).toBe('segmented-control-option-label');
        expect(btn.children[1].textContent).toBe('name:Evening');

        expect(buildTimeSegmentedButton('Evening', false).className).toBe('segmented-control-option');
    });

    it('buildTimeSegmentedControl gera os três períodos na ordem canônica', () => {
        const wrap = buildTimeSegmentedControl(['Afternoon']);
        expect(wrap.className).toBe('segmented-control');
        expect([...wrap.children].map(c => (c as HTMLElement).dataset.time)).toEqual(['Morning', 'Afternoon', 'Evening']);
        expect([...wrap.children].map(c => c.className)).toEqual([
            'segmented-control-option',
            'segmented-control-option selected',
            'segmented-control-option'
        ]);
    });
});
