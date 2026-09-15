import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { detectIntentSignals } from './intent_signals.mjs';
import { assertSchema, schemaDocument } from './schema_validator.mjs';

const sourceEvidenceByteLimit = 32_768;
const sourceEvidenceFileByteLimit = 8_192;
const policySignalSemantics = {
  verdict: 'SEMANTIC_NOT_LEXICAL',
  assessment: 'REQUIRED_FOR_EACH_SIGNAL_RULE',
  residualReview: 'SEPARATE_FROM_POLICY_ASSESSMENT',
};
const determinismDimensionKinds = [
  'ORDERING',
  'CANONICALIZATION',
  'DUPLICATES',
  'EMPTY_INPUT',
  'ODD_CARDINALITY',
  'ROUNDING_REMAINDER',
  'ZERO_DIVISOR',
  'TIE_BREAKING',
  'COUNTING_IDENTITY',
  'BOUNDED_ARITHMETIC',
];
const explicitUncertaintyPattern = /\b(?:acima\s+de|abaixo\s+de|maior\s+que|menor\s+que|escolh\p{L}*|defin\p{L}*|ainda|alternativ\p{L}*|ou|either|choose|undefined|unspecified)\b/iu;

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

function verifiedTextSource(repositoryRoot, manifestEntry) {
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

function buildSourceEvidence(repositoryRoot, preflight) {
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
    const bytes = verifiedTextSource(repositoryRoot, manifestEntry);
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
      sourceEvidence: buildSourceEvidence(repositoryRoot, preflight),
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
  const outputSchemaDocument = schemaDocument('aegis.semantic_opinion.v1');
  outputSchemaDocument.properties.worksheetDigest = { const: worksheetDigest };
  const requestWithoutDigest = {
    schema: 'aegis.semantic_request.v8',
    contextDigest,
    ...context,
    worksheetDigest,
    worksheet,
    outputSchema: {
      id: 'aegis.semantic_opinion.v1',
      digest: canonicalDigest(outputSchemaDocument),
      strict: true,
      document: outputSchemaDocument,
    },
  };
  const request = {
    ...requestWithoutDigest,
    requestDigest: canonicalDigest(requestWithoutDigest),
  };
  assertSchema('aegis.semantic_request.v8', request);
  return request;
}

export function buildSemanticWorksheet({ contextDigest, intentSignals }) {
  const requiresDeterminismReview = intentSignals.some(({ kind }) => (
    kind === 'DETERMINISM_CLAIM' || kind === 'ARITHMETIC_SEMANTICS'
  ));
  const bitFields = intentSignals.flatMap((signal, signalIndex) => {
    if (signal.kind !== 'BOUNDED_VALUE') return [];
    const match = /\bbits?\s+(\d+)\s*[–—-]\s*(\d+)\b/iu.exec(signal.reference);
    if (match === null) return [];
    const startBit = Number.parseInt(match[1], 10);
    const endBit = Number.parseInt(match[2], 10);
    if (endBit < startBit) return [];
    return [{ signalIndex, startBit, endBit, width: endBit - startBit + 1 }];
  });
  const worksheet = {
    schema: 'aegis.semantic_worksheet.v1',
    contextDigest,
    requiredDeterminismDimensions: requiresDeterminismReview
      ? determinismDimensionKinds
      : [],
    bitFields,
    compilerOwnedFields: [
      'SCHEMA',
      'CONTEXT_BINDING',
      'IDENTIFIERS',
      'SOURCE_BINDINGS',
      'AGGREGATE_STATUSES',
      'CONTRACT_ENVELOPE',
      'DIGESTS',
      'APPROVAL_STATE',
    ],
  };
  assertSchema('aegis.semantic_worksheet.v1', worksheet);
  return worksheet;
}

function assertUniqueIds(items, field, kind) {
  const ids = items.map((item) => item[field]);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate_${kind}_id`);
  return new Set(ids);
}

function normalizedObservableText(text) {
  return text.normalize('NFC')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/gu, ' ')
    .replace(/[.,;:!?]+$/gu, '')
    .trim();
}

function hasDisjunctiveOutcome(text) {
  const withoutAtomicComparators = normalizedObservableText(text)
    .replace(/\b(?:maior|menor)\s+ou\s+igual(?:\s+a)?\b/giu, '')
    .replace(/\b(?:greater|less)\s+than\s+or\s+equal(?:\s+to)?\b/giu, '')
    .replace(/\b(?:um|uma|one)\s+(?:ou|or)\s+(?:mais|more)\b/giu, '');
  return /\b(?:ou|or|either)\b|\s\/\s/iu.test(withoutAtomicComparators);
}

function acceptanceBranchKey(acceptanceCase) {
  return JSON.stringify({
    given: normalizedObservableText(acceptanceCase.given),
    when: normalizedObservableText(acceptanceCase.when),
    decisionBinding: acceptanceCase.decisionBinding,
  });
}

function assertObservableOutcomesAreUnique(acceptanceCases) {
  const outcomesByBranch = new Map();
  for (const acceptanceCase of acceptanceCases) {
    if (hasDisjunctiveOutcome(acceptanceCase.then)) {
      throw new Error(`ambiguous_observable_outcome:${acceptanceCase.id}`);
    }
    const branch = acceptanceBranchKey(acceptanceCase);
    const outcome = `${acceptanceCase.outcomeKind}\n${normalizedObservableText(acceptanceCase.then)}`;
    const previous = outcomesByBranch.get(branch);
    if (previous !== undefined && previous.outcome !== outcome) {
      throw new Error(`conflicting_observable_outcomes:${previous.id}:${acceptanceCase.id}`);
    }
    outcomesByBranch.set(branch, { id: acceptanceCase.id, outcome });
  }
}

function assertRequirementReferences(items, requirementIds, kind) {
  for (const item of items) {
    for (const requirementId of item.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new Error(`${kind}_references_unknown_requirement:${requirementId}`);
      }
    }
  }
}

function basisClaims(draft) {
  return [
    ...draft.pathReferences,
    ...draft.architectureContexts,
    ...draft.complexityReview.alternatives,
    ...draft.nonNormativeItems,
    ...draft.requirements,
    ...draft.risks,
    ...draft.boundaryRules,
    ...draft.unknowns,
    ...draft.adversarialReview.findings,
    ...draft.determinismReview.dimensions,
  ];
}

function literalReferenceAppears(text, reference) {
  const normalizedText = text.normalize('NFC').toLocaleLowerCase('pt-BR');
  const normalizedReference = reference.normalize('NFC').toLocaleLowerCase('pt-BR');
  if (/^[\p{L}\p{N}_-]+$/u.test(normalizedReference)) {
    return normalizedText.split(/[^\p{L}\p{N}_-]+/u).includes(normalizedReference);
  }
  return normalizedText.includes(normalizedReference);
}

function matchingReferences(intent, references) {
  return references.filter((reference) => literalReferenceAppears(intent, reference));
}

function mechanicalPolicySignals(policy, intent) {
  return policy.rules.flatMap((rule) => [
    ...matchingReferences(intent, rule.reviewReferences)
      .map((reference) => ({
        ruleId: rule.id,
        kind: 'REVIEW',
        reference,
      })),
    ...matchingReferences(intent, rule.forbiddenReferences)
      .map((reference) => ({
        ruleId: rule.id,
        kind: 'POSSIBLE_CONFLICT',
        reference,
      })),
  ]);
}

function ruleApplication(rule, architectureTags, intent) {
  const contextApplies = rule.appliesMode === 'all'
    ? rule.appliesWhen.every((tag) => architectureTags.has(tag))
    : rule.appliesWhen.some((tag) => architectureTags.has(tag));
  const reviewReferences = matchingReferences(intent, rule.reviewReferences);
  const forbiddenReferences = matchingReferences(intent, rule.forbiddenReferences);
  return {
    applies: contextApplies || reviewReferences.length > 0 || forbiddenReferences.length > 0,
  };
}

function workspaceBasisRange(reference) {
  const match = /^(src\/[^:]+):L([1-9]\d*)(?:-L([1-9]\d*))?$/u.exec(reference);
  if (match === null) return null;
  const startLine = Number.parseInt(match[2], 10);
  const endLine = Number.parseInt(match[3] ?? match[2], 10);
  if (endLine < startLine) return null;
  return { path: match[1], startLine, endLine };
}

function scopeContainsInternalPath(item) {
  return /(?:^|\s)(?:\.\/)?(?:src|lib|app|tests?)\/\S+/u.test(item);
}

function intentProductPaths(intent) {
  const pattern = /(?<![\p{L}\p{N}_.-])(?:\.\/)?src\/[\p{L}\p{N}_.@/+~-]*/gu;
  return [...new Set([...intent.matchAll(pattern)]
    .map(([path]) => path.replace(/^\.\//u, '').replace(/[.,;:]+$/u, '')))];
}

function technicalIdentifiers(text) {
  const pattern = /(?<![\p{L}\p{N}_$])(?:[\p{Lu}][\p{Ll}\p{N}_$-]+[\p{Lu}][\p{L}\p{N}_$-]*|[\p{Ll}_$][\p{L}\p{N}_$-]*[\p{Lu}][\p{L}\p{N}_$-]*|[\p{Lu}]{2,}(?:-[\p{L}\p{N}]+)?)(?![\p{L}\p{N}_$])/gu;
  return [...new Set([...text.matchAll(pattern)].map(([identifier]) => identifier))];
}

function targetIsQuantified(target) {
  return /\d/u.test(target)
    || /\b(?:zero|none|nenhum|nenhuma|sem\s+aloca(?:ç|c)(?:ão|ões)|no[- ]?allocation)\b/iu.test(target);
}

function numericTokens(text) {
  return [...new Set(text.match(/\d+(?:[.,]\d+)?/gu) ?? [])];
}

function semanticTokens(text) {
  const ignored = new Set([
    'a', 'as', 'at', 'de', 'do', 'dos', 'e', 'em', 'least', 'max', 'maximum', 'min',
    'minimum', 'no', 'none', 'o', 'os', 'per', 'por', 'sem', 'the', 'zero',
  ]);
  return [...new Set(text.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .match(/[\p{L}\p{N}_-]+/gu) ?? [])]
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function targetValueAppearsInEvidence(target, evidenceText) {
  if (literalReferenceAppears(evidenceText, target.value)) return true;
  const numbers = numericTokens(target.value);
  if (!numbers.every((number) => evidenceText.includes(number))) return false;
  const evidenceTokens = new Set(semanticTokens(evidenceText));
  return semanticTokens(target.value).every((token) => evidenceTokens.has(token));
}

function internalMechanismPhrases(text) {
  const patterns = [
    /\b(?:buffers?|arrays?|vetores?|objetos?)\s+(?:est[aá]tic[oa]s?|din[aâ]mic[oa]s?|tipad[oa]s?|pr[eé]-?alocad[oa]s?)\b/giu,
    /\bestruturas?\s+(?:planas?\s+)?pr[eé]-?alocad[oa]s?\b/giu,
    /\baloca(?:ç|c)(?:ão|ões)\s+(?:intermedi[aá]rias?\s+)?(?:de\s+)?heap\b/giu,
    /\binstancia(?:ç|c)(?:ão|ões)\s+tempor[aá]rias?\b/giu,
    /\bhierarquias?\s+(?:polim[oó]rficas?\s+)?de\s+classes?\b/giu,
    /\binje(?:ç|c)[aã]o\s+(?:din[aâ]mica\s+)?de\s+depend[eê]ncias?\b/giu,
  ];
  return [...new Set(patterns.flatMap((pattern) => [...text.matchAll(pattern)]
    .map(([phrase]) => phrase)))];
}

function assertNoUnprovenInternalMechanism(kind, id, text, trustedText) {
  for (const phrase of internalMechanismPhrases(text)) {
    if (!literalReferenceAppears(trustedText, phrase)) {
      throw new Error(`unproven_internal_mechanism:${kind}:${id}:${phrase}`);
    }
  }
}

const boundaryBehaviorPatterns = {
  REJECT: /\b(?:rejeit\p{L}*|recus\p{L}*|inv[aá]lid\p{L}*)\b/iu,
  SATURATE: /\bsatur\p{L}*\b/iu,
  EXPLICIT_SENTINEL: /\b(?:sentinela|sentinel|valor\s+especial)\b/iu,
  WRAP: /\b(?:wrap\p{L}*|trunc\p{L}*|circular|m[oó]dulo)\b/iu,
};

function textStatesBoundaryBehavior(text, behavior) {
  return behavior === 'NOT_APPLICABLE' || boundaryBehaviorPatterns[behavior].test(text);
}

function boundaryBehaviorIsExplicit(boundaryRule, behavior, humanResolutionEvidence) {
  if (behavior === 'NOT_APPLICABLE') return true;
  if (boundaryRule.basis.some(({ source, reference }) => source === 'USER_DECISION'
    && textStatesBoundaryBehavior(humanResolutionEvidence.get(reference) ?? '', behavior))) {
    return true;
  }
  return boundaryRule.basis.some(({ source, reference }) => source === 'USER_INTENT'
    && textStatesBoundaryBehavior(reference, behavior));
}

function basisCitesIntentSignal(claim, signal) {
  return claim.basis.some(({ source, reference }) => source === 'USER_INTENT'
    && (reference.includes(signal.reference) || signal.reference.includes(reference)));
}

function assertNoUnprovenTechnicalPrescription(kind, id, text, trustedText) {
  for (const identifier of technicalIdentifiers(text)) {
    if (!literalReferenceAppears(trustedText, identifier)) {
      throw new Error(`unproven_technical_prescription:${kind}:${id}:${identifier}`);
    }
  }
}

export function assertSemanticDraft(draft, policy, {
  constitutionRules = [],
  intent = '',
  resolvedDecisionIds = [],
  humanResolutions = [],
  workspaceEvidence = [],
} = {}) {
  assertSchema('aegis.semantic_draft.v7', draft);
  assertUniqueIds(draft.intentClaims, 'id', 'intent_claim');
  const nonNormativeItemIds = assertUniqueIds(draft.nonNormativeItems, 'id', 'non_normative_item');
  const pathReferenceIds = assertUniqueIds(draft.pathReferences, 'id', 'path_reference');
  const pathReferencesById = new Map(draft.pathReferences.map((item) => [item.id, item]));
  const requirementIds = assertUniqueIds(draft.requirements, 'id', 'requirement');
  const requirementsById = new Map(draft.requirements.map((item) => [item.id, item]));
  const acceptanceCases = draft.requirements.flatMap(({ acceptanceCases: cases }) => cases);
  assertUniqueIds(acceptanceCases, 'id', 'acceptance_case');
  const acceptanceCasesById = new Map(acceptanceCases.map((item) => [item.id, item]));
  const acceptanceRequirementById = new Map(draft.requirements.flatMap((requirement) => (
    requirement.acceptanceCases.map((item) => [item.id, requirement.id])
  )));
  assertObservableOutcomesAreUnique(acceptanceCases);
  const invariantIds = assertUniqueIds(draft.invariants, 'id', 'invariant');
  const riskIds = assertUniqueIds(draft.risks, 'id', 'risk');
  const boundaryRuleIds = assertUniqueIds(draft.boundaryRules, 'id', 'boundary_rule');
  assertUniqueIds(draft.unknowns, 'id', 'unknown');
  const decisionIds = assertUniqueIds(draft.decisions, 'questionId', 'decision');
  const decisionsById = new Map(draft.decisions.map((decision) => [decision.questionId, decision]));
  const knownResolvedDecisions = new Set([
    ...resolvedDecisionIds,
    ...humanResolutions.map(({ questionId }) => questionId),
  ]);
  const humanResolutionEvidence = new Map(humanResolutions.map((resolution) => [
    resolution.questionId,
    resolution.kind === 'ANSWER'
      ? `${resolution.label}\n${resolution.contractEffect ?? ''}`
      : resolution.correction,
  ]));
  assertUniqueIds(draft.adversarialReview.findings, 'id', 'adversarial_finding');
  const architectureTags = assertUniqueIds(draft.architectureContexts, 'tag', 'architecture_context');
  const knownArchitectureTags = new Set(policy.contexts.map(({ tag }) => tag));
  if (knownArchitectureTags.size !== policy.contexts.length) {
    throw new Error('duplicate_policy_context');
  }
  for (const tag of architectureTags) {
    if (!knownArchitectureTags.has(tag)) throw new Error(`unknown_architecture_context:${tag}`);
  }
  for (const rule of policy.rules) {
    for (const tag of rule.appliesWhen) {
      if (!knownArchitectureTags.has(tag)) {
        throw new Error(`policy_rule_references_unknown_context:${rule.id}:${tag}`);
      }
    }
  }
  const knownClaimTargets = new Set([
    ...nonNormativeItemIds,
    ...pathReferenceIds,
    ...requirementIds,
    ...decisionIds,
    ...knownResolvedDecisions,
    ...boundaryRuleIds,
    ...policy.rules.map(({ id }) => id),
  ]);
  const targetsByDisposition = {
    NORMATIVE: /^(?:REQ|BOUND)-/u,
    DECISION: /^Q-/u,
    POLICY_CORRECTION: /^ARCH-/u,
    NON_NORMATIVE: /^(?:NOTE|PATH)-/u,
  };
  const dispositionsByKind = {
    OBLIGATION: new Set(['NORMATIVE', 'POLICY_CORRECTION']),
    PROHIBITION: new Set(['NORMATIVE', 'POLICY_CORRECTION']),
    GOAL: new Set(['NON_NORMATIVE']),
    OPTION: new Set(['NON_NORMATIVE', 'POLICY_CORRECTION']),
    EXAMPLE: new Set(['NON_NORMATIVE', 'POLICY_CORRECTION']),
    AMBIGUITY: new Set(['DECISION']),
  };
  const normalizedClaimQuotes = new Set();
  const intentClaimsByTarget = new Map();
  for (const claim of draft.intentClaims) {
    if (!intent.includes(claim.quote)) throw new Error(`intent_claim_not_literal:${claim.id}`);
    const normalizedQuote = claim.quote.normalize('NFC');
    if (normalizedClaimQuotes.has(normalizedQuote)) {
      throw new Error(`duplicate_intent_claim_quote:${claim.id}`);
    }
    normalizedClaimQuotes.add(normalizedQuote);
    if (!dispositionsByKind[claim.kind].has(claim.disposition)) {
      throw new Error(`invalid_intent_claim_disposition:${claim.id}`);
    }
    for (const targetId of claim.targetIds) {
      if (!knownClaimTargets.has(targetId)) {
        throw new Error(`intent_claim_references_unknown_target:${claim.id}:${targetId}`);
      }
      if (!targetsByDisposition[claim.disposition].test(targetId)) {
        throw new Error(`intent_claim_targets_wrong_layer:${claim.id}:${targetId}`);
      }
      if (targetId.startsWith('PATH-')
        && pathReferencesById.get(targetId)?.role !== 'IMPLEMENTATION_SUGGESTION') {
        throw new Error(`intent_claim_targets_normative_path_as_note:${claim.id}:${targetId}`);
      }
      const claims = intentClaimsByTarget.get(targetId) ?? [];
      claims.push(claim);
      intentClaimsByTarget.set(targetId, claims);
    }
    if (claim.disposition === 'NORMATIVE') {
      if (typeof claim.contractEffect !== 'string'
        || !claim.contractEffect.normalize('NFC').includes(claim.quote.normalize('NFC'))) {
        throw new Error(`normative_claim_without_literal_effect:${claim.id}`);
      }
      const materialized = claim.targetIds.some((targetId) => {
        const requirement = requirementsById.get(targetId);
        if (requirement !== undefined) {
          return literalReferenceAppears([
            requirement.statement,
            ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
          ].join('\n'), claim.contractEffect);
        }
        const boundaryRule = draft.boundaryRules.find(({ id }) => id === targetId);
        if (boundaryRule === undefined) return false;
        return literalReferenceAppears([
          boundaryRule.subject,
          ...boundaryRule.acceptanceCaseIds
            .map((caseId) => acceptanceCasesById.get(caseId)?.then ?? ''),
        ].join('\n'), claim.contractEffect);
      });
      if (!materialized) throw new Error(`normative_claim_not_materialized:${claim.id}`);
    } else if (claim.contractEffect !== null) {
      throw new Error(`non_normative_claim_has_contract_effect:${claim.id}`);
    }
  }
  for (const requirement of draft.requirements) {
    const userReferences = requirement.basis
      .filter(({ source }) => source === 'USER_INTENT')
      .map(({ reference }) => reference);
    if (userReferences.length > 0) {
      const matchingClaim = (intentClaimsByTarget.get(requirement.id) ?? [])
        .find(({ disposition, quote }) => disposition === 'NORMATIVE'
          && userReferences.some((reference) => (
            quote.includes(reference) || reference.includes(quote)
          )));
      if (matchingClaim === undefined) {
        throw new Error(`user_requirement_without_intent_claim:${requirement.id}`);
      }
    }
  }
  for (const item of draft.nonNormativeItems) {
    const claims = intentClaimsByTarget.get(item.id) ?? [];
    if (claims.length === 0
      || claims.some(({ disposition }) => disposition !== 'NON_NORMATIVE')) {
      throw new Error(`non_normative_item_without_intent_claim:${item.id}`);
    }
    if (!item.basis.some(({ source, reference }) => (
      source === 'USER_INTENT'
      && claims.some(({ quote }) => quote.includes(reference) || reference.includes(quote))
    ))) {
      throw new Error(`non_normative_item_without_matching_basis:${item.id}`);
    }
  }
  for (const decisionId of decisionIds) {
    const unknownReferences = draft.unknowns
      .filter(({ decisionId: linkedDecisionId }) => linkedDecisionId === decisionId)
      .flatMap(({ basis }) => basis
        .filter(({ source }) => source === 'USER_INTENT')
        .map(({ reference }) => reference));
    if (!(intentClaimsByTarget.get(decisionId) ?? [])
      .some(({ disposition, quote }) => disposition === 'DECISION'
        && unknownReferences.some((reference) => (
          quote.includes(reference) || reference.includes(quote)
        )))) {
      throw new Error(`decision_without_ambiguity_claim:${decisionId}`);
    }
  }
  const ruleApplications = new Map(policy.rules.map((rule) => [
    rule.id,
    ruleApplication(rule, architectureTags, intent),
  ]));
  const intentSignals = detectIntentSignals(intent);
  const intentSignalsById = new Map(intentSignals.map((signal) => [signal.id, signal]));
  const vagueQualitySignals = intentSignals.filter(({ kind }) => kind === 'QUALITY_GOAL');
  for (const requirement of draft.requirements) {
    const normativeClaims = (intentClaimsByTarget.get(requirement.id) ?? [])
      .filter(({ disposition }) => disposition === 'NORMATIVE');
    if (normativeClaims.some(({ quote }) => vagueQualitySignals.some(({ reference }) => (
      quote.includes(reference) || reference.includes(quote)
    )))) {
      throw new Error(`quality_goal_promoted_to_requirement:${requirement.id}`);
    }
  }

  const pathReferencesByPath = new Map();
  for (const pathReference of draft.pathReferences) {
    if (pathReferencesByPath.has(pathReference.path)) {
      throw new Error(`duplicate_path_reference:${pathReference.path}`);
    }
    pathReferencesByPath.set(pathReference.path, pathReference);
    assertRequirementReferences([pathReference], requirementIds, 'path_reference');
    const userSourced = pathReference.basis.some(({ source, reference }) => (
      (source === 'USER_INTENT' && reference.includes(pathReference.path))
      || (source === 'USER_DECISION'
        && knownResolvedDecisions.has(reference)
        && literalReferenceAppears(
          humanResolutionEvidence.get(reference) ?? '',
          pathReference.path,
        ))
    ));
    const workspaceSourced = pathReference.basis.some(({ source, reference }) => (
      source === 'WORKSPACE_EVIDENCE' && reference.startsWith(`${pathReference.path}:L`)
    ));
    if (pathReference.role === 'EVIDENCE_ONLY') {
      if (!workspaceSourced || pathReference.requirementIds.length !== 0) {
        throw new Error(`invalid_evidence_only_path:${pathReference.path}`);
      }
    } else if (!userSourced) {
      throw new Error(`normative_path_without_human_basis:${pathReference.path}`);
    }
    const normativeRole = pathReference.role === 'PUBLIC_SURFACE'
      || pathReference.role === 'IMPLEMENTATION_CONSTRAINT';
    if (normativeRole && pathReference.requirementIds.length === 0) {
      throw new Error(`normative_path_without_requirement:${pathReference.path}`);
    }
    if (normativeRole && !pathReference.requirementIds.some((requirementId) => {
      const requirement = requirementsById.get(requirementId);
      const requirementText = [
        requirement?.statement ?? '',
        ...(requirement?.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]) ?? []),
      ].join('\n');
      return literalReferenceAppears(requirementText, pathReference.path);
    })) {
      throw new Error(`normative_path_not_materialized:${pathReference.path}`);
    }
    if (!normativeRole && pathReference.requirementIds.length !== 0) {
      throw new Error(`non_normative_path_with_requirement:${pathReference.path}`);
    }
  }
  for (const path of intentProductPaths(intent)) {
    if (!pathReferencesByPath.has(path)) throw new Error(`unclassified_intent_path:${path}`);
  }

  for (const item of [...draft.scope.inScope, ...draft.scope.outOfScope]) {
    if (scopeContainsInternalPath(item)) throw new Error(`scope_contains_internal_path:${item}`);
    for (const identifier of technicalIdentifiers(item)) {
      if (!literalReferenceAppears(intent, identifier)) {
        throw new Error(`scope_contains_unproven_technical_prescription:${identifier}`);
      }
    }
  }

  const nonNormativePaths = draft.pathReferences
    .filter(({ role }) => role === 'IMPLEMENTATION_SUGGESTION' || role === 'EVIDENCE_ONLY')
    .map(({ path }) => path);
  const normativeSpecificationText = [
    ...draft.requirements.flatMap((requirement) => [
      requirement.statement,
      ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
    ]),
    ...draft.invariants.flatMap(({ statement, falsification }) => [statement, falsification]),
  ].join('\n');
  for (const path of nonNormativePaths) {
    if (literalReferenceAppears(normativeSpecificationText, path)) {
      throw new Error(`non_normative_path_became_requirement:${path}`);
    }
  }

  for (const requirement of draft.requirements) {
    const kinds = new Set(requirement.acceptanceCases.map(({ kind }) => kind));
    if (!kinds.has('HAPPY_PATH') || (!kinds.has('FAILURE') && !kinds.has('BOUNDARY'))) {
      throw new Error(`requirement_without_dual_acceptance:${requirement.id}`);
    }
    if (requirement.kind === 'QUALITY' && !targetIsQuantified(requirement.measurement.target.value)) {
      throw new Error(`quality_requirement_without_quantified_target:${requirement.id}`);
    }
    if (requirement.kind === 'QUALITY') {
      const target = requirement.measurement.target;
      const acceptanceText = requirement.acceptanceCases
        .flatMap(({ given, when, then }) => [given, when, then])
        .join('\n');
      if (!acceptanceText.includes(target.value)
        && !acceptanceText.includes(requirement.measurement.metric)) {
        throw new Error(`quality_measurement_not_falsifiable:${requirement.id}`);
      }
      if (target.source === 'USER_INTENT' && !intent.includes(target.reference)) {
        throw new Error(`quality_target_not_present_in_intent:${requirement.id}`);
      }
      if (target.source === 'USER_INTENT'
        && !targetValueAppearsInEvidence(target, target.reference)) {
        throw new Error(`quality_target_not_supported_by_intent:${requirement.id}`);
      }
      if (target.source === 'USER_DECISION' && !knownResolvedDecisions.has(target.reference)) {
        throw new Error(`quality_target_references_unknown_decision:${requirement.id}`);
      }
      if (target.source === 'USER_DECISION') {
        const evidence = humanResolutionEvidence.get(target.reference);
        if (evidence === undefined || !targetValueAppearsInEvidence(target, evidence)) {
          throw new Error(`quality_target_not_supported_by_decision:${requirement.id}`);
        }
      }
      if (target.source === 'WORKSPACE_EVIDENCE') {
        const range = workspaceBasisRange(target.reference);
        const evidence = range === null ? undefined : workspaceEvidence.find((item) => (
          item.path === range.path
          && item.startLine <= range.startLine
          && item.endLine >= range.endLine
        ));
        if (evidence === undefined || !targetValueAppearsInEvidence(target, evidence.content)) {
          throw new Error(`quality_target_references_unavailable_evidence:${requirement.id}`);
        }
      }
      if (target.evidenceStatus === 'EVIDENCE_BACKED'
        && target.source !== 'WORKSPACE_EVIDENCE') {
        throw new Error(`quality_target_claims_unavailable_evidence:${requirement.id}`);
      }
    }
  }

  assertRequirementReferences(draft.invariants, requirementIds, 'invariant');
  assertRequirementReferences(draft.risks, requirementIds, 'risk');

  for (const unknown of draft.unknowns) {
    if (unknown.material && unknown.decisionId === null) {
      throw new Error(`material_unknown_without_decision:${unknown.id}`);
    }
    if (!unknown.material && unknown.decisionId !== null) {
      throw new Error(`non_material_unknown_with_decision:${unknown.id}`);
    }
    if (unknown.decisionId !== null && !decisionIds.has(unknown.decisionId)) {
      throw new Error(`unknown_references_missing_decision:${unknown.id}`);
    }
  }
  const materialDecisionIds = new Set(draft.unknowns
    .filter(({ material }) => material)
    .map(({ decisionId }) => decisionId));

  const requirementSignalOwners = new Map();
  for (const requirement of draft.requirements) {
    for (const signalId of requirement.intentSignalIds) {
      const signal = intentSignalsById.get(signalId);
      if (signal === undefined) throw new Error(`requirement_references_unknown_intent_signal:${signalId}`);
      const resolvedByHuman = requirement.basis.some(({ source, reference }) => (
        source === 'USER_DECISION' && knownResolvedDecisions.has(reference)
      ));
      if ((signal.kind === 'QUALITY_CONSTRAINT' && requirement.kind !== 'QUALITY')
        || signal.kind === 'QUALITY_GOAL'
        || signal.kind === 'EXAMPLE'
        || signal.kind === 'BOUNDED_VALUE'
        || signal.kind === 'DETERMINISM_CLAIM'
        || signal.kind === 'ARITHMETIC_SEMANTICS'
        || (signal.kind === 'INCOMPLETE_EXPRESSION'
          && signal.handling === 'MATERIAL_DECISION'
          && !resolvedByHuman)) {
        throw new Error(`invalid_requirement_intent_signal:${requirement.id}:${signalId}`);
      }
      if (!resolvedByHuman && !basisCitesIntentSignal(requirement, signal)) {
        throw new Error(`requirement_omits_intent_signal_basis:${requirement.id}:${signalId}`);
      }
      const owners = requirementSignalOwners.get(signalId) ?? [];
      owners.push(requirement);
      requirementSignalOwners.set(signalId, owners);
    }
  }
  const unknownSignalOwners = new Map();
  for (const unknown of draft.unknowns) {
    for (const signalId of unknown.intentSignalIds) {
      if (!intentSignalsById.has(signalId)) {
        throw new Error(`unknown_references_unknown_intent_signal:${signalId}`);
      }
      if (!unknown.material || unknown.decisionId === null) {
        throw new Error(`intent_signal_without_material_decision:${signalId}`);
      }
      if (!basisCitesIntentSignal(unknown, intentSignalsById.get(signalId))) {
        throw new Error(`unknown_omits_intent_signal_basis:${unknown.id}:${signalId}`);
      }
      const owners = unknownSignalOwners.get(signalId) ?? [];
      owners.push(unknown);
      unknownSignalOwners.set(signalId, owners);
    }
  }

  const nonNormativeSignalOwners = new Map();
  for (const item of draft.nonNormativeItems) {
    for (const signalId of item.intentSignalIds) {
      const signal = intentSignalsById.get(signalId);
      const validSignal = (item.kind === 'GOAL' && signal?.kind === 'QUALITY_GOAL')
        || (item.kind === 'EXAMPLE' && signal?.kind === 'EXAMPLE');
      if (!validSignal) {
        throw new Error(`non_normative_item_references_invalid_signal:${item.id}:${signalId}`);
      }
      if (!basisCitesIntentSignal(item, signal)) {
        throw new Error(`non_normative_item_omits_intent_signal_basis:${item.id}:${signalId}`);
      }
      const owners = nonNormativeSignalOwners.get(signalId) ?? [];
      owners.push(item);
      nonNormativeSignalOwners.set(signalId, owners);
    }
  }

  const boundarySignalOwners = new Map();
  const boundaryCaseOwners = new Map();
  for (const boundaryRule of draft.boundaryRules) {
    assertRequirementReferences([boundaryRule], requirementIds, 'boundary_rule');
    const linkedCases = boundaryRule.acceptanceCaseIds.map((caseId) => {
      const acceptanceCase = acceptanceCasesById.get(caseId);
      if (acceptanceCase === undefined) {
        throw new Error(`boundary_rule_references_unknown_case:${boundaryRule.id}:${caseId}`);
      }
      if (acceptanceCase.kind !== 'BOUNDARY'
        || !boundaryRule.requirementIds.includes(acceptanceRequirementById.get(caseId))) {
        throw new Error(`boundary_rule_references_non_boundary_case:${boundaryRule.id}:${caseId}`);
      }
      const binding = acceptanceCase.boundaryBinding;
      if (binding === null || binding.ruleId !== boundaryRule.id) {
        throw new Error(`boundary_rule_without_exact_case_binding:${boundaryRule.id}:${caseId}`);
      }
      if (boundaryCaseOwners.has(caseId)) {
        throw new Error(`boundary_case_reused:${caseId}`);
      }
      boundaryCaseOwners.set(caseId, boundaryRule.id);
      const expectedBehavior = binding.side === 'EXACT_WIDTH'
        ? 'NOT_APPLICABLE'
        : binding.side === 'UNDERFLOW'
          ? boundaryRule.underflowBehavior
          : boundaryRule.overflowBehavior;
      if (binding.expectedBehavior !== expectedBehavior) {
        throw new Error(`boundary_case_behavior_mismatch:${boundaryRule.id}:${caseId}`);
      }
      const valueRequired = binding.side === 'EXACT_WIDTH'
        || binding.expectedBehavior !== 'REJECT';
      if ((binding.expectedValue !== null) !== valueRequired) {
        throw new Error(`boundary_case_value_mismatch:${boundaryRule.id}:${caseId}`);
      }
      if (!textStatesBoundaryBehavior(acceptanceCase.then, binding.expectedBehavior)
        || (binding.expectedValue !== null
          && !literalReferenceAppears(acceptanceCase.then, binding.expectedValue))) {
        throw new Error(`boundary_case_not_falsifiable:${boundaryRule.id}:${caseId}`);
      }
      return acceptanceCase;
    });
    if (boundaryRule.underflowBehavior === 'NOT_APPLICABLE'
      && boundaryRule.overflowBehavior === 'NOT_APPLICABLE'
      && !linkedCases.some(({ boundaryBinding }) => boundaryBinding.side === 'EXACT_WIDTH')) {
      throw new Error(`fixed_width_rule_without_exact_width_case:${boundaryRule.id}`);
    }
    for (const [side, behavior] of [
      ['UNDERFLOW', boundaryRule.underflowBehavior],
      ['OVERFLOW', boundaryRule.overflowBehavior],
    ]) {
      if (behavior !== 'NOT_APPLICABLE'
        && !linkedCases.some(({ boundaryBinding }) => boundaryBinding.side === side)) {
        throw new Error(`boundary_side_without_case:${boundaryRule.id}:${side}`);
      }
    }
    for (const signalId of boundaryRule.intentSignalIds) {
      const signal = intentSignalsById.get(signalId);
      if (signal?.kind !== 'BOUNDED_VALUE') {
        throw new Error(`boundary_rule_references_invalid_signal:${boundaryRule.id}:${signalId}`);
      }
      if (!basisCitesIntentSignal(boundaryRule, signal)) {
        throw new Error(`boundary_rule_omits_intent_signal_basis:${boundaryRule.id}:${signalId}`);
      }
      const owners = boundarySignalOwners.get(signalId) ?? [];
      owners.push(boundaryRule);
      boundarySignalOwners.set(signalId, owners);
    }
    const unresolvedSides = [
      ['UNDERFLOW', boundaryRule.underflowBehavior],
      ['OVERFLOW', boundaryRule.overflowBehavior],
    ].filter(([, behavior]) => !boundaryBehaviorIsExplicit(
      boundaryRule,
      behavior,
      humanResolutionEvidence,
    ));
    if (unresolvedSides.length > 0
      && (boundaryRule.decisionId === null
        || !decisionIds.has(boundaryRule.decisionId)
        || unresolvedSides.some(([side]) => !linkedCases.some(({ boundaryBinding, decisionBinding }) => (
          boundaryBinding.side === side
          && decisionBinding?.questionId === boundaryRule.decisionId
        ))))) {
      throw new Error(`boundary_policy_not_deliberated:${boundaryRule.id}`);
    }
    if (boundaryRule.decisionId !== null) {
      const decision = decisionsById.get(boundaryRule.decisionId);
      if (decision === undefined
        || !boundaryRule.requirementIds.some((requirementId) => (
          decision.requirementIds.includes(requirementId)
        ))) {
        throw new Error(`boundary_rule_references_invalid_decision:${boundaryRule.id}`);
      }
    }
    if ((boundaryRule.underflowBehavior === 'WRAP' || boundaryRule.overflowBehavior === 'WRAP')
      && !boundaryBehaviorIsExplicit(boundaryRule, 'WRAP', humanResolutionEvidence)) {
      throw new Error(`silent_wrap_forbidden:${boundaryRule.id}`);
    }
  }
  for (const acceptanceCase of acceptanceCases) {
    if (acceptanceCase.kind !== 'BOUNDARY' && acceptanceCase.boundaryBinding !== null) {
      throw new Error(`non_boundary_case_has_boundary_binding:${acceptanceCase.id}`);
    }
    if (acceptanceCase.boundaryBinding !== null
      && !boundaryRuleIds.has(acceptanceCase.boundaryBinding.ruleId)) {
      throw new Error(`acceptance_case_references_unknown_boundary:${acceptanceCase.id}`);
    }
  }
  for (const signal of intentSignals) {
    const requirements = requirementSignalOwners.get(signal.id) ?? [];
    const unknowns = unknownSignalOwners.get(signal.id) ?? [];
    if (signal.kind === 'INCOMPLETE_EXPRESSION') {
      const resolved = requirements.length === 1 && unknowns.length === 0;
      const unresolved = requirements.length === 0
        && unknowns.length === 1
        && (signal.handling === 'MATERIAL_DECISION'
          || (intentClaimsByTarget.get(unknowns[0].decisionId) ?? [])
            .some(({ quote }) => explicitUncertaintyPattern.test(quote)));
      if (!resolved && !unresolved) {
        throw new Error(`incomplete_expression_not_deliberated:${signal.id}`);
      }
      continue;
    }
    if (signal.kind === 'BOUNDED_VALUE') {
      const boundaryRules = boundarySignalOwners.get(signal.id) ?? [];
      if (boundaryRules.length !== 1) {
        throw new Error(`bounded_value_without_boundary_rule:${signal.id}`);
      }
      continue;
    }
    if (signal.kind === 'QUALITY_GOAL') {
      const goals = nonNormativeSignalOwners.get(signal.id) ?? [];
      if (goals.length !== 1 || requirements.length !== 0 || unknowns.length !== 0) {
        throw new Error(`quality_goal_not_preserved_as_non_normative:${signal.id}`);
      }
      if (!(intentClaimsByTarget.get(goals[0].id) ?? []).some(({ quote }) => (
        quote.includes(signal.reference) || signal.reference.includes(quote)
      ))) {
        throw new Error(`quality_goal_signal_without_intent_claim:${signal.id}`);
      }
      continue;
    }
    if (signal.kind === 'EXAMPLE') {
      const examples = nonNormativeSignalOwners.get(signal.id) ?? [];
      if (examples.length !== 1 || requirements.length !== 0 || unknowns.length !== 0) {
        throw new Error(`example_not_preserved_as_non_normative:${signal.id}`);
      }
      if (!(intentClaimsByTarget.get(examples[0].id) ?? []).some(({ kind, quote }) => (
        kind === 'EXAMPLE'
        && (quote.includes(signal.reference) || signal.reference.includes(quote))
      ))) {
        throw new Error(`example_signal_without_intent_claim:${signal.id}`);
      }
      continue;
    }
    if (signal.kind === 'DETERMINISM_CLAIM' || signal.kind === 'ARITHMETIC_SEMANTICS') continue;
    if (requirements.length !== 1) {
      throw new Error(`quality_constraint_without_measurable_requirement:${signal.id}`);
    }
    if (unknowns.length !== 0) {
      throw new Error(`quality_constraint_decision_mismatch:${signal.id}`);
    }
  }

  const determinismSignals = intentSignals
    .filter(({ kind }) => kind === 'DETERMINISM_CLAIM' || kind === 'ARITHMETIC_SEMANTICS');
  const reviewedDeterminismSignalIds = new Set(draft.determinismReview.intentSignalIds);
  const expectedDeterminismSignalIds = new Set(determinismSignals.map(({ id }) => id));
  if (reviewedDeterminismSignalIds.size !== expectedDeterminismSignalIds.size
    || [...expectedDeterminismSignalIds]
      .some((signalId) => !reviewedDeterminismSignalIds.has(signalId))) {
    throw new Error('incomplete_determinism_signal_review');
  }
  assertUniqueIds(draft.determinismReview.dimensions, 'kind', 'determinism_dimension');
  if (determinismSignals.length === 0) {
    if (draft.determinismReview.status !== 'NOT_APPLICABLE'
      || draft.determinismReview.dimensions.length !== 0) {
      throw new Error('unexpected_determinism_review');
    }
  } else {
    if (draft.determinismReview.status === 'NOT_APPLICABLE'
      || draft.determinismReview.dimensions.length === 0) {
      throw new Error('determinism_claim_without_review');
    }
    const reviewedDimensionKinds = new Set(draft.determinismReview.dimensions
      .map(({ kind }) => kind));
    if (reviewedDimensionKinds.size !== determinismDimensionKinds.length
      || determinismDimensionKinds.some((kind) => !reviewedDimensionKinds.has(kind))) {
      throw new Error('incomplete_determinism_dimension_review');
    }
    for (const dimension of draft.determinismReview.dimensions) {
      for (const targetId of dimension.targetIds) {
        if (!requirementIds.has(targetId)
          && !invariantIds.has(targetId)
          && !decisionIds.has(targetId)) {
          throw new Error(`determinism_dimension_references_unknown_target:${dimension.kind}:${targetId}`);
        }
      }
      if (dimension.status === 'SPECIFIED') {
        const targetRequirementIds = dimension.targetIds
          .filter((targetId) => requirementIds.has(targetId));
        if (targetRequirementIds.length === 0) {
          throw new Error(`specified_determinism_dimension_without_requirement:${dimension.kind}`);
        }
        const proof = dimension.acceptanceCaseId === null
          ? undefined
          : acceptanceCasesById.get(dimension.acceptanceCaseId);
        if (proof === undefined
          || !targetRequirementIds.includes(acceptanceRequirementById.get(proof.id))
          || proof.then.normalize('NFC') !== dimension.rationale.normalize('NFC')) {
          throw new Error(`specified_determinism_dimension_without_exact_proof:${dimension.kind}`);
        }
      }
      if (dimension.status === 'DECISION_REQUIRED'
        && !dimension.targetIds.some((targetId) => decisionIds.has(targetId))) {
        throw new Error(`determinism_gap_without_decision:${dimension.kind}`);
      }
      if (dimension.status === 'NOT_APPLICABLE' && dimension.targetIds.length !== 0) {
        throw new Error(`inapplicable_determinism_dimension_has_target:${dimension.kind}`);
      }
      if (dimension.status !== 'SPECIFIED' && dimension.acceptanceCaseId !== null) {
        throw new Error(`non_specified_determinism_dimension_has_proof:${dimension.kind}`);
      }
      if (dimension.status === 'NOT_APPLICABLE'
        && dimension.basis.every(({ source }) => source === 'MODEL_ANALYSIS')) {
        throw new Error(`inapplicable_determinism_dimension_without_evidence:${dimension.kind}`);
      }
    }
    const gapsFound = draft.determinismReview.dimensions
      .some(({ status }) => status === 'DECISION_REQUIRED');
    if ((draft.determinismReview.status === 'GAPS_FOUND') !== gapsFound) {
      throw new Error('determinism_review_status_mismatch');
    }
  }

  for (const decision of draft.decisions) {
    if (!materialDecisionIds.has(decision.questionId)) {
      throw new Error(`decision_without_material_unknown:${decision.questionId}`);
    }
    const ambiguityClaims = intentClaimsByTarget.get(decision.questionId) ?? [];
    if (ambiguityClaims.some(({ quote }) => (
      /\(\s*\)|``/u.test(quote)
      && !explicitUncertaintyPattern.test(quote)
    ))) {
      throw new Error(`decision_based_only_on_placeholder:${decision.questionId}`);
    }
    assertUniqueIds(decision.answers, 'id', `answer_${decision.questionId}`);
    const recommended = decision.answers.filter(({ recommended }) => recommended);
    if (recommended.length !== 1 || recommended[0].id !== decision.recommendedAnswerId) {
      throw new Error(`invalid_recommendation:${decision.questionId}`);
    }
    const authorizedDecisionText = [
      ...draft.unknowns
        .filter(({ decisionId }) => decisionId === decision.questionId)
        .flatMap(({ basis }) => basis
          .filter(({ source }) => source === 'USER_INTENT' || source === 'USER_DECISION')
          .map(({ reference }) => reference)),
      ...draft.boundaryRules
        .filter(({ decisionId }) => decisionId === decision.questionId)
        .flatMap(({ lowerBound, upperBound }) => [lowerBound, upperBound]),
    ].join('\n');
    const authorizedNumbers = new Set(numericTokens(authorizedDecisionText));
    if (numericTokens(recommended[0].contractEffect)
      .some((number) => !authorizedNumbers.has(number))) {
      throw new Error(`recommended_answer_invents_numeric_literal:${decision.questionId}`);
    }
    const answerEffects = decision.answers
      .map(({ contractEffect }) => contractEffect.normalize('NFC'));
    if (new Set(answerEffects).size !== answerEffects.length) {
      throw new Error(`decision_answers_without_distinct_effects:${decision.questionId}`);
    }
    assertRequirementReferences([decision], requirementIds, 'decision');
    for (const invariantId of decision.invariantIds) {
      if (!invariantIds.has(invariantId)) {
        throw new Error(`decision_references_unknown_invariant:${invariantId}`);
      }
    }
    for (const riskId of decision.riskIds) {
      if (!riskIds.has(riskId)) throw new Error(`decision_references_unknown_risk:${riskId}`);
    }
    const boundCases = acceptanceCases.filter(({ decisionBinding }) => (
      decisionBinding?.questionId === decision.questionId
    ));
    if (boundCases.length === 0) {
      throw new Error(`decision_effect_not_materialized:${decision.questionId}`);
    }
    for (const acceptanceCase of boundCases) {
      if (acceptanceCase.decisionBinding.answerId !== decision.recommendedAnswerId
        || !decision.requirementIds.includes(acceptanceRequirementById.get(acceptanceCase.id))) {
        throw new Error(`invalid_decision_effect_binding:${decision.questionId}:${acceptanceCase.id}`);
      }
    }
    if (!boundCases.some(({ then }) => (
      then.normalize('NFC') === recommended[0].contractEffect.normalize('NFC')
    ))) {
      throw new Error(`decision_effect_not_proven:${decision.questionId}`);
    }
  }

  for (const acceptanceCase of acceptanceCases) {
    if (acceptanceCase.decisionBinding === null) continue;
    const decision = decisionsById.get(acceptanceCase.decisionBinding.questionId);
    if (decision === undefined
      || !decision.answers.some(({ id }) => id === acceptanceCase.decisionBinding.answerId)) {
      throw new Error(`acceptance_case_references_unknown_decision:${acceptanceCase.id}`);
    }
  }

  const knownConstitutionRules = new Set(constitutionRules.map(({ id }) => id));
  const policyRulesById = new Map(policy.rules.map((rule) => [rule.id, rule]));
  const knownPolicyReferences = new Set([
    ...policy.rules.map(({ id }) => id),
    ...(policy.amendments ?? []).map(({ id }) => id),
  ]);
  for (const claim of basisClaims(draft)) {
    for (const basis of claim.basis) {
      if (basis.source === 'USER_INTENT' && !intent.includes(basis.reference)) {
        throw new Error(`invalid_user_intent_basis:${basis.reference}`);
      }
      if (basis.source === 'USER_DECISION' && !knownResolvedDecisions.has(basis.reference)) {
        throw new Error(`invalid_user_decision_basis:${basis.reference}`);
      }
      if (basis.source === 'MODEL_ANALYSIS' && basis.reference !== 'analysis') {
        throw new Error(`invalid_model_analysis_basis:${basis.reference}`);
      }
      if (basis.source === 'CONSTITUTION'
        && knownConstitutionRules.size > 0
        && !knownConstitutionRules.has(basis.reference)) {
        throw new Error(`basis_references_unknown_constitution_rule:${basis.reference}`);
      }
      if (basis.source === 'ARCHITECTURE_POLICY'
        && !knownPolicyReferences.has(basis.reference)) {
        throw new Error(`basis_references_unknown_policy:${basis.reference}`);
      }
      if (basis.source === 'SAFE_MECHANICAL_DEFAULT'
        && !knownPolicyReferences.has(basis.reference)) {
        throw new Error(`safe_default_references_unknown_policy:${basis.reference}`);
      }
      if (basis.source === 'SAFE_MECHANICAL_DEFAULT') {
        const rule = policyRulesById.get(basis.reference);
        const claimText = [
          claim.statement,
          claim.rationale,
          claim.contractEffect,
          claim.mitigation,
          claim.response,
        ].filter((value) => typeof value === 'string');
        if (rule === undefined
          || !ruleApplication(rule, architectureTags, intent).applies
          || !claimText.some((text) => literalReferenceAppears(rule.statement, text))) {
          throw new Error(`safe_default_not_proven_by_policy:${basis.reference}`);
        }
      }
      if (basis.source === 'WORKSPACE_EVIDENCE') {
        const range = workspaceBasisRange(basis.reference);
        if (range === null || !workspaceEvidence.some((evidence) => evidence.path === range.path
          && evidence.startLine <= range.startLine
          && evidence.endLine >= range.endLine)) {
          throw new Error(`basis_references_unavailable_workspace_evidence:${basis.reference}`);
        }
      }
    }
  }
  const authoritativeRequirementSources = new Set([
    'USER_INTENT',
    'USER_DECISION',
    'CONSTITUTION',
    'ARCHITECTURE_POLICY',
    'SAFE_MECHANICAL_DEFAULT',
  ]);
  const trustedTechnicalText = [
    intent,
    ...humanResolutionEvidence.values(),
    ...constitutionRules.map(({ statement }) => statement),
    ...policy.rules.map(({ statement }) => statement),
  ].join('\n');
  for (const requirement of draft.requirements) {
    if (!requirement.basis.some(({ source }) => authoritativeRequirementSources.has(source))) {
      throw new Error(`requirement_without_authoritative_basis:${requirement.id}`);
    }
    const normativeText = [
      requirement.statement,
      ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
      ...(requirement.measurement === null ? [] : [
        requirement.measurement.method,
        requirement.measurement.metric,
        requirement.measurement.target.value,
        requirement.measurement.conditions,
      ]),
    ].join('\n');
    assertNoUnprovenTechnicalPrescription(
      'requirement',
      requirement.id,
      normativeText,
      trustedTechnicalText,
    );
    assertNoUnprovenInternalMechanism(
      'requirement',
      requirement.id,
      normativeText,
      trustedTechnicalText,
    );
  }
  for (const invariant of draft.invariants) {
    assertNoUnprovenTechnicalPrescription(
      'invariant',
      invariant.id,
      `${invariant.statement}\n${invariant.falsification}`,
      trustedTechnicalText,
    );
    assertNoUnprovenInternalMechanism(
      'invariant',
      invariant.id,
      `${invariant.statement}\n${invariant.falsification}`,
      trustedTechnicalText,
    );
  }
  for (const risk of draft.risks) {
    assertNoUnprovenTechnicalPrescription(
      'risk',
      risk.id,
      `${risk.statement}\n${risk.mitigation}`,
      trustedTechnicalText,
    );
    assertNoUnprovenInternalMechanism(
      'risk',
      risk.id,
      `${risk.statement}\n${risk.mitigation}`,
      trustedTechnicalText,
    );
  }
  const contextualEvidenceSources = new Set(['USER_INTENT', 'USER_DECISION', 'WORKSPACE_EVIDENCE']);
  for (const context of draft.architectureContexts) {
    if (!context.basis.some(({ source }) => contextualEvidenceSources.has(source))) {
      throw new Error(`architecture_context_without_evidence:${context.tag}`);
    }
  }

  const semanticTargetIds = new Set([
    ...nonNormativeItemIds,
    ...pathReferenceIds,
    ...requirementIds,
    ...invariantIds,
    ...riskIds,
    ...decisionIds,
    ...boundaryRuleIds,
    ...policy.rules.map(({ id }) => id),
  ]);
  if (draft.adversarialReview.status === 'CHALLENGES_INTEGRATED'
    && draft.adversarialReview.findings.length === 0) {
    throw new Error('adversarial_review_without_findings');
  }
  if (draft.adversarialReview.status === 'NO_ADDITIONAL_FINDINGS'
    && draft.adversarialReview.findings.length !== 0) {
    throw new Error('unexpected_adversarial_findings');
  }
  const materiallyContestable = draft.decisions.length > 0
    || draft.risks.some(({ level }) => level === 'HIGH' || level === 'CRITICAL')
    || draft.determinismReview.status === 'GAPS_FOUND';
  if (materiallyContestable && draft.adversarialReview.findings.length === 0) {
    throw new Error('material_draft_without_adversarial_finding');
  }
  const targetPatternByDisposition = {
    REQUIREMENT: /^(?:REQ|INV|RISK|BOUND)-/u,
    DECISION: /^Q-/u,
    POLICY_CORRECTION: /^ARCH-/u,
    NON_NORMATIVE: /^(?:NOTE|PATH)-/u,
  };
  const semanticTextByTarget = new Map([
    ...draft.nonNormativeItems.map((item) => [item.id, item.statement]),
    ...draft.pathReferences.map((item) => [item.id, `${item.path}\n${item.rationale}`]),
    ...draft.requirements.map((requirement) => [
      requirement.id,
      [
        requirement.statement,
        ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
      ].join('\n'),
    ]),
    ...draft.invariants.map((invariant) => [
      invariant.id,
      `${invariant.statement}\n${invariant.falsification}`,
    ]),
    ...draft.risks.map((risk) => [risk.id, `${risk.statement}\n${risk.mitigation}`]),
    ...draft.decisions.map((decision) => [
      decision.questionId,
      [decision.question, ...decision.answers.map(({ contractEffect }) => contractEffect)].join('\n'),
    ]),
    ...draft.boundaryRules.map((boundaryRule) => [
      boundaryRule.id,
      [
        boundaryRule.subject,
        ...boundaryRule.acceptanceCaseIds
          .map((caseId) => acceptanceCasesById.get(caseId)?.then ?? ''),
      ].join('\n'),
    ]),
    ...draft.policyAssessments.map((assessment) => [assessment.ruleId, assessment.rationale]),
  ]);
  for (const finding of draft.adversarialReview.findings) {
    for (const targetId of finding.targetIds) {
      if (!semanticTargetIds.has(targetId)) {
        throw new Error(`adversarial_finding_references_unknown_target:${targetId}`);
      }
      if (!targetPatternByDisposition[finding.disposition].test(targetId)) {
        throw new Error(`adversarial_finding_targets_wrong_layer:${finding.id}:${targetId}`);
      }
    }
    if (!finding.targetIds.some((targetId) => literalReferenceAppears(
      semanticTextByTarget.get(targetId) ?? '',
      finding.response,
    ))) {
      throw new Error(`adversarial_response_not_absorbed:${finding.id}`);
    }
  }
  if (draft.determinismReview.status === 'GAPS_FOUND'
    && !draft.adversarialReview.findings.some(({ kind }) => kind === 'DETERMINISM_GAP')) {
    throw new Error('determinism_gap_omitted_from_residual_review');
  }

  if (draft.complexityReview.status === 'SIMPLIFIED'
    && draft.complexityReview.alternatives.length === 0) {
    throw new Error('simplification_without_alternative');
  }
  if (draft.complexityReview.status === 'NO_EXCESS'
    && draft.complexityReview.alternatives.length !== 0) {
    throw new Error('unexpected_complexity_alternative');
  }
  if (draft.riskReview.status === 'FOUND' && draft.risks.length === 0) {
    throw new Error('risk_review_without_findings');
  }
  if (draft.riskReview.status === 'NONE' && draft.risks.length !== 0) {
    throw new Error('risk_findings_without_review_status');
  }
  if (draft.riskReview.status === 'UNKNOWN'
    && !draft.unknowns.some(({ material }) => material)) {
    throw new Error('unknown_risk_without_material_unknown');
  }
  const rulesById = new Map(policy.rules.map((rule) => [rule.id, rule]));
  const amendmentsById = new Map((policy.amendments ?? []).map((item) => [item.id, item]));
  if (rulesById.size !== policy.rules.length) throw new Error('duplicate_policy_rule_id');
  if (amendmentsById.size !== (policy.amendments ?? []).length) {
    throw new Error('duplicate_policy_amendment_id');
  }
  const assessedRuleIds = assertUniqueIds(draft.policyAssessments, 'ruleId', 'policy_assessment');
  const applicableRuleIds = new Set(policy.rules
    .filter((rule) => ruleApplications.get(rule.id)?.applies)
    .map(({ id }) => id));
  if (assessedRuleIds.size !== applicableRuleIds.size
    || [...applicableRuleIds].some((ruleId) => !assessedRuleIds.has(ruleId))) {
    throw new Error('incomplete_policy_assessment');
  }
  for (const assessment of draft.policyAssessments) {
    const rule = rulesById.get(assessment.ruleId);
    if (rule === undefined) throw new Error(`unknown_policy_rule:${assessment.ruleId}`);
    if (!applicableRuleIds.has(rule.id)) {
      throw new Error(`unexpected_non_applicable_assessment:${assessment.ruleId}`);
    }
    if (assessment.demandStatus === 'CONFLICT') {
      if (!(intentClaimsByTarget.get(assessment.ruleId) ?? [])
        .some(({ disposition }) => disposition === 'POLICY_CORRECTION')) {
        throw new Error(`policy_conflict_without_intent_claim:${assessment.ruleId}`);
      }
      if (assessment.decisionId !== null) {
        if (!decisionIds.has(assessment.decisionId)) {
          throw new Error(`policy_conflict_references_missing_decision:${assessment.ruleId}`);
        }
        if (rule.level !== 'default') {
          throw new Error(`non_deliberable_policy_conflict:${assessment.ruleId}`);
        }
      }
      if (assessment.recommendedStatus === 'COMPLIANT' && assessment.amendmentId !== null) {
        throw new Error(`unexpected_policy_amendment:${assessment.ruleId}`);
      }
      if (assessment.recommendedStatus === 'AMENDED') {
        const amendment = amendmentsById.get(assessment.amendmentId);
        if (amendment?.ruleId !== assessment.ruleId || amendment.status !== 'approved') {
          throw new Error(`unapproved_policy_conflict:${assessment.ruleId}`);
        }
      }
    } else if (assessment.demandStatus === 'COMPLIANT') {
      if (assessment.recommendedStatus !== 'COMPLIANT'
        || assessment.decisionId !== null
        || assessment.amendmentId !== null) {
        throw new Error(`unexpected_policy_resolution:${assessment.ruleId}`);
      }
    }
  }
}

function observedPaths(preflight) {
  return [
    ...preflight.discovery.files.map(({ path }) => path),
    ...preflight.discovery.ignoredEntries.map(({ path }) => path),
  ];
}

function generatedId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
}

function indexedValue(values, index, kind) {
  const value = values[index];
  if (value === undefined) throw new Error(`semantic_opinion_index_out_of_range:${kind}:${index}`);
  return value;
}

function compileOpinionBasis(basis, request) {
  const resolvedDecisionIds = request.revision?.answers.map(({ questionId }) => questionId) ?? [];
  return basis.map((item) => (item.source === 'USER_DECISION'
    ? {
      source: item.source,
      reference: indexedValue(resolvedDecisionIds, item.resolutionIndex, 'resolved_decision'),
    }
    : item));
}

export function compileSemanticOpinion(opinion, request) {
  assertSchema('aegis.semantic_request.v8', request);
  const { requestDigest, ...requestPayload } = request;
  if (requestDigest !== canonicalDigest(requestPayload)) {
    throw new Error('semantic_request_digest_mismatch');
  }
  if (request.worksheetDigest !== canonicalDigest(request.worksheet)
    || request.worksheet.contextDigest !== request.contextDigest) {
    throw new Error('semantic_worksheet_digest_mismatch');
  }
  assertSchema('aegis.semantic_opinion.v1', opinion);
  if (opinion.worksheetDigest !== request.worksheetDigest) {
    throw new Error('semantic_opinion_worksheet_mismatch');
  }

  const requirementIds = opinion.requirements.map((_, index) => generatedId('REQ', index));
  const invariantIds = opinion.invariants.map((_, index) => generatedId('INV', index));
  const riskIds = opinion.risks.map((_, index) => generatedId('RISK', index));
  const decisionIds = opinion.decisions.map((_, index) => generatedId('Q', index));
  const noteIds = opinion.nonNormativeItems.map((_, index) => generatedId('NOTE', index));
  const pathIds = opinion.pathReferences.map((_, index) => generatedId('PATH', index));
  const boundaryIds = opinion.boundaryRules.map((_, index) => generatedId('BOUND', index));
  const policyRuleIds = request.policy.rules.map(({ id }) => id);
  const amendmentIds = request.policy.amendments.map(({ id }) => id);
  const resolvedDecisionIds = request.revision?.answers.map(({ questionId }) => questionId) ?? [];
  const acceptanceIds = opinion.requirements.map((requirement, requirementIndex) => (
    requirement.acceptanceCases.map((_, caseIndex) => (
      `AC-${String(requirementIndex + 1).padStart(4, '0')}-${String(caseIndex + 1).padStart(2, '0')}`
    ))
  ));
  const answerIds = opinion.decisions.map((decision, decisionIndex) => (
    decision.answers.map((_, answerIndex) => (
      `ANS-${String(decisionIndex + 1).padStart(4, '0')}-${String(answerIndex + 1).padStart(2, '0')}`
    ))
  ));
  const targetCollections = {
    REQUIREMENT: requirementIds,
    INVARIANT: invariantIds,
    RISK: riskIds,
    DECISION: decisionIds,
    RESOLVED_DECISION: resolvedDecisionIds,
    NON_NORMATIVE_ITEM: noteIds,
    PATH_REFERENCE: pathIds,
    BOUNDARY_RULE: boundaryIds,
    POLICY_RULE: policyRuleIds,
  };
  const compileTargets = (targets) => targets.map(({ kind, index }) => (
    indexedValue(targetCollections[kind], index, kind.toLocaleLowerCase('en-US'))
  ));
  const compileIndexes = (indexes, values, kind) => indexes.map((index) => (
    indexedValue(values, index, kind)
  ));
  const compileAcceptanceReference = ({ requirementIndex, caseIndex }) => (
    indexedValue(
      indexedValue(acceptanceIds, requirementIndex, 'acceptance_requirement'),
      caseIndex,
      'acceptance_case',
    )
  );
  const compileDecisionBinding = (binding) => {
    if (binding === null) return null;
    return {
      questionId: indexedValue(decisionIds, binding.decisionIndex, 'decision'),
      answerId: indexedValue(
        indexedValue(answerIds, binding.decisionIndex, 'answer_decision'),
        binding.answerIndex,
        'answer',
      ),
    };
  };
  const compileMeasurement = (measurement) => {
    if (measurement === null) return null;
    const target = measurement.target.source === 'USER_DECISION'
      ? {
        value: measurement.target.value,
        source: measurement.target.source,
        reference: indexedValue(
          request.revision?.answers.map(({ questionId }) => questionId) ?? [],
          measurement.target.resolutionIndex,
          'measurement_decision',
        ),
        evidenceStatus: measurement.target.evidenceStatus,
      }
      : measurement.target;
    return { ...measurement, target };
  };
  const dimensions = opinion.determinismReview.dimensions;
  if (dimensions.length !== request.worksheet.requiredDeterminismDimensions.length) {
    throw new Error('semantic_opinion_determinism_dimension_count_mismatch');
  }
  const determinismSignalIds = request.intentSignals.signals
    .filter(({ kind }) => kind === 'DETERMINISM_CLAIM' || kind === 'ARITHMETIC_SEMANTICS')
    .map(({ id }) => id);

  return {
    schema: 'aegis.semantic_draft.v7',
    sourceContextDigest: request.contextDigest,
    title: opinion.title,
    interpretation: opinion.interpretation,
    changeKind: opinion.changeKind,
    scope: opinion.scope,
    intentClaims: opinion.intentClaims.map((claim, index) => ({
      id: generatedId('CLAIM', index),
      quote: claim.quote,
      kind: claim.kind,
      disposition: claim.disposition,
      contractEffect: claim.contractEffect,
      targetIds: compileTargets(claim.targets),
      rationale: claim.rationale,
    })),
    nonNormativeItems: opinion.nonNormativeItems.map((item, index) => ({
      id: noteIds[index],
      kind: item.kind,
      statement: item.statement,
      status: 'NON_NORMATIVE',
      intentSignalIds: compileIndexes(
        item.intentSignalIndexes,
        request.intentSignals.signals.map(({ id }) => id),
        'intent_signal',
      ),
      basis: compileOpinionBasis(item.basis, request),
    })),
    pathReferences: opinion.pathReferences.map((item, index) => ({
      id: pathIds[index],
      path: item.path,
      role: item.role,
      rationale: item.rationale,
      requirementIds: compileIndexes(item.requirementIndexes, requirementIds, 'requirement'),
      basis: compileOpinionBasis(item.basis, request),
    })),
    architectureContexts: opinion.architectureContexts.map((item) => ({
      tag: indexedValue(request.policy.contexts, item.contextIndex, 'architecture_context').tag,
      rationale: item.rationale,
      basis: compileOpinionBasis(item.basis, request),
    })),
    policyAssessments: opinion.policyAssessments.map((item) => ({
      ruleId: indexedValue(policyRuleIds, item.ruleIndex, 'policy_rule'),
      demandStatus: item.demandStatus,
      recommendedStatus: item.recommendedStatus,
      rationale: item.rationale,
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(decisionIds, item.decisionIndex, 'policy_decision'),
      amendmentId: item.amendmentIndex === null
        ? null
        : indexedValue(amendmentIds, item.amendmentIndex, 'policy_amendment'),
    })),
    complexityReview: {
      ...opinion.complexityReview,
      alternatives: opinion.complexityReview.alternatives.map((item) => ({
        ...item,
        basis: compileOpinionBasis(item.basis, request),
      })),
    },
    requirements: opinion.requirements.map((requirement, requirementIndex) => ({
      id: requirementIds[requirementIndex],
      kind: requirement.kind,
      statement: requirement.statement,
      basis: compileOpinionBasis(requirement.basis, request),
      intentSignalIds: compileIndexes(
        requirement.intentSignalIndexes,
        request.intentSignals.signals.map(({ id }) => id),
        'intent_signal',
      ),
      measurement: compileMeasurement(requirement.measurement),
      acceptanceCases: requirement.acceptanceCases.map((acceptanceCase, caseIndex) => ({
        id: acceptanceIds[requirementIndex][caseIndex],
        kind: acceptanceCase.kind,
        given: acceptanceCase.given,
        when: acceptanceCase.when,
        then: acceptanceCase.then,
        outcomeKind: acceptanceCase.outcomeKind,
        decisionBinding: compileDecisionBinding(acceptanceCase.decisionBinding),
        boundaryBinding: acceptanceCase.boundaryBinding === null
          ? null
          : {
            ruleId: indexedValue(
              boundaryIds,
              acceptanceCase.boundaryBinding.boundaryIndex,
              'boundary_rule',
            ),
            side: acceptanceCase.boundaryBinding.side,
            expectedBehavior: acceptanceCase.boundaryBinding.expectedBehavior,
            expectedValue: acceptanceCase.boundaryBinding.expectedValue,
          },
      })),
    })),
    invariants: opinion.invariants.map((item, index) => ({
      id: invariantIds[index],
      statement: item.statement,
      falsification: item.falsification,
      requirementIds: compileIndexes(item.requirementIndexes, requirementIds, 'requirement'),
    })),
    risks: opinion.risks.map((item, index) => ({
      id: riskIds[index],
      kind: item.kind,
      level: item.level,
      statement: item.statement,
      mitigation: item.mitigation,
      requirementIds: compileIndexes(item.requirementIndexes, requirementIds, 'requirement'),
      basis: compileOpinionBasis(item.basis, request),
    })),
    riskReview: {
      status: opinion.risks.length > 0
        ? 'FOUND'
        : opinion.riskReview.certainty === 'UNKNOWN' ? 'UNKNOWN' : 'NONE',
      rationale: opinion.riskReview.rationale,
    },
    adversarialReview: {
      status: opinion.adversarialReview.findings.length > 0
        ? 'CHALLENGES_INTEGRATED'
        : 'NO_ADDITIONAL_FINDINGS',
      rationale: opinion.adversarialReview.rationale,
      findings: opinion.adversarialReview.findings.map((item, index) => ({
        id: generatedId('ADV', index),
        kind: item.kind,
        disposition: item.disposition,
        challenge: item.challenge,
        response: item.response,
        targetIds: compileTargets(item.targets),
        basis: compileOpinionBasis(item.basis, request),
      })),
    },
    determinismReview: {
      status: dimensions.length === 0
        ? 'NOT_APPLICABLE'
        : dimensions.some(({ status }) => status === 'DECISION_REQUIRED')
          ? 'GAPS_FOUND'
          : 'COMPLETE',
      rationale: opinion.determinismReview.rationale,
      intentSignalIds: determinismSignalIds,
      dimensions: dimensions.map((item, index) => ({
        kind: request.worksheet.requiredDeterminismDimensions[index],
        status: item.status,
        rationale: item.rationale,
        targetIds: compileTargets(item.targets),
        basis: compileOpinionBasis(item.basis, request),
        acceptanceCaseId: item.acceptanceCase === null
          ? null
          : compileAcceptanceReference(item.acceptanceCase),
      })),
    },
    boundaryRules: opinion.boundaryRules.map((item, index) => ({
      id: boundaryIds[index],
      subject: item.subject,
      lowerBound: item.lowerBound,
      upperBound: item.upperBound,
      underflowBehavior: item.underflowBehavior,
      overflowBehavior: item.overflowBehavior,
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(decisionIds, item.decisionIndex, 'boundary_decision'),
      requirementIds: compileIndexes(item.requirementIndexes, requirementIds, 'requirement'),
      acceptanceCaseIds: item.acceptanceCases.map(compileAcceptanceReference),
      intentSignalIds: compileIndexes(
        item.intentSignalIndexes,
        request.intentSignals.signals.map(({ id }) => id),
        'intent_signal',
      ),
      basis: compileOpinionBasis(item.basis, request),
    })),
    unknowns: opinion.unknowns.map((item, index) => ({
      id: generatedId('UNKNOWN', index),
      statement: item.statement,
      material: item.material,
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(decisionIds, item.decisionIndex, 'unknown_decision'),
      intentSignalIds: compileIndexes(
        item.intentSignalIndexes,
        request.intentSignals.signals.map(({ id }) => id),
        'intent_signal',
      ),
      basis: compileOpinionBasis(item.basis, request),
    })),
    decisions: opinion.decisions.map((item, decisionIndex) => ({
      questionId: decisionIds[decisionIndex],
      question: item.question,
      recommendedAnswerId: indexedValue(
        answerIds[decisionIndex],
        item.recommendedAnswerIndex,
        'recommended_answer',
      ),
      requirementIds: compileIndexes(item.requirementIndexes, requirementIds, 'requirement'),
      invariantIds: compileIndexes(item.invariantIndexes, invariantIds, 'invariant'),
      riskIds: compileIndexes(item.riskIndexes, riskIds, 'risk'),
      answers: item.answers.map((answer, answerIndex) => ({
        id: answerIds[decisionIndex][answerIndex],
        label: answer.label,
        rationale: answer.rationale,
        contractEffect: answer.contractEffect,
        recommended: answerIndex === item.recommendedAnswerIndex,
      })),
    })),
  };
}

export function compileSemanticContract({
  repositoryRoot,
  draft,
  preflight,
  policy,
  policyDigest,
  constitution,
  constitutionDigest,
  humanResolutions = [],
  semanticRevision = null,
}) {
  assertSemanticDraft(draft, policy, {
    constitutionRules: constitution?.rules,
    intent: preflight.intent,
    resolvedDecisionIds: humanResolutions.map(({ questionId }) => questionId),
    humanResolutions,
    workspaceEvidence: buildSourceEvidence(repositoryRoot, preflight),
  });
  const semanticRequest = buildSemanticRequest({
    repositoryRoot,
    preflight,
    policy,
    constitution,
    revision: semanticRevision,
  });
  if (draft.sourceContextDigest !== semanticRequest.contextDigest) {
    throw new Error('semantic_context_mismatch');
  }
  const contract = {
    schema: 'aegis.issue_contract.v12',
    implementationAuthorized: false,
    sourceSemanticRequestDigest: semanticRequest.requestDigest,
    semanticRevision,
    sourcePreflightDigest: preflight.preflightDigest,
    sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
    policyDigest,
    constitutionDigest,
    intent: preflight.intent,
    observedPaths: observedPaths(preflight),
    intentSignals: detectIntentSignals(preflight.intent),
    policySignals: mechanicalPolicySignals(policy, preflight.intent),
    specification: draft,
    humanResolutions,
    approval: null,
  };
  assertSchema('aegis.issue_contract.v12', contract);
  assertContractApprovalEvidence(contract);
  return contract;
}

function decisionMap(contract) {
  return new Map(contract.specification.decisions
    .map((decision) => [decision.questionId, decision]));
}

export function buildHumanResolutionRecords(contract, resolution) {
  const decisions = decisionMap(contract);
  return resolution.answers.map((answer) => {
    const decision = decisions.get(answer.questionId);
    if (decision === undefined) throw new Error(`unknown_resolution_question:${answer.questionId}`);
    if ('correction' in answer) {
      return {
        questionId: answer.questionId,
        question: decision.question,
        kind: 'CORRECTION',
        correction: answer.correction,
        sourceContractDigest: resolution.contractDraftDigest,
        method: resolution.method,
        attestation: resolution.attestation,
      };
    }
    const selected = decision.answers.find(({ id }) => id === answer.answerId);
    if (selected === undefined) throw new Error(`unknown_resolution_answer:${answer.questionId}`);
    return {
      questionId: answer.questionId,
      question: decision.question,
      kind: 'ANSWER',
      answerId: selected.id,
      label: selected.label,
      rationale: selected.rationale,
      contractEffect: selected.contractEffect,
      sourceContractDigest: resolution.contractDraftDigest,
      method: resolution.method,
      attestation: resolution.attestation,
    };
  });
}

export function assertContractApprovalEvidence(contract, { required = false } = {}) {
  const resolutions = new Map();
  for (const resolution of contract.humanResolutions) {
    if (resolutions.has(resolution.questionId)) {
      throw new Error(`duplicate_human_resolution:${resolution.questionId}`);
    }
    resolutions.set(resolution.questionId, resolution);
  }
  const decisions = decisionMap(contract);
  if (contract.approval === null) {
    if (required) throw new Error('missing_human_approval');
    for (const questionId of decisions.keys()) {
      if (resolutions.has(questionId)) throw new Error(`pending_decision_marked_resolved:${questionId}`);
    }
    return;
  }

  for (const decision of decisions.values()) {
    const resolution = resolutions.get(decision.questionId);
    if (resolution?.kind !== 'ANSWER' || resolution.answerId !== decision.recommendedAnswerId) {
      throw new Error(`approved_decision_not_bound_to_recommendation:${decision.questionId}`);
    }
    const selected = decision.answers.find(({ id }) => id === resolution.answerId);
    if (selected === undefined
      || resolution.question !== decision.question
      || resolution.label !== selected.label
      || resolution.rationale !== selected.rationale
      || resolution.contractEffect !== selected.contractEffect
      || resolution.sourceContractDigest !== contract.approval.contractDraftDigest
      || resolution.method !== contract.approval.method
      || resolution.attestation !== contract.approval.attestation) {
      throw new Error(`human_resolution_evidence_mismatch:${decision.questionId}`);
    }
  }
  const pendingIds = new Set(decisions.keys());
  const draft = {
    ...contract,
    humanResolutions: contract.humanResolutions
      .filter(({ questionId }) => !pendingIds.has(questionId)),
    approval: null,
  };
  const draftDigest = canonicalDigest(draft);
  if (contract.approval.contractDraftDigest !== draftDigest
    || contract.approval.executionId !== `draft-${draftDigest.slice(0, 16)}`) {
    throw new Error('human_approval_draft_mismatch');
  }
}

export function assertContractDocument({
  repositoryRoot,
  contract,
  preflight,
  policy,
  policyDigest,
  constitution,
  constitutionDigest,
}) {
  assertSchema('aegis.issue_contract.v12', contract);
  const semanticRequest = buildSemanticRequest({
    repositoryRoot,
    preflight,
    policy,
    constitution,
    revision: contract.semanticRevision,
  });
  if (contract.sourceSemanticRequestDigest !== semanticRequest.requestDigest) {
    throw new Error('contract_semantic_request_mismatch');
  }
  if (contract.specification.sourceContextDigest !== semanticRequest.contextDigest) {
    throw new Error('contract_semantic_context_mismatch');
  }
  assertSemanticDraft(contract.specification, policy, {
    constitutionRules: constitution?.rules,
    intent: preflight.intent,
    resolvedDecisionIds: contract.humanResolutions.map(({ questionId }) => questionId),
    humanResolutions: contract.humanResolutions,
    workspaceEvidence: buildSourceEvidence(repositoryRoot, preflight),
  });
  if (contract.implementationAuthorized !== false) throw new Error('implementation_authorized');
  if (contract.sourcePreflightDigest !== preflight.preflightDigest) throw new Error('contract_preflight_mismatch');
  if (contract.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) throw new Error('contract_snapshot_mismatch');
  if (contract.policyDigest !== policyDigest) throw new Error('contract_policy_mismatch');
  if (contract.constitutionDigest !== constitutionDigest) throw new Error('contract_constitution_mismatch');
  if (contract.intent !== preflight.intent) throw new Error('contract_intent_mismatch');
  if (canonicalDigest(contract.observedPaths) !== canonicalDigest(observedPaths(preflight))) {
    throw new Error('contract_observed_paths_mismatch');
  }
  if (canonicalDigest(contract.intentSignals)
    !== canonicalDigest(detectIntentSignals(preflight.intent))) {
    throw new Error('contract_intent_signals_mismatch');
  }
  if (canonicalDigest(contract.policySignals)
    !== canonicalDigest(mechanicalPolicySignals(policy, preflight.intent))) {
    throw new Error('contract_policy_signals_mismatch');
  }
  assertContractApprovalEvidence(contract);
}

export function buildConfirmationRequest(contract) {
  if (contract.approval !== null) throw new Error('contract_already_approved');
  const contractDraftDigest = canonicalDigest(contract);
  const request = {
    schema: 'aegis.confirmation_request.v4',
    status: 'USER_CONFIRMATION_REQUIRED',
    executionId: `draft-${contractDraftDigest.slice(0, 16)}`,
    contractDraftDigest,
    title: contract.specification.title,
    recommendationPolicy: 'RECOMMENDATIONS_ARE_NOT_HUMAN_DECISIONS',
    requiredAttestation: 'CONTRACT_REVIEWED_AND_APPROVED',
    questions: contract.specification.decisions.map((decision) => ({
      id: decision.questionId,
      question: decision.question,
      recommendedAnswerId: decision.recommendedAnswerId,
      gaps: contract.specification.unknowns
        .filter(({ decisionId }) => decisionId === decision.questionId)
        .map(({ statement }) => statement),
      requirementIds: decision.requirementIds,
      acceptanceCaseIds: contract.specification.requirements
        .flatMap(({ acceptanceCases }) => acceptanceCases)
        .filter(({ decisionBinding }) => decisionBinding?.questionId === decision.questionId)
        .map(({ id }) => id),
      invariantIds: decision.invariantIds,
      riskIds: decision.riskIds,
      answers: decision.answers,
    })),
    artifactPath: '.harness/runtime/contract.md',
  };
  assertSchema('aegis.confirmation_request.v4', request);
  return request;
}

export function buildSemanticRevision(contract, resolution) {
  const decisions = new Map(contract.specification.decisions
    .map((decision) => [decision.questionId, decision]));
  return {
    sourceContractDigest: canonicalDigest(contract),
    answers: resolution.answers.map((answer) => {
      if ('correction' in answer) return answer;
      const selected = decisions.get(answer.questionId)?.answers
        .find(({ id }) => id === answer.answerId);
      if (selected === undefined) throw new Error(`unknown_resolution_answer:${answer.questionId}`);
      return {
        questionId: answer.questionId,
        answerId: answer.answerId,
        label: selected.label,
        rationale: selected.rationale,
        contractEffect: selected.contractEffect,
      };
    }),
  };
}

export function assertRevisionApplied(draft, resolution) {
  const resolvedQuestionIds = new Set(resolution.answers.map(({ questionId }) => questionId));
  if (!draft.requirements.some(({ basis }) => basis.some(({ source, reference }) => (
    source === 'USER_DECISION' && resolvedQuestionIds.has(reference)
  )))) {
    throw new Error('revision_without_user_decision_basis');
  }
  const decisions = new Map(draft.decisions.map((decision) => [decision.questionId, decision]));
  const normativeText = [
    ...draft.scope.inScope,
    ...draft.scope.outOfScope,
    ...draft.requirements.flatMap((requirement) => [
      requirement.statement,
      ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
    ]),
    ...draft.invariants.flatMap(({ statement, falsification }) => [statement, falsification]),
  ];
  for (const answer of resolution.answers) {
    const revisedDecision = decisions.get(answer.questionId);
    if ('correction' in answer) {
      if (revisedDecision !== undefined) throw new Error(`unresolved_correction:${answer.questionId}`);
    } else {
      if (revisedDecision !== undefined && revisedDecision.recommendedAnswerId !== answer.answerId) {
        throw new Error(`revision_ignored_selected_answer:${answer.questionId}`);
      }
      if (!normativeText.some((text) => (
        text.normalize('NFC') === answer.contractEffect.normalize('NFC')
      ))) {
        throw new Error(`revision_effect_not_materialized:${answer.questionId}`);
      }
    }
  }
}

export function assertConfirmationRequest(contract, request) {
  assertSchema('aegis.confirmation_request.v4', request);
  if (canonicalDigest(request) !== canonicalDigest(buildConfirmationRequest(contract))) {
    throw new Error('stale_confirmation_request');
  }
}

export function renderSemanticContractMarkdown(contract, {
  contractDigest = '',
  policyRules = [],
} = {}) {
  const specification = contract.specification;
  const governed = contract.approval !== null;
  const rules = new Map(policyRules.map((rule) => [rule.id, rule]));
  const selections = new Map(contract.humanResolutions
    .filter(({ kind }) => kind === 'ANSWER')
    .map(({ questionId, answerId }) => [questionId, answerId]));
  const renderBasis = (basis) => basis
    .map(({ source, reference }) => `${source}:${reference}`)
    .join(', ');
  const lines = [
    `# Issue / Contrato: ${specification.title}`,
    '',
    `> **Status:** ${governed ? 'Selado & Governado' : 'Rascunho aguardando confirmação'}`,
    `> **Modo:** ${specification.changeKind}`,
    '> **IMPLEMENTATION_AUTHORIZED:** `false`',
    ...(governed ? [`> **Digest do Contrato:** \`${contractDigest}\``] : []),
    ...(governed ? [
      `> **Rascunho aprovado:** \`${contract.approval.contractDraftDigest}\``,
      `> **Confirmação humana:** ${contract.approval.attestation} via ${contract.approval.method}`,
    ] : []),
    `> **Preflight:** \`${contract.sourcePreflightDigest}\``,
    `> **Requisição semântica:** \`${contract.sourceSemanticRequestDigest}\``,
    `> **Snapshot de src/:** \`${contract.sourceSnapshotDigest}\``,
    '',
    '## 1. Demanda interpretada',
    specification.interpretation,
    '',
    '> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.',
    '',
    '## 2. Escopo',
    '**Incluído:**',
    ...specification.scope.inScope.map((item) => `- ${item}`),
    '',
    '**Fora do escopo:**',
    ...(specification.scope.outOfScope.length > 0
      ? specification.scope.outOfScope.map((item) => `- ${item}`)
      : ['- Nada adicional declarado.']),
    '',
    '**Caminhos observados — não autorizam implementação:**',
    ...(contract.observedPaths.length > 0
      ? contract.observedPaths.map((path) => `- \`${path}\``)
      : ['- Nenhum caminho observado.']),
    '',
    '**Referências de caminho classificadas:**',
    ...(specification.pathReferences.length > 0
      ? specification.pathReferences.map(({ id, path, role, rationale }) => `- **${id}** — \`${path}\` — **${role}:** ${rationale}`)
      : ['- Nenhuma referência de caminho normativa ou sugerida.']),
    '',
    '> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.',
    '',
    '## 3. Governança e correções antecipadas',
  ];

  const compliantAssessments = specification.policyAssessments
    .filter(({ demandStatus }) => demandStatus === 'COMPLIANT');
  const conflictAssessments = specification.policyAssessments
    .filter(({ demandStatus }) => demandStatus === 'CONFLICT');
  lines.push(`- **Contextos detectados:** ${specification.architectureContexts.map(({ tag }) => tag).join(', ')}`);
  if (contract.policySignals.length > 0) {
    lines.push(`- **Sinais mecânicos:** ${contract.policySignals
      .map(({ ruleId, kind, reference }) => `${ruleId}/${kind}: ${reference}`)
      .join('; ')}.`);
  }
  if (contract.intentSignals.length > 0) {
    lines.push(`- **Sinais da intenção:** ${contract.intentSignals
      .map(({ id, kind, reference }) => `${id}/${kind}: ${reference}`)
      .join('; ')}.`);
  }
  if (compliantAssessments.length > 0) {
    lines.push(`- **Regras aplicáveis já conformes:** ${compliantAssessments.map(({ ruleId }) => ruleId).join(', ')}.`);
  }
  if (conflictAssessments.length === 0) lines.push('- Nenhuma correção constitucional necessária.');
  for (const assessment of conflictAssessments) {
    const rule = rules.get(assessment.ruleId);
    const disposition = assessment.decisionId
      ? 'DECISÃO MATERIAL PENDENTE'
      : rule?.level === 'hard' ? 'CORREÇÃO OBRIGATÓRIA' : 'CORREÇÃO KISS';
    lines.push(`- **${assessment.ruleId} — ${disposition}:** ${assessment.rationale}`);
    if (rule?.statement) lines.push(`  - Regra: ${rule.statement}`);
    if (assessment.decisionId) lines.push(`  - Decisão: \`${assessment.decisionId}\``);
    if (assessment.amendmentId) lines.push(`  - Emenda: \`${assessment.amendmentId}\``);
  }

  lines.push('', '## 4. Revisão de complexidade');
  lines.push(`- **${specification.complexityReview.status}:** ${specification.complexityReview.rationale}`);
  for (const alternative of specification.complexityReview.alternatives) {
    lines.push(`- **${alternative.requested} → ${alternative.simpler}:** ${alternative.rationale}`);
  }

  lines.push('', '### Rastreabilidade da intenção');
  for (const claim of specification.intentClaims) {
    lines.push(`- **${claim.id} — ${claim.kind}/${claim.disposition}:** “${claim.quote}” → ${claim.targetIds.join(', ')}.`);
  }
  if (specification.nonNormativeItems.length > 0) {
    lines.push('', '### Itens não normativos');
    for (const item of specification.nonNormativeItems) {
      lines.push(`- **${item.id} — ${item.kind}:** ${item.statement}`);
    }
  }

  lines.push('', '## 5. Requisitos e casos falsificáveis');
  for (const requirement of specification.requirements) {
    lines.push('', `### ${requirement.id}`, requirement.statement, `*Base: ${renderBasis(requirement.basis)}*`, '');
    if (requirement.measurement !== null) {
      lines.push(
        `- **Medição:** ${requirement.measurement.metric}`,
        `  - Método: ${requirement.measurement.method}`,
        `  - Alvo: ${requirement.measurement.target.value}`,
        `  - Procedência: ${requirement.measurement.target.source}:${requirement.measurement.target.reference}`,
        `  - Evidência de viabilidade: ${requirement.measurement.target.evidenceStatus}`,
        `  - Condições: ${requirement.measurement.conditions}`,
      );
    }
    for (const acceptanceCase of requirement.acceptanceCases) {
      lines.push(
        `- **${acceptanceCase.id} — ${acceptanceCase.kind}**`,
        `  - Dado: ${acceptanceCase.given}`,
        `  - Quando: ${acceptanceCase.when}`,
        `  - Então: ${acceptanceCase.then}`,
        `  - Resultado observável: ${acceptanceCase.outcomeKind}`,
      );
      if (acceptanceCase.boundaryBinding !== null) {
        lines.push(`  - Limite: ${acceptanceCase.boundaryBinding.ruleId}/${acceptanceCase.boundaryBinding.side} → ${acceptanceCase.boundaryBinding.expectedBehavior}${acceptanceCase.boundaryBinding.expectedValue === null ? '' : ` (${acceptanceCase.boundaryBinding.expectedValue})`}`);
      }
    }
  }

  lines.push('', '### Regras de limite e extrapolação');
  if (specification.boundaryRules.length === 0) {
    lines.push('- Nenhum valor público de representação finita identificado.');
  }
  for (const boundaryRule of specification.boundaryRules) {
    lines.push(`- **${boundaryRule.id}: ${boundaryRule.subject}**`);
    lines.push(`  - Intervalo: ${boundaryRule.lowerBound} até ${boundaryRule.upperBound}.`);
    lines.push(`  - Abaixo: ${boundaryRule.underflowBehavior}; acima: ${boundaryRule.overflowBehavior}.`);
    if (boundaryRule.decisionId !== null) lines.push(`  - Decisão necessária: ${boundaryRule.decisionId}.`);
    lines.push(`  - Provas: ${boundaryRule.acceptanceCaseIds.join(', ')}.`);
  }

  lines.push('', '### Revisão de determinismo');
  lines.push(`- **${specification.determinismReview.status}:** ${specification.determinismReview.rationale}`);
  for (const dimension of specification.determinismReview.dimensions) {
    lines.push(`- **${dimension.kind}/${dimension.status}:** ${dimension.rationale}${dimension.targetIds.length === 0 ? '' : ` → ${dimension.targetIds.join(', ')}`}`);
    lines.push(`  - Base: ${renderBasis(dimension.basis)}.`);
    if (dimension.acceptanceCaseId !== null) lines.push(`  - Prova única: ${dimension.acceptanceCaseId}.`);
  }

  lines.push('', '## 6. Invariantes');
  for (const invariant of specification.invariants) {
    lines.push(`- **${invariant.id}:** ${invariant.statement}`);
    lines.push(`  - Falsificado se: ${invariant.falsification}`);
  }

  lines.push('', '## 7. Riscos e vulnerabilidades');
  lines.push(`- **Revisão ${specification.riskReview.status}:** ${specification.riskReview.rationale}`);
  if (specification.risks.length === 0) lines.push('- Nenhum risco material identificado.');
  for (const risk of specification.risks) {
    lines.push(`- **${risk.id} — ${risk.kind}/${risk.level}:** ${risk.statement}`);
    lines.push(`  - Mitigação: ${risk.mitigation}`);
    lines.push(`  - Base: ${renderBasis(risk.basis)}`);
  }

  lines.push('', '## 8. Parecer adversarial');
  lines.push(`- **${specification.adversarialReview.status}:** ${specification.adversarialReview.rationale}`);
  for (const finding of specification.adversarialReview.findings) {
    lines.push(`- **${finding.id} — ${finding.kind}/${finding.disposition}:** ${finding.challenge}`);
    lines.push(`  - Resposta incorporada: ${finding.response}`);
    lines.push(`  - Afeta: ${finding.targetIds.join(', ')}.`);
    lines.push(`  - Base: ${renderBasis(finding.basis)}`);
  }

  const unknownsByDecision = new Map();
  for (const unknown of specification.unknowns.filter(({ decisionId }) => decisionId !== null)) {
    const related = unknownsByDecision.get(unknown.decisionId) ?? [];
    related.push(unknown);
    unknownsByDecision.set(unknown.decisionId, related);
  }
  const informationalUnknowns = specification.unknowns.filter(({ decisionId }) => decisionId === null);

  lines.push('', governed ? '## 9. Decisões humanas seladas' : '## 9. Decisões aguardando escolha humana');
  if (specification.decisions.length === 0) {
    lines.push('Nenhuma ambiguidade material detectada.');
  } else {
    for (const decision of specification.decisions) {
      lines.push('', `### ${decision.questionId}: ${decision.question}`);
      for (const unknown of unknownsByDecision.get(decision.questionId) ?? []) {
        lines.push(`**${governed ? 'Lacuna resolvida' : 'Lacuna'}:** ${unknown.statement}`);
      }
      for (const answer of decision.answers) {
        const selected = selections.get(decision.questionId) === answer.id;
        const mark = selected ? '(*)' : '( )';
        const evidence = selected
          ? ' **[ESCOLHA HUMANA]**'
          : answer.recommended ? ' **[RECOMENDADO — NÃO É CONSENTIMENTO]**' : '';
        lines.push(`${mark} **${answer.label}**${evidence}: ${answer.rationale}`);
        lines.push(`  - Efeito no contrato: ${answer.contractEffect}`);
      }
      const decisionCases = specification.requirements
        .flatMap(({ acceptanceCases }) => acceptanceCases)
        .filter(({ decisionBinding }) => decisionBinding?.questionId === decision.questionId)
        .map(({ id }) => id);
      lines.push(`Impacta requisitos: ${decision.requirementIds.join(', ') || 'nenhum'}; provas: ${decisionCases.join(', ') || 'nenhuma'}; invariantes: ${decision.invariantIds.join(', ') || 'nenhum'}; riscos: ${decision.riskIds.join(', ') || 'nenhum'}.`);
    }
  }
  if (informationalUnknowns.length > 0) {
    lines.push('', '### Lacunas informativas — não exigem decisão');
    for (const unknown of informationalUnknowns) lines.push(`- **${unknown.id}:** ${unknown.statement}`);
  }
  const currentDecisionIds = new Set(specification.decisions
    .map(({ questionId }) => questionId));
  const incorporatedResolutions = contract.humanResolutions
    .filter(({ questionId }) => !currentDecisionIds.has(questionId));
  if (incorporatedResolutions.length > 0) {
    lines.push('', '### Decisões humanas incorporadas por recompilação');
    for (const resolution of incorporatedResolutions) {
      if (resolution.kind === 'ANSWER') {
        lines.push(`- **${resolution.questionId}: ${resolution.question}** → ${resolution.label}. ${resolution.rationale}`);
        lines.push(`  - Efeito incorporado: ${resolution.contractEffect}`);
      } else {
        lines.push(`- **${resolution.questionId}: ${resolution.question}** → interpretação fornecida: ${resolution.correction}`);
      }
      lines.push(`  - Evidência: ${resolution.attestation} via ${resolution.method}; rascunho \`${resolution.sourceContractDigest}\`.`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function resolutionRequiresRecompilation({ contract, request, resolution }) {
  assertConfirmationRequest(contract, request);
  assertSchema('aegis.semantic_resolution.v2', resolution);
  if (request.executionId !== resolution.executionId
    || request.contractDraftDigest !== resolution.contractDraftDigest
    || request.contractDraftDigest !== canonicalDigest(contract)) {
    throw new Error('stale_semantic_resolution');
  }
  const decisions = new Map(contract.specification.decisions
    .map((decision) => [decision.questionId, decision]));
  if (resolution.method === 'DIRECT_COMMAND' && decisions.size > 0) {
    throw new Error('interactive_wizard_required');
  }
  const answered = assertUniqueIds(resolution.answers, 'questionId', 'resolution');
  if (answered.size !== decisions.size || [...decisions.keys()].some((id) => !answered.has(id))) {
    throw new Error('incomplete_semantic_resolution');
  }
  for (const answer of resolution.answers) {
    const decision = decisions.get(answer.questionId);
    if (decision === undefined) throw new Error(`unknown_resolution_question:${answer.questionId}`);
    if ('correction' in answer) return true;
    if (!decision.answers.some(({ id }) => id === answer.answerId)) {
      throw new Error(`unknown_resolution_answer:${answer.questionId}`);
    }
    if (answer.answerId !== decision.recommendedAnswerId) return true;
  }
  return false;
}

export function finalizeContractApproval({ contract, request, resolution }) {
  if (resolutionRequiresRecompilation({ contract, request, resolution })) {
    throw new Error('semantic_recompilation_required');
  }
  if (resolution.attestation !== 'CONTRACT_REVIEWED_AND_APPROVED') {
    throw new Error('contract_approval_attestation_required');
  }
  const finalContract = {
    ...contract,
    humanResolutions: [
      ...contract.humanResolutions,
      ...buildHumanResolutionRecords(contract, resolution),
    ],
    approval: {
      method: resolution.method,
      attestation: resolution.attestation,
      executionId: resolution.executionId,
      contractDraftDigest: resolution.contractDraftDigest,
    },
  };
  assertSchema('aegis.issue_contract.v12', finalContract);
  assertContractApprovalEvidence(finalContract, { required: true });
  return finalContract;
}
