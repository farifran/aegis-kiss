/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file listeners.ts
 * @description Ponto de Entrada para Inicialização de Eventos (Event Bootstrapper).
 */

import { ui } from './render/ui';
import { renderApp, renderAINotificationState, updateNotificationUI, initModalEngine, getCachedHabitCard, updateHabitCardElement, updateDayVisuals } from './render';
import { setupModalListeners } from './listeners/modals';
import { setupCardListeners } from './listeners/cards';
import { setupDragHandler } from './listeners/drag';
import { setupSwipeHandler } from './listeners/swipe';
import { setupCalendarListeners } from './listeners/calendar';
import { setupChartListeners } from './listeners/chart';
import { getTodayUTCIso, resetTodayCache, createDebounced, logger, getLocalPushOptIn, setLocalPushOptIn, hasRequestedPushPermission, getPushPermissionRequestAgeMs, markPushPermissionRequested, ensureOneSignalReady } from './utils';
import { state, getPersistableState, invalidateCachesForDateChange } from './state';
import { pullRemoteChanges, syncStateWithCloud } from './services/cloud';
import { checkAndAnalyzeDayContext } from './services/analysis';
import { NETWORK_DEBOUNCE_MS, INTERACTION_DELAY_MS } from './constants';
import { APP_EVENTS, CARD_EVENTS, emitDayChanged } from './events';

let areListenersAttached = false;
let visibilityRafId: number | null = null;
let isHandlingVisibility = false;
const PUSH_PERMISSION_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const _handleNetworkChange = createDebounced(() => {
    const isOnline = navigator.onLine;
    const wasOffline = document.body.classList.contains('is-offline');
    document.body.classList.toggle('is-offline', !isOnline);
    if (wasOffline === isOnline) renderAINotificationState();
    if (isOnline) {
        logger.info('[Network] Online stable. Pulling remote changes.');
        pullRemoteChanges().catch((error) => {
            logger.warn('[Network] Failed to pull remote changes on reconnect.', error);
        });
    }
}, NETWORK_DEBOUNCE_MS);

const _handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    if (isHandlingVisibility) return;
    isHandlingVisibility = true;

    try {
        _handleNetworkChange();
        const cachedToday = getTodayUTCIso();
        resetTodayCache();
        const realToday = getTodayUTCIso();
        if (cachedToday !== realToday) {
            if (state.selectedDate === cachedToday) state.selectedDate = realToday;
            emitDayChanged();
            isHandlingVisibility = false;
        } else {
            if (visibilityRafId) cancelAnimationFrame(visibilityRafId);
            visibilityRafId = requestAnimationFrame(() => {
                try {
                    renderApp();
                } finally {
                    visibilityRafId = null;
                    isHandlingVisibility = false;
                }
            });
        }
    } catch (e) {
        isHandlingVisibility = false;
        throw e;
    }
};

const _handleServiceWorkerMessage = (event: MessageEvent) => {
    if (event.data && event.data.type === 'REQUEST_SYNC') {
        logger.info('[SW Message] Sincronização solicitada pelo Service Worker.');
        syncStateWithCloud(getPersistableState(), true);
    }
};

const _handleCardUpdate = (e: Event) => {
    const { habitId, time, date } = (e as CustomEvent).detail;
    const habit = state.habits.find(h => h.id === habitId);
    let cardElement = getCachedHabitCard(habitId, time);
    if (!cardElement) cardElement = document.querySelector(`.habit-card[data-habit-id="${habitId}"][data-time="${time}"]`) as HTMLElement;
    if (habit && cardElement) {
        const shouldAnimate = e.type === CARD_EVENTS.statusChanged;
        updateHabitCardElement(cardElement, habit, time, undefined, { animate: shouldAnimate });
    }
    const targetDate = date || state.selectedDate;
    invalidateCachesForDateChange(targetDate);
    updateDayVisuals(targetDate);
};

export function setupEventListeners() {
    if (areListenersAttached) return;
    areListenersAttached = true;

    initModalEngine();
    setupModalListeners();
    setupCardListeners();
    setupCalendarListeners();
    
    // OneSignal é carregado sob demanda (quando o usuário ativa notificações).
    // Ainda assim, atualizamos a UI usando permissões nativas quando o SDK não estiver presente.
    updateNotificationUI();

    // Prompt automático (com user activation): na primeira interação do usuário, se ainda não houve decisão.
    // Isso recupera o comportamento "na primeira abertura" sem carregar SDKs no boot.
    const maybeRequestPushPermission = async () => {
        try {
            if (typeof Notification === 'undefined') return;

            const permission = (Notification as any).permission || 'default';
            if (permission !== 'default') return;
            if (getLocalPushOptIn() !== null) return;
            if (hasRequestedPushPermission()) {
                const ageMs = getPushPermissionRequestAgeMs();
                if (ageMs !== null && ageMs < PUSH_PERMISSION_RETRY_COOLDOWN_MS) return;
            }

            markPushPermissionRequested();
            const perm = (Notification as any).requestPermission ? await (Notification as any).requestPermission() : 'default';
            if (perm === 'granted') {
                setLocalPushOptIn(true);
                updateNotificationUI();
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('./sw.js?push=1').catch(() => {});
                }
                ensureOneSignalReady()
                    .then((OneSignal) => OneSignal.Notifications.requestPermission?.().catch(() => {}))
                    .catch(() => {});
            } else if (perm === 'denied') {
                setLocalPushOptIn(false);
                updateNotificationUI();
            } else {
                // User dismissed/ignored the browser prompt. Keep undecided state for future retries.
                updateNotificationUI();
            }
        } catch {}
    };

    const oneShot = () => {
        window.removeEventListener('pointerdown', oneShot, true);
        window.removeEventListener('keydown', oneShot, true);
        maybeRequestPushPermission();
    };
    window.addEventListener('pointerdown', oneShot, true);
    window.addEventListener('keydown', oneShot, true);

    document.addEventListener(APP_EVENTS.renderApp, renderApp);
    document.addEventListener(APP_EVENTS.requestAnalysis, (e: Event) => {
        const ce = e as CustomEvent;
        if (ce.detail?.date) checkAndAnalyzeDayContext(ce.detail.date);
    });

    document.addEventListener(CARD_EVENTS.statusChanged, _handleCardUpdate);
    document.addEventListener(CARD_EVENTS.goalChanged, _handleCardUpdate);

    window.addEventListener('online', _handleNetworkChange);
    window.addEventListener('offline', _handleNetworkChange);
    document.addEventListener('visibilitychange', _handleVisibilityChange);
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', _handleServiceWorkerMessage);
    }

    document.body.classList.toggle('is-offline', !navigator.onLine);

    const setupHeavyInteractions = () => {
        try {
            const container = ui.habitContainer;
            setupDragHandler(container);
            setupSwipeHandler(container);
            setupChartListeners();
        } catch (e) {}
    };

    if ('scheduler' in window && (window as any).scheduler) {
        (window as any).scheduler.postTask(setupHeavyInteractions, { priority: 'user-visible' });
    } else {
        setTimeout(setupHeavyInteractions, INTERACTION_DELAY_MS);
    }
}
