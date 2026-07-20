#!/usr/bin/env bash
#
# test_execution_boundary.sh — Constitutional proof: Execution Boundary isolation.
#
# Purpose:
#   Proves, by execution (not code inspection), that run_bounded_task() builds
#   a clean process environment. Bootstrap-layer variables (PIPELINE, RESUME,
#   UNTIL, TARGET, ISSUE_PATH, ISSUE_NUMBER) must be physically absent from
#   the Runtime subprocess. Only the eight authorized variables may cross the
#   boundary.
#
#   Two proofs:
#   (A) Static: run_bounded_task() contains `env -i`.
#   (B) Dynamic: A mock runtime_aegis.sh captures its own env. We assert that
#       unauthorized vars are absent and authorized vars are present.
#
# Constitutional reference: RFC §5 Execution Boundary Contract.
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
# PROOF A — Static: run_bounded_task() uses env -i
# =========================================================================

grep -q 'env -i' run_aegis.sh \
  || fail "execution_boundary: env -i not found in run_aegis.sh"

# Verify it appears specifically inside run_bounded_task, not elsewhere
awk '
  /^run_bounded_task\(\)/ { in_fn=1; depth=0 }
  in_fn {
    depth += gsub(/{/, "{")
    depth -= gsub(/}/, "}")
    if (/env -i/) found=1
    if (depth <= 0 && in_fn) { in_fn=0 }
  }
  END { exit (found ? 0 : 1) }
' run_aegis.sh \
  || fail "execution_boundary: env -i not found inside run_bounded_task()"

pass "execution_boundary: static proof — run_bounded_task() uses env -i"

# =========================================================================
# PROOF B — Dynamic: unauthorized vars are absent in the Runtime subprocess
# =========================================================================

test_tmp="$(mktemp -d)"

cleanup() {
  rm -rf "${test_tmp}"
}
trap cleanup EXIT

# Create a mock runtime_aegis.sh that dumps its own env to a file, then exits 0.
mock_runtime="${test_tmp}/runtime_aegis.sh"
env_dump="${test_tmp}/runtime_env.txt"

cat > "${mock_runtime}" << 'MOCK'
#!/usr/bin/env bash
# Mock runtime — dumps environment for boundary verification.
env | sort > runtime_env.txt
exit 0
MOCK
chmod +x "${mock_runtime}"

# Extract run_bounded_task() from run_aegis.sh so we can call it directly
# without executing the full script (which has side effects at top level).
helper_file="${test_tmp}/bounded_task_fn.sh"

awk '
  /^run_bounded_task\(\)/ { in_fn=1; depth=0 }
  in_fn {
    print
    depth += gsub(/{/, "{")
    depth -= gsub(/}/, "}")
    if (depth <= 0 && in_fn > 0 && NR > 1) in_fn=0
  }
' run_aegis.sh > "${helper_file}"

[[ -s "${helper_file}" ]] \
  || fail "execution_boundary: failed to extract run_bounded_task() from run_aegis.sh"

grep -c '^run_bounded_task()' "${helper_file}" | grep -q '^1$' \
  || fail "execution_boundary: extracted wrong number of function definitions"

# Poison the environment with Bootstrap-layer variables that must NOT cross.
export PIPELINE="mutation"
export RESUME="false"
export UNTIL="forensics"
export TARGET="src"
export ISSUE_PATH="Issue.md"
export ISSUE_NUMBER="42"
export AEGIS_ACTIVE_TASK="should not cross"
export AEGIS_ISSUE_DESCRIPTION="should not cross"

# Set authorized variables that MUST cross.
export AEGIS_INVESTIGATION_INPUT="test task text"
export AEGIS_WORKSPACE_PATH="${test_tmp}"

# Source the extracted function.
# shellcheck disable=SC1090
source "${helper_file}"

# We need to be in the test_tmp dir because the mock runtime_aegis.sh is there.
(
  cd "${test_tmp}"
  # run_bounded_task task workspace
  run_bounded_task "test task text" "${test_tmp}"
) || fail "execution_boundary: run_bounded_task() exited non-zero"

[[ -f "${env_dump}" ]] \
  || fail "execution_boundary: mock runtime did not produce env dump"

# ---- Assertions: unauthorized vars must be absent ----
for forbidden_var in PIPELINE RESUME UNTIL TARGET ISSUE_PATH ISSUE_NUMBER \
                     AEGIS_ACTIVE_TASK AEGIS_ISSUE_DESCRIPTION; do
  if grep -q "^${forbidden_var}=" "${env_dump}"; then
    fail "execution_boundary: forbidden var crossed boundary: ${forbidden_var}"
  fi
done

pass "execution_boundary: dynamic proof — Bootstrap vars absent from Runtime env"

# ---- Assertions: authorized vars must be present ----
grep -q "^AEGIS_INVESTIGATION_INPUT=test task text" "${env_dump}" \
  || fail "execution_boundary: AEGIS_INVESTIGATION_INPUT did not cross boundary"

grep -q "^AEGIS_EXECUTION_TARGET_PATH=" "${env_dump}" \
  || fail "execution_boundary: AEGIS_EXECUTION_TARGET_PATH did not cross boundary"

pass "execution_boundary: dynamic proof — authorized vars present in Runtime env"

# ---- Sanity: boundary env must be narrow ----
env_count="$(wc -l < "${env_dump}" | tr -d ' ')"
[[ "${env_count}" -le 20 ]] \
  || fail "execution_boundary: boundary env too wide — ${env_count} vars leaked (max 20)"

pass "execution_boundary: boundary env width within limit (${env_count} vars)"
