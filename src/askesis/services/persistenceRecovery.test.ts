/**
 * @file services/persistenceRecovery.test.ts
 * @description Rede de segurança da migração no boot.
 *
 * O snapshot durável em IndexedDB só é gravado quando há upgrade de schema de
 * verdade. Nas aberturas comuns — a esmagadora maioria — a recuperação vem de
 * uma cópia em memória, e é justamente ela que este arquivo prende: se a
 * sanitização de `migrateState` estourar no meio, o boot precisa devolver o
 * estado anterior em vez de morrer ou hidratar um objeto meio mutado.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APP_VERSION, state } from '../state';
import { clearTestState } from '../tests/test-utils';

vi.mock('../render', () => ({
    clearHabitDomCache: vi.fn(),
    resetGradeBaseline: vi.fn(),
    renderAINotificationState: vi.fn(),
    updateDayVisuals: vi.fn(),
    closeModal: vi.fn(),
    showConfirmationModal: vi.fn(),
    openModal: vi.fn(),
}));

vi.mock('./migration', () => ({ migrateState: vi.fn() }));

import { loadState } from './persistence';
import { migrateState } from './migration';

function estadoDaNuvem(version: number) {
    return {
        version,
        lastModified: 1000,
        habits: [{
            id: 'h1',
            createdOn: '2026-01-01',
            scheduleHistory: [{
                startDate: '2026-01-01', name: 'Ler', icon: '📖', color: '#8b5cf6',
                times: ['Morning'], goal: { type: 'check' }, frequency: { type: 'daily' }
            }]
        }],
        dailyData: {},
        archives: {},
        dailyDiagnoses: {},
        notificationsShown: [],
        pending21DayHabitIds: [],
        pendingConsolidationHabitIds: [],
        hasOnboarded: true,
        syncLogs: [],
        quests: [],
        monthlyLogs: new Map<string, bigint>([['h1_2026-01', 7n]]),
        aiDailyCount: 0,
        aiQuotaDate: '2026-01-01',
        lastAIContextHash: null
    } as any;
}

describe('🛟 Recuperação de migração no boot', () => {
    beforeEach(() => {
        clearTestState();
        vi.clearAllMocks();
    });

    it('hidrata normalmente quando não há nada a migrar', async () => {
        vi.mocked(migrateState).mockImplementation((s: any) => s);

        const resultado = await loadState(estadoDaNuvem(APP_VERSION));

        expect(resultado).toBeTruthy();
        expect(state.habits).toHaveLength(1);
        expect(state.monthlyLogs.get('h1_2026-01')).toBe(7n);
    });

    it('devolve o estado anterior quando a migração estoura sem upgrade de schema', async () => {
        // Mutação parcial antes do erro: é o cenário que a cópia em memória
        // existe para desfazer. Hidratar o objeto meio mutado apagaria hábitos.
        vi.mocked(migrateState).mockImplementation((s: any) => {
            s.habits = [];
            s.monthlyLogs = new Map();
            throw new Error('sanitização falhou');
        });

        const resultado = await loadState(estadoDaNuvem(APP_VERSION));

        expect(resultado).toBeTruthy();
        expect(resultado!.habits).toHaveLength(1);
        expect(state.habits).toHaveLength(1);
        expect(state.monthlyLogs.get('h1_2026-01')).toBe(7n);
    });

    it('devolve um Map de logs mesmo quando o estado restaurado traz o Record cru', async () => {
        // O estado pré-migração carrega `monthlyLogs` como veio do disco: hex por
        // chave, não Map. Hidratar isso direto deixaria o HabitService com um
        // objeto simples onde ele chama `.get`/`.set` — histórico invisível.
        const bruto = estadoDaNuvem(APP_VERSION);
        bruto.monthlyLogs = { 'h1_2026-01': '0x7' } as any;

        vi.mocked(migrateState).mockImplementation(() => { throw new Error('sanitização falhou'); });

        await loadState(bruto);

        expect(state.monthlyLogs).toBeInstanceOf(Map);
        expect(state.monthlyLogs.get('h1_2026-01')).toBe(7n);
    });

    it('propaga o erro quando a migração de verdade falha e não há snapshot em disco', async () => {
        // Com upgrade de schema o resgate é o snapshot durável; sem IndexedDB no
        // ambiente de teste ele não existe, e o erro precisa subir em vez de
        // hidratar silenciosamente um estado quebrado.
        vi.mocked(migrateState).mockImplementation(() => { throw new Error('bitmask v8→v9 falhou'); });

        await expect(loadState(estadoDaNuvem(APP_VERSION - 1))).rejects.toThrow('bitmask');
    });
});
