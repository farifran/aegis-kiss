import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { detectIntentSignals } from './intent_signals.mjs';
import { assertSchema, schemaDocument } from './schema_validator.mjs';
import {
  mechanicalPolicySignals,
  policySignalSemantics,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
} from './semantic_authority.mjs';

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
      method: 'DETERMINISTIC_INTENT_REVIEW_V2',
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
          .map(({ term, path, line }) => ({ term, path, line })),
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

export function buildSemanticWorksheet({ contextDigest, intentSignals }) {
  const bitFields = intentSignals.flatMap((signal, signalIndex) => {
    if (signal.kind !== 'BOUNDED_VALUE') return [];
    const match = /\bbits?\s+(\d+)\s*[–—-]\s*(\d+)\b/iu.exec(signal.reference);
    if (match === null) return [];
    const startBit = Number.parseInt(match[1], 10);
    const endBit = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(startBit)
      || !Number.isSafeInteger(endBit)
      || endBit < startBit) return [];
    const width = endBit - startBit + 1;
    const exactCapacity = Number.isSafeInteger(width) && width <= 256;
    const patternCount = exactCapacity ? 1n << BigInt(width) : null;
    return [{
      signalIndex,
      startBit,
      endBit,
      width,
      patternCount: patternCount === null ? `2^${width}` : patternCount.toString(),
      unsignedMaximum: patternCount === null ? `2^${width}-1` : (patternCount - 1n).toString(),
    }];
  });
  const worksheet = {
    schema: 'aegis.semantic_worksheet.v1',
    contextDigest,
    // Semantic dimensions are reported only when material. Requiring the full
    // universal catalogue made every deterministic demand produce boilerplate.
    requiredDeterminismDimensions: [],
    counterexampleWitnesses: [],
    bitFields,
    compilerOwnedFields: [
      'SCHEMA',
      'CONTEXT_BINDING',
      'IDENTIFIERS',
      'SOURCE_BINDINGS',
      'COUNTEREXAMPLE_WITNESSES',
      'AGGREGATE_STATUSES',
      'CONTRACT_ENVELOPE',
      'DIGESTS',
      'APPROVAL_STATE',
    ],
  };
  assertSchema('aegis.semantic_worksheet.v1', worksheet);
  return worksheet;
}
