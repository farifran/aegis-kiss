import { resolve } from 'node:path';
import { assertSchema } from './schema_validator.mjs';
import { canonicalDigest } from './canonical_json.mjs';
import { assertContractApprovalEvidence } from './semantic_approval.mjs';

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
  if (state === null || typeof state !== 'object') {
    throw new Error('invalid_semantic_state');
  }
  const contractSchemaByState = new Map([
    ['aegis.semantic_state.v14', 'aegis.issue_contract.v14'],
  ]);
  const contractSchema = contractSchemaByState.get(state.schema);
  if (contractSchema === undefined || state.contract?.schema !== contractSchema) {
    throw new Error('invalid_semantic_state');
  }
  assertSchema(contractSchema, state.contract);
  assertContractApprovalEvidence(state.contract, { required: true });
  if (state.contractDigest !== canonicalDigest(state.contract)) {
    throw new Error('semantic_state_digest_mismatch');
  }

  return state;
}
