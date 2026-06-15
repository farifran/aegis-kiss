#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — eslint.check
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
# - run ESLint checks on target files or workspace
# - parse lint messages into relative file Aegis standard JSON payload
# - support direct execution (e.g. for lint-cmd in Aider)
#
# =========================================================

set -Eeuo pipefail

# Find eslint
if [[ -f "node_modules/.bin/eslint" ]]; then
  readonly ESLINT_BIN="node_modules/.bin/eslint"
else
  readonly ESLINT_BIN="eslint"
fi

# Determine if we should output JSON
# JSON is output if AEGIS_EXECUTION_ID is set or if --json is passed
readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

run_eslint_check() {
  local exit_code=0
  local eslint_output=""
  
  if [[ -n "${IS_JSON_OUTPUT}" ]]; then
    # In JSON mode, lint everything (or specific targets) and parse with jq
    local targets=("src")
    if [[ "$#" -gt 0 ]]; then
      targets=("$@")
    fi
    
    local ignore_opts=(--ignore-pattern "node_modules" --ignore-pattern ".venv" --ignore-pattern ".harness")
    eslint_output="$(${ESLINT_BIN} "${targets[@]}" "${ignore_opts[@]}" --format json 2>/dev/null || true)"
    
    # Parse using jq, translating absolute paths to relative paths
    local parsed_errors
    parsed_errors="$(echo "${eslint_output}" | jq \
      --arg pwd "${PWD}" \
      '[
        .[]
        | select(.messages | length > 0)
        | .filePath as $filePath
        | .messages[]
        | {
            file: ($filePath | sub($pwd + "/"; "")),
            line: .line,
            message: ((if .ruleId then (.ruleId + ": ") else "" end) + .message)
          }
      ]')"
      
    local error_count
    error_count="$(echo "${parsed_errors}" | jq 'length')"
    
    if [[ "${error_count}" -eq 0 ]]; then
      emit_aegis_json "passed" "[]"
    else
      emit_aegis_json "failed" "${parsed_errors}"
    fi
    exit 0
  else
    # Direct mode for Aider or manual CLI run
    exec ${ESLINT_BIN} "$@"
  fi
}

emit_aegis_json() {
  local status="$1"
  local errors_json="$2"
  
  jq -n \
    --arg capability "eslint.check" \
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

run_eslint_check "$@"
