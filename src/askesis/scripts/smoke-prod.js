#!/usr/bin/env node
/**
 * Smoke test PÓS-DEPLOY: verifica fatos sobre a PRODUÇÃO REAL, não sobre o código.
 *
 * Existe para pegar a classe de falha "configurado mas nunca provado": asset que
 * o catch-all da Vercel troca por HTML, service worker sem hash injetado, endpoint
 * desprotegido, app id de push inexistente. Todos já aconteceram neste projeto.
 *
 * Todas as checagens são read-only e sem efeitos colaterais (a sondagem do
 * /api/reminder ESPERA 401 — se vier 200, o endpoint está desprotegido, que é
 * exatamente o defeito a acusar).
 *
 * Uso: node scripts/smoke-prod.js [baseUrl]   (default: https://askesis.vercel.app)
 */

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || 'https://askesis.vercel.app').replace(/\/$/, '');
const ONESIGNAL_APP_ID = 'd69cf0b6-bc03-4375-b3b7-dd7b37e05a17';

let failures = 0;

function ok(label) { console.log(`  ✅ ${label}`); }
function fail(label, detail) { failures++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }

async function get(path, init) {
    const res = await fetch(path.startsWith('http') ? path : BASE + path, { redirect: 'follow', ...init });
    const body = await res.text();
    return { status: res.status, type: res.headers.get('content-type') || '', body };
}

/** O modo de falha nº 1 deste deploy: catch-all devolvendo o app shell no lugar do asset. */
function isHtmlMasquerade(r) {
    return r.type.includes('text/html') || r.body.trimStart().startsWith('<!DOCTYPE');
}

function assertAsset(label, r, { expectType, mustContain, mustNotContain } = {}) {
    if (r.status !== 200) return fail(label, `HTTP ${r.status}`);
    if (isHtmlMasquerade(r) && expectType !== 'html') return fail(label, 'recebeu HTML (catch-all) no lugar do asset');
    if (expectType && expectType !== 'html' && !r.type.includes(expectType)) return fail(label, `content-type "${r.type}"`);
    for (const needle of [].concat(mustContain || [])) {
        if (!r.body.includes(needle)) return fail(label, `não contém "${needle}"`);
    }
    for (const needle of [].concat(mustNotContain || [])) {
        if (r.body.includes(needle)) return fail(label, `ainda contém "${needle}"`);
    }
    ok(label);
}

async function main() {
    console.log(`\nSmoke test de produção → ${BASE}\n`);

    // 1. Shell + descoberta dos bundles hasheados
    const shell = await get('/');
    const jsName = (shell.body.match(/bundle-[A-Za-z0-9]+\.js/) || [])[0];
    const cssName = (shell.body.match(/bundle-[A-Za-z0-9]+\.css/) || [])[0];
    if (shell.status !== 200 || !jsName || !cssName) {
        fail('shell (/) referencia bundles hasheados', `HTTP ${shell.status}, js=${jsName}, css=${cssName}`);
    } else {
        ok(`shell (/) referencia ${jsName} + ${cssName}`);

        const js = await get(`/${jsName}`);
        assertAsset(`bundle JS existe e contém o app id da OneSignal`, js, {
            expectType: 'javascript', mustContain: ONESIGNAL_APP_ID
        });
        assertAsset(`bundle CSS existe`, await get(`/${cssName}`), { expectType: 'css' });
    }

    // 2. Service worker offline: hash de build (sem OneSignal misturado)
    const sw = await get('/sw.js');
    assertAsset('sw.js com hash de build (offline only)', sw, {
        expectType: 'javascript',
        mustContain: jsName ? [jsName] : [],
        mustNotContain: ['__BUILD_HASH__', "importScripts('https://cdn.onesignal.com"]
    });
    for (const chunk of new Set(sw.body.match(/chunk-[A-Za-z0-9]+\.js/g) || [])) {
        assertAsset(`chunk precacheado ${chunk} existe`, await get(`/${chunk}`), { expectType: 'javascript' });
    }

    // 3. Worker de push OneSignal (raiz, escopo /onesignal/) e boot
    assertAsset('OneSignalSDKWorker.js na raiz', await get('/OneSignalSDKWorker.js'), {
        expectType: 'javascript', mustContain: 'cdn.onesignal.com'
    });
    assertAsset('boot/error-handler.js chega à produção', await get('/boot/error-handler.js'), {
        expectType: 'javascript'
    });

    // 4. Manifest e locales
    const manifest = await get('/manifest.json');
    try {
        const m = JSON.parse(manifest.body);
        // display DEVE ser 'standalone': é o que o iOS exige para tratar o app como
        // web app de tela inicial e expor a Badging API. O fullscreen do Android
        // vem por display_override, que o Safari ignora.
        const displayOk = m.display === 'standalone'
            && Array.isArray(m.display_override)
            && m.display_override[0] === 'fullscreen';
        if (displayOk && m.theme_color === '#000000') ok('manifest.json válido (standalone + override fullscreen, preto)');
        else fail('manifest.json', `display=${m.display}, display_override=${JSON.stringify(m.display_override)}, theme_color=${m.theme_color}`);
    } catch { fail('manifest.json', 'não é JSON válido'); }

    for (const lang of ['pt', 'en', 'es']) {
        const l = await get(`/locales/${lang}.json`);
        try { JSON.parse(l.body); ok(`locale ${lang}.json parseável`); }
        catch { fail(`locale ${lang}.json`, `HTTP ${l.status} / JSON inválido`); }
    }

    // 5. Headers de segurança e comportamento de arquivo ausente
    //
    // Ambos já falharam em produção: `routes` (legado) no vercel.json é mutuamente
    // exclusivo com `headers`, e o bloco inteiro era ignorado em silêncio — sem
    // CSP, sem XFO. E o fallback de SPA devolvia index.html com HTTP 200 para
    // QUALQUER caminho inexistente, o que já quebrou o worker de push, o
    // error-handler e o robots.txt.
    const secured = await fetch(BASE + '/');
    const required = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy'];
    const missing = required.filter(h => !secured.headers.get(h));
    if (missing.length === 0) ok('headers de segurança aplicados');
    else fail('headers de segurança', `ausentes: ${missing.join(', ')}`);
    // OneSignal carrega config via JSONP em api.onesignal.com — sem isso o init trava.
    const csp = secured.headers.get('content-security-policy') || '';
    if (csp.includes('api.onesignal.com') && csp.includes('cdn.onesignal.com')) {
        ok('CSP permite scripts OneSignal (cdn + api JSONP)');
    } else {
        fail('CSP OneSignal', 'script-src precisa de cdn.onesignal.com e api.onesignal.com');
    }

    const ghost = await get(`/nao-existe-${Date.now()}.js`);
    if (ghost.status === 404) ok('arquivo ausente responde 404 (sem disfarce de HTML)');
    else fail('arquivo ausente', `HTTP ${ghost.status} ${ghost.type} — o fallback está mascarando 404`);

    // 6. APIs: vivas e protegidas
    const reminder = await get('/api/reminder');
    if (reminder.status === 401) ok('/api/reminder exige autenticação (401 sem Bearer)');
    else if (reminder.status === 200) fail('/api/reminder DESPROTEGIDO', 'respondeu 200 sem auth — CRON_SECRET ausente do deploy');
    else fail('/api/reminder', `HTTP ${reminder.status} (esperado 401)`);

    for (const ep of ['/api/analyze', '/api/sync']) {
        const r = await get(ep, { method: 'OPTIONS' });
        if (r.status === 204) ok(`${ep} vivo (OPTIONS 204)`);
        else fail(`${ep}`, `OPTIONS HTTP ${r.status} (esperado 204)`);
    }

    // 7. OneSignal: o app id embarcado existe e aponta para esta origem
    const os = await get(`https://api.onesignal.com/sync/${ONESIGNAL_APP_ID}/web`);
    try {
        const cfg = JSON.parse(os.body);
        const origin = cfg?.config?.siteInfo?.origin;
        if (cfg.success === true && origin === BASE) ok(`app OneSignal existe e origin = ${origin}`);
        else fail('config OneSignal', `success=${cfg.success}, origin=${origin} (esperado ${BASE})`);
    } catch { fail('config OneSignal', `HTTP ${os.status} / resposta inválida`); }

    console.log(failures === 0
        ? '\n✅ Smoke test de produção: tudo verde.\n'
        : `\n❌ Smoke test de produção: ${failures} falha(s).\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('Erro fatal no smoke test:', e); process.exit(2); });
