#!/usr/bin/env bash

# =========================================================
# Demand materialization — normalize, path safety, issue mock
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
source "${AEGIS_TEST_ROOT}/scripts/lib/demand.sh"

# --- free-text passes through ---
free="fix the power helper in src/index.ts"
out="$(aegis_normalize_demand_text "${free}")"
[[ "${out}" == "${free}" ]] \
  || fail "free_text_should_pass_through"

# --- structured demand gets compact head + body ---
structured="$(cat <<'EOF'
## Goal
Add power function to math helpers.

## Targets
- src/index.ts
- src/math.ts

## Acceptance
- power(2,3) returns 8

## Out of scope
- UI changes

## Constraints
- TypeScript strict
EOF
)"

norm="$(aegis_normalize_demand_text "${structured}")"
printf '%s' "${norm}" | grep -q 'Demand (structured):' \
  || fail "missing_structured_head"
printf '%s' "${norm}" | grep -q 'Goal: Add power function' \
  || fail "missing_goal_line"
printf '%s' "${norm}" | grep -q 'Targets:.*src/index.ts' \
  || fail "missing_targets_line"
printf '%s' "${norm}" | grep -q 'Done when:.*power(2,3)' \
  || fail "missing_acceptance_line"
# Original body retained for audit / path regex
printf '%s' "${norm}" | grep -q '## Goal' \
  || fail "missing_original_body"

# --- path safety: traversal fatal ---
set +e
trap '' ERR
unsafe_out="$(aegis_materialize_investigation_input 'touch ../etc/passwd.ts' 2>&1)"
unsafe_rc=$?
set -e
[[ "${unsafe_rc}" -ne 0 ]] \
  || fail "traversal_should_fatal"
printf '%s' "${unsafe_out}" | grep -q 'demand_path_unsafe' \
  || fail "traversal_token_missing: ${unsafe_out}"

# --- path safety: absolute fatal ---
set +e
abs_out="$(aegis_materialize_investigation_input 'edit /tmp/evil.ts' 2>&1)"
abs_rc=$?
set -e
[[ "${abs_rc}" -ne 0 ]] \
  || fail "absolute_should_fatal"
printf '%s' "${abs_out}" | grep -q 'demand_path_unsafe' \
  || fail "absolute_token_missing: ${abs_out}"

# --- materialize safe structured demand ---
safe="$(aegis_materialize_investigation_input "${structured}")"
printf '%s' "${safe}" | grep -q 'src/index.ts' \
  || fail "safe_materialize_lost_path"

# --- normalize is idempotent ---
twice="$(aegis_normalize_demand_text "${safe}")"
[[ "${twice}" == "${safe}" ]] \
  || fail "normalize_not_idempotent"

# --- issue fetch uses gh (mock via PATH) ---
MOCK_BIN="$(mktemp -d)"
cat > "${MOCK_BIN}/gh" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  jq -n '{title:"Demo issue",body:"## Goal\nShip widget.\n\n## Targets\n- src/ui/fake_import.ts"}'
  exit 0
fi
echo "unexpected gh $*" >&2
exit 1
EOF
chmod +x "${MOCK_BIN}/gh"
export PATH="${MOCK_BIN}:${PATH}"

issue_raw="$(aegis_fetch_issue_demand 42)"
printf '%s' "${issue_raw}" | grep -q '# Issue #42: Demo issue' \
  || fail "issue_header_missing"
printf '%s' "${issue_raw}" | grep -q 'src/ui/fake_import.ts' \
  || fail "issue_body_missing"

issue_mat="$(aegis_materialize_investigation_input "${issue_raw}")"
printf '%s' "${issue_mat}" | grep -q 'Demand (structured):' \
  || fail "issue_structured_normalize_failed"
printf '%s' "${issue_mat}" | grep -q 'Goal: Ship widget' \
  || fail "issue_goal_compact_missing"

rm -rf "${MOCK_BIN}"

# --- task-scoped demand: global issue context + one checklist task ---
multi_issue="$(cat <<'EOF'
# Issue #42: Token bucket

## Goal
Token bucket in src/tokenBucket.ts reexported by src/index.ts.

## Targets
- src/tokenBucket.ts
- src/index.ts

## Tasks
- [ ] Create src/tokenBucket.ts with public consume/refill API
- [x] Reexport public API from src/index.ts
- [ ] Add unit smoke for consume

## Change
- Add tokenBucket module
- Reexport from index

## Acceptance
- Public API exists without any
- index reexports symbols

## Out of scope
- e2e tests; drive-by refactors

## Constraints
- no any; NodeNext .js relative imports

## Notes
Internal only — must not appear in task-scoped demand
EOF
)"

[[ "$(aegis_demand_task_count "${multi_issue}")" == "3" ]] \
  || fail "task_count_expected_3"
[[ "$(aegis_demand_task_title_at "${multi_issue}" 1)" == "Create src/tokenBucket.ts with public consume/refill API" ]] \
  || fail "task_1_title_wrong"
[[ "$(aegis_demand_task_title_at "${multi_issue}" 2)" == "Reexport public API from src/index.ts" ]] \
  || fail "task_2_title_wrong"

scoped="$(aegis_materialize_task_scoped_demand "${multi_issue}" 1 42)"
printf '%s' "${scoped}" | head -n 1 | grep -qE '^AEGIS_DEMAND issue:42 task:1 sha:' \
  || fail "missing_aegis_demand_header: $(printf '%s' "${scoped}" | head -n 1)"
printf '%s' "${scoped}" | grep -q 'ISSUE_CONTEXT:.*Token bucket' \
  || fail "missing_issue_context_global_goal"
printf '%s' "${scoped}" | grep -q 'GOAL: Create src/tokenBucket.ts' \
  || fail "missing_task_goal"
printf '%s' "${scoped}" | grep -q 'TARGETS:.*src/tokenBucket.ts' \
  || fail "missing_global_targets_in_head"
printf '%s' "${scoped}" | grep -q 'CONSTRAINTS:.*no any' \
  || fail "missing_global_constraints"
printf '%s' "${scoped}" | grep -q '## Targets' \
  || fail "missing_slim_targets_section"
# Other tasks and Notes must not leak into the scoped demand body.
printf '%s' "${scoped}" | grep -q 'Add unit smoke for consume' \
  && fail "other_task_leaked_into_scoped_demand"
printf '%s' "${scoped}" | grep -qi 'Internal only' \
  && fail "notes_leaked_into_scoped_demand"
printf '%s' "${scoped}" | grep -q '## Tasks' \
  && fail "tasks_section_should_be_omitted"

# Env-driven materialize path
export AEGIS_ISSUE_NUMBER=42
export AEGIS_ISSUE_TASK=2
scoped_env="$(aegis_materialize_investigation_input "${multi_issue}")"
printf '%s' "${scoped_env}" | grep -q 'task:2' \
  || fail "env_task_not_applied"
printf '%s' "${scoped_env}" | grep -q 'GOAL: Reexport public API from src/index.ts' \
  || fail "env_task_goal_wrong"
# Idempotent when already AEGIS_DEMAND
scoped_twice="$(aegis_materialize_investigation_input "${scoped_env}")"
[[ "${scoped_twice}" == "${scoped_env}" ]] \
  || fail "task_scoped_not_idempotent"
unset AEGIS_ISSUE_TASK AEGIS_ISSUE_NUMBER AEGIS_DEMAND_SHA

# Fatal: task out of range
set +e
trap '' ERR
miss_out="$(aegis_materialize_task_scoped_demand "${multi_issue}" 9 42 2>&1)"
miss_rc=$?
set -e
[[ "${miss_rc}" -ne 0 ]] || fail "out_of_range_task_should_fatal"
printf '%s' "${miss_out}" | grep -q 'demand_task_missing' \
  || fail "out_of_range_token_missing: ${miss_out}"

# Fatal: no task list
set +e
trap '' ERR
empty_tasks_out="$(aegis_materialize_task_scoped_demand "${structured}" 1 1 2>&1)"
empty_tasks_rc=$?
set -e
[[ "${empty_tasks_rc}" -ne 0 ]] || fail "empty_task_list_should_fatal"
printf '%s' "${empty_tasks_out}" | grep -q 'demand_task_list_empty' \
  || fail "empty_task_list_token_missing: ${empty_tasks_out}"

# --- skills must not advertise removed deep topology surfaces ---
if grep -REn 'structural_context|node_index|structural\.builder|AEGIS_DISCOVERY_DEPTH' \
  .skills/ >/dev/null 2>&1; then
  fail "skills_still_reference_removed_topology"
fi

echo "[AEGIS][TEST] demand materialization passed"
