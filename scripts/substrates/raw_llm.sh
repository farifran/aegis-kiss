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

if [[ -f ".harness/local.env" ]] && [[ "${OPENAI_API_KEY:-}" != *test-key* ]]; then
    source ".harness/local.env"
fi

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

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
AEGIS_LOG_TAG="RAW"

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

  if [[ "${payload_name}" == *"epistemic_handover.json" ]]; then
    local stripped_file
    stripped_file="$(mktemp)"
    if jq -c '
        if (.payload.content | type == "string") then
          .payload.content |= (fromjson | del(.artifact_snapshot.structural_context))
        else
          .payload.content.artifact_snapshot |= del(.structural_context)
        end' "${compact_file}" > "${stripped_file}" 2>/dev/null; then
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
  } >> "${section_file}"

  rm -f "${compact_file}" >/dev/null 2>&1 || true
}

# =========================================================
# PROMPT ASSEMBLY
# =========================================================

assemble_system_prompt() {

  local mode_specific_instructions=""
  if [[ "${AEGIS_MODE}" == "forensics" ]]; then
    mode_specific_instructions="MINIMAL FORENSICS ARTIFACT: emit ONLY {\"status\": \"interpreted|inconclusive\", \"repair_candidates\": [{\"id\": \"<file>\", \"reason\": \"<3-6 words>\"}]}. When status is 'inconclusive', repair_candidates MUST be []. When status is 'interpreted', propose exactly ONE candidate whose 'id' is a file present in the active topology (bridges, boundaries, hotspots, entrypoints, or surface members) — never a structurally isolated file — UNLESS the investigation input explicitly demands creation of a net-new file, in which case 'id' MUST be that exact requested path even though it exists in no topology or payload. Interpret only the evidence Discovery provided. The runtime injects mode, evidence identity, and attention routing — do NOT emit them."
  elif [[ "${AEGIS_MODE}" == "discovery" ]]; then
    mode_specific_instructions="MINIMAL DISCOVERY ARTIFACT: emit ONLY {\"observations\": [\"...\"], \"rationale\": \"...\", \"required_evidence\": [\"filesystem.read:<file>\"]}. The subject of every observation is the INVESTIGATION (gaps, priorities, next evidence), never the system under investigation: no counts/metrics repetition, no architectural role labels (orchestrator/controller/gateway), no semantic domain inference, no risk assessment, no inferring module function from topology position. The runtime injects mode, scope, attention, priorities, and evidence identity — do NOT emit them."
  fi

  # Byte 0 of the stream is the constitutional preamble — static and
  # clean so any serving-side prefix cache (including the hosted
  # provider's automatic layer) reuses the stable prompt head.
  cat > "${TMP_SYSTEM_PROMPT_FILE}" <<EOF
${AEGIS_CONSTITUTIONAL_PREAMBLE:+${AEGIS_CONSTITUTIONAL_PREAMBLE}

}You are executing inside Aegis Harness.

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

Skill contract:

$(cat "${SKILL_FILE}")

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

The investigation input is provided under the "=== INVESTIGATION INPUT ===" header of the user message. Execution identity is provided under the "=== EXECUTION IDENTITY ===" header of the user message.
EOF
}

# =========================================================
# MANIFEST BOUNDING
# =========================================================

assemble_bounded_manifest() {

  # Stable projection: deterministic per (mode, configuration). Emitted
  # high in the prompt so it participates in the KV-cache prefix.
  printf '%s\n' "${CAPABILITY_MANIFEST}" \
    | jq -c \
    '{
      schema_version: .schema_version,
      runtime_model: .runtime_model,
      mode: .mode,
      execution_engine: .execution_engine,
      capability_envelope: .capability_envelope,
      evidence_profile: .evidence_profile,
      evidence_capabilities: .evidence_capabilities,
      capabilities: .capabilities
    }' \
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

  # Monotonic token-stacking: segments ordered by decreasing half-life so
  # the KV-cache prefix survives across executions. Stable segments
  # (pocket map, stable manifest) at the head; volatile segments
  # (investigation input, volatile manifest, execution identity) at the
  # tail, appended after the payload loop. The skill contract lives in
  # the system prompt (assemble_system_prompt).
  {
    if [[ -n "${AEGIS_POCKET_MAP_FILE:-}" ]] && [[ -s "${AEGIS_POCKET_MAP_FILE}" ]]; then
      echo "=== REPOSITORY POCKET MAP (flat path census — baseline context) ==="
      echo
      cat "${AEGIS_POCKET_MAP_FILE}"
      echo
    fi

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
  local total_bytes

  for payload_path in "${SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"; do

    [[ -f "${payload_path}" ]] \
      || aegis_fatal "missing_exposed_capability_payload: ${payload_path}"

    [[ "${payload_path}" == "${CAPABILITY_PAYLOAD_DIR}/"* ]] \
      || aegis_fatal "exposed_capability_payload_out_of_scope: ${payload_path}"

    payload_count=$((payload_count + 1))

    if [[ "${payload_count}" -gt "${AEGIS_EVIDENCE_MAX_FILES}" ]]; then
      {
        echo
        echo "[AEGIS][CAPABILITY_PAYLOAD_LIMIT_REACHED]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi

    render_bounded_payload_section \
      "${payload_path}" \
      "${TMP_CAPABILITY_CONTEXT_FILE}"

    echo >> "${TMP_CAPABILITY_CONTEXT_FILE}"

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

  # Volatile tail: everything below this line changes per run/request and
  # must never precede the stable segments above.
  {
    echo
    echo "=== INVESTIGATION INPUT ==="
    echo
    printf '%s\n' "${AEGIS_INVESTIGATION_INPUT}"

    echo
    echo "=== MANIFEST EXECUTION METADATA ==="
    echo
    # Volatile identity wrappers projected inline at the tail — no temp
    # file: the stable manifest above is the only bounded artifact.
    printf '%s\n' "${CAPABILITY_MANIFEST}" \
      | jq -c '{generated_at, execution_id, manifest_hash}'

    echo
    echo "=== EXECUTION IDENTITY ==="
    echo
    printf 'Execution identity:\n%s\n' "${AEGIS_EXECUTION_ID}"
    echo
    printf 'Execution timestamp:\n%s\n' "${AEGIS_EXECUTION_TIMESTAMP}"
  } >> "${TMP_CAPABILITY_CONTEXT_FILE}"

  aegis_log "Capability payload evidence size bytes: $(wc -c < "${TMP_CAPABILITY_CONTEXT_FILE}")"
}

# =========================================================
# REQUEST ASSEMBLY
# =========================================================

assemble_provider_request() {

  # AEGIS_RAW_SUBSTRATE_MAX_TOKENS controls the output budget.
  # Default: 4096 — enough for any structured JSON artifact without truncation.
  : "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS:=4096}"

  # Adversarial emits short structural findings vectors only — cap its
  # decode budget hard so judgment latency stays bounded and prose leakage
  # is physically impossible past the cap.
  local effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS}"
  if [[ "${AEGIS_MODE}" == "adversarial" ]]; then
    effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL:-1024}"
  fi

  jq -n \
    --arg model "${MODEL}" \
    --rawfile system_prompt "${TMP_SYSTEM_PROMPT_FILE}" \
    --rawfile capability_context "${TMP_CAPABILITY_CONTEXT_FILE}" \
    --argjson temperature "${AEGIS_RAW_SUBSTRATE_TEMPERATURE}" \
    --argjson max_tokens "${effective_max_tokens}" \
    '
    {
      model: $model,
      temperature: $temperature,
      max_tokens: $max_tokens,
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

  aegis_log "Request size bytes: $(wc -c < "${TMP_REQUEST_FILE}")"
}

# =========================================================
# PROVIDER EXECUTION
# =========================================================

execute_provider_request() {

  aegis_log "Executing raw cognition substrate..."

  local attempt=1
  local http_code
  local error_message
  local curl_stats
  local t_connect
  local t_starttransfer
  local t_total

  # Empty-body retry state: long non-streaming generations (>70s) can be
  # dropped or truncated by upstream gateways/proxies, yielding HTTP 200
  # with an empty payload. That volatility is transient infrastructure
  # noise, not a protocol failure — re-fire the exact same request up to
  # 3 attempts with progressive backoff before the terminal
  # empty_provider_response fatal is allowed to fire downstream.
  local empty_response_attempt=1
  local empty_response_max_attempts=3
  local empty_response_backoff

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
        # Non-streaming request: the provider sends the body only after
        # generation finishes, so time_starttransfer ≈ time_total. This is
        # server-side prefill + FULL decode, not true time-to-first-token.
        echo "[AEGIS][TIMING] curl_connect: ${t_connect}s" >&2
        echo "[AEGIS][TIMING] provider_generation (prefill+decode, non-streaming): ${t_starttransfer}s" >&2
        echo "[AEGIS][TIMING] response_complete: ${t_total}s" >&2

        # Empty/whitespace-only body on HTTP 200: transient gateway drop.
        # Re-fire the identical request payload with progressive backoff;
        # after the final attempt, fall through so the deterministic
        # empty_provider_response fatal fires in extract_artifact_payload.
        if [[ -z "$(extract_provider_content | tr -d '[:space:]')" ]]; then
          if [[ "${empty_response_attempt}" -lt "${empty_response_max_attempts}" ]]; then
            if [[ "${empty_response_attempt}" -eq 1 ]]; then
              empty_response_backoff=2
            else
              empty_response_backoff=5
            fi
            echo "[AEGIS][RAW][WARN] Empty provider response detected on attempt ${empty_response_attempt}/${empty_response_max_attempts} — retrying in ${empty_response_backoff}s..." >&2
            empty_response_attempt=$((empty_response_attempt + 1))
            sleep "${empty_response_backoff}"
            continue
          fi
          echo "[AEGIS][RAW][WARN] Empty provider response persisted after ${empty_response_max_attempts}/${empty_response_max_attempts} attempts — surfacing terminal failure" >&2
        fi

        return 0
        ;;

      401|403)
        cat "${TMP_RESPONSE_FILE}" >&2 || true
        aegis_fatal "provider_authentication_failure"
        ;;

      400)
        error_message="$(
          jq -r '.error.message // empty' "${TMP_RESPONSE_FILE}" 2>/dev/null || true
        )"

        if [[ "${error_message}" == *"maximum context length"* ]]; then
          cat "${TMP_RESPONSE_FILE}" >&2 || true
          aegis_fatal "provider_context_length_exceeded"
        fi

        cat "${TMP_RESPONSE_FILE}" >&2 || true
        aegis_fatal "provider_http_failure"
        ;;

      429|500|502|503|504)
        aegis_warn "provider_transient_failure"

        attempt=$((attempt + 1))

        sleep "${AEGIS_PROVIDER_RETRY_DELAY}"
        ;;

      *)
        cat "${TMP_RESPONSE_FILE}" >&2 || true
        aegis_fatal "provider_http_failure"
        ;;

    esac
  done

  aegis_fatal "provider_retry_limit_exceeded"
}

# =========================================================
# RESPONSE EXTRACTION
# =========================================================

extract_provider_content() {

  # Prefer message.content. Reasoning-class models on NVIDIA NIM (e.g.
  # stepfun-ai/step-3.7-flash) can exhaust max_tokens in reasoning_content
  # and return an empty content field on large prompts — fall back so the
  # substrate can still extract an artifact when the provider split output.
  jq -r '
    .choices[0].message as $m
    | (
        ($m.content // "")
        | if length > 0 then .
          else ($m.reasoning_content // $m.reasoning // "")
          end
      )
  ' "${TMP_RESPONSE_FILE}"
}

# =========================================================
# ARTIFACT EXTRACTION
# =========================================================

# Probabilistic models decorate the protocol markers with markdown despite
# instructions: '### AEGIS ARTIFACT BEGIN', '`AEGIS_ARTIFACT_END`', fenced
# code blocks around the JSON. Normalize any line that is a decorated
# variant of a marker (leading hashes/backticks/whitespace, '_' rendered as
# space, trailing decoration) back to the literal marker token so the
# deterministic extraction below never dies on cosmetic noise.
normalize_decorated_markers() {

  local begin_rx end_rx
  # '_' in the canonical marker may be rendered as space or hyphen.
  begin_rx="$(printf '%s' "${AEGIS_ARTIFACT_BEGIN_MARKER}" | sed 's/_/[_ -]/g')"
  end_rx="$(printf '%s' "${AEGIS_ARTIFACT_END_MARKER}" | sed 's/_/[_ -]/g')"

  sed -E \
    -e "s/^[[:space:]#\`*]*${begin_rx}[[:space:]#\`*]*\$/${AEGIS_ARTIFACT_BEGIN_MARKER}/" \
    -e "s/^[[:space:]#\`*]*${end_rx}[[:space:]#\`*]*\$/${AEGIS_ARTIFACT_END_MARKER}/"
}

extract_artifact_payload() {

  local provider_content
  provider_content="$(
    extract_provider_content | normalize_decorated_markers
  )"

  [[ -n "${provider_content}" ]] \
    || aegis_fatal "empty_provider_response"

  if [[ "${provider_content}" != *"${AEGIS_ARTIFACT_BEGIN_MARKER}"* ]] \
    || [[ "${provider_content}" != *"${AEGIS_ARTIFACT_END_MARKER}"* ]]; then
    echo "[DEBUG] Raw LLM content (markers missing):" >&2
    echo "${provider_content}" >&2
    aegis_fatal "missing_artifact_markers"
  fi

  local artifact_payload="${provider_content#*"${AEGIS_ARTIFACT_BEGIN_MARKER}"}"
  artifact_payload="${artifact_payload%%"${AEGIS_ARTIFACT_END_MARKER}"*}"

  # Strip stray markdown code-fence lines the model may have wrapped the
  # JSON body in (``` / ```json), which would break jq parsing.
  artifact_payload="$(
    printf '%s\n' "${artifact_payload}" \
      | sed -E '/^[[:space:]]*`{3,}[a-zA-Z]*[[:space:]]*$/d'
  )"

  [[ -n "${artifact_payload//[[:space:]]/}" ]] \
    || aegis_fatal "empty_artifact_payload"

  if ! echo "${artifact_payload}" | jq empty >/dev/null 2>&1; then
    # Try a Python-based JSON repair for two classes of LLM slip:
    #   1. Missing closing quote on property keys.
    #   2. Truncated JSON (model stopped before closing all arrays/objects).
    local repaired_payload
    repaired_payload="$(python3 - <<'PY' "${artifact_payload}"
import sys
import json
import re

raw = sys.argv[1]
# Fix common LLM syntax slip: "property: "value" (missing closing quote on key)
fixed = re.sub(r'\"([a-zA-Z0-9_]+)(?<!\"):\s*\"', r'"\1": "', raw)
# Fix missing quote on property keys like "scope_confidence: "low"
fixed = re.sub(r'\"([a-zA-Z0-9_]+)\s*:\s*\"', r'"\1": "', fixed)

try:
    parsed = json.loads(fixed)
    print(json.dumps(parsed))
    sys.exit(0)
except Exception:
    pass

# Attempt to close a truncated JSON object by appending missing brackets.
# Count unmatched open brackets (arrays and objects) and close them.
stack = []
in_str = False
escape_next = False
for ch in fixed:
    if escape_next:
        escape_next = False
        continue
    if ch == '\\':
        escape_next = True
        continue
    if ch == '"':
        in_str = not in_str
        continue
    if in_str:
        continue
    if ch in ('{', '['):
        stack.append(ch)
    elif ch == '}':
        if stack and stack[-1] == '{':
            stack.pop()
    elif ch == ']':
        if stack and stack[-1] == '[':
            stack.pop()

closers = {'[': ']', '{': '}'}
truncation_suffix = ''.join(closers[c] for c in reversed(stack))
if truncation_suffix:
    candidate = fixed.rstrip().rstrip(',') + '\n' + truncation_suffix
    try:
        parsed = json.loads(candidate)
        print(json.dumps(parsed))
        sys.exit(0)
    except Exception:
        pass

# Give up — return raw so jq check triggers the fatal error
print(raw)
PY
)"
    if echo "${repaired_payload}" | jq empty >/dev/null 2>&1; then
      artifact_payload="${repaired_payload}"
    else
      echo "[DEBUG] Failed to parse artifact JSON. Raw payload:" >&2
      echo "${artifact_payload}" >&2
      aegis_fatal "artifact_not_json"
    fi
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