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

function emit(name: AppEventName | CardEventName, detail?: unknown): void {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(detail === undefined ? new CustomEvent(name) : new CustomEvent(name, { detail }));
}

export const emitRenderApp = () => emit(APP_EVENTS.renderApp);
export const emitHabitsChanged = () => emit(APP_EVENTS.habitsChanged);
export const emitDayChanged = () => emit(APP_EVENTS.dayChanged);
export const emitLanguageChanged = () => emit(APP_EVENTS.languageChanged);
export const emitRequestAnalysis = (date: string) => emit(APP_EVENTS.requestAnalysis, { date } satisfies RequestAnalysisDetail);

export const emitCardStatusChanged = (detail: CardEventDetail) => emit(CARD_EVENTS.statusChanged, detail);
export const emitCardGoalChanged = (detail: CardEventDetail) => emit(CARD_EVENTS.goalChanged, detail);
