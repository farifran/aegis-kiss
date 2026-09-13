const signalLimit = 32;
const contextRadius = 80;

const qualityPatterns = [
  { pattern: /\bzero[- ]?gc(?:\s+friendly)?\b/giu, implicitTarget: true },
  { pattern: /\b(?:zero[- ]?allocation|no[- ]?allocation|sem\s+aloca(?:ç|c)(?:ão|ões))\b/giu, implicitTarget: true },
  { pattern: /\b(?:alta|high)[ -]?frequ[eê]ncia\b/giu, implicitTarget: false },
  { pattern: /\b(?:(?:baixa|low)[ -]?)?lat[eê]ncia\b/giu, implicitTarget: false },
  { pattern: /\b(?:performance|desempenho|throughput|vaz(?:ã|a)o|escalabilidade|scalability)\b/giu, implicitTarget: false },
  { pattern: /\b(?:r[aá]pid[oa]s?|fast)\b/giu, implicitTarget: false },
];

const boundedValuePatterns = [
  /\bbits?\s+\d+\s*[–—-]\s*\d+\b/giu,
  /\b\d+\s*bits?\b/giu,
];

function excerptAt(intent, start, length) {
  const from = Math.max(0, start - contextRadius);
  const to = Math.min(intent.length, start + length + contextRadius);
  return intent.slice(from, to).replace(/\s+/gu, ' ').trim();
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
      handling: 'MATERIAL_DECISION',
      offset: match.index,
      reference: match[0],
      excerpt: excerptAt(intent, match.index, match[0].length),
    });
  }
  for (const match of intent.matchAll(/(?<!`)``(?!`)/gu)) {
    signals.push({
      kind: 'INCOMPLETE_EXPRESSION',
      handling: 'MATERIAL_DECISION',
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
  for (const { pattern, implicitTarget } of qualityPatterns) {
    for (const match of intent.matchAll(pattern)) {
      signals.push({
        kind: 'QUALITY_CONSTRAINT',
        handling: implicitTarget || /\d/u.test(nearbyText(intent, match.index, match[0].length))
          ? 'MEASURABLE_REQUIREMENT'
          : 'MATERIAL_DECISION',
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

function overlaps(left, right) {
  const leftEnd = left.offset + left.reference.length;
  const rightEnd = right.offset + right.reference.length;
  return left.offset < rightEnd && right.offset < leftEnd;
}

export function detectIntentSignals(intent) {
  const candidates = [
    ...collectIncompleteExpressions(intent),
    ...collectQualityClaims(intent),
    ...collectBoundedValues(intent),
  ].sort((left, right) => left.offset - right.offset
    || right.reference.length - left.reference.length
    || (left.kind < right.kind ? -1 : 1));
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => overlaps(existing, candidate))) continue;
    if (selected.length === signalLimit) throw new Error('intent_signal_limit_exceeded');
    selected.push(candidate);
  }
  return selected.map((signal, index) => ({
    id: `INPUT-${String(index + 1).padStart(4, '0')}`,
    ...signal,
  }));
}
