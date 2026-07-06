#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — AIDER MUTATION SUBSTRATE
# =========================================================
#
# Version: 1.0
# Layer: Mutation Substrate
# Status: Operational
#
# Responsibilities:
#
# - resolve mutation targets from epistemic handover
#   and observed_request_alignment capability payload
# - build bounded aider invocation inside git worktree
# - capture git diff as mutation evidence
# - emit bounded mutation artifact (diff JSON)
#
# This substrate intentionally:
#
# - does not commit, push, or manage git state (runtime owns)
# - does not apply mutations to the main worktree
# - does not inherit implicit repository awareness
# - exposes only the diff as an artifact candidate
# - delegates promotion decisions to the runtime
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# ROOT RESOLUTION
# =========================================================

readonly AEGIS_AIDER_SUBSTRATE_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

cd "${AEGIS_AIDER_SUBSTRATE_ROOT}"

# =========================================================
# CONFIGURATION
# =========================================================

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][AIDER][FATAL] missing_config" >&2
  exit 1
}

source ".harness/config.sh"

# Mutation timeouts: per-request (aider --timeout) and total wall clock
# (watchdog kill). Both operator-overridable.
: "${AEGIS_AIDER_TIMEOUT:=${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-120}}"
: "${AEGIS_AIDER_MAX_SECONDS:=300}"

# =========================================================
# INPUTS
# =========================================================

readonly AIDER_SKILL_FILE="${1:-}"
readonly AIDER_CAPABILITY_PAYLOAD_DIR="${2:-}"

AEGIS_AIDER_OUTPUT_LOG=""

# =========================================================
# LOGGING
# =========================================================

aider_log() {
  echo "[AEGIS][AIDER] $*" >&2
}

aider_warn() {
  echo "[AEGIS][AIDER][WARN] $*" >&2
}

aider_fatal() {
  echo "[AEGIS][AIDER][FATAL] $*" >&2
  exit 1
}

# =========================================================
# VALIDATION
# =========================================================

validate_aider_substrate_inputs() {

  [[ -n "${AEGIS_EXECUTION_SURFACE_PATH:-}" ]] \
    || aider_fatal "missing_execution_surface_path"

  [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] \
    || aider_fatal "execution_surface_not_materialized"

  [[ -n "${AEGIS_INVESTIGATION_INPUT:-}" ]] \
    || aider_fatal "missing_investigation_input"

  [[ -n "${AEGIS_MODE:-}" ]] \
    || aider_fatal "missing_execution_mode"

  [[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
    || aider_fatal "missing_execution_id"

  [[ -n "${AEGIS_AIDER_MODEL:-}" ]] \
    || aider_fatal "missing_aider_model"

  [[ -f "${AIDER_SKILL_FILE}" ]] \
    || aider_fatal "missing_skill_file"

  [[ -d "${AIDER_CAPABILITY_PAYLOAD_DIR}" ]] \
    || aider_fatal "missing_capability_payload_directory"

  command -v git >/dev/null 2>&1 \
    || aider_fatal "missing_dependency_git"

  if [[ ! -x "${AEGIS_AIDER_BIN:-}" ]]; then
    if command -v aider >/dev/null 2>&1; then
      export AEGIS_AIDER_BIN="$(command -v aider)"
    else
      aider_fatal "missing_aider_binary"
    fi
  fi

  [[ -d "${AEGIS_MUTATION_GIT_DIR:-}" ]] \
    || aider_fatal "missing_mutation_git_directory"
}

# =========================================================
# TARGET RESOLUTION
# =========================================================

# Resolve mutation targets from:
# 1. observed_request_alignment.resolved_paths (builder payload) — highest priority
# 2. epistemic_state.next_attention_targets (epistemic handover)
# 3. filesystem.search_symbol payload matches — fallback

resolve_mutation_targets() {

  local targets=()
  local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
  local line

  # jq over a file that may be absent or malformed; emits zero lines then.
  jq_lines() {
    [[ -f "$1" ]] || return 0
    jq -r "$2" "$1" 2>/dev/null || true
  }

  # Append every non-empty stdin line to targets.
  collect() {
    while IFS= read -r line; do
      [[ -n "${line}" ]] && targets+=("${line}")
    done
  }

  # Source 1: handover mode contracts (mandatory targets when present)
  local handover_mode
  handover_mode="$(jq_lines "${handover}" '.artifact_snapshot.mode // empty')"

  if [[ "${handover_mode}" == "forensics" ]]; then
    collect < <(jq_lines "${handover}" \
      '.artifact_snapshot.operational_context.repair_candidates[]?.id // empty')
    [[ "${#targets[@]}" -gt 0 ]] \
      || aider_fatal "missing_forensics_repair_candidates"
  elif [[ "${handover_mode}" == "repair" ]] && [[ "${AEGIS_MODE}" == "optimize" ]]; then
    collect < <(jq_lines "${handover}" \
      '.artifact_snapshot.operational_context.files_changed[]? // empty')
    [[ "${#targets[@]}" -gt 0 ]] \
      || aider_fatal "missing_repair_files_changed"
  fi

  # Fallback chain — first source yielding targets wins.

  # Source 2: structural.builder payload → observed_request_alignment
  [[ "${#targets[@]}" -eq 0 ]] && collect < <(
    jq_lines "${AIDER_CAPABILITY_PAYLOAD_DIR}/structural_builder.json" \
      '.payload.observed_request_alignment.resolved_paths[]? // empty'
  )

  # Source 3: handover → structural_context.observed_request_alignment
  [[ "${#targets[@]}" -eq 0 ]] && collect < <(
    jq_lines "${handover}" \
      '.artifact_snapshot.structural_context.observed_request_alignment.resolved_paths[]? // empty'
  )

  # Source 4: handover → ranked_targets (explicit_request)
  [[ "${#targets[@]}" -eq 0 ]] && collect < <(
    jq_lines "${handover}" \
      '.artifact_snapshot.structural_context.ranked_targets[]?
       | select(.type == "explicit_request")
       | .file // empty'
  )

  # Source 5: handover → next_attention_targets (path-shaped entries only)
  if [[ "${#targets[@]}" -eq 0 ]]; then
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      if [[ "${line}" == *"."* ]] || [[ "${line}" == *"/"* ]]; then
        targets+=("${line}")
      fi
    done < <(jq_lines "${handover}" '.epistemic_state.next_attention_targets[]? // empty')
  fi

  # Source 6: search_symbol payload matches
  [[ "${#targets[@]}" -eq 0 ]] && collect < <(
    jq_lines "${AIDER_CAPABILITY_PAYLOAD_DIR}/filesystem_search_symbol.json" \
      '.payload.matches[]?.file? // empty' | sort -u
  )

  # Deduplicate while preserving order
  local -A seen=()
  local t
  for t in "${targets[@]:-}"; do
    [[ -n "${t}" && -z "${seen[$t]:-}" ]] || continue
    seen["${t}"]=1
    printf '%s\n' "${t}"
  done
}

# =========================================================
# TEMP FILE CLEANUP
# =========================================================

_AIDER_TMP_FILES=()

aider_mktemp() {
  local tmp
  tmp="$(mktemp)"
  _AIDER_TMP_FILES+=("${tmp}")
  printf '%s' "${tmp}"
}

cleanup_aider_substrate() {
  set +e
  for f in "${_AIDER_TMP_FILES[@]:-}"; do
    rm -f "${f}" >/dev/null 2>&1 || true
  done
  set -e
}

trap cleanup_aider_substrate EXIT
trap 'aider_warn "Interrupted"; exit 130' INT TERM

# =========================================================
# CAPABILITY EVIDENCE INJECTION
# =========================================================

# Renders capability payload content into the mutation prompt.
# AEGIS_SELECTED_CAPABILITY_PAYLOADS is a JSON array of payload file paths.
# Each payload is a capability evidence document (git.diff, git.status,
# epistemic_handover, search_symbol, etc.) that the raw substrate sees.
# Without this, Aider only gets the investigation input string but not the
# structured evidence that defines what and why to mutate.

inject_capability_evidence() {

  [[ -n "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" ]] || return 0

  local payload_paths
  mapfile -t payload_paths < <(
    printf '%s' "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
      | jq -r '.[]?' 2>/dev/null || true
  )

  [[ "${#payload_paths[@]}" -gt 0 ]] || return 0

  printf '\n---\n\nCapability evidence payloads:\n'

  local payload_path
  for payload_path in "${payload_paths[@]}"; do
    [[ -f "${payload_path}" ]] || continue
    printf '\n### %s\n\n' "$(basename "${payload_path}" .json)"
    cat "${payload_path}"
    printf '\n'
  done
}

# =========================================================
# MUTATION PROMPT ASSEMBLY
# =========================================================

assemble_mutation_prompt() {

  local prompt_file="$1"

  local capability_evidence
  capability_evidence="$(inject_capability_evidence)"

  local input_label="Investigation input (operator mutation demand):"
  local mode_instructions="Apply the minimal sufficient mutation described in the investigation input.
Preserve runtime sovereignty, protocol integrity, and containment integrity.
Do not introduce speculative changes beyond what is explicitly requested.
Do not add explanations or narration.
Apply the change and stop."

  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    input_label="Original investigation input (already applied by Repair):"
    mode_instructions="CRITICAL INSTRUCTION FOR OPTIMIZE MODE:
The requested mutation (investigation input) has ALREADY been implemented and applied to the workspace by the preceding Repair step.
Your task is ONLY to simplify the implementation, remove complexity, remove redundancy, and clean up formatting inside the files that were modified by the Repair step.
Do NOT re-apply or re-implement the change.
Do NOT remove or delete the new functionality added by Repair.
Do NOT introduce any speculative changes or new unsolicited logic/functions.
Do NOT add explanations or narration.
Simplify/optimize the existing code and stop."
  fi

  cat > "${prompt_file}" << EOF
You are executing inside Aegis Harness in bounded mutation mode.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

Skill contract:
$(cat "${AIDER_SKILL_FILE}")

---

${input_label}
${AEGIS_INVESTIGATION_INPUT}
${capability_evidence}
---

${mode_instructions}
EOF
}

# =========================================================
# SURFACE ROLLBACK
# =========================================================

# On mutation failure the execution surface must be restored to HEAD with
# no transient residue: tracked files reset, untracked leftovers removed.
rollback_execution_surface() {

  aider_warn "Rolling back execution surface mutations..."

  (
    cd "${AEGIS_EXECUTION_SURFACE_PATH}" || exit 0
    git --git-dir="${AEGIS_MUTATION_GIT_DIR}" --work-tree=. \
      checkout -- . >/dev/null 2>&1 || true
    git --git-dir="${AEGIS_MUTATION_GIT_DIR}" --work-tree=. \
      clean -fd >/dev/null 2>&1 || true
  )
}

# =========================================================
# AIDER INVOCATION
# =========================================================

invoke_aider() {

  local prompt_file="$1"
  shift
  local file_args=("$@")

  local mutation_conf="${AEGIS_AIDER_SUBSTRATE_ROOT}/.aider.mutation.conf.yml"
  local aider_output
  local aider_status

  local aider_cmd=(
    "${AEGIS_AIDER_BIN}"
    "--config" "${mutation_conf}"
    "--model" "${AEGIS_AIDER_MODEL}"
    "--openai-api-base" "${OPENAI_API_BASE}"
    "--message-file" "${prompt_file}"
    "--timeout" "${AEGIS_AIDER_TIMEOUT}"
    "--yes-always"
    "--no-auto-commits"
    "--no-git"
    "--no-stream"
    "--no-pretty"
    "--no-show-model-warnings"
    "--no-auto-lint"
    "--no-auto-test"
    "--exit"
  )

  # Bounded mutation is single-shot by design: no lint/test fix loops here.
  # Each auto-lint retry is another slow model round-trip with no upper
  # bound, and verification is owned by the adversarial/validation modes.

  # Add mutation target files (guard against empty expansion)
  if [[ "${#file_args[@]}" -gt 0 ]]; then
    for f in "${file_args[@]}"; do
      [[ -z "${f}" ]] && continue
      aider_cmd+=("--file" "${f}")
    done
  fi

  aider_log "Invoking aider mutation substrate..."
  aider_log "Model: ${AEGIS_AIDER_MODEL}"
  aider_log "Targets: ${file_args[*]:-<none>}"

  AEGIS_AIDER_OUTPUT_LOG="$(aider_mktemp)"

  local aider_start_time
  aider_start_time=$(date +%s)

  # Wall-clock watchdog: --timeout only bounds individual API requests,
  # so retry loops can still hang the pipeline. The watchdog kills the
  # whole aider process after AEGIS_AIDER_MAX_SECONDS.
  set +e
  (
    cd "${AEGIS_EXECUTION_SURFACE_PATH}"

    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
      "${aider_cmd[@]}" >"${AEGIS_AIDER_OUTPUT_LOG}" 2>&1
  ) &
  local aider_pid=$!

  # stdout/stderr detached so the lingering sleep cannot hold the caller's
  # command-substitution pipe open after the watchdog is killed.
  ( sleep "${AEGIS_AIDER_MAX_SECONDS}" && kill "${aider_pid}" ) >/dev/null 2>&1 &
  local watchdog_pid=$!

  wait "${aider_pid}"
  aider_status=$?

  kill "${watchdog_pid}" 2>/dev/null
  wait "${watchdog_pid}" 2>/dev/null
  set -e

  local aider_end_time
  aider_end_time=$(date +%s)
  local aider_elapsed=$((aider_end_time - aider_start_time))
  echo "[AEGIS][TIMING] aider_substrate_call: ${aider_elapsed}s" >&2

  if [[ "${aider_status}" -ne 0 ]]; then
    if [[ "${aider_elapsed}" -ge "${AEGIS_AIDER_MAX_SECONDS}" ]]; then
      aider_warn "aider exceeded ${AEGIS_AIDER_MAX_SECONDS}s wall clock — killed by watchdog"
    else
      aider_warn "aider invocation failed with exit status ${aider_status}"
    fi
    tail -n 60 "${AEGIS_AIDER_OUTPUT_LOG}" >&2
    rollback_execution_surface
    aider_fatal "aider_execution_failed"
  fi
}

# =========================================================
# DIFF CAPTURE
# =========================================================

capture_worktree_diff() {

  local diff_output

  diff_output="$(
    git \
      --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
      --work-tree="${AEGIS_EXECUTION_SURFACE_PATH}" \
      diff \
      HEAD \
      -- \
      2>/dev/null || true
  )"

  printf '%s' "${diff_output}"
}

# =========================================================
# ARTIFACT EMISSION
# =========================================================

emit_mutation_artifact() {

  local diff_content="$1"
  shift
  local mutation_targets=("$@")

  local files_changed
  files_changed="$(
    printf '%s\n' "${diff_content}" \
      | jq -cRn '[inputs | select(startswith("+++ b/")) | ltrimstr("+++ b/")]'
  )"

  local primary_target="${mutation_targets[0]:-unknown}"

  local attention_targets_json='[]'
  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    attention_targets_json="$(
      jq -cn '$ARGS.positional' --args "${mutation_targets[@]}"
    )"
  fi

  local artifact_tmp
  artifact_tmp="$(aider_mktemp)"

  local diff_tmp
  diff_tmp="$(aider_mktemp)"
  printf '%s' "${diff_content}" > "${diff_tmp}"

  jq -n \
    --arg mode "${AEGIS_MODE}" \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
    --arg mutation_target "${primary_target}" \
    --rawfile diff "${diff_tmp}" \
    --argjson files_changed "${files_changed}" \
    --argjson next_attention_targets "${attention_targets_json}" \
    '{
      mode: $mode,
      execution_id: $execution_id,
      mutation_target: $mutation_target,
      diff: $diff,
      files_changed: $files_changed,
      handover_attention: {
        next_attention_targets: $next_attention_targets,
        attention_scope: "mutation_applied",
        attention_reason: ("repair applied mutation to: " + $mutation_target)
      }
    }' > "${artifact_tmp}"

  echo "${AEGIS_ARTIFACT_BEGIN_MARKER}"
  cat "${artifact_tmp}"
  echo "${AEGIS_ARTIFACT_END_MARKER}"
}

# =========================================================
# MAIN
# =========================================================

main() {

  validate_aider_substrate_inputs

  aider_log "Resolving mutation targets..."

  local mutation_targets=()
  while IFS= read -r target; do
    [[ -z "${target}" ]] && continue
    mutation_targets+=("${target}")
  done < <(resolve_mutation_targets)

  if [[ "${#mutation_targets[@]}" -eq 0 ]]; then
    aider_warn "no_mutation_targets_resolved — using investigation input only"
  else
    aider_log "Mutation targets: ${mutation_targets[*]}"
  fi

  local prompt_file
  prompt_file="$(aider_mktemp)"
  assemble_mutation_prompt "${prompt_file}"

  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    invoke_aider "${prompt_file}" "${mutation_targets[@]}"
  else
    invoke_aider "${prompt_file}"
  fi

  aider_log "Capturing worktree diff..."

  local diff_content
  diff_content="$(capture_worktree_diff)"

  if [[ -z "${diff_content}" ]]; then
    if [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      echo "[DEBUG] Aider output log:" >&2
      cat "${AEGIS_AIDER_OUTPUT_LOG}" >&2
    fi
    # No tracked changes, but aider may still have left untracked residue.
    rollback_execution_surface
    aider_fatal "empty_diff: aider produced no changes"
  fi

  aider_log "Emitting mutation artifact..."

  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    emit_mutation_artifact "${diff_content}" "${mutation_targets[@]}"
  else
    emit_mutation_artifact "${diff_content}"
  fi

  aider_log "Aider mutation substrate completed"
}

main "$@"
