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

if [[ ! -e "${ROOT_DIR}/.harness/proof_registry.json" && ! -e "${ROOT_DIR}/.harness/active_contract_ir.json" ]]; then
  exit 0
fi

source "${SCRIPT_DIR}/lib/proof_governance.sh"

validate_v2_working() {
  node "${SCRIPT_DIR}/validate_contract_ir_v2.mjs" --root "${ROOT_DIR}" >/dev/null
}

validate_v2_staged() {
  local staged_root target architecture_source rc=0
  staged_root="$(mktemp -d "${TMPDIR:-/tmp}/aegis-staged-contract.XXXXXX")"
  for target in \
    .harness/active_contract_ir.json \
    .harness/active_clarified_demand.json \
    .harness/proof_registry.json \
    governance/architecture.policy.json; do
    if ! git -C "${ROOT_DIR}" cat-file -e ":${target}" 2>/dev/null; then
      echo "[AEGIS][CONTRACT][FATAL] staged_contract_input_missing:${target}" >&2
      rc=1
      break
    fi
    mkdir -p "${staged_root}/$(dirname "${target}")"
    git -C "${ROOT_DIR}" show ":${target}" > "${staged_root}/${target}"
  done
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
    done < <(aegis_contract_targets "${staged_root}/.harness/active_contract_ir.json")
  fi
  if [[ "${rc}" -eq 0 ]]; then
    node "${SCRIPT_DIR}/validate_contract_ir_v2.mjs" --root "${staged_root}" >/dev/null || rc=1
  fi
  rm -rf "${staged_root}"
  return "${rc}"
}


if [[ ! -e "${ROOT_DIR}/.harness/proof_registry.json" || ! -e "${ROOT_DIR}/.harness/active_contract_ir.json" ]]; then
  echo "[AEGIS][PROOF][FATAL] incomplete_contract_evidence_metadata" >&2
  exit 1
fi

if ! jq -e '.schema == "aegis.contract_ir.v2"' "${ROOT_DIR}/.harness/active_contract_ir.json" >/dev/null 2>&1; then
  echo "[AEGIS][CONTRACT][FATAL] legacy_contract_ir_not_supported" >&2
  exit 1
fi

if [[ "${mode}" == "staged" ]]; then
  validate_v2_staged
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate_staged "${ROOT_DIR}"
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_continuity_validate_staged "${ROOT_DIR}"
else
  validate_v2_working
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate \
    "${ROOT_DIR}/.harness/proof_registry.json" \
    "${ROOT_DIR}/.harness/active_contract_ir.json"
fi
