#!/usr/bin/env bash

# =========================================================
# ./aegis CLI — demand shape and the guards before the network
# =========================================================
#
# Everything here runs offline: each case stops before `gh issue
# create`, so the suite never touches GitHub or a provider.
#
# Contract:
#
# - --accept is required (it seeds the prompt, the commit record
#   and the regression rail; derived from prose it yields words)
# - one target per go
# - the generated demand carries no ## Tasks and no filler ## Change
#   (filler words would leak into the tokenized Acceptance)
# - declining the confirmation creates nothing and says so in JSON
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

aegis_cli="${AEGIS_TEST_ROOT}/aegis"
[[ -x "${aegis_cli}" ]] || fail "aegis is not executable"

# These cases exercise the legacy mechanical intake (derive accept from goal).
# Quality intake is the product default; covered in test_intake_quality.sh.
export AEGIS_INTAKE_RELAXED=1
export AEGIS_BRIEFING=0

# --- context is read-only and always answers ---
context_out="$("${aegis_cli}" context 2>&1)" \
  || fail "context failed: ${context_out}"
printf '%s\n' "${context_out}" | grep -q 'registo:' \
  || fail "context did not report the record: ${context_out}"

# --- --accept is required ---
set +e
accept_out="$("${aegis_cli}" go --goal "x" --target src/index.ts 2>&1)"
accept_rc=$?
set -e
[[ "${accept_rc}" -ne 0 ]] || fail "go without --accept should fail"
printf '%s\n' "${accept_out}" | grep -q 'missing_accept' \
  || fail "go without --accept gave the wrong reason: ${accept_out}"

# --- one target per go ---
set +e
target_out="$(
  "${aegis_cli}" go --goal "x" --accept tokenA \
    --target src/index.ts --target src/other.ts 2>&1
)"
target_rc=$?
set -e
[[ "${target_rc}" -ne 0 ]] || fail "go with two targets should fail"
printf '%s\n' "${target_out}" | grep -q 'multiple_targets' \
  || fail "two targets gave the wrong reason: ${target_out}"

# --- demand shape, and declining creates nothing ---
set +e
draft_out="$(
  printf 'n\n' | "${aegis_cli}" go \
    --goal "converter Gigabits em Terabits em src/index.ts" \
    --target src/index.ts \
    --accept converterGigabitsEmTerabits \
    --accept "/ 1000" 2>&1
)"
draft_rc=$?
set -e

[[ "${draft_rc}" -ne 0 ]] || fail "declining the prompt should exit non-zero"

printf '%s\n' "${draft_out}" | grep -q '^## Tasks' \
  && fail "generated demand still carries a checklist"
printf '%s\n' "${draft_out}" | grep -q '^## Change' \
  && fail "generated demand carries a filler Change section"
printf '%s\n' "${draft_out}" | grep -q '^## Briefing' \
  || fail "generated demand missing ## Briefing: ${draft_out}"
printf '%s\n' "${draft_out}" | grep -q '^## Out of scope' \
  || fail "generated demand missing ## Out of scope: ${draft_out}"
printf '%s\n' "${draft_out}" | grep -q '^## Constraints' \
  || fail "generated demand missing ## Constraints: ${draft_out}"

printf '%s\n' "${draft_out}" | grep -qx -- '- converterGigabitsEmTerabits' \
  || fail "acceptance token missing from the demand: ${draft_out}"
printf '%s\n' "${draft_out}" | grep -qx -- '- / 1000' \
  || fail "acceptance token with spaces was mangled: ${draft_out}"

# No prose leaking into Acceptance: every bullet there must be a token
# the operator passed.
acceptance_block="$(
  printf '%s\n' "${draft_out}" \
    | awk '/^## Acceptance$/ { p = 1; next } /^## / { p = 0 } p' \
    | grep -v '^$'
)"
acceptance_lines="$(printf '%s\n' "${acceptance_block}" | grep -c . || true)"
[[ "${acceptance_lines}" -eq 2 ]] \
  || fail "acceptance has ${acceptance_lines} bullets, expected the 2 given"

printf '%s\n' "${draft_out}" | grep -q 'run_allowed=true' \
  || fail "fit check did not allow a well-formed micro demand: ${draft_out}"
printf '%s\n' "${draft_out}" | grep -q '"status":"CANCELLED"' \
  || fail "declining did not emit the CANCELLED result line"

# --- acceptance derived from a goal that already names code ---
set +e
derived_out="$(
  printf 'n\n' | "${aegis_cli}" go \
    "adicionar converterPetabitsEmBits a src/index.ts" \
    --target src/index.ts 2>&1
)"
derived_rc=$?
set -e
[[ "${derived_rc}" -ne 0 ]] || fail "declining the prompt should exit non-zero"
printf '%s\n' "${derived_out}" | grep -qx -- '- converterPetabitsEmBits' \
  || fail "acceptance not derived from a goal naming code: ${derived_out}"
printf '%s\n' "${derived_out}" | grep -q 'run_allowed=true' \
  || fail "derived demand did not pass the fit check"

# --- prose-only goal: refuse instead of inventing a permanent token ---
set +e
prose_out="$(
  "${aegis_cli}" go "converter uma coisa noutra coisa" --target src/index.ts 2>&1
)"
prose_rc=$?
set -e
[[ "${prose_rc}" -ne 0 ]] || fail "a prose-only goal should not produce acceptance"
printf '%s\n' "${prose_out}" | grep -q 'missing_accept' \
  || fail "prose-only goal gave the wrong reason: ${prose_out}"

# --- token shape: extracted, never invented ---
# shellcheck disable=SC1090
source "${aegis_cli}"

shape="$(derive_accept_tokens 'adicionar converterBytesEmBits e MAX_SIZE 1024 a src/index.ts por favor')"
for expected in converterBytesEmBits MAX_SIZE 1024; do
  printf '%s\n' "${shape}" | grep -Fxq -- "${expected}" \
    || fail "code-shaped token dropped: ${expected} (got: ${shape//$'\n'/ | })"
done
for prose in adicionar por favor e a src/index.ts; do
  printf '%s\n' "${shape}" | grep -Fxq -- "${prose}" \
    && fail "prose word became an acceptance token: ${prose}"
done

# --- net-new targets: git diff is blind to untracked files ---
# A create demand produces a file git diff never reports, which once made
# the gate believe nothing had been promoted. (aegis is already sourced.)
net_new_repo="$(mktemp -d)"
git -C "${net_new_repo}" init --quiet
git -C "${net_new_repo}" config user.email "test@aegis.local"
git -C "${net_new_repo}" config user.name "Aegis Test"
mkdir -p "${net_new_repo}/src"
printf 'export const x = 1;\n' > "${net_new_repo}/src/index.ts"
git -C "${net_new_repo}" add -A
git -C "${net_new_repo}" commit --quiet -m "feat: initial"

(
  cd "${net_new_repo}" || exit 1
  target_is_clean src || exit 1
  printf 'export const y = 2;\n' > src/novo.ts
  target_is_clean src && exit 1
  changes="$(target_changes src)"
  [[ "${changes}" == "src/novo.ts" ]] || exit 1
) || fail "net-new file not seen as a worktree change"

rm -rf "${net_new_repo}"

echo "[AEGIS][TEST][PASS] aegis cli: demand shape, accept guard, decline path, net-new"
