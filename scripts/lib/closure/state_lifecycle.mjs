import {
  checkReferenceIntegrity,
  validateContradictionDetection,
  validateOpenTermDependencies,
  validateOperationTotality,
} from './operation_totality.mjs';
import {
  CLOSED_KEY_NORMALIZATION_RULES,
  evaluateBatchWitnessError,
  normalizeKey,
} from './v7_rules.mjs';

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
      issues.push({
        slotId: `inventory/${collection}`,
        kind,
        reason: `O contexto declarado '${tag}' exige entradas em '${collection}'.`,
      });
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
        issues.push({
          slotId: `decision/${qId}/semanticKey`,
          kind: 'INVALID_SEMANTIC_KEY',
          reason: `A decisão '${qId}' possui semanticKey inválida ('${decision.semanticKey}'). Exige formato 'namespace.nome_politica'.`,
        });
      }
    }

    if (!dc || typeof dc.given !== 'string' || typeof dc.when !== 'string' || !Array.isArray(dc.outcomes)) {
      issues.push({
        slotId: `decision/${qId}/distinguishingCase`,
        kind: 'MISSING_DISTINGUISHING_CASE',
        reason: `A decisão '${qId}' não define distinguishingCase estruturado com given, when e outcomes.`,
      });
      continue;
    }

    if (dc.outcomes.length < 2) {
      issues.push({
        slotId: `decision/${qId}/distinguishingCase/outcomes`,
        kind: 'INSUFFICIENT_WITNESS_OUTCOMES',
        reason: `A decisão '${qId}' define menos de 2 desfechos em distinguishingCase.outcomes.`,
      });
    } else {
      const distinctOutcomes = new Set(dc.outcomes.map((o) => (typeof o.then === 'string' ? o.then.trim().toLowerCase() : '')));
      if (distinctOutcomes.size < 2) {
        issues.push({
          slotId: `decision/${qId}/distinguishingCase/divergence`,
          kind: 'NON_DISTINGUISHING_DECISION_WITNESS',
          reason: `A decisão '${qId}' não apresenta desfechos observáveis divergentes entre suas alternativas (todas produzem o mesmo resultado). Viola o princípio KISS.`,
        });
      }
    }

    const answers = Array.isArray(decision.answers) ? decision.answers : [];
    if (answers.length > 0) {
      const outcomeAnswerRefs = new Set(dc.outcomes.map((o) => (o.answerId ?? o.answerIndex)));
      const hasCoverage = answers.every((a, idx) => (
        outcomeAnswerRefs.has(a.id) || outcomeAnswerRefs.has(idx)
      ));
      if (!hasCoverage) {
        issues.push({
          slotId: `decision/${qId}/distinguishingCase/coverage`,
          kind: 'INCOMPLETE_WITNESS_OUTCOMES',
          reason: `A decisão '${qId}' possui alternativas declaradas em answers que não possuem desfecho correspondente em distinguishingCase.outcomes.`,
        });
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
    issues.push({
      slotId: `state/${fieldKey}/init`,
      kind: 'UNRESOLVED_INITIALIZATION',
      reason: `O campo de estado '${fieldKey}' não possui inicialização total determinada (kind: ${field.initialization?.kind ?? 'MISSING'}).`,
    });
  }

  if (field.reset?.allowed === true) {
    if (!field.reset.trigger
      || field.reset.resetValue === undefined
      || field.reset.resetValue === null) {
      issues.push({
        slotId: `state/${fieldKey}/reset`,
        kind: 'UNRESOLVED_RESET',
        reason: `O campo '${fieldKey}' permite reset mas não define gatilho e valor de reset determinísticos.`,
      });
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
        onMissing: (opName) => {
          issues.push({
            slotId: `state/${fieldKey}/transition/${opName}`,
            kind: 'UNRESOLVED_TRANSITION',
            reason: `O campo '${fieldKey}' não define mutação nem regra de preservação para a operação '${opName}'.`,
          });
        },
      });
    }
  }

  const readBy = Array.isArray(field.readBy) ? field.readBy : [];
  if (readBy.length === 0) {
    issues.push({
      slotId: `state/${fieldKey}/readBy`,
      kind: 'ORPHAN_STATE_FIELD',
      reason: `O campo '${fieldKey}' não declara leitores (operações ou observáveis).`,
    });
  }

  if (field.type === 'INTEGER' || field.isCounter === true) {
    if (!field.bounds
      || field.bounds.lowerBound === undefined
      || field.bounds.lowerBound === null
      || field.bounds.upperBound === undefined
      || (field.bounds.upperBound === null && (field.bounds.boundaryBehavior === 'SATURATE' || field.bounds.boundaryBehavior === 'ROLLOVER_MODULO'))
      || !field.bounds.boundaryBehavior) {
      issues.push({
        slotId: `state/${fieldKey}/bounds`,
        kind: 'UNRESOLVED_FIELD_BOUNDS',
        reason: `O campo numérico '${fieldKey}' não define bounds com lowerBound, upperBound e boundaryBehavior determinísticos.`,
      });
    }
  }
}

function validateCollectionEntity(entity, issues) {
  if (!entity.admissionPolicy) {
    issues.push({
      slotId: `entity/${entity.name}/admissionPolicy`,
      kind: 'UNRESOLVED_COLLECTION_ADMISSION',
      reason: `A entidade de coleção dinâmica '${entity.name}' não define admissionPolicy (ex: ON_FIRST_REQUEST, PRE_REGISTERED).`,
    });
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
    issues.push({
      slotId: `entity/${entity.name}/capacityPolicy`,
      kind: 'UNRESOLVED_COLLECTION_CAPACITY',
      reason: `A coleção '${entity.name}' precisa de capacidade e overflow explícitos ou ausência justificada de limite contratual.`,
    });
  }

  if (!entity.containerPolicy) return;
  if (!entity.containerPolicy.partitionKey) {
    issues.push({
      slotId: `entity/${entity.name}/containerPolicy/partitionKey`,
      kind: 'UNRESOLVED_CONTAINER_POLICY',
      reason: `A entidade '${entity.name}' declara containerPolicy sem partitionKey válida.`,
    });
  }
  if (entity.containerPolicy.retentionPolicy === 'IDLE_TTL_EVICTION' && !entity.containerPolicy.idleRetentionDuration) {
    issues.push({
      slotId: `entity/${entity.name}/containerPolicy/idleRetentionDuration`,
      kind: 'UNRESOLVED_CONTAINER_POLICY',
      reason: `A entidade '${entity.name}' declara retentionPolicy=IDLE_TTL_EVICTION mas não define idleRetentionDuration.`,
    });
  }
  if (entity.containerPolicy.retentionPolicy === 'UNBOUNDED_CONTAINER' && !entity.containerPolicy.unboundedRationale) {
    issues.push({
      slotId: `entity/${entity.name}/containerPolicy/unboundedRationale`,
      kind: 'UNRESOLVED_CONTAINER_POLICY',
      reason: `A entidade '${entity.name}' declara retentionPolicy=UNBOUNDED_CONTAINER mas não define unboundedRationale.`,
    });
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
    issues.push({
      slotId: `operation/${op.name}/guardPrecedence`,
      kind: 'UNRESOLVED_GUARD_PRECEDENCE',
      reason: `A operação '${op.name}' não define a ordem linear estrita de precedência de guards (GUARD_PRECEDENCE).`,
    });
  }
}

function validateBitmaskAllocation(obs, entityFieldKeys, entityFieldsMap, issues) {
  const bitAllocation = Array.isArray(obs.bitAllocation) ? obs.bitAllocation : [];
  if (bitAllocation.length === 0) {
    issues.push({
      slotId: `observable/${obs.name}/bitAllocation`,
      kind: 'INVALID_BITMASK_ALLOCATION',
      reason: `O observável em bitmask de 32 bits '${obs.name}' não define alocação explícita de fatias (bitAllocation).`,
    });
    return;
  }
  const allocatedBits = new Set();
  for (const item of bitAllocation) {
    const match = /^(\d+)(?:\.\.(\d+))?$/u.exec(item.slice.trim());
    if (!match) {
      issues.push({
        slotId: `observable/${obs.name}/bitAllocation/${item.slice}`,
        kind: 'INVALID_BITMASK_ALLOCATION',
        reason: `Fatia '${item.slice}' do observável '${obs.name}' possui formato inválido. Use 'start..end' ou 'bit'.`,
      });
      continue;
    }
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    const expectedWidth = (end - start) + 1;
    if (item.bitWidth !== expectedWidth) {
      issues.push({
        slotId: `observable/${obs.name}/bitAllocation/${item.slice}/width`,
        kind: 'INVALID_BITMASK_ALLOCATION',
        reason: `Fatia '${item.slice}' declara bitWidth ${item.bitWidth}, mas o intervalo representa ${expectedWidth} bit(s).`,
      });
    }
    for (let b = start; b <= end; b += 1) {
      if (allocatedBits.has(b)) {
        issues.push({
          slotId: `observable/${obs.name}/bitAllocation/overlap/${b}`,
          kind: 'INVALID_BITMASK_ALLOCATION',
          reason: `O bit ${b} do observável '${obs.name}' foi alocado em mais de uma fatia (sobreposição detectada).`,
        });
      }
      allocatedBits.add(b);
    }
    checkReferenceIntegrity({
      items: [item.field],
      targetSet: entityFieldKeys,
      ignoredKeys: new Set(['RESERVED', '*']),
      onMissing: (f) => {
        issues.push({
          slotId: `observable/${obs.name}/bitAllocation/${item.slice}/field`,
          kind: 'UNRESOLVED_OBSERVABLE_DEPENDENCY',
          reason: `A fatia '${item.slice}' referencia o campo desconhecido '${f}'.`,
        });
      },
    });
    if (item.field === 'RESERVED' || item.field === '*') continue;
    const fieldObj = entityFieldsMap.get(item.field);
    if (!fieldObj) continue;
    if (fieldObj.type === 'BOOLEAN') {
      if (item.bitWidth !== 1) {
        issues.push({
          slotId: `observable/${obs.name}/bitAllocation/${item.slice}/width`,
          kind: 'INVALID_BITMASK_ALLOCATION',
          reason: `A fatia '${item.slice}' aloca ${item.bitWidth} bit(s) para o campo booleano '${item.field}', mas booleanos exigem exatamente 1 bit.`,
        });
      }
    } else if (fieldObj.type === 'INTEGER') {
      const upperBound = fieldObj.bounds?.upperBound ? Number(fieldObj.bounds.upperBound) : null;
      if (upperBound !== null && !Number.isNaN(upperBound) && upperBound > 0) {
        const minBits = Math.ceil(Math.log2(upperBound + 1));
        if (item.bitWidth < minBits && !item.mapping) {
          issues.push({
            slotId: `observable/${obs.name}/bitAllocation/${item.slice}/capacity`,
            kind: 'INVALID_BITMASK_ALLOCATION',
            reason: `O campo inteiro '${item.field}' possui limite superior ${upperBound} (exigindo no mínimo ${minBits} bits), mas foi alocado em fatia de apenas ${item.bitWidth} bit(s) sem mapeamento explícito.`,
          });
        }
      } else if (item.bitWidth === 1 && !item.mapping) {
        issues.push({
          slotId: `observable/${obs.name}/bitAllocation/${item.slice}/capacity`,
          kind: 'INVALID_BITMASK_ALLOCATION',
          reason: `O campo inteiro '${item.field}' foi alocado em fatia de 1 bit sem mapeamento booleano explícito.`,
        });
      }
    }
  }
}

function validateObservable(obs, entityFieldKeys, entityFieldsMap, issues) {
  const derivedFrom = Array.isArray(obs.derivedFrom) ? obs.derivedFrom : [];
  if (derivedFrom.length === 0) {
    issues.push({
      slotId: `observable/${obs.name}/derivedFrom`,
      kind: 'UNRESOLVED_OBSERVABLE_DEPENDENCY',
      reason: `O observável '${obs.name}' não declara os campos de estado dos quais é derivado.`,
    });
  } else {
    checkReferenceIntegrity({
      items: derivedFrom,
      targetSet: entityFieldKeys,
      ignoredKeys: new Set(['*']),
      onMissing: (sourceField) => {
        issues.push({
          slotId: `observable/${obs.name}/dependency/${sourceField}`,
          kind: 'UNRESOLVED_OBSERVABLE_DEPENDENCY',
          reason: `O observável '${obs.name}' referencia o campo desconhecido '${sourceField}'.`,
        });
      },
    });
  }

  if (!obs.representation) {
    issues.push({
      slotId: `observable/${obs.name}/representation`,
      kind: 'UNRESOLVED_OBSERVABLE_REPRESENTATION',
      reason: `O observável '${obs.name}' não define representation (ex: UINT32_BITMASK, ENUM, SCALAR, RECORD).`,
    });
  }

  if (obs.emptyBehavior === undefined || obs.emptyBehavior === null) {
    issues.push({
      slotId: `observable/${obs.name}/emptyBehavior`,
      kind: 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR',
      reason: `O observável '${obs.name}' não define emptyBehavior para estado vazio ou registro inexistente.`,
    });
  }

  if (obs.representation === 'UINT32_BITMASK') {
    validateBitmaskAllocation(obs, entityFieldKeys, entityFieldsMap, issues);
  }
}

function validateCanonicalSerializations(stateModel, entityFieldKeys, issues) {
  const serializations = Array.isArray(stateModel.canonicalSerializations)
    ? stateModel.canonicalSerializations
    : [];
  if (serializations.length === 0) {
    issues.push({
      slotId: 'stateModel/canonicalSerializations',
      kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
      reason: 'A demanda envolve integridade de hash/digest (integrity-hash), mas o stateModel não define canonicalSerializations com a quádrupla canônica.',
    });
    return;
  }
  for (const item of serializations) {
    if (!item.target || item.target.trim() === '') {
      issues.push({
        slotId: 'stateModel/canonicalSerializations/target',
        kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
        reason: 'Item de serialização canônica não define target.',
      });
    }
    const fields = Array.isArray(item.includedFields) ? item.includedFields : [];
    if (fields.length === 0) {
      issues.push({
        slotId: `canonicalSerialization/${item.target}/includedFields`,
        kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
        reason: `A serialização canônica '${item.target}' não declara a lista nominal de campos incluídos.`,
      });
    }
    const encodings = Array.isArray(item.fieldEncodings) ? item.fieldEncodings : [];
    const encodedFields = new Set(encodings.map((e) => e.field));
    checkReferenceIntegrity({
      items: fields,
      targetSet: encodedFields,
      onMissing: (f) => {
        issues.push({
          slotId: `canonicalSerialization/${item.target}/encoding/${f}`,
          kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
          reason: `O campo '${f}' na serialização canônica '${item.target}' não possui formato de encoding declarado em fieldEncodings.`,
        });
      },
    });
    if (!item.recordOrderingKey) {
      issues.push({
        slotId: `canonicalSerialization/${item.target}/recordOrderingKey`,
        kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
        reason: `A serialização canônica '${item.target}' não define recordOrderingKey para ordenação canônica dos registros.`,
      });
    } else {
      const orderKeyField = item.recordOrderingKey.trim().split(/\s+/)[0];
      const orderKeyFieldRaw = orderKeyField.includes('.') ? orderKeyField.split('.').pop() : orderKeyField;
      const isKnownOrderKey = fields.includes(orderKeyField)
        || fields.includes(orderKeyFieldRaw)
        || entityFieldKeys.has(orderKeyField)
        || entityFieldKeys.has(orderKeyFieldRaw);
      if (!isKnownOrderKey) {
        issues.push({
          slotId: `canonicalSerialization/${item.target}/recordOrderingKey`,
          kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
          reason: `O campo de ordenação '${orderKeyField}' em recordOrderingKey não pertence aos campos incluídos nem a nenhuma entidade conhecida.`,
        });
      }
      const targetEntity = (stateModel.entities ?? []).find((e) => e.name === item.target || item.target.startsWith(`${e.name}.`));
      const isIdentifierKey = /id$/i.test(orderKeyFieldRaw);
      if (targetEntity?.isCollection && !isIdentifierKey && !item.recordOrderingKey.includes(',')) {
        issues.push({
          slotId: `canonicalSerialization/${item.target}/recordOrderingKey/tieBreaking`,
          kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
          reason: `A serialização canônica da coleção '${item.target}' utiliza ordenação simples por campo não-identificador ('${item.recordOrderingKey}'). Exige desempate composto (ex: 'campo ASC, sequencia ASC') para garantir ordenação estritamente total sem empates.`,
        });
      }
    }
    if (!item.emptyStateDigest) {
      issues.push({
        slotId: `canonicalSerialization/${item.target}/emptyStateDigest`,
        kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
        reason: `A serialização canônica '${item.target}' não define o valor canônico emptyStateDigest para o estado vazio da primitiva.`,
      });
    }
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

function isConcreteTypedValue(value, fieldType, allowedValues = null) {
  if (value === null || value === undefined) return false;
  if (fieldType === 'INTEGER' || fieldType === 'NUMBER') {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return /^-?\d+(?:\.\d+)?n?$/u.test(value.trim());
    return false;
  }
  if (fieldType === 'BOOLEAN') {
    return typeof value === 'boolean' || value === 'true' || value === 'false';
  }
  if (fieldType === 'STRING') {
    if (typeof value !== 'string' || value.trim().length === 0) return false;
    if (Array.isArray(allowedValues) && allowedValues.length > 0 && !allowedValues.includes(value)) {
      return false;
    }
    return true;
  }
  return typeof value !== 'string' || value.trim().length > 0;
}

function validateProducerConsumerSymmetry(stateModel, workspaceSkeleton, issues) {
  const operations = stateModel.operations ?? [];
  for (const entity of stateModel.entities ?? []) {
    const entityHasProducer = (entity.fields ?? []).some((f) => {
      const fKey = `${entity.name}.${f.name}`;
      const viaMutation = (f.mutations ?? []).some((m) => operations.some((op) => op.name === m.operation));
      const viaBranch = operations.some((op) => (op.branches ?? []).some((b) => (
        (b.stateEffects ?? []).some((e) => (e.field === fKey || e.field === f.name) && e.effect !== 'PRESERVE')
      )));
      return viaMutation || viaBranch;
    });

    for (const field of entity.fields ?? []) {
      const readBy = Array.isArray(field.readBy) ? field.readBy : [];
      if (field.isReadOnly === true || readBy.length === 0) continue;
      if (entityExistsInWorkspaceSkeleton(entity.name, field.name, workspaceSkeleton)) continue;

      const fieldKey = `${entity.name}.${field.name}`;
      const hasFieldProducer = (field.mutations ?? []).some((m) => operations.some((op) => op.name === m.operation))
        || operations.some((op) => (op.branches ?? []).some((b) => (
          (b.stateEffects ?? []).some((e) => (e.field === fieldKey || e.field === field.name) && e.effect !== 'PRESERVE')
        )));
      if (hasFieldProducer) continue;

      const initKind = field.initialization?.kind;
      const initRaw = String(field.initialization?.value ?? '').trim();
      const isEmptyLiteral = /^(?:\[\]|\{\}|empty)$/iu.test(initRaw);
      const isScalarConstantInit = initKind === 'EXPLICIT_VALUE'
        && !isEmptyLiteral
        && field.type !== 'MAP'
        && field.type !== 'SET'
        && !/^ARRAY\b/i.test(String(field.type ?? ''));

      if (!isScalarConstantInit && !(entity.isCollection && entityHasProducer && initKind === 'EXPLICIT_VALUE' && !isEmptyLiteral)) {
        issues.push({
          slotId: `state/${fieldKey}/producer`,
          kind: 'MISSING_PRODUCER_OPERATION',
          reason: `O campo dinâmico ou coleção '${fieldKey}' está ausente de workspaceSkeleton, não possui inicialização constante suficiente e aparece em readBy sem operação produtora declarada.`,
        });
      }
    }
  }
}

function validateStatusPartitionsAndWitnesses({ stateModel, requirements, issues }) {
  const operations = stateModel.operations ?? [];
  const operationsByName = new Map(operations.map((op) => [op.name, op]));
  const allAcceptanceCases = (requirements ?? []).flatMap((r) => r.acceptanceCases ?? []);
  const allBranchRefs = new Set();
  for (const op of operations) {
    for (const b of op.branches ?? []) {
      allBranchRefs.add(b.branchId);
      allBranchRefs.add(`${op.name}.${b.branchId}`);
    }
  }

  for (const entity of stateModel.entities ?? []) {
    if (!entity.isCollection) continue;
    for (const field of entity.fields ?? []) {
      const allowed = Array.isArray(field.allowedValues) ? field.allowedValues : null;
      if (!allowed || allowed.length <= 1) continue;
      const fieldKey = `${entity.name}.${field.name}`;
      const guardedSet = new Set();
      for (const op of operations) {
        for (const branch of op.branches ?? []) {
          if (!Array.isArray(branch.guardedValues)) continue;
          if (branch.guardedField && branch.guardedField !== field.name && branch.guardedField !== fieldKey) continue;
          for (const val of branch.guardedValues) guardedSet.add(val);
        }
      }
      const missingValues = allowed.filter((val) => !guardedSet.has(val));
      if (missingValues.length > 0) {
        issues.push({
          slotId: `state/${fieldKey}/statusPartition`,
          kind: 'INCOMPLETE_STATUS_PARTITION',
          reason: `O campo de status multi-valor '${fieldKey}' em coleção exige partição completa explícita de todos os valores em allowedValues (ausentes: ${missingValues.join(', ')}).`,
        });
      }
    }
  }

  for (const op of operations) {
    const hasCollectionParam = (op.parameters ?? []).some((p) => (
      p.isCollection === true || String(p.type ?? '').toUpperCase() === 'ARRAY'
    ));
    const hasGuardOrQuota = (op.guardPrecedence ?? []).length > 0
      || (op.branches ?? []).some((b) => b.outcomeKind === 'REJECTION')
      || op.quota != null
      || (op.parameters ?? []).some((p) => p.bounds != null || p.domain != null);
    if (hasCollectionParam && hasGuardOrQuota) {
      const validPolicy = op.partialFailurePolicy === 'ALL_OR_NOTHING'
        || op.partialFailurePolicy === 'FAIL_FAST'
        || op.partialFailurePolicy === 'CONTINUE_ON_ERROR';
      if (!validPolicy) {
        issues.push({
          slotId: `operation/${op.name}/partialFailurePolicy`,
          kind: 'INCOMPLETE_BATCH_POLICY_OR_WITNESS',
          reason: `A operação em lote '${op.name}' sob guarda/cota não declara partialFailurePolicy ('ALL_OR_NOTHING' | 'FAIL_FAST' | 'CONTINUE_ON_ERROR').`,
        });
      }
      if (typeof op.consumptionOrder !== 'string' || op.consumptionOrder.trim().length === 0) {
        issues.push({
          slotId: `operation/${op.name}/consumptionOrder`,
          kind: 'INCOMPLETE_BATCH_POLICY_OR_WITNESS',
          reason: `A operação em lote '${op.name}' não declara consumptionOrder explícito.`,
        });
      }
      if (Array.isArray(requirements) && requirements.length > 0) {
        const opBranchRefs = new Set((op.branches ?? []).flatMap((b) => [b.branchId, `${op.name}.${b.branchId}`]));
        const batchCases = allAcceptanceCases.filter((ac) => (
          ac.batchWitness != null
          && (opBranchRefs.size === 0 || !ac.branchRef || opBranchRefs.has(ac.branchRef))
        ));
        if (batchCases.length === 0) {
          issues.push({
            slotId: `operation/${op.name}/batchWitness`,
            kind: 'INCOMPLETE_BATCH_POLICY_OR_WITNESS',
            reason: `A operação em lote '${op.name}' exige ao menos um acceptanceCase com batchWitness estruturado.`,
          });
        } else if (validPolicy) {
          for (const ac of batchCases) {
            const err = evaluateBatchWitnessError(op.partialFailurePolicy, ac.batchWitness);
            if (err) {
              issues.push({
                slotId: `operation/${op.name}/batchWitness/${ac.id ?? 'case'}`,
                kind: 'INCOMPLETE_BATCH_POLICY_OR_WITNESS',
                reason: err,
              });
            }
          }
        }
      }
    }
  }

  for (const ac of allAcceptanceCases) {
    if (ac.batchWitness != null && ac.branchRef) {
      const ownerOp = operations.find((op) => (op.branches ?? []).some((b) => (
        b.branchId === ac.branchRef || `${op.name}.${b.branchId}` === ac.branchRef
      )));
      if (ownerOp?.partialFailurePolicy) {
        const err = evaluateBatchWitnessError(ownerOp.partialFailurePolicy, ac.batchWitness);
        if (err && !issues.some((i) => i.slotId.includes(ownerOp.name) && i.kind === 'INCOMPLETE_BATCH_POLICY_OR_WITNESS')) {
          issues.push({
            slotId: `acceptanceCase/${ac.id ?? 'case'}/batchWitness`,
            kind: 'INCOMPLETE_BATCH_POLICY_OR_WITNESS',
            reason: err,
          });
        }
      }
    }
  }

  if (Array.isArray(requirements) && requirements.length > 0) {
    for (const entity of stateModel.entities ?? []) {
      for (const field of entity.fields ?? []) {
        const fieldKey = `${entity.name}.${field.name}`;
        const touchingOps = new Set();
        for (const r of field.readBy ?? []) {
          if (operationsByName.has(r)) touchingOps.add(r);
        }
        for (const m of field.mutations ?? []) {
          if (operationsByName.has(m.operation)) touchingOps.add(m.operation);
        }
        for (const op of operations) {
          if ((op.branches ?? []).some((b) => (b.stateEffects ?? []).some((e) => e.field === fieldKey || e.field === field.name))) {
            touchingOps.add(op.name);
          }
        }
        if (touchingOps.size > 1) {
          const matchingCases = allAcceptanceCases.filter((ac) => (
            ac.crossOperationWitness != null
            && (ac.crossOperationWitness.sharedField === field.name || ac.crossOperationWitness.sharedField === fieldKey)
          ));
          if (matchingCases.length === 0) {
            issues.push({
              slotId: `state/${fieldKey}/crossOperationWitness`,
              kind: 'MISSING_OR_INVALID_CROSS_OPERATION_WITNESS',
              reason: `O campo compartilhado '${fieldKey}' é tocado por ${touchingOps.size} operações distintas e exige acceptanceCase com crossOperationWitness estruturado.`,
            });
          } else {
            for (const ac of matchingCases) {
              const w = ac.crossOperationWitness;
              const seq = Array.isArray(w.operationSequence) ? w.operationSequence : [];
              const distinctValidSeq = new Set(seq.filter((opName) => touchingOps.has(opName))).size >= 2;
              const branchValid = typeof ac.branchRef === 'string' && ac.branchRef.trim().length > 0 && allBranchRefs.has(ac.branchRef);
              const concreteValid = isConcreteTypedValue(w.initialValue, field.type, field.allowedValues)
                && isConcreteTypedValue(w.expectedFinalValue, field.type, field.allowedValues);
              const outcomeValid = typeof w.expectedOutcome === 'string' && w.expectedOutcome.trim().length > 0;
              if (!distinctValidSeq || !branchValid || !concreteValid || !outcomeValid) {
                issues.push({
                  slotId: `state/${fieldKey}/crossOperationWitness/${ac.id ?? 'case'}`,
                  kind: 'MISSING_OR_INVALID_CROSS_OPERATION_WITNESS',
                  reason: `O crossOperationWitness de '${fieldKey}' deve conter >= 2 operações distintas da sequência, branchRef válido, expectedOutcome não vazio e valores concretos compatíveis com o tipo ${field.type}.`,
                });
              }
            }
          }
        }
      }
    }
  }

  let needsStringKeyWitness = false;
  for (const entity of stateModel.entities ?? []) {
    for (const field of entity.fields ?? []) {
      const isPartitionKey = entity.containerPolicy?.partitionKey === field.name
        || entity.containerPolicy?.partitionKey === `${entity.name}.${field.name}`;
      const isKeyTriggered = field.type === 'STRING'
        && (field.usedInLookup === true || field.usedInDeduplication === true || field.usedInPartition === true || isPartitionKey);
      if (isKeyTriggered) {
        needsStringKeyWitness = true;
        const policyRule = field.keyNormalizationPolicy
          ?? operations.find((op) => (field.readBy ?? []).includes(op.name) || (field.mutations ?? []).some((m) => m.operation === op.name))?.keyNormalizationPolicy;
        if (!CLOSED_KEY_NORMALIZATION_RULES.has(policyRule)) {
          issues.push({
            slotId: `state/${entity.name}.${field.name}/keyNormalizationPolicy`,
            kind: 'INVALID_KEY_NORMALIZATION_OR_WITNESS',
            reason: `A chave textual '${entity.name}.${field.name}' exige keyNormalizationPolicy em enum fechado.`,
          });
        }
      }
    }
  }
  for (const op of operations) {
    for (const param of op.parameters ?? []) {
      if (param.type === 'STRING' && (param.usedInLookup === true || param.usedInDeduplication === true || param.usedInPartition === true)) {
        needsStringKeyWitness = true;
        if (!CLOSED_KEY_NORMALIZATION_RULES.has(op.keyNormalizationPolicy)) {
          issues.push({
            slotId: `operation/${op.name}/parameter/${param.name}/keyNormalizationPolicy`,
            kind: 'INVALID_KEY_NORMALIZATION_OR_WITNESS',
            reason: `O parâmetro chave '${param.name}' na operação '${op.name}' exige op.keyNormalizationPolicy em enum fechado.`,
          });
        }
      }
    }
  }

  validateStandaloneKeyWitnesses(requirements, needsStringKeyWitness, issues);
}

function validateStandaloneKeyWitnesses(requirements, needsStringKeyWitness, issues) {
  const allAcceptanceCases = (requirements ?? []).flatMap((r) => r.acceptanceCases ?? []);
  const keyCases = allAcceptanceCases.filter((ac) => ac.keyComparisonWitness != null);
  if (needsStringKeyWitness && Array.isArray(requirements) && requirements.length > 0 && keyCases.length === 0) {
    issues.push({
      slotId: 'acceptanceCases/keyComparisonWitness',
      kind: 'INVALID_KEY_NORMALIZATION_OR_WITNESS',
      reason: 'Chave textual usada em lookup/deduplicação/partição exige acceptanceCase com keyComparisonWitness estruturado.',
    });
  }
  for (const ac of keyCases) {
    const w = ac.keyComparisonWitness;
    if (!CLOSED_KEY_NORMALIZATION_RULES.has(w.comparisonRule) || w.baselineKey === w.variationKey) {
      issues.push({
        slotId: `acceptanceCase/${ac.id ?? 'case'}/keyComparisonWitness`,
        kind: 'INVALID_KEY_NORMALIZATION_OR_WITNESS',
        reason: `O keyComparisonWitness em '${ac.id ?? 'case'}' exige baselineKey !== variationKey e comparisonRule em enum fechado.`,
      });
      continue;
    }
    const actualMatch = normalizeKey(w.baselineKey, w.comparisonRule) === normalizeKey(w.variationKey, w.comparisonRule)
      ? 'MATCH'
      : 'DISTINCT';
    if (w.expectedMatchResult !== actualMatch) {
      issues.push({
        slotId: `acceptanceCase/${ac.id ?? 'case'}/keyComparisonWitness`,
        kind: 'INVALID_KEY_NORMALIZATION_OR_WITNESS',
        reason: `Contradição matemática em keyComparisonWitness: normalizeKey('${w.baselineKey}', '${w.comparisonRule}') vs '${w.variationKey}' produz '${actualMatch}', não '${w.expectedMatchResult}'.`,
      });
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
    issues.push({
      slotId: 'stateModel/entities',
      kind: 'UNRESOLVED_STATE_MODEL',
      reason: 'A demanda declara contexto de operação com estado (stateful-operation), mas não define stateModel com entidades e campos de estado.',
    });
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

