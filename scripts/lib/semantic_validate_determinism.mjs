import {
  canonicalDigest,
} from './canonical_json.mjs';
import {
  activatedDeterminismDimensions,
  closureAuthorityForDimension,
  counterexampleByDimension,
  decisionResolutionIsConcrete,
  determinismDimensionKinds,
  dimensionTriggerPattern,
  hasDisjunctiveOutcome,
  hasUnresolvedExpression,
  isBareDeterminismAssertion,
  literalReferenceAppears,
  mechanicalPolicyForDimension,
  observableIsGeneric,
  proofObligationMatchesDimension,
  ruleApplication,
  structuralAbsencePattern,
  structuralRulePattern,
} from './semantic_rules.mjs';

export function validateDeterminismReview(context) {
  const {
    acceptanceCasesById,
    acceptanceRequirementById,
    architectureTags,
    boundaryRuleIds,
    boundaryRulesById,
    constitutionRules,
    decisionIds,
    decisionsById,
    draft,
    humanResolutionEvidence,
    intent,
    intentSignals,
    invariantIds,
    policy,
    requirementIds,
    requirementsById,
  } = context;
  const determinismSignals = intentSignals
    .filter(({ kind }) => kind === 'DETERMINISM_CLAIM' || kind === 'ARITHMETIC_SEMANTICS');
  const reviewedDeterminismSignalIds = new Set(draft.determinismReview.intentSignalIds);
  const expectedDeterminismSignalIds = new Set(determinismSignals.map(({ id }) => id));
  if (reviewedDeterminismSignalIds.size !== expectedDeterminismSignalIds.size
    || [...expectedDeterminismSignalIds]
      .some((signalId) => !reviewedDeterminismSignalIds.has(signalId))) {
    throw new Error('incomplete_determinism_signal_review');
  }
  const determinismDimensionKeys = new Set();
  for (const dimension of draft.determinismReview.dimensions) {
    const key = `${dimension.kind}:${dimension.subjectId}`;
    if (determinismDimensionKeys.has(key)) {
      throw new Error(`duplicate_determinism_dimension_subject:${key}`);
    }
    determinismDimensionKeys.add(key);
  }
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
    const reviewedDimensionKinds = new Set(draft.determinismReview.dimensions.map(({ kind }) => kind));
    if (reviewedDimensionKinds.size !== determinismDimensionKinds.length
      || determinismDimensionKinds.some((kind) => !reviewedDimensionKinds.has(kind))) {
      throw new Error('incomplete_determinism_dimension_review');
    }
    const publicApplicabilityText = [
      ...draft.requirements.flatMap((requirement) => [
        requirement.statement,
        ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
      ]),
      ...draft.invariants.flatMap(({ statement, falsification }) => [statement, falsification]),
      ...draft.boundaryRules.flatMap(({ subject, lowerBound, upperBound }) => [
        subject,
        lowerBound,
        upperBound,
      ]),
    ].join('\n');
    const applicabilityTextForSubject = (subjectId) => {
      if (subjectId === 'PUBLIC_CONTRACT') return publicApplicabilityText;
      if (requirementIds.has(subjectId)) {
        const requirement = requirementsById.get(subjectId);
        return [
          requirement.statement,
          ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
          ...draft.invariants
            .filter(({ requirementIds: linkedIds }) => linkedIds.includes(subjectId))
            .flatMap(({ statement, falsification }) => [statement, falsification]),
        ].join('\n');
      }
      const boundaryRule = boundaryRulesById.get(subjectId);
      if (boundaryRule === undefined) return '';
      return [
        boundaryRule.subject,
        boundaryRule.lowerBound,
        boundaryRule.upperBound,
        ...boundaryRule.acceptanceCaseIds.flatMap((caseId) => {
          const acceptanceCase = acceptanceCasesById.get(caseId);
          return acceptanceCase === undefined
            ? []
            : [acceptanceCase.given, acceptanceCase.when, acceptanceCase.then];
        }),
      ].join('\n');
    };
    for (const dimension of draft.determinismReview.dimensions) {
      const subjectText = applicabilityTextForSubject(dimension.subjectId);
      const expectedWitness = {
        id: `WITNESS-${dimension.kind}`,
        dimension: dimension.kind,
        ...counterexampleByDimension[dimension.kind],
      };
      if (canonicalDigest(dimension.counterexampleWitness) !== canonicalDigest(expectedWitness)) {
        throw new Error(`determinism_dimension_witness_mismatch:${dimension.kind}`);
      }
      const closureText = dimension.status === 'NOT_APPLICABLE'
        ? dimension.inapplicabilityProof?.evidence ?? dimension.rationale
        : dimension.rationale;
      const expectedClosureAuthority = closureAuthorityForDimension({
        status: dimension.status,
        basis: dimension.basis,
        closureText,
        intent,
        decisionEvidence: humanResolutionEvidence,
        constitutionRules,
        policyRules: policy.rules,
      });
      if (dimension.closureAuthority !== expectedClosureAuthority) {
        throw new Error(`determinism_closure_authority_mismatch:${dimension.kind}`);
      }
      const mechanicalPolicyId = mechanicalPolicyForDimension(
        dimension,
        subjectText,
        intent,
      );
      const mechanicalPolicy = policy.rules.find(({ id }) => id === mechanicalPolicyId);
      if (mechanicalPolicy !== undefined
        && ruleApplication(mechanicalPolicy, architectureTags, intent).applies
        && dimension.status !== 'SPECIFIED') {
        throw new Error(
          `mechanical_dimension_must_be_specified:${dimension.kind}:${mechanicalPolicy.id}`,
        );
      }
      for (const targetId of dimension.targetIds) {
        if (!requirementIds.has(targetId)
          && !invariantIds.has(targetId)
          && !decisionIds.has(targetId)
          && !boundaryRuleIds.has(targetId)) {
          throw new Error(`determinism_dimension_references_unknown_target:${dimension.kind}:${targetId}`);
        }
      }
      if (dimension.subjectId === 'PUBLIC_CONTRACT') {
        if (dimension.status !== 'NOT_APPLICABLE' || dimension.targetIds.length !== 0) {
          throw new Error(`inapplicable_determinism_dimension_has_subject:${dimension.kind}`);
        }
      } else if ((!requirementIds.has(dimension.subjectId)
          && !boundaryRuleIds.has(dimension.subjectId))
        || !dimension.targetIds.includes(dimension.subjectId)) {
        throw new Error(`determinism_dimension_without_observable_subject:${dimension.kind}`);
      }
      if (dimension.kind === 'BOUNDED_ARITHMETIC'
        && dimension.status === 'SPECIFIED'
        && boundaryRulesById.get(dimension.subjectId)
          ?.representationKind !== 'ENCODED_VALUE') {
        throw new Error(`bounded_arithmetic_confuses_width_with_value:${dimension.subjectId}`);
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
        const boundarySubject = boundaryRuleIds.has(dimension.subjectId)
          ? boundaryRulesById.get(dimension.subjectId)
          : undefined;
        if ((proof !== undefined && proof.decisionBinding !== null)
          || (boundarySubject !== undefined && boundarySubject.decisionId !== null)) {
          throw new Error(`specified_dimension_depends_on_decision:${dimension.kind}:${dimension.subjectId}`);
        }
        const obligation = dimension.proofObligation;
        if (proof === undefined
          || obligation === undefined
          || obligation === null
          || obligation.witnessId !== dimension.counterexampleWitness.id
          || !literalReferenceAppears(proof.given, dimension.counterexampleWitness.baseline)
          || !literalReferenceAppears(proof.given, dimension.counterexampleWitness.variation)
          || !proofObligationMatchesDimension(dimension, proof)
          || obligation.observables.some((observable) => (
            observableIsGeneric(observable) || !literalReferenceAppears(proof.then, observable)
          ))
          || !targetRequirementIds.includes(acceptanceRequirementById.get(proof.id))
          || hasUnresolvedExpression(dimension.rationale)
          || hasDisjunctiveOutcome(dimension.rationale)
          || isBareDeterminismAssertion(dimension.rationale)
          || dimension.closureAuthority === 'MODEL_ARGUMENT') {
          throw new Error(`specified_determinism_dimension_without_exact_proof:${dimension.kind}`);
        }
      }
      if (dimension.status === 'DECISION_REQUIRED') {
        const targetDecisionIds = dimension.targetIds
          .filter((targetId) => decisionIds.has(targetId));
        if (targetDecisionIds.length !== 1) {
          throw new Error(`determinism_gap_without_single_decision:${dimension.kind}`);
        }
        const decision = decisionsById.get(targetDecisionIds[0]);
        const subjectRequirementIds = requirementIds.has(dimension.subjectId)
          ? [dimension.subjectId]
          : draft.boundaryRules
            .find(({ id }) => id === dimension.subjectId)?.requirementIds ?? [];
        if (decision === undefined
          || !subjectRequirementIds.some((requirementId) => (
            decision.requirementIds.includes(requirementId)
          ))) {
          throw new Error(`determinism_decision_has_wrong_subject:${dimension.kind}`);
        }
        const scenarioText = [
          decision.distinguishingCase.given,
          decision.distinguishingCase.when,
        ].join('\n');
        if (!literalReferenceAppears(scenarioText, dimension.counterexampleWitness.baseline)
          || !literalReferenceAppears(scenarioText, dimension.counterexampleWitness.variation)) {
          throw new Error(`determinism_decision_does_not_cover_witness:${dimension.kind}`);
        }
        const outcomesByAnswerId = new Map(decision.distinguishingCase.outcomes
          .map((outcome) => [outcome.answerId, outcome.then]));
        if (decision.answers.some((answer) => {
          const outcome = outcomesByAnswerId.get(answer.id) ?? '';
          return !decisionResolutionIsConcrete(
            dimension.kind,
            `${answer.contractEffect}\n${outcome}`,
          );
        })) {
          throw new Error(`determinism_decision_option_not_concrete:${dimension.kind}`);
        }
        if (decision.answers.some((answer) => {
          const outcome = outcomesByAnswerId.get(answer.id);
          return outcome === undefined || !dimensionTriggerPattern[dimension.kind].test([
            answer.contractEffect,
            outcome,
          ].join('\n'));
        })) {
          throw new Error(`determinism_decision_does_not_resolve_dimension:${dimension.kind}`);
        }
      }
      if (dimension.status === 'GAP_FOUND'
        && dimension.targetIds.some((targetId) => decisionIds.has(targetId))) {
        throw new Error(`unresolved_determinism_gap_has_decision:${dimension.kind}`);
      }
      if (dimension.status !== 'SPECIFIED' && dimension.acceptanceCaseId !== null) {
        throw new Error(`non_specified_determinism_dimension_has_proof:${dimension.kind}`);
      }
      if (dimension.status !== 'SPECIFIED' && dimension.proofObligation !== null) {
        throw new Error(`non_specified_determinism_dimension_has_proof_obligation:${dimension.kind}`);
      }
      if (dimension.status === 'NOT_APPLICABLE') {
        const proof = dimension.inapplicabilityProof;
        if (proof === undefined
          || proof === null
          || proof.proofKind !== 'STRUCTURAL_ABSENCE'
          || !['OPERATION_ABSENT', 'INPUT_CLASS_FORBIDDEN', 'INPUT_SCHEMA_EXCLUDES_CLASS']
            .includes(proof.structuralRule)
          || proof.absentStructure !== dimension.counterexampleWitness.inputClass
          || proof.evidence.normalize('NFC') !== dimension.rationale.normalize('NFC')
          || !structuralAbsencePattern.test(proof.evidence)
          || !structuralRulePattern[proof.structuralRule]?.test(proof.evidence)
          || !dimensionTriggerPattern[dimension.kind].test(proof.evidence)
          || hasUnresolvedExpression(proof.evidence)
          || hasDisjunctiveOutcome(proof.evidence)
          || isBareDeterminismAssertion(proof.evidence)
          || dimensionTriggerPattern[dimension.kind]
            .test(applicabilityTextForSubject(dimension.subjectId))
          || dimension.closureAuthority === 'MODEL_ARGUMENT') {
          throw new Error(`inapplicable_determinism_dimension_without_structural_absence:${dimension.kind}`);
        }
      } else if (dimension.inapplicabilityProof !== undefined
        && dimension.inapplicabilityProof !== null) {
        throw new Error(`applicable_determinism_dimension_has_independence_proof:${dimension.kind}`);
      }
    }
    for (const boundaryRuleId of boundaryRuleIds) {
      const boundaryRule = boundaryRulesById.get(boundaryRuleId);
      if (boundaryRule?.representationKind !== 'ENCODED_VALUE') continue;
      const boundedReviews = draft.determinismReview.dimensions.filter(({ kind, subjectId }) => (
        kind === 'BOUNDED_ARITHMETIC' && subjectId === boundaryRuleId
      ));
      if (boundedReviews.length !== 1 || boundedReviews[0].status === 'NOT_APPLICABLE') {
        throw new Error(`bounded_subject_without_determinism_review:${boundaryRuleId}`);
      }
    }
    for (const requirement of draft.requirements) {
      const subjectIds = new Set([
        requirement.id,
        ...draft.boundaryRules
          .filter(({ requirementIds: linkedRequirementIds }) => (
            linkedRequirementIds.includes(requirement.id)
          ))
          .map(({ id }) => id),
      ]);
      for (const kind of activatedDeterminismDimensions(
        applicabilityTextForSubject(requirement.id),
      )) {
        const covered = draft.determinismReview.dimensions.some((dimension) => (
          dimension.kind === kind
          && subjectIds.has(dimension.subjectId)
          && dimension.status !== 'NOT_APPLICABLE'
        ));
        if (!covered) {
          throw new Error(`activated_determinism_dimension_without_subject:${kind}:${requirement.id}`);
        }
      }
    }
    const gapsFound = draft.determinismReview.dimensions
      .some(({ status }) => status === 'DECISION_REQUIRED' || status === 'GAP_FOUND');
    if ((draft.determinismReview.status === 'GAPS_FOUND') !== gapsFound) {
      throw new Error('determinism_review_status_mismatch');
    }
  }
}
