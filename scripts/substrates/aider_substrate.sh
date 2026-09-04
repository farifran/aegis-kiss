#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — AIDER MUTATION SUBSTRATE
# =========================================================
#
# Bounded mutation inside a disposable worktree: resolve targets,
# invoke aider, capture diff, preflight, emit candidate artifact.
# Does not commit/push or promote (runtime owns that).
#
# Implementation split under scripts/substrates/aider/:
#   targets.sh  prompt.sh  invoke.sh  preflight.sh
#
# =========================================================

set -Eeuo pipefail

readonly AEGIS_AIDER_SUBSTRATE_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

cd "${AEGIS_AIDER_SUBSTRATE_ROOT}"

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][AIDER][FATAL] missing_config" >&2
  exit 1
}

# Model is mandatory for cognition substrates.
export AEGIS_REQUIRE_MODEL=1

source ".harness/config.sh"

# The request timeout is already the primary bound.  Keep only a small
# watchdog margin so a simple demand cannot spend six minutes in one Aider
# invocation merely because the child process stopped making progress.
: "${AEGIS_AIDER_TIMEOUT:=${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-120}}"
: "${AEGIS_AIDER_WATCHDOG_GRACE_SEC:=15}"
_aider_wallclock_floor=$(( AEGIS_AIDER_TIMEOUT + AEGIS_AIDER_WATCHDOG_GRACE_SEC ))
: "${AEGIS_AIDER_MAX_SECONDS:=${_aider_wallclock_floor}}"
unset _aider_wallclock_floor

readonly AIDER_SKILL_FILE="${1:-}"
readonly AIDER_CAPABILITY_PAYLOAD_DIR="${2:-}"

AEGIS_AIDER_OUTPUT_LOG=""

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
# shellcheck disable=SC1091
source "scripts/lib/demand.sh"
# shellcheck disable=SC1091
source "scripts/lib/briefing.sh"
# shellcheck disable=SC1091
source "scripts/lib/mutation_helpers.sh"
AEGIS_LOG_TAG="AIDER"

# shellcheck disable=SC1091
source "scripts/substrates/aider/targets.sh"
# shellcheck disable=SC1091
source "scripts/substrates/aider/prompt.sh"
# shellcheck disable=SC1091
source "scripts/substrates/aider/invoke.sh"
# shellcheck disable=SC1091
source "scripts/substrates/aider/preflight.sh"

validate_aider_substrate_inputs() {
  [[ -n "${AEGIS_EXECUTION_SURFACE_PATH:-}" ]] \
    || aegis_fatal "missing_execution_surface_path"
  [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] \
    || aegis_fatal "execution_surface_not_materialized"
  [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    || aegis_fatal "missing_investigation_input"
  [[ -n "${AEGIS_MODE:-}" ]] \
    || aegis_fatal "missing_execution_mode"
  [[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
    || aegis_fatal "missing_execution_id"
  [[ -n "${AEGIS_AIDER_MODEL:-}" ]] \
    || aegis_fatal "missing_aider_model"
  [[ -f "${AIDER_SKILL_FILE}" ]] \
    || aegis_fatal "missing_skill_file"
  [[ -d "${AIDER_CAPABILITY_PAYLOAD_DIR}" ]] \
    || aegis_fatal "missing_capability_payload_directory"
  command -v git >/dev/null 2>&1 \
    || aegis_fatal "missing_dependency_git"

  if [[ ! -x "${AEGIS_AIDER_BIN:-}" ]]; then
    if command -v aider >/dev/null 2>&1; then
      export AEGIS_AIDER_BIN="$(command -v aider)"
    else
      aegis_fatal "missing_aider_binary"
    fi
  fi

  [[ -d "${AEGIS_MUTATION_GIT_DIR:-}" ]] \
    || aegis_fatal "missing_mutation_git_directory"
}

main() {
  validate_aider_substrate_inputs

  scope_mutation_git_dir_to_surface

  aegis_log "Resolving mutation targets..."

  local mutation_targets=()
  while IFS= read -r target; do
    [[ -z "${target}" ]] && continue
    mutation_targets+=("${target}")
  done < <(resolve_mutation_targets | sanitize_mutation_targets)

  if [[ "${#mutation_targets[@]}" -eq 0 ]]; then
    aegis_warn "no_mutation_targets_resolved — using investigation input only"
  else
    aegis_log "Mutation targets: ${mutation_targets[*]}"
  fi

  # Optimize uses the raw engine (mechanical trivial-skip / advise). Aider
  # is mutation-only; mis-route is a hard fatal rather than a silent refine.
  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    aegis_fatal "optimize_uses_raw_engine_not_aider"
  fi

  # optimize→mutation refine could not re-apply the prior candidate on the
  # disposable surface. Re-emit that candidate; do not invoke Aider on HEAD
  # (would replace the pipeline candidate with an incomplete/wrong patch).
  if [[ "${AEGIS_MUTATION_KEEP_PREVIOUS_CANDIDATE:-${AEGIS_BUILD_KEEP_PREVIOUS_CANDIDATE:-0}}" == "1" ]]; then
    local prev_diff=""
    local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
    if [[ -n "${handover}" && -f "${handover}" ]]; then
      prev_diff="$(
        jq -r '
          .artifact_snapshot as $s
          | if $s.mode == "optimize" then
              $s.operational_context.candidate_result.diff // empty
            elif ($s.mode == "mutation" or $s.mode == "build") then
              $s.operational_context.diff // empty
            else
              $s.operational_context.candidate_result.diff
                // $s.operational_context.diff // empty
            end
        ' "${handover}" 2>/dev/null || true
      )"
    fi
    if [[ -z "${prev_diff}" || "${prev_diff}" == "(no changes)" ]]; then
      aegis_fatal "mutation_passthrough_missing_previous_candidate"
    fi
    aegis_log "mutation_passthrough: materialize failed — re-emitting previous candidate (no refine)"
    # Do not wipe candidate_tools_stamp (hash still matches previous green run).
    export AEGIS_SKIP_CANDIDATE_TOOLS_STAMP=1
    emit_mutation_artifact "${prev_diff}"
    unset AEGIS_SKIP_CANDIDATE_TOOLS_STAMP 2>/dev/null || true
    aegis_log "Aider mutation substrate completed (previous-candidate passthrough)"
    return 0
  fi

  local diff_content=""
  local resolved_edit_format
  resolved_edit_format="$(resolve_aider_edit_format "${mutation_targets[@]:-}")"

  # -------------------------------------------------------
  # Mechanical fast paths (no LLM):
  #   reexport | export_slice class create | export_slice function append
  # -------------------------------------------------------
  local _mech_ok=0 _mt _surface_root
  _surface_root="${AEGIS_EXECUTION_SURFACE_PATH:-.}"

  # 1) Pure barrel reexport: HEAD(+empty) + additive import/export.
  # Only on index/barrel paths — never rewrite module creates as reexport.
  if [[ "${_mech_ok}" -eq 0 ]] \
    && declare -f aegis_demand_is_reexport_preserve >/dev/null 2>&1 \
    && declare -f aegis_mechanical_barrel_reexport_apply >/dev/null 2>&1 \
    && aegis_demand_is_reexport_preserve "${AEGIS_INVESTIGATION_INPUT:-}"; then
    for _mt in "${mutation_targets[@]:-}"; do
      [[ -n "${_mt}" ]] || continue
      case "${_mt}" in
        src/index.ts|*/index.ts|index.ts) ;;
        *) continue ;;
      esac
      if aegis_mechanical_barrel_reexport_apply \
        "${_mt}" \
        "${AEGIS_INVESTIGATION_INPUT}" \
        "${_surface_root}" \
        "1"; then
        _mech_ok=1
        aegis_log "mechanical_reexport: wrote ${_mt} (no aider)"
      fi
    done
  fi

  # 2) export_slice class: materialize Briefing → export class (net-new file).
  if [[ "${_mech_ok}" -eq 0 ]] \
    && declare -f aegis_mechanical_export_class_create >/dev/null 2>&1 \
    && declare -f aegis_demand_is_export_class_slice >/dev/null 2>&1 \
    && aegis_demand_is_export_class_slice "${AEGIS_INVESTIGATION_INPUT:-}"; then
    for _mt in "${mutation_targets[@]:-}"; do
      [[ -n "${_mt}" ]] || continue
      case "${_mt}" in
        src/index.ts|*/index.ts|index.ts) continue ;;
      esac
      if aegis_mechanical_export_class_create \
        "${_mt}" \
        "${AEGIS_INVESTIGATION_INPUT}" \
        "${_surface_root}"; then
        _mech_ok=1
        aegis_log "mechanical_export_class: wrote ${_mt} (no aider)"
      fi
    done
  fi

  # 3) export_slice function on an existing module: append TS from Briefing.
  if [[ "${_mech_ok}" -eq 0 ]] \
    && declare -f aegis_mechanical_export_function_append >/dev/null 2>&1 \
    && declare -f aegis_demand_is_export_function_slice >/dev/null 2>&1 \
    && aegis_demand_is_export_function_slice "${AEGIS_INVESTIGATION_INPUT:-}"; then
    for _mt in "${mutation_targets[@]:-}"; do
      [[ -n "${_mt}" ]] || continue
      if aegis_mechanical_export_function_append \
        "${_mt}" \
        "${AEGIS_INVESTIGATION_INPUT}" \
        "${_surface_root}"; then
        _mech_ok=1
        aegis_log "mechanical_export_function: appended on ${_mt} (no aider)"
      fi
    done
  fi

  if [[ "${_mech_ok}" -eq 1 ]]; then
    # Register net-new paths for diff capture.
    for _mt in "${mutation_targets[@]:-}"; do
      [[ -n "${_mt}" && -f "${_surface_root}/${_mt}" ]] || continue
      git --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
        --work-tree="${_surface_root}" \
        add --intent-to-add -- "${_mt}" >/dev/null 2>&1 || true
    done
    diff_content="$(capture_worktree_diff)"
    if [[ -z "${diff_content}" ]]; then
      aegis_warn "mechanical_fast_path_empty_diff — falling through to aider"
      _mech_ok=0
    elif ! assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"; then
      aegis_warn "mechanical_fast_path_scope — falling through to aider"
      _mech_ok=0
    else
      # Tools preflight only; on failure fall through so aider can refine.
      local _pf_rc=0
      set +e
      diff_content="$(
        AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS=0 \
        AEGIS_MUTATION_INTENT_FIX_ATTEMPTS=0 \
          run_mutation_preflight_with_fix_attempts \
            "${resolved_edit_format}" \
            "${mutation_targets[@]:-}"
      )"
      _pf_rc=$?
      set -e
      if [[ "${_pf_rc}" -eq 0 && -n "${diff_content}" ]]; then
        if declare -f aegis_mechanical_shape_gate >/dev/null 2>&1 \
          && ! aegis_mechanical_shape_gate \
            "${AEGIS_INVESTIGATION_INPUT}" \
            "${_surface_root}" \
            "${mutation_targets[@]:-}"; then
          aegis_warn "mechanical_shape_gate_failed after preflight — not emitting"
        else
          aegis_log "mechanical_shape_gate: ok"
          aegis_log "Emitting mutation artifact (mechanical fast path)..."
          emit_mutation_artifact "${diff_content}"
          aegis_log "Aider mutation substrate completed (mechanical)"
          return 0
        fi
      fi
      aegis_warn "mechanical_fast_path_preflight_failed — re-apply mechanical (prefer Briefing fidelity over 8B rewrite)"
      # Preflight may have rolled back the surface. Re-materialize, then prefer
      # isolated tsc on the target: 8B "fix" often degrades quality (e.g. flips
      # rate number→bigint) while pure mechanical matches Briefing.
      for _mt in "${mutation_targets[@]:-}"; do
        [[ -n "${_mt}" ]] || continue
        if declare -f aegis_mechanical_export_class_create >/dev/null 2>&1; then
          aegis_mechanical_export_class_create \
            "${_mt}" "${AEGIS_INVESTIGATION_INPUT}" "${_surface_root}" 2>/dev/null || true
        fi
        if declare -f aegis_mechanical_export_function_append >/dev/null 2>&1; then
          aegis_mechanical_export_function_append \
            "${_mt}" "${AEGIS_INVESTIGATION_INPUT}" "${_surface_root}" 2>/dev/null || true
        fi
        case "${_mt}" in
          src/index.ts|*/index.ts|index.ts)
            if declare -f aegis_mechanical_barrel_reexport_apply >/dev/null 2>&1; then
              aegis_mechanical_barrel_reexport_apply \
                "${_mt}" "${AEGIS_INVESTIGATION_INPUT}" "${_surface_root}" "1" 2>/dev/null || true
            fi
            ;;
        esac
      done
      local _iso_ok=1
      for _mt in "${mutation_targets[@]:-}"; do
        [[ -n "${_mt}" && -f "${_surface_root}/${_mt}" ]] || continue
        if ! npx --yes tsc --noEmit --strict --target ES2022 \
          --module NodeNext --moduleResolution NodeNext \
          "${_surface_root}/${_mt}" >/dev/null 2>&1; then
          _iso_ok=0
          break
        fi
      done
      if [[ "${_iso_ok}" -eq 1 ]]; then
        for _mt in "${mutation_targets[@]:-}"; do
          [[ -n "${_mt}" && -f "${_surface_root}/${_mt}" ]] || continue
          git --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
            --work-tree="${_surface_root}" \
            add --intent-to-add -- "${_mt}" >/dev/null 2>&1 || true
        done
        diff_content="$(capture_worktree_diff)"
        if [[ -n "${diff_content}" ]] \
          && assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"; then
          if declare -f aegis_mechanical_shape_gate >/dev/null 2>&1 \
            && ! aegis_mechanical_shape_gate \
              "${AEGIS_INVESTIGATION_INPUT}" \
              "${_surface_root}" \
              "${mutation_targets[@]:-}"; then
            aegis_warn "mechanical_shape_gate_failed after isolated tsc — not emitting"
          else
            aegis_log "mechanical_shape_gate: ok"
            aegis_log "mechanical_isolated_tsc_ok: emitting without aider (quality-first)"
            emit_mutation_artifact "${diff_content}"
            aegis_log "Aider mutation substrate completed (mechanical isolated)"
            return 0
          fi
        fi
      fi
      aegis_warn "mechanical_isolated_tsc_failed — falling through to aider refine"
      _mech_ok=0
    fi
  fi

  local prompt_file
  prompt_file="$(aider_mktemp)"
  export AEGIS_CURRENT_PROMPT_FILE="${prompt_file}"
  assemble_mutation_prompt \
    "${prompt_file}" "${resolved_edit_format}" "${mutation_targets[@]:-}"
  invoke_aider \
    "${prompt_file}" "${resolved_edit_format}" "${mutation_targets[@]:-}"
  rm -f "${prompt_file}" 2>/dev/null || true
  unset AEGIS_CURRENT_PROMPT_FILE 2>/dev/null || true

  # Strip whole-format junk comments the 8B leaves on authorized files.
  if declare -f aegis_strip_aider_whole_file_junk_path >/dev/null 2>&1; then
    for _mt in "${mutation_targets[@]:-}"; do
      [[ -n "${_mt}" ]] || continue
      aegis_strip_aider_whole_file_junk_path "${_surface_root}/${_mt}" 2>/dev/null || true
    done
  fi

  aegis_log "Capturing worktree diff..."

  diff_content="$(capture_worktree_diff)"

  # Recovery: Aider logged Applied edit but capture is empty (intent-to-add
  # lost, untracked net-new, or summarizer crash). Re-register targets and retry.
  if [[ -z "${diff_content}" ]] \
    && [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]] \
    && grep -q "Applied edit" "${AEGIS_AIDER_OUTPUT_LOG}" 2>/dev/null; then
    aegis_warn "empty_diff_after_applied_edit — re-intent-to-add targets and recapture"
    local _t
    for _t in "${mutation_targets[@]:-}"; do
      [[ -n "${_t}" && -f "${AEGIS_EXECUTION_SURFACE_PATH}/${_t}" ]] || continue
      git --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
        --work-tree="${AEGIS_EXECUTION_SURFACE_PATH}" \
        add --intent-to-add -- "${_t}" >/dev/null 2>&1 || true
    done
    diff_content="$(capture_worktree_diff)"
  fi

  if [[ -z "${diff_content}" ]]; then
    if [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      echo "[DEBUG] Aider output log:" >&2
      cat "${AEGIS_AIDER_OUTPUT_LOG}" >&2
    fi
    rollback_execution_surface
    # When the provider never let the model answer, the demand is not the
    # problem: calling it mutation sends the operator (and the loop) off
    # rewriting a demand that was fine. provider is a stop class.
    if [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      if grep -qiE 'ratelimiterror|rate limited|429|too many requests' \
        "${AEGIS_AIDER_OUTPUT_LOG}" 2>/dev/null; then
        aegis_fatal "provider_retry_limit_exceeded"
      fi
      if grep -qiE 'authenticationerror|permissiondenied|error code: (401|403)' \
        "${AEGIS_AIDER_OUTPUT_LOG}" 2>/dev/null; then
        aegis_fatal "provider_authentication_failure"
      fi
      # 404 (model id gone), 5xx, connection errors — anything litellm
      # reports as a transport/API failure rather than a model answer.
      if grep -qiE 'litellm\.[A-Za-z]*Error|error code: [0-9]{3}|apiconnectionerror' \
        "${AEGIS_AIDER_OUTPUT_LOG}" 2>/dev/null; then
        aegis_fatal "provider_http_failure"
      fi
    fi
    mkdir -p "${AEGIS_RUNTIME_DIR:-.harness/runtime}" 2>/dev/null || true
    if [[ -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      cp "${AEGIS_AIDER_OUTPUT_LOG}" "${AEGIS_RUNTIME_DIR:-.harness/runtime}/substrate_stderr.log" 2>/dev/null || true
    fi
    printf '%s\n' "substrate_empty_diff_failure" > "${LAST_FATAL_FILE:-.harness/runtime/last_fatal}" 2>/dev/null || true
    aegis_fatal "empty_diff: aider produced no changes"
  fi

  if ! assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"; then
    aegis_fatal "mutation_scope_violation: after primary mutation"
  fi

  # Reexport units: if the model wiped pre-existing barrel exports, rebuild
  # the file from HEAD + additive import/export (issue #93 task 3 failure).
  if declare -f aegis_demand_is_reexport_preserve >/dev/null 2>&1 \
    && declare -f aegis_mechanical_barrel_reexport_apply >/dev/null 2>&1 \
    && aegis_demand_is_reexport_preserve "${AEGIS_INVESTIGATION_INPUT:-}"; then
    local _rt _merged=0
    for _rt in "${mutation_targets[@]:-}"; do
      [[ -n "${_rt}" ]] || continue
      case "${_rt}" in
        src/index.ts|*/index.ts|index.ts) ;;
        *) continue ;;
      esac
      if aegis_mechanical_barrel_reexport_apply \
        "${_rt}" \
        "${AEGIS_INVESTIGATION_INPUT}" \
        "${AEGIS_EXECUTION_SURFACE_PATH:-.}" \
        "1"; then
        _merged=1
        aegis_warn "barrel_reexport_preserve: restored HEAD exports on ${_rt} + additive reexport"
      fi
    done
    if [[ "${_merged}" -eq 1 ]]; then
      diff_content="$(capture_worktree_diff)"
    fi
  fi

  # Always scrub whole-format junk before preflight/artifact.
  if declare -f aegis_strip_aider_whole_file_junk_path >/dev/null 2>&1; then
    local _scrub=0
    for _rt in "${mutation_targets[@]:-}"; do
      [[ -n "${_rt}" ]] || continue
      if aegis_strip_aider_whole_file_junk_path \
        "${AEGIS_EXECUTION_SURFACE_PATH:-.}/${_rt}" 2>/dev/null; then
        _scrub=1
      fi
    done
    if [[ "${_scrub}" -eq 1 ]]; then
      diff_content="$(capture_worktree_diff)"
    fi
  fi

  diff_content="$(
    run_mutation_preflight_with_fix_attempts \
      "${resolved_edit_format}" \
      "${mutation_targets[@]:-}"
  )"

  # Fail-closed: Acceptance top-level exports + smoke import must hold after
  # aider/preflight too (method-only poison must not promote).
  if declare -f aegis_mechanical_shape_gate >/dev/null 2>&1; then
    if ! aegis_mechanical_shape_gate \
      "${AEGIS_INVESTIGATION_INPUT}" \
      "${AEGIS_EXECUTION_SURFACE_PATH:-.}" \
      "${mutation_targets[@]:-}"; then
      aegis_fatal "shape_gate_failed: acceptance exports missing or smoke failed"
    fi
    aegis_log "mechanical_shape_gate: ok (post-aider)"
  fi

  aegis_log "Emitting mutation artifact..."
  emit_mutation_artifact "${diff_content}"
  aegis_log "Aider mutation substrate completed"
}

main "$@"
