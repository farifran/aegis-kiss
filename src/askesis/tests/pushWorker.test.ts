/**
 * @file tests/pushWorker.test.ts
 * @description Personalização local do lembrete dentro do OneSignalSDKWorker.js.
 *
 * O worker não é um módulo (roda em contexto de Service Worker e faz
 * `importScripts` do SDK), então aqui ele é avaliado com `self` e `indexedDB`
 * falsos. É o trecho mais arriscado do fluxo de push: ele curto-circuita o
 * handler da OneSignal e passa a ser o ÚNICO a notificar — no iOS, push sem
 * notificação visível custa a permissão.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const TAG = 'askesis-reminder';
const MARKER = 'askesis-reminder';
/**
 * O MESMO "hoje" que o app e o worker usam para nomear os cartões.
 *
 * `getTodayUTCIso` monta `Date.UTC(...)` a partir de `getFullYear/getMonth/
 * getDate`, que são LOCAIS: apesar do nome, devolve a data do calendário local.
 * Um `toISOString().slice(0,10)` cru aqui daria a data UTC de verdade, e as duas
 * divergem sempre que o fuso empurra o relógio para o outro dia — era o que
 * fazia estes testes quebrarem sozinhos das 21h à meia-noite em BRT, sem que
 * nada no produto estivesse errado. É a mesma armadilha que o teste de Tóquio
 * mais abaixo já cobre no worker.
 */
const TODAY = (() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
})();

/** Texto genérico que o servidor manda e o SDK exibiria sozinho. */
const GENERICO = { title: 'Hábitos pendentes', alert: 'Como estão seus hábitos hoje?' };

/** Payload cru da OneSignal, no formato que o SDK dela consome. */
function pushPayload(extra: Record<string, unknown> = {}) {
    return {
        custom: { i: 'os-123', a: { askesis: MARKER }, u: 'https://askesis.vercel.app/' },
        icon: 'https://cdn.onesignal.com/icon.png',
        badge: 'https://cdn.onesignal.com/badge.png',
        ...GENERICO,
        ...extra
    };
}

type Card = { date: string; lang: string; title: string; body: string };
type Stored = Card | Card[] | null;

/** IndexedDB mínimo: só `open -> transaction -> objectStore -> get`. */
function fakeIndexedDB(card: Stored, opts: { missingStore?: boolean; failOpen?: boolean } = {}) {
    return {
        open() {
            const req: any = {};
            queueMicrotask(() => {
                if (opts.failOpen) {
                    req.error = new Error('idb indisponível');
                    req.onerror?.();
                    return;
                }
                req.result = {
                    objectStoreNames: { contains: () => !opts.missingStore },
                    transaction: () => ({
                        objectStore: () => ({
                            get() {
                                const r: any = {};
                                queueMicrotask(() => { r.result = card; r.onsuccess?.(); });
                                return r;
                            }
                        })
                    }),
                    close() { /* noop */ }
                };
                req.onsuccess?.();
            });
            return req;
        }
    };
}

interface WorkerOptions {
    idb?: { missingStore?: boolean; failOpen?: boolean };
    /** Escreve o motivo de não personalizar na própria notificação. */
    diagnostico?: boolean;
}

function loadWorker(card: Stored, options: WorkerOptions = {}) {
    // `importScripts` traria o SDK real da CDN; o handler dele é simulado abaixo.
    // DIAGNOSTICO é forçado conforme o teste: os casos abaixo cobrem o
    // comportamento definitivo, salvo o que cobre o próprio diagnóstico.
    const source = readFileSync('OneSignalSDKWorker.js', 'utf8')
        .replace(/^importScripts\([^)]*\);?\s*$/m, '')
        .replace(/var DIAGNOSTICO = \w+;/, `var DIAGNOSTICO = ${options.diagnostico ?? false};`);

    const shown: { title: string; options: any }[] = [];
    const oneSignalShown: unknown[] = [];
    const listeners: Record<string, ((event: any) => void)[]> = {};
    const state = { skipWaitingCalls: 0 };

    const selfStub = {
        addEventListener: (type: string, fn: (event: any) => void) => {
            (listeners[type] ??= []).push(fn);
        },
        skipWaiting: () => { state.skipWaitingCalls++; },
        registration: {
            showNotification: async (title: string, opts: any) => { shown.push({ title, options: opts }); }
        }
    };

    // eslint-disable-next-line no-new-func
    new Function('self', 'indexedDB', source)(selfStub, fakeIndexedDB(card, options.idb));

    // O handler do SDK, que o `importScripts` removido teria registrado DEPOIS
    // do nosso. É exatamente essa ordem que o worker explora.
    selfStub.addEventListener('push', event => { oneSignalShown.push(event); });

    async function firePush(payload: unknown = pushPayload()) {
        let pending: Promise<unknown> = Promise.resolve();
        let stopped = false;
        const event = {
            data: {
                json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
                text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload))
            },
            stopImmediatePropagation: () => { stopped = true; },
            waitUntil: (p: Promise<unknown>) => { pending = p; }
        };

        for (const fn of listeners.push ?? []) {
            fn(event);
            if (stopped) break;
        }
        await pending;
    }

    return {
        firePush,
        shown,
        oneSignalShown,
        install: () => listeners.install[0]({}),
        get skipWaitingCalls() { return state.skipWaitingCalls; }
    };
}

const CARD_HOJE: Card = { date: TODAY, lang: 'pt', title: 'Hábitos pendentes', body: 'Faltam: Meditar' };

describe('OneSignalSDKWorker — personalização local do lembrete', () => {
    it('assume o controle na instalação, sem ficar em espera', () => {
        // Regressão: nem o SDK da OneSignal nem este worker chamavam skipWaiting,
        // então cada versão nova ficava em espera e a antiga seguia atendendo os
        // pushes — correções aqui não chegavam ao aparelho.
        const worker = loadWorker(CARD_HOJE);
        worker.install();

        expect(worker.skipWaitingCalls).toBe(1);
    });

    it('exibe o cartão do dia e cala o handler da OneSignal', async () => {
        // Regressão: substituir a notificação DELA depois de publicada é uma
        // corrida — ela republicava e o usuário recebia as duas. Cortando a
        // propagação existe uma notificação só, a nossa.
        const { firePush, shown, oneSignalShown } = loadWorker(CARD_HOJE);
        await firePush();

        expect(oneSignalShown).toHaveLength(0);
        expect(shown).toHaveLength(1);
        expect(shown[0].title).toBe('Hábitos pendentes');
        expect(shown[0].options.body).toBe('Faltam: Meditar');
        // Tag fixa colapsa lembretes seguidos; renotify faz o de hoje alertar.
        expect(shown[0].options.tag).toBe(TAG);
        expect(shown[0].options.renotify).toBe(true);
    });

    it('deixa passar push sem o marcador (não sequestra anúncio do painel)', async () => {
        const { firePush, shown, oneSignalShown } = loadWorker(CARD_HOJE);
        await firePush({ custom: { a: {} }, alert: 'Novidade no Askesis!' });

        // Quem notifica é o SDK, pelo caminho normal dele.
        expect(oneSignalShown).toHaveLength(1);
        expect(shown).toHaveLength(0);
    });

    it('aceita o marcador em qualquer aninhamento do payload', async () => {
        // Regressão: ler caminhos fixos (custom.a / data / topic) fazia o handler
        // sair calado quando o SDK aninhava diferente — genérica sem pista alguma.
        for (const payload of [
            { data: { askesis: MARKER } },
            { topic: MARKER },
            { custom: { a: { askesis: MARKER } } },
            { qualquer: { coisa: { aninhada: MARKER } } }
        ]) {
            const { firePush, shown, oneSignalShown } = loadWorker(CARD_HOJE, {});
            await firePush(payload);
            expect(shown).toHaveLength(1);
            expect(oneSignalShown).toHaveLength(0);
        }
    });

    it('publica o data que o notificationclick do SDK espera', async () => {
        // O handler de clique dele continua registrado: sem estes campos, clicar
        // no lembrete deixaria de abrir o app e de registrar o evento.
        const { firePush, shown } = loadWorker(CARD_HOJE);
        await firePush();

        expect(shown[0].options.data).toEqual({
            notificationId: 'os-123',
            title: GENERICO.title,
            body: GENERICO.alert,
            additionalData: { askesis: MARKER },
            launchURL: 'https://askesis.vercel.app/'
        });
        expect(shown[0].options.icon).toBe('https://cdn.onesignal.com/icon.png');
    });

    it('cai para os ícones do app quando o payload não traz os dele', async () => {
        // Caminho absoluto: relativo resolveria contra /onesignal/, que não
        // serve assets.
        const { firePush, shown } = loadWorker(CARD_HOJE);
        await firePush(pushPayload({ icon: undefined, badge: undefined }));

        expect(shown[0].options.icon).toBe('/icons/icon-192.svg');
        expect(shown[0].options.badge).toBe('/icons/badge.svg');
    });

    it('escolhe da lista o cartão do dia UTC corrente', async () => {
        // O app grava hoje + próximos dias para sobreviver a uma ausência.
        const ontem: Card = { ...CARD_HOJE, date: '2020-01-01', body: 'Falta: Velho' };
        const depois: Card = { ...CARD_HOJE, date: '2099-12-31', body: 'Falta: Futuro' };
        const { firePush, shown } = loadWorker([ontem, CARD_HOJE, depois]);
        await firePush();

        expect(shown).toHaveLength(1);
        expect(shown[0].options.body).toBe('Faltam: Meditar');
    });

    describe('sem cartão utilizável, exibe o texto genérico do próprio payload', () => {
        // Como o handler do SDK foi curto-circuitado, ninguém mais notificaria:
        // sair calado aqui custaria a permissão de push no iOS.
        const casos: Array<[string, Stored, WorkerOptions]> = [
            ['nenhum cartão', null, {}],
            ['lista vazia', [], {}],
            ['nenhum cartão cobre hoje', [{ ...CARD_HOJE, date: '2020-01-01' }], {}],
            ['cartão de outro dia', { ...CARD_HOJE, date: '2020-01-01' }, {}],
            ['cartão incompleto', { ...CARD_HOJE, body: '' }, {}],
            ['banco do app ainda não existe', CARD_HOJE, { idb: { missingStore: true } }],
            ['IndexedDB falha ao abrir', CARD_HOJE, { idb: { failOpen: true } }]
        ];

        it.each(casos)('%s', async (_nome, card, options) => {
            const { firePush, shown } = loadWorker(card, options);
            await firePush();

            expect(shown).toHaveLength(1);
            expect(shown[0].title).toBe(GENERICO.title);
            expect(shown[0].options.body).toBe(GENERICO.alert);
        });
    });

    it('notifica mesmo com payload ilegível, desde que traga o marcador', async () => {
        // `text()` acha o marcador, `json()` estoura: ainda assim tem de sair
        // notificação, porque o SDK já não vai publicar nenhuma.
        const { firePush, shown } = loadWorker(null);
        await firePush('lixo askesis-reminder lixo');

        expect(shown).toHaveLength(1);
        expect(shown[0].title).toBe('Askesis');
    });

    it('modo diagnóstico escreve o motivo na própria notificação', async () => {
        // Único canal legível sem DevTools no aparelho onde isto é depurado.
        const ontem: Card = { ...CARD_HOJE, date: '2020-01-01' };
        const { firePush, shown } = loadWorker(ontem, { diagnostico: true });
        await firePush();

        expect(shown).toHaveLength(1);
        expect(shown[0].title).toContain('diagnostico');
        expect(shown[0].options.body).toContain('2020-01-01');
    });

    it('modo diagnóstico reporta falha do IndexedDB', async () => {
        const { firePush, shown } = loadWorker(CARD_HOJE, { idb: { failOpen: true }, diagnostico: true });
        await firePush();

        expect(shown).toHaveLength(1);
        expect(shown[0].options.body).toContain('IndexedDB');
    });

    describe('virada do dia sem o app ser aberto', () => {
        // O caso que motivou gravar uma janela de dias: quem passa o dia sem
        // abrir o Askesis é justamente quem mais precisa do lembrete.
        const janela = ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'].map(date => ({
            date, lang: 'pt', title: 'Frase de ' + date, body: 'Falta: Meditar'
        }));

        /** O push do dia: cron às 23:00 UTC. */
        const noDia = (dateISO: string) => vi.setSystemTime(new Date(`${dateISO}T23:00:00Z`));

        // Este bloco mede dependência de fuso, então FIXA o fuso em vez de
        // herdá-lo da máquina: às 23:00 UTC quem está adiantado já virou o dia,
        // e os casos que não são sobre isso passariam a medir onde o teste roda
        // (falhavam em Tóquio e Kiritimati, passavam em BRT e UTC). O caso do
        // fuso adiantado sobrescreve isto por conta própria, logo abaixo.
        const tzAmbiente = process.env.TZ;
        beforeEach(() => { process.env.TZ = 'America/Sao_Paulo'; });
        afterEach(() => { process.env.TZ = tzAmbiente; vi.useRealTimers(); });

        it('pega o cartão do dia novo, escrito dias antes', async () => {
            vi.useFakeTimers();
            noDia('2026-03-12');
            const { firePush, shown } = loadWorker(janela);
            await firePush();

            expect(shown[0].title).toBe('Frase de 2026-03-12');
        });

        it('usa o mesmo "hoje" do app, não a data UTC crua', async () => {
            // `getTodayUTCIso` nomeia os cartões pelo calendário LOCAL. Num fuso
            // adiantado, a data UTC às 23:00 ainda é a de ontem: procurar por ela
            // derrubaria o lembrete para o genérico todo dia. Em BRT as duas
            // coincidem nesse horário, e foi por isso que passou despercebido.
            const tz = process.env.TZ;
            process.env.TZ = 'Asia/Tokyo';
            try {
                vi.useFakeTimers();
                noDia('2026-03-12'); // 23:00 UTC = 08:00 do dia 13 em Tóquio
                const { firePush, shown } = loadWorker(janela);
                await firePush();

                expect(shown[0].title).toBe('Frase de 2026-03-13');
            } finally {
                process.env.TZ = tz;
            }
        });

        it('esgotada a janela, volta ao texto genérico do servidor', async () => {
            // Pendências velhas seriam pior que o texto neutro.
            vi.useFakeTimers();
            noDia('2026-03-14');
            const { firePush, shown } = loadWorker(janela);
            await firePush();

            expect(shown).toHaveLength(1);
            expect(shown[0].title).toBe(GENERICO.title);
        });
    });
});
