#!/usr/bin/env bash

# =========================================================
# Mutation scope gate — hard authority ⊆ targets
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/substrates/mutation_scope_gate.sh"

# --- empty authorized → skip (no-op pass) ---
if ! mutation_scope_check "" $'src/a.ts\n'; then
  fail "empty_authorized_should_skip"
fi

# --- empty changed → pass ---
if ! mutation_scope_check $'src/a.ts\n' ""; then
  fail "empty_changed_should_pass"
fi

# --- authorized exact match ---
if ! mutation_scope_check $'src/a.ts\nsrc/b.ts\n' $'src/a.ts\n'; then
  fail "exact_match_should_pass"
fi

# --- ./ prefix normalized ---
if ! mutation_scope_check $'src/a.ts\n' $'./src/a.ts\n'; then
  fail "dot_slash_should_normalize"
fi

# --- unauthorized path → fail + list offender ---
offenders=""
if offenders="$(mutation_scope_check $'src/a.ts\n' $'src/a.ts\nsrc/evil.ts\n')"; then
  fail "unauthorized_should_fail"
fi
echo "${offenders}" | grep -qx 'src/evil.ts' \
  || fail "offender_not_listed: ${offenders}"
echo "${offenders}" | grep -q 'src/a.ts' \
  && fail "authorized_path_listed_as_offender"

# --- CLI wrapper ---
auth_f="$(mktemp)"
chg_f="$(mktemp)"
printf '%s\n' "src/ok.ts" > "${auth_f}"
printf '%s\n' "src/ok.ts" "src/leak.ts" > "${chg_f}"

set +e
cli_out="$(bash "${AEGIS_TEST_ROOT}/scripts/substrates/mutation_scope_gate.sh" \
  --authorized-file "${auth_f}" \
  --changed-file "${chg_f}" 2>/dev/null)"
cli_rc=$?
set -e
rm -f "${auth_f}" "${chg_f}"

[[ "${cli_rc}" -eq 1 ]] \
  || fail "cli_should_exit_1_on_violation: ${cli_rc}"
echo "${cli_out}" | grep -qx 'src/leak.ts' \
  || fail "cli_missing_offender: ${cli_out}"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/run_outcome.sh"
line="$(aegis_classify_reason "mutation_scope_violation: src/leak.ts")"
class="${line%%$'\t'*}"
[[ "${class}" == "scope" ]] \
  || fail "scope_violation_class: ${class}"

echo "[PASS] mutation scope gate"
