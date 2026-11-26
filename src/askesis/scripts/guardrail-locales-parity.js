#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const BASE_LOCALE = 'pt';
const SUPPORTED_LOCALES = ['pt', 'en', 'es'];
const PLURAL_KEYS = ['one', 'other'];

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  console.error('❌ Locale parity guardrail failed:');
  list.forEach((message) => console.error(` - ${message}`));
  process.exit(1);
}

function readLocale(code) {
  const filePath = path.join(LOCALES_DIR, `${code}.json`);
  if (!fs.existsSync(filePath)) {
    fail(`missing locale file: locales/${code}.json`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`invalid JSON in locales/${code}.json (${error instanceof Error ? error.message : 'unknown error'})`);
  }
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isPluralObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return PLURAL_KEYS.every((key) => typeof value[key] === 'string');
}

function extractPlaceholderSet(text) {
  const set = new Set();
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  let match = regex.exec(text);
  while (match) {
    set.add(match[1]);
    match = regex.exec(text);
  }
  return set;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

const localeMaps = Object.fromEntries(SUPPORTED_LOCALES.map((code) => [code, readLocale(code)]));
const baseEntries = localeMaps[BASE_LOCALE];
// Chaves que começam com '_' são metadados/comentários internos, não strings de UI
const IGNORED_KEY_PREFIX = '_';
const baseKeys = Object.keys(baseEntries).filter((k) => !k.startsWith(IGNORED_KEY_PREFIX)).sort();
const errors = [];

for (const locale of SUPPORTED_LOCALES) {
  const entries = localeMaps[locale];
  const keys = Object.keys(entries).filter((k) => !k.startsWith(IGNORED_KEY_PREFIX)).sort();

  const missing = baseKeys.filter((key) => !(key in entries));
  const extra = keys.filter((key) => !(key in baseEntries));

  if (missing.length > 0) {
    errors.push(`${locale}: missing keys (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''})`);
  }

  if (extra.length > 0) {
    errors.push(`${locale}: extra keys (${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ', ...' : ''})`);
  }

  for (const key of baseKeys) {
    if (!(key in entries)) continue;

    const baseValue = baseEntries[key];
    const localeValue = entries[key];

    const baseIsPlural = isPluralObject(baseValue);
    const localeIsPlural = isPluralObject(localeValue);

    if (baseIsPlural !== localeIsPlural) {
      errors.push(`${locale}.${key}: expected ${baseIsPlural ? 'plural object' : valueType(baseValue)}, got ${valueType(localeValue)}`);
      continue;
    }

    if (baseIsPlural && localeIsPlural) {
      for (const pKey of PLURAL_KEYS) {
        const basePlaceholders = extractPlaceholderSet(baseValue[pKey]);
        const localePlaceholders = extractPlaceholderSet(localeValue[pKey]);
        if (!sameSet(basePlaceholders, localePlaceholders)) {
          errors.push(`${locale}.${key}.${pKey}: placeholder mismatch with ${BASE_LOCALE}`);
        }
      }
      continue;
    }

    if (typeof baseValue !== typeof localeValue) {
      errors.push(`${locale}.${key}: type mismatch (expected ${valueType(baseValue)}, got ${valueType(localeValue)})`);
      continue;
    }

    if (typeof baseValue === 'string' && typeof localeValue === 'string') {
      const basePlaceholders = extractPlaceholderSet(baseValue);
      const localePlaceholders = extractPlaceholderSet(localeValue);
      if (!sameSet(basePlaceholders, localePlaceholders)) {
        errors.push(`${locale}.${key}: placeholder mismatch with ${BASE_LOCALE}`);
      }
    }
  }
}

if (errors.length > 0) {
  fail(errors.slice(0, 30));
}

console.log('✅ Locale parity guardrail passed.');
