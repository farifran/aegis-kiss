#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — SHARED FILESYSTEM SURFACE UTILITIES
# =========================================================
#
# Classification:
# readonly (helper — not an invocable capability)
#
# Responsibilities:
#
# - capability envelope JSON emission (success/failure)
# - configuration sourcing and identity propagation
# - prune policy validation and exposure
# - bounded payload truncation
# - temp file lifecycle
#
# This helper intentionally:
#
# - carries no capability authority of its own;
# - is sourced only by thin capability surfaces;
# - is included in manifest integrity hashing.
#
# =========================================================

# Must be sourced, never executed.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][CAPABILITY][FATAL] shared_utils_not_invocable" >&2
  exit 1
fi

AEGIS_CAPABILITY_NAME=""
AEGIS_TRUNCATED="false"
AEGIS_TMP_FILES=()

# ---------------------------------------------------------
# Identity and configuration
# ---------------------------------------------------------

# Config is sourced at file scope so its declare'd registries stay global
# (declare inside a function would make them function-local).
[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][CAPABILITY][FATAL] missing_config" >&2
  exit 1
}

# shellcheck disable=SC1091
source ".harness/config.sh"

aegis_capability_init() {
  AEGIS_CAPABILITY_NAME="$1"
}

aegis_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# ---------------------------------------------------------
# Failure envelopes
# ---------------------------------------------------------

fail() {
  local error_type="$1"
  local target="${2:-}"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
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
}

fail_without_target() {
  local error_type="$1"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
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
}

# ---------------------------------------------------------
# Common validation
# ---------------------------------------------------------

require_directory_target() {
  local target="$1"

  if [[ ! -d "${target}" ]]; then
    fail "missing_directory" "${target}"
    exit 1
  fi
}

require_prune_policy() {

  declare -p AEGIS_FILESYSTEM_PRUNE_PATHS >/dev/null 2>&1 || {
    fail "missing_prune_policy"
    exit 1
  }

  export PRUNE_PATHS="${AEGIS_FILESYSTEM_PRUNE_PATHS[*]}"
}

# ---------------------------------------------------------
# Temp file lifecycle
# ---------------------------------------------------------

aegis_mktemp() {
  local tmp
  tmp="$(mktemp)"
  AEGIS_TMP_FILES+=("${tmp}")
  printf '%s' "${tmp}"
}

aegis_cleanup_tmp() {
  rm -f "${AEGIS_TMP_FILES[@]:-}" "${AEGIS_TMP_FILES[@]/%/.bounded}" \
    >/dev/null 2>&1 || true
}

trap aegis_cleanup_tmp EXIT

# ---------------------------------------------------------
# Payload boundaries
# ---------------------------------------------------------

# Truncate a file in place to max_bytes and append a marker line.
# Sets AEGIS_TRUNCATED="true" when truncation occurred.
bound_file_bytes() {
  local file="$1"
  local max_bytes="$2"
  local marker="$3"

  local current_size
  current_size="$(wc -c < "${file}")"

  if [[ "${current_size}" -le "${max_bytes}" ]]; then
    return 0
  fi

  head -c "${max_bytes}" "${file}" > "${file}.bounded"
  printf '\n%s\n' "${marker}" >> "${file}.bounded"
  mv "${file}.bounded" "${file}"

  AEGIS_TRUNCATED="true"
}

# ---------------------------------------------------------
# Success envelopes
# ---------------------------------------------------------

# Wrap a pre-built payload object (stored in a file) in the
# standard capability envelope.
emit_success_payload_file() {
  local payload_file="$1"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
    --slurpfile payload "${payload_file}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: $payload[0],
      error: null
    }'
}

# Wrap extractor output (a JSON document passed as a string) in the
# standard envelope with payload {target, <key>: <document>}.
emit_extraction_result() {
  local payload_key="$1"
  local target="$2"
  local extraction_json="$3"

  local tmp
  tmp="$(aegis_mktemp)"
  printf '%s' "${extraction_json}" > "${tmp}"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
    --arg target "${target}" \
    --arg key "${payload_key}" \
    --slurpfile extraction "${tmp}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: {
        target: $target,
        ($key): $extraction[0]
      },
      error: null
    }'

  rm -f "${tmp}" >/dev/null 2>&1 || true
}
