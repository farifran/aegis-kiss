#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-test-issue-contract.XXXXXX")"

cleanup() {
  local status=$?
  rm -rf "${WORK_DIR}"
  exit "${status}"
}
trap cleanup EXIT

# 1. Setup isolated test environment
mkdir -p "${WORK_DIR}/src" "${WORK_DIR}/.harness/runtime"
cp "${ROOT_DIR}/aegis" "${WORK_DIR}/aegis"
cp -r "${ROOT_DIR}/scripts" "${WORK_DIR}/scripts"
cp -r "${ROOT_DIR}/governance" "${WORK_DIR}/governance"
cp "${ROOT_DIR}/AGENTS.md" "${WORK_DIR}/AGENTS.md"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${WORK_DIR}/ARCHITECTURE.md"
ln -s "${ROOT_DIR}/node_modules" "${WORK_DIR}/node_modules"
printf 'export {};\n' > "${WORK_DIR}/src/index.ts"

git -C "${WORK_DIR}" init -q
git -C "${WORK_DIR}" config user.name "Aegis Test"
git -C "${WORK_DIR}" config user.email "aegis-test@example.invalid"
git -C "${WORK_DIR}" add .
git -C "${WORK_DIR}" commit -qm "baseline"

# 2. Test Input Sanitization in Core Library
node --input-type=module <<'NODE'
import { sanitizeInputText } from './scripts/lib/issue_contract_core.mjs';

// CRLF normalization
const crlf = sanitizeInputText(Buffer.from('Linha 1\r\nLinha 2\r\n'));
if (crlf !== 'Linha 1\nLinha 2\n') throw new Error('CRLF normalization failed');

// Over 64 KB rejection
let failed = false;
try {
  sanitizeInputText(Buffer.alloc(65537, 65));
} catch {
  failed = true;
}
if (!failed) throw new Error('DoS limit was not enforced');
NODE

# 3. Test Draft Generation via ./aegis CLI
set +e
draft_output="$(bash "${WORK_DIR}/aegis" "Criar um validador determinístico em src/validator.ts")"
draft_code=$?
set -e

if [[ "${draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 (USER_CONFIRMATION_REQUIRED), got ${draft_code}" >&2
  exit 1
fi

printf '%s\n' "${draft_output}" | jq -e '
  .status == "USER_CONFIRMATION_REQUIRED"
  and (.questions | length > 0)
  and (.questions[0].recommendedAnswerId != null)
  and (.artifactPath == ".harness/runtime/contract.md")
' >/dev/null

[[ -s "${WORK_DIR}/.harness/runtime/contract.json" ]]
[[ -s "${WORK_DIR}/.harness/runtime/contract.md" ]]
[[ -s "${WORK_DIR}/.harness/runtime/user_confirmation_request.json" ]]

# Verify contract.md formatting
grep -q '# Issue / Contrato:' "${WORK_DIR}/.harness/runtime/contract.md"
grep -q '\[RECOMENDADO\]' "${WORK_DIR}/.harness/runtime/contract.md"

# 4. Test Status Command before Approval
status_pre="$(bash "${WORK_DIR}/aegis" status)"
printf '%s\n' "${status_pre}" | jq -e '.status == "DRAFT_PENDING_CONFIRMATION"' >/dev/null

# 5. Test Approval via ./aegis approve
approve_output="$(bash "${WORK_DIR}/aegis" approve)"
printf '%s\n' "${approve_output}" | jq -e '
  .status == "FINALIZED"
  and (.contractDigest | test("^[a-f0-9]{64}$"))
  and .evidenceState == "GOVERNED"
' >/dev/null

contract_digest="$(printf '%s\n' "${approve_output}" | jq -r '.contractDigest')"

# Verify persisted state
[[ -s "${WORK_DIR}/src/.aegis/semantic-state.json" ]]
persisted_digest="$(jq -r '.digests.contractSemanticDigest' "${WORK_DIR}/src/.aegis/semantic-state.json")"
if [[ "${contract_digest}" != "${persisted_digest}" ]]; then
  echo "[FATAL] Digest mismatch between approval output and persisted state" >&2
  exit 1
fi

# 6. Test Status Command after Approval
status_post="$(bash "${WORK_DIR}/aegis" status)"
printf '%s\n' "${status_post}" | jq -e --arg digest "${contract_digest}" '
  .status == "GOVERNED"
  and .contractDigest == $digest
' >/dev/null

# 7. Test Clean Command
clean_output="$(bash "${WORK_DIR}/aegis" clean)"
printf '%s\n' "${clean_output}" | grep -q 'clean=PASS'
[[ ! -e "${WORK_DIR}/src/.aegis" ]]
[[ "$(cat "${WORK_DIR}/src/index.ts")" == $'// Ponto de entrada canônico para a próxima demanda.\nexport {};' ]]

status_idle="$(bash "${WORK_DIR}/aegis" status)"
printf '%s\n' "${status_idle}" | jq -e '.status == "IDLE"' >/dev/null

printf '[AEGIS][TEST] issue-contract symbiotic flow: PASS\n'
