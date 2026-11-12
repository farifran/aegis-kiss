/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file i18n.ts
 * @description Motor de Internacionalização (i18n) e Formatação de Texto/Data/Números.
 * 
 * [MAIN THREAD CONTEXT]:
 * Executa na thread principal. Otimizado para "Zero-Allocation" nos hot-paths.
 * 
 * ARQUITETURA (Pure Logic Layer):
 * - REFACTOR [2025-03-22]: Desacoplado de `render/` para evitar ciclos.
 * - PERF [2025-04-10]: Lookup Tables (O(1)) para TimeOfDay e Weekdays.
 * - SOPA [2025-04-13]: Hub Central de Localização (Strings, Plurais, Datas, Listas, Números, Collation).
 * 
 * DEPENDÊNCIAS CRÍTICAS:
 * - `state.ts`: Acesso ao idioma ativo.
 * - `locales/*.json`: Arquivos de tradução.
 */

import { state, TimeOfDay, LANGUAGES } from './state';
import { logger } from './utils';
import { pushToOneSignal } from './services/push';
import { LANG_LOAD_TIMEOUT_MS } from './constants';
import { emitLanguageChanged } from './events';

// INTERFACE ABSTRATA: Permite que o cache aceite tanto a classe nativa quanto o mock de fallback sem erros de tipo.
interface ListFormatter {
    format(list: Iterable<string>): string;
}

type PluralableTranslation = { one?: string; other: string; [key: string]: string | undefined };
type TranslationValue = string | PluralableTranslation;
type Translations = Record<string, TranslationValue>;

// --- CACHE DE API INTL (Performance Crítica) ---
// Criar instâncias Intl é custoso, então cada idioma monta as suas uma única vez.
type NumberFormatBundle = { int: Intl.NumberFormat; dec: Intl.NumberFormat; evo: Intl.NumberFormat };
type NumberFormatType = keyof NumberFormatBundle;

interface LangBundle {
    pluralRules: Intl.PluralRules;
    collator: Intl.Collator;
    listFormat: ListFormatter;
    numbers: NumberFormatBundle;
    /** Índice = getUTCDay() (0 = domingo). Acesso O(1) nos loops de calendário. */
    weekdays: string[];
}

const bundleCache: Record<string, LangBundle> = {};

// DUAL-LAYER CACHE STRATEGY [2025-04-13]:
// 1. WeakMap: Fast-path para objetos de opções reutilizados (Hoisted Constants). Chave = Referência do Objeto.
// 2. Map (String): Fallback para objetos literais inline. Chave = Serialização das opções.
const dateTimeWeakCache = new Map<string, WeakMap<object, Intl.DateTimeFormat>>();
const dateTimeStringCache = new Map<string, Intl.DateTimeFormat>();

// MEMORY GUARD: Limite de cache para evitar leaks em sessões longas.
const MAX_CACHE_SIZE = 100;

const loadedTranslations: Record<string, Translations> = {};

// CONCURRENCY: Map de Promises em voo para deduplicação de rede.
const inflightRequests = new Map<string, Promise<boolean>>();

// CONSTANTS: Opções estáticas.
const DAY_FORMAT_OPTS: Intl.DateTimeFormatOptions = { weekday: 'short', timeZone: 'UTC' };
// Reference week: Jan 4 1970 was Sunday. Array 0-6 corresponds to Sun-Sat.
const WEEKDAY_REF_DATES = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(1970, 0, 4 + i)));

// PERFORMANCE: Lookup Table para TimeOfDay.
const TIME_OF_DAY_KEYS: Record<TimeOfDay, string> = {
    'Morning': 'filterMorning',
    'Afternoon': 'filterAfternoon',
    'Evening': 'filterEvening'
};

// PERFORMANCE: Hot-Cache (Ponteiros diretos para uso síncrono rápido).
// Os dicionários ficam soltos de propósito: `t()` é o caminho mais quente do app.
let currentDict: Translations | null = null;
let fallbackDict: Translations | null = null; // Granular Fallback (ex: ES -> PT)
let current: LangBundle | null = null;
// Ponteiro direto: o calendário chama getLocaleDayName por célula renderizada,
// e o acesso ao array sem passar pelo bundle é mensuravelmente mais rápido.
let currentWeekdays: string[] = [];
let currentLangCode: string | null = null;

// CONCURRENCY: ID da última requisição.
let latestLangRequestId = 0;

// PERFORMANCE: Pre-compiled Regex.
const INTERPOLATION_REGEX = /{([^{}]+)}/g;

// NETWORK TIMEOUT: Evita Zombie State.

/**
 * Carrega o arquivo JSON de tradução.
 * Implementa padrão Promise Singleton para evitar Race Conditions de rede.
 * RELIABILITY: Adicionado AbortController para timeout.
 */
function loadLanguage(langCode: string): Promise<boolean> {
    // 1. Check Memory Cache (Sync)
    if (loadedTranslations[langCode]) {
        return Promise.resolve(true);
    }

    // 2. Check In-Flight Requests (Async Dedup)
    if (inflightRequests.has(langCode)) {
        return inflightRequests.get(langCode)!;
    }

    // 3. Initiate Network Request with Timeout
    const promise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), LANG_LOAD_TIMEOUT_MS);

        try {
            // A versão vem do conteúdo das traduções (injetada pelo build). Sem ela,
            // o endereço é fixo e um service worker antigo responde com a cópia
            // velha enquanto o bundle novo já veio da rede — texto velho em código
            // novo, que aparece na tela como a chave crua.
            const response = await fetch(`./locales/${langCode}.json?v=${__LOCALE_VERSION__}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`Status: ${response.status}`);
            }
            const translations = await response.json();
            loadedTranslations[langCode] = translations;
            return true;
        } catch (error) {
            clearTimeout(timeoutId);
            logger.error(`Could not load translations for ${langCode}:`, error);
            
            // Fallback Recovery: Garante que PT (base) esteja carregado para o fallbackDict
            // SECURITY: Evita recursão infinita se 'pt' também falhar.
            if (langCode !== 'pt' && !loadedTranslations['pt']) {
                try {
                    // Tentativa única de carregar o fallback
                    logger.warn("Attempting to load fallback 'pt'");
                    await loadLanguage('pt'); 
                } catch (fallbackError) {
                    logger.error(`CRITICAL: Could not load fallback language 'pt'.`, fallbackError);
                }
            }
            return false;
        } finally {
            inflightRequests.delete(langCode);
        }
    })();

    inflightRequests.set(langCode, promise);
    return promise;
}

function triggerBackgroundLoad(langCode: string) {
    loadLanguage(langCode).then(success => {
        if (success && state.activeLanguageCode === langCode) {
            updateHotCache(langCode);
            emitLanguageChanged();
        }
    });
}

/** Devolve o resultado da primeira fábrica que não explodir (degradação graciosa). */
function firstThatWorks<T>(...factories: Array<() => T>): T {
    let lastError: unknown;
    for (const make of factories) {
        try {
            return make();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

const NUMBER_OPTS = {
    int: { maximumFractionDigits: 0 },
    dec: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    evo: { minimumFractionDigits: 1, maximumFractionDigits: 1 }
} as const;

const makeNumbers = (locale?: string): NumberFormatBundle => ({
    int: new Intl.NumberFormat(locale, NUMBER_OPTS.int),
    dec: new Intl.NumberFormat(locale, NUMBER_OPTS.dec),
    evo: new Intl.NumberFormat(locale, NUMBER_OPTS.evo)
});

/**
 * Monta as instâncias Intl de um idioma. Cada campo degrada para PT e, no limite,
 * para um substituto que não quebra o render — browser antigo perde a formatação
 * localizada, nunca a funcionalidade.
 */
function buildBundle(langCode: string): LangBundle {
    const ListFormatCtor = (Intl as unknown as { ListFormat?: new (locales?: string | string[], options?: Intl.ListFormatOptions) => ListFormatter }).ListFormat;
    return {
        pluralRules: firstThatWorks(
            () => new Intl.PluralRules(langCode),
            () => new Intl.PluralRules('pt'),
            () => ({ select: () => 'other' }) as unknown as Intl.PluralRules
        ),
        collator: firstThatWorks(
            () => new Intl.Collator(langCode, { sensitivity: 'base', numeric: true }),
            () => new Intl.Collator('pt')
        ),
        listFormat: firstThatWorks<ListFormatter>(
            () => new ListFormatCtor!(langCode, { style: 'long', type: 'conjunction' }),
            () => ({ format: (list: Iterable<string>) => Array.from(list).join(', ') })
        ),
        numbers: firstThatWorks(
            () => makeNumbers(langCode),
            () => makeNumbers('pt'),
            () => makeNumbers(undefined)
        ),
        weekdays: firstThatWorks(
            () => {
                const dayFormatter = new Intl.DateTimeFormat(langCode, DAY_FORMAT_OPTS);
                return WEEKDAY_REF_DATES.map(date => dayFormatter.format(date).toUpperCase());
            },
            () => bundleCache['pt']?.weekdays ?? []
        )
    };
}

/** Aponta os caches quentes para o idioma indicado, carregando-o se preciso. */
function updateHotCache(langCode: string) {
    currentLangCode = langCode;

    if (loadedTranslations[langCode]) {
        currentDict = loadedTranslations[langCode];
        fallbackDict = langCode !== 'pt' ? (loadedTranslations['pt'] ?? null) : null;
    } else {
        currentDict = loadedTranslations['pt'] || null;
        fallbackDict = null;
        triggerBackgroundLoad(langCode);
    }

    current = bundleCache[langCode] ??= buildBundle(langCode);
    currentWeekdays = current.weekdays;
}

/** Sincroniza os ponteiros quentes com o idioma ativo do estado. */
function syncLang() {
    if (state.activeLanguageCode !== currentLangCode) updateHotCache(state.activeLanguageCode);
}

/**
 * Traduz uma chave para o idioma ativo.
 * [HOT PATH]: Otimizado para zero alocação desnecessária.
 */
export function t(key: string, options?: { [key: string]: string | number | undefined }): string {
    // Sync check
    syncLang();

    if (!currentDict) return key;

    let translationValue = currentDict[key];

    // RESILIENCE: Dictionary Fallback (Granular)
    if (translationValue === undefined && fallbackDict) {
        translationValue = fallbackDict[key];
    }

    if (translationValue === undefined) {
        return key;
    }

    let translationString: string;

    if (typeof translationValue === 'string') {
        translationString = translationValue;
    } else {
        // Pluralization
        if (options?.count !== undefined) {
            // CRASH GUARD: Ensure rules exist
            const rules = current?.pluralRules ?? new Intl.PluralRules('en');
            const pluralKey = rules.select(options.count as number);
            
            const foundString = translationValue[pluralKey] || translationValue.other;
            if (!foundString) return key;
            
            translationString = foundString;
        } else {
            return key;
        }
    }

    if (options) {
        // Fast path
        if (!translationString.includes('{')) {
            return translationString;
        }
        return translationString.replace(INTERPOLATION_REGEX, (_match, k) => {
            const value = options[k];
            return value !== undefined ? String(value) : _match;
        });
    }

    return translationString;
}

/**
 * Compara duas strings usando as regras do idioma ativo.
 * Otimizado para uso em `array.sort()`.
 */
export function compareStrings(a: string, b: string): number {
    syncLang();
    return current ? current.collator.compare(a, b) : a.localeCompare(b);
}

/**
 * Formata uma data usando as regras do idioma ativo.
 * Implementa estratégia de cache de dupla camada (WeakMap -> StringMap) para Alocação Zero.
 */
export function formatDate(date: Date | number | null | undefined, options: Intl.DateTimeFormatOptions): string {
    if (date === null || date === undefined) return '---';

    // CRITICAL GUARD: Check for invalid date before passing to Intl.
    // Intl.DateTimeFormat throws RangeError on invalid dates, which can crash the render loop.
    // CHAOS FIX: Ensure dateObj is actually a Date instance to prevent runtime crash if 'date' is a string/object (Data Rot).
    let dateObj: Date;
    if (typeof date === 'number') {
        dateObj = new Date(date);
    } else if (date instanceof Date) {
        dateObj = date;
    } else {
        // Fallback for corrupted data types (e.g. string from JSON without parsing)
        dateObj = new Date(String(date));
    }

    if (isNaN(dateObj.getTime())) {
        return '---';
    }

    syncLang();

    // 1. WeakMap Lookup (Fast Path / Zero Allocation)
    // Funciona perfeitamente quando o chamador usa constantes hoistadas (ex: OPTS_ARIA_DATE).
    // Evita completamente a serialização de strings.
    let weakCache = dateTimeWeakCache.get(currentLangCode!);
    if (!weakCache) {
        weakCache = new WeakMap();
        dateTimeWeakCache.set(currentLangCode!, weakCache);
    }
    
    let formatter = weakCache.get(options);
    if (formatter) return formatter.format(dateObj);

    // 2. String Key Generation (Slow Path / Fallback)
    // Necessário para objetos literais criados inline (ex: { month: 'short' }).
    // Ainda assim, cacheia o resultado no StringMap para reutilização futura do mesmo formato estrutural.
    const keys = Object.keys(options).sort();
    let optionsKey = '';
    for (const key of keys) {
        optionsKey += `${key}:${options[key as keyof Intl.DateTimeFormatOptions]};`;
    }
    const stringKey = `${currentLangCode}|${optionsKey}`;

    // 3. String Cache Lookup
    formatter = dateTimeStringCache.get(stringKey);
    if (!formatter) {
        // MEMORY LEAK GUARD: Limpa o cache se crescer demais (ex: widgets dinâmicos infinitos).
        if (dateTimeStringCache.size > MAX_CACHE_SIZE) {
            dateTimeStringCache.clear();
        }
        formatter = new Intl.DateTimeFormat(currentLangCode!, options);
        dateTimeStringCache.set(stringKey, formatter);
    }

    // 4. Populate WeakMap (Optimization for future)
    // Se este objeto de opção específico for reutilizado (loop), na próxima vez pegaremos no passo 1.
    weakCache.set(options, formatter);
    
    return formatter.format(dateObj);
}

function _formatNumber(num: number, type: NumberFormatType): string {
    syncLang();
    return current!.numbers[type].format(num);
}

/** 1000 -> "1.000" (PT) / "1,000" (EN). */
export const formatInteger = (num: number) => _formatNumber(num, 'int');

/** 10.5 -> "10,50" (PT) / "10.50" (EN). */
export const formatDecimal = (num: number) => _formatNumber(num, 'dec');

/** 12.5 -> "12,5" (PT) / "12.5" (EN). */
export const formatEvolution = (num: number) => _formatNumber(num, 'evo');

/**
 * Formata uma lista de strings (ex: "A, B e C") usando as regras do idioma ativo.
 */
export function formatList(list: string[]): string {
    if (list.length === 0) return '';
    syncLang();
    return current ? current.listFormat.format(list) : list.join(', ');
}

/**
 * Gets localized time of day name using optimized lookup table.
 */
export function getTimeOfDayName(time: TimeOfDay): string {
    // PERFORMANCE: Static object lookup instead of string concatenation.
    return t(TIME_OF_DAY_KEYS[time] || `filter${time}`);
}

/**
 * Gets localized day name (e.g. "SEG") from cached array.
 * PERFORMANCE: Array access O(1) instead of Date/Intl instantiation.
 */
export function getLocaleDayName(date: Date): string {
    syncLang();
    // getUTCDay() returns 0 for Sunday, matches array index
    return currentWeekdays[date.getUTCDay()] || '';
}

/**
 * Obtém o nome localizado do idioma ativo para ser usado nos prompts da IA.
 */
export function getAiLanguageName(): string {
    syncLang();
    return t(LANGUAGES.find(l => l.code === state.activeLanguageCode)?.nameKey || 'langEnglish');
}

export async function setLanguage(langCode: 'pt' | 'en' | 'es') {
    // Redundancy Guard
    if (state.activeLanguageCode === langCode && loadedTranslations[langCode]) {
        return;
    }

    const requestId = ++latestLangRequestId;
    const success = await loadLanguage(langCode);
    
    if (requestId !== latestLangRequestId) {
        return;
    }

    if (success) {
        state.activeLanguageCode = langCode;
        updateHotCache(langCode);

        // Side Effects
        document.documentElement.lang = langCode;
        localStorage.setItem('habitTrackerLanguage', langCode);
        
        pushToOneSignal((OneSignal: OneSignalLike) => {
            OneSignal.User.setLanguage?.(langCode);
        });

        // Dirty Checking flags
        state.uiDirtyState.calendarVisuals = true;
        state.uiDirtyState.habitListStructure = true;

        emitLanguageChanged();
    } else {
        logger.warn(`setLanguage aborted: Failed to load ${langCode}`);
    }
}