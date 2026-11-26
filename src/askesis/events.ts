/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file events.ts
 * @description Nomes e helpers de eventos globais do app (UI plumbing).
 */

import {
    APP_EVENTS,
    CARD_EVENTS,
    type AppEventName,
    type CardEventName,
    type RequestAnalysisDetail,
    type CardEventDetail
} from './contracts/events';

export { APP_EVENTS, CARD_EVENTS };
export type { AppEventName, CardEventName, RequestAnalysisDetail, CardEventDetail };

function _emitEvent<TDetail = undefined>(name: string, detail?: TDetail): void {
    if (typeof document === 'undefined') return;
    if (detail === undefined) {
        document.dispatchEvent(new CustomEvent(name));
    } else {
        document.dispatchEvent(new CustomEvent(name, { detail }));
    }
}

export function emitAppEvent<TDetail = undefined>(name: AppEventName, detail?: TDetail): void {
    _emitEvent(name, detail);
}

export function emitCardEvent<TDetail = undefined>(name: CardEventName, detail?: TDetail): void {
    _emitEvent(name, detail);
}

export const emitRenderApp = () => emitAppEvent(APP_EVENTS.renderApp);
export const emitHabitsChanged = () => emitAppEvent(APP_EVENTS.habitsChanged);
export const emitDayChanged = () => emitAppEvent(APP_EVENTS.dayChanged);
export const emitLanguageChanged = () => emitAppEvent(APP_EVENTS.languageChanged);
export const emitRequestAnalysis = (date: string) => emitAppEvent<RequestAnalysisDetail>(APP_EVENTS.requestAnalysis, { date });

export const emitCardStatusChanged = (detail: CardEventDetail) =>
    emitCardEvent(CARD_EVENTS.statusChanged, detail);

export const emitCardGoalChanged = (detail: CardEventDetail) =>
    emitCardEvent(CARD_EVENTS.goalChanged, detail);
