import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { buildIntentEvidence } from './intent_evidence.mjs';
import { assertSchema, standaloneSchemaDocument } from './schema_validator.mjs';
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

function compactOutputSchema(value, propertyMap = false) {
  if (Array.isArray(value)) return value.map((item) => compactOutputSchema(item));
  if (value === null || typeof value !== 'object') return value;
  if (propertyMap) {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, compactOutputSchema(item)]));
  }
  const compact = Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![
      'description', 'title', 'if', 'then', 'else', 'allOf', 'uniqueItems', 'pattern',
    ].includes(key))
    .map(([key, item]) => [
      key === 'oneOf' ? 'anyOf' : key,
      compactOutputSchema(item, key === 'properties'),
    ]));
  if (!Object.hasOwn(compact, 'type') && Object.hasOwn(compact, 'const')) {
    compact.type = compact.const === null ? 'null' : typeof compact.const;
  }
  if (!Object.hasOwn(compact, 'type') && Array.isArray(compact.enum) && compact.enum.length > 0) {
    const types = new Set(compact.enum.map((item) => (item === null ? 'null' : typeof item)));
    if (types.size === 1) [compact.type] = types;
  }
  return compact;
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
  const entrypoints = textFiles.map(({ path }) => path)
    .filter((path) => /(?:^|\/)(?:index|main|mod)\.[^/]+$/iu.test(path));
  const selections = smallWorkspace
    ? textFiles.map(({ path }) => ({ path, line: null }))
    : [
      ...new Map(preflight.discovery.lexicalEvidence.matches
        .map(({ path, line }) => [`${path}:${line}`, { path, line }])).values(),
      ...entrypoints.filter((path) => !preflight.discovery.lexicalEvidence.matches
        .some((match) => match.path === path)).map((path) => ({ path, line: null })),
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
    const excerpt = !smallWorkspace && matchLine !== null
      ? lineWindow(bytes, matchLine, limit)
      : (() => {
        const content = decodeUtf8Prefix(bytes, limit);
        return { content, startLine: 1, endLine: content.split('\n').length };
      })();
    const consumedBytes = Buffer.byteLength(excerpt.content, 'utf8');
    remainingBytes -= consumedBytes;
    evidence.push({
      path,
      ...excerpt,
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
  const intentEvidence = buildIntentEvidence(preflight.intent);
  const observedTextPaths = preflight.discovery.files
    .filter(({ kind }) => kind === 'UTF8_TEXT').map(({ path }) => path);
  const unavailablePaths = [
    ...preflight.discovery.files.filter(({ kind }) => kind !== 'UTF8_TEXT')
      .map(({ path, kind }) => ({ path, reason: kind })),
    ...preflight.discovery.ignoredEntries,
  ];
  const context = {
    delivery: {
      constitution: 'SYSTEM_INSTRUCTION',
      architecture: 'TRUSTED_POLICY',
      intent: 'USER_DATA',
      intentEvidence: 'MECHANICAL_FACTS_NOT_SEMANTIC_VERDICTS',
      workspace: 'UNTRUSTED_EVIDENCE',
      revision: 'USER_DECISION',
      outputSchema: 'STRICT_STRUCTURED_OUTPUT',
    },
    constitution,
    intent: preflight.intent,
    intentEvidence,
    workspace: {
      status: preflight.discovery.status,
      observedTextPaths,
      unavailablePaths,
      lexicalEvidence: {
        status: preflight.discovery.lexicalEvidence.status,
        termsTruncated: preflight.discovery.lexicalEvidence.termsTruncated,
        matches: preflight.discovery.lexicalEvidence.matches
          .map(({ term, sourceToken, matchKind, path, line, sourceRegion }) => ({
            term, sourceToken, matchKind, path, line, sourceRegion,
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
      amendments: (policy.amendments ?? []).map(({ id, ruleId, reason }) => ({ id, ruleId, reason })),
    },
    revision,
  };
  const contextDigest = canonicalDigest(context);
  const outputSchemaDocument = compactOutputSchema(
    standaloneSchemaDocument('aegis.semantic_opinion.v3'),
  );
  outputSchemaDocument.properties.determinismReview
    .properties.dimensions.items.properties.activationId = { type: 'null' };
  outputSchemaDocument.properties.fragmentDispositions.minItems = intentEvidence.fragments.length;
  outputSchemaDocument.properties.fragmentDispositions.maxItems = intentEvidence.fragments.length;
  const fragmentDisposition = outputSchemaDocument.properties.fragmentDispositions.items;
  const dispositionVariant = (status, claimIndexes) => ({
    ...fragmentDisposition,
    properties: {
      ...fragmentDisposition.properties,
      status: { type: 'string', const: status },
      claimIndexes: {
        ...fragmentDisposition.properties.claimIndexes,
        ...claimIndexes,
      },
    },
  });
  outputSchemaDocument.properties.fragmentDispositions.items = {
    anyOf: [
      dispositionVariant('CLAIMS_EXTRACTED', { minItems: 1 }),
      dispositionVariant('CONTEXT_ONLY', { maxItems: 0 }),
      dispositionVariant('UNCLEAR', {}),
    ],
  };
  outputSchemaDocument.properties.sourceEvidenceDigest = {
    type: 'string',
    const: intentEvidence.evidenceDigest,
  };
  const requestWithoutDigest = {
    schema: 'aegis.semantic_request.v10',
    contextDigest,
    ...context,
    outputSchema: {
      id: 'aegis.semantic_opinion.v3',
      digest: canonicalDigest(outputSchemaDocument),
      strict: true,
      document: outputSchemaDocument,
    },
  };
  const request = { ...requestWithoutDigest, requestDigest: canonicalDigest(requestWithoutDigest) };
  assertSchema('aegis.semantic_request.v10', request);
  return request;
}
