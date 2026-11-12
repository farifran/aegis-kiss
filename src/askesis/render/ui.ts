/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file render/ui.ts
 * @description Registro lazy de referências DOM — consultadas uma vez e cacheadas.
 *
 * A tabela abaixo é a única fonte de verdade: cada elemento aparece uma vez, com
 * o seu tipo e o seu seletor juntos. Antes eram duas listas paralelas (interface
 * + chamadas de registro) que podiam divergir sem o compilador perceber.
 */

/** Descreve um elemento: o seletor resolve em runtime, o parâmetro T tipa o acesso. */
interface Descriptor<T extends Element> {
    selector: string;
    optional: boolean;
    /** Apenas para carregar o tipo — nunca existe em runtime. */
    type?: T;
}

const el = <T extends Element>(selector: string, optional = false): Descriptor<T> => ({ selector, optional });

const ROOT = {
    appContainer: el<HTMLElement>('.app-container'),
    calendarStrip: el<HTMLElement>('#calendar-strip'),
    headerTitle: el<HTMLElement>('#header-title'),
    headerTitleDesktop: el<HTMLElement>('#header-title .header-title-desktop'),
    headerTitleMobile: el<HTMLElement>('#header-title .header-title-mobile'),
    navArrowPast: el<HTMLElement>('#nav-arrow-past'),
    navArrowFuture: el<HTMLElement>('#nav-arrow-future'),
    stoicQuoteDisplay: el<HTMLElement>('#stoic-quote-display'),
    habitContainer: el<HTMLElement>('#habit-container'),
    questsContainer: el<HTMLElement>('.quests-wrapper'),
    questPickerModal: el<HTMLElement>('#quest-picker-modal'),
    questPickerTitle: el<HTMLElement>('#quest-picker-title'),
    questCatalogList: el<HTMLElement>('#quest-catalog-list'),
    questCatalogNote: el<HTMLElement>('#quest-catalog-note'),
    createCustomQuestBtn: el<HTMLButtonElement>('#create-custom-quest-btn'),
    questCustomForm: el<HTMLElement>('#quest-custom-form'),
    questCustomTitleLabel: el<HTMLElement>('#quest-custom-title-label'),
    questCustomTitleInput: el<HTMLInputElement>('#quest-custom-title'),
    questCustomTargetLabel: el<HTMLElement>('#quest-custom-target-label'),
    questCustomTargetInput: el<HTMLInputElement>('#quest-custom-target'),
    questCustomConfirmBtn: el<HTMLButtonElement>('#quest-custom-confirm'),
    manageHabitsBtn: el<HTMLButtonElement>('#manage-habits-btn'),
    fabAddHabit: el<HTMLButtonElement>('#fab-add-habit'),
    manageModal: el<HTMLElement>('#manage-modal'),
    manageModalTitle: el<HTMLElement>('#manage-modal-title'),
    habitListTitle: el<HTMLElement>('#habit-list-title'),
    exploreModal: el<HTMLElement>('#explore-modal'),
    exploreHabitList: el<HTMLElement>('#explore-habit-list'),
    createCustomHabitBtn: el<HTMLButtonElement>('#create-custom-habit-btn'),
    aiEvalBtn: el<HTMLButtonElement>('#ai-eval-btn'),
    aiModal: el<HTMLElement>('#ai-modal'),
    aiOptionsModal: el<HTMLElement>('#ai-options-modal'),
    confirmModal: el<HTMLElement>('#confirm-modal'),
    habitList: el<HTMLElement>('#habit-list'),
    noHabitsMessage: el<HTMLElement>('#no-habits-message'),
    aiResponse: el<HTMLElement>('#ai-response'),
    confirmModalText: el<HTMLElement>('#confirm-modal-text'),
    confirmModalConfirmBtn: el<HTMLButtonElement>('#confirm-modal-confirm-btn'),
    confirmModalEditBtn: el<HTMLButtonElement>('#confirm-modal-edit-btn'),
    notesModal: el<HTMLElement>('#notes-modal'),
    notesModalTitle: el<HTMLElement>('#notes-modal-title'),
    notesModalSubtitle: el<HTMLElement>('#notes-modal-subtitle'),
    notesTextarea: el<HTMLTextAreaElement>('#notes-textarea'),
    saveNoteBtn: el<HTMLButtonElement>('#save-note-btn'),
    resetAppBtn: el<HTMLButtonElement>('#reset-app-btn'),
    languagePrevBtn: el<HTMLButtonElement>('#language-prev'),
    languageViewport: el<HTMLElement>('#language-viewport'),
    languageReel: el<HTMLElement>('#language-reel'),
    languageNextBtn: el<HTMLButtonElement>('#language-next'),
    editHabitModal: el<HTMLElement>('#edit-habit-modal'),
    editHabitModalTitle: el<HTMLElement>('#edit-habit-modal-title'),
    editHabitForm: el<HTMLFormElement>('#edit-habit-form'),
    habitSubtitleDisplay: el<HTMLElement>('#habit-subtitle-display'),
    editHabitSaveBtn: el<HTMLButtonElement>('#edit-habit-save-btn'),
    habitTimeContainer: el<HTMLElement>('#habit-time-container'),
    frequencyOptionsContainer: el<HTMLElement>('#frequency-options-container'),
    syncStatus: el<HTMLElement>('#sync-status'),
    syncInactiveView: el<HTMLElement>('#sync-inactive-view'),
    enableSyncBtn: el<HTMLButtonElement>('#enable-sync-btn'),
    enterKeyViewBtn: el<HTMLButtonElement>('#enter-key-view-btn'),
    syncEnterKeyView: el<HTMLElement>('#sync-enter-key-view'),
    syncKeyInput: el<HTMLInputElement>('#sync-key-input'),
    cancelEnterKeyBtn: el<HTMLButtonElement>('#cancel-enter-key-btn'),
    submitKeyBtn: el<HTMLButtonElement>('#submit-key-btn'),
    syncDisplayKeyView: el<HTMLElement>('#sync-display-key-view'),
    syncKeyText: el<HTMLElement>('#sync-key-text'),
    copyKeyBtn: el<HTMLButtonElement>('#copy-key-btn'),
    keySavedBtn: el<HTMLButtonElement>('#key-saved-btn'),
    syncActiveView: el<HTMLElement>('#sync-active-view'),
    viewKeyBtn: el<HTMLButtonElement>('#view-key-btn'),
    disableSyncBtn: el<HTMLButtonElement>('#disable-sync-btn'),
    notificationToggle: el<HTMLInputElement>('#notification-toggle'),
    notificationToggleLabel: el<HTMLLabelElement>('#notification-toggle-label'),
    notificationStatusDesc: el<HTMLElement>('#notification-status-desc'),
    iconPickerModal: el<HTMLElement>('#icon-picker-modal'),
    iconPickerGrid: el<HTMLElement>('#icon-picker-grid'),
    habitIconPickerBtn: el<HTMLButtonElement>('#habit-icon-picker-btn'),
    colorPickerModal: el<HTMLElement>('#color-picker-modal'),
    colorPickerGrid: el<HTMLElement>('#color-picker-grid'),
    changeColorFromPickerBtn: el<HTMLButtonElement>('#change-color-from-picker-btn'),
    fullCalendarModal: el<HTMLElement>('#full-calendar-modal'),
    fullCalendarMonthYear: el<HTMLElement>('#full-calendar-month-year'),
    fullCalendarPrevBtn: el<HTMLButtonElement>('#full-calendar-prev'),
    fullCalendarNextBtn: el<HTMLButtonElement>('#full-calendar-next'),
    fullCalendarGrid: el<HTMLElement>('#full-calendar-grid'),
    calendarQuickActions: el<HTMLElement>('#calendar-quick-actions'),
    quickActionDone: el<HTMLButtonElement>('#quick-action-done'),
    quickActionSnooze: el<HTMLButtonElement>('#quick-action-snooze'),
    quickActionAlmanac: el<HTMLButtonElement>('#quick-action-almanac'),
    labelLanguage: el<HTMLElement>('#label-language'),
    labelSync: el<HTMLElement>('#label-sync'),
    labelNotifications: el<HTMLElement>('#label-notifications'),
    labelReset: el<HTMLElement>('#label-reset'),
    labelPrivacy: el<HTMLElement>('#label-privacy'),
    exportDataBtn: el<HTMLButtonElement>('#export-data-btn'),
    importDataBtn: el<HTMLButtonElement>('#import-data-btn'),
    syncInactiveDesc: el<HTMLElement>('#sync-inactive-desc'),
    labelEnterKey: el<HTMLElement>('#label-enter-key'),
    syncWarningText: el<HTMLElement>('#sync-warning-text'),
    syncActiveDesc: el<HTMLElement>('#sync-active-desc'),
    iconPickerTitle: el<HTMLElement>('#icon-picker-modal-title'),
    colorPickerTitle: el<HTMLElement>('#color-picker-modal-title'),
    habitConscienceDisplay: el<HTMLElement>('#habit-conscience-display', true),
    syncErrorMsg: el<HTMLElement>('#sync-error-msg'),
};

const PROGRESSION = {
    title: el<HTMLElement>('#progression-container .progression-title'),
    subtitle: el<HTMLElement>('#progression-container .app-subtitle'),
    gradeBadge: el<HTMLElement>('#progression-container .grade-badge'),
    gradeRank: el<HTMLElement>('#progression-container .grade-rank'),
    gradeXp: el<HTMLElement>('#progression-container .grade-xp'),
    gradeTrack: el<HTMLElement>('#progression-container .grade-track'),
    gradeFill: el<HTMLElement>('#progression-container .grade-fill'),
    questsMarker: el<HTMLElement>('.quests-marker'),
    questsTitle: el<HTMLElement>('#quests-container .quests-title'),
    questsList: el<HTMLElement>('#quests-container .quests-list'),
};

type Resolved<M> = { [K in keyof M]: M[K] extends Descriptor<infer T> ? T : never };
export type UIElements = Resolved<typeof ROOT> & { progression: Resolved<typeof PROGRESSION> };

function queryElement(selector: string, isOptional: boolean): Element | null {
    // IDs simples usam getElementById (mais rápido que querySelector)
    const isSimpleId = selector.charCodeAt(0) === 35 /* # */ && !/[\s.\[]/.test(selector);

    const element = isSimpleId
        ? document.getElementById(selector.slice(1))
        : document.querySelector(selector);

    if (!element && !isOptional) {
        throw new Error(`UI element "${selector}" not found.`);
    }
    return element;
}

/** Define getters que consultam o DOM na primeira leitura e cacheiam o resultado. */
function bind(target: object, descriptors: Record<string, Descriptor<Element>>) {
    const cache: Record<string, Element> = {};
    for (const [prop, { selector, optional }] of Object.entries(descriptors)) {
        Object.defineProperty(target, prop, {
            get() {
                if (cache[prop] === undefined) {
                    const found = queryElement(selector, optional);
                    if (found) cache[prop] = found;
                    return found;
                }
                return cache[prop];
            },
            enumerable: true,
            configurable: false
        });
    }
}

export const ui = {} as UIElements;
bind(ui, ROOT);

ui.progression = {} as UIElements['progression'];
bind(ui.progression, PROGRESSION);
