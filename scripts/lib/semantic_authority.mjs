const sourceEvidenceByteLimit = 65_536;
const sourceEvidenceFileByteLimit = 8_192;

// Witness content is semantic; identity and subject binding are mechanical.
function compileCounterexampleWitness(kind, subjectId, witness) {
  return {
    ...witness,
    id: `WITNESS-${kind}-${subjectId}`,
    dimension: kind,
  };
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
  compileCounterexampleWitness,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
};
