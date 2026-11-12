/**
 * @file services/notificationCard.test.ts
 * @description Cartão pré-renderizado que o Service Worker lê para personalizar o lembrete.
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { state, HABIT_STATE, clearAllCaches } from '../state';
import { HabitService } from './HabitService';
import { getTodayUTCIso, toUTCIsoDateString, addDays, parseUTCIsoDate, resetTodayCache } from '../utils';
import { setLanguage } from '../i18n';
import { buildNotificationCards, setNotificationQuotes } from './notificationCard';
import { createTestHabit, clearTestState } from '../tests/test-utils';

const TODAY = getTodayUTCIso();

// A adaptação: versão curta que o app mostra sem expandir.
const QUOTE = 'Nenhum vento é favorável a quem não sabe aonde vai.';

describe('buildNotificationCard', () => {
    beforeAll(async () => {
        // O cartão é pré-renderizado: sem dicionário carregado, `t()` devolveria
        // a própria chave e o teste não veria o texto que chega ao usuário.
        await setLanguage('en');
        await setLanguage('pt');
    });

    beforeEach(() => {
        clearTestState();
        setNotificationQuotes({});
    });

    /** Cartão de hoje, que é o que o Service Worker exibe. */
    const todayCard = () => buildNotificationCards().find(c => c.date === TODAY);
    const quoteToday = () => setNotificationQuotes({ [TODAY]: QUOTE });

    it('retorna null quando não há hábitos ativos hoje', () => {
        // Sem nada agendado, o texto genérico do push é mais honesto.
        expect(todayCard()).toBeUndefined();
    });

    it('lista os hábitos pendentes pelo nome', () => {
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        createTestHabit({ name: 'Ler', time: 'Morning', goalType: 'check' });

        const card = todayCard()!;

        expect(card.date).toBe(TODAY);
        expect(card.lang).toBe('pt');
        // Sem frase carregada, o estado do dia assume o título.
        expect(card.title).toBe('Hábitos pendentes');
        expect(card.body).toContain('Meditar');
        expect(card.body).toContain('Ler');
    });

    it('resume com "+N" quando há mais nomes do que cabem', () => {
        ['A', 'B', 'C', 'D', 'E'].forEach(name =>
            createTestHabit({ name, time: 'Morning', goalType: 'check' })
        );

        const card = todayCard()!;

        // 3 nomes visíveis + contagem dos 2 restantes.
        expect(card.body).toContain('+2');
        expect(card.body).not.toContain('E');
        // Plural pelo total pendente, não pelo que coube.
        expect(card.body).toContain('Faltam:');
    });

    it('não conta como pendente o hábito já concluído', () => {
        const feito = createTestHabit({ name: 'Feito', time: 'Morning', goalType: 'check' });
        createTestHabit({ name: 'Pendente', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(feito, TODAY, 'Morning', HABIT_STATE.DONE);

        const card = todayCard()!;

        expect(card.body).toContain('Pendente');
        expect(card.body).not.toContain('Feito');
    });

    it('mostra a frase estoica quando o dia está completo', () => {
        const id = createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(id, TODAY, 'Morning', HABIT_STATE.DONE);
        quoteToday();

        const card = todayCard()!;

        expect(card.title).toBe(QUOTE);
        expect(card.body).toBe('Tudo em dia');
    });

    it('põe a frase no título e o estado do dia no corpo', () => {
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        quoteToday();

        const card = todayCard()!;

        expect(card.title).toBe(QUOTE);
        expect(card.body.split('\n')).toEqual(['Hábitos pendentes', 'Falta: Meditar']);
    });

    it('mostra só as pendências enquanto a frase não carregou', () => {
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });

        const card = todayCard()!;

        expect(card.body).toContain('Meditar');
        expect(card.body).not.toContain('\n');
    });

    it('usa o idioma ativo no título', () => {
        const id = createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(id, TODAY, 'Morning', HABIT_STATE.DONE);
        quoteToday();
        state.activeLanguageCode = 'en';

        const card = todayCard()!;

        expect(card.lang).toBe('en');
        expect(card.title).toBe(QUOTE);
        expect(card.body).toBe('All done');
    });

    it('retorna null no dia completo sem frase publicada', () => {
        // Frases carregam sob demanda: antes do chunk chegar não há o que dizer,
        // e o texto genérico do push é melhor que um corpo vazio.
        const id = createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(id, TODAY, 'Morning', HABIT_STATE.DONE);

        expect(todayCard()).toBeUndefined();
    });

    it('grava hoje e os próximos 5 dias', () => {
        // Sem isto, um dia sem abrir o app derrubava o lembrete para o genérico
        // — justamente para quem mais precisava dele.
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });

        const cards = buildNotificationCards();
        const esperado = Array.from({ length: 6 }, (_, i) =>
            toUTCIsoDateString(addDays(parseUTCIsoDate(TODAY), i))
        );

        expect(cards.map(c => c.date)).toEqual(esperado);
    });

    it('nos dias futuros tudo está pendente, pois nada foi marcado', () => {
        const id = createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(id, TODAY, 'Morning', HABIT_STATE.DONE);

        const cards = buildNotificationCards();
        const amanha = cards.find(c => c.date !== TODAY)!;

        // Hoje está zerado; amanhã o mesmo hábito volta a constar.
        expect(amanha.body).toContain('Meditar');
    });

    it('cada dia recebe a sua própria frase', () => {
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        const amanhaISO = toUTCIsoDateString(addDays(parseUTCIsoDate(TODAY), 1));
        setNotificationQuotes({ [TODAY]: QUOTE, [amanhaISO]: 'Outra frase.' });

        const cards = buildNotificationCards();

        expect(cards.find(c => c.date === TODAY)!.title).toBe(QUOTE);
        expect(cards.find(c => c.date === amanhaISO)!.title).toBe('Outra frase.');
    });

    it('nunca lança: falha ao montar vira null', () => {
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        // Corrompe o estado de um jeito que quebra o cálculo do resumo.
        (state as unknown as { habits: unknown }).habits = null;

        expect(() => buildNotificationCards()).not.toThrow();
        expect(todayCard()).toBeUndefined();
    });
});

/**
 * O cartão de um dia futuro é escrito ANTES desse dia chegar. Estes testes
 * cobrem a pergunta que só a virada responde: quando o dia vira, o lembrete
 * encontra um cartão, e o conteúdo dele é o do dia certo.
 */
describe('buildNotificationCards — virada do dia', () => {
    const DIA_D = '2026-03-10';
    const dia = (offset: number) => toUTCIsoDateString(addDays(parseUTCIsoDate(DIA_D), offset));

    /**
     * Congela o relógio ao meio-dia UTC do dia pedido.
     *
     * `getTodayUTCIso` guarda a data por 60s — sem limpar esse cache, viajar no
     * tempo não muda o "hoje" que os cartões enxergam. Em produção o próprio
     * TTL cobre a virada com o app aberto.
     */
    const viajarPara = (dateISO: string) => {
        vi.setSystemTime(new Date(`${dateISO}T12:00:00Z`));
        resetTodayCache();
    };

    beforeAll(async () => {
        await setLanguage('pt');
    });

    beforeEach(() => {
        clearTestState();
        setNotificationQuotes({});
        vi.useFakeTimers();
        viajarPara(DIA_D);
    });

    afterEach(() => {
        vi.useRealTimers();
        resetTodayCache();
    });

    it('o cartão de amanhã, escrito hoje, é igual ao que amanhã produziria', () => {
        // É o teste central da antecipação: o lembrete de amanhã não pode
        // depender de o app ser aberto amanhã.
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        setNotificationQuotes({ [dia(1)]: 'Frase de amanhã.' });

        const escritoHoje = buildNotificationCards().find(c => c.date === dia(1));

        viajarPara(dia(1));
        clearAllCaches();
        const escritoAmanha = buildNotificationCards().find(c => c.date === dia(1));

        expect(escritoHoje).toEqual(escritoAmanha);
        expect(escritoHoje!.title).toBe('Frase de amanhã.');
        expect(escritoHoje!.body).toContain('Meditar');
    });

    it('respeita a agenda do dia do cartão, não a de hoje', () => {
        // Hábito só no mesmo dia da semana que hoje: os dias D+1..D+5 ficam
        // vazios, e cartão nenhum pode inventar pendência para eles.
        const id = createTestHabit({ name: 'Semanal', time: 'Morning', goalType: 'check' });
        const habito = state.habits.find(h => h.id === id)!;
        // `frequency` é readonly no HabitSchedule: troca-se o agendamento inteiro,
        // que é o que a camada de ações também faz em produção.
        habito.scheduleHistory[0] = {
            ...habito.scheduleHistory[0],
            frequency: {
                type: 'specific_days_of_week',
                days: [parseUTCIsoDate(DIA_D).getUTCDay()]
            }
        };
        clearAllCaches();

        expect(buildNotificationCards().map(c => c.date)).toEqual([DIA_D]);
    });

    it('abrir o app no dia seguinte desliza a janela inteira', () => {
        createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });

        expect(buildNotificationCards().map(c => c.date)).toEqual(
            Array.from({ length: 6 }, (_, i) => dia(i))
        );

        viajarPara(dia(1));
        clearAllCaches();

        // O dia que passou sai da lista e um novo entra no fim: sem isso a
        // janela encolheria um dia a cada dia.
        expect(buildNotificationCards().map(c => c.date)).toEqual(
            Array.from({ length: 6 }, (_, i) => dia(i + 1))
        );
    });

    it('hábito criado hoje entra nos cartões dos dias já escritos', () => {
        // A janela é reescrita inteira a cada save; o cartão de D+3 montado
        // antes da criação não pode sobreviver ao rebuild.
        createTestHabit({ name: 'Antigo', time: 'Morning', goalType: 'check' });
        expect(buildNotificationCards().find(c => c.date === dia(3))!.body).not.toContain('Novo');

        createTestHabit({ name: 'Novo', time: 'Morning', goalType: 'check' });
        // O app invalida os caches de seletor antes de salvar (`_notifyChanges`).
        clearAllCaches();

        expect(buildNotificationCards().find(c => c.date === dia(3))!.body).toContain('Novo');
    });

    it('o que foi marcado hoje não zera o cartão de amanhã', () => {
        // Bitmask é por dia: marcar hoje não pode vazar para os dias seguintes.
        const id = createTestHabit({ name: 'Meditar', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(id, DIA_D, 'Morning', HABIT_STATE.DONE);
        setNotificationQuotes({ [DIA_D]: QUOTE, [dia(1)]: QUOTE });
        clearAllCaches();

        const cards = buildNotificationCards();

        expect(cards.find(c => c.date === DIA_D)!.body).toBe('Tudo em dia');
        expect(cards.find(c => c.date === dia(1))!.body).toContain('Meditar');
    });
});
