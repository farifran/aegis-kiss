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

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_emit.sh"

readonly CAPABILITY_NAME="test.run"

# Prefer project-local tooling when present; never inject machine-absolute PATH.
if [[ -d "node_modules/.bin" ]]; then
  export PATH="${PWD}/node_modules/.bin:${PATH}"
fi

readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

emit_test_status() {
  local status="$1"
  local summary="$2"
  local payload
  payload="$(
    jq -nc \
      --arg status "${status}" \
      --arg summary "${summary}" \
      '{status: $status, summary: $summary}'
  )"
  aegis_emit_capability_success "${CAPABILITY_NAME}" "${payload}"
}

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
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_test_status "passed" "No candidate unit tests configured."
      exit 0
    else
      echo "No candidate unit tests configured."
      exit 0
    fi
  fi

  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_test_status "passed" "${test_output}"
      exit 0
    else
      echo "${test_output}"
      echo "Tests passed."
      exit 0
    fi
  else
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_test_status "failed" "${test_output}"
      exit 0
    else
      echo "${test_output}"
      exit "${exit_code}"
    fi
  fi
}

run_tests
