import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaDirectory = resolve(repositoryRoot, 'governance/schemas');
const schemaFiles = new Map([
  ['aegis.architecture_policy.v1', 'architecture-policy.v1.schema.json'],
  ['aegis.normalized_demand.v2', 'normalized-demand.v2.schema.json'],
  ['aegis.clarified_demand.v2', 'clarified-demand.v2.schema.json'],
  ['aegis.clarified_demand_body.v2', 'clarified-demand-body.v2.schema.json'],
  ['aegis.contract_ir.v2', 'contract-ir.v2.schema.json'],
  ['aegis.contract_body.v2', 'contract-body.v2.schema.json'],
  ['aegis.preflight_decision.v2', 'preflight-decision.v2.schema.json'],
  ['aegis.preflight_resolution.v2', 'preflight-resolution.v2.schema.json'],
  ['aegis.ide_preflight.v2', 'ide-preflight.v2.schema.json'],
  ['aegis.preflight_review.v2', 'preflight-review.v2.schema.json'],
  ['aegis.preflight_review_request.v2', 'preflight-review-request.v2.schema.json'],
]);

const validator = new Ajv2020({ allErrors: true, strict: false });

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
  const file = schemaFiles.get(schemaId);
  if (file === undefined) throw new Error('unknown_schema:' + schemaId);
  if (loading.has(schemaId)) throw new Error('circular_schema_reference:' + schemaId);
  loading.add(schemaId);
  const schema = JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8'));
  for (const referenceId of referencedSchemaIds(schema)) loadSchema(referenceId, loading);
  validator.addSchema(schema);
  loading.delete(schemaId);
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
