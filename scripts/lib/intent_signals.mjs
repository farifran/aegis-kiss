const signalLimit = 32;
const contextRadius = 80;

const qualityPatterns = [
  { pattern: /\bzero[- ]?gc(?:\s+friendly)?\b/giu, mode: 'GOAL' },
  { pattern: /\b(?:zero[- ]?allocation|no[- ]?allocation)\b/giu, mode: 'EXPLICIT_TARGET' },
  { pattern: /\bsem\b[^.!?\n]{0,120}\baloca(?:ç|c)(?:ão|ões)(?:\s+intermedi[aá]rias?(?:\s+de\s+[\p{L}\p{N}_-]+)?)?/giu, mode: 'EXPLICIT_TARGET' },
  { pattern: /\b(?:alta|high)[ -]?frequ[eê]ncia\b/giu, mode: 'QUANTIFIED_WHEN_EXPLICIT' },
  { pattern: /\b(?:(?:baixa|low)[ -]?)?lat[eê]ncia\b/giu, mode: 'QUANTIFIED_WHEN_EXPLICIT' },
  { pattern: /\b(?:performance|desempenho|throughput|vaz(?:ã|a)o|escalabilidade|scalability)\b/giu, mode: 'QUANTIFIED_WHEN_EXPLICIT' },
  { pattern: /\b(?:r[aá]pid[oa]s?|fast)\b/giu, mode: 'QUANTIFIED_WHEN_EXPLICIT' },
];

const determinismPatterns = [
  /\b(?:determin(?:ismo|ista|[ií]stic[oa]s?)|reprodut[ií]vel|reproducible)\b/giu,
  /\bmesm[ao]\s+entrada[^.!?\n]{0,80}\bmesm[ao]\s+resultado\b/giu,
];

const boundedValuePatterns = [
  /\bbits?\s+\d+\s*[–—-]\s*\d+\b/giu,
  /\b\d+\s*bits?\b/giu,
];

const examplePatterns = [
  /(?:\(\s*como|tais\s+como|por\s+exemplo|e\.g\.)\s+`?[\p{L}\p{N}][\p{L}\p{N}_.-]*`?/giu,
];
const arithmeticPatterns = [
  /\b(?:xor|deslocamentos?|shift(?:s|ing)?|multiplica(?:ç|c)(?:ão|ões)|multiply|m[oó]dulo|modulo|overflow|wrap|satura(?:ç|c)(?:ão|ões))\b/giu,
];

function excerptAt(intent, start, length) {
  const from = Math.max(0, start - contextRadius);
  const to = Math.min(intent.length, start + length + contextRadius);
  const excerpt = intent.slice(from, to).replace(/\s+/gu, ' ').trim();
  return excerpt.length <= 240 ? excerpt : `${excerpt.slice(0, 239).trimEnd()}…`;
}

function nearbyText(intent, start, length) {
  const radius = 48;
  return intent.slice(Math.max(0, start - radius), Math.min(intent.length, start + length + radius));
}

function collectIncompleteExpressions(intent) {
  const signals = [];
  for (const match of intent.matchAll(/\(\s*\)/gu)) {
    const preceding = match.index === 0 ? '' : intent[match.index - 1];
    const following = intent.slice(match.index + match[0].length);
    if (/[\p{L}\p{N}_$\]})]/u.test(preceding)) continue;
    if (/^\s*=>/u.test(following)) continue;
    signals.push({
      kind: 'INCOMPLETE_EXPRESSION',
      handling: 'SEMANTIC_REVIEW',
      offset: match.index,
      reference: match[0],
      excerpt: excerptAt(intent, match.index, match[0].length),
    });
  }
  for (const match of intent.matchAll(/(?<!`)``(?!`)/gu)) {
    signals.push({
      kind: 'INCOMPLETE_EXPRESSION',
      handling: 'SEMANTIC_REVIEW',
      offset: match.index,
      reference: match[0],
      excerpt: excerptAt(intent, match.index, match[0].length),
    });
  }
  const danglingComparator = /\b(?:acima\s+de|abaixo\s+de|maior\s+que|menor\s+que|above|below|greater\s+than|less\s+than)\s*(?=[.,;:!?)]|$)/giu;
  for (const match of intent.matchAll(danglingComparator)) {
    signals.push({
      kind: 'INCOMPLETE_EXPRESSION',
      handling: 'MATERIAL_DECISION',
      offset: match.index,
      reference: match[0].trim(),
      excerpt: excerptAt(intent, match.index, match[0].length),
    });
  }
  return signals;
}

function collectQualityClaims(intent) {
  const signals = [];
  for (const { pattern, mode } of qualityPatterns) {
    for (const match of intent.matchAll(pattern)) {
      const allocationOffset = mode === 'EXPLICIT_TARGET'
        ? match[0].search(/\baloca(?:ç|c)(?:ão|ões)\b/iu)
        : -1;
      const offset = allocationOffset === -1 ? match.index : match.index + allocationOffset;
      const reference = allocationOffset === -1 ? match[0] : match[0].slice(allocationOffset);
      const measurable = mode === 'EXPLICIT_TARGET'
        || (mode === 'QUANTIFIED_WHEN_EXPLICIT'
          && /\d/u.test(nearbyText(intent, match.index, match[0].length)));
      signals.push({
        kind: measurable ? 'QUALITY_CONSTRAINT' : 'QUALITY_GOAL',
        handling: measurable ? 'MEASURABLE_REQUIREMENT' : 'NON_NORMATIVE_GOAL',
        offset,
        reference,
        excerpt: excerptAt(intent, match.index, match[0].length),
      });
    }
  }
  return signals;
}

function collectDeterminismClaims(intent) {
  const signals = [];
  for (const pattern of determinismPatterns) {
    for (const match of intent.matchAll(pattern)) {
      signals.push({
        kind: 'DETERMINISM_CLAIM',
        handling: 'DETERMINISM_REVIEW',
        offset: match.index,
        reference: match[0],
        excerpt: excerptAt(intent, match.index, match[0].length),
      });
    }
  }
  return signals;
}

function collectBoundedValues(intent) {
  const signals = [];
  for (const pattern of boundedValuePatterns) {
    for (const match of intent.matchAll(pattern)) {
      signals.push({
        kind: 'BOUNDED_VALUE',
        handling: 'BOUNDARY_RULE',
        offset: match.index,
        reference: match[0],
        excerpt: excerptAt(intent, match.index, match[0].length),
      });
    }
  }
  return signals;
}

function collectExamples(intent) {
  const signals = [];
  for (const pattern of examplePatterns) {
    for (const match of intent.matchAll(pattern)) {
      const markerOffset = match[0].search(/[\p{L}]/u);
      const reference = match[0].slice(markerOffset);
      signals.push({
        kind: 'EXAMPLE',
        handling: 'NON_NORMATIVE_EXAMPLE',
        offset: match.index + markerOffset,
        reference,
        excerpt: excerptAt(intent, match.index, match[0].length),
      });
    }
  }
  return signals;
}

function collectArithmeticSemantics(intent) {
  const signals = [];
  for (const pattern of arithmeticPatterns) {
    for (const match of intent.matchAll(pattern)) {
      if (!/\b\d+\s*bits?\b/iu.test(nearbyText(intent, match.index, match[0].length))) continue;
      signals.push({
        kind: 'ARITHMETIC_SEMANTICS',
        handling: 'DETERMINISM_REVIEW',
        offset: match.index,
        reference: match[0],
        excerpt: excerptAt(intent, match.index, match[0].length),
      });
    }
  }
  return signals;
}

function overlaps(left, right) {
  const leftEnd = left.offset + left.reference.length;
  const rightEnd = right.offset + right.reference.length;
  return left.offset < rightEnd && right.offset < leftEnd;
}

export function detectIntentSignals(intent) {
  const candidates = [
    ...collectIncompleteExpressions(intent),
    ...collectQualityClaims(intent),
    ...collectExamples(intent),
    ...collectBoundedValues(intent),
    ...collectArithmeticSemantics(intent),
    ...collectDeterminismClaims(intent),
  ].sort((left, right) => left.offset - right.offset
    || right.reference.length - left.reference.length
    || (left.kind < right.kind ? -1 : 1));
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => existing.kind === candidate.kind
      && overlaps(existing, candidate))) continue;
    if (selected.length === signalLimit) throw new Error('intent_signal_limit_exceeded');
    selected.push(candidate);
  }
  return selected.map((signal, index) => ({
    id: `INPUT-${String(index + 1).padStart(4, '0')}`,
    ...signal,
  }));
}
