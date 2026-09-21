import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import {
  schemaFiles,
  validatorFileName,
  validatorSchemaIds,
} from './schema_catalog.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaDirectory = resolve(repositoryRoot, 'governance/schemas');
const generatedDirectory = resolve(repositoryRoot, 'scripts/generated/schema_validators');
const require = createRequire(import.meta.url);
const validatorIds = new Set(validatorSchemaIds);
const validators = new Map();

function loadValidator(schemaId) {
  if (!validatorIds.has(schemaId)) {
    throw new Error(`schema_has_no_runtime_validator:${schemaId}`);
  }
  const existing = validators.get(schemaId);
  if (existing !== undefined) return existing;
  const validate = require(resolve(generatedDirectory, validatorFileName(schemaId)));
  validators.set(schemaId, validate);
  return validate;
}

export function schemaDocument(schemaId) {
  const file = schemaFiles.get(schemaId);
  if (file === undefined) throw new Error(`unknown_schema:${schemaId}`);
  return JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8'));
}

export function schemaErrors(schemaId, value) {
  const validate = loadValidator(schemaId);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'}:${error.keyword}`
  ));
}

export function assertSchema(schemaId, value) {
  const errors = schemaErrors(schemaId, value);
  if (errors.length > 0) {
    throw new Error(`schema_validation_failed:${schemaId}:${errors.join(',')}`);
  }
}
