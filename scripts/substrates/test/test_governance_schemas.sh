#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { assertSchema, schemaErrors } from './scripts/lib/schema_validator.mjs';
import { computePreflightDigest, createProofRegistry } from './scripts/lib/issue_contract_core.mjs';
import { assertPreflightDocument } from './scripts/lib/preflight_integrity.mjs';
import { semanticStateRelativePath } from './scripts/lib/semantic_state.mjs';
import { canonicalDigest } from './scripts/lib/canonical_json.mjs';

const files = [
  'architecture-policy.v1.schema.json',
  'issue-contract.v2.schema.json',
  'preflight-handoff.v2.schema.json',
  'rejection.v1.schema.json',
];

for (const file of files) {
  const schema = JSON.parse(readFileSync('governance/schemas/' + file, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !schema.$id.startsWith('aegis.')) {
    throw new Error('schema metadata invalid: ' + file);
  }
}

const valid = {
  schema: 'aegis.issue_contract.v2',
  title: 'Demanda de Teste',
  changeKind: 'PRODUCT',
  implementationAuthorized: false,
  sourcePreflightDigest: 'b'.repeat(64),
  sourceSnapshotDigest: 'c'.repeat(64),
  intent: 'Intenção de teste do schema.',
  architecture: {
    policyDigest: 'a'.repeat(64),
    appliedRuleIds: ['ARCH-FAILURE-EXPLICIT'],
    amendmentIds: [],
  },
  scope: { observedPaths: ['src/index.ts'] },
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

assertSchema('aegis.issue_contract.v2', valid);
if (schemaErrors('aegis.issue_contract.v2', { ...valid, implementationAuthorized: true }).length === 0) {
  throw new Error('contract authorized product implementation');
}
if (semanticStateRelativePath !== '.harness/state/semantic-state.json') {
  throw new Error('semantic state escaped the harness boundary');
}
if (schemaErrors('aegis.issue_contract.v2', {
  ...valid,
  scope: { authorizedPaths: ['src/index.ts'] },
}).length === 0) {
  throw new Error('legacy implementation authorization field was accepted');
}
if (schemaErrors('aegis.issue_contract.v2', { ...valid, extraField: 'invalid' }).length === 0) {
  throw new Error('schema accepted invalid extra field');
}

const duplicateExecutionContract = structuredClone(valid);
duplicateExecutionContract.proofObligations.push({
  ...duplicateExecutionContract.proofObligations[0],
  id: 'PO-TEST-FAILURES',
  coverageKey: 'test.failures',
});
const duplicateRegistry = createProofRegistry(duplicateExecutionContract);
if (duplicateRegistry.proofs[0].executionKey !== duplicateRegistry.proofs[1].executionKey) {
  throw new Error('equivalent proof commands were not deduplicated');
}

const preflightBody = {
  schema: 'aegis.preflight_handoff.v2',
  phase: 'DISCOVERED',
  status: 'SEMANTIC_DELIBERATION_REQUIRED',
  intent: 'Demanda de teste.',
  capture: {
    provenance: 'USER',
    transport: 'ARGV_STRING',
    unicodeNormalization: 'NFC',
    lineEndings: 'LF',
    byteLength: 17,
  },
  discovery: {
    sourceRoot: 'src',
    status: 'SOURCE_OBSERVED',
    files: [{
      path: 'src/index.ts',
      bytes: 11,
      digest: 'c'.repeat(64),
      kind: 'UTF8_TEXT',
    }],
    ignoredEntries: [],
    visitedEntries: 1,
    scannedBytes: 11,
    sourceSnapshotDigest: 'd'.repeat(64),
    lexicalEvidence: {
      status: 'NO_MATCH',
      method: 'NFC_UNICODE_LOWERCASE_SUBSTRING',
      queryTerms: ['Demanda', 'teste'],
      termsTruncated: false,
      matches: [],
    },
  },
};
preflightBody.discovery.sourceSnapshotDigest = canonicalDigest({
  sourceRoot: preflightBody.discovery.sourceRoot,
  files: preflightBody.discovery.files,
  ignoredEntries: preflightBody.discovery.ignoredEntries,
});
const preflight = { ...preflightBody, preflightDigest: canonicalDigest(preflightBody) };
assertSchema('aegis.preflight_handoff.v2', preflight);
assertPreflightDocument(preflight);
if (schemaErrors('aegis.preflight_handoff.v2', { ...preflight, requirements: [] }).length === 0) {
  throw new Error('preflight schema accepted semantic contract fields');
}

function expectInvalidPreflight(mutator) {
  const invalid = structuredClone(preflight);
  mutator(invalid);
  invalid.discovery.sourceSnapshotDigest = canonicalDigest({
    sourceRoot: invalid.discovery.sourceRoot,
    files: invalid.discovery.files,
    ignoredEntries: invalid.discovery.ignoredEntries,
  });
  invalid.preflightDigest = computePreflightDigest(invalid);
  try {
    assertPreflightDocument(invalid);
  } catch {
    return;
  }
  throw new Error('incoherent preflight was accepted');
}

expectInvalidPreflight((invalid) => { invalid.discovery.status = 'EMPTY_SOURCE'; });
expectInvalidPreflight((invalid) => { invalid.discovery.scannedBytes = 0; });
expectInvalidPreflight((invalid) => { invalid.discovery.files[0].path = 'src/../outside'; });
expectInvalidPreflight((invalid) => {
  invalid.discovery.files.push({ ...invalid.discovery.files[0], digest: 'e'.repeat(64) });
  invalid.discovery.scannedBytes += invalid.discovery.files[0].bytes;
});

assertSchema('aegis.rejection.v1', {
  schema: 'aegis.rejection.v1',
  status: 'REJECTED',
  phase: 'PREFLIGHT',
  reason: 'INVALID_DEMAND_ARITY',
});

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
assertSchema('aegis.issue_contract.v2', { ...valid, decisions });
const ambiguousRecommendation = structuredClone(decisions);
ambiguousRecommendation[0].answers[1].recommended = true;
if (schemaErrors('aegis.issue_contract.v2', { ...valid, decisions: ambiguousRecommendation }).length === 0) {
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
assertSchema('aegis.issue_contract.v2', {
  schema: 'aegis.issue_contract.v2',
  title: 'Demanda de Teste',
  changeKind: 'PRODUCT',
  implementationAuthorized: false,
  sourcePreflightDigest: 'b'.repeat(64),
  sourceSnapshotDigest: 'c'.repeat(64),
  intent: 'Intenção de teste.',
  architecture: {
    policyDigest: 'a'.repeat(64),
    appliedRuleIds: ['ARCH-FAILURE-EXPLICIT'],
    amendmentIds: [],
  },
  scope: { observedPaths: ['src/index.ts'] },
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

if (JSON.stringify(schemaReads) !== JSON.stringify(['issue-contract.v2.schema.json'])) {
  throw new Error('schema loader is not lazy: ' + schemaReads.join(','));
}
NODE

grep -Fqx '# Aegis Cognitive Constitution' "${ROOT_DIR}/AGENTS.md"

printf '[AEGIS][TEST] governance schemas: PASS\n'
