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
  closureAuthorityForDimension,
  counterexampleForDimension,
  literalReferenceAppears,
  mechanicalPolicySignals,
  policySignalSemantics,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
};
