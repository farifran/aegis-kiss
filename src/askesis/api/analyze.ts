
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

import { GoogleGenAI } from '@google/genai';
import {
    checkRateLimit,
    getClientIp,
    getCorsOrigin as getCorsOriginFromRules,
    isOriginAllowed,
    parseAllowedOrigins,
    parsePositiveInt
} from './_httpSecurity';

export const config = {
  runtime: 'edge',
};

const MAX_PROMPT_SIZE = 150 * 1024; // 150KB
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_MAX_ENTRIES = 500;
const AI_QUOTA_COOLDOWN_MS = parsePositiveInt(process.env.AI_QUOTA_COOLDOWN_MS, 90_000);

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const CORS_STRICT = process.env.CORS_STRICT === '1';

function getCorsOrigin(req: Request): string {
    return getCorsOriginFromRules(req, ALLOWED_ORIGINS);
}

function getCorsHeaders(req: Request): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': getCorsOrigin(req),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
    };
}

// ROBUSTNESS: Support both standard naming conventions
const API_KEY = process.env.API_KEY || process.env.GEMINI_API_KEY;
// Gemini 3.5 Flash-Lite: GA, latência ultrarrápida (~1s) e dimensionado para esta carga.
// Evita o timeout de 12s do cliente (Fetch is aborted) e erros 500 de capacidade do Gemma.
// Permite override via variável de ambiente (AI_MODEL_NAME ou GEMINI_MODEL).
const MODEL_NAME = process.env.AI_MODEL_NAME || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

let aiClient: GoogleGenAI | null = null;
let aiQuotaCooldownUntil = 0;
const responseCache = new Map<string, { value: string; ts: number }>();

function getAiQuotaRetryAfterSec(): number {
    return Math.max(1, Math.ceil(Math.max(0, aiQuotaCooldownUntil - Date.now()) / 1000));
}

async function computeCacheKey(prompt: string, systemInstruction: string, schemaKey: string): Promise<string> {
    const data = new TextEncoder().encode(`${MODEL_NAME}|${prompt}|${systemInstruction}|${schemaKey}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCachedResponse(key: string): string | null {
    const entry = responseCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        responseCache.delete(key);
        return null;
    }
    return entry.value;
}

function setCachedResponse(key: string, value: string) {
    responseCache.set(key, { value, ts: Date.now() });
    if (responseCache.size <= CACHE_MAX_ENTRIES) return;
    // Evict oldest entries when cache grows beyond limit.
    const entries = Array.from(responseCache.entries());
    entries.sort((a, b) => a[1].ts - b[1].ts);
    const excess = responseCache.size - CACHE_MAX_ENTRIES;
    for (let i = 0; i < excess; i++) {
        responseCache.delete(entries[i][0]);
    }
}

const ANALYZE_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.ANALYZE_RATE_LIMIT_WINDOW_MS, 60_000);
const ANALYZE_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.ANALYZE_RATE_LIMIT_MAX_REQUESTS, 20);
const ANALYZE_RATE_LIMIT_DISABLED = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === '1';

type ErrorLike = {
    name?: string;
    message?: string;
    status?: number | string;
    code?: number | string;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && typeof (error as ErrorLike).message === 'string') return (error as ErrorLike).message as string;
    return 'Unknown error';
}

function getErrorStatus(error: unknown): number {
    if (!error || typeof error !== 'object') return 0;
    const maybeStatus = (error as ErrorLike).status ?? (error as ErrorLike).code;
    const parsed = Number(maybeStatus);
    return Number.isFinite(parsed) ? parsed : 0;
}

export default async function handler(req: Request) {
    const reqOrigin = req.headers.get('origin') || '';
    const CORS_HEADERS = getCorsHeaders(req);
    if (CORS_STRICT && ALLOWED_ORIGINS.length > 0 && reqOrigin && !isOriginAllowed(req, reqOrigin, ALLOWED_ORIGINS)) {
        return new Response(JSON.stringify({ error: 'Origin not allowed', code: 'CORS_DENIED' }), {
            status: 403,
            headers: CORS_HEADERS
        });
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'POST') return new Response(null, { status: 405 });

    const ip = getClientIp(req);
    const limiter = await checkRateLimit({
        namespace: 'analyze',
        key: ip,
        windowMs: ANALYZE_RATE_LIMIT_WINDOW_MS,
        maxRequests: ANALYZE_RATE_LIMIT_MAX_REQUESTS,
        disabled: ANALYZE_RATE_LIMIT_DISABLED,
        localMaxEntries: 4000
    });
    if (limiter.limited) {
        return new Response(JSON.stringify({ error: 'Too Many Requests', code: 'RATE_LIMITED' }), {
            status: 429,
            headers: {
                ...CORS_HEADERS,
                'Retry-After': String(limiter.retryAfterSec)
            }
        });
    }

    if (!API_KEY) {
        console.error("Server Config Error: API_KEY or GEMINI_API_KEY not found in environment.");
        return new Response(JSON.stringify({ error: 'Server Configuration: Missing API Key' }), { status: 500, headers: CORS_HEADERS });
    }

    try {
        // CHAOS DEFENSE: Timeout de leitura do prompt para evitar workers pendentes
        const bodyText = await Promise.race([
            req.text(),
            new Promise<string>((_, r) => setTimeout(() => r('TIMEOUT'), 8000))
        ]);

        if (bodyText === 'TIMEOUT') return new Response(null, { status: 408 });
        if (bodyText.length > MAX_PROMPT_SIZE) return new Response(null, { status: 413 });

        const body = JSON.parse(bodyText);
        const { prompt, systemInstruction, responseSchema } = body;

        if (typeof prompt !== 'string' || typeof systemInstruction !== 'string' || !prompt || !systemInstruction) return new Response(null, { status: 400 });

        // Saída estruturada é OPCIONAL: a análise de citação envia um schema e
        // recebe JSON garantido; a avaliação de hábitos não envia e segue
        // recebendo prosa em markdown. O schema é dado do cliente, então entra
        // na chave de cache — schemas distintos produzem saídas distintas.
        const useSchema = !!responseSchema && typeof responseSchema === 'object';
        const schemaKey = useSchema ? JSON.stringify(responseSchema) : '';

        const cacheKey = await computeCacheKey(prompt, systemInstruction, schemaKey);
        const cached = getCachedResponse(cacheKey);
        if (cached) {
            return new Response(cached, {
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'X-Cache': 'HIT'
                }
            });
        }

        if (Date.now() < aiQuotaCooldownUntil) {
            return new Response(JSON.stringify({ error: 'AI quota reached', details: 'RESOURCE_EXHAUSTED' }), {
                status: 429,
                headers: {
                    ...CORS_HEADERS,
                    'Retry-After': String(getAiQuotaRetryAfterSec())
                }
            });
        }

        if (!aiClient) aiClient = new GoogleGenAI({ apiKey: API_KEY });

        // PROTEÇÃO CONTRA ZUMBIFICAÇÃO: Timeout de execução da IA
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                const timeoutError = new Error('AI generation timeout');
                timeoutError.name = 'AbortError';
                reject(timeoutError);
            }, 30000);
        });

        const isGemma = MODEL_NAME.toLowerCase().startsWith('gemma');

        // COMPATIBILIDADE GEMMA: Modelos Gemma não possuem role 'system' nativo em seu tokenizer.
        // Enviar systemInstruction no config do @google/genai gera HTTP 500 Internal Error no backend do Google.
        // Para a família Gemma, injetamos a instrução do sábio estoico no topo do conteúdo.
        const effectiveContents = isGemma && systemInstruction
            ? `[INSTRUÇÕES DO SISTEMA / SÁBIO ESTOICO]:\n${systemInstruction}\n\n[DADOS DO USUÁRIO]:\n${prompt}`
            : prompt;

        const genConfig: Record<string, unknown> = {};
        if (!isGemma && systemInstruction) {
            genConfig.systemInstruction = systemInstruction;
        }
        if (useSchema) {
            genConfig.responseMimeType = 'application/json';
            if (isGemma) {
                // Remove propriedades proprietárias do Gemini (ex: propertyOrdering) que podem quebrar o validador de Gemma
                const cleanSchema = JSON.parse(JSON.stringify(responseSchema, (key, value) => {
                    if (key === 'propertyOrdering') return undefined;
                    return value;
                }));
                genConfig.responseSchema = cleanSchema;
            } else {
                genConfig.responseSchema = responseSchema;
            }
        }

        const geminiResponse = await Promise.race([
            aiClient.models.generateContent({
                model: MODEL_NAME,
                contents: effectiveContents,
                config: genConfig,
            }),
            timeoutPromise
        ]);

        if (timeoutId) clearTimeout(timeoutId);
        
        const responseText = geminiResponse.text;
        if (!responseText) throw new Error('Empty AI response');

        setCachedResponse(cacheKey, responseText);
        aiQuotaCooldownUntil = 0;

        return new Response(responseText, { 
            headers: { 
                ...CORS_HEADERS, 
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Cache': 'MISS'
            } 
        });

    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error("AI Analysis Failed:", errorMessage);

        if (typeof error === 'object' && error && (error as ErrorLike).name === 'AbortError') {
            return new Response('AI Gateway Timeout', { status: 504, headers: CORS_HEADERS });
        }

        const status = getErrorStatus(error);
        const normalizedMessage = errorMessage.toLowerCase();
        const isRateLimit = status === 429
            || normalizedMessage.includes('429')
            || normalizedMessage.includes('resource_exhausted')
            || normalizedMessage.includes('quota')
            || normalizedMessage.includes('rate limit');

        if (isRateLimit) {
            aiQuotaCooldownUntil = Date.now() + AI_QUOTA_COOLDOWN_MS;
            return new Response(JSON.stringify({ error: 'AI quota reached', details: 'RESOURCE_EXHAUSTED' }), {
                status: 429,
                headers: {
                    ...CORS_HEADERS,
                    'Retry-After': String(getAiQuotaRetryAfterSec())
                }
            });
        }

        // SECURITY FIX: Truncate and sanitize error details to prevent information leakage
        const safeDetails = errorMessage.substring(0, 200).replace(/[<>"'&]/g, '');
        return new Response(JSON.stringify({ error: 'AI processing failed', details: safeDetails }), { status: 500, headers: CORS_HEADERS });
    }
}
