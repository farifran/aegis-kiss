/**
 * @file services/analysis.test.ts
 * @description Testes para contexto de borda na análise diária por IA.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../state';
import { clearTestState, createTestHabit, addTestNote } from '../tests/test-utils';

vi.mock('./cloud', () => ({
    runWorkerTask: vi.fn(),
}));

vi.mock('./api', () => ({
    apiFetch: vi.fn(),
}));

vi.mock('./persistence', () => ({
    saveState: vi.fn(),
}));

import { runWorkerTask } from './cloud';
import { apiFetch } from './api';
import { checkAndAnalyzeDayContext, getDailyNoteHistoryContext } from './analysis';

describe('🧠 Análise diária IA (analysis.ts)', () => {
    beforeEach(() => {
        clearTestState();
        vi.clearAllMocks();
        Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    });

    describe('getDailyNoteHistoryContext', () => {
        it('deve tratar ausência total de registros como primeira entrada', () => {
            const context = getDailyNoteHistoryContext('2026-02-13');

            expect(context.firstEntry).toBe(true);
            expect(context.historicalDaysWithNotes).toBe(0);
            expect(context.daysBeforeTargetWithNotes).toBe(0);
        });

        it('deve considerar primeira entrada quando só há nota no dia atual', () => {
            const habitId = createTestHabit({ name: 'Diário', time: 'Morning' });
            addTestNote(habitId, '2026-02-13', 'Morning', 'Primeira reflexão.');

            const context = getDailyNoteHistoryContext('2026-02-13');

            expect(context.firstEntry).toBe(true);
            expect(context.historicalDaysWithNotes).toBe(1);
            expect(context.daysBeforeTargetWithNotes).toBe(0);
        });

        it('deve identificar histórico anterior quando há notas em dias passados', () => {
            const habitId = createTestHabit({ name: 'Diário', time: 'Morning' });
            addTestNote(habitId, '2026-02-10', 'Morning', 'Reflexão passada.');
            addTestNote(habitId, '2026-02-13', 'Morning', 'Reflexão de hoje.');

            const context = getDailyNoteHistoryContext('2026-02-13');

            expect(context.firstEntry).toBe(false);
            expect(context.historicalDaysWithNotes).toBe(2);
            expect(context.daysBeforeTargetWithNotes).toBe(1);
        });
    });

    describe('checkAndAnalyzeDayContext', () => {
        it('deve enviar dataContext.firstEntry=true para a IA na primeira reflexão', async () => {
            const habitId = createTestHabit({ name: 'Diário', time: 'Morning' });

            // Garante histórico mínimo de instâncias para passar _hasSufficientHistory
            const supportDates = ['2026-02-07', '2026-02-08', '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12'];
            supportDates.forEach((date) => {
                state.dailyData[date] = {
                    [habitId]: {
                        instances: { Morning: {} },
                        dailySchedule: undefined
                    }
                };
            });
            addTestNote(habitId, '2026-02-13', 'Morning', 'Minha primeira nota de diário.');

            vi.mocked(runWorkerTask).mockResolvedValue({ prompt: 'p', systemInstruction: 's' } as any);
            vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
                analysis: { determined_level: 2 },
                relevant_themes: ['disciplina']
            }), { status: 200 }));

            await checkAndAnalyzeDayContext('2026-02-13');

            expect(runWorkerTask).toHaveBeenCalledTimes(1);
            const [, payload] = vi.mocked(runWorkerTask).mock.calls[0];
            expect(payload.dataContext.firstEntry).toBe(true);
            expect(payload.habitModes).toContain('[mode=');
        });

        it('deve enviar dataContext.firstEntry=false quando já existem notas anteriores', async () => {
            const habitId = createTestHabit({ name: 'Diário', time: 'Morning' });

            const supportDates = ['2026-02-07', '2026-02-08', '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12'];
            supportDates.forEach((date) => {
                state.dailyData[date] = {
                    [habitId]: {
                        instances: { Morning: {} },
                        dailySchedule: undefined
                    }
                };
            });
            addTestNote(habitId, '2026-02-10', 'Morning', 'Nota antiga.');
            addTestNote(habitId, '2026-02-13', 'Morning', 'Nota de hoje.');

            vi.mocked(runWorkerTask).mockResolvedValue({ prompt: 'p', systemInstruction: 's' } as any);
            vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
                analysis: { determined_level: 2 },
                relevant_themes: ['disciplina']
            }), { status: 200 }));

            await checkAndAnalyzeDayContext('2026-02-13');

            expect(runWorkerTask).toHaveBeenCalledTimes(1);
            const [, payload] = vi.mocked(runWorkerTask).mock.calls[0];
            expect(payload.dataContext.firstEntry).toBe(false);
            expect(payload.dataContext.daysBeforeTargetWithNotes).toBe(1);
        });
    });
});
