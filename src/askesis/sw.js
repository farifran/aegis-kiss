/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file sw.js
 * @description Service Worker: Proxy de Rede e Gerenciador de Cache (Offline Engine).
 *
 * Implementação zero-deps (sem Workbox). Estratégias:
 *  - /api/*        → rede direta (nunca cacheia dados do usuário)
 *  - navegação     → NetworkFirst com timeout e fallback para o shell cacheado
 *  - demais assets → CacheFirst com preenchimento em runtime
 *
 * CACHE VERSIONING: BUILD_HASH é injetado pelo build.js a partir do content hash
 * do bundle. Cada deploy gera um CACHE_NAME novo; o handler de `activate` apaga
 * todos os caches antigos, eliminando acúmulo de bundles hasheados obsoletos.
 *
 * PUSH: NÃO vive aqui. OneSignal registra OneSignalSDKWorker.js com escopo
 * `/onesignal/`, isolado deste SW de escopo `/`.
 */

const HTML_FALLBACK = '/index.html';
// Teto de espera pelo shell antes de servir o do cache. 1s, e não 3s: o cache é
// nomeado pelo BUILD_HASH e o `install` guarda shell, bundle e chunks juntos, de
// modo que cair no cache entrega o app inteiro e coerente — no pior caso um
// deploy atrás naquela abertura, e a atualização chega assim mesmo, pelo
// `sw.js` que o navegador rebusca. Esperar custa tempo que o usuário sente;
// desistir cedo não custa quase nada. Abaixo de ~600ms começaria a atrapalhar
// conexões 3G que responderiam, e o `updateShellCache` deixaria de rodar.
const NETWORK_TIMEOUT_MS = 1000;

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Network Timeout')), ms));

// Substituído pelo build de produção com o content hash do bundle.
const BUILD_HASH = '__BUILD_HASH__';
const CACHE_NAME = 'askesis-' + BUILD_HASH;
const CACHE_FILES = [
    '/',
    '/index.html',
    '/bundle.js',
    '/bundle.css',
    '/manifest.json',
    '/locales/pt.json?v=__LOCALE_VERSION__',
    '/locales/en.json?v=__LOCALE_VERSION__',
    '/locales/es.json?v=__LOCALE_VERSION__',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg',
    '/icons/icon-maskable-512.svg',
    '/icons/badge.svg',
    // Chunks de code-splitting injetados pelo build de produção (vazio em dev).
    ...[/*__EXTRA_PRECACHE__*/]
];

const RELOAD_OPTS = { cache: 'reload' };
const MATCH_OPTS = { ignoreSearch: true };

const updateShellCache = (res) => {
    if (res && res.ok && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(HTML_FALLBACK, copy));
    }
    return res;
};

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.all(CACHE_FILES.map(url =>
                fetch(url, RELOAD_OPTS).then(res => {
                    if (!res.ok) throw new Error(`[SW] Failed to cache: ${url}`);
                    return cache.put(url, res);
                })
            ));
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            self.registration.navigationPreload ? self.registration.navigationPreload.enable() : Promise.resolve(),
            caches.keys().then(keys => Promise.all(
                keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())
            ))
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) return;

    // Não interceptar workers (offline update + push OneSignal).
    if (url.pathname === '/sw.js' || url.pathname === '/OneSignalSDKWorker.js' || url.pathname.startsWith('/onesignal/')) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            (async () => {
                // O preload entra na MESMA corrida do fetch. Esperá-lo antes do
                // timeout — como era — tornava NETWORK_TIMEOUT_MS inócuo em todo
                // navegador que suporta navigation preload, que é justamente por
                // onde a maioria dos aparelhos passa: `preloadResponse` é uma
                // promessa sem teto próprio, e o limite de espera nunca valia.
                const fromNetwork = (async () => {
                    const preloadResp = await event.preloadResponse;
                    return updateShellCache(preloadResp || await fetch(req));
                })();

                // Consumir a resposta mesmo quando o cache vence a corrida: é ela
                // que renova o shell guardado, e um preload descartado sem uso
                // ainda rende aviso no console.
                event.waitUntil(fromNetwork.catch(() => {}));

                try {
                    return await Promise.race([fromNetwork, timeout(NETWORK_TIMEOUT_MS)]);
                } catch (error) {
                    // Sem cópia no cache (primeira visita em rede ruim), esperar a
                    // rede ainda é melhor que devolver erro.
                    return (await caches.match(HTML_FALLBACK, MATCH_OPTS)) || fromNetwork;
                }
            })()
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(networkResponse => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') return networkResponse;
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(req, responseToCache));
                return networkResponse;
            }).catch(() => new Response(null, { status: 408 }));
        })
    );
});

// --- NOTIFICATION CLICK (badge de pendências no Android) ---
// Só a tag local do app. Push remoto da OneSignal é tratado no worker dedicado.
self.addEventListener('notificationclick', (event) => {
    if (event.notification.tag !== 'askesis-pending-habits') return;
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const existing = clients.find(c => 'focus' in c);
            if (existing) return existing.focus();
            return self.clients.openWindow('/');
        })
    );
});

// --- BACKGROUND SYNC ---

/**
 * BACKGROUND SYNC EVENT:
 * Disparado pelo navegador quando a conectividade é restabelecida para tags registradas.
 */
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-cloud-pending') {
        console.log('[SW] Conectividade recuperada. Solicitando sincronização às abas ativas...');
        event.waitUntil(
            self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'REQUEST_SYNC' });
                });
            })
        );
    }
});
