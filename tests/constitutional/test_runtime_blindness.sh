#!/usr/bin/env bash
#
# test_runtime_blindness.sh — Constitutional proof: Runtime has no user interaction,
#                              no planning awareness, no workspace management.
#
# Purpose:
#   Proves by source analysis that runtime_aegis.sh never:
#   - Reads from stdin (no `read` commands)
#   - Presents menus (no `select`)
#   - Opens editors
#   - Knows the Engineering Plan (Issue.md)
#   - Manages git worktrees (workspace lifecycle belongs to Bootstrap)
#   - Calls finalize_workspace, prepare_issue, or other Bootstrap functions
#
# This test is purely static — source analysis is the correct tool here
# because "does the code contain X" is the claim being tested.
#
# Constitutional reference: RFC §5 Runtime Contract ("Runtime never owns planning,
# user interaction, workspace lifecycle, or persistence").
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
# User interaction checks
# =========================================================================

# `read` for user input — filter out comments and variable names that contain
# the word "read" (e.g. HANDOVER_BACKUP, file-read operations).
user_reads="$(
  grep -n '\bread\b' runtime_aegis.sh \
    | grep -v '^\s*#' \
    | grep -v 'read -r file\|read -r line\|readlink\|read_\|_read\b' \
    || true
)"

if [[ -n "${user_reads}" ]]; then
  echo "[FAIL] runtime_aegis.sh contains user-facing read:" >&2
  echo "${user_reads}" >&2
  fail "runtime_blindness: runtime reads from stdin (user interaction)"
fi

pass "runtime_blindness: no stdin read in runtime_aegis.sh"

# `select` for menus
user_selects="$(
  grep -n '\bselect\b' runtime_aegis.sh \
    | grep -v '^\s*#' \
    || true
)"

if [[ -n "${user_selects}" ]]; then
  echo "[FAIL] runtime_aegis.sh contains select:" >&2
  echo "${user_selects}" >&2
  fail "runtime_blindness: runtime uses select menu (user interaction)"
fi

pass "runtime_blindness: no select in runtime_aegis.sh"

# =========================================================================
# Planning awareness checks
# =========================================================================

# Runtime must not reference the Engineering Plan by file name patterns
for pattern in 'Issue\.md' 'ISSUE_PATH' 'issue_refiner' 'prepare_issue' \
               'ENGINEERING_PLAN' 'engineering_plan'; do
  if grep -q "${pattern}" runtime_aegis.sh; then
    fail "runtime_blindness: runtime references planning artifact '${pattern}'"
  fi
done

pass "runtime_blindness: runtime has no reference to Engineering Plan artifacts"

# Runtime must not know about Bootstrap-layer variables
for var in PIPELINE RESUME ISSUE_NUMBER ISSUE_PATH POSITIONAL; do
  if grep -qw "${var}" runtime_aegis.sh; then
    fail "runtime_blindness: runtime references Bootstrap variable '${var}'"
  fi
done

pass "runtime_blindness: runtime has no Bootstrap-layer variable references"

# =========================================================================
# Workspace lifecycle checks — workspace management belongs to Bootstrap
# =========================================================================

# runtime_aegis.sh is allowed to manage its OWN execution surface (worktrees
# under AEGIS_EXECUTION_SURFACE_ROOT, used for aider mutation substrates).
# It must NOT manage the Issue Workspace (ISSUE_WORKSPACE_PATH).
if grep -q 'ISSUE_WORKSPACE_PATH\|issue_workspace\|finalize_workspace\|initialize_workspace' \
   runtime_aegis.sh; then
  fail "runtime_blindness: runtime references Bootstrap workspace lifecycle functions"
fi

pass "runtime_blindness: runtime has no reference to Bootstrap workspace lifecycle"

# =========================================================================
# Git persistence checks — git commits belong to Bootstrap/Git domain
# =========================================================================

# Runtime must not call git commit or git cherry-pick
for git_cmd in 'git commit' 'git cherry-pick' 'git merge'; do
  if grep -q "${git_cmd}" runtime_aegis.sh; then
    fail "runtime_blindness: runtime calls persistence command '${git_cmd}'"
  fi
done

pass "runtime_blindness: runtime makes no git persistence calls"

# =========================================================================
# Editor / UI checks
# =========================================================================

for ui_pattern in '\bvi\b\s' '\bvim\b\s' '\bnano\b\s' 'EDITOR' 'show_plan_review' \
                  'finalize_workspace' 'prepare_issue' 'execute_issue'; do
  if grep -qP "${ui_pattern}" runtime_aegis.sh 2>/dev/null \
     || grep -q "${ui_pattern}" runtime_aegis.sh 2>/dev/null; then
    fail "runtime_blindness: runtime references UI function '${ui_pattern}'"
  fi
done

pass "runtime_blindness: runtime has no UI or Bootstrap function references"
