#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="working"

if [[ "${1:-}" == "--staged" && $# -eq 1 ]]; then
  mode="staged"
elif [[ $# -ne 0 ]]; then
  echo "[AEGIS][PROOF][FATAL] unknown_contract_evidence_gate_flag:${1}" >&2
  exit 1
fi

source "${ROOT_DIR}/scripts/lib/proof_governance.sh"

if [[ ! -e "${ROOT_DIR}/.harness/proof_registry.json" && ! -e "${ROOT_DIR}/.harness/active_contract_ir.json" ]]; then
  exit 0
fi

if [[ ! -e "${ROOT_DIR}/.harness/proof_registry.json" || ! -e "${ROOT_DIR}/.harness/active_contract_ir.json" ]]; then
  echo "[AEGIS][PROOF][FATAL] incomplete_contract_evidence_metadata" >&2
  exit 1
fi

if [[ "${mode}" == "staged" ]]; then
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate_staged "${ROOT_DIR}"
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_continuity_validate_staged "${ROOT_DIR}"
else
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate \
    "${ROOT_DIR}/.harness/proof_registry.json" \
    "${ROOT_DIR}/.harness/active_contract_ir.json"
fi
