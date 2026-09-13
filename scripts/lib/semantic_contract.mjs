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
  adversarialReview: 'REQUIRED_WHEN_FLAGGED_AND_MUST_CITE_RULE',
};

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
      method: 'DETERMINISTIC_INTENT_REVIEW_V1',
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
        requiresAdversarialReview: rule.requiresAdversarialReview,
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
  const outputSchemaDocument = schemaDocument('aegis.semantic_draft.v4');
  outputSchemaDocument.properties.sourceContextDigest = { const: contextDigest };
  const request = {
    schema: 'aegis.semantic_request.v4',
    contextDigest,
    ...context,
    outputSchema: {
      id: 'aegis.semantic_draft.v4',
      digest: canonicalDigest(outputSchemaDocument),
      strict: true,
      document: outputSchemaDocument,
    },
  };
  assertSchema('aegis.semantic_request.v4', request);
  return request;
}

function assertUniqueIds(items, field, kind) {
  const ids = items.map((item) => item[field]);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate_${kind}_id`);
  return new Set(ids);
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
    ...draft.requirements,
    ...draft.risks,
    ...draft.boundaryRules,
    ...draft.unknowns,
    ...draft.adversarialReview.findings,
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
        requiresAdversarialReview: rule.requiresAdversarialReview,
      })),
    ...matchingReferences(intent, rule.forbiddenReferences)
      .map((reference) => ({
        ruleId: rule.id,
        kind: 'POSSIBLE_CONFLICT',
        reference,
        requiresAdversarialReview: true,
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

function targetValueAppearsInEvidence(target, evidenceText) {
  const numbers = numericTokens(target.value);
  if (numbers.length > 0) return numbers.every((number) => evidenceText.includes(number));
  return literalReferenceAppears(evidenceText, target.value)
    || (/\bzero\b/iu.test(target.value)
      && /\b(?:zero|sem\s+aloca|no[- ]?allocation)\b/iu.test(evidenceText));
}

function internalMechanismPhrases(text) {
  const patterns = [
    /\b(?:buffers?|arrays?|vetores?|objetos?)\s+(?:est[aá]tic[oa]s?|din[aâ]mic[oa]s?|tipad[oa]s?|pr[eé]-?alocad[oa]s?)\b/giu,
    /\bestruturas?\s+(?:planas?\s+)?pr[eé]-?alocad[oa]s?\b/giu,
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

function boundaryBehaviorIsExplicit(boundaryRule, behavior, humanResolutionEvidence) {
  if (behavior === 'NOT_APPLICABLE') return true;
  const patternByBehavior = {
    REJECT: /\b(?:rejeit|erro|falha|inv[aá]lid)/iu,
    SATURATE: /\bsatur/iu,
    EXPLICIT_SENTINEL: /\b(?:sentinela|sentinel|valor\s+especial)\b/iu,
    WRAP: /\b(?:wrap|trunc|circular|m[oó]dulo)\b/iu,
  };
  if (boundaryRule.basis.some(({ source, reference }) => source === 'USER_DECISION'
    && patternByBehavior[behavior].test(humanResolutionEvidence.get(reference) ?? ''))) {
    return true;
  }
  return boundaryRule.basis.some(({ source, reference }) => source === 'USER_INTENT'
    && patternByBehavior[behavior].test(reference));
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
  assertSchema('aegis.semantic_draft.v4', draft);
  const requirementIds = assertUniqueIds(draft.requirements, 'id', 'requirement');
  const acceptanceCases = draft.requirements.flatMap(({ acceptanceCases: cases }) => cases);
  assertUniqueIds(acceptanceCases, 'id', 'acceptance_case');
  const acceptanceCasesById = new Map(acceptanceCases.map((item) => [item.id, item]));
  const acceptanceRequirementById = new Map(draft.requirements.flatMap((requirement) => (
    requirement.acceptanceCases.map((item) => [item.id, requirement.id])
  )));
  const invariantIds = assertUniqueIds(draft.invariants, 'id', 'invariant');
  const riskIds = assertUniqueIds(draft.risks, 'id', 'risk');
  const boundaryRuleIds = assertUniqueIds(draft.boundaryRules, 'id', 'boundary_rule');
  assertUniqueIds(draft.unknowns, 'id', 'unknown');
  const decisionIds = assertUniqueIds(draft.decisions, 'questionId', 'decision');
  const decisionsById = new Map(draft.decisions.map((decision) => [decision.questionId, decision]));
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
  const ruleApplications = new Map(policy.rules.map((rule) => [
    rule.id,
    ruleApplication(rule, architectureTags, intent),
  ]));
  const policySignals = mechanicalPolicySignals(policy, intent);
  const intentSignals = detectIntentSignals(intent);
  const intentSignalsById = new Map(intentSignals.map((signal) => [signal.id, signal]));
  const knownResolvedDecisions = new Set([
    ...resolvedDecisionIds,
    ...humanResolutions.map(({ questionId }) => questionId),
  ]);
  const humanResolutionEvidence = new Map(humanResolutions.map((resolution) => [
    resolution.questionId,
    resolution.kind === 'ANSWER' ? resolution.label : resolution.correction,
  ]));

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
      if (target.source === 'MODEL_PROPOSAL') {
        const decision = decisionsById.get(target.decisionId);
        if (target.reference !== 'analysis'
          || decision === undefined
          || !decision.requirementIds.includes(requirement.id)) {
          throw new Error(`model_quality_target_without_decision:${requirement.id}`);
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
  for (const requirement of draft.requirements.filter(({ kind }) => kind === 'QUALITY')) {
    const target = requirement.measurement.target;
    if (target.source === 'MODEL_PROPOSAL' && !materialDecisionIds.has(target.decisionId)) {
      throw new Error(`model_quality_target_without_material_unknown:${requirement.id}`);
    }
  }

  const requirementSignalOwners = new Map();
  for (const requirement of draft.requirements) {
    for (const signalId of requirement.intentSignalIds) {
      const signal = intentSignalsById.get(signalId);
      if (signal === undefined) throw new Error(`requirement_references_unknown_intent_signal:${signalId}`);
      const resolvedByHuman = requirement.basis.some(({ source, reference }) => (
        source === 'USER_DECISION' && knownResolvedDecisions.has(reference)
      ));
      if ((signal.kind === 'QUALITY_CONSTRAINT' && requirement.kind !== 'QUALITY')
        || signal.kind === 'BOUNDED_VALUE'
        || (signal.kind === 'INCOMPLETE_EXPRESSION' && !resolvedByHuman)) {
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

  const boundarySignalOwners = new Map();
  for (const boundaryRule of draft.boundaryRules) {
    assertRequirementReferences([boundaryRule], requirementIds, 'boundary_rule');
    if (boundaryRule.underflowBehavior === 'NOT_APPLICABLE'
      && boundaryRule.overflowBehavior === 'NOT_APPLICABLE') {
      throw new Error(`boundary_rule_without_behavior:${boundaryRule.id}`);
    }
    const linkedCases = boundaryRule.acceptanceCaseIds.map((caseId) => {
      const acceptanceCase = acceptanceCasesById.get(caseId);
      if (acceptanceCase === undefined) {
        throw new Error(`boundary_rule_references_unknown_case:${boundaryRule.id}:${caseId}`);
      }
      if (acceptanceCase.kind !== 'BOUNDARY'
        || !boundaryRule.requirementIds.includes(acceptanceRequirementById.get(caseId))) {
        throw new Error(`boundary_rule_references_non_boundary_case:${boundaryRule.id}:${caseId}`);
      }
      return acceptanceCase;
    });
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
    const missingHumanPolicy = [boundaryRule.underflowBehavior, boundaryRule.overflowBehavior]
      .some((behavior) => !boundaryBehaviorIsExplicit(
        boundaryRule,
        behavior,
        humanResolutionEvidence,
      ));
    if (missingHumanPolicy
      && (boundaryRule.decisionId === null
        || !decisionIds.has(boundaryRule.decisionId)
        || !linkedCases.some(({ decisionBinding }) => (
          decisionBinding?.questionId === boundaryRule.decisionId
        )))) {
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
  for (const signal of intentSignals) {
    const requirements = requirementSignalOwners.get(signal.id) ?? [];
    const unknowns = unknownSignalOwners.get(signal.id) ?? [];
    if (signal.kind === 'INCOMPLETE_EXPRESSION') {
      const unresolved = requirements.length === 0 && unknowns.length === 1;
      const resolved = requirements.length === 1 && unknowns.length === 0;
      if (!unresolved && !resolved) {
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
    if (requirements.length !== 1) {
      throw new Error(`quality_constraint_without_measurable_requirement:${signal.id}`);
    }
    const resolvedByHuman = requirements[0].basis.some(({ source, reference }) => (
      source === 'USER_DECISION' && knownResolvedDecisions.has(reference)
    ));
    const expectedUnknowns = signal.handling === 'MATERIAL_DECISION' && !resolvedByHuman ? 1 : 0;
    if (unknowns.length !== expectedUnknowns) {
      throw new Error(`quality_constraint_decision_mismatch:${signal.id}`);
    }
    const target = requirements[0].measurement.target;
    if (expectedUnknowns === 1
      && (target.source !== 'MODEL_PROPOSAL'
        || target.decisionId !== unknowns[0].decisionId)) {
      throw new Error(`vague_quality_target_claimed_as_fact:${signal.id}`);
    }
    if (signal.handling === 'MEASURABLE_REQUIREMENT'
      && target.source === 'MODEL_PROPOSAL') {
      throw new Error(`explicit_quality_target_replaced_by_model:${signal.id}`);
    }
  }

  for (const decision of draft.decisions) {
    if (!materialDecisionIds.has(decision.questionId)) {
      throw new Error(`decision_without_material_unknown:${decision.questionId}`);
    }
    assertUniqueIds(decision.answers, 'id', `answer_${decision.questionId}`);
    const recommended = decision.answers.filter(({ recommended }) => recommended);
    if (recommended.length !== 1 || recommended[0].id !== decision.recommendedAnswerId) {
      throw new Error(`invalid_recommendation:${decision.questionId}`);
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
    ...requirementIds,
    ...invariantIds,
    ...riskIds,
    ...decisionIds,
    ...boundaryRuleIds,
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
    || draft.policyAssessments.some(({ demandStatus }) => demandStatus === 'CONFLICT')
    || draft.complexityReview.status === 'SIMPLIFIED'
    || draft.risks.some(({ level }) => level === 'HIGH' || level === 'CRITICAL')
    || policySignals.some(({ requiresAdversarialReview }) => requiresAdversarialReview)
    || policy.rules.some((rule) => rule.requiresAdversarialReview
      && ruleApplications.get(rule.id)?.applies);
  if (materiallyContestable && draft.adversarialReview.findings.length === 0) {
    throw new Error('material_draft_without_adversarial_finding');
  }
  const adversarialRuleIds = new Set(draft.adversarialReview.findings
    .flatMap(({ basis }) => basis
      .filter(({ source }) => source === 'ARCHITECTURE_POLICY')
      .map(({ reference }) => reference)));
  const requiredAdversarialRuleIds = new Set([
    ...policySignals
      .filter(({ requiresAdversarialReview }) => requiresAdversarialReview)
      .map(({ ruleId }) => ruleId),
    ...policy.rules
      .filter((rule) => rule.requiresAdversarialReview
        && ruleApplications.get(rule.id)?.applies)
      .map(({ id }) => id),
  ]);
  for (const ruleId of requiredAdversarialRuleIds) {
    if (!adversarialRuleIds.has(ruleId)) {
      throw new Error(`adversarial_review_omits_policy_signal:${ruleId}`);
    }
  }
  for (const finding of draft.adversarialReview.findings) {
    for (const targetId of finding.targetIds) {
      if (!semanticTargetIds.has(targetId)) {
        throw new Error(`adversarial_finding_references_unknown_target:${targetId}`);
      }
    }
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

export function compileSemanticContract({
  repositoryRoot,
  draft,
  preflight,
  policy,
  policyDigest,
  constitution,
  constitutionDigest,
  humanResolutions = [],
}) {
  assertSemanticDraft(draft, policy, {
    constitutionRules: constitution?.rules,
    intent: preflight.intent,
    resolvedDecisionIds: humanResolutions.map(({ questionId }) => questionId),
    humanResolutions,
    workspaceEvidence: buildSourceEvidence(repositoryRoot, preflight),
  });
  const contract = {
    schema: 'aegis.issue_contract.v8',
    implementationAuthorized: false,
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
  assertSchema('aegis.issue_contract.v8', contract);
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
  assertSchema('aegis.issue_contract.v8', contract);
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
    schema: 'aegis.confirmation_request.v3',
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
  assertSchema('aegis.confirmation_request.v3', request);
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
  for (const answer of resolution.answers) {
    const revisedDecision = decisions.get(answer.questionId);
    if ('correction' in answer) {
      if (revisedDecision !== undefined) throw new Error(`unresolved_correction:${answer.questionId}`);
    } else if (revisedDecision !== undefined && revisedDecision.recommendedAnswerId !== answer.answerId) {
      throw new Error(`revision_ignored_selected_answer:${answer.questionId}`);
    }
  }
}

export function assertConfirmationRequest(contract, request) {
  assertSchema('aegis.confirmation_request.v3', request);
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
      ? specification.pathReferences.map(({ path, role, rationale }) => `- \`${path}\` — **${role}:** ${rationale}`)
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
        ...(requirement.measurement.target.decisionId === null
          ? []
          : [`  - Decisão necessária: ${requirement.measurement.target.decisionId}`]),
        `  - Condições: ${requirement.measurement.conditions}`,
      );
    }
    for (const acceptanceCase of requirement.acceptanceCases) {
      lines.push(
        `- **${acceptanceCase.id} — ${acceptanceCase.kind}**`,
        `  - Dado: ${acceptanceCase.given}`,
        `  - Quando: ${acceptanceCase.when}`,
        `  - Então: ${acceptanceCase.then}`,
      );
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
    lines.push(`- **${finding.id}:** ${finding.challenge}`);
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
  assertSchema('aegis.issue_contract.v8', finalContract);
  assertContractApprovalEvidence(finalContract, { required: true });
  return finalContract;
}
