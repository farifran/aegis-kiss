#!/usr/bin/env bash

# =========================================================
# Run outcome — classify, breadcrumb path, metrics, driver B
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/run_outcome.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"

test_tmp="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

# Isolate all metrics/breadcrumb I/O from the real runtime tree so the
# suite never grows .harness/runtime/pipeline_metrics.jsonl.
export AEGIS_RUNTIME_DIR="${test_tmp}/runtime"
export AEGIS_METRICS_FILE="${test_tmp}/pipeline_metrics.jsonl"
mkdir -p "${AEGIS_RUNTIME_DIR}"
: > "${AEGIS_METRICS_FILE}"

outcome_count() {
  if [[ ! -s "${AEGIS_METRICS_FILE}" ]]; then
    echo 0
    return
  fi
  # -c keeps one object per line so wc -l equals event count (not pretty-print lines).
  jq -c 'select(.kind == "outcome")' "${AEGIS_METRICS_FILE}" 2>/dev/null | wc -l | tr -d ' '
}

# Mirror of runtime cleanup_runtime outcome projection (contract B).
# Kept local to the test so we do not re-exec the full runtime trap.
simulate_cleanup_outcome() {
  local exit_code="$1"
  local mode="${2:-}"

  if [[ "${AEGIS_PIPELINE_DRIVER:-0}" == "1" ]]; then
    return 0
  fi

  local outcome_status outcome_reason outcome_class
  local last_fatal_file="${AEGIS_RUNTIME_DIR}/last_fatal"

  if [[ "${exit_code}" -ne 0 ]]; then
    outcome_status="FAILED"
    outcome_reason=""
    if [[ -f "${last_fatal_file}" ]]; then
      outcome_reason="$(tr -d '\r' < "${last_fatal_file}" | head -n 1)"
    fi
    aegis_classify_reason "${outcome_reason}" >/dev/null
    outcome_class="${AEGIS_OUTCOME_CLASS:-unknown}"
    aegis_emit_outcome_block "${outcome_status}" "${outcome_reason}"
    aegis_append_outcome_metric \
      "${outcome_status}" \
      "${outcome_reason}" \
      "${outcome_class}" \
      "${mode}"
  else
    aegis_append_outcome_metric "SUCCESS" "" "" "${mode}"
  fi
}

# --- D remains: known token classify (next_step now points at --fresh) ---
line="$(aegis_classify_reason "investigation_input_mismatch")"
class="${line%%$'\t'*}"
next_step="${line#*$'\t'}"

[[ "${class}" == "operator_input" ]] \
  || fail "classify_mismatch_class: got '${class}'"
[[ -n "${next_step}" ]] \
  || fail "classify_mismatch_empty_next_step"
echo "${next_step}" | grep -q -- '--fresh' \
  || fail "classify_mismatch_next_step_missing_fresh"

line="$(aegis_classify_reason "fresh_resume_conflict")"
class="${line%%$'\t'*}"
next_step="${line#*$'\t'}"
[[ "${class}" == "operator_input" ]] \
  || fail "classify_fresh_resume_class: got '${class}'"
[[ -n "${next_step}" ]] \
  || fail "classify_fresh_resume_empty_next_step"

# --- D remains: prefix match empty_diff:* ---
line="$(aegis_classify_reason "empty_diff: aider produced no changes")"
class="${line%%$'\t'*}"

[[ "${class}" == "mutation" ]] \
  || fail "classify_empty_diff_prefix: got '${class}'"

# --- D remains: unknown token ---
line="$(aegis_classify_reason "token_que_nao_existe")"
class="${line%%$'\t'*}"
next_step="${line#*$'\t'}"

[[ "${class}" == "unknown" ]] \
  || fail "classify_unknown_class: got '${class}'"
[[ -n "${next_step}" ]] \
  || fail "classify_unknown_empty_next_step"

# --- D remains: aegis_fatal path + exit 1 ---
set +e
(
  aegis_fatal "foo"
)
fatal_rc=$?
set -e

[[ "${fatal_rc}" -eq 1 ]] \
  || fail "aegis_fatal_exit_code: got ${fatal_rc}"

[[ -f "${AEGIS_RUNTIME_DIR}/last_fatal" ]] \
  || fail "aegis_fatal_missing_breadcrumb"

breadcrumb="$(tr -d '\r' < "${AEGIS_RUNTIME_DIR}/last_fatal" | head -n 1)"
[[ "${breadcrumb}" == "foo" ]] \
  || fail "aegis_fatal_breadcrumb_content: got '${breadcrumb}'"

[[ ! -f "${AEGIS_TEST_ROOT}/last_fatal" ]] \
  || [[ "$(cat "${AEGIS_TEST_ROOT}/last_fatal" 2>/dev/null || true)" != "foo" ]] \
  || fail "aegis_fatal_wrote_repo_root_breadcrumb"

# --- D remains: metrics schema (no next_step) ---
: > "${AEGIS_METRICS_FILE}"
aegis_append_outcome_metric "FAILED" "x" "provider" "repair"

last_line="$(tail -n 1 "${AEGIS_METRICS_FILE}")"
echo "${last_line}" | jq -e '
  .kind == "outcome"
  and .status == "FAILED"
  and .reason_code == "x"
  and .reason_class == "provider"
  and .mode == "repair"
  and (.at | type == "string")
' >/dev/null \
  || fail "outcome_metric_invalid_json: ${last_line}"

echo "${last_line}" | jq -e 'has("next_step") | not' >/dev/null \
  || fail "outcome_metric_must_not_store_next_step"

# --- B accept 1: driver=1 → cleanup emits zero outcome lines ---
: > "${AEGIS_METRICS_FILE}"
export AEGIS_PIPELINE_DRIVER=1
simulate_cleanup_outcome 0 "discovery"
simulate_cleanup_outcome 1 "repair"
count="$(outcome_count)"
[[ "${count}" -eq 0 ]] \
  || fail "driver_cleanup_must_emit_zero_outcomes: got ${count}"

# Source wiring: orchestrator exports the flag; runtime guards on it.
grep -q 'AEGIS_PIPELINE_DRIVER=1' "${AEGIS_TEST_ROOT}/run_aegis.sh" \
  || fail "run_aegis_missing_pipeline_driver_export"
grep -q 'AEGIS_PIPELINE_DRIVER' "${AEGIS_TEST_ROOT}/runtime_aegis.sh" \
  || fail "runtime_missing_pipeline_driver_guard"

# --- B accept 2: pipeline sim (3 mode success + final report) → 1 SUCCESS ---
: > "${AEGIS_METRICS_FILE}"
export AEGIS_PIPELINE_DRIVER=1
simulate_cleanup_outcome 0 "discovery"
simulate_cleanup_outcome 0 "forensics"
simulate_cleanup_outcome 0 "validation"
# orchestrator final projection (driver owns this)
aegis_append_outcome_metric "SUCCESS" "" "" "validation"
count="$(outcome_count)"
[[ "${count}" -eq 1 ]] \
  || fail "pipeline_must_emit_exactly_one_outcome: got ${count}"

last_line="$(tail -n 1 "${AEGIS_METRICS_FILE}")"
echo "${last_line}" | jq -e '
  .kind == "outcome" and .status == "SUCCESS" and .mode == "validation"
' >/dev/null \
  || fail "pipeline_outcome_not_success: ${last_line}"

# --- B accept 3: standalone fail → 1 FAILED line + human block ---
: > "${AEGIS_METRICS_FILE}"
unset AEGIS_PIPELINE_DRIVER
printf '%s\n' "investigation_input_mismatch" > "${AEGIS_RUNTIME_DIR}/last_fatal"

standalone_fail_out="$(simulate_cleanup_outcome 1 "forensics" 2>&1)"
count="$(outcome_count)"
[[ "${count}" -eq 1 ]] \
  || fail "standalone_fail_outcome_count: got ${count}"

echo "${standalone_fail_out}" | grep -q 'AEGIS OUTCOME' \
  || fail "standalone_fail_missing_human_block"

last_line="$(tail -n 1 "${AEGIS_METRICS_FILE}")"
echo "${last_line}" | jq -e '
  .kind == "outcome"
  and .status == "FAILED"
  and .reason_code == "investigation_input_mismatch"
  and .mode == "forensics"
' >/dev/null \
  || fail "standalone_fail_metric: ${last_line}"

# --- B accept 4: standalone success → 0 human blocks, 1 SUCCESS ---
: > "${AEGIS_METRICS_FILE}"
unset AEGIS_PIPELINE_DRIVER
standalone_ok_out="$(simulate_cleanup_outcome 0 "discovery" 2>&1)"
count="$(outcome_count)"
[[ "${count}" -eq 1 ]] \
  || fail "standalone_success_outcome_count: got ${count}"

if echo "${standalone_ok_out}" | grep -q 'AEGIS OUTCOME'; then
  fail "standalone_success_must_not_emit_human_block"
fi

last_line="$(tail -n 1 "${AEGIS_METRICS_FILE}")"
echo "${last_line}" | jq -e '
  .kind == "outcome" and .status == "SUCCESS" and .mode == "discovery"
' >/dev/null \
  || fail "standalone_success_metric: ${last_line}"

# --- B accept 5: ephemeral runtime paths not tracked ---
if git -C "${AEGIS_TEST_ROOT}" ls-files --error-unmatch \
  '.harness/runtime/pipeline_metrics.jsonl' >/dev/null 2>&1; then
  fail "pipeline_metrics_still_tracked"
fi

if git -C "${AEGIS_TEST_ROOT}" ls-files '.harness/runtime/evidence_cache/*' \
  | grep -q .; then
  fail "evidence_cache_still_tracked"
fi

if git -C "${AEGIS_TEST_ROOT}" ls-files --error-unmatch 'last_fatal' \
  >/dev/null 2>&1; then
  fail "root_last_fatal_still_tracked"
fi

# gitignore must cover both
git -C "${AEGIS_TEST_ROOT}" check-ignore -q \
  '.harness/runtime/pipeline_metrics.jsonl' \
  || fail "pipeline_metrics_not_gitignored"

git -C "${AEGIS_TEST_ROOT}" check-ignore -q \
  '.harness/runtime/evidence_cache/dummy.json' \
  || fail "evidence_cache_not_gitignored"

echo "[AEGIS][TEST] test_run_outcome: PASS"
