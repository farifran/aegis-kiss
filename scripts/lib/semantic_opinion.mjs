import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema, standaloneSchemaDocument } from './schema_validator.mjs';
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

export function normalizeSemanticOpinion(opinion, request) {
  opinion = globalThis.structuredClone(opinion);

  const normalizeTarget = (target) => {
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
  };

  if (Array.isArray(opinion.intentClaims)) {
    for (const claim of opinion.intentClaims) {
      if (claim.fragmentIndexes === undefined && request.intentEvidence.fragments.length === 1) {
        claim.fragmentIndexes = [0];
      }
      if (claim.disposition === 'NORMATIVE' && (!Array.isArray(claim.targets) || claim.targets.length === 0) && opinion.requirements?.length === 1) {
        claim.targets = [{ kind: 'REQUIREMENT', index: 0 }];
      }
      if (claim.disposition !== 'NORMATIVE' && claim.contractEffect === undefined) {
        claim.contractEffect = null;
      }
      if (Array.isArray(claim.targets)) {
        for (const target of claim.targets) normalizeTarget(target);
      }
    }
  }

  // 1. architectureContexts: aceita contextTag ou tag além de contextIndex e preenche default
  if (!Array.isArray(opinion.architectureContexts) || opinion.architectureContexts.length === 0) {
    opinion.architectureContexts = [{
      contextIndex: 0,
      rationale: 'Demanda funcional de produto.',
      basis: [{ source: 'USER_INTENT', reference: request.intentEvidence.fragments[0]?.anchor ?? request.intent }],
    }];
  } else {
    for (const item of opinion.architectureContexts) {
      if (item.contextIndex === undefined && (item.contextTag || item.tag)) {
        const tag = item.contextTag || item.tag;
        const index = request.policy.contexts.findIndex((c) => c.tag === tag);
        if (index !== -1) item.contextIndex = index;
      }
      item.basis ??= [{ source: 'USER_INTENT', reference: request.intentEvidence.fragments[0]?.anchor ?? request.intent }];
      delete item.contextTag;
      delete item.tag;
    }
  }

  // 2. policyAssessments: aceita ruleId/id, normaliza CONFLICT->AMENDED e auto-preenche regras COMPLIANT
  opinion.policyAssessments ??= [];
  for (const assessment of opinion.policyAssessments) {
    if (assessment.ruleIndex === undefined && (assessment.ruleId || assessment.id)) {
      const id = assessment.ruleId || assessment.id;
      const index = request.policy.rules.findIndex((r) => r.id === id);
      if (index !== -1) assessment.ruleIndex = index;
    }
    delete assessment.ruleId;
    delete assessment.id;
    if (assessment.recommendedStatus === 'CONFLICT') {
      assessment.recommendedStatus = 'AMENDED';
    }
    assessment.recommendedStatus ??= 'COMPLIANT';
    assessment.demandStatus ??= assessment.recommendedStatus === 'AMENDED' ? 'CONFLICT' : (assessment.recommendedStatus ?? 'COMPLIANT');
    assessment.decisionIndex ??= null;
    assessment.amendmentIndex ??= null;
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
  if (applicableRuleIndexes.some((idx) => !existingByRuleIndex.has(idx))) {
    const mergedAssessments = [];
    for (const idx of applicableRuleIndexes) {
      if (existingByRuleIndex.has(idx)) {
        mergedAssessments.push(existingByRuleIndex.get(idx));
        existingByRuleIndex.delete(idx);
      } else {
        mergedAssessments.push({
          ruleIndex: idx,
          demandStatus: 'COMPLIANT',
          recommendedStatus: 'COMPLIANT',
          rationale: `Conformidade verificada mecanicamente para ${request.policy.rules[idx].id}.`,
          decisionIndex: null,
          amendmentIndex: null,
        });
      }
    }
    for (const extra of existingByRuleIndex.values()) {
      mergedAssessments.push(extra);
    }
    opinion.policyAssessments = mergedAssessments;
  }

  // 3. determinismReview: aceita claimId além de claimIndex, e preenche cobertura default
  opinion.determinismReview ??= {
    rationale: 'A demanda não promete determinismo adicional além do contrato público.',
    dimensions: [],
    coverage: [],
  };
  delete opinion.determinismReview.promiseInDemand;
  delete opinion.determinismReview.status;
  delete opinion.determinismReview.sourceFragmentIds;
  opinion.determinismReview.dimensions ??= [];
  for (const dim of opinion.determinismReview.dimensions) {
    dim.status ??= 'SPECIFIED';
    if (dim.subject === undefined && opinion.requirements?.length === 1) {
      dim.subject = { kind: 'REQUIREMENT', index: 0 };
    }
    if (dim.targets === undefined && opinion.requirements?.length === 1) {
      dim.targets = [{ kind: 'REQUIREMENT', index: 0 }];
    }
    if (dim.subject && typeof dim.subject === 'object') normalizeTarget(dim.subject);
    if (Array.isArray(dim.targets)) {
      for (const target of dim.targets) normalizeTarget(target);
    }
    dim.inapplicabilityProof ??= null;
    if (dim.proofObligation && typeof dim.proofObligation === 'object') {
      dim.proofObligation.boundaryInclusivity ??= null;
    }
  }
  const materialFragmentIndexes = Array.isArray(opinion.intentClaims)
    ? [...new Set(
      opinion.intentClaims
        .filter((c) => c.disposition === 'NORMATIVE' || c.disposition === 'DECISION')
        .flatMap((c) => c.fragmentIndexes ?? [0]),
    )]
    : [];
  opinion.determinismReview.fragmentIndexes ??= materialFragmentIndexes.length > 0
    ? materialFragmentIndexes
    : request.intentEvidence.fragments.map((_, i) => i);
  opinion.determinismReview.coverage ??= [];
  for (const coverage of opinion.determinismReview.coverage) {
    if (coverage.claimIndex === undefined && coverage.claimId) {
      const parsed = parseInt(String(coverage.claimId).replace(/\D/g, ''), 10) - 1;
      if (!Number.isNaN(parsed)) coverage.claimIndex = parsed;
    }
    delete coverage.claimId;
    delete coverage.dimensionAssessments;
    coverage.dimensionIndexes ??= [];
    if (coverage.disposition === undefined) {
      coverage.disposition = coverage.dimensionIndexes.length > 0 ? 'DIMENSIONS_DECLARED' : 'NO_DIMENSION_APPLICABLE';
    }
  }
  if (Array.isArray(opinion.intentClaims)) {
    opinion.determinismReview.coverage = opinion.determinismReview.coverage.filter((coverage) => {
      const claim = opinion.intentClaims[coverage.claimIndex];
      if (!claim) return true;
      const isMaterial = claim.disposition === 'NORMATIVE' || claim.disposition === 'DECISION';
      return isMaterial || coverage.disposition !== 'NO_DIMENSION_APPLICABLE';
    });
    const coveredClaimIndexes = new Set(opinion.determinismReview.coverage.map((c) => c.claimIndex));
    let inserted = false;
    opinion.intentClaims.forEach((claim, claimIndex) => {
      const isMaterial = claim.disposition === 'NORMATIVE' || claim.disposition === 'DECISION';
      if (isMaterial && !coveredClaimIndexes.has(claimIndex)) {
        opinion.determinismReview.coverage.push({
          claimIndex,
          disposition: 'NO_DIMENSION_APPLICABLE',
          dimensionIndexes: [],
          rationale: 'Afirmação funcional sem fonte adicional de indeterminismo.',
        });
        inserted = true;
      }
    });
    if (inserted) {
      opinion.determinismReview.coverage.sort((a, b) => a.claimIndex - b.claimIndex);
    }
  }

  // 4. Parâmetros e campos de stateModel: normalizações, propagação de bounds e auto-derivação de transições
  if (opinion.stateModel) {
    const allEntityFieldKeys = [];
    if (Array.isArray(opinion.stateModel.entities)) {
      for (const entity of opinion.stateModel.entities) {
        if (Array.isArray(entity.fields)) {
          for (const field of entity.fields) {
            allEntityFieldKeys.push(`${entity.name}.${field.name}`);
          }
        }
      }
    }
    if (Array.isArray(opinion.stateModel.operations)) {
      for (const op of opinion.stateModel.operations) {
        op.parameters ??= [];
        op.guardPrecedence ??= [];
        for (const param of op.parameters) {
          if (param.nullability === 'NON_NULLABLE') {
            param.nullability = 'NOT_NULL';
          }
        }
        if (Array.isArray(op.branches)) {
          for (const branch of op.branches) {
            branch.stateEffects ??= [];
            for (const eff of branch.stateEffects) {
              if (eff.effect === 'SET_VALUE') eff.effect = 'SET';
            }
            branch.defaultPreservation ??= branch.outcomeKind === 'REJECTION' || branch.stateEffects.length === 0;
            if (branch.defaultPreservation === false && allEntityFieldKeys.length > 0) {
              const covered = new Set(branch.stateEffects.map((e) => e.field));
              for (const fieldKey of allEntityFieldKeys) {
                const shortName = fieldKey.split('.').slice(1).join('.');
                if (!covered.has(fieldKey) && !covered.has(shortName)) {
                  branch.stateEffects.push({ field: fieldKey, effect: 'PRESERVE' });
                }
              }
            }
          }
        }
      }
    }
    if (Array.isArray(opinion.stateModel.entities)) {
      for (const entity of opinion.stateModel.entities) {
        if (entity.isCollection === true && entity.capacityPolicy) {
          entity.admissionPolicy ??= 'ON_FIRST_REQUEST';
          if (
            entity.containerPolicy === undefined
            && ['FIFO_EVICTION', 'LRU_EVICTION', 'SLIDING_WINDOW_EVICTION'].includes(entity.capacityPolicy.overflowPolicy)
          ) {
            entity.containerPolicy = {
              partitionKey: 'id',
              retentionPolicy: entity.capacityPolicy.overflowPolicy,
            };
          }
        }
        if (Array.isArray(entity.fields)) {
          for (const field of entity.fields) {
            const fieldKey = `${entity.name}.${field.name}`;
            if (
              field.bounds === undefined
              && entity.isCollection === true
              && entity.capacityPolicy?.maxEntries != null
              && (field.type === 'COLLECTION' || field.isCounter === true)
            ) {
              field.bounds = {
                lowerBound: '0',
                upperBound: String(entity.capacityPolicy.maxEntries),
                boundaryBehavior: 'SATURATE',
                ...(entity.capacityPolicy.provenance
                  ? { provenance: structuredClone(entity.capacityPolicy.provenance) }
                  : {}),
              };
            }
            if (Array.isArray(field.mutations)) {
              for (const mut of field.mutations) {
                if (mut.effect === 'SET') mut.effect = 'SET_VALUE';
                mut.targetValue ??= null;
              }
            } else {
              field.mutations = [];
              for (const op of opinion.stateModel.operations ?? []) {
                for (const branch of op.branches ?? []) {
                  for (const eff of branch.stateEffects ?? []) {
                    if ((eff.field === fieldKey || eff.field === field.name) && eff.effect && eff.effect !== 'PRESERVE') {
                      field.mutations.push({
                        operation: op.name,
                        condition: branch.condition ?? branch.branchId,
                        effect: eff.effect === 'SET' ? 'SET_VALUE' : eff.effect,
                        targetValue: eff.value ?? null,
                      });
                    }
                  }
                }
              }
            }
            if (field.reset) {
              field.reset.trigger ??= null;
              field.reset.resetValue ??= null;
            } else {
              field.reset = { allowed: false, trigger: null, resetValue: null };
            }
            field.preservation ??= ['*'];
            if (!Array.isArray(field.readBy) || field.readBy.length === 0) {
              const readers = new Set();
              for (const op of opinion.stateModel.operations ?? []) {
                const touches = (op.branches ?? []).some((b) => (
                  (typeof b.condition === 'string' && (b.condition.includes(fieldKey) || b.condition.includes(field.name)))
                  || (b.stateEffects ?? []).some((eff) => eff.field === fieldKey || eff.field === field.name)
                ));
                if (touches || (op.branches ?? []).every((b) => b.defaultPreservation === true)) {
                  readers.add(op.name);
                }
              }
              for (const obs of opinion.stateModel.observables ?? []) {
                if ((obs.derivedFrom ?? []).some((d) => d === fieldKey || d === field.name || d === '*')) {
                  readers.add(obs.name);
                }
              }
              field.readBy = [...readers];
            }
          }
        }
      }
    }
  }

  // 5. Invariants, decisions, unknowns e requirements defaults
  const defaultFragmentIndexes = request.intentEvidence.fragments.map((_, i) => i);
  const normalizeRequirementItem = (req) => {
    if (!req || typeof req !== 'object') return;
    req.kind ??= 'FUNCTIONAL';
    req.measurement ??= null;
    req.fragmentIndexes ??= defaultFragmentIndexes;
    if (Array.isArray(req.acceptanceCases)) {
      for (const ac of req.acceptanceCases) {
        if (ac.kind === 'STATE_CHANGE') {
          ac.outcomeKind ??= 'STATE_CHANGE';
          ac.kind = 'BOUNDARY';
        }
        ac.decisionBinding ??= null;
        ac.boundaryBinding ??= null;
      }
    }
  };
  if (Array.isArray(opinion.decisions)) {
    for (const dec of opinion.decisions) {
      dec.recommendedAnswerIndex ??= 0;
      dec.requirementIndexes ??= [0];
      dec.invariantIndexes ??= [];
      dec.riskIndexes ??= [];
      if (dec.presentation && typeof dec.presentation === 'object') {
        dec.presentation.glossary ??= [];
      }
      if (Array.isArray(dec.answers)) {
        for (const ans of dec.answers) {
          if (ans.preparedEffect && typeof ans.preparedEffect === 'object') {
            ans.preparedEffect.requirements ??= [];
            ans.preparedEffect.invariants ??= [];
            ans.preparedEffect.risks ??= [];
            ans.preparedEffect.boundaryRules ??= [];
            ans.preparedEffect.dimensions ??= [];
            for (const entry of ans.preparedEffect.requirements) {
              if (entry.value) normalizeRequirementItem(entry.value);
            }
          }
        }
      }
    }
    if (opinion.unknowns === undefined && opinion.decisions.length > 0 && Array.isArray(opinion.intentClaims)) {
      opinion.unknowns = [];
      opinion.intentClaims.forEach((claim) => {
        if (claim.disposition === 'DECISION') {
          const decTargets = (claim.targets ?? []).filter((t) => t.kind === 'DECISION');
          const indexes = decTargets.length > 0 ? decTargets.map((t) => t.index ?? 0) : [0];
          for (const decisionIndex of indexes) {
            opinion.unknowns.push({
              statement: claim.rationale || claim.quote,
              material: true,
              decisionIndex,
              fragmentIndexes: claim.fragmentIndexes ?? [0],
              basis: [{ source: 'USER_INTENT', reference: claim.quote }],
            });
          }
        }
      });
    }
  }
  if (Array.isArray(opinion.invariants)) {
    for (const inv of opinion.invariants) {
      if (inv.requirementIndexes === undefined && Array.isArray(inv.targetRequirementIndexes)) {
        inv.requirementIndexes = inv.targetRequirementIndexes;
      }
      delete inv.targetRequirementIndexes;
      inv.requirementIndexes ??= [0];
    }
  }
  opinion.adversarialReview ??= { rationale: 'Revisão semântica residual sem achados adicionais.', findings: [] };
  delete opinion.adversarialReview.status;
  opinion.adversarialReview.findings ??= [];
  if (Array.isArray(opinion.requirements)) {
    for (const req of opinion.requirements) {
      normalizeRequirementItem(req);
    }
  }

  opinion.riskReview ??= { certainty: 'ASSESSED', rationale: 'Nenhum risco material adicional identificado.' };
  opinion.unknowns ??= [];
  opinion.decisions ??= [];
  opinion.boundaryRules ??= [];
  opinion.nonNormativeItems ??= [];
  opinion.pathReferences ??= [];
  opinion.risks ??= [];
  opinion.complexityReview ??= {
    status: 'NO_EXCESS',
    rationale: 'A especificação adota a menor solução suficiente sem abstrações especulativas.',
    alternatives: [],
  };
  opinion.complexityReview.alternatives ??= [];

  return opinion;
}

export function compileSemanticOpinion(opinion, request, compilePrepared = true) {
  assertSchema('aegis.semantic_request.v10', request);
  const { requestDigest, ...requestPayload } = request;
  if (requestDigest !== canonicalDigest(requestPayload)) {
    throw new Error('semantic_request_digest_mismatch');
  }
  // The transport binds the response to this request; the model need not echo custody fields.
  opinion = {
    ...opinion,
    schema: opinion.schema === undefined ? 'aegis.semantic_opinion.v3' : opinion.schema,
    sourceEvidenceDigest: opinion.sourceEvidenceDigest === undefined
      ? request.intentEvidence.evidenceDigest : opinion.sourceEvidenceDigest,
  };
  opinion = normalizeSemanticOpinion(opinion, request);
  omitOptionalNulls(opinion, standaloneSchemaDocument('aegis.semantic_opinion.v3'));
  assertSchema('aegis.semantic_opinion.v3', opinion);
  assertEvidenceCoverage(opinion, request);

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
  const fragmentIds = request.intentEvidence.fragments.map(({ id }) => id);
  const compileFragmentIndexes = (indexes) => compileIndexes(indexes, fragmentIds, 'fragment');
  const dimensionIdentity = (dimensionIndex) => {
    const dimension = indexedValue(dimensions, dimensionIndex, 'determinism_coverage_dimension');
    return {
      kind: dimension.kind,
      subjectId: dimension.subject === null
        ? 'PUBLIC_CONTRACT'
        : compileTargets([dimension.subject])[0],
    };
  };

  const draft = {
    schema: 'aegis.semantic_draft.v9',
    sourceContextDigest: request.contextDigest,
    sourceEvidenceDigest: request.intentEvidence.evidenceDigest,
    title: opinion.title,
    interpretation: opinion.interpretation,
    changeKind: opinion.changeKind,
    scope: opinion.scope,
    fragmentDispositions: fragmentIds.map((fragmentId, fragmentIndex) => {
      const claimIds = opinion.intentClaims.flatMap((claim, claimIndex) => (
        claim.fragmentIndexes.includes(fragmentIndex) ? [generatedId('CLAIM', claimIndex)] : []
      ));
      return {
        fragmentId,
        status: claimIds.length > 0 ? 'CLAIMS_EXTRACTED' : 'CONTEXT_ONLY',
        claimIds,
        rationale: claimIds.length > 0
          ? 'Derivado mecanicamente das claims que referenciam o fragmento.'
          : 'Nenhuma claim semântica referencia este fragmento.',
      };
    }),
    intentClaims: opinion.intentClaims.map((claim, index) => ({
      id: generatedId('CLAIM', index),
      quote: claim.quote,
      sourceFragmentIds: compileFragmentIndexes(claim.fragmentIndexes),
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
      sourceFragmentIds: compileFragmentIndexes(item.fragmentIndexes),
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
      sourceFragmentIds: compileFragmentIndexes(requirement.fragmentIndexes),
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
      sourceFragmentIds: compileFragmentIndexes(opinion.determinismReview.fragmentIndexes),
      coverage: opinion.determinismReview.coverage.map((item) => ({
        claimId: indexedValue(
          opinion.intentClaims.map((_, index) => generatedId('CLAIM', index)),
          item.claimIndex,
          'determinism_coverage_claim',
        ),
        disposition: item.disposition,
        dimensions: item.dimensionIndexes.map(dimensionIdentity),
        rationale: item.rationale,
      })),
      dimensions: dimensions.map((item) => {
        const basis = compileOpinionBasis(item.basis, request);
        const subjectId = item.subject === null
          ? 'PUBLIC_CONTRACT'
          : compileTargets([item.subject])[0];
        const witness = compileCounterexampleWitness(item.kind, subjectId, item.counterexampleWitness);
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
      sourceFragmentIds: compileFragmentIndexes(item.fragmentIndexes),
      basis: compileOpinionBasis(item.basis, request),
    })),
    unknowns: opinion.unknowns.map((item, index) => ({
      id: generatedId('UNKNOWN', index),
      statement: item.statement,
      material: item.material,
      decisionId: item.decisionIndex === null
        ? null
        : indexedValue(decisionIds, item.decisionIndex, 'unknown_decision'),
      sourceFragmentIds: compileFragmentIndexes(item.fragmentIndexes),
      basis: compileOpinionBasis(item.basis, request),
    })),
    decisions: opinion.decisions.map((item, decisionIndex) => ({
      ...(item.semanticKey ? { semanticKey: item.semanticKey } : {}),
      questionId: decisionIds[decisionIndex],
      question: item.question,
      presentation: item.presentation,
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
    stateModel: opinion.stateModel ?? {
      entities: [],
      operations: [],
      observables: [],
    },
  };
  draft.closureCertificate = generateClosureCertificate({
    specification: {
      ...draft,
      literalFacts: request.intentEvidence?.literalFacts ?? [],
      intentEvidence: request.intentEvidence,
      workspaceEvidence: request.workspace?.sourceEvidence ?? [],
    },
    humanResolutions: [],
  });
  if (compilePrepared) {
    for (const [decisionIndex, decision] of opinion.decisions.entries()) {
      for (const [answerIndex, answer] of decision.answers.entries()) {
        if (answer.preparedEffect == null) continue;
        const variant = globalThis.structuredClone(opinion);
        for (const item of variant.decisions) {
          for (const option of item.answers) delete option.preparedEffect;
        }
        replacePreparedEntries(variant, answer.preparedEffect);
        for (const entry of (answer.preparedEffect.requirements ?? [])) {
          if (entry.patch?.acceptanceCases) {
            for (const acPatch of entry.patch.acceptanceCases) {
              if (variant.requirements[entry.index]?.acceptanceCases[acPatch.index]) {
                variant.requirements[entry.index].acceptanceCases[acPatch.index].decisionBinding = {
                  decisionIndex,
                  answerIndex,
                };
              }
            }
          }
        }
        const compiled = compileSemanticOpinion(variant, request, false);
        draft.decisions[decisionIndex].answers[answerIndex].preparedEffect = Object.fromEntries(
          effectCollections.map((key) => [key, (answer.preparedEffect[key] ?? []).map((entry) => ({
            index: entry.index,
            value: effectCollection(compiled, key)[entry.index],
          }))]),
        );
      }
    }
  }
  return draft;
}
