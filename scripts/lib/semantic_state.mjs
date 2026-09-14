import { resolve } from 'node:path';
import { assertSchema } from './schema_validator.mjs';
import { canonicalDigest } from './canonical_json.mjs';
import { assertContractApprovalEvidence } from './semantic_contract.mjs';

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
    ['aegis.semantic_state.v3', 'aegis.issue_contract.v3'],
    ['aegis.semantic_state.v4', 'aegis.issue_contract.v4'],
    ['aegis.semantic_state.v5', 'aegis.issue_contract.v5'],
    ['aegis.semantic_state.v6', 'aegis.issue_contract.v6'],
    ['aegis.semantic_state.v7', 'aegis.issue_contract.v7'],
    ['aegis.semantic_state.v8', 'aegis.issue_contract.v8'],
    ['aegis.semantic_state.v9', 'aegis.issue_contract.v9'],
    ['aegis.semantic_state.v10', 'aegis.issue_contract.v10'],
  ]);
  const contractSchema = contractSchemaByState.get(state.schema);
  if (contractSchema === undefined || state.contract?.schema !== contractSchema) {
    throw new Error('invalid_semantic_state');
  }
  assertSchema(contractSchema, state.contract);
  if (state.schema === 'aegis.semantic_state.v7'
    || state.schema === 'aegis.semantic_state.v8'
    || state.schema === 'aegis.semantic_state.v9'
    || state.schema === 'aegis.semantic_state.v10') {
    assertContractApprovalEvidence(state.contract, { required: true });
  }
  if (state.contractDigest !== canonicalDigest(state.contract)) {
    throw new Error('semantic_state_digest_mismatch');
  }

  return state;
}
