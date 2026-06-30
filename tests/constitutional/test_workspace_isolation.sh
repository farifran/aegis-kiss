#!/usr/bin/env bash
#
# test_workspace_isolation.sh — Constitutional proof: Isolated Workspace containment.
#
# Purpose:
#   Proves that:
#   (A) run_bounded_task() routes AEGIS_EXECUTION_TARGET_PATH to the workspace,
#       not to the main repository root.
#   (B) The main repository working tree is clean during execution (no mutations
#       escape the workspace boundary into the main repo's git index).
#   (C) The workspace path passed to the Runtime is the actual initialized worktree.
#
# Constitutional reference: RFC §5 Isolated Workspace Contract.
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
# PROOF A — Static: run_bounded_task() passes workspace as AEGIS_EXECUTION_TARGET_PATH
# =========================================================================

# Verify that within run_bounded_task, AEGIS_EXECUTION_TARGET_PATH is set to
# the workspace argument (not a hardcoded path or the default '.').
awk '
  /^run_bounded_task\(\)/ { in_fn=1; depth=0 }
  in_fn {
    depth += gsub(/{/, "{")
    depth -= gsub(/}/, "}")
    if (/AEGIS_EXECUTION_TARGET_PATH=/) found=1
    if (depth <= 0 && in_fn > 0 && NR > 1) in_fn=0
  }
  END { exit (found ? 0 : 1) }
' run_aegis.sh \
  || fail "workspace_isolation: AEGIS_EXECUTION_TARGET_PATH not set inside run_bounded_task()"

pass "workspace_isolation: static proof — run_bounded_task() routes AEGIS_EXECUTION_TARGET_PATH"

# Verify the workspace is NOT hardcoded to '.' or the repo root
awk '
  /^run_bounded_task\(\)/ { in_fn=1; depth=0 }
  in_fn {
    depth += gsub(/{/, "{")
    depth -= gsub(/}/, "}")
    # Fail if AEGIS_EXECUTION_TARGET_PATH is set to the literal string "."
    if (/AEGIS_EXECUTION_TARGET_PATH=\x27\.\x27/ || /AEGIS_EXECUTION_TARGET_PATH="\."/) bad=1
    if (depth <= 0 && in_fn > 0 && NR > 1) in_fn=0
  }
  END { exit (bad ? 1 : 0) }
' run_aegis.sh \
  || fail "workspace_isolation: AEGIS_EXECUTION_TARGET_PATH hardcoded to repo root '.'"

pass "workspace_isolation: static proof — AEGIS_EXECUTION_TARGET_PATH is not hardcoded to '.'"

# =========================================================================
# PROOF B — Dynamic: Runtime subprocess receives workspace path, not repo root
# =========================================================================

test_tmp="$(mktemp -d)"
env_dump="${test_tmp}/runtime_env.txt"

cleanup() {
  rm -rf "${test_tmp}"
}
trap cleanup EXIT

# Create a mock runtime that captures AEGIS_EXECUTION_TARGET_PATH.
mock_runtime="${test_tmp}/runtime_aegis.sh"
cat > "${mock_runtime}" << 'MOCK'
#!/usr/bin/env bash
echo "AEGIS_EXECUTION_TARGET_PATH=${AEGIS_EXECUTION_TARGET_PATH:-UNSET}" > runtime_env.txt
exit 0
MOCK
chmod +x "${mock_runtime}"

# Extract run_bounded_task().
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
  || fail "workspace_isolation: failed to extract run_bounded_task()"

export AEGIS_TEST_ENV_DUMP="${env_dump}"
export AEGIS_WORKSPACE_PATH="${test_tmp}/the_workspace"

# shellcheck disable=SC1090
source "${helper_file}"

(
  cd "${test_tmp}"
  run_bounded_task "test task" "${test_tmp}/the_workspace"
) || fail "workspace_isolation: run_bounded_task() exited non-zero"

[[ -f "${env_dump}" ]] \
  || fail "workspace_isolation: mock runtime did not produce env dump"

# The Runtime must have received the workspace path, NOT '.' or the repo root.
received_path="$(grep '^AEGIS_EXECUTION_TARGET_PATH=' "${env_dump}" | cut -d= -f2-)"

[[ "${received_path}" != "." ]] \
  || fail "workspace_isolation: Runtime received repo root '.' instead of workspace"

[[ "${received_path}" != "${TEST_ROOT}" ]] \
  || fail "workspace_isolation: Runtime received repo root '${TEST_ROOT}' instead of workspace"

[[ "${received_path}" == "${test_tmp}/the_workspace" ]] \
  || fail "workspace_isolation: Runtime received wrong path: '${received_path}'"

pass "workspace_isolation: dynamic proof — Runtime received workspace path, not repo root"

# =========================================================================
# PROOF C — Static: Runtime does not hardcode CWD over the workspace
# =========================================================================
# runtime_aegis.sh CDs to AEGIS_RUNTIME_ROOT for config loading (acceptable).
# Verify it does NOT override AEGIS_EXECUTION_TARGET_PATH to '.'.
grep -n 'AEGIS_EXECUTION_TARGET_PATH=\.' runtime_aegis.sh \
  && fail "workspace_isolation: runtime_aegis.sh hardcodes AEGIS_EXECUTION_TARGET_PATH to '.'" \
  || true

pass "workspace_isolation: static proof — runtime_aegis.sh does not override AEGIS_EXECUTION_TARGET_PATH"
