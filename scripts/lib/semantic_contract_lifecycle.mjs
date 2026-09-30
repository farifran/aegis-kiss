import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';
import {
  assertContractApprovalEvidence,
  effectiveDeterminismStatus,
  assertRevisionApplied,
} from './semantic_approval.mjs';
import { applyPreparedAnswers } from './prepared_effects.mjs';
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
  assertSemanticDraft(draft, policy, validationContext);
  // Preview every prepared branch before exposing it to a human. This creates no consent.
  for (const decision of draft.decisions) {
    for (const answer of decision.answers) {
      if (answer.preparedEffect == null) continue;
      const choices = [{ questionId: decision.questionId, answerId: answer.id, contractEffect: answer.contractEffect }];
      const preview = applyPreparedAnswers(draft, choices, humanResolutions, effectiveSemanticRequest.intentEvidence);
      assertRevisionApplied(preview, { answers: choices }, draft);
      assertSemanticDraft(preview, policy, {
        ...validationContext,
        resolvedDecisionIds: [...validationContext.resolvedDecisionIds, decision.questionId],
      });
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
    policySignals: effectiveSemanticRequest.policy.signals,
    specification: draft,
    effectiveDeterminismStatus: effectiveDeterminismStatus(
      draft,
      humanResolutions,
      { intentEvidence: effectiveSemanticRequest.intentEvidence },
    ),
    humanResolutions,
    approval: null,
  };
  assertSchema('aegis.issue_contract.v14', contract);
  assertContractApprovalEvidence(contract);
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
  });
  if (contract.implementationAuthorized !== false) throw new Error('implementation_authorized');
  if (contract.sourcePreflightDigest !== preflight.preflightDigest) throw new Error('contract_preflight_mismatch');
  if (contract.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) throw new Error('contract_snapshot_mismatch');
  if (contract.policyDigest !== policyDigest) throw new Error('contract_policy_mismatch');
  if (contract.constitutionDigest !== constitutionDigest) throw new Error('contract_constitution_mismatch');
  if (contract.effectiveDeterminismStatus
    !== effectiveDeterminismStatus(
      contract.specification,
      contract.humanResolutions,
      { intentEvidence: contract.intentEvidence },
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
  if (canonicalDigest(contract.policySignals)
    !== canonicalDigest(semanticRequest.policy.signals)) {
    throw new Error('contract_policy_signals_mismatch');
  }
  assertContractApprovalEvidence(contract);
}
