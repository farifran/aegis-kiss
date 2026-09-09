#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { assertSchema, schemaErrors } from './scripts/lib/schema_validator.mjs';

const files = [
  'architecture-policy.v1.schema.json',
  'issue-contract.v1.schema.json',
];

for (const file of files) {
  const schema = JSON.parse(readFileSync('governance/schemas/' + file, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !schema.$id.startsWith('aegis.')) {
    throw new Error('schema metadata invalid: ' + file);
  }
}

const valid = {
  schema: 'aegis.issue_contract.v1',
  title: 'Demanda de Teste',
  changeKind: 'PRODUCT',
  intent: 'Intenção de teste do schema.',
  architecture: {
    policyDigest: 'a'.repeat(64),
    appliedRuleIds: ['ARCH-FAILURE-EXPLICIT'],
    amendmentIds: [],
  },
  scope: { authorizedPaths: ['src/index.ts'] },
  requirements: [{ id: 'REQ-0001', statement: 'Requisito funcional.', provenance: 'USER' }],
  behavior: [{ id: 'BEH-0001', statement: 'Comportamento observável.' }],
  invariants: [{ id: 'INV-0001', statement: 'Invariante de teste.', proofIds: ['PO-TEST'] }],
  proofObligations: [{
    id: 'PO-TEST',
    coverageKey: 'test',
    risk: 'Risco de teste.',
    obligation: 'Verificar teste.',
    entrypoint: 'src/index.proof.sh',
    targets: ['src/index.ts'],
    cadence: 'always',
    cost: 'low',
  }],
};

assertSchema('aegis.issue_contract.v1', valid);
if (schemaErrors('aegis.issue_contract.v1', { ...valid, extraField: 'invalid' }).length === 0) {
  throw new Error('schema accepted invalid extra field');
}
NODE

node --input-type=module <<'NODE'
import fs from 'node:fs';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const originalReadFileSync = fs.readFileSync;
const schemaReads = [];
fs.readFileSync = function trackedRead(path, ...args) {
  if (String(path).includes('/governance/schemas/')) schemaReads.push(basename(String(path)));
  return originalReadFileSync.call(this, path, ...args);
};
syncBuiltinESMExports();

const { assertSchema } = await import(process.cwd() + '/scripts/lib/schema_validator.mjs?lazy-load-test');
assertSchema('aegis.issue_contract.v1', {
  schema: 'aegis.issue_contract.v1',
  title: 'Demanda de Teste',
  changeKind: 'PRODUCT',
  intent: 'Intenção de teste.',
  architecture: {
    policyDigest: 'a'.repeat(64),
    appliedRuleIds: ['ARCH-FAILURE-EXPLICIT'],
    amendmentIds: [],
  },
  scope: { authorizedPaths: ['src/index.ts'] },
  requirements: [{ id: 'REQ-0001', statement: 'req', provenance: 'USER' }],
  behavior: [{ id: 'BEH-0001', statement: 'beh' }],
  invariants: [{ id: 'INV-0001', statement: 'inv', proofIds: ['PO-TEST'] }],
  proofObligations: [{
    id: 'PO-TEST',
    coverageKey: 'test',
    risk: 'risk',
    obligation: 'obl',
    entrypoint: 'src/index.proof.sh',
    targets: ['src/index.ts'],
    cadence: 'always',
    cost: 'low',
  }],
});

fs.readFileSync = originalReadFileSync;
syncBuiltinESMExports();

if (JSON.stringify(schemaReads) !== JSON.stringify(['issue-contract.v1.schema.json'])) {
  throw new Error('schema loader is not lazy: ' + schemaReads.join(','));
}
NODE

grep -Fqx '# Aegis Cognitive Constitution' "${ROOT_DIR}/AGENTS.md"

printf '[AEGIS][TEST] governance schemas: PASS\n'
