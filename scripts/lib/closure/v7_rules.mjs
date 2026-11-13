export const CLOSED_QUOTIENT_POLICIES = new Set([
  'TRUNC_ZERO',
  'FLOOR',
  'CEIL',
  'EXACT_DIVISIBLE_OR_REJECT',
]);

export const CLOSED_REMAINDER_POLICIES = new Set([
  'DISCARD',
  'CARRY',
  'ALLOCATE_FIRST_ITEM',
  'ALLOCATE_LAST_ITEM',
  'REJECT_NONZERO_REMAINDER',
]);

export const CLOSED_KEY_NORMALIZATION_RULES = new Set([
  'EXACT_CASE_SENSITIVE_NO_TRIM',
  'TRIM_ONLY',
  'CASE_INSENSITIVE_NO_TRIM',
  'TRIM_AND_CASE_INSENSITIVE',
]);

export const LOGICAL_EXTERNAL_ACTIONS = new Set([
  'EXTERNAL_OPERATION',
  'COMPENSATION_OPERATION',
]);

const STANDARD_NUMERIC_CONSTANTS = new Set([
  'null', 'none', 'unbounded', 'infinity', '-infinity', '+infinity',
  'max_safe_integer', 'min_safe_integer', 'number.max_safe_integer', 'number.min_safe_integer',
  'int_max', 'int_min', 'int32_max', 'int32_min', 'int64_max', 'int64_min',
  'uint32_max', 'uint64_max', 'bigint', 'integer', 'int', 'number', 'safe_integer',
]);

const SYMBOLIC_PROVENANCE_SOURCES = new Set([
  'USER_INTENT',
  'WORKSPACE_EVIDENCE',
  'USER_DECISION',
]);

/**
 * Pure key normalization function required by REQ-0008.
 */
export function normalizeKey(key, rule) {
  if (typeof key !== 'string') return '';
  switch (rule) {
    case 'EXACT_CASE_SENSITIVE_NO_TRIM':
      return key;
    case 'TRIM_ONLY':
      return key.trim();
    case 'CASE_INSENSITIVE_NO_TRIM':
      return key.toLowerCase();
    case 'TRIM_AND_CASE_INSENSITIVE':
      return key.trim().toLowerCase();
    default:
      throw new Error(`invalid_key_normalization_rule:${rule}`);
  }
}

/**
 * Computes expected determinismReview.status (REQ-0009 keeps arithmetic active without stateModel).
 */
export function computeDeterminismReviewStatus(dimensions = [], {
  arithmetic = null,
  architectureContexts = [],
} = {}) {
  const hasPendingOrGap = dimensions.some(({ status }) => (
    status === 'DECISION_REQUIRED' || status === 'GAP_FOUND'
  ));
  if (hasPendingOrGap) return 'GAPS_FOUND';
  if (dimensions.length > 0) return 'SEMANTICALLY_CLOSED';
  const hasArithmeticTag = architectureContexts.some((c) => (
    (typeof c === 'string' ? c : c?.tag) === 'integer-arithmetic'
  ));
  if (arithmetic != null || hasArithmeticTag) return 'SEMANTICALLY_CLOSED';
  return 'NOT_APPLICABLE';
}

function isPureNumericLiteral(raw) {
  const clean = String(raw).trim();
  if (!clean) return true;
  if (STANDARD_NUMERIC_CONSTANTS.has(clean.toLowerCase())) return true;
  return /^[+-]?(?:\d+(?:_\d+)*n?|\d+\.\d+|0x[0-9a-f]+n?)$/i.test(clean);
}

function collectKnownStateSymbols(stateModel, boundaryRules = []) {
  const symbols = new Set();
  for (const entity of stateModel?.entities ?? []) {
    if (entity.name) symbols.add(entity.name);
    for (const field of entity.fields ?? []) {
      if (field.name) {
        symbols.add(field.name);
        if (entity.name) symbols.add(`${entity.name}.${field.name}`);
      }
    }
  }
  for (const op of stateModel?.operations ?? []) {
    for (const param of op.parameters ?? []) {
      if (param.name) symbols.add(param.name);
    }
  }
  for (const rule of boundaryRules ?? []) {
    if (typeof rule.subject === 'string' && rule.subject.trim()) {
      symbols.add(rule.subject.trim());
    }
  }
  return symbols;
}

/**
 * Identifies cross-field symbolic comparison tokens in bounds or parameter domains.
 */
export function extractSymbolicComparisonTokens(rawValue, knownSymbols) {
  if (typeof rawValue !== 'string' || isPureNumericLiteral(rawValue)) return [];
  const trimmed = rawValue.trim();
  const matches = trimmed.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) ?? [];
  const hasComparisonOp = /(?:<=|>=|===|==|!=|<|>|\.\.)/.test(trimmed);
  const found = [];
  for (const token of matches) {
    if (STANDARD_NUMERIC_CONSTANTS.has(token.toLowerCase())) continue;
    if (token.includes('.') || knownSymbols.has(token) || (hasComparisonOp && token.length >= 1)) {
      found.push(token);
    }
  }
  return [...new Set(found)];
}

/**
 * Validates unified symbolic provenance across stateModel, parameters.domain and boundaryRules (REQ-0004).
 */
export function collectSymbolicProvenanceIssues({
  stateModel = null,
  boundaryRules = [],
} = {}) {
  const issues = [];
  const knownSymbols = collectKnownStateSymbols(stateModel, boundaryRules);

  const checkEntries = (rawValue, slotId, provenanceOrBasis) => {
    const tokens = extractSymbolicComparisonTokens(rawValue, knownSymbols);
    if (tokens.length === 0) return;
    const entries = Array.isArray(provenanceOrBasis) ? provenanceOrBasis : [];
    const hasAuthoritativeBacking = entries.some((entry) => SYMBOLIC_PROVENANCE_SOURCES.has(entry?.source));
    if (!hasAuthoritativeBacking) {
      issues.push({
        slotId,
        kind: 'UNAUTHORIZED_SYMBOLIC_COMPARISON',
        reason: `A comparação simbólica entre campos '${rawValue}' (${tokens.join(', ')}) em '${slotId}' não pode ser respaldada apenas por ARCHITECTURE_POLICY; exige USER_INTENT, WORKSPACE_EVIDENCE verificada ou USER_DECISION.`,
      });
    }
  };

  for (const entity of stateModel?.entities ?? []) {
    for (const field of entity.fields ?? []) {
      const slotPrefix = `state/${entity.name}.${field.name}/bounds`;
      checkEntries(field.bounds?.lowerBound, `${slotPrefix}/lowerBound`, field.bounds?.provenance);
      checkEntries(field.bounds?.upperBound, `${slotPrefix}/upperBound`, field.bounds?.provenance);
    }
  }
  for (const op of stateModel?.operations ?? []) {
    for (const param of op.parameters ?? []) {
      const provenance = param.bounds?.provenance ?? param.provenance;
      checkEntries(param.bounds?.lowerBound, `operation/${op.name}/parameter/${param.name}/bounds/lowerBound`, provenance);
      checkEntries(param.bounds?.upperBound, `operation/${op.name}/parameter/${param.name}/bounds/upperBound`, provenance);
      checkEntries(param.domain, `operation/${op.name}/parameter/${param.name}/domain`, provenance);
    }
  }
  for (const rule of boundaryRules ?? []) {
    const slotPrefix = `boundaryRules/${rule.id ?? rule.subject ?? 'unnamed'}`;
    checkEntries(rule.lowerBound, `${slotPrefix}/lowerBound`, rule.basis);
    checkEntries(rule.upperBound, `${slotPrefix}/upperBound`, rule.basis);
  }
  return issues;
}

/**
 * Validates REQ-0001 temporalRole on TIMESTAMP/temporalUnit entries and pertinent architectureContexts floor.
 */
export function findTemporalOrContextFloorError(draft) {
  const entities = draft.stateModel?.entities ?? [];
  const operations = draft.stateModel?.operations ?? [];
  const tags = new Set((draft.architectureContexts ?? []).map((c) => (typeof c === 'string' ? c : c.tag)));
  let needsTimeDependent = false;
  let needsStateful = false;
  let needsExternalEffect = false;

  const inspectTemporalEntry = (entry, slot) => {
    if (entry.type === 'TIMESTAMP' || entry.temporalUnit != null) {
      if (entry.temporalRole !== 'COMPUTATION_OR_COMPARISON' && entry.temporalRole !== 'PROJECTION_ONLY') {
        return `missing_temporal_role:${slot}`;
      }
      if (entry.temporalRole === 'COMPUTATION_OR_COMPARISON') needsTimeDependent = true;
    }
    return null;
  };

  for (const entity of entities) {
    for (const field of entity.fields ?? []) {
      const err = inspectTemporalEntry(field, `state/${entity.name}.${field.name}`);
      if (err) return err;
      if ((field.mutations ?? []).length > 0) needsStateful = true;
    }
  }
  for (const op of operations) {
    for (const param of op.parameters ?? []) {
      const err = inspectTemporalEntry(param, `operation/${op.name}/parameter/${param.name}`);
      if (err) return err;
    }
    for (const branch of op.branches ?? []) {
      if ((branch.stateEffects ?? []).some((e) => e.effect !== 'PRESERVE')) needsStateful = true;
      if ((branch.externalEffects ?? []).length > 0) needsExternalEffect = true;
    }
  }

  if (needsTimeDependent && !tags.has('time-dependent')) {
    return 'missing_required_architecture_context:time-dependent';
  }
  if (needsStateful && !tags.has('stateful-operation')) {
    return 'missing_required_architecture_context:stateful-operation';
  }
  if (needsExternalEffect && !tags.has('external-effect')) {
    return 'missing_required_architecture_context:external-effect';
  }
  return null;
}

function hasPendingArithmeticHumanDecision(draft, resolvedDecisionIds = new Set()) {
  const activeDecisions = new Set(
    (draft.decisions ?? [])
      .map((d) => d.questionId)
      .filter((id) => !resolvedDecisionIds.has(id)),
  );
  return (draft.determinismReview?.dimensions ?? []).some((dim) => (
    dim.status === 'DECISION_REQUIRED'
    && (dim.targetIds ?? []).some((id) => activeDecisions.has(id))
  ));
}

function hasSafeFiniteBounds(arithmetic, boundaryRules = []) {
  const withinSafe = (raw) => {
    if (raw === null || raw === undefined) return false;
    const num = Number(raw);
    return Number.isFinite(num) && Math.abs(num) <= Number.MAX_SAFE_INTEGER;
  };
  if (arithmetic?.operandBoundsDeclared === true) {
    if (arithmetic.operandMin != null || arithmetic.operandMax != null) {
      return withinSafe(arithmetic.operandMin) && withinSafe(arithmetic.operandMax);
    }
    return true;
  }
  return (boundaryRules ?? []).some((rule) => withinSafe(rule.lowerBound) && withinSafe(rule.upperBound));
}

/**
 * Validates pure integer-arithmetic policy closure (REQ-0009).
 */
export function findIntegerArithmeticCompileError(draft, resolvedDecisionIds = new Set()) {
  const tags = new Set((draft.architectureContexts ?? []).map((c) => (typeof c === 'string' ? c : c.tag)));
  const arithmetic = draft.determinismReview?.arithmetic ?? null;
  if (!tags.has('integer-arithmetic') && arithmetic === null) return null;

  const hasPendingDecision = hasPendingArithmeticHumanDecision(draft, resolvedDecisionIds);
  if (arithmetic === null || !arithmetic.numericRepresentation) {
    return hasPendingDecision ? null : 'missing_numeric_representation';
  }
  if (arithmetic.numericRepresentation !== 'BIGINT_EXACT'
    && arithmetic.numericRepresentation !== 'SAFE_INTEGER_BOUNDED') {
    return `invalid_numeric_representation:${arithmetic.numericRepresentation}`;
  }

  const ops = arithmetic.operations ?? [];
  const hasDivisionLike = ops.some((op) => op === 'DIVIDE' || op === 'MODULO' || op === 'PRORATE');
  const hasComposedOps = ops.length > 1 || ops.includes('MULTIPLY') || ops.includes('PRORATE');

  if (arithmetic.quotientPolicy != null && !CLOSED_QUOTIENT_POLICIES.has(arithmetic.quotientPolicy)) {
    return `invalid_or_missing_quotient_or_zero_divisor_policy:${arithmetic.quotientPolicy}`;
  }
  if (arithmetic.remainderPolicy != null && !CLOSED_REMAINDER_POLICIES.has(arithmetic.remainderPolicy)) {
    return `invalid_remainder_policy:${arithmetic.remainderPolicy}`;
  }

  if (arithmetic.numericRepresentation === 'SAFE_INTEGER_BOUNDED'
    && !hasSafeFiniteBounds(arithmetic, draft.boundaryRules)
    && !hasPendingDecision) {
    return 'missing_or_unbounded_safe_integer_bounds';
  }
  if (hasComposedOps && !arithmetic.orderPolicy && !hasPendingDecision) {
    return 'missing_arithmetic_order_policy';
  }

  if (hasDivisionLike && !hasPendingDecision) {
    if (arithmetic.zeroDivisorPolicy !== 'REJECT') {
      return 'invalid_or_missing_quotient_or_zero_divisor_policy:zeroDivisorPolicy';
    }
    if (!CLOSED_REMAINDER_POLICIES.has(arithmetic.remainderPolicy)) {
      return 'missing_remainder_policy';
    }
    if (arithmetic.numericRepresentation === 'SAFE_INTEGER_BOUNDED'
      && !CLOSED_QUOTIENT_POLICIES.has(arithmetic.quotientPolicy)) {
      return 'invalid_or_missing_quotient_or_zero_divisor_policy:quotientPolicy';
    }
  }
  return null;
}

/**
 * Evaluates closed-form batchWitness equations per partialFailurePolicy (REQ-0006).
 */
export function evaluateBatchWitnessError(policy, batchWitness) {
  if (!batchWitness || typeof batchWitness !== 'object') {
    return 'batchWitness estruturado ausente.';
  }
  const outcomes = batchWitness.itemOutcomes;
  if (!Array.isArray(outcomes) || outcomes.length < 3 || !outcomes.every((x) => x === 'OK' || x === 'FAILURE')) {
    return 'batchWitness.itemOutcomes deve conter ao menos 3 itens válidos (OK | FAILURE).';
  }
  const okCount = outcomes.filter((x) => x === 'OK').length;
  const failCount = outcomes.filter((x) => x === 'FAILURE').length;
  if (okCount === 0 || failCount === 0) {
    return 'batchWitness.itemOutcomes deve conter sequência mista com >= 1 OK e >= 1 FAILURE.';
  }
  const firstFail = outcomes.indexOf('FAILURE');
  const expected = policy === 'ALL_OR_NOTHING'
    ? { appliedCount: 0, rejectedCount: outcomes.length, skippedCount: 0, terminalStatus: 'ROLLED_BACK' }
    : policy === 'FAIL_FAST'
      ? {
        appliedCount: firstFail,
        rejectedCount: 1,
        skippedCount: outcomes.length - (firstFail + 1),
        terminalStatus: 'PARTIAL_STOPPED_ON_FAILURE',
      }
      : {
        appliedCount: okCount,
        rejectedCount: failCount,
        skippedCount: 0,
        terminalStatus: 'PARTIAL_COMPLETED_WITH_ERRORS',
      };

  if (batchWitness.appliedCount !== expected.appliedCount
    || batchWitness.rejectedCount !== expected.rejectedCount
    || batchWitness.skippedCount !== expected.skippedCount
    || batchWitness.terminalStatus !== expected.terminalStatus) {
    return `batchWitness para '${policy}' viola equação unívoca esperada (applied=${expected.appliedCount}, rejected=${expected.rejectedCount}, skipped=${expected.skippedCount}, terminalStatus=${expected.terminalStatus}).`;
  }
  return null;
}

/**
 * Evaluates strict payload descriptor completeness for REQ-0003.
 */
export function isCompletePayloadDescriptor(desc, payloadSchemas = null) {
  if (!desc || typeof desc !== 'object') return false;
  if (typeof desc.schemaRef === 'string' && desc.schemaRef.trim().length > 0) {
    if (!payloadSchemas) return false;
    const referenced = payloadSchemas instanceof Map ? payloadSchemas.get(desc.schemaRef) : payloadSchemas[desc.schemaRef];
    if (Array.isArray(referenced) && referenced.length > 0) {
      return referenced.every((item) => isCompletePayloadDescriptor(item, null));
    }
    return Boolean(referenced && isCompletePayloadDescriptor(referenced, null));
  }
  return typeof desc.field === 'string'
    && desc.field.trim().length > 0
    && typeof desc.type === 'string'
    && desc.type.trim().length > 0
    && typeof desc.required === 'boolean'
    && typeof desc.nullable === 'boolean'
    && desc.constraints !== undefined;
}
