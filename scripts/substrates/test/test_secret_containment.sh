#!/usr/bin/env bash
#
# test_secret_containment.sh — Formal proof-of-containment test.
#
# Purpose:
#   Proves, by execution, that provider credentials (OPENAI_API_KEY,
#   OPENAI_API_BASE) CANNOT reach the capability process environment, even when
#   those credentials are present in the parent process that invokes the
#   executor.
#
# Why this test exists:
#   test_constitutional_invariants.sh::assert_executor_subprocess_isolation_contract
#   proves that the executor source contains `env -i` (a static/code-inspection
#   proof). This test goes one step further: it invokes the executor's ACTUAL
#   `invoke_capability_handler` with a real probe capability and asserts that
#   the credential variables are absent from the spawned process environment.
#
#   This closes the gap between:
#     (A) "the code references the variable"   — already covered (it does not)
#     (B) "the variable reaches the process"   — covered HERE, by execution
#

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

readonly PROBE_HANDLER="scripts/substrates/test/probes/leak_probe.sh"
readonly SENTINEL_KEY="SECRET-containment-probe-key-do-not-use"
readonly SENTINEL_BASE="https://containment-probe.example.invalid/v1"

test_tmp="$(mktemp -d)"
probe_output="${test_tmp}/probe_output.json"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

# Sanity: probe handler must exist before we reason about its output.
[[ -f "${PROBE_HANDLER}" ]] \
  || fail "missing_probe_handler: ${PROBE_HANDLER}"

# ---------------------------------------------------------------------
# Load the executor so we can invoke its REAL invoke_capability_handler.
# The executor guards entry on its own env state, so we source the
# function definitions only; we do NOT run the executor's main flow.
# ---------------------------------------------------------------------

# The executor needs AEGIS_EXECUTION_ID and a few AEGIS_* vars to be set
# before its functions can be exercised. Provide minimal, probe-only values.
export AEGIS_EXECUTION_ID="secret-containment-probe"
export AEGIS_EXECUTION_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export AEGIS_EXECUTION_SURFACE_PATH="${test_tmp}"
export AEGIS_INVESTIGATION_INPUT="secret containment probe"

# The executor defines invoke_capability_handler inline. To exercise the REAL
# function (not a copy), we extract it from the executor source at runtime so
# this test breaks loudly if the executor's isolation helper is ever renamed.
#
# IMPORTANT: we must extract ONLY invoke_capability_handler. The sibling
# functions invoke_raw_substrate and invoke_aider_substrate legitimately
# include OPENAI_* in their env whitelists (substrates are the credential
# boundary by design). The capability handler must NOT. A naive brace match
# that over-captures would grab those siblings and produce a false failure.
extract_isolation_helper() {
  local src="$1"
  local out="$2"

  awk '
    # Match the function definition line.
    /^invoke_capability_handler\(\) *\{/ { in_fn = 1; depth = 0 }
    in_fn {
      print
      # Update brace depth from this line, then check for close.
      # The signature line contributes 1 "{" so depth becomes 1; the closing
      # "}" line brings it back to 0, which ends the function.
      depth += gsub(/{/, "{")
      depth -= gsub(/}/, "}")
      if (depth <= 0) in_fn = 0
    }
  ' "${src}" > "${out}"

  [[ -s "${out}" ]] \
    || fail "failed_to_extract_isolation_helper_from_executor"

  # Guard: we must have captured exactly one function definition.
  local def_count
  def_count="$(grep -c '^invoke_capability_handler()' "${out}")"
  [[ "${def_count}" -eq 1 ]] \
    || fail "isolation_helper_extraction_captured_wrong_scope: ${def_count} definitions"
}

helper_file="${test_tmp}/isolation_helper.sh"
extract_isolation_helper scripts/execute_mode.sh "${helper_file}"

# Confirm the extracted helper actually uses env -i before trusting it.
grep -q 'env -i' "${helper_file}" \
  || fail "extracted_isolation_helper_missing_env_i"

# Confirm the extracted helper does NOT pass credentials through.
# (Defensive: if someone later edits the executor to inject OPENAI_* into the
# capability env, this test must fail at this assertion.)
grep -q 'OPENAI_API_KEY' "${helper_file}" \
  && fail "isolation_helper_leaks_OPENAI_API_KEY"
grep -q 'OPENAI_API_BASE' "${helper_file}" \
  && fail "isolation_helper_leaks_OPENAI_API_BASE"

# Make the extracted helper callable in this shell.
# shellcheck disable=SC1090
source "${helper_file}"

# ---------------------------------------------------------------------
# THE PROOF: invoke the probe through the executor's real isolation helper
#            while credentials are present in the PARENT environment.
# ---------------------------------------------------------------------

# Set real-looking credentials in OUR environment. If isolation works, these
# MUST NOT propagate to the spawned capability process.
export OPENAI_API_KEY="${SENTINEL_KEY}"
export OPENAI_API_BASE="${SENTINEL_BASE}"

# invoke_capability_handler <handler> <capability_argument>
# The probe ignores its argument; pass an empty string.
invoke_capability_handler "${PROBE_HANDLER}" "" > "${probe_output}" \
  || fail "probe_invocation_failed"

unset OPENAI_API_KEY
unset OPENAI_API_BASE

# ---------------------------------------------------------------------
# Assertions over the probe payload.
# ---------------------------------------------------------------------

# The probe must have produced the capability contract.
jq -e \
  '
    .success == true
    and .capability == "leak_probe"
    and .classification == "readonly"
    and .error == null
  ' "${probe_output}" >/dev/null \
  || fail "invalid_probe_payload_contract"

# --- The core containment assertions ---
# Credentials MUST be absent from the capability process environment.
jq -e '.payload.openai_api_key_present == "false"' "${probe_output}" >/dev/null \
  || fail "OPENAI_API_KEY_LEAKED_INTO_CAPABILITY_ENV"

jq -e '.payload.openai_api_base_present == "false"' "${probe_output}" >/dev/null \
  || fail "OPENAI_API_BASE_LEAKED_INTO_CAPABILITY_ENV"

# Sanity: the env whitelist is small. This is a cheap regression guard: if the
# whitelist ever grows to include the whole parent env, env_var_count will jump
# and this will catch it. The capability whitelist currently contains ~9 vars.
env_count="$(jq -r '.payload.env_var_count' "${probe_output}")"
[[ "${env_count}" -le 30 ]] \
  || fail "capability_env_whitelist_too_wide: ${env_count} vars reached handler"

echo "[PASS] secret containment (credentials cannot reach capability process)"
