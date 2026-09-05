import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaDirectory = resolve(repositoryRoot, 'governance/schemas');
const schemaFiles = [
  'architecture-policy.v1.schema.json',
  'normalized-demand.v2.schema.json',
  'clarified-demand.v2.schema.json',
  'clarified-demand-body.v2.schema.json',
  'contract-ir.v2.schema.json',
  'contract-body.v2.schema.json',
  'preflight-decision.v2.schema.json',
  'preflight-resolution.v2.schema.json',
  'ide-preflight.v2.schema.json',
  'preflight-review.v2.schema.json',
  'preflight-review-request.v2.schema.json',
];

const validator = new Ajv2020({ allErrors: true, strict: false });
for (const file of schemaFiles) {
  validator.addSchema(JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8')));
}

export function schemaErrors(schemaId, value) {
  const validate = validator.getSchema(schemaId);
  if (validate === undefined) throw new Error('unknown_schema:' + schemaId);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => (error.instancePath || '/') + ':' + error.keyword);
}

export function assertSchema(schemaId, value) {
  const errors = schemaErrors(schemaId, value);
  if (errors.length > 0) throw new Error('schema_validation_failed:' + schemaId + ':' + errors.join(','));
}
