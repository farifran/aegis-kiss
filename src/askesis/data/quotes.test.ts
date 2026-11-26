/**
 * @file data/quotes.test.ts
 * @description Validacao estrutural do catalogo de citacoes estoicas.
 */

import { describe, expect, it } from 'vitest';
import { STOIC_QUOTES, type Quote } from './quotes';

const REQUIRED_LOCALES = ['pt', 'en', 'es'] as const;
const ALLOWED_VIRTUES = new Set(['Wisdom', 'Courage', 'Justice', 'Temperance']);
const ALLOWED_LEVELS = new Set([1, 2, 3]);
const ALLOWED_DISCIPLINES = new Set(['Desire', 'Action', 'Assent']);
const ALLOWED_SPHERES = new Set(['Biological', 'Structural', 'Social', 'Mental']);
const ALLOWED_COERCION = new Set(['Dogmatic', 'Inspirational', 'Reflective', 'Directive']);

function assertLocalizedTextMap(section: string, quoteId: string, data: Record<string, unknown>) {
  for (const locale of REQUIRED_LOCALES) {
    const value = data[locale];
    expect(typeof value, `${section}.${locale} must be string on ${quoteId}`).toBe('string');
    expect((value as string).trim().length, `${section}.${locale} cannot be empty on ${quoteId}`).toBeGreaterThan(0);
  }
}

function assertValidQuoteShape(quote: Quote) {
  expect(typeof quote.id).toBe('string');
  expect(quote.id.trim().length).toBeGreaterThan(0);

  expect(typeof quote.author).toBe('string');
  expect(quote.author.trim().length).toBeGreaterThan(0);

  expect(typeof quote.source).toBe('string');
  expect(quote.source.trim().length).toBeGreaterThan(0);

  assertLocalizedTextMap('original_text', quote.id, quote.original_text as Record<string, unknown>);

  expect(ALLOWED_VIRTUES.has(quote.metadata.virtue), `invalid virtue on ${quote.id}`).toBe(true);
  expect(ALLOWED_LEVELS.has(quote.metadata.level), `invalid level on ${quote.id}`).toBe(true);
  expect(ALLOWED_DISCIPLINES.has(quote.metadata.discipline), `invalid discipline on ${quote.id}`).toBe(true);
  expect(ALLOWED_SPHERES.has(quote.metadata.sphere), `invalid sphere on ${quote.id}`).toBe(true);
  expect(ALLOWED_COERCION.has(quote.metadata.coercion_type), `invalid coercion type on ${quote.id}`).toBe(true);

  expect(Array.isArray(quote.metadata.tags), `metadata.tags must be array on ${quote.id}`).toBe(true);
  expect(quote.metadata.tags.length, `metadata.tags cannot be empty on ${quote.id}`).toBeGreaterThan(0);

  const normalizedTags = quote.metadata.tags.map((tag) => tag.trim().toLowerCase());
  expect(new Set(normalizedTags).size, `metadata.tags cannot contain duplicates on ${quote.id}`).toBe(normalizedTags.length);

  assertLocalizedTextMap('adaptations.level_1', quote.id, quote.adaptations.level_1 as Record<string, unknown>);
  assertLocalizedTextMap('adaptations.level_2', quote.id, quote.adaptations.level_2 as Record<string, unknown>);
  assertLocalizedTextMap('adaptations.level_3', quote.id, quote.adaptations.level_3 as Record<string, unknown>);
}

describe('data/quotes.ts schema', () => {
  it('deve possuir citacoes carregadas', () => {
    expect(Array.isArray(STOIC_QUOTES)).toBe(true);
    expect(STOIC_QUOTES.length).toBeGreaterThan(0);
  });

  it('deve manter IDs unicos', () => {
    const ids = STOIC_QUOTES.map((quote) => quote.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('deve manter estrutura valida para todas as citacoes', () => {
    for (const quote of STOIC_QUOTES) {
      assertValidQuoteShape(quote);
    }
  });
});
