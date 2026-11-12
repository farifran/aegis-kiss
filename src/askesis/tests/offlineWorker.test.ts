/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file tests/offlineWorker.test.ts
 * @description Invariantes do sw.js (cache offline) e da versão dos locales.
 *
 * O contrato aqui é entre TRÊS arquivos que precisam concordar no mesmo endereço:
 * a dica de preload no index.html, o fetch do i18n.ts e a lista de pré-cache do
 * sw.js. Divergir tem dois preços, e nenhum aparece em teste de unidade comum:
 * o navegador baixa o arquivo duas vezes, ou serve a tradução velha para o código
 * novo — que foi o defeito real de 2026-08-14, com as strings novas aparecendo na
 * tela como a própria chave.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sw = readFileSync('sw.js', 'utf8');
const html = readFileSync('index.html', 'utf8');
const i18n = readFileSync('i18n.ts', 'utf8');
const build = readFileSync('build.js', 'utf8');

describe('Worker de offline e versão dos locales', () => {
    it('os três consumidores pedem o locale com o mesmo marcador de versão', () => {
        // O build substitui `__LOCALE_VERSION__` nos três; se um deles perder o
        // marcador, o endereço diverge e o arquivo é baixado duas vezes.
        expect(html, 'index.html (dica de preload)').toContain('.json?v=__LOCALE_VERSION__');
        expect(i18n, 'i18n.ts (fetch)').toContain('.json?v=${__LOCALE_VERSION__}');
        for (const lang of ['pt', 'en', 'es']) {
            expect(sw, `sw.js (pré-cache ${lang})`).toContain(`'/locales/${lang}.json?v=__LOCALE_VERSION__'`);
        }
    });

    it('o build injeta a versão nos três arquivos', () => {
        expect(build).toContain('__LOCALE_VERSION__: JSON.stringify(localeVersion)');
        expect(build).toContain("html.replace('__LOCALE_VERSION__', localeVersion)");
        expect(build).toMatch(/replace\(\/__LOCALE_VERSION__\/g, localeVersion\)/);
    });

    it('a versão sai do CONTEÚDO dos locales, não do bundle', () => {
        // Tirar do bundle seria circular: o hash do bundle vem do bundle. Tirar do
        // conteúdo também mantém o cache quente em deploys que não tocam tradução.
        expect(build).toMatch(/localeHash[\s\S]{0,200}readFile\(f\)/);
    });

    it('a busca no cache NÃO ignora a query string', () => {
        // A mina desta correção: `ignoreSearch: true` na busca geral faria a
        // entrada velha (`/locales/pt.json`) responder ao pedido novo
        // (`?v=<hash>`), e o defeito voltaria em silêncio. A opção existe no
        // arquivo, mas só pode valer para o fallback do HTML.
        const buscaGeral = sw.match(/caches\.match\(req[^)]*\)/g) ?? [];
        expect(buscaGeral.length, 'busca geral por requisição').toBeGreaterThan(0);
        for (const chamada of buscaGeral) {
            expect(chamada, 'busca geral não pode ignorar a query').not.toContain('MATCH_OPTS');
            expect(chamada).not.toContain('ignoreSearch');
        }
    });

    it('o pré-cache falha junto: um arquivo ausente impede o SW novo de assumir', () => {
        // Documenta a consequência, que não é obvia: `Promise.all` no install faz
        // um único 404 rejeitar a instalação inteira, e o SW ANTIGO segue no
        // controle indefinidamente — servindo bundle e traduções velhos.
        expect(sw).toMatch(/install[\s\S]{0,400}Promise\.all/);
    });
});
