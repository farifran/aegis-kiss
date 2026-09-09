#!/usr/bin/env bash

# AEGIS — Symbiotic Demand-to-Contract Gateway (Isolated Flow)

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"

fatal() { printf '[AEGIS][IDE][FATAL] %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Aegis — Fluxo Simbiótico Demanda até o Contrato:
  ./aegis "<demanda>"      Gera a Issue-Contrato pré-cozinhada (.harness/runtime/contract.md)
  ./aegis approve          Confirma e sela o contrato com o Hash Raiz Único (contractDigest)
  ./aegis status           Exibe o status do contrato e da árvore de trabalho
  ./aegis clean            Remove artefatos transientes e redefine src/index.ts
  ./aegis help             Exibe esta mensagem de ajuda
EOF
}

status_command() {
  local contract_file="${RUNTIME_DIR}/contract.json"
  local semantic_file="${ROOT_DIR}/src/.aegis/semantic-state.json"

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
    printf '{"status":"GOVERNED","contractDigest":"%s","semanticState":"%s"}\n' "${digest}" "${semantic_file}"
  elif [[ -f "${contract_file}" ]]; then
    printf '{"status":"DRAFT_PENDING_CONFIRMATION","draftPath":"%s"}\n' "${contract_file}"
  else
    printf '{"status":"IDLE","workspace":"clean"}\n'
  fi
}

clean_command() {
  rm -rf "${RUNTIME_DIR}"
  mkdir -p "${RUNTIME_DIR}"
  [[ -d "${ROOT_DIR}/src" && ! -L "${ROOT_DIR}/src" ]] || fatal 'invalid_source_directory'
  find "${ROOT_DIR}/src" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${ROOT_DIR}/src/index.ts"
  echo '[AEGIS][IDE] clean=PASS source_reset=1'
}

resolve_preflight_wizard() {
  local request_file="${RUNTIME_DIR}/user_confirmation_request.json"
  local resolution_file="${RUNTIME_DIR}/preflight_resolution.json"
  local selections="${RUNTIME_DIR}/preflight_wizard_selections.json"

  [[ -f "${request_file}" ]] || fatal 'no_pending_user_confirmation'
  local result
  result="$(cat "${request_file}")"

  : > "${selections}"
  local count index question answer_count choice correction answer_id
  count="$(jq '.questions | length' <<< "${result}")"
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
        jq -cn --arg questionId "$(jq -r '.id' <<< "${question}")" --arg answerId "${answer_id}" '{questionId:$questionId,action:"SELECT_ANSWER",answerId:$answerId}' >> "${selections}"
        break
      fi
      if [[ "${choice}" == "$((answer_count + 1))" ]]; then
        read -r -p 'Sua interpretação: ' correction
        [[ -n "${correction}" ]] || { printf '[AEGIS] A interpretação não pode ficar vazia.\n' >&2; continue; }
        jq -cn --arg questionId "$(jq -r '.id' <<< "${question}")" --arg correction "${correction}" '{questionId:$questionId,action:"CORRECT_INTERPRETATION",correction:$correction}' >> "${selections}"
        break
      fi
      printf '[AEGIS] Escolha inválida.\n' >&2
    done
  done
  local decision_digest
  decision_digest="$(jq -r '.executionId // .decisionDigest // .confirmation.confirmationId' <<< "${result}")"
  jq -s \
    --arg decisionDigest "${decision_digest}" \
    --arg promptDigest "${decision_digest}" \
    --arg confirmationId "${decision_digest}" \
    --argjson selectedAtEpochMs "$(node -e 'console.log(Date.now())')" \
    '{schema:"aegis.preflight_resolution.v2",decisionDigest:$decisionDigest,preflightPromptDigest:$promptDigest,confirmation:{channel:"IDE_TERMINAL_WIZARD",confirmationId:$confirmationId,selectedAtEpochMs:$selectedAtEpochMs},answers:.}' \
    "${selections}" > "${resolution_file}"
  rm -f "${selections}"
  echo '[AEGIS][IDE] Resolução gravada. Aprovando contrato...' >&2
  node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 1; }

  case "${1}" in
    approve|resume)
      node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
      ;;
    wizard)
      resolve_preflight_wizard
      ;;
    status)
      status_command
      ;;
    clean)
      clean_command
      ;;
    help|--help|-h)
      usage
      ;;
    *)
      # Any demand prompt string triggers the symbiotic draft runner
      node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" draft "$@"
      ;;
  esac
}

main "$@"
