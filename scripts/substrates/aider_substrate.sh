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

# Per-request timeout + wall-clock watchdog (max of 300s or 3× request).
: "${AEGIS_AIDER_TIMEOUT:=${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-120}}"
_aider_wallclock_floor=$(( AEGIS_AIDER_TIMEOUT * 3 ))
[[ "${_aider_wallclock_floor}" -lt 300 ]] && _aider_wallclock_floor=300
: "${AEGIS_AIDER_MAX_SECONDS:=${_aider_wallclock_floor}}"
unset _aider_wallclock_floor

readonly AIDER_SKILL_FILE="${1:-}"
readonly AIDER_CAPABILITY_PAYLOAD_DIR="${2:-}"

AEGIS_AIDER_OUTPUT_LOG=""

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
# shellcheck disable=SC1091
source "scripts/lib/demand.sh"
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

  # Optimize: post-repair surface is the baseline. Ask Aider whether a safe
  # refine exists; if the surface is unchanged, passthrough repair → next mode
  # (no re-preflight). If improved, same mutation rails as repair (lint+tools).
  local diff_content=""
  local optimize_baseline_diff=""
  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    optimize_baseline_diff="$(capture_worktree_diff)"
    if [[ -z "${optimize_baseline_diff}" ]]; then
      rollback_execution_surface
      aegis_fatal "empty_diff: optimize surface has no repair candidate applied"
    fi

    # AEGIS_OPTIMIZE_LLM:
    #   1|true|yes (default) — always ask the model
    #   0|false|no           — passthrough repair without LLM
    #   auto                 — passthrough when repair diff is very small
    : "${AEGIS_OPTIMIZE_LLM:=1}"
    : "${AEGIS_OPTIMIZE_MIN_LINES:=24}"
    local _opt_llm _opt_lines
    _opt_llm="$(printf '%s' "${AEGIS_OPTIMIZE_LLM}" | tr '[:upper:]' '[:lower:]')"
    _opt_lines="$(printf '%s\n' "${optimize_baseline_diff}" | wc -l | tr -d ' ')"

    if [[ "${_opt_llm}" == "0" || "${_opt_llm}" == "false" || "${_opt_llm}" == "no" ]]; then
      aegis_log "optimize_passthrough: AEGIS_OPTIMIZE_LLM=${AEGIS_OPTIMIZE_LLM} — repair candidate → next mode"
      emit_mutation_artifact "${optimize_baseline_diff}"
      aegis_log "Aider mutation substrate completed (optimize passthrough)"
      return 0
    fi
    if [[ "${_opt_llm}" == "auto" ]] \
      && [[ "${_opt_lines}" -le "${AEGIS_OPTIMIZE_MIN_LINES}" ]]; then
      aegis_log "optimize_passthrough: auto short-circuit (${_opt_lines}≤${AEGIS_OPTIMIZE_MIN_LINES} lines) — repair candidate → next mode"
      emit_mutation_artifact "${optimize_baseline_diff}"
      aegis_log "Aider mutation substrate completed (optimize passthrough)"
      return 0
    fi
    aegis_log "optimize_ask: can repair be improved? (baseline ${_opt_lines} lines, LLM=${AEGIS_OPTIMIZE_LLM})"
  fi

  local resolved_edit_format
  resolved_edit_format="$(resolve_aider_edit_format "${mutation_targets[@]:-}")"

  local prompt_file
  prompt_file="$(aider_mktemp)"
  assemble_mutation_prompt \
    "${prompt_file}" "${resolved_edit_format}" "${mutation_targets[@]:-}"
  invoke_aider \
    "${prompt_file}" "${resolved_edit_format}" "${mutation_targets[@]:-}"

  aegis_log "Capturing worktree diff..."

  diff_content="$(capture_worktree_diff)"

  if [[ -z "${diff_content}" ]]; then
    if [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      echo "[DEBUG] Aider output log:" >&2
      cat "${AEGIS_AIDER_OUTPUT_LOG}" >&2
    fi
    rollback_execution_surface
    aegis_fatal "empty_diff: aider produced no changes"
  fi

  if ! assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"; then
    aegis_fatal "mutation_scope_violation: after primary mutation"
  fi

  # Optimize no-op: surface still equals post-repair → forward repair, skip
  # tools re-run (already green from repair) and continue pipeline.
  if [[ "${AEGIS_MODE}" == "optimize" ]] \
    && [[ -n "${optimize_baseline_diff}" ]] \
    && [[ "${diff_content}" == "${optimize_baseline_diff}" ]]; then
    aegis_log "optimize_no_change: repair already optimal — passthrough to next mode"
    emit_mutation_artifact "${optimize_baseline_diff}"
    aegis_log "Aider mutation substrate completed (optimize no_optimization_needed)"
    return 0
  fi

  # Improved (or primary repair): same Aider tool rails as repair.
  diff_content="$(
    run_mutation_preflight_with_fix_attempts \
      "${resolved_edit_format}" \
      "${mutation_targets[@]:-}"
  )"

  aegis_log "Emitting mutation artifact..."
  emit_mutation_artifact "${diff_content}"
  aegis_log "Aider mutation substrate completed"
}

main "$@"
