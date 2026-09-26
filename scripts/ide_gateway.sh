#!/usr/bin/env bash

# AEGIS — Symbiotic Demand-to-Contract Gateway (Isolated Flow)

set -Eeuo pipefail

ROOT_DIR="${AEGIS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export AEGIS_ROOT="${ROOT_DIR}"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"

fatal() {
  printf '{"schema":"aegis.rejection.v1","status":"REJECTED","phase":"COMMAND","reason":"%s"}\n' "$1" >&2
  exit 1
}

require_command_arity() {
  [[ "$#" -eq 1 ]] || fatal 'INVALID_COMMAND_ARITY'
}

usage() {
  cat <<'EOF'
Aegis — Fluxo Simbiótico Demanda até o Contrato:
  ./aegis "<demanda>" Executa captura, Discovery, JEV e supervisão até o contrato
  ./aegis --approve   Confirma e sela o contrato com o Hash Raiz Único (contractDigest)
  ./aegis --verify    Verifica a integridade criptográfica do contrato assinado
  ./aegis --semantic-request  Entrega a Intent IR neutra à IA semântica
  ./aegis --semantic-run  Executa o supervisor configurado e compila o contrato
  ./aegis --semantic-compile  Recebe o parecer JSON da IDE pelo stdin e compila o contrato
  ./aegis --jev-request  Exibe o lote de avaliação paralela preparado para o JEV
  ./aegis --jev-run      Executa o JEV em modo sombra via Vercel AI Gateway
  ./aegis --wizard    Abre as decisões pendentes no terminal
  ./aegis --setup     Configura o supervisor do contrato e o agente de codificação
  ./aegis --setup --show  Exibe a configuração externa sem expor chaves
  ./aegis --status    Exibe o status do contrato e da árvore de trabalho
  ./aegis --clean     Remove artefatos transientes e redefine src/index.ts
  ./aegis --help      Exibe esta mensagem de ajuda
EOF
}

clean_command() {
  rm -rf "${RUNTIME_DIR}"
  mkdir -p "${RUNTIME_DIR}"
  rm -rf "${ROOT_DIR}/.harness/state"
  [[ -d "${ROOT_DIR}/src" && ! -L "${ROOT_DIR}/src" ]] || fatal 'INVALID_SOURCE_DIRECTORY'
  find "${ROOT_DIR}/src" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${ROOT_DIR}/src/index.ts"
  echo '[AEGIS][IDE] clean=PASS source_reset=1 contracts_reset=1 resolutions_reset=1'
}

resolve_preflight_wizard() {
  local request_file="${RUNTIME_DIR}/user_confirmation_request.json"
  local resolution_file="${RUNTIME_DIR}/preflight_resolution.json"
  local semantic_file="${ROOT_DIR}/.harness/state/semantic-state.json"

  if [[ ! -f "${request_file}" ]]; then
    if [[ -f "${semantic_file}" ]]; then
      printf '\n[AEGIS] O contrato já está selado e governado (GOVERNED). Nada a resolver no wizard.\n' >&2
    elif [[ -f "${RUNTIME_DIR}/preflight.json" ]]; then
      printf '\n[AEGIS] Captura e Discovery concluídos. A deliberação semântica ainda precisa compilar as opções do contrato.\n' >&2
    else
      printf '\n[AEGIS] Nenhuma Issue-Contrato pendente de confirmação. Execute: ./aegis "<sua demanda>" primeiro.\n' >&2
    fi
    exit 0
  fi
  local result
  result="$(cat "${request_file}")"

  local req_status
  req_status="$(jq -r '.status // empty' <<< "${result}")"
  if [[ "${req_status}" == "FINALIZED" ]]; then
    printf '\n[AEGIS] O contrato já foi finalizado. Nada a resolver no wizard.\n' >&2
    exit 0
  fi

  local request_schema
  request_schema="$(jq -r '.schema // empty' <<< "${result}")"
  if [[ "${request_schema}" != "aegis.confirmation_request.v5" ]]; then
    result="$(node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" confirmation-request)"
    request_schema="$(jq -r '.schema // empty' <<< "${result}")"
  fi
  if [[ "${request_schema}" != "aegis.confirmation_request.v5" ]]; then
    printf '\n[AEGIS] O pacote de decisão humana não pôde ser atualizado para o schema atual.\n' >&2
    return
  fi

  if [[ ! -t 0 ]] && [[ "${AEGIS_TEST_AUTOMATION:-0}" != "1" ]]; then
    printf '\n[AEGIS] O Wizard interativo exige um terminal TTY para deliberação humana.\n' >&2
    printf '[AEGIS] Simulações automatizadas de stdin via pipe são proibidas para assegurar o consentimento humano real.\n' >&2
    printf '[AEGIS] No chat da IDE, responda diretamente pelo modal interativo; no terminal, execute "./aegis --wizard" de forma interativa.\n' >&2
    return 1
  fi

  local count index question answer_count choice correction answer_id answers='[]'
  local recommended_index recommended_label recommended_effect remaining_answers
  local selected_label final_confirmation attestation
  local requires_recompilation=0 bulk_selected=0
  count="$(jq '.questionCount' <<< "${result}")"
  [[ "${count}" == "$(jq '.questions | length' <<< "${result}")" ]] || fatal 'INVALID_WIZARD_QUESTION_COUNT'
  if (( count > 0 )); then
    requires_recompilation=1
  fi
  printf '\n══════════════════════════════════════════════════════════════\n' >&2
  printf ' AEGIS — Deliberação e Aprovação Humana\n' >&2
  printf '══════════════════════════════════════════════════════════════\n' >&2
  printf 'Contrato: %s\n' "$(jq -r '.title' <<< "${result}")" >&2
  printf 'Digest do rascunho: %s\n' "$(jq -r '.contractDraftDigest' <<< "${result}")" >&2
  printf 'Revisão completa: %s\n' "$(jq -r '.artifactPath' <<< "${result}")" >&2
  printf 'Uma recomendação é apenas uma proposta; nada será selado sem sua confirmação final.\n' >&2
  if (( count == 0 )); then
    printf '\n[AEGIS] Nenhuma decisão material está pendente, mas o contrato ainda exige aprovação humana explícita.\n' >&2
  fi
  for ((index = 0; index < count; index++)); do
    question="$(jq -c ".questions[${index}]" <<< "${result}")"
    answer_count="$(jq '.answers | length' <<< "${question}")"
    recommended_index="$(jq -r '(.recommendedAnswerId) as $recommended | .answers | to_entries[] | select(.value.id == $recommended) | .key + 1' <<< "${question}")"
    recommended_label="$(jq -r '(.recommendedAnswerId) as $recommended | .answers[] | select(.id == $recommended) | .label' <<< "${question}")"
    recommended_effect="$(jq -r '(.recommendedAnswerId) as $recommended | .answers[] | select(.id == $recommended) | .contractEffect' <<< "${question}")"
    printf '\n[%d/%d] [%s] %s\n' "$((index + 1))" "${count}" "$(jq -r '.id' <<< "${question}")" "$(jq -r '.question' <<< "${question}")" >&2
    printf '  Contexto da demanda:\n' >&2
    printf '  %s\n' "$(jq -r '.presentation.context' <<< "${question}")" >&2
    printf '  Por que você precisa decidir:\n' >&2
    printf '  %s\n' "$(jq -r '.presentation.whyHumanDecision' <<< "${question}")" >&2
    printf '  O que muda na prática:\n' >&2
    printf '  %s\n' "$(jq -r '.presentation.observableImpact' <<< "${question}")" >&2
    if [[ "$(jq '.gaps | length' <<< "${question}")" -gt 0 ]]; then
      printf '  Lacunas da demanda:\n' >&2
      jq -r '.gaps[] | "  - \(.)"' <<< "${question}" >&2
    fi
    printf '  Exemplo que demonstra a diferença:\n' >&2
    printf '  - Dado: %s\n' "$(jq -r '.distinguishingCase.given' <<< "${question}")" >&2
    printf '  - Quando: %s\n' "$(jq -r '.distinguishingCase.when' <<< "${question}")" >&2
    jq -r '.distinguishingCase.outcomes[] as $outcome | .answers[] | select(.id == $outcome.answerId) | "  - Se escolher \(.label): \($outcome.then)"' <<< "${question}" >&2
    printf '  Recomendação do Aegis: %s\n' "${recommended_label}" >&2
    printf '  Por quê: %s\n' "$(jq -r '.presentation.recommendationReasoning' <<< "${question}")" >&2
    printf '  Se aceita: %s\n' "${recommended_effect}" >&2
    if [[ "$(jq '.presentation.glossary | length' <<< "${question}")" -gt 0 ]]; then
      printf '  Termos usados:\n' >&2
      jq -r '.presentation.glossary[] | "  - \(.term): \(.meaning)"' <<< "${question}" >&2
    fi
    printf '  O que esta decisão altera no contrato:\n' >&2
    jq -r '.traceability.requirements[] | "  - Requisito \(.id): \(.statement)"' <<< "${question}" >&2
    jq -r '.traceability.acceptanceCases[] | "  - Prova \(.id): dado \(.given) quando \(.when), deve ocorrer: \(.then) [\(.outcomeKind)]"' <<< "${question}" >&2
    jq -r '.traceability.invariants[] | "  - Invariante \(.id): \(.statement) Falha se: \(.falsification)"' <<< "${question}" >&2
    jq -r '.traceability.risks[] | "  - Risco \(.id) [\(.level)/\(.kind)]: \(.statement) Mitigação: \(.mitigation)"' <<< "${question}" >&2
    jq -r '.answers | to_entries[] | "  \(.key + 1)) \(.value.label)" + (if .value.recommended then " [RECOMENDADO — PROPOSTA]" else "" end) + "\n     Motivo: \(.value.rationale)\n     Efeito no contrato: \(.value.contractEffect)"' <<< "${question}" >&2
    printf '  %d) Outra interpretação\n     Descreva uma opção diferente; o contrato voltará para revisão semântica.\n' "$((answer_count + 1))" >&2
    printf '  ── Ação rápida ──\n' >&2
    printf '  A) %s\n     %s\n' \
      "$(jq -r '.bulkRecommendationAction.label' <<< "${result}")" \
      "$(jq -r '.bulkRecommendationAction.description' <<< "${result}")" >&2
    while true; do
      read -r -p "Escolha [${recommended_index} recomendado]: " choice
      choice="${choice:-${recommended_index}}"
      if [[ "${choice}" =~ ^[1-9][0-9]*$ ]] && ((choice >= 1 && choice <= answer_count)); then
        answer_id="$(jq -r ".answers[$((choice - 1))].id" <<< "${question}")"
        answers="$(jq -c --arg questionId "$(jq -r '.id' <<< "${question}")" --arg answerId "${answer_id}" '. + [{questionId:$questionId, answerId:$answerId}]' <<< "${answers}")"
        if [[ "${answer_id}" != "$(jq -r '.recommendedAnswerId' <<< "${question}")" ]]; then
          requires_recompilation=1
        fi
        break
      fi
      if [[ "${choice}" == "$((answer_count + 1))" ]]; then
        read -r -p 'Sua interpretação: ' correction
        [[ -n "${correction}" ]] || { printf '[AEGIS] A interpretação não pode ficar vazia.\n' >&2; continue; }
        answers="$(jq -c --arg questionId "$(jq -r '.id' <<< "${question}")" --arg correction "${correction}" '. + [{questionId:$questionId, correction:$correction}]' <<< "${answers}")"
        requires_recompilation=1
        break
      fi
      if [[ "${choice}" =~ ^[aA]$ ]]; then
        remaining_answers="$(jq -c --argjson start "${index}" '[.questions[$start:][] | {questionId:.id, answerId:.recommendedAnswerId}]' <<< "${result}")"
        answers="$(jq -c --argjson remaining "${remaining_answers}" '. + $remaining' <<< "${answers}")"
        bulk_selected=1
        break
      fi
      printf '[AEGIS] Escolha inválida.\n' >&2
    done
    if (( bulk_selected == 1 )); then
      printf '[AEGIS] Recomendações aplicadas desta pergunta até %d/%d. A confirmação final continua obrigatória.\n' "${count}" "${count}" >&2
      break
    fi
  done

  if (( count > 0 )); then
    printf '\n──────────────────────────────────────────────────────────────\n' >&2
    printf ' Resumo das suas escolhas\n' >&2
    printf '──────────────────────────────────────────────────────────────\n' >&2
    for ((index = 0; index < count; index++)); do
      question="$(jq -c ".questions[${index}]" <<< "${result}")"
      answer_id="$(jq -r ".[$index].answerId // empty" <<< "${answers}")"
      if [[ -n "${answer_id}" ]]; then
        selected_label="$(jq -r --arg answerId "${answer_id}" '.answers[] | select(.id == $answerId) | .label' <<< "${question}")"
      else
        selected_label="Interpretação própria: $(jq -r ".[$index].correction" <<< "${answers}")"
      fi
      printf -- '- %s → %s\n' "$(jq -r '.id' <<< "${question}")" "${selected_label}" >&2
    done
  fi

  if (( requires_recompilation == 1 )); then
    read -r -p 'Confirmar escolhas e enviar o contrato para recompilação? [s/N]: ' final_confirmation
    attestation='DECISIONS_REVIEWED_AND_CONFIRMED'
  else
    read -r -p 'Revisei o contrato e confirmo que ele pode ser selado? [s/N]: ' final_confirmation
    attestation='CONTRACT_REVIEWED_AND_APPROVED'
  fi
  if [[ ! "${final_confirmation}" =~ ^([sS]|[sS][iI][mM]|[yY]|[yY][eE][sS])$ ]]; then
    printf '[AEGIS] Operação cancelada. Nenhuma nova decisão ou aprovação foi gravada.\n' >&2
    return
  fi

  local execution_id contract_draft_digest resolution_staging
  execution_id="$(jq -r '.executionId' <<< "${result}")"
  contract_draft_digest="$(jq -r '.contractDraftDigest' <<< "${result}")"
  resolution_staging="$(mktemp "${RUNTIME_DIR}/.preflight_resolution.XXXXXX")"
  jq -n \
    --arg executionId "${execution_id}" \
    --arg contractDraftDigest "${contract_draft_digest}" \
    --arg attestation "${attestation}" \
    --argjson answers "${answers}" \
    '{schema:"aegis.semantic_resolution.v2",executionId:$executionId,contractDraftDigest:$contractDraftDigest,method:"INTERACTIVE_WIZARD",attestation:$attestation,answers:$answers}' \
    > "${resolution_staging}"
  mv "${resolution_staging}" "${resolution_file}"
  if (( requires_recompilation == 1 )); then
    printf '[AEGIS] Escolhas gravadas e vinculadas ao rascunho. Recompilação semântica necessária antes da assinatura.\n' >&2
    return
  fi
  echo '[AEGIS][IDE] Escolhas e aprovação explícita gravadas. Selando contrato...' >&2
  node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
}

main() {
  [[ $# -ge 1 ]] || fatal 'MISSING_ARGUMENT'

  case "${1}" in
    --approve)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
      ;;
    --verify)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" verify
      ;;
    --semantic-request)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" semantic-request
      ;;
    --jev-request)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" jev-request
      ;;
    --jev-run)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" jev-run
      ;;
    --semantic-run)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" semantic-run
      ;;
    --semantic-compile)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" semantic-compile
      ;;
    --wizard)
      require_command_arity "$@"
      resolve_preflight_wizard
      ;;
    --setup)
      if [[ "$#" -eq 1 ]]; then
        exec node "${ROOT_DIR}/scripts/setup_roles.mjs"
      elif [[ "$#" -eq 2 && "$2" == "--show" ]]; then
        exec node "${ROOT_DIR}/scripts/setup_roles.mjs" --show
      else
        fatal 'INVALID_SETUP_ARITY'
      fi
      ;;
    --status)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" status
      ;;
    --clean)
      require_command_arity "$@"
      clean_command
      ;;
    --help|-h)
      require_command_arity "$@"
      usage
      ;;
    --*)
      fatal 'UNKNOWN_COMMAND'
      ;;
    *)
      # A demand runs the governed flow through the contract draft.
      node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" run "$@"
      run_code=$?
      if [[ ${run_code} -ne 0 ]]; then
        exit ${run_code}
      fi
      if [[ -t 0 && -t 1 && -f "${RUNTIME_DIR}/user_confirmation_request.json" ]]; then
        q_count="$(jq -r '.questionCount // 0' "${RUNTIME_DIR}/user_confirmation_request.json" 2>/dev/null || echo 0)"
        if (( q_count > 0 )); then
          resolve_preflight_wizard
        fi
      fi
      ;;
  esac
}

main "$@"
