#!/usr/bin/env bash

set -Eeuo pipefail

readonly ARTIFACT_FILE="${1:-}"
readonly REPOSITORY_ROOT="${2:-}"

promotion_fatal() {
  echo "[AEGIS][PROMOTION][FATAL] $*" >&2
  exit 1
}

[[ -f "${ARTIFACT_FILE}" ]] \
  || promotion_fatal "missing_validation_artifact"

[[ -d "${REPOSITORY_ROOT}/.git" ]] \
  || promotion_fatal "missing_repository_root"

jq -e '
  .mode == "validation"
  and .verdict == "accepted"
  and (
    .validated_candidate
    | type == "object"
    and .source_mode == "optimize"
    and (.diff | type == "string" and length > 0)
    and (
      .files_changed
      | type == "array"
      and length > 0
      and all(
        type == "string"
        and length > 0
        and startswith("/") == false
        and (split("/") | index("..")) == null
      )
    )
  )
' "${ARTIFACT_FILE}" >/dev/null 2>&1 \
  || promotion_fatal "invalid_accepted_validation_artifact"

diff_file="$(mktemp)"
files_file="$(mktemp)"
diff_files_file="$(mktemp)"

cleanup() {
  rm -f "${diff_file}" "${files_file}" "${diff_files_file}" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT
handover_file="${REPOSITORY_ROOT}/.harness/runtime/epistemic_handover.json"
if [[ -f "${handover_file}" ]] && jq -e '.artifact_snapshot.candidate_result.diff' "${handover_file}" >/dev/null 2>&1; then
  jq -r '.artifact_snapshot.candidate_result.diff | gsub("\\\\n"; "\n") | gsub("\\\\\\\\"; "\\")' "${handover_file}" > "${diff_file}"
else
  jq -r '.validated_candidate.diff' "${ARTIFACT_FILE}" > "${diff_file}"
fi

jq -r '.validated_candidate.files_changed[]' "${ARTIFACT_FILE}" \
  | sort -u > "${files_file}"

git -C "${REPOSITORY_ROOT}" apply --numstat "${diff_file}" \
  | cut -f3- \
  | sort -u > "${diff_files_file}" \
  || promotion_fatal "validated_candidate_paths_unreadable"

cmp -s "${files_file}" "${diff_files_file}" \
  || promotion_fatal "validated_candidate_files_changed_mismatch"

while IFS= read -r changed_file; do
  git -C "${REPOSITORY_ROOT}" diff --quiet HEAD -- "${changed_file}" \
    || promotion_fatal "promotion_target_is_dirty: ${changed_file}"
done < "${files_file}"

git -C "${REPOSITORY_ROOT}" apply --check "${diff_file}" \
  || promotion_fatal "validated_candidate_check_failed"

git -C "${REPOSITORY_ROOT}" apply "${diff_file}" \
  || promotion_fatal "validated_candidate_apply_failed"

echo "[AEGIS][PROMOTION] Validated candidate applied" >&2
