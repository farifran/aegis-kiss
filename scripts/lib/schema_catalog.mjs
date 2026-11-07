export const schemaFiles = new Map([
  ['aegis.contract_components.v1', 'contract-components.v1.schema.json'],
  ['aegis.architecture_policy.v3', 'architecture-policy.v3.schema.json'],
  ['aegis.confirmation_request.v5', 'confirmation-request.v5.schema.json'],
  ['aegis.constitution.v1', 'constitution.v1.schema.json'],
  ['aegis.intent_evidence.v1', 'intent-evidence.v1.schema.json'],
  ['aegis.issue_contract.v14', 'issue-contract.v14.schema.json'],
  ['aegis.preflight_handoff.v2', 'preflight-handoff.v2.schema.json'],
  ['aegis.rejection.v1', 'rejection.v1.schema.json'],
  ['aegis.semantic_draft.v9', 'semantic-draft.v9.schema.json'],
  ['aegis.semantic_execution.v1', 'semantic-execution.v1.schema.json'],
  ['aegis.semantic_opinion.v3', 'semantic-opinion.v3.schema.json'],
  ['aegis.semantic_request.v10', 'semantic-request.v10.schema.json'],
  ['aegis.semantic_resolution.v2', 'semantic-resolution.v2.schema.json'],
  ['aegis.role_assignment.v1', 'role-assignment.v1.schema.json'],
]);

export const validatorSchemaIds = [
  'aegis.architecture_policy.v3',
  'aegis.confirmation_request.v5',
  'aegis.constitution.v1',
  'aegis.intent_evidence.v1',
  'aegis.issue_contract.v14',
  'aegis.preflight_handoff.v2',
  'aegis.rejection.v1',
  'aegis.semantic_draft.v9',
  'aegis.semantic_execution.v1',
  'aegis.semantic_opinion.v3',
  'aegis.semantic_request.v10',
  'aegis.semantic_resolution.v2',
  'aegis.role_assignment.v1',
];

export function validatorFileName(schemaId) {
  return `${schemaId.replaceAll('.', '_')}.cjs`;
}
