
/**
 * Validador Mecânico de Cobertura de Inventário Semântico (validateSemanticInventoryCoverage).
 * 
 * Executado ANTES de validateFieldLifecycle:
 * Impede que entidades, campos, observáveis ou fatias de fronteira semanticamente necessários
 * sejam simplesmente omitidos do IR pelo gerador (evitando falsos positivos de fechamento).
 */
export function validateSemanticInventoryCoverage({
  stateModel = null,
  architectureContexts = [],
  boundaryRules = [],
  literalFacts = [],
  requirements = [],
} = {}) {
  const issues = [];
  const tags = new Set(architectureContexts.map((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag)));

  const entities = Array.isArray(stateModel?.entities) ? stateModel.entities : [];
  const operations = Array.isArray(stateModel?.operations) ? stateModel.operations : [];
  const observables = Array.isArray(stateModel?.observables) ? stateModel.observables : [];
  const serializations = Array.isArray(stateModel?.canonicalSerializations) ? stateModel.canonicalSerializations : [];

  const allFieldKeys = new Set();
  const allFieldNames = new Set();
  for (const entity of entities) {
    for (const field of (entity.fields ?? [])) {
      allFieldKeys.add(`${entity.name}.${field.name}`);
      allFieldNames.add(field.name);
    }
  }

  const allAllocatedSlices = [];
  for (const obs of observables) {
    if (Array.isArray(obs.bitAllocation)) {
      for (const alloc of obs.bitAllocation) {
        if (typeof alloc.slice === 'string') {
          const match = alloc.slice.match(/^(\d+)(?:\.\.(\d+))?$/u);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : start;
            allAllocatedSlices.push({
              sliceStr: alloc.slice,
              start,
              end,
              field: alloc.field,
              mapping: alloc.mapping,
            });
          }
        }
      }
    }
  }

  // 1. Contextos Mandatórios
  if (tags.has('stateful-operation') && entities.length === 0) {
    issues.push({
      slotId: 'inventory/entities',
      kind: 'MISSING_STATEFUL_ENTITY_INVENTORY',
      reason: 'O contexto arquitetural stateful-operation exige ao menos uma entidade de estado no inventário.',
    });
  }

  if (tags.has('time-dependent')) {
    const hasTemporalField = Array.from(allFieldNames).some((name) => (
      /time|timestamp|clock/iu.test(name)
    ));
    if (!hasTemporalField) {
      issues.push({
        slotId: 'inventory/fields/temporal',
        kind: 'MISSING_TEMPORAL_FIELD_INVENTORY',
        reason: 'O contexto arquitetural time-dependent exige ao menos um campo temporal (ex: timestamp) nas entidades de estado.',
      });
    }

    const hasTemporalGuard = operations.some((op) => (
      (op.guardPrecedence ?? []).some((g) => /time.*regression|monotonic|clock/iu.test(g))
      || (op.branches ?? []).some((b) => /time.*regression|clock/iu.test(b.branchId) || /time.*regression|clock/iu.test(b.statusOrError ?? ''))
    ));
    if (!hasTemporalGuard) {
      issues.push({
        slotId: 'inventory/operations/temporal_guard',
        kind: 'MISSING_TEMPORAL_GUARD_INVENTORY',
        reason: 'O contexto arquitetural time-dependent exige ao menos uma operação com verificação ou guard contra regressão de relógio.',
      });
    }
  }

  if (tags.has('bounded-observability')) {
    const hasBitmask = observables.some((obs) => obs.representation === 'UINT32_BITMASK' || (obs.bitAllocation?.length ?? 0) > 0);
    if (!hasBitmask) {
      issues.push({
        slotId: 'inventory/observables/bitmask',
        kind: 'MISSING_BOUNDED_OBSERVABILITY_INVENTORY',
        reason: 'O contexto arquitetural bounded-observability exige observable com representação de bitmask finita (UINT32_BITMASK).',
      });
    }
  }

  if (tags.has('integrity-hash')) {
    if (serializations.length === 0) {
      issues.push({
        slotId: 'inventory/canonicalSerializations',
        kind: 'MISSING_CANONICAL_SERIALIZATION_INVENTORY',
        reason: 'O contexto arquitetural integrity-hash exige ao menos uma especificação em canonicalSerializations.',
      });
    }
  }

  // 2. Fatos Literais de Bits (BIT_RANGE)
  const bitRangeFacts = (literalFacts ?? []).filter((f) => f.kind === 'BIT_RANGE' && f.attributes?.start !== undefined);
  if (bitRangeFacts.length > 0) {
    const bitmaskObs = observables.find((obs) => obs.representation === 'UINT32_BITMASK');
    if (!bitmaskObs || !Array.isArray(bitmaskObs.bitAllocation) || bitmaskObs.bitAllocation.length === 0) {
      issues.push({
        slotId: 'inventory/observables/bitmask_allocation',
        kind: 'MISSING_BITMASK_INVENTORY',
        reason: 'A demanda contém fatos literais definindo fatias de bits, mas nenhum observable UINT32_BITMASK com bitAllocation foi fornecido.',
      });
    } else {
      for (const fact of bitRangeFacts) {
        const fStart = fact.attributes.start;
        const fEnd = fact.attributes.end !== undefined ? fact.attributes.end : fStart;
        const isCovered = allAllocatedSlices.some((slice) => (
          slice.start <= fStart && slice.end >= fEnd
        ));
        if (!isCovered) {
          issues.push({
            slotId: `inventory/bitmask/slice/${fStart}..${fEnd}`,
            kind: 'UNMAPPED_LITERAL_BIT_RANGE',
            reason: `O fato literal '${fact.reference}' define intervalo de bits [${fStart}..${fEnd}], mas nenhuma fatia correspondente foi mapeada em bitAllocation.`,
          });
        }
      }
    }
  }

  // 3. Cobertura de Boundary Rules
  for (const rule of (boundaryRules ?? [])) {
    const subject = rule.subject ?? '';
    const matchesField = Array.from(allFieldKeys).some((key) => subject.includes(key))
      || Array.from(allFieldNames).some((name) => subject.includes(name));
    const matchesObservable = observables.some((obs) => subject.includes(obs.name))
      || allAllocatedSlices.some((slice) => (
        subject.includes(slice.sliceStr)
        || (slice.mapping && subject.includes(slice.mapping))
        || new RegExp(`(?:bits?\\s+)?${slice.start}\\s*(?:a|\\.\\.|-|to)\\s*${slice.end}\\b`, 'iu').test(subject)
      ));

    if (!matchesField && !matchesObservable) {
      issues.push({
        slotId: `inventory/boundary/${rule.id}`,
        kind: 'UNMAPPED_BOUNDARY_RULE',
        reason: `A regra de fronteira '${rule.id}' (${subject}) não possui entidade, campo de estado ou fatia de observable mapeada no inventário semântico.`,
      });
    }
  }

  // 4. Cobertura de Requisitos com Subject explícito
  for (const req of (requirements ?? [])) {
    if (req.subject && typeof req.subject === 'string') {
      const subject = req.subject;
      const matchesField = Array.from(allFieldKeys).some((key) => subject.includes(key))
        || Array.from(allFieldNames).some((name) => subject.includes(name));
      const matchesObservable = observables.some((obs) => subject.includes(obs.name));
      if (!matchesField && !matchesObservable) {
        issues.push({
          slotId: `inventory/requirement/${req.id}`,
          kind: 'UNMAPPED_REQUIREMENT_SUBJECT',
          reason: `O requisito '${req.id}' referencia o subject '${subject}', ausente nas entidades ou observáveis do inventário semântico.`,
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

      // 2. RESET: Contadores de janela/streak exigem reset; se allowed === true, exige trigger e resetValue
      const isStreakOrWindow = (field.type === 'INTEGER' && field.name.toLocaleLowerCase().includes('streak'))
        || field.name.toLocaleLowerCase().includes('batch');
      if (isStreakOrWindow && field.reset?.allowed === false) {
        issues.push({
          slotId: `state/${fieldKey}/reset`,
          kind: 'UNRESOLVED_RESET',
          reason: `O campo de contagem de janela/streak '${fieldKey}' não pode ser monotônico perpétuo; requer gatilho e valor de reset determinísticos.`,
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
      if (!entity.capacityPolicy
        || entity.capacityPolicy.maxEntries === undefined
        || entity.capacityPolicy.maxEntries === null
        || !entity.capacityPolicy.overflowPolicy) {
        issues.push({
          slotId: `entity/${entity.name}/capacityPolicy`,
          kind: 'UNRESOLVED_COLLECTION_CAPACITY',
          reason: `A entidade de coleção dinâmica '${entity.name}' não define capacityPolicy com maxEntries e overflowPolicy determinísticos.`,
        });
      }
    }
  }

  // 7. GUARD PRECEDENCE: Toda operação deve declarar ordem linear de guards
  for (const op of operations) {
    if (!Array.isArray(op.guardPrecedence) || op.guardPrecedence.length === 0) {
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
 * 2. Branches de rejeição de guarda não executam mutações de estado indevidas em saldo/tempo.
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

    if (Array.isArray(op.branches) && op.branches.length > 0) {
      // 1. Cada guarda em guardPrecedence deve ter branch de rejeição correspondente
      for (const guard of guardPrecedence) {
        const guardNorm = guard.toLowerCase().replace(/[^a-z0-9]/g, '');
        const hasRejectionBranch = op.branches.some((branch) => {
          if (branch.outcomeKind !== 'REJECTION') return false;
          const branchIdNorm = (branch.branchId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const statusNorm = (branch.statusOrError ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const condNorm = (branch.condition ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return branchIdNorm.includes(guardNorm)
            || statusNorm.includes(guardNorm)
            || condNorm.includes(guardNorm);
        });

        if (!hasRejectionBranch) {
          issues.push({
            slotId: `operation/${op.name}/guard/${guard}/rejection`,
            kind: 'MISSING_GUARD_REJECTION_BRANCH',
            reason: `A operação '${op.name}' define o guard '${guard}' em guardPrecedence, mas não possui branch de rejeição correspondente.`,
          });
        }
      }

      // 2. Curto-circuito: branches de rejeição de guarda não podem ter efeitos colaterais indevidos
      for (const branch of op.branches) {
        if (branch.outcomeKind === 'REJECTION') {
          const effects = Array.isArray(branch.stateEffects) ? branch.stateEffects : [];
          for (const eff of effects) {
            const isBalanceOrTime = eff.field.toLowerCase().includes('token')
              || eff.field.toLowerCase().includes('balance')
              || eff.field.toLowerCase().includes('credit')
              || eff.field.toLowerCase().includes('timestamp');
            if (isBalanceOrTime && (eff.effect === 'DECREMENT' || eff.effect === 'SET' || eff.effect === 'MUTATE_COLLECTION')) {
              issues.push({
                slotId: `operation/${op.name}/branch/${branch.branchId}/sideEffect/${eff.field}`,
                kind: 'GUARD_REJECTION_SIDE_EFFECT',
                reason: `O branch de rejeição '${branch.branchId}' da operação '${op.name}' executa mutação indevida no campo '${eff.field}'. Rejeições de guarda devem curto-circuitar sem efeitos colaterais em saldo/tempo.`,
              });
            }
          }
        }
      }

      // 3. Totality de next-state por branch
      for (const branch of op.branches) {
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
 * Testes de Mutação Semântica (Two Conforming Interpretations Gate).
 * 
 * Testa o contrato contra interpretações concorrentes plausíveis:
 * 1. ZERO vs CAPACITY: Campo de saldo/créditos sem valor explícito de inicialização.
 * 2. TRAILING vs MAXIMUM: Contador de recusas/erros sem gatilho determinístico de reset.
 * 3. FREEZE vs ACCRUE: Interação temporal entre reposição e quarentena/trava sem precedência ou com efeitos colaterais.
 */
export function runSemanticMutationTests({
  stateModel = null,
  specification = null,
} = {}) {
  const divergences = [];

  if (!stateModel || !Array.isArray(stateModel.entities)) {
    return {
      passed: true,
      divergences: [],
    };
  }

  // 1. MUTATION_ZERO_VS_CAPACITY
  for (const entity of stateModel.entities) {
    for (const field of entity.fields ?? []) {
      const fieldKey = `${entity.name}.${field.name}`;
      const isBalanceOrTokens = field.name.toLowerCase().includes('token')
        || field.name.toLowerCase().includes('balance')
        || field.name.toLowerCase().includes('credit')
        || field.name.toLowerCase().includes('quota');

      if (isBalanceOrTokens) {
        if (!field.initialization
          || field.initialization.kind === 'UNRESOLVED'
          || field.initialization.value === null
          || field.initialization.value === undefined) {
          divergences.push({
            mutationId: 'MUTATION_ZERO_VS_CAPACITY',
            slotId: `state/${fieldKey}/init`,
            interpretationA: 'ZERO: Crachá inicia com saldo zerado (0 créditos/tokens), exigindo recarga prévia.',
            interpretationB: 'CAPACITY: Crachá inicia com saldo cheio (capacidade máxima de créditos/tokens), disponível imediatamente.',
            divergenceReason: `O campo '${fieldKey}' não possui valor de inicialização determinado, autorizando duas interpretações conformes divergentes.`,
          });
        }
      }
    }
  }

  // 2. MUTATION_TRAILING_VS_MAXIMUM
  for (const entity of stateModel.entities) {
    for (const field of entity.fields ?? []) {
      const fieldKey = `${entity.name}.${field.name}`;
      const isStreakOrRejection = field.isCounter === true
        && (field.name.toLowerCase().includes('streak')
          || field.name.toLowerCase().includes('reject')
          || field.name.toLowerCase().includes('failure')
          || field.name.toLowerCase().includes('error'));

      if (isStreakOrRejection) {
        if (field.reset?.allowed !== true
          || !field.reset?.trigger
          || field.reset?.resetValue === null
          || field.reset?.resetValue === undefined) {
          divergences.push({
            mutationId: 'MUTATION_TRAILING_VS_MAXIMUM',
            slotId: `state/${fieldKey}/reset`,
            interpretationA: 'TRAILING: Contador representa recusas consecutivas imediatas e reseta para zero na próxima autorização com sucesso.',
            interpretationB: 'MAXIMUM: Contador acumula o pico histórico total de recusas sem resetar em sucessos subsequentes.',
            divergenceReason: `O campo de streak '${fieldKey}' não define reset permitido com gatilho e valor explícitos, permitindo interpretação de streak consecutivo vs acumulador vitalício.`,
          });
        }
      }
    }
  }

  // 3. MUTATION_FREEZE_VS_ACCRUE
  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];
  for (const op of operations) {
    const guards = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
    const hasQuarantineOrLock = guards.some((g) => g.toLowerCase().includes('quarantine') || g.toLowerCase().includes('lock'));
    const hasRefill = guards.some((g) => g.toLowerCase().includes('refill') || g.toLowerCase().includes('time'));

    if (hasQuarantineOrLock && hasRefill) {
      const quarantineIdx = guards.findIndex((g) => g.toLowerCase().includes('quarantine') || g.toLowerCase().includes('lock'));
      const refillIdx = guards.findIndex((g) => g.toLowerCase().includes('refill') || g.toLowerCase().includes('time'));

      if (Array.isArray(op.branches)) {
        const quarantineBranch = op.branches.find((b) => (
          b.outcomeKind === 'REJECTION' && (b.branchId?.toLowerCase().includes('quarantine') || b.statusOrError?.toLowerCase().includes('quarantine'))
        ));

        if (quarantineBranch) {
          const effects = Array.isArray(quarantineBranch.stateEffects) ? quarantineBranch.stateEffects : [];
          const touchesRefill = effects.some((e) => e.field.toLowerCase().includes('token') || e.field.toLowerCase().includes('timestamp'));
          if (touchesRefill && quarantineIdx < refillIdx) {
            divergences.push({
              mutationId: 'MUTATION_FREEZE_VS_ACCRUE',
              slotId: `operation/${op.name}/branch/${quarantineBranch.branchId}/temporalOrder`,
              interpretationA: 'FREEZE: Quarentena curto-circuita antes do refill; o tempo em quarentena não gera créditos.',
              interpretationB: 'ACCRUE: O branch de quarentena muta estado temporal/créditos, acumulando créditos mesmo sob quarentena ativa.',
              divergenceReason: `A guarda de quarentena precede o refill na precedência, mas o branch de quarentena muta saldo ou carimbo temporal.`,
            });
          }
        }
      }
    }
  }

  // 4. MUTATION_REMAINDER_LEAK
  if (specification && Array.isArray(specification.determinismReview?.dimensions)) {
    const hasTemporalRemainder = stateModel.entities.some((entity) => (
      (entity.fields ?? []).some((f) => f.name.toLowerCase().includes('remainder'))
    ));
    if (hasTemporalRemainder) {
      const remainderDim = specification.determinismReview.dimensions.find((d) => (
        d.kind === 'REMAINDER_DISTRIBUTION' || d.kind === 'ROUNDING'
      ));
      if (!remainderDim || remainderDim.status !== 'SPECIFIED') {
        divergences.push({
          mutationId: 'MUTATION_REMAINDER_LEAK',
          slotId: 'determinism/REMAINDER_DISTRIBUTION/temporalRemainder',
          interpretationA: 'TRUNCATE: Descarta frações temporais residuais em cada avaliação, causando perda cumulativa de créditos sob alta frequência.',
          interpretationB: 'CONSERVE: Conserva resíduos temporais fracionários no acumulador para o próximo tick sob ARCH-TEMPORAL-INVARIANCE.',
          divergenceReason: 'A dimensão REMAINDER_DISTRIBUTION não está SPECIFIED para o campo de resíduo temporal fracionário.',
        });
      }
    }
  }

  // 5. MUTATION_OVERFLOW_EQUIVOCATION
  for (const entity of stateModel.entities) {
    for (const field of entity.fields ?? []) {
      const fieldKey = `${entity.name}.${field.name}`;
      if (field.type === 'INTEGER' || field.isCounter === true) {
        if (!field.bounds?.boundaryBehavior) {
          divergences.push({
            mutationId: 'MUTATION_OVERFLOW_EQUIVOCATION',
            slotId: `state/${fieldKey}/boundaryBehavior`,
            interpretationA: 'SATURATE: Campo satura no valor máximo sem estourar nem gerar exceção.',
            interpretationB: 'ROLLOVER_MODULO: Campo sofre wrap aritmético silencioso ou lança exceção em tempo de execução.',
            divergenceReason: `O campo numérico '${fieldKey}' não define boundaryBehavior explícito em bounds.`,
          });
        }
      }
    }
  }

  // 6. MUTATION_DIGEST_ENCODING_EQUIVOCATION
  const serializations = Array.isArray(stateModel.canonicalSerializations) ? stateModel.canonicalSerializations : [];
  for (const cs of serializations) {
    const included = Array.isArray(cs.includedFields) ? cs.includedFields : [];
    const encodings = Array.isArray(cs.fieldEncodings) ? cs.fieldEncodings : [];
    const encodedMap = new Set(encodings.map((e) => e.field));
    for (const field of included) {
      if (!encodedMap.has(field)) {
        divergences.push({
          mutationId: 'MUTATION_DIGEST_ENCODING_EQUIVOCATION',
          slotId: `canonicalSerialization/${cs.target}/encoding/${field}`,
          interpretationA: 'BIG_ENDIAN_LENGTH_PREFIXED: Serialização uniforme com tamanho prefixado e inteiros em Big Endian.',
          interpretationB: 'RAW_STRING_OR_LITTLE_ENDIAN: Serialização em formato nativo de plataforma ou Little Endian.',
          divergenceReason: `O campo '${field}' na serialização '${cs.target}' não possui codificação binária/textual explícita.`,
        });
      }
    }
  }

  return {
    passed: divergences.length === 0,
    divergences,
  };
}

/**
 * Validador Mecânico de Consistência Cruzada (validateSemanticCrossConsistency).
 * 
 * Executa cross-check automático entre Requirement/AC ↔ Inventory ↔ Transition Table ↔ Observable Mapping:
 * 1. Mapeamento de Observáveis de Conjunto: Impede que fatias que representam contagens de conjunto
 *    (ex: crachás distintos em quarentena) sejam mapeadas para contadores locais de um único crachá (ex: insufficientStreak).
 * 2. Transições em Limiares de Regra: Se um requisito/AC exige transição de estado em limiar de streak
 *    (ex: 3 falhas consecutivas colocam em quarentena), impede que a matriz de transições declare
 *    PRESERVE incondicional na guarda sem tratar o evento de disparo.
 */
export function validateSemanticCrossConsistency({
  stateModel = null,
  requirements = [],
  literalFacts = [],
} = {}) {
  const issues = [];
  if (!stateModel) return { valid: true, issues: [] };

  const observables = Array.isArray(stateModel.observables) ? stateModel.observables : [];
  const operations = Array.isArray(stateModel.operations) ? stateModel.operations : [];

  // 1. Cross-check: Observable bit allocation vs Aggregation / Entity Field
  for (const obs of observables) {
    if (Array.isArray(obs.bitAllocation)) {
      for (const item of obs.bitAllocation) {
        const isDistinctCount = (typeof item.mapping === 'string' && /distinct|unique|diferentes|identidades/iu.test(item.mapping))
          || (literalFacts.some((f) => f.kind === 'BIT_RANGE'
            && (item.slice === `${f.attributes?.start}..${f.attributes?.end}` || item.slice === `${f.attributes?.start}`)
            && /crachás diferentes|distintos/iu.test(f.reference)));

        if (isDistinctCount) {
          if (item.field.toLowerCase().includes('streak') || item.field.toLowerCase().includes('local')) {
            issues.push({
              slotId: `observable/${obs.name}/slice/${item.slice}/inconsistentMapping`,
              kind: 'CROSS_INCONSISTENT_OBSERVABLE_MAPPING',
              reason: `A fatia '${item.slice}' do observável '${obs.name}' representa contagem de conjunto/distintos, mas foi mapeada para o contador de entidade local '${item.field}'. Deve referenciar uma agregação de conjunto em aggregations.`,
            });
          }
        }
      }
    }
  }

  // 2. Cross-check: Requisito de Limiar de Streak vs Matriz de Transições
  const hasStreakTriggerRequirement = requirements.some((req) => (
    /3\s*(?:foras|recusas|falhas)|quarentena/iu.test(req.statement)
    || req.acceptanceCases?.some((ac) => /3\s*(?:foras|recusas|falhas)|terceira recusa/iu.test(`${ac.given} ${ac.then}`))
  ));

  if (hasStreakTriggerRequirement) {
    for (const op of operations) {
      if (Array.isArray(op.branches)) {
        for (const branch of op.branches) {
          if (branch.outcomeKind === 'REJECTION') {
            const effects = Array.isArray(branch.stateEffects) ? branch.stateEffects : [];
            const streakEffect = effects.find((e) => /streak/iu.test(e.field) && e.effect === 'INCREMENT');
            const quarantineEffect = effects.find((e) => /quarantin/iu.test(e.field));

            if (streakEffect) {
              if (quarantineEffect && quarantineEffect.effect === 'PRESERVE' && !branch.branchId.includes('THRESHOLD_NOT_MET') && !branch.condition?.includes('<')) {
                const hasThresholdBranch = op.branches.some((b) => (
                  b.branchId !== branch.branchId
                  && /quarantine.*trigger|threshold|reaches_3|quarantine_active/iu.test(`${b.branchId} ${b.condition ?? ''}`)
                ));
                if (!hasThresholdBranch) {
                  issues.push({
                    slotId: `operation/${op.name}/branch/${branch.branchId}/unhandledStreakTrigger`,
                    kind: 'CROSS_INCONSISTENT_TRANSITION_TRIGGER',
                    reason: `O branch '${branch.branchId}' da operação '${op.name}' incrementa contador de recusas consecutivas mas preserva 'quarantined' incondicionalmente, sem tratar a transição de estado da 3ª recusa exigida no requisito.`,
                  });
                }
              }
            }
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
} = {}) {
  const issues = [];
  if (!stateModel) return { valid: true, issues: [] };

  const hasProvenanceContext = literalFacts.length > 0 || (
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

  const validFactNumbers = new Set(
    literalFacts
      .filter((f) => f.kind === 'NUMBER_LITERAL' || f.kind === 'BIT_RANGE' || f.kind === 'BIT_WIDTH')
      .flatMap((f) => {
        const nums = [];
        if (f.attributes?.value !== undefined) nums.push(String(f.attributes.value));
        if (f.attributes?.start !== undefined) nums.push(String(f.attributes.start));
        if (f.attributes?.end !== undefined) nums.push(String(f.attributes.end));
        if (f.attributes?.width !== undefined) nums.push(String(f.attributes.width));
        return nums;
      })
  );

  validFactNumbers.add('0');
  validFactNumbers.add('1');

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
            if (p.source === 'USER_INTENT' && !validFactNumbers.has(maxVal)) {
              issues.push({
                slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                reason: `O valor de capacidade '${maxVal}' cita USER_INTENT mas não corresponde a nenhum fato literal fornecido na demanda.`,
              });
            } else if (p.source === 'ARCHITECTURE_POLICY' && !validPolicyRuleIds.has(p.reference)) {
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
            if (valStr === 'capacity' || valStr === 'defaultCapacity' || valStr === '0') return;

            if (!provenance || !Array.isArray(provenance) || provenance.length === 0) {
              issues.push({
                slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/provenance`,
                kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                reason: `O limite ${boundKind} '${valStr}' do campo '${entity.name}.${field.name}' não possui provenance autorizada.`,
              });
            } else {
              for (const p of provenance) {
                if (p.source === 'USER_INTENT' && !validFactNumbers.has(valStr)) {
                  issues.push({
                    slotId: `state/${entity.name}.${field.name}/bounds/${boundKind}/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O limite ${boundKind} '${valStr}' do campo '${entity.name}.${field.name}' cita USER_INTENT mas não corresponde a nenhum fato literal fornecido.`,
                  });
                } else if (p.source === 'ARCHITECTURE_POLICY' && !validPolicyRuleIds.has(p.reference)) {
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
  architectureContexts = [],
} = {}) {
  const issues = [];
  if (!stateModel) return { valid: true, issues: [] };

  const tags = new Set(architectureContexts.map((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag)));
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

  if (tags.has('bounded-observability')) {
    const hasGlobalLockBoundary = boundaries.some((b) => /lock/iu.test(b.signalName));
    if (!hasGlobalLockBoundary) {
      issues.push({
        slotId: 'stateModel/producerConsumerBoundaries/globalLock',
        kind: 'MISSING_PRODUCER_CONSUMER_BOUNDARY',
        reason: 'O sinal globalLock projetado no Bit 0 e utilizado em guard de trava geral exige declaração explícita de Producer/Consumer Boundary.',
      });
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
 * Compila a totalidade do contrato semântico em métricas estritas:
 * Qualquer valor > 0 proíbe SEMANTICALLY_CLOSED.
 */
export function generateClosureCertificate({
  specification,
  humanResolutions = [],
} = {}) {
  const inventoryResult = validateSemanticInventoryCoverage({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
    boundaryRules: specification.boundaryRules ?? [],
    literalFacts: specification.intentEvidence?.literalFacts ?? specification.literalFacts ?? [],
    requirements: specification.requirements ?? [],
  });

  const witnessResult = validateDecisionsWitness({
    decisions: specification.decisions ?? [],
  });

  const stateLifecycle = validateFieldLifecycle({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
  });

  const mutationResult = runSemanticMutationTests({
    stateModel: specification.stateModel,
    specification,
  });

  const crossConsistency = validateSemanticCrossConsistency({
    stateModel: specification.stateModel,
    requirements: specification.requirements ?? [],
    literalFacts: specification.intentEvidence?.literalFacts ?? specification.literalFacts ?? [],
  });

  const provenanceResult = validateProvenanceEnforcement({
    stateModel: specification.stateModel,
    architecturePolicy: specification.policy,
    literalFacts: specification.intentEvidence?.literalFacts ?? specification.literalFacts ?? [],
  });

  const aggregationResult = validateAggregationAndBoundaries({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
  });

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
  ));

  const observableIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_OBSERVABLE_DEPENDENCY'
    || i.kind === 'UNRESOLVED_OBSERVABLE_REPRESENTATION'
    || i.kind === 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR'
    || i.kind === 'INVALID_BITMASK_ALLOCATION'
  ));

  const sideEffectIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'GUARD_REJECTION_SIDE_EFFECT'
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
  const unresolvedDeterminismDimensions = determinismGaps.length + determinismDecisions.length;
  const orphanHumanDecisions = pendingDecisions.length;
  const unresolvedStateFields = stateFieldIssues.length;
  const unresolvedTransitions = transitionIssues.length;
  const unresolvedObservables = observableIssues.length;
  const contradictoryRules = sideEffectIssues.length
    + mutationResult.divergences.length
    + crossConsistency.issues.length;
  const regressedSemanticDimensions = 0;

  const totalUnresolved = unresolvedInventorySlots
    + unresolvedStateFields
    + unresolvedObservables
    + unresolvedTransitions
    + unresolvedAuthorities
    + unresolvedDeterminismDimensions
    + contradictoryRules
    + orphanHumanDecisions
    + regressedSemanticDimensions;

  const mutationIssues = mutationResult.divergences.map((d) => ({
    slotId: d.slotId,
    kind: 'DIVERGENT_INTERPRETATION',
    reason: `${d.mutationId}: ${d.divergenceReason}`,
  }));

  const allIssues = [
    ...inventoryIssues,
    ...stateLifecycle.issues,
    ...crossConsistency.issues,
    ...provenanceResult.issues,
    ...mutationIssues,
    ...materialUnknownGaps.map((u) => ({ slotId: `unknown/${u.id}`, kind: 'MATERIAL_UNKNOWN_GAP', reason: u.statement })),
    ...determinismGaps.map((d) => ({ slotId: `determinism/${d.kind}/${d.subjectId}`, kind: 'DETERMINISM_GAP', reason: d.rationale })),
    ...pendingDecisions.map((q) => ({ slotId: `decision/${q.questionId}`, kind: 'PENDING_HUMAN_DECISION', reason: q.question })),
  ];

  const stateEntities = Array.isArray(specification.stateModel?.entities) ? specification.stateModel.entities : [];
  const stateOperations = Array.isArray(specification.stateModel?.operations) ? specification.stateModel.operations : [];
  const stateObservables = Array.isArray(specification.stateModel?.observables) ? specification.stateModel.observables : [];
  const stateSerializations = Array.isArray(specification.stateModel?.canonicalSerializations) ? specification.stateModel.canonicalSerializations : [];

  let materializedFieldsCount = 0;
  for (const entity of stateEntities) {
    materializedFieldsCount += Array.isArray(entity.fields) ? entity.fields.length : 0;
  }

  const tags = new Set((specification.architectureContexts ?? []).map((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag)));
  const isStateful = tags.has('stateful-operation');
  const isTimeDependent = tags.has('time-dependent');
  const isBoundedObs = tags.has('bounded-observability');
  const isIntegrityHash = tags.has('integrity-hash');

  const expectedEntitiesMin = isStateful ? 1 : 0;
  const expectedFieldsMin = isStateful ? (isTimeDependent ? 2 : 1) : 0;
  const expectedOperationsMin = isStateful ? 1 : 0;
  const expectedObservablesMin = isBoundedObs ? 1 : 0;
  const expectedSerializationsMin = isIntegrityHash ? 1 : 0;

  const aggregationsClosed = specification.stateModel?.aggregations?.length ?? 0;
  const boundariesClosed = specification.stateModel?.producerConsumerBoundaries?.length ?? 0;

  const inventoryAudit = {
    normativeClaimsCount: (specification.requirements ?? []).length + (specification.invariants ?? []).length,
    expectedStateEntities: Math.max(expectedEntitiesMin, stateEntities.length),
    materializedStateEntities: stateEntities.length,
    expectedFields: Math.max(expectedFieldsMin, materializedFieldsCount),
    materializedFields: materializedFieldsCount,
    closedFields: Math.max(0, materializedFieldsCount - stateFieldIssues.length),
    expectedOperations: Math.max(expectedOperationsMin, stateOperations.length),
    materializedOperations: stateOperations.length,
    totalizedOperations: Math.max(0, stateOperations.length - transitionIssues.length),
    expectedObservables: Math.max(expectedObservablesMin, stateObservables.length),
    materializedObservables: stateObservables.length,
    closedObservables: Math.max(0, stateObservables.length - observableIssues.length),
    canonicalProfilesRequired: Math.max(expectedSerializationsMin, stateSerializations.length),
    canonicalProfilesClosed: Math.max(0, stateSerializations.length - (tags.has('integrity-hash') && stateSerializations.length === 0 ? 1 : 0)),
    aggregationsClosed,
    boundariesClosed,
    divergenceWitnessesSurviving: mutationResult.divergences.length,
  };

  const gapLedger = allIssues.map((issue, idx) => classifyGapIssue(issue, idx));

  return {
    unresolvedInventorySlots,
    unresolvedStateFields,
    unresolvedObservables,
    unresolvedTransitions,
    unresolvedAuthorities,
    unresolvedDeterminismDimensions,
    contradictoryRules,
    orphanHumanDecisions,
    regressedSemanticDimensions,
    status: totalUnresolved === 0 ? 'CERTIFIED_CLOSED' : 'BLOCKED_BY_UNRESOLVED_SLOTS',
    inventoryAudit,
    gapLedger,
    unresolvedSlots: allIssues,
  };
}

export function classifyGapIssue(issue, index) {
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
    case 'GUARD_REJECTION_SIDE_EFFECT':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Ramo de rejeição causa mutação indevida de estado subsequente.';
      break;
    case 'UNHANDLED_TRIGGER_TRANSITION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;
    case 'DIVERGENT_INTERPRETATION':
      layer = 'TRANSITION_CONSISTENCY';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason;
      break;
    case 'NON_DIVERGENT_WITNESS':
    case 'INCOMPLETE_WITNESS_COVERAGE':
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
    case 'INCONSISTENT_OBSERVABLE_MAPPING':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;
    case 'UNRESOLVED_CANONICAL_SERIALIZATION':
    case 'MISSING_CANONICAL_SERIALIZATION_INVENTORY':
      layer = 'OBSERVABLE_DEPENDENCY_CLOSURE';
      requiredAuthority = 'USER_DECISION';
      witness = issue.reason || 'Perfil de serialização canônica ausente para demanda de integridade.';
      break;

    // 3. AUTHORITY_PROVENANCE
    case 'UNBACKED_FIELD_BOUNDS':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Limites numéricos de campo sem proveniência autorizada.';
      break;
    case 'UNBACKED_COLLECTION_CAPACITY':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason || 'Capacidade máxima de coleção sem proveniência autorizada.';
      break;
    case 'UNBACKED_AGGREGATION_SATURATION':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason || 'Limite de saturação de agregação sem proveniência autorizada.';
      break;
    case 'UNBACKED_NUMERIC_LITERAL':
    case 'UNAUTHORIZED_NUMERIC_LITERAL':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;
    case 'UNAUTHORIZED_PROVENANCE_SOURCE':
      layer = 'AUTHORITY_PROVENANCE';
      requiredAuthority = 'ARCHITECTURE_POLICY';
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
    case 'MISSING_TEMPORAL_FIELD_INVENTORY':
    case 'MISSING_TEMPORAL_GUARD_INVENTORY':
    case 'MISSING_BOUNDED_OBSERVABILITY_INVENTORY':
    case 'MISSING_AGGREGATION_MODEL':
    case 'MISSING_PRODUCER_CONSUMER_BOUNDARY_MODEL':
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

    case 'UNKNOWN_AGGREGATION_SOURCE':
    case 'ORPHAN_STATE_FIELD':
    case 'UNALLOCATED_LITERAL_BIT_RANGE':
    case 'UNMAPPED_BOUNDARY_RULE':
      layer = 'COVERAGE_ACCOUNTING';
      requiredAuthority = 'USER_INTENT';
      witness = issue.reason;
      break;

    case 'UNKNOWN_BOUNDARY_PRODUCER':
    case 'UNKNOWN_BOUNDARY_CONSUMER':
      layer = 'COVERAGE_ACCOUNTING';
      requiredAuthority = 'ARCHITECTURE_POLICY';
      witness = issue.reason;
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
