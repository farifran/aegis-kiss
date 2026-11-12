import {
  checkReferenceIntegrity,
  validateContradictionDetection,
  validateOpenTermDependencies,
  validateOperationTotality,
} from './operation_totality.mjs';

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
export function validateFieldLifecycle({
  stateModel = null,
  architectureContexts = [],
  invariants = [],
  requirements = [],
  decisions = [],
  boundaryRules = [],
  pathReferences = [],
  resolvedDecisionIds = [],
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
    return {
      valid: false,
      issues,
    };
  }

  if (!stateModel || !Array.isArray(stateModel.entities)) {
    return {
      valid: true,
      issues: [],
    };
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

    if (entity.isCollection === true) {
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

      if (entity.containerPolicy) {
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
    }
  }

  for (const op of operations) {
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

  for (const obs of observables) {
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
      const bitAllocation = Array.isArray(obs.bitAllocation) ? obs.bitAllocation : [];
      if (bitAllocation.length === 0) {
        issues.push({
          slotId: `observable/${obs.name}/bitAllocation`,
          kind: 'INVALID_BITMASK_ALLOCATION',
          reason: `O observável em bitmask de 32 bits '${obs.name}' não define alocação explícita de fatias (bitAllocation).`,
        });
      } else {
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
          if (item.field !== 'RESERVED' && item.field !== '*') {
            const fieldObj = entityFieldsMap.get(item.field);
            if (fieldObj) {
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
        }
      }
    }
  }

  const isIntegrityHash = architectureContexts.some((ctx) => (
    (typeof ctx === 'string' ? ctx : ctx.tag) === 'integrity-hash'
  ));
  if (isIntegrityHash) {
    const serializations = Array.isArray(stateModel.canonicalSerializations)
      ? stateModel.canonicalSerializations
      : [];
    if (serializations.length === 0) {
      issues.push({
        slotId: 'stateModel/canonicalSerializations',
        kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
        reason: 'A demanda envolve integridade de hash/digest (integrity-hash), mas o stateModel não define canonicalSerializations com a quádrupla canônica.',
      });
    } else {
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
  }

  const totalityResult = validateOperationTotality({ stateModel, architectureContexts });
  issues.push(...totalityResult.issues);

  const contradictionResult = validateContradictionDetection({
    stateModel,
    invariants,
    requirements,
  });
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

