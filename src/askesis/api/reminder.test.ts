/**
 * @file api/reminder.test.ts
 * @description Testes do endpoint de lembrete diário (Vercel Cron -> OneSignal).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

function makeRequest(headers: Record<string, string> = {}) {
    return new Request('https://askesis.vercel.app/api/reminder', { method: 'GET', headers });
}

describe('api/reminder', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
        process.env.ONESIGNAL_REST_API_KEY = 'os_v2_test_key';
        process.env.CRON_SECRET = 'segredo';
        delete process.env.ONESIGNAL_APP_ID;
    });

    it('rejeita chamada sem o Bearer do CRON_SECRET', async () => {
        const mod = await import('./reminder');
        const res = await mod.default(makeRequest());
        expect(res.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejeita chamada quando CRON_SECRET está ausente (fail-closed)', async () => {
        delete process.env.CRON_SECRET;
        const mod = await import('./reminder');
        const res = await mod.default(makeRequest());
        expect(res.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('retorna 500 sem ONESIGNAL_REST_API_KEY', async () => {
        delete process.env.ONESIGNAL_REST_API_KEY;
        const mod = await import('./reminder');
        const res = await mod.default(makeRequest({ authorization: 'Bearer segredo' }));
        expect(res.status).toBe(500);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cria a notificação com entrega imediata e idempotência', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'notif-1' }), { status: 200 }));

        const mod = await import('./reminder');
        const res = await mod.default(makeRequest({ authorization: 'Bearer segredo' }));
        expect(res.status).toBe(200);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.onesignal.com/notifications');
        expect(init.headers['Authorization']).toBe('Key os_v2_test_key');

        const payload = JSON.parse(init.body);
        // "Subscribed Users" não existe mais no modelo novo da OneSignal, e mirar
        // um segmento inexistente não dá erro de validação — só resulta em zero
        // destinatários com HTTP 200.
        expect(payload.included_segments).toEqual(['Total Subscriptions']);
        expect(payload.ttl).toBe(86400);
        expect(payload.contents.pt).toContain('hábitos');
        expect(payload.headings.en).toBe('Pending habits');
        expect(payload.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(payload.web_push_topic).toBe('askesis-reminder');
        // Sem o marcador o worker ignora o push e o texto genérico permanece.
        expect(payload.data).toEqual({ askesis: 'askesis-reminder' });

        // Regressão: agendar por fuso zerava o público elegível ("All included
        // players are not subscribed") e nenhum lembrete chegava. Quem define o
        // horário agora é o cron.
        expect(payload.delayed_option).toBeUndefined();
        expect(payload.delivery_time_of_day).toBeUndefined();
    });

    it('o cron entrega às 20:00 BRT, já que o horário agora vem dele', async () => {
        const { readFileSync } = await import('node:fs');
        const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8'));

        const reminderCron = vercelConfig.crons.find((c: { path: string }) => c.path === '/api/reminder');
        // 23:00 UTC = 20:00 BRT. Hobby tem janela de 1h, então entrega 20:00–21:00.
        expect(reminderCron.schedule).toBe('0 23 * * *');
    });

    it('servidor e worker de push concordam no marcador', async () => {
        const { readFileSync } = await import('node:fs');
        const { REMINDER_MARKER } = await import('./reminder');

        // É o marcador — não a tag — que autoriza a personalização. Edge runtime
        // e service worker não podem se importar: só resta comparar o literal.
        expect(readFileSync('OneSignalSDKWorker.js', 'utf8'))
            .toContain(`var REMINDER_MARKER = '${REMINDER_MARKER}'`);
    });

    it('a tag do lembrete não colide com a do badge local', async () => {
        const { readFileSync } = await import('node:fs');
        const { REMINDER_MARKER } = await import('./reminder');

        // Elas vivem em registrations diferentes (sw.js vs /onesignal/), então
        // reusar a mesma string sugeriria um colapso que não acontece.
        expect(readFileSync('services/badge.ts', 'utf8'))
            .not.toContain(`PENDING_NOTIFICATION_TAG = '${REMINDER_MARKER}'`);
    });

    it('web_push_topic respeita o limite de 64 caracteres da OneSignal', async () => {
        const { REMINDER_MARKER } = await import('./reminder');
        expect(REMINDER_MARKER.length).toBeLessThanOrEqual(64);
    });

    it('idempotency key é estável no mesmo minuto e distinta entre minutos', async () => {
        const { idempotencyKeyForDate } = await import('./reminder');
        const a1 = await idempotencyKeyForDate('2026-08-01T23:00');
        const a2 = await idempotencyKeyForDate('2026-08-01T23:00');
        const b = await idempotencyKeyForDate('2026-08-01T23:01');
        expect(a1).toBe(a2);
        expect(a1).not.toBe(b);
    });

    it('a chave usa granularidade de minuto', async () => {
        // Com chave diária a OneSignal devolvia a notificação já criada e nenhum
        // push novo saía — impossível testar o lembrete duas vezes no mesmo dia.
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'notif-1' }), { status: 200 }));

        const mod = await import('./reminder');
        await mod.default(makeRequest({ authorization: 'Bearer segredo' }));

        const now = new Date().toISOString();
        const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(payload.idempotency_key).toBe(await mod.idempotencyKeyForDate(now.slice(0, 16)));
        expect(payload.idempotency_key).not.toBe(await mod.idempotencyKeyForDate(now.slice(0, 13)));
    });

    it('usa auth Basic para chaves legadas', async () => {
        process.env.ONESIGNAL_REST_API_KEY = 'legacy_key_abc';
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'notif-1' }), { status: 200 }));

        const mod = await import('./reminder');
        await mod.default(makeRequest({ authorization: 'Bearer segredo' }));
        expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Basic legacy_key_abc');
    });

    it('propaga falha da OneSignal como 502 sem lançar', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['bad'] }), { status: 400 }));

        const mod = await import('./reminder');
        const res = await mod.default(makeRequest({ authorization: 'Bearer segredo' }));
        expect(res.status).toBe(502);
    });

    // A OneSignal responde 200 mesmo quando não cria notificação nenhuma.
    // Tratar isso como sucesso fazia o cron reportar OK todo dia enquanto
    // ninguém recebia nada — e o log da Vercel mostrava 200.
    it('trata 200 com "errors" como falha (aceitou e não criou nada)', async () => {
        fetchMock.mockResolvedValueOnce(new Response(
            JSON.stringify({ errors: ['All included players are not subscribed'] }),
            { status: 200 }
        ));

        const mod = await import('./reminder');
        const res = await mod.default(makeRequest({ authorization: 'Bearer segredo' }));

        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.errors).toContain('All included players are not subscribed');
    });

    it('trata 200 sem id como falha', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ recipients: 0 }), { status: 200 }));

        const mod = await import('./reminder');
        const res = await mod.default(makeRequest({ authorization: 'Bearer segredo' }));

        expect(res.status).toBe(502);
        expect((await res.json()).recipients).toBe(0);
    });

    it('reporta o número de destinatários no sucesso', async () => {
        fetchMock.mockResolvedValueOnce(new Response(
            JSON.stringify({ id: 'notif-1', recipients: 7 }),
            { status: 200 }
        ));

        const mod = await import('./reminder');
        const res = await mod.default(makeRequest({ authorization: 'Bearer segredo' }));

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ ok: true, id: 'notif-1', recipients: 7 });
    });

    it('normaliza as duas formas de "errors" da OneSignal', async () => {
        const { extractErrors } = await import('./reminder');

        expect(extractErrors({ errors: ['a', 'b'] })).toEqual(['a', 'b']);
        expect(extractErrors({ errors: { invalid_player_ids: ['x'] } }))
            .toEqual(['invalid_player_ids: ["x"]']);
        expect(extractErrors({ id: 'ok' })).toEqual([]);
    });
});
