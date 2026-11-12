
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file services/badge.ts
 * @description Controlador de Integração com o Sistema Operacional (App Badging API).
 * 
 * [MAIN THREAD CONTEXT]:
 * Este módulo roda na thread principal, mas utiliza APIs assíncronas do navegador
 * para não bloquear a renderização.
 * 
 * ARQUITETURA (Progressive Enhancement):
 * - **Responsabilidade Única:** Sincronizar o contador de pendências do estado interno
 *   com o ícone do aplicativo no OS (Homescreen/Dock).
 * - **Falha Silenciosa:** Como é uma funcionalidade decorativa ("Delighter"), falhas não
 *   devem interromper o fluxo do usuário.
 * 
 * DEPENDÊNCIAS CRÍTICAS:
 * - `services/selectors.ts`: Lógica de cálculo de pendências.
 */

import { calculateDaySummary } from './selectors';
import { getTodayUTCIso, logger } from '../utils';
import { getLocalPushOptIn, getNotificationPermission } from './push';
import { t } from '../i18n';

// [2025-01-15] TYPE SAFETY: Definição de interface local para a Badging API.
// Evita o uso repetido de 'as any' e fornece autocompletar/verificação se o TS for atualizado.
// Esta API ainda é considerada experimental em alguns contextos.
interface NavigatorWithBadging extends Navigator {
    setAppBadge(contents?: number): Promise<void>;
    clearAppBadge(): Promise<void>;
}

/**
 * Tag estável: garante que exista no máximo UMA notificação de pendências
 * (showNotification com a mesma tag substitui a anterior).
 */
export const PENDING_NOTIFICATION_TAG = 'askesis-pending-habits';

function supportsNativeBadge(): boolean {
    return 'setAppBadge' in navigator && 'clearAppBadge' in navigator;
}

/**
 * O Android não pinta badge numérico no ícone: lá o emblema do launcher vem de
 * notificações não lidas. Navegadores Android podem EXPOR setAppBadge sem que
 * ela tenha efeito — confiar só no feature detection faz o código entrar no
 * ramo nativo, chamar uma função inócua e nunca publicar a notificação.
 */
function isAndroid(): boolean {
    const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
    if (uaData?.platform) return /android/i.test(uaData.platform);
    return /Android/i.test(navigator.userAgent || '');
}

/** Badge nativo só é confiável fora do Android (iOS 16.4+ PWA, desktop). */
function hasWorkingNativeBadge(): boolean {
    return supportsNativeBadge() && !isAndroid();
}

/** Memoiza a registration: o badge é sincronizado a cada marcação de hábito. */
let _cachedRegistration: ServiceWorkerRegistration | null = null;

function buildNotificationOptions(body: string): NotificationOptions {
    return {
        tag: PENDING_NOTIFICATION_TAG,
        body,
        icon: 'icons/icon-192.svg',
        badge: 'icons/badge.svg',
        silent: true,
        data: { url: '/' }
    } as NotificationOptions;
}

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (_cachedRegistration) return _cachedRegistration;
    if (!('serviceWorker' in navigator)) return null;
    try {
        _cachedRegistration = await navigator.serviceWorker.ready;
        return _cachedRegistration;
    } catch {
        return null;
    }
}

async function closePendingNotification(): Promise<void> {
    const reg = await getSwRegistration();
    if (!reg) return;
    const notifications = await reg.getNotifications({ tag: PENDING_NOTIFICATION_TAG });
    notifications.forEach(n => n.close());
}

async function showPendingNotification(count: number): Promise<void> {
    const title = t('pendingBadgeTitle');
    const body = t('pendingBadgeBody', { count });

    const reg = await getSwRegistration();
    if (!reg) return;
    await reg.showNotification(title, buildNotificationOptions(body));
}

/**
 * FALLBACK ANDROID: o Chrome/Android não pinta badge numérico no ícone — lá o
 * emblema do launcher vem de notificações não lidas.
 *
 * ESTRATÉGIA (espelho, não corrida): a notificação reflete o estado a qualquer
 * momento — existe enquanto houver pendências, some quando zeram —, inclusive
 * com o app aberto. Assim ela JÁ ESTÁ publicada quando o usuário sai, não
 * importa como: Home, gerenciador de janelas ou botão Voltar.
 *
 * A tentativa anterior era criá-la no instante da saída, o que exige rodar
 * JavaScript enquanto o Android encerra o app — corrida que o Voltar perde.
 */
async function updateNotificationFallback(count: number): Promise<void> {
    // Requisitos: permissão concedida E opt-in explícito do usuário no app.
    if (typeof Notification === 'undefined') return;
    if (getNotificationPermission() !== 'granted' || getLocalPushOptIn() !== true) return;

    if (count > 0) {
        await showPendingNotification(count);
    } else {
        await closePendingNotification();
    }
}

/**
 * Atualiza o emblema do ícone do aplicativo com o número atual de hábitos pendentes para hoje.
 * Se a contagem for zero, o emblema é limpo.
 * Esta função verifica o suporte do navegador antes de tentar definir o emblema.
 */
export async function updateAppBadge(): Promise<void> {
    try {
        // REFACTOR [2025-03-05]: usa a função centralizada e cacheada 'calculateDaySummary'
        // para obter a contagem de pendentes (custo O(1) na maioria das chamadas).
        const { pending: count } = calculateDaySummary(getTodayUTCIso());

        // PROGRESSIVE ENHANCEMENT: Badging API nativa quando ela realmente
        // funciona (iOS 16.4+ PWA, Chrome/Edge desktop) — nunca no Android.
        if (hasWorkingNativeBadge()) {
            const nav = navigator as NavigatorWithBadging;
            if (count > 0) {
                await nav.setAppBadge(count);
            } else {
                await nav.clearAppBadge();
            }
            return;
        }

        // Android (ou sem Badging API): badge via notificação silenciosa.
        await updateNotificationFallback(count);
    } catch (error) {
        // ROBUSTEZ: Falha silenciosa ou log discreto é aceitável para funcionalidades de UI progressivas.
        // Não queremos alertar o usuário se o OS rejeitar o badge (ex: permissões).
        logger.error('Failed to set app badge:', error);
    }
}
