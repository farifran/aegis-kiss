#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${AEGIS_ROOT_DIR:-${SCRIPT_ROOT}}"
cd "${ROOT_DIR}"
# shellcheck disable=SC1091
source "${SCRIPT_ROOT}/scripts/lib/proof_governance.sh"

profile="fast"
changed=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --changed) changed="${2:-}"; shift 2 ;;
    -h|--help)
      printf 'Uso: ./scripts/proof_runner.sh [--profile auto|fast|targeted|release|forensic] [--changed "arquivo\\n..."]\n'
      exit 0
      ;;
    *)
      echo "[AEGIS][PROOF][FATAL] unknown_runner_flag:$1" >&2
      exit 1
      ;;
  esac
done

case "${profile}" in
  auto|fast|targeted|release|forensic) ;;
  *) echo "[AEGIS][PROOF][FATAL] unknown_proof_profile:${profile}" >&2; exit 1 ;;
esac

if [[ "${AEGIS_PROOF_GOVERNANCE_VALIDATED:-0}" != "1" ]]; then
  AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate \
    "$(aegis_proof_registry_path)" \
    "$(aegis_proof_contract_path)" >/dev/null
fi

if [[ -z "${changed}" ]]; then
  changed="$(git status --porcelain --untracked-files=all | cut -c4- | grep -v '^$' || true)"
fi

if [[ "${profile}" == "auto" ]]; then
  profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change \
    "$(aegis_proof_registry_path)" "${changed}" | jq -r '.profile')"
  case "${profile}" in
    fast|targeted|release|forensic) ;;
    *) echo "[AEGIS][PROOF][FATAL] automatic_profile_resolution_failed" >&2; exit 1 ;;
  esac
  printf '%s\n' "[AEGIS][PROOF] selected profile=${profile} from diff"
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

    command_string="$(jq -r --arg id "${proof_id}" '.proofs[] | select(.id == $id) | .command' "$(aegis_proof_registry_path)")"
    if [[ "${command_string}" =~ ^npm[[:space:]]+run[[:space:]]+([a-zA-Z0-9:_-]+)$ ]]; then
      command=(npm run "${BASH_REMATCH[1]}")
    elif [[ "${command_string}" =~ ^bash[[:space:]]+([a-zA-Z0-9_./-]+)$ ]]; then
      command=(bash "${BASH_REMATCH[1]}")
    elif [[ "${command_string}" =~ ^node[[:space:]]+--import[[:space:]]+tsx[[:space:]]+([a-zA-Z0-9_./-]+\.ts)$ ]]; then
      command=(node --import tsx "${BASH_REMATCH[1]}")
    else
      echo "[AEGIS][PROOF][FATAL] untrusted_proof_command:${proof_id}" >&2
      exit 1
    fi

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
