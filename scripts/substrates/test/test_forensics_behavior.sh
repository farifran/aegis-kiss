#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

readonly TEST_INVESTIGATION_INPUT="forensics behavior investigation"

backup_epistemic_handover

seed_fake_handover() {
  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  jq -n \
    '{
      artifact_snapshot: {
        mode: "fake",
        status: "stale",
        summary: "old issue",
        observed_payloads: ["stale_payload.json"],
        generated_at: "1970-01-01T00:00:00Z"
      },
      epistemic_state: {
        next_attention_targets: ["old issue"],
        attention_scope: "stale scope",
        attention_reason: "stale attention"
      }
    }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
}

assert_runtime_read_handover_is_empty() {
  local payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json"

  [[ -f "${payload_file}" ]] \
    || fail "missing_runtime_read_handover_payload"

  jq -e '
    .success == true
    and .error == null
    and ((.payload.content | fromjson).artifact_snapshot == null)
    and ((.payload.content | fromjson).epistemic_state.next_attention_targets == [])
    and ((.payload.content | fromjson).epistemic_state.attention_scope == "none")
    and ((.payload.content | fromjson).epistemic_state.attention_reason == "no active attention")
  ' "${payload_file}" >/dev/null \
    || fail "discovery_did_not_start_from_empty_handover"
}

assert_handover_snapshot_matches_artifact() {
  local handover_file="$1"
  local artifact_payload="$2"

  jq -e \
    --argjson expected_artifact_payload "${artifact_payload}" \
    --arg expected_investigation_input "${TEST_INVESTIGATION_INPUT}" \
    '
      type == "object"
      and ((keys | sort) == ["artifact_snapshot", "epistemic_state"])
      and (.artifact_snapshot | type == "object")
      and (.artifact_snapshot.mode == $expected_artifact_payload.mode)
      and (($expected_artifact_payload
        | if .mode == "discovery" then .operational_context else . end
      ) as $expected_context |
        (.artifact_snapshot.operational_context.status == $expected_context.status)
        and (.artifact_snapshot.operational_context.summary == $expected_context.summary)
        and (.artifact_snapshot.operational_context.observed_payloads == $expected_context.observed_payloads)
      )
      and (.artifact_snapshot.investigation_input == $expected_investigation_input)
      and (.artifact_snapshot.generated_at | type == "string" and length > 0)
      and ((.artifact_snapshot | has("handover_attention")) == false)
      and (.epistemic_state == $expected_artifact_payload.handover_attention)
    ' "${handover_file}" >/dev/null \
    || fail "unexpected_runtime_handover_state: ${handover_file}"
}

assert_runtime_read_handover_matches_artifact() {
  local artifact_payload="$1"
  local payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json"

  [[ -f "${payload_file}" ]] \
    || fail "missing_runtime_read_handover_payload"

  jq -e \
    --argjson expected_artifact_payload "${artifact_payload}" \
    --arg expected_investigation_input "${TEST_INVESTIGATION_INPUT}" \
    '
      ($expected_artifact_payload
        | if .mode == "discovery" then .operational_context else . end
      ) as $expected_context
      | .success == true
      and .error == null
      and ((.payload.content | fromjson) as $handover |
        ($handover.artifact_snapshot | type == "object")
        and ($handover.artifact_snapshot.mode == $expected_artifact_payload.mode)
        and ($handover.artifact_snapshot.operational_context.status == $expected_context.status)
        and ($handover.artifact_snapshot.operational_context.summary == $expected_context.summary)
        and ($handover.artifact_snapshot.operational_context.observed_payloads == $expected_context.observed_payloads)
        and ($handover.artifact_snapshot.investigation_input == $expected_investigation_input)
        and ($handover.artifact_snapshot.generated_at | type == "string" and length > 0)
        and (($handover.artifact_snapshot | has("handover_attention")) == false)
        and ($handover.epistemic_state == $expected_artifact_payload.handover_attention)
      )
    ' "${payload_file}" >/dev/null \
    || fail "forensics_did_not_consume_discovery_handover"
}

assert_artifact_mode() {
  local artifact_payload="$1"
  local expected_mode="$2"

  jq -e --arg expected_mode "${expected_mode}" '
    .mode == $expected_mode
  ' <<<"${artifact_payload}" >/dev/null \
    || fail "unexpected_artifact_mode: ${expected_mode}"
}

main() {
  local discovery_output
  local discovery_artifact_payload
  local forensics_output
  local forensics_artifact_payload

  start_mock_curl_provider
  seed_fake_handover

  discovery_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh discovery
  })"

  discovery_artifact_payload="$({
    extract_first_artifact_payload "${discovery_output}"
  })"

  [[ -n "${discovery_artifact_payload}" ]] \
    || fail "missing_discovery_artifact"

  assert_artifact_mode "${discovery_artifact_payload}" "discovery"
  assert_runtime_read_handover_is_empty
  assert_handover_snapshot_matches_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${discovery_artifact_payload}"

  if grep -q 'old issue' "${AEGIS_EPISTEMIC_HANDOVER_FILE}"; then
    fail "stale_handover_state_survived_discovery"
  fi

  forensics_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh forensics
  })"

  forensics_artifact_payload="$({
    extract_first_artifact_payload "${forensics_output}"
  })"

  [[ -n "${forensics_artifact_payload}" ]] \
    || fail "missing_forensics_artifact"

  assert_artifact_mode "${forensics_artifact_payload}" "forensics"
  assert_runtime_read_handover_matches_artifact "${discovery_artifact_payload}"
  assert_handover_snapshot_matches_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${forensics_artifact_payload}"

  jq -n \
    --argjson discovery_artifact_payload "${discovery_artifact_payload}" \
    --argjson forensics_artifact_payload "${forensics_artifact_payload}" \
    '
      $discovery_artifact_payload.mode == "discovery"
      and $forensics_artifact_payload.mode == "forensics"
      and $discovery_artifact_payload != $forensics_artifact_payload
    ' >/dev/null || fail "forensics_did_not_replace_discovery_snapshot"

  echo "[AEGIS][TEST] forensics behavior passed"
}

main "$@"
