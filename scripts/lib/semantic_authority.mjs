const sourceEvidenceByteLimit = 32_768;
const sourceEvidenceFileByteLimit = 8_192;

const policySignalSemantics = {
  verdict: 'SEMANTIC_NOT_LEXICAL',
  assessment: 'REQUIRED_FOR_EACH_SIGNAL_RULE',
  residualReview: 'SEPARATE_FROM_POLICY_ASSESSMENT',
};

function canonicalProofOutcome(proof) {
  const parameter = proof.resolutionParameter === null
    ? ''
    : ` (${proof.resolutionParameter})`;
  return `Base: ${proof.baselineOutcome}; Variação: ${proof.variationOutcome}; Resolução: ${proof.resolutionKind}${parameter}.`;
}

// Witness content is semantic; identity and subject binding are mechanical.
function compileCounterexampleWitness(kind, subjectId, witness) {
  return {
    ...witness,
    id: `WITNESS-${kind}-${subjectId}`,
    dimension: kind,
  };
}

function literalReferenceAppears(text, reference) {
  return text.normalize('NFC').toLocaleLowerCase('pt-BR')
    .includes(reference.normalize('NFC').toLocaleLowerCase('pt-BR'));
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
  compileCounterexampleWitness,
  literalReferenceAppears,
  policySignalSemantics,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
};
