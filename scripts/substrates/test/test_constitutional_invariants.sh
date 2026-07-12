#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# Mock providers return a "rejected" validation verdict; disable the
# automated repair feedback loop so single-mode assertions stay
# single-mode (the mutation substrate cannot run against mocks).
export AEGIS_REPAIR_FEEDBACK_LOOP="false"

readonly TEST_INVESTIGATION_INPUT="constitutional investigation"
readonly MISMATCHED_INVESTIGATION_INPUT="mismatched investigation"

backup_epistemic_handover


assert_constitutional_state_registry() {
  local duplicate_states

  duplicate_states="$({
    printf '%s\n' "${AEGIS_PROVEN_SURFACES[@]}"
    printf '%s\n' "${AEGIS_INTENDED_SURFACES[@]}"
    printf '%s\n' "${AEGIS_DEFERRED_SURFACES[@]}"
  } | sort | uniq -d)"

  [[ -z "${duplicate_states}" ]] \
    || fail "overlapping_constitutional_state_registry"

  array_contains "payload_provenance_tracking" "${AEGIS_PROVEN_SURFACES[@]}" \
    || fail "payload_provenance_tracking_not_proven"

  array_contains "readonly_execution_surface_elision" "${AEGIS_PROVEN_SURFACES[@]}" \
    || fail "readonly_execution_surface_elision_not_proven"

  array_contains "runtime_owned_artifact_snapshot_handover" "${AEGIS_PROVEN_SURFACES[@]}" \
    || fail "runtime_owned_artifact_snapshot_handover_not_proven"

  array_contains "bounded_mutation_hardening" "${AEGIS_INTENDED_SURFACES[@]}" \
    || fail "bounded_mutation_hardening_not_intended"

  array_contains "advanced_capability_sandboxing" "${AEGIS_DEFERRED_SURFACES[@]}" \
    || fail "advanced_capability_sandboxing_not_deferred"
}

assert_executor_subprocess_isolation_contract() {

  grep -q 'env -i' scripts/execute_mode.sh \
    || fail "missing_sanitized_subprocess_environment"

  grep -q 'invoke_capability_handler()' scripts/execute_mode.sh \
    || fail "missing_capability_handler_isolation_helper"

  grep -q 'invoke_raw_substrate()' scripts/execute_mode.sh \
    || fail "missing_raw_substrate_isolation_helper"
}

assert_raw_substrate_isolation_contract() {

  grep -q 'prepare_isolated_substrate_workspace()' scripts/substrates/raw_llm.sh \
    || fail "missing_isolated_substrate_workspace_helper"

  grep -q 'cd "${AEGIS_SUBSTRATE_WORKSPACE}"' scripts/substrates/raw_llm.sh \
    || fail "missing_isolated_substrate_workspace_entry"

  grep -q 'normalize_selected_payload_paths' scripts/substrates/raw_llm.sh \
    || fail "missing_selected_payload_normalization"

  grep -q 'exposed_capability_payload_out_of_scope' scripts/substrates/raw_llm.sh \
    || fail "missing_payload_scope_guard"
}

assert_evidence_profiles_are_subset_of_envelopes() {
  local manifest

  manifest="$(
    bash scripts/capabilities/generate_manifest.sh
  )"

  printf '%s\n' "${manifest}" | jq -e '
    .modes
    | to_entries
    | all(
        ((.value.evidence_capabilities - (.value.capabilities | map(.capability))) | length) == 0
      )
  ' >/dev/null || fail "evidence_profile_outside_envelope"
}

seed_required_predecessor() {
  local mode="$1"

  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  case "${mode}" in
    adversarial)
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "optimize",
            investigation_input: $investigation_input,
            operational_context: {
              candidate_result: {
                source_mode: "optimize",
                diff: "diff --git a/src/index.ts b/src/index.ts",
                files_changed: ["src/index.ts"]
              }
            }
          },
          epistemic_state: {
            next_attention_targets: ["src/index.ts"],
            attention_scope: "mutation_applied",
            attention_reason: "optimized candidate"
          }
        }
      ' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
      ;;
    validation)
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "adversarial",
            investigation_input: $investigation_input,
            operational_context: {
              candidate_result: {
                source_mode: "optimize",
                diff: "diff --git a/src/index.ts b/src/index.ts",
                files_changed: ["src/index.ts"]
              },
              findings: [],
              evidence_refs: ["filesystem.read:epistemic_handover"]
            }
          },
          epistemic_state: {
            next_attention_targets: [],
            attention_scope: "bounded falsification",
            attention_reason: "challenge completed"
          }
        }
      ' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
      ;;
  esac
}

assert_readonly_mode_has_no_execution_surface() {
  local mode="$1"
  local runtime_log_file
  local execution_surface_path="${AEGIS_EXECUTION_SURFACE_ROOT}/${mode}"

  runtime_log_file="$(mktemp)"

  rm -rf "${execution_surface_path}"
  seed_required_predecessor "${mode}"

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE=false \
  bash runtime_aegis.sh "${mode}" >/dev/null 2>"${runtime_log_file}"

  [[ ! -d "${execution_surface_path}" ]] \
    || fail "unexpected_execution_surface_for_mode: ${mode}"

  grep -q "Skipping disposable execution surface" "${runtime_log_file}" \
    || fail "missing_execution_surface_skip_log_for_mode: ${mode}"

  grep -q "Preparing disposable execution surface" "${runtime_log_file}" \
    && fail "unexpected_execution_surface_preparation_for_mode: ${mode}"

  rm -f "${runtime_log_file}"
}

assert_payloads_are_execution_scoped() {
  local payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR}"
  local payload_file
  local actual_payloads_json

  rm -rf "${payload_dir}"
  mkdir -p "${payload_dir}"

  jq -n \
    --arg execution_id "stale-execution" \
    '{
      success: true,
      capability: "stale.payload",
      classification: "readonly",
      execution_id: $execution_id,
      generated_at: "1970-01-01T00:00:00Z",
      payload: {},
      error: null
    }' > "${payload_dir}/stale_payload.json"

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh discovery >/dev/null

  [[ ! -f "${payload_dir}/stale_payload.json" ]] \
    || fail "stale_payload_survived_runtime_refresh"

  local payload_files=()
  while IFS= read -r payload_file; do
    payload_files+=("${payload_file}")
  done < <(find "${payload_dir}" -maxdepth 1 -type f | sort)

  [[ "${#payload_files[@]}" -gt 0 ]] \
    || fail "missing_discovery_payloads"

  actual_payloads_json="$(
    jq -cn '[$ARGS.positional[] | sub(".*/"; "")]' --args "${payload_files[@]}"
  )"

  jq -n \
    --argjson actual_payloads "${actual_payloads_json}" \
    --argjson expected_payloads '[
      "filesystem_list_tree.json",
      "filesystem_read_epistemic_handover.json",
      "runtime_attention_seed.json",
      "runtime_layer0_facts.json"
    ]' \
    '
      $actual_payloads == $expected_payloads
    ' >/dev/null || fail "unexpected_discovery_payload_set"

  # One jq pass proves every payload contract and that all payloads share
  # a single (non-"unknown") execution id.
  jq -s '
    all(
      .success == true
      and .error == null
      and (.capability | type == "string" and length > 0)
      and (.classification | type == "string" and length > 0)
      and (.execution_id | type == "string" and length > 0 and . != "unknown")
      and (.generated_at | type == "string" and length > 0)
      and .payload != null
    )
    and ([.[].execution_id] | unique | length == 1)
  ' "${payload_files[@]}" \
    | grep -qx 'true' \
    || fail "invalid_or_mismatched_payload_contracts"

  rm -rf "${payload_dir}"
}

seed_fake_investigation_handover() {
  local marker="$1"

  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  jq -n \
    --arg marker "${marker}" \
    '{
      artifact_snapshot: {
        mode: "fake",
        status: "stale",
        summary: $marker,
        observed_payloads: ["stale_payload.json"],
        generated_at: "1970-01-01T00:00:00Z"
      },
      epistemic_state: {
        next_attention_targets: [$marker],
        attention_scope: "stale scope",
        attention_reason: "stale attention"
      }
    }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
}

assert_runtime_read_handover_payload_is_empty() {
  local payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json"

  [[ -f "${payload_file}" ]] \
    || fail "missing_runtime_read_handover_payload"

  jq -e '
    .success == true
    and .error == null
    and ((.payload.content | fromjson) as $handover |
      $handover.artifact_snapshot == null
      and $handover.epistemic_state == {
        next_attention_targets: [],
        attention_scope: "none",
        attention_reason: "no active attention"
      }
    )
  ' "${payload_file}" >/dev/null \
    || fail "discovery_observed_stale_handover_state"
}

assert_handover_file_matches_promoted_artifact() {
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
    || fail "unexpected_runtime_owned_handover: ${handover_file}"
}

assert_runtime_read_handover_payload_matches_promoted_artifact() {
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
    || fail "forensics_did_not_receive_current_investigation_handover"
}

assert_discovery_resets_prior_handover_state() {
  local runtime_output
  local artifact_payload

  seed_fake_investigation_handover "old issue"

  runtime_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh
  })"

  artifact_payload="$({
    extract_first_artifact_payload "${runtime_output}"
  })"

  [[ -n "${artifact_payload}" ]] \
    || fail "missing_runtime_artifact_for_discovery_reset"

  assert_runtime_read_handover_payload_is_empty
  assert_handover_file_matches_promoted_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${artifact_payload}"

  if grep -q 'old issue' "${AEGIS_EPISTEMIC_HANDOVER_FILE}"; then
    fail "stale_epistemic_state_survived_discovery_reset"
  fi

  if grep -q '"mode": "fake"' "${AEGIS_EPISTEMIC_HANDOVER_FILE}"; then
    fail "stale_artifact_snapshot_survived_discovery_reset"
  fi
}

assert_discovery_starts_fresh_each_execution() {
  local first_runtime_output
  local first_artifact_payload
  local second_runtime_output
  local second_artifact_payload

  first_runtime_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh
  })"

  first_artifact_payload="$({
    extract_first_artifact_payload "${first_runtime_output}"
  })"

  [[ -n "${first_artifact_payload}" ]] \
    || fail "missing_first_discovery_artifact"

  seed_fake_investigation_handover "issue-a"

  second_runtime_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh
  })"

  second_artifact_payload="$({
    extract_first_artifact_payload "${second_runtime_output}"
  })"

  [[ -n "${second_artifact_payload}" ]] \
    || fail "missing_second_discovery_artifact"

  assert_runtime_read_handover_payload_is_empty
  assert_handover_file_matches_promoted_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${second_artifact_payload}"

  if grep -q 'issue-a' "${AEGIS_EPISTEMIC_HANDOVER_FILE}"; then
    fail "second_discovery_inherited_prior_investigation_state"
  fi
}

assert_forensics_consumes_current_investigation_handover() {
  local discovery_runtime_output
  local discovery_artifact_payload
  local forensics_runtime_output
  local forensics_artifact_payload

  discovery_runtime_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh discovery
  })"

  discovery_artifact_payload="$({
    extract_first_artifact_payload "${discovery_runtime_output}"
  })"

  [[ -n "${discovery_artifact_payload}" ]] \
    || fail "missing_discovery_artifact_for_forensics_continuity"

  forensics_runtime_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh forensics
  })"

  forensics_artifact_payload="$({
    extract_first_artifact_payload "${forensics_runtime_output}"
  })"

  [[ -n "${forensics_artifact_payload}" ]] \
    || fail "missing_forensics_artifact_for_current_investigation"

  assert_runtime_read_handover_payload_matches_promoted_artifact "${discovery_artifact_payload}"
  assert_handover_file_matches_promoted_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${forensics_artifact_payload}"
}

assert_forensics_rejects_mismatched_investigation_input() {
  local mismatch_log_file
  local status

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh discovery >/dev/null

  mismatch_log_file="$(mktemp)"

  set +e
  AEGIS_INVESTIGATION_INPUT="${MISMATCHED_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh forensics >/dev/null 2>"${mismatch_log_file}"
  status=$?
  set -e

  [[ "${status}" -ne 0 ]] \
    || fail "forensics_accepted_mismatched_investigation_input"

  grep -q "investigation_input_mismatch" "${mismatch_log_file}" \
    || fail "missing_investigation_input_mismatch_failure"

  rm -f "${mismatch_log_file}"
}

# The mock provider key value must never persist into runtime-owned state.
# (Capability payloads legitimately embed repository source that names the
# OPENAI_API_KEY variable, so only the secret value counts as a leak.)
assert_provider_credentials_contained() {

  local surface

  for surface in "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${AEGIS_CAPABILITY_PAYLOAD_DIR}"; do
    [[ -e "${surface}" ]] || continue

    grep -Frq "${OPENAI_API_KEY}" "${surface}" \
      && fail "provider_credential_leaked_into_runtime_state: ${surface}"
  done

  return 0
}

main() {
  assert_constitutional_state_registry
  assert_executor_subprocess_isolation_contract
  assert_raw_substrate_isolation_contract
  bash scripts/substrates/test/test_runtime_contract.sh
  assert_evidence_profiles_are_subset_of_envelopes
  bash scripts/substrates/test/test_readonly_modes.sh

  start_mock_provider

  local mode
  for mode in discovery forensics validation adversarial; do
    assert_readonly_mode_has_no_execution_surface "${mode}"
  done

  assert_payloads_are_execution_scoped
  assert_discovery_resets_prior_handover_state
  assert_discovery_starts_fresh_each_execution
  assert_forensics_consumes_current_investigation_handover
  assert_provider_credentials_contained
  assert_forensics_rejects_mismatched_investigation_input

  echo "[AEGIS][TEST] constitutional invariants passed"
}

main "$@"
