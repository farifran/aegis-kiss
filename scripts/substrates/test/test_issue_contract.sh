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

# A captura aceita somente UTF-8 válido, normaliza CRLF e limita a demanda a 64 KiB.
node --input-type=module <<'NODE'
import { sanitizeInputText } from './scripts/lib/issue_contract_core.mjs';

if (sanitizeInputText(Buffer.from('Linha 1\r\nLinha 2\r\n')) !== 'Linha 1\nLinha 2\n') {
  throw new Error('CRLF normalization failed');
}
for (const input of [Buffer.alloc(65537, 65), Buffer.from([0xff])]) {
  let rejected = false;
  try {
    sanitizeInputText(input);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('invalid input was accepted');
}
NODE

# Artefatos de uma demanda anterior nunca podem sobreviver à nova captura.
printf '{}\n' > .harness/runtime/contract.json
printf '{}\n' > .harness/runtime/contract.md
printf '{}\n' > .harness/runtime/user_confirmation_request.json
printf '{}\n' > .harness/runtime/preflight_resolution.json
printf '{}\n' > .harness/runtime/verification_receipt.json

set +e
draft_output="$(bash ./aegis "Criar calculadora de precisão")"
draft_code=$?
set -e

if [[ "${draft_code}" -ne 0 ]]; then
  printf '[FATAL] Expected successful semantic handoff, got %s\n' "${draft_code}" >&2
  exit 1
fi

printf '%s\n' "${draft_output}" | jq -e '
  .schema == "aegis.preflight_handoff.v1"
  and .phase == "DISCOVERED"
  and .status == "SEMANTIC_DELIBERATION_REQUIRED"
  and .dataPath == ".harness/runtime/preflight.json"
  and .artifactPath == ".harness/runtime/preflight.md"
  and (has("intent") | not)
  and (has("discovery") | not)
  and (has("questions") | not)
' >/dev/null

[[ -s .harness/runtime/preflight.json ]]
[[ -s .harness/runtime/preflight.md ]]
[[ ! -e .harness/runtime/contract.json ]]
[[ ! -e .harness/runtime/contract.md ]]
[[ ! -e .harness/runtime/user_confirmation_request.json ]]
[[ ! -e .harness/runtime/preflight_resolution.json ]]
[[ ! -e .harness/runtime/verification_receipt.json ]]

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { assertSchema } from './scripts/lib/schema_validator.mjs';

assertSchema('aegis.preflight_handoff.v1', JSON.parse(readFileSync('.harness/runtime/preflight.json', 'utf8')));
NODE

# A saída das Fases 1–2 não pode conter decisões ou campos semânticos do contrato.
jq -e '
  .capture == {provenance:"USER",encoding:"UTF-8",lineEndings:"LF",byteLength:30}
  and .discovery.sourceFiles == ["src/index.ts"]
  and (.discovery.queryTerms | length > 0)
  and (has("requirements") | not)
  and (has("behavior") | not)
  and (has("invariants") | not)
  and (has("decisions") | not)
  and (has("verification") | not)
  and (has("proofObligations") | not)
' .harness/runtime/preflight.json >/dev/null

grep -q '^# Pré-voo:' .harness/runtime/preflight.md
grep -q 'aguardando deliberação semântica' .harness/runtime/preflight.md
grep -q 'Ausência de correspondência lexical não significa' .harness/runtime/preflight.md
if grep -Eq 'REQ-|BEH-|INV-|PO-|RECOMENDADO' .harness/runtime/preflight.md; then
  printf '[FATAL] Semantic contract content leaked into preflight.md\n' >&2
  exit 1
fi

status_output="$(bash ./aegis status)"
printf '%s\n' "${status_output}" | jq -e '
  .status == "SEMANTIC_DELIBERATION_REQUIRED"
  and .phase == "DISCOVERED"
' >/dev/null

set +e
approve_output="$(bash ./aegis approve 2>&1)"
approve_code=$?
set -e
if [[ "${approve_code}" -eq 0 ]] || ! grep -q 'semantic_deliberation_required' <<< "${approve_output}"; then
  printf '[FATAL] Preflight was incorrectly accepted as a contract\n' >&2
  exit 1
fi

# Assinar governa o contrato sem criar, editar ou apagar arquivos de produto.
source_before="$(shasum src/index.ts)"
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';

const contract = {
  schema: 'aegis.issue_contract.v1',
  title: 'Contrato sem implementação',
  changeKind: 'PRODUCT',
  implementationAuthorized: false,
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

approve_output="$(bash ./aegis approve)"
printf '%s\n' "${approve_output}" | jq -e '
  .status == "FINALIZED"
  and .evidenceState == "GOVERNED"
  and .implementationAuthorized == false
' >/dev/null
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
verify_output="$(bash ./aegis verify)"
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
bash ./aegis clean >/dev/null
printf 'def palindromo(texto):\n    return texto == texto[::-1]\n' > src/palindromo.py
printf '\000binary\n' > src/blob.bin
mkdir -p src/.aegis
printf '{}\n' > src/.aegis/semantic-state.json

set +e
forensic_output="$(bash ./aegis "identifique se é palindromo")"
forensic_code=$?
set -e
if [[ "${forensic_code}" -ne 0 ]]; then
  printf '[FATAL] Expected successful lexical Discovery, got %s\n' "${forensic_code}" >&2
  exit 1
fi

printf '%s\n' "${forensic_output}" | jq -e '.status == "SEMANTIC_DELIBERATION_REQUIRED"' >/dev/null
jq -e '
  .phase == "DISCOVERED"
  and .discovery.relationStatus == "LEXICAL_MATCH"
  and .discovery.matchKind == "CASE_FOLDED_SUBSTRING"
  and (.discovery.occurrences | any(.term == "palindromo" and .path == "src/palindromo.py" and .line == 1))
  and (.discovery.skippedFiles | any(.path == "src/blob.bin" and .reason == "BINARY"))
  and (.discovery.sourceFiles | index("src/.aegis/semantic-state.json") != null)
  and (has("requirements") | not)
' .harness/runtime/preflight.json >/dev/null

# A normalização da captura também aparece no artefato formal.
set +e
bash ./aegis $'Linha 1\r\nLinha 2' >/dev/null
normalized_code=$?
set -e
[[ "${normalized_code}" -eq 0 ]]
jq -e '.intent == "Linha 1\nLinha 2" and .capture.lineEndings == "LF"' .harness/runtime/preflight.json >/dev/null

clean_output="$(bash ./aegis clean)"
grep -q 'clean=PASS' <<< "${clean_output}"
[[ ! -e .harness/runtime/preflight.json ]]
printf '%s\n' "$(bash ./aegis status)" | jq -e '.status == "IDLE"' >/dev/null

printf '[AEGIS][TEST] capture and discovery phases: PASS\n'
