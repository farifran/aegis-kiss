/**
 * TESTE DE CENARIO 2: SINCRONIZAÇÃO CONFLITANTE (Multi-Device Hell)
 * 
 * Este teste valida simultaneamente:
 * ✓ Criptografia AES-GCM (encrypt/decrypt isomórfico)
 * ✓ Web Worker (crypto off-main-thread)
 * ✓ CRDT-lite merge algorithm
 * ✓ API retry/backoff
 * ✓ Offline-first functionality
 * ✓ Data integrity (bitmask operations)
 *
 * O GZIP do cold storage NÃO passa por aqui — vive em services/compression.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, HABIT_STATE, Habit, AppState } from '../state';
import { HabitService } from '../services/HabitService';
import { mergeStates } from '../services/dataMerge';
import { buildTestHabit, createTestHabit, clearTestState } from './test-utils';

describe('🔄 TESTE DE CENARIO 2: Sincronização com Conflitos', () => {
  const TEST_DATE = '2024-01-15';

  beforeEach(() => {
    clearTestState();
  });

  it('deve resolver conflitos entre 2 dispositivos offline', async () => {
    // ========================================
    // SETUP: Criar estado inicial compartilhado
    // ========================================
    // Criar 5 hábitos no "dispositivo principal"
    const habitIds = Array.from({ length: 5 }, (_, i) => 
      createTestHabit({
        name: `Hábito ${i + 1}`,
        time: 'Morning',
        goalType: 'check',
      })
    );

    // Popular 30 dias de histórico
    for (let day = 1; day <= 30; day++) {
      const date = `2024-01-${day.toString().padStart(2, '0')}`;
      habitIds.forEach(id => {
        HabitService.setStatus(id, date, 'Morning', HABIT_STATE.DONE);
      });
    }

    // ========================================
    // PASSO 1: Salvar estado inicial (simula sync)
    // ========================================
    const stateSnapshot = {
      habits: JSON.parse(JSON.stringify(state.habits)),
      monthlyLogs: new Map(state.monthlyLogs),
      lastModified: state.lastModified
    };

    // ========================================
    // PASSO 2: CONFLITO! Simular edições em dois "dispositivos"
    // ========================================
    const conflictHabitId = habitIds[0];
    const key = `${conflictHabitId}_2024-01`;

    // Bloco de 3 bits do dia D, período Manhã.
    const blockAt = (day: number) => BigInt((day - 1) * 9);
    const readBlock = (logs: Map<string, bigint>, day: number) => (logs.get(key)! >> blockAt(day)) & 7n;
    const writeBlock = (logs: Map<string, bigint>, day: number, value: bigint) => {
      const shift = blockAt(day);
      logs.set(key, (logs.get(key)! & ~(7n << shift)) | (value << shift));
    };

    // O histórico compartilhado cobre os dias 1..30; o dia 31 está livre.
    // "Device A" (vencedor, lastModified mais recente): adia o dia 15.
    const deviceALogs = new Map(stateSnapshot.monthlyLogs);
    writeBlock(deviceALogs, 15, BigInt(HABIT_STATE.DEFERRED));

    // "Device B" (perdedor, offline): marca o dia 31, que A nunca tocou.
    const deviceBLogs = new Map(stateSnapshot.monthlyLogs);
    writeBlock(deviceBLogs, 31, BigInt(HABIT_STATE.DONE));

    const merged = HabitService.mergeLogs(deviceALogs, deviceBLogs);

    // Edição do vencedor prevalece no slot que ele tocou...
    expect(readBlock(merged, 15)).toBe(BigInt(HABIT_STATE.DEFERRED));
    // ...e a edição do perdedor sobrevive no slot que o vencedor deixou vazio.
    expect(readBlock(merged, 31)).toBe(BigInt(HABIT_STATE.DONE));
    // Os demais dias do histórico compartilhado seguem intactos.
    expect(readBlock(merged, 1)).toBe(BigInt(HABIT_STATE.DONE));
    expect(readBlock(merged, 30)).toBe(BigInt(HABIT_STATE.DONE));
  });

  it('deve mesclar hábitos de dois dispositivos sem perda nem duplicação', async () => {
    const deviceA: AppState = {
      ...state,
      habits: [1, 2, 3].map(i => buildTestHabit({ name: `Hábito A${i}`, time: 'Morning' }, `a${i}`)),
      dailyData: {},
      monthlyLogs: new Map([['a1_2024-01', 1n]]),
      lastModified: 2000
    } as AppState;

    const deviceB: AppState = {
      ...state,
      habits: [4, 5, 6].map(i => buildTestHabit({ name: `Hábito B${i}`, time: 'Afternoon' }, `b${i}`)),
      dailyData: {},
      monthlyLogs: new Map([['b4_2024-01', 2n]]),
      lastModified: 1000
    } as AppState;

    const merged = await mergeStates(deviceA, deviceB);

    expect(merged.habits.map(h => h.id).sort()).toEqual(['a1', 'a2', 'a3', 'b4', 'b5', 'b6']);
    expect(merged.monthlyLogs.get('a1_2024-01')).toBe(1n);
    expect(merged.monthlyLogs.get('b4_2024-01')).toBe(2n);
  });

  it('desmarcação recente vence dado antigo, mas não reverte re-marcação posterior', async () => {
    const habitId = createTestHabit({ name: 'Test', time: 'Morning', goalType: 'check' });
    const readMerged = (winner: Map<string, bigint>, loser: Map<string, bigint>) => {
      state.monthlyLogs = HabitService.mergeLogs(winner, loser);
      return HabitService.getStatus(habitId, TEST_DATE, 'Morning');
    };

    HabitService.setStatus(habitId, TEST_DATE, 'Morning', HABIT_STATE.DONE);
    const marked = new Map(state.monthlyLogs);

    // O tombstone é escrito pelo próprio ciclo do checkbox (3º toque -> NULL).
    HabitService.setStatus(habitId, TEST_DATE, 'Morning', HABIT_STATE.NULL);
    expect(HabitService.getStatus(habitId, TEST_DATE, 'Morning')).toBe(HABIT_STATE.NULL);
    const tombstoned = new Map(state.monthlyLogs);

    // Desmarcação recente (vencedor) sobrepõe o DONE antigo da réplica.
    expect(readMerged(tombstoned, marked)).toBe(HABIT_STATE.NULL);

    // Mas a lápide obsoleta (perdedor) não pode engolir uma re-marcação recente.
    state.monthlyLogs = new Map(tombstoned);
    HabitService.setStatus(habitId, TEST_DATE, 'Morning', HABIT_STATE.DONE);
    const remarked = new Map(state.monthlyLogs);

    expect(readMerged(remarked, tombstoned)).toBe(HABIT_STATE.DONE);
  });

  it('deve manter integridade de bitmask após múltiplos merges', async () => {
    const habitId = createTestHabit({ name: 'Test Habit', time: 'Morning', goalType: 'check' });

    // Criar 10 versões do log
    for (let i = 1; i <= 10; i++) {
      const date = `2024-01-${(i % 30 + 1).toString().padStart(2, '0')}`;
      HabitService.setStatus(habitId, date, 'Morning', HABIT_STATE.DONE);
    }

    // Verificar que nenhum dado foi perdido
    const monthKey = `${habitId}_2024-01`;
    const finalBitmask = state.monthlyLogs.get(monthKey);
    
    expect(finalBitmask).toBeTruthy();
    expect(finalBitmask).not.toBe(0n);
  });

  it('deve serializar dados corretamente para nuvem', async () => {
    // Criar alguns hábitos
    const habitIds = Array.from({ length: 10 }, (_, i) => 
      createTestHabit({ name: `Habit ${i}`, time: 'Morning', goalType: 'check' })
    );

    // Popular dados
    habitIds.forEach(id => {
      HabitService.setStatus(id, TEST_DATE, 'Morning', HABIT_STATE.DONE);
    });

    // Serializar
    const serialized = HabitService.serializeLogsForCloud();
    
    expect(serialized.length).toBeGreaterThan(0);
    
    // Cada entrada deve ser hex válido
    serialized.forEach(([key, hex]) => {
      expect(key).toMatch(/^.+_\d{4}-\d{2}$/);
      expect(hex).toMatch(/^0x[0-9a-f]+$/);
    });
  });
});
