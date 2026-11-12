/**
 * @file listeners/swipe.test.ts
 * @description Cobertura basica de gestos do swipe handler (swipe horizontal e long press).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupSwipeHandler } from './swipe';

const dragMocks = vi.hoisted(() => ({
  startDragSession: vi.fn(),
  isDragging: vi.fn(() => false),
}));

vi.mock('./drag', () => ({
  startDragSession: dragMocks.startDragSession,
  isDragging: dragMocks.isDragging,
}));

vi.mock('../render', () => ({
  renderApp: vi.fn(),
}));

function makeCard() {
  const card = document.createElement('article');
  card.className = 'habit-card';
  // Como o cartão real: é `data-habit-id` que autoriza o long press de reordenar.
  card.dataset.habitId = 'h1';
  card.dataset.time = 'Morning';

  const content = document.createElement('div');
  content.className = 'habit-content-wrapper';
  card.appendChild(content);

  return { card, content };
}

/** Linha de objetivo secundário: mesmo gesto de swipe, sem reordenação. */
function makeQuestRow() {
  const row = document.createElement('li');
  row.className = 'quest-row';

  const content = document.createElement('div');
  content.className = 'quest-content-wrapper';
  row.appendChild(content);

  return { card: row, content };
}

describe('listeners/swipe.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('abre swipe para esquerda em gesto horizontal para direita', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);

    const { card, content } = makeCard();
    container.appendChild(card);

    setupSwipeHandler(container);

    content.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    }));

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      buttons: 1,
      clientX: 160,
      clientY: 12,
    }));

    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      clientX: 160,
      clientY: 12,
    }));

    expect(card.classList.contains('is-open-left')).toBe(true);
    expect(dragMocks.startDragSession).not.toHaveBeenCalled();
  });

  it('nao abre swipe em movimento predominantemente vertical', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);

    const { card, content } = makeCard();
    container.appendChild(card);

    setupSwipeHandler(container);

    content.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
    }));

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 2,
      buttons: 1,
      clientX: 20,
      clientY: 120,
    }));

    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 2,
      clientX: 20,
      clientY: 120,
    }));

    expect(card.classList.contains('is-open-left')).toBe(false);
    expect(card.classList.contains('is-open-right')).toBe(false);
    expect(dragMocks.startDragSession).not.toHaveBeenCalled();
  });

  it('dispara long press e inicia drag apos delay', () => {
    vi.useFakeTimers();

    const container = document.createElement('section');
    document.body.appendChild(container);

    const { card, content } = makeCard();
    // jsdom não implementa setPointerCapture — stub necessário para o fluxo de drag
    card.setPointerCapture = vi.fn();
    container.appendChild(card);

    setupSwipeHandler(container);

    content.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 3,
      clientX: 30,
      clientY: 30,
    }));

    vi.advanceTimersByTime(520);

    expect(dragMocks.startDragSession).toHaveBeenCalledTimes(1);
  });

  it('abre swipe no objetivo secundário, sem armar o long press', () => {
    // O objetivo não tem posição na grade, e `startDragSession` desistiria — mas
    // só depois de vibrar e prender o scroll do contêiner, que ninguém soltaria.
    vi.useFakeTimers();

    const container = document.createElement('section');
    document.body.appendChild(container);

    const { card, content } = makeQuestRow();
    card.setPointerCapture = vi.fn();
    container.appendChild(card);

    setupSwipeHandler(container);

    content.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 7, clientX: 40, clientY: 40,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 7, clientX: 80, clientY: 40,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, clientX: 80, clientY: 40,
    }));

    expect(card.classList.contains('is-open-left')).toBe(true);

    vi.advanceTimersByTime(520);
    expect(dragMocks.startDragSession).not.toHaveBeenCalled();
    expect(card.classList.contains('is-charging')).toBe(false);
  });
});
