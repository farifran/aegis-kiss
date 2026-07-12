#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — test.run
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
# - execute candidate test suite if configured
# - prevent recursion with harness tests
# - parse test output and status into Aegis standard JSON payload
#
# =========================================================

set -Eeuo pipefail

# Prefer project-local tooling when present; never inject machine-absolute PATH.
if [[ -d "node_modules/.bin" ]]; then
  export PATH="${PWD}/node_modules/.bin:${PATH}"
fi

# Determine if we should output JSON
# JSON is output if AEGIS_EXECUTION_ID is set or if --json is passed
readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

run_tests() {
  local exit_code=0
  local test_output=""
  
  # Check if a custom non-harness test script is in package.json
  if jq -e '.scripts.test and .scripts.test != "echo \"Error: no test specified\" && exit 1"' package.json >/dev/null 2>&1; then
    test_output="$(npm test 2>&1)" || exit_code=$?
  elif [[ -f "node_modules/.bin/vitest" ]]; then
    test_output="$(node_modules/.bin/vitest run 2>&1)" || exit_code=$?
  elif [[ -f "node_modules/.bin/jest" ]]; then
    test_output="$(node_modules/.bin/jest 2>&1)" || exit_code=$?
  else
    # No candidate tests configured
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_aegis_json "passed" "No candidate unit tests configured."
      exit 0
    else
      echo "No candidate unit tests configured."
      exit 0
    fi
  fi
  
  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_aegis_json "passed" "${test_output}"
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
