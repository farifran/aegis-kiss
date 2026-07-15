#!/usr/bin/env bash
#
# test_authority_isolation.sh — Formal authority-isolation test.
#
# Purpose:
#   Proves, by execution, that capability handlers cannot exceed their
#   declared envelope at runtime:
#
#     1. The configuration layer rejects any evidence profile that references
#        a capability outside the mode's declared envelope.
#     2. The protocol VM (scripts/execute_mode.sh) aborts with a deterministic
#        fatal exit code when a mode is not registered in the execution-engine
#        registry.
#     3. The protocol VM aborts with a deterministic fatal exit code when an
#        adversarial epistemic handover attempts to escalate authority by
#        injecting a capability with no registered handler in
#        .harness/config.sh — and no payload for the rogue capability is ever
#        materialized, and no substrate is ever invoked.
#     4. Capability execution cannot observe unauthorized environment
#        variables (adversarial sentinels planted in the parent environment
#        must not propagate) and receives only in-bounds filesystem
#        directories from the executor.
#     5. The path-containment jail (guard_path_containment in
#        scripts/capabilities/filesystem/_shared_utils.sh) traps and blocks
#        out-of-tree read targets — absolute (/etc/passwd) and traversal
#        (../../…) — both at the handler layer and through the executor's
#        full adversarial-handover flow.
#
# Complements:
#   test_secret_containment.sh — proves credentials never reach capabilities.
#   This test generalizes that proof to the full authority surface: envelope
#   membership, handler registration, environment whitelist width, and
#   filesystem bounds.
#

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

readonly EXECUTOR="scripts/execute_mode.sh"
readonly PROBE_HANDLER="scripts/substrates/test/probes/authority_probe.sh"
readonly ROGUE_CAPABILITY="authority.escalation_probe"

test_tmp="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

[[ -f "${EXECUTOR}" ]] || fail "missing_executor: ${EXECUTOR}"
[[ -f "${PROBE_HANDLER}" ]] || fail "missing_probe_handler: ${PROBE_HANDLER}"

backup_epistemic_handover

# ---------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------

readonly SKILL_FILE=".skills/validation.md"
[[ -f "${SKILL_FILE}" ]] || fail "missing_skill_fixture: ${SKILL_FILE}"

# Minimal-but-valid runtime-owned manifest. The abort under test must fire
# BEFORE manifest consumption, so an empty modes map is sufficient.
readonly MANIFEST_JSON='{"schema_version":"test","modes":{}}'

# Run the executor as a subprocess with controlled inputs and capture its
# exit code, stdout and stderr.
#
# run_executor <mode> <handover_file> <stdout_file> <stderr_file>
# Returns the executor's exit code.
run_executor() {
  local mode="$1"
  local handover_file="$2"
  local stdout_file="$3"
  local stderr_file="$4"

  local rc=0
  env \
    AEGIS_EXECUTION_SURFACE_PATH="${test_tmp}/surface" \
    AEGIS_EXECUTION_ID="authority-isolation-test" \
    AEGIS_EXECUTION_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    AEGIS_INVESTIGATION_INPUT="authority isolation probe" \
    AEGIS_CAPABILITY_MANIFEST="${MANIFEST_JSON}" \
    OPENAI_API_KEY="sk-test-key-authority-isolation" \
    bash "${EXECUTOR}" \
      "${SKILL_FILE}" \
      "${mode}" \
      "${handover_file}" \
    > "${stdout_file}" 2> "${stderr_file}" \
    || rc=$?

  return "${rc}"
}

mkdir -p "${test_tmp}/surface"

# ---------------------------------------------------------------------
# 1. Configuration layer: evidence profiles must stay inside envelopes.
#    validate_evidence_profiles is the load-time authority gate; it must
#    exist, be enforced on every config load, and pass for the shipped
#    topology (a rogue profile would make `source .harness/config.sh`
#    itself fail, which _test_lib.sh already exercised above).
# ---------------------------------------------------------------------

declare -F validate_evidence_profiles >/dev/null \
  || fail "missing_config_authority_gate: validate_evidence_profiles"

validate_evidence_profiles \
  || fail "shipped_evidence_profiles_escape_envelope"

# The gate must actually run at config load time, not merely exist.
grep -q '^validate_aegis_configuration$' .harness/config.sh \
  || fail "config_does_not_enforce_validation_on_load"

# ---------------------------------------------------------------------
# 2. Unknown mode: a mode absent from the execution-engine registry must
#    abort deterministically before any capability is touched.
# ---------------------------------------------------------------------

rogue_mode_handover="${test_tmp}/rogue_mode_handover.json"
echo '{"artifact_snapshot":{}}' > "${rogue_mode_handover}"

rc=0
run_executor \
  "exfiltration" \
  "${rogue_mode_handover}" \
  "${test_tmp}/unknown_mode.out" \
  "${test_tmp}/unknown_mode.err" \
  || rc=$?

[[ "${rc}" -eq 1 ]] \
  || fail "unknown_mode_wrong_exit_code: expected 1, got ${rc}"

grep -q '\[FATAL\] unknown_execution_mode' "${test_tmp}/unknown_mode.err" \
  || fail "unknown_mode_missing_deterministic_fatal_marker"

# ---------------------------------------------------------------------
# 3. Handler-registry escalation: an adversarial handover injects a
#    capability that has NO registered handler in .harness/config.sh via
#    required_evidence. The executor must abort fatally, materialize no
#    rogue payload, and never reach the substrate.
# ---------------------------------------------------------------------

# The handover is both the executor input and the runtime-owned
# filesystem.read target, so materialization of the legitimate
# validation evidence succeeds and the abort is attributable ONLY to the
# rogue capability.
mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"
jq -n \
  --arg rogue "${ROGUE_CAPABILITY}" \
  '{
    artifact_snapshot: {
      mode: "adversarial",
      operational_context: {
        required_evidence: [$rogue]
      }
    }
  }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

rogue_payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${ROGUE_CAPABILITY//./_}.json"
rm -f "${rogue_payload_file}"

rc=0
run_executor \
  "validation" \
  "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
  "${test_tmp}/escalation.out" \
  "${test_tmp}/escalation.err" \
  || rc=$?

[[ "${rc}" -eq 1 ]] \
  || fail "handler_escalation_wrong_exit_code: expected 1, got ${rc}"

grep -q '\[FATAL\] missing_capability_handler' "${test_tmp}/escalation.err" \
  || fail "handler_escalation_missing_deterministic_fatal_marker"

# The rogue capability must never have produced a payload.
[[ ! -f "${rogue_payload_file}" ]] \
  || fail "rogue_capability_payload_was_materialized"

# The substrate must never have executed: no artifact protocol markers.
grep -q "${AEGIS_ARTIFACT_BEGIN_MARKER}" "${test_tmp}/escalation.out" \
  && fail "substrate_executed_despite_authority_violation"

# ---------------------------------------------------------------------
# 4. Environment & filesystem isolation under adversarial conditions.
#    Extract the executor's REAL invoke_capability_handler (same
#    technique as test_secret_containment.sh) and invoke the authority
#    probe while hostile sentinels are planted in the parent env.
# ---------------------------------------------------------------------

extract_isolation_helper() {
  local src="$1"
  local out="$2"

  # Extract run_with_isolated_base_env (owns env -i) + invoke_capability_handler.
  awk '
    /^run_with_isolated_base_env\(\) *\{/ { in_fn = 1; depth = 0; want_handler = 1 }
    /^invoke_capability_handler\(\) *\{/ {
      if (!want_handler) next
      in_fn = 1
      depth = 0
      capturing_handler = 1
    }
    in_fn {
      print
      depth += gsub(/{/, "{")
      depth -= gsub(/}/, "}")
      if (depth <= 0) {
        in_fn = 0
        if (capturing_handler) exit
      }
    }
  ' "${src}" > "${out}"

  [[ -s "${out}" ]] \
    || fail "failed_to_extract_isolation_helper_from_executor"

  local base_count handler_count
  base_count="$(grep -c '^run_with_isolated_base_env()' "${out}" || true)"
  handler_count="$(grep -c '^invoke_capability_handler()' "${out}" || true)"
  [[ "${base_count}" -eq 1 ]] \
    || fail "isolation_helper_extraction_missing_base_env: ${base_count}"
  [[ "${handler_count}" -eq 1 ]] \
    || fail "isolation_helper_extraction_captured_wrong_scope: ${handler_count} definitions"
}

helper_file="${test_tmp}/isolation_helper.sh"
extract_isolation_helper "${EXECUTOR}" "${helper_file}"

grep -q 'env -i' "${helper_file}" \
  || fail "extracted_isolation_helper_missing_env_i"

# shellcheck disable=SC1090
source "${helper_file}"

# The executor-owned inputs the helper legitimately forwards.
export AEGIS_EXECUTION_ID="authority-isolation-probe"
export AEGIS_EXECUTION_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_ROOT}/authority_probe"
export AEGIS_INVESTIGATION_INPUT="authority isolation probe"

# Hostile sentinels: none of these may reach the capability process.
export AEGIS_ROGUE_AUTHORITY_TOKEN="ROGUE-authority-token-do-not-propagate"
export EXFIL_TARGET_DIR="/etc"
export AWS_SECRET_ACCESS_KEY="ROGUE-aws-secret-do-not-propagate"
export SSH_AUTH_SOCK="/tmp/rogue-agent.sock"

probe_output="${test_tmp}/authority_probe_output.json"

invoke_capability_handler "${PROBE_HANDLER}" "" > "${probe_output}" \
  || fail "authority_probe_invocation_failed"

unset AEGIS_ROGUE_AUTHORITY_TOKEN EXFIL_TARGET_DIR
unset AWS_SECRET_ACCESS_KEY SSH_AUTH_SOCK

# Probe payload contract sanity.
jq -e '
    .success == true
    and .capability == "authority_probe"
    and .classification == "readonly"
    and .error == null
  ' "${probe_output}" >/dev/null \
  || fail "invalid_authority_probe_payload_contract"

# --- Environment isolation: NO env var outside the documented whitelist
#     may reach the capability process. (env -i whitelist + the vars the
#     spawned shell itself manages: PWD, OLDPWD, SHLVL, _.)
env_violations="$(
  jq -r '
    [
      "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
      "PWD", "OLDPWD", "SHLVL", "_",
      "AEGIS_EXECUTION_ID",
      "AEGIS_EXECUTION_TIMESTAMP",
      "AEGIS_EXECUTION_SURFACE_PATH",
      "AEGIS_EPISTEMIC_HANDOVER_FILE",
      "AEGIS_INVESTIGATION_INPUT",
      "AEGIS_EVIDENCE_TARGET_PATH",
      "AEGIS_CAPABILITY_PAYLOAD_DIR",
      "AEGIS_POCKET_MAP_FILE",
      "AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES",
      "AEGIS_FILE_CONTENT_MAX_BYTES",
      "AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES",
      "AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES",
      "AEGIS_SEARCH_SYMBOL_CONTEXT_LINES"
    ] as $whitelist
    | .payload.env_names - $whitelist
    | .[]
  ' "${probe_output}"
)"

[[ -z "${env_violations}" ]] \
  || fail "unauthorized_env_vars_reached_capability: ${env_violations//$'\n'/, }"

# Explicit negative assertions on the hostile sentinels.
for sentinel in \
  AEGIS_ROGUE_AUTHORITY_TOKEN EXFIL_TARGET_DIR \
  AWS_SECRET_ACCESS_KEY SSH_AUTH_SOCK; do
  jq -e --arg s "${sentinel}" \
    '.payload.env_names | index($s) == null' \
    "${probe_output}" >/dev/null \
    || fail "hostile_sentinel_leaked_into_capability_env: ${sentinel}"
done

# --- Filesystem bounds: every directory surface the executor hands to a
#     capability must resolve inside the repository root.
assert_path_in_bounds() {
  local label="$1"
  local path="$2"

  [[ -n "${path}" ]] || fail "empty_capability_path_surface: ${label}"

  case "${path}" in
    /*) [[ "${path}" == "${AEGIS_TEST_ROOT}"* ]] \
          || fail "out_of_bounds_capability_path: ${label}=${path}" ;;
    *)  [[ "${path}" != *".."* ]] \
          || fail "traversal_in_capability_path: ${label}=${path}" ;;
  esac
}

probe_cwd="$(jq -r '.payload.cwd' "${probe_output}")"
[[ "${probe_cwd}" == "${AEGIS_TEST_ROOT}" ]] \
  || fail "capability_spawned_outside_repository_root: ${probe_cwd}"

assert_path_in_bounds "surface_path" \
  "$(jq -r '.payload.surface_path' "${probe_output}")"
assert_path_in_bounds "payload_dir" \
  "$(jq -r '.payload.payload_dir' "${probe_output}")"
assert_path_in_bounds "evidence_target" \
  "$(jq -r '.payload.evidence_target' "${probe_output}")"

# ---------------------------------------------------------------------
# 5. Path-traversal jail: out-of-tree read targets must be trapped and
#    blocked by guard_path_containment before any raw content is emitted.
# ---------------------------------------------------------------------

readonly READ_HANDLER="scripts/capabilities/filesystem/read_file.sh"
[[ -f "${READ_HANDLER}" ]] || fail "missing_read_handler: ${READ_HANDLER}"

# 5a. Handler layer, through the executor's REAL isolation helper.
#     Escape attempts must exit non-zero and emit the standard failure
#     envelope with the deterministic containment error type.
assert_read_target_jailed() {
  local target="$1"

  local out="${test_tmp}/jail_$(printf '%s' "${target}" | tr '/.' '__').json"

  local rc=0
  invoke_capability_handler "${READ_HANDLER}" "${target}" > "${out}" \
    || rc=$?

  [[ "${rc}" -ne 0 ]] \
    || fail "out_of_tree_read_not_blocked: ${target}"

  jq -e '
      .success == false
      and .payload == null
      and .error.type == "path_containment_violation"
    ' "${out}" >/dev/null \
    || fail "jail_breach_missing_deterministic_failure_envelope: ${target}"

  # The raw content must never appear in the emitted envelope.
  if grep -q 'root:' "${out}"; then
    fail "out_of_tree_content_leaked_into_envelope: ${target}"
  fi
}

assert_read_target_jailed "/etc/passwd"
assert_read_target_jailed "../../some_secret"
assert_read_target_jailed "${AEGIS_TEST_ROOT}/../authority_jail_escape"

# Positive control: in-tree reads must still succeed unchanged.
control_out="${test_tmp}/jail_control.json"
invoke_capability_handler "${READ_HANDLER}" "AGENTS.md" > "${control_out}" \
  || fail "in_tree_read_broken_by_jail"

jq -e '
    .success == true
    and .error == null
    and .payload.target == "AGENTS.md"
    and (.payload.content | type == "string" and length > 0)
  ' "${control_out}" >/dev/null \
  || fail "in_tree_read_payload_contract_broken_by_jail"

# 5b. Full executor flow: an adversarial handover pointing filesystem.read
#     at an out-of-tree absolute path must abort the protocol VM with no
#     payload materialized for the escape target.
jq -n \
  '{
    artifact_snapshot: {
      mode: "adversarial",
      operational_context: {
        required_evidence: ["filesystem.read:/etc/passwd"]
      }
    }
  }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

escape_payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read__etc_passwd.json"
rm -f "${escape_payload_file}"

rc=0
run_executor \
  "validation" \
  "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
  "${test_tmp}/jail_executor.out" \
  "${test_tmp}/jail_executor.err" \
  || rc=$?

[[ "${rc}" -eq 1 ]] \
  || fail "executor_jail_escape_wrong_exit_code: expected 1, got ${rc}"

[[ ! -f "${escape_payload_file}" ]] \
  || fail "out_of_tree_evidence_payload_was_materialized"

grep -q "${AEGIS_ARTIFACT_BEGIN_MARKER}" "${test_tmp}/jail_executor.out" \
  && fail "substrate_executed_despite_jail_escape_attempt"

echo "[PASS] authority isolation (envelope gate, deterministic fatal abort, env/fs containment, path jail)"
