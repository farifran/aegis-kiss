import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertSchema } from './schema_validator.mjs';
import { canonicalDigest } from './canonical_json.mjs';

export const semanticStateRelativePath = 'src/.aegis/semantic-state.json';

export function semanticStatePath(root) {
  return resolve(root, semanticStateRelativePath);
}

function parseJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(code);
  }
}

export function parseSemanticState(value) {
  const state = value;
  if (state === null || typeof state !== 'object' || state.schema !== 'aegis.semantic_state.v1') {
    throw new Error('invalid_semantic_state');
  }
  try {
    assertSchema('aegis.clarified_demand.v2', state.clarifiedDemand);
    assertSchema('aegis.contract_ir.v2', state.contract);
  } catch {
    throw new Error('invalid_semantic_state');
  }
  if (state.proofRegistry === null || typeof state.proofRegistry !== 'object') {
    throw new Error('invalid_semantic_state');
  }
  const digests = state.digests;
  if (
    digests === null
    || typeof digests !== 'object'
    || digests.clarifiedDemandSemanticDigest !== canonicalDigest(state.clarifiedDemand)
    || digests.contractSemanticDigest !== canonicalDigest(state.contract)
    || digests.proofRegistrySemanticDigest !== canonicalDigest(state.proofRegistry)
  ) {
    throw new Error('semantic_state_digest_mismatch');
  }
  return state;
}

export function readSemanticState(root) {
  const path = semanticStatePath(root);
  if (!existsSync(path)) return null;
  return parseSemanticState(parseJson(path, 'invalid_semantic_state'));
}

export function readSemanticEvidence(root) {
  const state = readSemanticState(root);
  if (state !== null) {
    return {
      source: 'semantic-state',
      clarifiedDemand: state.clarifiedDemand,
      contract: state.contract,
      proofRegistry: state.proofRegistry,
    };
  }
  return null;
}
