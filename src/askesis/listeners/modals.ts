
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file listeners/modals.ts
 * @description Controlador de Interação de Modais (Forms, Configurações, Diálogos).
 * 
 * [MAIN THREAD CONTEXT]:
 * Este módulo gerencia o ciclo de vida de interações complexas que pausam o fluxo principal da aplicação.
 * 
 * ARQUITETURA (Static Dispatch & Zero-Allocation):
 * - **Static Handlers:** Todos os listeners são definidos no nível do módulo. Zero closures em `setupModalListeners`.
 * - **Validation Optimization:** Separação estrita entre validação lógica (Input Loop) e feedback visual (RAF).
 * - **Event Delegation:** Delegação eficiente para listas e grids.
 */

import { ui } from '../render/ui';
import { 
    state, 
    LANGUAGES, 
    MAX_HABIT_NAME_LENGTH
} from '../state';
import { PREDEFINED_HABITS } from '../data/predefinedHabits';
import {
    openModal,
    closeModal,
    setupManageModal,
    renderExploreHabits,
    showConfirmationModal,
    renderLanguageFilter,
    openEditModal,
    updateNotificationUI,
} from '../render';
import {
    saveHabitFromModal,
    requestHabitEndingFromModal,
    requestHabitPermanentDeletion,
    resetAccountData,
    handleSaveNote,
    graduateHabit,
    exportData,
    importData,
} from '../services/habitActions';
import { t, setLanguage } from '../i18n';
import { setupReelRotary } from '../render/rotary';
import { triggerHaptic, logger, getTodayUTCIso, isActivationKeyboardEvent } from '../utils';
import { ensureOneSignalReady, ensurePushSubscribed, setLocalPushOptIn, getNotificationPermission } from '../services/push';
import { hasLocalSyncKey } from '../services/api';
import { setTextContent } from '../render/dom';
import {
    handleAiEvalClick,
    handleAiOptionsClick,
} from './modals/aiHandlers';
import {
    handleFullCalendarPrevClick,
    handleFullCalendarNextClick,
    handleFullCalendarGridClick,
    handleFullCalendarGridKeydown,
} from './modals/fullCalendarHandlers';
import {
    handleHabitNameInput,
    handleIconPickerClick,
    handleIconGridClick,
    handleColorGridClick,
    handleChangeColorClick,
    handleTimeContainerClick,
    handleFrequencyChange,
    handleFrequencyClick,
} from './modals/formHandlers';

// --- STATIC EVENT HANDLERS ---

const _handleManageHabitsClick = () => {
    if (ui.manageModal.classList.contains('visible')) return;
    
    triggerHaptic('light');
    setupManageModal();
    updateNotificationUI();
    openModal(ui.manageModal);
};

const _handleFabClick = () => {
    if (ui.exploreModal.classList.contains('visible')) return;

    triggerHaptic('light');
    renderExploreHabits();
    openModal(ui.exploreModal);
};

const _handleHabitListClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button');
    if (!button) return;

    const habitId = button.closest<HTMLLIElement>('li.habit-list-item')?.dataset.habitId;
    if (!habitId) return;

    if (ui.confirmModal.classList.contains('visible')) return;

    triggerHaptic('light');

    if (button.classList.contains('end-habit-btn')) {
        requestHabitEndingFromModal(habitId, getTodayUTCIso());
    } else if (button.classList.contains('permanent-delete-habit-btn')) {
        requestHabitPermanentDeletion(habitId);
    } else if (button.classList.contains('graduate-habit-btn')) {
        graduateHabit(habitId);
    }
};

const _handleManageModalClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.id === 'export-data-btn') {
        exportData();
    } else if (target.id === 'import-data-btn') {
        importData();
    }
};

/**
 * "Apagar dados" tem um alcance só: zera a conta inteira e continua
 * sincronizado. Não há escopo a escolher — quem quer sair da conta usa
 * "Desativar sincronização", que solta a chave e limpa este aparelho.
 *
 * Sem chave de sync não existe conta, e o texto muda para o que de fato
 * acontece: só este aparelho é apagado.
 */
const _handleResetAppClick = () => {
    if (ui.confirmModal.classList.contains('visible')) return;

    triggerHaptic('light');

    const hasAccount = hasLocalSyncKey();
    showConfirmationModal(
        t(hasAccount ? 'confirmResetData' : 'confirmResetLocal'),
        () => {
            // Não resolve: o caminho feliz termina em reload. O catch é para o
            // purge recusado pela nuvem, que mantém os dados de pé e precisa
            // dizer isso — apagar em silêncio seria pior que não apagar.
            resetAccountData().catch((e) => {
                logger.error('Reset failed', e);
                if (!hasAccount) return;
                showConfirmationModal(t('resetAccountError'), () => {}, {
                    title: t('modalManageReset'),
                    confirmText: 'OK',
                    hideCancel: true,
                    confirmButtonStyle: 'danger'
                });
            });
        },
        {
            confirmText: t('modalManageResetButton'),
            title: t('modalManageReset'),
            confirmButtonStyle: 'danger'
        }
    );
};

// Após permissão nativa (ou já granted): intenção local imediata + subscription OneSignal.
const _enableNotificationsAsync = async (perm: string) => {
    try {
        if (perm !== 'granted') {
            ui.notificationToggle.checked = false;
            setLocalPushOptIn(false);
            setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            return;
        }

        // Intenção imediata: UI fica “ligada” sem pedir reinício.
        setLocalPushOptIn(true);
        ui.notificationToggle.checked = true;
        setTextContent(ui.notificationStatusDesc, t('notificationStatusEnabled'));

        try {
            await ensurePushSubscribed();
        } catch (err) {
            logger.error('Enable notifications: OneSignal subscribe failed', err);
            // Mantém ligado se o browser ainda tem permissão (retry no boot).
            if (getNotificationPermission() !== 'granted') {
                ui.notificationToggle.checked = false;
                setLocalPushOptIn(false);
                setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            }
        }
    } catch (err) {
        logger.error('Enable notifications failed', err);
        if (getNotificationPermission() !== 'granted') {
            ui.notificationToggle.checked = false;
            setLocalPushOptIn(false);
            setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
        }
    } finally {
        updateNotificationUI();
    }
};

// iOS Safari PWA: NÃO async. requestPermission nativo no mesmo tick do gesto.
const _handleNotificationToggleChange = () => {
    const wantsEnabled = ui.notificationToggle.checked;

    if (!wantsEnabled) {
        (async () => {
            setLocalPushOptIn(false);
            ui.notificationToggle.checked = false;
            setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            try {
                const OneSignal = await ensureOneSignalReady();
                await OneSignal.User.PushSubscription.optOut();
            } catch {
                // Opt-out local já persistido.
            } finally {
                updateNotificationUI();
            }
        })();
        return;
    }

    const currentPerm = getNotificationPermission();
    let permPromise: Promise<string>;
    if (currentPerm === 'default' && typeof Notification !== 'undefined') {
        try {
            const res = (Notification as { requestPermission?: () => Promise<NotificationPermission> | NotificationPermission })
                .requestPermission?.call(Notification);
            permPromise = Promise.resolve((res as string) ?? currentPerm);
        } catch {
            permPromise = Promise.resolve(currentPerm);
        }
    } else {
        permPromise = Promise.resolve(currentPerm);
    }

    permPromise
        .then((perm) => _enableNotificationsAsync(perm))
        .catch(() => {
            if (getNotificationPermission() !== 'granted') {
                ui.notificationToggle.checked = false;
                setLocalPushOptIn(false);
                setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            }
            updateNotificationUI();
        });
};

const _handleExploreHabitListClick = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.explore-habit-item');
    if (!item) return;
    triggerHaptic('light');
    const index = parseInt(item.dataset.index!, 10);
    const habitTemplate = PREDEFINED_HABITS[index];
    if (habitTemplate) {
        closeModal(ui.exploreModal);
        // LÓGICA RADICAL: Sempre abre o modal de edição para criar um NOVO hábito a partir do modelo,
        // mesmo que um com nome parecido já exista. Elimina a ambiguidade.
        // CALLBACK: Se cancelar (back/close), reabre o modal de Explorar.
        openEditModal(habitTemplate, undefined, () => openModal(ui.exploreModal));
    }
};

const _handleExploreHabitListKeydown = (e: KeyboardEvent) => {
    if (isActivationKeyboardEvent(e)) {
        e.preventDefault();
        const item = (e.target as HTMLElement).closest<HTMLElement>('.explore-habit-item');
        if (item) {
            item.click();
        }
    }
};

const _handleCreateCustomHabitClick = () => {
    triggerHaptic('light');
    closeModal(ui.exploreModal);
    // CALLBACK: Se cancelar (back/close), reabre o modal de Explorar.
    openEditModal(null, undefined, () => openModal(ui.exploreModal));
};

const _handleConfirmClick = () => {
    triggerHaptic('light');
    const action = state.confirmAction;
    
    try {
        action?.();
    } catch (e) {
        logger.error("Action execution failed", e);
    }

    state.confirmAction = null;
    state.confirmEditAction = null;
    
    // Sem suppressCallbacks: onCancel roda como safety-net para ActionContext.reset()
    closeModal(ui.confirmModal);
};

const _handleEditClick = () => {
    triggerHaptic('light');
    const editAction = state.confirmEditAction;
    
    try {
        editAction?.();
    } catch (e) {
        logger.error("Edit Action execution failed", e);
    }

    state.confirmAction = null;
    state.confirmEditAction = null;
    
    closeModal(ui.confirmModal);
};

export function setupModalListeners() {
    // Main Actions
    ui.manageHabitsBtn.addEventListener('click', _handleManageHabitsClick);
    ui.fabAddHabit.addEventListener('click', _handleFabClick);
    ui.habitList.addEventListener('click', _handleHabitListClick);
    ui.manageModal.addEventListener('click', _handleManageModalClick);
    ui.resetAppBtn.addEventListener('click', _handleResetAppClick);
    ui.notificationToggle.addEventListener('change', _handleNotificationToggleChange);

    // Rotary Config
    setupReelRotary({
        viewportEl: ui.languageViewport,
        reelEl: ui.languageReel,
        prevBtn: ui.languagePrevBtn,
        nextBtn: ui.languageNextBtn,
        optionsCount: LANGUAGES.length,
        getInitialIndex: () => LANGUAGES.findIndex(l => l.code === state.activeLanguageCode),
        onIndexChange: async (index) => {
            const newLang = LANGUAGES[index].code;
            if (newLang !== state.activeLanguageCode) {
                await setLanguage(newLang);
            }
        },
        render: renderLanguageFilter,
    });

    // Explore / Create
    ui.exploreHabitList.addEventListener('click', _handleExploreHabitListClick);
    ui.exploreHabitList.addEventListener('keydown', _handleExploreHabitListKeydown);
    ui.createCustomHabitBtn.addEventListener('click', _handleCreateCustomHabitClick);

    // AI
    ui.aiEvalBtn.addEventListener('click', handleAiEvalClick);
    ui.aiOptionsModal.addEventListener('click', handleAiOptionsClick);

    // Dialogs
    ui.confirmModalConfirmBtn.addEventListener('click', _handleConfirmClick);
    ui.confirmModalEditBtn.addEventListener('click', _handleEditClick);
    ui.saveNoteBtn.addEventListener('click', () => { triggerHaptic('light'); handleSaveNote(); });

    // Full Calendar
    ui.fullCalendarPrevBtn.addEventListener('click', handleFullCalendarPrevClick);
    ui.fullCalendarNextBtn.addEventListener('click', handleFullCalendarNextClick);
    ui.fullCalendarGrid.addEventListener('click', handleFullCalendarGridClick);
    ui.fullCalendarGrid.addEventListener('keydown', handleFullCalendarGridKeydown);

    // Habit Editing Form
    ui.editHabitSaveBtn.addEventListener('click', () => { triggerHaptic('light'); saveHabitFromModal(); });
    
    // Performance Optimized Input Handler
    const habitNameInput = ui.editHabitForm.elements.namedItem('habit-name') as HTMLInputElement;
    // BROWSER LEVEL GUARD: Define maxLength no DOM para prevenir colagem excessiva
    habitNameInput.maxLength = MAX_HABIT_NAME_LENGTH;
    habitNameInput.addEventListener('input', handleHabitNameInput);

    // Pickers
    ui.habitIconPickerBtn.addEventListener('click', handleIconPickerClick);
    ui.iconPickerGrid.addEventListener('click', handleIconGridClick);
    ui.colorPickerGrid.addEventListener('click', handleColorGridClick);
    ui.changeColorFromPickerBtn.addEventListener('click', handleChangeColorClick);
    ui.habitTimeContainer.addEventListener('click', handleTimeContainerClick);
    
    // Frequency Controls
    ui.frequencyOptionsContainer.addEventListener('change', handleFrequencyChange);
    ui.frequencyOptionsContainer.addEventListener('click', handleFrequencyClick);
}
