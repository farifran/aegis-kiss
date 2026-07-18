#!/usr/bin/env bash
# Source-only — mutation target resolution (loaded by aider_substrate.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] aider_targets_lib_not_invocable" >&2
  exit 1
fi

mutation_jq_lines() {
  [[ -f "$1" ]] || return 0
  jq -r "$2" "$1" 2>/dev/null || true
}

# Contract-mandatory seeds from the preceding mode handover (stdout lines).
mutation_targets_from_handover_contract() {
  local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
  local handover_mode
  handover_mode="$(mutation_jq_lines "${handover}" '.artifact_snapshot.mode // empty')"

  if [[ "${handover_mode}" == "forensics" ]]; then
    mutation_jq_lines "${handover}" \
      '.artifact_snapshot.operational_context.repair_candidates[]?.id // empty'
    return 0
  fi

  if [[ "${handover_mode}" == "validation" ]] && [[ "${AEGIS_MODE}" == "repair" ]]; then
    # Local repair feedback: re-enter from rejected validation without
    # rediscovery. Scope is authorized_scopes (+ violation target_files).
    mutation_jq_lines "${handover}" '
      (.artifact_snapshot.operational_context.repair_feedback.authorized_scopes // [])[]?,
      (.artifact_snapshot.operational_context.repair_feedback.violations // [])[]?.target_files[]?
    '
    return 0
  fi

  if [[ "${handover_mode}" == "optimize" ]] && [[ "${AEGIS_MODE}" == "repair" ]]; then
    # Optimize can_improve → repair refine (same feedback shape).
    mutation_jq_lines "${handover}" '
      (.artifact_snapshot.operational_context.repair_feedback.authorized_scopes // [])[]?,
      (.artifact_snapshot.operational_context.repair_feedback.violations // [])[]?.target_files[]?
    '
    return 0
  fi
}

# required_evidence filesystem.read paths from handover (stdout lines).
mutation_targets_from_required_evidence() {
  local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
  mutation_jq_lines "${handover}" '
    (.artifact_snapshot.operational_context.required_evidence // [])[]?
    | select(type == "string")
    | if startswith("filesystem.read:") then .[16:] else empty end
    | select(test("\\.(ts|tsx|js|jsx|mjs|cjs|sh|py)$"))
  '
}

# Drop ghost net-new targets (absent on surface, not operator-named).
# Reads candidate paths from stdin; writes kept paths to stdout.
mutation_filter_ghost_net_new() {
  local inv_paths=""
  inv_paths="$(aegis_extract_operator_named_paths "${AEGIS_INVESTIGATION_INPUT:-}")"
  local t
  while IFS= read -r t; do
    [[ -n "${t}" ]] || continue
    t="${t#./}"
    if [[ -f "${AEGIS_EXECUTION_SURFACE_PATH:-.}/${t}" ]]; then
      printf '%s\n' "${t}"
      continue
    fi
    if printf '%s\n' "${inv_paths}" | command grep -Fxq "${t}"; then
      printf '%s\n' "${t}"
    else
      aegis_warn "target_dropped_ghost_net_new_not_in_investigation: ${t}"
    fi
  done
}

# Fallback when contract + operator + required_evidence are empty:
# path-shaped epistemic attention only (Layer 0 / forensics handover).
mutation_targets_first_fallback() {
  local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
  local line

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    if [[ "${line}" == *"."* ]] || [[ "${line}" == *"/"* ]]; then
      printf '%s\n' "${line}"
    fi
  done < <(mutation_jq_lines "${handover}" '.epistemic_state.next_attention_targets[]? // empty')
}

mutation_targets_search_symbol_fallback() {
  mutation_jq_lines "${AIDER_CAPABILITY_PAYLOAD_DIR}/filesystem_search_symbol.json" \
    '.payload.matches[]?.file? // empty' | sort -u
}

# Deduplicate stdin lines while preserving order.
mutation_targets_dedupe() {
  # bash 4+ associative array (already required elsewhere in this file).
  local -A seen=()
  local t
  while IFS= read -r t; do
    [[ -n "${t}" && -z "${seen[$t]:-}" ]] || continue
    seen["${t}"]=1
    printf '%s\n' "${t}"
  done
}

# Assert contract sources that must not be empty when the mode applies.
mutation_targets_assert_contract_nonempty() {
  local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
  local handover_mode
  local count="$1"
  handover_mode="$(mutation_jq_lines "${handover}" '.artifact_snapshot.mode // empty')"

  if [[ "${handover_mode}" == "forensics" ]] && [[ "${count}" -eq 0 ]]; then
    aegis_fatal "missing_forensics_repair_candidates"
  fi
  if [[ "${handover_mode}" == "validation" ]] && [[ "${AEGIS_MODE}" == "repair" ]] \
    && [[ "${count}" -eq 0 ]]; then
    aegis_fatal "missing_repair_feedback_authorized_scopes"
  fi
  if [[ "${handover_mode}" == "optimize" ]] && [[ "${AEGIS_MODE}" == "repair" ]] \
    && [[ "${count}" -eq 0 ]]; then
    aegis_fatal "missing_optimize_improve_authorized_scopes"
  fi
}

resolve_mutation_targets() {
  local -a targets=()
  local line
  local contract_count=0

  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    targets+=("${line}")
  done < <(mutation_targets_from_handover_contract)
  contract_count="${#targets[@]}"
  mutation_targets_assert_contract_nonempty "${contract_count}"

  # UNION — operator-named paths (never first-wins).
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    targets+=("${line}")
  done < <(aegis_extract_operator_named_paths "${AEGIS_INVESTIGATION_INPUT:-}")

  # UNION — required_evidence paths.
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    targets+=("${line}")
  done < <(mutation_targets_from_required_evidence)

  # Ghost-path filter over the union so far.
  if [[ "${#targets[@]}" -gt 0 ]]; then
    local -a filtered=()
    while IFS= read -r line; do
      [[ -n "${line}" ]] || continue
      filtered+=("${line}")
    done < <(printf '%s\n' "${targets[@]}" | mutation_filter_ghost_net_new)
    targets=("${filtered[@]:-}")
  fi

  # Fallback chain only when still empty.
  if [[ "${#targets[@]}" -eq 0 ]]; then
    while IFS= read -r line; do
      [[ -n "${line}" ]] || continue
      targets+=("${line}")
    done < <(mutation_targets_first_fallback)

    if [[ "${#targets[@]}" -eq 0 ]]; then
      while IFS= read -r line; do
        [[ -n "${line}" ]] || continue
        targets+=("${line}")
      done < <(mutation_targets_search_symbol_fallback)
    fi
  fi

  printf '%s\n' "${targets[@]:-}" | mutation_targets_dedupe
}

# =========================================================
# TARGET SANITIZATION
# =========================================================

# Resolved targets become aider --file arguments; anything that expands
# beyond a single regular file floods the chat context with the whole
# repository. Sanitization is therefore strict:
#
# - no glob metacharacters or whitespace (no wildcard expansion)
# - no absolute paths or ../ traversal (surface-relative only)
# - must resolve to a REGULAR FILE inside the execution surface
#   (directories would be added recursively); a path that does not
#   exist yet is a NET-NEW target and is pre-materialized as an empty
#   file so it passes the .aiderignore jail and aider can populate it
# - hard cap on target count (context and wall-clock budget)
: "${AEGIS_AIDER_MAX_TARGET_FILES:=8}"

sanitize_mutation_targets() {

  local kept=0
  local t

  while IFS= read -r t; do
    [[ -n "${t}" ]] || continue

    case "${t}" in
      *'*'* | *'?'* | *'['* | *']'* | *'{'* | *'}'* | *[[:space:]]*)
        aegis_warn "target_rejected_glob_or_whitespace: ${t}"
        continue
        ;;
      /* | *..*)
        aegis_warn "target_rejected_out_of_surface: ${t}"
        continue
        ;;
    esac

    t="${t#./}"

    if [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}/${t}" ]]; then
      aegis_warn "target_rejected_directory: ${t}"
      continue
    fi

    if [[ ! -f "${AEGIS_EXECUTION_SURFACE_PATH}/${t}" ]]; then
      # Non-file, existing path (socket, symlink to dir, ...) stays rejected.
      if [[ -e "${AEGIS_EXECUTION_SURFACE_PATH}/${t}" ]]; then
        aegis_warn "target_rejected_not_a_file_in_surface: ${t}"
        continue
      fi
      # Net-new target: pre-materialize an empty regular file inside the
      # surface so the .aiderignore jail and --file loading accept it,
      # then register it with --intent-to-add so the content aider writes
      # appears in `git diff HEAD` (untracked paths are diff-invisible).
      # If aider writes nothing, the file stays empty (empty diff hunk)
      # and the rollback `git clean -fd` sweeps it on failure — no
      # residue can leak past the surface.
      if ! mkdir -p "$(dirname "${AEGIS_EXECUTION_SURFACE_PATH}/${t}")"; then
        aegis_warn "target_rejected_unmaterializable: ${t}"
        continue
      fi
      # Empty regular file only — never seed domain stubs or invented
      # export names. Content-bearing stubs were left as the "implementation"
      # by floor models and leaked ghost modules (e.g. createTokenBucket)
      # into accepted candidates.
      if ! : > "${AEGIS_EXECUTION_SURFACE_PATH}/${t}"; then
        aegis_warn "target_rejected_unmaterializable: ${t}"
        continue
      fi
      git \
        --git-dir="${AEGIS_MUTATION_GIT_DIR}" \
        --work-tree="${AEGIS_EXECUTION_SURFACE_PATH}" \
        add --intent-to-add -- "${t}" >/dev/null 2>&1 \
        || aegis_warn "net_new_target_intent_to_add_failed: ${t}"
      aegis_warn "target_pre_materialized_net_new_file: ${t}"
    fi

    if [[ "${kept}" -ge "${AEGIS_AIDER_MAX_TARGET_FILES}" ]]; then
      aegis_warn "target_dropped_over_cap(${AEGIS_AIDER_MAX_TARGET_FILES}): ${t}"
      continue
    fi

    kept=$((kept + 1))
    printf '%s\n' "${t}"
  done
}

