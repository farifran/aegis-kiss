/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file contracts/events.ts
 * @description Contratos tipados para eventos globais do app.
 */

export const APP_EVENTS = {
    renderApp: 'render-app',
    habitsChanged: 'habitsChanged',
    dayChanged: 'dayChanged',
    languageChanged: 'language-changed',
    requestAnalysis: 'request-analysis'
} as const;

export const CARD_EVENTS = {
    statusChanged: 'card-status-changed',
    goalChanged: 'card-goal-changed'
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];
export type CardEventName = (typeof CARD_EVENTS)[keyof typeof CARD_EVENTS];

export type RequestAnalysisDetail = { date: string };

export type CardEventDetail = {
    habitId: string;
    time: string;
    date?: string;
};
