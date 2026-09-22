import {
  assertUniqueIds,
} from './semantic_collections.mjs';
import {
  cryptographicSmallHashPattern,
  explicitInterfaceDefinitionPattern,
  feasibilityRiskPattern,
  hashRiskPattern,
  literalReferenceAppears,
  normalizedObservableText,
  publicInterfaceGapPattern,
  publicInterfaceIntentPattern,
} from './semantic_rules.mjs';

export function validateReviewsAndPolicy(context) {
  const {
    acceptanceCases,
    acceptanceCasesById,
    boundaryRuleIds,
    decisionIds,
    draft,
    humanResolutionEvidence,
    intent,
    intentClaimsByTarget,
    invariantIds,
    nonNormativeItemIds,
    pathReferenceIds,
    policy,
    policyAmendmentsById,
    policyRulesById,
    requirementIds,
    riskIds,
    ruleApplications,
  } = context;
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
  const provisionalDecisionByEffect = new Map(acceptanceCases
    .filter(({ decisionBinding }) => decisionBinding !== null)
    .map((acceptanceCase) => [
      normalizedObservableText(acceptanceCase.then),
      acceptanceCase.decisionBinding.questionId,
    ]));
  for (const finding of draft.adversarialReview.findings) {
    const pendingDecisionId = provisionalDecisionByEffect
      .get(normalizedObservableText(finding.response));
    if (pendingDecisionId !== undefined
      && (finding.disposition !== 'DECISION'
        || !finding.targetIds.includes(pendingDecisionId))) {
      throw new Error(`pending_decision_presented_as_resolved:${finding.id}:${pendingDecisionId}`);
    }
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
  for (const requirement of draft.requirements) {
    if (requirement.kind === 'QUALITY'
      && requirement.measurement?.target.evidenceStatus === 'UNVERIFIED') {
      const feasibilityCovered = draft.risks.some((risk) => (
        risk.requirementIds.includes(requirement.id)
        && (risk.kind === 'PERFORMANCE' || risk.kind === 'RELIABILITY')
        && feasibilityRiskPattern.test(`${risk.statement}\n${risk.mitigation}`)
      ));
      if (!feasibilityCovered) {
        throw new Error(`unverified_quality_without_feasibility_risk:${requirement.id}`);
      }
    }
    if (cryptographicSmallHashPattern.test(requirement.statement)) {
      const collisionCovered = draft.risks.some((risk) => (
        risk.requirementIds.includes(requirement.id)
        && (risk.kind === 'SECURITY' || risk.kind === 'INTEGRITY')
        && hashRiskPattern.test(`${risk.statement}\n${risk.mitigation}`)
      ));
      if (!collisionCovered) {
        throw new Error(`cryptographic_small_hash_without_collision_risk:${requirement.id}`);
      }
      const securityDecision = draft.decisions.find((decision) => (
        decision.requirementIds.includes(requirement.id)
        && decision.answers.some(({ contractEffect }) => (
          /\b(?:fingerprint|n[aã]o\s+criptogr[aá]fic\p{L}*|non[- ]?cryptographic)\b/iu
            .test(contractEffect)
        ))
        && decision.answers.some(({ contractEffect }) => (
          /\b(?:integridade\s+criptogr[aá]fic\p{L}*|garantia\s+criptogr[aá]fic\p{L}*|cryptographic\s+integrity|cryptographic\s+guarantee)\b/iu
            .test(contractEffect)
        ))
      ));
      if (securityDecision === undefined) {
        throw new Error(`cryptographic_small_hash_without_security_decision:${requirement.id}`);
      }
    }
  }
  const trustedInterfaceDefinition = [
    intent,
    ...humanResolutionEvidence.values(),
  ].join('\n');
  if (publicInterfaceIntentPattern.test(intent)
    && !explicitInterfaceDefinitionPattern.test(trustedInterfaceDefinition)
    && !draft.unknowns.some((unknown) => (
      unknown.material && publicInterfaceGapPattern.test(unknown.statement)
    ))) {
    throw new Error('public_interface_without_contract_or_blocking_gap');
  }
  if (policyRulesById.size !== policy.rules.length) throw new Error('duplicate_policy_rule_id');
  if (policyAmendmentsById.size !== (policy.amendments ?? []).length) {
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
    const rule = policyRulesById.get(assessment.ruleId);
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
        const amendment = policyAmendmentsById.get(assessment.amendmentId);
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
