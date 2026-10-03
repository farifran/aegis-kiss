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

  for (const agg of aggregations) {
    if (agg.name) entityFieldKeys.add(agg.name);
  }
  for (const b of boundaries) {
    if (b.signalName) entityFieldKeys.add(b.signalName);
  }

  for (const entity of stateModel.entities) {
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    for (const field of fields) {
      const fieldKey = `${entity.name}.${field.name}`;
      entityFieldKeys.add(fieldKey);

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

        for (const op of operations) {
          const hasMutation = mutations.some((m) => m.operation === op.name);
          const isPreserved = preservation.includes(op.name) || preservation.includes('*');

          if (!hasMutation && !isPreserved) {
            issues.push({
              slotId: `state/${fieldKey}/transition/${op.name}`,
              kind: 'UNRESOLVED_TRANSITION',
              reason: `O campo '${fieldKey}' não define mutação nem regra de preservação para a operação '${op.name}'.`,
            });
          }
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
          || field.bounds.upperBound === null
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
      const noContractLimit = entity.capacityPolicy?.overflowPolicy === 'NO_CONTRACT_LIMIT'
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
      for (const sourceField of derivedFrom) {
        if (!entityFieldKeys.has(sourceField) && sourceField !== '*') {
          issues.push({
            slotId: `observable/${obs.name}/dependency/${sourceField}`,
            kind: 'UNRESOLVED_OBSERVABLE_DEPENDENCY',
            reason: `O observável '${obs.name}' referencia o campo desconhecido '${sourceField}'.`,
          });
        }
      }
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
          if (item.field !== 'RESERVED' && !entityFieldKeys.has(item.field) && item.field !== '*') {
            issues.push({
              slotId: `observable/${obs.name}/bitAllocation/${item.slice}/field`,
              kind: 'UNRESOLVED_OBSERVABLE_DEPENDENCY',
              reason: `A fatia '${item.slice}' referencia o campo desconhecido '${item.field}'.`,
            });
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
        for (const f of fields) {
          if (!encodedFields.has(f)) {
            issues.push({
              slotId: `canonicalSerialization/${item.target}/encoding/${f}`,
              kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
              reason: `O campo '${f}' na serialização canônica '${item.target}' não possui formato de encoding declarado em fieldEncodings.`,
            });
          }
        }
        if (!item.recordOrderingKey) {
          issues.push({
            slotId: `canonicalSerialization/${item.target}/recordOrderingKey`,
            kind: 'UNRESOLVED_CANONICAL_SERIALIZATION',
            reason: `A serialização canônica '${item.target}' não define recordOrderingKey para ordenação canônica dos registros.`,
          });
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

  // 11. PIPELINE CROSS-CHECK: Conectividade linear entre etapas e guards
  const pipelineResult = validatePipelineCrossCheck({ stateModel });
  issues.push(...pipelineResult.issues);

  // 12. INPUT DOMAIN CLOSURE: Totalidade de domínio e rejeição determinística de parâmetros
  const inputDomainResult = validateInputDomainClosure({ stateModel });
  issues.push(...inputDomainResult.issues);

  // 13. STATE MUTATION OWNERSHIP: Causalidade e donos declarados de mutação/reset
  const mutationOwnershipResult = validateStateMutationOwnership({ stateModel });
  issues.push(...mutationOwnershipResult.issues);

  // 14. CONTRADICTION DETECTION: Detecção ativa de contradições estruturais
  const contradictionResult = validateContradictionDetection({
    stateModel,
    invariants,
    requirements,
  });
  issues.push(...contradictionResult.issues);

  // 15. DERIVED FIELD DERIVATIONS: Totalidade de funções de derivação para campos derivados/carry-over
  const derivationResult = validateDerivedFieldDerivations({ stateModel });
  issues.push(...derivationResult.issues);

  // 16. CATEGORY SET MEMBERSHIP: Fechamento de conjuntos e membros para categorias abstratas
  const categoryResult = validateCategorySetMembership({ stateModel });
  issues.push(...categoryResult.issues);

  // 17. COMPUTABILITY GRAPH CLOSURE: Fase 1 - Completude Causal e Grafo de Dependências
  const computabilityResult = validateComputabilityGraphClosure({
    stateModel,
    decisions,
    boundaryRules,
    pathReferences,
    architectureContexts,
    requirements,
    invariants,
  });
  issues.push(...computabilityResult.issues);

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
    const guardPrecedence = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
    const branchIds = (op.branches ?? []).map(branch => branch.branchId);
    if (new Set(branchIds).size !== branchIds.length
      || new Set(guardPrecedence).size !== guardPrecedence.length) {
      issues.push({ slotId: `operation/${op.name}/identities`, kind: 'CONFLICTING_STATE_DECLARATIONS',
        reason: `A operação '${op.name}' repete identificadores de branches ou guardas.` });
    }

    if (Array.isArray(op.branches) && op.branches.length > 0) {
      // 1. Cada guarda em guardPrecedence deve ter branch de rejeição correspondente
      for (const guard of guardPrecedence) {
        const hasRejectionBranch = op.branches.some(branch =>
          branch.outcomeKind === 'REJECTION' && branch.branchId === guard);

        if (!hasRejectionBranch) {
          issues.push({
            slotId: `operation/${op.name}/guard/${guard}/rejection`,
            kind: 'MISSING_GUARD_REJECTION_BRANCH',
            reason: `A operação '${op.name}' define o guard '${guard}' em guardPrecedence, mas não possui branch de rejeição correspondente.`,
          });
        }
      }

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

          for (const fieldKey of allEntityFields) {
            if (!coveredFields.has(fieldKey)) {
              issues.push({
                slotId: `operation/${op.name}/branch/${branch.branchId}/missingField/${fieldKey}`,
                kind: 'UNDETERMINED_BRANCH_NEXT_STATE',
                reason: `O branch '${branch.branchId}' da operação '${op.name}' não determina o próximo estado para o campo '${fieldKey}' (ausente em stateEffects sem defaultPreservation: true).`,
              });
            }
          }
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
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validador Mecânico de Conferência Cruzada de Pipeline Linear (validatePipelineCrossCheck).
 * 
 * Verifica que a ordem de execução do pipeline e a precedência de guards são mutuamente consistentes:
 * 1. Todos os guards de guardPrecedence devem constar nas etapas GUARD de executionPipeline.
 * 2. Todas as etapas GUARD de executionPipeline devem constar em guardPrecedence.
 * 3. A ordem linear relativa de guards deve coincidir estritamente.
 * 4. Nenhuma etapa GUARD pode ocorrer após etapas de mutação de estado.
 */
export function validatePipelineCrossCheck({ stateModel = null } = {}) {
  const issues = [];
  if (!stateModel || !Array.isArray(stateModel.operations)) {
    return { valid: true, issues: [] };
  }

  for (const op of stateModel.operations) {
    const pipeline = Array.isArray(op.executionPipeline) ? op.executionPipeline : [];
    if (pipeline.length === 0) continue;

    const guardPrecedence = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
    const guardStages = pipeline.filter((stage) => stage.stage === 'GUARD');

    if (guardStages.length > 0 || guardPrecedence.length > 0) {
      const pipelineGuardIds = guardStages.map((s) => s.id);

      for (const gp of guardPrecedence) {
        if (!pipelineGuardIds.includes(gp)) {
          issues.push({
            slotId: `operation/${op.name}/executionPipeline/${gp}`,
            kind: 'PIPELINE_PRECEDENCE_CONTRADICTION',
            reason: `A operação '${op.name}' define o guard '${gp}' em guardPrecedence, mas ele não consta nas etapas GUARD de executionPipeline.`,
          });
        }
      }

      for (const pg of pipelineGuardIds) {
        if (!guardPrecedence.includes(pg)) {
          issues.push({
            slotId: `operation/${op.name}/executionPipeline/${pg}`,
            kind: 'PIPELINE_PRECEDENCE_CONTRADICTION',
            reason: `A etapa GUARD '${pg}' em executionPipeline da operação '${op.name}' não consta em guardPrecedence.`,
          });
        }
      }

      if (issues.length === 0 && guardPrecedence.length > 1 && pipelineGuardIds.length === guardPrecedence.length) {
        for (let i = 0; i < guardPrecedence.length; i++) {
          if (guardPrecedence[i] !== pipelineGuardIds[i]) {
            issues.push({
              slotId: `operation/${op.name}/executionPipeline/order`,
              kind: 'PIPELINE_PRECEDENCE_CONTRADICTION',
              reason: `Ordem de precedência contraditória na operação '${op.name}': guardPrecedence define '${guardPrecedence.join(' -> ')}', mas executionPipeline define '${pipelineGuardIds.join(' -> ')}'.`,
            });
            break;
          }
        }
      }
    }

    let seenMutation = false;
    let mutationStageId = null;
    for (const step of pipeline) {
      if (step.stage === 'MUTATION') {
        seenMutation = true;
        mutationStageId = step.id;
      } else if (step.stage === 'GUARD' && seenMutation) {
        issues.push({
          slotId: `operation/${op.name}/executionPipeline/${step.id}/afterMutation`,
          kind: 'PIPELINE_PRECEDENCE_CONTRADICTION',
          reason: `A etapa GUARD '${step.id}' da operação '${op.name}' é executada após a mutação '${mutationStageId}', violando a ordem determinística de guarda prévia.`,
        });
      }
    }

    // Conferência de precedência determinística de reposição temporal (REFILL) antes da verificação de saldo
    const hasRefillContext = Array.isArray(stateModel.entities) && stateModel.entities.some((e) => (
      Array.isArray(e.fields) && e.fields.some((f) => f.name === 'refillRate' || f.name === 'fractionalRemainder')
    ));
    const evaluatesBalance = op.parameters?.some((p) => /credit|token|ficha|amount/iu.test(p.name))
      || op.branches?.some((b) => /credit|token|saldo|balance/iu.test(b.branchId || '') || /credit|token|saldo|balance/iu.test(b.condition || ''));

    if (hasRefillContext && evaluatesBalance) {
      const refillIndex = pipeline.findIndex((step) => /refill|reposic/iu.test(step.id) || /refill|reposic/iu.test(step.description || ''));
      const firstBalanceGuardIndex = pipeline.findIndex((step) => step.stage === 'GUARD' && (/balance|saldo|credit|insufficient/iu.test(step.id) || /balance|saldo|credit|insufficient/iu.test(step.description || '')));

      if (refillIndex === -1) {
        issues.push({
          slotId: `operation/${op.name}/executionPipeline/missingRefill`,
          kind: 'PIPELINE_PRECEDENCE_CONTRADICTION',
          reason: `A operação '${op.name}' avalia saldo de créditos mas omite a etapa de reposição (REFILL) em executionPipeline antes da verificação de saldo.`,
        });
      } else if (firstBalanceGuardIndex !== -1 && refillIndex > firstBalanceGuardIndex) {
        issues.push({
          slotId: `operation/${op.name}/executionPipeline/refillPrecedence`,
          kind: 'PIPELINE_PRECEDENCE_CONTRADICTION',
          reason: `A etapa de reposição (REFILL: '${pipeline[refillIndex].id}') na operação '${op.name}' está posicionada após a verificação de saldo ('${pipeline[firstBalanceGuardIndex].id}'), violando a ordem determinística de reposição prévia.`,
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
 * Validador Mecânico de Totalidade das Entradas (validateInputDomainClosure).
 * 
 * Garante que parâmetros numéricos possuam limites e regras determinísticas de rejeição:
 * 1. Parâmetros INTEGER, NUMBER ou BIGINT exigem bounds determinísticos.
 * 2. Se bounds.boundaryBehavior for REJECT ou ERROR, exige onInvalid com outcomeKind e error.
 * 3. Parâmetros de débito/crédito exigem limite inferior estritamente positivo (lowerBound >= 1).
 */
export function validateInputDomainClosure({ stateModel = null } = {}) {
  const issues = [];
  if (!stateModel || !Array.isArray(stateModel.operations)) {
    return { valid: true, issues: [] };
  }

  for (const op of stateModel.operations) {
    const params = Array.isArray(op.parameters) ? op.parameters : [];
    for (const param of params) {
      const isNumeric = param.type === 'INTEGER' || param.type === 'NUMBER' || param.type === 'BIGINT';
      if (isNumeric) {
        if (!param.bounds
          || param.bounds.lowerBound === undefined
          || param.bounds.lowerBound === null
          || param.bounds.upperBound === undefined
          || param.bounds.upperBound === null
          || !param.bounds.boundaryBehavior) {
          issues.push({
            slotId: `operation/${op.name}/parameter/${param.name}/bounds`,
            kind: 'UNRESOLVED_PARAMETER_DOMAIN',
            reason: `O parâmetro numérico '${param.name}' da operação '${op.name}' não define limites (bounds) determinísticos com lowerBound, upperBound e boundaryBehavior.`,
          });
          continue;
        }

        if (param.bounds.boundaryBehavior === 'REJECT' || param.bounds.boundaryBehavior === 'ERROR') {
          if (!param.onInvalid
            || !param.onInvalid.outcomeKind
            || !param.onInvalid.error
            || param.onInvalid.error.trim().length === 0) {
            issues.push({
              slotId: `operation/${op.name}/parameter/${param.name}/onInvalid`,
              kind: 'UNRESOLVED_PARAMETER_DOMAIN',
              reason: `O parâmetro '${param.name}' da operação '${op.name}' possui boundaryBehavior '${param.bounds.boundaryBehavior}' mas não define onInvalid com outcomeKind e error explícitos.`,
            });
          }
        }

        if (/credit|token|ficha|amount/iu.test(param.name)) {
          const lowerVal = Number(param.bounds.lowerBound);
          if (Number.isNaN(lowerVal) || lowerVal < 1) {
            issues.push({
              slotId: `operation/${op.name}/parameter/${param.name}/domain`,
              kind: 'UNRESOLVED_PARAMETER_DOMAIN',
              reason: `O parâmetro de débito '${param.name}' permite valores menores que 1 (lowerBound: ${param.bounds.lowerBound}), o que causaria acréscimo indevido de créditos na subtração de saldo.`,
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

function hasDeclaredTriggerOwner(trigger, knownSymbols) {
  if (!trigger || typeof trigger !== 'string') return false;
  const cleanTrigger = trigger.trim();
  if (cleanTrigger.length === 0) return false;

  const lowerTrigger = cleanTrigger.toLowerCase();
  for (const sym of knownSymbols) {
    if (sym && sym.toLowerCase() === lowerTrigger) return true;
  }

  const tokens = lowerTrigger.split(/[\s_\-/]+/u).filter((t) => t.length > 1 && t !== 'or' && t !== 'and');
  for (const token of tokens) {
    for (const sym of knownSymbols) {
      if (sym && sym.toLowerCase().includes(token)) return true;
    }
  }

  return false;
}

/**
 * Validador Mecânico de Causalidade e Dono de Estado (validateStateMutationOwnership).
 * 
 * Assegura que todo gatilho de reset, mutação declarada e sinal de fronteira possua dono conhecido:
 * 1. Gatilhos de reset devem corresponder a operações, branches, guardas, sinais ou agregações.
 * 2. Mutações nominais devem referenciar operações existentes no modelo.
 */
export function validateStateMutationOwnership({ stateModel = null } = {}) {
  const issues = [];
  if (!stateModel || !Array.isArray(stateModel.entities)) {
    return { valid: true, issues: [] };
  }

  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  const boundaries = Array.isArray(stateModel.producerConsumerBoundaries) ? stateModel.producerConsumerBoundaries : [];
  const aggregations = Array.isArray(stateModel.aggregations) ? stateModel.aggregations : [];

  const knownSymbols = new Set();
  for (const op of operations) {
    if (op.name) knownSymbols.add(op.name);
    if (Array.isArray(op.guardPrecedence)) {
      for (const gp of op.guardPrecedence) knownSymbols.add(gp);
    }
    if (Array.isArray(op.branches)) {
      for (const b of op.branches) {
        if (b.branchId) knownSymbols.add(b.branchId);
        if (b.statusOrError) knownSymbols.add(b.statusOrError);
      }
    }
    if (Array.isArray(op.executionPipeline)) {
      for (const step of op.executionPipeline) {
        if (step.id) knownSymbols.add(step.id);
      }
    }
  }
  for (const b of boundaries) {
    if (b.signalName) knownSymbols.add(b.signalName);
    if (b.producer) knownSymbols.add(b.producer);
    if (b.consumer) knownSymbols.add(b.consumer);
  }
  for (const a of aggregations) {
    if (a.name) knownSymbols.add(a.name);
  }

  for (const entity of stateModel.entities) {
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    for (const field of fields) {
      const fieldKey = `${entity.name}.${field.name}`;

      if (field.reset?.allowed === true && field.reset.trigger) {
        if (!hasDeclaredTriggerOwner(field.reset.trigger, knownSymbols)) {
          issues.push({
            slotId: `state/${fieldKey}/reset/trigger/${field.reset.trigger}`,
            kind: 'ORPHAN_STATE_MUTATION_OWNER',
            reason: `O gatilho de reset '${field.reset.trigger}' do campo '${fieldKey}' não possui dono declarado no modelo (não corresponde a nenhuma operação, branch, sinal de fronteira ou agregação).`,
          });
        }
      }

      const mutations = Array.isArray(field.mutations) ? field.mutations : [];
      for (const m of mutations) {
        if (m.operation && !operations.some((op) => op.name === m.operation)) {
          issues.push({
            slotId: `state/${fieldKey}/mutation/${m.operation}`,
            kind: 'ORPHAN_STATE_MUTATION_OWNER',
            reason: `A mutação declarada no campo '${fieldKey}' referencia a operação inexistente '${m.operation}'.`,
          });
        }
      }
    }
  }

  for (const b of boundaries) {
    if (b.consumer && operations.length > 0) {
      const consumerOp = operations.find((op) => op.name === b.consumer);
      if (consumerOp) {
        const matchesSignal = (sym) => {
          if (!sym || typeof sym !== 'string') return false;
          const sLower = b.signalName.toLowerCase();
          const symLower = sym.toLowerCase();
          if (sLower === symLower || symLower.includes(sLower) || sLower.includes(symLower)) return true;
          const tokens = b.signalName.replace(/([a-z])([A-Z])/gu, '$1_$2').toLowerCase().split(/[\s_\-]+/u).filter((t) => t.length > 2);
          return tokens.some((t) => symLower.includes(t));
        };

        const hasParam = consumerOp.parameters?.some((p) => matchesSignal(p.name));
        const hasBranch = consumerOp.branches?.some((br) => (
          matchesSignal(br.branchId) || matchesSignal(br.condition) || matchesSignal(br.statusOrError)
        ));
        const hasGuard = consumerOp.guardPrecedence?.some((gp) => matchesSignal(gp));

        if (!hasParam && !hasBranch && !hasGuard) {
          issues.push({
            slotId: `operation/${consumerOp.name}/boundary/${b.signalName}`,
            kind: 'UNRESOLVED_BOUNDARY_CONSUMPTION',
            reason: `A fronteira declara o sinal '${b.signalName}' consumido pela operação '${consumerOp.name}', mas a operação não modela o sinal em parâmetros, guardas ou ramos de execução.`,
          });
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

  // 3. Contradição de Admissão vs Comportamento de Observáveis / Guardas
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
      for (const op of operations) {
        for (const guard of op.guardPrecedence ?? []) {
          if (/unregistered|unknown_badge|inexistent/iu.test(guard)) {
            issues.push({
              slotId: `operation/${op.name}/guard/${guard}/admissionContradiction`,
              kind: 'CONTRADICTORY_RULE_DETECTED',
              reason: `A entidade '${entity.name}' possui admissionPolicy 'ON_FIRST_REQUEST', mas a operação '${op.name}' define o guard '${guard}' de rejeição de crachá inexistente.`,
            });
          }
        }
      }
    }
  }

  // 4. Contradição de Bitmask vazia com Digest canônico ou Sinais Globais Independentes
  const serializations = Array.isArray(stateModel.canonicalSerializations) ? stateModel.canonicalSerializations : [];
  const boundaries = Array.isArray(stateModel.producerConsumerBoundaries) ? stateModel.producerConsumerBoundaries : [];
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

          const isGlobalSignal = boundaries.some((b) => b.signalName === item.field && b.ownership === 'SYSTEM_CONFIGURATION');
          if (isGlobalSignal) {
            issues.push({
              slotId: `observable/${obs.name}/bitmaskEmptySignalContradiction`,
              kind: 'CONTRADICTORY_RULE_DETECTED',
              reason: `O observável bitmask '${obs.name}' declara emptyBehavior = '0', mas a fatia '${item.slice}' codifica o sinal global '${item.field}', que opera independentemente do estado da coleção.`,
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
 * Validador Mecânico de Funções de Derivação Total (validateDerivedFieldDerivations).
 * 
 * Garante que campos derivados ou carry-over fracionário possuam função de derivação total.
 */
export function validateDerivedFieldDerivations({ stateModel = null } = {}) {
  const issues = [];
  if (!stateModel || !Array.isArray(stateModel.entities)) return { valid: true, issues: [] };

  for (const entity of stateModel.entities) {
    for (const field of entity.fields ?? []) {
      const isDerived = field.initialization?.kind === 'DERIVED';

      if (isDerived) {
        const hasDerivation = field.derivation && typeof field.derivation.formula === 'string' && field.derivation.total === true;
        const hasDerivationFunc = typeof field.initialization?.derivationFunction === 'string' && field.initialization.derivationFunction.trim().length > 0;
        const hasFormulaInMutation = field.mutations?.some((m) => (
          typeof m.targetValue === 'string' && (/[\/*%]/u.test(m.targetValue) || /floor|mod|min|max/iu.test(m.targetValue))
        ));

        if (!hasDerivation && !hasDerivationFunc && !hasFormulaInMutation) {
          issues.push({
            slotId: `state/${entity.name}.${field.name}/derivation`,
            kind: 'UNRESOLVED_DERIVATION_FUNCTION',
            reason: `O campo derivado '${entity.name}.${field.name}' não define função de derivação total (derivation com formula, inputs e total: true).`,
          });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Validador Mecânico de Fechamento de Categorias Abstratas (validateCategorySetMembership).
 * 
 * Exige enumeração formal de membros para categorias citadas em triggers, mutações ou métricas.
 */
export function validateCategorySetMembership({ stateModel = null } = {}) {
  const issues = [];
  if (!stateModel) return { valid: true, issues: [] };

  const categories = Array.isArray(stateModel.categories) ? stateModel.categories : [];
  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  const knownStatuses = new Set();

  for (const op of operations) {
    if (Array.isArray(op.branches)) {
      for (const b of op.branches) {
        if (b.branchId) knownStatuses.add(b.branchId);
        if (b.statusOrError) knownStatuses.add(b.statusOrError);
      }
    }
    if (Array.isArray(op.guardPrecedence)) {
      for (const gp of op.guardPrecedence) knownStatuses.add(gp);
    }
  }

  const categoryNames = new Set(categories.map((c) => c.name));

  for (const cat of categories) {
    if (!Array.isArray(cat.members) || cat.members.length === 0) {
      issues.push({
        slotId: `stateModel/categories/${cat.name}/members`,
        kind: 'UNRESOLVED_CATEGORY_MEMBERSHIP',
        reason: `A categoria '${cat.name}' não enumera os membros pertencentes ao conjunto.`,
      });
    } else {
      for (const member of cat.members) {
        if (!knownStatuses.has(member)) {
          issues.push({
            slotId: `stateModel/categories/${cat.name}/unknownMember/${member}`,
            kind: 'UNRESOLVED_CATEGORY_MEMBERSHIP',
            reason: `O membro '${member}' da categoria '${cat.name}' não corresponde a nenhum branch statusOrError ou outcome de operação conhecido.`,
          });
        }
      }
    }
  }

  const checkCategoryUsage = (str, usageLocation) => {
    if (!str || typeof str !== 'string') return;
    const tokens = str.split(/(?:\s+(?:OR|AND)\s+|_(?:OR|AND)_|[\s/,()|]+)/u).filter((t) => /^[A-Z][A-Z0-9_]{2,}$/u.test(t));
    for (const tok of tokens) {
      if (tok.includes('REJECTION') || tok.includes('ERROR') || tok.includes('FAILURE')) {
        if (!categoryNames.has(tok) && !knownStatuses.has(tok)) {
          issues.push({
            slotId: `stateModel/categories/${tok}`,
            kind: 'UNRESOLVED_CATEGORY_MEMBERSHIP',
            reason: `A categoria abstrata '${tok}' citada em ${usageLocation} não possui enumeração de membros em stateModel.categories.`,
          });
        }
      }
    }
  };

  if (Array.isArray(stateModel.entities)) {
    for (const entity of stateModel.entities) {
      for (const field of entity.fields ?? []) {
        if (field.reset?.allowed && field.reset.trigger) {
          checkCategoryUsage(field.reset.trigger, `reset.trigger do campo '${entity.name}.${field.name}'`);
        }
        for (const m of field.mutations ?? []) {
          checkCategoryUsage(m.condition, `mutations.condition do campo '${entity.name}.${field.name}'`);
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
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
    'ARCH-STATE-TRANSITION-TOTALITY', 'ARCH-TEMPORAL-INVARIANCE',
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
                    } else if (!factSupportsValue(fact, valStr)) {
                      issues.push({
                        slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                        kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                        reason: `O limite ${boundKind} '${valStr}' do campo '${entity.name}.${field.name}' cita o fato '${p.reference}', mas os atributos do fato não autorizam esse valor.`,
                      });
                    }
                  } else if (typeof p.reference === 'string' && p.reference.startsWith('FRAG-')) {
                    if (fragmentsById.size > 0 && !fragmentsById.has(p.reference)) {
                      issues.push({
                        slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                        kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                        reason: `O limite ${boundKind} '${valStr}' cita o fragmento '${p.reference}' que não existe na evidência da demanda.`,
                      });
                    }
                  } else if (intent && intent.length > 0 && typeof p.reference === 'string' && !intent.includes(p.reference)) {
                    issues.push({
                      slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                      kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                      reason: `A referência '${p.reference}' citada em USER_INTENT para o limite '${valStr}' não aparece no texto da demanda.`,
                    });
                  }
                } else if ((p.source === 'ARCHITECTURE_POLICY' || p.source === 'SAFE_MECHANICAL_DEFAULT') && !validPolicyRuleIds.has(p.reference)) {
                  issues.push({
                    slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedPolicy`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `A regra de política '${p.reference}' citada para o limite '${valStr}' não existe na governança.`,
                  });
                }
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
 * Validador Mecânico de Agregações e Fronteiras Producer/Consumer (validateAggregationAndBoundaries).
 */
export function validateAggregationAndBoundaries({
  stateModel = null,
} = {}) {
  const issues = [];
  if (!stateModel) return { valid: true, issues: [] };

  const entities = Array.isArray(stateModel.entities) ? stateModel.entities : [];
  const collectionEntityNames = new Set(entities.filter((e) => e.isCollection).map((e) => e.name));

  const aggregations = Array.isArray(stateModel.aggregations) ? stateModel.aggregations : [];
  const boundaries = Array.isArray(stateModel.producerConsumerBoundaries) ? stateModel.producerConsumerBoundaries : [];

  for (const agg of aggregations) {
    if (!collectionEntityNames.has(agg.sourceCollection)) {
      issues.push({
        slotId: `aggregation/${agg.name}/sourceCollection`,
        kind: 'INVALID_AGGREGATION_SOURCE',
        reason: `A agregação '${agg.name}' referencia a fonte '${agg.sourceCollection}', que não é uma entidade de coleção válida.`,
      });
    }
    if (!agg.filterPredicate || agg.filterPredicate.trim() === '') {
      issues.push({
        slotId: `aggregation/${agg.name}/filterPredicate`,
        kind: 'MISSING_AGGREGATION_PREDICATE',
        reason: `A agregação '${agg.name}' não define filterPredicate determinístico.`,
      });
    }
    if (!agg.provenance || !Array.isArray(agg.provenance) || agg.provenance.length === 0) {
      issues.push({
        slotId: `aggregation/${agg.name}/provenance`,
        kind: 'MISSING_AGGREGATION_PROVENANCE',
        reason: `A agregação '${agg.name}' não possui declaração de provenance.`,
      });
    }
  }

  for (const b of boundaries) {
    if (!b.signalName || !b.producer || !b.consumer || !b.ownership) {
      issues.push({
        slotId: `boundary/${b.signalName ?? 'unknown'}`,
        kind: 'INCOMPLETE_PRODUCER_CONSUMER_BOUNDARY',
        reason: `A fronteira '${b.signalName}' deve declarar signalName, producer, consumer e ownership.`,
      });
    }
    if (!b.provenance || !Array.isArray(b.provenance) || b.provenance.length === 0) {
      issues.push({
        slotId: `boundary/${b.signalName}/provenance`,
        kind: 'MISSING_BOUNDARY_PROVENANCE',
        reason: `A fronteira '${b.signalName}' não possui declaração de provenance.`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validador Mecânico de Grafo de Computabilidade Semântica (validateComputabilityGraphClosure).
 * 
 * FASE 1 — COMPLETUDE CAUSAL:
 * Verifica se todas as peças necessárias para que o sistema seja computável foram descobertas e fundamentadas.
 * Percorre o grafo de dependências semânticas e assegura que todo nó termine em um elemento fundamentado:
 * - EXTERNAL_INPUT: Parâmetro de operação ou sinal de fronteira de ingress
 * - STATE_FIELD: Campo pertencente ao inventário de entidades de estado
 * - SYSTEM_CONFIGURATION: Regra de fronteira ou constante de política autorizada
 * - HUMAN_DECISION: Decisão humana vinculada e resolvida
 * - MATHEMATICAL_RULE: Regra com fórmula determinística e dependências fechadas
 * - DERIVED_VALUE: Valor derivado com precursores declarados
 * 
 * Rejeita qualquer dependência sem proveniência ou nó em aberto com OPEN_COMPUTATIONAL_DEPENDENCY.
 * Detecta ciclos causais com COMPUTATIONAL_DEPENDENCY_CYCLE.
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateComputabilityGraphClosure({
  stateModel = null,
  decisions = [],
  boundaryRules = [],
  pathReferences = [],
  architectureContexts = [],
  requirements = [],
  invariants = [],
} = {}) {
  const issues = [];
  if (!stateModel) {
    return { valid: true, issues: [] };
  }

  const computabilityGraph = Array.isArray(stateModel.computabilityGraph)
    ? stateModel.computabilityGraph
    : [];

  const entityFields = new Set();
  const rawFieldNames = new Set();
  if (Array.isArray(stateModel.entities)) {
    for (const entity of stateModel.entities) {
      const fields = Array.isArray(entity.fields) ? entity.fields : [];
      for (const field of fields) {
        entityFields.add(`${entity.name}.${field.name}`);
        rawFieldNames.add(field.name);
      }
    }
  }

  const operationParams = new Set();
  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  for (const op of operations) {
    const params = Array.isArray(op.parameters) ? op.parameters : [];
    for (const p of params) {
      operationParams.add(p.name);
    }
  }

  const boundarySignals = new Set();
  const boundaries = Array.isArray(stateModel.producerConsumerBoundaries)
    ? stateModel.producerConsumerBoundaries
    : [];
  for (const b of boundaries) {
    if (b.signalName) boundarySignals.add(b.signalName);
    if (b.source) boundarySignals.add(b.source);
    if (b.eventType) boundarySignals.add(b.eventType);
    if (b.targetOperation) boundarySignals.add(b.targetOperation);
  }

  const configKeys = new Set();
  for (const rule of boundaryRules) {
    if (rule.ruleId) configKeys.add(rule.ruleId);
    if (rule.source) configKeys.add(rule.source);
  }

  const decisionIds = new Set();
  for (const d of decisions) {
    if (d.questionId) decisionIds.add(d.questionId);
    if (d.semanticKey) decisionIds.add(d.semanticKey);
    if (d.id) decisionIds.add(d.id);
  }

  const observableNames = new Set();
  const observables = Array.isArray(stateModel.observables) ? stateModel.observables : [];
  for (const obs of observables) {
    if (obs.name) observableNames.add(obs.name);
  }

  const nodeMap = new Map();
  for (const node of computabilityGraph) {
    const id = node.symbol ?? node.nodeId;
    if (!id) continue;
    if (nodeMap.has(id)) {
      issues.push({
        slotId: `computabilityGraph/${id}`,
        kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
        reason: `Nó duplicado '${id}' no grafo de computabilidade.`,
      });
    }
    nodeMap.set(id, node);
  }

  const nodeLocalIssues = new Map();
  function recordNodeIssue(nodeId, issue) {
    issues.push(issue);
    if (!nodeLocalIssues.has(nodeId)) {
      nodeLocalIssues.set(nodeId, []);
    }
    nodeLocalIssues.get(nodeId).push(issue);
  }

  const reservedFormulaKeywords = new Set([
    'if', 'then', 'else', 'true', 'false', 'null', 'undefined', 'none', 'empty',
    'max', 'min', 'abs', 'sum', 'avg', 'sqrt', 'floor', 'ceil', 'round', 'clamp',
    'return', 'and', 'or', 'not', 'n', 'bps', 'bigint', 'scaled', 'case', 'when',
    'end', 'is', 'in', 'strict', 'local', 'extremum', 'peak', 'trough',
  ]);

  // 1. Verificação Causal e de Regras Locais (As 6 Perguntas para cada nó)
  for (const node of computabilityGraph) {
    const id = node.symbol ?? node.nodeId;
    const slotId = `computabilityGraph/${id}`;

    if (node.status === 'OPEN_DEPENDENCY' || node.computabilityStatus === 'OPEN_DEPENDENCY') {
      recordNodeIssue(id, {
        slotId,
        kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
        reason: `Dependência computacional em aberto declarada no nó '${id}': ${node.groundedIn || node.target || id} não possui proveniência resolvida.`,
      });
      continue;
    }

    const target = node.groundedIn || node.target || id;
    const formula = node.derivationRule || node.formula;
    const deps = Array.isArray(node.dependencies) ? node.dependencies : [];

    // Pergunta 1: Sei exatamente de onde vem? (Aterramento de Terminais vs Derivados)
    switch (node.category) {
      case 'STATE_FIELD': {
        const isPresent = entityFields.has(target) || rawFieldNames.has(target);
        if (!isPresent) {
          recordNodeIssue(id, {
            slotId,
            kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
            reason: `O nó de computabilidade '${id}' exige o campo de estado '${target}', mas este campo não existe em nenhuma entidade do inventário.`,
          });
        }
        break;
      }
      case 'EXTERNAL_INPUT': {
        const isPresent = operationParams.has(target)
          || boundarySignals.has(target)
          || rawFieldNames.has(target)
          || target.includes('.');
        if (!isPresent) {
          recordNodeIssue(id, {
            slotId,
            kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
            reason: `O nó de computabilidade '${id}' declara entrada externa '${target}', mas nenhum parâmetro de operação ou sinal de fronteira a fornece.`,
          });
        }

        // Gate 1: Derivation Provenance (Não aceitar atalhos falsos)
        // Quantidades agregadas, derivadas de arquivos ou cálculos internos não podem ser classificadas como EXTERNAL_INPUT.
        const derivedPattern = /(?:accumulated|calc_|calculated|computed|total_|delta|divergence|parsed|extracted|declared_in_footer|row_count|batch_sum|running_total)/i;
        if (derivedPattern.test(id) || derivedPattern.test(target)) {
          const hasIngressBoundary = boundaries.some((b) => (
            b.ownership === 'REQUEST_INGRESS' && (b.signalName === target || b.signalName === id)
          ));
          if (!hasIngressBoundary) {
            recordNodeIssue(id, {
              slotId: `${slotId}/derivationProvenance`,
              kind: 'DERIVATION_PROVENANCE_MISSING',
              reason: `O nó '${id}' ('${target}') foi classificado como EXTERNAL_INPUT, mas representa uma quantidade calculada ou derivada internamente (atalho falso). Sob Derivation Provenance, deve ser modelado como COMPUTED_VARIABLE ou DERIVED_VALUE com fórmula explícita e proveniência causal a partir das entradas brutas.`,
            });
          }
        }
        break;
      }
      case 'HUMAN_DECISION': {
        const isPresent = decisionIds.has(target)
          || (node.resolutionAuthority && decisionIds.has(node.resolutionAuthority))
          || decisions.length === 0;
        if (!isPresent) {
          recordNodeIssue(id, {
            slotId,
            kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
            reason: `O nó de computabilidade '${id}' requer decisão humana '${target}', mas não há decisão vinculada correspondente.`,
          });
        }
        break;
      }
      case 'SYSTEM_CONFIGURATION':
        break;
      case 'COMPUTED_VARIABLE':
      case 'DERIVED_VALUE':
      case 'MATHEMATICAL_RULE': {
        // Pergunta 2: Sei exatamente como é calculada?
        if (!formula || typeof formula !== 'string' || formula.trim().length === 0) {
          recordNodeIssue(id, {
            slotId: `${slotId}/derivationRule`,
            kind: 'MISSING_DERIVATION_RULE',
            reason: `O nó computado '${id}' não possui regra de cálculo ou fórmula determinística definida (derivationRule ausente).`,
          });
        }

        // Deve possuir dependências
        if (deps.length === 0 && !target) {
          recordNodeIssue(id, {
            slotId,
            kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
            reason: `O nó de valor derivado '${id}' não declara precursores ou dependências causais de onde é calculado.`,
          });
        }
        break;
      }
      default:
        recordNodeIssue(id, {
          slotId,
          kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
          reason: `O nó de computabilidade '${id}' possui categoria desconhecida ou inválida: '${node.category}'.`,
        });
        break;
    }

    // Validação de precursores declarados
    for (const depId of deps) {
      if (!nodeMap.has(depId)) {
        recordNodeIssue(id, {
          slotId: `${slotId}/dependency/${depId}`,
          kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
          reason: `O nó '${id}' depende do precursor '${depId}', que não está definido no grafo de computabilidade.`,
        });
      }
    }

    // Se possui fórmula / derivationRule:
    if (formula && typeof formula === 'string' && formula.trim().length > 0) {
      const formulaStr = formula.trim();

      // Extrair nomes de funções invocadas (ex: fn(...)) para não confundi-las com operandos de dados
      const functionCalls = new Set();
      for (const m of formulaStr.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
        functionCalls.add(m[1]);
      }

      // Pergunta 3: Tenho todos os dados que a fórmula usa? (Totality of Operands / Fios soltos)
      const formulaTokens = formulaStr
        .replace(/['"][^'"]*['"]/g, ' ')
        .split(/[^a-zA-Z0-9_.]+/)
        .filter((t) => t.length > 0 && isNaN(Number(t)));

      const depNodes = deps.map((d) => nodeMap.get(d)).filter(Boolean);
      const depTargets = new Set();
      const depSymbols = new Set(deps);
      for (const d of depNodes) {
        if (d.symbol) depSymbols.add(d.symbol);
        if (d.nodeId) depSymbols.add(d.nodeId);
        if (d.target) depTargets.add(d.target);
        if (d.groundedIn) depTargets.add(d.groundedIn);
      }

      for (const token of formulaTokens) {
        if (reservedFormulaKeywords.has(token.toLowerCase())
          || functionCalls.has(token)
          || /^\d+n$/i.test(token)) {
          continue;
        }
        const baseToken = token.includes('.') ? token.split('.')[0] : token;
        const isConnected = depSymbols.has(token)
          || depSymbols.has(baseToken)
          || depTargets.has(token)
          || depTargets.has(baseToken)
          || token === id
          || token === target
          || baseToken === target
          || [...depTargets].some((t) => t.endsWith(`.${token}`) || t.endsWith(`.${baseToken}`))
          || [...depSymbols].some((s) => s.toLowerCase() === token.toLowerCase());

        if (!isConnected) {
          recordNodeIssue(id, {
            slotId: `${slotId}/operand/${token}`,
            kind: 'DISCONNECTED_CIRCUIT_OPERAND',
            reason: `A regra de cálculo de '${id}' ('${formulaStr}') utiliza o operando '${token}', mas este fio não está conectado nas dependências do nó.`,
          });
        }
      }

      // Pergunta 5 (Casos Limites - Divisão por zero):
      const codeWithoutStrings = formulaStr.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, '');
      if (codeWithoutStrings.includes('/')) {
        const divMatch = codeWithoutStrings.match(/\/\s*([a-zA-Z0-9_.]+)/);
        if (divMatch) {
          const divisorToken = divMatch[1];
          const isConstantNonZero = /^[1-9]\d*n?$/.test(divisorToken);
          if (!isConstantNonZero) {
            const hasZeroDivRule = Boolean(node.edgeCaseRules?.zeroDivisor)
              || /(?:loss\s*==\s*0|divisor\s*==\s*0|denominator\s*==\s*0|zero\s*divisor|sentinel|fallback|safe_?div)/i.test(formulaStr);
            if (!hasZeroDivRule) {
              recordNodeIssue(id, {
                slotId: `${slotId}/edgeCase/zeroDivisor`,
                kind: 'UNRESOLVED_ZERO_DIVISOR',
                reason: `A fórmula de '${id}' realiza divisão contendo variáveis ('/${divisorToken}'), mas não define política determinística para divisor zero (ex: edgeCaseRules.zeroDivisor).`,
              });
            }
          }
        }
      }

      // Pergunta 5 (Casos Limites - Desempate de Pivôs / Extremos):
      const isPivotExtremum = /(?:pivot|pivo|peak|trough|extrema|local_max|local_min)/i.test(id)
        || /(?:pivot|pivo|peak|trough|extrema|local_max|local_min)/i.test(target)
        || /(?:localPeak|localTrough|findPeaks|findExtrema)/i.test(formulaStr);

      if (isPivotExtremum) {
        const hasTieRule = Boolean(node.edgeCaseRules?.tieBreaking)
          || /(?:STRICT_LOCAL_EXTREMUM|FIRST_OCCURRENCE|LAST_OCCURRENCE|REJECT_PLATEAU|TIE_BREAK|DESEMPATE|STRICT)/i.test(formulaStr);
        if (!hasTieRule) {
          recordNodeIssue(id, {
            slotId: `${slotId}/edgeCase/tieBreaking`,
            kind: 'PIVOT_TIE_POLICY_UNRESOLVED',
            reason: `O nó '${id}' detecta pivôs/extremos locais ou divergências sem definir política determinística de desempate para valores consecutivos iguais (ex: edgeCaseRules.tieBreaking para sequências como [10, 15, 15, 12]).`,
          });
        }
      }
    }

    // Pergunta 5 (Loop Fechado de Execução / Confirmação de Ordem):
    const isExecutionNode = /(?:order|trade|dispatch|execution|proceeds|fill|execucao|ordem)/i.test(id)
      || /(?:order|trade|dispatch|execution|proceeds|fill|execucao|ordem)/i.test(target);
    if (isExecutionNode && (node.category === 'COMPUTED_VARIABLE' || node.category === 'DERIVED_VALUE' || node.category === 'STATE_FIELD')) {
      const hasFeedbackConfirmation = Boolean(node.feedbackConfirmation?.executionMode)
        || Boolean(node.feedbackConfirmation?.confirmedBy)
        || boundaries.some((b) => /(?:router|fill|exec)/i.test(b.signalName || '') || /(?:router|fill|exec)/i.test(b.source || ''));
      if (!hasFeedbackConfirmation) {
        recordNodeIssue(id, {
          slotId: `${slotId}/feedbackConfirmation`,
          kind: 'UNCONFIRMED_FEEDBACK_LOOP',
          reason: `O nó de execução '${id}' despacha ordens ou processa efeitos de negociação sem definir confirmação de execução de loop fechado (feedbackConfirmation: confirmedBy, onRejection ou premissa LOCAL_SYNCHRONOUS_FILL).`,
        });
      }
    }

    // =========================================================================
    // AEGIS SEMANTIC CIRCUIT V2: GATES DE FECHAMENTO ONTO-SEMÂNTICO
    // =========================================================================

    // GATE A: ANÁLISE DIMENSIONAL NOMINAL (validateDimensionalUnits)
    if (node.unit || deps.some((d) => nodeMap.get(d)?.unit)) {
      const depNodesWithUnit = deps.map((d) => nodeMap.get(d)).filter((d) => Boolean(d?.unit));

      if (formula && typeof formula === 'string' && formula.trim().length > 0) {
        const formulaStr = formula.trim();

        // 1. Verificação de pares de grandezas em operações aditivas (+ / -) e multiplicativas (* / /)
        for (let i = 0; i < depNodesWithUnit.length; i++) {
          for (let j = i + 1; j < depNodesWithUnit.length; j++) {
            const d1 = depNodesWithUnit[i];
            const d2 = depNodesWithUnit[j];
            const s1 = d1.symbol ?? d1.nodeId;
            const s2 = d2.symbol ?? d2.nodeId;
            const t1 = d1.groundedIn ?? d1.target ?? s1;
            const t2 = d2.groundedIn ?? d2.target ?? s2;

            const a1s = [s1, t1, t1.split('.').pop()].filter(Boolean);
            const a2s = [s2, t2, t2.split('.').pop()].filter(Boolean);

            const isAdditive = a1s.some((a1) => a2s.some((a2) => {
              const p = new RegExp(`(?:\\b${escapeRegex(a1)}\\b\\s*[+-]\\s*\\b${escapeRegex(a2)}\\b)|(?:\\b${escapeRegex(a2)}\\b\\s*[+-]\\s*\\b${escapeRegex(a1)}\\b)`, 'i');
              return p.test(formulaStr);
            }));

            if (isAdditive) {
              if (d1.unit.family !== d2.unit.family) {
                recordNodeIssue(id, {
                  slotId: `${slotId}/unit`,
                  kind: 'DIMENSIONAL_UNIT_MISMATCH',
                  reason: `Incompatibilidade dimensional aditiva no nó '${id}': a fórmula ('${formulaStr}') soma/subtrai grandezas de famílias distintas ('${s1}' [${d1.unit.family}] e '${s2}' [${d2.unit.family}]).`,
                });
              } else if (d1.unit.label !== d2.unit.label && !node.unit?.conversion && !d1.unit?.conversion && !d2.unit?.conversion) {
                recordNodeIssue(id, {
                  slotId: `${slotId}/unit`,
                  kind: 'DIMENSIONAL_UNIT_MISMATCH',
                  reason: `Incompatibilidade dimensional aditiva no nó '${id}': grandezas com rótulos distintos ('${s1}' [${d1.unit.label}] e '${s2}' [${d2.unit.label}]) somadas sem fator de conversão.`,
                });
              }
            }

            const isMultiplicative = a1s.some((a1) => a2s.some((a2) => {
              const p = new RegExp(`(?:\\b${escapeRegex(a1)}\\b\\s*[*]\\s*\\b${escapeRegex(a2)}\\b)|(?:\\b${escapeRegex(a2)}\\b\\s*[*]\\s*\\b${escapeRegex(a1)}\\b)`, 'i');
              return p.test(formulaStr);
            }));

            if (isMultiplicative) {
              if (d1.unit.family !== d2.unit.family) {
                const isRatio1 = d1.unit.family === 'RATIO';
                const isRatio2 = d2.unit.family === 'RATIO';
                const hasConversion = Boolean(node.unit?.conversion) || Boolean(d1.unit?.conversion) || Boolean(d2.unit?.conversion);

                // Helper para extrair denominador de uma unidade do tipo RATIO
                const getRatioDenom = (u) => {
                  if (u.denominator?.family) return u.denominator;
                  if (u.per?.family) return u.per;
                  const label = (u.label || '').toUpperCase();
                  const m = label.match(/(?:_PER_|\/|_POR_)([A-Z0-9_]+)$/);
                  if (m) {
                    const raw = m[1];
                    if (raw.includes('PALLET') || raw.includes('PALETE') || raw.includes('ITEM') || raw.includes('UNIT') || raw.includes('COUNT')) {
                      return { family: 'DISCRETE_COUNT', label: raw };
                    }
                    if (raw.includes('M3') || raw.includes('VOLUME')) {
                      return { family: 'PHYSICAL_VOLUME', label: raw };
                    }
                    if (raw.includes('KG') || raw.includes('WEIGHT') || raw.includes('PESO')) {
                      return { family: 'PHYSICAL_WEIGHT', label: raw };
                    }
                  }
                  return null;
                };

                if (isRatio2 && !hasConversion) {
                  const denom = getRatioDenom(d2.unit);
                  if (denom && d1.unit.family !== denom.family) {
                    recordNodeIssue(id, {
                      slotId: `${slotId}/unit`,
                      kind: 'DIMENSIONAL_CANCELLATION_FAILURE',
                      reason: `Falha de cancelamento dimensional na multiplicação no nó '${id}': a grandeza multiplicadora '${s1}' [${d1.unit.family}:${d1.unit.label}] não cancela o denominador [${denom.family}:${denom.label}] da taxa unitária '${s2}' sem fator de conversão declarado (álgebra dimensional violada: impossível multiplicar ${d1.unit.label} por ${d2.unit.label} diretamente).`,
                    });
                  }
                } else if (isRatio1 && !hasConversion) {
                  const denom = getRatioDenom(d1.unit);
                  if (denom && d2.unit.family !== denom.family) {
                    recordNodeIssue(id, {
                      slotId: `${slotId}/unit`,
                      kind: 'DIMENSIONAL_CANCELLATION_FAILURE',
                      reason: `Falha de cancelamento dimensional na multiplicação no nó '${id}': a grandeza multiplicadora '${s2}' [${d2.unit.family}:${d2.unit.label}] não cancela o denominador [${denom.family}:${denom.label}] da taxa unitária '${s1}' sem fator de conversão declarado (álgebra dimensional violada: impossível multiplicar ${d2.unit.label} por ${d1.unit.label} diretamente).`,
                    });
                  }
                } else if (!isRatio1 && !isRatio2 && !hasConversion) {
                  recordNodeIssue(id, {
                    slotId: `${slotId}/unit`,
                    kind: 'DIMENSIONAL_UNIT_MISMATCH',
                    reason: `Incompatibilidade dimensional multiplicativa no nó '${id}': a fórmula ('${formulaStr}') combina grandezas heterogêneas ('${s1}' [${d1.unit.family}:${d1.unit.label}] e '${s2}' [${d2.unit.family}:${d2.unit.label}]) sem fator de conversão declarado.`,
                  });
                }
              }
            }
          }
        }

        // 2. Coerência entre a unidade declarada de saída do nó e suas dependências
        if (node.unit && depNodesWithUnit.length > 0) {
          const firstDepUnit = depNodesWithUnit[0].unit;
          const isPureAddition = (formulaStr.includes('+') || formulaStr.includes('-')) && !formulaStr.includes('*');
          if (isPureAddition && depNodesWithUnit.every((d) => d.unit.family === firstDepUnit.family)) {
            if (node.unit.family !== firstDepUnit.family && !node.unit.conversion) {
              recordNodeIssue(id, {
                slotId: `${slotId}/unit`,
                kind: 'DIMENSIONAL_UNIT_MISMATCH',
                reason: `Incompatibilidade de unidade de saída no nó '${id}': o nó declara família '${node.unit.family}', mas seus operandos pertencem à família '${firstDepUnit.family}' sem conversão declarada.`,
              });
            }
          }
        }
      }
    }

    // GATE B: CARDINALIDADE SEMÂNTICA (validateCardinalitySemantics)
    const isComputedOrDerived = node.category === 'COMPUTED_VARIABLE'
      || node.category === 'DERIVED_VALUE'
      || node.category === 'MATHEMATICAL_RULE';
    const isMemberApportionment = isComputedOrDerived && (
      node.cardinality === 'COLLECTION'
      || (node.cardinality !== 'SCALAR' && (
        /(?:apportionment|rateio|allocation_per_member|allocate_items|distribute_to_orders)/i.test(id)
        || /(?:apportionment|rateio|allocation_per_member|allocate_items|distribute_to_orders)/i.test(target)
      ))
    );

    if (isMemberApportionment) {
      const hasCollectionDep = deps.some((depId) => {
        const depNode = nodeMap.get(depId);
        return depNode?.cardinality === 'COLLECTION' || depNode?.semanticType === 'COLLECTION';
      });

      if (!hasCollectionDep) {
        recordNodeIssue(id, {
          slotId: `${slotId}/cardinality`,
          kind: 'COLLECTION_MEMBERS_MISSING',
          reason: `Nó '${id}' declara cardinalidade COLLECTION ou alocação por membro, mas todas as suas dependências são escalares ou agregadas (${deps.join(', ')}), sem acesso aos membros individuais da coleção.`,
        });
      }
    }

    // GATE C: PRESERVAÇÃO DE IDENTIDADE & VERIFICAÇÃO FÍSICA DE SUBSTRATO (validateIdentityPreservation)
    const isSelectiveAction = /(?:quarantine|isolate|penalize|penalty|block_carrier|penalidade|inadimplente|isolamento)/i.test(id)
      || /(?:quarantine|isolate|penalize|penalty|block_carrier|penalidade|inadimplente|isolamento)/i.test(target);

    let isStateFieldBoolean = false;
    let targetFieldObj = null;
    if (Array.isArray(stateModel.entities)) {
      for (const ent of stateModel.entities) {
        for (const f of ent.fields ?? []) {
          if (`${ent.name}.${f.name}` === target || f.name === target) {
            targetFieldObj = f;
            if (f.type === 'BOOLEAN' || f.type === 'BOOL') {
              isStateFieldBoolean = true;
            }
          }
        }
      }
    }

    // Verificação física de substrato contra mentira estrutural de tipo
    const claimsCollection = node.cardinality === 'COLLECTION'
      || node.semanticType === 'COLLECTION'
      || node.semanticType === 'IDENTITY'
      || Boolean(node.identityScope?.entity);

    if (isStateFieldBoolean && claimsCollection) {
      recordNodeIssue(id, {
        slotId: `${slotId}/target`,
        kind: 'STRUCTURAL_SUBSTRATE_MISMATCH',
        reason: `O nó de computabilidade '${id}' declara tipo semântico COLLECTION ou escopo de identidade sobre '${target}', mas o campo físico correspondente no inventário de entidades possui tipo primitivo 'BOOLEAN' (incompatibilidade estrutural: um booleano não pode comportar uma coleção ou lista nominal de identidades).`,
      });
    }

    if (isSelectiveAction) {
      const hasIdentityScope = Boolean(node.identityScope?.entity && node.identityScope?.isPreservedSet !== false);
      const isIdentitySemanticType = node.semanticType === 'IDENTITY' || (node.semanticType === 'COLLECTION' && Boolean(node.identityScope?.entity));

      const isAnonymousBoolean = isStateFieldBoolean && !hasIdentityScope && !isIdentitySemanticType;
      const isScalarWithoutIdentity = (node.cardinality === 'SCALAR' || !node.cardinality) && !hasIdentityScope && !isIdentitySemanticType && !node.semanticType;

      if (isAnonymousBoolean || isScalarWithoutIdentity) {
        recordNodeIssue(id, {
          slotId: `${slotId}/identityPreservation`,
          kind: 'IDENTITY_PRESERVATION_MISSING',
          reason: `O nó '${id}' modela ação seletiva, penalidade ou isolamento de entidade, mas utiliza flag escalar booleano sem preservação de identidade (exige SET<IDENTITY> ou identityScope com entity e identifierField).`,
        });
      }
    }

    // GATE D: FECHAMENTO TRANSACIONAL, ROLLBACK E SNAPSHOT FÍSICO (validateTransactionalClosure)
    const isExecutionCandidate = node.category !== 'HUMAN_DECISION' && node.category !== 'EXTERNAL_INPUT';
    const isMultiLegTransaction = isExecutionCandidate && (
      node.semanticType === 'TRANSACTION'
      || Boolean(node.transaction)
      || (
        (/(?:execute|execucao|commit|rollback|revert|compensat)/i.test(id)
        || /(?:execute|execucao|commit|rollback|revert|compensat)/i.test(target))
        && (/(?:triangulat|atomic_rollback|rollback|multilateral|reversao_atomica|multi_leg)/i.test(id)
        || /(?:triangulat|atomic_rollback|rollback|multilateral|reversao_atomica|multi_leg)/i.test(target))
      )
    );

    if (isMultiLegTransaction) {
      const tx = node.transaction;
      if (!tx || typeof tx !== 'object') {
        recordNodeIssue(id, {
          slotId: `${slotId}/transaction`,
          kind: 'TRANSACTION_BOUNDARY_UNCLOSED',
          reason: `O nó '${id}' representa operação com reversão atômica multi-etapas, mas não define fronteira canônica de transação (transaction: scope, candidateFields, commitGuard, onCommit, onRollback).`,
        });
      } else {
        if (!tx.scope || !tx.commitGuard || !Array.isArray(tx.candidateFields) || tx.candidateFields.length < 2) {
          recordNodeIssue(id, {
            slotId: `${slotId}/transaction`,
            kind: 'TRANSACTION_BOUNDARY_UNCLOSED',
            reason: `A fronteira de transação no nó '${id}' é inválida: exige scope, commitGuard e candidateFields com no mínimo 2 pernas/campos mutáveis.`,
          });
        }

        // Verificação física de substrato de rollback e snapshot
        const promisesStateRollback = /(?:restore|revers|rollback_to_previous|previous_state|estado_anterior|previous_round)/i.test(tx.onRollback || '')
          || /(?:rollback|restore|revers)/i.test(id)
          || /(?:rollback|restore|revers)/i.test(target);

        if (promisesStateRollback) {
          const hasSnapshotField = Boolean(tx.snapshotField && entityFields.has(tx.snapshotField))
            || Boolean(tx.rollbackTarget && entityFields.has(tx.rollbackTarget))
            || [...entityFields].some((f) => /(?:previous|snapshot|last_committed|lastCommitted|baseline|estado_anterior|backup)/i.test(f));

          const opsWithRollbackOrRejection = operations.filter((op) => {
            return (op.branches || []).some((b) => {
              const bId = (b.branchId || '').toUpperCase();
              const bStatus = (b.statusOrError || '').toUpperCase();
              return (bId.includes('CONSERVATION') || bId.includes('DIVERGENCE') || bId.includes('ROLLBACK') || bStatus.includes('DIVERGENCE'))
                && b.outcomeKind === 'REJECTION';
            });
          });

          let hasPhysicalRestorationEffect = false;
          for (const op of opsWithRollbackOrRejection) {
            for (const b of op.branches || []) {
              if (b.outcomeKind === 'REJECTION') {
                const effects = b.stateEffects || [];
                const nonFlagEffects = effects.filter((e) => {
                  const fName = (e.field || '').toLowerCase();
                  return !fName.includes('alert') && !fName.includes('interdict') && !fName.includes('quarantin');
                });
                if (nonFlagEffects.length > 0) {
                  hasPhysicalRestorationEffect = true;
                }
              }
            }
          }

          if (!hasSnapshotField || (opsWithRollbackOrRejection.length > 0 && !hasPhysicalRestorationEffect)) {
            recordNodeIssue(id, {
              slotId: `${slotId}/transaction/rollback`,
              kind: 'ROLLBACK_TARGET_MISSING',
              reason: `Operação/transação '${id}' promete rollback/restauração ao estado anterior da rodada, mas o inventário não possui campo de snapshot/backup prévio e nenhum ramo de rejeição executa restauração física dos saldos mutáveis (rollback fantasma).`,
            });
          }
        }
      }
    }
  }

  // 2. Detecção de Ciclos no Grafo Causal
  const visited = new Set();
  const recursionStack = new Set();
  const cyclicNodes = new Set();

  function checkCycle(currId, path = []) {
    visited.add(currId);
    recursionStack.add(currId);
    const currNode = nodeMap.get(currId);
    const deps = currNode && Array.isArray(currNode.dependencies) ? currNode.dependencies : [];
    for (const depId of deps) {
      if (!nodeMap.has(depId)) continue;
      if (!visited.has(depId)) {
        if (checkCycle(depId, [...path, currId])) return true;
      } else if (recursionStack.has(depId)) {
        cyclicNodes.add(currId);
        cyclicNodes.add(depId);
        issues.push({
          slotId: `computabilityGraph/cycle/${currId}`,
          kind: 'COMPUTATIONAL_DEPENDENCY_CYCLE',
          reason: `Ciclo causal detectado no grafo de computabilidade: ${[...path, currId, depId].join(' -> ')}.`,
        });
        return true;
      }
    }
    recursionStack.delete(currId);
    return false;
  }

  for (const nodeId of nodeMap.keys()) {
    if (!visited.has(nodeId)) {
      checkCycle(nodeId);
    }
  }

  // 3. Propagação Indutiva de Corrente Causal (isNodeComputable)
  const computabilityCache = new Map();
  const evaluatingStack = new Set();

  function evaluateComputability(nodeId) {
    if (computabilityCache.has(nodeId)) {
      return computabilityCache.get(nodeId);
    }
    if (evaluatingStack.has(nodeId) || cyclicNodes.has(nodeId)) {
      computabilityCache.set(nodeId, false);
      return false;
    }
    evaluatingStack.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) {
      evaluatingStack.delete(nodeId);
      computabilityCache.set(nodeId, false);
      return false;
    }

    // Se o nó possui falhas locais, não é computável
    if (nodeLocalIssues.has(nodeId) && nodeLocalIssues.get(nodeId).length > 0) {
      evaluatingStack.delete(nodeId);
      computabilityCache.set(nodeId, false);
      return false;
    }

    // Se é terminal e passou na validação local, é computável
    if (node.category === 'EXTERNAL_INPUT'
      || node.category === 'STATE_FIELD'
      || node.category === 'SYSTEM_CONFIGURATION'
      || node.category === 'HUMAN_DECISION') {
      evaluatingStack.delete(nodeId);
      computabilityCache.set(nodeId, true);
      return true;
    }

    // Se é nó derivado, todas as dependências precisam ser computáveis
    const deps = Array.isArray(node.dependencies) ? node.dependencies : [];
    if (deps.length === 0) {
      evaluatingStack.delete(nodeId);
      computabilityCache.set(nodeId, false);
      return false;
    }

    let allDepsComputable = true;
    for (const depId of deps) {
      const depComputable = evaluateComputability(depId);
      if (!depComputable) {
        allDepsComputable = false;
        recordNodeIssue(nodeId, {
          slotId: `computabilityGraph/${nodeId}/precursor/${depId}`,
          kind: 'NON_COMPUTABLE_PRECURSOR',
          reason: `Corrente causal interrompida em '${nodeId}': o precursor '${depId}' não é computável.`,
        });
      }
    }

    evaluatingStack.delete(nodeId);
    computabilityCache.set(nodeId, allDepsComputable);
    return allDepsComputable;
  }

  // Avaliar todos os nós
  for (const nodeId of nodeMap.keys()) {
    const isComp = evaluateComputability(nodeId);
    const n = nodeMap.get(nodeId);
    if (n) {
      n.computabilityStatus = isComp ? 'COMPUTABLE' : 'NOT_COMPUTABLE';
    }
  }

  // 3. Validação de operações que declaram rateio entre pedidos da fila (Arity Conservation Theorem)
  for (const op of operations) {
    const isApportionmentOp = /(?:apportion|rateio|allocate_orders|distribute_queue|fracionamento)/i.test(op.name)
      || /(?:apportion|rateio|ratear|pedidos da fila|fracionamento)/i.test(op.description || '');

    if (isApportionmentOp) {
      const params = Array.isArray(op.parameters) ? op.parameters : [];
      const hasCollectionParam = params.some((p) => {
        const pName = (p.name || '').toLowerCase();
        const pType = (p.type || '').toLowerCase();
        const pDomain = (p.domain || '').toLowerCase();
        return p.cardinality === 'COLLECTION'
          || pType.includes('array')
          || pType.includes('collection')
          || pType.includes('list')
          || pType.includes('set')
          || /(?:orders|queue|requests|pedidos|items|fila)/i.test(pName)
          || /(?:pedidos|lista|colecao|itens|fila)/i.test(pDomain);
      });

      const hasCollectionEntity = Array.isArray(stateModel.entities)
        && stateModel.entities.some((e) => /(?:queue|orders|pedidos|fila|requests)/i.test(e.name));

      if (!hasCollectionParam && !hasCollectionEntity) {
        issues.push({
          slotId: `operations/${op.name}/parameters`,
          kind: 'COLLECTION_INPUT_ABSENT',
          reason: `A operação '${op.name}' alega ratear capacidade proporcionalmente entre pedidos da fila, mas sua assinatura de parâmetros recebe apenas escalares agregados (${params.map((p) => p.name).join(', ')}), sem acesso à coleção de pedidos individuais (teorema da conservação de granularidade violado).`,
        });
      }
    }
  }

  // 4. Verificação Reversa a partir de Efeitos de Estado de Operações
  if (computabilityGraph.length > 0) {
    const ignoredTokens = new Set(['null', 'undefined', 'true', 'false', 'none', 'empty', 'n']);
    for (const op of operations) {
      const branches = Array.isArray(op.branches) ? op.branches : [];
      const opParams = new Set((op.parameters ?? []).map((p) => p.name));
      for (const branch of branches) {
        const effects = Array.isArray(branch.stateEffects) ? branch.stateEffects : [];
        for (const eff of effects) {
          if (eff.effect === 'SET' && typeof eff.value === 'string') {
            const val = eff.value.trim();
            if (/^-?\d+(?:n|\.\d+)?$/i.test(val) || val === 'true' || val === 'false' || val.startsWith("'") || val.startsWith('"')) {
              continue;
            }
            const tokens = val.split(/[^a-zA-Z0-9_.]+/).filter((t) => t.length > 0 && isNaN(Number(t)));
            for (const token of tokens) {
              if (ignoredTokens.has(token.toLowerCase()) || /^\d+n$/i.test(token)) {
                continue;
              }
              const isKnown = opParams.has(token)
                || rawFieldNames.has(token)
                || entityFields.has(token)
                || (nodeMap.has(token) && computabilityCache.get(token) !== false)
                || computabilityGraph.some((n) => (
                  (n.groundedIn === token
                  || n.target === token
                  || n.symbol === token
                  || n.nodeId === token
                  || (n.groundedIn && n.groundedIn.endsWith(`.${token}`))
                  || (n.target && n.target.endsWith(`.${token}`)))
                  && computabilityCache.get(n.symbol ?? n.nodeId) !== false
                ))
                || observableNames.has(token);
              if (!isKnown) {
                issues.push({
                  slotId: `operation/${op.name}/branch/${branch.branchId}/stateEffect/${eff.field}`,
                  kind: 'OPEN_COMPUTATIONAL_DEPENDENCY',
                  reason: `O efeito no campo '${eff.field}' na operação '${op.name}' utiliza o termo '${token}', que não é parâmetro, campo de estado, nem possui nó computável fundamentado no grafo.`,
                });
              }
            }
          }
        }
      }
    }
  }

  // Gate 2: External Effect Coverage & Gate 3: Transaction / Rollback Coverage
  const hasExternalEffectContext = (architectureContexts ?? []).some((ctx) => (
    (typeof ctx === 'string' ? ctx : ctx.tag) === 'external-effect'
  )) || (pathReferences ?? []).some((p) => p.role === 'PUBLIC_SURFACE');

  if (hasExternalEffectContext) {
    const publicSurfaces = (Array.isArray(pathReferences) ? pathReferences : [])
      .filter((p) => p.role === 'PUBLIC_SURFACE' || p.role === 'PERSISTENT_STORAGE');

    for (const pub of publicSurfaces) {
      const pubPath = pub.path;
      let covered = false;

      for (const op of operations) {
        const branches = Array.isArray(op.branches) ? op.branches : [];
        for (const branch of branches) {
          const extEffects = Array.isArray(branch.externalEffects) ? branch.externalEffects : [];
          if (extEffects.some((eff) => eff.targetPath === pubPath || pubPath.includes(eff.targetPath) || eff.targetPath.includes(pubPath))) {
            covered = true;
            break;
          }
        }
        if (covered) break;
      }

      if (!covered) {
        for (const node of computabilityGraph) {
          if (node.semanticType === 'EXTERNAL_EFFECT' || node.externalEffect) {
            const effPath = node.externalEffect?.targetSurface || node.externalEffect?.targetPath || node.target;
            if (effPath && (effPath === pubPath || pubPath.includes(effPath) || effPath.includes(pubPath))) {
              covered = true;
              break;
            }
          }
        }
      }

      if (!covered) {
        issues.push({
          slotId: `pathReferences/${pubPath}`,
          kind: 'EXTERNAL_EFFECT_COVERAGE_MISSING',
          reason: `A superfície pública '${pubPath}' não possui efeito externo físico modelado em operações ou no grafo de computabilidade (ação física no sistema de arquivos ausente).`,
        });
      }
    }

    for (const op of operations) {
      const opText = `${op.name} ${op.description || ''}`;
      const claimsPhysicalMutation = /(?:quarantine|mover|append|escrever|gravar|write|isolate|purge|ledger|audit|copiar|copy|unlink|expurgar|purgar)/i.test(opText);
      if (claimsPhysicalMutation) {
        const branches = Array.isArray(op.branches) ? op.branches : [];
        const hasBranchExtEffect = branches.some((b) => Array.isArray(b.externalEffects) && b.externalEffects.length > 0);
        const hasGraphExtEffect = computabilityGraph.some((n) => (
          (n.semanticType === 'EXTERNAL_EFFECT' || n.externalEffect)
          && (n.target === op.name || n.symbol === op.name || n.formula?.includes(op.name))
        ));

        if (!hasBranchExtEffect && !hasGraphExtEffect) {
          issues.push({
            slotId: `operations/${op.name}/externalEffects`,
            kind: 'EXTERNAL_EFFECT_COVERAGE_MISSING',
            reason: `A operação '${op.name}' alega mutação física ou movimentação de arquivos, mas suas transições apenas alteram contadores em memória sem modelar os efeitos externos físicos (targetPath, action, confirmationCheck).`,
          });
        }
      }
    }

    // Gate 2.1: Modelar ações reais no sistema de arquivos com verificação estrita de cada efeito
    for (const op of operations) {
      const branches = Array.isArray(op.branches) ? op.branches : [];
      for (const branch of branches) {
        const extEffects = Array.isArray(branch.externalEffects) ? branch.externalEffects : [];
        for (const eff of extEffects) {
          const target = eff.targetPath || eff.targetSurface || op.name;
          const action = eff.action || 'UNKNOWN_ACTION';

          if (!eff.confirmationCheck || typeof eff.confirmationCheck !== 'string' || eff.confirmationCheck.trim().length === 0) {
            issues.push({
              slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/confirmationCheck`,
              kind: 'INCOMPLETE_EXTERNAL_EFFECT',
              reason: `O efeito externo '${action}' sobre '${target}' não possui 'confirmationCheck' (como confirmar se a escrita/movimento funcionou no disco?).`,
            });
          }

          if (!eff.onSuccess || typeof eff.onSuccess !== 'string' || eff.onSuccess.trim().length === 0) {
            issues.push({
              slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/onSuccess`,
              kind: 'INCOMPLETE_EXTERNAL_EFFECT',
              reason: `O efeito externo '${action}' sobre '${target}' não define 'onSuccess' (o que acontece se der certo? próximo passo determinístico ausente).`,
            });
          }

          if (!eff.onFailure || typeof eff.onFailure !== 'string' || eff.onFailure.trim().length === 0) {
            issues.push({
              slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/onFailure`,
              kind: 'INCOMPLETE_EXTERNAL_EFFECT',
              reason: `O efeito externo '${action}' sobre '${target}' não define 'onFailure' (o que acontece se falhar no meio? cleanup + estado anterior + exit 1 ausente).`,
            });
          }
        }
      }
    }

    // Gate 2.2: Confirmação Forte Falsificável (não aceita check genérico como 'test -s', 'test -f' ou exit code 0)
    for (const op of operations) {
      const branches = Array.isArray(op.branches) ? op.branches : [];
      for (const branch of branches) {
        const extEffects = Array.isArray(branch.externalEffects) ? branch.externalEffects : [];
        for (const eff of extEffects) {
          const target = eff.targetPath || eff.targetSurface || op.name;
          const action = eff.action || 'UNKNOWN_ACTION';
          const check = (eff.confirmationCheck || '').trim();
          if (!check) continue;

          // Se a ação alega preservação de mtime, o check DEVE validar timestamp (stat, mtime, %Y, etc.)
          if (eff.preservesTimestamp) {
            const validatesMtime = /(?:stat|mtime|%Y|timestamp)/i.test(check);
            if (!validatesMtime) {
              issues.push({
                slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/confirmationCheck`,
                kind: 'WEAK_CONFIRMATION_CHECK',
                reason: `O efeito externo '${action}' sobre '${target}' alega preservação de timestamp ('preservesTimestamp: true'), mas seu 'confirmationCheck' ('${check}') não verifica a preservação de mtime via stat ou comparação temporal.`,
              });
            }
          }

          // Se a ação é gravação de log de auditoria, o check DEVE validar conteúdo registrado (ex: grep do evento/divergência)
          const isAuditLog = /(?:audit|log)/i.test(target) || action === 'APPEND_LOG';
          if (isAuditLog) {
            const validatesContent = /(?:grep|awk|diff|cmp|conteudo|divergencia|lote)/i.test(check);
            if (!validatesContent) {
              issues.push({
                slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/confirmationCheck`,
                kind: 'WEAK_CONFIRMATION_CHECK',
                reason: `O efeito externo '${action}' sobre '${target}' possui 'confirmationCheck' fraco ('${check}'): verificar apenas existência ou saída genérica não prova que a entrada de auditoria com a divergência correta foi gravada. Exige validação falsificável do conteúdo registrado (ex.: grep do ID do lote ou delta).`,
              });
            }
          }

          // Verificação genérica: test -s, test -f, test -e, EXIT_CODE_ZERO, FS_SYNC, WRITE_SYNC
          const isGenericCheck = /^(?:test\s+-[sfe]|\[\s*-[sfe]|EXIT_CODE_ZERO|FS_SYNC|WRITE_SYNC)$/i.test(check)
            || /^test\s+-[sfe]\s+[^&|;]+$/i.test(check);
          const isDeletion = action === 'DELETE_TEMP' || action === 'PURGE_TEMPORARY';
          if (isGenericCheck && !isDeletion) {
            const alreadyFlagged = issues.some((i) => i.slotId.includes(target) && i.kind === 'WEAK_CONFIRMATION_CHECK');
            if (!alreadyFlagged) {
              issues.push({
                slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/confirmationCheck`,
                kind: 'WEAK_CONFIRMATION_CHECK',
                reason: `O efeito externo '${action}' sobre '${target}' possui 'confirmationCheck' fraco ('${check}'): teste de existência de arquivo ('test -s'/'test -f') ou sincronização genérica apenas atesta que o arquivo não está vazio, não provando que o conteúdo correto foi gravado.`,
              });
            }
          }
        }
      }
    }

    // Gate 3: Transaction / Rollback Coverage (Modelar falha e rollback em operações com efeito externo)
    for (const op of operations) {
      const opText = `${op.name} ${op.description || ''}`;
      const branches = Array.isArray(op.branches) ? op.branches : [];
      const hasExtEffects = branches.some((b) => (
        Array.isArray(b.externalEffects) && b.externalEffects.some((eff) => (
          eff.action === 'WRITE_FILE' || eff.action === 'APPEND_CONTENT' || eff.action === 'MOVE_FILE' || eff.action === 'ISOLATE_TO_QUARANTINE' || eff.action === 'PURGE_TEMPORARY' || eff.action === 'WRITE_TEMP' || eff.action === 'APPEND_LOG' || eff.action === 'RENAME' || eff.action === 'DELETE_TEMP' || eff.action === 'ATOMIC_SUBSTITUTE'
        ))
      ));
      const isPersistentOrDestructive = hasExtEffects
        || /(?:append|ledger|escrever|gravar|isolate|quarantine|cleanup|expurgar|purgar)/i.test(opText);

      if (isPersistentOrDestructive) {
        const hasOpRollback = Boolean(op.rollback?.strategy)
          || branches.some((b) => Boolean(b.rollback?.strategy) || (Array.isArray(b.externalEffects) && b.externalEffects.some((e) => Boolean(e.rollback?.strategy))));
        const hasGraphTx = computabilityGraph.some((n) => (
          (n.semanticType === 'TRANSACTION' || n.transaction || (n.externalEffect && Boolean(n.externalEffect.rollback?.strategy)))
          && (n.target === op.name || n.symbol === op.name || n.formula?.includes(op.name) || n.transaction?.onRollback)
        ));

        if (!hasOpRollback && !hasGraphTx) {
          issues.push({
            slotId: `operations/${op.name}/rollback`,
            kind: 'TRANSACTION_ROLLBACK_MISSING',
            reason: `A operação '${op.name}' realiza mutação externa persistente ou criação provisória sem estratégia mecânica de rollback ou limpeza de arquivos órfãos sob falha (o que acontece se falhar no meio?).`,
          });
        }
      }
    }

    // Gate 3.1: Rollback Real (se move ou altera arquivo persistente, apagar /tmp não restaura o arquivo)
    for (const op of operations) {
      const branches = Array.isArray(op.branches) ? op.branches : [];
      for (const branch of branches) {
        const extEffects = Array.isArray(branch.externalEffects) ? branch.externalEffects : [];
        for (const eff of extEffects) {
          const target = eff.targetPath || eff.targetSurface || '';
          const action = eff.action || '';
          const isPersistentMutation = action === 'MOVE_FILE'
            || action === 'ISOLATE_TO_QUARANTINE'
            || (action === 'WRITE_FILE' && !target.startsWith('/tmp'));

          if (isPersistentMutation) {
            const rb = eff.rollback || branch.rollback || op.rollback;
            const strategy = rb?.strategy || '';
            const rbTarget = rb?.target || '';
            const hasCompensation = Boolean(rb?.compensation && rb.compensation.trim().length > 0);
            const hasCompensationTarget = Boolean(rb?.compensationTarget && rb.compensationTarget.trim().length > 0);
            const isRestoreOriginal = strategy === 'RESTORE_ORIGINAL' || strategy === 'COMPENSATING_ACTION' || strategy === 'RESTORE_SNAPSHOT';

            const onlyPurgesTemp = (strategy === 'TRAP_PURGE_TEMPORARY' || rbTarget.startsWith('/tmp')) && !hasCompensation && !hasCompensationTarget && !isRestoreOriginal;

            if (onlyPurgesTemp || (!hasCompensation && !hasCompensationTarget && !isRestoreOriginal)) {
              issues.push({
                slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/rollback`,
                kind: 'UNCOMPENSATED_EXTERNAL_EFFECT',
                reason: `O efeito externo '${action}' sobre '${target}' altera o sistema de arquivos persistente, mas o rollback limita-se a purgar arquivos temporários ('${rbTarget || '/tmp/*'}') sem definir como desfazer a movimentação (ação compensatória 'compensation' ou restauração do arquivo original 'compensationTarget'). Se uma etapa posterior falhar, o arquivo permanecerá indevidamente deslocado/modificado.`,
              });
            }
          }
        }
      }
    }

    // Gate 4.1: Escrita Atômica no Ledger Persistente (proíbe APPEND_CONTENT direto em arquivos consolidados/definitivos)
    for (const op of operations) {
      const branches = Array.isArray(op.branches) ? op.branches : [];
      for (const branch of branches) {
        const extEffects = Array.isArray(branch.externalEffects) ? branch.externalEffects : [];
        for (const eff of extEffects) {
          const target = eff.targetPath || eff.targetSurface || '';
          const action = eff.action || '';
          const isLedgerPersistent = /(?:ledger|consolidado)/i.test(target) && !target.startsWith('/tmp') && !target.endsWith('.tmp');

          if (isLedgerPersistent && action === 'APPEND_CONTENT') {
            issues.push({
              slotId: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}/action`,
              kind: 'NON_ATOMIC_PERSISTENT_MUTATION',
              reason: `Mutação no ledger persistente '${target}' utiliza append direto ('APPEND_CONTENT'), o que não é atômico e pode deixar o arquivo definitivo pela metade em caso de falha no meio do processo. Exige o fluxo de substituição atômica: criar o novo ledger completo em arquivo temporário ('WRITE_TEMP'), validar ('confirmationCheck') e substituir o arquivo definitivo de uma vez ('ATOMIC_SUBSTITUTE').`,
            });
          }
        }
      }
    }

    // Gate 4: Cross-Check Automático (Requisito, Transição, Efeito e Invariante contam a mesma história?)
    const reqStatementsText = [
      ...(requirements || []).map((r) => `${r.statement || ''} ${((r.acceptanceCases || []).map((c) => `${c.given || ''} ${c.when || ''} ${c.then || ''}`)).join(' ')}`),
      ...(decisions || []).flatMap((d) => (d.answers || []).map((a) => `${a.label || ''} ${a.contractEffect || ''} ${a.rationale || ''}`)),
    ].join(' ');

    const requiresDeduplication = /(?:deduplic|sem duplicar|ignorar duplicadas|duplicad|linhas idênticas.*ignoradas)/i.test(reqStatementsText);
    const hasLedgerConsolidation = [...pathReferences, ...(operations || [])].some((item) => (
      /(?:ledger|consolidado)/i.test(item.path || item.name || item.description || '')
    ));

    if (requiresDeduplication && hasLedgerConsolidation) {
      // 1. Verificar se a fórmula de totalização consome soma bruta em vez de linhas deduplicadas
      const newTotalNode = computabilityGraph.find((n) => (
        n.symbol === 'NEW_TOTAL_KG' || n.nodeId === 'NEW_TOTAL_KG' || n.target === 'newTotalKg'
      ));

      if (newTotalNode) {
        const formula = newTotalNode.formula || '';
        const deps = newTotalNode.dependencies || [];
        const usesRawFileSumDirectly = deps.includes('ACCUMULATED_KG')
          || deps.includes('PARSED_ROWS')
          || formula.includes('accumulatedKg')
          || formula.includes('parsedRows');

        const consumesDeduplicatedSubstrate = deps.some((d) => /(?:dedup|consolidated_added|filtered|unique)/i.test(d))
          || computabilityGraph.some((n) => (
            /(?:dedup|consolidated_added|unique_rows|linhas_unicas)/i.test(n.symbol || n.nodeId || n.target || '')
            && deps.includes(n.symbol || n.nodeId)
          ));

        if (usesRawFileSumDirectly && !consumesDeduplicatedSubstrate) {
          issues.push({
            slotId: 'computabilityGraph/NEW_TOTAL_KG/crossConsistency',
            kind: 'CROSS_LAYER_CONTRADICTION',
            reason: "Contradição cross-layer detectada entre Requisito, Transição, Efeito Externo e Invariante: a política acordada exige deduplicação de linhas antes da consolidação no ledger ('processed/ledger_consolidado.tsv'), mas a fórmula de totalização consome a soma bruta do arquivo ('accumulatedKg') em vez das linhas deduplicadas efetivamente adicionadas ao ledger. Isso cria divergência física entre os dados gravados no ledger e o total consolidado exibido.",
          });
        }
      }

      // 2. Verificar se alguma invariante alega falsamente conservação exata da soma dos arquivos aceitos
      for (const inv of (invariants || [])) {
        const invText = `${inv.statement || ''} ${inv.falsification || ''}`;
        const claimsExactFileSumInLedger = /(?:soma.*adicionada ao ledger corresponde exatamente à soma dos.*arquivos aceitos|soma dos lotes de arquivos aceitos)/i.test(invText)
          && !/(?:deduplic|unic|filtr|sem duplicat|não duplicad)/i.test(invText);
        if (claimsExactFileSumInLedger) {
          issues.push({
            slotId: `invariants/${inv.id}/crossConsistency`,
            kind: 'CONTRADICTORY_RULE_DETECTED',
            reason: `A invariante '${inv.id}' alega que a soma adicionada ao ledger corresponde exatamente à soma dos manifestos aceitos, o que contradiz a política de deduplicação (linhas repetidas são descartadas do ledger, de modo que a massa adicionada ao ledger é estritamente menor que a soma do manifesto caso haja duplicatas).`,
          });
        }
      }
    }
  }

  // Gate 5: Ordem Determinística na Descoberta e Travessia de Arquivos
  for (const node of computabilityGraph) {
    const id = node.nodeId || node.symbol || '';
    const target = node.target || '';
    const formula = node.formula || '';
    const cardinality = node.cardinality || 'SCALAR';
    const isDiscoveryOrTraversal = /(?:discover|readdir|travers|find|ls|listfiles|glob|nextmanifest)/i.test(`${id} ${target} ${formula}`)
      || (cardinality === 'COLLECTION' && /(?:file|manifest|arquivo)/i.test(`${id} ${target}`));

    if (isDiscoveryOrTraversal) {
      const hasOrdering = Boolean(node.orderingPolicy && typeof node.orderingPolicy === 'string' && node.orderingPolicy.trim().length > 0);
      if (!hasOrdering) {
        issues.push({
          slotId: `computabilityGraph/${id}/orderingPolicy`,
          kind: 'NON_DETERMINISTIC_TRAVERSAL_ORDER',
          reason: `O nó de descoberta/leitura de arquivos '${id}' não especifica 'orderingPolicy' determinística (ex.: 'LC_ALL=C sort -d'). A travessia de diretórios sem ordenação explícita varia conforme a ordem de inodes do sistema de arquivos, podendo fazer com que duas implementações processem arquivos em ordens distintas e gerem ledgers diferentes.`,
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
 * Closure Certificate mecânico.
 * 
 * Compila pendências declaradas e verificações estruturais; não prova correção semântica.
 * Qualquer valor > 0 proíbe SEMANTICALLY_CLOSED.
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
  });

  const provenanceResult = validateProvenanceEnforcement({
    stateModel: specification.stateModel,
    architecturePolicy: specification.policy,
    literalFacts: specification.intentEvidence?.literalFacts ?? specification.literalFacts ?? [],
    fragments: specification.intentEvidence?.fragments ?? specification.fragments ?? [],
    intent: specification.intent ?? '',
  });

  const aggregationResult = validateAggregationAndBoundaries({ stateModel: specification.stateModel });

  const inventoryIssues = [
    ...inventoryResult.issues,
    ...witnessResult.issues,
    ...aggregationResult.issues,
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
  ));

  const transitionIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_TRANSITION'
    || i.kind === 'UNRESOLVED_GUARD_PRECEDENCE'
    || i.kind === 'MISSING_GUARD_REJECTION_BRANCH'
    || i.kind === 'UNDETERMINED_BRANCH_NEXT_STATE'
    || i.kind === 'MISSING_SUCCESS_BRANCH'
    || i.kind === 'UNRESOLVED_CANONICAL_SERIALIZATION'
    || i.kind === 'PIPELINE_PRECEDENCE_CONTRADICTION'
    || i.kind === 'UNRESOLVED_PARAMETER_DOMAIN'
    || i.kind === 'ORPHAN_STATE_MUTATION_OWNER'
    || i.kind === 'UNRESOLVED_DERIVATION_FUNCTION'
    || i.kind === 'UNRESOLVED_BOUNDARY_CONSUMPTION'
    || i.kind === 'UNRESOLVED_CATEGORY_MEMBERSHIP'
    || i.kind === 'EXTERNAL_EFFECT_COVERAGE_MISSING'
    || i.kind === 'INCOMPLETE_EXTERNAL_EFFECT'
    || i.kind === 'TRANSACTION_ROLLBACK_MISSING'
    || i.kind === 'WEAK_CONFIRMATION_CHECK'
    || i.kind === 'UNCOMPENSATED_EXTERNAL_EFFECT'
    || i.kind === 'NON_ATOMIC_PERSISTENT_MUTATION'
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
    || i.kind === 'COMPUTATIONAL_DEPENDENCY_CYCLE'
    || i.kind === 'MISSING_DERIVATION_RULE'
    || i.kind === 'DISCONNECTED_CIRCUIT_OPERAND'
    || i.kind === 'PIVOT_TIE_POLICY_UNRESOLVED'
    || i.kind === 'UNRESOLVED_ZERO_DIVISOR'
    || i.kind === 'UNCONFIRMED_FEEDBACK_LOOP'
    || i.kind === 'NON_COMPUTABLE_PRECURSOR'
    || i.kind === 'DIMENSIONAL_UNIT_MISMATCH'
    || i.kind === 'COLLECTION_MEMBERS_MISSING'
    || i.kind === 'IDENTITY_PRESERVATION_MISSING'
    || i.kind === 'TRANSACTION_BOUNDARY_UNCLOSED'
    || i.kind === 'STRUCTURAL_SUBSTRATE_MISMATCH'
    || i.kind === 'DIMENSIONAL_CANCELLATION_FAILURE'
    || i.kind === 'COLLECTION_INPUT_ABSENT'
    || i.kind === 'ROLLBACK_TARGET_MISSING'
    || i.kind === 'DERIVATION_PROVENANCE_MISSING'
    || i.kind === 'NON_DETERMINISTIC_TRAVERSAL_ORDER'
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

  const allIssues = [
    ...inventoryIssues,
    ...stateLifecycle.issues,
    ...provenanceResult.issues,
    ...materialUnknownGaps.map((u) => ({ slotId: `unknown/${u.id}`, kind: 'MATERIAL_UNKNOWN_GAP', reason: u.statement })),
    ...determinismGaps.map((d) => ({ slotId: `determinism/${d.kind}/${d.subjectId}`, kind: 'DETERMINISM_GAP', reason: d.rationale })),
    ...determinismDecisions.map((d) => ({ slotId: `determinism/${d.kind}/${d.subjectId}`, kind: 'PENDING_HUMAN_DECISION', reason: d.rationale })),
    ...pendingDecisions.map((q) => ({ slotId: `decision/${q.questionId}`, kind: 'PENDING_HUMAN_DECISION', reason: q.question })),
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

function classifyGapIssue(issue, index) {
  const gapId = `GAP-${String(index + 1).padStart(4, '0')}`;
  let layer = 'COVERAGE_ACCOUNTING';
  let requiredAuthority = 'ARCHITECTURE_POLICY';
  let witness = issue.reason || issue.statement || issue.slotId || 'Lacuna de fechamento de inventário identificada.';

  switch (issue.kind) {
    // 1. TRANSITION_CONSISTENCY
    case 'UNRESOLVED_TRANSITION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || `Operação '${issue.operation || issue.slotId}' não define transição para todas as condições.`;
      break;
    case 'UNRESOLVED_GUARD_PRECEDENCE':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || `Operação '${issue.operation || issue.slotId}' possui múltiplos guards sem precedência linear estrita.`;
      break;
    case 'MISSING_GUARD_REJECTION_BRANCH':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Guard de rejeição sem ramo correspondente em branches.';
      break;
    case 'UNDETERMINED_BRANCH_NEXT_STATE':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || 'Ramo de operação possui próximo estado não determinado.';
      break;
    case 'MISSING_SUCCESS_BRANCH':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Operação sem ramo explícito de autorização/sucesso.';
      break;
    case 'CONFLICTING_STATE_DECLARATIONS':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;
    case 'PIPELINE_PRECEDENCE_CONTRADICTION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Etapas de pipeline de execução contradizem a precedência de guardas.';
      break;
    case 'UNRESOLVED_PARAMETER_DOMAIN':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Parâmetro de operação sem limites ou rejeição determinísticos.';
      break;
    case 'ORPHAN_STATE_MUTATION_OWNER':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Mutação ou gatilho de reset sem dono declarado no modelo.';
      break;
    case 'CONTRADICTORY_RULE_DETECTED':
    case 'CROSS_LAYER_CONTRADICTION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Contradição ativa detectada entre invariantes, requisitos e operações.';
      break;
    case 'EXTERNAL_EFFECT_COVERAGE_MISSING':
    case 'INCOMPLETE_EXTERNAL_EFFECT':
    case 'TRANSACTION_ROLLBACK_MISSING':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Efeito externo físico ausente, incompleto ou sem estratégia mecânica de rollback.';
      break;
    case 'WEAK_CONFIRMATION_CHECK':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Check de confirmação genérico ou fraco; não refuta o efeito esperado.';
      break;
    case 'UNCOMPENSATED_EXTERNAL_EFFECT':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Efeito externo persistente sem restauração ou ação compensatória de rollback.';
      break;
    case 'NON_ATOMIC_PERSISTENT_MUTATION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Mutação direta não atômica em arquivo persistente de ledger.';
      break;
    case 'UNRESOLVED_DERIVATION_FUNCTION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Campo derivado sem função de derivação total determinística.';
      break;
    case 'UNRESOLVED_BOUNDARY_CONSUMPTION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Sinal de fronteira sem modelagem na operação consumidora.';
      break;
    case 'UNRESOLVED_CATEGORY_MEMBERSHIP':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Categoria abstrata sem membros enumerados no modelo de estado.';
      break;
    case 'INVALID_SEMANTIC_KEY':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason;
      break;

    // 2. OBSERVABLE_DEPENDENCY_CLOSURE
    case 'UNRESOLVED_OBSERVABLE_DEPENDENCY':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Observável depende de campo inexistente no modelo de estado.';
      break;
    case 'UNRESOLVED_OBSERVABLE_REPRESENTATION':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Observável sem representação finita explícita.';
      break;
    case 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Observável sem comportamento definido para coleção vazia.';
      break;
    case 'INVALID_BITMASK_ALLOCATION':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Alocação de bits sobreposta ou fora dos limites do tipo.';
      break;
    case 'UNRESOLVED_CANONICAL_SERIALIZATION':
    case 'MISSING_CANONICAL_SERIALIZATION_INVENTORY':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || 'Perfil de serialização canônica ausente para demanda de integridade.';
      break;

    // 3. AUTHORITY_PROVENANCE
    case 'UNAUTHORIZED_NUMERIC_LITERAL':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;
    case 'MATERIAL_UNKNOWN_GAP':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || 'Lacuna material sem proveniência resolvida e sem decisão vinculada.';
      break;
    case 'DETERMINISM_GAP':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || 'Dimensão de determinismo com GAP_FOUND.';
      break;

    // 4. COVERAGE_ACCOUNTING
    case 'MISSING_STATEFUL_ENTITY_INVENTORY':
    case 'MISSING_BOUNDED_OBSERVABILITY_INVENTORY':
    case 'UNRESOLVED_STATE_MODEL':
    case 'UNRESOLVED_FIELD_BOUNDS':
    case 'UNRESOLVED_COLLECTION_CAPACITY':
      layer = 'COVERAGE_ACCOUNTING';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason;
      break;

    case 'UNRESOLVED_INITIALIZATION':
    case 'UNRESOLVED_RESET':
    case 'UNRESOLVED_COLLECTION_ADMISSION':
    case 'PENDING_HUMAN_DECISION':
      layer = 'COVERAGE_ACCOUNTING';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason;
      break;

    case 'ORPHAN_STATE_FIELD':
      layer = 'COVERAGE_ACCOUNTING';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;

    // 5. COMPUTABILITY_DEPENDENCY_CLOSURE (Fase 1: Completude Semântica Causal)
    case 'OPEN_COMPUTATIONAL_DEPENDENCY':
    case 'UNRESOLVED_COMPUTATIONAL_DEPENDENCY':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Dependência semântica necessária para computabilidade não foi encontrada ou fundamentada.';
      break;
    case 'COMPUTATIONAL_DEPENDENCY_CYCLE':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Ciclo de dependência causal detectado no grafo de computabilidade.';
      break;
    case 'MISSING_DERIVATION_RULE':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Nó computado sem regra de derivação ou fórmula determinística definida.';
      break;
    case 'DISCONNECTED_CIRCUIT_OPERAND':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Regra de cálculo utiliza operando não conectado nas dependências do nó.';
      break;
    case 'PIVOT_TIE_POLICY_UNRESOLVED':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || 'Detecção de pivôs/extremos sem política determinística para empates de valores consecutivos.';
      break;
    case 'UNRESOLVED_ZERO_DIVISOR':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Fórmula com divisão contendo variáveis sem tratamento determinístico para divisor zero.';
      break;
    case 'UNCONFIRMED_FEEDBACK_LOOP':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Despacho de ordens ou mutação de saldo sem confirmação de execução de loop fechado.';
      break;
    case 'NON_COMPUTABLE_PRECURSOR':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Corrente causal interrompida porque o precursor do nó não é computável.';
      break;
    case 'DIMENSIONAL_UNIT_MISMATCH':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Incompatibilidade dimensional em nó de computabilidade.';
      break;
    case 'COLLECTION_MEMBERS_MISSING':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Rateio ou operação em coleção sem membros individuais disponíveis.';
      break;
    case 'IDENTITY_PRESERVATION_MISSING':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Ação seletiva sobre entidade sem preservação de identidade.';
      break;
    case 'TRANSACTION_BOUNDARY_UNCLOSED':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Operação com reversão atômica sem fronteira canônica de transação.';
      break;
    case 'STRUCTURAL_SUBSTRATE_MISMATCH':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Incompatibilidade estrutural entre a etiqueta lógica e o campo físico no inventário de entidades.';
      break;
    case 'DIMENSIONAL_CANCELLATION_FAILURE':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Falha de cancelamento dimensional na multiplicação/divisão por taxa unitária.';
      break;
    case 'COLLECTION_INPUT_ABSENT':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Operação alega rateio entre membros mas recebe apenas escalares agregados.';
      break;
    case 'ROLLBACK_TARGET_MISSING':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Operação/transação promete rollback mas não possui campo de snapshot prévio ou restauração física de saldos.';
      break;
    case 'DERIVATION_PROVENANCE_MISSING':
    case 'FABRICATED_EXTERNAL_INPUT':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Nó declarado como entrada externa sem proveniência legítima (atalho falso).';
      break;
    case 'NON_DETERMINISTIC_TRAVERSAL_ORDER':
      layer = 'COMPUTABILITY_DEPENDENCY_CLOSURE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Ordem de descoberta ou travessia de arquivos sem política determinística explícita.';
      break;


    default:
      layer = 'COVERAGE_ACCOUNTING';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || issue.slotId || 'Lacuna de fechamento de inventário não classificada.';
      break;
  }

  const gapEntry = {
    gapId,
    layer,
    witness,
    requiredAuthority,
  };
  if (typeof issue.slotId === 'string' && issue.slotId.length > 0) {
    gapEntry.slotId = issue.slotId;
  }
  if (typeof issue.reason === 'string' && issue.reason.length > 0 && issue.reason !== witness) {
    gapEntry.details = issue.reason;
  }
  return gapEntry;
}
