/**
 * @file services/push.test.ts
 * @description Testes do fluxo de inscrição push (OneSignal).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('ensurePushSubscribed', () => {
    afterEach(() => {
        try {
            delete (window as any).OneSignal;
            delete (window as any).OneSignalDeferred;
            localStorage.removeItem('askesis_onesignal_opted_in');
        } catch {}
        vi.restoreAllMocks();
        vi.resetModules();
    });

    async function runWithMockSdk(sdk: any, nativePerm: NotificationPermission = 'granted') {
        (window as any).OneSignal = sdk;
        (window as any).OneSignalDeferred = [];
        Object.defineProperty(window, 'Notification', {
            configurable: true,
            value: { permission: nativePerm },
        });
        vi.spyOn(document.head, 'appendChild').mockImplementation((node: any) => {
            if (node?.tagName === 'SCRIPT') {
                queueMicrotask(async () => {
                    const deferred = (window as any).OneSignalDeferred as Array<(os: any) => any>;
                    for (const fn of [...(deferred || [])]) await fn(sdk);
                    node.dispatchEvent(new Event('load'));
                });
            }
            return node;
        });

        const { ensurePushSubscribed, getLocalPushOptIn } = await import('./push');
        const result = await ensurePushSubscribed();
        return { result, getLocalPushOptIn };
    }

    it('chama requestPermission+optIn e grava localOptIn quando optedIn=true', async () => {
        const optIn = vi.fn(async () => {});
        const requestPermission = vi.fn(async () => true);
        const { result, getLocalPushOptIn } = await runWithMockSdk({
            init: vi.fn(async () => {}),
            User: {
                PushSubscription: {
                    optIn,
                    optOut: vi.fn(),
                    optedIn: true,
                    id: 'sub-1',
                    token: 'tok',
                },
            },
            Notifications: {
                requestPermission,
                permission: true,
                isPushSupported: () => true,
            },
        });

        expect(requestPermission).toHaveBeenCalled();
        expect(optIn).toHaveBeenCalled();
        expect(result.optedIn).toBe(true);
        expect(getLocalPushOptIn()).toBe(true);
    });

    it('mantém localOptIn se permissão nativa granted mesmo com optedIn lento', async () => {
        const optIn = vi.fn(async () => {});
        const { result, getLocalPushOptIn } = await runWithMockSdk({
            init: vi.fn(async () => {}),
            User: {
                PushSubscription: {
                    optIn,
                    optOut: vi.fn(),
                    optedIn: false,
                    id: null,
                    token: null,
                },
            },
            Notifications: {
                requestPermission: vi.fn(async () => true),
                permission: true,
                isPushSupported: () => true,
            },
        }, 'granted');

        expect(result.optedIn).toBe(false);
        // Intenção + permissão: toggle não fica “morto” nem pede reinício.
        expect(getLocalPushOptIn()).toBe(true);
    });
});
