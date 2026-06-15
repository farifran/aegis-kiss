#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — typescript.check
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
# - verify TypeScript type soundness
# - parse compiler output into Aegis standard JSON payload
# - support direct execution (e.g. for lint-cmd in Aider)
#
# =========================================================

set -Eeuo pipefail

# Find tsc
if [[ -f "node_modules/.bin/tsc" ]]; then
  readonly TSC_BIN="node_modules/.bin/tsc"
else
  readonly TSC_BIN="tsc"
fi

# Determine if we should output JSON
# JSON is output if AEGIS_EXECUTION_ID is set or if --json is passed
readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

run_tsc_check() {
  local exit_code=0
  local tsc_output=""
  
  # Run tsc and capture output
  tsc_output="$(${TSC_BIN} --noEmit --pretty false 2>&1)" || exit_code=$?
  
  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_aegis_json "passed" "[]"
    else
      echo "TypeScript typecheck passed."
      exit 0
    fi
  else
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      # Parse errors into JSON array using jq
      local parsed_errors
      parsed_errors="$(echo "${tsc_output}" | jq -R -s '
        split("\n")
        | map(select(test("^[^(]+\\([0-9]+,[0-9]+\\): error")))
        | map(
            capture("^(?<file>[^(]+)\\((?<line>[0-9]+),(?<col>[0-9]+)\\): error (?<msg>.*)$")
            | {
                file: .file,
                line: (.line | tonumber),
                message: .msg
              }
          )
      ')"
      emit_aegis_json "failed" "${parsed_errors}"
      exit 0
    else
      echo "${tsc_output}"
      exit "${exit_code}"
    fi
  fi
}

emit_aegis_json() {
  local status="$1"
  local errors_json="$2"
  
  jq -n \
    --arg capability "typescript.check" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg status "${status}" \
    --argjson errors "${errors_json}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: {
        status: $status,
        errors: $errors
      },
      error: null
    }'
}

run_tsc_check
