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
repair_result="${AEGIS_UAAM_REPAIR_RESULT:-${AEGIS_UAAM_LOOP_DIR:-${ROOT_DIR}/.harness/runtime/uaam_loop}/iteration-${AEGIS_UAAM_ITERATION:-0}/repair_result.json}"
mkdir -p "$(dirname "${repair_result}")"

set +e
bash run_aegis_loop.sh --max 1 --no-fit "${brief}"
provider_rc=$?
set -e

targets_json="${AEGIS_UAAM_TARGETS:-$(jq -c '(.targets // [])' "${contract_file}")}"
provider_result="${AEGIS_UAAM_LOOP_DIR:-${ROOT_DIR}/.harness/runtime/uaam_loop}/iteration-${AEGIS_UAAM_ITERATION:-0}/provider_result.json"
changed_files='[]'
if [[ -s "${provider_result}" ]]; then
  changed_files="$(jq -c '(.changedFiles // .scope // []) | map(select(type == "string" and length > 0))' "${provider_result}" 2>/dev/null || printf '[]')"
fi
if [[ "${changed_files}" == "[]" ]] && git rev-parse --show-toplevel >/dev/null 2>&1; then
  changed_files="$(git diff --name-only HEAD -- $(jq -r '.[]' <<<"${targets_json}") 2>/dev/null | jq -R -s 'split("\n") | map(select(length > 0))' )"
fi

scope_verified=false
if jq -n -e --argjson changed "${changed_files}" --argjson targets "${targets_json}" '
  ($changed | length > 0)
  and ($changed | all(. as $file | $targets | index($file) != null))
' >/dev/null 2>&1; then
  scope_verified=true
fi

diff_hash=""
if [[ "${changed_files}" != "[]" ]]; then
  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    diff_hash="$(git diff --binary HEAD -- $(jq -r '.[]' <<<"${changed_files}") 2>/dev/null | shasum -a 256 | awk '{print $1}')"
  else
    diff_hash="$(jq -r '.[]' <<<"${changed_files}" | while IFS= read -r file; do shasum -a 256 "${file}" 2>/dev/null || true; done | shasum -a 256 | awk '{print $1}')"
  fi
fi

receipt_status="FAILED"
if [[ "${provider_rc}" -eq 0 && "${scope_verified}" == "true" && -n "${diff_hash}" ]]; then
  receipt_status="APPLIED"
fi
jq -n \
  --arg status "${receipt_status}" \
  --argjson changedFiles "${changed_files}" \
  --arg diffHash "${diff_hash}" \
  --argjson scopeVerified "${scope_verified}" \
  --argjson providerExitCode "${provider_rc}" \
  '{version:"uaam-repair-result-v1",status:$status,changedFiles:$changedFiles,diffHash:$diffHash,scopeVerified:$scopeVerified,providerExitCode:$providerExitCode}' \
  > "${repair_result}"

exit "${provider_rc}"
