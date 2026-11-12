/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file tests/property/cacheCoherence.property.test.ts
 * @description Property tests de coerência de cache.
 *
 * INVARIANTE CENTRAL: um cache deve ser invisível. Para qualquer sequência de
 * mutações aplicadas através do caminho real de invalidação da aplicação, ler um
 * seletor com os caches quentes tem de dar exatamente o mesmo resultado que lê-lo
 * com todos os caches limpos.
 *
 * Qualquer divergência é, por definição, um bug de invalidação: o usuário vê um
 * número obsoleto que só some ao recarregar a página.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import {
    state,
    clearAllCaches,
    invalidateCachesForDateChange,
    HABIT_STATE,
    type Habit,
    type HabitSchedule,
    type TimeOfDay
} from '../../state';
import {
    calculateHabitStreak,
    shouldHabitAppearOnDate,
    getScheduleForDate,
    getActiveHabitsForDate,
    clearSelectorInternalCaches
} from '../../services/selectors';
import { HabitService } from '../../services/HabitService';
import { clearTestState } from '../test-utils';

const BASE_DATE = '2025-03-01';
/**
 * Janela curta de propósito. Valores derivados só ficam interessantes quando dias
 * adjacentes se tocam (um streak é uma corrida de dias consecutivos); espalhar as
 * mutações por um mês inteiro faz o gerador quase nunca produzir esse encontro.
 */
const WINDOW_DAYS = 6;

function isoAtOffset(offset: number): string {
    const d = new Date(Date.UTC(2025, 2, 1));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
}

const ALL_DATES = Array.from({ length: WINDOW_DAYS }, (_, i) => isoAtOffset(i));

function makeHabit(id: string, times: TimeOfDay[]): Habit {
    const schedule: HabitSchedule = {
        startDate: BASE_DATE,
        icon: '⭐',
        color: '#3498db',
        goal: { type: 'check' },
        name: id,
        times,
        frequency: { type: 'daily' },
        scheduleAnchor: BASE_DATE
    };
    return { id, createdOn: BASE_DATE, scheduleHistory: [schedule] };
}

/**
 * Uma mutação: marcar um status num (hábito, data, período), seguida da
 * invalidação que a aplicação realmente executa nesse caminho
 * (`_notifyPartialUIRefresh` -> `invalidateCachesForDateChange`).
 */
interface Mutation {
    habitIndex: number;
    dateIndex: number;
    time: TimeOfDay;
    status: number;
}

const mutationArb: fc.Arbitrary<Mutation> = fc.record({
    habitIndex: fc.integer({ min: 0, max: 1 }),
    dateIndex: fc.integer({ min: 0, max: WINDOW_DAYS - 1 }),
    time: fc.constantFrom<TimeOfDay>('Morning', 'Evening'),
    // Viés para DONE: um gerador uniforme sobre os 4 estados quase nunca completa
    // dias consecutivos, e sem streak > 0 não há valor obsoleto para observar.
    status: fc.oneof(
        { arbitrary: fc.constant<number>(HABIT_STATE.DONE), weight: 6 },
        { arbitrary: fc.constant<number>(HABIT_STATE.NULL), weight: 3 },
        { arbitrary: fc.constant<number>(HABIT_STATE.DEFERRED), weight: 1 },
        { arbitrary: fc.constant<number>(HABIT_STATE.DONE_PLUS), weight: 1 }
    )
});

const mutationsArb = fc.array(mutationArb, { minLength: 4, maxLength: 24 });

function setupHabits(): Habit[] {
    const habits = [
        makeHabit('habit-a', ['Morning', 'Evening']),
        makeHabit('habit-b', ['Morning'])
    ];
    state.habits = habits;
    return habits;
}

function applyMutation(habits: Habit[], m: Mutation) {
    const habit = habits[m.habitIndex];
    const dateISO = ALL_DATES[m.dateIndex];
    const times = habit.scheduleHistory[0].times;
    if (!times.includes(m.time)) return;

    HabitService.setStatus(habit.id, dateISO, m.time, m.status);
    // Caminho de invalidação real da aplicação para uma mudança de status.
    invalidateCachesForDateChange(dateISO);
}

/** Lê um seletor com os caches quentes. */
function readCached(habits: Habit[], read: (h: Habit, d: string) => unknown) {
    return habits.flatMap(h => ALL_DATES.map(d => read(h, d)));
}

/**
 * Aplica as mutações intercalando leituras completas entre elas.
 *
 * Aquecer o cache só no início não prova nada: com o estado vazio todos os
 * valores derivados são triviais, então nenhum valor obsoleto consegue existir.
 * O caso real — e o que quebra — é o usuário registrar dias, olhar a tela (que
 * preenche o cache com valores não-triviais) e só então voltar para editar um
 * dia anterior.
 */
function applyInterleaved(habits: Habit[], mutations: Mutation[], read: (h: Habit, d: string) => unknown) {
    mutations.forEach(m => {
        applyMutation(habits, m);
        readCached(habits, read);
    });
}

/** Lê o mesmo seletor a partir do zero, sem nenhum cache. */
function readFromScratch(habits: Habit[], read: (h: Habit, d: string) => unknown) {
    clearAllCaches();
    clearSelectorInternalCaches();
    const result = habits.flatMap(h => ALL_DATES.map(d => read(h, d)));
    clearAllCaches();
    clearSelectorInternalCaches();
    return result;
}

describe('Coerência de cache (property tests)', () => {
    beforeEach(() => {
        clearTestState();
        clearSelectorInternalCaches();
    });

    it('shouldHabitAppearOnDate: valor cacheado == recálculo do zero', () => {
        fc.assert(
            fc.property(mutationsArb, mutations => {
                clearTestState();
                clearSelectorInternalCaches();
                const habits = setupHabits();

                // Aquece os caches antes de mutar — é o cenário real: o usuário já
                // olhou para a tela antes de editar alguma coisa.
                applyInterleaved(habits, mutations, (h, d) => shouldHabitAppearOnDate(h, d));

                const cached = readCached(habits, (h, d) => shouldHabitAppearOnDate(h, d));
                const fresh = readFromScratch(habits, (h, d) => shouldHabitAppearOnDate(h, d));
                expect(cached).toEqual(fresh);
            }),
            { numRuns: 100 }
        );
    });

    it('getScheduleForDate: valor cacheado == recálculo do zero', () => {
        fc.assert(
            fc.property(mutationsArb, mutations => {
                clearTestState();
                clearSelectorInternalCaches();
                const habits = setupHabits();

                applyInterleaved(habits, mutations, (h, d) => getScheduleForDate(h, d));

                const cached = readCached(habits, (h, d) => getScheduleForDate(h, d));
                const fresh = readFromScratch(habits, (h, d) => getScheduleForDate(h, d));
                expect(cached).toEqual(fresh);
            }),
            { numRuns: 100 }
        );
    });

    it('getActiveHabitsForDate: valor cacheado == recálculo do zero', () => {
        fc.assert(
            fc.property(mutationsArb, mutations => {
                clearTestState();
                clearSelectorInternalCaches();
                const habits = setupHabits();

                mutations.forEach(m => {
                    applyMutation(habits, m);
                    ALL_DATES.forEach(d => getActiveHabitsForDate(d));
                });

                const cached = ALL_DATES.map(d => getActiveHabitsForDate(d).map(e => e.habit.id));
                clearAllCaches();
                clearSelectorInternalCaches();
                const fresh = ALL_DATES.map(d => getActiveHabitsForDate(d).map(e => e.habit.id));
                expect(cached).toEqual(fresh);
            }),
            { numRuns: 100 }
        );
    });

    it('calculateHabitStreak: valor cacheado == recálculo do zero', () => {
        fc.assert(
            fc.property(mutationsArb, mutations => {
                clearTestState();
                clearSelectorInternalCaches();
                const habits = setupHabits();

                applyInterleaved(habits, mutations, (h, d) => calculateHabitStreak(h, d));

                const cached = readCached(habits, (h, d) => calculateHabitStreak(h, d));
                const fresh = readFromScratch(habits, (h, d) => calculateHabitStreak(h, d));
                expect(cached).toEqual(fresh);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * REGRESSÃO: contraexemplo mínimo derivado do property test acima.
     * `invalidateCachesForDateChange(D)` apagava apenas a chave D do streaksCache,
     * mas o streak de qualquer dia posterior também depende de D. Desmarcar um dia
     * já registrado deixava o streak do dia seguinte congelado no valor antigo.
     */
    it('desmarcar um dia passado atualiza o streak dos dias seguintes', () => {
        clearTestState();
        clearSelectorInternalCaches();
        const [, habitB] = setupHabits();

        applyMutation([habitB, habitB], { habitIndex: 0, dateIndex: 0, time: 'Morning', status: HABIT_STATE.DONE });
        applyMutation([habitB, habitB], { habitIndex: 0, dateIndex: 1, time: 'Morning', status: HABIT_STATE.DONE });

        // Usuário olha a tela: streak de 2 dias entra no cache.
        expect(calculateHabitStreak(habitB, ALL_DATES[1])).toBe(2);

        // Volta e desmarca o primeiro dia.
        applyMutation([habitB, habitB], { habitIndex: 0, dateIndex: 0, time: 'Morning', status: HABIT_STATE.NULL });

        expect(calculateHabitStreak(habitB, ALL_DATES[1])).toBe(1);
    });
});
