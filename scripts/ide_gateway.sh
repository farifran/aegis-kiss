#!/usr/bin/env bash

# AEGIS — Symbiotic Demand-to-Contract Gateway (Isolated Flow)

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
  ./aegis "<demanda>" Captura a intenção e executa o Discovery (.harness/runtime/preflight.json)
  ./aegis --approve   Confirma e sela o contrato com o Hash Raiz Único (contractDigest)
  ./aegis --verify    Verifica a integridade criptográfica do contrato assinado
  ./aegis --wizard    Abre as decisões pendentes no terminal
  ./aegis --setup     Define supervisor do contrato e agente de código locais
  ./aegis --setup --show  Exibe a atribuição local sem expor chaves
  ./aegis --status    Exibe o status do contrato e da árvore de trabalho
  ./aegis --clean     Remove artefatos transientes e redefine src/index.ts
  ./aegis --help      Exibe esta mensagem de ajuda
EOF
}

preflight_is_valid() {
  node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" validate-preflight >/dev/null 2>&1
}

status_command() {
  local contract_file="${RUNTIME_DIR}/contract.json"
  local preflight_file="${RUNTIME_DIR}/preflight.json"
  local confirmation_file="${RUNTIME_DIR}/user_confirmation_request.json"
  local semantic_file="${ROOT_DIR}/.harness/state/semantic-state.json"
  if [[ -f "${contract_file}" ]]; then
    if [[ ! -f "${preflight_file}" ]] || ! preflight_is_valid; then
      printf '{"status":"INVALID_PREFLIGHT","preflightPath":"%s"}\n' "${preflight_file}"
    elif [[ -f "${confirmation_file}" ]] || [[ ! -f "${semantic_file}" ]]; then
      printf '{"status":"DRAFT_PENDING_CONFIRMATION","draftPath":"%s"}\n' "${contract_file}"
    else
      local digest
      digest="$(node -e '
        const fs = require("fs");
        try {
          const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          console.log(state.contractDigest || "unknown");
        } catch {
          console.log("invalid");
        }
      ' "${semantic_file}")"
      printf '{"status":"GOVERNED","contractDigest":"%s","semanticState":"%s"}\n' "${digest}" "${semantic_file}"
    fi
  elif [[ -f "${preflight_file}" ]]; then
    if preflight_is_valid; then
      printf '{"status":"SEMANTIC_DELIBERATION_REQUIRED","phase":"DISCOVERED","preflightPath":"%s"}\n' "${preflight_file}"
    else
      printf '{"status":"INVALID_PREFLIGHT","preflightPath":"%s"}\n' "${preflight_file}"
    fi
  elif [[ -f "${semantic_file}" ]]; then
    local digest
    digest="$(node -e '
      const fs = require("fs");
      try {
        const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        console.log(state.contractDigest || "unknown");
      } catch {
        console.log("invalid");
      }
    ' "${semantic_file}")"
    printf '{"status":"GOVERNED","contractDigest":"%s","semanticState":"%s"}\n' "${digest}" "${semantic_file}"
  else
    printf '{"status":"IDLE","workspace":"clean"}\n'
  fi
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

  local count index question answer_count choice correction answer_id answers='[]'
  count="$(jq '.questions | length' <<< "${result}")"
  if (( count == 0 )); then
    printf '\n[AEGIS] Nenhuma ambiguidade detectada na demanda. Aprovando contrato...\n' >&2
    local execution_id contract_draft_digest
    execution_id="$(jq -r '.executionId' <<< "${result}")"
    contract_draft_digest="$(jq -r '.contractDraftDigest' <<< "${result}")"
    jq -n \
      --arg executionId "${execution_id}" \
      --arg contractDraftDigest "${contract_draft_digest}" \
      '{schema:"aegis.semantic_resolution.v1",executionId:$executionId,contractDraftDigest:$contractDraftDigest,answers:[]}' \
      > "${resolution_file}"
    node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
    return
  fi
  printf '\n══════════════════════════════════════════════════════════════\n' >&2
  printf ' AEGIS — Decisões Necessárias para Selar o Contrato\n' >&2
  printf '══════════════════════════════════════════════════════════════\n' >&2
  for ((index = 0; index < count; index++)); do
    question="$(jq -c ".questions[${index}]" <<< "${result}")"
    answer_count="$(jq '.answers | length' <<< "${question}")"
    printf '\n[%s] %s\n' "$(jq -r '.id' <<< "${question}")" "$(jq -r '.question' <<< "${question}")" >&2
    jq -r '.answers | to_entries[] | "  \(.key + 1)) \(.value.label)" + (if .value.recommended then " [RECOMENDADO]" else "" end) + "\n     \(.value.rationale)"' <<< "${question}" >&2
    printf '  %d) Outra interpretação\n     Descreva uma opção diferente; o contrato voltará para revisão semântica.\n' "$((answer_count + 1))" >&2
    while true; do
      read -r -p "Escolha [1-$((answer_count + 1))]: " choice
      if [[ "${choice}" =~ ^[1-9][0-9]*$ ]] && ((choice >= 1 && choice <= answer_count)); then
        answer_id="$(jq -r ".answers[$((choice - 1))].id" <<< "${question}")"
        answers="$(jq -c --arg questionId "$(jq -r '.id' <<< "${question}")" --arg answerId "${answer_id}" '. + [{questionId:$questionId, answerId:$answerId}]' <<< "${answers}")"
        break
      fi
      if [[ "${choice}" == "$((answer_count + 1))" ]]; then
        read -r -p 'Sua interpretação: ' correction
        [[ -n "${correction}" ]] || { printf '[AEGIS] A interpretação não pode ficar vazia.\n' >&2; continue; }
        answers="$(jq -c --arg questionId "$(jq -r '.id' <<< "${question}")" --arg correction "${correction}" '. + [{questionId:$questionId, correction:$correction}]' <<< "${answers}")"
        break
      fi
      printf '[AEGIS] Escolha inválida.\n' >&2
    done
  done
  local execution_id contract_draft_digest
  execution_id="$(jq -r '.executionId' <<< "${result}")"
  contract_draft_digest="$(jq -r '.contractDraftDigest' <<< "${result}")"
  jq -n \
    --arg executionId "${execution_id}" \
    --arg contractDraftDigest "${contract_draft_digest}" \
    --argjson answers "${answers}" \
    '{schema:"aegis.semantic_resolution.v1",executionId:$executionId,contractDraftDigest:$contractDraftDigest,answers:$answers}' \
    > "${resolution_file}"
  echo '[AEGIS][IDE] Resolução gravada. Aprovando contrato...' >&2
  node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
}

main() {
  [[ $# -ge 1 ]] || fatal 'MISSING_ARGUMENT'

  case "${1}" in
    --approve|approve)
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
      status_command
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
      # Any demand prompt string triggers the symbiotic draft runner
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" draft "$@"
      ;;
  esac
}

main "$@"
