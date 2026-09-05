#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AEGIS_ROOT_DIR="${ROOT_DIR}"
export AEGIS_ROOT_DIR

source "${ROOT_DIR}/scripts/lib/proof_governance.sh"

registry_file="${ROOT_DIR}/src/.aegis/proof-registry.json"
contract_file="${ROOT_DIR}/src/.aegis/contract-ir.json"

# A clean universal baseline has no project-specific proof registry yet.  That
# is a valid state; governance becomes mandatory as soon as a project adds
# one side of the contract/evidence pair.
if [[ ! -e "${registry_file}" && ! -e "${contract_file}" ]]; then
  echo "[AEGIS][PROOF] governance: NOT_APPLICABLE (no project evidence metadata)"
  exit 0
fi

if [[ ! -e "${registry_file}" || ! -e "${contract_file}" ]]; then
  echo "[AEGIS][PROOF][FATAL] incomplete_contract_evidence_metadata" >&2
  exit 1
fi

aegis_proof_governance_validate "${registry_file}" "${contract_file}"
