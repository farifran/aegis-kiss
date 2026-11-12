/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file services/push.ts
 * @description Web push via OneSignal: permissão nativa, opt-in local e SDK.
 *
 * Arquitetura estável:
 *  - Offline: sw.js (escopo `/`)
 *  - Push: OneSignalSDKWorker.js na raiz, escopo `/onesignal/` (não compete com offline)
 *  - CSP DEVE permitir script de https://api.onesignal.com (JSONP do init)
 *
 * Fluxo de opt-in (simples, o que já funcionava no produto):
 *  1) permissão nativa no gesto (iOS)
 *  2) setLocalPushOptIn(true) imediatamente
 *  3) init + requestPermission + optIn em background
 */

import { logger } from '../utils';

const SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
const APP_ID = 'd69cf0b6-bc03-4375-b3b7-dd7b37e05a17';
const SAFARI_WEB_ID = 'web.onesignal.auto.2465995d-af39-44d0-9727-0f4afeb298e1';
const OPTIN_STORAGE_KEY = 'askesis_onesignal_opted_in';
const PERMISSION_REQUESTED_KEY = 'askesis_push_permission_requested';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- INTENÇÃO LOCAL DO USUÁRIO (localStorage) ---

export function getLocalPushOptIn(): boolean | null {
    try {
        const raw = localStorage.getItem(OPTIN_STORAGE_KEY);
        return raw === '1' ? true : raw === '0' ? false : null;
    } catch {
        return null;
    }
}

export function setLocalPushOptIn(value: boolean) {
    try {
        localStorage.setItem(OPTIN_STORAGE_KEY, value ? '1' : '0');
    } catch {}
}

export function hasRequestedPushPermission(): boolean {
    try {
        return localStorage.getItem(PERMISSION_REQUESTED_KEY) !== null;
    } catch {
        return false;
    }
}

/** `Infinity` para marcas do formato antigo (`'1'`), que não guardavam timestamp. */
export function getPushPermissionRequestAgeMs(): number | null {
    try {
        const raw = localStorage.getItem(PERMISSION_REQUESTED_KEY);
        if (!raw) return null;
        const ts = Number(raw);
        if (raw === '1' || !Number.isFinite(ts) || ts <= 0) return Number.POSITIVE_INFINITY;
        return Math.max(0, Date.now() - ts);
    } catch {
        return null;
    }
}

export function markPushPermissionRequested() {
    try {
        localStorage.setItem(PERMISSION_REQUESTED_KEY, String(Date.now()));
    } catch {}
}

// --- PERMISSÃO NATIVA ---

export function getNotificationPermission(): NotificationPermission {
    try {
        if (typeof Notification === 'undefined') return 'default';
        return Notification.permission ?? 'default';
    } catch {
        return 'default';
    }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
    try {
        if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') return 'default';
        return await Notification.requestPermission();
    } catch {
        return 'default';
    }
}

// --- SDK ONESIGNAL ---

let _initPromise: Promise<OneSignalLike> | null = null;

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const fail = () => reject(new Error(`Failed to load ${src}`));
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing) {
            if ((existing as any)._loaded) return resolve();
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', fail, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.async = true;
        script.src = src;
        script.addEventListener('load', () => { (script as any)._loaded = true; resolve(); }, { once: true });
        script.addEventListener('error', fail, { once: true });
        document.head.appendChild(script);
    });
}

/** Roda callback se o SDK já estiver no window (sem lazy-load). */
export function pushToOneSignal(callback: (oneSignal: OneSignalLike) => void) {
    if (typeof window === 'undefined' || !window.OneSignal) return;
    callback(window.OneSignal);
}

/**
 * Força a checagem de atualização do worker de push.
 *
 * POR QUE É PRECISO PEDIR EXPLICITAMENTE:
 * O navegador revalida um service worker quando o usuário navega para uma
 * página SOB O ESCOPO dele. O worker de push vive em `/onesignal/`, onde não
 * existe página alguma — abrir o app (`/`) atualiza o `sw.js`, nunca este.
 * Sem isto, ele só seria revalidado num evento `push` depois de 24h, e uma
 * correção no lembrete levaria um dia para chegar ao aparelho.
 *
 * Falha em silêncio de propósito: é manutenção de fundo, não fluxo do usuário.
 */
async function refreshPushWorker(): Promise<void> {
    try {
        if (!('serviceWorker' in navigator)) return;
        const registration = await navigator.serviceWorker.getRegistration('/onesignal/');
        await registration?.update();
    } catch (error) {
        logger.warn('[Push] Falha ao checar atualização do worker de push.', error);
    }
}

/** Carrega o page.js, espera o es6 (init real) e roda OneSignal.init uma vez. */
export async function ensureOneSignalReady(): Promise<OneSignalLike> {
    if (typeof window === 'undefined') throw new Error('OneSignal unavailable');
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        window.OneSignalDeferred ??= [];

        const ready = new Promise<OneSignalLike>((resolve, reject) => {
            window.OneSignalDeferred!.push(async (OneSignal) => {
                try {
                    await OneSignal.init({
                        appId: APP_ID,
                        safari_web_id: SAFARI_WEB_ID,
                        allowLocalhostAsSecureOrigin: true,
                        autoResubscribe: true,
                        // Isola o worker de push do sw.js offline (escopo `/`).
                        serviceWorkerPath: 'OneSignalSDKWorker.js',
                        serviceWorkerParam: { scope: '/onesignal/' },
                    });
                    void refreshPushWorker();
                    resolve(OneSignal);
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    // Re-init na mesma página: devolve a instância já pronta.
                    if (/already initialized/i.test(msg) && window.OneSignal) resolve(window.OneSignal);
                    else reject(e);
                }
            });
        });

        await loadScript(SDK_URL);

        // page.js só enfileira o es6; sem esta espera o init pode nunca rodar a tempo.
        const deadline = Date.now() + 15000;
        while (typeof window.OneSignal?.init !== 'function' && Date.now() < deadline) await sleep(40);
        if (!window.OneSignal) throw new Error('OneSignal SDK load timeout');

        return await Promise.race([
            ready,
            sleep(20000).then<never>(() => { throw new Error('OneSignal init timeout'); }),
        ]);
    })().catch((e) => {
        _initPromise = null;
        throw e;
    });

    return _initPromise;
}

/**
 * Finaliza inscrição no OneSignal (requestPermission + optIn).
 * Em caso de permissão já granted, mantém intenção local mesmo se o SDK
 * demorar a reportar optedIn (evita toggle “morto” e mensagem de reiniciar).
 */
export async function ensurePushSubscribed(): Promise<{ optedIn: boolean; subscriptionId?: string | null }> {
    const OneSignal = await ensureOneSignalReady();
    const subscription = OneSignal.User.PushSubscription;

    try {
        await OneSignal.Notifications.requestPermission();
    } catch (err) {
        logger.error('OneSignal requestPermission failed', err);
    }

    try {
        // Necessário no Chromium quando a permissão nativa já foi dada fora do SDK.
        if (typeof subscription.optIn === 'function') await subscription.optIn();
    } catch (err) {
        logger.error('OneSignal optIn failed', err);
    }

    for (let i = 0; i < 15 && !subscription.optedIn; i++) await sleep(200);

    const optedIn = !!subscription.optedIn;
    const subscriptionId = subscription.id ?? null;

    // Intenção do usuário + permissão do browser: mantém opt-in local.
    // Só zera se o browser recusou (denied/default).
    setLocalPushOptIn(optedIn || getNotificationPermission() === 'granted');

    if (!optedIn) {
        logger.error('OneSignal subscription not confirmed yet', {
            permission: getNotificationPermission(),
            sdkPermission: OneSignal.Notifications.permission,
            id: subscriptionId,
            token: !!subscription.token,
        });
    }

    return { optedIn, subscriptionId };
}
