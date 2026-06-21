#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — RUNTIME AUTHORITY
# =========================================================
#
# Version: 2.5
# Layer: Runtime Sovereignty
# Status: Operational Memory Hardened
#
# Responsibilities:
#
# - sovereign orchestration
# - disposable execution surface lifecycle
# - execution identity propagation
# - artifact promotion
# - runtime-owned epistemic handover lifecycle
# - runtime cleanup
# - capability environment cleanup
# - capability payload cleanup
# - runtime contract validation
# - policy enforcement
#
# The runtime intentionally owns:
#
# - orchestration
# - artifact promotion
# - epistemic handover lifecycle
# - persistence decisions
# - cleanup
# - execution sequencing
# - execution surface lifecycle
#
# The runtime intentionally does NOT:
#
# - reason semantically
# - interpret cognition
# - redesign architecture
# - mutate implicitly
#
# =========================================================
if [[ -f ".harness/local.env" ]] && [[ "${OPENAI_API_KEY:-}" != *test-key* ]]; then
    source ".harness/local.env"
fi
set -Eeuo pipefail

# =========================================================
# ROOT RESOLUTION
# =========================================================

readonly AEGIS_RUNTIME_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
)"

cd "${AEGIS_RUNTIME_ROOT}"

# =========================================================
# CONFIGURATION
# =========================================================

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][RUNTIME][FATAL] missing_config" >&2
  exit 1
}

source ".harness/config.sh"

# =========================================================
# EXECUTION IDENTITY
# =========================================================

export AEGIS_EXECUTION_ID="$(
  date +%s
)-$$"

export AEGIS_EXECUTION_TIMESTAMP="$(
  date -u +"%Y-%m-%dT%H:%M:%SZ"
)"

# =========================================================
# LOGGING
# =========================================================

runtime_log() {
  echo "[AEGIS][RUNTIME] $*" >&2
}

runtime_warn() {
  echo "[AEGIS][RUNTIME][WARN] $*" >&2
}

runtime_fatal() {
  echo "[AEGIS][RUNTIME][FATAL] $*" >&2
  exit 1
}

measure() {
  local label="$1"
  local start
  start=$(date +%s)
  shift
  "$@"
  local end
  end=$(date +%s)
  echo "[AEGIS][TIMING] ${label}: $((end-start))s" >&2
}

# =========================================================
# CLI
# =========================================================

join_cli_positional_arguments() {
  local positional_args=("$@")
  local joined_input=""
  local positional_arg

  for positional_arg in "${positional_args[@]}"; do
    if [[ -n "${joined_input}" ]]; then
      joined_input+=" "
    fi

    joined_input+="${positional_arg}"
  done

  printf '%s' "${joined_input}"
}

parse_runtime_cli() {

  local cli_mode="discovery"
  local cli_issue_number=""
  local cli_target_path=""
  local cli_investigation_input=""
  local positional_args=()

  if [[ "$#" -gt 0 ]] && [[ "${1}" != --* ]]; then
    cli_mode="$1"
    shift
  fi

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --issue)
        shift

        [[ "$#" -gt 0 ]] \
          || runtime_fatal "missing_issue_number"

        [[ -z "${cli_issue_number}" ]] \
          || runtime_fatal "duplicate_issue_argument"

        cli_issue_number="$1"
        ;;
      --issue=*)
        [[ -z "${cli_issue_number}" ]] \
          || runtime_fatal "duplicate_issue_argument"

        cli_issue_number="${1#--issue=}"
        ;;
      --target)
        shift

        [[ "$#" -gt 0 ]] \
          || runtime_fatal "missing_target_path"

        [[ -z "${cli_target_path}" ]] \
          || runtime_fatal "duplicate_target_argument"

        cli_target_path="$1"
        ;;
      --target=*)
        [[ -z "${cli_target_path}" ]] \
          || runtime_fatal "duplicate_target_argument"

        cli_target_path="${1#--target=}"
        ;;
      --)
        shift

        while [[ "$#" -gt 0 ]]; do
          positional_args+=("$1")
          shift
        done

        break
        ;;
      -*)
        runtime_fatal "unknown_argument: $1"
        ;;
      *)
        positional_args+=("$1")
        ;;
    esac

    shift
  done

  if [[ -n "${cli_issue_number}" ]]; then
    [[ "${cli_issue_number}" =~ ^[0-9]+$ ]] \
      || runtime_fatal "invalid_issue_number"

    [[ "${#positional_args[@]}" -eq 0 ]] \
      || runtime_fatal "mixed_investigation_input_forms"

    cli_investigation_input="issue #${cli_issue_number}"
  elif [[ "${#positional_args[@]}" -gt 0 ]]; then
    if [[ -z "${cli_target_path}" ]] && [[ -d "${positional_args[0]}" ]]; then
      cli_target_path="${positional_args[0]}"
      positional_args=("${positional_args[@]:1}")
    fi

    cli_investigation_input="$(
      join_cli_positional_arguments "${positional_args[@]}"
    )"
  fi

  if [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    && [[ -n "${cli_investigation_input}" ]] \
    && [[ "${AEGIS_INVESTIGATION_INPUT}" != "${cli_investigation_input}" ]]; then
    runtime_fatal "investigation_input_conflict"
  fi

  AEGIS_MODE="${cli_mode}"

  if [[ -n "${cli_investigation_input}" ]]; then
    export AEGIS_INVESTIGATION_INPUT="${cli_investigation_input}"
  fi

  if [[ -n "${cli_target_path}" ]]; then
    [[ -d "${cli_target_path}" ]] \
      || runtime_fatal "target_path_not_directory"

    export AEGIS_EVIDENCE_TARGET_PATH="${cli_target_path}"
  fi
}

get_next_mode() {
  case "$1" in
    discovery)   echo "forensics" ;;
    forensics)   echo "repair" ;;
    repair)      echo "optimize" ;;
    optimize)    echo "adversarial" ;;
    adversarial) echo "validation" ;;
    *)           echo "null" ;;
  esac
}

print_status_json() {
  local last_mode="null"
  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}" ]]; then
    last_mode="$(jq -r '.artifact_snapshot.mode // "null"' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || echo "null")"
  fi

  local next_mode="discovery"
  if [[ "${last_mode}" != "null" ]]; then
    next_mode="$(get_next_mode "${last_mode}")"
  fi

  jq -n \
    --arg last_mode "${last_mode}" \
    --arg next_mode "${next_mode}" \
    '{
      last_mode: (if $last_mode == "null" then null else $last_mode end),
      next_mode: (if $next_mode == "null" then null else $next_mode end)
    }'
}

print_modes_json() {
  jq -n \
    --argjson readonly '["discovery", "forensics"]' \
    --argjson mutation '["discovery", "forensics", "repair", "optimize", "adversarial", "validation"]' \
    '{readonly: $readonly, mutation: $mutation}'
}

AEGIS_MODE=""
AEGIS_SKILL_FILE=""

parse_runtime_cli "$@"

if [[ "${AEGIS_MODE}" == "status" ]]; then
  print_status_json
  exit 0
elif [[ "${AEGIS_MODE}" == "modes" ]]; then
  print_modes_json
  exit 0
fi

readonly AEGIS_MODE
readonly AEGIS_SKILL_FILE=".skills/${AEGIS_MODE}.md"

# =========================================================
# EXECUTION SURFACE PATH
# =========================================================

export AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_ROOT}/${AEGIS_MODE}"

AEGIS_EXECUTION_SURFACE_ACTIVE="false"

apply_default_investigation_input() {
  export AEGIS_INVESTIGATION_INPUT="${AEGIS_DEFAULT_INVESTIGATION_INPUT}"

  printf '%s\n' \
    "[AEGIS][RUNTIME]" \
    "No investigation input provided." \
    "Using default exploratory investigation." >&2
}

mode_requires_execution_surface() {
  local execution_engine="${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}"

  [[ "${execution_engine}" == "aider" ]]
}

mode_starts_new_investigation() {
  [[ "${AEGIS_MODE}" == "discovery" ]]
}

artifact_snapshot_investigation_input_from_handover() {

  local handover_file="$1"

  if ! handover_schema_is_valid "${handover_file}"; then
    return 0
  fi

  jq -r '
    if (
      (.artifact_snapshot | type == "object")
      and (.artifact_snapshot.investigation_input? | type == "string")
      and (.artifact_snapshot.investigation_input | length > 0)
    ) then
      .artifact_snapshot.investigation_input
    else
      empty
    end
  ' "${handover_file}" 2>/dev/null || true
}

resolve_runtime_investigation_input() {

  local current_investigation_input
  current_investigation_input="$({
    artifact_snapshot_investigation_input_from_handover "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
  })"

  if mode_starts_new_investigation; then
    if [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]]; then
      export AEGIS_INVESTIGATION_INPUT
      return 0
    fi

    apply_default_investigation_input
    return 0
  fi

  if [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    && [[ -n "${current_investigation_input}" ]] \
    && [[ "${AEGIS_INVESTIGATION_INPUT}" != "${current_investigation_input}" ]]; then
    runtime_fatal "investigation_input_mismatch"
  fi

  if [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]]; then
    export AEGIS_INVESTIGATION_INPUT
    return 0
  fi

  if [[ -n "${current_investigation_input}" ]]; then
    export AEGIS_INVESTIGATION_INPUT="${current_investigation_input}"
    return 0
  fi

  apply_default_investigation_input
}

# =========================================================
# CLEANUP
# =========================================================

cleanup_runtime() {

  set +e

  runtime_log "Starting runtime-owned cleanup..."

  if [[ "${AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE}" == "true" ]] \
    && [[ "${AEGIS_EXECUTION_SURFACE_ACTIVE}" == "true" ]]; then
    remove_runtime_owned_execution_surface_if_present
  fi

  remove_runtime_owned_capability_surfaces

  runtime_log "Runtime cleanup completed"

  set -e
}

trap cleanup_runtime EXIT
trap 'runtime_warn "Interrupted"; exit 130' INT TERM

# =========================================================
# EPISTEMIC HANDOVER
# =========================================================

epistemic_state_schema_filter() {
  cat <<'EOF'
type == "object"
and ((keys | sort) == [
  "attention_reason",
  "attention_scope",
  "next_attention_targets"
])
and (.next_attention_targets | type == "array")
and (.attention_scope | type == "string" and length > 0)
and (.attention_reason | type == "string" and length > 0)
and (
  [.next_attention_targets[]] | all(type == "string")
)
EOF
}

epistemic_handover_schema_filter() {
  cat <<'EOF'
type == "object"
and ((keys | sort) == [
  "artifact_snapshot",
  "epistemic_state"
])
and (
  (.artifact_snapshot == null)
  or (.artifact_snapshot | type == "object")
)
and (
  .epistemic_state
  | (
      type == "object"
      and ((keys | sort) == [
        "attention_reason",
        "attention_scope",
        "next_attention_targets"
      ])
      and (.next_attention_targets | type == "array")
      and (.attention_scope | type == "string" and length > 0)
      and (.attention_reason | type == "string" and length > 0)
      and (
        [.next_attention_targets[]] | all(type == "string")
      )
    )
)
EOF
}

handover_schema_is_valid() {

  local handover_file="$1"

  jq -e "$(epistemic_handover_schema_filter)" "${handover_file}" >/dev/null 2>&1
}

validate_epistemic_state_json() {

  local epistemic_state_json="$1"

  printf '%s' "${epistemic_state_json}" \
    | jq -e "$(epistemic_state_schema_filter)" >/dev/null 2>&1
}

write_empty_epistemic_handover_state_json() {
  printf '%s' '{"next_attention_targets":[],"attention_scope":"none","attention_reason":"no active attention"}'
}

handover_size_is_valid() {

  local handover_file="$1"
  local handover_size_bytes

  [[ -f "${handover_file}" ]] || return 1

  handover_size_bytes="$(
    wc -c < "${handover_file}"
  )"

  [[ "${handover_size_bytes}" -le "${AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES}" ]]
}

runtime_owned_epistemic_handover_is_valid() {

  local handover_file="$1"

  [[ -f "${handover_file}" ]] \
    && handover_schema_is_valid "${handover_file}" \
    && handover_size_is_valid "${handover_file}"
}

assert_valid_runtime_owned_epistemic_handover() {

  local handover_file="$1"
  local invalid_error="$2"
  local size_error="$3"

  handover_schema_is_valid "${handover_file}" \
    || runtime_fatal "${invalid_error}"

  handover_size_is_valid "${handover_file}" \
    || runtime_fatal "${size_error}"
}

write_empty_epistemic_handover() {

  local handover_file="$1"

  write_runtime_owned_epistemic_handover \
    "${handover_file}" \
    'null' \
    "$(write_empty_epistemic_handover_state_json)"
}

write_runtime_owned_epistemic_handover() {

  local handover_file="$1"
  local artifact_snapshot_json="$2"
  local epistemic_state_json="$3"
  local tmp_handover_file

  tmp_handover_file="$(mktemp)"

  jq -n \
    --argjson artifact_snapshot "${artifact_snapshot_json}" \
    --argjson epistemic_state "${epistemic_state_json}" \
    '{
      artifact_snapshot: $artifact_snapshot,
      epistemic_state: $epistemic_state
    }' > "${tmp_handover_file}" \
    || runtime_fatal "failed_to_materialize_epistemic_handover"

  handover_size_is_valid "${tmp_handover_file}" \
    || runtime_fatal "epistemic_handover_runtime_state_exceeds_max_bytes"

  mv "${tmp_handover_file}" "${handover_file}" \
    || runtime_fatal "failed_to_commit_epistemic_handover"
}

remove_runtime_owned_execution_surface_if_present() {

  if git worktree list | grep -q "${AEGIS_EXECUTION_SURFACE_PATH}" \
    || [[ -d "${AEGIS_EXECUTION_SURFACE_PATH:-}" ]]; then
    git worktree remove \
      --force \
      "${AEGIS_EXECUTION_SURFACE_PATH}" \
      >/dev/null 2>&1 || true
    rm -rf "${AEGIS_EXECUTION_SURFACE_PATH}"
  fi

  git worktree prune \
    >/dev/null 2>&1 || true
}

remove_runtime_owned_capability_surfaces() {

  local respect_cleanup_policy="${1:-true}"

  if [[ "${respect_cleanup_policy}" != "false" ]] \
    && [[ "${AEGIS_RUNTIME_REMOVE_CAPABILITY_ENV}" != "true" ]]; then
    :
  else
    rm -rf "${AEGIS_CAPABILITY_ENV_DIR}" \
      >/dev/null 2>&1 || true
  fi

  if [[ "${respect_cleanup_policy}" != "false" ]] \
    && [[ "${AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS}" != "true" ]]; then
    :
  else
    rm -rf "${AEGIS_CAPABILITY_PAYLOAD_DIR}" \
      >/dev/null 2>&1 || true
  fi
}

prepare_runtime_owned_epistemic_handover() {

  local handover_file="$1"

  if ! runtime_owned_epistemic_handover_is_valid "${handover_file}"; then
    runtime_warn "invalid_epistemic_handover_detected_reinitializing"
    write_empty_epistemic_handover "${handover_file}"
  fi

  assert_valid_runtime_owned_epistemic_handover \
    "${handover_file}" \
    "invalid_epistemic_handover_runtime_state" \
    "epistemic_handover_runtime_state_exceeds_max_bytes"
}

reset_runtime_owned_epistemic_handover_for_new_investigation() {

  if ! mode_starts_new_investigation; then
    return
  fi

  runtime_log "Resetting runtime-owned epistemic handover for new investigation boundary..."

  write_empty_epistemic_handover "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
}

validate_mode_preconditions() {

  if [[ "${AEGIS_MODE}" == "discovery" ]]; then
    return 0
  fi

  [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]] \
    || runtime_fatal "missing_epistemic_handover_for_mode: ${AEGIS_MODE}"

  local handover_content
  handover_content="$(cat "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  case "${AEGIS_MODE}" in
    forensics)
      echo "${handover_content}" | jq -e '
        .artifact_snapshot != null
        and .artifact_snapshot.mode == "discovery"
      ' >/dev/null 2>&1 || runtime_fatal "precondition_failed_discovery_artifact_missing_or_invalid"
      ;;
    repair)
      echo "${handover_content}" | jq -e '
        .artifact_snapshot != null
        and .artifact_snapshot.mode == "forensics"
        and (.artifact_snapshot.operational_context.repair_candidates | type == "array" and length > 0)
      ' >/dev/null 2>&1 || runtime_fatal "precondition_failed_forensics_artifact_missing_or_invalid"
      ;;
    optimize)
      echo "${handover_content}" | jq -e '
        .artifact_snapshot != null
        and .artifact_snapshot.mode == "repair"
        and (.artifact_snapshot.operational_context.diff | type == "string" and length > 0 and . != "(no changes)")
        and (.artifact_snapshot.operational_context.files_changed | type == "array" and length > 0)
      ' >/dev/null 2>&1 || runtime_fatal "precondition_failed_repair_candidate_missing_or_invalid"
      ;;
    adversarial)
      echo "${handover_content}" | jq -e '
        .artifact_snapshot != null
        and .artifact_snapshot.mode == "optimize"
        and (.artifact_snapshot.operational_context.diff | type == "string" and length > 0 and . != "(no changes)")
        and (.artifact_snapshot.operational_context.files_changed | type == "array" and length > 0)
      ' >/dev/null 2>&1 || runtime_fatal "precondition_failed_optimize_candidate_missing_or_invalid"
      ;;
    validation)
      echo "${handover_content}" | jq -e '
        .artifact_snapshot != null
        and .artifact_snapshot.mode == "adversarial"
        and (.artifact_snapshot.operational_context.candidate_result | type == "object")
        and (.artifact_snapshot.operational_context.candidate_result.diff | type == "string" and length > 0 and . != "(no changes)")
        and (.artifact_snapshot.operational_context.candidate_result.files_changed | type == "array" and length > 0)
        and (.artifact_snapshot.operational_context.adversarial_findings | type == "array")
      ' >/dev/null 2>&1 || runtime_fatal "precondition_failed_adversarial_findings_missing_or_invalid"
      ;;
  esac
}

# =========================================================
# VALIDATION
# =========================================================

validate_execution_engine_requirements() {
  local engine
  engine="${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}"
  case "$engine" in
    aider)
      command -v aider >/dev/null 2>&1 \
        || runtime_fatal "missing_aider_binary"
      ;;
  esac
}

validate_runtime_environment() {

  runtime_log "Initializing runtime..."

  local required_commands=(
    git
    jq
  )

  local command_name
  for command_name in "${required_commands[@]}"; do
    command -v "${command_name}" >/dev/null 2>&1 \
      || runtime_fatal "missing_dependency: ${command_name}"
  done

  local required_runtime_vars=(
    AEGIS_EXECUTION_SURFACE_ROOT
    AEGIS_RUNTIME_DIR
    AEGIS_CAPABILITY_ENV_DIR
    AEGIS_CAPABILITY_PAYLOAD_DIR
    AEGIS_EPISTEMIC_HANDOVER_FILE
    AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES
    AEGIS_EVIDENCE_MAX_TOTAL_BYTES
    AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES
  )

  local runtime_var
  for runtime_var in "${required_runtime_vars[@]}"; do
    [[ -n "${!runtime_var:-}" ]] \
      || runtime_fatal "missing_runtime_variable: ${runtime_var}"
  done

  declare -p AEGIS_EXECUTION_ENGINES >/dev/null 2>&1 \
    || runtime_fatal "missing_execution_engine_registry"

  declare -p AEGIS_MODE_CAPABILITY_MAP >/dev/null 2>&1 \
    || runtime_fatal "missing_capability_envelope_registry"

  declare -p AEGIS_MODE_EVIDENCE_PROFILE >/dev/null 2>&1 \
    || runtime_fatal "missing_evidence_profile_registry"

  [[ -f "${AEGIS_SKILL_FILE}" ]] \
    || runtime_fatal "missing_skill_contract"

  [[ -n "${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}" ]] \
    || runtime_fatal "unknown_mode"

  [[ -n "${AEGIS_MODE_EVIDENCE_PROFILE[$AEGIS_MODE]:-}" ]] \
    || runtime_fatal "missing_mode_evidence_profile"

  validate_execution_engine_requirements
}

# =========================================================
# RUNTIME BOOTSTRAP
# =========================================================

bootstrap_runtime_state() {

  mkdir -p "${AEGIS_RUNTIME_DIR}"

  prepare_runtime_owned_epistemic_handover \
    "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

  resolve_runtime_investigation_input
}

# =========================================================
# RESIDUE CLEANUP
# =========================================================

remove_stale_runtime_residue() {

  runtime_log "Removing stale execution-surface residue..."

  if [[ "${AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE}" == "true" ]] \
    && mode_requires_execution_surface; then
    remove_runtime_owned_execution_surface_if_present
  fi

  remove_runtime_owned_capability_surfaces
}

# =========================================================
# EXECUTION SURFACE
# =========================================================

prepare_execution_surface() {

  if ! mode_requires_execution_surface; then
    runtime_log "Skipping disposable execution surface for mode without execution-surface requirements..."
    return
  fi

  runtime_log "Preparing disposable execution surface..."

  mkdir -p "${AEGIS_EXECUTION_SURFACE_ROOT}"

  git worktree add \
    --force \
    --detach \
    "${AEGIS_EXECUTION_SURFACE_PATH}" \
    HEAD \
    >/dev/null

  [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] \
    || runtime_fatal "failed_to_materialize_execution_surface"

  AEGIS_EXECUTION_SURFACE_ACTIVE="true"
}

materialize_preceding_mutation_candidate() {

  if [[ "${AEGIS_MODE}" != "optimize" ]]; then
    return
  fi

  runtime_log "Materializing Repair candidate for Optimize..."

  bash scripts/runtime/apply_candidate_diff.sh \
    "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
    "${AEGIS_EXECUTION_SURFACE_PATH}" \
    || runtime_fatal "failed_to_materialize_repair_candidate"
}

# =========================================================
# CAPABILITY SURFACES
# =========================================================

prepare_runtime_owned_capability_surfaces() {

  runtime_log "Preparing runtime-owned capability surfaces..."

  remove_runtime_owned_capability_surfaces false

  mkdir -p "${AEGIS_CAPABILITY_ENV_DIR}"
  mkdir -p "${AEGIS_CAPABILITY_PAYLOAD_DIR}"

  [[ -d "${AEGIS_CAPABILITY_ENV_DIR}" ]] \
    || runtime_fatal "failed_to_prepare_capability_environment"

  [[ -d "${AEGIS_CAPABILITY_PAYLOAD_DIR}" ]] \
    || runtime_fatal "failed_to_prepare_capability_payload_directory"
}

# =========================================================
# CAPABILITY MANIFEST
# =========================================================

materialize_runtime_owned_capability_manifest() {

  runtime_log "Generating runtime-owned capability manifest..."

  export AEGIS_CAPABILITY_MANIFEST="$(
    bash scripts/capabilities/generate_manifest.sh
  )"

  [[ -n "${AEGIS_CAPABILITY_MANIFEST}" ]] \
    || runtime_fatal "missing_runtime_owned_capability_manifest"

  printf '%s\n' "${AEGIS_CAPABILITY_MANIFEST}" \
    | jq empty \
      >/dev/null 2>&1 \
    || runtime_fatal "invalid_runtime_owned_capability_manifest"
}

# =========================================================
# EXECUTION
# =========================================================

execute_mode() {

  runtime_log "Executing mode: ${AEGIS_MODE}"

  local execution_output
  local artifact_payload

  execution_output="$(
    bash scripts/execute_mode.sh \
      "${AEGIS_SKILL_FILE}" \
      "${AEGIS_MODE}" \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
  )"

  echo "${execution_output}"

  echo "${execution_output}" | grep -q "${AEGIS_ARTIFACT_BEGIN_MARKER}" \
    || runtime_fatal "missing_artifact"

  echo "${execution_output}" | grep -q "${AEGIS_ARTIFACT_END_MARKER}" \
    || runtime_fatal "missing_artifact"

  artifact_payload="$(
    echo "${execution_output}" \
      | sed -n '/AEGIS_ARTIFACT_BEGIN/,/AEGIS_ARTIFACT_END/p' \
      | sed '1d;$d'
  )"

  [[ -n "${artifact_payload}" ]] \
    || runtime_fatal "empty_artifact_payload"

  echo "${artifact_payload}" \
    | jq empty \
      >/dev/null 2>&1 \
    || runtime_fatal "invalid_promoted_artifact_json"

  echo "${artifact_payload}" \
    | jq -e 'type == "object"' \
      >/dev/null 2>&1 \
    || runtime_fatal "invalid_promoted_artifact_shape"

  export AEGIS_PROMOTED_ARTIFACT_PAYLOAD="$({
    printf '%s\n' "${artifact_payload}" | jq -c '.'
  })"

  [[ -n "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" ]] \
    || runtime_fatal "failed_to_compact_promoted_artifact"

  runtime_log "Promoting validated artifact..."

  runtime_log "Execution completed successfully"
}

promote_validated_candidate() {

  if [[ "${AEGIS_MODE}" != "validation" ]]; then
    return
  fi

  local verdict
  verdict="$(
    printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" \
      | jq -r '.verdict // empty'
  )"

  if [[ "${verdict}" != "accepted" ]]; then
    runtime_log "Validation verdict does not authorize mutation promotion: ${verdict}"
    return
  fi

  local validation_artifact_file
  validation_artifact_file="$(mktemp)"
  printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" \
    > "${validation_artifact_file}"

  bash scripts/runtime/promote_validated_candidate.sh \
    "${validation_artifact_file}" \
    "${AEGIS_RUNTIME_ROOT}" \
    || {
      rm -f "${validation_artifact_file}"
      runtime_fatal "validated_candidate_promotion_failed"
    }

  rm -f "${validation_artifact_file}"
}

# =========================================================
# EPISTEMIC HANDOVER
# =========================================================

promote_epistemic_handover() {

  runtime_log "Updating epistemic handover..."

  [[ -n "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD:-}" ]] \
    || runtime_fatal "missing_promoted_artifact_for_handover"

  local handover_json
  local builder_payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/structural_builder.json"

  # --- runtime-owned structural injection with epistemic separation ---
  # artifact_snapshot is split into two explicit areas:
  #   structural_context — runtime-owned facts (from structural.builder)
  #   operational_context — discovery-owned interpretation/focus
  # This makes the origin of truth explicit: structural data is produced
  # mechanically by the runtime, operational data is produced cognitively
  # by the Discovery mode. The LLM cannot corrupt structural data.
  # mode, investigation_input, and generated_at stay at the top level
  # of artifact_snapshot (they are metadata, not structural or operational).
  if [[ -f "${builder_payload_path}" ]]; then
    handover_json="$({
      printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" |
        jq -c \
          --arg generated_at "${AEGIS_EXECUTION_TIMESTAMP}" \
          --arg investigation_input "${AEGIS_INVESTIGATION_INPUT}" \
          --slurpfile builder "${builder_payload_path}" '
          . as $orig
          | ($builder[0].payload // {}) as $bp
          | {
              artifact_snapshot: {
                mode: $orig.mode,
                investigation_input: $investigation_input,
                generated_at: (if $orig | has("generated_at") then $orig.generated_at else $generated_at end),
                structural_context: {
                  topology_index:             $bp.topology_index,
                  topology_summary:           $bp.topology_summary,
                  ranked_targets:             $bp.ranked_targets,
                  bridge_data:                $bp.topology_index.bridges,
                  boundary_data:              $bp.topology_index.boundaries,
                  hotspot_data:               $bp.topology_index.hotspots,
                  entrypoints:                $bp.topology_index.entrypoints,
                  evidence_summary:           $bp.evidence,
                  unresolved_references:      $bp.unresolved_references,
                  observed_request_alignment:    $bp.observed_request_alignment,
                  suggested_evidence_priorities: $bp.suggested_evidence_priorities,
                  gap_counts:                    $bp.gap_counts
                },
                operational_context: (
                  (if ($orig | has("operational_context")) then
                    $orig.operational_context
                  else
                    ($orig
                     | del(.handover_attention, .mode, .investigation_input,
                           .topology_summary, .topology_index, .ranked_targets,
                           .observed_request_alignment, .gap_counts, .evidence,
                           .unresolved_references, .generated_at,
                           .boundary_count, .bridge_count, .hotspot_count,
                           .entrypoint_count, .unresolved_reference_count)
                    )
                  end)
                  | del(.topology_summary, .topology_index, .ranked_targets,
                        .observed_request_alignment, .gap_counts, .evidence,
                        .unresolved_references, .boundary_count, .bridge_count,
                        .hotspot_count, .entrypoint_count, .unresolved_reference_count)
                )
              },
              epistemic_state: (
                $orig.handover_attention //
                {
                  next_attention_targets: [],
                  attention_scope: "none",
                  attention_reason: "no active attention"
                }
              )
            }
        '
    })" || runtime_fatal "failed_to_materialize_handover"
  else
    # Builder payload missing — promote without structural injection.
    # Preserve structural_context and flat topology keys from preceding handover if it exists.
    local prev_arg=()
    if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
      prev_arg=(--slurpfile prev "${AEGIS_EPISTEMIC_HANDOVER_FILE}")
    fi

    handover_json="$({
      printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" |
        jq -c "${prev_arg[@]}" \
          --arg generated_at "${AEGIS_EXECUTION_TIMESTAMP}" \
          --arg investigation_input "${AEGIS_INVESTIGATION_INPUT}" '
          . as $orig
          | ($prev[0].artifact_snapshot // {}) as $pr
          | {
              artifact_snapshot: {
                mode: $orig.mode,
                investigation_input: $investigation_input,
                generated_at: (if $orig | has("generated_at") then $orig.generated_at else $generated_at end),
                structural_context:         ($pr.structural_context // {}),
                operational_context: (
                  (if ($orig | has("operational_context")) then
                    $orig.operational_context
                  else
                    ($orig
                     | del(.handover_attention, .mode, .investigation_input,
                           .topology_summary, .topology_index, .ranked_targets,
                           .observed_request_alignment, .gap_counts, .evidence,
                           .unresolved_references, .generated_at,
                           .boundary_count, .bridge_count, .hotspot_count,
                           .entrypoint_count, .unresolved_reference_count)
                    )
                  end)
                  | del(.topology_summary, .topology_index, .ranked_targets,
                        .observed_request_alignment, .gap_counts, .evidence,
                        .unresolved_references, .boundary_count, .bridge_count,
                        .hotspot_count, .entrypoint_count, .unresolved_reference_count)
                )
              },
              epistemic_state: (
                $orig.handover_attention //
                {
                  next_attention_targets: [],
                  attention_scope: "none",
                  attention_reason: "no active attention"
                }
              )
            }
        '
    })" || runtime_fatal "failed_to_materialize_handover"
  fi
  write_runtime_owned_epistemic_handover \
  "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
  "$(printf '%s' "${handover_json}" | jq -c '.artifact_snapshot')" \
  "$(printf '%s' "${handover_json}" | jq -c '.epistemic_state')"

  assert_valid_runtime_owned_epistemic_handover \
    "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
    "invalid_epistemic_handover_after_mode_execution" \
    "epistemic_handover_after_mode_execution_exceeds_max_bytes"
}

# =========================================================
# MAIN
# =========================================================

main() {
  validate_runtime_environment
  bootstrap_runtime_state
  reset_runtime_owned_epistemic_handover_for_new_investigation
  validate_mode_preconditions
  remove_stale_runtime_residue
  measure "runtime_prepare_execution_surface" prepare_execution_surface
  measure "runtime_materialize_preceding_mutation_candidate" materialize_preceding_mutation_candidate
  prepare_runtime_owned_capability_surfaces
  measure "runtime_materialize_manifest" materialize_runtime_owned_capability_manifest
  measure "runtime_execute_mode" execute_mode
  measure "runtime_promote_validated_candidate" promote_validated_candidate
  promote_epistemic_handover
}

main "$@"
