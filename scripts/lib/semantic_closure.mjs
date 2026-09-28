
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
  const entityFieldKeys = new Set();

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
    }
  }

  // 5. GUARD PRECEDENCE: Toda operação deve declarar ordem linear de guards
  for (const op of operations) {
    if (!Array.isArray(op.guardPrecedence) || op.guardPrecedence.length === 0) {
      issues.push({
        slotId: `operation/${op.name}/guardPrecedence`,
        kind: 'UNRESOLVED_GUARD_PRECEDENCE',
        reason: `A operação '${op.name}' não define a ordem linear estrita de precedência de guards (GUARD_PRECEDENCE).`,
      });
    }
  }

  // 6. OBSERVABLES: Todo observável deve declarar campos de origem válidos
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
  }

  // 7. OPERATION TOTALITY: Totalidade de branches e guards
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

  return {
    passed: divergences.length === 0,
    divergences,
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
  const stateLifecycle = validateFieldLifecycle({
    stateModel: specification.stateModel,
    architectureContexts: specification.architectureContexts ?? [],
  });

  const mutationResult = runSemanticMutationTests({
    stateModel: specification.stateModel,
    specification,
  });

  const stateFieldIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_STATE_MODEL'
    || i.kind === 'UNRESOLVED_INITIALIZATION'
    || i.kind === 'UNRESOLVED_RESET'
    || i.kind === 'ORPHAN_STATE_FIELD'
  ));

  const transitionIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_TRANSITION'
    || i.kind === 'UNRESOLVED_GUARD_PRECEDENCE'
    || i.kind === 'MISSING_GUARD_REJECTION_BRANCH'
    || i.kind === 'UNDETERMINED_BRANCH_NEXT_STATE'
    || i.kind === 'MISSING_SUCCESS_BRANCH'
  ));

  const observableIssues = stateLifecycle.issues.filter((i) => (
    i.kind === 'UNRESOLVED_OBSERVABLE_DEPENDENCY'
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

  const unresolvedAuthorities = materialUnknownGaps.length;
  const unresolvedDeterminismDimensions = determinismGaps.length + determinismDecisions.length;
  const orphanHumanDecisions = pendingDecisions.length;
  const unresolvedStateFields = stateFieldIssues.length;
  const unresolvedTransitions = transitionIssues.length;
  const unresolvedObservables = observableIssues.length;
  const contradictoryRules = sideEffectIssues.length + mutationResult.divergences.length;
  const regressedSemanticDimensions = 0;

  const totalUnresolved = unresolvedStateFields
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
    ...stateLifecycle.issues,
    ...mutationIssues,
    ...materialUnknownGaps.map((u) => ({ slotId: `unknown/${u.id}`, kind: 'MATERIAL_UNKNOWN_GAP', reason: u.statement })),
    ...determinismGaps.map((d) => ({ slotId: `determinism/${d.kind}/${d.subjectId}`, kind: 'DETERMINISM_GAP', reason: d.rationale })),
    ...pendingDecisions.map((q) => ({ slotId: `decision/${q.questionId}`, kind: 'PENDING_HUMAN_DECISION', reason: q.question })),
  ];

  return {
    unresolvedStateFields,
    unresolvedObservables,
    unresolvedTransitions,
    unresolvedAuthorities,
    unresolvedDeterminismDimensions,
    contradictoryRules,
    orphanHumanDecisions,
    regressedSemanticDimensions,
    status: totalUnresolved === 0 ? 'CERTIFIED_CLOSED' : 'BLOCKED_BY_UNRESOLVED_SLOTS',
    unresolvedSlots: allIssues,
  };
}
