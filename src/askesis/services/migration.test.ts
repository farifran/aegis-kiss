/**
 * @file services/migration.test.ts
 * @description Testes para o módulo de migração de schema.
 * P0 - Crítico: Corrupção silenciosa de dados se migração falhar.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { migrateState } from './migration';
import { APP_VERSION } from '../state';
import { CUSTOM_QUEST_MAX_TARGET } from '../constants';

describe('🔄 Migração de Schema (migration.ts)', () => {

    describe('Fresh Install (null state)', () => {
        it('deve retornar estado padrão quando loadedState é null', () => {
            const result = migrateState(null, APP_VERSION);

            expect(result).toBeDefined();
            expect(result.version).toBe(APP_VERSION);
            expect(result.habits).toEqual([]);
            expect(result.dailyData).toEqual({});
            expect(result.archives).toEqual({});
            expect(result.dailyDiagnoses).toEqual({});
            expect(result.monthlyLogs).toBeInstanceOf(Map);
            expect(result.monthlyLogs.size).toBe(0);
            expect(result.syncLogs).toEqual([]);
            expect(result.hasOnboarded).toBe(true);
            expect(result.aiDailyCount).toBe(0);
            expect(result.lastAIContextHash).toBeNull();
        });

        it('deve retornar estado padrão para undefined', () => {
            const result = migrateState(undefined, APP_VERSION);
            expect(result.version).toBe(APP_VERSION);
            expect(result.habits).toEqual([]);
        });

        it('deve retornar estado padrão para string vazia', () => {
            const result = migrateState('', APP_VERSION);
            expect(result.version).toBe(APP_VERSION);
        });

        it('deve retornar estado padrão para 0', () => {
            const result = migrateState(0, APP_VERSION);
            expect(result.version).toBe(APP_VERSION);
        });
    });

    describe('Hidratação de monthlyLogs (Map/BigInt)', () => {
        // Os logs são serializados em HEXADECIMAL (`HabitService.serializeLogValue`).
        // O prefixo `0x` é opcional: o binário legado do IndexedDB foi gravado sem ele.
        it('deve hidratar Object entries (hex com prefixo) para Map<string, bigint>', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                dailyData: {},
                monthlyLogs: {
                    'habit1-2024-01': '0xff',
                    'habit2-2024-02': '0x3ff'
                }
            };

            const result = migrateState(loaded, APP_VERSION);

            expect(result.monthlyLogs).toBeInstanceOf(Map);
            expect(result.monthlyLogs.get('habit1-2024-01')).toBe(255n);
            expect(result.monthlyLogs.get('habit2-2024-02')).toBe(1023n);
        });

        it('deve hidratar hex legado sem prefixo 0x', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: [
                    ['habit1-2024-01', 'ff'],
                    ['habit2-2024-02', '3ff']
                ]
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs).toBeInstanceOf(Map);
            expect(result.monthlyLogs.get('habit1-2024-01')).toBe(255n);
            expect(result.monthlyLogs.get('habit2-2024-02')).toBe(1023n);
        });

        it('deve hidratar um mês cheio (279 bits / 70 dígitos hex) sem truncar', () => {
            // Regressão: um limite de 64 dígitos descartava silenciosamente
            // qualquer log com marcações a partir do dia ~29.
            const fullMonth = (1n << 279n) - 1n;
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: { 'habit1-2024-01': '0x' + fullMonth.toString(16) }
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs.get('habit1-2024-01')).toBe(fullMonth);
        });

        it('deve hidratar formato do worker { __type: "bigint", val: "<decimal>" }', () => {
            // `sync.worker.ts` serializa via `bigint.toString()`, ou seja, DECIMAL.
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: {
                    'key1': { __type: 'bigint', val: '999' }
                }
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs.get('key1')).toBe(999n);
        });

        it('deve criar Map vazio quando monthlyLogs é null', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: null
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs).toBeInstanceOf(Map);
            expect(result.monthlyLogs.size).toBe(0);
        });

        it('deve manter Map existente sem alteração', () => {
            const existingMap = new Map([['k1', 42n]]);
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: existingMap
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs).toBe(existingMap);
            expect(result.monthlyLogs.get('k1')).toBe(42n);
        });

        it('deve lidar graciosamente com valores inválidos de BigInt', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: {
                    'key1': 'não-é-número'
                }
            };

            // Deve capturar o erro e criar Map vazio (graceful degradation)
            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs).toBeInstanceOf(Map);
        });
    });

    describe('Migração V8 → V9 (Bitmask Expansion 6-bit → 9-bit)', () => {
        it('deve expandir bitmasks de 6-bit para 9-bit por dia', () => {
            // Simula logs de V8 com status para dia 1
            // V8: Manhã=pos0-1, Tarde=pos2-3, Noite=pos4-5 
            // Status DONE=1 (0b01) para manhã
            const v8Log = 1n; // Status 1 na posição 0 (Manhã, dia 1)

            const loaded = {
                version: 8,
                habits: [],
                monthlyLogs: new Map([['habit1-2024-01', v8Log]])
            };

            const result = migrateState(loaded, APP_VERSION);

            // V9: Manhã=pos0-2, Tarde=pos3-5, Noite=pos6-8
            // Status DONE(1) na Manhã do dia 1 → bit position 0, valor 1
            const migrated = result.monthlyLogs.get('habit1-2024-01')!;
            // O status 1 (DONE) na Manhã do dia 1 deve estar na posição 0 com 3 bits
            const day1MorningStatus = Number((migrated >> 0n) & 7n); // 3 bits for V9
            expect(day1MorningStatus).toBe(1); // DONE
        });

        it('deve preservar múltiplos status em V8→V9', () => {
            // V8: Dia 1, Manhã=DONE(1), Tarde=DEFERRED(2)
            // Manhã pos 0-1: 0b01 = 1n
            // Tarde pos 2-3: 0b10 = (2n << 2n)
            const v8Log = 1n | (2n << 2n); // = 0b1001 = 9n

            const loaded = {
                version: 8,
                habits: [],
                monthlyLogs: new Map([['h-2024-01', v8Log]])
            };

            const result = migrateState(loaded, APP_VERSION);
            const migrated = result.monthlyLogs.get('h-2024-01')!;

            // V9 positions: Manhã 0-2, Tarde 3-5
            const morning = Number((migrated >> 0n) & 7n);
            const afternoon = Number((migrated >> 3n) & 7n);

            expect(morning).toBe(1); // DONE
            expect(afternoon).toBe(2); // DEFERRED
        });

        it('não deve migrar bitmasks se versão >= 9', () => {
            const v9Log = 42n;
            const loaded = {
                version: 9,
                habits: [],
                monthlyLogs: new Map([['h-2024-01', v9Log]])
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.monthlyLogs.get('h-2024-01')).toBe(v9Log);
        });
    });

    describe('Campos de AI Quota (V9 → V10)', () => {
        it('deve inicializar campos de quota AI quando ausentes', () => {
            const loaded = {
                version: 9,
                habits: [],
                monthlyLogs: new Map()
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.aiDailyCount).toBe(0);
            expect(result.aiQuotaDate).toBeDefined();
            expect(result.lastAIContextHash).toBeNull();
        });

        it('deve preservar campos de quota existentes', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: new Map(),
                aiDailyCount: 3,
                aiQuotaDate: '2025-01-15',
                lastAIContextHash: 'abc123'
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.aiDailyCount).toBe(3);
        });
    });

    describe('Defaults e campos faltantes', () => {
        it('deve inicializar hasOnboarded como true quando ausente', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: new Map()
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.hasOnboarded).toBe(true);
        });

        it('deve inicializar syncLogs como array vazio quando ausente', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: new Map()
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.syncLogs).toEqual([]);
        });

        it('deve sanitizar syncLogs para manter apenas campos válidos', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [],
                monthlyLogs: new Map(),
                syncLogs: [
                    { time: 123, msg: 'test', type: 'info', extraField: 'should be stripped' },
                    { time: 456, msg: 'test2', type: 'success' }
                ]
            };

            const result = migrateState(loaded, APP_VERSION);
            expect(result.syncLogs).toHaveLength(2);
            expect(result.syncLogs[0]).toEqual({ time: 123, msg: 'test', type: 'info' });
            expect((result.syncLogs[0] as any).extraField).toBeUndefined();
        });

        it('deve normalizar mode em scheduleHistory e limitar times em attitudinal', () => {
            const loaded = {
                version: APP_VERSION,
                habits: [
                    {
                        id: 'h-1',
                        createdOn: '2025-01-01',
                        scheduleHistory: [
                            {
                                startDate: '2025-01-01',
                                icon: '🧠',
                                color: '#fff',
                                goal: { type: 'check' },
                                frequency: { type: 'daily' },
                                scheduleAnchor: '2025-01-01',
                                times: ['Morning', 'Evening']
                            },
                            {
                                startDate: '2025-01-02',
                                icon: '🧠',
                                color: '#fff',
                                goal: { type: 'check' },
                                frequency: { type: 'daily' },
                                scheduleAnchor: '2025-01-02',
                                mode: 'attitudinal',
                                times: ['Evening', 'Morning']
                            }
                        ]
                    }
                ],
                monthlyLogs: new Map()
            };

            const result = migrateState(loaded, APP_VERSION);
            const [first, second] = result.habits[0].scheduleHistory;

            expect(first.mode).toBe('scheduled');
            expect(first.times).toEqual(['Morning', 'Evening']);
            expect(second.mode).toBe('attitudinal');
            expect(second.times).toEqual(['Evening']);
            expect(second.frequency).toEqual({ type: 'daily' });
        });

        it('deve forçar versão target no resultado', () => {
            const loaded = {
                version: 5,
                habits: [],
                monthlyLogs: new Map()
            };

            const result = migrateState(loaded, 99);
            expect(result.version).toBe(99);
        });
    });

    describe('Objetivos secundários vindos de fora (V11 → V12)', () => {
        /** Estado mínimo com um objetivo personalizado de alvo arbitrário. */
        function comAlvo(customTarget: unknown) {
            return migrateState({
                version: 11,
                habits: [],
                dailyData: {},
                quests: [{ id: 'custom:x', startedOn: '2026-01-01', days: [], customTarget }]
            }, APP_VERSION);
        }

        it('prende o alvo na mesma faixa que o formulário impõe', () => {
            // REGRESSÃO: aceitar "qualquer número finito" deixava passar 0, e
            // `getQuestStepXp` dividia por zero. O NaN atravessava a soma de XP
            // até `gradeFromXp`, cujo laço não sai enquanto a comparação for
            // falsa — um backup importado promovia ao grau máximo.
            expect(comAlvo(0).quests[0].customTarget).toBe(1);
            expect(comAlvo(-7).quests[0].customTarget).toBe(1);
            expect(comAlvo(3.7).quests[0].customTarget).toBe(3);
            expect(comAlvo(1e9).quests[0].customTarget).toBe(CUSTOM_QUEST_MAX_TARGET);
        });

        it('descarta alvo que não é número, sem inventar um', () => {
            expect(comAlvo('12').quests[0].customTarget).toBeUndefined();
            expect(comAlvo(NaN).quests[0].customTarget).toBeUndefined();
            expect(comAlvo(Infinity).quests[0].customTarget).toBeUndefined();
        });

        it('estado anterior à v12 ganha a lista vazia, não undefined', () => {
            const result = migrateState({ version: 11, habits: [], dailyData: {} }, APP_VERSION);
            expect(result.quests).toEqual([]);
        });
    });
});
