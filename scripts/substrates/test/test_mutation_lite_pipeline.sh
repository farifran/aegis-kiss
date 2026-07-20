#!/usr/bin/env bash
# =========================================================
# mutation_lite pipeline registration + help surface
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

run_sh="${AEGIS_TEST_ROOT}/run_aegis.sh"

# Pipeline map includes mutation_lite with short mode list
grep -q '\[mutation_lite\]="discovery forensics repair validation"' "${run_sh}" \
  || fail "mutation_lite_pipeline_missing"

# Full mutation still has optimize + adversarial
grep -q '\[mutation\]="discovery forensics repair optimize adversarial validation"' "${run_sh}" \
  || fail "mutation_full_pipeline_changed_unexpectedly"

# Help documents mutation_lite
help_out="$(bash "${run_sh}" --help 2>&1 || true)"
printf '%s' "${help_out}" | grep -q 'mutation_lite' \
  || fail "help_missing_mutation_lite"

# maybe_apply_mutation_lite helper exists
grep -q 'maybe_apply_mutation_lite' "${run_sh}" \
  || fail "maybe_apply_mutation_lite_missing"

# Auto path keys off fit score
grep -q 'AEGIS_MUTATION_LITE_MAX_SCORE' "${run_sh}" \
  || fail "lite_max_score_missing"

# Precondition / continuity must accept repair→validation (lite handoff).
# Structural greps only here; behavioral coverage lives in
# test_mutation_lite_validation_handoff.sh.
grep -q 'mutation_lite: repair' "${AEGIS_TEST_ROOT}/runtime_aegis.sh" \
  || grep -q 'mutation_lite' "${AEGIS_TEST_ROOT}/runtime_aegis.sh" \
  || fail "runtime_missing_mutation_lite_validation_comment"
grep -q 'source_mode = "optimize"' \
  "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh" \
  || fail "artifact_protocol_missing_candidate_synthesis"
grep -q 'operational_context.diff' \
  "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh" \
  || fail "artifact_protocol_missing_repair_diff_fallback"

echo "[PASS] mutation_lite pipeline"
