const sourceEvidenceByteLimit = 98_304;
const sourceEvidenceFileByteLimit = 8_192;
const sourceEvidenceExplicitFileByteLimit = 24_576;

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

function assertUniqueIds(items, field, kind) {
  const ids = items.map((item) => item[field]);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate_${kind}_id`);
  return new Set(ids);
}

export {
  assertUniqueIds,
  closureAuthorityForDimension,
  compileCounterexampleWitness,
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
  sourceEvidenceExplicitFileByteLimit,
};
