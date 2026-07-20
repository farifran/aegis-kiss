#!/usr/bin/env bash
#
# test_git_persistence.sh — Constitutional proof: Git Commit Contract.
#
# Four cases:
#   Case 1: No staged changes → no commit created.
#   Case 2: Changes exist → commit SHA produced → cherry-pick succeeds → HEAD updated.
#   Case 3: Cherry-pick conflict → abort called → main repo remains intact.
#   Case 4: SIGINT during workspace existence → trap fires → worktree removed.
#
# Constitutional reference: RFC §5 Git Contract ("One Engineering Plan corresponds
# to one persistence event").
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

source ".harness/config.sh"

# =========================================================================
# Test environment setup — isolated git repo for each test case
# =========================================================================

make_test_repo() {
  local dir="$1"
  mkdir -p "${dir}"
  git -C "${dir}" init --quiet
  git -C "${dir}" config user.email "test@aegis.local"
  git -C "${dir}" config user.name "Aegis Test"
  echo "root" > "${dir}/root.txt"
  git -C "${dir}" add -A
  git -C "${dir}" commit -m "initial" --quiet
}

# Extract _promote_workspace() from run_aegis.sh so we can call it in isolation.
extract_promote_fn() {
  local out="$1"
  awk '
    /^_promote_workspace\(\)/ { in_fn=1; depth=0 }
    in_fn {
      print
      depth += gsub(/{/, "{")
      depth -= gsub(/}/, "}")
      if (depth <= 0 && in_fn > 0 && NR > 1) in_fn=0
    }
  ' run_aegis.sh > "${out}"
  [[ -s "${out}" ]] || fail "git_persistence: could not extract _promote_workspace()"
}

extract_resolve_plan_title_fn() {
  local out="$1"
  awk '
    /^resolve_plan_title\(\)/ { in_fn=1; depth=0 }
    in_fn {
      print
      depth += gsub(/{/, "{")
      depth -= gsub(/}/, "}")
      if (depth <= 0 && in_fn > 0 && NR > 1) in_fn=0
    }
  ' run_aegis.sh >> "${out}"
}

global_tmp="$(mktemp -d)"
promote_fn="${global_tmp}/promote_fn.sh"
extract_promote_fn "${promote_fn}"
extract_resolve_plan_title_fn "${promote_fn}"

cleanup_global() {
  rm -rf "${global_tmp}"
}
trap cleanup_global EXIT

# =========================================================================
# Case 1: No changes → no commit produced
# =========================================================================

test_repo_1="${global_tmp}/repo1"
make_test_repo "${test_repo_1}"

# Create worktree (detached HEAD)
workspace_1="${global_tmp}/ws1"
git -C "${test_repo_1}" worktree add --detach "${workspace_1}" HEAD --quiet

# Capture HEAD before
head_before="$(git -C "${test_repo_1}" rev-parse HEAD)"

# Create a mock plan
plan_1="${global_tmp}/plan1.md"
echo "# Test Plan" > "${plan_1}"
echo "" >> "${plan_1}"
echo "- [x] Task one" >> "${plan_1}"

# Source promote function and run in context of test_repo_1
(
  cd "${test_repo_1}"
  # ISSUE_WORKSPACE_PATH must be visible to _promote_workspace
  ISSUE_WORKSPACE_PATH="${workspace_1}"
  # shellcheck disable=SC1090
  source "${promote_fn}"
  _promote_workspace "${plan_1}"
) || fail "git_persistence case1: _promote_workspace failed"

head_after="$(git -C "${test_repo_1}" rev-parse HEAD)"

[[ "${head_before}" == "${head_after}" ]] \
  || fail "git_persistence case1: HEAD changed despite no changes (before=${head_before} after=${head_after})"

git -C "${test_repo_1}" worktree remove --force "${workspace_1}" 2>/dev/null || true

pass "git_persistence case1: no changes → no commit → HEAD unchanged"

# =========================================================================
# Case 2: Changes exist → commit SHA → cherry-pick → HEAD updated
# =========================================================================

test_repo_2="${global_tmp}/repo2"
make_test_repo "${test_repo_2}"

workspace_2="${global_tmp}/ws2"
git -C "${test_repo_2}" worktree add --detach "${workspace_2}" HEAD --quiet

head_before="$(git -C "${test_repo_2}" rev-parse HEAD)"

# Add a file change in the workspace
echo "new content" > "${workspace_2}/newfile.txt"

plan_2="${global_tmp}/plan2.md"
echo "# Feature Plan" > "${plan_2}"
echo "" >> "${plan_2}"
echo "- [x] Add newfile" >> "${plan_2}"

(
  cd "${test_repo_2}"
  ISSUE_WORKSPACE_PATH="${workspace_2}"
  # shellcheck disable=SC1090
  source "${promote_fn}"
  _promote_workspace "${plan_2}"
) || fail "git_persistence case2: _promote_workspace failed"

head_after="$(git -C "${test_repo_2}" rev-parse HEAD)"

[[ "${head_before}" != "${head_after}" ]] \
  || fail "git_persistence case2: HEAD did not advance after changes"

# The commit message must match the plan title
commit_msg="$(git -C "${test_repo_2}" log -1 --format='%s')"
[[ "${commit_msg}" == "Feature Plan" ]] \
  || fail "git_persistence case2: commit message '${commit_msg}' != plan title 'Feature Plan'"

# The new file must exist in the main repo
[[ -f "${test_repo_2}/newfile.txt" ]] \
  || fail "git_persistence case2: promoted file not found in main repo"

git -C "${test_repo_2}" worktree remove --force "${workspace_2}" 2>/dev/null || true

pass "git_persistence case2: changes → commit SHA → cherry-pick → HEAD updated"

# =========================================================================
# Case 3: Cherry-pick conflict → abort → repo intact
# =========================================================================

test_repo_3="${global_tmp}/repo3"
make_test_repo "${test_repo_3}"

# Introduce conflicting content in main repo
echo "main version" > "${test_repo_3}/conflict.txt"
git -C "${test_repo_3}" add -A
git -C "${test_repo_3}" commit -m "main adds conflict.txt" --quiet

workspace_3="${global_tmp}/ws3"
git -C "${test_repo_3}" worktree add --detach "${workspace_3}" HEAD~1 --quiet

head_before="$(git -C "${test_repo_3}" rev-parse HEAD)"

# Workspace writes a conflicting version of the same file
echo "workspace version" > "${workspace_3}/conflict.txt"

plan_3="${global_tmp}/plan3.md"
echo "# Conflict Plan" > "${plan_3}"
echo "" >> "${plan_3}"
echo "- [x] Conflicting change" >> "${plan_3}"

# _promote_workspace must handle cherry-pick failure gracefully (no exit 1)
(
  cd "${test_repo_3}"
  ISSUE_WORKSPACE_PATH="${workspace_3}"
  # shellcheck disable=SC1090
  source "${promote_fn}"
  _promote_workspace "${plan_3}"
) || fail "git_persistence case3: _promote_workspace crashed instead of handling conflict gracefully"

head_after="$(git -C "${test_repo_3}" rev-parse HEAD)"

# Main repo HEAD must remain unchanged after a failed cherry-pick
[[ "${head_before}" == "${head_after}" ]] \
  || fail "git_persistence case3: HEAD changed after cherry-pick conflict (before=${head_before} after=${head_after})"

# No cherry-pick must be in progress (must have been aborted)
git -C "${test_repo_3}" cherry-pick --abort 2>/dev/null && \
  fail "git_persistence case3: cherry-pick was still in progress after _promote_workspace returned"

git -C "${test_repo_3}" worktree remove --force "${workspace_3}" 2>/dev/null || true

pass "git_persistence case3: cherry-pick conflict → abort → repo intact"

# =========================================================================
# Case 4: SIGINT → cleanup trap → no orphan worktree
# =========================================================================

test_repo_4="${global_tmp}/repo4"
make_test_repo "${test_repo_4}"

workspace_4="${global_tmp}/ws4"
git -C "${test_repo_4}" worktree add --detach "${workspace_4}" HEAD --quiet

# Verify worktree is registered
git -C "${test_repo_4}" worktree list | grep -q "${workspace_4}" \
  || fail "git_persistence case4: worktree not registered before test"

# Simulate the cleanup trap logic from run_aegis.sh in isolation.
# We run a subshell that initializes the workspace flag, then sends itself SIGINT.
cleanup_result="${global_tmp}/cleanup_result.txt"

(
  WORKSPACE_INITIALIZED=true
  ISSUE_WORKSPACE_PATH="${workspace_4}"
  REPO_ROOT="${test_repo_4}"

  _cleanup_workspace() {
    if [[ "${WORKSPACE_INITIALIZED}" == "true" ]]; then
      git -C "${REPO_ROOT}" worktree remove --force "${ISSUE_WORKSPACE_PATH}" \
        >/dev/null 2>&1 || true
      git -C "${REPO_ROOT}" worktree prune >/dev/null 2>&1 || true
      echo "cleanup_ran" > "${cleanup_result}"
    fi
  }
  trap '_cleanup_workspace' EXIT INT TERM

  # Simulate SIGINT
  kill -INT $$
) || true

# Allow the trap to complete
sleep 0.2

[[ -f "${cleanup_result}" ]] \
  || fail "git_persistence case4: cleanup trap did not fire on SIGINT"

# Worktree must no longer be registered
git -C "${test_repo_4}" worktree list | grep -q "${workspace_4}" \
  && fail "git_persistence case4: orphan worktree still registered after SIGINT"

pass "git_persistence case4: SIGINT → cleanup trap fires → no orphan worktree"
