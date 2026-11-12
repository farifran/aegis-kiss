/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file utils.ts
 * @description Biblioteca de Utilitários de Infraestrutura (Clean & Native).
 */

import { HAPTIC_PATTERNS } from './constants';
import { emitDayChanged } from './events';

export const MS_PER_DAY = 86400000;

// --- LOGGER (Dev Only) ---
// Política: usar `logger` em código de app; `console` fica restrito a testes/build.
const SHOULD_LOG = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !== 'production';

export const logger = {
    info: (message: string, data?: unknown) => {
        if (SHOULD_LOG) data !== undefined ? console.log(message, data) : console.log(message);
    },
    warn: (message: string, data?: unknown) => {
        if (SHOULD_LOG) data !== undefined ? console.warn(message, data) : console.warn(message);
    },
    error: (message: string, data?: unknown) => {
        data !== undefined ? console.error(message, data) : console.error(message);
    },
};

// --- TIMERS ---
export type DebouncedFn = (() => void) & { cancel: () => void };

export function createDebounced(fn: () => void, delayMs: number): DebouncedFn {
    let timer: number | undefined;
    const debounced = (() => {
        debounced.cancel();
        timer = window.setTimeout(fn, delayMs);
    }) as DebouncedFn;
    debounced.cancel = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    return debounced;
}

// --- UUID (Crypto Strong) ---
export function generateUUID(): string {
    try {
        if (crypto.randomUUID) return crypto.randomUUID();
    } catch {}

    const bytes = new Uint8Array(16);
    try {
        crypto.getRandomValues(bytes);
    } catch {
        for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) & 0xff;
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- DATAS (UTC estrito) ---
// A tabela vale as duas linhas: toUTCIsoDateString roda 730 vezes por streak
// calculado, e a busca no array é ~3x mais rápida que padStart (medido).
const PAD_LUT = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));

export function pad2(value: number): string {
    return PAD_LUT[value] ?? String(value).padStart(2, '0');
}

export function toUTCIsoDateString(date: Date): string {
    if (isNaN(date.getTime())) throw new Error('CRITICAL: toUTCIsoDateString received Invalid Date.');
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function getTodayUTC(): Date {
    const today = new Date();
    return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
}

// A data de hoje é lida em todo render; recalcular sempre é caro e desnecessário.
let _cachedTodayISO: string | null = null;
let _lastTodayCheckTime = 0;

export function getTodayUTCIso(): string {
    const now = Date.now();
    if (!_cachedTodayISO || now - _lastTodayCheckTime > 60000) {
        _cachedTodayISO = toUTCIsoDateString(getTodayUTC());
        _lastTodayCheckTime = now;
    }
    return _cachedTodayISO;
}

export function resetTodayCache() {
    _cachedTodayISO = null;
    _lastTodayCheckTime = 0;
}

let _midnightTimer: number | undefined;

export function setupMidnightLoop() {
    clearTimeout(_midnightTimer);
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msToMidnight = Math.max(1000, tomorrow.getTime() - now.getTime());
    _midnightTimer = window.setTimeout(() => {
        resetTodayCache();
        emitDayChanged();
        setupMidnightLoop();
    }, msToMidnight + 1000);
}

export function parseUTCIsoDate(isoString: string): Date {
    if (!isoString || typeof isoString !== 'string') return new Date(NaN);
    const date = new Date(`${isoString}T00:00:00.000Z`);
    // `new Date` normaliza overflow (2025-02-30 → 2025-03-02); comparar de volta rejeita a data inválida.
    if (isoString.length === 10 && !isNaN(date.getTime())) {
        const [year, month, day] = isoString.split('-').map(Number);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
            return new Date(NaN);
        }
    }
    return date;
}

export function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export function getSafeDate(date: string | undefined | null): string {
    return date && ISO_DATE_REGEX.test(date) ? date : getTodayUTCIso();
}

// --- TEXTO E HTML ---
const ESCAPE_REPLACEMENTS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Regex e replacer içados: escapeHTML roda por cartão renderizado.
const ESCAPE_REGEX = /[&<>"']/g;
const escapeReplacer = (match: string) => ESCAPE_REPLACEMENTS[match];
export function escapeHTML(str: string): string {
    return str ? str.replace(ESCAPE_REGEX, escapeReplacer) : '';
}

export function sanitizeText(value: string, maxLength?: number): string {
    if (!value) return '';
    const sanitized = value.replace(/[<>{}]/g, '').trim();
    return maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

// --- MARKDOWN (parser mínimo, zero-dep) ---
const MD_INLINE_REGEX = /(\*\*\*(.*?)\*\*\*)|(\*\*(.*?)\*\*)|(\*(.*?)\*)|(~~(.*?)~~)/g;
const MD_HEADING_REGEX = /^(#{1,3}) /;
const MD_UL_REGEX = /^[*+-\s] /;
const MD_OL_REGEX = /^\d+\.\s/;

function formatInline(line: string): string {
    return escapeHTML(line).replace(MD_INLINE_REGEX, (match, b3, c3, b2, c2, i1, ci, s1, cs) => {
        if (b3) return `<strong><em>${c3}</em></strong>`;
        if (b2) return `<strong>${c2}</strong>`;
        if (i1) return `<em>${ci}</em>`;
        if (s1) return `<del>${cs}</del>`;
        return match;
    });
}

export function simpleMarkdownToHTML(text: string): string {
    if (!text) return '';
    const html: string[] = [];
    let openTag: 'ul' | 'ol' | null = null;

    const setList = (tag: 'ul' | 'ol' | null) => {
        if (openTag === tag) return;
        if (openTag) html.push(`</${openTag}>`);
        if (tag) html.push(`<${tag}>`);
        openTag = tag;
    };

    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        const heading = MD_HEADING_REGEX.exec(trimmed);
        if (heading) {
            const level = heading[1].length;
            setList(null);
            html.push(`<h${level}>${formatInline(line.substring(level + 1))}</h${level}>`);
        } else if (MD_UL_REGEX.test(trimmed)) {
            setList('ul');
            html.push(`<li>${formatInline(trimmed.substring(2))}</li>`);
        } else if (MD_OL_REGEX.test(trimmed)) {
            setList('ol');
            html.push(`<li>${formatInline(line.replace(MD_OL_REGEX, ''))}</li>`);
        } else {
            setList(null);
            if (trimmed) html.push(`<p>${formatInline(line)}</p>`);
        }
    }

    setList(null);
    return html.join('');
}

// --- TECLADO (normalização cross-browser) ---
const KEY_ALIASES: Record<string, string> = {
    ' ': 'Space', Spacebar: 'Space', Esc: 'Escape',
    Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown',
};

export function getNormalizedKeyboardKey(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
    // Usa `code` como fallback para manter a detecção de Space estável entre layouts.
    if (event.code === 'Space') return 'Space';
    const key = event.key || '';
    return KEY_ALIASES[key] ?? key;
}

export function isActivationKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'code'>): boolean {
    const key = getNormalizedKeyboardKey(event);
    return key === 'Enter' || key === 'Space';
}

export function isEscapeKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'code'>): boolean {
    return getNormalizedKeyboardKey(event) === 'Escape';
}

// --- HÁPTICO ---
export function triggerHaptic(type: keyof typeof HAPTIC_PATTERNS) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(HAPTIC_PATTERNS[type] as number | number[]); } catch {}
    }
}

/** Contrário de triggerHaptic: corta a vibração em curso ao sair do limite. */
export function stopHaptic() {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(0); } catch {}
    }
}

// --- CONTRASTE DE COR (hot path do render de cartões) ---
let themeColors: { light: string; dark: string } | null = null;
const contrastCache = new Map<string, string>();

function getThemeColors() {
    if (themeColors) return themeColors;
    try {
        const rootStyles = getComputedStyle(document.documentElement);
        themeColors = {
            light: rootStyles.getPropertyValue('--text-primary').trim() || '#e5e5e5',
            dark: rootStyles.getPropertyValue('--bg-color').trim() || '#000000',
        };
    } catch {
        themeColors = { light: '#e5e5e5', dark: '#000000' };
    }
    return themeColors;
}

export function getContrastColor(hexColor: string): string {
    const cached = contrastCache.get(hexColor);
    if (cached) return cached;

    const { light, dark } = getThemeColors();
    if (!hexColor || hexColor.length < 4) return light;

    const hex = hexColor.replace('#', '');
    // Forma curta (#abc) → expandida (#aabbcc).
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    const byte = (i: number) => parseInt(full.slice(i, i + 2), 16) || 0;
    const yiq = byte(0) * 299 + byte(2) * 587 + byte(4) * 114;

    const result = yiq >= 128000 ? dark : light;
    if (contrastCache.size < 100) contrastCache.set(hexColor, result);
    return result;
}
