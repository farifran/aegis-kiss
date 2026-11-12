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
import { setupOverscroll } from './listeners/overscroll';
import { setupCalendarListeners } from './listeners/calendar';
import { setupProgressionListeners } from './listeners/progression';
import { updateAppBadge } from './services/badge';
import { getTodayUTCIso, resetTodayCache, createDebounced, logger } from './utils';
import { getLocalPushOptIn, setLocalPushOptIn, hasRequestedPushPermission, getPushPermissionRequestAgeMs, markPushPermissionRequested, ensurePushSubscribed, getNotificationPermission, requestNotificationPermission } from './services/push';
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
    // Sincroniza o badge nas duas direções: cobre a volta ao app depois de o dia
    // ter virado em segundo plano, quando as pendências mudam sozinhas.
    updateAppBadge().catch(() => {});

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
    const targetDate = date || state.selectedDate;
    invalidateCachesForDateChange(targetDate);
    const habit = state.habits.find(h => h.id === habitId);
    let cardElement = getCachedHabitCard(habitId, time);
    if (!cardElement) cardElement = document.querySelector(`.habit-card[data-habit-id="${habitId}"][data-time="${time}"]`) as HTMLElement;
    if (habit && cardElement) {
        const shouldAnimate = e.type === CARD_EVENTS.statusChanged;
        updateHabitCardElement(cardElement, habit, time, undefined, { animate: shouldAnimate });
    }
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
            const permission = getNotificationPermission();
            if (permission !== 'default') return;
            if (getLocalPushOptIn() !== null) return;
            if (hasRequestedPushPermission()) {
                const ageMs = getPushPermissionRequestAgeMs();
                if (ageMs !== null && ageMs < PUSH_PERMISSION_RETRY_COOLDOWN_MS) return;
            }

            markPushPermissionRequested();
            const perm = await requestNotificationPermission();
            if (perm === 'granted') {
                setLocalPushOptIn(true);
                updateNotificationUI();
                ensurePushSubscribed()
                    .then(() => updateNotificationUI())
                    .catch((err) => {
                        logger.error('Auto push subscribe failed', err);
                        updateNotificationUI();
                    });
            } else if (perm === 'denied') {
                setLocalPushOptIn(false);
                updateNotificationUI();
            } else {
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

    // Attach lightweight overscroll handler early to avoid first-interaction lag.
    try {
        const earlyContainer = ui.habitContainer;
        if (earlyContainer) setupOverscroll(earlyContainer);
    } catch (err) {
        // If DOM not ready yet, fallback to next frame.
        requestAnimationFrame(() => {
            try {
                const c = ui.habitContainer;
                if (c) setupOverscroll(c);
            } catch (_) {}
        });
    }

    const setupHeavyInteractions = () => {
        try {
            const container = ui.habitContainer;
            setupDragHandler(container);
            setupSwipeHandler(container);
            setupOverscroll(container);
            setupProgressionListeners();
        } catch (e) {}
    };

    if (window.scheduler?.postTask) {
        window.scheduler.postTask(setupHeavyInteractions, { priority: 'user-visible' });
    } else {
        setTimeout(setupHeavyInteractions, INTERACTION_DELAY_MS);
    }
}
