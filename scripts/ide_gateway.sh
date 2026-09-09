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
  rm -rf "${ROOT_DIR}/src/.aegis"
  mkdir -p "${RUNTIME_DIR}"
  printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${ROOT_DIR}/src/index.ts"
  echo '[AEGIS][IDE] clean=PASS source_reset=1'
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 1; }

  case "${1}" in
    approve|resume)
      node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
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
