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

# 3. Test Draft Generation via ./aegis CLI (com e sem decisões)
decisions_payload='[{"questionId":"Q-0001","question":"Qual o modo de validação?","scope":"INPUT","recommendedAnswerId":"ANS-0001","selectedAnswerId":"ANS-0001","answers":[{"id":"ANS-0001","label":"Estrito","rationale":"Validação imediata","resolutionClause":"Rejeitar entrada inválida","recommended":true},{"id":"ANS-0002","label":"Tolerante","rationale":"Permissivo","resolutionClause":"Sanitizar automaticamente","recommended":false}]}]'

set +e
draft_output="$(bash "${WORK_DIR}/aegis" "Criar um validador determinístico em src/validator.ts" --decisions "${decisions_payload}")"
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

# Verify no cryptographic custody digests leak in draft (letter is being written, not sealed)
if grep -q 'Digest do Contrato:' "${WORK_DIR}/.harness/runtime/contract.md"; then
  echo "[FATAL] Cryptographic contract digest leaked into draft contract.md" >&2
  exit 1
fi
if grep -q 'Constituição (AGENTS.md):' "${WORK_DIR}/.harness/runtime/contract.md"; then
  echo "[FATAL] Cryptographic constitution digest leaked into draft contract.md" >&2
  exit 1
fi

# Verify draft contract policyDigest is unsealed placeholder (all zeros)
jq -e '
  .architecture.policyDigest == "0000000000000000000000000000000000000000000000000000000000000000"
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

# Verify executionId in draft is a correlation ID, not a sha256
jq -e '
  (.executionId | startswith("draft-"))
' "${WORK_DIR}/.harness/runtime/user_confirmation_request.json" >/dev/null

# 3b. Test Draft Generation without decisions (zero questions, no generic hardcoded cards)
bash "${WORK_DIR}/aegis" clean >/dev/null
set +e
zero_q_output="$(bash "${WORK_DIR}/aegis" "Criar um validador simples em src/validator.ts")"
zero_q_code=$?
set -e

if [[ "${zero_q_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 for draft without questions, got ${zero_q_code}" >&2
  exit 1
fi

printf '%s\n' "${zero_q_output}" | jq -e '
  .status == "USER_CONFIRMATION_REQUIRED"
  and (.questions | length == 0)
' >/dev/null

grep -q 'Nenhuma ambiguidade material detectada' "${WORK_DIR}/.harness/runtime/contract.md"

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

# Verify cryptographic custody stamps appear strictly after approval: ONLY the contract digest
grep -q 'Digest do Contrato:' "${WORK_DIR}/.harness/runtime/contract.md"
if grep -q 'Constituição (AGENTS.md):' "${WORK_DIR}/.harness/runtime/contract.md"; then
  echo "[FATAL] Unwanted constitution digest leaked into contract.md" >&2
  exit 1
fi
if grep -q 'Política Arquitetural:' "${WORK_DIR}/.harness/runtime/contract.md"; then
  echo "[FATAL] Unwanted policy digest leaked into contract.md" >&2
  exit 1
fi

# Verify persisted state
[[ -s "${WORK_DIR}/src/.aegis/semantic-state.json" ]]
persisted_digest="$(jq -r '.digests.contractSemanticDigest' "${WORK_DIR}/src/.aegis/semantic-state.json")"
if [[ "${contract_digest}" != "${persisted_digest}" ]]; then
  echo "[FATAL] Digest mismatch between approval output and persisted state" >&2
  exit 1
fi

jq -e '
  (.digests.contractSemanticDigest | test("^[a-f0-9]{64}$"))
  and (.digests.proofRegistrySemanticDigest | test("^[a-f0-9]{64}$"))
' "${WORK_DIR}/src/.aegis/semantic-state.json" >/dev/null

# Verify contract.json was sealed with non-zero policyDigest upon approval
jq -e '
  .architecture.policyDigest != "0000000000000000000000000000000000000000000000000000000000000000"
  and (.architecture.policyDigest | test("^[a-f0-9]{64}$"))
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

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

# 8. Test Universal Transformations: INV-TIE-BREAK, Cross-Clause Consistency and Constitutional Guardrail
set +e
liquidity_draft="$(bash "${WORK_DIR}/aegis" "Implementar motor de LiquidityResolver com anéis circulares e MinFlow")"
liq_draft_code=$?
set -e

if [[ "${liq_draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 for liquidity demand, got ${liq_draft_code}" >&2
  exit 1
fi

# Verify INV-TIE-BREAK is present in draft contract
jq -e '
  .invariants | any(.id == "INV-TIE-BREAK")
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

# Test Constitutional Guardrail (attempt to approve with ANS-LAX-OVERENGINEERING)
cat > "${WORK_DIR}/.harness/runtime/user_resolution.json" <<'EOF'
{
  "answers": [
    { "questionId": "Q-0001", "selectedAnswerId": "ANS-LAX-OVERENGINEERING" }
  ]
}
EOF

set +e
lax_approve_err="$(bash "${WORK_DIR}/aegis" approve 2>&1)"
lax_approve_code=$?
set -e

if [[ "${lax_approve_code}" -eq 0 ]]; then
  echo "[FATAL] Expected constitutional guardrail to block ANS-LAX-OVERENGINEERING" >&2
  exit 1
fi

if ! printf '%s\n' "${lax_approve_err}" | grep -q 'constitutional_conflict'; then
  echo "[FATAL] Error message did not mention constitutional_conflict: ${lax_approve_err}" >&2
  exit 1
fi

# Test Cross-Clause Consistency (resolve with ANS-TREASURY-ABSORB)
cat > "${WORK_DIR}/.harness/runtime/user_resolution.json" <<'EOF'
{
  "answers": [
    { "questionId": "Q-0001", "selectedAnswerId": "ANS-STRICT-KISS" },
    { "questionId": "Q-0002", "selectedAnswerId": "ANS-RESTORE-ECOSYSTEM" },
    { "questionId": "Q-0003", "selectedAnswerId": "ANS-TREASURY-ABSORB" }
  ]
}
EOF

liq_approve="$(bash "${WORK_DIR}/aegis" approve)"
printf '%s\n' "${liq_approve}" | jq -e '.status == "FINALIZED"' >/dev/null

# Verify bidirectional cross-clause update: FAIL-0001 must have updated observableResult
jq -e '
  .failureSemantics[] | select(.id == "FAIL-0001") | .observableResult | contains("conta tesouro")
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

# Verify dynamic vector table renders treasury absorption
grep -q 'Absorção no fundo do tesouro' "${WORK_DIR}/.harness/runtime/contract.md"

# Final Clean
bash "${WORK_DIR}/aegis" clean >/dev/null

printf '[AEGIS][TEST] issue-contract symbiotic flow: PASS\n'

