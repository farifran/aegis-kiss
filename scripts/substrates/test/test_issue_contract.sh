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

# 3. Uma demanda sem evidência suficiente exige esclarecimento, nunca aprovação automática.
set +e
draft_output="$(bash "${WORK_DIR}/aegis" Criar um validador determinístico em src/validator.ts)"
draft_code=$?
set -e

if [[ "${draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 (USER_CONFIRMATION_REQUIRED), got ${draft_code}" >&2
  exit 1
fi

printf '%s\n' "${draft_output}" | jq -e '
  .status == "USER_CONFIRMATION_REQUIRED"
  and (.questions | length == 1)
  and (.questions[0].id == "Q-INPUT-CLARIFICATION")
  and (.questions[0].answers[0].requiresText == true)
  and (.intent == "Criar um validador determinístico em src/validator.ts")
  and (.artifactPath == ".harness/runtime/contract.md")
' >/dev/null

[[ -s "${WORK_DIR}/.harness/runtime/contract.json" ]]
[[ -s "${WORK_DIR}/.harness/runtime/contract.md" ]]
[[ -s "${WORK_DIR}/.harness/runtime/user_confirmation_request.json" ]]

# Verify contract.md formatting
grep -q '# Issue / Contrato:' "${WORK_DIR}/.harness/runtime/contract.md"
grep -q 'Decisões Pendentes de Confirmação' "${WORK_DIR}/.harness/runtime/contract.md"

jq -e '
  .scope.authorizedPaths == ["src"]
  and (.evidenceDiscipline.knownFacts | any(startswith("Discovery:")))
  and (.evidenceDiscipline.unknownFacts | any(startswith("Forense mecânico: nenhum termo textual")))
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

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

# 3b. Um workspace sem evidência também exige esclarecimento, sem inferência especulativa.
bash "${WORK_DIR}/aegis" clean >/dev/null
set +e
zero_q_output="$(bash "${WORK_DIR}/aegis" "Criar uma operação simples em src/validator.ts")"
zero_q_code=$?
set -e

if [[ "${zero_q_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 for draft requiring clarification, got ${zero_q_code}" >&2
  exit 1
fi

printf '%s\n' "${zero_q_output}" | jq -e '
  .status == "USER_CONFIRMATION_REQUIRED"
  and (.questions | length == 1)
  and (.questions[0].id == "Q-INPUT-CLARIFICATION")
' >/dev/null

grep -q 'Decisões Pendentes de Confirmação' "${WORK_DIR}/.harness/runtime/contract.md"

# Plain-text intent normalizes CRLF before it becomes contractual evidence.
bash "${WORK_DIR}/aegis" clean >/dev/null
set +e
spec_draft="$(bash "${WORK_DIR}/aegis" $'Linha 1\r\nLinha 2')"
spec_draft_code=$?
set -e
if [[ "${spec_draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected draft generated from normalized text intent" >&2
  exit 1
fi
jq -e '.intent == "Linha 1\nLinha 2"' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

# 4. Test Status Command before Approval
status_pre="$(bash "${WORK_DIR}/aegis" status)"
printf '%s\n' "${status_pre}" | jq -e '.status == "DRAFT_PENDING_CONFIRMATION"' >/dev/null

# 5. Aprovação direta falha até o usuário fornecer a especificação pedida.
set +e
unresolved_approve="$(bash "${WORK_DIR}/aegis" approve 2>&1)"
unresolved_code=$?
set -e
if [[ "${unresolved_code}" -eq 0 ]] || ! grep -q 'unresolved_decision:Q-INPUT-CLARIFICATION' <<< "${unresolved_approve}"; then
  echo "[FATAL] Unresolved clarification was incorrectly approved" >&2
  exit 1
fi

execution_id="$(jq -r '.executionId' "${WORK_DIR}/.harness/runtime/user_confirmation_request.json")"
jq -n \
  --arg executionId "${execution_id}" \
  --arg correction 'Recebe dois números decimais e uma operação; retorna o resultado decimal arredondado a duas casas e rejeita divisão por zero.' \
  '{schema:"aegis.preflight_resolution.v2",executionId:$executionId,answers:[{questionId:"Q-INPUT-CLARIFICATION",correction:$correction}]}' \
  > "${WORK_DIR}/.harness/runtime/preflight_resolution.json"

# 6. Test Approval via ./aegis approve after clarification.
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

# 7. Test Status Command after Approval
status_post="$(bash "${WORK_DIR}/aegis" status)"
printf '%s\n' "${status_post}" | jq -e --arg digest "${contract_digest}" '
  .status == "GOVERNED"
  and .contractDigest == $digest
' >/dev/null

# 8. Test Clean Command
clean_output="$(bash "${WORK_DIR}/aegis" clean)"
printf '%s\n' "${clean_output}" | grep -q 'clean=PASS'
[[ ! -e "${WORK_DIR}/src/.aegis" ]]
[[ "$(cat "${WORK_DIR}/src/index.ts")" == $'// Ponto de entrada canônico para a próxima demanda.\nexport {};' ]]

status_idle="$(bash "${WORK_DIR}/aegis" status)"
printf '%s\n' "${status_idle}" | jq -e '.status == "IDLE"' >/dev/null

# 9. O forense integrado relaciona demanda, fonte e teste sem criar perguntas quando todos os termos têm evidência.
printf 'export function calculateDiscount(value: number) {\n  return value; // desconto\n}\n' > "${WORK_DIR}/src/pricing.ts"
printf 'export { calculateDiscount } from "./pricing.js";\n' > "${WORK_DIR}/src/index.ts"
printf 'import { calculateDiscount } from "./pricing.js";\nvoid calculateDiscount(10);\n' > "${WORK_DIR}/src/pricing.test.ts"
set +e
forensic_draft="$(bash "${WORK_DIR}/aegis" "calculateDiscount desconto")"
forensic_draft_code=$?
set -e

if [[ "${forensic_draft_code}" -ne 2 ]]; then
  echo "[FATAL] Expected exit code 2 for forensic draft, got ${forensic_draft_code}" >&2
  exit 1
fi

# Discovery records textual evidence and direct references; it does not infer API/state policy.
jq -e '
  (.decisions | length == 0)
  and (.evidenceDiscipline.knownFacts | any(. == "Forense mecânico: \"calculateDiscount\" em src/pricing.ts:1."))
  and (.evidenceDiscipline.knownFacts | any(. == "Forense mecânico: src/index.ts declara importação/exportação relativa para src/pricing.ts."))
  and (.evidenceDiscipline.knownFacts | any(. == "Forense mecânico: teste diretamente relacionado observado em src/pricing.test.ts."))
  and ([.evidenceDiscipline.unknownFacts[] | select(startswith("Forense mecânico:"))] | length == 0)
  and ([.evidenceDiscipline.knownFacts[] | select(startswith("Ponto de entrada autorizado:"))] | length == 0)
' "${WORK_DIR}/.harness/runtime/contract.json" >/dev/null

forensic_approve="$(bash "${WORK_DIR}/aegis" approve)"
printf '%s\n' "${forensic_approve}" | jq -e '.status == "FINALIZED"' >/dev/null

# The rendered contract must not pretend that evidence created a state decision.
grep -q 'Aguardando deliberação' "${WORK_DIR}/.harness/runtime/contract.md" && {
  echo "[FATAL] Final contract retained a speculative state decision" >&2
  exit 1
}

# Final Clean
bash "${WORK_DIR}/aegis" clean >/dev/null

printf '[AEGIS][TEST] issue-contract symbiotic flow: PASS\n'
