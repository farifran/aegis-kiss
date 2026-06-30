#!/usr/bin/env bash

# =========================================================
# AEGIS BOOTSTRAP (KISS)
# =========================================================
#
# OPERATOR GUIDE
#
# ---------------------------------------------------------
# ENGINEERING PLAN EXECUTION
# ---------------------------------------------------------
#
# ./run_aegis.sh --plan <EngineeringPlan.md>
#
# Executes the tasks listed in the plan sequentially:
#   parse_cli
#   -> prepare workspace
#   -> run Runtime for each task
#   -> read validated_result
#   -> persist and promote changes to main repository
#
# ---------------------------------------------------------
# FAIL FAST
# ---------------------------------------------------------
#
# Any task failure immediately aborts execution.
#
# =========================================================

set -Eeuo pipefail



# Tracks whether the Isolated Workspace was successfully initialized.
# Used by the cleanup trap to avoid removing a workspace that was never created.
WORKSPACE_INITIALIZED=false




ISSUE_PATH=""


require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[RUN][FATAL] missing dependency: $1" >&2
    exit 1
  }
}

check_dependencies() {

  echo
  echo "Checking requirements..."
  echo

  require jq
  echo "jq           ✓"

  require git
  echo "git          ✓"

  echo
}

show_final_report() {
  echo
  echo "══════════════════════════════"
  echo "AEGIS RUN REPORT"
  echo "══════════════════════════════"
  echo
  echo "Plan Status:"
  echo "SUCCESS"
  echo
  echo "══════════════════════════════"
}

# =========================================================
# BOOTSTRAP — PLAN PARSING
# =========================================================

# Resolve the first unchecked task from the Engineering Plan.
# Outputs the task text, or empty string if none remain.
resolve_next_task() {
  local plan="$1"
  grep -m 1 '^[[:space:]]*- \[ \]' "${plan}" \
    | sed -E 's/^[[:space:]]*- \[ \] //'
}

# Mark the first unchecked task as completed.
check_next_task() {
  local plan="$1"
  # Portable: replace first occurrence of '- [ ]' with '- [x]'
  python3 -c '
import sys
plan = sys.argv[1]
with open(plan, "r") as f:
    content = f.read()
new_content = content.replace("- [ ]", "- [x]", 1)
with open(plan, "w") as f:
    f.write(new_content)
' "${plan}"
}

# Extract the plan title (first # heading) for display.
resolve_plan_title() {
  local plan="$1"
  grep -m 1 '^# ' "${plan}" | sed 's/^# //'
}

# Extract the plan description (first non-heading, non-task paragraph).
resolve_plan_description() {
  local plan="$1"
  awk '/^# /{found=1; next} found && /^[^-#[:space:]]/{print; exit}' "${plan}"
}

# Display the current plan contents for review.
show_plan_review() {
  local plan="$1"
  echo
  echo "════════════════════════════════════════"
  echo "  ENGINEERING PLAN"
  echo "════════════════════════════════════════"
  cat "${plan}"
  echo
  echo "════════════════════════════════════════"
  echo
}

# Invoke the Planning Translator skill (issue_refiner) via raw_llm.
refine_plan_with_ai() {
  local plan="$1"
  local skill=".skills/bootstrap/issue_refiner.md"

  [[ -f "${skill}" ]] || {
    echo "[BOOTSTRAP][WARN] issue_refiner skill not found — skipping refinement."
    return 0
  }

  [[ -f "scripts/substrates/raw_llm.sh" ]] || {
    echo "[BOOTSTRAP][WARN] raw_llm substrate not found — skipping refinement."
    return 0
  }

  local plan_content
  plan_content="$(cat "${plan}")"

  local refined
  refined="$(
    AEGIS_ACTIVE_TASK="" \
    AEGIS_ISSUE_DESCRIPTION="${plan_content}" \
    bash scripts/substrates/raw_llm.sh "${skill}"
  )" || {
    echo "[BOOTSTRAP][WARN] Refinement failed — keeping original plan."
    return 0
  }

  if [[ -n "${refined}" ]]; then
    printf '%s\n' "${refined}" > "${plan}"
    echo "[BOOTSTRAP] Plan refined."
  fi
}

# Interactive Bootstrap review loop.
prepare_issue() {
  local plan="$1"

  while true; do
    show_plan_review "${plan}"
    echo "How do you want to continue?"
    echo "  1) Execute"
    echo "  2) Edit"
    echo "  3) Improve with AI"
    echo "  4) Cancel"
    echo
    read -r -p "> " choice

    case "${choice}" in
      1) return 0 ;;
      2)
        local editor="${EDITOR:-vi}"
        "${editor}" "${plan}"
        ;;
      3)
        refine_plan_with_ai "${plan}"
        ;;
      4)
        echo "[BOOTSTRAP] Cancelled."
        exit 0
        ;;
      *)
        echo "[BOOTSTRAP] Invalid choice. Please enter 1, 2, 3 or 4."
        ;;
    esac
  done
}

# =========================================================
# BOOTSTRAP — WORKSPACE LIFECYCLE
# =========================================================

ISSUE_WORKSPACE_PATH=".harness/execution_surfaces/issue_workspace"

initialize_workspace() {
  echo
  echo "[BOOTSTRAP] Initializing Isolated Workspace..."

  # Remove stale worktree if exists
  if [[ -d "${ISSUE_WORKSPACE_PATH}" ]]; then
    git worktree remove --force "${ISSUE_WORKSPACE_PATH}" 2>/dev/null || true
  fi

  git worktree add --detach "${ISSUE_WORKSPACE_PATH}" HEAD

  export AEGIS_WORKSPACE_PATH="${ISSUE_WORKSPACE_PATH}"
  echo "[BOOTSTRAP] Workspace ready: ${ISSUE_WORKSPACE_PATH}"
}

finalize_workspace() {
  local plan="$1"

  echo
  echo "════════════════════════════════════════"
  echo "  ALL TASKS COMPLETE"
  echo "════════════════════════════════════════"
  echo
  echo "How do you want to continue?"
  echo "  1) Commit"
  echo "  2) Add new tasks"
  echo "  3) Close without commit"
  echo
  read -r -p "> " choice

  case "${choice}" in
    1)
      _promote_workspace "${plan}"
      ;;
    2)
      local editor="${EDITOR:-vi}"
      "${editor}" "${plan}"
      # Return 1 — execute_issue() loop will pick up new tasks.
      return 1
      ;;
    3)
      echo "[BOOTSTRAP] Closed without commit."
      ;;
    *)
      echo "[BOOTSTRAP] Invalid choice. Closing without commit."
      ;;
  esac

  # Workspace teardown is handled by the EXIT trap.
  return 0
}

# =========================================================
# PHASE 0.4 — GIT PROMOTION
# =========================================================
#
# Promotion flow:
#   1. Commit all workspace changes inside the worktree → get SHA.
#   2. cherry-pick that SHA onto the main repo.
#
# This is the only correct way to promote from a detached-HEAD worktree.
# git merge/cherry-pick require a commit ref, not a filesystem path.

_promote_workspace() {
  local plan="$1"
  local title
  title="$(resolve_plan_title "${plan}")"

  echo "[BOOTSTRAP] Committing workspace changes..."

  local commit_msg="${title}"
  local summary_file=".harness/runtime/commit_summary.json"
  if [[ -f "${summary_file}" ]]; then
    local type scope subject
    type="$(jq -r '.type // empty' "${summary_file}" 2>/dev/null || echo "")"
    scope="$(jq -r '.scope // empty' "${summary_file}" 2>/dev/null || echo "")"
    subject="$(jq -r '.subject // empty' "${summary_file}" 2>/dev/null || echo "")"
    
    if [[ -n "${type}" && -n "${subject}" ]]; then
      if [[ -n "${scope}" ]]; then
        commit_msg="${type}(${scope}): ${subject}"
      else
        commit_msg="${type}: ${subject}"
      fi
      
      local num_points
      num_points="$(jq '.summary | length' "${summary_file}" 2>/dev/null || echo "0")"
      if [[ "${num_points}" -gt 0 ]]; then
        commit_msg+=$'\n\n'
        while IFS= read -r point; do
          commit_msg+=$'- '"${point}"$'\n'
        done < <(jq -r '.summary[]' "${summary_file}" 2>/dev/null)
      fi
    fi
  fi

  local commit_sha
  commit_sha="$(
    cd "${ISSUE_WORKSPACE_PATH}" &&
    git add -A &&
    git diff --cached --quiet && {
      echo "[BOOTSTRAP] No changes to commit." >&2
      echo ""
    } || {
      git commit -m "${commit_msg}" --quiet &&
      git rev-parse HEAD
    }
  )" || {
    echo "[BOOTSTRAP][WARN] Workspace commit failed. No changes promoted."
    return 0
  }

  if [[ -z "${commit_sha}" ]]; then
    echo "[BOOTSTRAP] Nothing to promote."
    return 0
  fi

  echo "[BOOTSTRAP] Promoting commit ${commit_sha} to main repository..."

  git cherry-pick "${commit_sha}" || {
    echo "[BOOTSTRAP][WARN] cherry-pick failed. Resolve conflicts manually."
    git cherry-pick --abort 2>/dev/null || true
    return 0
  }

  echo "[BOOTSTRAP] Promotion complete."
}

# =========================================================
# BOOTSTRAP — ISSUE EXECUTION LOOP
# =========================================================

# =========================================================
# PHASE 0.3 — VALIDATED RESULT
# =========================================================
#
# execute_issue() selects and runs each task from the plan,
# verifying the validation verdict of the task.

run_bounded_task() {
  local task="$1"
  local workspace="$2"

  echo
  echo "================================================="
  echo "EXECUTE TASK VIA RUNTIME"
  echo "================================================="

  env -i \
    PATH="${PATH}" \
    HOME="${HOME}" \
    TERM="${TERM:-xterm}" \
    USER="${USER:-}" \
    AEGIS_INVESTIGATION_INPUT="${task}" \
    AEGIS_EXECUTION_TARGET_PATH="${workspace}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    bash runtime_aegis.sh --execute-task
}

execute_issue() {
  local plan="$1"

  while true; do
    local active_task
    active_task="$(resolve_next_task "${plan}")"

    if [[ -z "${active_task}" ]]; then
      finalize_workspace "${plan}" && break || continue
    fi

    echo
    echo "════════════════════════════════════════"
    echo "  ACTIVE TASK"
    echo "  ${active_task}"
    echo "════════════════════════════════════════"
    echo

    local workspace="${AEGIS_WORKSPACE_PATH}"
    local task_success=false
    local result_file=".harness/runtime/validated_result.json"

    rm -f "${result_file}"

    if run_bounded_task "${active_task}" "${workspace}"; then
      if [[ -f "${result_file}" ]]; then
        local status
        status="$(jq -r '.status // "rejected"' "${result_file}" 2>/dev/null || echo "rejected")"
        if [[ "${status}" == "accepted" ]]; then
          task_success=true
        else
          echo "[BOOTSTRAP] Validated Result: rejected. Halting execution."
        fi
      else
        echo "[BOOTSTRAP][WARN] Runtime exited successfully but no validated_result.json was found. Treating as rejected."
      fi
    else
      echo "[BOOTSTRAP] Runtime execution failed. Halting task."
    fi

    if $task_success; then
      _promote_workspace "${plan}"
      check_next_task "${plan}"
      echo "[BOOTSTRAP] Task completed and marked."
      
      show_final_report

      local next_task
      next_task="$(resolve_next_task "${plan}")"
      if [[ -n "${next_task}" ]]; then
        echo
        echo -n "[BOOTSTRAP] Proceed to next task: '${next_task}'? (Y/n): "
        local proceed_choice
        read -r proceed_choice
        if [[ "${proceed_choice}" == "n" || "${proceed_choice}" == "N" ]]; then
          echo "[BOOTSTRAP] Execution paused by user."
          break
        fi
      fi
    else
      echo "[BOOTSTRAP] Task execution was unsuccessful. Halting issue execution."
      break
    fi
  done
}

# =========================================================
# CLI PARSING
# =========================================================

parse_cli() {

  while [[ $# -gt 0 ]]; do

    case "$1" in

      --plan)
        shift
        [[ $# -gt 0 ]] || { echo "[RUN][FATAL] missing plan value" >&2; exit 1; }
        ISSUE_PATH="$1"
        ;;

      -*)
        echo "[RUN][FATAL] unknown argument: $1" >&2
        exit 1
        ;;

      *)
        # Auto-detect: if argument is a readable .md file, treat as Engineering Plan
        if [[ -f "$1" ]] && [[ "$1" == *.md ]]; then
          ISSUE_PATH="$1"
        else
          echo "[RUN][FATAL] unknown argument: $1" >&2
          exit 1
        fi
        ;;

    esac

    shift
  done

}

main() {
  parse_cli "$@"
  check_dependencies

  # Fallback logic: check for local Issue.md or template if no path is provided
  if [[ -z "${ISSUE_PATH}" ]]; then
    if [[ -f "Issue.md" ]]; then
      echo "[BOOTSTRAP] Auto-detected local plan: Issue.md"
      ISSUE_PATH="Issue.md"
    elif [[ -f ".templates/default_issue.md" ]]; then
      echo "[BOOTSTRAP] No Engineering Plan provided and 'Issue.md' not found."
      echo -n "[BOOTSTRAP] Would you like to create a default 'Issue.md' from template? (y/N): "
      local response
      read -r response
      if [[ "${response}" =~ ^[Yy]$ ]]; then
        cp ".templates/default_issue.md" "Issue.md"
        echo "[BOOTSTRAP] Created 'Issue.md' in the current directory."
        echo -n "[BOOTSTRAP] Edit 'Issue.md' to describe your tasks, then press Enter to execute it: "
        read -r _
        ISSUE_PATH="Issue.md"
      fi
    fi
  fi

  if [[ -n "${ISSUE_PATH}" ]]; then
    [[ -f "${ISSUE_PATH}" ]] || {
      echo "[RUN][FATAL] Engineering Plan not found: ${ISSUE_PATH}" >&2
      exit 1
    }

    _cleanup_workspace() {
      if [[ "${WORKSPACE_INITIALIZED}" == "true" ]]; then
        echo "[BOOTSTRAP] Cleaning up Isolated Workspace..." >&2
        git worktree remove --force "${ISSUE_WORKSPACE_PATH}" >/dev/null 2>&1 || true
        git worktree prune >/dev/null 2>&1 || true
      fi
    }
    trap '_cleanup_workspace' EXIT INT TERM

    prepare_issue "${ISSUE_PATH}"
    initialize_workspace
    WORKSPACE_INITIALIZED=true
    execute_issue "${ISSUE_PATH}"
    return 0
  else
    echo "[RUN][FATAL] No Engineering Plan provided. Aegis now operates exclusively in planning-centric execution." >&2
    echo "Usage: ./run_aegis.sh --plan <EngineeringPlan.md>" >&2
    exit 1
  fi
}

main "$@"
