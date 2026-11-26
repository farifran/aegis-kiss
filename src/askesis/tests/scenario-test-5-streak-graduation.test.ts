/**
 * @file tests/scenario-test-5-streak-graduation.test.ts
 * @description Teste de Cenário 8 — Jornada de Streak e Graduação
 *
 * Valida o fluxo completo:
 * ✓ Construção de streak ao longo de semanas
 * ✓ Streak resiste a dias fora do agendamento (specific_days_of_week / interval)
 * ✓ Dias com DONE_PLUS também contam para o streak
 * ✓ Hábito não aparece após ser graduado
 * ✓ Completar todos os turnos de um hábito multi-turno conta um dia no streak
 * ✓ Interromper streak em dia agendado reinicia contagem
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, HABIT_STATE, Habit, STREAK_CONSOLIDATED } from '../state';
import { HabitService } from '../services/HabitService';
import { calculateHabitStreak, shouldHabitAppearOnDate, clearSelectorInternalCaches } from '../services/selectors';
import { clearTestState } from './test-utils';
import { generateUUID } from '../utils';

// ── helpers locais ────────────────────────────────────────────────────────────

function makeHabit(overrides: {
    name: string;
    startDate: string;
    times?: string[];
    frequency?: Record<string, unknown>;
    scheduleAnchor?: string;
}): Habit {
    const habit: Habit = {
        id: generateUUID(),
        createdOn: overrides.startDate,
        scheduleHistory: [{
            startDate: overrides.startDate,
            scheduleAnchor: overrides.scheduleAnchor ?? overrides.startDate,
            icon: '⭐',
            color: '#3498db',
            goal: { type: 'check' },
            name: overrides.name,
            times: (overrides.times ?? ['Morning']) as any,
            frequency: (overrides.frequency ?? { type: 'daily' }) as any,
        }]
    };
    state.habits.push(habit);
    return habit;
}

function markDone(habitId: string, date: string, times: string[] = ['Morning']) {
    for (const time of times) {
        HabitService.setStatus(habitId, date, time as any, HABIT_STATE.DONE);
    }
}

/** Gera lista de datas ISO em ordem crescente a partir de startDate por `count` dias. */
function dateRange(startDate: string, count: number): string[] {
    const dates: string[] = [];
    const base = new Date(startDate + 'T00:00:00Z');
    for (let i = 0; i < count; i++) {
        const d = new Date(base.getTime() + i * 86400000);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

// ── testes ────────────────────────────────────────────────────────────────────

describe('🏆 CENÁRIO 8: Streak & Graduação', () => {

    beforeEach(() => {
        clearTestState();
        clearSelectorInternalCaches();
    });

    describe('Streak diário', () => {
        it('deve contar streak contínuo de 7 dias', () => {
            const habit = makeHabit({ name: 'Diário', startDate: '2025-06-01' });
            dateRange('2025-06-01', 7).forEach(d => markDone(habit.id, d));

            expect(calculateHabitStreak(habit, '2025-06-07')).toBe(7);
        });

        it('deve reiniciar ao encontrar dia agendado não completado', () => {
            const habit = makeHabit({ name: 'Com falha', startDate: '2025-06-01' });
            // 1..5 feitos, 6 pulado, 7..8 feitos
            dateRange('2025-06-01', 5).forEach(d => markDone(habit.id, d));
            // dia 6 não marcado
            dateRange('2025-06-07', 2).forEach(d => markDone(habit.id, d));

            // streak começa no dia 7 (06 quebrou)
            expect(calculateHabitStreak(habit, '2025-06-08')).toBe(2);
        });

        it('deve contar DONE_PLUS como dia completado', () => {
            const habit = makeHabit({ name: 'Plus', startDate: '2025-06-01' });
            HabitService.setStatus(habit.id, '2025-06-01', 'Morning', HABIT_STATE.DONE_PLUS);
            HabitService.setStatus(habit.id, '2025-06-02', 'Morning', HABIT_STATE.DONE_PLUS);
            HabitService.setStatus(habit.id, '2025-06-03', 'Morning', HABIT_STATE.DONE);

            expect(calculateHabitStreak(habit, '2025-06-03')).toBe(3);
        });
    });

    describe('Streak com frequência alternate (specific_days_of_week)', () => {
        it('deve ignorar dias fora do agendamento ao contar streak', () => {
            // Seg (1) / Qua (3) / Sex (5) — âncora 2025-06-02 (segunda)
            const habit = makeHabit({
                name: 'Seg/Qua/Sex',
                startDate: '2025-06-02',
                frequency: { type: 'specific_days_of_week', days: [1, 3, 5] },
            });

            // 2025-06-02=seg, 04=qua, 06=sex → 3 sessões
            markDone(habit.id, '2025-06-02');
            markDone(habit.id, '2025-06-04');
            markDone(habit.id, '2025-06-06');

            // Streak na sexta deve ser 3 (Ter/Qui/Sáb são ignorados)
            expect(calculateHabitStreak(habit, '2025-06-06')).toBe(3);
        });

        it('deve parar streak quando dia agendado não é completado', () => {
            const habit = makeHabit({
                name: 'Seg/Sex',
                startDate: '2025-06-02',
                frequency: { type: 'specific_days_of_week', days: [1, 5] },
            });

            markDone(habit.id, '2025-06-02'); // seg
            // sex 2025-06-06 NÃO marcado
            markDone(habit.id, '2025-06-09'); // seg seguinte

            expect(calculateHabitStreak(habit, '2025-06-09')).toBe(1);
        });
    });

    describe('Streak com frequência interval', () => {
        it('deve ignorar dias não-alvo ao contar streak (a cada 2 dias)', () => {
            const habit = makeHabit({
                name: 'Dia sim dia não',
                startDate: '2025-06-01',
                frequency: { type: 'interval', unit: 'days', amount: 2 },
                scheduleAnchor: '2025-06-01',
            });

            // Datas alvo: 01, 03, 05, 07
            markDone(habit.id, '2025-06-01');
            markDone(habit.id, '2025-06-03');
            markDone(habit.id, '2025-06-05');
            markDone(habit.id, '2025-06-07');

            // Dias 02/04/06 são ignorados pelo streak
            expect(calculateHabitStreak(habit, '2025-06-07')).toBe(4);
        });
    });

    describe('Streak multi-turno', () => {
        it('deve exigir TODOS os turnos completos para contar o dia', () => {
            const habit = makeHabit({
                name: 'Manhã e Noite',
                startDate: '2025-06-01',
                times: ['Morning', 'Evening'],
            });

            // Dia 1: apenas manhã → dia incompleto para o streak
            HabitService.setStatus(habit.id, '2025-06-01', 'Morning', HABIT_STATE.DONE);
            // Dia 2: ambos os turnos
            HabitService.setStatus(habit.id, '2025-06-02', 'Morning', HABIT_STATE.DONE);
            HabitService.setStatus(habit.id, '2025-06-02', 'Evening', HABIT_STATE.DONE);

            expect(calculateHabitStreak(habit, '2025-06-02')).toBe(1);
        });
    });

    describe('Fluxo completo: graduação', () => {
        it('hábito não deve aparecer após ser graduado', () => {
            const habit = makeHabit({ name: 'Caminhada', startDate: '2025-01-01' });

            expect(shouldHabitAppearOnDate(habit, '2025-02-28')).toBe(true);

            // Graduar — limpar cache pois shouldHabitAppearOnDate armazena resultado por data
            habit.graduatedOn = '2025-03-01';
            state.habitAppearanceCache.delete(habit.id);

            expect(shouldHabitAppearOnDate(habit, '2025-03-01')).toBe(false);
            expect(shouldHabitAppearOnDate(habit, '2025-06-01')).toBe(false);
        });

        it(`deve atingir nível de consolidação após ${STREAK_CONSOLIDATED} dias consecutivos`, () => {
            const start = '2025-01-01';
            const habit = makeHabit({ name: 'Consolidação', startDate: start });

            // Marca os primeiros STREAK_CONSOLIDATED dias
            dateRange(start, STREAK_CONSOLIDATED).forEach(d => markDone(habit.id, d));

            const lastDay = dateRange(start, STREAK_CONSOLIDATED).at(-1)!;
            const streak = calculateHabitStreak(habit, lastDay);

            expect(streak).toBeGreaterThanOrEqual(STREAK_CONSOLIDATED);
        });

        it('deve permanecer graduado mesmo com hábitos recriados no estado', () => {
            const habit = makeHabit({ name: 'Antigo', startDate: '2025-01-01' });
            habit.graduatedOn = '2025-04-01';

            // Cria outro hábito com mesmo nome mas sem graduação
            const newHabit = makeHabit({ name: 'Antigo', startDate: '2025-04-15' });

            expect(shouldHabitAppearOnDate(habit, '2025-05-01')).toBe(false);
            expect(shouldHabitAppearOnDate(newHabit, '2025-05-01')).toBe(true);
        });
    });
});
