import {
  assertUniqueIds,
} from './semantic_collections.mjs';
import {
  assertNoUnprovenInternalMechanism,
  assertNoUnprovenTechnicalPrescription,
  assertRequirementReferences,
  basisCitesIntentSignal,
  basisClaims,
  boundaryBehaviorIsExplicit,
  boundedSignalRequiresEncodedValue,
  canonicalIntegerThreshold,
  conservationInvariantPattern,
  explicitUncertaintyPattern,
  hasDisjunctiveOutcome,
  hashRiskPattern,
  hashSecurityDecisionPattern,
  hasMatureAlternativesForIncompleteOperand,
  hasUnresolvedExpression,
  injectiveInvariantPattern,
  literalReferenceAppears,
  normalizedObservableText,
  numericTokens,
  requestedBehaviorRemovalPattern,
  retainedResidualPattern,
  ruleApplication,
  textStatesBoundaryBehavior,
  thresholdRiskPattern,
  workspaceBasisRange,
} from './semantic_rules.mjs';

export function validateRequirementsAndBoundaries(context) {
  const {
    acceptanceCases,
    acceptanceCasesById,
    acceptanceRequirementById,
    boundaryRuleIds,
    decisionIds,
    decisionsById,
    draft,
    humanResolutionEvidence,
    intent,
    intentClaimsByTarget,
    intentSignals,
    intentSignalsById,
    nonNormativeSignalOwners,
    requirementIds,
    requirementSignalOwners,
    unknownSignalOwners,
  } = context;
  const boundarySignalOwners = new Map();
  const boundaryCaseOwners = new Map();
  for (const boundaryRule of draft.boundaryRules) {
    if (boundaryRule.representationKind === undefined) {
      throw new Error(`boundary_rule_without_representation_kind:${boundaryRule.id}`);
    }
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
    if (boundaryRule.representationKind === 'REPRESENTATION_WIDTH') {
      if (boundaryRule.underflowBehavior !== 'NOT_APPLICABLE'
        || boundaryRule.overflowBehavior !== 'NOT_APPLICABLE'
        || linkedCases.some(({ boundaryBinding }) => boundaryBinding.side !== 'EXACT_WIDTH')) {
        throw new Error(`representation_width_mixed_with_value_range:${boundaryRule.id}`);
      }
      if (linkedCases.some(({ given }) => (
        /\b(?:maior\s+valor\s+represent[aá]vel|uma\s+unidade\s+acima|maximum\s+representable\s+value|one\s+unit\s+above)\b/iu
          .test(given)
      ))) {
        throw new Error(`representation_width_uses_value_range_witness:${boundaryRule.id}`);
      }
    }
    if (boundaryRule.representationKind === 'ENCODED_VALUE') {
      if (boundaryRule.underflowBehavior === 'NOT_APPLICABLE'
        || boundaryRule.overflowBehavior === 'NOT_APPLICABLE') {
        throw new Error(`encoded_value_without_both_range_policies:${boundaryRule.id}`);
      }
      if (/\bbits?\s+\d+\s*[–—-]\s*\d+\b/iu.test(boundaryRule.lowerBound)
        || /\bbits?\s+\d+\s*[–—-]\s*\d+\b/iu.test(boundaryRule.upperBound)) {
        throw new Error(`encoded_value_uses_bit_position_as_value_range:${boundaryRule.id}`);
      }
    }
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
        && (unknowns[0].decisionId === null
          || signal.handling === 'MATERIAL_DECISION'
          || (intentClaimsByTarget.get(unknowns[0].decisionId) ?? [])
            .some(({ quote }) => explicitUncertaintyPattern.test(quote)));
      if (!resolved && !unresolved) {
        throw new Error(`incomplete_expression_not_deliberated:${signal.id}`);
      }
      continue;
    }
    if (signal.kind === 'BOUNDED_VALUE') {
      const boundaryRules = boundarySignalOwners.get(signal.id) ?? [];
      const widthRules = boundaryRules
        .filter(({ representationKind }) => representationKind === 'REPRESENTATION_WIDTH');
      const encodedRules = boundaryRules
        .filter(({ representationKind }) => representationKind === 'ENCODED_VALUE');
      if (boundedSignalRequiresEncodedValue(intent, signal)) {
        if (widthRules.length !== 1 || encodedRules.length !== 1 || boundaryRules.length !== 2) {
          throw new Error(`bounded_quantity_without_width_and_value_rules:${signal.id}`);
        }
      } else if (boundaryRules.length !== 1) {
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
      const normativeText = [
        ...draft.requirements.flatMap((requirement) => [
          requirement.statement,
          ...requirement.acceptanceCases.map(({ then }) => then),
        ]),
        ...draft.invariants.flatMap(({ statement, falsification }) => [statement, falsification]),
        ...draft.boundaryRules.flatMap(({ subject, lowerBound, upperBound }) => [
          subject,
          lowerBound,
          upperBound,
        ]),
      ].join('\n');
      if (literalReferenceAppears(normativeText, signal.reference)) {
        throw new Error(`non_normative_example_promoted_to_contract:${signal.id}`);
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
}

export function validateDecisionsAndEvidence(context) {
  const {
    acceptanceCases,
    acceptanceRequirementById,
    architectureTags,
    constitutionRules,
    decisionsById,
    draft,
    humanResolutionEvidence,
    intent,
    intentClaimsByTarget,
    invariantIds,
    knownResolvedDecisions,
    materialDecisionIds,
    policy,
    policyRulesById,
    requirementIds,
    requirementsById,
    riskIds,
    risksById,
    workspaceEvidence,
  } = context;
  for (const decision of draft.decisions) {
    if (!materialDecisionIds.has(decision.questionId)) {
      throw new Error(`decision_without_material_unknown:${decision.questionId}`);
    }
    const decisionUnknowns = draft.unknowns.filter(({ decisionId }) => (
      decisionId === decision.questionId
    ));
    if (decisionUnknowns.some((unknown) => (
      !hasMatureAlternativesForIncompleteOperand(unknown, intent, decision)
    ))) {
      throw new Error(`incomplete_operand_requires_gap:${decision.questionId}`);
    }
    const ambiguityClaims = intentClaimsByTarget.get(decision.questionId) ?? [];
    if (ambiguityClaims.some(({ quote }) => (
      /\(\s*\)|``/u.test(quote)
      && !explicitUncertaintyPattern.test(quote)
    ))) {
      throw new Error(`decision_based_only_on_placeholder:${decision.questionId}`);
    }
    const protectsExplicitUserBehavior = decision.requirementIds.some((requirementId) => (
      (intentClaimsByTarget.get(requirementId) ?? []).some(({ kind, disposition }) => (
        disposition === 'NORMATIVE' && (kind === 'OBLIGATION' || kind === 'PROHIBITION')
      ))
    ));
    assertUniqueIds(decision.answers, 'id', `answer_${decision.questionId}`);
    const recommended = decision.answers.filter(({ recommended }) => recommended);
    if (recommended.length !== 1 || recommended[0].id !== decision.recommendedAnswerId) {
      throw new Error(`invalid_recommendation:${decision.questionId}`);
    }
    const authorizedDecisionFragments = [
      ...draft.unknowns
        .filter(({ decisionId }) => decisionId === decision.questionId)
        .flatMap(({ basis }) => basis
          .filter(({ source }) => source === 'USER_INTENT' || source === 'USER_DECISION')
          .map(({ reference }) => reference)),
      ...draft.boundaryRules
        .filter(({ decisionId }) => decisionId === decision.questionId)
        .flatMap(({ lowerBound, upperBound }) => [lowerBound, upperBound]),
    ];
    const authorizedDecisionText = authorizedDecisionFragments.join('\n');
    const authorizedNumbers = new Set(numericTokens(authorizedDecisionText));
    for (const answer of decision.answers) {
      if (protectsExplicitUserBehavior
        && requestedBehaviorRemovalPattern.test(answer.contractEffect)) {
        throw new Error(`decision_answer_negates_user_intent:${decision.questionId}:${answer.id}`);
      }
      if (numericTokens(answer.contractEffect)
        .some((number) => !authorizedNumbers.has(number))) {
        throw new Error(`decision_answer_invents_numeric_literal:${decision.questionId}:${answer.id}`);
      }
      const answerThreshold = canonicalIntegerThreshold(answer.contractEffect);
      if (answerThreshold !== null
        && !authorizedDecisionFragments.some((fragment) => (
          canonicalIntegerThreshold(fragment) === answerThreshold
        ))) {
        throw new Error(`decision_answer_invents_threshold:${decision.questionId}:${answer.id}`);
      }
    }
    const answerEffects = decision.answers
      .map(({ contractEffect }) => normalizedObservableText(contractEffect));
    if (new Set(answerEffects).size !== answerEffects.length) {
      throw new Error(`decision_answers_without_distinct_effects:${decision.questionId}`);
    }
    if (/\b(?:bigint|inteiros?)\b/iu.test(intent)) {
      const thresholdEffects = decision.answers
        .map(({ id, contractEffect }) => ({
          id,
          canonical: canonicalIntegerThreshold(contractEffect),
        }))
        .filter(({ canonical }) => canonical !== null);
      if (new Set(thresholdEffects.map(({ canonical }) => canonical)).size
        !== thresholdEffects.length) {
        const equivalence = thresholdEffects
          .map(({ id, canonical }) => `${id}=${canonical}`)
          .join(',');
        throw new Error(`decision_answers_semantically_equivalent:${decision.questionId}:${equivalence}`);
      }
    }
    if (decision.distinguishingCase === undefined) {
      throw new Error(`decision_without_observable_distinguishing_case:${decision.questionId}`);
    }
    {
      const outcomeIds = decision.distinguishingCase.outcomes.map(({ answerId }) => answerId);
      const knownAnswerIds = new Set(decision.answers.map(({ id }) => id));
      if (outcomeIds.length !== knownAnswerIds.size
        || new Set(outcomeIds).size !== knownAnswerIds.size
        || outcomeIds.some((answerId) => !knownAnswerIds.has(answerId))) {
        throw new Error(`decision_distinguishing_case_incomplete:${decision.questionId}`);
      }
      const outcomes = decision.distinguishingCase.outcomes
        .map(({ then }) => normalizedObservableText(then));
      if (new Set(outcomes).size !== outcomes.length
        || hasUnresolvedExpression(decision.distinguishingCase.given)
        || hasUnresolvedExpression(decision.distinguishingCase.when)
        || decision.distinguishingCase.outcomes.some(({ then }) => (
          hasUnresolvedExpression(then) || hasDisjunctiveOutcome(then)
        ))) {
        throw new Error(`decision_without_observable_distinguishing_case:${decision.questionId}`);
      }
    }
    assertRequirementReferences([decision], requirementIds, 'decision');
    for (const invariantId of decision.invariantIds) {
      if (!invariantIds.has(invariantId)) {
        throw new Error(`decision_references_unknown_invariant:${invariantId}`);
      }
    }
    for (const riskId of decision.riskIds) {
      if (!riskIds.has(riskId)) throw new Error(`decision_references_unknown_risk:${riskId}`);
      const risk = risksById.get(riskId);
      if (risk === undefined || !risk.requirementIds.some((requirementId) => (
        decision.requirementIds.includes(requirementId)
      ))) {
        throw new Error(`decision_references_unrelated_risk:${decision.questionId}:${riskId}`);
      }
      const riskText = `${risk.statement}\n${risk.mitigation}`;
      const decisionText = [
        decision.question,
        ...decision.answers.flatMap(({ label, rationale, contractEffect }) => (
          [label, rationale, contractEffect]
        )),
        decision.distinguishingCase.given,
        decision.distinguishingCase.when,
        ...decision.distinguishingCase.outcomes.map(({ then }) => then),
      ].join('\n');
      if ((hashRiskPattern.test(riskText) && !hashSecurityDecisionPattern.test(decisionText))
        || (thresholdRiskPattern.test(riskText) && !thresholdRiskPattern.test(decisionText))) {
        throw new Error(`decision_references_unrelated_risk:${decision.questionId}:${riskId}`);
      }
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

  for (const invariant of draft.invariants) {
    const invariantText = `${invariant.statement}\n${invariant.falsification}`;
    const linkedRequirements = invariant.requirementIds
      .map((requirementId) => requirementsById.get(requirementId))
      .filter((requirement) => requirement !== undefined);
    const linkedRequirementText = linkedRequirements.flatMap((requirement) => [
      requirement.statement,
      ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
    ]).join('\n');
    const linkedBoundaryRules = draft.boundaryRules.filter(({ requirementIds: linkedIds }) => (
      linkedIds.some((requirementId) => invariant.requirementIds.includes(requirementId))
    ));
    const hasLossyEncoding = linkedBoundaryRules.some(({ underflowBehavior, overflowBehavior }) => (
      ['SATURATE', 'WRAP', 'EXPLICIT_SENTINEL'].includes(underflowBehavior)
      || ['SATURATE', 'WRAP', 'EXPLICIT_SENTINEL'].includes(overflowBehavior)
    ));
    if (injectiveInvariantPattern.test(invariantText) && hasLossyEncoding) {
      throw new Error(`injective_invariant_with_lossy_encoding:${invariant.id}`);
    }
    if (conservationInvariantPattern.test(invariantText)
      && retainedResidualPattern.test(linkedRequirementText)
      && !/\b(?:resto|res[ií]du\p{L}*|remainder)\b/iu.test(invariantText)) {
      throw new Error(`conservation_omits_retained_residual:${invariant.id}`);
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
}
