import { resolve } from 'node:path';
import { assertSchema } from './schema_validator.mjs';
import { canonicalDigest } from './canonical_json.mjs';

export const semanticStateRelativePath = '.harness/state/semantic-state.json';

export function semanticStatePath(root) {
  return resolve(root, semanticStateRelativePath);
}

/**
 * Valida a integridade estrutural e criptográfica do estado semântico governado.
 * Lança erro explícito se houver qualquer adulteração em relação aos digests canônicos.
 */
export function parseSemanticState(value) {
  const state = value;
  if (state === null || typeof state !== 'object' || state.schema !== 'aegis.semantic_state.v3') {
    throw new Error('invalid_semantic_state');
  }

  if (state.contract?.schema !== 'aegis.issue_contract.v3') {
    throw new Error('invalid_semantic_state');
  }
  assertSchema('aegis.issue_contract.v3', state.contract);
  if (state.contractDigest !== canonicalDigest(state.contract)) {
    throw new Error('semantic_state_digest_mismatch');
  }

  return state;
}
