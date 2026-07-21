#!/usr/bin/env bash
# =========================================================
# fit_check_demand — rails + model-risk + auto-fixes
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/fit_check.sh"

# --- micro demand (like issue #5) should allow run ---
micro="$(cat <<'EOF'
## Goal
TokenBucket in src/tokenBucket.ts

## Targets
- src/tokenBucket.ts

## Tasks
- [ ] Task 1 — create TokenBucket

## Change
1. export class TokenBucket
2. consume with BigInt

## Acceptance
- TokenBucket
- consume
- BigInt

## Out of scope
- network
- UI

## Constraints
- no any
EOF
)"
r="$(aegis_fit_check_demand "${micro}")"
echo "${r}" | jq -e '.schema == "aegis.fit_check.v1" and .run_allowed == true and .rails_ok == true' >/dev/null \
  || fail "micro_should_run: ${r}"

# --- monster multi-target should block and propose units ---
monster="$(cat <<'EOF'
## Goal
Token bucket offline-first with bitmask and reexport high precision BigInt nanos

## Targets
- src/tokenBucket.ts
- src/index.ts

## Tasks
- [ ] Task 1 — create
- [ ] Task 2 — bitmask
- [ ] Task 3 — reexport

## Change
Create module, accumulate bits, high-precision offline-first, reexport from index, bitmask flags.

## Acceptance
- converterMegabytesToKilobits is exported from src/index.ts with typed number params and no any

## Out of scope
- package.js
- e2e

## Constraints
- see package.json for deps
EOF
)"
r="$(aegis_fit_check_demand "${monster}")"
echo "${r}" | jq -e '.run_allowed == false' >/dev/null \
  || fail "monster_should_block: ${r}"
echo "${r}" | jq -e '(.proposed_units | length) >= 1 or (.blockers | length) >= 1' >/dev/null \
  || fail "monster_should_split_or_block: ${r}"
echo "${r}" | jq -e '.auto_fixes_applied | index("tokenize_acceptance") != null' >/dev/null \
  || fail "monster_should_tokenize_acceptance: ${r}"
# Create module unit must precede barrel reexport (index alphabetically first otherwise).
echo "${r}" | jq -e '
  (.proposed_units | length) >= 2
  and (.proposed_units[0].targets[0] == "src/tokenBucket.ts")
  and (.proposed_units[-1].targets[0] == "src/index.ts")
' >/dev/null \
  || fail "monster_unit_order_create_before_reexport: ${r}"
# Unit demand must keep algorithm intent (not only "Minimal stub").
echo "${r}" | jq -e '
  (.proposed_units[0].demand | test("Token bucket|BigInt|bitmask|offline"; "i"))
  and ((.proposed_units[0].demand | test("Minimal stub")) | not)
' >/dev/null \
  || fail "monster_unit0_keeps_algorithm_intent: $(echo "${r}" | jq -r '.proposed_units[0].demand')"

# --- free-text wraps to structured ---
r="$(aegis_fit_check_demand "add helper in src/foo.ts for megabits")"
echo "${r}" | jq -e '.auto_fixes_applied | index("wrap_free_text_to_structured") != null' >/dev/null \
  || fail "free_text_should_wrap: ${r}"
echo "${r}" | jq -e '.fixed_demand | test("## Goal")' >/dev/null \
  || fail "fixed_has_goal: ${r}"

# --- CLI exits 0 for micro ---
if ! printf '%s' "${micro}" | bash "${AEGIS_TEST_ROOT}/scripts/fit_check_demand.sh" >/tmp/aegis_fit_out.json 2>/tmp/aegis_fit_err.txt; then
  fail "cli_micro_exit: $(cat /tmp/aegis_fit_err.txt)"
fi
jq -e '.run_allowed == true' /tmp/aegis_fit_out.json >/dev/null \
  || fail "cli_micro_json"

# --- CLI exits 1 for monster ---
if printf '%s' "${monster}" | bash "${AEGIS_TEST_ROOT}/scripts/fit_check_demand.sh" >/tmp/aegis_fit_out2.json 2>/tmp/aegis_fit_err2.txt; then
  fail "cli_monster_should_exit_1"
fi
jq -e '.run_allowed == false' /tmp/aegis_fit_out2.json >/dev/null \
  || fail "cli_monster_json"

# --- emit-micros writes fit.json + unit-N.md with demand ---
micro_dir="$(mktemp -d)"
printf '%s' "${monster}" | bash "${AEGIS_TEST_ROOT}/scripts/fit_check_demand.sh" \
  --emit-micros "${micro_dir}" >/tmp/aegis_fit_emit.json 2>/tmp/aegis_fit_emit.err || true
[[ -f "${micro_dir}/fit.json" ]] || fail "emit_missing_fit_json"
n_units="$(jq '.proposed_units | length' "${micro_dir}/fit.json")"
[[ "${n_units}" -ge 1 ]] || fail "emit_no_units: ${n_units}"
[[ -f "${micro_dir}/unit-0.md" ]] || fail "emit_missing_unit0"
grep -q '## Goal' "${micro_dir}/unit-0.md" || fail "unit0_not_structured"
jq -e '.proposed_units[0].demand | type == "string" and length > 20' "${micro_dir}/fit.json" >/dev/null \
  || fail "unit0_demand_missing"
rm -rf "${micro_dir}"

echo "OK test_fit_check"
