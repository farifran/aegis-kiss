#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-test-preflight.XXXXXX")"

cleanup() {
  local status=$?
  rm -rf "${WORK_DIR}"
  exit "${status}"
}
trap cleanup EXIT

mkdir -p "${WORK_DIR}/src" "${WORK_DIR}/.harness/runtime"
cp "${ROOT_DIR}/aegis" "${WORK_DIR}/aegis"
cp -r "${ROOT_DIR}/scripts" "${WORK_DIR}/scripts"
cp -r "${ROOT_DIR}/governance" "${WORK_DIR}/governance"
ln -s "${ROOT_DIR}/node_modules" "${WORK_DIR}/node_modules"
printf 'export {};\n' > "${WORK_DIR}/src/index.ts"

cd "${WORK_DIR}"

# A captura exige um argumento, normaliza LF/NFC, rejeita controles e limita a 64 KiB.
node --input-type=module <<'NODE'
import { captureDemand } from './scripts/lib/issue_contract_core.mjs';

if (captureDemand(['Linha 1\r\nLinha 2\r\n']) !== 'Linha 1\nLinha 2\n') {
  throw new Error('CRLF normalization failed');
}
if (captureDemand(['precisa\u0303o']) !== 'precisão') {
  throw new Error('NFC normalization failed');
}
for (const args of [[], ['   '], ['duas', 'partes'], ['controle\u001b'], ['a'.repeat(65537)]]) {
  let rejected = false;
  try {
    captureDemand(args);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('invalid input was accepted');
}
NODE

# O Discovery preserva a identidade dos caminhos e rejeita travessias ou nomes inseguros.
node --input-type=module <<'NODE'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { discoverWorkspace } from './scripts/lib/issue_contract_core.mjs';

function expectFailure(root, reason) {
  try {
    discoverWorkspace(root, 'segredo constitucional');
  } catch (error) {
    if (error.message === reason) return;
    throw error;
  }
  throw new Error(`Discovery accepted invalid source root: ${reason}`);
}

const outside = mkdtempSync(join(tmpdir(), 'aegis-outside.'));
const linkedRoot = mkdtempSync(join(tmpdir(), 'aegis-linked-root.'));
const fileRoot = mkdtempSync(join(tmpdir(), 'aegis-file-root.'));
const regularRoot = mkdtempSync(join(tmpdir(), 'aegis-regular-root.'));
const pathRoot = mkdtempSync(join(tmpdir(), 'aegis-path-root.'));
const unsafePathRoot = mkdtempSync(join(tmpdir(), 'aegis-unsafe-path-root.'));
try {
  writeFileSync(join(outside, 'secret.txt'), 'segredo constitucional\n');
  symlinkSync(outside, join(linkedRoot, 'src'), 'dir');
  expectFailure(linkedRoot, 'discovery_source_root_symlink');

  writeFileSync(join(fileRoot, 'src'), 'not a directory\n');
  expectFailure(fileRoot, 'invalid_source_root');

  mkdirSync(join(regularRoot, 'src'));
  writeFileSync(join(regularRoot, 'src/index.ts'), 'export {};\n');
  const demand = Array.from({ length: 65 }, (_, index) => `termo${String(index).padStart(3, '0')}`).join(' ');
  const discovery = discoverWorkspace(regularRoot, demand);
  if (!discovery.lexicalEvidence.termsTruncated) throw new Error('Lexical term limit was not reported');

  mkdirSync(join(pathRoot, 'src/a'), { recursive: true });
  writeFileSync(join(pathRoot, 'src/a/b.ts'), 'export const nested = true;\n');
  if (sep === '/') {
    writeFileSync(join(pathRoot, 'src/a\\b.ts'), 'export const backslash = true;\n');
    const paths = discoverWorkspace(pathRoot).files.map(({ path }) => path);
    if (new Set(paths).size !== paths.length
      || !paths.includes('src/a/b.ts')
      || !paths.includes('src/a\\b.ts')) {
      throw new Error('Distinct POSIX paths collapsed in the Discovery manifest');
    }
  }

  mkdirSync(join(unsafePathRoot, 'src'));
  writeFileSync(join(unsafePathRoot, 'src/safe-\u202Etxt.js'), 'export {};\n');
  expectFailure(unsafePathRoot, 'unsafe_source_path');
} finally {
  rmSync(outside, { recursive: true, force: true });
  rmSync(linkedRoot, { recursive: true, force: true });
  rmSync(fileRoot, { recursive: true, force: true });
  rmSync(regularRoot, { recursive: true, force: true });
  rmSync(pathRoot, { recursive: true, force: true });
  rmSync(unsafePathRoot, { recursive: true, force: true });
}
NODE

# Conteúdo e comandos são separados: "clean" é demanda; somente --clean executa o comando.
source_before_reserved_demand="$(shasum src/index.ts)"
reserved_demand_output="$(bash ./aegis "clean")"
printf '%s\n' "${reserved_demand_output}" | jq -e '.status == "SEMANTIC_DELIBERATION_REQUIRED"' >/dev/null
jq -e '.intent == "clean" and .capture.transport == "ARGV_STRING"' .harness/runtime/preflight.json >/dev/null
[[ "${source_before_reserved_demand}" == "$(shasum src/index.ts)" ]]

# Comandos de controle não aceitam conteúdo adicional.
set +e
unsafe_clean_output="$(bash ./aegis --clean "não apagar" 2>&1)"
unsafe_clean_code=$?
set -e
if [[ "${unsafe_clean_code}" -eq 0 ]] || ! printf '%s\n' "${unsafe_clean_output}" | jq -e '
  .reason == "INVALID_COMMAND_ARITY"
' >/dev/null; then
  printf '[FATAL] Control command accepted demand content\n' >&2
  exit 1
fi
[[ "${source_before_reserved_demand}" == "$(shasum src/index.ts)" ]]

# Tokens separados não podem ser remontados silenciosamente como uma demanda.
set +e
ambiguous_output="$(bash ./aegis criar calculadora 2>&1)"
ambiguous_code=$?
set -e
if [[ "${ambiguous_code}" -eq 0 ]] || ! printf '%s\n' "${ambiguous_output}" | jq -e '
  .status == "REJECTED"
  and .phase == "PREFLIGHT"
  and .reason == "INVALID_DEMAND_ARITY"
' >/dev/null; then
  printf '[FATAL] Multiple demand arguments were not rejected\n' >&2
  exit 1
fi

set +e
unknown_command_output="$(bash ./aegis --unknown 2>&1)"
unknown_command_code=$?
set -e
if [[ "${unknown_command_code}" -eq 0 ]] || ! printf '%s\n' "${unknown_command_output}" | jq -e '
  .status == "REJECTED"
  and .phase == "COMMAND"
  and .reason == "UNKNOWN_COMMAND"
' >/dev/null; then
  printf '[FATAL] Unknown control command was treated as demand\n' >&2
  exit 1
fi

# Artefatos de uma demanda anterior nunca podem sobreviver à nova captura.
printf '{}\n' > .harness/runtime/contract.json
printf '{}\n' > .harness/runtime/contract.md
printf '{}\n' > .harness/runtime/preflight.md
printf '{}\n' > .harness/runtime/user_confirmation_request.json
printf '{}\n' > .harness/runtime/preflight_resolution.json
printf '{}\n' > .harness/runtime/verification_receipt.json
mkdir -p .harness/runtime/stale
printf '{}\n' > .harness/runtime/stale/unknown.json

set +e
draft_output="$(bash ./aegis "Criar calculadora de precisão")"
draft_code=$?
set -e

if [[ "${draft_code}" -ne 0 ]]; then
  printf '[FATAL] Expected successful semantic handoff, got %s\n' "${draft_code}" >&2
  exit 1
fi

printf '%s\n' "${draft_output}" | jq -e '
  .schema == "aegis.preflight_handoff.v2"
  and .phase == "DISCOVERED"
  and .status == "SEMANTIC_DELIBERATION_REQUIRED"
  and .dataPath == ".harness/runtime/preflight.json"
  and (.preflightDigest | test("^[a-f0-9]{64}$"))
  and (.sourceSnapshotDigest | test("^[a-f0-9]{64}$"))
  and (has("title") | not)
  and (has("intent") | not)
  and (has("discovery") | not)
  and (has("questions") | not)
' >/dev/null

[[ -s .harness/runtime/preflight.json ]]
[[ "$(find .harness/runtime -mindepth 1 -maxdepth 1 -print)" == ".harness/runtime/preflight.json" ]]
[[ -z "$(find .harness -maxdepth 1 -type d -name '.preflight-*' -print -quit)" ]]

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { assertSchema } from './scripts/lib/schema_validator.mjs';

assertSchema('aegis.preflight_handoff.v2', JSON.parse(readFileSync('.harness/runtime/preflight.json', 'utf8')));
NODE

# A saída das Fases 1–2 não pode conter decisões ou campos semânticos do contrato.
jq -e '
  .capture == {provenance:"USER",transport:"ARGV_STRING",unicodeNormalization:"NFC",lineEndings:"LF",byteLength:30}
  and .discovery.status == "SOURCE_OBSERVED"
  and (.discovery.files | map(.path)) == ["src/index.ts"]
  and (.discovery.files[0].digest | test("^[a-f0-9]{64}$"))
  and (.discovery.sourceSnapshotDigest | test("^[a-f0-9]{64}$"))
  and (.discovery.lexicalEvidence.queryTerms | length > 0)
  and (has("title") | not)
  and (has("requirements") | not)
  and (has("behavior") | not)
  and (has("invariants") | not)
  and (has("decisions") | not)
  and (has("verification") | not)
  and (has("proofObligations") | not)
' .harness/runtime/preflight.json >/dev/null

status_output="$(bash ./aegis --status)"
printf '%s\n' "${status_output}" | jq -e '
  .status == "SEMANTIC_DELIBERATION_REQUIRED"
  and .phase == "DISCOVERED"
' >/dev/null

cp .harness/runtime/preflight.json .harness/preflight-valid.json
printf '{}\n' > .harness/runtime/preflight.json
printf '%s\n' "$(bash ./aegis --status)" | jq -e '.status == "INVALID_PREFLIGHT"' >/dev/null
mv .harness/preflight-valid.json .harness/runtime/preflight.json

set +e
approve_output="$(bash ./aegis --approve 2>&1)"
approve_code=$?
set -e
if [[ "${approve_code}" -eq 0 ]] || ! printf '%s\n' "${approve_output}" | jq -e '
  .status == "REJECTED"
  and .phase == "APPROVAL"
  and .reason == "SEMANTIC_DELIBERATION_REQUIRED"
' >/dev/null; then
  printf '[FATAL] Preflight was incorrectly accepted as a contract\n' >&2
  exit 1
fi

# Assinar governa o contrato sem criar, editar ou apagar arquivos de produto.
source_before="$(shasum src/index.ts)"
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';

const contract = {
  schema: 'aegis.issue_contract.v2',
  title: 'Contrato sem implementação',
  changeKind: 'PRODUCT',
  implementationAuthorized: false,
  sourcePreflightDigest: 'f'.repeat(64),
  intent: 'Descrever uma fronteira pública sem implementá-la.',
  architecture: {
    policyDigest: '0'.repeat(64),
    appliedRuleIds: ['ARCH-FAILURE-EXPLICIT'],
    amendmentIds: [],
  },
  scope: { observedPaths: ['src/index.ts'] },
  requirements: [{ id: 'REQ-CONTRACT', statement: 'Produzir somente o contrato.', provenance: 'USER' }],
  behavior: [{ id: 'BEH-CONTRACT', statement: 'A assinatura termina sem alterar o produto.' }],
  invariants: [{ id: 'INV-CONTRACT', statement: 'src permanece inalterado.', proofIds: ['PO-CONTRACT', 'PO-CONTRACT-FAILURES'] }],
  proofObligations: ['PO-CONTRACT', 'PO-CONTRACT-FAILURES'].map((id, index) => ({
    id,
    coverageKey: index === 0 ? 'contract-only' : 'contract-only.failures',
    risk: 'Alteração indevida do produto.',
    obligation: 'Confirmar que a assinatura não altera src.',
    entrypoint: '.harness/dedup-proof.sh',
    targets: ['src/index.ts'],
    cadence: 'always',
    cost: 'low',
  })),
};
writeFileSync('.harness/runtime/contract.json', `${JSON.stringify(contract)}\n`);
NODE

# Um contrato não pode ser assinado se não estiver ligado ao preflight atual.
set +e
mismatch_output="$(bash ./aegis --approve 2>&1)"
mismatch_code=$?
set -e
if [[ "${mismatch_code}" -eq 0 ]] || ! printf '%s\n' "${mismatch_output}" | jq -e '
  .status == "REJECTED"
  and .phase == "APPROVAL"
  and .reason == "CONTRACT_PREFLIGHT_MISMATCH"
' >/dev/null; then
  printf '[FATAL] Contract was not bound to the current preflight\n' >&2
  exit 1
fi
[[ ! -e .harness/state/semantic-state.json ]]

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const contract = JSON.parse(readFileSync('.harness/runtime/contract.json', 'utf8'));
const preflight = JSON.parse(readFileSync('.harness/runtime/preflight.json', 'utf8'));
contract.sourcePreflightDigest = preflight.preflightDigest;
writeFileSync('.harness/runtime/contract.json', `${JSON.stringify(contract)}\n`);
NODE

# Referenciar o digest não permite trocar silenciosamente a intenção capturada.
set +e
intent_mismatch_output="$(bash ./aegis --approve 2>&1)"
intent_mismatch_code=$?
set -e
if [[ "${intent_mismatch_code}" -eq 0 ]] || ! printf '%s\n' "${intent_mismatch_output}" | jq -e '
  .status == "REJECTED"
  and .reason == "CONTRACT_INTENT_MISMATCH"
' >/dev/null; then
  printf '[FATAL] Contract changed the captured intent\n' >&2
  exit 1
fi

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const contract = JSON.parse(readFileSync('.harness/runtime/contract.json', 'utf8'));
const preflight = JSON.parse(readFileSync('.harness/runtime/preflight.json', 'utf8'));
contract.intent = preflight.intent;
writeFileSync('.harness/runtime/contract.json', `${JSON.stringify(contract)}\n`);
NODE

# O contrato não pode usar fatos de um src/ alterado depois do Discovery.
printf 'export const changedAfterDiscovery = true;\n' > src/index.ts
set +e
snapshot_mismatch_output="$(bash ./aegis --approve 2>&1)"
snapshot_mismatch_code=$?
set -e
if [[ "${snapshot_mismatch_code}" -eq 0 ]] || ! printf '%s\n' "${snapshot_mismatch_output}" | jq -e '
  .status == "REJECTED"
  and .phase == "APPROVAL"
  and .reason == "SOURCE_SNAPSHOT_CHANGED"
' >/dev/null; then
  printf '[FATAL] Contract accepted a changed source snapshot\n' >&2
  exit 1
fi
[[ ! -e .harness/state/semantic-state.json ]]
printf 'export {};\n' > src/index.ts

# Um digest recalculado não legitima fatos mecânicos adulterados.
cp .harness/runtime/preflight.json .harness/preflight-original.json
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { computePreflightDigest } from './scripts/lib/issue_contract_core.mjs';

const preflight = JSON.parse(readFileSync('.harness/runtime/preflight.json', 'utf8'));
preflight.discovery.lexicalEvidence.status = 'MATCH';
preflight.preflightDigest = computePreflightDigest(preflight);
writeFileSync('.harness/runtime/preflight.json', `${JSON.stringify(preflight)}\n`);

const contract = JSON.parse(readFileSync('.harness/runtime/contract.json', 'utf8'));
contract.sourcePreflightDigest = preflight.preflightDigest;
writeFileSync('.harness/runtime/contract.json', `${JSON.stringify(contract)}\n`);
NODE
set +e
evidence_mismatch_output="$(bash ./aegis --approve 2>&1)"
evidence_mismatch_code=$?
set -e
if [[ "${evidence_mismatch_code}" -eq 0 ]] || ! printf '%s\n' "${evidence_mismatch_output}" | jq -e '
  .status == "REJECTED"
  and .phase == "APPROVAL"
  and .reason == "PREFLIGHT_INTEGRITY_MISMATCH"
' >/dev/null; then
  printf '[FATAL] Contract accepted tampered Discovery evidence\n' >&2
  exit 1
fi
mv .harness/preflight-original.json .harness/runtime/preflight.json
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const contract = JSON.parse(readFileSync('.harness/runtime/contract.json', 'utf8'));
const preflight = JSON.parse(readFileSync('.harness/runtime/preflight.json', 'utf8'));
contract.sourcePreflightDigest = preflight.preflightDigest;
writeFileSync('.harness/runtime/contract.json', `${JSON.stringify(contract)}\n`);
NODE

approve_output="$(bash ./aegis --approve)"
printf '%s\n' "${approve_output}" | jq -e '
  .status == "FINALIZED"
  and .evidenceState == "GOVERNED"
  and .implementationAuthorized == false
' >/dev/null
jq -e --slurpfile preflight .harness/runtime/preflight.json '
  .sourceSnapshotDigest == $preflight[0].discovery.sourceSnapshotDigest
' .harness/runtime/contract.json >/dev/null
[[ -s .harness/state/semantic-state.json ]]
[[ ! -e src/.aegis ]]
[[ "${source_before}" == "$(shasum src/index.ts)" ]]
[[ "$(find src -type f | wc -l | tr -d ' ')" == "1" ]]
grep -q 'IMPLEMENTATION_AUTHORIZED.*false' .harness/runtime/contract.md
if grep -qi 'implementação autorizado\|arquivos autorizados' .harness/runtime/contract.md; then
  printf '[FATAL] Contract still suggests implementation authorization\n' >&2
  exit 1
fi

# Obrigações diferentes que usam o mesmo executor físico rodam apenas uma vez.
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -Eeuo pipefail' \
  'count_file=".harness/runtime/proof-executions"' \
  'count=0' \
  '[[ ! -f "${count_file}" ]] || read -r count < "${count_file}"' \
  'printf "%s\\n" "$((count + 1))" > "${count_file}"' \
  > .harness/dedup-proof.sh
chmod +x .harness/dedup-proof.sh
verify_output="$(bash ./aegis --verify)"
printf '%s\n' "${verify_output}" | tail -n 1 | jq -e '
  .status == "PROVEN"
  and .proofsCovered == 3
  and .executionsRun == 2
' >/dev/null
[[ "$(cat .harness/runtime/proof-executions)" == "1" ]]
jq -e '
  .proofsCovered == 3
  and .executionsRun == 2
  and (.results | map(select(.executionKey != "aegis-static-gate")) | length == 2)
  and (.results | map(select(.reusedExecution == true)) | length == 1)
' .harness/runtime/verification_receipt.json >/dev/null

# O Discovery é agnóstico de linguagem e registra limites da evidência lexical.
bash ./aegis --clean >/dev/null
printf 'def palindromo(texto):\n    return texto == texto[::-1]\n' > src/palindromo.py
printf 'def outra_funcao():\n    return "palindromo"\n' > src/zduplicate.py
printf 'precisa\xCC\x83o\n' > src/unicode.txt
printf '\000binary\n' > src/blob.bin
printf '\377' > src/invalid.bin
ln -s palindromo.py src/link.py
mkdir -p src/config
printf '{}\n' > src/config/product.json

set +e
lexical_output="$(bash ./aegis "identifique se é palindromo com precisão")"
lexical_code=$?
set -e
if [[ "${lexical_code}" -ne 0 ]]; then
  printf '[FATAL] Expected successful lexical Discovery, got %s\n' "${lexical_code}" >&2
  exit 1
fi

printf '%s\n' "${lexical_output}" | jq -e '.status == "SEMANTIC_DELIBERATION_REQUIRED"' >/dev/null
jq -e '
  .phase == "DISCOVERED"
  and .discovery.status == "SOURCE_OBSERVED"
  and (.discovery.sourceSnapshotDigest | test("^[a-f0-9]{64}$"))
  and .discovery.lexicalEvidence.status == "MATCH"
  and .discovery.lexicalEvidence.method == "NFC_UNICODE_LOWERCASE_SUBSTRING"
  and ([.discovery.lexicalEvidence.matches[] | select(.term == "palindromo")] | length) == 1
  and (.discovery.lexicalEvidence.matches | any(.term == "palindromo" and .path == "src/palindromo.py" and .line == 1))
  and (.discovery.lexicalEvidence.matches | any(.term == "precisão" and .path == "src/unicode.txt" and .line == 1))
  and (.discovery.files | any(.path == "src/blob.bin" and .kind == "BINARY"))
  and (.discovery.files | any(.path == "src/invalid.bin" and .kind == "INVALID_UTF8"))
  and (.discovery.files | any(.path == "src/config/product.json" and .kind == "UTF8_TEXT"))
  and (.discovery.ignoredEntries | any(.path == "src/link.py" and .reason == "SYMLINK"))
  and (has("requirements") | not)
' .harness/runtime/preflight.json >/dev/null
if grep -q 'texto == texto' .harness/runtime/preflight.json; then
  printf '[FATAL] Source content leaked into the persisted preflight\n' >&2
  exit 1
fi

# A normalização da captura também aparece no artefato formal.
set +e
bash ./aegis $'Linha 1\r\nLinha 2' >/dev/null
normalized_code=$?
set -e
[[ "${normalized_code}" -eq 0 ]]
jq -e '
  .intent == "Linha 1\nLinha 2"
  and .capture.lineEndings == "LF"
  and .capture.unicodeNormalization == "NFC"
' .harness/runtime/preflight.json >/dev/null

clean_output="$(bash ./aegis --clean)"
grep -q 'clean=PASS' <<< "${clean_output}"
[[ ! -e .harness/runtime/preflight.json ]]
printf '%s\n' "$(bash ./aegis --status)" | jq -e '.status == "IDLE"' >/dev/null

printf '[AEGIS][TEST] capture, normalization and discovery phases: PASS\n'
