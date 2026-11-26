import { LOGICAL_EXTERNAL_ACTIONS, isCompletePayloadDescriptor } from './v7_rules.mjs';

export function addIssue(issues, slotId, kind, reason) {
  issues.push({ slotId, kind, reason });
}

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

function branchMatchesOutcome(branch, outcome) {
  if (!branch || typeof branch.branchId !== 'string') return false;
  if (branch.externalOutcome === outcome || branch.statusOrError === outcome) return true;
  const bUp = branch.branchId.toUpperCase();
  const oUp = String(outcome).toUpperCase();
  if (bUp === oUp) return true;
  const negatedPrefix = /^(?:NOT|NO|NON)[_:-]/u;
  if (negatedPrefix.test(bUp) && !negatedPrefix.test(oUp)) return false;
  return bUp.endsWith(`_${oUp}`)
    || bUp.endsWith(`:${oUp}`)
    || bUp.endsWith(`-${oUp}`);
}

function validateLogicalExternalEffect({
  eff,
  op,
  slotPrefix,
  workspaceSkeleton,
  unknowns,
  decisions,
  payloadSchemas,
  issues,
}) {
  if (typeof eff.executionOrder !== 'string' || eff.executionOrder.trim().length === 0) {
    issues.push({
      slotId: `${slotPrefix}/executionOrder`,
      kind: 'INCOMPLETE_EXTERNAL_EFFECT',
      reason: `O efeito lógico '${eff.action}' na operação '${op.name}' não declara executionOrder explícito relativo ao estado local.`,
    });
  }
  const possibleOutcomes = Array.isArray(eff.possibleOutcomes) ? eff.possibleOutcomes : null;
  if (!possibleOutcomes || possibleOutcomes.length === 0 || new Set(possibleOutcomes).size !== possibleOutcomes.length) {
    issues.push({
      slotId: `${slotPrefix}/possibleOutcomes`,
      kind: 'INCOMPLETE_EXTERNAL_EFFECT',
      reason: `O efeito lógico '${eff.action}' na operação '${op.name}' deve declarar possibleOutcomes fechado e sem duplicatas.`,
    });
  } else {
    const usedBranchIds = new Set();
    for (const outcome of possibleOutcomes) {
      const matched = (op.branches ?? []).find((b) => !usedBranchIds.has(b.branchId) && branchMatchesOutcome(b, outcome));
      if (!matched) {
        issues.push({
          slotId: `${slotPrefix}/outcomeBranch/${outcome}`,
          kind: 'INCOMPLETE_EXTERNAL_EFFECT',
          reason: `O resultado '${outcome}' de '${eff.action}' na operação '${op.name}' não possui ramo 1-para-1 correspondente em branches (defina statusOrError: '${outcome}' ou branchId compatível).`,
        });
      } else {
        usedBranchIds.add(matched.branchId);
      }
    }
  }

  let hasSrcAdapter = false;
  if (workspaceSkeleton && (Array.isArray(workspaceSkeleton.files) || Array.isArray(workspaceSkeleton.symbols))) {
    const srcFiles = (workspaceSkeleton.files ?? []).filter((f) => typeof f === 'string' && f.startsWith('src/'));
    const srcSymbols = (workspaceSkeleton.symbols ?? []).filter((s) => typeof s.path === 'string' && s.path.startsWith('src/'));
    hasSrcAdapter = srcFiles.some((f) => (eff.targetPath && f === eff.targetPath) || (eff.targetSurface && f.includes(eff.targetSurface)))
      || srcSymbols.some((s) => s.name === op.name || (eff.targetPath && s.path === eff.targetPath) || (eff.targetSurface && s.path.includes(eff.targetSurface)));
  }

  const isAbstractBoundary = eff.externalInterfaceStatus === 'UNBOUND_ABSTRACT_BOUNDARY';
  if (isAbstractBoundary && hasSrcAdapter) {
    issues.push({
      slotId: `${slotPrefix}/externalInterfaceStatus`,
      kind: 'INCOMPLETE_EXTERNAL_EFFECT',
      reason: `A operação '${op.name}' declara UNBOUND_ABSTRACT_BOUNDARY para '${eff.action}', mas já existe adaptador correspondente em src/.`,
    });
  }

  if (!isAbstractBoundary) {
    const reqPayload = eff.requestPayload;
    const reqValid = Array.isArray(reqPayload)
      ? reqPayload.every((d) => isCompletePayloadDescriptor(d, payloadSchemas))
      : (reqPayload && typeof reqPayload === 'object' && typeof reqPayload.schemaRef === 'string'
        ? isCompletePayloadDescriptor(reqPayload, payloadSchemas)
        : false);
    if (!reqValid) {
      issues.push({
        slotId: `${slotPrefix}/requestPayload`,
        kind: 'INCOMPLETE_EXTERNAL_EFFECT',
        reason: `O efeito lógico '${eff.action}' na operação '${op.name}' possui requestPayload ausente ou incompleto (exige { field, type, required, nullable, constraints } ou schemaRef).`,
      });
    }

    const rawOut = eff.outcomePayloads;
    const outcomeMap = new Map();
    let outStructValid = true;
    if (Array.isArray(rawOut)) {
      for (const entry of rawOut) {
        if (!entry || typeof entry.outcome !== 'string' || !entry.outcome.trim() || outcomeMap.has(entry.outcome)) {
          outStructValid = false;
          break;
        }
        const entryOk = typeof entry.schemaRef === 'string' && entry.schemaRef.trim().length > 0
          ? isCompletePayloadDescriptor({ schemaRef: entry.schemaRef }, payloadSchemas)
          : (Array.isArray(entry.fields) && entry.fields.every((d) => isCompletePayloadDescriptor(d, payloadSchemas)));
        if (!entryOk) {
          outStructValid = false;
          break;
        }
        outcomeMap.set(entry.outcome, entry);
      }
    } else if (rawOut && typeof rawOut === 'object') {
      for (const [outcome, val] of Object.entries(rawOut)) {
        const entryOk = Array.isArray(val)
          ? val.every((d) => isCompletePayloadDescriptor(d, payloadSchemas))
          : isCompletePayloadDescriptor(val, payloadSchemas);
        if (!entryOk) {
          outStructValid = false;
          break;
        }
        outcomeMap.set(outcome, val);
      }
    } else {
      outStructValid = false;
    }

    if (!outStructValid
      || (possibleOutcomes && (!possibleOutcomes.every((o) => outcomeMap.has(o)) || outcomeMap.size !== possibleOutcomes.length))) {
      addIssue(issues, `${slotPrefix}/outcomePayloads`, 'INCOMPLETE_EXTERNAL_EFFECT', `O efeito lógico '${eff.action}' na operação '${op.name}' exige outcomePayloads completo mapeado 1-para-1 a possibleOutcomes.`);
    }
  }

  if (workspaceSkeleton && !hasSrcAdapter && (unknowns?.length ?? 0) === 0 && (decisions?.length ?? 0) === 0) {
    addIssue(issues, `${slotPrefix}/missingSrcAdapter`, 'INCOMPLETE_EXTERNAL_EFFECT', `Nenhum adaptador correspondente em src/ foi encontrado em workspaceSkeleton para '${eff.action}' (${op.name}), exigindo registro explícito em unknowns ou decisão de fronteira.`);
  }
}

/**
 * Validador Mecânico de Totalidade de Operações e Branches (validateOperationTotality).
 *
 * Verifica que cada operação:
 * 1. Cada guarda em guardPrecedence possui branch de rejeição correspondente (se branches definidos).
 * 2. Cada branch cobre todos os campos de entidade (via stateEffects explícito ou defaultPreservation: true).
 * 3. Existe ao menos um branch de execução bem-sucedida (não-rejeição).
 * 4. REQ-0005: evaluatedInputs, additionalPropertiesPolicy (somente entradas OBJECT) e branchRef.
 * 5. REQ-0003: externalEffects lógicos completos (executionOrder, possibleOutcomes, requestPayload, outcomePayloads).
 */
export function validateOperationTotality({
  stateModel = null,
  requirements = null,
  unknowns = [],
  decisions = [],
  workspaceSkeleton = null,
  payloadSchemas = null,
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
        addIssue(issues, `operation/${op.name}/returnContract`, 'UNRESOLVED_RETURN_CONTRACT', `A operação '${op.name}' declara returnContract incompleto (exige successType e errorProtocol).`);
      }
    }

    const guardPrecedence = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
    const branchIds = (op.branches ?? []).map((branch) => branch.branchId);
    if (new Set(branchIds).size !== branchIds.length
      || new Set(guardPrecedence).size !== guardPrecedence.length) {
      addIssue(issues, `operation/${op.name}/identities`, 'CONFLICTING_STATE_DECLARATIONS', `A operação '${op.name}' repete identificadores de branches ou guardas.`);
    }

    if (Array.isArray(op.branches) && op.branches.length > 0) {
      const rejectionBranchIds = new Set(
        op.branches.filter((b) => b.outcomeKind === 'REJECTION').map((b) => b.branchId),
      );
      checkReferenceIntegrity({
        items: guardPrecedence,
        targetSet: rejectionBranchIds,
        onMissing: (guard) => addIssue(issues, `operation/${op.name}/guard/${guard}/rejection`, 'MISSING_GUARD_REJECTION_BRANCH', `A operação '${op.name}' define o guard '${guard}' em guardPrecedence, mas não possui branch de rejeição correspondente.`),
      });

      for (const branch of op.branches) {
        const explicitFields = new Set();
        for (const effect of branch.stateEffects ?? []) {
          if (!allEntityFields.has(effect.field) || explicitFields.has(effect.field)) {
            addIssue(issues, `operation/${op.name}/branch/${branch.branchId}/effect/${effect.field}`, 'CONFLICTING_STATE_DECLARATIONS', `O efeito referencia campo inexistente ou repetido: '${effect.field}'.`);
          }
          explicitFields.add(effect.field);
        }
        if (branch.defaultPreservation !== true) {
          const effects = Array.isArray(branch.stateEffects) ? branch.stateEffects : [];
          const coveredFields = new Set(effects.map((e) => e.field));

          checkReferenceIntegrity({
            items: allEntityFields,
            targetSet: coveredFields,
            onMissing: (fieldKey) => addIssue(issues, `operation/${op.name}/branch/${branch.branchId}/missingField/${fieldKey}`, 'UNDETERMINED_BRANCH_NEXT_STATE', `O branch '${branch.branchId}' da operação '${op.name}' não determina o próximo estado para o campo '${fieldKey}' (ausente em stateEffects sem defaultPreservation: true).`),
          });
        }
      }

      const hasSuccessBranch = op.branches.some((branch) => branch.outcomeKind !== 'REJECTION');
      if (!hasSuccessBranch) {
        addIssue(issues, `operation/${op.name}/successBranch`, 'MISSING_SUCCESS_BRANCH', `A operação '${op.name}' define apenas branches de rejeição, sem nenhum branch de avanço normal de fluxo ou sucesso.`);
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
              addIssue(issues, `operation/${op.name}/mutationCoverage/${fieldKey}/${m.condition}`, 'UNRESOLVED_TRANSITION', `O campo '${fieldKey}' declara mutação na operação '${op.name}' sob condição '${m.condition}', mas nenhum branch da operação especifica stateEffects nem branchId correspondente.`);
            }
          }
        }
      }
    }

    for (const param of (op.parameters ?? [])) {
      if ((param.type === 'INTEGER' || param.type === 'NUMBER') && !param.bounds && !param.domain) {
        addIssue(issues, `operation/${op.name}/parameter/${param.name}/domain`, 'UNRESOLVED_FIELD_BOUNDS', `O parâmetro '${param.name}' da operação '${op.name}' é do tipo ${param.type} mas não define limites nem domínio numérico fechado (bounds).`);
      }
    }

    const params = op.parameters ?? [];
    if (!Array.isArray(op.evaluatedInputs)) {
      addIssue(issues, `operation/${op.name}/evaluatedInputs`, 'MISSING_EVALUATED_INPUTS', `A operação '${op.name}' deve declarar explicitamente evaluatedInputs (array com entradas avaliadas).`);
    } else {
      const evaluatedSet = new Set(op.evaluatedInputs);
      for (const param of params) {
        if (!evaluatedSet.has(param.name)) {
          addIssue(issues, `operation/${op.name}/evaluatedInputs/${param.name}`, 'MISSING_EVALUATED_INPUTS', `O parâmetro '${param.name}' da operação '${op.name}' não consta em evaluatedInputs.`);
        }
      }
    }

    const hasObjectParam = params.some((p) => /^(?:OBJECT|RECORD|STRUCT|MAP)\b/i.test(String(p.type ?? '')));
    if (hasObjectParam && op.additionalPropertiesPolicy !== 'REJECT_UNKNOWN' && op.additionalPropertiesPolicy !== 'IGNORE_UNKNOWN') {
      issues.push({
        slotId: `operation/${op.name}/additionalPropertiesPolicy`,
        kind: 'MISSING_ADDITIONAL_PROPERTIES_POLICY',
        reason: `A operação '${op.name}' recebe parâmetro OBJECT e deve declarar additionalPropertiesPolicy ('REJECT_UNKNOWN' | 'IGNORE_UNKNOWN').`,
      });
    }

    for (const branch of (op.branches ?? [])) {
      for (const eff of (branch.externalEffects ?? [])) {
        if (LOGICAL_EXTERNAL_ACTIONS.has(eff.action)) {
          const target = eff.targetPath || eff.targetSurface || op.name;
          validateLogicalExternalEffect({
            eff,
            op,
            slotPrefix: `operations/${op.name}/branches/${branch.branchId}/externalEffects/${target}`,
            workspaceSkeleton,
            unknowns,
            decisions,
            payloadSchemas,
            issues,
          });
        }
      }
    }
  }

  if (Array.isArray(requirements) && requirements.length > 0) {
    const allAcceptanceCases = requirements.flatMap((r) => r.acceptanceCases ?? []);
    const allBranchKeys = new Set();
    for (const op of stateModel.operations) {
      for (const branch of (op.branches ?? [])) {
        const directKey = branch.branchId;
        const qualifiedKey = `${op.name}.${branch.branchId}`;
        allBranchKeys.add(directKey);
        allBranchKeys.add(qualifiedKey);
        const hasCaseRef = allAcceptanceCases.some((ac) => (
          ac.branchRef === directKey || ac.branchRef === qualifiedKey
        ));
        if (!hasCaseRef) {
          addIssue(issues, `operation/${op.name}/branch/${branch.branchId}/branchRef`, 'MISSING_BRANCH_ACCEPTANCE_REF', `O branch '${branch.branchId}' da operação '${op.name}' não possui acceptanceCase ligado via branchRef.`);
        }
      }
    }
    for (const ac of allAcceptanceCases) {
      if (ac.branchRef != null && !allBranchKeys.has(ac.branchRef)) {
        addIssue(issues, `acceptanceCase/${ac.id ?? 'unnamed'}/branchRef`, 'MISSING_BRANCH_ACCEPTANCE_REF', `O acceptanceCase '${ac.id ?? ''}' referencia branchRef inexistente '${ac.branchRef}'.`);
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
                  addIssue(issues, `operation/${op.name}/returnContract`, 'UNRESOLVED_RETURN_CONTRACT', `A operação '${op.name}' declara returnContract incompleto (exige successType e errorProtocol).`);
                }
              }

              const guardPrecedence = Array.isArray(op.guardPrecedence) ? op.guardPrecedence : [];
              if (guardPrecedence.length === 0) {
                const invIds = protectingInvariants.map((inv) => inv.id).join(', ');
                addIssue(issues, `operation/${op.name}/contradiction/${fieldKey}`, 'CONTRADICTORY_RULE_DETECTED', `A operação '${op.name}' executa DECREMENT no campo protegido '${fieldKey}' sem nenhum guard de verificação de saldo/limite, contradizendo o invariante (${invIds}).`);
              } else {
                const rejectionBranches = branches.filter((b) => b.outcomeKind === 'REJECTION');
                if (rejectionBranches.length === 0) {
                  const invIds = protectingInvariants.map((inv) => inv.id).join(', ');
                  addIssue(issues, `operation/${op.name}/contradiction/${fieldKey}`, 'CONTRADICTORY_RULE_DETECTED', `A operação '${op.name}' executa DECREMENT no campo protegido '${fieldKey}' mas não define nenhum branch de rejeição para impedir violação do invariante (${invIds}).`);
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
      addIssue(issues, 'operations/rejectionContradiction', 'CONTRADICTORY_RULE_DETECTED', 'Os critérios de aceitação (acceptanceCases) exigem desfecho de rejeição (REJECTION), mas nenhuma operação declara ramos de rejeição.');
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
      addIssue(issues, 'operations/stateChangeContradiction', 'CONTRADICTORY_RULE_DETECTED', 'Os critérios de aceitação (acceptanceCases) exigem mudança de estado (STATE_CHANGE), mas nenhuma operação declara ramo de mutação efetivo.');
    }
  }

  for (const op of operations) {
    for (const branch of (op.branches ?? [])) {
      if (branch.outcomeKind === 'STATE_CHANGE') {
        const effects = branch.stateEffects ?? [];
        const mutatingEffects = effects.filter((e) => e.effect !== 'PRESERVE');
        if (mutatingEffects.length === 0 && branch.defaultPreservation === true) {
          addIssue(issues, `operation/${op.name}/branch/${branch.branchId}/contradiction`, 'CONTRADICTORY_RULE_DETECTED', `O branch '${branch.branchId}' da operação '${op.name}' declara outcomeKind 'STATE_CHANGE', mas possui defaultPreservation: true e nenhum efeito de mutação (stateEffects).`);
        }
      }
    }
  }

  for (const entity of entities) {
    if (entity.isCollection && entity.admissionPolicy === 'ON_FIRST_REQUEST') {
      for (const obs of stateModel.observables ?? []) {
        if (typeof obs.emptyBehavior === 'string' && /reject.*(?:unregistered|empty|unknown)/iu.test(obs.emptyBehavior)) {
          addIssue(issues, `observable/${obs.name}/admissionContradiction`, 'CONTRADICTORY_RULE_DETECTED', `A entidade '${entity.name}' possui admissionPolicy 'ON_FIRST_REQUEST' (criação automática), mas o observável '${obs.name}' declara emptyBehavior de rejeição ('${obs.emptyBehavior}'). Essa contradição interna impede fechamento determinístico.`);
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
            addIssue(issues, `observable/${obs.name}/bitmaskEmptyDigestContradiction`, 'CONTRADICTORY_RULE_DETECTED', `O observável bitmask '${obs.name}' declara emptyBehavior = '0', mas a fatia '${item.slice}' codifica digest canônico com emptyStateDigest '${canon.emptyStateDigest}' (não-nulo). Declarar zero na coleção vazia contradiz a quádrupla canônica.`);
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
  const allowedFieldValues = new Set();
  for (const entity of (stateModel.entities ?? [])) {
    for (const field of (entity.fields ?? [])) {
      entityFields.add(`${entity.name}.${field.name}`);
      rawFieldNames.add(field.name);
      for (const allowedVal of (field.allowedValues ?? [])) {
        if (typeof allowedVal === 'string' && allowedVal.trim()) allowedFieldValues.add(allowedVal.trim());
      }
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
      || allowedFieldValues.has(token)
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

  const isPhysicalPublicSurface = (p) => (
    p.role === 'PERSISTENT_STORAGE'
    || (p.role === 'PUBLIC_SURFACE' && !/^src\/.+\.(?:[mc]?[jt]sx?|py|go|rs|java|rb)$/iu.test(String(p.path ?? '')))
  );
  const hasExplicitExternalTag = (architectureContexts ?? []).some((ctx) => (typeof ctx === 'string' ? ctx : ctx.tag) === 'external-effect');
  const hasExternalEffectContext = hasExplicitExternalTag
    || (pathReferences ?? []).some(isPhysicalPublicSurface);
  if (hasExternalEffectContext) {
    const publicSurfaces = (Array.isArray(pathReferences) ? pathReferences : []).filter((p) => (
      p.role === 'PERSISTENT_STORAGE'
      || (p.role === 'PUBLIC_SURFACE' && (hasExplicitExternalTag || isPhysicalPublicSurface(p)))
    ));
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
          if (LOGICAL_EXTERNAL_ACTIONS.has(eff.action)) continue;
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

