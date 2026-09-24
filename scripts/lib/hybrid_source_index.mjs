import { canonicalDigest } from './canonical_json.mjs';

const tokenPattern = /[\p{L}\p{N}_$-]{3,}/gu;
const minimumPlainTermLength = 5;
const queryTermLimit = 64;
const indexSchema = 'aegis.hybrid_source_index.v2';
const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const sourceRegionRank = { COMMENT: 0, UNKNOWN: 1, CODE: 2 };

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function indexDigest(index) {
  const { digest, ...payload } = index;
  void digest;
  return canonicalDigest(payload);
}

function identifierParts(term) {
  const separated = term
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/[_$-]+/gu, ' ');
  return [...new Set(separated
    .split(/\s+/u)
    .map((part) => part.normalize('NFC').toLowerCase())
    .filter((part) => [...part].length >= 3))]
    .sort(compareText);
}

function isCompoundIdentifier(term, parts) {
  return parts.length > 1 || /[_$-]/u.test(term) || /\p{Ll}\p{Lu}/u.test(term);
}

function sourceLineRegions(path, text) {
  const extension = /\.[^./]+$/u.exec(path)?.[0]?.toLowerCase();
  const lines = text.split('\n');
  if (!codeExtensions.has(extension)) return lines.map(() => 'UNKNOWN');
  let blockComment = false;
  return lines.map((line) => {
    const trimmed = line.trimStart();
    if (blockComment) {
      if (trimmed.includes('*/')) blockComment = false;
      return 'COMMENT';
    }
    if (trimmed.startsWith('//')) return 'COMMENT';
    if (trimmed.startsWith('/*')) {
      blockComment = !trimmed.includes('*/');
      return 'COMMENT';
    }
    return 'CODE';
  });
}

/** Constrói uma representação compacta e serializável uma única vez por snapshot. */
export function buildHybridSourceIndex(sourceRecords, sourceSnapshotDigest) {
  const documents = sourceRecords.map(({ path }) => ({ path, length: 0 }));
  const termsByKey = new Map();

  sourceRecords.forEach(({ text, path }, documentIndex) => {
    const normalizedText = text.normalize('NFC');
    const lineRegions = sourceLineRegions(path, normalizedText);
    let line = 1;
    let cursor = 0;
    const occurrences = new Map();

    for (const match of normalizedText.matchAll(tokenPattern)) {
      while (cursor < match.index) {
        if (normalizedText.charCodeAt(cursor) === 0x0A) line += 1;
        cursor += 1;
      }
      const sourceToken = match[0];
      const key = sourceToken.toLowerCase();
      const sourceRegion = lineRegions[line - 1] ?? 'UNKNOWN';
      documents[documentIndex].length += 1;
      const occurrence = occurrences.get(key);
      if (occurrence === undefined) {
        occurrences.set(key, { frequency: 1, line, sourceToken, sourceRegion });
      } else {
        occurrence.frequency += 1;
        if (sourceRegionRank[sourceRegion] > sourceRegionRank[occurrence.sourceRegion]) {
          occurrence.line = line;
          occurrence.sourceToken = sourceToken;
          occurrence.sourceRegion = sourceRegion;
        }
      }
    }

    for (const [key, occurrence] of occurrences) {
      let term = termsByKey.get(key);
      if (term === undefined) {
        const parts = identifierParts(occurrence.sourceToken);
        term = {
          key,
          sourceToken: occurrence.sourceToken,
          parts: isCompoundIdentifier(occurrence.sourceToken, parts) ? parts : [],
          collectionFrequency: 0,
          occurrences: [],
        };
        termsByKey.set(key, term);
      }
      term.collectionFrequency += occurrence.frequency;
      term.occurrences.push({
        document: documentIndex,
        frequency: occurrence.frequency,
        line: occurrence.line,
        sourceToken: occurrence.sourceToken,
        sourceRegion: occurrence.sourceRegion,
      });
    }
  });

  const terms = [...termsByKey.values()].sort((left, right) => compareText(left.key, right.key));
  const unsigned = {
    schema: indexSchema,
    sourceSnapshotDigest,
    documents,
    terms,
  };
  return { ...unsigned, digest: canonicalDigest(unsigned) };
}

function validInteger(value, minimum = 0) {
  return Number.isInteger(value) && value >= minimum;
}

/** Cache é apenas uma otimização: qualquer dúvida faz o chamador reconstruí-lo. */
export function isReusableHybridSourceIndex(index, sourceSnapshotDigest) {
  if (index === null || typeof index !== 'object' || Array.isArray(index)
    || index.schema !== indexSchema
    || index.sourceSnapshotDigest !== sourceSnapshotDigest
    || typeof index.digest !== 'string'
    || indexDigest(index) !== index.digest
    || !Array.isArray(index.documents)
    || !Array.isArray(index.terms)) return false;

  const paths = new Set();
  for (const document of index.documents) {
    if (document === null || typeof document !== 'object'
      || typeof document.path !== 'string'
      || !validInteger(document.length)
      || paths.has(document.path)) return false;
    paths.add(document.path);
  }

  let previousKey = '';
  for (const term of index.terms) {
    if (term === null || typeof term !== 'object'
      || typeof term.key !== 'string'
      || term.key.length < 3
      || compareText(previousKey, term.key) >= 0
      || typeof term.sourceToken !== 'string'
      || !Array.isArray(term.parts)
      || !validInteger(term.collectionFrequency, 1)
      || !Array.isArray(term.occurrences)
      || term.occurrences.length === 0) return false;
    if (term.parts.some((part) => typeof part !== 'string' || part.length < 3)
      || new Set(term.parts).size !== term.parts.length
      || term.parts.some((part, index) => index > 0 && compareText(term.parts[index - 1], part) >= 0)) {
      return false;
    }
    previousKey = term.key;
    let totalFrequency = 0;
    const seenDocuments = new Set();
    for (const occurrence of term.occurrences) {
      if (occurrence === null || typeof occurrence !== 'object'
        || !validInteger(occurrence.document)
        || occurrence.document >= index.documents.length
        || seenDocuments.has(occurrence.document)
        || !validInteger(occurrence.frequency, 1)
        || !validInteger(occurrence.line, 1)
        || typeof occurrence.sourceToken !== 'string'
        || !Object.hasOwn(sourceRegionRank, occurrence.sourceRegion)) return false;
      seenDocuments.add(occurrence.document);
      totalFrequency += occurrence.frequency;
    }
    if (totalFrequency !== term.collectionFrequency) return false;
  }
  return true;
}

function codeSpanRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(/`[^`\r\n]+`/gu)) {
    ranges.push({ start: match.index + 1, end: match.index + match[0].length - 1 });
  }
  return ranges;
}

function isIdentifierLike(term) {
  return /[_$\d-]/u.test(term) || /\p{Ll}\p{Lu}/u.test(term);
}

function isTechnicalName(text, matchIndex, term) {
  if (!/^\p{Lu}/u.test(term)) return false;
  const preceding = text.slice(0, matchIndex).trimEnd().at(-1);
  return preceding !== undefined && !/[.!?:\n*-]/u.test(preceding);
}

function indexLookup(index) {
  const termsByKey = new Map(index.terms.map((term) => [term.key, term]));
  const termsByPart = new Map();
  for (const term of index.terms) {
    for (const part of term.parts) {
      const candidates = termsByPart.get(part) ?? [];
      candidates.push(term);
      termsByPart.set(part, candidates);
    }
  }
  return { termsByKey, termsByPart };
}

function demandTerms(text, lookup) {
  const codeRanges = codeSpanRanges(text);
  const termsByKey = new Map();
  let codeRangeIndex = 0;
  let position = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const term = match[0];
    const key = term.normalize('NFC').toLowerCase();
    while (codeRanges[codeRangeIndex]?.end <= match.index) codeRangeIndex += 1;
    const inCodeSpan = codeRanges[codeRangeIndex]?.start <= match.index
      && match.index < codeRanges[codeRangeIndex]?.end;
    const codeLike = inCodeSpan || isIdentifierLike(term);
    const technicalName = !codeLike && isTechnicalName(text, match.index, term);
    if (!codeLike && [...term].length < minimumPlainTermLength) continue;

    const existing = termsByKey.get(key);
    if (existing !== undefined) {
      existing.occurrences += 1;
      existing.codeLike ||= codeLike;
      existing.technicalName ||= technicalName;
      continue;
    }
    termsByKey.set(key, {
      key,
      term,
      codeLike,
      technicalName,
      occurrences: 1,
      position,
    });
    position += 1;
  }

  const terms = [...termsByKey.values()]
    .map((term) => {
      const exact = lookup.termsByKey.get(term.key);
      const structural = lookup.termsByPart.get(term.key) ?? [];
      return {
        ...term,
        exact,
        structural,
        sourceFrequency: exact?.collectionFrequency
          ?? structural.reduce((total, candidate) => total + candidate.collectionFrequency, 0),
        documentFrequency: exact?.occurrences.length
          ?? structural.reduce((total, candidate) => total + candidate.occurrences.length, 0),
      };
    })
    .filter(({ codeLike, technicalName, sourceFrequency }) => (
      codeLike || technicalName || sourceFrequency > 0
    ))
    .sort((left, right) => Number(right.codeLike) - Number(left.codeLike)
      || Number(right.technicalName) - Number(left.technicalName)
      || Number(right.exact !== undefined) - Number(left.exact !== undefined)
      || Number(right.sourceFrequency > 0) - Number(left.sourceFrequency > 0)
      || left.documentFrequency - right.documentFrequency
      || left.sourceFrequency - right.sourceFrequency
      || right.occurrences - left.occurrences
      || left.position - right.position);
  return {
    terms: terms.slice(0, queryTermLimit),
    termsTruncated: terms.length > queryTermLimit,
  };
}

function compareFractions(leftNumerator, leftDenominator, rightNumerator, rightDenominator) {
  const left = leftNumerator * rightDenominator;
  const right = rightNumerator * leftDenominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function bestDocument(index, term) {
  const totalLength = index.documents.reduce((total, document) => total + document.length, 0);
  if (totalLength === 0) return null;
  const totalLengthBigInt = BigInt(totalLength);
  const documentCount = BigInt(index.documents.length);
  let best = null;
  for (const occurrence of term.occurrences) {
    const document = index.documents[occurrence.document];
    const frequency = BigInt(occurrence.frequency);
    const numerator = frequency * 10n * totalLengthBigInt;
    const denominator = numerator
      + (3n * totalLengthBigInt)
      + (9n * BigInt(document.length) * documentCount);
    const comparison = best === null
      ? 1
      : compareFractions(numerator, denominator, best.numerator, best.denominator);
    const regionComparison = best === null
      ? 1
      : sourceRegionRank[occurrence.sourceRegion] - sourceRegionRank[best.sourceRegion];
    if (best === null || regionComparison > 0
      || (regionComparison === 0 && comparison > 0)
      || (regionComparison === 0
        && comparison === 0
        && compareText(document.path, best.path) < 0)) {
      best = {
        path: document.path,
        line: occurrence.line,
        sourceToken: occurrence.sourceToken,
        sourceRegion: occurrence.sourceRegion,
        numerator,
        denominator,
      };
    }
  }
  return best;
}

function bestStructuralTerm(candidates) {
  return [...candidates].sort((left, right) => left.parts.length - right.parts.length
    || left.occurrences.length - right.occurrences.length
    || left.collectionFrequency - right.collectionFrequency
    || compareText(left.key, right.key))[0];
}

/**
 * Combina busca exata BM25 com fallback por componentes de identificadores.
 * O fallback é evidência estrutural, nunca equivalência semântica.
 */
export function searchHybridSourceIndex(index, intent) {
  const lookup = indexLookup(index);
  const { terms, termsTruncated } = demandTerms(intent, lookup);
  const matches = [];
  for (const query of terms) {
    const sourceTerm = query.exact ?? bestStructuralTerm(query.structural);
    if (sourceTerm === undefined) continue;
    const document = bestDocument(index, sourceTerm);
    if (document === null) continue;
    if (document.sourceRegion === 'COMMENT' && !query.codeLike && !query.technicalName) continue;
    matches.push({
      term: query.term,
      sourceToken: document.sourceToken,
      matchKind: query.exact === undefined ? 'IDENTIFIER_COMPONENT' : 'EXACT_TOKEN',
      path: document.path,
      line: document.line,
      sourceRegion: document.sourceRegion,
    });
  }

  const applicable = index.documents.length > 0 && terms.length > 0;
  return {
    status: applicable ? (matches.length > 0 ? 'MATCH' : 'NO_MATCH') : 'NOT_APPLICABLE',
    method: 'HYBRID_BM25_IDENTIFIER_V2',
    queryTerms: terms.map(({ term }) => term),
    termsTruncated,
    matches,
  };
}
