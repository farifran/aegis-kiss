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

# Repair handover: operational_context.diff. Optimize→repair refine:
# candidate_result holds the prior Repair patch.
jq -e '
  (
    .artifact_snapshot.mode == "repair"
    and (.artifact_snapshot.operational_context.diff | type == "string" and length > 0)
    and (
      .artifact_snapshot.operational_context.files_changed
      | type == "array" and length > 0
      and all(type == "string" and length > 0
        and startswith("/") == false
        and (split("/") | index("..")) == null)
    )
  ) or (
    .artifact_snapshot.mode == "optimize"
    and (.artifact_snapshot.operational_context.candidate_result.diff
      | type == "string" and length > 0 and . != "(no changes)")
    and (
      .artifact_snapshot.operational_context.candidate_result.files_changed
      | type == "array" and length > 0
      and all(type == "string" and length > 0
        and startswith("/") == false
        and (split("/") | index("..")) == null)
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

jq -r '
  if .artifact_snapshot.mode == "optimize" then
    .artifact_snapshot.operational_context.candidate_result.diff
  else
    .artifact_snapshot.operational_context.diff
  end
' "${HANDOVER_FILE}" > "${diff_file}"
jq -r '
  if .artifact_snapshot.mode == "optimize" then
    .artifact_snapshot.operational_context.candidate_result.files_changed[]?
  else
    .artifact_snapshot.operational_context.files_changed[]?
  end
' "${HANDOVER_FILE}" | sort -u > "${expected_files}"

# Prefer clean apply; fall back to 3-way (optimize→repair refine on dirty-ish trees).
if ! git -C "${EXECUTION_SURFACE}" apply --check "${diff_file}" 2>/dev/null; then
  if git -C "${EXECUTION_SURFACE}" apply --3way --check "${diff_file}" 2>/dev/null; then
    git -C "${EXECUTION_SURFACE}" apply --3way "${diff_file}" \
      || candidate_fatal "candidate_diff_apply_3way_failed"
  else
    git -C "${EXECUTION_SURFACE}" apply --check "${diff_file}" 2>&1 \
      | head -n 20 >&2 || true
    candidate_fatal "candidate_diff_check_failed"
  fi
else
  git -C "${EXECUTION_SURFACE}" apply "${diff_file}" \
    || candidate_fatal "candidate_diff_apply_failed"
fi

git -C "${EXECUTION_SURFACE}" diff --name-only HEAD -- \
  | sort -u > "${actual_files}"

# Allow actual ⊆ expected? No — require equality, but ignore empty noise.
if ! cmp -s "${expected_files}" "${actual_files}"; then
  echo "[AEGIS][CANDIDATE][DIAG] expected_files:" >&2
  cat "${expected_files}" >&2 || true
  echo "[AEGIS][CANDIDATE][DIAG] actual_files:" >&2
  cat "${actual_files}" >&2 || true
  candidate_fatal "candidate_files_changed_mismatch"
fi

echo "[AEGIS][CANDIDATE] Repair candidate materialized" >&2
