/**
 * @file utils.test.ts
 * @description Testes para utilitários de infraestrutura.
 * P1 - Funções de data, sanitização HTML, UUID, compressão e markdown usadas globalmente.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    createDebounced,
    pad2,
    generateUUID,
    toUTCIsoDateString,
    getTodayUTC,
    getTodayUTCIso,
    resetTodayCache,
    parseUTCIsoDate,
    addDays,
    getSafeDate,
    escapeHTML,
    sanitizeText,
    simpleMarkdownToHTML
} from './utils';

describe('🧰 Utilitários de Infraestrutura (utils.ts)', () => {

    beforeEach(() => {
        resetTodayCache();
    });

    describe('createDebounced', () => {
        it('deve executar a função após o delay', async () => {
            const fn = vi.fn();
            const debounced = createDebounced(fn, 50);

            debounced();
            expect(fn).not.toHaveBeenCalled();

            await new Promise(r => setTimeout(r, 60));
            expect(fn).toHaveBeenCalledOnce();
        });

        it('deve agrupar múltiplas chamadas', async () => {
            const fn = vi.fn();
            const debounced = createDebounced(fn, 50);

            debounced();
            debounced();
            debounced();

            await new Promise(r => setTimeout(r, 60));
            expect(fn).toHaveBeenCalledOnce();
        });

        it('deve cancelar com .cancel()', async () => {
            const fn = vi.fn();
            const debounced = createDebounced(fn, 50);

            debounced();
            debounced.cancel();

            await new Promise(r => setTimeout(r, 60));
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('pad2', () => {
        it('deve preencher números de 1 dígito com zero', () => {
            expect(pad2(0)).toBe('00');
            expect(pad2(1)).toBe('01');
            expect(pad2(9)).toBe('09');
        });

        it('deve manter números de 2 dígitos inalterados', () => {
            expect(pad2(10)).toBe('10');
            expect(pad2(99)).toBe('99');
        });

        it('deve funcionar com números fora do LUT (>99)', () => {
            const result = pad2(100);
            expect(result).toBe('100');
        });
    });

    describe('generateUUID', () => {
        it('deve gerar UUID v4 válido', () => {
            const uuid = generateUUID();
            expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        });

        it('deve gerar UUIDs únicos', () => {
            const uuids = new Set<string>();
            for (let i = 0; i < 1000; i++) {
                uuids.add(generateUUID());
            }
            expect(uuids.size).toBe(1000);
        });

        it('deve ter 36 caracteres', () => {
            expect(generateUUID()).toHaveLength(36);
        });
    });

    describe('Datas UTC', () => {
        describe('toUTCIsoDateString', () => {
            it('deve formatar data corretamente', () => {
                const date = new Date(Date.UTC(2025, 0, 15));
                expect(toUTCIsoDateString(date)).toBe('2025-01-15');
            });

            it('deve usar componentes UTC (não local)', () => {
                const date = new Date(Date.UTC(2025, 11, 31, 23, 59, 59));
                expect(toUTCIsoDateString(date)).toBe('2025-12-31');
            });

            it('deve lançar erro para data inválida', () => {
                expect(() => toUTCIsoDateString(new Date('invalid'))).toThrow('Invalid Date');
            });
        });

        describe('parseUTCIsoDate', () => {
            it('deve parsear ISO date string', () => {
                const date = parseUTCIsoDate('2025-01-15');
                expect(date.getUTCFullYear()).toBe(2025);
                expect(date.getUTCMonth()).toBe(0);
                expect(date.getUTCDate()).toBe(15);
            });

            it('deve retornar Invalid Date para strings inválidas', () => {
                expect(isNaN(parseUTCIsoDate('').getTime())).toBe(true);
                expect(isNaN(parseUTCIsoDate('not-a-date').getTime())).toBe(true);
                expect(isNaN(parseUTCIsoDate(null as any).getTime())).toBe(true);
                expect(isNaN(parseUTCIsoDate(undefined as any).getTime())).toBe(true);
            });

            it('deve validar data real (rejeitar 2025-02-30)', () => {
                const date = parseUTCIsoDate('2025-02-30');
                // Fevereiro não tem 30 dias, o Date irá rolar para março
                // A validação do fast path deve detectar isso
                expect(isNaN(date.getTime())).toBe(true);
            });
        });

        describe('getTodayUTC / getTodayUTCIso', () => {
            it('deve retornar data de hoje', () => {
                const today = getTodayUTC();
                const now = new Date();
                expect(today.getUTCFullYear()).toBe(now.getFullYear());
            });

            it('deve cachear resultado de getTodayUTCIso', () => {
                const iso1 = getTodayUTCIso();
                const iso2 = getTodayUTCIso();
                expect(iso1).toBe(iso2);
            });

            it('deve resetar cache com resetTodayCache', () => {
                const iso1 = getTodayUTCIso();
                resetTodayCache();
                const iso2 = getTodayUTCIso();
                expect(iso2).toBe(iso1); // Mesmo dia, mesmo valor
            });
        });

        describe('addDays', () => {
            it('deve adicionar dias positivos', () => {
                const date = new Date(Date.UTC(2025, 0, 1));
                const result = addDays(date, 5);
                expect(result.getUTCDate()).toBe(6);
            });

            it('deve subtrair dias negativos', () => {
                const date = new Date(Date.UTC(2025, 0, 10));
                const result = addDays(date, -5);
                expect(result.getUTCDate()).toBe(5);
            });

            it('deve cruzar fronteira de mês', () => {
                const date = new Date(Date.UTC(2025, 0, 31));
                const result = addDays(date, 1);
                expect(result.getUTCMonth()).toBe(1); // Fevereiro
                expect(result.getUTCDate()).toBe(1);
            });
        });

        describe('getSafeDate', () => {
            it('deve retornar data válida inalterada', () => {
                expect(getSafeDate('2025-01-15')).toBe('2025-01-15');
            });

            it('deve retornar hoje para input inválido', () => {
                const today = getTodayUTCIso();
                expect(getSafeDate(undefined)).toBe(today);
                expect(getSafeDate(null)).toBe(today);
                expect(getSafeDate('invalid')).toBe(today);
                expect(getSafeDate('')).toBe(today);
            });
        });
    });

    describe('Sanitização e segurança', () => {
        describe('escapeHTML', () => {
            it('deve escapar caracteres perigosos', () => {
                expect(escapeHTML('&')).toBe('&amp;');
                expect(escapeHTML('<')).toBe('&lt;');
                expect(escapeHTML('>')).toBe('&gt;');
                expect(escapeHTML('"')).toBe('&quot;');
                expect(escapeHTML("'")).toBe('&#39;');
            });

            it('deve escapar tag de script (XSS)', () => {
                const xss = '<script>alert("xss")</script>';
                const escaped = escapeHTML(xss);
                expect(escaped).not.toContain('<script>');
                expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
            });

            it('deve retornar string vazia para input vazio/falsy', () => {
                expect(escapeHTML('')).toBe('');
            });
        });

        describe('sanitizeText', () => {
            it('deve remover caracteres perigosos < > { }', () => {
                expect(sanitizeText('texto <com> {chaves}')).toBe('texto com chaves');
            });

            it('deve truncar pelo maxLength', () => {
                expect(sanitizeText('texto longo', 5)).toBe('texto');
            });

            it('deve retornar string vazia para input vazio', () => {
                expect(sanitizeText('')).toBe('');
            });

            it('deve aplicar trim', () => {
                expect(sanitizeText('  espaços  ')).toBe('espaços');
            });
        });
    });

    describe('simpleMarkdownToHTML', () => {
        it('deve converter headers', () => {
            expect(simpleMarkdownToHTML('# Título')).toContain('<h1>');
            expect(simpleMarkdownToHTML('## Subtítulo')).toContain('<h2>');
            expect(simpleMarkdownToHTML('### Seção')).toContain('<h3>');
        });

        it('deve converter negrito e itálico', () => {
            expect(simpleMarkdownToHTML('**negrito**')).toContain('<strong>negrito</strong>');
            expect(simpleMarkdownToHTML('*itálico*')).toContain('<em>itálico</em>');
            expect(simpleMarkdownToHTML('***ambos***')).toContain('<strong><em>ambos</em></strong>');
        });

        it('deve converter strikethrough', () => {
            expect(simpleMarkdownToHTML('~~riscado~~')).toContain('<del>riscado</del>');
        });

        it('deve converter listas não-ordenadas', () => {
            const md = '* Item 1\n* Item 2';
            const html = simpleMarkdownToHTML(md);
            expect(html).toContain('<ul>');
            expect(html).toContain('<li>');
        });

        it('deve converter listas ordenadas', () => {
            const md = '1. Primeiro\n2. Segundo';
            const html = simpleMarkdownToHTML(md);
            expect(html).toContain('<ol>');
            expect(html).toContain('<li>');
        });

        it('deve retornar string vazia para input vazio', () => {
            expect(simpleMarkdownToHTML('')).toBe('');
        });

        it('deve escapar HTML dentro do markdown', () => {
            const md = '**<script>alert("xss")</script>**';
            const html = simpleMarkdownToHTML(md);
            expect(html).not.toContain('<script>');
        });
    });
});
