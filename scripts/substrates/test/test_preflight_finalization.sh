#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"
CLARIFIED_PATH="${ROOT_DIR}/.harness/active_clarified_demand.json"
FIXTURE_DIR="${ROOT_DIR}/scratch/preflight-finalization"
DECISION_PATH="${FIXTURE_DIR}/decision.json"
RESOLUTION_PATH="${FIXTURE_DIR}/resolution.json"
BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-preflight-state.XXXXXX")"
HAD_CLARIFIED=0

if [[ -e "${CLARIFIED_PATH}" ]]; then
  cp "${CLARIFIED_PATH}" "${BACKUP_DIR}/active_clarified_demand.json"
  HAD_CLARIFIED=1
fi

cleanup() {
  rm -rf "${FIXTURE_DIR}"
  rm -f "${RUNTIME_DIR}/ide_intake.json" "${RUNTIME_DIR}/mechanical_inventory.json"
  if [[ "${HAD_CLARIFIED}" -eq 1 ]]; then
    cp "${BACKUP_DIR}/active_clarified_demand.json" "${CLARIFIED_PATH}"
  else
    rm -f "${CLARIFIED_PATH}"
  fi
  rm -rf "${BACKUP_DIR}"
}
trap cleanup EXIT

mkdir -p "${FIXTURE_DIR}"
: > "${DECISION_PATH}"
: > "${RESOLUTION_PATH}"

# Cenário 1: demanda inequívoca, com CRLF. Pode ser esclarecida sem pergunta
# e não pode deixar a entrada bruta persistida.
direct_demand=$'Exportar somente o tipo HealthStatus em src/index.ts.\r\nSem valores em runtime.'
direct_preflight="$(bash "${ROOT_DIR}/aegis" "${direct_demand}" --target src)"
printf '%s' "${direct_preflight}" | jq -e '
  .status == "PENDING_SEMANTIC_PREFLIGHT"
  and (.prompt | contains("\\r") | not)
  and (.prompt | contains("src/index.ts"))
' >/dev/null
direct_normalized_digest="$(printf '%s' "${direct_preflight}" | jq -r '.normalizedDemandDigest')"
direct_facts_digest="$(printf '%s' "${direct_preflight}" | jq -r '.mechanicalFactsDigest')"
direct_policy_digest="$(printf '%s' "${direct_preflight}" | jq -r '.architecturePolicyDigest')"
jq -n \
  --arg normalized "${direct_normalized_digest}" \
  --arg facts "${direct_facts_digest}" \
  --arg policy "${direct_policy_digest}" \
  '{
    schema:"aegis.preflight_decision.v1",
    normalizedDemandDigest:$normalized,
    mechanicalFactsDigest:$facts,
    architecturePolicyDigest:$policy,
    status:"CLARIFIED",
    findings:[],
    questions:[],
    clarifiedDemand:{
      schema:"aegis.clarified_demand.v1",
      normalizedDemandDigest:$normalized,
      intent:"Exportar somente o tipo HealthStatus.",
      requirements:[{
        id:"REQ-HEALTH-STATUS-001",
        statement:"src/index.ts deve exportar o tipo HealthStatus sem valor de runtime.",
        provenance:"USER"
      }],
      scope:{included:["src/index.ts"],excluded:["valores de runtime"]}
    }
  }' > "${FIXTURE_DIR}/direct-decision.json"
direct_output="$(bash "${ROOT_DIR}/aegis" finalize "${direct_demand}" --target src --decision scratch/preflight-finalization/direct-decision.json)"
printf '%s' "${direct_output}" | jq -e '.status == "CLARIFIED_DEMAND_PERSISTED"' >/dev/null
jq -e '.intent == "Exportar somente o tipo HealthStatus." and (has("demand") | not)' "${CLARIFIED_PATH}" >/dev/null

# Cenário 2: escopo ambíguo. A resposta precisa se ligar ao prompt e à decisão.
demand='Adicionar uma exportação pública mínima em src/index.ts.'
preflight="$(bash "${ROOT_DIR}/aegis" "${demand}" --target src)"
normalized_digest="$(printf '%s' "${preflight}" | jq -r '.normalizedDemandDigest')"
facts_digest="$(printf '%s' "${preflight}" | jq -r '.mechanicalFactsDigest')"
policy_digest="$(printf '%s' "${preflight}" | jq -r '.architecturePolicyDigest')"
prompt_digest="$(printf '%s' "${preflight}" | jq -r '.promptDigest')"

jq -n \
  --arg normalized "${normalized_digest}" \
  --arg facts "${facts_digest}" \
  --arg policy "${policy_digest}" \
  '{
    schema:"aegis.preflight_decision.v1",
    normalizedDemandDigest:$normalized,
    mechanicalFactsDigest:$facts,
    architecturePolicyDigest:$policy,
    status:"NEEDS_CONFIRMATION",
    findings:[],
    questions:[{
      id:"Q-SCOPE-001",
      scope:"SCOPE",
      prompt:"A exportação deve ser apenas de tipo?",
      evidence:"A demanda não especifica valor em tempo de execução.",
      impact:"Define a superfície pública entregue.",
      recommendation:"Exportar somente um tipo até haver requisito de runtime."
    }]
  }' > "${DECISION_PATH}"

decision_digest="$(shasum -a 256 "${DECISION_PATH}" | awk '{print $1}')"
jq -n \
  --arg decision "${decision_digest}" \
  --arg prompt "${prompt_digest}" \
  --arg normalized "${normalized_digest}" \
  '{
    schema:"aegis.preflight_resolution.v1",
    decisionDigest:$decision,
    preflightPromptDigest:$prompt,
    answers:[{questionId:"Q-SCOPE-001",answer:"Sim, apenas tipo."}],
    clarifiedDemand:{
      schema:"aegis.clarified_demand.v1",
      normalizedDemandDigest:$normalized,
      intent:"Adicionar uma exportação pública de tipo mínima.",
      requirements:[{
        id:"REQ-EXPORT-TYPE-001",
        statement:"src/index.ts deve exportar somente o tipo público solicitado.",
        provenance:"USER_CLARIFICATION"
      }],
      scope:{included:["src/index.ts"],excluded:["valores de runtime"]},
      acceptanceCriteria:["O tipo pode ser importado por consumidores TypeScript."]
    }
  }' > "${RESOLUTION_PATH}"

output="$(bash "${ROOT_DIR}/aegis" finalize "${demand}" --target src --decision scratch/preflight-finalization/decision.json --resolution scratch/preflight-finalization/resolution.json)"
printf '%s' "${output}" | jq -e '
  .schema == "aegis.preflight_finalization.v1"
  and .status == "CLARIFIED_DEMAND_PERSISTED"
  and .path == ".harness/active_clarified_demand.json"
  and (.clarifiedDemandDigest | test("^[a-f0-9]{64}$"))
' >/dev/null

jq -e '
  .schema == "aegis.clarified_demand.v1"
  and .intent == "Adicionar uma exportação pública de tipo mínima."
  and (has("demand") | not)
  and (.requirements[0].provenance == "USER_CLARIFICATION")
' "${CLARIFIED_PATH}" >/dev/null
[[ ! -e "${RUNTIME_DIR}/ide_intake.json" ]] || {
  echo 'finalization persisted raw intake' >&2
  exit 1
}

cp "${RESOLUTION_PATH}" "${FIXTURE_DIR}/invalid-resolution.json"
jq '.answers[0].questionId = "Q-SCOPE-999"' "${FIXTURE_DIR}/invalid-resolution.json" > "${FIXTURE_DIR}/invalid-resolution.tmp"
mv "${FIXTURE_DIR}/invalid-resolution.tmp" "${FIXTURE_DIR}/invalid-resolution.json"
if bash "${ROOT_DIR}/aegis" finalize "${demand}" --target src --decision scratch/preflight-finalization/decision.json --resolution scratch/preflight-finalization/invalid-resolution.json >/dev/null 2>&1; then
  echo 'finalization accepted mismatched answer ids' >&2
  exit 1
fi

# Cenário 3: uma referência indispensável ausente bloqueia a demanda sem
# sobrescrever o último esclarecimento válido.
blocked_demand='Atualizar a API conforme o anexo obrigatório requirements/alerta.md.'
blocked_preflight="$(bash "${ROOT_DIR}/aegis" "${blocked_demand}" --target requirements)"
printf '%s' "${blocked_preflight}" | jq -e '.prompt | contains("path_not_found")' >/dev/null
persisted_digest_before="$(shasum -a 256 "${CLARIFIED_PATH}" | awk '{print $1}')"
blocked_normalized_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.normalizedDemandDigest')"
blocked_facts_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.mechanicalFactsDigest')"
blocked_policy_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.architecturePolicyDigest')"
jq -n \
  --arg normalized "${blocked_normalized_digest}" \
  --arg facts "${blocked_facts_digest}" \
  --arg policy "${blocked_policy_digest}" \
  '{
    schema:"aegis.preflight_decision.v1",
    normalizedDemandDigest:$normalized,
    mechanicalFactsDigest:$facts,
    architecturePolicyDigest:$policy,
    status:"BLOCKED",
    findings:[{
      id:"PF-REFERENCE-001",
      kind:"reference",
      status:"DISPROVEN",
      evidence:"O anexo solicitado não está no worktree."
    }],
    questions:[]
  }' > "${FIXTURE_DIR}/blocked-decision.json"
blocked_output="$(bash "${ROOT_DIR}/aegis" finalize "${blocked_demand}" --target requirements --decision scratch/preflight-finalization/blocked-decision.json)"
printf '%s' "${blocked_output}" | jq -e '.status == "BLOCKED"' >/dev/null
[[ "${persisted_digest_before}" == "$(shasum -a 256 "${CLARIFIED_PATH}" | awk '{print $1}')" ]] || {
  echo 'blocked preflight changed clarified demand' >&2
  exit 1
}

printf '[AEGIS][TEST] preflight finalization scenarios: PASS (3 demands)\n'
