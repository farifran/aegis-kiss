/**
 * @license
 * SPDX-License-Identifier: MIT
*/

declare global {
    /** Versão das traduções, injetada pelo build a partir do conteúdo dos locales. */
    const __LOCALE_VERSION__: string;

    interface Element {
        attributeStyleMap?: {
            set(property: string, value: any): void;
            get(property: string): any;
            clear(): void;
        };
    }

    interface OneSignalNotifications {
        addEventListener(event: 'permissionChange', handler: () => void): void;
        requestPermission(): Promise<void | boolean>;
        /** SDK v16: boolean (true = granted). */
        permission?: boolean | 'default' | 'denied' | 'granted';
    }

    interface OneSignalUserPushSubscription {
        optIn(): Promise<void>;
        optOut(): Promise<void>;
        optedIn?: boolean;
        id?: string | null;
        token?: string | null;
    }

    interface OneSignalUser {
        PushSubscription: OneSignalUserPushSubscription;
        setLanguage?(lang: string): void;
    }

    interface OneSignalLike {
        init(options: Record<string, unknown>): Promise<void>;
        Notifications: OneSignalNotifications;
        User: OneSignalUser;
    }

    interface Window {
        OneSignal?: OneSignalLike;
        OneSignalDeferred?: Array<(oneSignal: OneSignalLike) => void>;
        bootWatchdog?: number;
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
