#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { assertSchema, schemaErrors } from './scripts/lib/schema_validator.mjs';

const files = [
  'architecture-policy.v1.schema.json',
  'issue-contract.v1.schema.json',
  'preflight-handoff.v1.schema.json',
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

const preflight = {
  schema: 'aegis.preflight_handoff.v1',
  phase: 'DISCOVERED',
  status: 'SEMANTIC_DELIBERATION_REQUIRED',
  title: 'Demanda de Teste',
  intent: 'Demanda de teste.',
  capture: { provenance: 'USER', encoding: 'UTF-8', lineEndings: 'LF', byteLength: 17 },
  discovery: {
    sourceRoot: 'src',
    sourceFiles: ['src/index.ts'],
    visitedEntries: 1,
    inspectedFiles: 1,
    scannedBytes: 11,
    skippedFiles: [],
    relationStatus: 'NO_LEXICAL_MATCH',
    matchKind: 'CASE_FOLDED_SUBSTRING',
    queryTerms: ['Demanda', 'teste'],
    termsTruncated: false,
    occurrences: [],
    unmatchedTerms: ['Demanda', 'teste'],
  },
};
assertSchema('aegis.preflight_handoff.v1', preflight);
if (schemaErrors('aegis.preflight_handoff.v1', { ...preflight, requirements: [] }).length === 0) {
  throw new Error('preflight schema accepted semantic contract fields');
}

const decisions = [{
  questionId: 'Q-OUTPUT',
  question: 'Qual saída pública deve ser adotada?',
  recommendedAnswerId: 'ANS-SIMPLE',
  selectedAnswerId: 'ANS-SIMPLE',
  answers: [
    { id: 'ANS-SIMPLE', label: 'Resultado simples', rationale: 'Menor superfície.', resolutionClause: 'Retornar resultado simples.', recommended: true },
    { id: 'ANS-DETAIL', label: 'Resultado detalhado', rationale: 'Expõe metadados.', resolutionClause: 'Retornar resultado detalhado.', recommended: false },
  ],
}];
assertSchema('aegis.issue_contract.v1', { ...valid, decisions });
const ambiguousRecommendation = structuredClone(decisions);
ambiguousRecommendation[0].answers[1].recommended = true;
if (schemaErrors('aegis.issue_contract.v1', { ...valid, decisions: ambiguousRecommendation }).length === 0) {
  throw new Error('contract schema accepted multiple recommended answers');
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
