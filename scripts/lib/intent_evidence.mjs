import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';

const factLimit = 512;
const fragmentLimit = 255;
const anchorLimit = 240;

const bitFieldPattern = /\bbits?\s+(\d+)(?:\s*(?:[\u2013\u2014-]|to|\.\.)\s*(\d+))?\b/giu;

function structuralKind(text) {
  if (/^\s*```/u.test(text)) return 'CODE_FENCE';
  if (/^\s*#{1,6}\s+/u.test(text)) return 'HEADING';
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(text)) return 'LIST_ITEM';
  return 'TEXT';
}

function sentenceRanges(text, absoluteStart) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!'.!?'.includes(text[index])) continue;
    let next = index + 1;
    while (next < text.length && '.!?'.includes(text[next])) next += 1;
    if (next < text.length && !/\s/u.test(text[next])) continue;
    while (next < text.length && /\s/u.test(text[next])) next += 1;
    ranges.push({ startOffset: absoluteStart + start, endOffset: absoluteStart + index + 1 });
    start = next;
    index = next - 1;
  }
  if (start < text.length) {
    ranges.push({ startOffset: absoluteStart + start, endOffset: absoluteStart + text.length });
  }
  return ranges;
}

function fragmentsFrom(intent) {
  const fragments = [];
  for (const match of intent.matchAll(/[^\r\n]+/gu)) {
    const leading = match[0].match(/^\s*/u)?.[0].length ?? 0;
    const trailing = match[0].match(/\s*$/u)?.[0].length ?? 0;
    const startOffset = match.index + leading;
    const endOffset = match.index + match[0].length - trailing;
    if (endOffset <= startOffset) continue;
    const lineText = intent.slice(startOffset, endOffset);
    const kind = structuralKind(lineText);
    const ranges = kind === 'TEXT'
      ? sentenceRanges(lineText, startOffset)
      : [{ startOffset, endOffset }];
    for (const range of ranges) {
      const text = intent.slice(range.startOffset, range.endOffset);
      fragments.push({
        id: `FRAG-${String(fragments.length + 1).padStart(4, '0')}`,
        ...range,
        structuralKind: kind,
        anchor: text.length <= anchorLimit ? text : `${text.slice(0, anchorLimit - 1)}…`,
      });
    }
  }
  if (fragments.length === 0) throw new Error('intent_evidence_without_fragments');
  if (fragments.length > fragmentLimit) throw new Error('intent_fragment_limit_exceeded');
  return fragments;
}

function fragmentIndexAt(fragments, offset, endOffset) {
  return fragments.findIndex((fragment) => (
    fragment.startOffset <= offset && fragment.endOffset >= endOffset
  ));
}

function overlaps(left, right) {
  return left.offset < right.endOffset && right.offset < left.endOffset;
}

function literalCandidates(intent) {
  const candidates = [];
  const add = (kind, match, attributes = {}) => {
    candidates.push({
      kind,
      offset: match.index,
      endOffset: match.index + match[0].length,
      reference: match[0],
      attributes,
    });
  };

  for (const match of intent.matchAll(bitFieldPattern)) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2] ?? match[1], 10);
    add('BIT_RANGE', match, { start, end, width: end - start + 1 });
  }
  for (const match of intent.matchAll(/\b(\d+)\s*[- ]?bits?\b/giu)) {
    add('BIT_WIDTH', match, { width: Number.parseInt(match[1], 10) });
  }
  for (const match of intent.matchAll(/`([^`\r\n]+)`/gu)) {
    add('CODE_SPAN', match, { content: match[1] });
  }
  for (const match of intent.matchAll(/\b(?:src|test|tests)\/(?!\.\.(?:\/|$))[^\s`'"<>()[\]{}]+/gu)) {
    add('REPOSITORY_PATH', match, { path: match[0].replace(/[.,;:!?]+$/u, '') });
  }
  for (const match of intent.matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?n?(?![\p{L}\p{N}_])/gu)) {
    add('NUMBER_LITERAL', match, { value: match[0] });
  }
  for (const match of intent.matchAll(/\(\s*\)/gu)) add('EMPTY_PARENS', match);

  return candidates.sort((left, right) => left.offset - right.offset
    || right.reference.length - left.reference.length
    || left.kind.localeCompare(right.kind, 'en-US'));
}

function literalFacts(intent, fragments) {
  const selected = [];
  for (const candidate of literalCandidates(intent)) {
    if ((candidate.kind === 'BIT_WIDTH' || candidate.kind === 'NUMBER_LITERAL')
      && selected.some((existing) => overlaps(existing, candidate)
        && (existing.kind === 'BIT_RANGE' || existing.kind === 'BIT_WIDTH'))) continue;
    const fragmentIndex = fragmentIndexAt(fragments, candidate.offset, candidate.endOffset);
    if (fragmentIndex < 0) continue;
    selected.push({ ...candidate, fragmentIndex });
  }
  if (selected.length > factLimit) throw new Error('intent_literal_fact_limit_exceeded');
  return selected.map((fact, index) => ({
    id: `FACT-${String(index + 1).padStart(4, '0')}`,
    ...fact,
  }));
}

export function buildIntentEvidence(intent) {
  const fragments = fragmentsFrom(intent);
  const facts = literalFacts(intent, fragments);
  const payload = {
    schema: 'aegis.intent_evidence.v1',
    method: 'LOSSLESS_NEUTRAL_SENTENCES_V2',
    offsetUnit: 'UTF16_CODE_UNIT',
    intentDigest: canonicalDigest(intent),
    fragments,
    literalFacts: facts,
    bitLayouts: [],
  };
  const evidence = { ...payload, evidenceDigest: canonicalDigest(payload) };
  assertIntentEvidence(evidence, intent);
  return evidence;
}

export function assertIntentEvidence(evidence, intent) {
  assertSchema('aegis.intent_evidence.v1', evidence);
  const { evidenceDigest, ...payload } = evidence;
  if (evidenceDigest !== canonicalDigest(payload) || evidence.intentDigest !== canonicalDigest(intent)) {
    throw new Error('intent_evidence_digest_mismatch');
  }
  let previousEnd = -1;
  for (const fragment of evidence.fragments) {
    const source = intent.slice(fragment.startOffset, fragment.endOffset);
    const expectedAnchor = source.length <= anchorLimit
      ? source
      : `${source.slice(0, anchorLimit - 1)}…`;
    if (fragment.startOffset < previousEnd
      || fragment.endOffset <= fragment.startOffset
      || fragment.anchor !== expectedAnchor) {
      throw new Error(`intent_fragment_binding_mismatch:${fragment.id}`);
    }
    previousEnd = fragment.endOffset;
  }
  for (const fact of evidence.literalFacts) {
    if (intent.slice(fact.offset, fact.endOffset) !== fact.reference
      || evidence.fragments[fact.fragmentIndex] === undefined) {
      throw new Error(`intent_fact_binding_mismatch:${fact.id}`);
    }
  }
}
