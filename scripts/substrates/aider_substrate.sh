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

  # Source 1: Forensics artifact → explicit repair candidates
  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
    local handover_mode
    handover_mode="$(
      jq -r '.artifact_snapshot.mode // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
    )"

    if [[ "${handover_mode}" == "forensics" ]]; then
      local repair_candidate_ids
      repair_candidate_ids="$(
        jq -r '
          .artifact_snapshot.operational_context.repair_candidates[]?.id // empty
        ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
      )"

      while IFS= read -r path; do
        [[ -z "${path}" ]] && continue
        targets+=("${path}")
      done <<< "${repair_candidate_ids}"

      [[ "${#targets[@]}" -gt 0 ]] \
        || aider_fatal "missing_forensics_repair_candidates"
    elif [[ "${handover_mode}" == "repair" ]] \
      && [[ "${AEGIS_MODE}" == "optimize" ]]; then
      local repaired_files
      repaired_files="$(
        jq -r '
          .artifact_snapshot.operational_context.files_changed[]? // empty
        ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
      )"

      while IFS= read -r path; do
        [[ -z "${path}" ]] && continue
        targets+=("${path}")
      done <<< "${repaired_files}"

      [[ "${#targets[@]}" -gt 0 ]] \
        || aider_fatal "missing_repair_files_changed"
    fi
  fi

  # Source 2: structural.builder payload → observed_request_alignment
  # (Available only if capability payloads were NOT cleaned up between modes)
  local builder_payload="${AIDER_CAPABILITY_PAYLOAD_DIR}/structural_builder.json"
  if [[ "${#targets[@]}" -eq 0 ]] && [[ -f "${builder_payload}" ]]; then
    local resolved_paths
    resolved_paths="$(
      jq -r '
        .payload.observed_request_alignment.resolved_paths[]? // empty
      ' "${builder_payload}" 2>/dev/null || true
    )"
    while IFS= read -r path; do
      [[ -z "${path}" ]] && continue
      targets+=("${path}")
    done <<< "${resolved_paths}"
  fi

  # Source 3: epistemic handover → artifact_snapshot.structural_context.observed_request_alignment
  # (The discovery artifact's structural context is stored here; resolved_paths survives cleanup)
  if [[ "${#targets[@]}" -eq 0 ]] && [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
    local snapshot_paths
    snapshot_paths="$(
      jq -r '
        .artifact_snapshot.structural_context.observed_request_alignment.resolved_paths[]? // empty
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
    )"
    while IFS= read -r path; do
      [[ -z "${path}" ]] && continue
      targets+=("${path}")
    done <<< "${snapshot_paths}"
  fi

  # Source 4: epistemic handover → artifact_snapshot.structural_context.ranked_targets (explicit_request)
  if [[ "${#targets[@]}" -eq 0 ]] && [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
    local ranked_files
    ranked_files="$(
      jq -r '
        .artifact_snapshot.structural_context.ranked_targets[]?
        | select(.type == "explicit_request")
        | .file // empty
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
    )"
    while IFS= read -r path; do
      [[ -z "${path}" ]] && continue
      targets+=("${path}")
    done <<< "${ranked_files}"
  fi

  # Source 5: epistemic handover → epistemic_state.next_attention_targets
  if [[ "${#targets[@]}" -eq 0 ]] && [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
    local handover_targets
    handover_targets="$(
      jq -r '
        .epistemic_state.next_attention_targets[]? // empty
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
    )"
    while IFS= read -r path; do
      [[ -z "${path}" ]] && continue
      # Only include targets that look like file paths (contain a dot or slash)
      if [[ "${path}" == *"."* ]] || [[ "${path}" == *"/"* ]]; then
        targets+=("${path}")
      fi
    done <<< "${handover_targets}"
  fi

  # Source 6: search_symbol payload — extract file paths from matches
  if [[ "${#targets[@]}" -eq 0 ]]; then
    local search_payload="${AIDER_CAPABILITY_PAYLOAD_DIR}/filesystem_search_symbol.json"
    if [[ -f "${search_payload}" ]]; then
      local search_files
      search_files="$(
        jq -r '
          .payload.matches[]?.file? // empty
        ' "${search_payload}" 2>/dev/null | sort -u || true
      )"
      while IFS= read -r path; do
        [[ -z "${path}" ]] && continue
        targets+=("${path}")
      done <<< "${search_files}"
    fi
  fi

  # Deduplicate while preserving order, and resolve relative paths to repo-relative paths
  local seen=()
  local unique_targets=()
  for t in "${targets[@]}"; do
    local found=0
    for s in "${seen[@]:-}"; do
      [[ "${s}" == "${t}" ]] && found=1 && break
    done
    if [[ "${found}" -eq 0 ]]; then
      seen+=("${t}")

      unique_targets+=("${t}")
    fi
  done

  printf '%s\n' "${unique_targets[@]:-}"
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

  local selected_payloads="${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}"

  if [[ -z "${selected_payloads}" ]]; then
    return 0
  fi

  local payload_count
  payload_count="$(
    printf '%s' "${selected_payloads}" \
      | jq -r 'length' 2>/dev/null || echo 0
  )"

  if [[ "${payload_count:-0}" -eq 0 ]]; then
    return 0
  fi

  printf '\n---\n\nCapability evidence payloads:\n'

  local i=0
  while [[ "${i}" -lt "${payload_count}" ]]; do
    local payload_path
    payload_path="$(
      printf '%s' "${selected_payloads}" \
        | jq -r ".[${i}]" 2>/dev/null || true
    )"

    if [[ -z "${payload_path}" ]] || [[ ! -f "${payload_path}" ]]; then
      i=$(( i + 1 ))
      continue
    fi

    local capability_label
    capability_label="$(basename "${payload_path}" .json)"

    printf '\n### %s\n\n' "${capability_label}"
    cat "${payload_path}"
    printf '\n'

    i=$(( i + 1 ))
  done
}

# =========================================================
# MUTATION PROMPT ASSEMBLY
# =========================================================

assemble_mutation_prompt() {

  local prompt_file="$1"

  local capability_evidence
  capability_evidence="$(inject_capability_evidence)"

  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    cat > "${prompt_file}" << EOF
You are executing inside Aegis Harness in bounded mutation mode.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

Skill contract:
$(cat "${AIDER_SKILL_FILE}")

---

Original investigation input (already applied by Repair):
${AEGIS_INVESTIGATION_INPUT}
${capability_evidence}
---

CRITICAL INSTRUCTION FOR OPTIMIZE MODE:
The requested mutation (investigation input) has ALREADY been implemented and applied to the workspace by the preceding Repair step.
Your task is ONLY to simplify the implementation, remove complexity, remove redundancy, and clean up formatting inside the files that were modified by the Repair step.
Do NOT re-apply or re-implement the change.
Do NOT remove or delete the new functionality added by Repair.
Do NOT introduce any speculative changes or new unsolicited logic/functions.
Do NOT add explanations or narration.
Simplify/optimize the existing code and stop.
EOF
  else
    cat > "${prompt_file}" << EOF
You are executing inside Aegis Harness in bounded mutation mode.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

Skill contract:
$(cat "${AIDER_SKILL_FILE}")

---

Investigation input (operator mutation demand):
${AEGIS_INVESTIGATION_INPUT}
${capability_evidence}
---

Apply the minimal sufficient mutation described in the investigation input.
Preserve runtime sovereignty, protocol integrity, and containment integrity.
Do not introduce speculative changes beyond what is explicitly requested.
Do not add explanations or narration.
Apply the change and stop.
EOF
  fi
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
    "--yes-always"
    "--no-auto-commits"
    "--no-git"
    "--no-stream"
    "--no-pretty"
    "--no-show-model-warnings"
    "--exit"
  )
  
  if [[ "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" == *typescript_check* ]]; then
    aider_cmd+=(
      "--lint-cmd" "ts:bash scripts/capabilities/typescript_check.sh"
      "--lint-cmd" "tsx:bash scripts/capabilities/typescript_check.sh"
      "--auto-lint"
    )
  fi

  if [[ "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" == *eslint_check* ]]; then
    aider_cmd+=(
      "--lint-cmd" "js:bash scripts/capabilities/eslint_check.sh"
      "--lint-cmd" "jsx:bash scripts/capabilities/eslint_check.sh"
      "--lint-cmd" "ts:bash scripts/capabilities/eslint_check.sh"
      "--lint-cmd" "tsx:bash scripts/capabilities/eslint_check.sh"
      "--auto-lint"
    )
  fi

  if [[ "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" == *test_runner* ]]; then
    aider_cmd+=(
      "--test-cmd" "bash scripts/capabilities/test_runner.sh"
      "--auto-test"
    )
  fi

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
  aider_log "Actual aider command to be executed:"
  printf '%q ' "${aider_cmd[@]}" >&2
  echo >&2

  AEGIS_AIDER_OUTPUT_LOG="$(aider_mktemp)"

  local aider_start_time
  aider_start_time=$(date +%s)

  set +e
  (
    cd "${AEGIS_EXECUTION_SURFACE_PATH}"

    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
      "${aider_cmd[@]}" >"${AEGIS_AIDER_OUTPUT_LOG}" 2>&1
  )
  aider_status=$?
  set -e

  local aider_end_time
  aider_end_time=$(date +%s)
  local aider_elapsed=$((aider_end_time - aider_start_time))
  echo "[AEGIS][TIMING] aider_substrate_call: ${aider_elapsed}s" >&2

  if [[ "${aider_status}" -ne 0 ]]; then
    aider_warn "aider invocation failed with exit status ${aider_status}"
    sed -n '1,120p' "${AEGIS_AIDER_OUTPUT_LOG}" >&2
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
      | grep '^+++ b/' \
      | sed 's|^+++ b/||' \
      | jq -R . \
      | jq -sc '.'
  )"

  [[ -n "${files_changed}" ]] \
    || files_changed='[]'

  local primary_target="${mutation_targets[0]:-unknown}"

  local attention_targets_json
  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    attention_targets_json="$(
      printf '%s\n' "${mutation_targets[@]}" | jq -R . | jq -sc '.'
    )"
  else
    attention_targets_json='[]'
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

  echo "=== WORKTREE STATUS ===" >&2
  git \
    --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
    --work-tree="${AEGIS_EXECUTION_SURFACE_PATH}" \
    status --short >&2

  echo "=== WORKTREE HEAD ===" >&2
  git \
    --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
    --work-tree="${AEGIS_EXECUTION_SURFACE_PATH}" \
    rev-parse HEAD >&2

  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    for f in "${mutation_targets[@]}"; do
      echo "=== TARGET FILE: ${f} ===" >&2
      if [[ -f "${AEGIS_EXECUTION_SURFACE_PATH}/${f}" ]]; then
        cat "${AEGIS_EXECUTION_SURFACE_PATH}/${f}" >&2
      else
        echo "(file does not exist)" >&2
      fi
    done
  fi

  aider_log "Capturing worktree diff..."

  local diff_content
  diff_content="$(capture_worktree_diff)"

  if [[ -z "${diff_content}" ]]; then
    if [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      echo "[DEBUG] Aider output log:" >&2
      cat "${AEGIS_AIDER_OUTPUT_LOG}" >&2
    fi
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
