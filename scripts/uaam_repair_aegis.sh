#!/usr/bin/env bash

# =========================================================
# AEGIS — UAAM REPAIR ADAPTER
# =========================================================
#
# Converts a failed UAAM proof into the existing Aegis mutation demand. The
# mutation authority remains run_aegis_loop.sh; this adapter only binds evidence,
# targets and repair constraints to that official executor.
#
# =========================================================

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

request_file="${AEGIS_UAAM_REPAIR_REQUEST:-}"
[[ -n "${request_file}" && -f "${request_file}" ]] || {
  echo "[AEGIS][UAAM_REPAIR][FATAL] missing_repair_request" >&2
  exit 2
}

contract_file="${ROOT_DIR}/.harness/active_contract_ir.json"
[[ -f "${contract_file}" ]] || {
  echo "[AEGIS][UAAM_REPAIR][FATAL] missing_active_contract" >&2
  exit 2
}

brief="$({
  jq -r '
    [
      "UAAM repair request: restore every failed required proof obligation.",
      ("Iteration: " + (.iteration | tostring)),
      ("Failed proof checks: " + ([.failed_checks[].name] | join(", "))),
      ("Evidence: " + (.evidence_file // "not persisted")),
      "The runtime will re-run the complete Evidence Matrix after mutation.",
      "Apply the smallest repair that restores the violated contract properties.",
      "Do not add domain-specific framework code, bypass proof obligations, or change unrelated files."
    ] | join(" ")
  ' "${request_file}"
  jq -r '
    "Authorized contract targets: " + ((.targets // []) | map(select(type == "string" and length > 0)) | join(", "))
  ' "${contract_file}"
})"

target_dir="."
first_target="$(jq -r '(.targets // [])[]? | select(type == "string" and length > 0)' "${contract_file}" | head -1)"
if [[ -n "${first_target}" && "${first_target}" != "null" ]]; then
  target_dir="$(dirname "${first_target}")"
fi

echo "[AEGIS][UAAM_REPAIR] delegating_to=run_aegis_loop.sh target=${target_dir}" >&2
exec bash run_aegis_loop.sh --max 1 --no-fit "${brief}"
