#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — RAW COGNITION SUBSTRATE
# =========================================================
#
# Version: 2.9
# Layer: Raw Readonly Cognition Substrate
# Status: Evidence Exposure Hardened
#
# Responsibilities:
#
# - bounded cognition execution
# - provider interaction
# - capability-exposed prompt assembly
# - selective payload exposure
# - payload aggregation
# - evidence budget enforcement
# - bounded evidence assembly
# - truncation policy enforcement
# - protocol coercion
# - deterministic artifact extraction
#
# This substrate intentionally:
#
# - consumes only runtime-exposed capability payloads;
# - avoids full payload-directory scanning;
# - avoids assistant topology;
# - avoids hidden operational memory surfaces;
# - emits only bounded protocol payloads;
# - treats the model as a JSON payload generator.
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# ROOT RESOLUTION
# =========================================================

readonly AEGIS_SUBSTRATE_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

cd "${AEGIS_SUBSTRATE_ROOT}"

# =========================================================
# CONFIGURATION
# =========================================================

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][RAW][FATAL] missing_config" >&2
  exit 1
}

source ".harness/config.sh"

# =========================================================
# INPUTS
# =========================================================

readonly MODEL="${1:-}"
readonly SKILL_FILE_INPUT="${2:-}"
readonly CAPABILITY_MANIFEST="${3:-}"
readonly CAPABILITY_PAYLOAD_DIR_INPUT="${4:-}"

SKILL_FILE=""
CAPABILITY_PAYLOAD_DIR=""
AEGIS_SUBSTRATE_WORKSPACE=""

# =========================================================
# LOGGING
# =========================================================

raw_log() {
  echo "[AEGIS][RAW] $*" >&2
}

raw_warn() {
  echo "[AEGIS][RAW][WARN] $*" >&2
}

raw_fatal() {
  echo "[AEGIS][RAW][FATAL] $*" >&2
  exit 1
}

resolve_absolute_input_path() {
  local input_path="$1"

  if [[ "${input_path}" == /* ]]; then
    printf '%s' "${input_path}"
  else
    printf '%s/%s' "${AEGIS_SUBSTRATE_ROOT}" "${input_path}"
  fi
}

normalize_selected_payload_paths() {
  local normalized_payloads='[]'
  local payload_path
  local absolute_payload_path

  for payload_path in "${SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"; do

    absolute_payload_path="$(
      resolve_absolute_input_path "${payload_path}"
    )"

    normalized_payloads="$(
      printf '%s' "${normalized_payloads}" \
        | jq --arg payload_path "${absolute_payload_path}" '. + [$payload_path]'
    )"

  done

  export AEGIS_SELECTED_CAPABILITY_PAYLOADS="${normalized_payloads}"

  mapfile -t SELECTED_CAPABILITY_PAYLOAD_PATHS < <(
    echo "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
      | jq -r '.[]'
  )
}

prepare_isolated_substrate_workspace() {

  AEGIS_SUBSTRATE_WORKSPACE="$(mktemp -d)"

  [[ -d "${AEGIS_SUBSTRATE_WORKSPACE}" ]] \
    || raw_fatal "failed_to_prepare_isolated_substrate_workspace"

  cd "${AEGIS_SUBSTRATE_WORKSPACE}"
}

# =========================================================
# VALIDATION
# =========================================================

validate_raw_substrate_inputs() {

  [[ -n "${MODEL}" ]] \
    || raw_fatal "missing_model"

  SKILL_FILE="$(
    resolve_absolute_input_path "${SKILL_FILE_INPUT}"
  )"

  CAPABILITY_PAYLOAD_DIR="$(
    resolve_absolute_input_path "${CAPABILITY_PAYLOAD_DIR_INPUT}"
  )"

  [[ -f "${SKILL_FILE}" ]] \
    || raw_fatal "missing_skill_file"

  [[ -n "${CAPABILITY_MANIFEST}" ]] \
    || raw_fatal "missing_capability_manifest"

  printf '%s\n' "${CAPABILITY_MANIFEST}" \
    | jq empty \
      >/dev/null 2>&1 \
    || raw_fatal "invalid_capability_manifest_json"

  printf '%s\n' "${CAPABILITY_MANIFEST}" \
    | jq -e --arg mode "${AEGIS_MODE}" '.mode == $mode' \
      >/dev/null 2>&1 \
    || raw_fatal "manifest_mode_mismatch"

  printf '%s\n' "${CAPABILITY_MANIFEST}" \
    | jq -e '.execution_engine == "raw"' \
      >/dev/null 2>&1 \
    || raw_fatal "manifest_not_readonly_engine"

  printf '%s\n' "${CAPABILITY_MANIFEST}" \
    | jq -e '(.capabilities | type == "array") and ([.capabilities[]?.classification == "readonly"] | all)' \
      >/dev/null 2>&1 \
    || raw_fatal "manifest_contains_non_readonly_capabilities"

  [[ -d "${CAPABILITY_PAYLOAD_DIR}" ]] \
    || raw_fatal "missing_capability_payload_directory"

  [[ -n "${OPENAI_API_KEY:-}" ]] \
    || raw_fatal "missing_provider_api_key"

  [[ -n "${OPENAI_API_BASE:-}" ]] \
    || raw_fatal "missing_provider_api_base"

  [[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
    || raw_fatal "missing_execution_id"

  [[ -n "${AEGIS_EXECUTION_TIMESTAMP:-}" ]] \
    || raw_fatal "missing_execution_timestamp"

  [[ -n "${AEGIS_MODE:-}" ]] \
    || raw_fatal "missing_execution_mode"

  [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    || raw_fatal "missing_investigation_input"

  [[ -n "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES:-}" ]] \
    || raw_fatal "missing_evidence_budget"

  [[ -n "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-}" ]] \
    || raw_fatal "missing_capability_payload_budget"

  [[ -n "${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-}" ]] \
    || raw_fatal "missing_response_timeout"

  [[ -n "${AEGIS_PROVIDER_CONNECT_TIMEOUT:-}" ]] \
    || raw_fatal "missing_connect_timeout"

  [[ -n "${AEGIS_PROVIDER_MAX_RETRIES:-}" ]] \
    || raw_fatal "missing_retry_configuration"

  [[ -n "${AEGIS_PROVIDER_RETRY_DELAY:-}" ]] \
    || raw_fatal "missing_retry_delay"

  [[ -n "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" ]] \
    || raw_fatal "missing_selected_capability_payloads"

  echo "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
    | jq -e 'type == "array"' \
      >/dev/null 2>&1 \
    || raw_fatal "invalid_selected_capability_payloads"

  mapfile -t SELECTED_CAPABILITY_PAYLOAD_PATHS < <(
    echo "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
      | jq -r '.[]'
  )

  [[ "${#SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}" -gt 0 ]] \
    || raw_fatal "empty_selected_capability_payloads"

  normalize_selected_payload_paths
}

# =========================================================
# TEMP FILES
# =========================================================

TMP_SYSTEM_PROMPT_FILE="$(
  mktemp
)"

TMP_MANIFEST_RAW_FILE="$(
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
    "${TMP_MANIFEST_RAW_FILE}" \
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
trap 'raw_warn "Interrupted"; exit 130' INT TERM

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

  # The structural.builder payload contains a node_index (reverse lookup
  # table, file -> topology facts) that is consumed by Forensics via the
  # epistemic handover — NOT by the Discovery LLM. It grows linearly with
  # node count and can dominate the payload (30KB+ for ~80 nodes), pushing
  # it past the per-payload byte limit and causing truncation that breaks
  # the JSON. Strip it from the LLM evidence copy; the full payload on disk
  # (with node_index intact) is still read by promote_epistemic_handover.
  if [[ "${payload_name}" == "structural_builder.json" ]]; then
    local stripped_file
    stripped_file="$(mktemp)"
    if jq -c '.payload = { topology_summary: .payload.topology_summary, suggested_evidence_priorities: .payload.suggested_evidence_priorities, ranked_targets: .payload.ranked_targets, observed_request_alignment: .payload.observed_request_alignment, gap_counts: .payload.gap_counts }' \
        "${compact_file}" > "${stripped_file}" 2>/dev/null; then
      mv "${stripped_file}" "${compact_file}"
    else
      rm -f "${stripped_file}" >/dev/null 2>&1 || true
    fi
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
  } > "${section_file}"

  rm -f "${compact_file}" >/dev/null 2>&1 || true
}

# =========================================================
# PROMPT ASSEMBLY
# =========================================================

assemble_system_prompt() {

  local mode_specific_instructions=""
  if [[ "${AEGIS_MODE}" == "forensics" ]]; then
    mode_specific_instructions="CRITICAL FORENSICS CONTRACT REQUIREMENT: When status is 'interpreted', the array 'handover_attention.next_attention_targets' MUST be exactly identical (both in order and elements) to the list of 'id' values extracted from the 'repair_candidates' array. Do not add any target to next_attention_targets unless it is also listed in repair_candidates, and vice versa. When status is 'inconclusive', 'repair_candidates' MUST be empty ([]), but 'handover_attention.next_attention_targets' may contain target files that require further investigation/evidence collection to resolve the gap. Furthermore, repair candidate 'id's MUST ONLY be files that are part of the active topology (i.e. bridges, boundaries, hotspots, entrypoints, or surface cluster members). Do NOT propose structurally isolated files (with zero relationships/total_degree=0) as repair candidates under any circumstances. Populate the following fields at the top level of the forensics artifact: Additionally, Forensics must only interpret the evidence that Discovery provides and must not read any additional source files.
- 'investigation_hypotheses': qualitative hypotheses about structural/dependency patterns or failure causes.
- 'investigation_risks': qualitative risks in the current topology/scope (e.g. untested boundaries, hidden coupling, single points of failure)."
  elif [[ "${AEGIS_MODE}" == "discovery" ]]; then
    mode_specific_instructions="CRITICAL DISCOVERY CONTEXT CONSTRAINTS: You must stop describing or narrating the topology structure verbatim (never repeat counts, metrics, or raw facts such as node/edge/bridge/boundary counts). Instead, you must exclusively produce operational context: priorities, gaps, next steps, and investigative strategy (what to do with what exists, not what exists). Populate the following fields inside 'operational_context':
- 'evidence_priorities': COPY suggested_evidence_priorities from the structural_builder payload VERBATIM. Do NOT generate this list — it is deterministically pre-computed by the runtime from ranked_targets.
- 'confidence_drivers': factors driving structural/operational confidence (e.g. 'Bridge observed mechanically').

FUNDAMENTAL RULE: The subject of every operational_observations entry is the INVESTIGATION, not the system under investigation. Ask yourself: am I describing what the investigation must do, or am I describing what the system does? Only the former is permitted.

HARD PROHIBITIONS for Discovery operational_observations and rationale:
- Do NOT assign architectural role labels to nodes: words like 'orchestrator', 'controller', 'gateway', 'facade', 'central hub' are FORBIDDEN. Reference the mechanical topology role instead (e.g. 'entrypoint node', 'boundary node', 'hotspot').
- Do NOT name or infer semantic domains from file content or module names: phrases like 'authentication domain', 'billing service', 'payment module', 'between auth and billing', 'service domains' are FORBIDDEN. You have not read file content — reference the mechanical responsibility classification from node_index instead (e.g. 'two boundary nodes with responsibility:service').
- Do NOT assess risk: phrases like 'integration risk', 'coupling risk', 'failure risk' are FORBIDDEN. Risk assessment belongs to Forensics (investigation_risks field). Discovery may note structural gaps without naming risk.
- Do NOT infer module function from topology position: phrases like 'it mediates connectivity', 'it orchestrates requests', 'it likely validates', 'dependency mediation role', 'validates bridge semantics', 'operational flow' are FORBIDDEN. Topology reveals structure, not function. Function requires reading file content — that is Forensics. State topological facts only: 'entrypoint node connects to two boundary nodes via bridge_001 and bridge_002'.
- Do NOT describe what the SYSTEM does: the subject of operational_observations is always the investigation. WRONG: 'The entrypoint mediates connectivity between boundary nodes.' RIGHT: 'Evidence collection at the entrypoint node is required before forensics can interpret boundary relationships.'"
  fi

  cat > "${TMP_SYSTEM_PROMPT_FILE}" <<EOF
You are executing inside Aegis Harness.

Mode:
${AEGIS_MODE}

Execution model:
- protocol oriented
- bounded cognition
- capability exposure
- runtime governed
- evidence bounded
- selective capability payload exposure only

The runtime provides one operator-defined investigation input.

You must treat that investigation input as the current investigation demand without distinguishing whether it originated from an issue or an informal prompt.

${mode_specific_instructions}

You must:
- consume only runtime-selected evidence
- avoid assumptions
- avoid hidden repository inheritance
- avoid architecture redesign
- emit only JSON
- remain bounded

You must emit the output in this exact format:

${AEGIS_ARTIFACT_BEGIN_MARKER}
{
  "mode": "${AEGIS_MODE}",
  ...
}
${AEGIS_ARTIFACT_END_MARKER}

The payload MUST:
- be a valid JSON object ONLY.
- contain no HTML tags, no XML tags, no markdown block wrappers (do NOT wrap the JSON in triple-backtick code blocks, do NOT use "json" or "<json>" tag wrappers).
- contain no prose, no conversational explanations, no markdown notes.
- have the opening brace '{' of the JSON object immediately on the line after ${AEGIS_ARTIFACT_BEGIN_MARKER}.
- have the closing brace '}' of the JSON object immediately on the line before ${AEGIS_ARTIFACT_END_MARKER}.

Execution identity:
${AEGIS_EXECUTION_ID}

Execution timestamp:
${AEGIS_EXECUTION_TIMESTAMP}

Investigation input:
${AEGIS_INVESTIGATION_INPUT}
EOF
}

# =========================================================
# MANIFEST BOUNDING
# =========================================================

assemble_bounded_manifest() {

  printf '%s\n' \
    "${CAPABILITY_MANIFEST}" \
    > "${TMP_MANIFEST_RAW_FILE}"

  jq -c \
    '{
      schema_version: .schema_version,
      runtime_model: .runtime_model,
      generated_at: .generated_at,
      execution_id: .execution_id,
      manifest_hash: .manifest_hash,
      mode: .mode,
      execution_engine: .execution_engine,
      capability_envelope: .capability_envelope,
      evidence_profile: .evidence_profile,
      evidence_capabilities: .evidence_capabilities,
      capabilities: .capabilities
    }' \
    "${TMP_MANIFEST_RAW_FILE}" \
    > "${TMP_MANIFEST_FILE}"

  truncate_file_bytes \
    "${TMP_MANIFEST_FILE}" \
    "${AEGIS_CAPABILITY_MANIFEST_MAX_BYTES}" \
    "${TMP_MANIFEST_FILE}.bounded"

  mv "${TMP_MANIFEST_FILE}.bounded" "${TMP_MANIFEST_FILE}"
}

# =========================================================
# SELECTIVE CAPABILITY PAYLOAD EXPOSURE
# =========================================================

assemble_bounded_capability_context() {

  {
    echo "=== INVESTIGATION INPUT ==="
    echo
    printf '%s\n' "${AEGIS_INVESTIGATION_INPUT}"

    echo
    echo "=== SKILL CONTRACT ==="
    echo
    cat "${SKILL_FILE}"

    echo
    echo "=== SELECTED CAPABILITY MANIFEST ==="
    echo
    cat "${TMP_MANIFEST_FILE}"

    echo
    echo "=== EXPOSED CAPABILITY PAYLOADS ==="
    echo
    printf 'Exposed capability payload count: %s\n' "${#SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"
    echo
  } > "${TMP_CAPABILITY_CONTEXT_FILE}"

  local payload_count=0
  local payload_path
  local section_file
  local total_bytes

  for payload_path in "${SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"; do

    [[ -f "${payload_path}" ]] \
      || raw_fatal "missing_exposed_capability_payload: ${payload_path}"

    [[ "${payload_path}" == "${CAPABILITY_PAYLOAD_DIR}/"* ]] \
      || raw_fatal "exposed_capability_payload_out_of_scope: ${payload_path}"

    payload_count=$((payload_count + 1))

    if [[ "${payload_count}" -gt "${AEGIS_EVIDENCE_MAX_FILES}" ]]; then
      {
        echo
        echo "[AEGIS][CAPABILITY_PAYLOAD_LIMIT_REACHED]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi

    section_file="$(
      mktemp
    )"

    render_bounded_payload_section \
      "${payload_path}" \
      "${section_file}"

    cat "${section_file}" >> "${TMP_CAPABILITY_CONTEXT_FILE}"
    echo >> "${TMP_CAPABILITY_CONTEXT_FILE}"

    rm -f "${section_file}" >/dev/null 2>&1 || true

    total_bytes="$(
      wc -c < "${TMP_CAPABILITY_CONTEXT_FILE}"
    )"

    # Per-mode evidence budget — constitutional guard against prompt explosion.
    # Falls back to AEGIS_EVIDENCE_MAX_TOTAL_BYTES if no mode-specific budget.
    case "${AEGIS_MODE}" in
      discovery)  mode_budget="${AEGIS_MAX_DISCOVERY_BYTES:-${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}}" ;;
      forensics)  mode_budget="${AEGIS_MAX_FORENSICS_BYTES:-${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}}" ;;
      *)          mode_budget="${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" ;;
    esac

    if [[ "${total_bytes}" -ge "${mode_budget}" ]]; then
      {
        echo
        echo "[AEGIS][MODE_EVIDENCE_BUDGET_REACHED:${AEGIS_MODE}:${mode_budget}]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi

    if [[ "${total_bytes}" -ge "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" ]]; then
      {
        echo
        echo "[AEGIS][TOTAL_EVIDENCE_BUDGET_REACHED]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi
  done

  raw_log "Capability payload evidence size bytes: $(wc -c < "${TMP_CAPABILITY_CONTEXT_FILE}")"
}

# =========================================================
# REQUEST ASSEMBLY
# =========================================================

assemble_provider_request() {

  jq -n \
    --arg model "${MODEL}" \
    --rawfile system_prompt "${TMP_SYSTEM_PROMPT_FILE}" \
    --rawfile capability_context "${TMP_CAPABILITY_CONTEXT_FILE}" \
    --argjson temperature "${AEGIS_RAW_SUBSTRATE_TEMPERATURE}" \
    '
    {
      model: $model,
      temperature: $temperature,
      messages: [
        {
          role: "system",
          content: $system_prompt
        },
        {
          role: "user",
          content: $capability_context
        }
      ]
    }
    ' > "${TMP_REQUEST_FILE}"

  raw_log "Request size bytes: $(wc -c < "${TMP_REQUEST_FILE}")"
}

# =========================================================
# PROVIDER EXECUTION
# =========================================================

execute_provider_request() {

  raw_log "Executing raw cognition substrate..."

  local attempt=1
  local http_code
  local error_message
  local curl_stats
  local t_connect
  local t_starttransfer
  local t_total

  while [[ "${attempt}" -le "${AEGIS_PROVIDER_MAX_RETRIES}" ]]; do

    curl_stats="$(
      curl \
        --silent \
        --show-error \
        --connect-timeout "${AEGIS_PROVIDER_CONNECT_TIMEOUT}" \
        --max-time "${AEGIS_PROVIDER_RESPONSE_TIMEOUT}" \
        --output "${TMP_RESPONSE_FILE}" \
        --write-out "%{http_code} %{time_connect} %{time_starttransfer} %{time_total}" \
        -X POST \
        "${OPENAI_API_BASE}/chat/completions" \
        -H "Authorization: Bearer ${OPENAI_API_KEY}" \
        -H "Content-Type: application/json" \
        --data @"${TMP_REQUEST_FILE}"
    )"

    read -r http_code t_connect t_starttransfer t_total <<< "${curl_stats}"

    t_connect="${t_connect:-0.000000}"
    t_starttransfer="${t_starttransfer:-0.000000}"
    t_total="${t_total:-0.000000}"

    case "${http_code}" in

      200)
        echo "[AEGIS][TIMING] curl_connect: ${t_connect}s" >&2
        echo "[AEGIS][TIMING] first_token: ${t_starttransfer}s" >&2
        echo "[AEGIS][TIMING] response_complete: ${t_total}s" >&2
        return 0
        ;;

      401|403)
        cat "${TMP_RESPONSE_FILE}" >&2 || true
        raw_fatal "provider_authentication_failure"
        ;;

      400)
        error_message="$(
          jq -r '.error.message // empty' "${TMP_RESPONSE_FILE}" 2>/dev/null || true
        )"

        if [[ "${error_message}" == *"maximum context length"* ]]; then
          cat "${TMP_RESPONSE_FILE}" >&2 || true
          raw_fatal "provider_context_length_exceeded"
        fi

        cat "${TMP_RESPONSE_FILE}" >&2 || true
        raw_fatal "provider_http_failure"
        ;;

      429|500|502|503|504)
        raw_warn "provider_transient_failure"

        attempt=$((attempt + 1))

        sleep "${AEGIS_PROVIDER_RETRY_DELAY}"
        ;;

      *)
        cat "${TMP_RESPONSE_FILE}" >&2 || true
        raw_fatal "provider_http_failure"
        ;;

    esac
  done

  raw_fatal "provider_retry_limit_exceeded"
}

# =========================================================
# RESPONSE EXTRACTION
# =========================================================

extract_provider_content() {

  jq -r '
    .choices[0].message.content // empty
  ' "${TMP_RESPONSE_FILE}"
}

# =========================================================
# ARTIFACT EXTRACTION
# =========================================================

extract_artifact_payload() {

  local provider_content
  provider_content="$(
    extract_provider_content
  )"

  [[ -n "${provider_content}" ]] \
    || raw_fatal "empty_provider_response"

  # Debug: Always save the raw response content to /tmp/raw_response.json for diagnostics
  echo "${provider_content}" > /tmp/raw_response.json

  local artifact
  artifact="$(
    echo "${provider_content}" \
      | sed -n \
          "/${AEGIS_ARTIFACT_BEGIN_MARKER}/,/${AEGIS_ARTIFACT_END_MARKER}/p"
  )"

  [[ -n "${artifact}" ]] \
    || {
      echo "[DEBUG] Raw LLM content (markers missing):" >&2
      echo "${provider_content}" >&2
      raw_fatal "missing_artifact_markers"
    }

  local artifact_payload
  artifact_payload="$(
    echo "${artifact}" \
      | sed '1d;$d'
  )"

  [[ -n "${artifact_payload}" ]] \
    || raw_fatal "empty_artifact_payload"

  if ! echo "${artifact_payload}" | jq empty >/dev/null 2>&1; then
    echo "[DEBUG] Failed to parse artifact JSON. Raw payload:" >&2
    echo "${artifact_payload}" >&2
    raw_fatal "artifact_not_json"
  fi

  echo "${AEGIS_ARTIFACT_BEGIN_MARKER}"
  echo "${artifact_payload}"
  echo "${AEGIS_ARTIFACT_END_MARKER}"
}

# =========================================================
# MAIN
# =========================================================

main() {

  validate_raw_substrate_inputs
  prepare_isolated_substrate_workspace

  local start_assembly
  start_assembly=$(date +%s)
  assemble_system_prompt
  assemble_bounded_manifest
  assemble_bounded_capability_context
  assemble_provider_request
  local end_assembly
  end_assembly=$(date +%s)
  echo "[AEGIS][TIMING] prompt_assembly: $((end_assembly - start_assembly))s" >&2

  execute_provider_request

  local start_extract
  start_extract=$(date +%s)
  extract_artifact_payload
  local end_extract
  end_extract=$(date +%s)
  echo "[AEGIS][TIMING] artifact_extract: $((end_extract - start_extract))s" >&2
}

main "$@"