#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — MODEL BOUNDARY PROMPT STABILITY
# =========================================================
#
# Guards the deterministic model-boundary rails:
#
# 1. Prompt prefix byte-stability: two consecutive same-mode runtime
#    executions must produce byte-identical system prompts and
#    byte-identical user-message stable prefixes (through the payload
#    section header). Volatile identity (execution id, timestamp,
#    manifest metadata) must appear only in the tail. This is the
#    contract that unlocks serving-side automatic prefix caching.
#
# 2. Empty-mutation-candidate rejection gate: the REAL jq gate embedded
#    in scripts/execute_mode.sh (extracted from source, not duplicated)
#    must force verdict "rejected" with basis "empty_mutation_candidate"
#    for blank/placeholder diffs or empty files_changed, and must leave
#    a genuine candidate untouched.
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

export AEGIS_REPAIR_FEEDBACK_LOOP="false"

readonly FIXED_INVESTIGATION_INPUT="cache idempotency smoke investigation"

# ---------------------------------------------------------
# Part 1 — empty-mutation-candidate gate (real production filter)
# ---------------------------------------------------------

assert_empty_candidate_rejection_gate() {

  # Extract the actual gate expression from execute_mode.sh so this test
  # exercises production logic, not a copy that could drift.
  local gate_filter
  gate_filter="$(
    awk '/# Physical mutation constraint/,/else \. end\)/' scripts/execute_mode.sh \
      | grep -v '^[[:space:]]*#' \
      | sed 's/^[[:space:]]*| //'
  )"

  [[ -n "${gate_filter}" ]] \
    || fail "empty_candidate_gate_not_found_in_execute_mode"

  local rejected
  rejected="$(
    jq -cn '{verdict:"accepted",validated_candidate:{diff:"(no changes)",files_changed:[]},basis:["ok"]}' \
      | jq "${gate_filter} | {verdict, basis}"
  )" || fail "empty_candidate_gate_filter_not_executable"

  [[ "$(jq -r '.verdict' <<<"${rejected}")" == "rejected" ]] \
    || fail "empty_candidate_not_rejected: ${rejected}"
  [[ "$(jq -r '.basis[0]' <<<"${rejected}")" == "empty_mutation_candidate" ]] \
    || fail "empty_candidate_basis_missing: ${rejected}"

  local blank_rejected
  blank_rejected="$(
    jq -cn '{verdict:"accepted",validated_candidate:{diff:"   ",files_changed:["x"]},basis:["ok"]}' \
      | jq "${gate_filter} | .verdict" -r
  )"
  [[ "${blank_rejected}" == "rejected" ]] \
    || fail "blank_diff_not_rejected"

  local untouched
  untouched="$(
    jq -cn '{verdict:"accepted",validated_candidate:{diff:"diff --git a/x b/x\n+1",files_changed:["x"]},basis:["ok"]}' \
      | jq "${gate_filter} | .verdict" -r
  )"
  [[ "${untouched}" == "accepted" ]] \
    || fail "genuine_candidate_was_rejected"

  echo "[AEGIS][TEST] empty-mutation-candidate gate contract passed"
}

# ---------------------------------------------------------
# Part 2 — prompt prefix stability across same-mode runs
# ---------------------------------------------------------

# Capture-curl shim: persists every request body, then delegates to the
# shared mock provider curl so the runtime completes normally.
REQUEST_CAPTURE_DIR=""
CAPTURE_CURL_DIR=""

start_capturing_mock_curl() {

  REQUEST_CAPTURE_DIR="$(mktemp -d)"
  CAPTURE_CURL_DIR="$(mktemp -d)"

  cat > "${CAPTURE_CURL_DIR}/curl" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
capture_dir="${REQUEST_CAPTURE_DIR}"
mock_curl="${AEGIS_MOCK_PROVIDER_DIR}/mock_openai_curl.sh"
args=("\$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [[ "\${args[\$i]}" == "--data" ]]; then
    request_file="\${args[\$((i + 1))]#@}"
    cp "\${request_file}" "\${capture_dir}/request_\$(date +%s%N).json"
  fi
done
exec "\${mock_curl}" "\$@"
EOF
  chmod +x "${CAPTURE_CURL_DIR}/curl"

  export PATH="${CAPTURE_CURL_DIR}:${PATH}"
  export OPENAI_API_BASE="local-process://mock-openai"
  _export_mock_provider_env
}

assert_prompt_prefix_stability() {

  backup_epistemic_handover

  start_capturing_mock_curl

  bash runtime_aegis.sh discovery "${FIXED_INVESTIGATION_INPUT}" \
    >/dev/null 2>&1 \
    || fail "first_discovery_run_failed"

  bash runtime_aegis.sh discovery "${FIXED_INVESTIGATION_INPUT}" \
    >/dev/null 2>&1 \
    || fail "second_discovery_run_failed"

  local captured=()
  while IFS= read -r f; do
    captured+=("${f}")
  done < <(ls -1 "${REQUEST_CAPTURE_DIR}"/request_*.json 2>/dev/null | sort)

  [[ "${#captured[@]}" -ge 2 ]] \
    || fail "expected_two_captured_requests_got_${#captured[@]}"

  local req_a="${captured[0]}"
  local req_b="${captured[$((${#captured[@]} - 1))]}"

  # System prompts must be byte-identical across runs — any divergence
  # means volatile identity leaked into the stable prefix.
  local sys_a sys_b
  sys_a="$(jq -r '.messages[0].content' "${req_a}")"
  sys_b="$(jq -r '.messages[0].content' "${req_b}")"
  [[ "${sys_a}" == "${sys_b}" ]] \
    || fail "system_prompt_not_prefix_stable_across_runs"

  # The system prompt must carry the skill contract (apex placement).
  printf '%s' "${sys_a}" | grep -q 'Skill contract:' \
    || fail "skill_contract_missing_from_system_prompt"

  # User-message stable prefix (through the payload section header) must
  # be byte-identical across runs.
  local user_a user_b prefix_a prefix_b
  user_a="$(jq -r '.messages[1].content' "${req_a}")"
  user_b="$(jq -r '.messages[1].content' "${req_b}")"

  # Extract the concrete execution id value from the tail section so the
  # leak assertions test the VALUE, not the header phrase (the system
  # prompt legitimately references the header by name).
  local exec_id_a
  exec_id_a="$(
    printf '%s\n' "${user_a}" \
      | awk '$0 == "Execution identity:" { getline; print; exit }'
  )"
  [[ -n "${exec_id_a}" ]] \
    || fail "execution_id_value_missing_from_user_message"

  # NEGATIVE POWER: the volatile execution id value must NOT appear in
  # the system prompt.
  printf '%s' "${sys_a}" | grep -qF "${exec_id_a}" \
    && fail "execution_identity_leaked_into_system_prompt"

  prefix_a="${user_a%%=== EXPOSED CAPABILITY PAYLOADS ===*}"
  prefix_b="${user_b%%=== EXPOSED CAPABILITY PAYLOADS ===*}"

  [[ -n "${prefix_a}" ]] && [[ "${prefix_a}" != "${user_a}" ]] \
    || fail "payload_section_header_missing_from_user_message"

  [[ "${prefix_a}" == "${prefix_b}" ]] \
    || fail "user_stable_prefix_not_identical_across_runs"

  # Volatile identity must sit in the tail, under its named header,
  # AFTER the payload section.
  local tail_a
  tail_a="${user_a#*=== EXPOSED CAPABILITY PAYLOADS ===}"
  printf '%s' "${tail_a}" | grep -q '=== EXECUTION IDENTITY ===' \
    || fail "execution_identity_header_missing_from_user_tail"
  printf '%s' "${prefix_a}" | grep -qF "${exec_id_a}" \
    && fail "execution_identity_leaked_into_user_stable_prefix"
  printf '%s' "${tail_a}" | grep -q '=== INVESTIGATION INPUT ===' \
    || fail "investigation_input_not_in_volatile_tail"
  printf '%s' "${tail_a}" | grep -q '=== MANIFEST EXECUTION METADATA ===' \
    || fail "volatile_manifest_metadata_not_in_tail"
  printf '%s' "${prefix_a}" | grep -q '"manifest_hash"' \
    && fail "manifest_hash_leaked_into_user_stable_prefix"

  echo "[AEGIS][TEST] prompt prefix stability contract passed"
}

test_cleanup_extra() {
  rm -rf "${REQUEST_CAPTURE_DIR}" "${CAPTURE_CURL_DIR}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------

assert_empty_candidate_rejection_gate
assert_prompt_prefix_stability

echo "[PASS] model boundary prompt stability"
