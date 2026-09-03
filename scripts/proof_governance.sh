#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AEGIS_ROOT_DIR="${ROOT_DIR}"
export AEGIS_ROOT_DIR

source "${ROOT_DIR}/scripts/lib/proof_governance.sh"
aegis_proof_governance_validate
