import { addIssue, checkReferenceIntegrity } from './operation_totality.mjs';
import {
  CLOSED_KEY_NORMALIZATION_RULES,
  evaluateBatchWitnessError,
  normalizeKey,
} from './v7_rules.mjs';

function validateBitmaskAllocation(obs, entityFieldKeys, entityFieldsMap, issues) {
  const bitAllocation = Array.isArray(obs.bitAllocation) ? obs.bitAllocation : [];
  if (bitAllocation.length === 0) {
    addIssue(issues, `observable/${obs.name}/bitAllocation`, 'INVALID_BITMASK_ALLOCATION', `O observável em bitmask de 32 bits '${obs.name}' não define alocação explícita de fatias (bitAllocation).`);
    return;
  }
  const allocatedBits = new Set();
  for (const item of bitAllocation) {
    const match = /^(\d+)(?:\.\.(\d+))?$/u.exec(item.slice.trim());
    if (!match) {
      addIssue(issues, `observable/${obs.name}/bitAllocation/${item.slice}`, 'INVALID_BITMASK_ALLOCATION', `Fatia '${item.slice}' do observável '${obs.name}' possui formato inválido. Use 'start..end' ou 'bit'.`);
      continue;
    }
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    const expectedWidth = (end - start) + 1;
    if (item.bitWidth !== expectedWidth) {
      addIssue(issues, `observable/${obs.name}/bitAllocation/${item.slice}/width`, 'INVALID_BITMASK_ALLOCATION', `Fatia '${item.slice}' declara bitWidth ${item.bitWidth}, mas o intervalo representa ${expectedWidth} bit(s).`);
    }
    for (let b = start; b <= end; b += 1) {
      if (allocatedBits.has(b)) {
        addIssue(issues, `observable/${obs.name}/bitAllocation/overlap/${b}`, 'INVALID_BITMASK_ALLOCATION', `O bit ${b} do observável '${obs.name}' foi alocado em mais de uma fatia (sobreposição detectada).`);
      }
      allocatedBits.add(b);
    }
    checkReferenceIntegrity({
      items: [item.field],
      targetSet: entityFieldKeys,
      ignoredKeys: new Set(['RESERVED', '*']),
      onMissing: (f) => addIssue(issues, `observable/${obs.name}/bitAllocation/${item.slice}/field`, 'UNRESOLVED_OBSERVABLE_DEPENDENCY', `A fatia '${item.slice}' referencia o campo desconhecido '${f}'.`),
    });
    if (item.field === 'RESERVED' || item.field === '*') continue;
    const fieldObj = entityFieldsMap.get(item.field);
    if (!fieldObj) continue;
    if (fieldObj.type === 'BOOLEAN') {
      if (item.bitWidth !== 1) {
        addIssue(issues, `observable/${obs.name}/bitAllocation/${item.slice}/width`, 'INVALID_BITMASK_ALLOCATION', `A fatia '${item.slice}' aloca ${item.bitWidth} bit(s) para o campo booleano '${item.field}', mas booleanos exigem exatamente 1 bit.`);
      }
    } else if (fieldObj.type === 'INTEGER') {
      const upperBound = fieldObj.bounds?.upperBound ? Number(fieldObj.bounds.upperBound) : null;
      if (upperBound !== null && !Number.isNaN(upperBound) && upperBound > 0) {
        const minBits = Math.ceil(Math.log2(upperBound + 1));
        if (item.bitWidth < minBits && !item.mapping) {
          addIssue(issues, `observable/${obs.name}/bitAllocation/${item.slice}/capacity`, 'INVALID_BITMASK_ALLOCATION', `O campo inteiro '${item.field}' possui limite superior ${upperBound} (exigindo no mínimo ${minBits} bits), mas foi alocado em fatia de apenas ${item.bitWidth} bit(s) sem mapeamento explícito.`);
        }
      } else if (item.bitWidth === 1 && !item.mapping) {
        addIssue(issues, `observable/${obs.name}/bitAllocation/${item.slice}/capacity`, 'INVALID_BITMASK_ALLOCATION', `O campo inteiro '${item.field}' foi alocado em fatia de 1 bit sem mapeamento booleano explícito.`);
      }
    }
  }
}

export function validateObservable(obs, entityFieldKeys, entityFieldsMap, issues) {
  const derivedFrom = Array.isArray(obs.derivedFrom) ? obs.derivedFrom : [];
  if (derivedFrom.length === 0) {
    addIssue(issues, `observable/${obs.name}/derivedFrom`, 'UNRESOLVED_OBSERVABLE_DEPENDENCY', `O observável '${obs.name}' não declara os campos de estado dos quais é derivado.`);
  } else {
    checkReferenceIntegrity({
      items: derivedFrom,
      targetSet: entityFieldKeys,
      ignoredKeys: new Set(['*']),
      onMissing: (sourceField) => addIssue(issues, `observable/${obs.name}/dependency/${sourceField}`, 'UNRESOLVED_OBSERVABLE_DEPENDENCY', `O observável '${obs.name}' referencia o campo desconhecido '${sourceField}'.`),
    });
  }

  if (!obs.representation) {
    addIssue(issues, `observable/${obs.name}/representation`, 'UNRESOLVED_OBSERVABLE_REPRESENTATION', `O observável '${obs.name}' não define representation (ex: UINT32_BITMASK, ENUM, SCALAR, RECORD).`);
  }

  if (obs.emptyBehavior === undefined || obs.emptyBehavior === null) {
    addIssue(issues, `observable/${obs.name}/emptyBehavior`, 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR', `O observável '${obs.name}' não define emptyBehavior para estado vazio ou registro inexistente.`);
  }

  if (obs.representation === 'UINT32_BITMASK') {
    validateBitmaskAllocation(obs, entityFieldKeys, entityFieldsMap, issues);
  }
}

export function validateCanonicalSerializations(stateModel, entityFieldKeys, issues) {
  const serializations = Array.isArray(stateModel.canonicalSerializations)
    ? stateModel.canonicalSerializations
    : [];
  if (serializations.length === 0) {
    addIssue(issues, 'stateModel/canonicalSerializations', 'UNRESOLVED_CANONICAL_SERIALIZATION', 'A demanda envolve integridade de hash/digest (integrity-hash), mas o stateModel não define canonicalSerializations com a quádrupla canônica.');
    return;
  }
  for (const item of serializations) {
    if (!item.target || item.target.trim() === '') {
      addIssue(issues, 'stateModel/canonicalSerializations/target', 'UNRESOLVED_CANONICAL_SERIALIZATION', 'Item de serialização canônica não define target.');
    }
    const fields = Array.isArray(item.includedFields) ? item.includedFields : [];
    if (fields.length === 0) {
      addIssue(issues, `canonicalSerialization/${item.target}/includedFields`, 'UNRESOLVED_CANONICAL_SERIALIZATION', `A serialização canônica '${item.target}' não declara a lista nominal de campos incluídos.`);
    }
    const encodings = Array.isArray(item.fieldEncodings) ? item.fieldEncodings : [];
    const encodedFields = new Set(encodings.map((e) => e.field));
    checkReferenceIntegrity({
      items: fields,
      targetSet: encodedFields,
      onMissing: (f) => addIssue(issues, `canonicalSerialization/${item.target}/encoding/${f}`, 'UNRESOLVED_CANONICAL_SERIALIZATION', `O campo '${f}' na serialização canônica '${item.target}' não possui formato de encoding declarado em fieldEncodings.`),
    });
    if (!item.recordOrderingKey) {
      addIssue(issues, `canonicalSerialization/${item.target}/recordOrderingKey`, 'UNRESOLVED_CANONICAL_SERIALIZATION', `A serialização canônica '${item.target}' não define recordOrderingKey para ordenação canônica dos registros.`);
    } else {
      const orderKeyField = item.recordOrderingKey.trim().split(/\s+/)[0];
      const orderKeyFieldRaw = orderKeyField.includes('.') ? orderKeyField.split('.').pop() : orderKeyField;
      const isKnownOrderKey = fields.includes(orderKeyField)
        || fields.includes(orderKeyFieldRaw)
        || entityFieldKeys.has(orderKeyField)
        || entityFieldKeys.has(orderKeyFieldRaw);
      if (!isKnownOrderKey) {
        addIssue(issues, `canonicalSerialization/${item.target}/recordOrderingKey`, 'UNRESOLVED_CANONICAL_SERIALIZATION', `O campo de ordenação '${orderKeyField}' em recordOrderingKey não pertence aos campos incluídos nem a nenhuma entidade conhecida.`);
      }
      const targetEntity = (stateModel.entities ?? []).find((e) => e.name === item.target || item.target.startsWith(`${e.name}.`));
      const isIdentifierKey = /id$/i.test(orderKeyFieldRaw);
      if (targetEntity?.isCollection && !isIdentifierKey && !item.recordOrderingKey.includes(',')) {
        addIssue(issues, `canonicalSerialization/${item.target}/recordOrderingKey/tieBreaking`, 'UNRESOLVED_CANONICAL_SERIALIZATION', `A serialização canônica da coleção '${item.target}' utiliza ordenação simples por campo não-identificador ('${item.recordOrderingKey}'). Exige desempate composto (ex: 'campo ASC, sequencia ASC') para garantir ordenação estritamente total sem empates.`);
      }
    }
    if (!item.emptyStateDigest) {
      addIssue(issues, `canonicalSerialization/${item.target}/emptyStateDigest`, 'UNRESOLVED_CANONICAL_SERIALIZATION', `A serialização canônica '${item.target}' não define o valor canônico emptyStateDigest para o estado vazio da primitiva.`);
    }
  }
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

export function validateStandaloneKeyWitnesses(requirements, needsStringKeyWitness, issues) {
  const allAcceptanceCases = (requirements ?? []).flatMap((r) => r.acceptanceCases ?? []);
  const keyCases = allAcceptanceCases.filter((ac) => ac.keyComparisonWitness != null);
  if (needsStringKeyWitness && Array.isArray(requirements) && requirements.length > 0 && keyCases.length === 0) {
    addIssue(issues, 'acceptanceCases/keyComparisonWitness', 'INVALID_KEY_NORMALIZATION_OR_WITNESS', 'Chave textual usada em lookup/deduplicação/partição exige acceptanceCase com keyComparisonWitness estruturado.');
  }
  for (const ac of keyCases) {
    const w = ac.keyComparisonWitness;
    if (!CLOSED_KEY_NORMALIZATION_RULES.has(w.comparisonRule) || w.baselineKey === w.variationKey) {
      addIssue(issues, `acceptanceCase/${ac.id ?? 'case'}/keyComparisonWitness`, 'INVALID_KEY_NORMALIZATION_OR_WITNESS', `O keyComparisonWitness em '${ac.id ?? 'case'}' exige baselineKey !== variationKey e comparisonRule em enum fechado.`);
      continue;
    }
    const actualMatch = normalizeKey(w.baselineKey, w.comparisonRule) === normalizeKey(w.variationKey, w.comparisonRule)
      ? 'MATCH'
      : 'DISTINCT';
    if (w.expectedMatchResult !== actualMatch) {
      addIssue(issues, `acceptanceCase/${ac.id ?? 'case'}/keyComparisonWitness`, 'INVALID_KEY_NORMALIZATION_OR_WITNESS', `Contradição matemática em keyComparisonWitness: normalizeKey('${w.baselineKey}', '${w.comparisonRule}') vs '${w.variationKey}' produz '${actualMatch}', não '${w.expectedMatchResult}'.`);
    }
  }
}

export function validateStatusPartitionsAndWitnesses({ stateModel, requirements, issues }) {
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
        addIssue(issues, `state/${fieldKey}/statusPartition`, 'INCOMPLETE_STATUS_PARTITION', `O campo de status multi-valor '${fieldKey}' em coleção exige partição completa explícita de todos os valores em allowedValues (ausentes: ${missingValues.join(', ')}).`);
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
        addIssue(issues, `operation/${op.name}/partialFailurePolicy`, 'INCOMPLETE_BATCH_POLICY_OR_WITNESS', `A operação em lote '${op.name}' sob guarda/cota não declara partialFailurePolicy ('ALL_OR_NOTHING' | 'FAIL_FAST' | 'CONTINUE_ON_ERROR').`);
      }
      if (typeof op.consumptionOrder !== 'string' || op.consumptionOrder.trim().length === 0) {
        addIssue(issues, `operation/${op.name}/consumptionOrder`, 'INCOMPLETE_BATCH_POLICY_OR_WITNESS', `A operação em lote '${op.name}' não declara consumptionOrder explícito.`);
      }
      if (Array.isArray(requirements) && requirements.length > 0) {
        const opBranchRefs = new Set((op.branches ?? []).flatMap((b) => [b.branchId, `${op.name}.${b.branchId}`]));
        const batchCases = allAcceptanceCases.filter((ac) => (
          ac.batchWitness != null
          && (opBranchRefs.size === 0 || !ac.branchRef || opBranchRefs.has(ac.branchRef))
        ));
        if (batchCases.length === 0) {
          addIssue(issues, `operation/${op.name}/batchWitness`, 'INCOMPLETE_BATCH_POLICY_OR_WITNESS', `A operação em lote '${op.name}' exige ao menos um acceptanceCase com batchWitness estruturado.`);
        } else if (validPolicy) {
          for (const ac of batchCases) {
            const err = evaluateBatchWitnessError(op.partialFailurePolicy, ac.batchWitness);
            if (err) {
              addIssue(issues, `operation/${op.name}/batchWitness/${ac.id ?? 'case'}`, 'INCOMPLETE_BATCH_POLICY_OR_WITNESS', err);
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
          addIssue(issues, `acceptanceCase/${ac.id ?? 'case'}/batchWitness`, 'INCOMPLETE_BATCH_POLICY_OR_WITNESS', err);
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
            addIssue(issues, `state/${fieldKey}/crossOperationWitness`, 'MISSING_OR_INVALID_CROSS_OPERATION_WITNESS', `O campo compartilhado '${fieldKey}' é tocado por ${touchingOps.size} operações distintas e exige acceptanceCase com crossOperationWitness estruturado.`);
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
                addIssue(issues, `state/${fieldKey}/crossOperationWitness/${ac.id ?? 'case'}`, 'MISSING_OR_INVALID_CROSS_OPERATION_WITNESS', `O crossOperationWitness de '${fieldKey}' deve conter >= 2 operações distintas da sequência, branchRef válido, expectedOutcome não vazio e valores concretos compatíveis com o tipo ${field.type}.`);
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
          addIssue(issues, `state/${entity.name}.${field.name}/keyNormalizationPolicy`, 'INVALID_KEY_NORMALIZATION_OR_WITNESS', `A chave textual '${entity.name}.${field.name}' exige keyNormalizationPolicy em enum fechado.`);
        }
      }
    }
  }
  for (const op of operations) {
    for (const param of op.parameters ?? []) {
      if (param.type === 'STRING' && (param.usedInLookup === true || param.usedInDeduplication === true || param.usedInPartition === true)) {
        needsStringKeyWitness = true;
        if (!CLOSED_KEY_NORMALIZATION_RULES.has(op.keyNormalizationPolicy)) {
          addIssue(issues, `operation/${op.name}/parameter/${param.name}/keyNormalizationPolicy`, 'INVALID_KEY_NORMALIZATION_OR_WITNESS', `O parâmetro chave '${param.name}' na operação '${op.name}' exige op.keyNormalizationPolicy em enum fechado.`);
        }
      }
    }
  }

  validateStandaloneKeyWitnesses(requirements, needsStringKeyWitness, issues);
}
