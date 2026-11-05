/**
 * Checks inventory obligations activated explicitly by semantic context tags.
 * It does not infer applicability from names, prose or unclassified literal facts.
 */
export function validateSemanticInventoryCoverage({ stateModel = null, architectureContexts = [] } = {}) {
  const issues = [];
  const tags = new Set(architectureContexts.map(ctx => typeof ctx === 'string' ? ctx : ctx.tag));
  const obligations = [
    ['stateful-operation', 'entities', 'MISSING_STATEFUL_ENTITY_INVENTORY'],
    ['bounded-observability', 'observables', 'MISSING_BOUNDED_OBSERVABILITY_INVENTORY'],
    ['integrity-hash', 'canonicalSerializations', 'MISSING_CANONICAL_SERIALIZATION_INVENTORY'],
  ];
  for (const [tag, collection, kind] of obligations) {
    if (tags.has(tag) && !(stateModel?.[collection]?.length > 0)) {
      issues.push({ slotId: `inventory/${collection}`, kind,
        reason: `O contexto declarado '${tag}' exige entradas em '${collection}'.` });
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
 * Utilitário Relacional Genérico de Integridade de Referências (Passo 3: Verificação Declarativa).
 * Valida de forma uniforme se referências de uma coleção existem no conjunto-alvo de chaves autorizadas.
 */
export function checkReferenceIntegrity({
  items,
  getKey = (item) => item,
  targetSet,
  ignoredKeys = null,
  onMissing,
}) {
  if (!items || !targetSet) return;
  for (const item of items) {
    const key = getKey(item);
    if (key === undefined || key === null) continue;
    if (ignoredKeys && ignoredKeys.has(key)) continue;
    if (!targetSet.has(key)) {
      onMissing(key, item);
    }
  }
}

/**
 * Validador Mecânico de Ciclo de Vida de Campos de Estado (validateFieldLifecycle).
 * 
 * Implementa a verificação de totalidade de transição de estado sobre o IR:
 * - INIT: Todo campo exige valor inicial explícito, configurado ou derivado.
 * - TRANSITION: Toda operação do sistema deve declarar mutação ou preservação explícita sobre o campo.
 * - RESET: Todo contador, acumulador ou campo rearmável exige gatilho e valor de reset explícitos.
 * - PRECEDENCE: Toda operação deve definir a precedência determinística estrita de guards.
 * - READ_BY: Nenhum campo de estado pode ser órfão de leitores (operações ou observáveis).
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

      // 1. INIT: Obrigatório e total
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

      // 3. TRANSITIONS: Cobertura total de operações do sistema (UPDATE ou PRESERVE)
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

      // 4. READ_BY: Sem campos órfãos
      const readBy = Array.isArray(field.readBy) ? field.readBy : [];
      if (readBy.length === 0) {
        issues.push({
          slotId: `state/${fieldKey}/readBy`,
          kind: 'ORPHAN_STATE_FIELD',
          reason: `O campo '${fieldKey}' não declara leitores (operações ou observáveis).`,
        });
      }

      // 5. BOUNDS & BOUNDARY_BEHAVIOR: Obrigatório para inteiros e contadores
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

    // 6. COLLECTION CAPACITY & ADMISSION: Obrigatório se isCollection === true
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

  // 7. Empty guards require explicit justification, never an inferred exemption.
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

  // 8. OBSERVABLES: Todo observável deve declarar origem, representação e comportamento em estado vazio
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

  // 9. CANONICAL SERIALIZATION: Se o contexto demandar integridade de hash/digest
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

  // 10. OPERATION TOTALITY: Totalidade de branches e guards
  const totalityResult = validateOperationTotality({ stateModel, architectureContexts });
  issues.push(...totalityResult.issues);

  // 14. CONTRADICTION DETECTION: Detecção ativa de contradições estruturais
  const contradictionResult = validateContradictionDetection({
    stateModel,
    invariants,
    requirements,
  });
  issues.push(...contradictionResult.issues);

  // 17. OPEN TERM DEPENDENCIES: Validação de Termos Fundamentados e Efeitos Físicos
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

/**
 * Validador Mecânico de Totalidade de Operações e Branches (validateOperationTotality).
 * 
 * Verifica que cada operação:
 * 1. Cada guarda em guardPrecedence possui branch de rejeição correspondente (se branches definidos).
 * 3. Cada branch cobre todos os campos de entidade (via stateEffects explícito ou defaultPreservation: true).
 * 4. Existe ao menos um branch de execução bem-sucedida (não-rejeição).
 */
export function validateOperationTotality({
  stateModel = null,
} = {}) {
  const issues = [];

  if (!stateModel || !Array.isArray(stateModel.operations)) {
    return {
      valid: true,
      issues: [],
    };
  }

  const allEntityFields = new Set();
  if (Array.isArray(stateModel.entities)) {
    for (const entity of stateModel.entities) {
      const fields = Array.isArray(entity.fields) ? entity.fields : [];
      for (const field of fields) {
        allEntityFields.add(`${entity.name}.${field.name}`);
      }
    }
  }

  for (const op of stateModel.operations) {
    if (op.returnContract) {
      if (!op.returnContract.successType || !op.returnContract.errorProtocol) {
        issues.push({
          slotId: `operation/${op.name}/returnContract`,
          kind: 'UNRESOLVED_RETURN_CONTRACT',
          reason: `A operação '${op.name}' declara returnContract incompleto (exige successType e errorProtocol).`,
        });
      }
    }

    const guardPrecedence = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
    const branchIds = (op.branches ?? []).map(branch => branch.branchId);
    if (new Set(branchIds).size !== branchIds.length
      || new Set(guardPrecedence).size !== guardPrecedence.length) {
      issues.push({ slotId: `operation/${op.name}/identities`, kind: 'CONFLICTING_STATE_DECLARATIONS',
        reason: `A operação '${op.name}' repete identificadores de branches ou guardas.` });
    }

    if (Array.isArray(op.branches) && op.branches.length > 0) {
      // 1. Cada guarda em guardPrecedence deve ter branch de rejeição correspondente
      const rejectionBranchIds = new Set(
        op.branches.filter((b) => b.outcomeKind === 'REJECTION').map((b) => b.branchId)
      );
      checkReferenceIntegrity({
        items: guardPrecedence,
        targetSet: rejectionBranchIds,
        onMissing: (guard) => {
          issues.push({
            slotId: `operation/${op.name}/guard/${guard}/rejection`,
            kind: 'MISSING_GUARD_REJECTION_BRANCH',
            reason: `A operação '${op.name}' define o guard '${guard}' em guardPrecedence, mas não possui branch de rejeição correspondente.`,
          });
        },
      });

      // 3. Totality de next-state por branch
      for (const branch of op.branches) {
        const explicitFields = new Set();
        for (const effect of branch.stateEffects ?? []) {
          if (!allEntityFields.has(effect.field) || explicitFields.has(effect.field)) {
            issues.push({ slotId: `operation/${op.name}/branch/${branch.branchId}/effect/${effect.field}`,
              kind: 'CONFLICTING_STATE_DECLARATIONS',
              reason: `O efeito referencia campo inexistente ou repetido: '${effect.field}'.` });
          }
          explicitFields.add(effect.field);
        }
        if (branch.defaultPreservation !== true) {
          const effects = Array.isArray(branch.stateEffects) ? branch.stateEffects : [];
          const coveredFields = new Set(effects.map((e) => e.field));

          checkReferenceIntegrity({
            items: allEntityFields,
            targetSet: coveredFields,
            onMissing: (fieldKey) => {
              issues.push({
                slotId: `operation/${op.name}/branch/${branch.branchId}/missingField/${fieldKey}`,
                kind: 'UNDETERMINED_BRANCH_NEXT_STATE',
                reason: `O branch '${branch.branchId}' da operação '${op.name}' não determina o próximo estado para o campo '${fieldKey}' (ausente em stateEffects sem defaultPreservation: true).`,
              });
            },
          });
        }
      }

      // 4. Ao menos um branch de execução bem-sucedida
      const hasSuccessBranch = op.branches.some((branch) => branch.outcomeKind !== 'REJECTION');
      if (!hasSuccessBranch) {
        issues.push({
          slotId: `operation/${op.name}/successBranch`,
          kind: 'MISSING_SUCCESS_BRANCH',
          reason: `A operação '${op.name}' define apenas branches de rejeição, sem nenhum branch de avanço normal de fluxo ou sucesso.`,
        });
      }

      // 5. Coerência entre mutações declaradas nos campos e efeitos nos branches
      for (const entity of (stateModel.entities ?? [])) {
        for (const field of (entity.fields ?? [])) {
          const fieldKey = `${entity.name}.${field.name}`;
          const declaredMutations = (field.mutations ?? []).filter((m) => m.operation === op.name);
          for (const m of declaredMutations) {
            const hasBranchEffect = (op.branches ?? []).some((b) => (
              (b.stateEffects ?? []).some((eff) => eff.field === fieldKey || eff.field === field.name)
              || b.branchId === m.condition
            ));
            if (!hasBranchEffect) {
              issues.push({
                slotId: `operation/${op.name}/mutationCoverage/${fieldKey}/${m.condition}`,
                kind: 'UNRESOLVED_TRANSITION',
                reason: `O campo '${fieldKey}' declara mutação na operação '${op.name}' sob condição '${m.condition}', mas nenhum branch da operação especifica stateEffects nem branchId correspondente.`,
              });
            }
          }
        }
      }
    }

    // 6. Parâmetros numéricos com domínio e limites fechados
    for (const param of (op.parameters ?? [])) {
      if ((param.type === 'INTEGER' || param.type === 'NUMBER') && !param.bounds && !param.domain) {
        issues.push({
          slotId: `operation/${op.name}/parameter/${param.name}/domain`,
          kind: 'UNRESOLVED_FIELD_BOUNDS',
          reason: `O parâmetro '${param.name}' da operação '${op.name}' é do tipo ${param.type} mas não define limites nem domínio numérico fechado (bounds).`,
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
 * Validador Mecânico de Detecção Ativa de Contradições (validateContradictionDetection).
 * 
 * Cruza invariantes, requisitos e modelo de operações antes de certificar fechamento:
 * 1. Operação não pode executar DECREMENT sem guards sobre campo protegido por invariante ou limite inferior.
 * 2. Critérios de aceitação que exigem REJECTION exigem ramos de rejeição nas operações.
 */
export function validateContradictionDetection({
  specification = null,
  stateModel = specification?.stateModel ?? null,
  invariants = specification?.invariants ?? [],
  requirements = specification?.requirements ?? [],
} = {}) {
  const issues = [];
  if (!stateModel) {
    return { valid: true, issues: [] };
  }

  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  const entities = Array.isArray(stateModel.entities) ? stateModel.entities : [];

  for (const entity of entities) {
    for (const field of entity.fields ?? []) {
      const fieldKey = `${entity.name}.${field.name}`;

      const protectingInvariants = (invariants ?? []).filter((inv) => {
        const text = `${inv.statement ?? ''} ${inv.falsification ?? ''}`.toLowerCase();
        const fieldNameLower = field.name.toLowerCase();
        const entityNameLower = entity.name.toLowerCase();
        return (
          text.includes(fieldNameLower) ||
          text.includes(`${entityNameLower}.${fieldNameLower}`) ||
          (field.isCounter && (text.includes('negativo') || text.includes('underflow')))
        );
      });

      if (protectingInvariants.length > 0) {
        for (const op of operations) {
          const branches = Array.isArray(op.branches) ? op.branches : [];
          for (const branch of branches) {
            const effects = Array.isArray(branch.stateEffects) ? branch.stateEffects : [];
            const hasDecrement = effects.some((e) => e.field === fieldKey && e.effect === 'DECREMENT');

            if (hasDecrement) {
              if (op.returnContract) {
      if (!op.returnContract.successType || !op.returnContract.errorProtocol) {
        issues.push({
          slotId: `operation/${op.name}/returnContract`,
          kind: 'UNRESOLVED_RETURN_CONTRACT',
          reason: `A operação '${op.name}' declara returnContract incompleto (exige successType e errorProtocol).`,
        });
      }
    }

    const guardPrecedence = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
              if (guardPrecedence.length === 0) {
                const invIds = protectingInvariants.map((inv) => inv.id).join(', ');
                issues.push({
                  slotId: `operation/${op.name}/contradiction/${fieldKey}`,
                  kind: 'CONTRADICTORY_RULE_DETECTED',
                  reason: `A operação '${op.name}' executa DECREMENT no campo protegido '${fieldKey}' sem nenhum guard de verificação de saldo/limite, contradizendo o invariante (${invIds}).`,
                });
              } else {
                const rejectionBranches = branches.filter((b) => b.outcomeKind === 'REJECTION');
                if (rejectionBranches.length === 0) {
                  const invIds = protectingInvariants.map((inv) => inv.id).join(', ');
                  issues.push({
                    slotId: `operation/${op.name}/contradiction/${fieldKey}`,
                    kind: 'CONTRADICTORY_RULE_DETECTED',
                    reason: `A operação '${op.name}' executa DECREMENT no campo protegido '${fieldKey}' mas não define nenhum branch de rejeição para impedir violação do invariante (${invIds}).`,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  const hasRejectionAC = (requirements ?? []).some((r) =>
    (r.acceptanceCases ?? []).some((ac) => ac.outcomeKind === 'REJECTION')
  );
  if (hasRejectionAC && operations.length > 0) {
    const hasAnyRejectionBranch = operations.some((op) =>
      (op.branches ?? []).some((b) => b.outcomeKind === 'REJECTION')
    );
    if (!hasAnyRejectionBranch) {
      issues.push({
        slotId: 'operations/rejectionContradiction',
        kind: 'CONTRADICTORY_RULE_DETECTED',
        reason: 'Os critérios de aceitação (acceptanceCases) exigem desfecho de rejeição (REJECTION), mas nenhuma operação declara ramos de rejeição.',
      });
    }
  }

  // 3. Contradição de Admissão vs Comportamento de Observáveis
  for (const entity of entities) {
    if (entity.isCollection && entity.admissionPolicy === 'ON_FIRST_REQUEST') {
      for (const obs of stateModel.observables ?? []) {
        if (typeof obs.emptyBehavior === 'string' && /reject.*(?:unregistered|empty|unknown)/iu.test(obs.emptyBehavior)) {
          issues.push({
            slotId: `observable/${obs.name}/admissionContradiction`,
            kind: 'CONTRADICTORY_RULE_DETECTED',
            reason: `A entidade '${entity.name}' possui admissionPolicy 'ON_FIRST_REQUEST' (criação automática), mas o observável '${obs.name}' declara emptyBehavior de rejeição ('${obs.emptyBehavior}'). Essa contradição interna impede fechamento determinístico.`,
          });
        }
      }
    }
  }

  // 4. Contradição de Bitmask vazia com Digest canônico
  const serializations = Array.isArray(stateModel.canonicalSerializations) ? stateModel.canonicalSerializations : [];
  for (const obs of stateModel.observables ?? []) {
    if (obs.representation === 'UINT32_BITMASK') {
      const emptyVal = String(obs.emptyBehavior ?? '').trim();
      if (emptyVal === '0' || emptyVal === '0x0') {
        const bitAllocation = Array.isArray(obs.bitAllocation) ? obs.bitAllocation : [];

        for (const item of bitAllocation) {
          const canon = serializations.find((cs) => cs.target === item.field || (typeof item.mapping === 'string' && item.mapping.includes(cs.target)));
          if (canon && canon.emptyStateDigest && canon.emptyStateDigest !== '0' && canon.emptyStateDigest !== '0x0') {
            issues.push({
              slotId: `observable/${obs.name}/bitmaskEmptyDigestContradiction`,
              kind: 'CONTRADICTORY_RULE_DETECTED',
              reason: `O observável bitmask '${obs.name}' declara emptyBehavior = '0', mas a fatia '${item.slice}' codifica digest canônico com emptyStateDigest '${canon.emptyStateDigest}' (não-nulo). Declarar zero na coleção vazia contradiz a quádrupla canônica.`,
            });
          }
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validador Mecânico de Provenance Obrigatório (validateProvenanceEnforcement).
 * 
 * Proíbe literais numéricos arbitrários (100000, 2^31-1, 999, etc.) em bounds, capacities e limites.
 * Todo número especificado deve possuir procedência tipada autorizada.
 */
export function validateProvenanceEnforcement({
  stateModel = null,
  architecturePolicy = null,
  literalFacts = [],
  fragments = [],
  intent = '',
} = {}) {
  const issues = [];
  if (!stateModel) return { valid: true, issues: [] };

  const hasProvenanceContext = literalFacts.length > 0 || fragments.length > 0 || (
    stateModel.entities?.some((e) => (
      Boolean(e.capacityPolicy?.provenance)
      || e.fields?.some((f) => Boolean(f.bounds?.provenance))
    ))
  );

  if (!hasProvenanceContext) {
    return { valid: true, issues: [] };
  }

  const validPolicyRuleIds = new Set(architecturePolicy?.rules?.map((r) => r.id) ?? [
    'ARCH-PARSIMONY', 'ARCH-PRODUCT-BOUNDARY', 'ARCH-STRICT-EXPLICIT-MODULES',
    'ARCH-FAILURE-EXPLICIT', 'ARCH-DETERMINISTIC-TIME', 'ARCH-OBSERVABILITY-COUNTERS',
    'ARCH-HASH-SECURITY-LABEL', 'ARCH-CANONICAL-DIGEST-REPRESENTATION', 'ARCH-BIGINT-ARITHMETIC',
    'ARCH-LOCAL-DETERMINISTIC-CORE', 'ARCH-PUBLIC-INTERFACE', 'ARCH-CONTRACT-CONSISTENCY',
    'ARCH-STATE-TRANSITION-TOTALITY', 'ARCH-TEMPORAL-INVARIANCE', 'ARCH-MINIMAL-SUFFICIENT-CLOSURE',
  ]);

  const factsById = new Map(literalFacts.map((f) => [f.id, f]));
  const fragmentsById = new Map(fragments.map((f) => [f.id, f]));

  const factSupportsValue = (fact, valStr) => {
    if (valStr === '0' || valStr === '1') return true;
    const clean = (s) => String(s).replaceAll('_', '').replace(/n$/u, '').trim();
    const cleanVal = clean(valStr);
    if (fact.attributes?.value !== undefined) {
      const cleanFact = clean(fact.attributes.value);
      if (cleanFact === cleanVal) return true;
      try {
        if (BigInt(cleanFact) === BigInt(cleanVal)) return true;
      } catch {
        // ignore non-integer comparison
      }
    }
    if (fact.attributes?.width !== undefined) {
      const w = fact.attributes.width;
      if (String(w) === valStr || String((2 ** w) - 1) === valStr || String(Math.pow(2, w - 1) - 1) === valStr) return true;
    }
    if (fact.attributes?.bitWidth !== undefined) {
      const w = fact.attributes.bitWidth;
      if (String(w) === valStr || String((2 ** w) - 1) === valStr || String(Math.pow(2, w - 1) - 1) === valStr) return true;
    }
    if (fact.attributes?.start !== undefined && String(fact.attributes.start) === valStr) return true;
    if (fact.attributes?.end !== undefined && String(fact.attributes.end) === valStr) return true;
    return false;
  };

  if (Array.isArray(stateModel.entities)) {
    for (const entity of stateModel.entities) {
      if (entity.isCollection && entity.capacityPolicy?.maxEntries !== null && entity.capacityPolicy?.maxEntries !== undefined) {
        const maxVal = String(entity.capacityPolicy.maxEntries);
        const prov = entity.capacityPolicy.provenance;
        if (!prov || !Array.isArray(prov) || prov.length === 0) {
          issues.push({
            slotId: `entity/${entity.name}/capacityPolicy/provenance`,
            kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
            reason: `A capacidade máxima '${maxVal}' da entidade '${entity.name}' não possui declaração de provenance autorizada.`,
          });
        } else {
          for (const p of prov) {
            if (p.source === 'USER_INTENT') {
              if (typeof p.reference === 'string' && p.reference.startsWith('FACT-')) {
                const fact = factsById.get(p.reference);
                if (!fact) {
                  issues.push({
                    slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O valor de capacidade '${maxVal}' cita o fato literal '${p.reference}' que não existe na evidência da demanda.`,
                  });
                } else if (!factSupportsValue(fact, maxVal)) {
                  issues.push({
                    slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O valor de capacidade '${maxVal}' cita o fato '${p.reference}', mas os atributos do fato não autorizam esse valor.`,
                  });
                }
              } else if (typeof p.reference === 'string' && p.reference.startsWith('FRAG-')) {
                if (fragmentsById.size > 0 && !fragmentsById.has(p.reference)) {
                  issues.push({
                    slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O valor de capacidade '${maxVal}' cita o fragmento '${p.reference}' que não existe na evidência da demanda.`,
                  });
                }
              } else if (intent && intent.length > 0 && typeof p.reference === 'string' && !intent.includes(p.reference)) {
                issues.push({
                  slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                  kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                  reason: `A referência '${p.reference}' citada em USER_INTENT para a capacidade máxima '${maxVal}' não aparece no texto da demanda.`,
                });
              }
            } else if ((p.source === 'ARCHITECTURE_POLICY' || p.source === 'SAFE_MECHANICAL_DEFAULT') && !validPolicyRuleIds.has(p.reference)) {
              issues.push({
                slotId: `entity/${entity.name}/capacityPolicy/unauthorizedPolicy`,
                kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                reason: `A regra de política '${p.reference}' citada para capacidade '${maxVal}' não existe na governança.`,
              });
            }
          }
        }
      }

      for (const field of entity.fields ?? []) {
        if (field.bounds) {
          const { lowerBound, upperBound, provenance } = field.bounds;
          const checkBound = (val, boundKind) => {
            if (val === null || val === undefined) return;
            const valStr = String(val);

            if (!provenance || !Array.isArray(provenance) || provenance.length === 0) {
              issues.push({
                slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/provenance`,
                kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                reason: `O limite ${boundKind} '${valStr}' do campo '${entity.name}.${field.name}' não possui provenance autorizada.`,
              });
            } else {
              let hasValidFactRef = false;
              let anyFactSupportsBound = false;
              let hasNonFactSupport = false;
              for (const p of provenance) {
                if (p.source === 'USER_INTENT') {
                  if (typeof p.reference === 'string' && p.reference.startsWith('FACT-')) {
                    const fact = factsById.get(p.reference);
                    if (!fact) {
                      issues.push({
                        slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                        kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                        reason: `O limite ${boundKind} '${valStr}' do campo '${entity.name}.${field.name}' cita o fato '${p.reference}' que não existe na evidência da demanda.`,
                      });
                    } else {
                      hasValidFactRef = true;
                      if (factSupportsValue(fact, valStr)) {
                        anyFactSupportsBound = true;
                      }
                    }
                  } else if (typeof p.reference === 'string' && p.reference.startsWith('FRAG-')) {
                    if (fragmentsById.size > 0 && !fragmentsById.has(p.reference)) {
                      issues.push({
                        slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                        kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                        reason: `O limite ${boundKind} '${valStr}' cita o fragmento '${p.reference}' que não existe na evidência da demanda.`,
                      });
                    } else {
                      hasNonFactSupport = true;
                    }
                  } else if (intent && intent.length > 0 && typeof p.reference === 'string' && !intent.includes(p.reference)) {
                    issues.push({
                      slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                      kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                      reason: `A referência '${p.reference}' citada em USER_INTENT para o limite '${valStr}' não aparece no texto da demanda.`,
                    });
                  } else {
                    hasNonFactSupport = true;
                  }
                } else if ((p.source === 'ARCHITECTURE_POLICY' || p.source === 'SAFE_MECHANICAL_DEFAULT') && !validPolicyRuleIds.has(p.reference)) {
                  issues.push({
                    slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedPolicy`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `A regra de política '${p.reference}' citada para o limite '${valStr}' não existe na governança.`,
                  });
                } else {
                  hasNonFactSupport = true;
                }
              }
              if (hasValidFactRef && !anyFactSupportsBound && !hasNonFactSupport) {
                issues.push({
                  slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                  kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                  reason: `O limite ${boundKind} '${valStr}' do campo '${entity.name}.${field.name}' não é autorizado pelos fatos literais citados em provenance.`,
                });
              }
            }
          };

          checkBound(lowerBound, 'lowerBound');
          checkBound(upperBound, 'upperBound');
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validador Mecânico de Fechamento de Expressões de Operações e Efeitos Externos.
 * 
 * Verifica que:
 * 1. Expressões em `stateEffects[].value` e `mutations[].targetValue` utilizem apenas
 *    símbolos fundamentados (parâmetros de operação, campos de entidade, regras de fronteira,
 *    decisões vinculadas ou observáveis).
 * 2. Quando houver superfície com efeito externo (`external-effect` / `PUBLIC_SURFACE`),
 *    exista cobertura, verificação de confirmação e estratégia de rollback.
 */
export function validateOpenTermDependencies({
  stateModel = null,
  decisions = [],
  boundaryRules = [],
  pathReferences = [],
  architectureContexts = [],
} = {}) {
  const issues = [];
  if (!stateModel) {
    return { valid: true, issues: [] };
  }

  const entityFields = new Set();
  const rawFieldNames = new Set();
  for (const entity of (stateModel.entities ?? [])) {
    for (const field of (entity.fields ?? [])) {
      entityFields.add(`${entity.name}.${field.name}`);
      rawFieldNames.add(field.name);
    }
    if (entity.isCollection) {
      entityFields.add(`${entity.name}.id`);
      rawFieldNames.add('id');
    }
  }

  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  const operationParams = new Set(operations.flatMap((op) => (op.parameters ?? []).map((p) => p.name)));
  const configKeys = new Set((boundaryRules ?? []).flatMap((r) => [r.ruleId, r.source].filter(Boolean)));
  const decisionIds = new Set((decisions ?? []).flatMap((d) => [d.questionId, d.semanticKey, d.id].filter(Boolean)));

  const ignoredTokens = new Set([
    'if', 'then', 'else', 'true', 'false', 'null', 'undefined', 'none', 'empty', 'now',
    'max', 'min', 'abs', 'sum', 'avg', 'sqrt', 'floor', 'ceil', 'round', 'clamp',
    'return', 'and', 'or', 'not', 'n', 'bigint', 'case', 'when', 'end', 'is', 'in',
  ]);

  function isTermKnown(token, extraParams = null) {
    const tokenRoot = token.includes('.') ? token.split('.')[0] : token;
    return (extraParams && (extraParams.has(token) || extraParams.has(tokenRoot)))
      || rawFieldNames.has(token) || rawFieldNames.has(tokenRoot)
      || entityFields.has(token)
      || configKeys.has(token) || configKeys.has(tokenRoot)
      || decisionIds.has(token) || decisionIds.has(tokenRoot)
      || (stateModel.observables ?? []).some((o) => o.name === token);
  }

  function extractTermTokens(exprStr) {
    if (typeof exprStr !== 'string') return [];
    const val = exprStr.trim();
    if (!val || /^-?\d+(?:n|\.\d+)?$/i.test(val) || val === 'true' || val === 'false' || val.startsWith("'") || val.startsWith('"')) return [];
    const functionCalls = new Set([...val.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map((m) => m[1]));
    return val
      .replace(/['"][^'"]*['"]/g, ' ')
      .split(/[^a-zA-Z0-9_.]+/)
      .filter((t) => t.length > 0 && isNaN(Number(t)) && !ignoredTokens.has(t.toLowerCase()) && !functionCalls.has(t) && !/^\d+n$/i.test(t));
  }

  for (const op of operations) {
    const opParams = new Set((op.parameters ?? []).map((p) => p.name));
    for (const branch of (op.branches ?? [])) {
      for (const eff of (branch.stateEffects ?? [])) {
        for (const token of extractTermTokens(eff.value)) {
          if (!isTermKnown(token, opParams)) {
            issues.push({
              slotId: `operation/${op.name}/branch/${branch.branchId}/stateEffect/${eff.field}`,
              kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
              reason: `O efeito no campo '${eff.field}' na operação '${op.name}' utiliza o termo '${token}', que não é parâmetro nem campo de estado fundamentado.`,
            });
          }
        }
      }
    }
  }
  for (const entity of (stateModel.entities ?? [])) {
    for (const field of (entity.fields ?? [])) {
      for (const m of (field.mutations ?? [])) {
        for (const token of extractTermTokens(m.targetValue)) {
          if (!isTermKnown(token, operationParams)) {
            issues.push({
              slotId: `entity/${entity.name}/field/${field.name}/mutation/${m.condition}`,
              kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
              reason: `A mutação no campo '${entity.name}.${field.name}' na condição '${m.condition}' utiliza o termo '${token}', que não é parâmetro nem campo de estado fundamentado.`,
            });
          }
        }
      }
    }
  }

  const hasExternalEffectContext = (architectureContexts ?? []).some((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag) === 'external-effect') || (pathReferences ?? []).some((p) => p.role === 'PUBLIC_SURFACE');
  if (hasExternalEffectContext) {
    const publicSurfaces = (Array.isArray(pathReferences) ? pathReferences : []).filter((p) => p.role === 'PUBLIC_SURFACE' || p.role === 'PERSISTENT_STORAGE');
    for (const pub of publicSurfaces) {
      const pubPath = pub.path;
      const covered = operations.some((op) => (op.branches ?? []).some((b) => (b.externalEffects ?? []).some((eff) => eff.targetPath === pubPath || pubPath.includes(eff.targetPath) || eff.targetPath?.includes(pubPath))));
      if (!covered) {
        issues.push({ slotId: `pathReferences/${pubPath}`, kind: 'EXTERNAL_EFFECT_COVERAGE_MISSING', reason: `A superfície pública '${pubPath}' não possui efeito externo físico modelado em operações.` });
      }
    }

    for (const op of operations) {
      for (const branch of (op.branches ?? [])) {
        for (const eff of (branch.externalEffects ?? [])) {
          const target = eff.targetPath || eff.targetSurface || op.name;
          const action = eff.action || 'UNKNOWN_ACTION';
          const slotPrefix = `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}`;
          if (!eff.confirmationCheck || typeof eff.confirmationCheck !== 'string' || eff.confirmationCheck.trim().length === 0) {
            issues.push({ slotId: `${slotPrefix}/confirmationCheck`, kind: 'INCOMPLETE_EXTERNAL_EFFECT', reason: `O efeito externo '${action}' sobre '${target}' não possui 'confirmationCheck'.` });
          }
          if (!eff.onSuccess || typeof eff.onSuccess !== 'string' || eff.onSuccess.trim().length === 0) {
            issues.push({ slotId: `${slotPrefix}/onSuccess`, kind: 'INCOMPLETE_EXTERNAL_EFFECT', reason: `O efeito externo '${action}' sobre '${target}' não define 'onSuccess'.` });
          }
          if (!eff.onFailure || typeof eff.onFailure !== 'string' || eff.onFailure.trim().length === 0) {
            issues.push({ slotId: `${slotPrefix}/onFailure`, kind: 'INCOMPLETE_EXTERNAL_EFFECT', reason: `O efeito externo '${action}' sobre '${target}' não define 'onFailure'.` });
          }
        }
      }

      const hasExtEffects = (op.branches ?? []).some((b) => (b.externalEffects ?? []).some((eff) => ['WRITE_FILE', 'APPEND_CONTENT', 'MOVE_FILE', 'DELETE_FILE', 'PURGE_TEMPORARY', 'WRITE_TEMP', 'APPEND_LOG', 'RENAME', 'DELETE_TEMP', 'ATOMIC_SUBSTITUTE'].includes(eff.action)));
      if (hasExtEffects) {
        const hasOpRollback = Boolean(op.rollback?.strategy) || (op.branches ?? []).some((b) => Boolean(b.rollback?.strategy) || (b.externalEffects ?? []).some((e) => Boolean(e.rollback?.strategy)));
        if (!hasOpRollback) {
          issues.push({ slotId: `operations/${op.name}/rollback`, kind: 'TRANSACTION_ROLLBACK_MISSING', reason: `A operação '${op.name}' realiza mutação externa persistente ou criação provisória sem estratégia mecânica de rollback ou limpeza de arquivos órfãos sob falha.` });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

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
    || i.kind === 'CROSS_LAYER_CONTRADICTION'
  ));

  // Gaps materiais sem decisão vinculada
  const materialUnknownGaps = (specification.unknowns ?? []).filter(({ material, decisionId }) => (
    material && decisionId === null
  ));

  // Dimensões de determinismo com GAP_FOUND
  const determinismGaps = (specification.determinismReview?.dimensions ?? []).filter(({ status }) => (
    status === 'GAP_FOUND'
  ));

  // Dimensões aguardando decisão humana
  const determinismDecisions = (specification.determinismReview?.dimensions ?? []).filter(({ status }) => (
    status === 'DECISION_REQUIRED'
  ));

  // Decisões humanas pendentes
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
    || i.kind === 'UNRESOLVED_COMPUTATIONAL_DEPENDENCY'
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

  // Uma lacuna é uma decisão pendente, não cada superfície em que ela aparece:
  // a dimensão de determinismo que aponta para uma decisão pendente é uma manifestação dela.
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

const GAP_KIND_MAP = {
  // TRANSITION_CONSISTENCY
  UNRESOLVED_TRANSITION: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason || `Operação '${i.operation || i.slotId}' não define transição para todas as condições.`],
  UNRESOLVED_GUARD_PRECEDENCE: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason || `Operação '${i.operation || i.slotId}' possui múltiplos guards sem precedência linear estrita.`],
  MISSING_GUARD_REJECTION_BRANCH: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason || 'Guard de rejeição sem ramo correspondente em branches.'],
  UNDETERMINED_BRANCH_NEXT_STATE: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason || 'Ramo de operação possui próximo estado não determinado.'],
  MISSING_SUCCESS_BRANCH: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason || 'Operação sem ramo explícito de autorização/sucesso.'],
  CONFLICTING_STATE_DECLARATIONS: ['TRANSITION_CONSISTENCY', 'USER_INTENT', (i) => i.reason],
  CONTRADICTORY_RULE_DETECTED: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Contradição ativa detectada entre invariantes, requisitos e operações.'],
  CROSS_LAYER_CONTRADICTION: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Contradição ativa detectada entre invariantes, requisitos e operações.'],
  EXTERNAL_EFFECT_COVERAGE_MISSING: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.'],
  INCOMPLETE_EXTERNAL_EFFECT: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.'],
  TRANSACTION_ROLLBACK_MISSING: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.'],
  UNRESOLVED_RETURN_CONTRACT: ['TRANSITION_CONSISTENCY', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Contrato de retorno ou protocolo de erro da operação incompleto.'],
  INVALID_SEMANTIC_KEY: ['TRANSITION_CONSISTENCY', 'USER_DECISION', (i) => i.reason],

  // OBSERVABLE_DEPENDENCY_CLOSURE
  UNRESOLVED_OBSERVABLE_DEPENDENCY: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Observável depende de campo inexistente no modelo de estado.'],
  UNRESOLVED_OBSERVABLE_REPRESENTATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Observável sem representação finita explícita.'],
  UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Observável sem comportamento definido para coleção vazia.'],
  INVALID_BITMASK_ALLOCATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'ARCHITECTURE_POLICY', (i) => i.reason || 'Alocação de bits sobreposta ou fora dos limites do tipo.'],
  UNRESOLVED_CANONICAL_SERIALIZATION: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason || 'Perfil de serialização canônica ausente para demanda de integridade.'],
  MISSING_CANONICAL_SERIALIZATION_INVENTORY: ['OBSERVABLE_DEPENDENCY_CLOSURE', 'USER_DECISION', (i) => i.reason || 'Perfil de serialização canônica ausente para demanda de integridade.'],

  // AUTHORITY_PROVENANCE
  UNAUTHORIZED_NUMERIC_LITERAL: ['AUTHORITY_PROVENANCE', 'USER_INTENT', (i) => i.reason],
  MATERIAL_UNKNOWN_GAP: ['AUTHORITY_PROVENANCE', 'USER_DECISION', (i) => i.reason || 'Lacuna material sem proveniência resolvida e sem decisão vinculada.'],
  DETERMINISM_GAP: ['AUTHORITY_PROVENANCE', 'USER_DECISION', (i) => i.reason || 'Dimensão de determinismo com GAP_FOUND.'],

  // COVERAGE_ACCOUNTING
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

  // COMPUTABILITY_DEPENDENCY_CLOSURE
  OPEN_COMPUTATIONAL_DEPENDENCY: ['COMPUTABILITY_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Dependência semântica necessária para computabilidade não foi encontrada ou fundamentada.'],
  UNRESOLVED_COMPUTATIONAL_DEPENDENCY: ['COMPUTABILITY_DEPENDENCY_CLOSURE', 'USER_INTENT', (i) => i.reason || 'Dependência semântica necessária para computabilidade não foi encontrada ou fundamentada.'],
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
