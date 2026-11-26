import { Buffer } from 'node:buffer';
import { canonicalDigest, canonicalJson } from './canonical_json.mjs';
import { computeDeterminismReviewStatus } from './closure/v7_rules.mjs';
import { assertSchema, standaloneSchemaDocument } from './schema_validator.mjs';
import { buildQuestionRequest } from './semantic_approval.mjs';
import { runCollected } from './semantic_draft_validator.mjs';
import { omitOptionalNulls } from './semantic_output_schema.mjs';
import { generateClosureCertificate } from './semantic_closure.mjs';
import { effectCollections, effectCollection, replacePreparedEntries } from './prepared_effects.mjs';
import {
  closureAuthorityForDimension,
  compileCounterexampleWitness,
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

function assertEvidenceCoverage(opinion, request) {
  if (opinion.sourceEvidenceDigest !== request.intentEvidence.evidenceDigest) {
    throw new Error('semantic_opinion_evidence_mismatch');
  }
  for (let index = 0; index < opinion.intentClaims.length; index += 1) {
    const claim = opinion.intentClaims[index];
    let literalQuoteFound = false;
    for (const fragmentIndex of claim.fragmentIndexes) {
      const fragment = request.intentEvidence.fragments[fragmentIndex];
      if (fragment === undefined) throw new Error(`semantic_opinion_fragment_out_of_range:${fragmentIndex}`);
      const source = request.intent.slice(fragment.startOffset, fragment.endOffset);
      if (source.includes(claim.quote)) literalQuoteFound = true;
    }
    if (!literalQuoteFound) throw new Error(`semantic_opinion_claim_quote_outside_fragment:${index}`);
  }
}

function normalizeTargetRef(target, request) {
  if (!target || typeof target !== 'object') return;
  if (target.index === undefined) {
    const id = target.ruleId || target.id;
    if (target.kind === 'POLICY_RULE' && id) {
      const idx = request.policy.rules.findIndex((r) => r.id === id);
      if (idx !== -1) target.index = idx;
    } else if (id) {
      const parsed = parseInt(String(id).replace(/\D/g, ''), 10) - 1;
      if (!Number.isNaN(parsed) && parsed >= 0) target.index = parsed;
    }
  }
  delete target.ruleId;
  delete target.id;
}

function normalizeWorkspaceLineReference(reference) {
  if (typeof reference !== 'string') return reference;
  const match = /^(src\/[^:]+):L?([1-9]\d*)(?:-L?([1-9]\d*))?$/u.exec(reference.trim());
  if (match === null) return reference;
  return match[3] ? `${match[1]}:L${match[2]}-L${match[3]}` : `${match[1]}:L${match[2]}`;
}

function normalizeWorkspaceEvidenceReferences(node) {
  if (Array.isArray(node)) {
    node.forEach(normalizeWorkspaceEvidenceReferences);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (node.source === 'WORKSPACE_EVIDENCE' && typeof node.reference === 'string') {
    node.reference = normalizeWorkspaceLineReference(node.reference);
  }
  Object.values(node).forEach(normalizeWorkspaceEvidenceReferences);
}

function normalizeIntentClaimsAndContexts(opinion, request) {
  normalizeWorkspaceEvidenceReferences(opinion);
  if (Array.isArray(opinion.intentClaims)) {
    for (const claim of opinion.intentClaims) {
      if (claim.disposition !== 'NORMATIVE' && claim.contractEffect === undefined) {
        claim.contractEffect = null;
      }
      if (Array.isArray(claim.targets)) {
        for (const target of claim.targets) normalizeTargetRef(target, request);
      }
    }
  }

  // A ausência de contexto é uma lacuna de análise, não autorização para inferir o primeiro contexto.
  if (!Array.isArray(opinion.architectureContexts) || opinion.architectureContexts.length === 0) {
    throw new Error('semantic_review_required:missing_architecture_contexts');
  }
  for (const item of opinion.architectureContexts) {
    if (item.contextIndex === undefined && (item.contextTag || item.tag)) {
      const tag = item.contextTag || item.tag;
      const index = request.policy.contexts.findIndex((c) => c.tag === tag);
      if (index !== -1) item.contextIndex = index;
    }
    if (!Array.isArray(item.basis) || item.basis.length === 0) {
      throw new Error(`semantic_review_required:missing_context_basis:${item.contextIndex ?? 'unknown'}`);
    }
    delete item.contextTag;
    delete item.tag;
  }
}

function normalizePolicyAssessments(opinion, request) {
  // 2. policyAssessments: regras padrão COMPLIANT sem conflito declarado são derivadas pelo Harness.
  if (opinion.policyAssessments === undefined || opinion.policyAssessments === null) {
    opinion.policyAssessments = [];
  }
  if (!Array.isArray(opinion.policyAssessments)) {
    throw new Error('semantic_review_required:missing_policy_assessments');
  }
  for (const assessment of opinion.policyAssessments) {
    if (assessment.ruleIndex === undefined && (assessment.ruleId || assessment.id)) {
      const id = assessment.ruleId || assessment.id;
      const index = request.policy.rules.findIndex((r) => r.id === id);
      if (index !== -1) assessment.ruleIndex = index;
    }
    delete assessment.ruleId;
    delete assessment.id;
    if (assessment.amendmentIndex === undefined) {
      assessment.amendmentIndex = null;
    }
    if (assessment.recommendedStatus === 'CONFLICT') {
      assessment.recommendedStatus = 'AMENDED';
    }
    if (assessment.recommendedStatus === undefined || assessment.demandStatus === undefined) {
      throw new Error(`semantic_review_required:incomplete_policy_assessment:${assessment.ruleIndex ?? 'unknown'}`);
    }
  }
  const activeContextTags = new Set(
    opinion.architectureContexts.map((c) => request.policy.contexts[c.contextIndex]?.tag).filter(Boolean),
  );
  const existingByRuleIndex = new Map(opinion.policyAssessments.map((a) => [a.ruleIndex, a]));
  const applicableRuleIndexes = [];
  request.policy.rules.forEach((rule, idx) => {
    const applies = rule.appliesMode === 'all'
      ? rule.appliesWhen.every((tag) => activeContextTags.has(tag))
      : rule.appliesWhen.some((tag) => activeContextTags.has(tag));
    if (applies) applicableRuleIndexes.push(idx);
  });
  for (const idx of applicableRuleIndexes) {
    if (!existingByRuleIndex.has(idx)) {
      existingByRuleIndex.set(idx, {
        ruleIndex: idx,
        demandStatus: 'COMPLIANT',
        recommendedStatus: 'COMPLIANT',
        rationale: 'Conformidade padrão derivada pelo compilador na ausência de conflito declarado.',
        decisionIndex: null,
        amendmentIndex: null,
      });
    }
  }
  const applicableAssessments = applicableRuleIndexes.map((idx) => existingByRuleIndex.get(idx));
  const applicableIndexes = new Set(applicableRuleIndexes);
  opinion.policyAssessments = [
    ...applicableAssessments,
    ...[...existingByRuleIndex.entries()]
      .filter(([idx]) => !applicableIndexes.has(idx))
      .map(([, assessment]) => assessment),
  ];
}

function normalizeDeterminismReview(opinion, request) {
  // 3. determinismReview: deriva fragmentIndexes materiais e cobertura default NO_DIMENSION_APPLICABLE quando seguro.
  if (!opinion.determinismReview || typeof opinion.determinismReview !== 'object') {
    throw new Error('semantic_review_required:missing_determinism_review');
  }
  delete opinion.determinismReview.promiseInDemand;
  delete opinion.determinismReview.status;
  delete opinion.determinismReview.sourceFragmentIds;
  if (!Array.isArray(opinion.determinismReview.dimensions)) {
    throw new Error('semantic_review_required:missing_determinism_dimensions');
  }
  for (const dim of opinion.determinismReview.dimensions) {
    if (dim.subject && typeof dim.subject === 'object') normalizeTargetRef(dim.subject, request);
    if (Array.isArray(dim.targets)) {
      for (const target of dim.targets) normalizeTargetRef(target, request);
    }
  }
  if (opinion.determinismReview.fragmentIndexes == null) {
    const derivedFragments = new Set();
    for (const claim of opinion.intentClaims ?? []) {
      if ((claim.disposition === 'NORMATIVE' || claim.disposition === 'DECISION')
        && Array.isArray(claim.fragmentIndexes)) {
        for (const fragmentIndex of claim.fragmentIndexes) derivedFragments.add(fragmentIndex);
      }
    }
    opinion.determinismReview.fragmentIndexes = [...derivedFragments].sort((a, b) => a - b);
  }
  if (!Array.isArray(opinion.determinismReview.fragmentIndexes)) {
    throw new Error('semantic_review_required:missing_determinism_source_fragments');
  }
  if (opinion.determinismReview.coverage == null) {
    opinion.determinismReview.coverage = [];
  }
  if (!Array.isArray(opinion.determinismReview.coverage)) {
    throw new Error('semantic_review_required:missing_determinism_coverage');
  }
  for (const coverage of opinion.determinismReview.coverage) {
    if (coverage.claimIndex === undefined && coverage.claimId) {
      const parsed = parseInt(String(coverage.claimId).replace(/\D/g, ''), 10) - 1;
      if (!Number.isNaN(parsed)) coverage.claimIndex = parsed;
    }
    delete coverage.claimId;
    delete coverage.dimensionAssessments;
    if (!Array.isArray(coverage.dimensionIndexes)) {
      throw new Error(`semantic_review_required:incomplete_determinism_coverage:${coverage.claimIndex ?? 'unknown'}`);
    }
    if (coverage.disposition === undefined) {
      coverage.disposition = coverage.dimensionIndexes.length > 0 ? 'DIMENSIONS_DECLARED' : 'NO_DIMENSION_APPLICABLE';
    }
  }
  if (!Array.isArray(opinion.intentClaims)) return;

  opinion.determinismReview.coverage = opinion.determinismReview.coverage.filter((coverage) => {
    const claim = opinion.intentClaims[coverage.claimIndex];
    if (!claim) return true;
    const isMaterial = claim.disposition === 'NORMATIVE' || claim.disposition === 'DECISION';
    return isMaterial || coverage.disposition !== 'NO_DIMENSION_APPLICABLE';
  });
  const coveredClaimIndexes = new Set(opinion.determinismReview.coverage.map((c) => c.claimIndex));
  const coveredDimensionIndexes = new Set(opinion.determinismReview.coverage.flatMap((c) => c.dimensionIndexes ?? []));
  const targetKey = (t) => (t && typeof t === 'object' ? `${t.kind}:${t.index}` : null);
  const missingCoverage = [];
  opinion.intentClaims.forEach((claim, claimIndex) => {
    const isMaterial = claim.disposition === 'NORMATIVE' || claim.disposition === 'DECISION';
    if (!isMaterial || coveredClaimIndexes.has(claimIndex)) return;
    const mentionsDeterminism = /(?:determinis)/iu.test(`${claim.quote ?? ''}\n${claim.contractEffect ?? ''}`);
    const claimTargetKeys = new Set((claim.targets ?? []).map(targetKey).filter(Boolean));
    const touchesDeclaredDimension = opinion.determinismReview.dimensions.some((dim, dimIdx) => {
      if (coveredDimensionIndexes.has(dimIdx)) return false;
      const subj = targetKey(dim.subject);
      if (subj && claimTargetKeys.has(subj)) return true;
      return (dim.targets ?? []).some((t) => claimTargetKeys.has(targetKey(t)));
    });
    if (claim.disposition === 'NORMATIVE' && !mentionsDeterminism && !touchesDeclaredDimension) {
      opinion.determinismReview.coverage.push({
        claimIndex,
        disposition: 'NO_DIMENSION_APPLICABLE',
        dimensionIndexes: [],
        rationale: 'Nenhuma dimensão de determinismo ativada para esta obrigação.',
      });
      return;
    }
    missingCoverage.push(claimIndex);
  });
  if (missingCoverage.length > 0) {
    throw new Error(`semantic_review_required:missing_determinism_claim_coverage:${missingCoverage.join(',')}`);
  }
}

function resolveUniqueStateFieldName(fieldName, fieldEntitiesMap, defaultEntityName = null) {
  if (typeof fieldName !== 'string' || !fieldName.trim()) return fieldName;
  if (fieldName.includes('.')) return fieldName;
  const owners = fieldEntitiesMap.get(fieldName);
  if (owners?.length === 1) return `${owners[0]}.${fieldName}`;
  if (defaultEntityName && owners?.includes(defaultEntityName)) return `${defaultEntityName}.${fieldName}`;
  return fieldName;
}

function normalizeStateModel(stateModel) {
  if (!stateModel) return;
  const entities = Array.isArray(stateModel.entities) ? stateModel.entities : [];
  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  const operationNames = new Set(operations.map((op) => op.name).filter(Boolean));
  const fieldEntitiesMap = new Map();
  for (const entity of entities) {
    for (const field of entity.fields ?? []) {
      if (!fieldEntitiesMap.has(field.name)) fieldEntitiesMap.set(field.name, []);
      fieldEntitiesMap.get(field.name).push(entity.name);
    }
  }
  const singleEntityName = entities.length === 1 ? entities[0].name : null;

  for (const op of operations) {
    for (const param of op.parameters ?? []) {
      if (param.nullability === 'NON_NULLABLE') param.nullability = 'NOT_NULL';
    }
    for (const branch of op.branches ?? []) {
      for (const eff of branch.stateEffects ?? []) {
        if (eff.effect === 'SET_VALUE') eff.effect = 'SET';
        eff.field = resolveUniqueStateFieldName(eff.field, fieldEntitiesMap, singleEntityName);
      }
    }
  }

  const effectToMutation = new Map([
    ['SET', 'SET_VALUE'],
    ['INCREMENT', 'INCREMENT'],
    ['DECREMENT', 'DECREMENT'],
    ['MUTATE_COLLECTION', 'MUTATE_COLLECTION'],
    ['CUSTOM', 'CUSTOM'],
  ]);

  for (const entity of entities) {
    for (const field of entity.fields ?? []) {
      const fullKey = `${entity.name}.${field.name}`;
      if (Array.isArray(field.preservation)) {
        field.preservation = [...new Set(field.preservation.map((entry) => {
          if (typeof entry !== 'string' || entry === '*') return entry;
          const prefix = entry.split(':')[0];
          return operationNames.has(prefix) ? prefix : entry;
        }))];
      }

      if (field.mutations == null || (Array.isArray(field.mutations) && field.mutations.length === 0)) {
        const derivedMutations = [];
        for (const op of operations) {
          for (const branch of op.branches ?? []) {
            for (const eff of branch.stateEffects ?? []) {
              if (eff.field !== fullKey) continue;
              const mappedEffect = effectToMutation.get(eff.effect);
              if (!mappedEffect) continue;
              derivedMutations.push({
                operation: op.name,
                condition: branch.branchId || branch.condition || 'BRANCH',
                effect: mappedEffect,
                targetValue: eff.value ?? null,
              });
            }
          }
        }
        field.mutations = derivedMutations;
      } else {
        for (const mutation of field.mutations) {
          if (mutation.effect === 'SET') mutation.effect = 'SET_VALUE';
        }
      }

      if (field.preservation == null || (Array.isArray(field.preservation) && field.preservation.length === 0)) {
        const mutatedOps = new Set((field.mutations ?? []).map((m) => m.operation));
        const derivedPreservation = [];
        for (const op of operations) {
          if (mutatedOps.has(op.name)) continue;
          const branches = op.branches ?? [];
          if (branches.length === 0) continue;
          const allPreserve = branches.every((branch) => {
            const explicitPreserve = (branch.stateEffects ?? []).some(
              (eff) => eff.field === fullKey && eff.effect === 'PRESERVE',
            );
            const mutatesHere = (branch.stateEffects ?? []).some(
              (eff) => eff.field === fullKey && eff.effect !== 'PRESERVE',
            );
            return explicitPreserve || (!mutatesHere && branch.defaultPreservation === true);
          });
          if (allPreserve) derivedPreservation.push(op.name);
        }
        field.preservation = derivedPreservation;
      }

      if (field.readBy == null) {
        const derivedReaders = new Set((field.mutations ?? []).map((m) => m.operation));
        const fieldRegex = new RegExp(`\\b${field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'u');
        for (const op of operations) {
          if ((op.evaluatedInputs ?? []).includes(field.name)
            || (op.branches ?? []).some((b) => typeof b.condition === 'string' && fieldRegex.test(b.condition))) {
            derivedReaders.add(op.name);
          }
        }
        for (const obs of (stateModel.observables ?? [])) {
          if (Array.isArray(obs.derivedFrom)
            && (obs.derivedFrom.includes(fullKey) || obs.derivedFrom.includes(field.name))) {
            derivedReaders.add(obs.name);
          }
        }
        field.readBy = [...derivedReaders];
      }
    }
  }
}

function normalizeRequirementItem(req) {
  if (!req || typeof req !== 'object') return;
  for (const ac of req.acceptanceCases ?? []) {
    if (ac.kind === 'STATE_CHANGE') {
      if (ac.outcomeKind === undefined) {
        throw new Error('semantic_review_required:missing_acceptance_outcome_kind');
      }
      ac.kind = 'BOUNDARY';
    }
  }
}

function normalizeDecisionsAndInventory(opinion) {
  if (Array.isArray(opinion.decisions)) {
    for (const dec of opinion.decisions) {
      for (const ans of dec.answers ?? []) {
        if (ans.preparedEffect && typeof ans.preparedEffect === 'object') {
          for (const entry of ans.preparedEffect.requirements ?? []) {
            if (entry.value) normalizeRequirementItem(entry.value);
          }
        }
      }
    }
  }
  for (const inv of opinion.invariants ?? []) {
    if (inv.requirementIndexes === undefined && Array.isArray(inv.targetRequirementIndexes)) {
      inv.requirementIndexes = inv.targetRequirementIndexes;
    }
    delete inv.targetRequirementIndexes;
  }
  if (opinion.adversarialReview && typeof opinion.adversarialReview === 'object') {
    delete opinion.adversarialReview.status;
  }
  for (const req of opinion.requirements ?? []) {
    normalizeRequirementItem(req);
  }
}

function normalizeSemanticOpinion(opinion, request) {
  const cloned = globalThis.structuredClone(opinion);
  normalizeIntentClaimsAndContexts(cloned, request);
  runCollected([
    () => normalizePolicyAssessments(cloned, request),
    () => normalizeDeterminismReview(cloned, request),
    () => normalizeStateModel(cloned.stateModel),
    () => normalizeDecisionsAndInventory(cloned),
  ]);
  return cloned;
}

function buildOpinionCompileContext(opinion, request) {
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
  const fragmentIds = request.intentEvidence.fragments.map(({ id }) => id);
  const dimensions = opinion.determinismReview.dimensions;
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
  const compileFragmentIndexes = (indexes) => compileIndexes(indexes, fragmentIds, 'fragment');
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
          resolvedDecisionIds,
          measurement.target.resolutionIndex,
          'measurement_decision',
        ),
        evidenceStatus: measurement.target.evidenceStatus,
      }
      : measurement.target;
    return { ...measurement, target };
  };
  const dimensionIdentity = (dimensionIndex) => {
    const dimension = indexedValue(dimensions, dimensionIndex, 'determinism_coverage_dimension');
    return {
      kind: dimension.kind,
      subjectId: dimension.subject === null
        ? 'PUBLIC_CONTRACT'
        : compileTargets([dimension.subject])[0],
    };
  };

  return {
    requirementIds,
    invariantIds,
    riskIds,
    decisionIds,
    noteIds,
    pathIds,
    boundaryIds,
    policyRuleIds,
    amendmentIds,
    acceptanceIds,
    answerIds,
    fragmentIds,
    dimensions,
    compileTargets,
    compileIndexes,
    compileFragmentIndexes,
    compileAcceptanceReference,
    compileDecisionBinding,
    compileMeasurement,
    dimensionIdentity,
  };
}

function compileRequirementsSection(opinion, request, ctx) {
  return opinion.requirements.map((requirement, requirementIndex) => ({
    id: ctx.requirementIds[requirementIndex],
    kind: requirement.kind,
    statement: requirement.statement,
    basis: compileOpinionBasis(requirement.basis, request),
    sourceFragmentIds: ctx.compileFragmentIndexes(requirement.fragmentIndexes),
    measurement: ctx.compileMeasurement(requirement.measurement),
    acceptanceCases: requirement.acceptanceCases.map((acceptanceCase, caseIndex) => ({
      id: ctx.acceptanceIds[requirementIndex][caseIndex],
      kind: acceptanceCase.kind,
      given: acceptanceCase.given,
      when: acceptanceCase.when,
      then: acceptanceCase.then,
      outcomeKind: acceptanceCase.outcomeKind,
      ...(acceptanceCase.branchRef != null ? { branchRef: acceptanceCase.branchRef } : {}),
      ...(acceptanceCase.batchWitness != null ? { batchWitness: acceptanceCase.batchWitness } : {}),
      ...(acceptanceCase.crossOperationWitness != null ? { crossOperationWitness: acceptanceCase.crossOperationWitness } : {}),
      ...(acceptanceCase.keyComparisonWitness != null ? { keyComparisonWitness: acceptanceCase.keyComparisonWitness } : {}),
      decisionBinding: ctx.compileDecisionBinding(acceptanceCase.decisionBinding),
      boundaryBinding: acceptanceCase.boundaryBinding === null
        ? null
        : {
          ruleId: indexedValue(
            ctx.boundaryIds,
            acceptanceCase.boundaryBinding.boundaryIndex,
            'boundary_rule',
          ),
          side: acceptanceCase.boundaryBinding.side,
          expectedBehavior: acceptanceCase.boundaryBinding.expectedBehavior,
          expectedValue: acceptanceCase.boundaryBinding.expectedValue,
        },
    })),
  }));
}

function compileDeterminismReviewSection(opinion, request, ctx) {
  const { dimensions } = ctx;
  const claimIds = opinion.intentClaims.map((_, index) => generatedId('CLAIM', index));
  const arithmetic = opinion.determinismReview.arithmetic ?? null;
  const architectureContexts = opinion.architectureContexts.map((item) => ({
    tag: indexedValue(request.policy.contexts, item.contextIndex, 'architecture_context').tag,
  }));
  return {
    status: computeDeterminismReviewStatus(dimensions, { arithmetic, architectureContexts }),
    ...(arithmetic !== null ? { arithmetic } : {}),
    rationale: opinion.determinismReview.rationale,
    sourceFragmentIds: ctx.compileFragmentIndexes(opinion.determinismReview.fragmentIndexes),
    coverage: opinion.determinismReview.coverage.map((item) => ({
      claimId: indexedValue(claimIds, item.claimIndex, 'determinism_coverage_claim'),
      disposition: item.disposition,
      dimensions: item.dimensionIndexes.map(ctx.dimensionIdentity),
      rationale: item.rationale,
    })),
    dimensions: dimensions.map((item) => {
      const basis = compileOpinionBasis(item.basis, request);
      const subjectId = item.subject === null
        ? 'PUBLIC_CONTRACT'
        : ctx.compileTargets([item.subject])[0];
      const witness = compileCounterexampleWitness(item.kind, subjectId, item.counterexampleWitness);
      return {
        kind: item.kind,
        subjectId,
        status: item.status,
        rationale: item.rationale,
        targetIds: ctx.compileTargets(item.targets),
        basis,
        closureAuthority: closureAuthorityForDimension({ status: item.status, basis }),
        counterexampleWitness: witness,
        proofObligation: item.proofObligation === null
          ? null
          : {
            ...item.proofObligation,
            witnessId: witness.id,
          },
        inapplicabilityProof: item.inapplicabilityProof,
        acceptanceCaseId: item.acceptanceCase === null
          ? null
          : ctx.compileAcceptanceReference(item.acceptanceCase),
      };
    }),
  };
}

function compileDecisionsSection(opinion, ctx) {
  return opinion.decisions.map((item, decisionIndex) => ({
    ...(item.semanticKey ? { semanticKey: item.semanticKey } : {}),
    questionId: ctx.decisionIds[decisionIndex],
    question: item.question,
    presentation: item.presentation,
    recommendedAnswerId: indexedValue(
      ctx.answerIds[decisionIndex],
      item.recommendedAnswerIndex,
      'recommended_answer',
    ),
    requirementIds: ctx.compileIndexes(item.requirementIndexes, ctx.requirementIds, 'requirement'),
    invariantIds: ctx.compileIndexes(item.invariantIndexes, ctx.invariantIds, 'invariant'),
    riskIds: ctx.compileIndexes(item.riskIndexes, ctx.riskIds, 'risk'),
    distinguishingCase: {
      given: item.distinguishingCase.given,
      when: item.distinguishingCase.when,
      outcomes: item.distinguishingCase.outcomes.map(({ answerIndex, then }) => ({
        answerId: indexedValue(ctx.answerIds[decisionIndex], answerIndex, 'distinguishing_answer'),
        then,
      })),
    },
    answers: item.answers.map((answer, answerIndex) => ({
      id: ctx.answerIds[decisionIndex][answerIndex],
      label: answer.label,
      rationale: answer.rationale,
      contractEffect: answer.contractEffect,
      recommended: answerIndex === item.recommendedAnswerIndex,
    })),
  }));
}

function compilePreparedStateModelPatch(rawStateModel, compiledStateModel) {
  if (!rawStateModel || typeof rawStateModel !== 'object') return undefined;
  const pickPatch = (patch, target) => Object.fromEntries(
    Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([k, value]) => [k, target?.[k] !== undefined ? globalThis.structuredClone(target[k]) : value]),
  );
  const out = {};
  if (Array.isArray(rawStateModel.operations)) {
    out.operations = rawStateModel.operations.map(({ index, patch }) => ({
      index,
      patch: pickPatch(patch, compiledStateModel?.operations?.[index]),
    }));
  }
  if (Array.isArray(rawStateModel.fields)) {
    out.fields = rawStateModel.fields.map(({ entityIndex, fieldIndex, patch }) => ({
      entityIndex,
      fieldIndex,
      patch: pickPatch(patch, compiledStateModel?.entities?.[entityIndex]?.fields?.[fieldIndex]),
    }));
  }
  if (Array.isArray(rawStateModel.observables)) {
    out.observables = rawStateModel.observables.map(({ index, patch }) => ({
      index,
      patch: pickPatch(patch, compiledStateModel?.observables?.[index]),
    }));
  }
  return out;
}

function compilePreparedAnswerEffects(opinion, draft, request) {
  for (const [decisionIndex, decision] of opinion.decisions.entries()) {
    for (const [answerIndex, answer] of decision.answers.entries()) {
      if (answer.preparedEffect == null) continue;
      const variant = globalThis.structuredClone(opinion);
      for (const item of variant.decisions) {
        for (const option of item.answers) delete option.preparedEffect;
      }
      replacePreparedEntries(variant, answer.preparedEffect);
      for (const entry of (answer.preparedEffect.requirements ?? [])) {
        if (!entry.patch?.acceptanceCases) continue;
        for (const acPatch of entry.patch.acceptanceCases) {
          if (variant.requirements[entry.index]?.acceptanceCases[acPatch.index]) {
            variant.requirements[entry.index].acceptanceCases[acPatch.index].decisionBinding = {
              decisionIndex,
              answerIndex,
            };
          }
        }
      }
      const compiled = compileSemanticOpinion(variant, request, false);
      const compiledPrepared = Object.fromEntries(
        effectCollections.map((key) => [key, (answer.preparedEffect[key] ?? []).map((entry) => {
          if (entry.patch === undefined) {
            return { index: entry.index, value: effectCollection(compiled, key)[entry.index] };
          }
          const compiledItem = effectCollection(compiled, key)[entry.index];
          const patch = globalThis.structuredClone(entry.patch);
          if (key === 'requirements' && Array.isArray(patch.acceptanceCases)) {
            patch.acceptanceCases = patch.acceptanceCases.map((acPatch) => ({
              ...acPatch,
              decisionBinding: compiledItem.acceptanceCases[acPatch.index]?.decisionBinding ?? null,
            }));
          }
          if (key === 'dimensions' && patch.acceptanceCase !== undefined) {
            patch.acceptanceCaseId = compiledItem.acceptanceCaseId;
            delete patch.acceptanceCase;
          }
          return { index: entry.index, patch };
        })]),
      );
      if (answer.preparedEffect.interpretation !== undefined) {
        compiledPrepared.interpretation = compiled.interpretation;
      }
      if (answer.preparedEffect.stateModel !== undefined) {
        compiledPrepared.stateModel = compilePreparedStateModelPatch(answer.preparedEffect.stateModel, compiled.stateModel);
      }
      draft.decisions[decisionIndex].answers[answerIndex].preparedEffect = compiledPrepared;
    }
  }
}

let cachedOpinionSchema = null;

function getOpinionSchema() {
  if (cachedOpinionSchema === null) {
    cachedOpinionSchema = standaloneSchemaDocument('aegis.semantic_opinion.v3');
  }
  return cachedOpinionSchema;
}

export function compileSemanticOpinion(opinion, request, compilePrepared = true) {
  if (compilePrepared) {
    assertSchema('aegis.semantic_request.v10', request);
    const { requestDigest, ...requestPayload } = request;
    if (requestDigest !== canonicalDigest(requestPayload)) {
      throw new Error('semantic_request_digest_mismatch');
    }
  }
  // The transport binds the response to this request; the model need not echo custody fields.
  opinion = {
    ...opinion,
    schema: opinion.schema === undefined ? 'aegis.semantic_opinion.v3' : opinion.schema,
    sourceEvidenceDigest: opinion.sourceEvidenceDigest === undefined
      ? request.intentEvidence.evidenceDigest : opinion.sourceEvidenceDigest,
  };
  opinion = normalizeSemanticOpinion(opinion, request);
  omitOptionalNulls(opinion, getOpinionSchema());
  assertSchema('aegis.semantic_opinion.v3', opinion);
  assertEvidenceCoverage(opinion, request);

  const ctx = buildOpinionCompileContext(opinion, request);
  const unclassifiedFragments = [];
  const fragmentDispositions = ctx.fragmentIds.map((fragmentId, fragmentIndex) => {
    const claimIds = opinion.intentClaims.flatMap((claim, claimIndex) => (
      claim.fragmentIndexes.includes(fragmentIndex) ? [generatedId('CLAIM', claimIndex)] : []
    ));
    if (claimIds.length === 0) unclassifiedFragments.push(fragmentIndex);
    return {
      fragmentId,
      status: claimIds.length > 0 ? 'CLAIMS_EXTRACTED' : 'CONTEXT_ONLY',
      claimIds,
      rationale: claimIds.length > 0
        ? 'Derivado mecanicamente das claims que referenciam o fragmento.'
        : 'Nenhuma claim semântica referencia este fragmento.',
    };
  });
  if (unclassifiedFragments.length > 0) {
    throw new Error(`semantic_review_required:unclassified_intent_fragment:${unclassifiedFragments.join(',')}`);
  }
  const draft = {
    schema: 'aegis.semantic_draft.v9',
    sourceContextDigest: request.contextDigest,
    sourceEvidenceDigest: request.intentEvidence.evidenceDigest,
    title: opinion.title,
    interpretation: opinion.interpretation,
    changeKind: opinion.changeKind,
    scope: opinion.scope,
    fragmentDispositions,
    intentClaims: opinion.intentClaims.map((claim, index) => ({
      id: generatedId('CLAIM', index),
      quote: claim.quote,
      sourceFragmentIds: ctx.compileFragmentIndexes(claim.fragmentIndexes),
      kind: claim.kind,
      disposition: claim.disposition,
      contractEffect: claim.contractEffect,
      targetIds: ctx.compileTargets(claim.targets),
      rationale: claim.rationale,
    })),
    nonNormativeItems: opinion.nonNormativeItems.map((item, index) => ({
      id: ctx.noteIds[index],
      kind: item.kind,
      statement: item.statement,
      status: 'NON_NORMATIVE',
      sourceFragmentIds: ctx.compileFragmentIndexes(item.fragmentIndexes),
      basis: compileOpinionBasis(item.basis, request),
    })),
    pathReferences: opinion.pathReferences.map((item, index) => ({
      id: ctx.pathIds[index],
      path: item.path,
      role: item.role,
      rationale: item.rationale,
      requirementIds: ctx.compileIndexes(item.requirementIndexes, ctx.requirementIds, 'requirement'),
      basis: compileOpinionBasis(item.basis, request),
    })),
    architectureContexts: opinion.architectureContexts.map((item) => ({
      tag: indexedValue(request.policy.contexts, item.contextIndex, 'architecture_context').tag,
      rationale: item.rationale,
      basis: compileOpinionBasis(item.basis, request),
    })),
    policyAssessments: opinion.policyAssessments.map((item) => ({
      ruleId: indexedValue(ctx.policyRuleIds, item.ruleIndex, 'policy_rule'),
      demandStatus: item.demandStatus,
      recommendedStatus: item.recommendedStatus,
      rationale: item.rationale,
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(ctx.decisionIds, item.decisionIndex, 'policy_decision'),
      amendmentId: item.amendmentIndex === null
        ? null
        : indexedValue(ctx.amendmentIds, item.amendmentIndex, 'policy_amendment'),
    })),
    complexityReview: {
      ...opinion.complexityReview,
      alternatives: opinion.complexityReview.alternatives.map((item) => ({
        ...item,
        basis: compileOpinionBasis(item.basis, request),
      })),
    },
    requirements: compileRequirementsSection(opinion, request, ctx),
    invariants: opinion.invariants.map((item, index) => ({
      id: ctx.invariantIds[index],
      statement: item.statement,
      falsification: item.falsification,
      ...(item.falsificationSpec != null ? { falsificationSpec: item.falsificationSpec } : {}),
      requirementIds: ctx.compileIndexes(item.requirementIndexes, ctx.requirementIds, 'requirement'),
    })),
    risks: opinion.risks.map((item, index) => ({
      id: ctx.riskIds[index],
      kind: item.kind,
      level: item.level,
      statement: item.statement,
      mitigation: item.mitigation,
      requirementIds: ctx.compileIndexes(item.requirementIndexes, ctx.requirementIds, 'requirement'),
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
        targetIds: ctx.compileTargets(item.targets),
        basis: compileOpinionBasis(item.basis, request),
      })),
    },
    determinismReview: compileDeterminismReviewSection(opinion, request, ctx),
    boundaryRules: opinion.boundaryRules.map((item, index) => ({
      id: ctx.boundaryIds[index],
      subject: item.subject,
      representationKind: item.representationKind,
      lowerBound: item.lowerBound,
      upperBound: item.upperBound,
      underflowBehavior: item.underflowBehavior,
      overflowBehavior: item.overflowBehavior,
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(ctx.decisionIds, item.decisionIndex, 'boundary_decision'),
      requirementIds: ctx.compileIndexes(item.requirementIndexes, ctx.requirementIds, 'requirement'),
      acceptanceCaseIds: item.acceptanceCases.map(ctx.compileAcceptanceReference),
      sourceFragmentIds: ctx.compileFragmentIndexes(item.fragmentIndexes),
      basis: compileOpinionBasis(item.basis, request),
    })),
    unknowns: opinion.unknowns.map((item, index) => ({
      id: generatedId('UNKNOWN', index),
      statement: item.statement,
      material: item.material,
      ...(item.materialEffect === undefined ? {} : { materialEffect: item.materialEffect }),
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(ctx.decisionIds, item.decisionIndex, 'unknown_decision'),
      sourceFragmentIds: ctx.compileFragmentIndexes(item.fragmentIndexes),
      basis: compileOpinionBasis(item.basis, request),
    })),
    decisions: compileDecisionsSection(opinion, ctx),
    stateModel: opinion.stateModel,
  };
  if (compilePrepared) {
    draft.closureCertificate = generateClosureCertificate({
      specification: draft,
      intent: request.intent,
      intentEvidence: request.intentEvidence,
      workspaceEvidence: request.workspace?.sourceEvidence ?? [],
      workspaceSkeleton: request.workspace?.workspaceSkeleton ?? null,
      humanResolutions: [],
    });
    compilePreparedAnswerEffects(opinion, draft, request);
  }
  return draft;
}

const earlyClarificationByteLimit = 5120;

export function compileEarlyClarification(opinion, request, rawBytes = null) {
  assertSchema('aegis.semantic_request.v10', request);
  const { requestDigest, ...requestPayload } = request;
  if (requestDigest !== canonicalDigest(requestPayload)) {
    throw new Error('semantic_request_digest_mismatch');
  }
  if (!opinion || typeof opinion !== 'object' || opinion.schema !== 'aegis.early_clarification_opinion.v1') {
    throw new Error('invalid_early_clarification_schema');
  }
  const byteSize = typeof rawBytes === 'number' ? rawBytes : Buffer.byteLength(canonicalJson(opinion), 'utf8');
  if (byteSize > earlyClarificationByteLimit) {
    throw new Error(`early_clarification_too_large:${byteSize}:${earlyClarificationByteLimit}`);
  }
  if (opinion.sourceEvidenceDigest !== undefined && opinion.sourceEvidenceDigest !== request.intentEvidence.evidenceDigest) {
    throw new Error('semantic_opinion_evidence_mismatch');
  }
  const summary = typeof opinion.summary === 'string' ? opinion.summary.trim() : '';
  if (summary.length === 0) throw new Error('incomplete_early_clarification:missing_summary');
  if (!Array.isArray(opinion.questions) || opinion.questions.length === 0) {
    throw new Error('incomplete_early_clarification:missing_questions');
  }

  const fragments = request.intentEvidence?.fragments ?? [];
  const observedPaths = new Set(request.workspace?.observedTextPaths ?? []);
  const compiledQuestions = [];
  runCollected(opinion.questions.map((item, idx) => () => {
    const q = typeof item?.question === 'string' ? item.question.trim() : '';
    const effect = typeof item?.materialEffect === 'string' ? item.materialEffect.trim() : '';
    if (!q || !effect) throw new Error(`incomplete_early_clarification:question:${idx}`);
    if (!Array.isArray(item.fragmentIndexes) || item.fragmentIndexes.length === 0) {
      throw new Error(`incomplete_early_clarification:fragmentIndexes:${idx}`);
    }
    const sourceFragmentIds = [];
    const sourceFragments = [];
    for (const fragIdx of item.fragmentIndexes) {
      const fragment = fragments[fragIdx];
      if (!fragment) throw new Error(`semantic_opinion_fragment_out_of_range:${fragIdx}`);
      sourceFragmentIds.push(fragment.id);
      sourceFragments.push({ id: fragment.id, text: request.intent.slice(fragment.startOffset, fragment.endOffset) });
    }
    const sourcePaths = Array.isArray(item.sourcePaths) ? item.sourcePaths : [];
    for (const p of sourcePaths) {
      if (typeof p !== 'string' || !observedPaths.has(p)) {
        throw new Error(`invalid_early_clarification_path:${p}`);
      }
    }
    const options = Array.isArray(item.options) && item.options.length > 0
      ? item.options.map((opt, optIdx) => {
        const label = typeof opt?.label === 'string' ? opt.label.trim() : '';
        const optEff = typeof opt?.effect === 'string' ? opt.effect.trim() : '';
        if (!label || !optEff) throw new Error(`incomplete_early_clarification:option:${idx}:${optIdx}`);
        return { label, effect: optEff };
      })
      : null;
    if (options && new Set(options.map((o) => o.effect.toLowerCase())).size !== options.length) {
      throw new Error(`early_clarification_options_not_distinct:${idx}`);
    }
    compiledQuestions.push({
      id: generatedId('ECQ', idx),
      question: q,
      materialEffect: effect,
      sourceFragmentIds: [...new Set(sourceFragmentIds)],
      ...(sourcePaths.length > 0 ? { sourcePaths: [...new Set(sourcePaths)] } : {}),
      ...(options ? { options } : {}),
      sourceFragments,
    });
  }));

  const title = typeof opinion.title === 'string' && opinion.title.trim().length > 0
    ? opinion.title.trim()
    : summary.slice(0, 120);
  return buildQuestionRequest({
    digestSeed: { sourceRequestDigest: requestDigest, summary, questions: compiledQuestions },
    title,
    summary,
    sourceRequestDigest: requestDigest,
    questions: compiledQuestions,
  }, { mode: 'EARLY_CLARIFICATION' });
}
