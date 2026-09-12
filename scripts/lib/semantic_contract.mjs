import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { assertSchema, schemaDocument } from './schema_validator.mjs';

const sourceEvidenceByteLimit = 32_768;
const sourceEvidenceFileByteLimit = 8_192;

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
      workspace: 'UNTRUSTED_EVIDENCE',
      revision: 'USER_DECISION',
      outputSchema: 'STRICT_STRUCTURED_OUTPUT',
    },
    constitution,
    intent: preflight.intent,
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
      rules: policy.rules.map((rule) => ({
        id: rule.id,
        level: rule.level,
        statement: rule.statement,
        appliesWhen: rule.appliesWhen,
        appliesMode: rule.appliesMode,
        forbiddenReferences: rule.forbiddenReferences ?? [],
      })),
      amendments: (policy.amendments ?? []).map(({ id, ruleId, reason }) => ({
        id,
        ruleId,
        reason,
      })),
    },
    revision,
  };
  const contextDigest = canonicalDigest(context);
  const outputSchemaDocument = schemaDocument('aegis.semantic_draft.v1');
  outputSchemaDocument.properties.sourceContextDigest = { const: contextDigest };
  const request = {
    schema: 'aegis.semantic_request.v1',
    contextDigest,
    ...context,
    outputSchema: {
      id: 'aegis.semantic_draft.v1',
      digest: canonicalDigest(outputSchemaDocument),
      strict: true,
      document: outputSchemaDocument,
    },
  };
  assertSchema('aegis.semantic_request.v1', request);
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

export function assertSemanticDraft(draft, policy) {
  assertSchema('aegis.semantic_draft.v1', draft);
  const requirementIds = assertUniqueIds(draft.requirements, 'id', 'requirement');
  const acceptanceCases = draft.requirements.flatMap(({ acceptanceCases: cases }) => cases);
  assertUniqueIds(acceptanceCases, 'id', 'acceptance_case');
  const invariantIds = assertUniqueIds(draft.invariants, 'id', 'invariant');
  const riskIds = assertUniqueIds(draft.risks, 'id', 'risk');
  assertUniqueIds(draft.unknowns, 'id', 'unknown');
  const decisionIds = assertUniqueIds(draft.decisions, 'questionId', 'decision');
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

  for (const requirement of draft.requirements) {
    const kinds = new Set(requirement.acceptanceCases.map(({ kind }) => kind));
    if (!kinds.has('HAPPY_PATH') || (!kinds.has('FAILURE') && !kinds.has('BOUNDARY'))) {
      throw new Error(`requirement_without_dual_acceptance:${requirement.id}`);
    }
  }

  assertRequirementReferences(draft.invariants, requirementIds, 'invariant');
  assertRequirementReferences(draft.risks, requirementIds, 'risk');

  for (const unknown of draft.unknowns) {
    if (unknown.material && unknown.decisionId === null) {
      throw new Error(`material_unknown_without_decision:${unknown.id}`);
    }
    if (unknown.decisionId !== null && !decisionIds.has(unknown.decisionId)) {
      throw new Error(`unknown_references_missing_decision:${unknown.id}`);
    }
  }

  for (const decision of draft.decisions) {
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
    if (decision.requirementIds.length + decision.invariantIds.length + decision.riskIds.length === 0) {
      throw new Error(`decision_without_observable_impact:${decision.questionId}`);
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
  const expectedRiskKinds = new Set([
    'SECURITY', 'RELIABILITY', 'PRIVACY', 'PERFORMANCE', 'INTEGRITY', 'COMPLEXITY',
  ]);
  if (draft.riskReview.consideredKinds.length !== expectedRiskKinds.size
    || draft.riskReview.consideredKinds.some((kind) => !expectedRiskKinds.has(kind))) {
    throw new Error('incomplete_risk_review');
  }

  const rulesById = new Map(policy.rules.map((rule) => [rule.id, rule]));
  const amendmentsById = new Map((policy.amendments ?? []).map((item) => [item.id, item]));
  if (rulesById.size !== policy.rules.length) throw new Error('duplicate_policy_rule_id');
  if (amendmentsById.size !== (policy.amendments ?? []).length) {
    throw new Error('duplicate_policy_amendment_id');
  }
  const assessedRuleIds = assertUniqueIds(draft.policyAssessments, 'ruleId', 'policy_assessment');
  if (assessedRuleIds.size !== rulesById.size
    || [...rulesById.keys()].some((ruleId) => !assessedRuleIds.has(ruleId))) {
    throw new Error('incomplete_policy_assessment');
  }
  for (const assessment of draft.policyAssessments) {
    const rule = rulesById.get(assessment.ruleId);
    if (rule === undefined) throw new Error(`unknown_policy_rule:${assessment.ruleId}`);
    const applicable = rule.appliesMode === 'all'
      ? rule.appliesWhen.every((tag) => architectureTags.has(tag))
      : rule.appliesWhen.some((tag) => architectureTags.has(tag));
    if (!applicable) {
      if (assessment.demandStatus !== 'NOT_APPLICABLE'
        || assessment.recommendedStatus !== 'NOT_APPLICABLE'
        || assessment.decisionId !== null
        || assessment.amendmentId !== null) {
        throw new Error(`invalid_non_applicable_assessment:${assessment.ruleId}`);
      }
    } else if (assessment.demandStatus === 'NOT_APPLICABLE'
      || assessment.recommendedStatus === 'NOT_APPLICABLE') {
      throw new Error(`applicable_rule_marked_not_applicable:${assessment.ruleId}`);
    } else if (assessment.demandStatus === 'CONFLICT') {
      if (assessment.decisionId === null || !decisionIds.has(assessment.decisionId)) {
        throw new Error(`policy_conflict_without_decision:${assessment.ruleId}`);
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
  draft,
  preflight,
  policy,
  policyDigest,
  constitutionDigest,
  humanResolutions = [],
}) {
  assertSemanticDraft(draft, policy);
  const contract = {
    schema: 'aegis.issue_contract.v3',
    implementationAuthorized: false,
    sourcePreflightDigest: preflight.preflightDigest,
    sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
    policyDigest,
    constitutionDigest,
    intent: preflight.intent,
    observedPaths: observedPaths(preflight),
    specification: draft,
    decisionSelections: draft.decisions.map((decision) => ({
      questionId: decision.questionId,
      answerId: decision.recommendedAnswerId,
    })),
    humanResolutions,
  };
  assertSchema('aegis.issue_contract.v3', contract);
  return contract;
}

export function assertContractDocument({
  contract,
  preflight,
  policy,
  policyDigest,
  constitutionDigest,
}) {
  assertSchema('aegis.issue_contract.v3', contract);
  assertSemanticDraft(contract.specification, policy);
  if (contract.implementationAuthorized !== false) throw new Error('implementation_authorized');
  if (contract.sourcePreflightDigest !== preflight.preflightDigest) throw new Error('contract_preflight_mismatch');
  if (contract.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) throw new Error('contract_snapshot_mismatch');
  if (contract.policyDigest !== policyDigest) throw new Error('contract_policy_mismatch');
  if (contract.constitutionDigest !== constitutionDigest) throw new Error('contract_constitution_mismatch');
  if (contract.intent !== preflight.intent) throw new Error('contract_intent_mismatch');
  if (canonicalDigest(contract.observedPaths) !== canonicalDigest(observedPaths(preflight))) {
    throw new Error('contract_observed_paths_mismatch');
  }
  const expectedSelections = contract.specification.decisions.map((decision) => ({
    questionId: decision.questionId,
    answerId: decision.recommendedAnswerId,
  }));
  if (canonicalDigest(contract.decisionSelections) !== canonicalDigest(expectedSelections)) {
    throw new Error('contract_decision_selection_mismatch');
  }
}

export function buildConfirmationRequest(contract) {
  const contractDraftDigest = canonicalDigest(contract);
  const request = {
    schema: 'aegis.confirmation_request.v1',
    status: 'USER_CONFIRMATION_REQUIRED',
    executionId: `draft-${contractDraftDigest.slice(0, 16)}`,
    contractDraftDigest,
    title: contract.specification.title,
    questions: contract.specification.decisions.map((decision) => ({
      id: decision.questionId,
      question: decision.question,
      recommendedAnswerId: decision.recommendedAnswerId,
      answers: decision.answers,
    })),
    artifactPath: '.harness/runtime/contract.md',
  };
  assertSchema('aegis.confirmation_request.v1', request);
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
  if (!draft.requirements.some(({ provenance }) => provenance === 'USER_CLARIFICATION')) {
    throw new Error('revision_without_user_clarification_provenance');
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
  assertSchema('aegis.confirmation_request.v1', request);
  if (canonicalDigest(request) !== canonicalDigest(buildConfirmationRequest(contract))) {
    throw new Error('stale_confirmation_request');
  }
}

export function renderSemanticContractMarkdown(contract, {
  governed = false,
  contractDigest = '',
  policyRules = [],
} = {}) {
  const specification = contract.specification;
  const rules = new Map(policyRules.map((rule) => [rule.id, rule.statement]));
  const selections = new Map(contract.decisionSelections
    .map(({ questionId, answerId }) => [questionId, answerId]));
  const lines = [
    `# Issue / Contrato: ${specification.title}`,
    '',
    `> **Status:** ${governed ? 'Selado & Governado' : 'Rascunho aguardando confirmação'}`,
    `> **Modo:** ${specification.changeKind}`,
    '> **IMPLEMENTATION_AUTHORIZED:** `false`',
    ...(governed ? [`> **Digest do Contrato:** \`${contractDigest}\``] : []),
    `> **Preflight:** \`${contract.sourcePreflightDigest}\``,
    `> **Snapshot de src/:** \`${contract.sourceSnapshotDigest}\``,
    '',
    '## 1. Intenção',
    contract.intent,
    '',
    '**Interpretação proposta:**',
    specification.interpretation,
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
    '## 3. Política arquitetural',
  ];

  const applicableAssessments = specification.policyAssessments
    .filter(({ demandStatus }) => demandStatus !== 'NOT_APPLICABLE');
  const omittedAssessments = specification.policyAssessments.length - applicableAssessments.length;
  lines.push(`- **Contextos detectados:** ${specification.architectureContexts.map(({ tag }) => tag).join(', ')}`);
  for (const assessment of applicableAssessments) {
    lines.push(`- **${assessment.ruleId} — demanda ${assessment.demandStatus} → recomendação ${assessment.recommendedStatus}:** ${assessment.rationale}`);
    const statement = rules.get(assessment.ruleId);
    if (statement) lines.push(`  - Regra: ${statement}`);
    if (assessment.decisionId) lines.push(`  - Decisão: \`${assessment.decisionId}\``);
    if (assessment.amendmentId) lines.push(`  - Emenda: \`${assessment.amendmentId}\``);
  }
  if (omittedAssessments > 0) lines.push(`- ${omittedAssessments} regra(s) não aplicável(is) omitida(s) desta visão.`);

  lines.push('', '## 4. Revisão de complexidade');
  lines.push(`- **${specification.complexityReview.status}:** ${specification.complexityReview.rationale}`);
  for (const alternative of specification.complexityReview.alternatives) {
    lines.push(`- **${alternative.requested} → ${alternative.simpler}:** ${alternative.rationale}`);
  }

  lines.push('', '## 5. Requisitos e casos falsificáveis');
  for (const requirement of specification.requirements) {
    lines.push('', `### ${requirement.id}`, requirement.statement, `*Proveniência: ${requirement.provenance}*`, '');
    for (const acceptanceCase of requirement.acceptanceCases) {
      lines.push(
        `- **${acceptanceCase.id} — ${acceptanceCase.kind}**`,
        `  - Dado: ${acceptanceCase.given}`,
        `  - Quando: ${acceptanceCase.when}`,
        `  - Então: ${acceptanceCase.then}`,
      );
    }
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
  }

  lines.push('', '## 8. Lacunas declaradas');
  if (specification.unknowns.length === 0) lines.push('- Nenhuma lacuna material não resolvida.');
  for (const unknown of specification.unknowns) {
    lines.push(`- **${unknown.id}${unknown.material ? ' — MATERIAL' : ''}:** ${unknown.statement}`);
  }

  lines.push('', governed ? '## 9. Decisões seladas' : '## 9. Decisões pendentes');
  if (specification.decisions.length === 0) {
    lines.push('Nenhuma ambiguidade material detectada.');
  } else {
    for (const decision of specification.decisions) {
      lines.push('', `### ${decision.questionId}: ${decision.question}`);
      for (const answer of decision.answers) {
        const mark = selections.get(decision.questionId) === answer.id ? '(*)' : '( )';
        const recommended = answer.recommended ? ' **[RECOMENDADO]**' : '';
        lines.push(`${mark} **${answer.label}**${recommended}: ${answer.rationale}`);
      }
      lines.push(`Impacta requisitos: ${decision.requirementIds.join(', ') || 'nenhum'}; invariantes: ${decision.invariantIds.join(', ') || 'nenhum'}; riscos: ${decision.riskIds.join(', ') || 'nenhum'}.`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function resolutionRequiresRecompilation({ contract, request, resolution }) {
  assertConfirmationRequest(contract, request);
  assertSchema('aegis.semantic_resolution.v1', resolution);
  if (request.executionId !== resolution.executionId
    || request.contractDraftDigest !== resolution.contractDraftDigest
    || request.contractDraftDigest !== canonicalDigest(contract)) {
    throw new Error('stale_semantic_resolution');
  }
  const decisions = new Map(contract.specification.decisions
    .map((decision) => [decision.questionId, decision]));
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
