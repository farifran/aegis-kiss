#!/usr/bin/env bash
# =========================================================
# demand loop CLI surface (no live LLM run)
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

loop_sh="${AEGIS_TEST_ROOT}/run_aegis_loop.sh"
[[ -x "${loop_sh}" ]] || fail "run_aegis_loop_not_executable"

help_out="$(bash "${loop_sh}" --help 2>&1 || true)"
printf '%s' "${help_out}" | grep -q 'run_aegis_loop' \
  || fail "help_missing_name"
printf '%s' "${help_out}" | grep -q 'pipeline mutation' \
  || fail "help_must_state_full_mutation"
printf '%s' "${help_out}" | grep -q 'LOOP' \
  || printf '%s' "${help_out}" | grep -qi 'demand' \
  || fail "help_missing_demand_docs"

# Missing seed → fatal
set +e
out="$(bash "${loop_sh}" 2>&1)"
rc=$?
set -e
[[ "${rc}" -ne 0 ]] || fail "missing_seed_should_fail"
printf '%s' "${out}" | grep -q 'need --issue\|demand-file\|free-text' \
  || fail "missing_seed_message: ${out}"

# Script is orchestration only — does not define mutation_lite
grep -q 'mutation_lite' "${loop_sh}" \
  && fail "loop_must_not_reference_mutation_lite"
grep -q 'run_aegis.sh' "${loop_sh}" \
  || fail "loop_must_invoke_run_aegis"
grep -q 'LOOP FEEDBACK' "${loop_sh}" \
  || fail "loop_must_improve_demand_with_feedback"
grep -q 'fit_check_demand' "${loop_sh}" \
  || fail "loop_must_use_fit_check"
grep -q 'insights.jsonl\|LOOP_INSIGHTS' "${loop_sh}" \
  || fail "loop_must_write_insights_for_harness_learning"
grep -q 'capture_iteration_insight\|write_insights_digest' "${loop_sh}" \
  || fail "loop_must_capture_iteration_insights"
grep -q 'harness' "${loop_sh}" \
  || fail "loop_docs_must_mention_harness_learning"

echo "[PASS] aegis demand loop surface"
