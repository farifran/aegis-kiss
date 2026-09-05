#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { TextDecoder } from 'node:util';

const defaultMaxBytes = 65_536;

function fail(code) {
  process.stderr.write(`[AEGIS][NORMALIZE][FATAL] ${code}\n`);
  process.exit(1);
}

function parseMaxBytes(argv) {
  if (argv.length === 0) return defaultMaxBytes;
  if (argv.length === 2 && argv[0] === '--max-bytes' && /^[1-9][0-9]*$/.test(argv[1])) {
    return Number(argv[1]);
  }
  fail('invalid_arguments');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function range(startByte, endByte) {
  return { startByte, endByte };
}

function addSegment(segments, rawStart, rawEnd, normalizedStart, normalizedEnd) {
  const previous = segments.at(-1);
  const rawLength = rawEnd - rawStart;
  const normalizedLength = normalizedEnd - normalizedStart;
  const previousRawLength = previous === undefined ? -1 : previous.raw.endByte - previous.raw.startByte;
  const previousNormalizedLength = previous === undefined ? -1 : previous.normalized.endByte - previous.normalized.startByte;
  if (
    previous !== undefined
    && previous.raw.endByte === rawStart
    && previous.normalized.endByte === normalizedStart
    && rawLength === normalizedLength
    && previousRawLength === previousNormalizedLength
  ) {
    previous.raw.endByte = rawEnd;
    previous.normalized.endByte = normalizedEnd;
    return;
  }
  segments.push({ raw: range(rawStart, rawEnd), normalized: range(normalizedStart, normalizedEnd) });
}

function normalizeLineEndings(rawText) {
  const text = [];
  const sourceMap = [];
  let rawOffset = 0;
  let normalizedOffset = 0;
  let crlfCount = 0;

  for (let index = 0; index < rawText.length;) {
    const unit = rawText.codePointAt(index);
    if (unit === undefined) break;
    const character = String.fromCodePoint(unit);
    const rawUnit = character === '\r' && rawText[index + 1] === '\n' ? '\r\n' : character;
    const normalizedUnit = rawUnit === '\r\n' ? '\n' : rawUnit;
    const rawLength = byteLength(rawUnit);
    const normalizedLength = byteLength(normalizedUnit);
    text.push(normalizedUnit);
    addSegment(
      sourceMap,
      rawOffset,
      rawOffset + rawLength,
      normalizedOffset,
      normalizedOffset + normalizedLength,
    );
    rawOffset += rawLength;
    normalizedOffset += normalizedLength;
    index += rawUnit.length;
    if (rawUnit === '\r\n') crlfCount += 1;
  }

  return {
    text: text.join(''),
    sourceMap,
    transformations: crlfCount === 0 ? [] : [{ kind: 'CRLF_TO_LF', count: crlfCount }],
  };
}

function classifyLine(line) {
  const content = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (/^#{1,6}\s+/.test(content)) return 'heading';
  if (/^>\s?/.test(content)) return 'quote';
  if (/^(?:[-+*]|\d+[.)])\s+/.test(content)) return 'list';
  if (/^\[[^\]]+\]\([^\s)]+\)$/.test(content)) return 'link';
  return 'paragraph';
}

function extractBlocks(text) {
  const lines = text.match(/.*(?:\n|$)/gu) ?? [];
  const blocks = [];
  let offset = 0;
  let codeFence = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    const endOffset = offset + byteLength(line);
    const content = line.endsWith('\n') ? line.slice(0, -1) : line;
    let kind;
    if (codeFence || /^```/.test(content)) {
      kind = 'code';
      if (/^```/.test(content)) codeFence = !codeFence;
    } else {
      kind = classifyLine(line);
    }
    const previous = blocks.at(-1);
    if (previous !== undefined && previous.kind === kind && previous.range.endByte === offset) {
      previous.range.endByte = endOffset;
    } else {
      blocks.push({ kind, range: range(offset, endOffset) });
    }
    offset = endOffset;
  }
  return blocks;
}

function normalizedByteOffset(text, utf16Offset) {
  return byteLength(text.slice(0, utf16Offset));
}

function isPathLike(value) {
  return value.includes('/') || /\.[A-Za-z0-9_-]{1,12}$/.test(value);
}

function addReference(references, kind, value, startIndex, endIndex, text) {
  const item = {
    kind,
    value,
    range: range(normalizedByteOffset(text, startIndex), normalizedByteOffset(text, endIndex)),
  };
  if (
    kind === 'path'
    && references.some((existing) => (
      existing.kind === 'url'
      && item.range.startByte >= existing.range.startByte
      && item.range.endByte <= existing.range.endByte
    ))
  ) return;
  if (references.some((existing) => (
    existing.kind === item.kind
    && existing.value === item.value
    && existing.range.startByte === item.range.startByte
    && existing.range.endByte === item.range.endByte
  ))) return;
  references.push(item);
}

function extractReferences(text) {
  const references = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gu)) {
    addReference(references, 'url', match[0], match.index, match.index + match[0].length, text);
  }
  for (const match of text.matchAll(/`([^`\n]+)`/gu)) {
    const value = match[1];
    const start = match.index + 1;
    if (isPathLike(value)) {
      addReference(references, 'path', value, start, start + value.length, text);
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:[.:][A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(value)) {
      addReference(references, 'symbol', value, start, start + value.length, text);
    }
  }
  for (const match of text.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/gu)) {
    addReference(references, 'path', match[0], match.index, match.index + match[0].length, text);
  }
  return references.sort((left, right) => left.range.startByte - right.range.startByte || left.kind.localeCompare(right.kind));
}

const maxBytes = parseMaxBytes(process.argv.slice(2));
const chunks = [];
let inputBytes = 0;

process.stdin.on('data', (chunk) => {
  inputBytes += chunk.length;
  if (inputBytes > maxBytes) fail('input_too_large');
  chunks.push(chunk);
});

process.stdin.on('error', () => fail('input_read_failed'));

process.stdin.on('end', () => {
  const rawBytes = Buffer.concat(chunks);
  let rawText;
  try {
    rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBytes);
  } catch {
    fail('invalid_utf8');
    return;
  }
  if (rawText.trim().length === 0) {
    fail('empty_demand');
    return;
  }

  const normalized = normalizeLineEndings(rawText);
  const output = {
    schema: 'aegis.normalized_demand.v1',
    normalizerVersion: '1',
    rawDigest: digest(rawBytes),
    normalizedDigest: digest(normalized.text),
    rawByteLength: rawBytes.length,
    normalizedByteLength: byteLength(normalized.text),
    text: normalized.text,
    sourceMap: normalized.sourceMap,
    transformations: normalized.transformations,
    blocks: extractBlocks(normalized.text),
    correctionCandidates: [],
    references: extractReferences(normalized.text),
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
});
