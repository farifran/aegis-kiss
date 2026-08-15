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

# Locate the candidate by SHAPE, not by mode name. Build carries the patch in
# operational_context.diff; optimize, adversarial and validation forward it as
# candidate_result. Enumerating only build and optimize meant a
# validation-mode handover — the one every build-feedback re-entry carries —
# matched nothing and was refused as an invalid contract, so the loop that
# validation itself asked for could never rebuild the candidate.
candidate_src="$(
  jq -r '
    def valid_diff: type == "string" and length > 0 and . != "(no changes)";
    def valid_files: type == "array" and length > 0
      and all(type == "string" and length > 0
        and startswith("/") == false
        and (split("/") | index("..")) == null);
    (.artifact_snapshot.operational_context // {}) as $oc
    | ($oc.candidate_result // {}) as $cr
    | if ($oc.diff | valid_diff) and ($oc.files_changed | valid_files) then
        "direct"
      elif ($cr.diff | valid_diff) and ($cr.files_changed | valid_files) then
        "candidate_result"
      else
        ""
      end
  ' "${HANDOVER_FILE}" 2>/dev/null || true
)"

[[ -n "${candidate_src}" ]] \
  || candidate_fatal "invalid_build_candidate_contract"

diff_file="$(mktemp)"
expected_files="$(mktemp)"
actual_files="$(mktemp)"

cleanup() {
  rm -f "${diff_file}" "${expected_files}" "${actual_files}" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

if [[ "${candidate_src}" == "candidate_result" ]]; then
  jq -r '.artifact_snapshot.operational_context.candidate_result.diff' \
    "${HANDOVER_FILE}" > "${diff_file}"
  jq -r '.artifact_snapshot.operational_context.candidate_result.files_changed[]?' \
    "${HANDOVER_FILE}" | sort -u > "${expected_files}"
else
  jq -r '.artifact_snapshot.operational_context.diff' \
    "${HANDOVER_FILE}" > "${diff_file}"
  jq -r '.artifact_snapshot.operational_context.files_changed[]?' \
    "${HANDOVER_FILE}" | sort -u > "${expected_files}"
fi

# Prefer clean apply; fall back to 3-way (optimize→build refine on dirty-ish trees).
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

# 3-way can leave conflict markers while exiting 0 in some cases — refuse.
# Match start markers only (======= alone appears in legitimate prose).
if git -C "${EXECUTION_SURFACE}" grep -l -E '^(<<<<<<< |>>>>>>>)' -- \
  2>/dev/null | grep -q .; then
  candidate_fatal "candidate_diff_apply_left_conflict_markers"
fi

# A net-new module is the canonical target ("Create src/tokenBucket.ts"), and
# `git diff --name-only HEAD` never lists an untracked file. Counting only
# tracked changes left actual_files empty for exactly the case the pipeline
# exists to serve, and every creation was rejected as a files_changed mismatch.
{
  git -C "${EXECUTION_SURFACE}" diff --name-only HEAD -- 2>/dev/null || true
  git -C "${EXECUTION_SURFACE}" ls-files --others --exclude-standard 2>/dev/null || true
} | sort -u > "${actual_files}"

# Allow actual ⊆ expected? No — require equality, but ignore empty noise.
if ! cmp -s "${expected_files}" "${actual_files}"; then
  echo "[AEGIS][CANDIDATE][DIAG] expected_files:" >&2
  cat "${expected_files}" >&2 || true
  echo "[AEGIS][CANDIDATE][DIAG] actual_files:" >&2
  cat "${actual_files}" >&2 || true
  candidate_fatal "candidate_files_changed_mismatch"
fi

echo "[AEGIS][CANDIDATE] Build candidate materialized" >&2
