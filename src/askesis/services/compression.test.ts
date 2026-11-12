/**
 * @file services/compression.test.ts
 * @description Invariantes do GZIP de cold storage.
 *
 * A camada é transparente por design: quem chama não sabe se o valor está
 * comprimido. Isso a torna fácil de quebrar em silêncio — um envelope que não
 * volta ao JSON original só aparece meses depois, quando alguém deleta um hábito
 * e o ano inteiro é descartado. Os testes abaixo fixam o round-trip, a
 * compatibilidade com o formato legado (JSON puro) e a REGRA DE PRESERVAÇÃO:
 * arquivo ilegível nunca vira `{}`.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { compressArchive, decompressArchive, isCompressedArchive } from './compression';
import { processArchiving, pruneHabitFromArchives } from './sync.worker';

/** Arquivo anual realista: um ano de dailyData com notas e instâncias. */
function buildYearArchive(year: string, days = 365): string {
    const archive: Record<string, unknown> = {};
    for (let i = 0; i < days; i++) {
        const date = new Date(Date.UTC(Number(year), 0, 1 + i)).toISOString().slice(0, 10);
        archive[date] = {
            'habit-morning-meditation': {
                instances: { Morning: { status: 1, note: 'Sentei vinte minutos antes do café.' } }
            },
            'habit-evening-reading': {
                instances: { Night: { status: 1, note: '' } }
            }
        };
    }
    return JSON.stringify(archive);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Cold storage GZIP', () => {
    describe('round-trip', () => {
        it('devolve o JSON original byte a byte', async () => {
            const original = buildYearArchive('2024');
            const compressed = await compressArchive(original);

            expect(isCompressedArchive(compressed)).toBe(true);
            expect(await decompressArchive(compressed)).toBe(original);
        });

        it('preserva unicode fora do BMP e caracteres de controle', async () => {
            const original = JSON.stringify({ '2024-01-01': { note: 'Ω → 🧘🏽‍♀️ "aspas"\n\ttab' } });
            const compressed = await compressArchive(original);

            expect(JSON.parse(await decompressArchive(compressed))).toEqual(JSON.parse(original));
        });
    });

    describe('economia real', () => {
        // O README promete redução drástica de banda e armazenamento no cold
        // storage. Este teste é o que sustenta a afirmação.
        it('reduz um arquivo anual em mais de 80%, já contando o base64', async () => {
            const original = buildYearArchive('2024');
            const compressed = await compressArchive(original);

            expect(compressed.length).toBeLessThan(original.length * 0.2);
        });

        it('não infla arquivos pequenos: mantém JSON puro quando o envelope seria maior', async () => {
            const tiny = '{}';

            expect(await compressArchive(tiny)).toBe(tiny);
        });
    });

    describe('compatibilidade', () => {
        it('deixa passar JSON puro do formato legado', async () => {
            const legacy = '{"2023-05-02":{"habit-a":{"instances":{}}}}';

            expect(isCompressedArchive(legacy)).toBe(false);
            expect(await decompressArchive(legacy)).toBe(legacy);
        });

        it('grava JSON puro quando o navegador não tem Compression Streams', async () => {
            vi.stubGlobal('CompressionStream', undefined);
            const original = buildYearArchive('2024', 30);

            expect(await compressArchive(original)).toBe(original);
        });

        it('falha alto ao ler envelope gzip sem a API disponível', async () => {
            const compressed = await compressArchive(buildYearArchive('2024', 30));
            vi.stubGlobal('DecompressionStream', undefined);

            await expect(decompressArchive(compressed)).rejects.toThrow(/indisponível/);
        });

        it('rejeita envelope corrompido em vez de devolver lixo', async () => {
            await expect(decompressArchive('gz1:bm90LWd6aXAtYXQtYWxs')).rejects.toThrow();
        });
    });
});

describe('Pipeline de arquivamento com GZIP', () => {
    const day = (note: string) => ({ 'habit-a': { instances: { Morning: { status: 1, note } } } });

    it('grava o arquivo anual comprimido', async () => {
        const additions: Record<string, unknown> = {};
        for (let i = 1; i <= 60; i++) {
            additions[`2024-01-${String(i).padStart(2, '0')}`] = day('nota repetida o bastante para comprimir bem');
        }

        const result = await processArchiving({ '2024': { base: {}, additions } });

        expect(isCompressedArchive(result['2024'])).toBe(true);
        expect(Object.keys(JSON.parse(await decompressArchive(result['2024'])))).toHaveLength(60);
    });

    it('mescla adições sobre uma base já comprimida', async () => {
        const base = await compressArchive(JSON.stringify({ '2024-01-01': day('antigo') }));

        const result = await processArchiving({ '2024': { base, additions: { '2024-02-01': day('novo') } } });
        const merged = JSON.parse(await decompressArchive(result['2024']));

        expect(Object.keys(merged).sort()).toEqual(['2024-01-01', '2024-02-01']);
    });

    it('lê base legada em JSON puro e regrava comprimida', async () => {
        const legacyBase = JSON.stringify(
            Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`2023-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`, day('legado')]))
        );

        const result = await processArchiving({ '2023': { base: legacyBase, additions: { '2023-12-31': day('novo') } } });

        expect(isCompressedArchive(result['2023'])).toBe(true);
        expect(JSON.parse(await decompressArchive(result['2023']))['2023-12-31']).toBeDefined();
    });

    // REGRESSÃO: a versão anterior fazia `catch { base = {} }`. Uma base ilegível
    // (envelope de um dispositivo mais novo, base64 truncado) era substituída pelas
    // adições do dia e o ano inteiro de histórico sumia na gravação seguinte.
    it('omite o ano quando a base é ilegível, em vez de sobrescrevê-la', async () => {
        const result = await processArchiving({
            '2022': { base: 'gz1:###nao-e-base64###', additions: { '2022-06-01': day('hoje') } }
        });

        expect(result['2022']).toBeUndefined();
    });

    it('trata base vazia como arquivo novo', async () => {
        const result = await processArchiving({ '2025': { base: '', additions: { '2025-01-01': day('primeiro') } } });

        expect(JSON.parse(await decompressArchive(result['2025']))['2025-01-01']).toBeDefined();
    });
});

describe('Poda de hábito em arquivos comprimidos', () => {
    it('remove o hábito e regrava o ano comprimido', async () => {
        const content: Record<string, unknown> = {};
        for (let i = 1; i <= 40; i++) {
            const date = `2024-03-${String(i % 28 + 1).padStart(2, '0')}`;
            content[date] = {
                'habit-doomed': { instances: { Morning: { status: 1, note: 'texto suficiente para comprimir' } } },
                'habit-kept': { instances: { Night: { status: 1, note: 'texto suficiente para comprimir' } } }
            };
        }
        const archives = { '2024': await compressArchive(JSON.stringify(content)) };

        const updated = await pruneHabitFromArchives('habit-doomed', archives);
        const pruned = JSON.parse(await decompressArchive(updated['2024']));

        expect(isCompressedArchive(updated['2024'])).toBe(true);
        expect(JSON.stringify(pruned)).not.toContain('habit-doomed');
        expect(Object.values(pruned)[0]).toHaveProperty('habit-kept');
    });

    it('esvazia o ano quando o hábito era o único conteúdo', async () => {
        const archives = {
            '2024': JSON.stringify({ '2024-03-01': { 'habit-doomed': { instances: {} } } })
        };

        expect(await pruneHabitFromArchives('habit-doomed', archives)).toEqual({ '2024': '' });
    });

    it('ignora anos ilegíveis sem tocar neles', async () => {
        const updated = await pruneHabitFromArchives('habit-doomed', { '2021': 'gz1:###quebrado###' });

        expect(updated).toEqual({});
    });
});
