/**
 * @file tests/swNavigation.test.ts
 * @description Comportamento do service worker na navegação (abertura do app).
 *
 * O arquivo é executado de verdade num sandbox com `self`, `caches` e `fetch`
 * falsos: os outros testes do SW conferem texto, e texto não pega o defeito que
 * motivou estes casos — esperar `preloadResponse` FORA da corrida fazia o teto
 * de espera não valer nada em Chrome/Android, onde o preload é o caminho usado.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Ouvintes = Map<string, (event: any) => void>;

function carregarServiceWorker(fetchFalso: (req: any) => Promise<any>) {
    const codigo = readFileSync(resolve(__dirname, '..', 'sw.js'), 'utf8');
    const ouvintes: Ouvintes = new Map();
    const guardado = new Map<string, any>();

    const self = {
        addEventListener: (tipo: string, handler: any) => ouvintes.set(tipo, handler),
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
        registration: { navigationPreload: { enable: vi.fn() } }
    };

    const caches = {
        open: async () => ({ put: async (chave: any, valor: any) => { guardado.set(String(chave), valor); } }),
        match: async (chave: any) => guardado.get(String(chave)),
        keys: async () => [],
        delete: async () => true
    };

    // eslint-disable-next-line no-new-func
    new Function('self', 'caches', 'fetch', codigo)(self, caches, fetchFalso);
    return { ouvintes, guardado };
}

function respostaFalsa(corpo: string) {
    return { ok: true, status: 200, type: 'basic', corpo, clone() { return this; } } as any;
}

function eventoDeNavegacao(preloadResponse: Promise<any>) {
    let resposta: Promise<any> | null = null;
    return {
        evento: {
            request: { url: 'https://askesis.app/', mode: 'navigate' },
            preloadResponse,
            respondWith: (p: Promise<any>) => { resposta = p; },
            waitUntil: () => {}
        },
        get resposta() { return resposta; }
    };
}

describe('🌐 Service worker — abertura do app', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('serve o shell do cache quando a rede passa do teto de espera', async () => {
        const rede = vi.fn(async () => respostaFalsa('da rede'));
        const { ouvintes, guardado } = carregarServiceWorker(rede);
        guardado.set('/index.html', respostaFalsa('do cache'));

        // Preload que nunca resolve: é o cenário de sinal fraco, e era ele que
        // escapava do timeout quando o await vinha antes da corrida.
        const alvo = eventoDeNavegacao(new Promise(() => {}));
        ouvintes.get('fetch')!(alvo.evento);

        await vi.advanceTimersByTimeAsync(1100);

        expect((await alvo.resposta)?.corpo).toBe('do cache');
    });

    it('usa a resposta do preload quando ela chega dentro do teto', async () => {
        const rede = vi.fn(async () => respostaFalsa('fetch direto'));
        const { ouvintes, guardado } = carregarServiceWorker(rede);
        guardado.set('/index.html', respostaFalsa('do cache'));

        const alvo = eventoDeNavegacao(Promise.resolve(respostaFalsa('do preload')));
        ouvintes.get('fetch')!(alvo.evento);

        await vi.advanceTimersByTimeAsync(10);

        expect((await alvo.resposta)?.corpo).toBe('do preload');
        expect(rede).not.toHaveBeenCalled();
        // A volta da rede renova o shell guardado.
        expect(guardado.get('/index.html')?.corpo).toBe('do preload');
    });

    it('cai no fetch normal quando o navegador não faz preload', async () => {
        const rede = vi.fn(async () => respostaFalsa('fetch direto'));
        const { ouvintes } = carregarServiceWorker(rede);

        const alvo = eventoDeNavegacao(Promise.resolve(undefined));
        ouvintes.get('fetch')!(alvo.evento);

        await vi.advanceTimersByTimeAsync(10);

        expect((await alvo.resposta)?.corpo).toBe('fetch direto');
        expect(rede).toHaveBeenCalledTimes(1);
    });
});
