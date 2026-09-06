#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AEGIS_ROOT_DIR="${ROOT_DIR}"
export AEGIS_ROOT_DIR

source "${ROOT_DIR}/scripts/lib/proof_governance.sh"

semantic_state="${ROOT_DIR}/src/.aegis/semantic-state.json"

for legacy in contract-ir.json clarified-demand.json proof-registry.json; do
  if [[ -e "${ROOT_DIR}/src/.aegis/${legacy}" ]]; then
    echo "[AEGIS][PROOF][FATAL] legacy_semantic_metadata_detected" >&2
    exit 1
  fi
done

# A clean universal baseline has no project-specific proof registry yet.  That
# is a valid state; governance becomes mandatory as soon as a project adds
# one side of the contract/evidence pair.
if [[ ! -e "${semantic_state}" ]]; then
  echo "[AEGIS][PROOF] governance: NOT_APPLICABLE (no project evidence metadata)"
  exit 0
fi

aegis_proof_governance_validate
