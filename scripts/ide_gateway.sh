#!/usr/bin/env bash

# AEGIS KISS — Local IDE Gateway (0 tokens in Discovery & Verification)

set -Eeuo pipefail

ROOT_DIR="${AEGIS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export AEGIS_ROOT="${ROOT_DIR}"

main() {
  if [[ $# -eq 0 ]]; then
    exec node "${ROOT_DIR}/scripts/aegis_cli.mjs" help
  fi

  case "${1}" in
    brief|verify-contract|--verify-contract|--verify|check|--check|status|--status|clean|--clean|help|--help|-h)
      exec node "${ROOT_DIR}/scripts/aegis_cli.mjs" "$@"
      ;;
    --issue)
      shift
      exec node "${ROOT_DIR}/scripts/aegis_cli.mjs" brief --issue "$@"
      ;;
    --*)
      printf '[AEGIS][ERROR] unknown_command:%s\n' "${1}" >&2
      exit 1
      ;;
    *)
      exec node "${ROOT_DIR}/scripts/aegis_cli.mjs" brief "$@"
      ;;
  esac
}

main "$@"
