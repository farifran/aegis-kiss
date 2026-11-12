/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file api/reminder.ts
 * @description Lembrete diário via OneSignal (badge de reengajamento no Android).
 *
 * Disparado pelo Vercel Cron (ver vercel.json). Cria UMA notificação por dia na
 * OneSignal, entregue no ato. No Android, a notificação não lida é o que produz
 * o badge no ícone do launcher (a Badging API não existe lá).
 *
 * HORÁRIO: quem define é o cron (`0 23 * * *` = 20:00 BRT), não a OneSignal.
 * A entrega por fuso (`delayed_option: 'timezone'`) foi removida: ela exige que
 * a OneSignal conheça o fuso de cada assinatura e, sem esse dado, o público
 * elegível vira zero — a API respondia 200 com "All included players are not
 * subscribed" e nenhum lembrete chegava a ninguém.
 *
 * CONSEQUÊNCIA: todos recebem no mesmo instante. Aceitável enquanto o público
 * está num fuso só; com usuários espalhados, será preciso voltar à entrega por
 * fuso (garantindo o timezone nas assinaturas) ou criar uma notificação por
 * fuso com `send_after`.
 *
 * PRIVACIDADE: o servidor não sabe quem tem pendências (estado é E2E cifrado);
 * o texto é genérico e a entrega vai só a quem optou por push (assinantes).
 * O aparelho escreve o lembrete real no lugar dele — ver OneSignalSDKWorker.js.
 * O texto daqui não é desperdício: é o que o aparelho exibe quando não tem
 * cartão utilizável (app nunca aberto, ou dias sem abrir).
 *
 * ENV VARS (Vercel):
 * - ONESIGNAL_REST_API_KEY (obrigatória; prefixo os_v2_ usa auth "Key")
 * - CRON_SECRET (recomendada; Vercel a envia como Bearer automaticamente)
 * - ONESIGNAL_APP_ID (opcional; default = app id público do cliente)
 */

export const config = {
    runtime: 'edge',
};

const DEFAULT_APP_ID = 'd69cf0b6-bc03-4375-b3b7-dd7b37e05a17';
const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';

/**
 * Segmento alvo. É o segmento "Default" do app (Audience -> Segments).
 *
 * ATENÇÃO: a OneSignal renomeou os segmentos padrão no modelo de usuários novo.
 * O antigo "Subscribed Users" NÃO existe mais, e mirar um segmento inexistente
 * não dá erro de validação — a API responde 200 com "All included players are
 * not subscribed" e não cria nada. Foi assim que o lembrete ficou dias sem
 * chegar a ninguém enquanto o cron reportava sucesso.
 *
 * Se um dia isso quebrar de novo, confira o nome em Audience -> Segments antes
 * de suspeitar de qualquer outra coisa.
 */
const TARGET_SEGMENT = 'Total Subscriptions';

/**
 * Identifica ESTE push. Vai em dois campos, com papéis distintos:
 *
 * - `data.askesis` — o que o Service Worker lê para autorizar a personalização.
 *   Não usamos a tag para isso: depender de `web_push_topic` virar
 *   `Notification.tag` é suposição sobre o interno do SDK, e ela não se
 *   confirmou. O marcador em `data` chega íntegro ao evento `push`.
 *   Também evita sequestro: um anúncio enviado pelo painel não o carrega, e
 *   portanto segue o caminho normal da OneSignal.
 *
 * - `web_push_topic` — agrupa lembretes consecutivos numa notificação só,
 *   quando o navegador honra o topic. A personalização não depende disto: o
 *   worker publica com tag própria (o mesmo valor).
 *
 * Deliberadamente diferente de PENDING_NOTIFICATION_TAG (services/badge.ts):
 * colapso por tag vale por service worker registration, e o badge vive no
 * sw.js (scope '/') enquanto o push vive em '/onesignal/'. Tags iguais não
 * colapsariam — só criariam a ilusão de que colapsam.
 */
export const REMINDER_MARKER = 'askesis-reminder';

const HEADINGS = {
    en: 'Pending habits',
    pt: 'Hábitos pendentes',
    es: 'Hábitos pendientes'
};

const CONTENTS = {
    en: 'How are your habits today? Open Askesis and log your progress.',
    pt: 'Como estão seus hábitos hoje? Abra o Askesis e registre seu progresso.',
    es: '¿Cómo van tus hábitos hoy? Abre Askesis y registra tu progreso.'
};

function json(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

interface OneSignalResponse {
    id?: string;
    recipients?: number;
    /** Ora um array de mensagens, ora um objeto com listas por tipo de erro. */
    errors?: string[] | Record<string, unknown>;
}

/** Normaliza as duas formas de `errors` da OneSignal numa lista de mensagens. */
export function extractErrors(body: OneSignalResponse): string[] {
    const { errors } = body;
    if (!errors) return [];
    if (Array.isArray(errors)) return errors.map(String);
    if (typeof errors === 'object') {
        return Object.entries(errors).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    }
    return [];
}

/**
 * Chave de idempotência determinística por HORA (UTC): se o cron reexecutar
 * logo em seguida (retry/redeploy), a OneSignal deduplica em vez de enviar duas
 * vezes. Formato UUID exigido pela API, derivado de SHA-256 do carimbo.
 *
 * Granularidade de MINUTO. Com chave diária (ou horária) a OneSignal devolve a
 * notificação já criada e NENHUM push novo sai, o que inviabiliza testar o
 * lembrete duas vezes seguidas. Disparo duplo de cron acontece em segundos, e
 * o minuto ainda o cobre.
 */
export async function idempotencyKeyForDate(stamp: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`askesis-reminder|${stamp}`));
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    // Formata como UUID v4-like (nibbles de versão/variante fixos para validade).
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function getAuthHeader(restKey: string): string {
    // Chaves novas da OneSignal (prefixo os_v2_) usam o esquema "Key";
    // chaves legadas usam "Basic".
    return restKey.startsWith('os_') ? `Key ${restKey}` : `Basic ${restKey}`;
}

export default async function handler(req: Request) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return new Response(null, { status: 405 });
    }

    // AUTENTICAÇÃO: o Vercel Cron envia Authorization: Bearer ${CRON_SECRET}.
    // Sem isso, qualquer um poderia disparar notificações para toda a base.
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return json(401, { error: 'Unauthorized' });
    }

    const restKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!restKey) {
        return json(500, { error: 'Server Configuration: Missing ONESIGNAL_REST_API_KEY' });
    }

    const appId = process.env.ONESIGNAL_APP_ID || DEFAULT_APP_ID;
    const now = new Date().toISOString();
    const todayISO = now.slice(0, 10);
    const minuteStamp = now.slice(0, 16); // YYYY-MM-DDTHH:MM

    const payload = {
        app_id: appId,
        included_segments: [TARGET_SEGMENT],
        headings: HEADINGS,
        contents: CONTENTS,
        url: 'https://askesis.vercel.app/',
        // Sem agendamento: quem define o horário é o cron. Ver o cabeçalho.
        // Expira sem entrega após 24h (evita lembrete atrasado no dia seguinte).
        ttl: 86400,
        // Marcador lido pelo OneSignalSDKWorker.js: é ele que autoriza a
        // substituição deste texto genérico pelo lembrete real do aparelho.
        data: { askesis: REMINDER_MARKER },
        web_push_topic: REMINDER_MARKER,
        idempotency_key: await idempotencyKeyForDate(minuteStamp)
    };

    try {
        const res = await fetch(ONESIGNAL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': getAuthHeader(restKey)
            },
            body: JSON.stringify(payload)
        });

        const body = await res.json().catch(() => ({})) as OneSignalResponse;

        if (!res.ok) {
            console.error('[reminder] OneSignal recusou a requisição', { status: res.status, body });
            return json(502, { error: 'OneSignal request failed', status: res.status, details: body });
        }

        // HTTP 200 NÃO significa notificação criada: a OneSignal responde 200 com
        // `errors` quando aceita a requisição e não cria nada (segmento sem
        // destinatários elegíveis, por exemplo). Sem esta checagem o cron reporta
        // sucesso todo dia enquanto ninguém recebe nada.
        const errors = extractErrors(body);
        if (errors.length > 0 || !body.id) {
            // Inclui alvo e app: a causa quase sempre é um deles, e sem isso no
            // log só resta conferir o painel na mão.
            console.error('[reminder] OneSignal aceitou sem criar notificação', {
                errors,
                recipients: body.recipients ?? null,
                segment: TARGET_SEGMENT,
                appId,
                body
            });
            return json(502, {
                error: 'OneSignal accepted the request without creating a notification',
                errors,
                recipients: body.recipients ?? null
            });
        }

        console.log('[reminder] notificação criada', {
            id: body.id,
            recipients: body.recipients ?? null,
            date: todayISO
        });
        return json(200, { ok: true, date: todayISO, id: body.id, recipients: body.recipients ?? null });
    } catch (error) {
        console.error('[reminder] falha ao chamar a OneSignal', error);
        return json(502, { error: 'OneSignal request failed', details: String(error).slice(0, 200) });
    }
}
