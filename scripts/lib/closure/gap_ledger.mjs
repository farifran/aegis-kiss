import { validateProvenanceEnforcement } from './provenance.mjs';
import {
  validateDecisionsWitness,
  validateFieldLifecycle,
  validateSemanticInventoryCoverage,
} from './state_lifecycle.mjs';

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

  UNRESOLVED_OBSERVABLE_DEPENDENCY: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Observável depende de campo inexistente no modelo de estado.'],
  UNRESOLVED_OBSERVABLE_REPRESENTATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Observável sem representação finita explícita.'],
  UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Observável sem comportamento definido para coleção vazia.'],
  INVALID_BITMASK_ALLOCATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Alocação de bits sobreposta ou fora dos limites do tipo.'],
  UNRESOLVED_CANONICAL_SERIALIZATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason || 'Perfil de serialização canônica ausente para demanda de integridade.'],
  MISSING_CANONICAL_SERIALIZATION_INVENTORY: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason || 'Perfil de serialização canônica ausente para demanda de integridade.'],

  UNAUTHORIZED_NUMERIC_LITERAL: ['AUTHORITY_PROVENANCE', 'USER_INTENT', (i) => i.reason],
  UNAUTHORIZED_GUARD_OR_ERROR_CODE: ['AUTHORITY_PROVENANCE', 'USER_INTENT', (i) => i.reason || 'Guarda ou código de erro sem fundamentação na intenção, workspace ou governança.'],
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

  OPEN_COMPUTATIONAL_DEPENDENCY: ['COMPUTABILITY_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Dependência semântica necessária para computabilidade não foi encontrada ou fundamentada.'],
};

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
} = {}) {
  const inventoryResult = validateSemanticInventoryCoverage({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
  });

  const witnessResult = validateDecisionsWitness({
    decisions: specification.decisions ?? [],
  });

  const stateLifecycle = validateFieldLifecycle({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
    invariants: specification.invariants ?? [],
    requirements: specification.requirements ?? [],
    decisions: specification.decisions ?? [],
    boundaryRules: specification.boundaries?.boundaryRules ?? specification.boundaryRules ?? [],
    pathReferences: specification.pathReferences ?? [],
    resolvedDecisionIds: humanResolutions.map(({ questionId }) => questionId),
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
  });

  const inventoryIssues = [
    ...inventoryResult.issues,
    ...witnessResult.issues,
  ];
  const unresolvedInventorySlots = inventoryIssues.length;

  const stateFieldIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_STATE_MODEL'
    || i.kind === 'UNRESOLVED_INITIALIZATION'
    || i.kind === 'UNRESOLVED_RESET'
    || i.kind === 'ORPHAN_STATE_FIELD'
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
  ));

  const observableIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_OBSERVABLE_DEPENDENCY'
    || i.kind === 'UNRESOLVED_OBSERVABLE_REPRESENTATION'
    || i.kind === 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR'
    || i.kind === 'INVALID_BITMASK_ALLOCATION'
  ));

  const declarationConflicts = stateLifecycle.issues.filter((i) => (
    i.kind === 'CONFLICTING_STATE_DECLARATIONS'
    || i.kind === 'CONTRADICTORY_RULE_DETECTED'
  ));

  const materialUnknownGaps = (specification.unknowns ?? []).filter(({ material, decisionId }) => (
    material && decisionId === null
  ));

  const determinismGaps = (specification.determinismReview?.dimensions ?? []).filter(({ status }) => (
    status === 'GAP_FOUND'
  ));

  const determinismDecisions = (specification.determinismReview?.dimensions ?? []).filter(({ status }) => (
    status === 'DECISION_REQUIRED'
  ));

  const resolvedDecisionIds = new Set(humanResolutions.map(({ questionId }) => questionId));
  const pendingDecisions = (specification.decisions ?? []).filter(({ questionId }) => (
    !resolvedDecisionIds.has(questionId)
  ));

  const authorityIssues = [
    ...materialUnknownGaps.map((u) => ({ slotId: `unknown/${u.id}`, kind: 'MATERIAL_UNKNOWN_GAP', reason: u.statement })),
    ...provenanceResult.issues,
  ];

  const unresolvedAuthorities = authorityIssues.length;
  const computabilityIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY'
    || i.kind === 'EXTERNAL_EFFECT_COVERAGE_MISSING'
    || i.kind === 'INCOMPLETE_EXTERNAL_EFFECT'
    || i.kind === 'TRANSACTION_ROLLBACK_MISSING'
  ));
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
    + orphanHumanDecisions;

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
    status: totalUnresolved === 0 && gapLedger.length === 0 ? 'CERTIFIED_CLOSED' : 'BLOCKED_BY_UNRESOLVED_SLOTS',
    gapLedger,
  };
}

