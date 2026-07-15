#!/usr/bin/env bash
# Source-only — workspace isolation + validation + payload render (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_workspace_lib_not_invocable" >&2
  exit 1
fi

resolve_absolute_input_path() {
  local input_path="$1"

  if [[ "${input_path}" == /* ]]; then
    printf '%s' "${input_path}"
  else
    printf '%s/%s' "${AEGIS_SUBSTRATE_ROOT}" "${input_path}"
  fi
}

normalize_selected_payload_paths() {
  local normalized_paths=()
  local payload_path

  for payload_path in "${SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"; do
    normalized_paths+=("$(resolve_absolute_input_path "${payload_path}")")
  done

  SELECTED_CAPABILITY_PAYLOAD_PATHS=("${normalized_paths[@]}")

  export AEGIS_SELECTED_CAPABILITY_PAYLOADS="$(
    jq -cn '$ARGS.positional' --args "${SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"
  )"
}

prepare_isolated_substrate_workspace() {

  AEGIS_SUBSTRATE_WORKSPACE="$(mktemp -d)"

  [[ -d "${AEGIS_SUBSTRATE_WORKSPACE}" ]] \
    || aegis_fatal "failed_to_prepare_isolated_substrate_workspace"

  cd "${AEGIS_SUBSTRATE_WORKSPACE}"
}

# =========================================================
# VALIDATION
# =========================================================

validate_raw_substrate_inputs() {

  [[ -n "${MODEL}" ]] \
    || aegis_fatal "missing_model"

  SKILL_FILE="$(
    resolve_absolute_input_path "${SKILL_FILE_INPUT}"
  )"

  CAPABILITY_PAYLOAD_DIR="$(
    resolve_absolute_input_path "${CAPABILITY_PAYLOAD_DIR_INPUT}"
  )"

  [[ -f "${SKILL_FILE}" ]] \
    || aegis_fatal "missing_skill_file"

  [[ -n "${CAPABILITY_MANIFEST}" ]] \
    || aegis_fatal "missing_capability_manifest"

  # Single-pass manifest validation: one jq fork evaluates every
  # contract rule and names the first violation; a parse failure
  # (non-JSON manifest) exits nonzero and hits the fatal fallback.
  local manifest_violation
  manifest_violation="$(
    printf '%s\n' "${CAPABILITY_MANIFEST}" \
      | jq -r --arg mode "${AEGIS_MODE}" '
          if .mode != $mode then "manifest_mode_mismatch"
          elif .execution_engine != "raw" then "manifest_not_readonly_engine"
          elif ((.capabilities | type) != "array")
            or (([.capabilities[]?.classification == "readonly"] | all) | not)
          then "manifest_contains_non_readonly_capabilities"
          else empty end
        ' 2>/dev/null
  )" || aegis_fatal "invalid_capability_manifest_json"

  [[ -z "${manifest_violation}" ]] \
    || aegis_fatal "${manifest_violation}"

  [[ -d "${CAPABILITY_PAYLOAD_DIR}" ]] \
    || aegis_fatal "missing_capability_payload_directory"

  [[ -n "${OPENAI_API_KEY:-}" ]] \
    || aegis_fatal "missing_provider_api_key"

  [[ -n "${OPENAI_API_BASE:-}" ]] \
    || aegis_fatal "missing_provider_api_base"

  [[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
    || aegis_fatal "missing_execution_id"

  [[ -n "${AEGIS_EXECUTION_TIMESTAMP:-}" ]] \
    || aegis_fatal "missing_execution_timestamp"

  [[ -n "${AEGIS_MODE:-}" ]] \
    || aegis_fatal "missing_execution_mode"

  [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    || aegis_fatal "missing_investigation_input"

  [[ -n "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES:-}" ]] \
    || aegis_fatal "missing_evidence_budget"

  [[ -n "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-}" ]] \
    || aegis_fatal "missing_capability_payload_budget"

  [[ -n "${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-}" ]] \
    || aegis_fatal "missing_response_timeout"

  [[ -n "${AEGIS_PROVIDER_CONNECT_TIMEOUT:-}" ]] \
    || aegis_fatal "missing_connect_timeout"

  [[ -n "${AEGIS_PROVIDER_MAX_RETRIES:-}" ]] \
    || aegis_fatal "missing_retry_configuration"

  [[ -n "${AEGIS_PROVIDER_RETRY_DELAY:-}" ]] \
    || aegis_fatal "missing_retry_delay"

  [[ -n "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" ]] \
    || aegis_fatal "missing_selected_capability_payloads"

  echo "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
    | jq -e 'type == "array"' \
      >/dev/null 2>&1 \
    || aegis_fatal "invalid_selected_capability_payloads"

  mapfile -t SELECTED_CAPABILITY_PAYLOAD_PATHS < <(
    echo "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
      | jq -r '.[]'
  )

  [[ "${#SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}" -gt 0 ]] \
    || aegis_fatal "empty_selected_capability_payloads"

  normalize_selected_payload_paths
}

# =========================================================
# TEMP FILES
# =========================================================

TMP_SYSTEM_PROMPT_FILE="$(
  mktemp
)"

TMP_MANIFEST_FILE="$(
  mktemp
)"

TMP_CAPABILITY_CONTEXT_FILE="$(
  mktemp
)"

TMP_REQUEST_FILE="$(
  mktemp
)"

TMP_RESPONSE_FILE="$(
  mktemp
)"

cleanup_raw_substrate() {

  set +e

  rm -f \
    "${TMP_SYSTEM_PROMPT_FILE}" \
    "${TMP_MANIFEST_FILE}" \
    "${TMP_CAPABILITY_CONTEXT_FILE}" \
    "${TMP_REQUEST_FILE}" \
    "${TMP_RESPONSE_FILE}" \
    >/dev/null 2>&1 || true

  if [[ -n "${AEGIS_SUBSTRATE_WORKSPACE}" ]]; then
    rm -rf "${AEGIS_SUBSTRATE_WORKSPACE}" \
      >/dev/null 2>&1 || true
  fi

  set -e
}

trap cleanup_raw_substrate EXIT
trap 'aegis_warn "Interrupted"; exit 130' INT TERM

# =========================================================
# UTILITY HELPERS
# =========================================================

truncate_file_bytes() {

  local input_file="$1"
  local max_bytes="$2"
  local output_file="$3"

  local current_size
  current_size="$(
    wc -c < "${input_file}"
  )"

  if [[ "${current_size}" -le "${max_bytes}" ]]; then
    cat "${input_file}" > "${output_file}"
    return
  fi

  head -c "${max_bytes}" "${input_file}" > "${output_file}"
  printf '\n[AEGIS][TRUNCATED]\n' >> "${output_file}"
}

render_bounded_payload_section() {

  local payload_path="$1"
  local section_file="$2"

  local payload_name
  payload_name="$(basename "${payload_path}")"

  local compact_file
  compact_file="$(
    mktemp
  )"

  if jq -c . "${payload_path}" > "${compact_file}" 2>/dev/null; then
    :
  else
    cat "${payload_path}" > "${compact_file}"
  fi

  local payload_size
  payload_size="$(
    wc -c < "${compact_file}"
  )"

  if [[ "${payload_size}" -gt "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES}" ]]; then
    truncate_file_bytes \
      "${compact_file}" \
      "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES}" \
      "${compact_file}.bounded"
    mv "${compact_file}.bounded" "${compact_file}"
  fi

  {
    echo "--- PAYLOAD: ${payload_name} ---"
    echo "SOURCE: ${payload_path}"
    echo
    cat "${compact_file}"
    echo
  } >> "${section_file}"

  rm -f "${compact_file}" >/dev/null 2>&1 || true
}

# =========================================================
# PROMPT ASSEMBLY
# =========================================================


