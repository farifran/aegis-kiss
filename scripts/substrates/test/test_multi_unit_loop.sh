#!/usr/bin/env bash

# =========================================================
# Multi-unit plan helpers — offline (no gh, no provider)
# =========================================================
#
# Covers keep-progress policy building blocks:
#   - plan body with ## Tasks checklist
#   - aegis_md_check_task flips [ ] → [x]
#   - unit acceptance / target extraction
#   - record message carries Aegis-Task
#   - commit_unit_checkpoint creates a managed commit
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

aegis_cli="${AEGIS_TEST_ROOT}/aegis"
[[ -x "${aegis_cli}" ]] || fail "aegis is not executable"

# shellcheck disable=SC1090
source "${aegis_cli}"

# --- aegis_md_check_task ---
sample_body="$(cat <<'EOF'
## Goal
Parent intent.

## Tasks
- [ ] Task 1 — create module (`src/a.ts`) · accept: Alpha
- [ ] Task 2 — reexport (`src/index.ts`) · accept: Alpha
- [x] Task 3 — already done

## Constraints
- no any
EOF
)"

checked="$(aegis_md_check_task "${sample_body}" 2)"
printf '%s\n' "${checked}" | grep -qE '^- \[x\] Task 2' \
  || fail "task 2 was not checked: ${checked}"
printf '%s\n' "${checked}" | grep -qE '^- \[ \] Task 1' \
  || fail "task 1 should stay open: ${checked}"
printf '%s\n' "${checked}" | grep -qE '^- \[x\] Task 3' \
  || fail "task 3 should stay checked: ${checked}"

# --- strip + build plan body ---
parent="$(cat <<'EOF'
## Goal
Create module and reexport.

## Targets
- src/a.ts
- src/index.ts

## Acceptance
- Alpha

## Out of scope
- e2e

## Constraints
- no any
EOF
)"

micros="$(mktemp -d)"
mkdir -p "${micros}"
cat > "${micros}/unit-0.md" <<'EOF'
## Goal
create module only

## Targets
- src/a.ts

## Acceptance
- Alpha

## Out of scope
- src/index.ts
EOF
cat > "${micros}/unit-1.md" <<'EOF'
## Goal
reexport only

## Targets
- src/index.ts

## Acceptance
- Alpha

## Out of scope
- logic
EOF
cat > "${micros}/fit.json" <<'EOF'
{
  "proposed_units": [
    {"title": "create module only", "targets": ["src/a.ts"]},
    {"title": "reexport only", "targets": ["src/index.ts"]}
  ]
}
EOF

[[ "$(count_micro_units "${micros}")" == "2" ]] \
  || fail "count_micro_units expected 2"

plan="$(build_multiunit_plan_body "${parent}" "${micros}")"
printf '%s\n' "${plan}" | grep -q '^## Tasks' \
  || fail "plan missing ## Tasks: ${plan}"
printf '%s\n' "${plan}" | grep -qE '^- \[ \] Task 1 — create module only' \
  || fail "plan missing task 1: ${plan}"
printf '%s\n' "${plan}" | grep -qE '^- \[ \] Task 2 — reexport only' \
  || fail "plan missing task 2: ${plan}"
printf '%s\n' "${plan}" | grep -c '^## Tasks' | grep -qx 1 \
  || fail "duplicate ## Tasks sections"

acc0="$(unit_acceptance_csv "${micros}/unit-0.md")"
[[ "${acc0}" == "Alpha" ]] || fail "unit_acceptance_csv: ${acc0}"
t0="$(unit_target_paths "${micros}/unit-0.md" | tr '\n' ' ' | sed 's/ $//')"
[[ "${t0}" == "src/a.ts" ]] || fail "unit_target_paths: ${t0}"

# --- record message with Aegis-Task ---
msg="$(aegis_record_render_message "42" "Alpha" "Alpha" "1/2")"
printf '%s\n' "${msg}" | grep -qx 'Aegis-Issue: 42' \
  || fail "missing Aegis-Issue in message"
printf '%s\n' "${msg}" | grep -qx 'Aegis-Task: 1/2' \
  || fail "missing Aegis-Task in message"
printf '%s\n' "${msg}" | grep -qx 'Aegis-Accept: Alpha' \
  || fail "missing Aegis-Accept in message"

# --- commit_unit_checkpoint in a throwaway repo ---
repo="$(mktemp -d)"
git -C "${repo}" init --quiet
git -C "${repo}" config user.email "test@aegis.local"
git -C "${repo}" config user.name "Aegis Test"
mkdir -p "${repo}/src"
printf 'export const seed = 1;\n' > "${repo}/src/index.ts"
git -C "${repo}" add -A
git -C "${repo}" commit --quiet -m "feat: seed"

# Point runtime paths used by commit_unit_checkpoint at the temp repo layout.
# Helpers use ROOT-relative RUNTIME_DIR; run inside repo with a mini harness.
(
  cd "${repo}" || exit 1
  msg="$(mktemp)"
  printf 'export class Alpha {}\n' > src/a.ts
  paths="$(git status --porcelain --untracked-files=all -- src/a.ts | cut -c4-)"
  [[ -n "${paths}" ]] || exit 1
  # Same trailers commit_unit_checkpoint writes (plan already approved → no -e).
  aegis_record_render_message "7" "Alpha" "Alpha" "1/2" > "${msg}"
  git add -- src/a.ts
  git commit -F "${msg}" --quiet
  rm -f "${msg}"
  git log -1 --format=%B | grep -qx 'Aegis-Task: 1/2' || exit 1
  git log -1 --format=%B | grep -qx 'Aegis-Accept: Alpha' || exit 1
) || fail "per-unit checkpoint commit failed"

# --- first open task / task count / is_done ---
progress_body="$(cat <<'EOF'
## Goal
x

## Tasks
- [x] Task 1 — done
- [ ] Task 2 — next
- [ ] Task 3 — later
EOF
)"
[[ "$(aegis_md_task_count "${progress_body}")" == "3" ]] \
  || fail "task_count expected 3"
[[ "$(aegis_md_first_open_task "${progress_body}")" == "2" ]] \
  || fail "first_open expected 2"
aegis_md_task_is_done "${progress_body}" 1 \
  || fail "task 1 should be done"
aegis_md_task_is_done "${progress_body}" 2 \
  && fail "task 2 should be open"

# --- scoped briefing: create unit must not keep index barrel block ---
# aegis already sourced common.sh; re-sourcing it blows up on readonly vars.
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/fit_check.sh"

parent_with_briefing="$(cat <<'EOF'
## Goal
Token bucket and reexport

## Targets
- src/tokenBucket.ts
- src/index.ts

## Acceptance
- TokenBucket

## Briefing
1) export class TokenBucket:
   constructor() { this._x = 1n }
Em src/tokenBucket.ts:
   (module body)
Em src/index.ts:
   import { TokenBucket } from './tokenBucket.js'
   export { TokenBucket }

## Out of scope
- e2e

## Constraints
- no any
EOF
)"

create_demand="$(aegis_fit_unit_demand_md \
  "${parent_with_briefing}" \
  "create module only" \
  "omit reexport" \
  '["src/tokenBucket.ts"]')"
printf '%s\n' "${create_demand}" | grep -q 'TokenBucket' \
  || fail "create unit lost TokenBucket"
printf '%s\n' "${create_demand}" | grep -q "from './tokenBucket.js'" \
  && fail "create unit still has barrel reexport briefing: ${create_demand}"

reexport_demand="$(aegis_fit_unit_demand_md \
  "${parent_with_briefing}" \
  "reexport only" \
  "after create succeeds" \
  '["src/index.ts"]')"
printf '%s\n' "${reexport_demand}" | grep -qE 're-export|export \{' \
  || fail "reexport unit missing barrel intent: ${reexport_demand}"
printf '%s\n' "${reexport_demand}" | grep -q 'constructor() { this._x' \
  && fail "reexport unit still has class body briefing: ${reexport_demand}"

# --- uncheck task (force-task reopen) ---
reopened="$(aegis_md_uncheck_task "${progress_body}" 1)"
printf '%s\n' "${reopened}" | grep -qE '^- \[ \] Task 1' \
  || fail "task 1 should reopen to [ ]: ${reopened}"
aegis_md_task_is_done "${reopened}" 1 && fail "task 1 should not be done after uncheck"

# --- mechanical multi-export split (single file, 2+ briefing exports) ---
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/fit_check.sh"

multi_export_parent="$(cat <<'EOF'
## Goal
Class and helper in one file.

## Targets
- src/scheduler.ts

## Acceptance
- PriorityScheduler
- obterFilaSnapshot

## Briefing
1) export class PriorityScheduler:
   constructor() { this._q = [] }
2) export function obterFilaSnapshot(s: PriorityScheduler): number[]:
   return []

## Out of scope
- e2e

## Constraints
- no any
EOF
)"
names="$(aegis_fit_briefing_export_names "${multi_export_parent}")"
printf '%s\n' "${names}" | grep -qx 'PriorityScheduler' \
  || fail "export names missing class: ${names}"
printf '%s\n' "${names}" | grep -qx 'obterFilaSnapshot' \
  || fail "export names missing fn: ${names}"

units_json="$(aegis_fit_propose_units_json "${multi_export_parent}")"
n_u="$(printf '%s' "${units_json}" | jq 'length')"
[[ "${n_u}" -ge 2 ]] || fail "multi-export should propose >=2 units: ${units_json}"
printf '%s' "${units_json}" | jq -e '.[0].note | startswith("export_slice:")' >/dev/null \
  || fail "unit0 should be export_slice: ${units_json}"
slice_demand="$(printf '%s' "${units_json}" | jq -r '.[0].demand')"
printf '%s\n' "${slice_demand}" | grep -q 'PriorityScheduler' \
  || fail "slice demand missing PriorityScheduler"
# Second export should not dominate first unit's acceptance
acc0="$(printf '%s\n' "${slice_demand}" | awk '/^## Acceptance$/{p=1;next}/^## /{p=0}p')"
printf '%s\n' "${acc0}" | grep -q 'obterFilaSnapshot' \
  && fail "first slice should not require second export: ${acc0}"

rm -rf "${micros}" "${repo}"

echo "[AEGIS][TEST][PASS] multi-unit loop helpers: plan, checklist, force-task uncheck, multi-export split"
