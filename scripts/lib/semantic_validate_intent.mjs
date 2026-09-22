import {
  detectIntentSignals,
} from './intent_signals.mjs';
import {
  assertRequirementReferences,
  basisCitesIntentSignal,
  hasUnresolvedExpression,
  intentProductPaths,
  literalReferenceAppears,
  ruleApplication,
  scopeContainsInternalPath,
  targetIsQuantified,
  targetValueAppearsInEvidence,
  technicalIdentifiers,
  workspaceBasisRange,
} from './semantic_rules.mjs';

export function validateIntentClassification(context) {
  const {
    acceptanceCasesById,
    architectureTags,
    boundaryRulesById,
    decisionIds,
    dispositionsByKind,
    draft,
    intent,
    intentClaimsByTarget,
    knownClaimTargets,
    normalizedClaimQuotes,
    pathReferencesById,
    policy,
    requirementsById,
    targetsByDisposition,
  } = context;
  for (const claim of draft.intentClaims) {
    if (!intent.includes(claim.quote)) throw new Error(`intent_claim_not_literal:${claim.id}`);
    const normalizedQuote = claim.quote.normalize('NFC');
    if (normalizedClaimQuotes.has(normalizedQuote)) {
      throw new Error(`duplicate_intent_claim_quote:${claim.id}`);
    }
    normalizedClaimQuotes.add(normalizedQuote);
    if (!dispositionsByKind[claim.kind].has(claim.disposition)) {
      throw new Error(`invalid_intent_claim_disposition:${claim.id}`);
    }
    for (const targetId of claim.targetIds) {
      if (!knownClaimTargets.has(targetId)) {
        throw new Error(`intent_claim_references_unknown_target:${claim.id}:${targetId}`);
      }
      if (!targetsByDisposition[claim.disposition].test(targetId)) {
        throw new Error(`intent_claim_targets_wrong_layer:${claim.id}:${targetId}`);
      }
      if (targetId.startsWith('PATH-')
        && pathReferencesById.get(targetId)?.role !== 'IMPLEMENTATION_SUGGESTION') {
        throw new Error(`intent_claim_targets_normative_path_as_note:${claim.id}:${targetId}`);
      }
      const claims = intentClaimsByTarget.get(targetId) ?? [];
      claims.push(claim);
      intentClaimsByTarget.set(targetId, claims);
    }
    if (claim.disposition === 'NORMATIVE') {
      if (typeof claim.contractEffect !== 'string'
        || !claim.contractEffect.normalize('NFC').includes(claim.quote.normalize('NFC'))) {
        throw new Error(`normative_claim_without_literal_effect:${claim.id}`);
      }
      const materialized = claim.targetIds.some((targetId) => {
        const requirement = requirementsById.get(targetId);
        if (requirement !== undefined) {
          return literalReferenceAppears([
            requirement.statement,
            ...requirement.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]),
          ].join('\n'), claim.contractEffect);
        }
        const boundaryRule = boundaryRulesById.get(targetId);
        if (boundaryRule === undefined) return false;
        return literalReferenceAppears([
          boundaryRule.subject,
          ...boundaryRule.acceptanceCaseIds
            .map((caseId) => acceptanceCasesById.get(caseId)?.then ?? ''),
        ].join('\n'), claim.contractEffect);
      });
      if (!materialized) throw new Error(`normative_claim_not_materialized:${claim.id}`);
    } else if (claim.contractEffect !== null) {
      throw new Error(`non_normative_claim_has_contract_effect:${claim.id}`);
    }
  }
  const normativeFragments = [
    ...draft.intentClaims
      .filter(({ disposition }) => disposition === 'NORMATIVE')
      .flatMap(({ id, contractEffect }) => [[`intent_claim:${id}`, contractEffect ?? '']]),
    ...draft.requirements.flatMap((requirement) => [
      [`requirement:${requirement.id}`, requirement.statement],
      ...requirement.acceptanceCases.flatMap((acceptanceCase) => [
        [`acceptance_given:${acceptanceCase.id}`, acceptanceCase.given],
        [`acceptance_when:${acceptanceCase.id}`, acceptanceCase.when],
        [`acceptance_then:${acceptanceCase.id}`, acceptanceCase.then],
      ]),
    ]),
    ...draft.invariants.flatMap(({ id, statement, falsification }) => [
      [`invariant:${id}`, statement],
      [`invariant_falsification:${id}`, falsification],
    ]),
    ...draft.decisions.flatMap((decision) => decision.answers.map(({ id, contractEffect }) => (
      [`decision_effect:${decision.questionId}:${id}`, contractEffect]
    ))),
  ];
  for (const [location, text] of normativeFragments) {
    if (hasUnresolvedExpression(text)) {
      throw new Error(`unresolved_expression_in_normative_text:${location}`);
    }
  }
  for (const requirement of draft.requirements) {
    const userReferences = requirement.basis
      .filter(({ source }) => source === 'USER_INTENT')
      .map(({ reference }) => reference);
    if (userReferences.length > 0) {
      const matchingClaim = (intentClaimsByTarget.get(requirement.id) ?? [])
        .find(({ disposition, quote }) => disposition === 'NORMATIVE'
          && userReferences.some((reference) => (
            quote.includes(reference) || reference.includes(quote)
          )));
      if (matchingClaim === undefined) {
        throw new Error(`user_requirement_without_intent_claim:${requirement.id}`);
      }
    }
  }
  for (const item of draft.nonNormativeItems) {
    const claims = intentClaimsByTarget.get(item.id) ?? [];
    if (claims.length === 0
      || claims.some(({ disposition }) => disposition !== 'NON_NORMATIVE')) {
      throw new Error(`non_normative_item_without_intent_claim:${item.id}`);
    }
    if (!item.basis.some(({ source, reference }) => (
      source === 'USER_INTENT'
      && claims.some(({ quote }) => quote.includes(reference) || reference.includes(quote))
    ))) {
      throw new Error(`non_normative_item_without_matching_basis:${item.id}`);
    }
  }
  for (const decisionId of decisionIds) {
    const unknownReferences = draft.unknowns
      .filter(({ decisionId: linkedDecisionId }) => linkedDecisionId === decisionId)
      .flatMap(({ basis }) => basis
        .filter(({ source }) => source === 'USER_INTENT')
        .map(({ reference }) => reference));
    if (!(intentClaimsByTarget.get(decisionId) ?? [])
      .some(({ disposition, quote }) => disposition === 'DECISION'
        && unknownReferences.some((reference) => (
          quote.includes(reference) || reference.includes(quote)
        )))) {
      throw new Error(`decision_without_ambiguity_claim:${decisionId}`);
    }
  }
  const ruleApplications = new Map(policy.rules.map((rule) => [
    rule.id,
    ruleApplication(rule, architectureTags, intent),
  ]));
  const intentSignals = detectIntentSignals(intent);
  const intentSignalsById = new Map(intentSignals.map((signal) => [signal.id, signal]));
  const vagueQualitySignals = intentSignals.filter(({ kind }) => kind === 'QUALITY_GOAL');
  for (const requirement of draft.requirements) {
    const normativeClaims = (intentClaimsByTarget.get(requirement.id) ?? [])
      .filter(({ disposition }) => disposition === 'NORMATIVE');
    if (normativeClaims.some(({ quote }) => vagueQualitySignals.some(({ reference }) => (
      quote.includes(reference) || reference.includes(quote)
    )))) {
      throw new Error(`quality_goal_promoted_to_requirement:${requirement.id}`);
    }
  }
  return { intentSignals, intentSignalsById, ruleApplications };
}

export function validateScopeAndIntentSignals(context) {
  const {
    decisionIds,
    draft,
    humanResolutionEvidence,
    intent,
    intentSignalsById,
    knownResolvedDecisions,
    requirementIds,
    requirementsById,
    workspaceEvidence,
  } = context;
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
    if (normativeRole && !pathReference.requirementIds.some((requirementId) => {
      const requirement = requirementsById.get(requirementId);
      const requirementText = [
        requirement?.statement ?? '',
        ...(requirement?.acceptanceCases.flatMap(({ given, when, then }) => [given, when, then]) ?? []),
      ].join('\n');
      return literalReferenceAppears(requirementText, pathReference.path);
    })) {
      throw new Error(`normative_path_not_materialized:${pathReference.path}`);
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
      if (target.evidenceStatus === 'EVIDENCE_BACKED'
        && target.source !== 'WORKSPACE_EVIDENCE') {
        throw new Error(`quality_target_claims_unavailable_evidence:${requirement.id}`);
      }
    }
  }

  assertRequirementReferences(draft.invariants, requirementIds, 'invariant');
  assertRequirementReferences(draft.risks, requirementIds, 'risk');

  for (const unknown of draft.unknowns) {
    if (!unknown.material && unknown.decisionId !== null) {
      throw new Error(`non_material_unknown_with_decision:${unknown.id}`);
    }
    if (unknown.decisionId !== null && !decisionIds.has(unknown.decisionId)) {
      throw new Error(`unknown_references_missing_decision:${unknown.id}`);
    }
  }
  const materialDecisionIds = new Set(draft.unknowns
    .filter(({ material, decisionId }) => material && decisionId !== null)
    .map(({ decisionId }) => decisionId));

  const requirementSignalOwners = new Map();
  for (const requirement of draft.requirements) {
    for (const signalId of requirement.intentSignalIds) {
      const signal = intentSignalsById.get(signalId);
      if (signal === undefined) throw new Error(`requirement_references_unknown_intent_signal:${signalId}`);
      const resolvedByHuman = requirement.basis.some(({ source, reference }) => (
        source === 'USER_DECISION' && knownResolvedDecisions.has(reference)
      ));
      if ((signal.kind === 'QUALITY_CONSTRAINT' && requirement.kind !== 'QUALITY')
        || signal.kind === 'QUALITY_GOAL'
        || signal.kind === 'EXAMPLE'
        || signal.kind === 'BOUNDED_VALUE'
        || signal.kind === 'DETERMINISM_CLAIM'
        || signal.kind === 'ARITHMETIC_SEMANTICS'
        || (signal.kind === 'INCOMPLETE_EXPRESSION'
          && signal.handling === 'MATERIAL_DECISION'
          && !resolvedByHuman)) {
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
      if (!unknown.material) {
        throw new Error(`intent_signal_without_material_unknown:${signalId}`);
      }
      if (!basisCitesIntentSignal(unknown, intentSignalsById.get(signalId))) {
        throw new Error(`unknown_omits_intent_signal_basis:${unknown.id}:${signalId}`);
      }
      const owners = unknownSignalOwners.get(signalId) ?? [];
      owners.push(unknown);
      unknownSignalOwners.set(signalId, owners);
    }
  }

  const nonNormativeSignalOwners = new Map();
  for (const item of draft.nonNormativeItems) {
    for (const signalId of item.intentSignalIds) {
      const signal = intentSignalsById.get(signalId);
      const validSignal = (item.kind === 'GOAL' && signal?.kind === 'QUALITY_GOAL')
        || (item.kind === 'EXAMPLE' && signal?.kind === 'EXAMPLE');
      if (!validSignal) {
        throw new Error(`non_normative_item_references_invalid_signal:${item.id}:${signalId}`);
      }
      if (!basisCitesIntentSignal(item, signal)) {
        throw new Error(`non_normative_item_omits_intent_signal_basis:${item.id}:${signalId}`);
      }
      const owners = nonNormativeSignalOwners.get(signalId) ?? [];
      owners.push(item);
      nonNormativeSignalOwners.set(signalId, owners);
    }
  }
  return { materialDecisionIds, nonNormativeSignalOwners, requirementSignalOwners, unknownSignalOwners };
}
