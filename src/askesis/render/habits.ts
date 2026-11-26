
/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file render/habits.ts
 * @description Motor de Renderização de Cartões de Hábito (Virtual DOM-lite).
 */

import { state, Habit, HabitDayData, STREAK_CONSOLIDATED, STREAK_SEMI_CONSOLIDATED, TimeOfDay, getHabitDailyInfoForDate, TIMES_OF_DAY, HabitDailyInfo, HABIT_STATE } from '../state';
import { calculateHabitStreak, getActiveHabitsForDate, getSmartGoalForHabit, getHabitDisplayInfo, getHabitPropertiesForDate } from '../services/selectors';
import { ui } from './ui';
import { t, formatInteger } from '../i18n';
import { UI_ICONS, getTimeOfDayIcon, sanitizeHabitIcon } from './icons';
import { setTextContent, setTrustedHtmlFragment } from './dom';
import { CSS_CLASSES, DOM_SELECTORS } from './constants';
import { parseUTCIsoDate } from '../utils';
import { HabitService } from '../services/HabitService';

const habitElementCache = new Map<string, HTMLElement>();
const habitsByTimePool: Record<TimeOfDay, Habit[]> = { 'Morning': [], 'Afternoon': [], 'Evening': [] };
const groupDomCache = new Map<TimeOfDay, { wrapper: HTMLElement; group: HTMLElement; marker: HTMLElement }>();

type CardElements = {
    icon: HTMLElement; contentWrapper: HTMLElement; name: HTMLElement; subtitle: HTMLElement;
    details: HTMLElement; consolidationMsg: HTMLElement; noteBtn: HTMLElement; deleteBtn: HTMLElement;
    goal: HTMLElement; goalProgress?: HTMLElement; goalUnit?: HTMLElement;
    goalDecBtn?: HTMLButtonElement; goalIncBtn?: HTMLButtonElement; cachedIconHtml?: string;
};
const cardElementsCache = new WeakMap<HTMLElement, CardElements>();

function replaceWithHtmlFragment(target: HTMLElement, html: string) {
    // Use centralized sanitizer and fragment creator to avoid unsafe insertion.
    setTrustedHtmlFragment(target, html);
}

function getGroupDOM(time: TimeOfDay) {
    let cached = groupDomCache.get(time);
    if (!cached && ui.habitContainer) {
        const wrapper = ui.habitContainer.querySelector<HTMLElement>(`.habit-group-wrapper[data-time-wrapper="${time}"]`);
        const group = wrapper?.querySelector<HTMLElement>(`.${CSS_CLASSES.HABIT_GROUP}[data-time="${time}"]`);
        const marker = wrapper?.querySelector<HTMLElement>('.time-marker');
        if (wrapper && group && marker) {
            cached = { wrapper, group, marker };
            groupDomCache.set(time, cached);
        }
    }
    return cached;
}

// TEMPLATES
let goalControlsTemplate: HTMLElement | null = null;
const statusTemplates: Record<string, HTMLElement> = {};
let habitCardTemplate: HTMLElement | null = null;
let placeholderTemplate: HTMLElement | null = null;

const getGoalControlsTemplate = () => goalControlsTemplate || (goalControlsTemplate = (() => {
    const div = document.createElement('div');
    div.className = CSS_CLASSES.HABIT_GOAL_CONTROLS;

    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = CSS_CLASSES.GOAL_CONTROL_BTN;
    decBtn.dataset.action = 'decrement';
    decBtn.textContent = '-';

    const wrapper = document.createElement('div');
    wrapper.className = CSS_CLASSES.GOAL_VALUE_WRAPPER;

    const progress = document.createElement('div');
    progress.className = 'progress';
    const unit = document.createElement('div');
    unit.className = 'unit';
    wrapper.append(progress, unit);

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = CSS_CLASSES.GOAL_CONTROL_BTN;
    incBtn.dataset.action = 'increment';
    incBtn.textContent = '+';

    div.append(decBtn, wrapper, incBtn);
    return div;
})());

const getStatusWrapperTemplate = (cls: string, icon: string) => statusTemplates[cls] || (statusTemplates[cls] = (() => {
    const w = document.createElement('div');
    w.className = cls;
    replaceWithHtmlFragment(w, icon);
    return w;
})());

const getPlaceholderTemplate = () => placeholderTemplate || (placeholderTemplate = (() => {
    const p = document.createElement('div'); p.className = CSS_CLASSES.EMPTY_GROUP_PLACEHOLDER;
    p.setAttribute('role', 'button'); p.setAttribute('tabindex', '0'); return p;
})());

const getHabitCardTemplate = () => habitCardTemplate || (habitCardTemplate = (() => {
    const li = document.createElement('li');
    li.className = CSS_CLASSES.HABIT_CARD;

    const leftActions = document.createElement('div');
    leftActions.className = 'habit-actions-left';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = CSS_CLASSES.SWIPE_DELETE_BTN;
    replaceWithHtmlFragment(deleteBtn, UI_ICONS.swipeDelete);
    leftActions.appendChild(deleteBtn);

    const rightActions = document.createElement('div');
    rightActions.className = 'habit-actions-right';
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = CSS_CLASSES.SWIPE_NOTE_BTN;
    replaceWithHtmlFragment(noteBtn, UI_ICONS.swipeNote);
    rightActions.appendChild(noteBtn);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = CSS_CLASSES.HABIT_CONTENT_WRAPPER;
    contentWrapper.setAttribute('role', 'button');
    contentWrapper.setAttribute('tabindex', '0');

    const icon = document.createElement('div');
    icon.className = 'habit-icon';

    const details = document.createElement('div');
    details.className = CSS_CLASSES.HABIT_DETAILS;

    const name = document.createElement('div');
    name.className = 'name';
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    const consolidation = document.createElement('div');
    consolidation.className = 'consolidation-message';
    consolidation.hidden = true;
    details.append(name, subtitle, consolidation);

    const goal = document.createElement('div');
    goal.className = 'habit-goal';

    const ripple = document.createElement('div');
    ripple.className = 'ripple-container';

    contentWrapper.append(icon, details, goal, ripple);
    li.append(leftActions, rightActions, contentWrapper);
    return li;
})());

// Otimiza a criação de chaves de cache para evitar repetição de string literal.
const _getCacheKey = (habitId: string, time: TimeOfDay): string => `${habitId}|${time}`;

export const clearHabitDomCache = () => habitElementCache.clear();
export const getCachedHabitCard = (id: string, t: TimeOfDay) => habitElementCache.get(_getCacheKey(id, t));

function hasSameChildOrder(parent: HTMLElement, nextChildren: readonly HTMLElement[]): boolean {
    const currentChildren = parent.children;
    if (currentChildren.length !== nextChildren.length) return false;

    for (let i = 0; i < nextChildren.length; i++) {
        if (currentChildren[i] !== nextChildren[i]) return false;
    }

    return true;
}

function _renderPendingGoalControls(habit: Habit, time: TimeOfDay, dayData: HabitDayData | undefined, els: CardElements) {
    const schedule = getHabitPropertiesForDate(habit, state.selectedDate);
    if (!schedule) { if (els.goal.hasChildNodes()) els.goal.replaceChildren(); return; }

    if (schedule.goal.type === 'check') { if (els.goal.hasChildNodes()) els.goal.replaceChildren(); return; }
    
    // 1. Ensure Container Exists
    let controls = els.goal.querySelector(`.${CSS_CLASSES.HABIT_GOAL_CONTROLS}`);
    if (!controls) {
        els.goal.replaceChildren(getGoalControlsTemplate().cloneNode(true));
        controls = els.goal.firstElementChild;
        // Reset cache references as they are invalid now
        els.goalDecBtn = els.goalIncBtn = els.goalProgress = els.goalUnit = undefined;
    }

    // 2. Ensure Inner Elements Integrity (Self-Healing DOM)
    // Se o usuário usou o Direct Input, o conteúdo do wrapper foi substituído por um <input>.
    // Precisamos restaurar a estrutura <div>.progress</div> se ela não existir.
    const wrapper = controls!.querySelector(`.${CSS_CLASSES.GOAL_VALUE_WRAPPER}`) as HTMLElement;
    const progressEl = wrapper.querySelector('.progress');
    
    if (!progressEl) {
        // ROBUSTNESS: Restaura estrutura destruída
        const restoredProgress = document.createElement('div');
        restoredProgress.className = 'progress';
        const restoredUnit = document.createElement('div');
        restoredUnit.className = 'unit';
        wrapper.replaceChildren(restoredProgress, restoredUnit);
        els.goalProgress = wrapper.querySelector('.progress') as HTMLElement;
        els.goalUnit = wrapper.querySelector('.unit') as HTMLElement;
    } else if (!els.goalProgress || !els.goalProgress.isConnected) {
        // Re-bind se o cache estiver estragado
        els.goalProgress = progressEl as HTMLElement;
        els.goalUnit = wrapper.querySelector('.unit') as HTMLElement;
    }

    // 3. Ensure Buttons
    if (!els.goalDecBtn || !els.goalDecBtn.isConnected) els.goalDecBtn = controls!.querySelector(`[data-action="decrement"]`) as HTMLButtonElement;
    if (!els.goalIncBtn || !els.goalIncBtn.isConnected) els.goalIncBtn = controls!.querySelector(`[data-action="increment"]`) as HTMLButtonElement;

    // 4. Update Values
    const cur = dayData?.goalOverride ?? getSmartGoalForHabit(habit, state.selectedDate, time);
    if (els.goalDecBtn) els.goalDecBtn.disabled = cur <= 1;
    if (els.goalProgress) setTextContent(els.goalProgress, formatInteger(cur));
    
    if (els.goalUnit) setTextContent(els.goalUnit, t(schedule.goal.unitKey || 'unitCheck', { count: cur }));
}

export function updateHabitCardElement(card: HTMLElement, habit: Habit, time: TimeOfDay, preInfo?: Record<string, HabitDailyInfo>, options?: { animate?: boolean }) {
    const els = cardElementsCache.get(card)!;
    
    // 1. LEITURA DE STATUS VIA BITMASK (Fonte da Verdade)
    const bitStatus = HabitService.getStatus(habit.id, state.selectedDate, time);
    let status: string = CSS_CLASSES.PENDING;
    
    if (bitStatus === HABIT_STATE.DONE || bitStatus === HABIT_STATE.DONE_PLUS) {
        status = CSS_CLASSES.COMPLETED;
    } else if (bitStatus === HABIT_STATE.DEFERRED) {
        status = CSS_CLASSES.SNOOZED;
    }

    // ARETE LOGIC: Exposição de Estado 'Done+' (Superação) no DOM para estilização CSS.
    // Evita Layout Thrashing checando o atributo antes de setar.
    if (bitStatus === HABIT_STATE.DONE_PLUS) {
        if (card.dataset.arete !== 'true') card.dataset.arete = 'true';
    } else {
        if (card.dataset.arete) card.removeAttribute('data-arete');
    }

    // 2. LEITURA DE DADOS RICOS (Legado JSON - Notas/Override)
    // Usado APENAS para metadados, nunca para status de conclusão.
    const info = (preInfo || getHabitDailyInfoForDate(state.selectedDate))[habit.id]?.instances?.[time];
    
    const streak = calculateHabitStreak(habit, state.selectedDate);
    const { name, subtitle } = getHabitDisplayInfo(habit, state.selectedDate);

    if (!card.classList.contains(status)) {
        card.classList.remove(CSS_CLASSES.PENDING, CSS_CLASSES.COMPLETED, CSS_CLASSES.SNOOZED);
        card.classList.add(status);
        if (status === CSS_CLASSES.COMPLETED && options?.animate) {
            els.icon.classList.remove('animate-pop'); void els.icon.offsetWidth; els.icon.classList.add('animate-pop');
        }
    }

    const schedule = getHabitPropertiesForDate(habit, state.selectedDate);
    if (!schedule) return;

    // SECURITY FIX: Only allow known safe habit icons via sanitized fragment
    if (els.cachedIconHtml !== schedule.icon) {
        const safeIcon = sanitizeHabitIcon(schedule.icon, '❓');
        replaceWithHtmlFragment(els.icon, safeIcon);
        els.cachedIconHtml = safeIcon;
    }
    els.icon.style.color = schedule.color;
    // RESTORED [2025-06-15]: Match Explore Modal style (Color + Opacity 30 for background)
    els.icon.style.backgroundColor = schedule.color + '30';
    
    const isCons = streak >= STREAK_CONSOLIDATED, isSemi = streak >= STREAK_SEMI_CONSOLIDATED && !isCons;
    card.classList.toggle('consolidated', isCons); card.classList.toggle('semi-consolidated', isSemi);
    
    setTextContent(els.name, name); setTextContent(els.subtitle, subtitle);
    const msg = isCons ? t('habitConsolidatedMessage') : (isSemi ? t('habitSemiConsolidatedMessage') : '');
    setTextContent(els.consolidationMsg, msg); els.consolidationMsg.hidden = !msg;

    const hasN = !!info?.note;
    if (els.noteBtn.dataset.hasNote !== String(hasN)) {
        replaceWithHtmlFragment(els.noteBtn, hasN ? UI_ICONS.swipeNoteHasNote : UI_ICONS.swipeNote);
        els.noteBtn.dataset.hasNote = String(hasN);
    }

    if (status === CSS_CLASSES.COMPLETED) els.goal.replaceChildren(getStatusWrapperTemplate('completed-wrapper', UI_ICONS.check).cloneNode(true));
    else if (status === CSS_CLASSES.SNOOZED) els.goal.replaceChildren(getStatusWrapperTemplate('snoozed-wrapper', UI_ICONS.snoozed).cloneNode(true));
    else _renderPendingGoalControls(habit, time, info, els);
}

function createHabitCardElement(habit: Habit, time: TimeOfDay, preInfo?: Record<string, HabitDailyInfo>): HTMLElement {
    const card = getHabitCardTemplate().cloneNode(true) as HTMLElement;
    card.dataset.habitId = habit.id; card.dataset.time = time;
    const key = _getCacheKey(habit.id, time);
    habitElementCache.set(key, card);

    const al = card.firstElementChild!, ar = al.nextElementSibling!, cw = ar.nextElementSibling!;
    const det = cw.children[1] as HTMLElement, goal = cw.children[2] as HTMLElement;
    cardElementsCache.set(card, {
        icon: cw.children[0] as HTMLElement, contentWrapper: cw as HTMLElement,
        name: det.children[0] as HTMLElement, subtitle: det.children[1] as HTMLElement,
        details: det, consolidationMsg: det.children[2] as HTMLElement,
        noteBtn: ar.firstElementChild as HTMLElement, deleteBtn: al.firstElementChild as HTMLElement, goal
    });
    updateHabitCardElement(card, habit, time, preInfo);
    return card;
}

export function renderHabits() {
    // FIX: INTERACTION LOCK. Adiciona verificação de is-dragging-active.
    // Se o usuário está arrastando (Drag Mode), NÃO podemos re-renderizar a lista, 
    // pois isso destruiria o elemento DOM que está sendo arrastado e que o motor de física segue.
    if (document.body.classList.contains('is-interaction-active') || document.body.classList.contains('is-dragging-active') || !state.uiDirtyState.habitListStructure) return;
    
    const selDate = parseUTCIsoDate(state.selectedDate), dInfo = getHabitDailyInfoForDate(state.selectedDate);
    const active = getActiveHabitsForDate(state.selectedDate, selDate);
    
    TIMES_OF_DAY.forEach(t => habitsByTimePool[t].length = 0);
    for (let i = 0; i < active.length; i++) {
        const { habit, schedule } = active[i];
        for (let j = 0; j < schedule.length; j++) habitsByTimePool[schedule[j]].push(habit);
    }

    const empty = TIMES_OF_DAY.filter(t => habitsByTimePool[t].length === 0);
    const activeKeysThisRender = new Set<string>();

    TIMES_OF_DAY.forEach(time => {
        const dom = getGroupDOM(time); if (!dom) return;
        const habits = habitsByTimePool[time], hasH = habits.length > 0;
        
        dom.marker.style.display = hasH ? '' : 'none';
        if (hasH && dom.marker.dataset.renderedTime !== time) {
            replaceWithHtmlFragment(dom.marker, getTimeOfDayIcon(time));
            dom.marker.dataset.renderedTime = time;
        }

        const newChildren: HTMLElement[] = [];
        if (hasH) {
            for (let i = 0; i < habits.length; i++) {
                const habit = habits[i];
                const key = _getCacheKey(habit.id, time);
                activeKeysThisRender.add(key);

                let card = habitElementCache.get(key);
                if (card) {
                    // FIX: Não remove classes de estado persistente (IS_OPEN_*) ou interação ativa (IS_SWIPING)
                    card.classList.remove(CSS_CLASSES.DRAGGING);
                    updateHabitCardElement(card, habit, time, dInfo);
                } else {
                    card = createHabitCardElement(habit, time, dInfo);
                }
                newChildren.push(card);
            }
        }

        const isSmart = time === empty[0];
        dom.wrapper.classList.toggle('has-habits', hasH);
        dom.wrapper.classList.toggle('is-collapsible', !hasH && !isSmart);

        if (!hasH) {
            let ph = dom.group.querySelector<HTMLElement>(DOM_SELECTORS.EMPTY_GROUP_PLACEHOLDER);
            if (!ph) {
                ph = getPlaceholderTemplate().cloneNode(true) as HTMLElement;
            }
            ph.dataset.time = time;
            ph.classList.toggle('show-smart-placeholder', isSmart);

            const iconRoot = document.createElement('div');
            iconRoot.className = 'time-of-day-icon';

            if (isSmart) {
                const genericSpan = document.createElement('span');
                genericSpan.className = 'placeholder-icon-generic';

                empty.forEach((emptyTime, index) => {
                    const temp = document.createElement('span');
                    replaceWithHtmlFragment(temp, getTimeOfDayIcon(emptyTime));
                    while (temp.firstChild) genericSpan.appendChild(temp.firstChild);

                    if (index < empty.length - 1) {
                        const sep = document.createElement('span');
                        sep.className = 'icon-separator';
                        sep.textContent = '/';
                        genericSpan.appendChild(sep);
                    }
                });

                const specificSpan = document.createElement('span');
                specificSpan.className = 'placeholder-icon-specific';
                replaceWithHtmlFragment(specificSpan, getTimeOfDayIcon(time));

                iconRoot.append(genericSpan, specificSpan);
            } else {
                const specificSpan = document.createElement('span');
                specificSpan.className = 'placeholder-icon-specific';
                replaceWithHtmlFragment(specificSpan, getTimeOfDayIcon(time));
                iconRoot.appendChild(specificSpan);
            }

            const arrow = document.createElement('span');
            arrow.className = 'placeholder-arrow';
            arrow.textContent = '→';

            const label = document.createElement('span');
            label.textContent = t('dragToAddHabit');

            ph.replaceChildren(iconRoot, arrow, label);
            newChildren.push(ph);
        }
        
        if (!hasSameChildOrder(dom.group, newChildren)) {
            dom.group.replaceChildren(...newChildren);
        }
    });

    for (const key of habitElementCache.keys()) {
        if (!activeKeysThisRender.has(key)) {
            habitElementCache.delete(key);
        }
    }

    state.uiDirtyState.habitListStructure = false;
}
