/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file index.tsx
 * @description Bootstrapper e Orquestrador de Ciclo de Vida da Aplicação.
 */

import './css/variables.css';
import './css/base.css';
import './css/layout.css';
import './css/header.css';
import './css/components.css';
import './css/calendar.css';
import './css/habits.css';
import './css/progression.css';
import './css/forms.css';
import './css/modals.css';

import { state } from './state';
import { loadState, registerSyncHandler, saveState, setupPersistenceLifecycleFlush } from './services/persistence';
import { renderApp, initI18n, updateUIText, showConfirmationModal } from './render';
import { setupEventListeners } from './listeners';
import { handleDayTransition, performArchivalCheck } from './services/habitActions';
import { initSync } from './listeners/sync';
import { fetchStateFromCloud, syncStateWithCloud } from './services/cloud';
import { hasLocalSyncKey, initAuth } from './services/api';
import { updateAppBadge } from './services/badge';
import { setupMidnightLoop, logger } from './utils';
import { getLocalPushOptIn, ensurePushSubscribed, getNotificationPermission } from './services/push';
import { BOOT_RELOAD_DELAY_MS, BOOT_SYNC_TIMEOUT_MS } from './constants';
import { t } from './i18n';

// --- AUTO-HEALING & INTEGRITY CHECK ---
const BOOT_ATTEMPTS_KEY = 'askesis_boot_attempts';
const MAX_BOOT_ATTEMPTS = 3;

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let browserSupportsNativeInstallPrompt = false;

function checkIntegrityAndHeal() {
    const attempts = parseInt(sessionStorage.getItem(BOOT_ATTEMPTS_KEY) || '0', 10);
    if (attempts >= MAX_BOOT_ATTEMPTS) {
        logger.warn('🚨 Detected boot loop. Initiating Auto-Healing...');
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for (const registration of registrations) { registration.unregister(); }
            });
        }
        if ('caches' in window) {
            caches.keys().then(names => { for (const name of names) { caches.delete(name); } });
        }
        sessionStorage.removeItem(BOOT_ATTEMPTS_KEY);
        setTimeout(() => window.location.reload(), BOOT_RELOAD_DELAY_MS);
        return false;
    }
    sessionStorage.setItem(BOOT_ATTEMPTS_KEY, (attempts + 1).toString());
    return true;
}

function isRunningAsInstalledPwa(): boolean {
    const standaloneDisplay = window.matchMedia?.('(display-mode: standalone)')?.matches === true;
    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return standaloneDisplay || iosStandalone;
}

function setupInstallPromptCapture() {
    window.addEventListener('beforeinstallprompt', (event) => {
        // Do not cancel default behavior: compatible browsers can keep their native install recommendation flow.
        browserSupportsNativeInstallPrompt = true;
        deferredInstallPrompt = event as BeforeInstallPromptEvent;
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
    });
}

function renderCriticalBootError(loader: HTMLElement) {
    const wrapper = document.createElement('div');
    wrapper.style.color = '#ff6b6b';
    wrapper.style.padding = '2rem';
    wrapper.style.textAlign = 'center';

    const title = document.createElement('h3');
    title.textContent = 'Falha Crítica';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Tentar Novamente';
    retryButton.addEventListener('click', () => window.location.reload());

    wrapper.append(title, retryButton);
    loader.replaceChildren(wrapper);
}

function recommendInstallForNewUsers(isFirstTimeUser: boolean) {
    if (!isFirstTimeUser) return;
    if (isRunningAsInstalledPwa()) return;

    const isSafariFamily = (() => {
        const ua = window.navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/.test(ua)
            || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
        const isSafariDesktop = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
        return isIOS || isSafariDesktop;
    })();

    const openManualInstallHelp = () => {
        showConfirmationModal(
            t('installPromptFallbackBody'),
            () => {},
            {
                title: t('installPromptFallbackTitle'),
                confirmText: t('closeButton'),
                hideCancel: true
            }
        );
    };

    // Safari/iOS does not provide beforeinstallprompt. Show direct guidance for manual A2HS install.
    if (isSafariFamily && !browserSupportsNativeInstallPrompt) {
        openManualInstallHelp();
        return;
    }

    // If the browser can recommend install natively, do not compete with that UX.
    if (browserSupportsNativeInstallPrompt) return;

    // In non-Safari browsers, avoid manual fallback here: native recommendation can appear later.
    if (!deferredInstallPrompt) return;

    showConfirmationModal(
        t('installPromptBody'),
        async () => {
            const promptEvent = deferredInstallPrompt;
            if (!promptEvent) return;

            try {
                await promptEvent.prompt();
                await promptEvent.userChoice;
                deferredInstallPrompt = null;
            } catch (error) {
                logger.warn('Install prompt failed', error);
            }
        },
        {
            title: t('installPromptTitle'),
            confirmText: t('installPromptConfirm'),
            cancelText: t('installPromptLater')
        }
    );
}

let isInitializing = false;
let isInitialized = false;

const registerServiceWorker = () => {
    if ('serviceWorker' in navigator && !window.location.protocol.startsWith('file')) {
        const loadSW = () => {
            // Offline/cache (escopo `/`). Push: OneSignalSDKWorker.js em /onesignal/.
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    logger.info('Service Worker registered with scope:', registration.scope);
                })
                .catch(err => {
                    logger.warn('Service worker registration failed:', err);
                });
        };

        if (document.readyState === 'complete') loadSW();
        else window.addEventListener('load', loadSW);
    }
};

async function loadInitialState() {
    // 1. CARREGAMENTO IMEDIATO (Local-First)
    await loadState();

    // 2. SINCRONIZAÇÃO PROATIVA (Background/Decisiva)
    if (hasLocalSyncKey()) {
        // Trava visual de boot: Bloqueia interações até o sync terminar ou dar timeout
        document.body.classList.add('is-booting');
        
        // Timeout de segurança para destravar a UI se a nuvem demorar demais
        const syncPromise = fetchStateFromCloud();
        const timeoutPromise = new Promise<void>((resolve) => 
            setTimeout(() => {
                if (!state.initialSyncDone) {
                    logger.warn('Boot sync timeout. Unlocking UI.');
                    state.initialSyncDone = true; // Força desbloqueio lógico
                    resolve();
                }
            }, BOOT_SYNC_TIMEOUT_MS)
        );

        Promise.race([syncPromise, timeoutPromise])
            .finally(() => {
                document.body.classList.remove('is-booting');
            });
            
    } else {
        state.initialSyncDone = true;
    }
}

function handleFirstTimeUser() {
    if (!state.hasOnboarded) {
        state.hasOnboarded = true;
        // Imediato: cria o store IDB na 1ª abertura (sem esperar debounce).
        saveState(true);
    }
}

function setupAppListeners() {
    setupEventListeners();
    initSync();
    // Arrow function: evita que o Event seja passado como options de updateAppBadge.
    document.addEventListener('habitsChanged', () => { updateAppBadge().catch(() => {}); });
    setupMidnightLoop();
    document.addEventListener('dayChanged', handleDayTransition);
    // Virada de dia: as pendências mudam sem passar por habitsChanged.
    document.addEventListener('dayChanged', () => { updateAppBadge().catch(() => {}); });
    registerSyncHandler(syncStateWithCloud);
}

function finalizeInit(loader: HTMLElement | null) {
    sessionStorage.removeItem(BOOT_ATTEMPTS_KEY);
    if (loader) {
        loader.classList.add('hidden');
        const cleanup = () => {
            loader.remove();
            document.getElementById('initial-loader-container')?.remove();
        };
        const timer = setTimeout(cleanup, 400); 
        loader.addEventListener('transitionend', () => { clearTimeout(timer); cleanup(); }, { once: true });
    }
    const runBackgroundTasks = () => {
        performArchivalCheck();

        // Re-inscreve push se o usuário já optou (sem prompt nativo — fora de gesto).
        const permission = getNotificationPermission();
        if (getLocalPushOptIn() === true && permission === 'granted') {
            ensurePushSubscribed().catch((err) => logger.warn('Boot push resubscribe failed', err));
        }
    };
    if (window.scheduler?.postTask) {
        window.scheduler.postTask(runBackgroundTasks, { priority: 'background' });
    } else {
        (window.requestIdleCallback || ((cb) => setTimeout(cb, 1000)))(runBackgroundTasks);
    }
}

async function init(loader: HTMLElement | null) {
    if (isInitializing || isInitialized) return;
    isInitializing = true;

    if (window.bootWatchdog) {
        clearTimeout(window.bootWatchdog);
        window.bootWatchdog = undefined;
    }

    await initAuth();
    
    // `updateUIText` NÃO entra aqui: os argumentos de um `Promise.all` são
    // avaliados antes da chamada, então ele rodaria síncrono com o dicionário
    // ainda vazio e gravaria as chaves cruas em ~46 nós. Quem o chama com a
    // tradução pronta é o próprio `initI18n`, pelo evento `languageChanged`.
    await initI18n();

    await loadInitialState();
    const isFirstTimeUser = !state.hasOnboarded;

    // Flush de saves debounced ao fechar/background (1ª sessão pós-install).
    setupPersistenceLifecycleFlush();
    setupAppListeners();
    handleFirstTimeUser();
    renderApp(); 
    setTimeout(() => recommendInstallForNewUsers(isFirstTimeUser), 1200);
    
    updateAppBadge();
    finalizeInit(loader);
    
    isInitialized = true;
    isInitializing = false;
}

const startApp = () => {
    if (!checkIntegrityAndHeal()) return;
    setupInstallPromptCapture();
    registerServiceWorker();
    if (isInitializing || isInitialized) return;
    const loader = document.getElementById('initial-loader');
    init(loader).catch(err => {
        logger.error('Boot failed', err);
        isInitializing = false;
        if (window.showFatalError) {
            window.showFatalError("Erro na inicialização: " + (err.message || err));
        } else if(loader && loader.isConnected) {
            renderCriticalBootError(loader);
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
