#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EXECUTION PROTOCOL VM
# =========================================================
#
# Version: 2.9
# Layer: Protocol VM
# Status: Evidence Transition Hardened
#
# Responsibilities:
#
# - capability envelope resolution
# - capability environment materialization
# - capability payload persistence
# - runtime-owned capability manifest consumption
# - evidence profile resolution
# - selective evidence payload selection
# - selected manifest materialization
# - capability invocation contracts
# - capability evidence generation
# - substrate invocation
# - protocol validation
# - candidate artifact validation
#
# The executor intentionally owns:
#
# - capability routing
# - payload persistence
# - evidence selection
# - runtime-owned capability manifest validation
# - selected manifest generation
# - capability invocation
# - protocol enforcement
# - capability evidence lifecycle
# - candidate artifact validation
#
# The executor intentionally does NOT:
#
# - own orchestration
# - own runtime lifecycle
# - own persistence decisions
# - own capability manifest generation
# - reason semantically
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# ROOT RESOLUTION
# =========================================================

readonly AEGIS_EXECUTOR_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"

cd "${AEGIS_EXECUTOR_ROOT}"

# =========================================================
# CONFIGURATION
# =========================================================

if [[ -f ".harness/local.env" ]] && [[ "${OPENAI_API_KEY:-}" != *test-key* ]]; then
    source ".harness/local.env"
fi

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][EXECUTOR][FATAL] missing_config" >&2
  exit 1
}

source ".harness/config.sh"

# =========================================================
# INPUTS
# =========================================================

readonly AEGIS_SKILL_FILE="${1:-}"
readonly AEGIS_MODE="${2:-}"
readonly AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${3:-}"

# =========================================================
# LOGGING
# =========================================================

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
AEGIS_LOG_TAG="EXECUTOR"


# =========================================================
# CLEANUP
# =========================================================

cleanup_executor() {

  set +e

  aegis_log "Starting executor cleanup..."

  #
  # Runtime remains sovereign over:
  #
  # - execution surfaces
  # - payload retention
  # - capability environment retention
  # - epistemic handover lifecycle
  #
  # Executor intentionally does NOT remove runtime-owned state.
  #

  aegis_log "Executor cleanup completed"

  set -e
}

trap cleanup_executor EXIT
trap 'aegis_warn "Interrupted"; exit 130' INT TERM

# =========================================================
# VALIDATION
# =========================================================

validate_executor_inputs() {

  [[ -n "${AEGIS_EXECUTION_SURFACE_PATH:-}" ]] \
    || aegis_fatal "missing_execution_surface_path"

  [[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
    || aegis_fatal "missing_execution_id"

  [[ -n "${AEGIS_EXECUTION_TIMESTAMP:-}" ]] \
    || aegis_fatal "missing_execution_timestamp"

  [[ -f "${AEGIS_SKILL_FILE}" ]] \
    || aegis_fatal "missing_skill_contract"

  [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" ]] \
    || aegis_fatal "missing_epistemic_handover"

  [[ -n "${AEGIS_CAPABILITY_MANIFEST:-}" ]] \
    || aegis_fatal "missing_runtime_owned_capability_manifest"

  declare -p AEGIS_EXECUTION_ENGINES >/dev/null 2>&1 \
    || aegis_fatal "missing_execution_engine_registry"

  declare -p AEGIS_MODE_CAPABILITY_MAP >/dev/null 2>&1 \
    || aegis_fatal "missing_mode_capability_map"

  declare -p AEGIS_CAPABILITY_HANDLERS >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_handler_registry"

  declare -p AEGIS_CAPABILITY_ARGUMENTS >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_argument_registry"

  declare -p AEGIS_MODE_EVIDENCE_PROFILE >/dev/null 2>&1 \
    || aegis_fatal "missing_evidence_profile_registry"

  [[ -n "${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}" ]] \
    || aegis_fatal "unknown_execution_mode"
}

# =========================================================
# EXECUTION ENGINE
# =========================================================

resolve_execution_engine() {

  export AEGIS_EXECUTION_ENGINE="${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]}"

  [[ -n "${AEGIS_EXECUTION_ENGINE}" ]] \
    || aegis_fatal "missing_execution_engine"

  aegis_log "Execution engine: ${AEGIS_EXECUTION_ENGINE}"
}

# =========================================================
# CAPABILITY ENVELOPE
# =========================================================

resolve_capability_envelope() {

  local envelope_name="${AEGIS_MODE_CAPABILITY_MAP[$AEGIS_MODE]:-}"

  [[ -n "${envelope_name}" ]] \
    || aegis_fatal "missing_capability_envelope"

  declare -n envelope_ref="${envelope_name}"

  [[ "${#envelope_ref[@]}" -gt 0 ]] \
    || aegis_fatal "empty_capability_envelope"

  AEGIS_ACTIVE_CAPABILITIES=("${envelope_ref[@]}")
}

# =========================================================
# EVIDENCE PROFILE
# =========================================================

resolve_evidence_profile() {

  local profile_name="${AEGIS_MODE_EVIDENCE_PROFILE[$AEGIS_MODE]:-}"

  [[ -n "${profile_name}" ]] \
    || aegis_fatal "missing_evidence_profile"

  declare -n evidence_ref="${profile_name}"

  [[ "${#evidence_ref[@]}" -gt 0 ]] \
    || aegis_fatal "empty_evidence_profile"

  AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${evidence_ref[@]}")
}

augment_evidence_profile_from_handover() {

  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
    local req_ev
    req_ev="$(
      jq -r '.artifact_snapshot.operational_context.required_evidence[]? // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null || true
    )"
    while IFS= read -r entry; do
      [[ -z "${entry}" ]] && continue
      local dup="false"
      local active
      for active in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
        if [[ "${active}" == "${entry}" ]]; then
          dup="true"
          break
        fi
      done
      if [[ "${dup}" == "false" ]]; then
        AEGIS_ACTIVE_EVIDENCE_ENTRIES+=("${entry}")
      fi
    done <<< "${req_ev}"
  fi
}

resolve_evidence_entry_capability() {

  local evidence_entry="$1"

  printf '%s' "${evidence_entry%%:*}"
}

resolve_evidence_entry_alias() {

  local evidence_entry="$1"

  if [[ "${evidence_entry}" == *:* ]]; then
    printf '%s' "${evidence_entry#*:}"
    return 0
  fi

  printf '%s' ""
}

resolve_evidence_payload_file() {

  local capability="$1"
  local evidence_alias="${2:-}"
  local payload_key="${capability}"

  if [[ -n "${evidence_alias}" ]]; then
    payload_key+="_${evidence_alias}"
  fi

  payload_key="${payload_key//./_}"
  printf '%s.json' "${payload_key//\//_}"
}

# =========================================================
# EXECUTION STATE
# =========================================================

prepare_execution_state() {

  aegis_log "Using runtime-prepared execution state..."

  if [[ ! -d "${AEGIS_CAPABILITY_ENV_DIR}" ]]; then
    mkdir -p "${AEGIS_CAPABILITY_ENV_DIR}" || aegis_fatal "failed_to_create_capability_environment"
  fi
  if [[ ! -d "${AEGIS_CAPABILITY_PAYLOAD_DIR}" ]]; then
    mkdir -p "${AEGIS_CAPABILITY_PAYLOAD_DIR}" || aegis_fatal "failed_to_create_capability_payload_dir"
  fi
}

# =========================================================
# PAYLOAD VALIDATION
# =========================================================

validate_materialized_payload() {

  local capability="$1"
  local payload_path="$2"
  local expected_classification

  expected_classification="${AEGIS_CAPABILITY_CLASSIFICATION[$capability]:-}"

  [[ -n "${expected_classification}" ]] \
    || aegis_fatal "missing_capability_classification"

  jq -e \
    --arg capability "${capability}" \
    --arg classification "${expected_classification}" \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
    '
      .success == true
      and .error == null
      and .payload != null
      and .capability == $capability
      and .classification == $classification
      and .execution_id == $execution_id
      and (.generated_at | type == "string" and length > 0)
    ' "${payload_path}" >/dev/null 2>&1 \
    || aegis_fatal "invalid_capability_payload_contract: ${capability}"
}

# =========================================================
# ARGUMENT CONTRACTS
# =========================================================

resolve_capability_argument() {

  local capability="$1"
  local evidence_alias="${2:-}"

  case "${capability}" in
    filesystem.read)
      if [[ -n "${evidence_alias}" ]]; then
        declare -p AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS >/dev/null 2>&1 \
          || aegis_fatal "missing_runtime_filesystem_read_target_registry"

        # Case A: Runtime-owned internal target
        if [[ -n "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[$evidence_alias]:-}" ]]; then
          printf '%s' "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[$evidence_alias]}"
          return 0
        fi

        # Case B: Workspace target file - return directly
        printf '%s' "${evidence_alias}"
        return 0
      fi

      printf '%s' "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"
      ;;
    filesystem.list_tree|filesystem.extract_import_graph|filesystem.extract_reference_graph|filesystem.extract_symbols|filesystem.extract_entrypoints|filesystem.extract_test_relationships|filesystem.extract_configuration_structure|filesystem.extract_responsibilities|structural.builder)
      printf '%s' "${AEGIS_EVIDENCE_TARGET_PATH:-.}"
      ;;
    *)
      printf '%s' "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"
      ;;
  esac
}

invoke_capability_handler() {

  local handler="$1"
  local capability_argument="$2"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_PATH}" \
    AEGIS_EPISTEMIC_HANDOVER_FILE="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_CAPABILITY_PAYLOAD_DIR="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
    AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES="${AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES:-}" \
    AEGIS_FILE_CONTENT_MAX_BYTES="${AEGIS_FILE_CONTENT_MAX_BYTES:-}" \
    AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES="${AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES:-}" \
    AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-}" \
    AEGIS_SEARCH_SYMBOL_CONTEXT_LINES="${AEGIS_SEARCH_SYMBOL_CONTEXT_LINES:-}" \
    bash "${handler}" "${capability_argument}"
}

invoke_raw_substrate() {

  local model="$1"
  local skill_file="$2"
  local selected_manifest="$3"
  local capability_payload_dir="$4"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    AEGIS_MODE="${AEGIS_MODE}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_SELECTED_CAPABILITY_PAYLOADS="${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
    AEGIS_EVIDENCE_MAX_TOTAL_BYTES="${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" \
    AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES}" \
    AEGIS_PROVIDER_RESPONSE_TIMEOUT="${AEGIS_PROVIDER_RESPONSE_TIMEOUT}" \
    AEGIS_PROVIDER_CONNECT_TIMEOUT="${AEGIS_PROVIDER_CONNECT_TIMEOUT}" \
    AEGIS_PROVIDER_MAX_RETRIES="${AEGIS_PROVIDER_MAX_RETRIES}" \
    AEGIS_PROVIDER_RETRY_DELAY="${AEGIS_PROVIDER_RETRY_DELAY}" \
    AEGIS_EVIDENCE_MAX_FILES="${AEGIS_EVIDENCE_MAX_FILES}" \
    AEGIS_RAW_SUBSTRATE_TEMPERATURE="${AEGIS_RAW_SUBSTRATE_TEMPERATURE}" \
    AEGIS_CAPABILITY_MANIFEST_MAX_BYTES="${AEGIS_CAPABILITY_MANIFEST_MAX_BYTES}" \
    AEGIS_ARTIFACT_BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
    AEGIS_ARTIFACT_END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
    bash scripts/substrates/raw_llm.sh \
      "${model}" \
      "${skill_file}" \
      "${selected_manifest}" \
      "${capability_payload_dir}"
}

invoke_aider_substrate() {

  local skill_file="$1"
  local capability_payload_dir="$2"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    AEGIS_MODE="${AEGIS_MODE}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_PATH}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_SELECTED_CAPABILITY_PAYLOADS="${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" \
    AEGIS_MUTATION_MODEL="${AEGIS_MUTATION_MODEL:-}" \
    AEGIS_AIDER_MODEL="${AEGIS_AIDER_MODEL:-}" \
    AEGIS_AIDER_BIN="${AEGIS_AIDER_BIN:-}" \
    AEGIS_MUTATION_GIT_DIR="${AEGIS_MUTATION_GIT_DIR:-}" \
    AEGIS_EPISTEMIC_HANDOVER_FILE="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" \
    AEGIS_ARTIFACT_BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
    AEGIS_ARTIFACT_END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
    bash scripts/substrates/aider_substrate.sh \
      "${skill_file}" \
      "${capability_payload_dir}"
}


# =========================================================
# CAPABILITY ENVIRONMENT
# =========================================================

materialize_capability_environment() {

  aegis_log "Materializing capability environment..."

  local capability
  local handler
  local capability_path

  for capability in "${AEGIS_ACTIVE_CAPABILITIES[@]}"; do

    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]:-}"

    [[ -n "${handler}" ]] \
      || aegis_fatal "missing_handler_for_capability"

    [[ -f "${handler}" ]] \
      || aegis_fatal "missing_capability_handler_file"

    capability_path="${AEGIS_CAPABILITY_ENV_DIR}/${capability}"

    cat > "${capability_path}" <<EOF
#!/usr/bin/env bash
exec bash "${AEGIS_EXECUTOR_ROOT}/${handler}" "\$@"
EOF

    chmod +x "${capability_path}"

  done
}

# =========================================================
# CAPABILITY PAYLOADS
# =========================================================

materialize_capability_payloads() {

  aegis_log "Materializing capability payloads..."

  local evidence_entry
  local capability
  local evidence_alias
  local handler
  local capability_argument
  local payload_output
  local payload_file
  local payload_path

  for evidence_entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do

    capability="$(
      resolve_evidence_entry_capability "${evidence_entry}"
    )"

    evidence_alias="$(
      resolve_evidence_entry_alias "${evidence_entry}"
    )"

    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]:-}"

    [[ -f "${handler}" ]] \
      || aegis_fatal "missing_capability_handler"

    capability_argument="$(
      resolve_capability_argument "${capability}" "${evidence_alias}"
    )"

    payload_file="$(
      resolve_evidence_payload_file "${capability}" "${evidence_alias}"
    )"

    payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${payload_file}"

    payload_output="$(
      invoke_capability_handler \
        "${handler}" \
        "${capability_argument}"
    )"

    printf '%s\n' "${payload_output}" > "${payload_path}"

    jq empty "${payload_path}" \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_capability_payload_json"

    validate_materialized_payload \
      "${capability}" \
      "${payload_path}"

  done
}

# =========================================================
# RUNTIME-OWNED MANIFEST
# =========================================================

consume_runtime_owned_capability_manifest() {

  aegis_log "Consuming runtime-owned capability manifest..."

  [[ -n "${AEGIS_CAPABILITY_MANIFEST}" ]] \
    || aegis_fatal "missing_capability_manifest"

  printf '%s\n' "${AEGIS_CAPABILITY_MANIFEST}" \
    | jq empty \
      >/dev/null 2>&1 \
    || aegis_fatal "invalid_runtime_owned_capability_manifest"
}

# =========================================================
# EVIDENCE PAYLOAD SELECTION
# =========================================================

select_evidence_payloads() {

  local evidence_entry
  local capability
  local evidence_alias
  local payload_file
  local payload_path
  local payload_paths=()

  for evidence_entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do

    capability="$(
      resolve_evidence_entry_capability "${evidence_entry}"
    )"

    evidence_alias="$(
      resolve_evidence_entry_alias "${evidence_entry}"
    )"

    payload_file="$(
      resolve_evidence_payload_file "${capability}" "${evidence_alias}"
    )"

    payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${payload_file}"

    [[ -f "${payload_path}" ]] \
      || aegis_fatal "missing_evidence_payload: ${payload_path}"

    payload_paths+=("${payload_path}")
  done

  export AEGIS_SELECTED_CAPABILITY_PAYLOADS="$(
    jq -cn '$ARGS.positional' --args "${payload_paths[@]}"
  )"
}

# =========================================================
# SELECTED MANIFEST
# =========================================================

materialize_selected_manifest() {

  [[ -n "${AEGIS_CAPABILITY_MANIFEST:-}" ]] \
    || aegis_fatal "missing_capability_manifest"

  # Shell variable only — consumed in-process and passed to substrates
  # as an explicit argument, never via the environment.
  AEGIS_SELECTED_MANIFEST="$(
    echo "${AEGIS_CAPABILITY_MANIFEST}" \
      | jq -c \
          --arg mode "${AEGIS_MODE}" \
          '{
            schema_version: .schema_version,
            runtime_model: .runtime_model,
            generated_at: .generated_at,
            execution_id: .execution_id,
            manifest_hash: .manifest_hash,
            mode: $mode,
            execution_engine: .modes[$mode].execution_engine,
            capability_envelope: .modes[$mode].capability_envelope,
            evidence_profile: .modes[$mode].evidence_profile,
            evidence_capabilities: .modes[$mode].evidence_capabilities,
            capabilities: .modes[$mode].capabilities
          }'
  )"

  [[ -n "${AEGIS_SELECTED_MANIFEST}" ]] \
    || aegis_fatal "missing_selected_manifest"
}

# =========================================================
# SUBSTRATE
# =========================================================

execute_substrate() {

  local substrate_output

  case "${AEGIS_EXECUTION_ENGINE}" in

    raw)
      substrate_output="$(
        invoke_raw_substrate \
          "${OPENAI_MODEL_READONLY_COGNITION}" \
          "${AEGIS_SKILL_FILE}" \
          "${AEGIS_SELECTED_MANIFEST}" \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
      )"
      ;;

    aider)
      substrate_output="$(
        invoke_aider_substrate \
          "${AEGIS_SKILL_FILE}" \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
      )"
      ;;

    *)
      aegis_fatal "unknown_execution_engine"
      ;;

  esac

  # Shell variable only — exporting this multi-hundred-KB blob into the
  # environment makes every subsequent fork/exec fail with E2BIG.
  AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
}

# =========================================================
# ARTIFACT VALIDATION
# =========================================================

# Shared jq diff normalizer — tolerates escaping/whitespace/hunk-header
# drift when comparing candidate diffs across mode boundaries.
readonly AEGIS_JQ_DIFF_NORM='def norm(s): s | gsub("\\\\r"; "") | gsub("\\r"; "") | gsub("\\\\n"; "") | gsub("\\n"; "") | gsub("\\\\\\\\"; "") | gsub("\\\\"; "") | gsub("[[:space:]]+"; "") | gsub("Nonewlineatendoffile"; "") | gsub("@@[^@]+@@[^\n]*"; "@@");'

# Shared jq projection of the topology targets a Discovery handover
# authorizes for Forensics repair candidates.
readonly AEGIS_JQ_AUTHORIZED_TARGETS='def authorized_targets:
  [
    .artifact_snapshot.structural_context.observed_request_alignment.resolved_paths[]?,
    (.artifact_snapshot.structural_context.ranked_targets[]?
      | select(.type == "explicit_request")
      | .file),
    .epistemic_state.next_attention_targets[]?,
    (.artifact_snapshot.structural_context.topology_index.boundaries[]?.file),
    (.artifact_snapshot.structural_context.topology_index.hotspots[]?.file),
    (.artifact_snapshot.structural_context.topology_index.entrypoints[]?.file),
    (.artifact_snapshot.structural_context.topology_index.bridges[]?.from),
    (.artifact_snapshot.structural_context.topology_index.bridges[]?.to),
    (.artifact_snapshot.structural_context.topology_index.surfaces[]?.members[]?)
  ]
  | unique;'

extract_substrate_artifact() {

  local output="${AEGIS_SUBSTRATE_OUTPUT}"

  [[ "${output}" == *"${AEGIS_ARTIFACT_BEGIN_MARKER}"* ]] || return 0
  [[ "${output}" == *"${AEGIS_ARTIFACT_END_MARKER}"* ]] || return 0

  output="${output#*"${AEGIS_ARTIFACT_BEGIN_MARKER}"}"
  printf '%s' "${output%%"${AEGIS_ARTIFACT_END_MARKER}"*}"
}

# Print a labelled mismatch dump: alternating description/JSON pairs.
dump_mismatch() {
  local label="$1"
  shift

  echo "[DEBUG] ${label} details:" >&2
  while [[ "$#" -gt 1 ]]; do
    echo "[DEBUG] $1:" >&2
    printf '%s\n' "$2" | jq -c '.' >&2 || printf '%s\n' "$2" >&2
    shift 2
  done
}

validate_artifact() {

  local artifact

  artifact="$(extract_substrate_artifact)"

  [[ -n "${artifact}" ]] \
    || aegis_fatal "missing_artifact_payload"

  echo "${artifact}" \
    | jq empty \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_artifact_json"

  local artifact_mode

  artifact_mode="$(
    echo "${artifact}" \
      | jq -r '.mode // empty'
  )"

  [[ "${artifact_mode}" == "${AEGIS_MODE}" ]] \
    || aegis_fatal "artifact_mode_mismatch"

  if [[ "${AEGIS_MODE}" == "forensics" ]]; then
    if ! echo "${artifact}" \
      | jq -e '
          (.status == "interpreted" or .status == "inconclusive")
          and (
            .repair_candidates
            | type == "array"
            and all(
              type == "object"
              and ((keys | sort) == ["evidence_refs", "id", "reason"])
              and (.id | type == "string" and length > 0)
              and (.reason | type == "string" and length > 0)
              and (.evidence_refs | type == "array" and length > 0)
              and all(.evidence_refs[]; type == "string" and length > 0)
            )
          )
          and (
            .handover_attention
            | type == "object"
            and (.next_attention_targets | type == "array")
            and (.attention_scope | type == "string" and length > 0)
            and (.attention_reason | type == "string" and length > 0)
          )
          and (
            .status == "inconclusive"
            or (
              [.repair_candidates[].id]
              == .handover_attention.next_attention_targets
            )
          )
        ' >/dev/null 2>&1; then
      dump_mismatch "invalid_forensics_artifact_contract" "Artifact" "${artifact}"
      aegis_fatal "invalid_forensics_artifact_contract"
    fi

    previous_discovery="$(
      jq -c '.' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_discovery "${previous_discovery}" \
        "${AEGIS_JQ_AUTHORIZED_TARGETS}"'
        ($previous_discovery.artifact_snapshot.mode == "discovery")
        and (
          $previous_discovery | authorized_targets
        ) as $authorized_targets
        | all(
            .repair_candidates[];
            . as $candidate
            | $authorized_targets
            | index($candidate.id) != null
          )
      ' >/dev/null 2>&1; then
      dump_mismatch "forensics_repair_candidate_outside_discovery_scope" \
        "Authorized targets" \
        "$(echo "${previous_discovery}" | jq -c "${AEGIS_JQ_AUTHORIZED_TARGETS} authorized_targets")" \
        "Forensics repair candidates" \
        "$(echo "${artifact}" | jq -c '.repair_candidates')"
      aegis_fatal "forensics_repair_candidate_outside_discovery_scope"
    fi
  fi

  if [[ "${AEGIS_MODE}" == "adversarial" ]]; then
    if ! echo "${artifact}" \
      | jq -e '
          (.status == "challenged" or .status == "inconclusive")
          and (
            .candidate_result
            | type == "object"
            and .source_mode == "optimize"
            and (.diff | type == "string" and length > 0)
            and (.files_changed | type == "array" and length > 0)
            and all(.files_changed[]; type == "string" and length > 0)
          )
          and (.findings | type == "array")
          and (.evidence_refs | type == "array")
          and (
            .handover_attention
            | type == "object"
            and (.next_attention_targets | type == "array")
            and (.attention_scope | type == "string" and length > 0)
            and (.attention_reason | type == "string" and length > 0)
          )
        ' >/dev/null 2>&1; then
      dump_mismatch "invalid_adversarial_artifact_contract" "Artifact" "${artifact}"
      aegis_fatal "invalid_adversarial_artifact_contract"
    fi

    previous_optimized_candidate="$(
      jq -c '
        .artifact_snapshot
        | {
            source_mode: .mode,
            diff: .operational_context.candidate_result.diff,
            files_changed: .operational_context.candidate_result.files_changed
          }
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_candidate "${previous_optimized_candidate}" \
        "${AEGIS_JQ_DIFF_NORM}"'
          (.candidate_result.source_mode == $previous_candidate.source_mode)
          and (.candidate_result.files_changed == $previous_candidate.files_changed)
          and (norm(.candidate_result.diff) == norm($previous_candidate.diff))
        ' >/dev/null 2>&1; then
      echo "[DEBUG] adversarial_candidate_mismatch details:" >&2
      echo "[DEBUG] Expected candidate:" >&2
      echo "${previous_optimized_candidate}" | jq -c '.' >&2
      echo "[DEBUG] Actual candidate received:" >&2
      echo "${artifact}" | jq -c '.candidate_result' >&2
      aegis_fatal "adversarial_candidate_mismatch"
    fi
  fi

  if [[ "${AEGIS_MODE}" == "validation" ]]; then
    if ! echo "${artifact}" \
      | jq -e '
          (.verdict == "accepted"
            or .verdict == "rejected"
            or .verdict == "insufficient")
          and (.findings | type == "array")
          and (.basis | type == "array")
          and (
            .validated_candidate
            | type == "object"
            and .source_mode == "optimize"
            and (.diff | type == "string" and length > 0)
            and (.files_changed | type == "array" and length > 0)
            and all(.files_changed[]; type == "string" and length > 0)
          )
          and (
            .handover_attention
            | type == "object"
            and (.next_attention_targets | type == "array")
            and (.attention_scope | type == "string" and length > 0)
            and (.attention_reason | type == "string" and length > 0)
          )
        ' >/dev/null 2>&1; then
      dump_mismatch "invalid_validation_artifact_contract" "Artifact" "${artifact}"
      aegis_fatal "invalid_validation_artifact_contract"
    fi

    previous_candidate="$(
      jq -c '.artifact_snapshot.operational_context.candidate_result // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    [[ -n "${previous_candidate}" ]] \
      || aegis_fatal "missing_adversarial_candidate_result"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_candidate "${previous_candidate}" \
        "${AEGIS_JQ_DIFF_NORM}"'
          (.validated_candidate.source_mode == $previous_candidate.source_mode)
          and (.validated_candidate.files_changed == $previous_candidate.files_changed)
          and (norm(.validated_candidate.diff) == norm($previous_candidate.diff))
        ' >/dev/null 2>&1; then
      aegis_fatal "validation_candidate_mismatch"
    fi

    previous_findings="$(
      jq -c '.artifact_snapshot.operational_context.findings // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    [[ -n "${previous_findings}" ]] \
      || aegis_fatal "missing_findings"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_findings "${previous_findings}" \
        '.findings == $previous_findings' \
        >/dev/null 2>&1; then
      echo "[DEBUG] validation_findings_mismatch details:" >&2
      echo "[DEBUG] Expected findings:" >&2
      echo "${previous_findings}" | jq -c '.' >&2
      echo "[DEBUG] Actual findings received:" >&2
      echo "${artifact}" | jq -c '.findings' >&2
      aegis_fatal "validation_findings_mismatch"
    fi
  fi

  aegis_log "Payload validated successfully"
}

validate_mutation_artifact() {

  local artifact

  artifact="$(extract_substrate_artifact)"

  [[ -n "${artifact}" ]] \
    || aegis_fatal "missing_mutation_artifact_payload"

  echo "${artifact}" \
    | jq empty \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_mutation_artifact_json"

  local artifact_mode
  artifact_mode="$(
    echo "${artifact}" | jq -r '.mode // empty'
  )"

  [[ "${artifact_mode}" == "${AEGIS_MODE}" ]] \
    || aegis_fatal "mutation_artifact_mode_mismatch"

  echo "${artifact}" \
    | jq -e '
        (.diff | type == "string" and length > 0)
        and (.diff != "(no changes)")
      ' >/dev/null 2>&1 \
    || aegis_fatal "mutation_artifact_missing_diff"

  echo "${artifact}" \
    | jq -e '
        (.files_changed | type == "array" and length > 0)
      ' >/dev/null 2>&1 \
    || aegis_fatal "mutation_artifact_missing_files_changed"

  aegis_log "Mutation artifact validated successfully"
}

# =========================================================
# OUTPUT
# =========================================================

normalize_substrate_output() {
  local raw_artifact
  raw_artifact="$(extract_substrate_artifact)"
  # If it is valid JSON, normalize/ensure the structural fields exist
  if printf '%s\n' "${raw_artifact}" | jq empty >/dev/null 2>&1; then
    # Contract fallback when a candidate omits its own evidence_refs.
    local evidence_refs_json
    evidence_refs_json="$(
      jq -cn '$ARGS.positional' --args "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"
    )"

    local updated_artifact
    updated_artifact="$(
      printf '%s\n' "${raw_artifact}" | jq \
        --arg mode "${AEGIS_MODE}" \
        --argjson evidence_refs "${evidence_refs_json}" \
        '
        .mode = $mode
        | .handover_attention = (
            .handover_attention // {
              next_attention_targets: (.repair_candidates // [] | map(.id)? // .validated_candidate.files_changed // []),
              attention_scope: (if .verdict? then "validation_result" elif .verdict? == null and .diff? then "mutation_result" else "exploratory" end),
              attention_reason: "runtime auto-populated attention"
            }
          )
        | if .status? == null then
            if .verdict? then
              .
            elif .diff? then
              .status = "optimized"
            else
              .status = "interpreted"
            end
          else
            .
          end
        | if $mode == "forensics" then
            # Deterministic protocol coercion: project candidates onto the
            # exact contract shape (extra model keys dropped, defaults
            # filled) and keep attention targets in lockstep with them.
            .repair_candidates = (.repair_candidates // [] | map({
              id,
              reason: (.reason // "unspecified"),
              evidence_refs: (
                if (.evidence_refs | type == "array" and length > 0)
                then .evidence_refs
                else $evidence_refs
                end
              )
            }))
            | .handover_attention = {
                next_attention_targets: (
                  if .status == "interpreted"
                  then [.repair_candidates[].id]
                  else (.handover_attention.next_attention_targets // [])
                  end
                ),
                attention_scope: "evidence-backed interpretation",
                attention_reason: (.handover_attention.attention_reason // "runtime auto-populated attention")
              }
          else
            .
          end
        '
    )"
    
    # Reconstruct output around the normalized artifact using parameter expansion
    local prefix="${AEGIS_SUBSTRATE_OUTPUT%%"${AEGIS_ARTIFACT_BEGIN_MARKER}"*}"
    local suffix="${AEGIS_SUBSTRATE_OUTPUT#*"${AEGIS_ARTIFACT_END_MARKER}"}"

    AEGIS_SUBSTRATE_OUTPUT="$(
      printf '%s\n' "${prefix}"
      printf '%s\n' "${AEGIS_ARTIFACT_BEGIN_MARKER}"
      printf '%s\n' "${updated_artifact}"
      printf '%s\n' "${AEGIS_ARTIFACT_END_MARKER}"
      printf '%s\n' "${suffix}"
    )"
  else
    aegis_warn "substrate_artifact_not_normalizable"
  fi
}

emit_output() {
  echo "${AEGIS_SUBSTRATE_OUTPUT}"
}

# =========================================================
# MAIN
# =========================================================

main() {

  validate_executor_inputs
  resolve_execution_engine
  resolve_capability_envelope
  resolve_evidence_profile
  augment_evidence_profile_from_handover
  prepare_execution_state
  materialize_capability_environment
  measure "executor_capability_payloads" materialize_capability_payloads
  consume_runtime_owned_capability_manifest
  select_evidence_payloads
  materialize_selected_manifest
  measure "executor_execute_substrate" execute_substrate

  # Normalize substrate output first, so validate_artifact validates the corrected/enveloped JSON
  normalize_substrate_output

  case "${AEGIS_EXECUTION_ENGINE}" in
    aider) measure "executor_artifact_validation" validate_mutation_artifact ;;
    *)     measure "executor_artifact_validation" validate_artifact           ;;
  esac

  emit_output
}

main "$@"
