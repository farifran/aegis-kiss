#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

assert_runtime_specific_handlers_are_removed() {
  [[ ! -e scripts/capabilities/runtime/read_epistemic_handover.sh ]] \
    || fail "runtime_specific_handover_handler_still_present"
}

assert_manifest_uses_filesystem_read_only() {
  local manifest

  manifest="$("${BASH}" scripts/capabilities/generate_manifest.sh)"

  printf '%s\n' "${manifest}" | jq -e '
    ([.modes[].capabilities[].capability] | index("runtime.read_epistemic_handover") == null)
    and ([.modes[].evidence_capabilities[]] | index("runtime.read_epistemic_handover") == null)
    and (.modes.discovery.evidence_capabilities == [
      "runtime.demand_anchors",
      "filesystem.list_tree",
      "filesystem.read",
      "runtime.layer0_facts",
      "runtime.attention_seed"
    ])
    and (.modes.validation.evidence_capabilities == ["filesystem.read"])
  ' >/dev/null || fail "manifest_still_references_runtime_specific_reads"
}

assert_runtime_owned_files_are_readable_via_filesystem_read() {
  local target_path="$1"
  local jq_filter="$2"
  local output

  output="$("${BASH}" scripts/capabilities/filesystem/read_file.sh "${target_path}")" \
    || fail "filesystem_read_failed_for_runtime_owned_file: ${target_path}"

  printf '%s\n' "${output}" | jq -e \
    --arg path "${target_path}" \
    "${jq_filter}" >/dev/null \
    || fail "unexpected_filesystem_read_output_for_runtime_owned_file: ${target_path}"
}

TMP_TEST_DIR="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${TMP_TEST_DIR}" >/dev/null 2>&1 || true
}

export AEGIS_EXECUTION_ID="runtime-contract-harness"
export AEGIS_EXECUTION_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

export AEGIS_EPISTEMIC_HANDOVER_FILE="${TMP_TEST_DIR}/epistemic_handover.json"

jq -n \
  '{
    artifact_snapshot: null,
    epistemic_state: {
      next_attention_targets: [],
      attention_scope: "none",
      attention_reason: "no active attention"
    }
  }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

assert_runtime_specific_handlers_are_removed
assert_manifest_uses_filesystem_read_only

assert_runtime_owned_files_are_readable_via_filesystem_read \
  "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
  '.success == true and .capability == "filesystem.read" and .payload.target == $path and ((.payload.content | fromjson).epistemic_state.next_attention_targets == []) and ((.payload.content | fromjson).epistemic_state.attention_scope == "none") and ((.payload.content | fromjson).epistemic_state.attention_reason == "no active attention") and ((.payload.content | fromjson).artifact_snapshot == null)'

jq -n \
  '{
    artifact_snapshot: null,
    epistemic_state: {
      incomplete_observations: [],
      uninspected_areas: [],
      insufficient_evidence: [],
      observed_limitations: []
    }
  }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

assert_runtime_owned_files_are_readable_via_filesystem_read \
  "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
  '.success == true and .capability == "filesystem.read" and .payload.target == $path and ((.payload.content | fromjson).epistemic_state.incomplete_observations == []) and ((.payload.content | fromjson).epistemic_state.uninspected_areas == []) and ((.payload.content | fromjson).epistemic_state.insufficient_evidence == []) and ((.payload.content | fromjson).epistemic_state.observed_limitations == [])'

echo "[AEGIS][TEST] runtime contract harness passed"
