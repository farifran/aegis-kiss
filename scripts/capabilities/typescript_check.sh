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

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_emit.sh"

readonly CAPABILITY_NAME="typescript.check"

# Find tsc
if [[ -f "node_modules/.bin/tsc" ]]; then
  readonly TSC_BIN="node_modules/.bin/tsc"
else
  readonly TSC_BIN="tsc"
fi

# JSON mode when AEGIS_EXECUTION_ID is set
readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

run_tsc_check() {
  local exit_code=0
  local tsc_output=""

  tsc_output="$(${TSC_BIN} --noEmit --pretty false 2>&1)" || exit_code=$?

  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      aegis_emit_tool_status "${CAPABILITY_NAME}" "passed" "[]"
    else
      echo "TypeScript typecheck passed."
      exit 0
    fi
  else
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
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
      aegis_emit_tool_status "${CAPABILITY_NAME}" "failed" "${parsed_errors}"
      exit 0
    else
      echo "${tsc_output}"
      exit "${exit_code}"
    fi
  fi
}

run_tsc_check
