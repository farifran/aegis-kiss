#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { assertSchema, schemaErrors } from './scripts/lib/schema_validator.mjs';

const files = [
  'architecture-policy.v1.schema.json',
  'normalized-demand.v2.schema.json',
  'clarified-demand.v2.schema.json',
  'clarified-demand-body.v2.schema.json',
  'contract-body.v2.schema.json',
  'preflight-decision.v2.schema.json',
  'preflight-resolution.v2.schema.json',
  'ide-preflight.v2.schema.json',
  'contract-ir.v2.schema.json',
  'preflight-review.v2.schema.json',
  'preflight-review-request.v2.schema.json',
];
for (const file of files) {
  const schema = JSON.parse(readFileSync('governance/schemas/' + file, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !schema.$id.startsWith('aegis.')) {
    throw new Error('schema metadata invalid: ' + file);
  }
}
const valid = {
  schema: 'aegis.normalized_demand.v2',
  digest: 'a'.repeat(64),
  text: 'Criar arquivo.',
  units: [{ id: 'UNIT-0001', kind: 'paragraph', text: 'Criar arquivo.', range: { startByte: 0, endByte: 14 } }],
  references: [],
};
assertSchema('aegis.normalized_demand.v2', valid);
if (schemaErrors('aegis.normalized_demand.v2', { ...valid, rawDigest: 'b'.repeat(64) }).length === 0) {
  throw new Error('schema accepted removed normalizer field');
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
assertSchema('aegis.normalized_demand.v2', {
  schema: 'aegis.normalized_demand.v2',
  digest: 'a'.repeat(64),
  text: 'Criar arquivo.',
  units: [{ id: 'UNIT-0001', kind: 'paragraph', text: 'Criar arquivo.', range: { startByte: 0, endByte: 14 } }],
  references: [],
});
fs.readFileSync = originalReadFileSync;
syncBuiltinESMExports();
if (JSON.stringify(schemaReads) !== JSON.stringify(['normalized-demand.v2.schema.json'])) {
  throw new Error('schema loader is not lazy: ' + schemaReads.join(','));
}
NODE

node --input-type=module <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = fs.mkdtempSync(join(tmpdir(), 'aegis-mechanical-read-set.'));
fs.mkdirSync(join(fixture, 'governance/prompts'), { recursive: true });
for (const path of ['ARCHITECTURE.md', 'governance/architecture.policy.json', 'governance/prompts/preflight.v2.md']) {
  fs.copyFileSync(join(process.cwd(), path), join(fixture, path));
}
const originalReadFileSync = fs.readFileSync;
const fixtureReads = [];
fs.readFileSync = function trackedRead(path, ...args) {
  const value = String(path);
  if (value.startsWith(fixture + '/')) fixtureReads.push(relative(fixture, value));
  return originalReadFileSync.call(this, path, ...args);
};
syncBuiltinESMExports();
const { buildPreflight } = await import(process.cwd() + '/scripts/lib/preflight_core.mjs?mechanical-read-set-test');
await buildPreflight(Buffer.from('Criar src/example.ts.'), '', fixture);
fs.readFileSync = originalReadFileSync;
syncBuiltinESMExports();
fs.rmSync(fixture, { recursive: true });
const expected = ['governance/architecture.policy.json', 'ARCHITECTURE.md', 'governance/prompts/preflight.v2.md'];
if (JSON.stringify(fixtureReads) !== JSON.stringify(expected)) {
  throw new Error('unexpected mechanical read set: ' + fixtureReads.join(','));
}
NODE

grep -Fqx '#### 1. PREFLIGHT, ALINHAMENTO E CONTRATO' "${ROOT_DIR}/AGENTS.md"
grep -Fqx '# Briefing e implementação' "${ROOT_DIR}/.skills/briefing.md"
grep -Fq 'não consulte arquivos, código ou documentação do repositório nesta fase.' "${ROOT_DIR}/governance/prompts/preflight.v2.md"
if [[ -e "${ROOT_DIR}/governance/prompts/contract.v2.md" || -e "${ROOT_DIR}/scripts/build_contract_prompt.mjs" || -e "${ROOT_DIR}/scripts/finalize_contract.mjs" ]]; then
  echo 'separate contract compiler still exists' >&2
  exit 1
fi

printf '[AEGIS][TEST] governance schemas: PASS\n'
