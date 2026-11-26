import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';
import {
  assertContractApprovalEvidence,
  determinismStatusFromCertificate,
  effectiveDeterminismStatus,
  assertRevisionApplied,
} from './semantic_approval.mjs';
import {
  applyPreparedAnswers,
  assertPreparedEffectsDisjoint,
  cartesianProduct,
} from './prepared_effects.mjs';
import { assertSemanticDraft } from './semantic_draft_validator.mjs';
import { buildSemanticRequest } from './semantic_request.mjs';

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
  semanticRevision = null,
  semanticRequest = null,
  workspaceObservation = null,
}) {
  const effectiveSemanticRequest = semanticRequest ?? buildSemanticRequest({
    repositoryRoot,
    preflight,
    policy,
    constitution,
    revision: semanticRevision,
    workspaceObservation,
  });
  const validationContext = {
    constitutionRules: constitution?.rules,
    intent: preflight.intent,
    intentEvidence: effectiveSemanticRequest.intentEvidence,
    resolvedDecisionIds: humanResolutions.map(({ questionId }) => questionId),
    humanResolutions,
    workspaceEvidence: effectiveSemanticRequest.workspace.sourceEvidence,
  };
  const workspaceSkeleton = workspaceObservation?.workspaceSkeleton
    ?? preflight.discovery?.workspaceSkeleton
    ?? effectiveSemanticRequest.workspace?.workspaceSkeleton
    ?? null;
  const closureEvidence = {
    intent: preflight.intent,
    intentEvidence: effectiveSemanticRequest.intentEvidence,
    workspaceEvidence: effectiveSemanticRequest.workspace?.sourceEvidence ?? [],
    workspaceSkeleton,
  };
  assertSemanticDraft(draft, policy, validationContext);
  assertPreparedEffectsDisjoint(draft.decisions);
  const baselineStatus = effectiveDeterminismStatus(draft, humanResolutions, closureEvidence);
  const MAX_PREPARED_CARTESIAN_COMBINATIONS = 32;
  // Preview every prepared combination (bounded Cartesian product) reusing single-pass closureCertificate.
  const preparedBranchesPerDecision = draft.decisions
    .map((decision) => decision.answers
      .filter((answer) => answer.preparedEffect != null)
      .map((answer) => ({
        questionId: decision.questionId,
        answerId: answer.id,
        contractEffect: answer.contractEffect,
      })))
    .filter((branches) => branches.length > 0);
  if (preparedBranchesPerDecision.length > 0) {
    const combinationCount = preparedBranchesPerDecision.reduce((acc, list) => acc * list.length, 1);
    if (combinationCount > MAX_PREPARED_CARTESIAN_COMBINATIONS) {
      throw new Error(`prepared_effect_combinatorial_explosion:${combinationCount}:${MAX_PREPARED_CARTESIAN_COMBINATIONS}`);
    }
  }
  for (const choices of cartesianProduct(preparedBranchesPerDecision)) {
    try {
      const nextResolutions = [...humanResolutions, ...choices];
      const preview = applyPreparedAnswers(
        draft,
        choices,
        nextResolutions,
        effectiveSemanticRequest.intentEvidence,
        effectiveSemanticRequest.workspace?.sourceEvidence,
        workspaceSkeleton,
      );
      assertRevisionApplied(preview, { answers: choices }, draft);
      assertSemanticDraft(preview, policy, {
        ...validationContext,
        resolvedDecisionIds: [...validationContext.resolvedDecisionIds, ...choices.map((c) => c.questionId)],
        skipImmutableChecks: true,
      });
      const previewStatus = determinismStatusFromCertificate(preview.closureCertificate, preview);
      if (previewStatus === 'BLOCKED_BY_GAP' && baselineStatus !== 'BLOCKED_BY_GAP') {
        throw new Error('prepared_effect_blocked_by_gap');
      }
    } catch (error) {
      if (error instanceof Error) {
        const label = choices.map((c) => `${c.questionId}/${c.answerId}`).join(',');
        error.message = `${error.message}:preparedEffect(${label})`;
      }
      throw error;
    }
  }
  if (draft.sourceContextDigest !== effectiveSemanticRequest.contextDigest) {
    throw new Error('semantic_context_mismatch');
  }
  const contract = {
    schema: 'aegis.issue_contract.v14',
    implementationAuthorized: false,
    sourceSemanticRequestDigest: effectiveSemanticRequest.requestDigest,
    semanticRevision,
    sourcePreflightDigest: preflight.preflightDigest,
    sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
    policyDigest,
    constitutionDigest,
    intent: preflight.intent,
    observedPaths: observedPaths(preflight),
    intentEvidence: effectiveSemanticRequest.intentEvidence,
    specification: draft,
    effectiveDeterminismStatus: baselineStatus,
    humanResolutions,
    approval: null,
  };
  assertSchema('aegis.issue_contract.v14', contract);
  assertContractApprovalEvidence(contract, {
    intent: preflight.intent,
    workspaceEvidence: effectiveSemanticRequest.workspace?.sourceEvidence ?? [],
    workspaceSkeleton,
  });
  return contract;
}


export function assertContractDocument({
  repositoryRoot,
  contract,
  preflight,
  policy,
  policyDigest,
  constitution,
  constitutionDigest,
  workspaceObservation = null,
}) {
  assertSchema('aegis.issue_contract.v14', contract);
  const semanticRequest = buildSemanticRequest({
    repositoryRoot,
    preflight,
    policy,
    constitution,
    revision: contract.semanticRevision,
    workspaceObservation,
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
    intentEvidence: semanticRequest.intentEvidence,
    resolvedDecisionIds: contract.humanResolutions.map(({ questionId }) => questionId),
    humanResolutions: contract.humanResolutions,
    workspaceEvidence: semanticRequest.workspace.sourceEvidence,
    skipSchema: true,
  });
  if (contract.implementationAuthorized !== false) throw new Error('implementation_authorized');
  if (contract.sourcePreflightDigest !== preflight.preflightDigest) throw new Error('contract_preflight_mismatch');
  if (contract.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) throw new Error('contract_snapshot_mismatch');
  if (contract.policyDigest !== policyDigest) throw new Error('contract_policy_mismatch');
  if (contract.constitutionDigest !== constitutionDigest) throw new Error('contract_constitution_mismatch');
  const workspaceSkeleton = workspaceObservation?.workspaceSkeleton
    ?? preflight.discovery?.workspaceSkeleton
    ?? semanticRequest.workspace?.workspaceSkeleton
    ?? null;
  if (contract.effectiveDeterminismStatus
    !== effectiveDeterminismStatus(
      contract.specification,
      contract.humanResolutions,
      {
        intentEvidence: contract.intentEvidence,
        workspaceEvidence: semanticRequest.workspace?.sourceEvidence ?? [],
        workspaceSkeleton,
        semanticReviewAcknowledged: contract.approval?.attestation === 'CONTRACT_REVIEWED_AND_APPROVED',
      },
    )) {
    throw new Error('contract_effective_determinism_status_mismatch');
  }
  if (contract.intent !== preflight.intent) throw new Error('contract_intent_mismatch');
  if (canonicalDigest(contract.observedPaths) !== canonicalDigest(observedPaths(preflight))) {
    throw new Error('contract_observed_paths_mismatch');
  }
  if (canonicalDigest(contract.intentEvidence)
    !== canonicalDigest(semanticRequest.intentEvidence)) {
    throw new Error('contract_intent_evidence_mismatch');
  }
  assertContractApprovalEvidence(contract, {
    workspaceEvidence: semanticRequest.workspace?.sourceEvidence ?? [],
    workspaceSkeleton,
  });
}
