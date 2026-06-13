#!/usr/bin/env bash

set -Eeuo pipefail

readonly HANDOVER_FILE="${1:-}"
readonly EXECUTION_SURFACE="${2:-}"

candidate_fatal() {
  echo "[AEGIS][CANDIDATE][FATAL] $*" >&2
  exit 1
}

[[ -f "${HANDOVER_FILE}" ]] \
  || candidate_fatal "missing_handover_file"

[[ -d "${EXECUTION_SURFACE}" ]] \
  || candidate_fatal "missing_execution_surface"

jq -e '
  .artifact_snapshot.mode == "repair"
  and (.artifact_snapshot.diff | type == "string" and length > 0)
  and (
    .artifact_snapshot.files_changed
    | type == "array"
    and length > 0
    and all(
      type == "string"
      and length > 0
      and startswith("/") == false
      and (split("/") | index("..")) == null
    )
  )
' "${HANDOVER_FILE}" >/dev/null 2>&1 \
  || candidate_fatal "invalid_repair_candidate_contract"

diff_file="$(mktemp)"
expected_files="$(mktemp)"
actual_files="$(mktemp)"

cleanup() {
  rm -f "${diff_file}" "${expected_files}" "${actual_files}" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

jq -r '.artifact_snapshot.diff' "${HANDOVER_FILE}" > "${diff_file}"
jq -r '.artifact_snapshot.files_changed[]' "${HANDOVER_FILE}" \
  | sort -u > "${expected_files}"

git -C "${EXECUTION_SURFACE}" apply --check "${diff_file}" \
  || candidate_fatal "candidate_diff_check_failed"

git -C "${EXECUTION_SURFACE}" apply "${diff_file}" \
  || candidate_fatal "candidate_diff_apply_failed"

git -C "${EXECUTION_SURFACE}" diff --name-only HEAD -- \
  | sort -u > "${actual_files}"

cmp -s "${expected_files}" "${actual_files}" \
  || candidate_fatal "candidate_files_changed_mismatch"

echo "[AEGIS][CANDIDATE] Repair candidate materialized" >&2
