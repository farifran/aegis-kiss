import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';
import { assertUniqueIds } from './semantic_collections.mjs';

function effectiveDeterminismStatus(specification, humanResolutions) {
  if (specification.unknowns.some(({ material, decisionId }) => (
    material && decisionId === null
  ))) return 'BLOCKED_BY_GAP';
  if (specification.determinismReview.dimensions.some(({ status }) => status === 'GAP_FOUND')) {
    return 'BLOCKED_BY_GAP';
  }
  if (specification.determinismReview.dimensions.some(({ status }) => (
    status === 'DECISION_REQUIRED'
  )) || specification.decisions.length > 0) {
    return 'PENDING_HUMAN_DECISIONS';
  }
  const resolvedDecisionIds = new Set(humanResolutions.map(({ questionId }) => questionId));
  const pendingDecisionIds = specification.decisions
    .map(({ questionId }) => questionId)
    .filter((questionId) => !resolvedDecisionIds.has(questionId));
  if (pendingDecisionIds.length > 0) return 'PENDING_HUMAN_DECISIONS';
  return specification.determinismReview.status === 'NOT_APPLICABLE'
    ? 'NOT_APPLICABLE'
    : 'SEMANTICALLY_CLOSED';
}

function decisionMap(contract) {
  return new Map(contract.specification.decisions
    .map((decision) => [decision.questionId, decision]));
}

function appendUserDecisionBasis(basis, questionId) {
  if (basis.some(({ source, reference }) => (
    source === 'USER_DECISION' && reference === questionId
  ))) return basis;
  return [...basis, { source: 'USER_DECISION', reference: questionId }];
}

function materializeSpecification(specification, resolution) {
  const materialized = globalThis.structuredClone(specification);
  const decisions = new Map(materialized.decisions
    .map((decision) => [decision.questionId, decision]));
  const selections = new Map();
  for (const answer of resolution.answers) {
    if ('correction' in answer) throw new Error('semantic_recompilation_required');
    const decision = decisions.get(answer.questionId);
    const selected = decision?.answers.find(({ id }) => id === answer.answerId);
    if (selected?.closure.mode !== 'MATERIALIZE') {
      throw new Error('semantic_recompilation_required');
    }
    selections.set(answer.questionId, { decision, selected });
  }

  for (const requirement of materialized.requirements) {
    const originalCases = requirement.acceptanceCases;
    requirement.acceptanceCases = originalCases.flatMap((acceptanceCase) => {
      const questionId = acceptanceCase.decisionBinding?.questionId;
      if (questionId === undefined) return [acceptanceCase];
      const selection = selections.get(questionId);
      if (selection === undefined
        || !selection.selected.closure.acceptanceCaseIds.includes(acceptanceCase.id)) return [];
      return [{ ...acceptanceCase, decisionBinding: null }];
    });
    const decisionOwners = [...selections.entries()]
      .filter(([, { decision }]) => (
        decision.requirementIds.includes(requirement.id)
          || originalCases.some(({ decisionBinding }) => (
            decisionBinding?.questionId === decision.questionId
          ))
      ))
      .map(([questionId]) => questionId);
    for (const questionId of decisionOwners) {
      requirement.basis = appendUserDecisionBasis(requirement.basis, questionId);
    }
  }

  materialized.determinismReview.dimensions = materialized.determinismReview.dimensions
    .map((dimension) => {
      if (dimension.status !== 'DECISION_REQUIRED') return dimension;
      const questionId = dimension.targetIds.find((id) => selections.has(id));
      if (questionId === undefined) return dimension;
      const { selected } = selections.get(questionId);
      const closure = selected.closure.determinismResolutions.find((candidate) => (
        candidate.kind === dimension.kind && candidate.subjectId === dimension.subjectId
      ));
      if (closure === undefined) {
        throw new Error(`missing_materialized_determinism_resolution:${questionId}:${dimension.kind}:${dimension.subjectId}`);
      }
      return {
        ...dimension,
        status: 'SPECIFIED',
        rationale: closure.rationale,
        targetIds: dimension.targetIds.filter((id) => id !== questionId),
        basis: appendUserDecisionBasis(dimension.basis, questionId),
        closureAuthority: 'HUMAN_DECISION',
        proofObligation: closure.proofObligation,
        inapplicabilityProof: null,
        acceptanceCaseId: closure.acceptanceCaseId,
      };
    });
  materialized.determinismReview.status = materialized.determinismReview.dimensions.length === 0
    ? 'NOT_APPLICABLE'
    : materialized.determinismReview.dimensions.some(({ status }) => (
      status === 'DECISION_REQUIRED' || status === 'GAP_FOUND'
    )) ? 'GAPS_FOUND' : 'SEMANTICALLY_CLOSED';

  materialized.unknowns = materialized.unknowns
    .filter(({ decisionId }) => !selections.has(decisionId));
  materialized.adversarialReview.findings = materialized.adversarialReview.findings
    .map((finding) => ({
      ...finding,
      targetIds: [...new Set(finding.targetIds.flatMap((targetId) => (
        selections.has(targetId)
          ? selections.get(targetId).decision.requirementIds
          : [targetId]
      )))],
    }));
  materialized.decisions = materialized.decisions
    .filter(({ questionId }) => !selections.has(questionId));
  return materialized;
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
  if (contract.effectiveDeterminismStatus === 'BLOCKED_BY_GAP'
    || contract.effectiveDeterminismStatus === 'PENDING_HUMAN_DECISIONS') {
    throw new Error('approval_with_unresolved_semantics');
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
  const materializedResolutions = contract.humanResolutions.filter(({ sourceContractDigest }) => (
    sourceContractDigest === contract.approval.contractDraftDigest
  ));
  if (contract.approval.method === 'INTERACTIVE_WIZARD'
    && decisions.size === 0
    && materializedResolutions.length > 0) {
    if (materializedResolutions.some((resolution) => (
      resolution.kind !== 'ANSWER'
        || resolution.method !== contract.approval.method
        || resolution.attestation !== contract.approval.attestation
    ))) {
      throw new Error('materialized_human_resolution_evidence_mismatch');
    }
    if (contract.approval.executionId
      !== `draft-${contract.approval.contractDraftDigest.slice(0, 16)}`) {
      throw new Error('human_approval_draft_mismatch');
    }
    return;
  }
  const pendingIds = new Set(decisions.keys());
  const retainedResolutions = contract.humanResolutions
    .filter(({ questionId }) => !pendingIds.has(questionId));
  const draft = {
    ...contract,
    effectiveDeterminismStatus: effectiveDeterminismStatus(
      contract.specification,
      retainedResolutions,
    ),
    humanResolutions: retainedResolutions,
    approval: null,
  };
  const draftDigest = canonicalDigest(draft);
  if (contract.approval.contractDraftDigest !== draftDigest
    || contract.approval.executionId !== `draft-${draftDigest.slice(0, 16)}`) {
    throw new Error('human_approval_draft_mismatch');
  }
}


export function buildConfirmationRequest(contract) {
  if (contract.approval !== null) throw new Error('contract_already_approved');
  const unresolvedGaps = [
    ...contract.specification.determinismReview.dimensions
    .filter(({ status }) => status === 'GAP_FOUND')
      .map(({ kind, subjectId }) => `${kind}:${subjectId}`),
    ...contract.specification.unknowns
      .filter(({ material, decisionId }) => material && decisionId === null)
      .map(({ id }) => id),
  ];
  if (unresolvedGaps.length > 0) {
    throw new Error(`unresolved_semantic_gap:${unresolvedGaps.join(',')}`);
  }
  const contractDraftDigest = canonicalDigest(contract);
  const questions = contract.specification.decisions.map((decision) => {
    const gaps = contract.specification.unknowns
      .filter(({ decisionId }) => decisionId === decision.questionId)
      .map(({ statement }) => statement);
    return {
      id: decision.questionId,
      question: decision.question,
      presentation: decision.presentation,
      recommendedAnswerId: decision.recommendedAnswerId,
      gaps,
      distinguishingCase: decision.distinguishingCase,
      traceability: {
        requirements: contract.specification.requirements
          .filter(({ id }) => decision.requirementIds.includes(id))
          .map(({ id, statement }) => ({ id, statement })),
        acceptanceCases: contract.specification.requirements
          .flatMap(({ acceptanceCases }) => acceptanceCases)
          .filter(({ decisionBinding }) => decisionBinding?.questionId === decision.questionId)
          .map(({ id, given, when, then, outcomeKind }) => ({
            id, given, when, then, outcomeKind,
          })),
        invariants: contract.specification.invariants
          .filter(({ id }) => decision.invariantIds.includes(id))
          .map(({ id, statement, falsification }) => ({ id, statement, falsification })),
        risks: contract.specification.risks
          .filter(({ id }) => decision.riskIds.includes(id))
          .map(({ id, kind, level, statement, mitigation }) => ({
            id, kind, level, statement, mitigation,
          })),
      },
      answers: decision.answers.map((answer) => ({
        id: answer.id,
        label: answer.label,
        rationale: answer.rationale,
        contractEffect: answer.contractEffect,
        recommended: answer.recommended,
        requiresSemanticRevision: answer.closure.mode === 'REOPEN_PREFLIGHT',
      })),
    };
  });
  const request = {
    schema: 'aegis.confirmation_request.v5',
    status: 'USER_CONFIRMATION_REQUIRED',
    executionId: `draft-${contractDraftDigest.slice(0, 16)}`,
    contractDraftDigest,
    title: contract.specification.title,
    recommendationPolicy: 'RECOMMENDATIONS_ARE_NOT_HUMAN_DECISIONS',
    requiredAttestation: 'CONTRACT_REVIEWED_AND_APPROVED',
    questionCount: questions.length,
    bulkRecommendationAction: {
      id: 'ACCEPT_RECOMMENDED_REMAINING',
      label: 'Aceitar esta recomendação e todas as restantes',
      description: 'Preserva escolhas anteriores e seleciona a opção recomendada desta pergunta e de todas as perguntas seguintes.',
    },
    questions,
    artifactPath: '.harness/runtime/contract.md',
  };
  assertSchema('aegis.confirmation_request.v5', request);
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
      if (revisedDecision !== undefined) {
        throw new Error(`revision_retains_resolved_decision:${answer.questionId}`);
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
  assertSchema('aegis.confirmation_request.v5', request);
  if (canonicalDigest(request) !== canonicalDigest(buildConfirmationRequest(contract))) {
    throw new Error('stale_confirmation_request');
  }
}


export function resolutionRequiresSemanticRevision({ contract, request, resolution }) {
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
    if ('correction' in answer) continue;
    const selected = decision.answers.find(({ id }) => id === answer.answerId);
    if (selected === undefined) {
      throw new Error(`unknown_resolution_answer:${answer.questionId}`);
    }
    if (selected.closure.mode === 'REOPEN_PREFLIGHT') return true;
  }
  return resolution.answers.some((answer) => 'correction' in answer);
}

export function finalizeContractApproval({ contract, request, resolution }) {
  if (resolutionRequiresSemanticRevision({ contract, request, resolution })) {
    throw new Error('semantic_recompilation_required');
  }
  if (resolution.attestation !== 'CONTRACT_REVIEWED_AND_APPROVED') {
    throw new Error('contract_approval_attestation_required');
  }
  const humanResolutions = [
    ...contract.humanResolutions,
    ...buildHumanResolutionRecords(contract, resolution),
  ];
  const specification = materializeSpecification(contract.specification, resolution);
  const finalContract = {
    ...contract,
    specification,
    effectiveDeterminismStatus: effectiveDeterminismStatus(
      specification,
      humanResolutions,
    ),
    humanResolutions,
    approval: {
      method: resolution.method,
      attestation: resolution.attestation,
      executionId: resolution.executionId,
      contractDraftDigest: resolution.contractDraftDigest,
    },
  };
  if (finalContract.effectiveDeterminismStatus === 'PENDING_HUMAN_DECISIONS'
    || finalContract.effectiveDeterminismStatus === 'BLOCKED_BY_GAP') {
    throw new Error('contract_has_unresolved_determinism');
  }
  assertSchema('aegis.issue_contract.v14', finalContract);
  assertContractApprovalEvidence(finalContract, { required: true });
  return finalContract;
}

export { effectiveDeterminismStatus };
