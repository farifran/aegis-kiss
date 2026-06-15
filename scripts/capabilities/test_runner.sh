#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — test.run
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
# - execute the test suite (npm run aegis:test)
# - parse test output and status into Aegis standard JSON payload
# - support direct execution (e.g. for test-cmd in Aider)
#
# =========================================================

set -Eeuo pipefail

# Ensure node/npm is in PATH
export PATH="/Users/rafaelfarias/.gemini/antigravity/bin:$PATH"

# Determine if we should output JSON
# JSON is output if AEGIS_EXECUTION_ID is set or if --json is passed
readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

run_tests() {
  local exit_code=0
  local test_output=""
  
  # Run npm run aegis:test and capture output
  test_output="$(npm run aegis:test 2>&1)" || exit_code=$?
  
  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_aegis_json "passed" "All tests passed successfully."
      exit 0
    else
      echo "${test_output}"
      echo "Tests passed."
      exit 0
    fi
  else
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_aegis_json "failed" "${test_output}"
      exit 0
    else
      echo "${test_output}"
      exit "${exit_code}"
    fi
  fi
}

emit_aegis_json() {
  local status="$1"
  local summary="$2"
  
  # Create a clean, safe JSON payload, keeping summary small or bounded if needed
  jq -n \
    --arg capability "test.run" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg status "${status}" \
    --arg summary "${summary}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: {
        status: $status,
        summary: $summary
      },
      error: null
    }'
}

run_tests
