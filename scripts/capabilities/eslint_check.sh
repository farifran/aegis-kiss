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

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_emit.sh"

readonly CAPABILITY_NAME="eslint.check"

# Find eslint
if [[ -f "node_modules/.bin/eslint" ]]; then
  readonly ESLINT_BIN="node_modules/.bin/eslint"
else
  readonly ESLINT_BIN="eslint"
fi

# JSON mode when executed by AEGIS
readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

run_eslint_check() {
  local exit_code=0
  local eslint_output=""
  local eslint_exit=0

  if [[ -n "${IS_JSON_OUTPUT}" ]]; then

    local targets=("src")

    if [[ "$#" -gt 0 ]]; then
      targets=("$@")
    fi

    local ignore_opts=(
      --ignore-pattern "node_modules"
      --ignore-pattern ".venv"
      --ignore-pattern ".harness"
    )

    local eslint_stdout_file
    local eslint_stderr_file
    eslint_stdout_file="$(mktemp)"
    eslint_stderr_file="$(mktemp)"
    trap 'rm -f "${eslint_stdout_file}" "${eslint_stderr_file}"' EXIT

    set +e

    ${ESLINT_BIN} \
      "${targets[@]}" \
      "${ignore_opts[@]}" \
      --format json \
      > "${eslint_stdout_file}" \
      2> "${eslint_stderr_file}"

    eslint_exit=$?

    set -e

    eslint_output="$(cat "${eslint_stdout_file}")"
    local eslint_err_msg
    eslint_err_msg="$(cat "${eslint_stderr_file}")"

    if [[ -z "${eslint_output}" ]] || ! echo "${eslint_output}" | jq empty >/dev/null 2>&1; then
      local err_detail="${eslint_err_msg}"
      if [[ -z "${err_detail}" ]]; then
        err_detail="${eslint_output}"
      fi
      if [[ -z "${err_detail}" ]]; then
        err_detail="ESLint execution failed with exit code ${eslint_exit} and no output"
      fi

      aegis_emit_capability_error_message "${CAPABILITY_NAME}" "${err_detail}"
      exit 1
    fi

    local parsed_errors

    parsed_errors="$(
      echo "${eslint_output}" | jq \
        --arg pwd "${PWD}" \
        '[
          .[]
          | select(.messages | length > 0)
          | .filePath as $filePath
          | .messages[]
          | {
              file: ($filePath | sub($pwd + "/"; "")),
              line: .line,
              message: (
                (if .ruleId then (.ruleId + ": ") else "" end)
                + .message
              )
            }
        ]'
    )"

    local error_count
    error_count="$(echo "${parsed_errors}" | jq 'length')"

    if [[ "${error_count}" -eq 0 ]]; then
      aegis_emit_tool_status "${CAPABILITY_NAME}" "passed" "[]"
    else
      aegis_emit_tool_status "${CAPABILITY_NAME}" "failed" "${parsed_errors}"
    fi

    exit 0

  else
    # Direct mode (Aider/manual execution)
    exec ${ESLINT_BIN} "$@"
  fi
}

run_eslint_check "$@"
