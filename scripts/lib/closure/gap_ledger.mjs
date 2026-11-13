import { validateProvenanceEnforcement } from './provenance.mjs';
import {
  validateDecisionsWitness,
  validateFieldLifecycle,
  validateSemanticInventoryCoverage,
} from './state_lifecycle.mjs';
import {
  CLOSED_KEY_NORMALIZATION_RULES,
  CLOSED_QUOTIENT_POLICIES,
  CLOSED_REMAINDER_POLICIES,
  findIntegerArithmeticCompileError,
} from './v7_rules.mjs';

const GAP_KIND_MAP = {
  UNRESOLVED_TRANSITION: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason || `Operação '${i.operation || i.slotId}' não define transição para todas as condições.`],
  UNRESOLVED_GUARD_PRECEDENCE: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason || `Operação '${i.operation || i.slotId}' possui múltiplos guards sem precedência linear estrita.`],
  MISSING_GUARD_REJECTION_BRANCH: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason || 'Guard de rejeição sem ramo correspondente em branches.'],
  UNDETERMINED_BRANCH_NEXT_STATE: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason || 'Ramo de operação possui próximo estado não determinado.'],
  MISSING_SUCCESS_BRANCH: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason || 'Operação sem ramo explícito de autorização/sucesso.'],
  CONFLICTING_STATE_DECLARATIONS: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  CONTRADICTORY_RULE_DETECTED: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Contradição ativa detectada entre invariantes, requisitos e operações.'],
  EXTERNAL_EFFECT_COVERAGE_MISSING: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.'],
  INCOMPLETE_EXTERNAL_EFFECT: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.'],
  TRANSACTION_ROLLBACK_MISSING: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.'],
  UNRESOLVED_RETURN_CONTRACT: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Contrato de retorno ou protocolo de erro da operação incompleto.'],
  INVALID_SEMANTIC_KEY: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason],
  INCOMPLETE_STATUS_PARTITION: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason],
  MISSING_EVALUATED_INPUTS: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  MISSING_ADDITIONAL_PROPERTIES_POLICY: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason],
  MISSING_BRANCH_ACCEPTANCE_REF: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  INCOMPLETE_BATCH_POLICY_OR_WITNESS: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason],
  MISSING_OR_INVALID_CROSS_OPERATION_WITNESS: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  INVALID_KEY_NORMALIZATION_OR_WITNESS: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason],

  UNRESOLVED_OBSERVABLE_DEPENDENCY: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Observável depende de campo inexistente no modelo de estado.'],
  UNRESOLVED_OBSERVABLE_REPRESENTATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Observável sem representação finita explícita.'],
  UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Observável sem comportamento definido para coleção vazia.'],
  INVALID_BITMASK_ALLOCATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Alocação de bits sobreposta ou fora dos limites do tipo.'],
  UNRESOLVED_CANONICAL_SERIALIZATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason || 'Perfil de serialização canônica ausente para demanda de integridade.'],
  MISSING_CANONICAL_SERIALIZATION_INVENTORY: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason || 'Perfil de serialização canônica ausente para demanda de integridade.'],

  UNAUTHORIZED_NUMERIC_LITERAL: ['AUTHORITY_PROVENANCE', 'USER_INTENT', (i) => i.reason],
  UNAUTHORIZED_GUARD_OR_ERROR_CODE: ['AUTHORITY_PROVENANCE', 'USER_INTENT', (i) => i.reason || 'Guarda ou código de erro sem fundamentação na intenção, workspace ou governança.'],
  UNAUTHORIZED_SYMBOLIC_COMPARISON: ['AUTHORITY_PROVENANCE', 'USER_INTENT', (i) => i.reason],
  MATERIAL_UNKNOWN_GAP: ['AUTHORITY_PROVENANCE', 'USER_DECISION', (i) => i.reason || 'Lacuna material sem proveniência resolvida e sem decisão vinculada.'],
  DETERMINISM_GAP: ['AUTHORITY_PROVENANCE', 'USER_DECISION', (i) => i.reason || 'Dimensão de determinismo com GAP_FOUND.'],

  MISSING_STATEFUL_ENTITY_INVENTORY: ['COVERAGE_ACCOUNTING', 'ARCHITECTURE_POLICY', (i) => i.reason],
  MISSING_BOUNDED_OBSERVABILITY_INVENTORY: ['COVERAGE_ACCOUNTING', 'ARCHITECTURE_POLICY', (i) => i.reason],
  UNRESOLVED_STATE_MODEL: ['COVERAGE_ACCOUNTING', 'ARCHITECTURE_POLICY', (i) => i.reason],
  UNRESOLVED_FIELD_BOUNDS: ['COVERAGE_ACCOUNTING', 'ARCHITECTURE_POLICY', (i) => i.reason],
  UNRESOLVED_COLLECTION_CAPACITY: ['COVERAGE_ACCOUNTING', 'ARCHITECTURE_POLICY', (i) => i.reason],
  UNRESOLVED_CONTAINER_POLICY: ['COVERAGE_ACCOUNTING', 'ARCHITECTURE_POLICY', (i) => i.reason],
  UNRESOLVED_INITIALIZATION: ['COVERAGE_ACCOUNTING', 'USER_DECISION', (i) => i.reason],
  UNRESOLVED_RESET: ['COVERAGE_ACCOUNTING', 'USER_DECISION', (i) => i.reason],
  UNRESOLVED_COLLECTION_ADMISSION: ['COVERAGE_ACCOUNTING', 'USER_DECISION', (i) => i.reason],
  PENDING_HUMAN_DECISION: ['COVERAGE_ACCOUNTING', 'USER_DECISION', (i) => i.reason],
  ORPHAN_STATE_FIELD: ['COVERAGE_ACCOUNTING', 'USER_INTENT', (i) => i.reason],
  MISSING_PRODUCER_OPERATION: ['COVERAGE_ACCOUNTING', 'USER_INTENT', (i) => i.reason],

  OPEN_COMPUTATIONAL_DEPENDENCY: ['COMPUTABILITY_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Dependência semântica necessária para computabilidade não foi encontrada ou fundamentada.'],
  OPEN_ARITHMETIC_DECISION: ['COMPUTABILITY_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason],

  INVERTED_INVARIANT_FALSIFICATION: ['AUDIT_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  DUPLICATE_CONTRACT_IDENTIFIER: ['AUDIT_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  BROKEN_CONTRACT_REFERENCE: ['AUDIT_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  AMBIGUOUS_SCENARIO_OUTCOME: ['AUDIT_CONSISTENCY', 'CONSTITUTION', (i) => i.reason],
  CLOSED_POLICY_ENUM_VIOLATION: ['AUDIT_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason],
};

function runIndependentClosureAudit({
  specification,
  resolvedDecisionIds,
  pendingDecisions,
  determinismDecisions,
  stateLifecycleIssues,
  provenanceIssues,
  inventoryIssues,
}) {
  const defects = [];
  const auditItems = [];
  const requirements = specification.requirements ?? [];
  const invariants = specification.invariants ?? [];
  const risks = specification.risks ?? [];
  const boundaryRules = specification.boundaries?.boundaryRules ?? specification.boundaryRules ?? [];
  const decisions = specification.decisions ?? [];
  const unknowns = specification.unknowns ?? [];

  // 1. Unicidade de IDs transversais
  const seenIds = new Set();
  const trackUniqueId = (id, label) => {
    if (typeof id !== 'string' || id.trim().length === 0) return;
    if (seenIds.has(id)) {
      defects.push({
        slotId: `audit/duplicateId/${id}`,
        kind: 'DUPLICATE_CONTRACT_IDENTIFIER',
        reason: `Identificador duplicado '${id}' detectado em ${label}.`,
      });
    }
    seenIds.add(id);
  };
  for (const r of requirements) {
    trackUniqueId(r.id, 'requirements');
    for (const ac of r.acceptanceCases ?? []) trackUniqueId(ac.id, `requirements/${r.id}/acceptanceCases`);
  }
  for (const inv of invariants) trackUniqueId(inv.id, 'invariants');
  for (const b of boundaryRules) trackUniqueId(b.id, 'boundaryRules');
  for (const risk of risks) trackUniqueId(risk.id, 'risks');
  for (const d of decisions) trackUniqueId(d.questionId, 'decisions');
  for (const u of unknowns) trackUniqueId(u.id, 'unknowns');

  // 2. Integridade de referências e cenário observável único
  const reqIds = new Set(requirements.map((r) => r.id).filter(Boolean));
  const acIds = new Set(requirements.flatMap((r) => (r.acceptanceCases ?? []).map((ac) => ac.id).filter(Boolean)));
  const boundIds = new Set(boundaryRules.map((b) => b.id).filter(Boolean));

  if (reqIds.size > 0) {
    for (const inv of invariants) {
      for (const reqId of inv.requirementIds ?? []) {
        if (!reqIds.has(reqId)) {
          defects.push({
            slotId: `audit/reference/${inv.id}/${reqId}`,
            kind: 'BROKEN_CONTRACT_REFERENCE',
            reason: `Invariante '${inv.id}' referencia requisito inexistente '${reqId}'.`,
          });
        }
      }
    }
    for (const risk of risks) {
      for (const reqId of risk.requirementIds ?? []) {
        if (!reqIds.has(reqId)) {
          defects.push({
            slotId: `audit/reference/${risk.id}/${reqId}`,
            kind: 'BROKEN_CONTRACT_REFERENCE',
            reason: `Risco '${risk.id}' referencia requisito inexistente '${reqId}'.`,
          });
        }
      }
    }
  }
  for (const bound of boundaryRules) {
    if (reqIds.size > 0) {
      for (const reqId of bound.requirementIds ?? []) {
        if (!reqIds.has(reqId)) {
          defects.push({
            slotId: `audit/reference/${bound.id}/${reqId}`,
            kind: 'BROKEN_CONTRACT_REFERENCE',
            reason: `Regra de fronteira '${bound.id}' referencia requisito inexistente '${reqId}'.`,
          });
        }
      }
    }
    if (acIds.size > 0) {
      for (const acId of bound.acceptanceCaseIds ?? []) {
        if (!acIds.has(acId)) {
          defects.push({
            slotId: `audit/reference/${bound.id}/${acId}`,
            kind: 'BROKEN_CONTRACT_REFERENCE',
            reason: `Regra de fronteira '${bound.id}' referencia caso de aceitação inexistente '${acId}'.`,
          });
        }
      }
    }
  }
  for (const r of requirements) {
    for (const ac of r.acceptanceCases ?? []) {
      if (boundIds.size > 0 && ac.boundaryBinding?.ruleId && !boundIds.has(ac.boundaryBinding.ruleId)) {
        defects.push({
          slotId: `audit/reference/${ac.id}/${ac.boundaryBinding.ruleId}`,
          kind: 'BROKEN_CONTRACT_REFERENCE',
          reason: `Caso de aceitação '${ac.id}' referencia boundaryRule inexistente '${ac.boundaryBinding.ruleId}'.`,
        });
      }
      if (ac.outcomeKind !== undefined) {
        const validSingle = typeof ac.outcomeKind === 'string'
          && /^[A-Z][A-Z0-9_]*$/u.test(ac.outcomeKind.trim());
        if (!validSingle) {
          defects.push({
            slotId: `audit/singleOutcome/${ac.id ?? 'case'}`,
            kind: 'AMBIGUOUS_SCENARIO_OUTCOME',
            reason: `Caso de aceitação '${ac.id ?? 'case'}' deve declarar um único outcomeKind observável inequívoco.`,
          });
        }
      }
    }
  }

  // 3. Políticas em enum fechado e aritmética inteira
  const arithmetic = specification.determinismReview?.arithmetic ?? null;
  if (arithmetic) {
    if (arithmetic.numericRepresentation !== undefined && arithmetic.numericRepresentation !== null
      && arithmetic.numericRepresentation !== 'BIGINT_EXACT'
      && arithmetic.numericRepresentation !== 'SAFE_INTEGER_BOUNDED') {
      defects.push({
        slotId: 'audit/arithmetic/numericRepresentation',
        kind: 'CLOSED_POLICY_ENUM_VIOLATION',
        reason: `numericRepresentation inválido '${arithmetic.numericRepresentation}'.`,
      });
    }
    if (arithmetic.quotientPolicy !== undefined && arithmetic.quotientPolicy !== null
      && !CLOSED_QUOTIENT_POLICIES.has(arithmetic.quotientPolicy)) {
      defects.push({
        slotId: 'audit/arithmetic/quotientPolicy',
        kind: 'CLOSED_POLICY_ENUM_VIOLATION',
        reason: `quotientPolicy inválido ou vedado '${arithmetic.quotientPolicy}' (esperado enum inteiro fechado, sem DECIMAL_BOUNDED).`,
      });
    }
    if (arithmetic.remainderPolicy !== undefined && arithmetic.remainderPolicy !== null
      && !CLOSED_REMAINDER_POLICIES.has(arithmetic.remainderPolicy)) {
      defects.push({
        slotId: 'audit/arithmetic/remainderPolicy',
        kind: 'CLOSED_POLICY_ENUM_VIOLATION',
        reason: `remainderPolicy inválido '${arithmetic.remainderPolicy}'.`,
      });
    }
  }
  const arithmeticCompileErr = findIntegerArithmeticCompileError(specification, resolvedDecisionIds);
  if (arithmeticCompileErr) {
    defects.push({
      slotId: 'audit/arithmetic/compileError',
      kind: 'OPEN_ARITHMETIC_DECISION',
      reason: `Fechamento aritmético incompleto: ${arithmeticCompileErr}.`,
    });
  }
  for (const op of specification.stateModel?.operations ?? []) {
    if (op.keyNormalizationPolicy != null && !CLOSED_KEY_NORMALIZATION_RULES.has(op.keyNormalizationPolicy)) {
      defects.push({
        slotId: `audit/operation/${op.name}/keyNormalizationPolicy`,
        kind: 'CLOSED_POLICY_ENUM_VIOLATION',
        reason: `keyNormalizationPolicy inválido '${op.keyNormalizationPolicy}' na operação '${op.name}'.`,
      });
    }
  }

  // 4. Direção de falsificação dos invariantes + classificação tripartite
  for (const inv of invariants) {
    const invId = inv.id || 'INV-UNNAMED';
    if (typeof inv.falsification !== 'string' || inv.falsification.trim().length === 0) {
      defects.push({
        slotId: `audit/invariant/${invId}/falsification`,
        kind: 'INVERTED_INVARIANT_FALSIFICATION',
        reason: `Invariante '${invId}' não declara critério de falsificação.`,
      });
      continue;
    }
    if (inv.falsificationSpec?.polarity === 'CONFIRMATION') {
      defects.push({
        slotId: `audit/invariant/${invId}/falsificationDirection`,
        kind: 'INVERTED_INVARIANT_FALSIFICATION',
        reason: `Invariante '${invId}' traz critério de falsificação invertido (polarity='CONFIRMATION' descreve confirmação em vez de violação observável).`,
      });
      continue;
    }
    if (inv.falsificationSpec?.polarity === 'VIOLATION') {
      const obsEffect = inv.falsificationSpec.observableEffect ?? inv.falsificationSpec.observableFailure;
      if (typeof obsEffect !== 'string' || obsEffect.trim().length === 0) {
        defects.push({
          slotId: `audit/invariant/${invId}/observableEffect`,
          kind: 'INVERTED_INVARIANT_FALSIFICATION',
          reason: `Invariante '${invId}' declara falsificationSpec.polarity='VIOLATION' sem observableEffect não vazio.`,
        });
        continue;
      }
      auditItems.push({
        itemId: `audit:${invId}`,
        classification: 'SEMANTIC_REVIEW_REQUIRED',
        category: 'INVARIANT_FALSIFICATION',
        summary: `A forma do falsificationSpec foi validada; confirme que o efeito descrito realmente contradiz o invariante '${invId}'.`,
      });
    } else {
      auditItems.push({
        itemId: `audit:${invId}`,
        classification: 'SEMANTIC_REVIEW_REQUIRED',
        category: 'INVARIANT_FALSIFICATION',
        summary: `Invariante '${invId}' requer revisão semântica humana quanto à violação falsificável em prosa.`,
      });
    }
  }

  for (const r of requirements) {
    for (const ac of r.acceptanceCases ?? []) {
      if (ac.crossOperationWitness != null) {
        auditItems.push({
          itemId: `audit:${ac.id ?? r.id}:crossOperationSemantics`,
          classification: 'SEMANTIC_REVIEW_REQUIRED',
          category: 'CROSS_OPERATION_SEMANTICS',
          summary: `Coerência de domínio da sequência ${JSON.stringify(ac.crossOperationWitness.operationSequence)} sobre '${ac.crossOperationWitness.sharedField}' sob revisão semântica/testes de produto.`,
        });
      }
    }
  }

  const hasInfraIssues = stateLifecycleIssues.length > 0 || provenanceIssues.length > 0 || inventoryIssues.length > 0;
  if (!hasInfraIssues && defects.length === 0) {
    auditItems.push({
      itemId: 'audit:structural-consistency',
      classification: 'MECHANICALLY_VERIFIED',
      category: 'STRUCTURAL_CLOSURE',
      summary: 'Unicidade de IDs, integridade referencial, enums fechados e totalidade estrutural verificados mecanicamente.',
    });
  }

  for (const d of pendingDecisions) {
    auditItems.push({
      itemId: `decision:${d.questionId}`,
      classification: 'AWAITING_HUMAN_DECISION',
      category: 'HUMAN_DECISION',
      summary: d.question,
    });
  }
  for (const dim of determinismDecisions) {
    const owned = (dim.targetIds ?? []).some((id) => pendingDecisions.some((d) => d.questionId === id));
    if (!owned) {
      auditItems.push({
        itemId: `determinism:${dim.kind}:${dim.subjectId}`,
        classification: 'AWAITING_HUMAN_DECISION',
        category: 'DETERMINISM_DECISION',
        summary: dim.rationale,
      });
    }
  }

  const counts = {
    MECHANICALLY_VERIFIED: auditItems.filter((x) => x.classification === 'MECHANICALLY_VERIFIED').length,
    AWAITING_HUMAN_DECISION: auditItems.filter((x) => x.classification === 'AWAITING_HUMAN_DECISION').length,
    SEMANTIC_REVIEW_REQUIRED: auditItems.filter((x) => x.classification === 'SEMANTIC_REVIEW_REQUIRED').length,
  };

  return {
    defects,
    closureAudit: { counts, items: auditItems },
  };
}

function classifyGapIssue(issue, index) {
  const gapId = `GAP-${String(index + 1).padStart(4, '0')}`;
  const entry = GAP_KIND_MAP[issue.kind];
  const layer = entry ? entry[0] : 'COVERAGE_ACCOUNTING';
  const requiredAuthority = entry ? entry[1] : 'ARCHITECTURE_POLICY';
  const witness = (entry && entry[2](issue)) || issue.reason || issue.statement || issue.slotId || 'Lacuna de fechamento de inventário não classificada.';

  const gapEntry = { gapId, layer, witness, requiredAuthority };
  if (typeof issue.slotId === 'string' && issue.slotId.length > 0) {
    gapEntry.slotId = issue.slotId;
  }
  const detailParts = [];
  if (typeof issue.reason === 'string' && issue.reason.length > 0 && issue.reason !== witness) {
    detailParts.push(issue.reason);
  }
  if (Array.isArray(issue.related)) detailParts.push(...issue.related);
  if (detailParts.length > 0) gapEntry.details = detailParts.join(' | ');
  return gapEntry;
}

/**
 * Compila o certificado de fechamento semântico e o gapLedger em 4 camadas.
 */
export function generateClosureCertificate({
  specification,
  humanResolutions = [],
  semanticReviewAcknowledged = false,
} = {}) {
  const inventoryResult = validateSemanticInventoryCoverage({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
  });

  const witnessResult = validateDecisionsWitness({
    decisions: specification.decisions ?? [],
  });

  const resolvedIdsList = humanResolutions.map(({ questionId }) => questionId);
  const stateLifecycle = validateFieldLifecycle({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
    invariants: specification.invariants ?? [],
    requirements: specification.requirements ?? [],
    decisions: specification.decisions ?? [],
    boundaryRules: specification.boundaries?.boundaryRules ?? specification.boundaryRules ?? [],
    pathReferences: specification.pathReferences ?? [],
    resolvedDecisionIds: resolvedIdsList,
    unknowns: specification.unknowns ?? [],
    workspaceSkeleton: specification.workspaceSkeleton ?? null,
    payloadSchemas: specification.payloadSchemas ?? null,
  });

  const provenanceResult = validateProvenanceEnforcement({
    stateModel: specification.stateModel,
    architecturePolicy: specification.policy,
    literalFacts: specification.intentEvidence?.literalFacts ?? specification.literalFacts ?? [],
    fragments: specification.intentEvidence?.fragments ?? specification.fragments ?? [],
    intent: specification.intent ?? '',
    workspaceEvidence: specification.workspaceEvidence ?? specification.workspace?.sourceEvidence ?? [],
    requirements: specification.requirements ?? [],
    invariants: specification.invariants ?? [],
    decisions: specification.decisions ?? [],
    boundaryRules: specification.boundaries?.boundaryRules ?? specification.boundaryRules ?? [],
  });

  const inventoryIssues = [
    ...inventoryResult.issues,
    ...witnessResult.issues,
  ];
  const resolvedDecisionIds = new Set(resolvedIdsList);
  const pendingDecisions = (specification.decisions ?? []).filter(({ questionId }) => (
    !resolvedDecisionIds.has(questionId)
  ));
  const determinismGaps = (specification.determinismReview?.dimensions ?? []).filter(({ status }) => (
    status === 'GAP_FOUND'
  ));
  const determinismDecisions = (specification.determinismReview?.dimensions ?? []).filter(({ status }) => (
    status === 'DECISION_REQUIRED'
  ));

  const { defects: auditDefects, closureAudit } = runIndependentClosureAudit({
    specification,
    resolvedDecisionIds,
    pendingDecisions,
    determinismDecisions,
    stateLifecycleIssues: stateLifecycle.issues,
    provenanceIssues: provenanceResult.issues,
    inventoryIssues,
  });

  const unresolvedInventorySlots = inventoryIssues.length;

  const stateFieldIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_STATE_MODEL'
    || i.kind === 'UNRESOLVED_INITIALIZATION'
    || i.kind === 'UNRESOLVED_RESET'
    || i.kind === 'ORPHAN_STATE_FIELD'
    || i.kind === 'MISSING_PRODUCER_OPERATION'
    || i.kind === 'UNRESOLVED_FIELD_BOUNDS'
    || i.kind === 'UNRESOLVED_COLLECTION_ADMISSION'
    || i.kind === 'UNRESOLVED_COLLECTION_CAPACITY'
    || i.kind === 'UNRESOLVED_CONTAINER_POLICY'
  ));

  const transitionIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_TRANSITION'
    || i.kind === 'UNRESOLVED_GUARD_PRECEDENCE'
    || i.kind === 'MISSING_GUARD_REJECTION_BRANCH'
    || i.kind === 'UNDETERMINED_BRANCH_NEXT_STATE'
    || i.kind === 'MISSING_SUCCESS_BRANCH'
    || i.kind === 'UNRESOLVED_CANONICAL_SERIALIZATION'
    || i.kind === 'EXTERNAL_EFFECT_COVERAGE_MISSING'
    || i.kind === 'INCOMPLETE_EXTERNAL_EFFECT'
    || i.kind === 'TRANSACTION_ROLLBACK_MISSING'
    || i.kind === 'UNRESOLVED_RETURN_CONTRACT'
    || i.kind === 'INCOMPLETE_STATUS_PARTITION'
    || i.kind === 'MISSING_EVALUATED_INPUTS'
    || i.kind === 'MISSING_ADDITIONAL_PROPERTIES_POLICY'
    || i.kind === 'MISSING_BRANCH_ACCEPTANCE_REF'
    || i.kind === 'INCOMPLETE_BATCH_POLICY_OR_WITNESS'
    || i.kind === 'MISSING_OR_INVALID_CROSS_OPERATION_WITNESS'
    || i.kind === 'INVALID_KEY_NORMALIZATION_OR_WITNESS'
  ));

  const observableIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_OBSERVABLE_DEPENDENCY'
    || i.kind === 'UNRESOLVED_OBSERVABLE_REPRESENTATION'
    || i.kind === 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR'
    || i.kind === 'INVALID_BITMASK_ALLOCATION'
  ));

  const declarationConflicts = [
    ...stateLifecycle.issues.filter((i) => (
      i.kind === 'CONFLICTING_STATE_DECLARATIONS'
      || i.kind === 'CONTRADICTORY_RULE_DETECTED'
    )),
    ...auditDefects.filter((i) => (
      i.kind === 'INVERTED_INVARIANT_FALSIFICATION'
      || i.kind === 'DUPLICATE_CONTRACT_IDENTIFIER'
      || i.kind === 'BROKEN_CONTRACT_REFERENCE'
      || i.kind === 'AMBIGUOUS_SCENARIO_OUTCOME'
      || i.kind === 'CLOSED_POLICY_ENUM_VIOLATION'
    )),
  ];

  const materialUnknownGaps = (specification.unknowns ?? []).filter(({ material, decisionId }) => (
    material && decisionId === null
  ));

  const authorityIssues = [
    ...materialUnknownGaps.map((u) => ({ slotId: `unknown/${u.id}`, kind: 'MATERIAL_UNKNOWN_GAP', reason: u.statement })),
    ...provenanceResult.issues,
  ];

  const unresolvedAuthorities = authorityIssues.length;
  const computabilityIssues = [
    ...stateLifecycle.issues.filter((i) => (
      i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY'
      || i.kind === 'EXTERNAL_EFFECT_COVERAGE_MISSING'
      || i.kind === 'INCOMPLETE_EXTERNAL_EFFECT'
      || i.kind === 'TRANSACTION_ROLLBACK_MISSING'
    )),
    ...auditDefects.filter((i) => i.kind === 'OPEN_ARITHMETIC_DECISION'),
  ];
  const unresolvedDependencies = computabilityIssues.length;
  const unresolvedDeterminismDimensions = determinismGaps.length + determinismDecisions.length;
  const orphanHumanDecisions = pendingDecisions.length;
  const unresolvedStateFields = stateFieldIssues.length;
  const unresolvedTransitions = transitionIssues.length;
  const unresolvedObservables = observableIssues.length;
  const contradictoryRules = declarationConflicts.length;

  const totalUnresolved = unresolvedInventorySlots
    + unresolvedDependencies
    + unresolvedStateFields
    + unresolvedObservables
    + unresolvedTransitions
    + unresolvedAuthorities
    + unresolvedDeterminismDimensions
    + contradictoryRules
    + orphanHumanDecisions
    + auditDefects.length;

  const pendingDecisionIssues = pendingDecisions.map((q) => ({
    slotId: `decision/${q.questionId}`,
    kind: 'PENDING_HUMAN_DECISION',
    reason: q.question,
    related: [],
  }));
  const pendingIssueByQuestion = new Map(pendingDecisions.map((q, index) => [
    q.questionId,
    pendingDecisionIssues[index],
  ]));
  const independentDeterminismDecisions = determinismDecisions.filter((d) => {
    const owner = (d.targetIds ?? []).find((targetId) => pendingIssueByQuestion.has(targetId));
    if (owner === undefined) return true;
    pendingIssueByQuestion.get(owner).related.push(`Dimensão ${d.kind}/${d.subjectId}: ${d.rationale}`);
    return false;
  });

  const allIssues = [
    ...inventoryIssues,
    ...stateLifecycle.issues,
    ...provenanceResult.issues,
    ...auditDefects,
    ...materialUnknownGaps.map((u) => ({ slotId: `unknown/${u.id}`, kind: 'MATERIAL_UNKNOWN_GAP', reason: u.statement })),
    ...determinismGaps.map((d) => ({ slotId: `determinism/${d.kind}/${d.subjectId}`, kind: 'DETERMINISM_GAP', reason: d.rationale })),
    ...independentDeterminismDecisions.map((d) => ({ slotId: `determinism/${d.kind}/${d.subjectId}`, kind: 'PENDING_HUMAN_DECISION', reason: d.rationale })),
    ...pendingDecisionIssues,
  ];

  const gapLedger = allIssues.map((issue, idx) => classifyGapIssue(issue, idx));

  return {
    unresolvedInventorySlots,
    unresolvedDependencies,
    unresolvedStateFields,
    unresolvedObservables,
    unresolvedTransitions,
    unresolvedAuthorities,
    unresolvedDeterminismDimensions,
    contradictoryRules,
    orphanHumanDecisions,
    status: totalUnresolved === 0
      && gapLedger.length === 0
      && closureAudit.counts.AWAITING_HUMAN_DECISION === 0
      ? (closureAudit.counts.SEMANTIC_REVIEW_REQUIRED === 0
        ? 'CERTIFIED_CLOSED'
        : semanticReviewAcknowledged
          ? 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW'
          : 'BLOCKED_BY_UNRESOLVED_SLOTS')
      : 'BLOCKED_BY_UNRESOLVED_SLOTS',
    gapLedger,
    closureAudit,
  };
}
