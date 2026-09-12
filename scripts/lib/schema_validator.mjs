import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaDirectory = resolve(repositoryRoot, 'governance/schemas');
const schemaFiles = new Map([
  ['aegis.architecture_policy.v1', 'architecture-policy.v1.schema.json'],
  ['aegis.confirmation_request.v1', 'confirmation-request.v1.schema.json'],
  ['aegis.constitution.v1', 'constitution.v1.schema.json'],
  ['aegis.issue_contract.v3', 'issue-contract.v3.schema.json'],
  ['aegis.issue_contract.v4', 'issue-contract.v4.schema.json'],
  ['aegis.preflight_handoff.v2', 'preflight-handoff.v2.schema.json'],
  ['aegis.rejection.v1', 'rejection.v1.schema.json'],
  ['aegis.semantic_draft.v1', 'semantic-draft.v1.schema.json'],
  ['aegis.semantic_draft.v2', 'semantic-draft.v2.schema.json'],
  ['aegis.semantic_request.v1', 'semantic-request.v1.schema.json'],
  ['aegis.semantic_request.v2', 'semantic-request.v2.schema.json'],
  ['aegis.semantic_resolution.v1', 'semantic-resolution.v1.schema.json'],
]);

const validator = new Ajv2020({ allErrors: true, strict: true });

function referencedSchemaIds(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) referencedSchemaIds(item, result);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string' && item.startsWith('aegis.')) {
        result.add(item.split('#', 1)[0]);
      } else {
        referencedSchemaIds(item, result);
      }
    }
  }
  return result;
}

function loadSchema(schemaId, loading = new Set()) {
  if (validator.getSchema(schemaId) !== undefined) return;
  if (loading.has(schemaId)) throw new Error('circular_schema_reference:' + schemaId);
  loading.add(schemaId);
  const schema = schemaDocument(schemaId);
  for (const referenceId of referencedSchemaIds(schema)) loadSchema(referenceId, loading);
  validator.addSchema(schema);
  loading.delete(schemaId);
}

export function schemaDocument(schemaId) {
  const file = schemaFiles.get(schemaId);
  if (file === undefined) throw new Error('unknown_schema:' + schemaId);
  return JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8'));
}

export function schemaErrors(schemaId, value) {
  loadSchema(schemaId);
  const validate = validator.getSchema(schemaId);
  if (validate === undefined) throw new Error('schema_unavailable:' + schemaId);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => (error.instancePath || '/') + ':' + error.keyword);
}

export function assertSchema(schemaId, value) {
  const errors = schemaErrors(schemaId, value);
  if (errors.length > 0) throw new Error('schema_validation_failed:' + schemaId + ':' + errors.join(','));
}
