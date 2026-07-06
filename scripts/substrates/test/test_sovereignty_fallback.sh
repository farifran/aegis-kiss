#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

backup_epistemic_handover

# We set up an invalid API base so that raw_llm.sh fails to connect and raises provider_retry_limit_exceeded.
export OPENAI_API_BASE="http://127.0.0.1:54321"
export OPENAI_API_KEY="aegis-test-key"
export OPENAI_MODEL_READONLY_COGNITION="aegis-test-model"
export AEGIS_PROVIDER_CONNECT_TIMEOUT=1
export AEGIS_PROVIDER_RESPONSE_TIMEOUT=1
export AEGIS_PROVIDER_MAX_RETRIES=1
export AEGIS_PROVIDER_RETRY_DELAY=0

# Ensure payloads are preserved after failure so we can verify them
export AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false

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

echo "[AEGIS][TEST] Running discovery with failing provider..."

set +e
bash runtime_aegis.sh discovery
status=$?
set -e

if [[ "${status}" -eq 0 ]]; then
  fail "discovery_should_have_failed_due_to_network_error"
fi

echo "[AEGIS][TEST] Discovery failed as expected with status ${status}. Verifying handover fallback..."

if [[ ! -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
  fail "missing_handover_file_after_discovery_failure"
fi

# Assert schema validity
jq -e "$(epistemic_handover_schema_filter)" "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
  || fail "invalid_handover_schema_after_discovery_failure"

# Assert null snapshot and default epistemic state
jq -e '
  .artifact_snapshot == null
  and .epistemic_state.next_attention_targets == []
  and .epistemic_state.attention_scope == "none"
' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
  || fail "handover_does_not_contain_fallback_reason"

echo "[AEGIS][TEST] Sovereignty fallback promotion verified successfully."
