/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/notificationCard.ts
 * @description Cartão de notificação: o texto do lembrete, pré-renderizado no cliente.
 *
 * POR QUE ISSO EXISTE:
 * O servidor não pode montar o texto do lembrete — o estado é E2E cifrado e ele
 * não sabe o que está pendente. Mas com o app fechado nada roda no aparelho: só
 * um push da rede acorda o Service Worker (agendamento local não existe — a
 * Notification Triggers API foi descontinuada e timers de SW morrem em ~30s).
 *
 * A solução é separar gatilho de conteúdo: o servidor manda uma campainha
 * idêntica para todo mundo, e o SW monta o texto lendo ESTE cartão do
 * IndexedDB. O servidor nunca sabe o que a notificação diz.
 *
 * O cartão guarda `title`/`body` JÁ RENDERIZADOS porque o Service Worker não
 * consegue importar o i18n nem `data/quotes.ts` — ele só lê e exibe.
 *
 * Consumido por `OneSignalSDKWorker.js`. Gravado por `services/persistence.ts`.
 */

import { state, HABIT_STATE } from '../state';
import { calculateDaySummary, getActiveHabitsForDate, getHabitDisplayInfo } from './selectors';
import { HabitService } from './HabitService';
import { getTodayUTCIso, parseUTCIsoDate, toUTCIsoDateString, addDays, logger } from '../utils';
import { t } from '../i18n';
import { NOTIFICATION_QUOTE_DAYS } from '../constants';

/** Chave dos cartões no object store `app_state`. Espelhada em OneSignalSDKWorker.js. */
export const NOTIFICATION_CARD_KEY = 'askesis_notification_card';

/** Quantos nomes de hábito cabem no corpo antes de virar "+N". */
const MAX_HABIT_NAMES = 3;

/**
 * Quantos dias à frente de hoje ganham cartão.
 *
 * O cartão vale para um dia UTC específico, e quem o grava é o app. Sem isto,
 * passar um dia inteiro sem abrir o Askesis fazia o lembrete cair no texto
 * genérico — justamente para quem mais precisava dele.
 *
 * Dias futuros são calculáveis: nada foi marcado ainda, então as pendências são
 * todos os hábitos agendados para aquele dia.
 */
const DAYS_AHEAD = NOTIFICATION_QUOTE_DAYS;

export interface NotificationCard {
    /** Data UTC (YYYY-MM-DD) a que o cartão se refere. O SW usa o que casar com hoje. */
    date: string;
    /** Idioma em que title/body foram renderizados — só para diagnóstico. */
    lang: string;
    title: string;
    body: string;
}

/** Nomes dos hábitos ainda pendentes hoje, na ordem em que aparecem no app. */
function collectPendingNames(dateISO: string): string[] {
    const names: string[] = [];
    const dateObj = parseUTCIsoDate(dateISO);

    for (const { habit, schedule } of getActiveHabitsForDate(dateISO, dateObj)) {
        const isPending = schedule.some(time => HabitService.getStatus(habit.id, dateISO, time) === HABIT_STATE.NULL);
        if (!isPending) continue;

        const { name } = getHabitDisplayInfo(habit, dateISO);
        if (name) names.push(name);
    }
    return names;
}

/**
 * A adaptação da frase que o app está exibindo agora, publicada por
 * `renderStoicQuote` — a versão curta, a mesma que aparece no card sem precisar
 * expandir. O texto original (mais longo, com autor) fica só no expandido.
 *
 * A dependência é invertida de propósito: `data/quotes.ts` pesa ~87 KB e é
 * carregado sob demanda (`import()` em render.ts). Importá-lo aqui o traria
 * para o grafo estático e o app pagaria esse custo já no boot.
 */
let publishedQuotes: Record<string, string> = {};

export function setNotificationQuotes(byDateISO: Record<string, string>): void {
    publishedQuotes = byDateISO || {};
}

/** Linha das pendências, ou null quando não há nome legível para mostrar. */
function pendingLine(dateISO: string, pending: number): string {
    const names = collectPendingNames(dateISO);
    const shown = names.slice(0, MAX_HABIT_NAMES);

    // Sem nomes legíveis, cai para a contagem pura.
    if (shown.length === 0) return t('pendingBadgeBody', { count: pending });

    const hidden = names.length - shown.length;
    const list = hidden > 0 ? t('notifyPendingMore', { names: shown.join(', '), count: hidden }) : shown.join(', ');
    // `count` é o total pendente, não o exibido: "Falta:" só com um hábito mesmo.
    return t('notifyPendingList', { names: list, count: names.length });
}

/**
 * Monta o cartão de UM dia UTC.
 *
 * A frase vai no TÍTULO e o estado do dia desce para o corpo:
 *
 *     Nenhum vento é favorável a quem não sabe aonde vai.
 *     Hábitos pendentes
 *     Falta: Abstenção
 *
 * Sem frase (o chunk de citações é lazy), o título volta a ser o estado do dia
 * para a notificação não ficar sem cabeçalho.
 *
 * Retorna `null` quando não há o que dizer — nenhum hábito agendado, ou dia
 * zerado sem frase. Nesse caso o SW mantém o texto genérico do push em vez de
 * inventar conteúdo.
 */
function buildCardForDate(dateISO: string): NotificationCard | null {
    const { total, pending } = calculateDaySummary(dateISO);
    if (total === 0) return null;

    const status = pending > 0 ? t('pendingBadgeTitle') : t('notifyAllDoneTitle');
    const list = pending > 0 ? pendingLine(dateISO, pending) : null;
    const base = { date: dateISO, lang: state.activeLanguageCode };
    const quote = publishedQuotes[dateISO];

    if (quote) {
        return { ...base, title: quote, body: [status, list].filter(Boolean).join('\n') };
    }

    return list ? { ...base, title: status, body: list } : null;
}

/**
 * Monta os cartões de hoje e dos próximos {@link DAYS_AHEAD} dias.
 *
 * O Service Worker escolhe o que casar com a data UTC no momento do push, então
 * um dia inteiro sem abrir o app deixa de derrubar o lembrete para o genérico.
 */
export function buildNotificationCards(): NotificationCard[] {
    try {
        const today = parseUTCIsoDate(getTodayUTCIso());
        const cards: NotificationCard[] = [];

        for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
            const card = buildCardForDate(toUTCIsoDateString(addDays(today, offset)));
            if (card) cards.push(card);
        }
        return cards;
    } catch (error) {
        // Os cartões são um extra: nunca podem derrubar o save do estado.
        logger.error('[NotificationCard] Falha ao montar os cartões', error);
        return [];
    }
}
