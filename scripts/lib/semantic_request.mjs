import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { analyzeBitLayouts, detectIntentSignals } from './intent_signals.mjs';
import { assertSchema, schemaDocument } from './schema_validator.mjs';
import {
  counterexampleForSubject,
  mechanicalPolicySignals,
  policySignalSemantics,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
} from './semantic_authority.mjs';

const counterLabelPattern = /\b(?:quantidade|contagem|contador(?:es)?|n[uú]mero\s+de|cantidad|conteo|count(?:er)?|number\s+of)\b/iu;
const explicitBoundaryPattern = /\b(?:satur\w*|wrap\w*|m[oó]dulo|modulo|trunc\w*|rejeit\w*|reject\w*|erro|error)\b/iu;
const merklePattern = /\bmerkle\b/iu;
const integerArithmeticPattern = /\b(?:bigint|inteiros?\s+puros?|integer\s+arithmetic|divis[aã]o\s+inteira|integer\s+division)\b/iu;
const divisionOperationPattern = /\b(?:divis[aã]o|division|partial\s+fill|preenchimento\s+(?:parcial|fracion[aá]rio)|raz[aã]o\s+entre|ratio\s+between)\b/iu;
const distributedDivisionPattern = /\b(?:partial\s+fill|preenchimento\s+(?:parcial|fracion[aá]rio))\b/iu;
const purityPattern = /\b(?:fun[cç][aã]o\s+pura|pure\s+function)\b/giu;

function fieldClause(intent, signal) {
  const start = signal.offset + signal.reference.length;
  return intent.slice(start, start + 180).split(/[;\n.]/u, 1)[0].trim();
}

function exactBoundaryValue(width, offset) {
  if (width <= 256) return ((1n << BigInt(width)) + BigInt(offset)).toString();
  if (offset === -2) return `2^${width}-2`;
  if (offset === -1) return `2^${width}-1`;
  return `2^${width}`;
}

function counterBoundaryFor({ intent, signal, width, semanticRole }) {
  if (semanticRole !== 'OBSERVABILITY_COUNTER') return null;
  const clause = fieldClause(intent, signal);
  if (explicitBoundaryPattern.test(clause)) return null;
  const belowMaximum = exactBoundaryValue(width, -2);
  const maximum = exactBoundaryValue(width, -1);
  const aboveMaximum = exactBoundaryValue(width, 0);
  return {
    authority: 'ARCH-OBSERVABILITY-COUNTERS',
    resolutionKind: 'OVERFLOW_SATURATE',
    resolutionParameter: `SATURATE_MAX=${maximum}`,
    proofCases: [
      { input: belowMaximum, expected: belowMaximum },
      { input: maximum, expected: maximum },
      { input: aboveMaximum, expected: maximum },
    ],
  };
}

function signalIndexesMatching(intentSignals, pattern) {
  return intentSignals.flatMap((signal, index) => (
    pattern.test(`${signal.reference} ${signal.excerpt}`) ? [index] : []
  ));
}

function firstPatternTrigger(intent, pattern) {
  const match = pattern.exec(intent);
  if (match === null) throw new Error('semantic_worksheet_activation_without_trigger');
  return { triggerOffset: match.index, triggerReference: match[0] };
}

function determinismActivations(intent, intentSignals, bitFields) {
  const pending = [];
  if (merklePattern.test(intent)) {
    pending.push({
      dimension: 'ORDERING',
      subject: { kind: 'OPERATION', key: 'MERKLE_SEQUENCE' },
      triggerSignalIndexes: signalIndexesMatching(intentSignals, merklePattern),
      ...firstPatternTrigger(intent, merklePattern),
    });
  }
  if (integerArithmeticPattern.test(intent) && divisionOperationPattern.test(intent)) {
    const triggerSignalIndexes = signalIndexesMatching(
      intentSignals,
      /\b(?:bigint|partial\s+fill|preenchimento\s+(?:parcial|fracion[aá]rio)|divis[aã]o|raz[aã]o)\b/iu,
    );
    pending.push(
      {
        dimension: 'ROUNDING',
        subject: { kind: 'OPERATION', key: 'INTEGER_DIVISION' },
        triggerSignalIndexes,
        ...firstPatternTrigger(intent, divisionOperationPattern),
      },
      {
        dimension: 'ZERO_DIVISOR',
        subject: { kind: 'OPERATION', key: 'INTEGER_DIVISION' },
        triggerSignalIndexes,
        ...firstPatternTrigger(intent, divisionOperationPattern),
      },
    );
    if (distributedDivisionPattern.test(intent)) {
      pending.push({
        dimension: 'REMAINDER_DISTRIBUTION',
        subject: { kind: 'OPERATION', key: 'DISTRIBUTED_INTEGER_DIVISION' },
        triggerSignalIndexes,
        ...firstPatternTrigger(intent, distributedDivisionPattern),
      });
    }
  }
  for (const field of bitFields.filter(({ semanticRole }) => (
    semanticRole === 'OBSERVABILITY_COUNTER'
  ))) {
    pending.push({
      dimension: 'BOUNDED_ARITHMETIC',
      subject: { kind: 'BIT_FIELD', key: `BITS_${field.startBit}_${field.endBit}` },
      triggerSignalIndexes: [field.signalIndex],
      triggerOffset: intentSignals[field.signalIndex].offset,
      triggerReference: intentSignals[field.signalIndex].reference,
    });
  }
  return pending.map((activation, index) => ({
    id: `DET-ACT-${String(index + 1).padStart(4, '0')}`,
    ...activation,
    counterexampleWitness: counterexampleForSubject(
      activation.dimension,
      activation.subject.key,
    ),
  }));
}

function finiteRepresentation(intent, signal, signalIndex, bitLayouts) {
  if (signal.kind !== 'BOUNDED_VALUE') return null;
  const range = /\bbits?\s+(\d+)(?:\s*[–—-]\s*(\d+))?\b/iu.exec(signal.reference);
  const declared = /\b(\d+)\s*bits?\b/iu.exec(signal.reference);
  if (range === null && declared === null) return null;
  const startBit = range === null ? null : Number.parseInt(range[1], 10);
  const endBit = range === null ? null : Number.parseInt(range[2] ?? range[1], 10);
  const width = range === null ? Number.parseInt(declared[1], 10) : endBit - startBit + 1;
  if (!Number.isSafeInteger(width) || width < 1) return null;
  const declaredLayout = bitLayouts.some(({ declaredWidthSignalIndex }) => (
    declaredWidthSignalIndex === signalIndex
  ));
  const layoutField = bitLayouts.some(({ fieldSignalIndexes }) => (
    fieldSignalIndexes.includes(signalIndex)
  ));
  let role = 'UNCLASSIFIED';
  const preceding = intent.slice(Math.max(0, signal.offset - 64), signal.offset);
  const following = intent.slice(
    signal.offset + signal.reference.length,
    signal.offset + signal.reference.length + 64,
  );
  if (declaredLayout) role = 'BITMASK_LAYOUT';
  else if (layoutField) role = 'BIT_FIELD';
  else if (/^\s*(?:mais\s+significativos|most\s+significant)\b/iu.test(following)) {
    role = 'PROJECTION_WIDTH';
  } else if (/\b(?:hash|fingerprint|raiz|merkle)\b/iu.test(preceding)
    || /^\s*(?:de\s+)?(?:hash|fingerprint|raiz|merkle|fnv)\b/iu.test(following)) {
    role = 'HASH_WIDTH';
  }
  const exactCapacity = width <= 256;
  const patternCount = exactCapacity ? 1n << BigInt(width) : null;
  return {
    id: `REP-${String(signalIndex + 1).padStart(4, '0')}`,
    signalIndex,
    form: range === null ? 'DECLARED_WIDTH' : 'BIT_RANGE',
    role,
    startBit,
    endBit,
    width,
    patternCount: patternCount === null ? `2^${width}` : patternCount.toString(),
    unsignedMaximum: patternCount === null ? `2^${width}-1` : (patternCount - 1n).toString(),
  };
}

function mechanicalProofObligations(intent) {
  return [...intent.matchAll(purityPattern)].map((match, index) => ({
    id: `MECH-PROOF-${String(index + 1).padStart(4, '0')}`,
    kind: 'OBSERVATIONAL_PURITY',
    triggerOffset: match.index,
    triggerReference: match[0],
    acceptanceCase: {
      given: 'Um estado válido S e uma entrada válida X.',
      when: 'X for processada após chamadas repetidas da função observacional.',
      then: 'O resultado e o estado futuro observável devem ser idênticos à execução de X sem chamadas observacionais intermediárias.',
      outcomeKind: 'RETURN_VALUE',
    },
  }));
}

export function loadSemanticConstitution(repositoryRoot) {
  const policyPath = resolve(repositoryRoot, 'governance/constitution.json');
  const policyMetadata = lstatSync(policyPath);
  if (!policyMetadata.isFile() || policyMetadata.isSymbolicLink()) {
    throw new Error('semantic_constitution_unavailable');
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch {
    throw new Error('semantic_constitution_invalid_json');
  }
  assertSchema('aegis.constitution.v1', policy);
  const sourcePath = resolve(repositoryRoot, policy.origin.sourcePath);
  const sourceMetadata = lstatSync(sourcePath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error('semantic_constitution_origin_unavailable');
  }
  if (sha256(readFileSync(sourcePath)) !== policy.origin.sourceDigest) {
    throw new Error('semantic_constitution_origin_mismatch');
  }
  return {
    schema: policy.schema,
    version: policy.constitutionVersion,
    digest: canonicalDigest(policy),
    authority: 'TRUSTED_CONSTITUTION',
    rules: policy.rules,
  };
}

function decodeUtf8Prefix(bytes, byteLimit) {
  let end = Math.min(bytes.byteLength, byteLimit);
  while (end > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return '';
}

function compactOutputSchema(value) {
  if (Array.isArray(value)) return value.map(compactOutputSchema);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'description' && key !== 'title')
    .map(([key, item]) => [key, compactOutputSchema(item)]));
}

function verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation = null) {
  const observedBytes = workspaceObservation?.sourceBytesByPath?.get(manifestEntry.path);
  if (observedBytes !== undefined) {
    if (observedBytes.byteLength !== manifestEntry.bytes
      || sha256(observedBytes) !== manifestEntry.digest) {
      throw new Error(`semantic_source_changed:${manifestEntry.path}`);
    }
    return observedBytes;
  }
  const absolutePath = resolve(repositoryRoot, manifestEntry.path);
  const metadata = lstatSync(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`semantic_source_changed:${manifestEntry.path}`);
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.byteLength !== manifestEntry.bytes || sha256(bytes) !== manifestEntry.digest) {
    throw new Error(`semantic_source_changed:${manifestEntry.path}`);
  }
  return bytes;
}

function lineWindow(bytes, targetLine, byteLimit) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split('\n');
  const target = Math.min(Math.max(targetLine - 1, 0), lines.length - 1);
  let start = target;
  let end = target + 1;
  let content = lines[target];
  while (start > 0 || end < lines.length) {
    const nextStart = start > 0 ? start - 1 : start;
    const nextEnd = end < lines.length ? end + 1 : end;
    const candidate = lines.slice(nextStart, nextEnd).join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > byteLimit) break;
    start = nextStart;
    end = nextEnd;
    content = candidate;
  }
  if (Buffer.byteLength(content, 'utf8') > byteLimit) {
    content = decodeUtf8Prefix(Buffer.from(content), byteLimit);
  }
  return { content, startLine: start + 1, endLine: end };
}

function buildSourceEvidence(repositoryRoot, preflight, workspaceObservation = null) {
  const textFiles = preflight.discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const filesByPath = new Map(textFiles.map((file) => [file.path, file]));
  const smallWorkspace = textFiles.reduce((total, { bytes }) => total + bytes, 0)
    <= sourceEvidenceByteLimit;
  const entrypoints = textFiles
    .map(({ path }) => path)
    .filter((path) => /(?:^|\/)(?:index|main|mod)\.[^/]+$/iu.test(path));
  const selections = smallWorkspace
    ? textFiles.map(({ path }) => ({ path, line: null }))
    : [
      ...new Map(preflight.discovery.lexicalEvidence.matches
        .map(({ path, line }) => [`${path}:${line}`, { path, line }])).values(),
      ...entrypoints
        .filter((path) => !preflight.discovery.lexicalEvidence.matches
          .some((match) => match.path === path))
        .map((path) => ({ path, line: null })),
    ];
  if (!smallWorkspace && selections.length === 0 && textFiles[0] !== undefined) {
    selections.push({ path: textFiles[0].path, line: null });
  }
  const evidence = [];
  let remainingBytes = sourceEvidenceByteLimit;

  for (const { path, line: matchLine } of selections) {
    if (remainingBytes === 0) break;
    const manifestEntry = filesByPath.get(path);
    if (manifestEntry === undefined) continue;
    const bytes = verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation);
    const limit = Math.min(smallWorkspace ? bytes.byteLength : sourceEvidenceFileByteLimit, remainingBytes);
    let excerpt;
    if (!smallWorkspace && matchLine !== null) {
      excerpt = lineWindow(bytes, matchLine, limit);
    } else {
      const content = decodeUtf8Prefix(bytes, limit);
      excerpt = {
        content,
        startLine: 1,
        endLine: content.split('\n').length,
      };
    }
    const { content, startLine, endLine } = excerpt;
    const consumedBytes = Buffer.byteLength(content, 'utf8');
    remainingBytes -= consumedBytes;
    evidence.push({
      path,
      content,
      startLine,
      endLine,
      truncated: consumedBytes < bytes.byteLength,
      selection: smallWorkspace
        ? 'FULL_SOURCE'
        : matchLine === null ? 'ENTRYPOINT_PREFIX' : 'LEXICAL_WINDOW',
      trust: 'UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS',
    });
  }

  return evidence;
}

export function buildSemanticRequest({
  repositoryRoot,
  preflight,
  policy,
  constitution,
  revision = null,
  workspaceObservation = null,
}) {
  const detectedIntentSignals = detectIntentSignals(preflight.intent);
  const observedTextPaths = preflight.discovery.files
    .filter(({ kind }) => kind === 'UTF8_TEXT')
    .map(({ path }) => path);
  const unavailablePaths = [
    ...preflight.discovery.files
      .filter(({ kind }) => kind !== 'UTF8_TEXT')
      .map(({ path, kind }) => ({ path, reason: kind })),
    ...preflight.discovery.ignoredEntries,
  ];
  const context = {
    delivery: {
      constitution: 'SYSTEM_INSTRUCTION',
      architecture: 'TRUSTED_POLICY',
      intent: 'USER_DATA',
      intentSignals: 'MECHANICAL_REVIEW_OBLIGATIONS',
      workspace: 'UNTRUSTED_EVIDENCE',
      revision: 'USER_DECISION',
      outputSchema: 'STRICT_STRUCTURED_OUTPUT',
    },
    constitution,
    intent: preflight.intent,
    intentSignals: {
      method: 'DETERMINISTIC_INTENT_REVIEW_V3',
      status: detectedIntentSignals.length === 0 ? 'CLEAR' : 'REVIEW_REQUIRED',
      signals: detectedIntentSignals,
    },
    workspace: {
      status: preflight.discovery.status,
      observedTextPaths,
      unavailablePaths,
      lexicalEvidence: {
        status: preflight.discovery.lexicalEvidence.status,
        termsTruncated: preflight.discovery.lexicalEvidence.termsTruncated,
        matches: preflight.discovery.lexicalEvidence.matches
          .map(({ term, sourceToken, matchKind, path, line, sourceRegion }) => ({
            term,
            sourceToken,
            matchKind,
            path,
            line,
            sourceRegion,
          })),
      },
      sourceEvidence: buildSourceEvidence(repositoryRoot, preflight, workspaceObservation),
    },
    policy: {
      contexts: policy.contexts,
      signalSemantics: policySignalSemantics,
      rules: policy.rules.map((rule) => ({
        id: rule.id,
        level: rule.level,
        statement: rule.statement,
        appliesWhen: rule.appliesWhen,
        appliesMode: rule.appliesMode,
        reviewReferences: rule.reviewReferences,
        forbiddenReferences: rule.forbiddenReferences,
      })),
      signals: mechanicalPolicySignals(policy, preflight.intent),
      amendments: (policy.amendments ?? []).map(({ id, ruleId, reason }) => ({
        id,
        ruleId,
        reason,
      })),
    },
    revision,
  };
  const contextDigest = canonicalDigest(context);
  const worksheet = buildSemanticWorksheet({
    contextDigest,
    intent: preflight.intent,
    intentSignals: detectedIntentSignals,
  });
  const worksheetDigest = canonicalDigest(worksheet);
  const outputSchemaDocument = compactOutputSchema(schemaDocument('aegis.semantic_opinion.v2'));
  outputSchemaDocument.properties.worksheetDigest = { const: worksheetDigest };
  const requestWithoutDigest = {
    schema: 'aegis.semantic_request.v9',
    contextDigest,
    ...context,
    worksheetDigest,
    worksheet,
    outputSchema: {
      id: 'aegis.semantic_opinion.v2',
      digest: canonicalDigest(outputSchemaDocument),
      strict: true,
      document: outputSchemaDocument,
    },
  };
  const request = {
    ...requestWithoutDigest,
    requestDigest: canonicalDigest(requestWithoutDigest),
  };
  assertSchema('aegis.semantic_request.v9', request);
  return request;
}

export function buildSemanticWorksheet({ contextDigest, intent, intentSignals }) {
  const bitLayouts = analyzeBitLayouts(intent, intentSignals);
  const finiteRepresentations = intentSignals
    .map((signal, signalIndex) => finiteRepresentation(
      intent,
      signal,
      signalIndex,
      bitLayouts,
    ))
    .filter((representation) => representation !== null);
  const bitFields = intentSignals.flatMap((signal, signalIndex) => {
    if (signal.kind !== 'BOUNDED_VALUE') return [];
    const match = /\bbits?\s+(\d+)(?:\s*[–—-]\s*(\d+))?\b/iu.exec(signal.reference);
    if (match === null) return [];
    const startBit = Number.parseInt(match[1], 10);
    const endBit = Number.parseInt(match[2] ?? match[1], 10);
    if (!Number.isSafeInteger(startBit)
      || !Number.isSafeInteger(endBit)
      || endBit < startBit) return [];
    const width = endBit - startBit + 1;
    const exactCapacity = Number.isSafeInteger(width) && width <= 256;
    const patternCount = exactCapacity ? 1n << BigInt(width) : null;
    const isLayoutField = bitLayouts.some((layout) => (
      layout.fieldSignalIndexes.includes(signalIndex)
      && layout.declaredWidthSignalIndex !== signalIndex
    ));
    const semanticRole = isLayoutField
      && width > 1
      && counterLabelPattern.test(fieldClause(intent, signal))
      ? 'OBSERVABILITY_COUNTER'
      : 'UNCLASSIFIED';
    return [{
      signalIndex,
      startBit,
      endBit,
      width,
      patternCount: patternCount === null ? `2^${width}` : patternCount.toString(),
      unsignedMaximum: patternCount === null ? `2^${width}-1` : (patternCount - 1n).toString(),
      semanticRole,
      counterBoundary: counterBoundaryFor({ intent, signal, width, semanticRole }),
    }];
  });
  const activations = determinismActivations(intent, intentSignals, bitFields);
  const worksheet = {
    schema: 'aegis.semantic_worksheet.v1',
    contextDigest,
    determinismActivations: activations,
    mechanicalProofObligations: mechanicalProofObligations(intent),
    finiteRepresentations,
    bitFields,
    bitLayouts: bitLayouts.map((layout) => ({
      id: layout.id,
      declaredWidthSignalIndex: layout.declaredWidthSignalIndex,
      declaredWidth: layout.declaredWidth,
      fieldSignalIndexes: layout.fieldSignalIndexes,
      coveredWidth: layout.coveredWidth,
      status: layout.status,
      gaps: layout.gaps,
      overlaps: layout.overlaps,
      outOfRange: layout.outOfRange,
    })),
    compilerOwnedFields: [
      'SCHEMA',
      'CONTEXT_BINDING',
      'IDENTIFIERS',
      'SOURCE_BINDINGS',
      'DETERMINISM_ACTIVATIONS',
      'MECHANICAL_PROOF_OBLIGATIONS',
      'FINITE_REPRESENTATIONS',
      'AGGREGATE_STATUSES',
      'CONTRACT_ENVELOPE',
      'DIGESTS',
      'APPROVAL_STATE',
    ],
  };
  assertSchema('aegis.semantic_worksheet.v1', worksheet);
  return worksheet;
}
