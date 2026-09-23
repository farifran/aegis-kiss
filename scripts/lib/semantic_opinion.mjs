import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';
import {
  closureAuthorityForDimension,
  counterexampleForDimension,
} from './semantic_authority.mjs';

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

function assertWorksheetRequirements(opinion, request) {
  const requiredDimensions = request.worksheet.requiredDeterminismDimensions;
  const expectedWitnesses = requiredDimensions.map(counterexampleForDimension);
  if (JSON.stringify(request.worksheet.counterexampleWitnesses)
    !== JSON.stringify(expectedWitnesses)) {
    throw new Error('semantic_worksheet_witnesses_mismatch');
  }
  const reportedKinds = new Set(opinion.determinismReview.dimensions.map(({ kind }) => kind));
  for (const dimension of requiredDimensions) {
    if (!reportedKinds.has(dimension)) {
      throw new Error(`semantic_opinion_missing_required_determinism:${dimension}`);
    }
  }

  const counterBoundaries = request.worksheet.bitFields
    .map(({ counterBoundary }) => counterBoundary)
    .filter((boundary) => boundary !== null);
  const availableProofs = opinion.determinismReview.dimensions
    .filter((dimension) => dimension.kind === 'BOUNDED_ARITHMETIC')
    .map((dimension) => ({ dimension, used: false }));
  for (const boundary of counterBoundaries) {
    const maximum = boundary.proofCases[1].expected;
    const match = availableProofs.find(({ dimension, used }) => (
      !used
      && dimension.status === 'SPECIFIED'
      && dimension.basis.some(({ source, reference }) => (
        source === 'ARCHITECTURE_POLICY' && reference === boundary.authority
      ))
      && dimension.proofObligation?.relation === 'DEFINED_RESULT'
      && dimension.proofObligation.resolutionKind === boundary.resolutionKind
      && dimension.proofObligation.resolutionParameter === boundary.resolutionParameter
      && dimension.proofObligation.baselineOutcome === maximum
      && dimension.proofObligation.variationOutcome === maximum
    ));
    if (match === undefined) {
      throw new Error(`semantic_opinion_missing_counter_saturation_proof:${boundary.resolutionParameter}`);
    }
    match.used = true;
  }
}

export function compileSemanticOpinion(opinion, request) {
  assertSchema('aegis.semantic_request.v9', request);
  const { requestDigest, ...requestPayload } = request;
  if (requestDigest !== canonicalDigest(requestPayload)) {
    throw new Error('semantic_request_digest_mismatch');
  }
  if (request.worksheetDigest !== canonicalDigest(request.worksheet)
    || request.worksheet.contextDigest !== request.contextDigest) {
    throw new Error('semantic_worksheet_digest_mismatch');
  }
  assertSchema('aegis.semantic_opinion.v2', opinion);
  if (opinion.worksheetDigest !== request.worksheetDigest) {
    throw new Error('semantic_opinion_worksheet_mismatch');
  }
  assertWorksheetRequirements(opinion, request);

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
  const determinismSignalIds = request.intentSignals.signals
    .filter(({ kind }) => kind === 'DETERMINISM_CLAIM' || kind === 'ARITHMETIC_SEMANTICS')
    .map(({ id }) => id);

  return {
    schema: 'aegis.semantic_draft.v8',
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
        : dimensions.some(({ status }) => (
          status === 'DECISION_REQUIRED' || status === 'GAP_FOUND'
        ))
          ? 'GAPS_FOUND'
          : 'SEMANTICALLY_CLOSED',
      rationale: opinion.determinismReview.rationale,
      intentSignalIds: dimensions.length === 0 ? [] : determinismSignalIds,
      dimensions: dimensions.map((item) => {
        const basis = compileOpinionBasis(item.basis, request);
        const subjectId = item.subject === null
          ? 'PUBLIC_CONTRACT'
          : compileTargets([item.subject])[0];
        return {
          kind: item.kind,
          subjectId,
          status: item.status,
          rationale: item.rationale,
          targetIds: compileTargets(item.targets),
          basis,
          closureAuthority: closureAuthorityForDimension({
            status: item.status,
            basis,
          }),
          counterexampleWitness: counterexampleForDimension(item.kind),
          proofObligation: item.proofObligation === null
            ? null
            : {
              ...item.proofObligation,
              witnessId: counterexampleForDimension(item.kind).id,
            },
          inapplicabilityProof: item.inapplicabilityProof,
          acceptanceCaseId: item.acceptanceCase === null
            ? null
            : compileAcceptanceReference(item.acceptanceCase),
        };
      }),
    },
    boundaryRules: opinion.boundaryRules.map((item, index) => ({
      id: boundaryIds[index],
      subject: item.subject,
      representationKind: item.representationKind,
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
      distinguishingCase: {
        given: item.distinguishingCase.given,
        when: item.distinguishingCase.when,
        outcomes: item.distinguishingCase.outcomes.map(({ answerIndex, then }) => ({
          answerId: indexedValue(answerIds[decisionIndex], answerIndex, 'distinguishing_answer'),
          then,
        })),
      },
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
