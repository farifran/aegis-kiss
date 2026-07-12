#!/usr/bin/env bash

set -Eeuo pipefail

readonly ARTIFACT_FILE="${1:-}"
readonly REPOSITORY_ROOT="${2:-}"

promotion_fatal() {
  echo "[AEGIS][PROMOTION][FATAL] $*" >&2
  exit 1
}

# Structured diagnostic: never hides the operator-actionable detail behind
# a single opaque token. The pipeline breadcrumb still records the summary
# via runtime's validated_candidate_promotion_failed wrapper.
promotion_diag() {
  local code="$1"
  shift
  echo "[AEGIS][PROMOTION][FATAL] ${code}" >&2
  if [[ "$#" -gt 0 ]]; then
    printf '[AEGIS][PROMOTION][DIAG] %s\n' "$@" >&2
  fi
  exit 1
}

[[ -f "${ARTIFACT_FILE}" ]] \
  || promotion_fatal "missing_validation_artifact"

[[ -d "${REPOSITORY_ROOT}/.git" ]] \
  || promotion_fatal "missing_repository_root"

# Verdict envelope: "accepted" is the normal path. "operator_forced" is
# accepted ONLY while the runtime's explicit --force-apply override is
# active in the environment; every structural rail below (path jail,
# files_changed cross-check, dirty-target refusal, atomic apply) applies
# identically to both paths.
if ! jq -e '
  .mode == "validation"
  and (
    .verdict == "accepted"
    or (env.AEGIS_FORCE_APPLY == "true" and .verdict == "operator_forced")
  )
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
' "${ARTIFACT_FILE}" >/dev/null 2>&1; then
  shape="$(
    jq -c '{
      mode: .mode,
      verdict: .verdict,
      force_apply: (env.AEGIS_FORCE_APPLY // "false"),
      has_candidate: (.validated_candidate | type == "object"),
      source_mode: (.validated_candidate.source_mode // null),
      diff_len: ((.validated_candidate.diff // "") | length),
      files_changed: (.validated_candidate.files_changed // null)
    }' "${ARTIFACT_FILE}" 2>/dev/null || echo '{}'
  )"
  promotion_diag "invalid_accepted_validation_artifact" "shape=${shape}"
fi

diff_file="$(mktemp)"
files_file="$(mktemp)"
diff_files_file="$(mktemp)"
check_err_file="$(mktemp)"

cleanup() {
  rm -f "${diff_file}" "${files_file}" "${diff_files_file}" "${check_err_file}" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

# The validation artifact is the single source of truth for the promoted
# diff. The executor has already enforced that it matches the epistemic
# handover candidate, so no secondary state file is consulted here.
jq -r '.validated_candidate.diff' "${ARTIFACT_FILE}" > "${diff_file}"

jq -r '.validated_candidate.files_changed[]' "${ARTIFACT_FILE}" \
  | sort -u > "${files_file}"

if ! git -C "${REPOSITORY_ROOT}" apply --numstat "${diff_file}" \
  > "${diff_files_file}.raw" 2>"${check_err_file}"; then
  promotion_diag "validated_candidate_paths_unreadable" \
    "git_apply_numstat_failed" \
    "stderr=$(tr '\n' ' ' < "${check_err_file}")"
fi

cut -f3- "${diff_files_file}.raw" | sort -u > "${diff_files_file}"
rm -f "${diff_files_file}.raw"

if ! cmp -s "${files_file}" "${diff_files_file}"; then
  promotion_diag "validated_candidate_files_changed_mismatch" \
    "declared=$(tr '\n' ',' < "${files_file}")" \
    "from_diff=$(tr '\n' ',' < "${diff_files_file}")"
fi

while IFS= read -r changed_file; do
  [[ -n "${changed_file}" ]] || continue
  if ! git -C "${REPOSITORY_ROOT}" diff --quiet HEAD -- "${changed_file}"; then
    dirty_stat="$(
      git -C "${REPOSITORY_ROOT}" status --short -- "${changed_file}" 2>/dev/null \
        || echo "status_unavailable"
    )"
    # Opt-in: reset dirty targets to HEAD so a clean apply can proceed.
    # Default remains refuse — never silently discard operator work.
    if [[ "${AEGIS_PROMOTION_RESET_DIRTY:-false}" == "true" ]]; then
      echo "[AEGIS][PROMOTION][WARN] resetting dirty target to HEAD: ${changed_file} (${dirty_stat})" >&2
      git -C "${REPOSITORY_ROOT}" checkout -- "${changed_file}" \
        || promotion_diag "promotion_dirty_reset_failed" "file=${changed_file}"
    else
      promotion_diag "promotion_target_is_dirty" \
        "file=${changed_file}" \
        "status=${dirty_stat}" \
        "hint=commit_or_stash_or_AEGIS_PROMOTION_RESET_DIRTY=true"
    fi
  fi
done < "${files_file}"

# Dry-check before apply so a rejected hunk never partially mutates.
if ! git -C "${REPOSITORY_ROOT}" apply --check "${diff_file}" 2>"${check_err_file}"; then
  promotion_diag "validated_candidate_apply_check_failed" \
    "stderr=$(tr '\n' ' ' < "${check_err_file}")" \
    "hint=candidate_diff_does_not_apply_cleanly_to_HEAD"
fi

# git apply is all-or-nothing after --check: it verifies every hunk before
# touching the worktree.
if ! git -C "${REPOSITORY_ROOT}" apply "${diff_file}" 2>"${check_err_file}"; then
  promotion_diag "validated_candidate_apply_failed" \
    "stderr=$(tr '\n' ' ' < "${check_err_file}")"
fi

echo "[AEGIS][PROMOTION] Validated candidate applied" >&2
echo "[AEGIS][PROMOTION] files=$(tr '\n' ' ' < "${files_file}")" >&2
