#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

if grep -Eq '(^|[[:space:]])rg([[:space:]]|$)' \
  scripts/audit_epistemic_pipeline.sh; then
  fail "audit_depends_on_ripgrep"
fi

# Isolate from leftover runtime handovers (legacy structural_context, etc.).
backup_epistemic_handover
mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"
jq -n '{
  artifact_snapshot: null,
  epistemic_state: {
    next_attention_targets: [],
    attention_scope: "none",
    attention_reason: "no active attention"
  }
}' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

output="$("${BASH}" scripts/audit_epistemic_pipeline.sh)"

printf '%s\n' "${output}" \
  | jq -e '
      .pipeline_ok == true
      and .mutation_pipeline_proven == true
      and .epistemic_pipeline_proven == true
      and (.boundaries | length == 6)
      and (.boundaries[0].boundary == "Discovery -> Forensics")
      and (.boundaries[0].status == "pass")
      and (.boundaries[0].next_mode_operates_from_contract_only == true)
      and (.boundaries[1].boundary == "Forensics -> Repair")
      and (.boundaries[1].status == "pass")
      and (.boundaries[1].next_mode_operates_from_contract_only == true)
      and (.boundaries[2].boundary == "Repair -> Optimize")
      and (.boundaries[2].status == "pass")
      and (.boundaries[2].next_mode_operates_from_contract_only == true)
      and (.boundaries[3].status == "pass")
      and (.boundaries[4].status == "pass")
      and (.boundaries[5].boundary == "Validation -> Promote")
      and (.boundaries[5].status == "pass")
      and (.boundaries[5].next_mode_operates_from_contract_only == true)
    ' >/dev/null \
  || fail "unexpected_epistemic_pipeline_audit"

# ---------------------------------------------------------------------
# Deep handover-state validation: audit_handover_state must reject
# malformed internal structures with the deterministic
# unsanitized_handover_state fatal envelope, and keep accepting the
# runtime-owned contract shapes.
# ---------------------------------------------------------------------

# run_audit_with_handover <handover_json>
# Writes the handover, runs the auditor, returns its exit code and
# leaves stderr in ${audit_err}.
audit_err=""
run_audit_with_handover() {
  local handover_json="$1"

  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"
  printf '%s\n' "${handover_json}" > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

  local err_file
  err_file="$(mktemp)"

  local rc=0
  "${BASH}" scripts/audit_epistemic_pipeline.sh \
    > /dev/null 2> "${err_file}" \
    || rc=$?

  audit_err="$(cat "${err_file}")"
  rm -f "${err_file}"

  return "${rc}"
}

assert_handover_rejected() {
  local label="$1"
  local handover_json="$2"

  local rc=0
  run_audit_with_handover "${handover_json}" || rc=$?

  [[ "${rc}" -eq 1 ]] \
    || fail "malformed_handover_not_rejected: ${label} (rc=${rc})"

  printf '%s\n' "${audit_err}" \
    | grep -q '\[AEGIS\]\[AUDIT\]\[FATAL\] unsanitized_handover_state' \
    || fail "missing_unsanitized_handover_state_envelope: ${label}"
}

assert_handover_accepted() {
  local label="$1"
  local handover_json="$2"

  run_audit_with_handover "${handover_json}" \
    || fail "valid_handover_rejected_by_deep_audit: ${label}"
}

valid_snapshot='{
  "mode": "discovery",
  "investigation_input": "audit probe",
  "generated_at": "2026-07-07T00:00:00Z",
  "operational_context": {"status": "interpreted", "summary": "probe"}
}'

valid_state='{
  "next_attention_targets": ["src/a.ts"],
  "attention_scope": "layer0",
  "attention_reason": "ATTENTION_REASON_DISCOVERY"
}'

# Positive controls: the runtime-owned contract shapes must keep passing.
assert_handover_accepted "full_snapshot" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": ${valid_state}}"
assert_handover_accepted "null_snapshot_pre_investigation" \
  "{\"artifact_snapshot\": null, \"epistemic_state\": ${valid_state}}"

# Rogue structural extensions.
assert_handover_rejected "rogue_root_key" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": ${valid_state}, \"injected\": true}"
assert_handover_rejected "rogue_snapshot_key" \
  "{\"artifact_snapshot\": $(jq -c '. + {rogue_extension: {}}' <<< "${valid_snapshot}"), \"epistemic_state\": ${valid_state}}"
assert_handover_rejected "rogue_epistemic_state_key" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": $(jq -c '. + {escalate: "now"}' <<< "${valid_state}")}"
# Legacy deep-topology field is no longer a legal snapshot key.
assert_handover_rejected "legacy_structural_context" \
  "{\"artifact_snapshot\": $(jq -c '. + {structural_context: {}}' <<< "${valid_snapshot}"), \"epistemic_state\": ${valid_state}}"

# Type-coercion bypass attempts.
assert_handover_rejected "snapshot_as_array" \
  "{\"artifact_snapshot\": [], \"epistemic_state\": ${valid_state}}"
assert_handover_rejected "numeric_mode" \
  "{\"artifact_snapshot\": $(jq -c '.mode = 42' <<< "${valid_snapshot}"), \"epistemic_state\": ${valid_state}}"
assert_handover_rejected "object_typed_status" \
  "{\"artifact_snapshot\": $(jq -c '.operational_context.status = {}' <<< "${valid_snapshot}"), \"epistemic_state\": ${valid_state}}"
assert_handover_rejected "stringified_attention_targets" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": $(jq -c '.next_attention_targets = "[]"' <<< "${valid_state}")}"
assert_handover_rejected "non_string_attention_target" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": $(jq -c '.next_attention_targets = [7]' <<< "${valid_state}")}"
assert_handover_rejected "empty_attention_scope" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": $(jq -c '.attention_scope = ""' <<< "${valid_state}")}"
assert_handover_rejected "missing_epistemic_state_field" \
  "{\"artifact_snapshot\": ${valid_snapshot}, \"epistemic_state\": $(jq -c 'del(.attention_reason)' <<< "${valid_state}")}"

restore_epistemic_handover

echo "[PASS] epistemic pipeline audit"
