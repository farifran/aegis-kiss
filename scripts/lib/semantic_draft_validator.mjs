import { assertSchema } from './schema_validator.mjs';
import { assertUniqueIds } from './semantic_collections.mjs';
import { detectIntentSignals } from './intent_signals.mjs';
import {
  counterexampleForDimension,
  literalReferenceAppears,
} from './semantic_authority.mjs';

const authoritativeSources = new Set([
  'USER_INTENT',
  'USER_DECISION',
  'CONSTITUTION',
  'ARCHITECTURE_POLICY',
  'SAFE_MECHANICAL_DEFAULT',
]);

function normalized(text) {
  return text.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim();
}

function assertKnownReferences(items, knownIds, label) {
  for (const item of items) {
    if (!knownIds.has(item)) throw new Error(`${label}_references_unknown_target:${item}`);
  }
}

function hasIncompleteMarker(text) {
  return /(?<![\p{L}\p{N}_$])\(\s*\)(?!\s*=>)|(?<!`)``(?!`)/u.test(text);
}

function workspaceReferenceAvailable(reference, workspaceEvidence) {
  const match = /^(src\/[^:]+):L([1-9]\d*)(?:-L([1-9]\d*))?$/u.exec(reference);
  if (match === null) return false;
  const start = Number.parseInt(match[2], 10);
  const end = Number.parseInt(match[3] ?? match[2], 10);
  return workspaceEvidence.some((evidence) => (
    evidence.path === match[1]
      && evidence.startLine <= start
      && evidence.endLine >= end
  ));
}

function validateBasis(basis, context, owner) {
  for (const item of basis) {
    if (item.source === 'USER_INTENT' && !context.intent.includes(item.reference)) {
      throw new Error(`invalid_user_intent_basis:${owner}:${item.reference}`);
    }
    if (item.source === 'USER_DECISION' && !context.resolvedDecisionIds.has(item.reference)) {
      throw new Error(`invalid_user_decision_basis:${owner}:${item.reference}`);
    }
    if (item.source === 'CONSTITUTION' && !context.constitutionRuleIds.has(item.reference)) {
      throw new Error(`basis_references_unknown_constitution_rule:${item.reference}`);
    }
    if ((item.source === 'ARCHITECTURE_POLICY'
      || item.source === 'SAFE_MECHANICAL_DEFAULT')
      && !context.policyReferenceIds.has(item.reference)) {
      throw new Error(`basis_references_unknown_policy:${item.reference}`);
    }
    if (item.source === 'WORKSPACE_EVIDENCE'
      && !workspaceReferenceAvailable(item.reference, context.workspaceEvidence)) {
      throw new Error(`basis_references_unavailable_workspace_evidence:${item.reference}`);
    }
    if (item.source === 'MODEL_ANALYSIS' && item.reference !== 'analysis') {
      throw new Error(`invalid_model_analysis_basis:${item.reference}`);
    }
  }
}

function validateClaims(draft, context) {
  const seenQuotes = new Set();
  const normativeText = [
    ...draft.requirements.flatMap((requirement) => [
      requirement.statement,
      ...requirement.acceptanceCases.map(({ then }) => then),
    ]),
    ...draft.boundaryRules.flatMap((rule) => [rule.subject, rule.lowerBound, rule.upperBound]),
  ].map((text) => text.normalize('NFC'));
  const allowedTargets = {
    NORMATIVE: /^(?:REQ|BOUND)-/u,
    DECISION: /^Q-/u,
    POLICY_CORRECTION: /^ARCH-/u,
    NON_NORMATIVE: /^(?:NOTE|PATH)-/u,
  };
  const allowedDispositions = {
    OBLIGATION: new Set(['NORMATIVE', 'POLICY_CORRECTION']),
    PROHIBITION: new Set(['NORMATIVE', 'POLICY_CORRECTION']),
    GOAL: new Set(['NON_NORMATIVE']),
    OPTION: new Set(['NON_NORMATIVE', 'POLICY_CORRECTION']),
    EXAMPLE: new Set(['NON_NORMATIVE', 'POLICY_CORRECTION']),
    AMBIGUITY: new Set(['DECISION']),
  };

  for (const claim of draft.intentClaims) {
    if (!context.intent.includes(claim.quote)) throw new Error(`intent_claim_not_literal:${claim.id}`);
    const quote = normalized(claim.quote);
    if (seenQuotes.has(quote)) throw new Error(`duplicate_intent_claim_quote:${claim.id}`);
    seenQuotes.add(quote);
    if (!allowedDispositions[claim.kind].has(claim.disposition)) {
      throw new Error(`invalid_intent_claim_disposition:${claim.id}`);
    }
    assertKnownReferences(claim.targetIds, context.claimTargetIds, `intent_claim:${claim.id}`);
    if (claim.targetIds.some((target) => !allowedTargets[claim.disposition].test(target))) {
      throw new Error(`intent_claim_targets_wrong_layer:${claim.id}`);
    }
    if (claim.disposition === 'NORMATIVE') {
      if (claim.contractEffect === null || hasIncompleteMarker(claim.contractEffect)) {
        throw new Error(`normative_claim_without_literal_effect:${claim.id}`);
      }
      if (!normativeText.includes(claim.contractEffect.normalize('NFC'))) {
        throw new Error(`normative_claim_not_materialized:${claim.id}`);
      }
    } else if (claim.contractEffect !== null) {
      throw new Error(`non_normative_claim_has_contract_effect:${claim.id}`);
    }
  }
}

function validateRequirements(draft, context) {
  const acceptanceCases = draft.requirements.flatMap((requirement) => requirement.acceptanceCases);
  assertUniqueIds(acceptanceCases, 'id', 'acceptance_case');
  const acceptanceIds = new Set(acceptanceCases.map(({ id }) => id));
  const outcomes = new Map();

  for (const requirement of draft.requirements) {
    validateBasis(requirement.basis, context, requirement.id);
    if (!requirement.basis.some(({ source }) => authoritativeSources.has(source))) {
      throw new Error(`requirement_without_authoritative_basis:${requirement.id}`);
    }
    assertKnownReferences(requirement.intentSignalIds, context.intentSignalIds, `requirement:${requirement.id}`);
    if (hasIncompleteMarker(requirement.statement)) {
      throw new Error(`unresolved_expression_in_normative_text:${requirement.id}`);
    }
    if (requirement.measurement !== null) {
      const { target } = requirement.measurement;
      if (target.source === 'USER_INTENT' && !context.intent.includes(target.reference)) {
        throw new Error(`quality_target_not_supported_by_intent:${requirement.id}`);
      }
      if (target.source === 'USER_DECISION'
        && !context.resolvedDecisionIds.has(target.reference)) {
        throw new Error(`quality_target_references_unknown_decision:${requirement.id}`);
      }
      if (target.source === 'WORKSPACE_EVIDENCE'
        && !workspaceReferenceAvailable(target.reference, context.workspaceEvidence)) {
        throw new Error(`quality_target_references_unavailable_evidence:${requirement.id}`);
      }
    }
    for (const acceptanceCase of requirement.acceptanceCases) {
      for (const [field, text] of Object.entries({
        given: acceptanceCase.given,
        when: acceptanceCase.when,
        then: acceptanceCase.then,
      })) {
        if (hasIncompleteMarker(text)) {
          throw new Error(`unresolved_expression_in_normative_text:${acceptanceCase.id}.${field}`);
        }
      }
      const branch = JSON.stringify({
        given: normalized(acceptanceCase.given),
        when: normalized(acceptanceCase.when),
        decisionBinding: acceptanceCase.decisionBinding,
      });
      const result = `${acceptanceCase.outcomeKind}:${normalized(acceptanceCase.then)}`;
      const previous = outcomes.get(branch);
      if (previous !== undefined && previous.result !== result) {
        throw new Error(`conflicting_observable_outcomes:${previous.id}:${acceptanceCase.id}`);
      }
      outcomes.set(branch, { id: acceptanceCase.id, result });
    }
  }

  const boundCases = new Set();
  for (const boundary of draft.boundaryRules) {
    validateBasis(boundary.basis, context, boundary.id);
    assertKnownReferences(boundary.requirementIds, context.requirementIds, `boundary:${boundary.id}`);
    assertKnownReferences(boundary.intentSignalIds, context.intentSignalIds, `boundary:${boundary.id}`);
    assertKnownReferences(boundary.acceptanceCaseIds, acceptanceIds, `boundary:${boundary.id}`);
    if (boundary.decisionId !== null && !context.decisionIds.has(boundary.decisionId)) {
      throw new Error(`boundary_rule_references_invalid_decision:${boundary.id}`);
    }
    for (const caseId of boundary.acceptanceCaseIds) {
      if (boundCases.has(caseId)) throw new Error(`boundary_case_reused:${caseId}`);
      boundCases.add(caseId);
      const acceptanceCase = acceptanceCases.find(({ id }) => id === caseId);
      if (acceptanceCase?.boundaryBinding?.ruleId !== boundary.id) {
        throw new Error(`boundary_rule_without_exact_case_binding:${boundary.id}:${caseId}`);
      }
    }
    if ((boundary.underflowBehavior === 'WRAP' || boundary.overflowBehavior === 'WRAP')
      && !boundary.basis.some(({ source }) => source === 'USER_INTENT' || source === 'USER_DECISION')) {
      throw new Error(`silent_wrap_forbidden:${boundary.id}`);
    }
  }
  for (const acceptanceCase of acceptanceCases) {
    if (acceptanceCase.decisionBinding !== null) {
      const decision = context.decisionsById.get(acceptanceCase.decisionBinding.questionId);
      if (decision === undefined
        || !decision.answers.some(({ id }) => id === acceptanceCase.decisionBinding.answerId)) {
        throw new Error(`acceptance_case_references_unknown_decision:${acceptanceCase.id}`);
      }
    }
    if (acceptanceCase.boundaryBinding !== null
      && !context.boundaryIds.has(acceptanceCase.boundaryBinding.ruleId)) {
      throw new Error(`acceptance_case_references_unknown_boundary:${acceptanceCase.id}`);
    }
  }
}

function validateDecisions(draft, context) {
  const ambiguityTargets = new Set(draft.intentClaims
    .filter(({ disposition }) => disposition === 'DECISION')
    .flatMap(({ targetIds }) => targetIds));
  const unknownTargets = new Set(draft.unknowns
    .filter(({ material }) => material)
    .map(({ decisionId }) => decisionId)
    .filter((id) => id !== null));
  const acceptanceCases = draft.requirements.flatMap((requirement) => requirement.acceptanceCases);

  for (const decision of draft.decisions) {
    if (!ambiguityTargets.has(decision.questionId) && !unknownTargets.has(decision.questionId)) {
      throw new Error(`decision_without_material_unknown:${decision.questionId}`);
    }
    assertUniqueIds(decision.answers, 'id', `answer_${decision.questionId}`);
    const recommended = decision.answers.filter(({ recommended }) => recommended);
    if (recommended.length !== 1 || recommended[0].id !== decision.recommendedAnswerId) {
      throw new Error(`invalid_recommendation:${decision.questionId}`);
    }
    if (new Set(decision.answers.map(({ contractEffect }) => normalized(contractEffect))).size
      !== decision.answers.length) {
      throw new Error(`decision_answers_without_distinct_effects:${decision.questionId}`);
    }
    const answerIds = new Set(decision.answers.map(({ id }) => id));
    const outcomeIds = decision.distinguishingCase.outcomes.map(({ answerId }) => answerId);
    if (outcomeIds.length !== answerIds.size
      || new Set(outcomeIds).size !== answerIds.size
      || outcomeIds.some((id) => !answerIds.has(id))) {
      throw new Error(`decision_distinguishing_case_incomplete:${decision.questionId}`);
    }
    if (new Set(decision.distinguishingCase.outcomes.map(({ then }) => normalized(then))).size
      !== decision.answers.length) {
      throw new Error(`decision_without_observable_distinguishing_case:${decision.questionId}`);
    }
    assertKnownReferences(decision.requirementIds, context.requirementIds, `decision:${decision.questionId}`);
    assertKnownReferences(decision.invariantIds, context.invariantIds, `decision:${decision.questionId}`);
    assertKnownReferences(decision.riskIds, context.riskIds, `decision:${decision.questionId}`);
    const proofCases = acceptanceCases.filter(({ decisionBinding }) => (
      decisionBinding?.questionId === decision.questionId
        && decisionBinding.answerId === decision.recommendedAnswerId
    ));
    if (!proofCases.some(({ then }) => (
      then.normalize('NFC') === recommended[0].contractEffect.normalize('NFC')
    ))) throw new Error(`decision_effect_not_proven:${decision.questionId}`);
  }
}

function validateDeterminism(draft, context) {
  const seen = new Set();
  for (const dimension of draft.determinismReview.dimensions) {
    const key = `${dimension.kind}:${dimension.subjectId}`;
    if (seen.has(key)) throw new Error(`duplicate_determinism_dimension_subject:${key}`);
    seen.add(key);
    const expectedWitness = counterexampleForDimension(dimension.kind);
    if (JSON.stringify(dimension.counterexampleWitness) !== JSON.stringify(expectedWitness)) {
      throw new Error(`determinism_dimension_witness_mismatch:${dimension.kind}`);
    }
    validateBasis(dimension.basis, context, key);
    assertKnownReferences(dimension.targetIds, context.semanticTargetIds, `determinism:${key}`);
    if (dimension.subjectId !== 'PUBLIC_CONTRACT'
      && !context.requirementIds.has(dimension.subjectId)
      && !context.boundaryIds.has(dimension.subjectId)) {
      throw new Error(`determinism_dimension_without_observable_subject:${key}`);
    }
    if (dimension.status === 'SPECIFIED') {
      if (dimension.closureAuthority === 'MODEL_ARGUMENT'
        || dimension.acceptanceCaseId === null
        || dimension.proofObligation === null
        || dimension.inapplicabilityProof !== null) {
        throw new Error(`specified_determinism_dimension_without_authority_or_proof:${key}`);
      }
      if (!context.acceptanceIds.has(dimension.acceptanceCaseId)) {
        throw new Error(`specified_determinism_dimension_without_exact_proof:${key}`);
      }
    } else if (dimension.status === 'NOT_APPLICABLE') {
      if (dimension.closureAuthority === 'MODEL_ARGUMENT'
        || dimension.inapplicabilityProof === null
        || dimension.acceptanceCaseId !== null
        || dimension.proofObligation !== null) {
        throw new Error(`inapplicable_determinism_dimension_without_authority:${key}`);
      }
    } else {
      if (dimension.closureAuthority !== 'MODEL_ARGUMENT'
        || dimension.acceptanceCaseId !== null
        || dimension.proofObligation !== null
        || dimension.inapplicabilityProof !== null) {
        throw new Error(`open_determinism_dimension_claims_closure:${key}`);
      }
      const decisionTargets = dimension.targetIds.filter((id) => id.startsWith('Q-'));
      if (dimension.status === 'DECISION_REQUIRED' && decisionTargets.length !== 1) {
        throw new Error(`determinism_gap_without_single_decision:${key}`);
      }
      if (dimension.status === 'GAP_FOUND' && decisionTargets.length !== 0) {
        throw new Error(`unresolved_determinism_gap_has_decision:${key}`);
      }
    }
  }
  const expectedStatus = draft.determinismReview.dimensions.length === 0
    ? 'NOT_APPLICABLE'
    : draft.determinismReview.dimensions.some(({ status }) => (
      status === 'DECISION_REQUIRED' || status === 'GAP_FOUND'
    )) ? 'GAPS_FOUND' : 'SEMANTICALLY_CLOSED';
  if (draft.determinismReview.status !== expectedStatus) {
    throw new Error('determinism_review_status_mismatch');
  }
}

function validateReviews(draft, context) {
  if ((draft.riskReview.status === 'FOUND') !== (draft.risks.length > 0)) {
    throw new Error('risk_review_status_mismatch');
  }
  if ((draft.adversarialReview.status === 'CHALLENGES_INTEGRATED')
    !== (draft.adversarialReview.findings.length > 0)) {
    throw new Error('adversarial_review_status_mismatch');
  }
  if (draft.complexityReview.status === 'SIMPLIFIED'
    && draft.complexityReview.alternatives.length === 0) {
    throw new Error('simplification_without_alternative');
  }
  if (draft.complexityReview.status === 'NO_EXCESS'
    && draft.complexityReview.alternatives.length > 0) {
    throw new Error('unexpected_complexity_alternative');
  }
  for (const risk of draft.risks) {
    validateBasis(risk.basis, context, risk.id);
    assertKnownReferences(risk.requirementIds, context.requirementIds, `risk:${risk.id}`);
  }
  for (const invariant of draft.invariants) {
    assertKnownReferences(invariant.requirementIds, context.requirementIds, `invariant:${invariant.id}`);
  }
  for (const finding of draft.adversarialReview.findings) {
    validateBasis(finding.basis, context, finding.id);
    assertKnownReferences(finding.targetIds, context.semanticTargetIds, `adversarial:${finding.id}`);
  }
  for (const item of [
    ...draft.nonNormativeItems,
    ...draft.pathReferences,
    ...draft.architectureContexts,
    ...draft.complexityReview.alternatives,
    ...draft.unknowns,
  ]) validateBasis(item.basis, context, item.id ?? item.tag ?? 'review_item');
  for (const item of draft.nonNormativeItems) {
    assertKnownReferences(item.intentSignalIds, context.intentSignalIds, `non_normative:${item.id}`);
  }
  for (const item of draft.pathReferences) {
    assertKnownReferences(item.requirementIds, context.requirementIds, `path:${item.id}`);
    if ((item.role === 'IMPLEMENTATION_SUGGESTION' || item.role === 'EVIDENCE_ONLY')
      && item.requirementIds.length > 0) {
      throw new Error(`non_normative_path_with_requirement:${item.id}`);
    }
  }
  for (const unknown of draft.unknowns) {
    assertKnownReferences(unknown.intentSignalIds, context.intentSignalIds, `unknown:${unknown.id}`);
    if (unknown.decisionId !== null && !context.decisionIds.has(unknown.decisionId)) {
      throw new Error(`unknown_references_missing_decision:${unknown.id}`);
    }
    if (!unknown.material && unknown.decisionId !== null) {
      throw new Error(`non_material_unknown_with_decision:${unknown.id}`);
    }
  }

  const applicableRuleIds = new Set(context.policy.rules
    .filter((rule) => {
      const byContext = rule.appliesMode === 'all'
        ? rule.appliesWhen.every((tag) => context.architectureTags.has(tag))
        : rule.appliesWhen.some((tag) => context.architectureTags.has(tag));
      const byText = [...rule.reviewReferences, ...rule.forbiddenReferences]
        .some((reference) => literalReferenceAppears(context.intent, reference));
      return byContext || byText;
    })
    .map(({ id }) => id));
  const assessedRuleIds = assertUniqueIds(draft.policyAssessments, 'ruleId', 'policy_assessment');
  if (assessedRuleIds.size !== applicableRuleIds.size
    || [...applicableRuleIds].some((id) => !assessedRuleIds.has(id))) {
    throw new Error('incomplete_policy_assessment');
  }
  for (const assessment of draft.policyAssessments) {
    if (!applicableRuleIds.has(assessment.ruleId)) {
      throw new Error(`unexpected_policy_assessment:${assessment.ruleId}`);
    }
    if (assessment.decisionId !== null && !context.decisionIds.has(assessment.decisionId)) {
      throw new Error(`policy_conflict_references_missing_decision:${assessment.ruleId}`);
    }
    if (assessment.amendmentId !== null && !context.policyAmendmentIds.has(assessment.amendmentId)) {
      throw new Error(`unexpected_policy_amendment:${assessment.ruleId}`);
    }
    const rule = context.policyRulesById.get(assessment.ruleId);
    if (rule.level === 'hard'
      && (assessment.recommendedStatus !== 'COMPLIANT'
        || assessment.decisionId !== null
        || assessment.amendmentId !== null)) {
      throw new Error(`non_deliberable_policy_conflict:${assessment.ruleId}`);
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
  assertSchema('aegis.semantic_draft.v8', draft);
  const requirementIds = assertUniqueIds(draft.requirements, 'id', 'requirement');
  const invariantIds = assertUniqueIds(draft.invariants, 'id', 'invariant');
  const riskIds = assertUniqueIds(draft.risks, 'id', 'risk');
  const boundaryIds = assertUniqueIds(draft.boundaryRules, 'id', 'boundary_rule');
  const decisionIds = assertUniqueIds(draft.decisions, 'questionId', 'decision');
  const noteIds = assertUniqueIds(draft.nonNormativeItems, 'id', 'non_normative_item');
  const pathIds = assertUniqueIds(draft.pathReferences, 'id', 'path_reference');
  assertUniqueIds(draft.intentClaims, 'id', 'intent_claim');
  assertUniqueIds(draft.unknowns, 'id', 'unknown');
  assertUniqueIds(draft.adversarialReview.findings, 'id', 'adversarial_finding');
  const architectureTags = assertUniqueIds(draft.architectureContexts, 'tag', 'architecture_context');
  const acceptanceIds = new Set(draft.requirements
    .flatMap(({ acceptanceCases }) => acceptanceCases.map(({ id }) => id)));
  const knownResolved = new Set([
    ...resolvedDecisionIds,
    ...humanResolutions.map(({ questionId }) => questionId),
  ]);
  const policyRulesById = new Map(policy.rules.map((rule) => [rule.id, rule]));
  const policyAmendmentIds = new Set((policy.amendments ?? []).map(({ id }) => id));
  const knownPolicyTags = assertUniqueIds(policy.contexts, 'tag', 'policy_context');
  assertUniqueIds(policy.rules, 'id', 'policy_rule');
  assertUniqueIds(policy.amendments ?? [], 'id', 'policy_amendment');
  for (const tag of architectureTags) {
    if (!knownPolicyTags.has(tag)) throw new Error(`unknown_architecture_context:${tag}`);
  }
  for (const rule of policy.rules) {
    assertKnownReferences(rule.appliesWhen, knownPolicyTags, `policy_rule:${rule.id}`);
  }
  const intentSignalIds = new Set(detectIntentSignals(intent).map(({ id }) => id));
  const context = {
    policy,
    intent,
    workspaceEvidence,
    requirementIds,
    invariantIds,
    riskIds,
    boundaryIds,
    decisionIds,
    acceptanceIds,
    architectureTags,
    decisionsById: new Map(draft.decisions.map((decision) => [decision.questionId, decision])),
    intentSignalIds,
    resolvedDecisionIds: knownResolved,
    constitutionRuleIds: new Set(constitutionRules.map(({ id }) => id)),
    policyReferenceIds: new Set([...policyRulesById.keys(), ...policyAmendmentIds]),
    policyRulesById,
    policyAmendmentIds,
    claimTargetIds: new Set([
      ...requirementIds,
      ...boundaryIds,
      ...decisionIds,
      ...noteIds,
      ...pathIds,
      ...policyRulesById.keys(),
      ...knownResolved,
    ]),
    semanticTargetIds: new Set([
      ...requirementIds,
      ...invariantIds,
      ...riskIds,
      ...boundaryIds,
      ...decisionIds,
      ...noteIds,
      ...pathIds,
      ...policyRulesById.keys(),
    ]),
  };

  validateClaims(draft, context);
  validateRequirements(draft, context);
  validateDecisions(draft, context);
  validateDeterminism(draft, context);
  validateReviews(draft, context);
}
