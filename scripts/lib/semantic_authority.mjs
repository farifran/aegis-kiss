const sourceEvidenceByteLimit = 32_768;
const sourceEvidenceFileByteLimit = 8_192;

const policySignalSemantics = {
  verdict: 'SEMANTIC_NOT_LEXICAL',
  assessment: 'REQUIRED_FOR_EACH_SIGNAL_RULE',
  residualReview: 'SEPARATE_FROM_POLICY_ASSESSMENT',
};

const determinismWitnesses = {
  ORDERING: ['PERMUTED_EQUIVALENT_INPUTS', 'Elementos equivalentes na ordem [A, B].', 'Os mesmos elementos na ordem [B, A].'],
  CANONICALIZATION: ['EQUIVALENT_REPRESENTATIONS', 'Um valor lógico na representação A.', 'O mesmo valor lógico na representação B.'],
  DUPLICATES: ['DUPLICATED_ELEMENT', 'Coleção [A].', 'Coleção [A, A].'],
  EMPTY_INPUT: ['EMPTY_COLLECTION', 'Coleção com um elemento válido.', 'Coleção vazia.'],
  ODD_CARDINALITY: ['THREE_ELEMENTS', 'Coleção com dois elementos.', 'Coleção com três elementos.'],
  ROUNDING: ['NON_EXACT_DIVISION', 'Divisão inteira exata 4/2.', 'Divisão inteira não exata 5/2.'],
  REMAINDER_DISTRIBUTION: ['MULTIPLE_RECIPIENTS_WITH_REMAINDER', 'Dois destinatários sem resto.', 'Dois destinatários com uma unidade de resto.'],
  ZERO_DIVISOR: ['ZERO_DENOMINATOR', 'Divisão 1/1.', 'Divisão 1/0.'],
  TIE_BREAKING: ['EQUAL_PRIORITY_CANDIDATES', 'Dois candidatos com prioridades distintas.', 'Os mesmos candidatos com prioridade igual.'],
  COUNTING_IDENTITY: ['DUPLICATED_IDENTITY_OCCURRENCES', 'Identidades [A, B].', 'Ocorrências [A, A, B].'],
  BOUNDED_ARITHMETIC: ['OUTSIDE_REPRESENTABLE_RANGE', 'Maior valor representável.', 'Uma unidade acima do maior valor representável.'],
};

const determinismResolutionKinds = {
  ORDERING: new Set(['INPUT_ORDER_PRESERVED', 'CANONICAL_ORDER', 'PERMUTATION_INVARIANT']),
  CANONICALIZATION: new Set(['CANONICAL_REPRESENTATION']),
  DUPLICATES: new Set(['DUPLICATES_PRESERVED', 'DUPLICATES_MERGED', 'DUPLICATES_REJECTED']),
  EMPTY_INPUT: new Set(['EMPTY_RETURNS_IDENTITY', 'EMPTY_REJECTED']),
  ODD_CARDINALITY: new Set(['ODD_DUPLICATE_LAST', 'ODD_PROMOTE_LAST', 'ODD_REJECTED']),
  ROUNDING: new Set(['ROUND_TRUNCATE_TOWARD_ZERO', 'ROUND_FLOOR', 'ROUND_CEILING', 'ROUND_EXACT_ONLY']),
  REMAINDER_DISTRIBUTION: new Set(['REMAINDER_RETAINED', 'REMAINDER_DISTRIBUTED_BY_RULE', 'REMAINDER_REJECTED']),
  ZERO_DIVISOR: new Set(['ZERO_DIVISOR_REJECTED', 'ZERO_DIVISOR_RETURNS_ZERO', 'ZERO_DIVISOR_RETURNS_SENTINEL']),
  TIE_BREAKING: new Set(['TIE_BREAK_BY_KEY', 'TIE_PRESERVE_INPUT_ORDER']),
  COUNTING_IDENTITY: new Set(['COUNT_UNIQUE_IDENTITIES', 'COUNT_OCCURRENCES']),
  BOUNDED_ARITHMETIC: new Set(['OVERFLOW_REJECT', 'OVERFLOW_SATURATE', 'OVERFLOW_WRAP', 'OVERFLOW_MODULO']),
};

const equalOutputResolutions = new Set([
  'CANONICAL_ORDER',
  'PERMUTATION_INVARIANT',
  'CANONICAL_REPRESENTATION',
  'DUPLICATES_MERGED',
]);

const rejectionResolutions = new Set([
  'DUPLICATES_REJECTED',
  'EMPTY_REJECTED',
  'ODD_REJECTED',
  'ROUND_EXACT_ONLY',
  'REMAINDER_REJECTED',
  'ZERO_DIVISOR_REJECTED',
  'OVERFLOW_REJECT',
]);

function expectedRelationForResolution(resolutionKind) {
  if (equalOutputResolutions.has(resolutionKind)) return 'OUTPUTS_EQUAL';
  if (rejectionResolutions.has(resolutionKind)) return 'EXPLICIT_REJECTION';
  return 'DEFINED_RESULT';
}

function resolutionAllowedForDimension(dimension, resolutionKind) {
  return determinismResolutionKinds[dimension]?.has(resolutionKind) ?? false;
}

function canonicalProofOutcome(proof) {
  const parameter = proof.resolutionParameter === null
    ? ''
    : ` (${proof.resolutionParameter})`;
  return `Base: ${proof.baselineOutcome}; Variação: ${proof.variationOutcome}; Resolução: ${proof.resolutionKind}${parameter}.`;
}

function counterexampleForDimension(kind) {
  const witness = determinismWitnesses[kind];
  if (witness === undefined) throw new Error(`unknown_determinism_dimension:${kind}`);
  return {
    id: `WITNESS-${kind}`,
    dimension: kind,
    inputClass: witness[0],
    baseline: witness[1],
    variation: witness[2],
  };
}

function literalReferenceAppears(text, reference) {
  return text.normalize('NFC').toLocaleLowerCase('pt-BR')
    .includes(reference.normalize('NFC').toLocaleLowerCase('pt-BR'));
}

function matchingReferences(intent, references) {
  return references.filter((reference) => literalReferenceAppears(intent, reference));
}

function mechanicalPolicySignals(policy, intent) {
  return policy.rules.flatMap((rule) => [
    ...matchingReferences(intent, rule.reviewReferences).map((reference) => ({
      ruleId: rule.id,
      kind: 'REVIEW',
      reference,
    })),
    ...matchingReferences(intent, rule.forbiddenReferences).map((reference) => ({
      ruleId: rule.id,
      kind: 'POSSIBLE_CONFLICT',
      reference,
    })),
  ]);
}

function closureAuthorityForDimension({ status, basis }) {
  if (status === 'DECISION_REQUIRED' || status === 'GAP_FOUND') return 'MODEL_ARGUMENT';
  if (basis.some(({ source }) => source === 'USER_DECISION')) return 'HUMAN_DECISION';
  if (basis.some(({ source }) => source === 'SAFE_MECHANICAL_DEFAULT')) {
    return 'MECHANICAL_FACT';
  }
  if (basis.some(({ source }) => (
    source === 'USER_INTENT'
      || source === 'CONSTITUTION'
      || source === 'ARCHITECTURE_POLICY'
  ))) return 'AUTHORITATIVE_RULE';
  return 'MODEL_ARGUMENT';
}

export {
  canonicalProofOutcome,
  closureAuthorityForDimension,
  counterexampleForDimension,
  expectedRelationForResolution,
  literalReferenceAppears,
  mechanicalPolicySignals,
  policySignalSemantics,
  resolutionAllowedForDimension,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
};
