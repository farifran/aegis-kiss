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
  ./aegis --verify    Executa as provas físicas do tribunal e emite recibo PROVEN
  ./aegis --wizard    Abre as decisões pendentes no terminal
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
  local semantic_file="${ROOT_DIR}/.harness/state/semantic-state.json"
  local receipt_file="${RUNTIME_DIR}/verification_receipt.json"

  if [[ -f "${semantic_file}" ]]; then
    local digest
    digest="$(node -e '
      const fs = require("fs");
      try {
        const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        console.log(state.digests?.contractSemanticDigest || "unknown");
      } catch {
        console.log("invalid");
      }
    ' "${semantic_file}")"

    if [[ -f "${receipt_file}" ]]; then
      local receipt_digest
      receipt_digest="$(node -e '
        const fs = require("fs");
        try {
          const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          if (r.status === "PROVEN" && r.contractDigest === process.argv[2]) {
            console.log(r.receiptDigest || "proven");
          } else {
            console.log("");
          }
        } catch {
          console.log("");
        }
      ' "${receipt_file}" "${digest}")"

      if [[ -n "${receipt_digest}" ]]; then
        printf '{"status":"PROVEN","contractDigest":"%s","receiptDigest":"%s","semanticState":"%s"}\n' "${digest}" "${receipt_digest}" "${semantic_file}"
        return
      fi
    fi

    printf '{"status":"GOVERNED","contractDigest":"%s","semanticState":"%s"}\n' "${digest}" "${semantic_file}"
  elif [[ -f "${contract_file}" ]]; then
    if [[ ! -f "${preflight_file}" ]] || ! preflight_is_valid; then
      printf '{"status":"INVALID_PREFLIGHT","preflightPath":"%s"}\n' "${preflight_file}"
    else
      printf '{"status":"DRAFT_PENDING_CONFIRMATION","draftPath":"%s"}\n' "${contract_file}"
    fi
  elif [[ -f "${preflight_file}" ]]; then
    if preflight_is_valid; then
      printf '{"status":"SEMANTIC_DELIBERATION_REQUIRED","phase":"DISCOVERED","preflightPath":"%s"}\n' "${preflight_file}"
    else
      printf '{"status":"INVALID_PREFLIGHT","preflightPath":"%s"}\n' "${preflight_file}"
    fi
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

  if [[ -f "${semantic_file}" ]]; then
    printf '\n[AEGIS] O contrato já está selado e governado (GOVERNED). Nada a resolver no wizard.\n' >&2
    exit 0
  fi

  if [[ ! -f "${request_file}" ]]; then
    if [[ -f "${RUNTIME_DIR}/preflight.json" ]]; then
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
    local execution_id
    execution_id="$(jq -r '.executionId' <<< "${result}")"
    jq -n \
      --arg executionId "${execution_id}" \
      '{schema:"aegis.preflight_resolution.v2",executionId:$executionId,answers:[]}' \
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
  local execution_id
  execution_id="$(jq -r '.executionId' <<< "${result}")"
  jq -n \
    --arg executionId "${execution_id}" \
    --argjson answers "${answers}" \
    '{schema:"aegis.preflight_resolution.v2",executionId:$executionId,answers:$answers}' \
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
    --wizard)
      require_command_arity "$@"
      resolve_preflight_wizard
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
