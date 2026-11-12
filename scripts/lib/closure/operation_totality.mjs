/**
 * Utilitário relacional genérico de integridade de referências.
 * Valida se referências de uma coleção existem no conjunto-alvo de chaves autorizadas.
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
 * Validador Mecânico de Totalidade de Operações e Branches (validateOperationTotality).
 *
 * Verifica que cada operação:
 * 1. Cada guarda em guardPrecedence possui branch de rejeição correspondente (se branches definidos).
 * 2. Cada branch cobre todos os campos de entidade (via stateEffects explícito ou defaultPreservation: true).
 * 3. Existe ao menos um branch de execução bem-sucedida (não-rejeição).
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
    const branchIds = (op.branches ?? []).map((branch) => branch.branchId);
    if (new Set(branchIds).size !== branchIds.length
      || new Set(guardPrecedence).size !== guardPrecedence.length) {
      issues.push({
        slotId: `operation/${op.name}/identities`,
        kind: 'CONFLICTING_STATE_DECLARATIONS',
        reason: `A operação '${op.name}' repete identificadores de branches ou guardas.`,
      });
    }

    if (Array.isArray(op.branches) && op.branches.length > 0) {
      const rejectionBranchIds = new Set(
        op.branches.filter((b) => b.outcomeKind === 'REJECTION').map((b) => b.branchId),
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

      for (const branch of op.branches) {
        const explicitFields = new Set();
        for (const effect of branch.stateEffects ?? []) {
          if (!allEntityFields.has(effect.field) || explicitFields.has(effect.field)) {
            issues.push({
              slotId: `operation/${op.name}/branch/${branch.branchId}/effect/${effect.field}`,
              kind: 'CONFLICTING_STATE_DECLARATIONS',
              reason: `O efeito referencia campo inexistente ou repetido: '${effect.field}'.`,
            });
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

      const hasSuccessBranch = op.branches.some((branch) => branch.outcomeKind !== 'REJECTION');
      if (!hasSuccessBranch) {
        issues.push({
          slotId: `operation/${op.name}/successBranch`,
          kind: 'MISSING_SUCCESS_BRANCH',
          reason: `A operação '${op.name}' define apenas branches de rejeição, sem nenhum branch de avanço normal de fluxo ou sucesso.`,
        });
      }

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
    (r.acceptanceCases ?? []).some((ac) => ac.outcomeKind === 'REJECTION'),
  );
  if (hasRejectionAC && operations.length > 0) {
    const hasAnyRejectionBranch = operations.some((op) =>
      (op.branches ?? []).some((b) => b.outcomeKind === 'REJECTION'),
    );
    if (!hasAnyRejectionBranch) {
      issues.push({
        slotId: 'operations/rejectionContradiction',
        kind: 'CONTRADICTORY_RULE_DETECTED',
        reason: 'Os critérios de aceitação (acceptanceCases) exigem desfecho de rejeição (REJECTION), mas nenhuma operação declara ramos de rejeição.',
      });
    }
  }

  const hasStateChangeAC = (requirements ?? []).some((r) =>
    (r.acceptanceCases ?? []).some((ac) => ac.outcomeKind === 'STATE_CHANGE' || ac.outcomeKind === 'SUCCESS'),
  );
  if (hasStateChangeAC && operations.length > 0) {
    const hasAnyMutatingBranch = operations.some((op) =>
      (op.branches ?? []).some((b) =>
        b.outcomeKind === 'STATE_CHANGE'
        && b.defaultPreservation !== true
        && Array.isArray(b.stateEffects)
        && b.stateEffects.some((e) => e.effect !== 'PRESERVE'),
      ),
    );
    const hasMutableFields = entities.some((e) => (e.fields ?? []).some((f) => !f.isReadOnly));
    if (hasMutableFields && !hasAnyMutatingBranch) {
      issues.push({
        slotId: 'operations/stateChangeContradiction',
        kind: 'CONTRADICTORY_RULE_DETECTED',
        reason: 'Os critérios de aceitação (acceptanceCases) exigem mudança de estado (STATE_CHANGE), mas nenhuma operação declara ramo de mutação efetivo.',
      });
    }
  }

  for (const op of operations) {
    for (const branch of (op.branches ?? [])) {
      if (branch.outcomeKind === 'STATE_CHANGE') {
        const effects = branch.stateEffects ?? [];
        const mutatingEffects = effects.filter((e) => e.effect !== 'PRESERVE');
        if (mutatingEffects.length === 0 && branch.defaultPreservation === true) {
          issues.push({
            slotId: `operation/${op.name}/branch/${branch.branchId}/contradiction`,
            kind: 'CONTRADICTORY_RULE_DETECTED',
            reason: `O branch '${branch.branchId}' da operação '${op.name}' declara outcomeKind 'STATE_CHANGE', mas possui defaultPreservation: true e nenhum efeito de mutação (stateEffects).`,
          });
        }
      }
    }
  }

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
 * Validador Mecânico de Fechamento de Expressões de Operações e Efeitos Externos.
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
    'math', 'number', 'string', 'boolean', 'object', 'array', 'date', 'json', 'console',
  ]);

  function isTermKnown(token, extraParams = null) {
    const tokenRoot = token.includes('.') ? token.split('.')[0] : token;
    if (['math', 'number', 'string', 'boolean', 'bigint', 'json'].includes(tokenRoot.toLowerCase())) {
      return true;
    }
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
    const functionCalls = new Set([...val.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(/g)].map((m) => m[1]));
    return val
      .replace(/['"][^'"]*['"]/g, ' ')
      .split(/[^a-zA-Z0-9_.]+/)
      .filter((t) => (
        t.length > 0
        && isNaN(Number(t))
        && !ignoredTokens.has(t.toLowerCase())
        && !ignoredTokens.has((t.split('.')[0] ?? '').toLowerCase())
        && !functionCalls.has(t)
        && !/^\d+n$/i.test(t)
      ));
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

  const hasExternalEffectContext = (architectureContexts ?? []).some((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag) === 'external-effect')
    || (pathReferences ?? []).some((p) => p.role === 'PUBLIC_SURFACE');
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

