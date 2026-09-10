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

# Standard input is bounded while being read, not only after full buffering.
node -e 'require("fs").writeFileSync(process.argv[1], "a".repeat(65537))' "${WORK_DIR}/oversized-demand.txt"
set +e
bash "${WORK_DIR}/aegis" - <"${WORK_DIR}/oversized-demand.txt" >/dev/null 2>"${WORK_DIR}/stdin-too-large.err"
stdin_code=$?
set -e
if [[ "${stdin_code}" -eq 0 ]] || ! grep -q 'input_too_large' "${WORK_DIR}/stdin-too-large.err"; then
  echo "[FATAL] Oversized stdin was not rejected during capture" >&2
  exit 1
fi

# Capture must not silently choose between two competing intents.
set +e
ambiguous_intent_output="$(bash "${WORK_DIR}/aegis" "Intenção livre" --spec '{"intent":"Intenção estruturada"}' 2>&1)"
ambiguous_intent_code=$?
set -e
if [[ "${ambiguous_intent_code}" -eq 0 ]] || ! grep -q 'ambiguous_intent_sources' <<< "${ambiguous_intent_output}"; then
  echo "[FATAL] Competing intent sources were not rejected" >&2
  exit 1
fi

# Structured input must stay inside the workspace and use its declared type.
set +e
outside_spec_output="$(bash "${WORK_DIR}/aegis" --spec /dev/null 2>&1)"
outside_spec_code=$?
invalid_intent_output="$(bash "${WORK_DIR}/aegis" --spec '{"intent":{"not":"text"}}' 2>&1)"
invalid_intent_code=$?
invalid_target_output="$(bash "${WORK_DIR}/aegis" "Demanda válida" --target src/../escape.ts 2>&1)"
invalid_target_code=$?
set -e
if [[ "${outside_spec_code}" -eq 0 ]] || ! grep -q 'input_file_outside_workspace:--spec' <<< "${outside_spec_output}"; then
  echo "[FATAL] Structured file escaped the workspace boundary" >&2
  exit 1
fi
if [[ "${invalid_intent_code}" -eq 0 ]] || ! grep -q 'invalid_spec_intent' <<< "${invalid_intent_output}"; then
  echo "[FATAL] Non-text spec intent was not rejected" >&2
  exit 1
fi
if [[ "${invalid_target_code}" -eq 0 ]] || ! grep -q 'invalid_target_path' <<< "${invalid_target_output}"; then
  echo "[FATAL] Invalid target path was not rejected" >&2
  exit 1
fi

# 3. Test Draft Generation via ./aegis CLI (com e sem decisões)
decisions_payload='[{"questionId":"Q-0001","question":"Qual o modo de validação?","scope":"INPUT","recommendedAnswerId":"ANS-0001","selectedAnswerId":"ANS-0001","answers":[{"id":"ANS-0001","label":"Estrito","rationale":"Validação imediata","resolutionClause":"Rejeitar entrada inválida","recommended":true},{"id":"ANS-0002","label":"Tolerante","rationale":"Permissivo","resolutionClause":"Sanitizar automaticamente","recommended":false}]}]'

set +e
draft_output="$(bash "${WORK_DIR}/aegis" Criar um validador determinístico em src/validator.ts --decisions "${decisions_payload}")"
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
  and (.intent == "Criar um validador determinístico em src/validator.ts")
  and (.artifactPath == ".harness/runtime/contract.md")
' >/dev/null

set +e
unknown_option_output="$(bash "${WORK_DIR}/aegis" "Demanda válida" --legacy 2>&1)"
unknown_option_code=$?
set -e
if [[ "${unknown_option_code}" -eq 0 ]] || ! grep -q 'unknown_draft_option:--legacy' <<< "${unknown_option_output}"; then
  echo "[FATAL] Unknown draft option was not rejected" >&2
  exit 1
fi

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
zero_q_output="$(bash "${WORK_DIR}/aegis" "Criar uma operação simples em src/validator.ts" --state-kind NONE)"
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

# Intent supplied by --spec follows the same normalization as free text.
bash "${WORK_DIR}/aegis" clean >/dev/null
set +e
spec_draft="$(bash "${WORK_DIR}/aegis" --spec '{"intent":"Linha 1\r\nLinha 2"}' --state-kind NONE)"
spec_draft_code=$?
set -e
if [[ "${spec_draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected draft generated from --spec intent" >&2
  exit 1
fi
jq -e '.intent == "Linha 1\nLinha 2"' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

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

# 8. Test deliberação genérica de modelo de estado sem regras de domínio embutidas
set +e
state_draft="$(bash "${WORK_DIR}/aegis" "Criar uma operação genérica em src/worker.ts")"
state_draft_code=$?
set -e

if [[ "${state_draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 for draft with unresolved state model, got ${state_draft_code}" >&2
  exit 1
fi

# The harness must ask about state rather than infer it from words in the demand.
jq -e '
  (.stateModel == null)
  and (.decisions | any(.questionId == "Q-STATE-MODEL"))
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

# Resolve the generic decision with an explicit state transition.
cat > "${WORK_DIR}/.harness/runtime/user_resolution.json" <<'EOF'
{
  "answers": [
    { "questionId": "Q-STATE-MODEL", "selectedAnswerId": "ANS-STATE-TRANSITION" }
  ]
}
EOF

state_approve="$(bash "${WORK_DIR}/aegis" approve)"
printf '%s\n' "${state_approve}" | jq -e '.status == "FINALIZED"' >/dev/null

jq -e '
  .stateModel.kind == "STATE_TRANSITION"
  and (.invariants | all(.statement | contains("Massa") | not))
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

# The rendered contract is derived from abstract clauses only.
grep -q 'Aguardando deliberação' "${WORK_DIR}/.harness/runtime/contract.md" && {
  echo "[FATAL] Final contract retained unresolved state model" >&2
  exit 1
}

# Final Clean
bash "${WORK_DIR}/aegis" clean >/dev/null

printf '[AEGIS][TEST] issue-contract symbiotic flow: PASS\n'
