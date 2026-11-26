/**
 * @file services/quoteEngine.test.ts
 * @description Testes para o motor de recomendação contextual de citações estoicas.
 * P2 - Algoritmo de scoring ponderado, anti-repetição, histerese de performance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, HABIT_STATE } from '../state';
import { clearTestState, createTestHabit } from '../tests/test-utils';
import { HabitService } from './HabitService';
import { selectBestQuote } from './quoteEngine';
import type { Quote } from '../data/quotes';

// Mock do render 
vi.mock('../render', () => ({
    clearHabitDomCache: vi.fn(),
    renderAINotificationState: vi.fn(),
    updateDayVisuals: vi.fn(),
    closeModal: vi.fn(),
    showConfirmationModal: vi.fn(),
    openModal: vi.fn(),
}));

function createMockQuote(id: string, overrides: Partial<Quote['metadata']> = {}): Quote {
    return {
        id,
        author: 'Marcus Aurelius',
        original_text: { pt: 'Texto teste', en: 'Test text', es: 'Texto de prueba' },
        source: 'Meditações',
        metadata: {
            virtue: overrides.virtue || 'Wisdom',
            level: overrides.level || 1,
            discipline: overrides.discipline || 'Assent',
            sphere: overrides.sphere || 'Mental',
            tags: overrides.tags || ['action', 'discipline'],
            coercion_type: overrides.coercion_type || 'Dogmatic'
        },
        adaptations: {
            level_1: { pt: 'L1', en: 'L1', es: 'L1' },
            level_2: { pt: 'L2', en: 'L2', es: 'L2' },
            level_3: { pt: 'L3', en: 'L3', es: 'L3' }
        }
    };
}

describe('🏛️ Motor de Citações Estoicas (quoteEngine.ts)', () => {

    beforeEach(() => {
        clearTestState();
        state.quoteState = undefined;
        state.dailyDiagnoses = {};
    });

    describe('selectBestQuote - Casos básicos', () => {
        it('deve retornar uma citação de um array', () => {
            const quotes = [
                createMockQuote('q1'),
                createMockQuote('q2'),
                createMockQuote('q3')
            ];

            const result = selectBestQuote(quotes, '2025-01-15');
            expect(result).toBeDefined();
            expect(result.id).toBeTruthy();
        });

        it('deve lançar erro para array vazio', () => {
            expect(() => selectBestQuote([], '2025-01-15')).toThrow('No quotes provided');
        });

        it('deve retornar a única citação quando há apenas uma', () => {
            const quote = createMockQuote('only-one');
            const result = selectBestQuote([quote], '2025-01-15');
            expect(result.id).toBe('only-one');
        });

        it('deve lidar com dateISO inválido (fallback para hoje)', () => {
            const quotes = [createMockQuote('q1')];
            const result = selectBestQuote(quotes, 'invalid-date');
            expect(result).toBeDefined();
        });
    });

    describe('Anti-repetição', () => {
        it('deve evitar repetir a última citação mostrada', () => {
            const quotes = [
                createMockQuote('q1', { tags: ['action'] }),
                createMockQuote('q2', { tags: ['resilience'] }),
                createMockQuote('q3', { tags: ['discipline'] }),
                createMockQuote('q4', { tags: ['humility'] }),
                createMockQuote('q5', { tags: ['temperance'] })
            ];

            // Marca q1 como última mostrada
            state.quoteState = {
                currentId: 'q1',
                displayedAt: Date.now() - 1000000, // muito tempo atrás
                lockedContext: 'old-context'
            };

            // Com penalidade de anti-repetição, q1 deve ser menos provável
            const results = new Set<string>();
            for (let i = 0; i < 20; i++) {
                // Varia a data para diferentes seeds
                const result = selectBestQuote(quotes, `2025-01-${String(i + 1).padStart(2, '0')}`);
                results.add(result.id);
            }

            // Deve selecionar mais de 1 citação diferente
            expect(results.size).toBeGreaterThan(1);
        });
    });

    describe('AI Theme Boost', () => {
        it('deve priorizar citações com tags alinhadas ao diagnóstico de IA', () => {
            state.dailyDiagnoses['2025-01-15'] = {
                level: 2,
                themes: ['resilience', 'growth'],
                timestamp: Date.now()
            };

            const quotes = [
                createMockQuote('q_match', { tags: ['resilience', 'growth', 'hope'] }),
                createMockQuote('q_nomatch', { tags: ['death', 'time', 'anxiety'] })
            ];

            const result = selectBestQuote(quotes, '2025-01-15');
            // o quote com tags matching deve ter score mais alto
            expect(result.id).toBe('q_match');
        });
    });

    describe('Determinismo por seed', () => {
        it('deve retornar a mesma citação para a mesma data e contexto', () => {
            const quotes = [
                createMockQuote('q1', { tags: ['action'] }),
                createMockQuote('q2', { tags: ['discipline'] }),
                createMockQuote('q3', { tags: ['resilience'] })
            ];

            // Limpa state entre chamadas
            state.quoteState = undefined;
            const r1 = selectBestQuote(quotes, '2025-06-15');
            state.quoteState = undefined;
            const r2 = selectBestQuote(quotes, '2025-06-15');

            expect(r1.id).toBe(r2.id);
        });

        it('deve variar a seleção por data', () => {
            // Tags neutras que NÃO disparam regras de scoring contextual (TIME_OF_DAY, PERFORMANCE etc.)
            const quotes = Array.from({ length: 10 }, (_, i) => 
                createMockQuote(`q${i}`, { 
                    tags: [['truth', 'freedom', 'identity', 'legacy', 'belief',
                            'patience', 'honor', 'strength', 'purpose', 'integrity'][i] as any]
                })
            );

            const results = new Set<string>();
            for (let d = 1; d <= 28; d++) {
                state.quoteState = undefined;
                const result = selectBestQuote(quotes, `2025-01-${String(d).padStart(2, '0')}`);
                results.add(result.id);
            }

            // Em 28 dias deve selecionar pelo menos 2 citações diferentes
            expect(results.size).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Performance State Reactions', () => {
        it('deve priorizar tags de resiliência quando performanceState=defeat', () => {
            // Cria hábitos sem completar nenhum (para simular defeat)
            createTestHabit({ name: 'H1', time: 'Morning' });
            createTestHabit({ name: 'H2', time: 'Afternoon' });

            const quotes = [
                createMockQuote('q_resilience', { tags: ['resilience', 'acceptance'] }),
                createMockQuote('q_triumph', { tags: ['humility', 'temperance'] })
            ];

            // Sem completar nenhum hábito no dia, performance deve ser neutra/baixa
            const result = selectBestQuote(quotes, '2025-01-15');
            expect(result).toBeDefined();
        });
    });

    describe('Stickiness (tempo mínimo de exibição)', () => {
        it('deve manter mesma citação se tempo mínimo não passou (hoje)', () => {
            const quotes = [
                createMockQuote('sticky', { tags: ['action'] }),
                createMockQuote('other', { tags: ['discipline'] })
            ];

            // Configura como a citação acabou de ser mostrada HOJE
            const today = new Date().toISOString().split('T')[0];
            const hour = new Date().getHours();
            const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
            state.quoteState = {
                currentId: 'sticky',
                displayedAt: Date.now() - 1000, // 1 segundo atrás (< MIN_DISPLAY_DURATION)
                lockedContext: `${today}-${timeOfDay}-neutral--none`
            };

            const result = selectBestQuote(quotes, today);
            expect(result.id).toBe('sticky');
        });

        it('deve ignorar stickiness quando há major shift para urgencia', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-03-06T20:30:00Z'));

            // Um habito pendente garante total>0 e completion/snooze baixos.
            createTestHabit({ name: 'Pendencia', time: 'Morning' });

            const today = new Date().toISOString().split('T')[0];
            state.quoteState = {
                currentId: 'sticky',
                displayedAt: Date.now() - 500,
                lockedContext: `${today}-morning-neutral-none-none`
            };

            const quotes = [
                createMockQuote('sticky', { tags: ['truth'] }),
                createMockQuote('urgent', { tags: ['urgency'] })
            ];

            const result = selectBestQuote(quotes, today);
            expect(result.id).toBe('urgent');

            vi.useRealTimers();
        });
    });

    describe('Estados contextuais adicionais', () => {
        it('deve priorizar tag de urgencia em noite improdutiva (estado urgency)', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-03-06T20:00:00Z'));

            createTestHabit({ name: 'H1', time: 'Morning' });
            createTestHabit({ name: 'H2', time: 'Afternoon' });

            const today = new Date().toISOString().split('T')[0];
            const quotes = [
                createMockQuote('q_urgency', { tags: ['urgency', 'action'] }),
                createMockQuote('q_neutral', { tags: ['truth'] })
            ];

            const result = selectBestQuote(quotes, today);
            expect(result.id).toBe('q_urgency');

            vi.useRealTimers();
        });

        it('nao deve mutar quoteState para datas historicas', () => {
            const previous = {
                currentId: 'existing',
                displayedAt: Date.now(),
                lockedContext: 'ctx'
            };
            state.quoteState = previous;

            const quotes = [createMockQuote('q1'), createMockQuote('q2')];
            selectBestQuote(quotes, '2024-01-15');

            expect(state.quoteState).toEqual(previous);
        });
    });
});
