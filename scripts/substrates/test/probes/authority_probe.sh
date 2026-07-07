#!/usr/bin/env bash
#
# authority_probe.sh — Authority-isolation probe capability.
#
# Purpose:
#   This is NOT a production capability. It is a test probe used exclusively
#   by test_authority_isolation.sh to prove, by execution, that a capability
#   process cannot observe unauthorized environment variables or receive
#   out-of-bounds filesystem directories from the executor.
#
# Contract:
#   Emits the standard capability payload contract
#   ({ success, capability, classification, execution_id, generated_at, payload, error })
#   so it can be validated like any real capability payload.
#
#   The payload reports:
#     - the full list of environment variable NAMES visible to this process
#       (names only — values are never echoed, so nothing can leak through
#        the payload itself)
#     - the working directory the capability was spawned in
#     - the AEGIS_* directory paths the executor handed over
#
# Invoked only through invoke_capability_handler's env -i whitelist.
#

set -Eeuo pipefail

# Environment variable NAMES visible to this process, as a JSON array.
env_names_json="$(
  env | sed 's/=.*//' | jq -Rn '[inputs]'
)"

jq -n \
  --arg capability "authority_probe" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-probe}" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson env_names "${env_names_json}" \
  --arg cwd "${PWD}" \
  --arg surface_path "${AEGIS_EXECUTION_SURFACE_PATH:-}" \
  --arg payload_dir "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
  --arg evidence_target "${AEGIS_EVIDENCE_TARGET_PATH:-}" \
  '
    {
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: {
        env_names: $env_names,
        cwd: $cwd,
        surface_path: $surface_path,
        payload_dir: $payload_dir,
        evidence_target: $evidence_target
      },
      error: null
    }
  '
