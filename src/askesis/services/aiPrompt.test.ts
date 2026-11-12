/**
 * @file services/aiPrompt.test.ts
 * @description Invariantes do prompt de análise estoica.
 *
 * O prompt é um CONTRATO entre três partes: os templates dos locales, o montador
 * no worker e o consumo do resultado pelo quoteEngine. Erros aqui são silenciosos
 * — a IA responde, o JSON parseia, e o efeito simplesmente não acontece.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_THEMES } from '../data/aiThemes';
import { QUOTE_ANALYSIS_SCHEMA } from './analysis';

const LOCALES = ['pt', 'en', 'es'] as const;

function loadLocale(lang: string): Record<string, unknown> {
    return JSON.parse(readFileSync(`locales/${lang}.json`, 'utf8'));
}

/** Tags canônicas declaradas na união StoicTag de data/quotes.ts. */
function loadStoicTags(): Set<string> {
    const src = readFileSync('data/quotes.ts', 'utf8');
    const union = src.match(/export type StoicTag =([\s\S]*?);/);
    if (!union) throw new Error('União StoicTag não encontrada em data/quotes.ts');
    return new Set([...union[1].matchAll(/'([a-zA-Z_]+)'/g)].map(m => m[1]));
}

describe('Prompt de análise estoica', () => {
    describe('vocabulário de temas', () => {
        // REGRESSÃO: a lista vivia nos locales e foi traduzida em pt/es, enquanto
        // as tags das citações são inglesas. Os temas devolvidos pela IA nunca
        // casavam com quote.metadata.tags e o AI_MATCH boost ficava morto — no
        // idioma padrão do app. Agora é constante tipada, validada na compilação.
        it('contém apenas tags que existem em StoicTag', () => {
            const tags = loadStoicTags();
            expect(AI_THEMES.length).toBeGreaterThan(0);
            const invalid = AI_THEMES.filter(theme => !tags.has(theme));
            expect(invalid, `temas sem tag correspondente: ${invalid.join(', ')}`).toEqual([]);
        });

        it('saiu dos arquivos de locale (não é texto de interface)', () => {
            for (const lang of LOCALES) {
                expect(loadLocale(lang), `locale ${lang}`).not.toHaveProperty('aiThemeList');
            }
        });

        it('o schema restringe os temas ao mesmo vocabulário do prompt', () => {
            // Enum no responseSchema: tema fora da lista deixa de ser improvável
            // e passa a ser impossível — o modelo é restringido na decodificação.
            const themesSchema = QUOTE_ANALYSIS_SCHEMA.properties.relevant_themes;
            expect(themesSchema.items.enum).toEqual([...AI_THEMES]);
        });
    });

    describe('templates', () => {
        it('todos os idiomas declaram os placeholders que o montador substitui', () => {
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                expect(prompt, `locale ${lang}`).toContain('{notes}');
                expect(prompt, `locale ${lang}`).toContain('{theme_list}');
            }
        });

        it('todos os idiomas pedem os campos que o app realmente consome', () => {
            // analysis.ts lê json.analysis.determined_level e json.relevant_themes.
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                expect(prompt, `locale ${lang}`).toContain('determined_level');
                expect(prompt, `locale ${lang}`).toContain('relevant_themes');
            }
        });

        it('documenta todos os blocos que o montador injeta', () => {
            // REGRESSÃO: [DATA_CONTEXT] era anexado a todo prompt sem que nenhum
            // template o explicasse — o modelo recebia dados que as instruções
            // nunca mandavam usar, ao contrário de [HABIT_MODES].
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                expect(prompt, `locale ${lang}`).toContain('[HABIT_MODES]');
                expect(prompt, `locale ${lang}`).toContain('[DATA_CONTEXT]');
                expect(prompt, `locale ${lang}`).toContain('first_entry=true');
            }
        });

        it('numera os passos sequencialmente, sem saltos nem repetições', () => {
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                const steps = [...prompt.matchAll(/^(\d+)\.\s{2}\*\*/gm)].map(m => Number(m[1]));
                expect(steps.length, `locale ${lang}`).toBeGreaterThan(1);
                expect(steps, `locale ${lang}`).toEqual(steps.map((_, i) => i + 1));
            }
        });

        it('manda copiar os identificadores de tema sem traduzir', () => {
            // O prompt é escrito em pt/es mas a lista de temas é inglesa: sem
            // instrução explícita, o modelo traduz e o boost volta a morrer.
            const markers = { pt: 'sem traduzir', en: 'without translating', es: 'sin traducir' };
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                expect(prompt, `locale ${lang}`).toContain(markers[lang]);
            }
        });

        it('define o nível por rubrica direta, não por média aritmética', () => {
            // A média de 5 critérios 1-3, arredondada, prende 82,7% dos casos no
            // nível 2 — a adaptação de registro deixava de diferenciar.
            const markers = { pt: 'NÃO uma média aritmética', en: 'NOT an arithmetic average', es: 'NO un promedio aritmético' };
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                expect(prompt, `locale ${lang}`).toContain(markers[lang]);
                expect(prompt, `locale ${lang}`).not.toContain('average_score');
            }
        });

        it('cobre entrada sem sinal reflexivo suficiente', () => {
            for (const lang of LOCALES) {
                const prompt = String(loadLocale(lang).aiPromptQuote);
                expect(prompt, `locale ${lang}`).toContain('relevant_themes: []');
            }
        });

        it('não vaza palavras de outro idioma, em nenhum dos prompts', () => {
            // Os três idiomas nasceram por tradução manual um do outro, e sobrou
            // texto do vizinho em ambas as direções: o mentor estoico instruía em
            // portunhol ("O Conselho Práctico", "Reglas Adicionais") e o espanhol
            // pedia "Período de Análise". Como é a instrução que define a
            // ESTRUTURA da resposta, o modelo copia o erro para a tela.
            const PROMPTS = ['aiPromptQuote', 'aiSystemInstruction', 'aiPromptMonthly', 'aiPromptQuarterly', 'aiPromptGeneral'];
            const INTRUSOS: Record<string, string[]> = {
                pt: ['palabras', 'Granularidad ', 'puntuación', 'siguiente', 'Días', 'Práctico', 'Reglas', 'fortaleciendo', 'Análisis', 'Historial'],
                es: ['Dias', 'Prático', 'Regras', 'fortalecendo', 'Análise', 'Histórico', 'surgindo', ' and '],
                en: ['Días', 'Dias', 'Reglas', 'Regras', 'Análisis', 'Análise']
            };
            for (const lang of LOCALES) {
                const locale = loadLocale(lang);
                for (const chave of PROMPTS) {
                    const texto = String(locale[chave] ?? '');
                    for (const intruso of INTRUSOS[lang]) {
                        expect(texto.includes(intruso), `${lang}/${chave} contém termo estrangeiro: ${intruso}`).toBe(false);
                    }
                }
            }
        });
    });
});

describe('Montagem do prompt de análise', () => {
    const HABITO = {
        id: 'h1',
        scheduleHistory: [{ name: 'Leitura', mode: 'scheduled' }]
    };

    /** Payload mínimo com o template real de um idioma. */
    function payload(lang: string, extra: Record<string, unknown> = {}) {
        const locale = loadLocale(lang);
        const trans: Record<string, unknown> = {
            promptTemplate: locale.aiPromptMonthly,
            aiSystemInstruction: locale.aiSystemInstruction,
            aiPromptNotesSectionHeader: locale.aiPromptNotesSectionHeader,
            aiPromptGraduatedSection: locale.aiPromptGraduatedSection,
            periodLabel: locale.aiPeriodMonthly
        };
        return { habits: [HABITO], dailyData: {}, translations: trans, languageName: 'Portuguese', ...extra };
    }

    it('não deixa nenhum marcador do template sem substituir', async () => {
        // REGRESSÃO: o montador substituía só {activeHabitDetails} e {history}.
        // {aiPeriodMonthly}, {graduatedHabitsSection} e {notesSection} viajavam
        // literais até o modelo, em todos os idiomas.
        const { buildAiPrompt } = await import('./sync.worker');
        for (const lang of LOCALES) {
            const { prompt } = buildAiPrompt(payload(lang)) as { prompt: string };
            const restantes = prompt.match(/\{[a-zA-Z_]+\}/g);
            expect(restantes, `locale ${lang}`).toBeNull();
        }
    });

    it('põe a nota do usuário em prosa e a tira do JSON do histórico', async () => {
        const { buildAiPrompt } = await import('./sync.worker');
        const dailyData = { '2026-08-10': { h1: { instances: { Morning: { status: 'completed', note: 'custou hoje' } } } } };
        const { prompt } = buildAiPrompt(payload('pt', { dailyData })) as { prompt: string };

        expect(prompt).toContain('Leitura (Morning): custou hoje');
        // o histórico continua no prompt, mas sem duplicar o texto da nota
        expect(prompt).toContain('2026-08-10');
        expect(prompt.match(/custou hoje/g)).toHaveLength(1);
    });

    it('registra objetivo cumprido como nota, com as anotações do percurso', async () => {
        const { buildAiPrompt } = await import('./sync.worker');
        const questNotes = [{
            date: '2026-08-12',
            title: 'Três dias de caminhada',
            target: 3,
            notes: [{ date: '2026-08-10', text: 'comecei devagar' }, { date: '2026-08-12', text: 'fechei' }]
        }];
        const { prompt } = buildAiPrompt(payload('pt', { questNotes })) as { prompt: string };

        expect(prompt).toContain('[quest_completed target=3] Três dias de caminhada');
        expect(prompt).toContain('comecei devagar | fechei');
    });

    it('não inventa seção quando não há nota nem objetivo', async () => {
        const { buildAiPrompt } = await import('./sync.worker');
        const { prompt } = buildAiPrompt(payload('pt')) as { prompt: string };
        expect(prompt).not.toContain('Notas do Usuário');
    });

    it('preserva padrões de $ vindos de nota e de título de objetivo', async () => {
        const { buildAiPrompt } = await import('./sync.worker');
        const texto = "Gastei $& e $` e $$ hoje";
        const dailyData = { '2026-08-10': { h1: { instances: { Morning: { note: texto } } } } };
        const questNotes = [{ date: '2026-08-11', title: "Meta $& de $$", target: 1, notes: [] }];
        const { prompt } = buildAiPrompt(payload('pt', { dailyData, questNotes })) as { prompt: string };

        expect(prompt).toContain(texto);
        expect(prompt).toContain("Meta $& de $$");
    });
});

describe('Montagem do prompt (sync.worker)', () => {
    it('preserva padrões de $ vindos das notas do usuário', async () => {
        // REGRESSÃO: String.replace(str, str) interpreta `$&`, `$\``, `$'` e `$$`
        // no texto de substituição. Uma nota contendo esses padrões era corrompida
        // — trechos do template vazavam para dentro do texto enviado à IA.
        const { buildAiQuoteAnalysisPrompt } = await import('./sync.worker');

        const notes = "Gastei $& hoje, refleti sobre $`isso e $$ economias";
        const result = buildAiQuoteAnalysisPrompt({
            notes,
            themeList: 'action, courage',
            translations: {
                aiPromptQuote: 'Notas:\n{notes}\n---\nTemas: {theme_list}',
                aiSystemInstructionQuote: 'sys'
            }
        }) as { prompt: string };

        expect(result.prompt).toContain(notes);
        expect(result.prompt).not.toContain('{notes}');
        expect(result.prompt).toContain('Temas: action, courage');
    });
});
