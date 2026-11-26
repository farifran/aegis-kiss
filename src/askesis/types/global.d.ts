/**
 * @license
 * SPDX-License-Identifier: MIT
*/

declare global {
    interface Element {
        attributeStyleMap?: {
            set(property: string, value: any): void;
            get(property: string): any;
            clear(): void;
        };
    }

    interface OneSignalNotifications {
        addEventListener(event: 'permissionChange', handler: () => void): void;
        requestPermission(): Promise<void>;
        permission?: 'default' | 'denied' | 'granted';
    }

    interface OneSignalUserPushSubscription {
        optOut(): Promise<void>;
        optedIn?: boolean;
    }

    interface OneSignalUser {
        PushSubscription: OneSignalUserPushSubscription;
        setLanguage?(lang: string): void;
    }

    interface OneSignalLike {
        init(options: { appId: string; allowLocalhostAsSecureOrigin?: boolean }): Promise<void>;
        Notifications: OneSignalNotifications;
        User: OneSignalUser;
    }

    interface Window {
        OneSignal?: OneSignalLike;
        OneSignalDeferred?: Array<(oneSignal: OneSignalLike) => void>;
        showFatalError?: (message: string, isWatchdog?: boolean) => void;
        CSSTranslate?: new (x: unknown, y: unknown, z?: unknown) => unknown;
        scheduler?: {
            postTask<T>(callback: () => T | Promise<T>, options?: { priority?: 'user-blocking' | 'user-visible' | 'background'; signal?: AbortSignal; delay?: number }): Promise<T>;
        };
    }

    interface ViewTransition {
        readonly finished: Promise<void>;
        readonly ready: Promise<void>;
        readonly updateCallbackDone: Promise<void>;
        skipTransition(): void;
    }

    interface Document {
        startViewTransition?(callback?: () => void | Promise<void>): ViewTransition;
    }
}

export {};
