#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — MODEL BOUNDARY CACHE IDEMPOTENCY
# =========================================================
#
# Guards the KV-cache prefix-matching contract at the model boundary:
#
# 1. Salt derivation (fail-powered): derive_cache_salt must be
#    deterministic for an unchanged surface (idempotency) and MUST
#    rotate on any physical mutation of the execution surface —
#    tracked diff, net-new untracked file, or handover generation
#    change. The suite goes red if a mutation fails to rotate the salt
#    (stale attention states would become reachable).
#
# 2. Prompt prefix stability: two consecutive same-mode runtime
#    executions must produce byte-identical system prompts and
#    byte-identical user-message stable prefixes (through the payload
#    section header). Volatile identity (execution id, timestamp,
#    manifest metadata) must appear only in the tail, and the request
#    must carry the cache_salt partition key.
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

source "scripts/lib/common.sh"

export AEGIS_REPAIR_FEEDBACK_LOOP="false"

readonly FIXED_INVESTIGATION_INPUT="cache idempotency smoke investigation"

# ---------------------------------------------------------
# Part 1 — salt derivation: idempotency + forced rotation
# ---------------------------------------------------------

assert_salt_derivation_contract() {

  local surface_dir handover_file
  surface_dir="$(mktemp -d)"
  handover_file="$(mktemp)"

  (
    cd "${surface_dir}"
    git init -q
    git config user.email "aegis-test@localhost"
    git config user.name "Aegis Test"
    echo "line one" > tracked.txt
    git add tracked.txt
    git commit -qm "seed"
  ) || fail "salt_test_surface_setup_failed"

  printf '%s' '{"artifact_snapshot":{"generated_at":"2026-01-01T00:00:00Z"}}' \
    > "${handover_file}"

  local salt_base salt_repeat
  salt_base="$(derive_cache_salt "${surface_dir}" "${handover_file}")"
  salt_repeat="$(derive_cache_salt "${surface_dir}" "${handover_file}")"

  [[ "${salt_base}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "cache_salt_not_sha256_hex: ${salt_base}"

  [[ "${salt_base}" == "${salt_repeat}" ]] \
    || fail "cache_salt_not_idempotent_on_unchanged_surface"

  # NEGATIVE POWER: tracked mutation MUST rotate the salt.
  echo "mutated" >> "${surface_dir}/tracked.txt"
  local salt_after_tracked_mutation
  salt_after_tracked_mutation="$(derive_cache_salt "${surface_dir}" "${handover_file}")"
  [[ "${salt_base}" != "${salt_after_tracked_mutation}" ]] \
    || fail "cache_salt_failed_to_rotate_on_tracked_mutation"

  # Restoring the surface MUST return to the original partition.
  git -C "${surface_dir}" checkout -q -- tracked.txt
  local salt_after_restore
  salt_after_restore="$(derive_cache_salt "${surface_dir}" "${handover_file}")"
  [[ "${salt_base}" == "${salt_after_restore}" ]] \
    || fail "cache_salt_not_restored_after_surface_reset"

  # NEGATIVE POWER: additive-only mutation (net-new untracked file)
  # MUST rotate the salt.
  echo "net new" > "${surface_dir}/untracked_new.txt"
  local salt_after_untracked_addition
  salt_after_untracked_addition="$(derive_cache_salt "${surface_dir}" "${handover_file}")"
  [[ "${salt_base}" != "${salt_after_untracked_addition}" ]] \
    || fail "cache_salt_failed_to_rotate_on_untracked_addition"
  rm -f "${surface_dir}/untracked_new.txt"

  # NEGATIVE POWER: handover generation change MUST rotate the salt.
  printf '%s' '{"artifact_snapshot":{"generated_at":"2026-01-02T00:00:00Z"}}' \
    > "${handover_file}"
  local salt_after_handover_promotion
  salt_after_handover_promotion="$(derive_cache_salt "${surface_dir}" "${handover_file}")"
  [[ "${salt_base}" != "${salt_after_handover_promotion}" ]] \
    || fail "cache_salt_failed_to_rotate_on_handover_promotion"

  rm -rf "${surface_dir}" "${handover_file}"

  echo "[AEGIS][TEST] salt derivation contract passed"
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

  # cache_salt partition key: present, sha256-hex, and stable across two
  # runs with no surface mutation in between.
  local salt_a salt_b
  salt_a="$(jq -r '.cache_salt // empty' "${req_a}")"
  salt_b="$(jq -r '.cache_salt // empty' "${req_b}")"
  [[ "${salt_a}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "request_cache_salt_missing_or_malformed: '${salt_a}'"
  [[ "${salt_a}" == "${salt_b}" ]] \
    || fail "cache_salt_rotated_without_surface_mutation"

  echo "[AEGIS][TEST] prompt prefix stability contract passed"
}

test_cleanup_extra() {
  rm -rf "${REQUEST_CAPTURE_DIR}" "${CAPTURE_CURL_DIR}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------

assert_salt_derivation_contract
assert_prompt_prefix_stability

echo "[PASS] model boundary cache idempotency"
