/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file listeners/modals/formHandlers.ts
 * @description Handlers de interação para o formulário de edição de hábito
 * (nome, ícone, cor, horário, frequência).
 */

import { state, FREQUENCIES, TimeOfDay, MAX_HABIT_NAME_LENGTH } from '../../state';
import { ui } from '../../render/ui';
import {
    openModal,
    closeModal,
    renderFrequencyOptions,
    renderIconPicker,
    renderColorPicker,
} from '../../render';
import { sanitizeHabitIcon } from '../../data/icons';
import { t } from '../../i18n';
import { getContrastColor, triggerHaptic, sanitizeText } from '../../utils';
import { setTextContent, setTrustedSvgContent } from '../../render/dom';

// --- VALIDATION LOGIC (Decoupled) ---

/**
 * Valida o nome do hábito e atualiza a UI.
 * PERFORMANCE: Evita Layout Thrashing (offsetWidth) no loop de input.
 * Apenas atualiza o texto de erro se o *tipo* de erro mudar.
 */
function validateAndFeedback(newName: string): boolean {
    const formNoticeEl = ui.editHabitForm.querySelector<HTMLElement>('.form-notice')!;
    const habitNameInput = ui.editHabitForm.elements.namedItem('habit-name') as HTMLInputElement;

    const trimmedName = newName.trim();
    let errorKey: string | null = null;
    const isBlockingError = trimmedName.length === 0;

    if (isBlockingError) {
        errorKey = 'noticeNameCannotBeEmpty';
    } else if (trimmedName.length > MAX_HABIT_NAME_LENGTH) {
        errorKey = 'noticeNameTooLong'; // Apenas um aviso não-bloqueante
    }

    const isValid = !isBlockingError;

    // UI Updates (DOM Writes)
    if (!errorKey) {
        if (formNoticeEl.classList.contains('visible')) {
            formNoticeEl.classList.remove('visible');
            habitNameInput.classList.remove('shake');
        }
    } else {
        const errorText = t(errorKey);
        if (formNoticeEl.textContent !== errorText) {
            formNoticeEl.textContent = errorText;
        }

        if (!formNoticeEl.classList.contains('visible')) {
            formNoticeEl.classList.add('visible');

            if (isBlockingError) {
                requestAnimationFrame(() => {
                    habitNameInput.classList.add('shake');
                    habitNameInput.addEventListener('animationend', () => habitNameInput.classList.remove('shake'), { once: true });
                });
            }
        }
    }

    ui.editHabitSaveBtn.disabled = isBlockingError;
    return isValid;
}

function applySafeIconToEditForm(rawIcon: string) {
    if (!state.editingHabit) return;
    const safeIcon = sanitizeHabitIcon(rawIcon, '❓');
    state.editingHabit.formData.icon = safeIcon;
    setTrustedSvgContent(ui.habitIconPickerBtn, safeIcon);
}

// --- EXPORTED HANDLERS ---

export const handleHabitNameInput = () => {
    if (!state.editingHabit) return;

    const habitNameInput = ui.editHabitForm.elements.namedItem('habit-name') as HTMLInputElement;
    const rawName = habitNameInput.value;
    const newName = sanitizeText(rawName, MAX_HABIT_NAME_LENGTH);
    if (newName !== rawName) habitNameInput.value = newName;

    if (state.editingHabit.formData.nameKey) {
        delete state.editingHabit.formData.nameKey;
        state.editingHabit.formData.subtitleKey = 'customHabitSubtitle';
        if (ui.habitSubtitleDisplay) {
            setTextContent(ui.habitSubtitleDisplay, t('customHabitSubtitle'));
        }
    }

    state.editingHabit.formData.name = newName;

    validateAndFeedback(newName);
};

export const handleIconPickerClick = () => {
    renderIconPicker();
    openModal(ui.iconPickerModal);
};

export const handleIconGridClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLButtonElement>('.icon-picker-item');
    if (item && state.editingHabit) {
        triggerHaptic('light');
        applySafeIconToEditForm(item.dataset.iconSvg!);
        closeModal(ui.iconPickerModal);
    }
};

export const handleColorGridClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const swatch = target.closest<HTMLButtonElement>('.color-swatch');
    if (swatch && state.editingHabit) {
        triggerHaptic('light');
        const color = swatch.dataset.color!;

        state.editingHabit.formData.color = color;

        const iconColor = getContrastColor(color);
        ui.habitIconPickerBtn.style.backgroundColor = color;
        ui.habitIconPickerBtn.style.color = iconColor;

        ui.colorPickerGrid.querySelector('.selected')?.classList.remove('selected');
        swatch.classList.add('selected');

        ui.iconPickerGrid.style.setProperty('--current-habit-bg-color', color);
        ui.iconPickerGrid.style.setProperty('--current-habit-fg-color', iconColor);

        ui.iconPickerModal.classList.remove('is-picking-color');

        closeModal(ui.colorPickerModal, true);
    }
};

export const handleChangeColorClick = () => {
    renderColorPicker();
    ui.iconPickerModal.classList.add('is-picking-color');
    openModal(ui.colorPickerModal, undefined, () => {
        ui.iconPickerModal.classList.remove('is-picking-color');
        renderIconPicker();
    });
};

export const handleTimeContainerClick = (e: MouseEvent) => {
    if (!state.editingHabit) return;
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.segmented-control-option');
    if (!button) return;

    triggerHaptic('light');
    const time = button.dataset.time as TimeOfDay;
    const currentlySelected = state.editingHabit.formData.times.includes(time);
    const isAttitudinal = state.editingHabit.formData.mode === 'attitudinal';

    if (isAttitudinal) {
        if (currentlySelected) return;
        state.editingHabit.formData.times = [time];
        const options = ui.habitTimeContainer.querySelectorAll<HTMLButtonElement>('.segmented-control-option');
        options.forEach(option => {
            option.classList.toggle('selected', option.dataset.time === time);
        });
        return;
    }

    if (currentlySelected) {
        state.editingHabit.formData.times = state.editingHabit.formData.times.filter(tod => tod !== time);
        button.classList.remove('selected');
    } else {
        state.editingHabit.formData.times.push(time);
        button.classList.add('selected');
    }
};

export const handleFrequencyChange = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!state.editingHabit) return;
    if (state.editingHabit.formData.mode === 'attitudinal') {
        state.editingHabit.formData.frequency = { type: 'daily' };
        return;
    }

    if (target.matches('input[name="frequency-type"]')) {
        const radio = target as HTMLInputElement;
        const type = radio.value as 'daily' | 'interval' | 'specific_days_of_week';

        switch (type) {
            case 'daily':
                state.editingHabit.formData.frequency = { type: 'daily' };
                break;
            case 'specific_days_of_week': {
                const currentFreq = state.editingHabit.formData.frequency;
                const days = currentFreq.type === 'specific_days_of_week' ? currentFreq.days : [];
                state.editingHabit.formData.frequency = { type: 'specific_days_of_week', days };
                break;
            }
            case 'interval': {
                const intervalFreqTpl = FREQUENCIES.find(f => f.value.type === 'interval')!.value as { type: 'interval', unit: 'days' | 'weeks', amount: number };
                const currentIntervalFreq = state.editingHabit.formData.frequency;
                const amount = (currentIntervalFreq.type === 'interval' ? currentIntervalFreq.amount : intervalFreqTpl.amount);
                const unit = (currentIntervalFreq.type === 'interval' ? currentIntervalFreq.unit : intervalFreqTpl.unit);
                state.editingHabit.formData.frequency = { type: 'interval', amount, unit };
                break;
            }
        }
        renderFrequencyOptions();
    } else if (target.closest('.weekday-picker input')) {
        const days = Array.from(ui.frequencyOptionsContainer.querySelectorAll<HTMLInputElement>('.weekday-picker input:checked'))
            .map(el => parseInt(el.dataset.day!, 10));
        state.editingHabit.formData.frequency = { type: 'specific_days_of_week', days };
    }
};

export const handleFrequencyClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('.stepper-btn, .unit-toggle-btn');
    if (!btn || !state.editingHabit || state.editingHabit.formData.mode === 'attitudinal' || state.editingHabit.formData.frequency.type !== 'interval') return;

    const action = btn.dataset.action;
    const currentFreq = state.editingHabit.formData.frequency;
    let { amount, unit } = currentFreq;

    if (action === 'interval-decrement') amount = Math.max(1, amount - 1);
    if (action === 'interval-increment') amount = Math.min(99, amount + 1);
    if (action === 'interval-unit-toggle') unit = unit === 'days' ? 'weeks' : 'days';

    state.editingHabit.formData.frequency = { type: 'interval', amount, unit };
    renderFrequencyOptions();
};
