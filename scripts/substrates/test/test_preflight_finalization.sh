#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"
CLARIFIED_PATH="${ROOT_DIR}/.harness/active_clarified_demand.json"
FIXTURE_DIR="${ROOT_DIR}/scratch/preflight-finalization"
DECISION_PATH="${FIXTURE_DIR}/decision.json"
RESOLUTION_PATH="${FIXTURE_DIR}/resolution.json"
REPORT_PATH="${RUNTIME_DIR}/preflight_forensic_report.md"
BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-preflight-state.XXXXXX")"
HAD_CLARIFIED=0

now_ns() {
  node -e 'process.stdout.write(process.hrtime.bigint().toString())'
}

elapsed_ms() {
  node -e 'const [start, end] = process.argv.slice(1).map(BigInt); process.stdout.write(((Number(end - start) / 1e6).toFixed(2)))' "$1" "$2"
}

prompt_block() {
  node -e 'const [text, start, end] = process.argv.slice(1); const from = text.indexOf(start); const to = text.indexOf(end, from + start.length); if (from < 0 || to < 0) process.exit(1); process.stdout.write(text.slice(from + start.length, to).trim())' "$1" "$2" "$3"
}

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
direct_preflight_started="$(now_ns)"
direct_preflight="$(bash "${ROOT_DIR}/aegis" "${direct_demand}" --target src)"
direct_preflight_elapsed="$(elapsed_ms "${direct_preflight_started}" "$(now_ns)")"
printf '%s' "${direct_preflight}" | jq -e '
  .status == "PENDING_SEMANTIC_PREFLIGHT"
  and (.prompt | contains("\\r") | not)
  and (.prompt | contains("src/index.ts"))
' >/dev/null
direct_normalized_digest="$(printf '%s' "${direct_preflight}" | jq -r '.normalizedDemandDigest')"
direct_facts_digest="$(printf '%s' "${direct_preflight}" | jq -r '.mechanicalFactsDigest')"
direct_policy_digest="$(printf '%s' "${direct_preflight}" | jq -r '.architecturePolicyDigest')"
direct_prompt_digest="$(printf '%s' "${direct_preflight}" | jq -r '.promptDigest')"
direct_prompt="$(printf '%s' "${direct_preflight}" | jq -r '.prompt')"
direct_normalized_text="$(prompt_block "${direct_prompt}" '<DEMANDA_NORMALIZADA>' '</DEMANDA_NORMALIZADA>' | jq -r '.text')"
direct_facts="$(prompt_block "${direct_prompt}" '<FATOS_MECÂNICOS>' '</FATOS_MECÂNICOS>')"
direct_decision_started="$(now_ns)"
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
direct_decision_elapsed="$(elapsed_ms "${direct_decision_started}" "$(now_ns)")"
direct_decision="$(jq . "${FIXTURE_DIR}/direct-decision.json")"
direct_finalize_started="$(now_ns)"
direct_output="$(bash "${ROOT_DIR}/aegis" finalize "${direct_demand}" --target src --decision scratch/preflight-finalization/direct-decision.json)"
direct_finalize_elapsed="$(elapsed_ms "${direct_finalize_started}" "$(now_ns)")"
printf '%s' "${direct_output}" | jq -e '.status == "CLARIFIED_DEMAND_PERSISTED"' >/dev/null
jq -e '.intent == "Exportar somente o tipo HealthStatus." and (has("demand") | not)' "${CLARIFIED_PATH}" >/dev/null
direct_clarified="$(jq . "${CLARIFIED_PATH}")"

# Cenário 2: escopo ambíguo. A resposta precisa se ligar ao prompt e à decisão.
demand='Adicionar uma exportação pública mínima em src/index.ts.'
confirmation_preflight_started="$(now_ns)"
preflight="$(bash "${ROOT_DIR}/aegis" "${demand}" --target src)"
confirmation_preflight_elapsed="$(elapsed_ms "${confirmation_preflight_started}" "$(now_ns)")"
normalized_digest="$(printf '%s' "${preflight}" | jq -r '.normalizedDemandDigest')"
facts_digest="$(printf '%s' "${preflight}" | jq -r '.mechanicalFactsDigest')"
policy_digest="$(printf '%s' "${preflight}" | jq -r '.architecturePolicyDigest')"
prompt_digest="$(printf '%s' "${preflight}" | jq -r '.promptDigest')"
confirmation_prompt="$(printf '%s' "${preflight}" | jq -r '.prompt')"
confirmation_normalized_text="$(prompt_block "${confirmation_prompt}" '<DEMANDA_NORMALIZADA>' '</DEMANDA_NORMALIZADA>' | jq -r '.text')"
confirmation_facts="$(prompt_block "${confirmation_prompt}" '<FATOS_MECÂNICOS>' '</FATOS_MECÂNICOS>')"

confirmation_decision_started="$(now_ns)"
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
confirmation_decision="$(jq . "${DECISION_PATH}")"

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
confirmation_resolution="$(jq . "${RESOLUTION_PATH}")"
confirmation_decision_elapsed="$(elapsed_ms "${confirmation_decision_started}" "$(now_ns)")"

confirmation_finalize_started="$(now_ns)"
output="$(bash "${ROOT_DIR}/aegis" finalize "${demand}" --target src --decision scratch/preflight-finalization/decision.json --resolution scratch/preflight-finalization/resolution.json)"
confirmation_finalize_elapsed="$(elapsed_ms "${confirmation_finalize_started}" "$(now_ns)")"
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
confirmation_clarified="$(jq . "${CLARIFIED_PATH}")"
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
blocked_preflight_started="$(now_ns)"
blocked_preflight="$(bash "${ROOT_DIR}/aegis" "${blocked_demand}" --target requirements)"
blocked_preflight_elapsed="$(elapsed_ms "${blocked_preflight_started}" "$(now_ns)")"
printf '%s' "${blocked_preflight}" | jq -e '.prompt | contains("path_not_found")' >/dev/null
persisted_digest_before="$(shasum -a 256 "${CLARIFIED_PATH}" | awk '{print $1}')"
blocked_normalized_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.normalizedDemandDigest')"
blocked_facts_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.mechanicalFactsDigest')"
blocked_policy_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.architecturePolicyDigest')"
blocked_prompt_digest="$(printf '%s' "${blocked_preflight}" | jq -r '.promptDigest')"
blocked_prompt="$(printf '%s' "${blocked_preflight}" | jq -r '.prompt')"
blocked_normalized_text="$(prompt_block "${blocked_prompt}" '<DEMANDA_NORMALIZADA>' '</DEMANDA_NORMALIZADA>' | jq -r '.text')"
blocked_facts="$(prompt_block "${blocked_prompt}" '<FATOS_MECÂNICOS>' '</FATOS_MECÂNICOS>')"
blocked_decision_started="$(now_ns)"
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
blocked_decision="$(jq . "${FIXTURE_DIR}/blocked-decision.json")"
blocked_decision_elapsed="$(elapsed_ms "${blocked_decision_started}" "$(now_ns)")"
blocked_finalize_started="$(now_ns)"
blocked_output="$(bash "${ROOT_DIR}/aegis" finalize "${blocked_demand}" --target requirements --decision scratch/preflight-finalization/blocked-decision.json)"
blocked_finalize_elapsed="$(elapsed_ms "${blocked_finalize_started}" "$(now_ns)")"
printf '%s' "${blocked_output}" | jq -e '.status == "BLOCKED"' >/dev/null
[[ "${persisted_digest_before}" == "$(shasum -a 256 "${CLARIFIED_PATH}" | awk '{print $1}')" ]] || {
  echo 'blocked preflight changed clarified demand' >&2
  exit 1
}

mkdir -p "${RUNTIME_DIR}"
{
  printf '# Relatório forense — Preflight v1\n\n'
  printf 'Escopo: três demandas sintéticas executadas ponta a ponta. O relatório é transitório em .harness/runtime/; ./aegis clean o remove.\n\n'
  printf 'A revisão semântica usa fixtures controladas para testar o protocolo. Nenhum modelo foi chamado; tempos de raciocínio do IDE: N/A. Os tempos medidos são das etapas mecânicas e da finalização local.\n\n'
  printf '| Cenário | Preflight mecânico (ms) | Decisão fixture (ms) | Finalização local (ms) | Estado final |\n'
  printf '| --- | ---: | ---: | ---: | --- |\n'
  printf '| 1. Inequívoca | %s | %s | %s | CLARIFIED_DEMAND_PERSISTED |\n' "${direct_preflight_elapsed}" "${direct_decision_elapsed}" "${direct_finalize_elapsed}"
  printf '| 2. Confirmação | %s | %s | %s | CLARIFIED_DEMAND_PERSISTED |\n' "${confirmation_preflight_elapsed}" "${confirmation_decision_elapsed}" "${confirmation_finalize_elapsed}"
  printf '| 3. Bloqueada | %s | %s | %s | BLOCKED; estado anterior preservado |\n\n' "${blocked_preflight_elapsed}" "${blocked_decision_elapsed}" "${blocked_finalize_elapsed}"

  printf '## 1. Demanda inequívoca\n\nDemanda bruta:\n\n    %s\n\n' "${direct_demand}"
  printf 'Demanda normalizada:\n\n    %s\n\n' "${direct_normalized_text}"
  printf 'Normalização e fatos:\n\n- CRLF convertido para LF; nenhuma correção semântica aplicada.\n- Target src encontrado; política: %s; prompt: %s.\n\n' "${direct_policy_digest}" "${direct_prompt_digest}"
  printf 'Fatos mecânicos:\n\n'
  printf '%s\n\n' "${direct_facts}" | sed 's/^/    /'
  printf 'Decisão fixture:\n\n'
  printf '%s\n\n' "${direct_decision}" | sed 's/^/    /'
  printf 'Decisão e resultado:\n\n- Decisão controlada CLARIFIED, sem perguntas.\n- Modificação de estado: somente .harness/active_clarified_demand.json; nenhum arquivo do produto mudou.\n\n'
  printf 'Demanda esclarecida:\n\n    %s\n\n' "${direct_clarified}"

  printf '## 2. Escopo ambíguo\n\nDemanda bruta:\n\n    %s\n\n' "${demand}"
  printf 'Demanda normalizada:\n\n    %s\n\n' "${confirmation_normalized_text}"
  printf 'Normalização e fatos:\n\n- Texto já estava em LF; target src encontrado; fatos: %s; prompt: %s.\n\n' "${facts_digest}" "${prompt_digest}"
  printf 'Fatos mecânicos:\n\n'
  printf '%s\n\n' "${confirmation_facts}" | sed 's/^/    /'
  printf 'Decisão fixture:\n\n'
  printf '%s\n\n' "${confirmation_decision}" | sed 's/^/    /'
  printf 'Resolução aprovada:\n\n'
  printf '%s\n\n' "${confirmation_resolution}" | sed 's/^/    /'
  printf 'Decisão, confirmação e resultado:\n\n- Decisão controlada NEEDS_CONFIRMATION; Q-SCOPE-001 delimitou tipo versus valor de runtime.\n- Resposta aprovada: Sim, apenas tipo.; validada contra o digest da decisão e do prompt.\n- Tentativa com Q-SCOPE-999 foi rejeitada.\n- Modificação de estado: somente .harness/active_clarified_demand.json.\n\n'
  printf 'Demanda esclarecida:\n\n    %s\n\n' "${confirmation_clarified}"

  printf '## 3. Referência obrigatória ausente\n\nDemanda bruta:\n\n    %s\n\n' "${blocked_demand}"
  printf 'Demanda normalizada:\n\n    %s\n\n' "${blocked_normalized_text}"
  printf 'Normalização e fatos:\n\n- Target requirements ausente (path_not_found); fatos: %s; política: %s; prompt: %s.\n\n' "${blocked_facts_digest}" "${blocked_policy_digest}" "${blocked_prompt_digest}"
  printf 'Fatos mecânicos:\n\n'
  printf '%s\n\n' "${blocked_facts}" | sed 's/^/    /'
  printf 'Decisão fixture:\n\n'
  printf '%s\n\n' "${blocked_decision}" | sed 's/^/    /'
  printf 'Decisão e resultado:\n\n- Decisão controlada BLOCKED; achado PF-REFERENCE-001 em DISPROVEN.\n- Não houve demanda esclarecida, pergunta, resposta, persistência ou alteração de arquivos do produto.\n- A digest da demanda esclarecida anterior permaneceu idêntica.\n'
} > "${REPORT_PATH}"

[[ -s "${REPORT_PATH}" ]] || {
  echo 'forensic report was not created' >&2
  exit 1
}

printf '[AEGIS][TEST] preflight finalization scenarios: PASS (3 demands)\n'
printf '[AEGIS][TEST] forensic_report=%s\n' "${REPORT_PATH}"
