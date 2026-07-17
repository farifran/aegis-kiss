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

# --- skills must not advertise removed deep topology surfaces ---
if grep -REn 'structural_context|node_index|structural\.builder|AEGIS_DISCOVERY_DEPTH' \
  .skills/ >/dev/null 2>&1; then
  fail "skills_still_reference_removed_topology"
fi

echo "[AEGIS][TEST] demand materialization passed"
