/**
 * @file listeners/drag.test.ts
 * @description Cobertura basica da maquina de estados de drag (idle -> active -> idle).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearTestState } from '../tests/test-utils';

vi.mock('../services/habitActions', () => ({
  handleHabitDrop: vi.fn(),
  reorderHabit: vi.fn(),
}));

vi.mock('../services/selectors', () => ({
  getEffectiveScheduleForHabitOnDate: vi.fn(() => ['Morning']),
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return { ...actual, triggerHaptic: vi.fn() };
});

vi.mock('../render', () => ({
  renderApp: vi.fn(),
}));

import { isDragging, setupDragHandler, startDragSession } from './drag';
import { CSS_CLASSES } from '../render/constants';
import { handleHabitDrop, reorderHabit } from '../services/habitActions';
import { getEffectiveScheduleForHabitOnDate } from '../services/selectors';
import { createTestHabit } from '../tests/test-utils';

function createCardAndContent(habitId = 'habit-1', time = 'Morning') {
  const card = document.createElement('article');
  card.className = 'habit-card';
  card.dataset.habitId = habitId;
  card.dataset.time = time;

  const content = document.createElement('div');
  content.className = 'habit-content-wrapper';
  card.appendChild(content);

  return { card, content };
}

describe('listeners/drag.ts', () => {
  beforeEach(() => {
    clearTestState();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pointercancel'));
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('permanece idle sem container configurado', () => {
    const { card, content } = createCardAndContent();
    const startEvent = { clientX: 10, clientY: 10, pointerId: 1 } as PointerEvent;

    startDragSession(card, content, startEvent);

    expect(isDragging()).toBe(false);
    expect(card.classList.contains(CSS_CLASSES.DRAGGING)).toBe(false);
  });

  it('entra em estado active com setup valido', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    setupDragHandler(container);

    const { card, content } = createCardAndContent();
    container.appendChild(card);

    const startEvent = { clientX: 24, clientY: 40, pointerId: 7 } as PointerEvent;
    startDragSession(card, content, startEvent);

    expect(isDragging()).toBe(true);
    expect(card.classList.contains(CSS_CLASSES.DRAGGING)).toBe(true);
    expect(document.body.classList.contains('is-dragging-active')).toBe(true);
    expect(document.querySelector(`.${CSS_CLASSES.DRAG_IMAGE_GHOST}`)).toBeTruthy();
  });

  it('retorna para idle no pointerup e limpa classes visuais', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    setupDragHandler(container);

    const { card, content } = createCardAndContent();
    container.appendChild(card);

    const startEvent = { clientX: 18, clientY: 22, pointerId: 4 } as PointerEvent;
    startDragSession(card, content, startEvent);

    window.dispatchEvent(new Event('pointerup'));

    expect(isDragging()).toBe(false);
    expect(card.classList.contains(CSS_CLASSES.DRAGGING)).toBe(false);
    expect(document.body.classList.contains('is-dragging-active')).toBe(false);
    expect(document.querySelector(`.${CSS_CLASSES.DRAG_IMAGE_GHOST}`)).toBeNull();
  });

  it('executa handleHabitDrop em drop valido entre grupos', () => {
    const habitId = createTestHabit({ name: 'Mover', time: 'Morning' });

    const container = document.createElement('section');
    document.body.appendChild(container);
    setupDragHandler(container);

    const sourceZone = document.createElement('div');
    sourceZone.className = 'drop-zone';
    sourceZone.dataset.time = 'Morning';

    const targetZone = document.createElement('div');
    targetZone.className = 'drop-zone';
    targetZone.dataset.time = 'Afternoon';

    const { card, content } = createCardAndContent(habitId, 'Morning');
    sourceZone.appendChild(card);
    container.append(sourceZone, targetZone);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(targetZone);

    const startEvent = new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 11, buttons: 1 });
    startDragSession(card, content, startEvent);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 16, clientY: 24, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(handleHabitDrop).toHaveBeenCalledTimes(1);
    expect(handleHabitDrop).toHaveBeenCalledWith(habitId, 'Morning', 'Afternoon', undefined);
    expect(reorderHabit).not.toHaveBeenCalled();
  });

  it('executa reorderHabit em drop valido no mesmo grupo', () => {
    const sourceId = createTestHabit({ name: 'Origem', time: 'Morning' });
    const targetId = createTestHabit({ name: 'Alvo', time: 'Morning' });

    const container = document.createElement('section');
    document.body.appendChild(container);
    setupDragHandler(container);

    const zone = document.createElement('div');
    zone.className = 'drop-zone';
    zone.dataset.time = 'Morning';

    const { card: sourceCard, content } = createCardAndContent(sourceId, 'Morning');
    const { card: targetCard } = createCardAndContent(targetId, 'Morning');
    zone.append(sourceCard, targetCard);
    container.appendChild(zone);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);

    const startEvent = new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 12, buttons: 1 });
    startDragSession(sourceCard, content, startEvent);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 22, clientY: 35, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(reorderHabit).toHaveBeenCalledTimes(1);
    expect(reorderHabit).toHaveBeenCalledWith(sourceId, targetId, 'after');
    expect(handleHabitDrop).not.toHaveBeenCalled();
  });

  it('bloqueia drop invalido quando habito ja existe no horario de destino', () => {
    const habitId = createTestHabit({ name: 'Duplicado', time: 'Morning' });
    vi.mocked(getEffectiveScheduleForHabitOnDate).mockReturnValue(['Morning', 'Afternoon']);

    const container = document.createElement('section');
    document.body.appendChild(container);
    setupDragHandler(container);

    const sourceZone = document.createElement('div');
    sourceZone.className = 'drop-zone';
    sourceZone.dataset.time = 'Morning';

    const targetZone = document.createElement('div');
    targetZone.className = 'drop-zone';
    targetZone.dataset.time = 'Afternoon';

    const { card, content } = createCardAndContent(habitId, 'Morning');
    sourceZone.appendChild(card);
    container.append(sourceZone, targetZone);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(targetZone);

    const startEvent = new PointerEvent('pointerdown', { clientX: 8, clientY: 8, pointerId: 13, buttons: 1 });
    startDragSession(card, content, startEvent);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 28, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(handleHabitDrop).not.toHaveBeenCalled();
    expect(reorderHabit).not.toHaveBeenCalled();
  });
});
