#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — SHARED JSON ENVELOPE (source-only)
# =========================================================
#
# Thin emit helpers for non-filesystem capabilities (git, tsc,
# eslint, test.run). Filesystem extractors keep using
# _shared_utils.sh; this file avoids sourcing config/jail.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][CAPABILITY][FATAL] emit_lib_not_invocable" >&2
  exit 1
fi

aegis_capability_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# aegis_emit_capability_success <capability> <payload_json_object>
aegis_emit_capability_success() {
  local capability="$1"
  local payload_json="$2"

  jq -n \
    --arg capability "${capability}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_capability_now)" \
    --argjson payload "${payload_json}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: $payload,
      error: null
    }'
}

# aegis_emit_capability_failure <capability> <error_type> [target]
# Structured error object: { type, target? }.
aegis_emit_capability_failure() {
  local capability="$1"
  local error_type="$2"
  local target="${3:-}"

  if [[ -n "${target}" ]]; then
    jq -n \
      --arg capability "${capability}" \
      --arg classification "readonly" \
      --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
      --arg generated_at "$(aegis_capability_now)" \
      --arg error_type "${error_type}" \
      --arg target "${target}" \
      '{
        success: false,
        capability: $capability,
        classification: $classification,
        execution_id: $execution_id,
        generated_at: $generated_at,
        payload: null,
        error: {
          type: $error_type,
          target: $target
        }
      }'
  else
    jq -n \
      --arg capability "${capability}" \
      --arg classification "readonly" \
      --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
      --arg generated_at "$(aegis_capability_now)" \
      --arg error_type "${error_type}" \
      '{
        success: false,
        capability: $capability,
        classification: $classification,
        execution_id: $execution_id,
        generated_at: $generated_at,
        payload: null,
        error: {
          type: $error_type
        }
      }'
  fi
}

# aegis_emit_capability_error_message <capability> <message>
# Free-form string error (tool infrastructure failures).
aegis_emit_capability_error_message() {
  local capability="$1"
  local message="$2"

  jq -n \
    --arg capability "${capability}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_capability_now)" \
    --arg message "${message}" \
    '{
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: $message
    }'
}

# aegis_emit_tool_status <capability> <status> <errors_json_array>
# Standard tool payload: { status, errors }.
aegis_emit_tool_status() {
  local capability="$1"
  local status="$2"
  local errors_json="${3:-[]}"

  local payload
  payload="$(
    jq -nc \
      --arg status "${status}" \
      --argjson errors "${errors_json}" \
      '{status: $status, errors: $errors}'
  )"
  aegis_emit_capability_success "${capability}" "${payload}"
}
