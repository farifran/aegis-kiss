#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — RUNTIME AUTHORITY
# =========================================================
#
# Sovereign orchestrator: mode sequencing, disposable execution
# surfaces, artifact promotion, and the runtime-owned epistemic
# handover lifecycle. It never reasons semantically or mutates
# implicitly — cognition belongs to the substrates.
#
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

# Allow config to load .harness/local.env once (never in env -i children).
export AEGIS_LOAD_LOCAL_ENV=1
source ".harness/config.sh"

# =========================================================
# EXECUTION IDENTITY
# =========================================================

# Portable epoch via date subshell: the printf '%(%s)T' builtin token
# requires Bash >= 4.2 and yields an empty string on macOS Bash 3.2.
export AEGIS_EXECUTION_ID="$(
  date +%s
)-$$"

export AEGIS_EXECUTION_TIMESTAMP="$(
  date -u +"%Y-%m-%dT%H:%M:%SZ"
)"

# =========================================================
# LOGGING
# =========================================================

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
source "scripts/lib/demand.sh"
source "scripts/lib/epistemic_handover.sh"
source "scripts/lib/run_outcome.sh"
AEGIS_LOG_TAG="RUNTIME"


# =========================================================
# CLI
# =========================================================

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
          || aegis_fatal "missing_issue_number"

        [[ -z "${cli_issue_number}" ]] \
          || aegis_fatal "duplicate_issue_argument"

        cli_issue_number="$1"
        ;;
      --issue=*)
        [[ -z "${cli_issue_number}" ]] \
          || aegis_fatal "duplicate_issue_argument"

        cli_issue_number="${1#--issue=}"
        ;;
      --target)
        shift

        [[ "$#" -gt 0 ]] \
          || aegis_fatal "missing_target_path"

        [[ -z "${cli_target_path}" ]] \
          || aegis_fatal "duplicate_target_argument"

        cli_target_path="$1"
        ;;
      --target=*)
        [[ -z "${cli_target_path}" ]] \
          || aegis_fatal "duplicate_target_argument"

        cli_target_path="${1#--target=}"
        ;;
      --force-apply)
        export AEGIS_FORCE_APPLY="true"
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
        aegis_fatal "unknown_argument: $1"
        ;;
      *)
        positional_args+=("$1")
        ;;
    esac

    shift
  done

  if [[ -n "${cli_issue_number}" ]]; then
    [[ "${cli_issue_number}" =~ ^[0-9]+$ ]] \
      || aegis_fatal "invalid_issue_number"

    [[ "${#positional_args[@]}" -eq 0 ]] \
      || aegis_fatal "mixed_investigation_input_forms"

    # Real body via gh — never the opaque placeholder "issue #N".
    cli_investigation_input="$(aegis_fetch_issue_demand "${cli_issue_number}")"
  elif [[ "${#positional_args[@]}" -gt 0 ]]; then
    if [[ -z "${cli_target_path}" ]] && [[ -d "${positional_args[0]}" ]]; then
      cli_target_path="${positional_args[0]}"
      positional_args=("${positional_args[@]:1}")
    fi

    cli_investigation_input="${positional_args[*]}"
  fi

  # Soft-normalize structured markdown + mechanical path safety.
  # Free-text demands pass through unchanged (aside from path checks).
  if [[ -n "${cli_investigation_input}" ]]; then
    cli_investigation_input="$(
      aegis_materialize_investigation_input "${cli_investigation_input}"
    )"
  fi

  if [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    && [[ -n "${cli_investigation_input}" ]] \
    && [[ "${AEGIS_INVESTIGATION_INPUT}" != "${cli_investigation_input}" ]]; then
    # Env may already hold a materialised demand (pipeline re-entry).
    # Re-materialise the env value for an apples-to-apples compare only
    # when the CLI form differs in surface text.
    local env_materialised
    env_materialised="$(
      aegis_materialize_investigation_input "${AEGIS_INVESTIGATION_INPUT}"
    )"
    if [[ "${env_materialised}" != "${cli_investigation_input}" ]]; then
      aegis_fatal "investigation_input_conflict"
    fi
    cli_investigation_input="${env_materialised}"
  fi

  AEGIS_MODE="${cli_mode}"

  if [[ -n "${cli_investigation_input}" ]]; then
    export AEGIS_INVESTIGATION_INPUT="${cli_investigation_input}"
  elif [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]]; then
    # Env-only demand (tests / outer pipeline): still normalise + scrub.
    export AEGIS_INVESTIGATION_INPUT="$(
      aegis_materialize_investigation_input "${AEGIS_INVESTIGATION_INPUT}"
    )"
  fi

  if [[ -n "${cli_target_path}" ]]; then
    [[ -d "${cli_target_path}" ]] \
      || aegis_fatal "target_path_not_directory"

    export AEGIS_EVIDENCE_TARGET_PATH="${cli_target_path}"
  fi
}

AEGIS_MODE=""
AEGIS_SKILL_FILE=""

parse_runtime_cli "$@"

# =========================================================
# ACTIVE MODE / EXECUTION SURFACE PATH
# =========================================================

# The epistemic feedback loop can re-enter the pipeline in repair mode,
# so the active mode (and its derived skill/surface paths) is mutable
# runtime state rather than a readonly constant.
set_active_mode() {

  AEGIS_MODE="$1"
  AEGIS_SKILL_FILE=".skills/${AEGIS_MODE}.md"

  export AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_ROOT}/${AEGIS_MODE}"

  AEGIS_EXECUTION_SURFACE_ACTIVE="false"
}

set_active_mode "${AEGIS_MODE}"

# =========================================================
# EPISTEMIC FEEDBACK LOOP STATE
# =========================================================

# Automated repair feedback: a rejected validation verdict loops the
# pipeline back into repair mode (hard ceiling below). Operator gate
# for environments that cannot run the mutation substrate.
AEGIS_REPAIR_ATTEMPT_COUNT=0
# Local repair budget (no rediscovery): rejected validation re-enters
# repair → optimize → adversarial → validation up to this many times.
: "${AEGIS_MAX_REPAIR_ATTEMPTS:=2}"
: "${AEGIS_REPAIR_FEEDBACK_LOOP:=true}"
export AEGIS_MAX_REPAIR_ATTEMPTS
export AEGIS_REPAIR_FEEDBACK_LOOP
# Optimize advisory → one Repair refine pass (cap 1; no infinite loop).
AEGIS_OPTIMIZE_REPAIR_COUNT=0
: "${AEGIS_MAX_OPTIMIZE_REPAIR_ATTEMPTS:=1}"
: "${AEGIS_OPTIMIZE_REPAIR_LOOP:=true}"
export AEGIS_MAX_OPTIMIZE_REPAIR_ATTEMPTS
export AEGIS_OPTIMIZE_REPAIR_LOOP

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
  handover_schema_is_valid "${handover_file}" || return 0
  jq -r '
    .artifact_snapshot.investigation_input? // empty
    | select(type == "string" and length > 0)
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
    aegis_fatal "investigation_input_mismatch"
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

  # Capture the terminating status BEFORE any command in this handler can
  # overwrite $?. A non-zero code means abnormal termination — a fatal
  # provider error, a validation-rejection abort, or any unhandled failure
  # under `set -Eeuo pipefail`.
  local exit_code=$?

  set +e

  aegis_log "Starting runtime-owned cleanup (exit_code=${exit_code})..."

  if [[ "${exit_code}" -ne 0 ]]; then
    # ABSOLUTE CLEANUP INVARIANT: abnormal termination must never leave a
    # disposable git worktree or intermediate execution surface behind,
    # regardless of the retention policy that governs clean exits. Force a
    # comprehensive expunge of every disposable surface under the root —
    # not just the current mode's — since a partial feedback pipeline may
    # have materialized siblings before failing.
    aegis_warn "Abnormal termination — forcing disposable surface expunge (retention policy overridden)"
    expurge_disposable_execution_surfaces
    remove_runtime_owned_capability_surfaces false
  else
    # Clean exit: honor the operator's retention policy, but still expunge
    # ALL disposable surfaces (not only the current mode's) so a completed
    # multi-mode feedback pipeline never orphans intermediate worktrees.
    if [[ "${AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE}" == "true" ]]; then
      expurge_disposable_execution_surfaces
    fi
    remove_runtime_owned_capability_surfaces
  fi

  # Outcome projection: exactly one kind:"outcome" per logical run.
  # When AEGIS_PIPELINE_DRIVER=1, run_aegis.sh owns the projection at
  # show_final_report — cleanup stays silent (no double-emit / no mode spam).
  # Standalone runtime (flag unset): fail → block+metric; success → metric only.
  if [[ "${AEGIS_PIPELINE_DRIVER:-0}" != "1" ]]; then
    local outcome_status outcome_reason outcome_class
    local last_fatal_file="${AEGIS_RUNTIME_DIR:-.harness/runtime}/last_fatal"

    if [[ "${exit_code}" -ne 0 ]]; then
      outcome_status="FAILED"
      outcome_reason=""
      if [[ -f "${last_fatal_file}" ]]; then
        outcome_reason="$(tr -d '\r' < "${last_fatal_file}" | head -n 1)"
      fi
      aegis_classify_reason "${outcome_reason}" >/dev/null
      outcome_class="${AEGIS_OUTCOME_CLASS:-unknown}"
      aegis_emit_outcome_block "${outcome_status}" "${outcome_reason}"
      aegis_append_outcome_metric \
        "${outcome_status}" \
        "${outcome_reason}" \
        "${outcome_class}" \
        "${AEGIS_MODE:-}"
    else
      aegis_append_outcome_metric "SUCCESS" "" "" "${AEGIS_MODE:-}"
    fi
  fi

  aegis_log "Runtime cleanup completed"

  set -e
}

trap cleanup_runtime EXIT

# ---------------------------------------------------------
# Atomic signal guard (SIGINT / SIGTERM)
# ---------------------------------------------------------

AEGIS_SIGNAL_GUARD_FIRED="false"

# Expurge every disposable execution surface under the surface root,
# not only the current mode's — an interrupted earlier run may have
# left siblings behind.
expurge_disposable_execution_surfaces() {

  local surface

  for surface in "${AEGIS_EXECUTION_SURFACE_ROOT}"/*/; do
    [[ -d "${surface}" ]] || continue

    git worktree remove \
      --force \
      "${surface%/}" \
      >/dev/null 2>&1 || true

    rm -rf "${surface%/}" >/dev/null 2>&1 || true
  done

  git worktree prune \
    >/dev/null 2>&1 || true
}

handle_runtime_termination_signal() {

  local signal_name="$1"
  local exit_code="$2"

  # Re-entrancy latch: a second signal during cleanup must not restart
  # the sequence or recurse through the traps.
  if [[ "${AEGIS_SIGNAL_GUARD_FIRED}" == "true" ]]; then
    exit "${exit_code}"
  fi
  AEGIS_SIGNAL_GUARD_FIRED="true"

  # Atomic sequence: no further signal interleaving, and the EXIT trap
  # is disarmed so cleanup cannot run twice with conflicting policies.
  trap '' INT TERM
  trap - EXIT

  set +e

  aegis_warn "Interrupted by ${signal_name} — executing atomic signal cleanup"

  expurge_disposable_execution_surfaces

  # Transient runtime residues are force-removed on interruption,
  # regardless of the retention policy that governs normal exits.
  remove_runtime_owned_capability_surfaces false

  aegis_warn "Signal cleanup completed — exiting ${exit_code}"

  exit "${exit_code}"
}

trap 'handle_runtime_termination_signal SIGINT 130' INT
trap 'handle_runtime_termination_signal SIGTERM 143' TERM


# jq -e against the epistemic handover or fatal with the given code.
assert_handover_precondition() {
  local fatal_code="$1"
  local filter="$2"
  jq -e "${filter}" "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 \
    || aegis_fatal "${fatal_code}"
}

# Shared shape: prior mode left a non-empty candidate_result.diff + files_changed.
readonly AEGIS_JQ_HANDOVER_CANDIDATE_RESULT='
  (.artifact_snapshot.operational_context.candidate_result | type == "object")
  and (.artifact_snapshot.operational_context.candidate_result.diff
        | type == "string" and length > 0 and . != "(no changes)")
  and (.artifact_snapshot.operational_context.candidate_result.files_changed
        | type == "array" and length > 0)
'

validate_mode_preconditions() {
  [[ "${AEGIS_MODE}" == "discovery" ]] && return 0

  [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]] \
    || aegis_fatal "missing_epistemic_handover_for_mode: ${AEGIS_MODE}"

  case "${AEGIS_MODE}" in
    forensics)
      assert_handover_precondition \
        "precondition_failed_discovery_artifact_missing_or_invalid" \
        '.artifact_snapshot != null and .artifact_snapshot.mode == "discovery"'
      ;;
    repair)
      # Feedback re-entry: rejected validation + structured repair_feedback.
      if [[ "${AEGIS_REPAIR_ATTEMPT_COUNT}" -gt 0 ]]; then
        assert_handover_precondition \
          "precondition_failed_structured_repair_feedback_missing_or_invalid" \
          '.artifact_snapshot != null
           and .artifact_snapshot.mode == "validation"
           and .artifact_snapshot.operational_context.verdict == "rejected"
           and (.artifact_snapshot.operational_context.repair_feedback | type == "object")
           and (.artifact_snapshot.operational_context.repair_feedback.violations | type == "array")
           and (.artifact_snapshot.operational_context.repair_feedback.authorized_scopes | type == "array")'
        return 0
      fi
      # Optimize advisory → repair refine (can_improve + repair_feedback).
      if [[ "${AEGIS_OPTIMIZE_REPAIR_COUNT}" -gt 0 ]]; then
        assert_handover_precondition \
          "precondition_failed_optimize_improve_feedback_missing_or_invalid" \
          '.artifact_snapshot != null
           and .artifact_snapshot.mode == "optimize"
           and .artifact_snapshot.operational_context.status == "can_improve"
           and (.artifact_snapshot.operational_context.repair_feedback | type == "object")
           and (.artifact_snapshot.operational_context.repair_feedback.violations | type == "array")
           and (.artifact_snapshot.operational_context.repair_feedback.authorized_scopes | type == "array")
           and (.artifact_snapshot.operational_context.candidate_result.diff
                | type == "string" and length > 0 and . != "(no changes)")'
        return 0
      fi
      assert_handover_precondition \
        "precondition_failed_forensics_artifact_missing_or_invalid" \
        '.artifact_snapshot != null
         and .artifact_snapshot.mode == "forensics"
         and (.artifact_snapshot.operational_context.repair_candidates
              | type == "array" and length > 0)'
      ;;
    optimize)
      assert_handover_precondition \
        "precondition_failed_repair_candidate_missing_or_invalid" \
        '.artifact_snapshot != null
         and .artifact_snapshot.mode == "repair"
         and (.artifact_snapshot.operational_context.diff
              | type == "string" and length > 0 and . != "(no changes)")
         and (.artifact_snapshot.operational_context.files_changed
              | type == "array" and length > 0)'
      ;;
    adversarial)
      assert_handover_precondition \
        "precondition_failed_optimize_candidate_missing_or_invalid" \
        ".artifact_snapshot != null
         and .artifact_snapshot.mode == \"optimize\"
         and (${AEGIS_JQ_HANDOVER_CANDIDATE_RESULT})"
      ;;
    validation)
      assert_handover_precondition \
        "precondition_failed_findings_missing_or_invalid" \
        ".artifact_snapshot != null
         and .artifact_snapshot.mode == \"adversarial\"
         and (${AEGIS_JQ_HANDOVER_CANDIDATE_RESULT})
         and (.artifact_snapshot.operational_context.findings | type == \"array\")"
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
        || aegis_fatal "missing_aider_binary"
      ;;
  esac
}

validate_runtime_environment() {

  aegis_log "Initializing runtime..."

  local required_commands=(
    git
    jq
  )

  local command_name
  for command_name in "${required_commands[@]}"; do
    command -v "${command_name}" >/dev/null 2>&1 \
      || aegis_fatal "missing_dependency: ${command_name}"
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
      || aegis_fatal "missing_runtime_variable: ${runtime_var}"
  done

  declare -p AEGIS_EXECUTION_ENGINES >/dev/null 2>&1 \
    || aegis_fatal "missing_execution_engine_registry"

  declare -p AEGIS_MODE_CAPABILITY_MAP >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_envelope_registry"

  declare -p AEGIS_MODE_EVIDENCE_PROFILE >/dev/null 2>&1 \
    || aegis_fatal "missing_evidence_profile_registry"

  # Discovery is runtime-mechanical only — no model skill contract required.
  if [[ "${AEGIS_MODE}" != "discovery" ]]; then
    [[ -f "${AEGIS_SKILL_FILE}" ]] \
      || aegis_fatal "missing_skill_contract"
  fi

  [[ -n "${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}" ]] \
    || aegis_fatal "unknown_mode"

  [[ -n "${AEGIS_MODE_EVIDENCE_PROFILE[$AEGIS_MODE]:-}" ]] \
    || aegis_fatal "missing_mode_evidence_profile"

  validate_execution_engine_requirements
}

# =========================================================
# RUNTIME BOOTSTRAP
# =========================================================

bootstrap_runtime_state() {

  mkdir -p "${AEGIS_RUNTIME_DIR}"

  # Anti-staleness: never let a previous run's fatal breadcrumb pollute
  # this run's outcome projection (pipeline driver clears it too).
  rm -f "${AEGIS_RUNTIME_DIR}/last_fatal" 2>/dev/null || true

  prepare_runtime_owned_epistemic_handover \
    "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

  resolve_runtime_investigation_input
}

# =========================================================
# RESIDUE CLEANUP
# =========================================================

remove_stale_runtime_residue() {

  aegis_log "Removing stale execution-surface residue..."

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
    aegis_log "Skipping disposable execution surface for mode without execution-surface requirements..."
    return
  fi

  aegis_log "Preparing disposable execution surface..."

  mkdir -p "${AEGIS_EXECUTION_SURFACE_ROOT}"

  git worktree add \
    --force \
    --detach \
    "${AEGIS_EXECUTION_SURFACE_PATH}" \
    HEAD \
    >/dev/null

  [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] \
    || aegis_fatal "failed_to_materialize_execution_surface"

  AEGIS_EXECUTION_SURFACE_ACTIVE="true"
}

materialize_preceding_mutation_candidate() {
  # Repair refine after optimize: re-apply Repair candidate, then Aider
  # applies only optimize_feedback improvements on that surface.
  if [[ "${AEGIS_MODE}" == "repair" ]] \
    && [[ "${AEGIS_OPTIMIZE_REPAIR_COUNT}" -gt 0 ]] \
    && mode_requires_execution_surface; then
    aegis_log "Materializing Repair candidate for optimize→repair refine..."
    bash scripts/runtime/apply_candidate_diff.sh \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
      "${AEGIS_EXECUTION_SURFACE_PATH}" \
      || aegis_fatal "failed_to_materialize_repair_candidate_for_optimize_refine"
    return 0
  fi
  return 0
}

# =========================================================
# CAPABILITY SURFACES
# =========================================================

prepare_runtime_owned_capability_surfaces() {

  aegis_log "Preparing runtime-owned capability surfaces..."

  remove_runtime_owned_capability_surfaces false

  mkdir -p "${AEGIS_CAPABILITY_ENV_DIR}"
  mkdir -p "${AEGIS_CAPABILITY_PAYLOAD_DIR}"

  [[ -d "${AEGIS_CAPABILITY_ENV_DIR}" ]] \
    || aegis_fatal "failed_to_prepare_capability_environment"

  [[ -d "${AEGIS_CAPABILITY_PAYLOAD_DIR}" ]] \
    || aegis_fatal "failed_to_prepare_capability_payload_directory"
}

# =========================================================
# CAPABILITY MANIFEST
# =========================================================

materialize_runtime_owned_capability_manifest() {

  aegis_log "Generating runtime-owned capability manifest..."

  export AEGIS_CAPABILITY_MANIFEST="$(
    bash scripts/capabilities/generate_manifest.sh
  )"

  [[ -n "${AEGIS_CAPABILITY_MANIFEST}" ]] \
    || aegis_fatal "missing_runtime_owned_capability_manifest"

  printf '%s\n' "${AEGIS_CAPABILITY_MANIFEST}" \
    | jq empty \
      >/dev/null 2>&1 \
    || aegis_fatal "invalid_runtime_owned_capability_manifest"
}

# =========================================================
# EXECUTION
# =========================================================

execute_mode() {

  aegis_log "Executing mode: ${AEGIS_MODE}"

  local execution_output
  local artifact_payload

  execution_output="$(
    bash scripts/execute_mode.sh \
      "${AEGIS_SKILL_FILE}" \
      "${AEGIS_MODE}" \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
  )"

  echo "${execution_output}"

  [[ "${execution_output}" == *"${AEGIS_ARTIFACT_BEGIN_MARKER}"* ]] \
    && [[ "${execution_output}" == *"${AEGIS_ARTIFACT_END_MARKER}"* ]] \
    || aegis_fatal "missing_artifact"

  artifact_payload="${execution_output#*"${AEGIS_ARTIFACT_BEGIN_MARKER}"}"
  artifact_payload="${artifact_payload%%"${AEGIS_ARTIFACT_END_MARKER}"*}"

  [[ -n "${artifact_payload//[[:space:]]/}" ]] \
    || aegis_fatal "empty_artifact_payload"

  printf '%s\n' "${artifact_payload}" \
    | jq empty \
      >/dev/null 2>&1 \
    || aegis_fatal "invalid_promoted_artifact_json"

  # Shell variable only — large validated diffs must not enter the
  # environment or later fork/exec calls fail with E2BIG.
  AEGIS_PROMOTED_ARTIFACT_PAYLOAD="$(
    printf '%s\n' "${artifact_payload}" | jq -c 'select(type == "object")'
  )"

  [[ -n "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" ]] \
    || aegis_fatal "invalid_promoted_artifact_shape"

  aegis_log "Execution completed successfully"
}

promote_validated_candidate() {

  local promotion_payload="${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}"

  if [[ "${AEGIS_MODE}" != "validation" ]]; then

    # Operator override path: an explicit --force-apply on the final mode
    # of a partial run promotes the candidate WITHOUT a validation
    # verdict. Scope is deliberately narrow: the mode's artifact must
    # carry a runtime-owned candidate_result, the synthesized envelope is
    # tagged "operator_forced" (never "accepted"), and every structural
    # rail in promote_validated_candidate.sh (path jail, files_changed
    # cross-check, dirty-target refusal, atomic apply) still gates it.
    # return 0 explicitly: a bare `return` here would propagate the failed
    # test's status 1 and set -e would abort the runtime post-execution.
    [[ "${AEGIS_FORCE_APPLY:-false}" == "true" ]] || return 0

    local forced_candidate
    forced_candidate="$(
      printf '%s' "${promotion_payload}" \
        | jq -c '.candidate_result // empty' 2>/dev/null
    )"

    if [[ -z "${forced_candidate}" ]]; then
      aegis_warn "force_apply_requested_but_no_candidate_result_in_mode: ${AEGIS_MODE}"
      return
    fi

    aegis_warn "FORCE-APPLY: promoting UNVALIDATED candidate from mode '${AEGIS_MODE}' (explicit operator override — no validation verdict exists for this diff)"

    promotion_payload="$(
      jq -cn --argjson candidate "${forced_candidate}" \
        '{mode: "validation", verdict: "operator_forced", validated_candidate: $candidate}'
    )" || aegis_fatal "force_apply_envelope_synthesis_failed"

  else

    local verdict
    verdict="$(
      printf '%s' "${promotion_payload}" \
        | jq -r '.verdict // empty'
    )"

    if [[ "${verdict}" != "accepted" ]]; then
      aegis_log "Validation verdict does not authorize mutation promotion: ${verdict}"
      return
    fi

  fi

  local validation_artifact_file
  validation_artifact_file="$(mktemp)"
  printf '%s' "${promotion_payload}" \
    > "${validation_artifact_file}"

  local promotion_rc=0
  local promotion_log
  promotion_log="$(mktemp)"
  set +e
  bash scripts/runtime/promote_validated_candidate.sh \
    "${validation_artifact_file}" \
    "${AEGIS_RUNTIME_ROOT}" \
    >"${promotion_log}" 2>&1
  promotion_rc=$?
  set -e

  # Always surface promoter output (success or failure diagnostics).
  cat "${promotion_log}" >&2 || true

  if [[ "${promotion_rc}" -ne 0 ]]; then
    local promo_diag=""
    promo_diag="$(
      command grep '\[PROMOTION\]' "${promotion_log}" 2>/dev/null \
        | command tail -n 3 \
        | tr '\n' ' ' \
        || true
    )"
    rm -f "${validation_artifact_file}" "${promotion_log}"
    if [[ -n "${promo_diag}" ]]; then
      aegis_fatal "validated_candidate_promotion_failed: ${promo_diag}"
    fi
    aegis_fatal "validated_candidate_promotion_failed"
  fi

  rm -f "${validation_artifact_file}" "${promotion_log}"
}

# =========================================================
# EPISTEMIC HANDOVER
# =========================================================

promote_epistemic_handover() {

  aegis_log "Updating epistemic handover..."

  [[ -n "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD:-}" ]] \
    || aegis_fatal "missing_promoted_artifact_for_handover"

  local handover_json

  # Snapshot keys: mode, investigation_input, generated_at, operational_context
  # only (structural_context removed with deep topology).
  # Mechanical demand anchors (stable across modes). Prefer recompute
  # from investigation input + current handover/payloads; never LLM prose.
  local demand_anchors_json="{}"
  if declare -f aegis_materialize_demand_anchors_json >/dev/null 2>&1; then
    demand_anchors_json="$(
      aegis_materialize_demand_anchors_json \
        "${AEGIS_INVESTIGATION_INPUT:-}" \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}" \
        "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
        2>/dev/null || printf '{}'
    )"
  fi
  if ! printf '%s' "${demand_anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    demand_anchors_json="{}"
  fi

  handover_json="$(
    printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD}" |
      jq -c \
        --arg generated_at "${AEGIS_EXECUTION_TIMESTAMP}" \
        --arg investigation_input "${AEGIS_INVESTIGATION_INPUT}" \
        --argjson demand_anchors "${demand_anchors_json}" '
        . as $orig
        | (
            if ($orig | has("operational_context")) then $orig.operational_context
            else ($orig | del(.handover_attention, .mode, .investigation_input, .generated_at,
                              .structural_context))
            end
          ) as $oc
        | ($oc + {demand_anchors: $demand_anchors}) as $oc_anchored
        | {
            artifact_snapshot: {
              mode: $orig.mode,
              investigation_input: $investigation_input,
              generated_at: (if $orig | has("generated_at") then $orig.generated_at else $generated_at end),
              operational_context: $oc_anchored
            },
            epistemic_state: (
              $orig.handover_attention // {
                next_attention_targets: [],
                attention_scope: "none",
                attention_reason: "no active attention"
              }
            )
          }
      '
  )" || aegis_fatal "failed_to_materialize_handover"

  local handover_parts
  mapfile -t handover_parts < <(
    printf '%s' "${handover_json}" | jq -c '.artifact_snapshot, .epistemic_state'
  )

  write_runtime_owned_epistemic_handover \
    "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
    "${handover_parts[0]}" \
    "${handover_parts[1]}"

  assert_valid_runtime_owned_epistemic_handover \
    "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
    "invalid_epistemic_handover_after_mode_execution" \
    "epistemic_handover_after_mode_execution_exceeds_max_bytes"
}

# =========================================================
# MAIN
# =========================================================

run_mode_pipeline() {
  # Timing labels carry the active mode so feedback iterations report
  # under their own mode metrics instead of contaminating the metrics
  # of the mode the runtime was invoked with.
  validate_runtime_environment
  bootstrap_runtime_state
  reset_runtime_owned_epistemic_handover_for_new_investigation
  validate_mode_preconditions
  remove_stale_runtime_residue
  measure "runtime_prepare_execution_surface:${AEGIS_MODE}" prepare_execution_surface
  measure "runtime_materialize_preceding_mutation_candidate:${AEGIS_MODE}" materialize_preceding_mutation_candidate
  prepare_runtime_owned_capability_surfaces
  measure "runtime_materialize_manifest:${AEGIS_MODE}" materialize_runtime_owned_capability_manifest
  measure "runtime_execute_mode:${AEGIS_MODE}" execute_mode
  measure "runtime_promote_validated_candidate:${AEGIS_MODE}" promote_validated_candidate
  promote_epistemic_handover
}

# Returns 0 when the pipeline must loop back into repair mode. Enforces
# the hard attempt ceiling fatally. The epistemic handover is NOT reset
# on re-entry: the rejected validation findings stay in place so the
# next repair iteration exposes the failure context to the substrate.
repair_feedback_loop_should_fire() {

  [[ "${AEGIS_REPAIR_FEEDBACK_LOOP}" == "true" ]] || return 1
  [[ "${AEGIS_MODE}" == "validation" ]] || return 1

  local verdict
  verdict="$(
    printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD:-}" \
      | jq -r '.verdict // empty' 2>/dev/null
  )"

  [[ "${verdict}" == "rejected" ]] || return 1

  if [[ "${AEGIS_REPAIR_ATTEMPT_COUNT}" -ge "${AEGIS_MAX_REPAIR_ATTEMPTS}" ]]; then
    aegis_fatal "max_repair_attempts_exceeded"
  fi

  AEGIS_REPAIR_ATTEMPT_COUNT=$((AEGIS_REPAIR_ATTEMPT_COUNT + 1))
  aegis_warn "Validation rejected candidate — LOCAL repair feedback iteration ${AEGIS_REPAIR_ATTEMPT_COUNT}/${AEGIS_MAX_REPAIR_ATTEMPTS} (no rediscovery; scopes from repair_feedback)"

  if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
    jq -cn \
      --argjson attempt "${AEGIS_REPAIR_ATTEMPT_COUNT}" \
      --argjson max "${AEGIS_MAX_REPAIR_ATTEMPTS}" \
      '{kind:"repair_feedback",attempt:$attempt,max:$max}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  fi

  return 0
}

# Optimize advisory can_improve → one local Repair refine (not rediscovery).
optimize_improve_loop_should_fire() {
  [[ "${AEGIS_OPTIMIZE_REPAIR_LOOP}" == "true" ]] || return 1
  [[ "${AEGIS_MODE}" == "optimize" ]] || return 1

  local status
  status="$(
    printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD:-}" \
      | jq -r '.status // empty' 2>/dev/null
  )"
  [[ "${status}" == "can_improve" ]] || return 1

  if ! printf '%s' "${AEGIS_PROMOTED_ARTIFACT_PAYLOAD:-}" | jq -e '
      (.repair_feedback | type == "object")
      and (.repair_feedback.violations | type == "array" and length > 0)
      and (.repair_feedback.authorized_scopes | type == "array" and length > 0)
    ' >/dev/null 2>&1; then
    return 1
  fi

  if [[ "${AEGIS_OPTIMIZE_REPAIR_COUNT}" -ge "${AEGIS_MAX_OPTIMIZE_REPAIR_ATTEMPTS}" ]]; then
    aegis_warn "optimize_improve_cap: already refined once — continuing with candidate (no further optimize→repair)"
    return 1
  fi

  AEGIS_OPTIMIZE_REPAIR_COUNT=$((AEGIS_OPTIMIZE_REPAIR_COUNT + 1))
  aegis_warn "Optimize can_improve — LOCAL repair refine ${AEGIS_OPTIMIZE_REPAIR_COUNT}/${AEGIS_MAX_OPTIMIZE_REPAIR_ATTEMPTS}"

  if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
    jq -cn \
      --argjson attempt "${AEGIS_OPTIMIZE_REPAIR_COUNT}" \
      --argjson max "${AEGIS_MAX_OPTIMIZE_REPAIR_ATTEMPTS}" \
      '{kind:"optimize_improve",attempt:$attempt,max:$max}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  fi

  return 0
}

# Downstream progression for feedback iterations: a re-entered repair
# must roll forward through the entire optimization and verification
# stack. Terminal state is validation — success is only ever reached
# through an explicit "accepted" verdict from a fresh validation pass.
AEGIS_FEEDBACK_PIPELINE_ACTIVE="false"

# Authoritative feedback progression (re-entered repair → validation).
readonly AEGIS_FEEDBACK_MODE_SEQUENCE="repair optimize adversarial validation"

next_feedback_pipeline_mode() {
  aegis_next_in_sequence "${AEGIS_MODE}" "${AEGIS_FEEDBACK_MODE_SEQUENCE}"
}

main() {

  local next_mode

  while :; do
    run_mode_pipeline

    # Optimize advisory: can_improve → repair refine once, then continue
    # repair → optimize → … (optimize will no-op/cap on second visit).
    if optimize_improve_loop_should_fire; then
      AEGIS_PROMOTED_ARTIFACT_PAYLOAD=""
      AEGIS_FEEDBACK_PIPELINE_ACTIVE="true"
      set_active_mode "repair"
      continue
    fi

    # A rejected fresh validation verdict re-enters the mutation stack
    # (or aborts fatally at the attempt ceiling).
    if repair_feedback_loop_should_fire; then
      AEGIS_PROMOTED_ARTIFACT_PAYLOAD=""
      AEGIS_FEEDBACK_PIPELINE_ACTIVE="true"
      set_active_mode "repair"
      continue
    fi

    # Inside a feedback iteration, roll forward through the mandatory
    # downstream stages until the pipeline reaches validation again.
    if [[ "${AEGIS_FEEDBACK_PIPELINE_ACTIVE}" == "true" ]]; then
      next_mode="$(next_feedback_pipeline_mode)"

      if [[ -n "${next_mode}" ]]; then
        aegis_log "Feedback pipeline progression: ${AEGIS_MODE} -> ${next_mode}"
        AEGIS_PROMOTED_ARTIFACT_PAYLOAD=""
        set_active_mode "${next_mode}"
        continue
      fi
    fi

    break
  done
}

main "$@"
