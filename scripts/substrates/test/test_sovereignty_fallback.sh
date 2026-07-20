#!/usr/bin/env bash

# =========================================================
# Runtime sovereignty vs provider network
# =========================================================
# Discovery is mechanical (no LLM) — must succeed with a dead provider.
# LLM residual modes (forensics with AEGIS_FORENSICS_LLM=1) must fail
# deterministically on network error without corrupting handover schema.
#
# (Historical: this suite expected discovery itself to fail on network.
# That contract is obsolete after mechanical discovery.)

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

backup_epistemic_handover

export OPENAI_API_BASE="http://127.0.0.1:54321"
export OPENAI_API_KEY="aegis-test-key"
export OPENAI_MODEL_READONLY_COGNITION="aegis-test-model"
export AEGIS_PROVIDER_CONNECT_TIMEOUT=1
export AEGIS_PROVIDER_RESPONSE_TIMEOUT=1
export AEGIS_PROVIDER_MAX_RETRIES=1
export AEGIS_PROVIDER_RETRY_DELAY=0
export AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false
export AEGIS_INVESTIGATION_INPUT="identify highest-value investigation structure"

epistemic_handover_schema_filter() {
  cat <<'EOF'
type == "object"
and ((keys | sort) == [
  "artifact_snapshot",
  "epistemic_state"
])
and (
  (.artifact_snapshot == null)
  or (.artifact_snapshot | type == "object")
)
and (
  .epistemic_state
  | (
      type == "object"
      and ((keys | sort) == [
        "attention_reason",
        "attention_scope",
        "next_attention_targets"
      ])
      and (.next_attention_targets | type == "array")
      and (.attention_scope | type == "string" and length > 0)
      and (.attention_reason | type == "string" and length > 0)
      and (
        [.next_attention_targets[]] | all(type == "string")
      )
    )
)
EOF
}

# Fresh investigation boundary
rm -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

echo "[AEGIS][TEST] Mechanical discovery must succeed with dead provider..."

set +e
bash runtime_aegis.sh discovery >/dev/null 2>"${AEGIS_TEST_ROOT}/.harness/runtime/sov_discovery.err"
discovery_status=$?
set -e

[[ "${discovery_status}" -eq 0 ]] \
  || fail "mechanical_discovery_should_succeed_without_provider (status=${discovery_status})"

[[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]] \
  || fail "missing_handover_after_mechanical_discovery"

jq -e "$(epistemic_handover_schema_filter)" "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
  || fail "invalid_handover_schema_after_mechanical_discovery"

jq -e '.artifact_snapshot.mode == "discovery"' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
  || fail "discovery_snapshot_missing_after_mechanical_run"

echo "[AEGIS][TEST] Discovery ok offline. Forcing forensics LLM with dead provider..."

set +e
AEGIS_FORENSICS_LLM=1 \
  bash runtime_aegis.sh forensics >/dev/null 2>"${AEGIS_TEST_ROOT}/.harness/runtime/sov_forensics.err"
forensics_status=$?
set -e

[[ "${forensics_status}" -ne 0 ]] \
  || fail "forensics_llm_should_have_failed_due_to_network_error"

# Prior mechanical discovery must remain schema-valid (no half-written junk).
[[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]] \
  || fail "missing_handover_file_after_forensics_provider_failure"

jq -e "$(epistemic_handover_schema_filter)" "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
  || fail "invalid_handover_schema_after_forensics_provider_failure"

# Failure must not promote a partial forensics snapshot; keep last good mode.
jq -e '
  .artifact_snapshot != null
  and .artifact_snapshot.mode == "discovery"
' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
  || fail "provider_failure_overwrote_or_cleared_last_good_discovery_snapshot"

echo "[AEGIS][TEST] Sovereignty verified: mechanical offline + LLM network fail without schema corruption."
echo "[PASS] sovereignty fallback (mechanical discovery + LLM residual network fail)"
