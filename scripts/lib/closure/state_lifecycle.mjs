import {
  addIssue,
  checkReferenceIntegrity,
  validateContradictionDetection,
  validateOpenTermDependencies,
  validateOperationTotality,
} from './operation_totality.mjs';
import {
  validateCanonicalSerializations,
  validateObservable,
  validateStandaloneKeyWitnesses,
  validateStatusPartitionsAndWitnesses,
} from './state_witnesses.mjs';

/**
 * Checks inventory obligations activated explicitly by semantic context tags.
 * It does not infer applicability from names, prose or unclassified literal facts.
 */
export function validateSemanticInventoryCoverage({ stateModel = null, architectureContexts = [] } = {}) {
  const issues = [];
  const tags = new Set(architectureContexts.map((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag)));
  const obligations = [
    ['stateful-operation', 'entities', 'MISSING_STATEFUL_ENTITY_INVENTORY'],
    ['bounded-observability', 'observables', 'MISSING_BOUNDED_OBSERVABILITY_INVENTORY'],
    ['integrity-hash', 'canonicalSerializations', 'MISSING_CANONICAL_SERIALIZATION_INVENTORY'],
  ];
  for (const [tag, collection, kind] of obligations) {
    if (tags.has(tag) && !(stateModel?.[collection]?.length > 0)) {
      addIssue(issues, `inventory/${collection}`, kind, `O contexto declarado '${tag}' exige entradas em '${collection}'.`);
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Validador Mecânico de Distinguishing Witness em Decisões (validateDecisionsWitness).
 */
export function validateDecisionsWitness({
  decisions = [],
} = {}) {
  const issues = [];

  for (const decision of decisions) {
    const qId = decision.questionId ?? decision.question;
    const dc = decision.distinguishingCase;

    if (decision.semanticKey !== undefined && decision.semanticKey !== null) {
      if (typeof decision.semanticKey !== 'string' || !/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/u.test(decision.semanticKey)) {
        addIssue(issues, `decision/${qId}/semanticKey`, 'INVALID_SEMANTIC_KEY', `A decisão '${qId}' possui semanticKey inválida ('${decision.semanticKey}'). Exige formato 'namespace.nome_politica'.`);
      }
    }

    if (!dc || typeof dc.given !== 'string' || typeof dc.when !== 'string' || !Array.isArray(dc.outcomes)) {
      addIssue(issues, `decision/${qId}/distinguishingCase`, 'MISSING_DISTINGUISHING_CASE', `A decisão '${qId}' não define distinguishingCase estruturado com given, when e outcomes.`);
      continue;
    }

    if (dc.outcomes.length < 2) {
      addIssue(issues, `decision/${qId}/distinguishingCase/outcomes`, 'INSUFFICIENT_WITNESS_OUTCOMES', `A decisão '${qId}' define menos de 2 desfechos em distinguishingCase.outcomes.`);
    } else {
      const distinctOutcomes = new Set(dc.outcomes.map((o) => (typeof o.then === 'string' ? o.then.trim().toLowerCase() : '')));
      if (distinctOutcomes.size < 2) {
        addIssue(issues, `decision/${qId}/distinguishingCase/divergence`, 'NON_DISTINGUISHING_DECISION_WITNESS', `A decisão '${qId}' não apresenta desfechos observáveis divergentes entre suas alternativas (todas produzem o mesmo resultado). Viola o princípio KISS.`);
      }
    }

    const answers = Array.isArray(decision.answers) ? decision.answers : [];
    if (answers.length > 0) {
      const outcomeAnswerRefs = new Set(dc.outcomes.map((o) => (o.answerId ?? o.answerIndex)));
      const hasCoverage = answers.every((a, idx) => (
        outcomeAnswerRefs.has(a.id) || outcomeAnswerRefs.has(idx)
      ));
      if (!hasCoverage) {
        addIssue(issues, `decision/${qId}/distinguishingCase/coverage`, 'INCOMPLETE_WITNESS_OUTCOMES', `A decisão '${qId}' possui alternativas declaradas em answers que não possuem desfecho correspondente em distinguishingCase.outcomes.`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validador Mecânico de Ciclo de Vida de Campos de Estado (validateFieldLifecycle).
 */
function validateEntityField(entity, field, operations, issues) {
  const fieldKey = `${entity.name}.${field.name}`;
  if (!field.initialization
    || field.initialization.kind === 'UNRESOLVED'
    || field.initialization.value === undefined
    || field.initialization.value === null) {
    addIssue(issues, `state/${fieldKey}/init`, 'UNRESOLVED_INITIALIZATION', `O campo de estado '${fieldKey}' não possui inicialização total determinada (kind: ${field.initialization?.kind ?? 'MISSING'}).`);
  }

  if (field.reset?.allowed === true) {
    if (!field.reset.trigger
      || field.reset.resetValue === undefined
      || field.reset.resetValue === null) {
      addIssue(issues, `state/${fieldKey}/reset`, 'UNRESOLVED_RESET', `O campo '${fieldKey}' permite reset mas não define gatilho e valor de reset determinísticos.`);
    }
  }

  if (operations.length > 0) {
    const mutations = Array.isArray(field.mutations) ? field.mutations : [];
    const preservation = Array.isArray(field.preservation) ? field.preservation : [];
    if (!preservation.includes('*')) {
      const coveredOps = new Set([...mutations.map((m) => m.operation), ...preservation]);
      checkReferenceIntegrity({
        items: operations,
        getKey: (op) => op.name,
        targetSet: coveredOps,
        onMissing: (opName) => addIssue(issues, `state/${fieldKey}/transition/${opName}`, 'UNRESOLVED_TRANSITION', `O campo '${fieldKey}' não define mutação nem regra de preservação para a operação '${opName}'.`),
      });
    }
  }

  const readBy = Array.isArray(field.readBy) ? field.readBy : [];
  if (readBy.length === 0) {
    addIssue(issues, `state/${fieldKey}/readBy`, 'ORPHAN_STATE_FIELD', `O campo '${fieldKey}' não declara leitores (operações ou observáveis).`);
  }

  if (field.type === 'INTEGER' || field.isCounter === true) {
    if (!field.bounds
      || field.bounds.lowerBound === undefined
      || field.bounds.lowerBound === null
      || field.bounds.upperBound === undefined
      || (field.bounds.upperBound === null && (field.bounds.boundaryBehavior === 'SATURATE' || field.bounds.boundaryBehavior === 'ROLLOVER_MODULO'))
      || !field.bounds.boundaryBehavior) {
      addIssue(issues, `state/${fieldKey}/bounds`, 'UNRESOLVED_FIELD_BOUNDS', `O campo numérico '${fieldKey}' não define bounds com lowerBound, upperBound e boundaryBehavior determinísticos.`);
    }
  }
}

function validateCollectionEntity(entity, issues) {
  if (!entity.admissionPolicy) {
    addIssue(issues, `entity/${entity.name}/admissionPolicy`, 'UNRESOLVED_COLLECTION_ADMISSION', `A entidade de coleção dinâmica '${entity.name}' não define admissionPolicy (ex: ON_FIRST_REQUEST, PRE_REGISTERED).`);
  }
  const noContractLimit = (
    entity.capacityPolicy?.overflowPolicy === 'NO_CONTRACT_LIMIT'
    || entity.capacityPolicy?.overflowPolicy === 'SLIDING_WINDOW_EVICTION'
    || entity.capacityPolicy?.overflowPolicy === 'EXPIRATION_TTL'
  )
    && entity.capacityPolicy.maxEntries === null
    && typeof entity.capacityPolicy.unboundedRationale === 'string'
    && entity.capacityPolicy.unboundedRationale.trim().length > 0;
  if (!noContractLimit && (!entity.capacityPolicy
    || entity.capacityPolicy.maxEntries === undefined
    || entity.capacityPolicy.maxEntries === null
    || !entity.capacityPolicy.overflowPolicy
    || entity.capacityPolicy.overflowPolicy === 'NO_CONTRACT_LIMIT')) {
    addIssue(issues, `entity/${entity.name}/capacityPolicy`, 'UNRESOLVED_COLLECTION_CAPACITY', `A coleção '${entity.name}' precisa de capacidade e overflow explícitos ou ausência justificada de limite contratual.`);
  }

  if (!entity.containerPolicy) return;
  if (!entity.containerPolicy.partitionKey) {
    addIssue(issues, `entity/${entity.name}/containerPolicy/partitionKey`, 'UNRESOLVED_CONTAINER_POLICY', `A entidade '${entity.name}' declara containerPolicy sem partitionKey válida.`);
  }
  if (entity.containerPolicy.retentionPolicy === 'IDLE_TTL_EVICTION' && !entity.containerPolicy.idleRetentionDuration) {
    addIssue(issues, `entity/${entity.name}/containerPolicy/idleRetentionDuration`, 'UNRESOLVED_CONTAINER_POLICY', `A entidade '${entity.name}' declara retentionPolicy=IDLE_TTL_EVICTION mas não define idleRetentionDuration.`);
  }
  if (entity.containerPolicy.retentionPolicy === 'UNBOUNDED_CONTAINER' && !entity.containerPolicy.unboundedRationale) {
    addIssue(issues, `entity/${entity.name}/containerPolicy/unboundedRationale`, 'UNRESOLVED_CONTAINER_POLICY', `A entidade '${entity.name}' declara retentionPolicy=UNBOUNDED_CONTAINER mas não define unboundedRationale.`);
  }
}

function validateOperationGuards(op, issues) {
  const noGuards = Array.isArray(op.guardPrecedence) && op.guardPrecedence.length === 0
    && typeof op.noGuardsRationale === 'string' && op.noGuardsRationale.trim().length > 0
    && Array.isArray(op.branches) && op.branches.length > 0
    && !op.branches.some((branch) => branch.outcomeKind === 'REJECTION');
  const contradictoryExemption = typeof op.noGuardsRationale === 'string'
    && op.noGuardsRationale.trim().length > 0 && !noGuards;
  if (contradictoryExemption || !Array.isArray(op.guardPrecedence)
    || (op.guardPrecedence.length === 0 && !noGuards)) {
    addIssue(issues, `operation/${op.name}/guardPrecedence`, 'UNRESOLVED_GUARD_PRECEDENCE', `A operação '${op.name}' não define a ordem linear estrita de precedência de guards (GUARD_PRECEDENCE).`);
  }
}

function entityExistsInWorkspaceSkeleton(entityName, fieldName, workspaceSkeleton) {
  if (!workspaceSkeleton) return false;
  const fieldKey = `${entityName}.${fieldName}`;
  return (workspaceSkeleton.symbols ?? []).some((sym) => (
    sym.name === entityName
    || sym.name === fieldName
    || sym.name === fieldKey
    || (typeof sym.signature === 'string' && (sym.signature.includes(entityName) || sym.signature.includes(fieldName)))
  ));
}

function hasMutatingOpForField(entityName, field, operations) {
  const fieldKey = `${entityName}.${field.name}`;
  return (field.mutations ?? []).some((m) => operations.some((op) => op.name === m.operation))
    || operations.some((op) => (op.branches ?? []).some((b) => (
      (b.stateEffects ?? []).some((e) => (e.field === fieldKey || e.field === field.name) && e.effect !== 'PRESERVE')
    )));
}

function validateProducerConsumerSymmetry(stateModel, workspaceSkeleton, issues) {
  const operations = stateModel.operations ?? [];
  for (const entity of stateModel.entities ?? []) {
    const entityHasProducer = (entity.fields ?? []).some((f) => hasMutatingOpForField(entity.name, f, operations));

    for (const field of entity.fields ?? []) {
      const readBy = Array.isArray(field.readBy) ? field.readBy : [];
      if (field.isReadOnly === true || readBy.length === 0) continue;
      if (entityExistsInWorkspaceSkeleton(entity.name, field.name, workspaceSkeleton)) continue;
      if (hasMutatingOpForField(entity.name, field, operations)) continue;

      const fieldKey = `${entity.name}.${field.name}`;
      const initKind = field.initialization?.kind;
      const initRaw = String(field.initialization?.value ?? '').trim();
      const isEmptyLiteral = /^(?:\[\]|\{\}|empty)$/iu.test(initRaw);
      const isScalarConstantInit = initKind === 'EXPLICIT_VALUE'
        && !isEmptyLiteral
        && field.type !== 'MAP'
        && field.type !== 'SET'
        && !/^ARRAY\b/i.test(String(field.type ?? ''));

      if (isScalarConstantInit || (entity.isCollection && entityHasProducer && initKind === 'EXPLICIT_VALUE' && !isEmptyLiteral)) {
        continue;
      }
      addIssue(
        issues,
        `state/${fieldKey}/producer`,
        'MISSING_PRODUCER_OPERATION',
        `O campo dinâmico ou coleção '${fieldKey}' está ausente de workspaceSkeleton, não possui inicialização constante suficiente e aparece em readBy sem operação produtora declarada.`,
      );
    }
  }
}

export function validateFieldLifecycle({
  stateModel = null,
  architectureContexts = [],
  invariants = [],
  requirements = [],
  decisions = [],
  boundaryRules = [],
  pathReferences = [],
  resolvedDecisionIds = [],
  unknowns = [],
  workspaceSkeleton = null,
  payloadSchemas = null,
} = {}) {
  const isStateful = architectureContexts.some((ctx) => (
    (typeof ctx === 'string' ? ctx : ctx.tag) === 'stateful-operation'
  ));

  const issues = [];

  if (isStateful && (!stateModel || !stateModel.entities || stateModel.entities.length === 0)) {
    addIssue(issues, 'stateModel/entities', 'UNRESOLVED_STATE_MODEL', 'A demanda declara contexto de operação com estado (stateful-operation), mas não define stateModel com entidades e campos de estado.');
    return { valid: false, issues };
  }

  if (!stateModel || !Array.isArray(stateModel.entities)) {
    validateStandaloneKeyWitnesses(requirements, false, issues);
    return { valid: issues.length === 0, issues };
  }

  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  const observables = Array.isArray(stateModel.observables) ? stateModel.observables : [];
  const aggregations = Array.isArray(stateModel.aggregations) ? stateModel.aggregations : [];
  const boundaries = Array.isArray(stateModel.producerConsumerBoundaries) ? stateModel.producerConsumerBoundaries : [];
  const entityFieldKeys = new Set();
  const entityFieldsMap = new Map();

  for (const agg of aggregations) {
    if (agg.name) entityFieldKeys.add(agg.name);
  }
  for (const b of boundaries) {
    if (b.signalName) entityFieldKeys.add(b.signalName);
  }

  for (const entity of stateModel.entities) {
    if (entity.isCollection) {
      entityFieldKeys.add(`${entity.name}.id`);
      entityFieldKeys.add('id');
    }
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    for (const field of fields) {
      const fieldKey = `${entity.name}.${field.name}`;
      entityFieldKeys.add(fieldKey);
      entityFieldKeys.add(field.name);
      entityFieldsMap.set(fieldKey, field);
      entityFieldsMap.set(field.name, field);
      validateEntityField(entity, field, operations, issues);
    }
    if (entity.isCollection === true) validateCollectionEntity(entity, issues);
  }

  for (const op of operations) validateOperationGuards(op, issues);
  for (const obs of observables) validateObservable(obs, entityFieldKeys, entityFieldsMap, issues);

  const isIntegrityHash = architectureContexts.some((ctx) => (
    (typeof ctx === 'string' ? ctx : ctx.tag) === 'integrity-hash'
  ));
  if (isIntegrityHash) validateCanonicalSerializations(stateModel, entityFieldKeys, issues);

  const totalityResult = validateOperationTotality({
    stateModel,
    requirements,
    unknowns,
    decisions,
    workspaceSkeleton,
    payloadSchemas,
  });
  issues.push(...totalityResult.issues);

  validateProducerConsumerSymmetry(stateModel, workspaceSkeleton, issues);
  validateStatusPartitionsAndWitnesses({ stateModel, requirements, issues });

  const contradictionResult = validateContradictionDetection({ stateModel, invariants, requirements });
  issues.push(...contradictionResult.issues);

  const termDependenciesResult = validateOpenTermDependencies({
    stateModel,
    decisions,
    boundaryRules,
    pathReferences,
    architectureContexts,
    requirements,
    invariants,
    resolvedDecisionIds,
  });
  issues.push(...termDependenciesResult.issues);

  return {
    valid: issues.length === 0,
    issues,
  };
}

