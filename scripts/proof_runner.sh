#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
# shellcheck disable=SC1091
source scripts/lib/proof_governance.sh

profile="fast"
changed=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --changed) changed="${2:-}"; shift 2 ;;
    -h|--help)
      printf 'Uso: ./scripts/proof_runner.sh [--profile fast|targeted|release|forensic] [--changed "arquivo\\n..."]\n'
      exit 0
      ;;
    *)
      echo "[AEGIS][PROOF][FATAL] unknown_runner_flag:$1" >&2
      exit 1
      ;;
  esac
done

case "${profile}" in
  fast|targeted|release|forensic) ;;
  *) echo "[AEGIS][PROOF][FATAL] unknown_proof_profile:${profile}" >&2; exit 1 ;;
esac

AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate \
  "$(aegis_proof_registry_path)" \
  "$(aegis_proof_contract_path)" >/dev/null

if [[ -z "${changed}" ]]; then
  changed="$(git status --porcelain --untracked-files=all | cut -c4- | grep -v '^$' || true)"
fi

plan="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_plan "${profile}" \
  "$(aegis_proof_registry_path)" "${changed}")"
runtime_dir="${AEGIS_RUNTIME_DIR:-${ROOT_DIR}/.harness/runtime}"
mkdir -p "${runtime_dir}/evidence_cache"

printf '%s\n' "${plan}" | jq -r '.proofs[] | [.id, .executionKey] | @tsv' \
  | while IFS=$'\t' read -r proof_id execution_key; do
    [[ -n "${proof_id}" ]] || continue
    files="$(jq -r --arg id "${proof_id}" '.proofs[] | select(.id == $id) | .targets[]' "$(aegis_proof_registry_path)")"
    key="$(AEGIS_ROOT_DIR="${ROOT_DIR}" AEGIS_RUNTIME_DIR="${runtime_dir}" \
      aegis_proof_cache_key "${proof_id}" "${profile}" \
      "$(aegis_proof_contract_path)" \
      "$(aegis_proof_registry_path)" "${files}")"
    execution_files="$(jq -r --arg execution "${execution_key}" \
      '.proofs[] | select(.executionKey == $execution and .status != "retired") | .targets[]' \
      "$(aegis_proof_registry_path)" | sort -u)"
    execution_digest="$(AEGIS_ROOT_DIR="${ROOT_DIR}" \
      aegis_proof_execution_cache_key "${execution_key}" "${profile}" \
      "$(aegis_proof_contract_path)" "$(aegis_proof_registry_path)" "${execution_files}")"
    execution_marker="${runtime_dir}/evidence_cache/${execution_key}.${execution_digest}.done"
    if [[ -f "${execution_marker}" ]]; then
      AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_store \
        "${key}" "${proof_id}" PROVEN "${execution_key}" >/dev/null
      printf '%s\n' "[AEGIS][PROOF] cached execution=${execution_key} proof=${proof_id}"
      continue
    fi

    case "${execution_key}" in
      typecheck)
        command=(npm run aegis:typecheck)
        ;;
      engine-suite)
        command=(npm test)
        ;;
      *)
        echo "[AEGIS][PROOF][FATAL] execution_key_not_allowlisted:${execution_key}" >&2
        exit 1
        ;;
    esac

    printf '%s\n' "[AEGIS][PROOF] run execution=${execution_key} proof=${proof_id}"
    if "${command[@]}"; then
      AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_store \
        "${key}" "${proof_id}" PROVEN "${execution_key}" >/dev/null
      : > "${execution_marker}"
    else
      AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_store \
        "${key}" "${proof_id}" DISPROVEN "${execution_key}" >/dev/null || true
      echo "[AEGIS][PROOF][FAIL] execution=${execution_key} proof=${proof_id}" >&2
      exit 1
    fi
  done

echo "[AEGIS][PROOF] execution: PASS"
