
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
    resetApplicationData,
    handleSaveNote,
    graduateHabit,
    exportData,
    importData,
} from '../services/habitActions';
import { t, setLanguage } from '../i18n';
import { setupReelRotary } from '../render/rotary';
import { ensureOneSignalReady, setLocalPushOptIn, triggerHaptic, logger, getTodayUTCIso, isActivationKeyboardEvent } from '../utils';
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

const _handleResetAppClick = () => {
    if (ui.confirmModal.classList.contains('visible')) return;

    triggerHaptic('light');
    showConfirmationModal(
        t('confirmResetApp'),
        resetApplicationData,
        { 
            confirmText: t('modalManageResetButton'), 
            title: t('modalManageReset'),
            confirmButtonStyle: 'danger'
        }
    );
};

// Async helper chamado após obter a permissão (ou já possuí-la).
const _enableNotificationsAsync = async (perm: string) => {
    try {
        if (perm !== 'granted') {
            ui.notificationToggle.checked = false;
            setLocalPushOptIn(false);
            setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            return;
        }

        ui.notificationToggle.disabled = true;
        setTextContent(ui.notificationStatusDesc, t('notificationChangePending'));

        // Persiste opt-in local imediatamente (boot pode refletir sem SDK).
        setLocalPushOptIn(true);
        updateNotificationUI();

        // Carrega OneSignal em background para finalizar subscription.
        ensureOneSignalReady()
            .then(async (OneSignal) => {
                try { await OneSignal.Notifications.requestPermission?.(); } catch {}
                try {
                    const optedIn = !!OneSignal.User.PushSubscription.optedIn;
                    // Só persiste quando o SDK confirma opt-in. Se optedIn=false logo após
                    // a ativação (race condition do SDK), não sobrescreve o true já persistido.
                    if (optedIn) {
                        setLocalPushOptIn(true);
                    }
                } catch {}
                updateNotificationUI();
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('./sw.js?push=1').catch(() => {});
                }
            })
            .catch(() => { updateNotificationUI(); });
    } catch {
        const nativePerm = (typeof Notification !== 'undefined') ? (Notification as any).permission : 'default';
        if (nativePerm !== 'granted') {
            ui.notificationToggle.checked = false;
            setLocalPushOptIn(false);
        }
        setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
    } finally {
        ui.notificationToggle.disabled = false;
        updateNotificationUI();
    }
};

// iOS Safari PWA CRÍTICO: esta função NÃO pode ser async.
// O WebKit exige que Notification.requestPermission() seja chamado sincronamente dentro
// de um handler de gesto do usuário sem nenhum contexto async antes.
// Usar async/await aqui faz o token de ativação do usuário não ser propagado
// corretamente, causando o diálogo de permissão não aparecer intermitentemente.
const _handleNotificationToggleChange = () => {
    const wantsEnabled = ui.notificationToggle.checked;

    if (!wantsEnabled) {
        // Desativar: não requer gesto do usuário, pode ser async.
        (async () => {
            ui.notificationToggle.disabled = true;
            setTextContent(ui.notificationStatusDesc, t('notificationChangePending'));
            try {
                const OneSignal = await ensureOneSignalReady();
                await OneSignal.User.PushSubscription.optOut();
                setLocalPushOptIn(false);
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('./sw.js').catch(() => {});
                }
            } catch {
                // Persiste opt-out mesmo em caso de falha do SDK (sem conexão, timeout, etc.)
                // para que updateNotificationUI() não releia localOptIn=true e reative o toggle.
                setLocalPushOptIn(false);
                setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            } finally {
                ui.notificationToggle.disabled = false;
                updateNotificationUI();
            }
        })();
        return;
    }

    const currentPerm: string =
        (typeof Notification !== 'undefined' && (Notification as any).permission) || 'default';

    // Chama requestPermission() SINCRONAMENTE dentro do gesto do usuário (sem async antes).
    // Isso garante compatibilidade com iOS Safari PWA e qualquer browser com restrição de gesto.
    const permPromise: Promise<string> =
        (currentPerm === 'default' &&
            typeof Notification !== 'undefined' &&
            typeof (Notification as any).requestPermission === 'function')
            ? ((Notification as any).requestPermission() as Promise<string>)
            : Promise.resolve(currentPerm);

    permPromise
        .then(perm => _enableNotificationsAsync(perm))
        .catch(() => {
            const nativePerm = (typeof Notification !== 'undefined') ? (Notification as any).permission : 'default';
            if (nativePerm !== 'granted') {
                ui.notificationToggle.checked = false;
                setLocalPushOptIn(false);
            }
            setTextContent(ui.notificationStatusDesc, t('notificationStatusOptedOut'));
            ui.notificationToggle.disabled = false;
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
