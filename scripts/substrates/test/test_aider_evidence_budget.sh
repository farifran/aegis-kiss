#!/usr/bin/env bash

# =========================================================
# Regression: inject_capability_evidence under set -u without
# AEGIS_AIDER_EVIDENCE_MAX_BYTES (repair env -i isolation).
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
AEGIS_LOG_TAG="AIDER"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/substrates/aider/prompt.sh"

test_tmp="$(mktemp -d)"
test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

payload="${test_tmp}/epistemic_handover.json"
printf '%s\n' '{"payload":{"ok":true}}' > "${payload}"
export AEGIS_SELECTED_CAPABILITY_PAYLOADS
AEGIS_SELECTED_CAPABILITY_PAYLOADS="$(jq -cn --arg p "${payload}" '[$p]')"

# Exactly the isolation shape that crashed repair: set -u, vars unset.
unset AEGIS_AIDER_EVIDENCE_MAX_BYTES 2>/dev/null || true
unset AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES 2>/dev/null || true

set -u
out="$(inject_capability_evidence "epistemic_handover")" || fail "inject_failed_under_set_u"
set +u

printf '%s' "${out}" | grep -q 'Capability evidence payloads' \
  || fail "inject_missing_header"
printf '%s' "${out}" | grep -q 'epistemic_handover' \
  || fail "inject_missing_payload_name"
printf '%s' "${out}" | grep -q '"ok":true' \
  || fail "inject_missing_payload_body"

# Truncation path with explicit tiny budget still works under set -u.
big="${test_tmp}/big.json"
python3 -c 'print("x" * 500)' > "${big}"
AEGIS_SELECTED_CAPABILITY_PAYLOADS="$(jq -cn --arg p "${big}" '[$p]')"
unset AEGIS_AIDER_EVIDENCE_MAX_BYTES 2>/dev/null || true
export AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES=40
set -u
out="$(inject_capability_evidence)" || fail "inject_truncate_failed_under_set_u"
set +u
printf '%s' "${out}" | grep -q 'EVIDENCE_TRUNCATED' \
  || fail "inject_expected_truncation_marker"

echo "[PASS] aider evidence budget under set -u"
