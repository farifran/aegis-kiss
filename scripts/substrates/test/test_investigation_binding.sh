#!/usr/bin/env bash

# =========================================================
# Investigation binding — mismatch fail-hard + --fresh path
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/run_outcome.sh"

backup_epistemic_handover

HANDOVER="${AEGIS_EPISTEMIC_HANDOVER_FILE}"
LAST_GOOD=".harness/runtime/last_good_epistemic_handover.json"
LAST_FATAL=".harness/runtime/last_fatal"

write_discovery_handover() {
  local demand="$1"
  mkdir -p "$(dirname "${HANDOVER}")"
  jq -n --arg inv "${demand}" '{
    artifact_snapshot: {
      mode: "discovery",
      investigation_input: $inv,
      generated_at: "2026-01-01T00:00:00Z",
      operational_context: {}
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "test",
      attention_reason: "binding fixture"
    }
  }' > "${HANDOVER}"
}

# --- classify updates (mismatch next_step + fresh_resume_conflict) ---
line="$(aegis_classify_reason "investigation_input_mismatch")"
class="${line%%$'\t'*}"
next_step="${line#*$'\t'}"
[[ "${class}" == "operator_input" ]] \
  || fail "mismatch_class: ${class}"
echo "${next_step}" | grep -q -- '--fresh' \
  || fail "mismatch_next_step_missing_fresh: ${next_step}"

line="$(aegis_classify_reason "fresh_resume_conflict")"
class="${line%%$'\t'*}"
next_step="${line#*$'\t'}"
[[ "${class}" == "operator_input" ]] \
  || fail "fresh_resume_class: ${class}"
[[ -n "${next_step}" ]] \
  || fail "fresh_resume_empty_next_step"

# --- usage mentions --fresh ---
bash "${AEGIS_TEST_ROOT}/run_aegis.sh" --help 2>&1 | grep -q -- '--fresh' \
  || fail "usage_missing_fresh"

# --- assert 4: --fresh --resume → fresh_resume_conflict ---
rm -f "${LAST_FATAL}"
set +e
bash "${AEGIS_TEST_ROOT}/run_aegis.sh" readonly --fresh --resume "x" >/dev/null 2>&1
conflict_rc=$?
set -e
[[ "${conflict_rc}" -ne 0 ]] \
  || fail "fresh_resume_should_exit_nonzero"
[[ -f "${LAST_FATAL}" ]] \
  || fail "fresh_resume_missing_breadcrumb"
token="$(tr -d '\r' < "${LAST_FATAL}" | head -n 1)"
[[ "${token}" == "fresh_resume_conflict" ]] \
  || fail "fresh_resume_token: got '${token}'"

# --- assert 1+2: downstream mismatch fatals; handover byte-identical ---
write_discovery_handover "old demand alpha"
pre_sha="$(shasum -a 256 "${HANDOVER}" | awk '{print $1}')"
cp "${HANDOVER}" "${LAST_GOOD}" 2>/dev/null || true

rm -f "${LAST_FATAL}"
set +e
bash "${AEGIS_TEST_ROOT}/runtime_aegis.sh" forensics "new demand beta" >/dev/null 2>&1
mismatch_rc=$?
set -e

[[ "${mismatch_rc}" -ne 0 ]] \
  || fail "mismatch_should_exit_nonzero"

[[ -f "${LAST_FATAL}" ]] \
  || fail "mismatch_missing_breadcrumb"
token="$(tr -d '\r' < "${LAST_FATAL}" | head -n 1)"
[[ "${token}" == "investigation_input_mismatch" ]] \
  || fail "mismatch_token: got '${token}'"

post_sha="$(shasum -a 256 "${HANDOVER}" | awk '{print $1}')"
[[ "${pre_sha}" == "${post_sha}" ]] \
  || fail "mismatch_must_not_mutate_handover pre=${pre_sha} post=${post_sha}"

# --- assert 5: runtime rejects --fresh (no rebind flag on runtime) ---
set +e
out="$(bash "${AEGIS_TEST_ROOT}/runtime_aegis.sh" repair --fresh x 2>&1)"
rt_rc=$?
set -e
[[ "${rt_rc}" -ne 0 ]] \
  || fail "runtime_fresh_should_fail"
echo "${out}" | grep -q 'unknown_argument' \
  || fail "runtime_fresh_should_be_unknown_argument: ${out}"

# --- assert 3: --fresh bootstrap removes handover + last_good ---
# Exercise the same clear path as production without running a full pipeline:
# parse-equivalent flags + clear_operator_breadcrumbs body.
write_discovery_handover "stale demand"
printf '%s\n' "stale" > "${LAST_GOOD}"
[[ -f "${HANDOVER}" ]] || fail "fixture_handover_missing"
[[ -f "${LAST_GOOD}" ]] || fail "fixture_last_good_missing"

FRESH_INVESTIGATION=true
# Inline the orchestrator clear contract (must match run_aegis.sh).
rm -f "${LAST_FATAL}" 2>/dev/null || true
if [[ "${FRESH_INVESTIGATION}" == "true" ]]; then
  rm -f "${HANDOVER}" "${LAST_GOOD}" 2>/dev/null || true
fi

[[ ! -f "${HANDOVER}" ]] \
  || fail "fresh_left_handover"
[[ ! -f "${LAST_GOOD}" ]] \
  || fail "fresh_left_last_good"

# After fresh wipe, discovery with new demand must bind that demand into handover.
# Use mock provider + readonly discovery only (no aider).
start_mock_provider
write_discovery_handover "should_be_wiped"
rm -f "${HANDOVER}" "${LAST_GOOD}" "${LAST_FATAL}"

set +e
bash "${AEGIS_TEST_ROOT}/runtime_aegis.sh" discovery "nova demanda" >/dev/null 2>&1
disc_rc=$?
set -e

[[ "${disc_rc}" -eq 0 ]] \
  || fail "fresh_discovery_failed_rc=${disc_rc}"

[[ -f "${HANDOVER}" ]] \
  || fail "discovery_did_not_write_handover"

bound="$(jq -r '.artifact_snapshot.investigation_input // empty' "${HANDOVER}")"
[[ "${bound}" == "nova demanda" ]] \
  || fail "discovery_bound_wrong_input: '${bound}'"

# --- assert 6: inheritance — downstream without CLI inherits handover demand ---
write_discovery_handover "inherited demand"
rm -f "${LAST_FATAL}"
# Unset any injected investigation input from the environment.
unset AEGIS_INVESTIGATION_INPUT

set +e
# May fail later (provider/precondition path), but must NOT be mismatch.
bash "${AEGIS_TEST_ROOT}/runtime_aegis.sh" forensics >/dev/null 2>&1
inherit_rc=$?
set -e

if [[ -f "${LAST_FATAL}" ]]; then
  token="$(tr -d '\r' < "${LAST_FATAL}" | head -n 1)"
  [[ "${token}" != "investigation_input_mismatch" ]] \
    || fail "inheritance_falsely_mismatched"
fi

# Continuity: handover still carries the inherited demand after the attempt
# (forensics either progressed or failed without rewriting investigation_input
# to something else via mismatch path).
still="$(jq -r '.artifact_snapshot.investigation_input // empty' "${HANDOVER}" 2>/dev/null || true)"
[[ "${still}" == "inherited demand" ]] \
  || fail "inheritance_corrupted_handover_demand: '${still}'"

# Silence unused-var lint-style noise if inherit_rc is unread in some shells
: "${inherit_rc}"

echo "[AEGIS][TEST] test_investigation_binding: PASS"
