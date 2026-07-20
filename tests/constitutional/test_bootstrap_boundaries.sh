#!/usr/bin/env bash
#
# test_bootstrap_boundaries.sh — Constitutional proof: Bootstrap respects its own limits.
#
# Purpose:
#   Proves that run_aegis.sh (Bootstrap) behaviorally adheres to the separation of concerns:
#   (A) Bootstrap invoca o Runtime uma única vez por Task (invokes runtime exactly once per loop step).
#   (B) Bootstrap não interpreta handovers (does not read, parse, or reference handover files/keys).
#   (C) Bootstrap não decide a ordem de execução (does not sequence, list, or transition between execution modes).
#
# Constitutional reference: RFC §5 Bootstrap Contract.
#

set -Eeuo pipefail

readonly TEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

cd "${TEST_ROOT}"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

pass() {
  echo "[PASS] $*"
}

# =========================================================================
# Preparation: extract function bodies and strip comments
# =========================================================================

# Extract execute_issue() function body.
execute_issue_body="$(
  awk '
    /^execute_issue\(\)/ { in_fn=1; depth=0 }
    in_fn {
      print
      depth += gsub(/{/, "{")
      depth -= gsub(/}/, "}")
      if (depth <= 0 && in_fn > 0 && NR > 1) in_fn=0
    }
  ' run_aegis.sh
)"

[[ -n "${execute_issue_body}" ]] \
  || fail "bootstrap_boundaries: could not extract execute_issue() from run_aegis.sh"

code_without_comments="$(sed 's/#.*//' run_aegis.sh)"
execute_issue_code_without_comments="$(echo "${execute_issue_body}" | sed 's/#.*//')"

# =========================================================================
# Verification: "Bootstrap invoca o Runtime uma única vez por Task"
# =========================================================================

# The entire run_aegis.sh script must invoke runtime_aegis.sh at exactly ONE point (inside run_bounded_task).
runtime_calls="$(echo "${code_without_comments}" | grep -o 'runtime_aegis\.sh' | wc -l | tr -d ' ')"
if [[ "${runtime_calls}" -ne 1 ]]; then
  fail "bootstrap_boundaries: run_aegis.sh invokes runtime_aegis.sh ${runtime_calls} times (must be exactly 1)"
fi

# The task loop body (execute_issue) must call run_bounded_task exactly once per task iteration.
loop_invocations="$(echo "${execute_issue_code_without_comments}" | grep -o '\brun_bounded_task\b' | wc -l | tr -d ' ')"
if [[ "${loop_invocations}" -ne 1 ]]; then
  fail "bootstrap_boundaries: execute_issue() calls run_bounded_task ${loop_invocations} times (must be exactly 1)"
fi

pass "bootstrap_boundaries: Bootstrap invoca o Runtime uma única vez por Task"

# =========================================================================
# Verification: "Bootstrap não interpreta handovers"
# =========================================================================

# The Bootstrap code must not reference handover files, keys, or parse handover JSON.
if echo "${code_without_comments}" | grep -q -i 'handover'; then
  fail "bootstrap_boundaries: Bootstrap contains references to handover in code"
fi

# The task loop must not inspect repair candidates (part of handover logic).
if echo "${execute_issue_code_without_comments}" | grep -q 'repair_candidates'; then
  fail "bootstrap_boundaries: execute_issue() references repair_candidates"
fi

pass "bootstrap_boundaries: Bootstrap não interpreta handovers"

# =========================================================================
# Verification: "Bootstrap não decide a ordem de execução"
# =========================================================================

# The Bootstrap code must not contain references to the runtime execution modes, sequencing, or loops.
for mode in 'discovery' 'forensics' 'repair' 'optimize' 'adversarial' 'validation'; do
  if echo "${code_without_comments}" | grep -q "\b${mode}\b"; then
    fail "bootstrap_boundaries: Bootstrap contains references to execution mode '${mode}' in code"
  fi
done

pass "bootstrap_boundaries: Bootstrap não decide a ordem de execução"

# =========================================================================
# Validation Verdict / Result pattern
# =========================================================================

# execute_issue() must check for validated_result.json or result_file
if ! echo "${execute_issue_code_without_comments}" | grep -q 'result_file\|validated_result'; then
  fail "bootstrap_boundaries: execute_issue() missing Validated Result target"
fi

pass "bootstrap_boundaries: execute_issue() uses Validated Result Contract pattern"

# =========================================================================
# Bootstrap does not invoke cognition scripts directly
# =========================================================================

for script in 'execute_mode.sh' 'scripts/substrates/aider' 'apply_candidate_diff'; do
  if echo "${code_without_comments}" | grep -q "${script}"; then
    fail "bootstrap_boundaries: run_aegis.sh calls Runtime-domain script '${script}'"
  fi
done

pass "bootstrap_boundaries: Bootstrap does not invoke Runtime-domain scripts"

# =========================================================================
# Interaction Boundary
# =========================================================================

bootstrap_reads="$(echo "${code_without_comments}" | grep -c '\bread\b' || true)"
set +e
runtime_reads="$(grep -v '^\s*#' runtime_aegis.sh | grep -v 'readlink\|read_\|_read' | grep -c '\bread\b')"
set -e
runtime_reads="${runtime_reads:-0}"

[[ "${runtime_reads}" -eq 0 ]] \
  || fail "bootstrap_boundaries: runtime_aegis.sh has ${runtime_reads} read call(s) (must be 0)"

[[ "${bootstrap_reads}" -gt 0 ]] \
  || fail "bootstrap_boundaries: run_aegis.sh has no read calls in code"

pass "bootstrap_boundaries: all user interaction in Bootstrap, none in Runtime"
