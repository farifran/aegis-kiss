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

function pointerValue(document, pointer) {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) throw new Error(`unsupported_schema_pointer:${pointer}`);
  return pointer.slice(1).split('/').reduce((value, segment) => {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`unresolved_schema_pointer:${pointer}`);
    }
    return value[key];
  }, document);
}

function expandSchema(value, currentSchemaId, stack) {
  if (Array.isArray(value)) return value.map((item) => expandSchema(item, currentSchemaId, stack));
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') {
    if (Object.keys(value).length !== 1) throw new Error(`schema_ref_with_siblings:${value.$ref}`);
    const [referencedId, pointer = ''] = value.$ref.startsWith('#')
      ? [currentSchemaId, value.$ref.slice(1)]
      : value.$ref.split('#');
    const absoluteReference = `${referencedId}#${pointer}`;
    if (stack.has(absoluteReference)) throw new Error(`recursive_schema_ref:${absoluteReference}`);
    const nextStack = new Set(stack);
    nextStack.add(absoluteReference);
    return expandSchema(
      pointerValue(schemaDocument(referencedId), pointer),
      referencedId,
      nextStack,
    );
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== '$defs')
    .map(([key, item]) => [key, expandSchema(item, currentSchemaId, stack)]));
}

/** Produz o schema autocontido usado fora do processo local, sem refs dependentes do catálogo. */
export function standaloneSchemaDocument(schemaId) {
  return expandSchema(schemaDocument(schemaId), schemaId, new Set());
}

export function schemaErrors(schemaId, value) {
  const validate = loadValidator(schemaId);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'}:${error.keyword}${
      error.keyword === 'required' ? `:${error.params.missingProperty}` : ''
    }`
  ));
}

export function assertSchema(schemaId, value) {
  const errors = schemaErrors(schemaId, value);
  if (errors.length > 0) {
    throw new Error(`schema_validation_failed:${schemaId}:${errors.join(',')}`);
  }
}
