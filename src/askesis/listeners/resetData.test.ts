/**
 * @file listeners/resetData.test.ts
 * @description Testes do fluxo de "Apagar dados" nas Configurações Gerais.
 *
 * O botão tem um alcance só: zera a conta inteira e mantém a sincronização.
 * Sair da conta é trabalho do "Desativar sincronização", noutro lugar da tela.
 * O que se testa aqui é que a confirmação descreve o alcance certo — inclusive
 * quando não há conta nenhuma — e que a falha do purge aparece em vez de sumir.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const _btn = () => ({ addEventListener: vi.fn() });
const _cls = () => ({ classList: { contains: vi.fn(() => false), toggle: vi.fn() } });

const mockShowConfirmationModal = vi.fn();
vi.mock('../render', () => ({
    updateNotificationUI: vi.fn(),
    openModal: vi.fn(),
    closeModal: vi.fn(),
    setupManageModal: vi.fn(),
    renderExploreHabits: vi.fn(),
    showConfirmationModal: (...args: any[]) => mockShowConfirmationModal(...args),
    renderLanguageFilter: vi.fn(),
    openEditModal: vi.fn(),
}));

vi.mock('../render/dom', () => ({ setTextContent: vi.fn() }));
vi.mock('../render/rotary', () => ({ setupReelRotary: vi.fn() }));

vi.mock('../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils')>();
    return {
        ...actual,
        triggerHaptic: vi.fn(),
        logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };
});

vi.mock('../i18n', () => ({
    t: (key: string) => key,
    setLanguage: vi.fn(),
    getAiLanguageName: vi.fn(),
}));

vi.mock('../services/push', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/push')>();
    return {
        ...actual,
        ensureOneSignalReady: vi.fn(),
        setLocalPushOptIn: vi.fn(),
        getLocalPushOptIn: vi.fn(() => null),
    };
});

vi.mock('../services/api', () => ({ hasLocalSyncKey: vi.fn(() => true) }));

vi.mock('../services/habitActions', () => ({
    saveHabitFromModal: vi.fn(),
    requestHabitEndingFromModal: vi.fn(),
    requestHabitPermanentDeletion: vi.fn(),
    resetDeviceData: vi.fn(async () => {}),
    resetAccountData: vi.fn(async () => {}),
    handleSaveNote: vi.fn(),
    graduateHabit: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
}));

vi.mock('../state', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../state')>();
    return { ...actual, LANGUAGES: [{ code: 'pt', nameKey: 'langPt' }] };
});

vi.mock('./modals/aiHandlers', () => ({
    handleAiEvalClick: vi.fn(),
    handleAiOptionsClick: vi.fn(),
}));

vi.mock('./modals/fullCalendarHandlers', () => ({
    handleFullCalendarPrevClick: vi.fn(),
    handleFullCalendarNextClick: vi.fn(),
    handleFullCalendarGridClick: vi.fn(),
    handleFullCalendarGridKeydown: vi.fn(),
}));

vi.mock('./modals/formHandlers', () => ({
    handleHabitNameInput: vi.fn(),
    handleIconPickerClick: vi.fn(),
    handleIconGridClick: vi.fn(),
    handleColorGridClick: vi.fn(),
    handleChangeColorClick: vi.fn(),
    handleTimeContainerClick: vi.fn(),
    handleFrequencyChange: vi.fn(),
    handleFrequencyClick: vi.fn(),
}));

vi.mock('../data/predefinedHabits', () => ({ PREDEFINED_HABITS: [] }));

const resetAppBtn = _btn();
vi.mock('../render/ui', () => ({
    ui: {
        notificationToggle: { checked: false, disabled: false, ..._btn() },
        notificationToggleLabel: { classList: { toggle: vi.fn(), contains: vi.fn(() => false) } },
        notificationStatusDesc: { textContent: '' },
        manageHabitsBtn: _btn(),
        fabAddHabit: _btn(),
        habitList: _btn(),
        manageModal: { ..._btn(), ..._cls() },
        get resetAppBtn() { return resetAppBtn; },
        languageViewport: {},
        languageReel: {},
        languagePrevBtn: _btn(),
        languageNextBtn: _btn(),
        exploreHabitList: _btn(),
        createCustomHabitBtn: _btn(),
        aiEvalBtn: _btn(),
        aiOptionsModal: _btn(),
        confirmModalConfirmBtn: _btn(),
        confirmModalEditBtn: _btn(),
        saveNoteBtn: _btn(),
        fullCalendarPrevBtn: _btn(),
        fullCalendarNextBtn: _btn(),
        fullCalendarGrid: _btn(),
        editHabitSaveBtn: _btn(),
        editHabitForm: { elements: { namedItem: vi.fn(() => ({ maxLength: 0, addEventListener: vi.fn() })) } },
        habitIconPickerBtn: _btn(),
        iconPickerGrid: _btn(),
        colorPickerGrid: _btn(),
        changeColorFromPickerBtn: _btn(),
        habitTimeContainer: _btn(),
        frequencyOptionsContainer: _btn(),
        exploreModal: _cls(),
        confirmModal: _cls(),
    },
}));

import { hasLocalSyncKey } from '../services/api';
import { resetAccountData } from '../services/habitActions';

type ModalCall = [string, () => void, Record<string, any> | undefined];

/** Dispara o clique em "Apagar dados" e devolve o modal aberto. */
async function clickResetButton(): Promise<ModalCall> {
    const { setupModalListeners } = await import('./modals');
    setupModalListeners();

    const handler = resetAppBtn.addEventListener.mock.calls
        .find(([event]) => event === 'click')?.[1] as () => void;
    expect(handler).toBeTypeOf('function');

    handler();
    return mockShowConfirmationModal.mock.calls.at(-1) as ModalCall;
}

/** O encadeamento entre modais passa por microtask; deixa a fila drenar. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('🧹 Apagar dados', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(hasLocalSyncKey).mockReturnValue(true);
    });

    it('confirma antes de apagar, dizendo que a conta inteira é zerada', async () => {
        const [text, applyReset, opts] = await clickResetButton();

        expect(text).toBe('confirmResetData');
        expect(opts?.confirmText).toBe('modalManageResetButton');
        expect(resetAccountData).not.toHaveBeenCalled();

        applyReset();
        expect(resetAccountData).toHaveBeenCalledTimes(1);
    });

    it('sem chave de sync, o texto fala só deste aparelho', async () => {
        // Não existe conta a reiniciar: prometer "todos os aparelhos" seria
        // descrever um alcance que não existe.
        vi.mocked(hasLocalSyncKey).mockReturnValue(false);

        const [text, applyReset] = await clickResetButton();
        expect(text).toBe('confirmResetLocal');

        applyReset();
        expect(resetAccountData).toHaveBeenCalledTimes(1);
    });

    it('avisa quando o purge falha, em vez de apagar em silêncio', async () => {
        vi.mocked(resetAccountData).mockRejectedValueOnce(new Error('KV down'));

        const [, applyReset] = await clickResetButton();
        applyReset();
        await flush();

        const [errorText, , errorOpts] = mockShowConfirmationModal.mock.calls.at(-1) as ModalCall;
        expect(errorText).toBe('resetAccountError');
        expect(errorOpts?.hideCancel).toBe(true);
    });

    it('não abre modal de erro quando não havia conta para purgar', async () => {
        // Sem conta a falha só pode ser local, e o texto de nuvem mentiria.
        vi.mocked(hasLocalSyncKey).mockReturnValue(false);
        vi.mocked(resetAccountData).mockRejectedValueOnce(new Error('IDB down'));

        const [, applyReset] = await clickResetButton();
        const antes = mockShowConfirmationModal.mock.calls.length;
        applyReset();
        await flush();

        expect(mockShowConfirmationModal.mock.calls.length).toBe(antes);
    });
});
