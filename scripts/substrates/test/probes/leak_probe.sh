#!/usr/bin/env bash
#
# leak_probe.sh — Secret-containment probe capability.
#
# Purpose:
#   This is NOT a production capability. It is a test probe used exclusively by
#   test_secret_containment.sh to prove, by execution (not by code inspection),
#   that provider credentials cannot reach the capability process environment.
#
# Contract:
#   Emits the standard capability payload contract
#   ({ success, capability, classification, execution_id, generated_at, payload, error })
#   so it can be materialized and validated by the executor like any real capability.
#
#   The payload reports whether OPENAI_API_KEY / OPENAI_API_BASE are present in
#   the process environment of this handler. Under correct isolation, both MUST
#   report as absent.
#
# Invoked only through invoke_capability_handler's env -i whitelist.
#

set -Eeuo pipefail

# Detection is performed WITHOUT ever expanding the secret value:
#   ${VAR+x} expands to "x" iff VAR is set (even to empty), and to nothing otherwise.
# So a leak is detected by SET-ness, never by leaking the value itself.
key_set="${OPENAI_API_KEY+x}"
base_set="${OPENAI_API_BASE+x}"

key_present="false"
base_present="false"

[[ -n "${key_set}" ]] && key_present="true"
[[ -n "${base_set}" ]] && base_present="true"

# Also surface how many env vars reached us, as a cheap sanity bound on the
# whitelist width. The capability whitelist is intentionally small.
env_count="$(env | wc -l | tr -d ' ')"

jq -n \
  --arg capability "leak_probe" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-probe}" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg key_present "${key_present}" \
  --arg base_present "${base_present}" \
  --arg env_count "${env_count}" \
  '
    {
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: {
        openai_api_key_present: $key_present,
        openai_api_base_present: $base_present,
        env_var_count: $env_count
      },
      error: null
    }
  '
