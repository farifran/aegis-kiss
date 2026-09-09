#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${AEGIS_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
mode="working"

if [[ "${1:-}" == "--staged" && $# -eq 1 ]]; then
  mode="staged"
elif [[ $# -ne 0 ]]; then
  echo "[AEGIS][PROOF][FATAL] unknown_contract_evidence_gate_flag:${1}" >&2
  exit 1
fi

semantic_state="${ROOT_DIR}/src/.aegis/semantic-state.json"

for legacy in contract-ir.json clarified-demand.json proof-registry.json; do
  if [[ -e "${ROOT_DIR}/src/.aegis/${legacy}" ]]; then
    echo "[AEGIS][CONTRACT][FATAL] legacy_semantic_metadata_detected" >&2
    exit 1
  fi
done

if [[ ! -e "${semantic_state}" ]]; then
  exit 0
fi

source "${SCRIPT_DIR}/lib/proof_governance.sh"

validate_v2_working() {
  node "${SCRIPT_DIR}/validate_contract_ir_v2.mjs" --root "${ROOT_DIR}" >/dev/null
}

validate_v2_staged() {
  local staged_root target architecture_source rc=0
  staged_root="$(mktemp -d "${TMPDIR:-/tmp}/aegis-staged-contract.XXXXXX")"
  if ! git -C "${ROOT_DIR}" cat-file -e ':src/.aegis/semantic-state.json' 2>/dev/null; then
    echo "[AEGIS][CONTRACT][FATAL] staged_semantic_state_missing" >&2
    rm -rf "${staged_root}"
    return 1
  fi
  mkdir -p "${staged_root}/src/.aegis" "${staged_root}/governance"
  git -C "${ROOT_DIR}" show ':src/.aegis/semantic-state.json' > "${staged_root}/src/.aegis/semantic-state.json"
  jq -e '.schema == "aegis.semantic_state.v1" and (.contract | type == "object") and (.proofRegistry | type == "object")' \
    "${staged_root}/src/.aegis/semantic-state.json" >/dev/null || rc=1
  if [[ "${rc}" -eq 0 ]]; then
    jq '.contract' "${staged_root}/src/.aegis/semantic-state.json" > "${staged_root}/src/.aegis/contract-ir.json"
    git -C "${ROOT_DIR}" show ':governance/architecture.policy.json' > "${staged_root}/governance/architecture.policy.json" || rc=1
  fi
  if [[ "${rc}" -eq 0 ]]; then
    architecture_source="$(jq -r '.origin.sourcePath // empty' "${staged_root}/governance/architecture.policy.json")"
    if ! aegis_proof_materialize_staged_path "${ROOT_DIR}" "${staged_root}" "${architecture_source}"; then
      echo "[AEGIS][CONTRACT][FATAL] staged_architecture_source_missing:${architecture_source}" >&2
      rc=1
    fi
  fi
  if [[ "${rc}" -eq 0 ]]; then
    while IFS= read -r target; do
      [[ -n "${target}" ]] || continue
      if ! aegis_proof_materialize_staged_path "${ROOT_DIR}" "${staged_root}" "${target}"; then
        echo "[AEGIS][CONTRACT][FATAL] staged_authorized_target_missing:${target}" >&2
        rc=1
        break
      fi
    done < <(aegis_contract_targets "${staged_root}/src/.aegis/contract-ir.json")
  fi
  if [[ "${rc}" -eq 0 ]]; then
    node "${SCRIPT_DIR}/validate_contract_ir_v2.mjs" --root "${staged_root}" >/dev/null || rc=1
  fi
  if [[ "${rc}" -eq 0 ]]; then
    aegis_staged_scope_validate "${ROOT_DIR}" "${staged_root}/src/.aegis/contract-ir.json" || rc=1
  fi
  rm -rf "${staged_root}"
  return "${rc}"
}


jq -e '.schema == "aegis.semantic_state.v1" and (.contract.schema | IN("aegis.contract_ir.v2", "aegis.issue_contract.v1"))' "${semantic_state}" >/dev/null 2>&1 || {
  echo "[AEGIS][CONTRACT][FATAL] invalid_semantic_state" >&2
  exit 1
}

if [[ "${mode}" == "staged" ]]; then
  validate_v2_staged
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate_staged "${ROOT_DIR}"
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_continuity_validate_staged "${ROOT_DIR}"
else
  validate_v2_working
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate
fi
