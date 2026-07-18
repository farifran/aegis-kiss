#!/usr/bin/env bash
# Source-only — preflight fix taxonomy + retry loop (loaded by aider_substrate.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] aider_preflight_lib_not_invocable" >&2
  exit 1
fi

classify_preflight_diagnostic_line() {
  local line="${1:-}"
  local lower
  lower="$(printf '%s' "${line}" | tr '[:upper:]' '[:lower:]')"

  case "${lower}" in
    smoke\ *|*'smoke.'*)
      printf 'runtime_load'
      ;;
    *'as any'*|*': any'*|*'unexpected any'*|*'no-explicit-any'*|*'ts7006'*|*'implicitly has an "any"'*|*"implicitly has an 'any'"*|*'@ts-ignore'*|*'@ts-expect-error'*|*'ts-nocheck'*)
      printf 'any'
      ;;
    *'cannot find module'*|*'cannot find package'*|*'err_module_not_found'*|*'ts2307'*|*'ts2305'*|*'has no exported member'*|*'is not a module'*)
      printf 'import'
      ;;
    *'is not assignable'*|*'not exist on type'*|*'undefined is not'*|*'null is not'*)
      printf 'type'
      ;;
    *)
      printf 'other'
      ;;
  esac
}

# Policy line for a diagnostic class (from prompts/preflight_class_policies.txt).
preflight_class_policy() {
  local class="$1"
  local policies="${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/prompts/preflight_class_policies.txt"
  local line
  line="$(command grep -E "^${class}\\|" "${policies}" 2>/dev/null | head -n 1 || true)"
  if [[ -n "${line}" ]]; then
    printf '%s' "${line#*|}"
  else
    printf '%s' "Fix with the smallest edit; stay inside authorized files."
  fi
}

# Emit one class section (title + policy + up to 8 items).
preflight_format_class_block() {
  local title="$1"
  local policy="$2"
  shift 2
  local -a items=("$@")
  [[ "${#items[@]}" -gt 0 ]] || return 0
  printf '%s\n' "${title}"
  printf '%s\n' "Policy: ${policy}"
  local it n=0
  for it in "${items[@]}"; do
    n=$((n + 1))
    if [[ "${n}" -gt 8 ]]; then
      printf '%s\n' "- … ($(( ${#items[@]} - 8 )) more omitted)"
      break
    fi
    printf '%s\n' "- ${it}"
  done
  printf '\n'
}

# Taxonomized fix prompt after preflight failure (tsc / smoke / …).
# Static standing rules live under scripts/substrates/prompts/.
assemble_preflight_fix_prompt() {

  local prompt_file="$1"
  local resolved_edit_format="$2"
  shift 2
  local prompt_targets=("$@")

  local tsc_payload="${AIDER_CAPABILITY_PAYLOAD_DIR}/typescript_check.json"
  local smoke_payload="${AIDER_CAPABILITY_PAYLOAD_DIR}/smoke_import.json"
  local standing_rules="${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/prompts/preflight_standing_rules.txt"

  local -a lines_any=() lines_import=() lines_type=() lines_runtime=() lines_other=()
  local raw_line class

  if [[ -f "${tsc_payload}" ]]; then
    while IFS= read -r raw_line; do
      [[ -n "${raw_line}" ]] || continue
      class="$(classify_preflight_diagnostic_line "${raw_line}")"
      case "${class}" in
        any) lines_any+=("${raw_line}") ;;
        import) lines_import+=("${raw_line}") ;;
        runtime_load) lines_runtime+=("${raw_line}") ;;
        type) lines_type+=("${raw_line}") ;;
        *) lines_other+=("${raw_line}") ;;
      esac
    done < <(
      jq -r '
        (.payload.errors // [])
        | .[]?
        | "\(.file // "?"):\(.line // "?"): \(.message // .)"
      ' "${tsc_payload}" 2>/dev/null || true
    )
  fi

  if [[ -f "${smoke_payload}" ]]; then
    while IFS= read -r raw_line; do
      [[ -n "${raw_line}" ]] || continue
      lines_runtime+=("${raw_line}")
    done < <(
      jq -r '
        (.payload.results // [])
        | .[]?
        | select(.status == "failed")
        | "smoke \(.file // "?"): \(.detail // "load failed" | .[0:240])"
      ' "${smoke_payload}" 2>/dev/null || true
    )
  fi

  local taxonomy_block=""
  taxonomy_block+="$(preflight_format_class_block \
    "[any] Type escapes" "$(preflight_class_policy any)" "${lines_any[@]:-}")"
  taxonomy_block+="$(preflight_format_class_block \
    "[import] Module resolution" "$(preflight_class_policy import)" "${lines_import[@]:-}")"
  taxonomy_block+="$(preflight_format_class_block \
    "[type] Type errors" "$(preflight_class_policy type)" "${lines_type[@]:-}")"
  taxonomy_block+="$(preflight_format_class_block \
    "[runtime_load] Module load failures" "$(preflight_class_policy runtime_load)" "${lines_runtime[@]:-}")"
  taxonomy_block+="$(preflight_format_class_block \
    "[other] Other diagnostics" "$(preflight_class_policy other)" "${lines_other[@]:-}")"

  if [[ -z "$(printf '%s' "${taxonomy_block}" | sed '/^$/d')" ]]; then
    taxonomy_block="(no structured diagnostics available — re-read the loaded files and make them compile and load cleanly)
"
  fi

  local target_list
  target_list="$(printf -- '- %s\n' "${prompt_targets[@]:-}")"
  local standing=""
  [[ -f "${standing_rules}" ]] && standing="$(cat "${standing_rules}")"

  cat > "${prompt_file}" << EOF
You are fixing a preflight failure after a prior mutation attempt inside Aegis Harness.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

Original demand:
${AEGIS_INVESTIGATION_INPUT}

Diagnostics by class (fix ONLY these; do not expand scope):

${taxonomy_block}
${standing}

FILE ACCESS CONSTRAINTS (NON-NEGOTIABLE):
The ONLY files you may edit are:
${target_list}
You are FORBIDDEN from adding files to the chat.

YOUR TASK NOW: edit the loaded files so every listed diagnostic is resolved.
EOF

  if [[ "${resolved_edit_format}" == "whole" && "${#prompt_targets[@]}" -gt 0 ]]; then
    {
      echo ""
      echo "WHOLE-FILE FORMAT — one block per file:"
      local t
      for t in "${prompt_targets[@]}"; do
        printf '%s\n```\n<entire content of %s>\n```\n\n' "${t}" "${t}"
      done
    } >> "${prompt_file}"
  fi
}

# Soft gate: dense demand tokens should appear in added mutation lines.
# Default: warn only. Set AEGIS_DEMAND_TOKEN_PREFLIGHT=hard to fail.
assert_demand_tokens_in_mutation_diff() {
  local diff_content="${1-}"
  [[ -n "${diff_content}" ]] || return 0
  [[ "${AEGIS_MODE:-}" == "repair" ]] || return 0

  if ! declare -f aegis_demand_dense_tokens >/dev/null 2>&1; then
    return 0
  fi

  local tokens token hit=0
  tokens="$(aegis_demand_dense_tokens "${AEGIS_INVESTIGATION_INPUT:-}")"
  [[ -n "${tokens}" ]] || return 0

  local added
  added="$(
    printf '%s\n' "${diff_content}" \
      | grep -E '^\+' \
      | grep -vE '^\+\+\+' \
      | tr '[:upper:]' '[:lower:]' \
      || true
  )"
  [[ -n "${added}" ]] || return 0

  while IFS= read -r token; do
    [[ -n "${token}" ]] || continue
    [[ "${#token}" -ge 4 ]] || continue
    if printf '%s' "${added}" | grep -Fqi -- "${token}"; then
      hit=1
      break
    fi
  done <<< "${tokens}"

  if [[ "${hit}" -eq 1 ]]; then
    return 0
  fi

  local token_list
  token_list="$(printf '%s' "${tokens}" | tr '\n' ' ')"
  if [[ "${AEGIS_DEMAND_TOKEN_PREFLIGHT:-soft}" == "hard" ]]; then
    aegis_warn "demand_token_preflight_miss (hard): none of [${token_list}] in added lines"
    return 1
  fi
  aegis_warn "demand_token_preflight_miss: none of [${token_list}] appear in added diff lines"
  return 0
}

run_mutation_preflight() {

  local preflight_script="${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/mutation_preflight.sh"

  if [[ ! -f "${preflight_script}" ]]; then
    aegis_warn "mutation_preflight_script_missing — skipping"
    return 0
  fi

  aegis_log "Running one-shot mutation preflight (typescript.check + test.run + smoke.import)..."

  # Surface the mutation file set so preflight can ignore pre-existing
  # typescript debt outside the candidate (baseline pollution), and so
  # smoke.import only loads model-authored paths (not node_modules residue).
  local changed_files=""
  local surface_diff=""
  surface_diff="$(capture_worktree_diff)"
  changed_files="$(
    list_mutation_changed_paths "${surface_diff}"
  )"

  # Return status only — caller owns rollback / fix-retry policy.
  if ! AEGIS_SUBSTRATE_ROOT="${AEGIS_AIDER_SUBSTRATE_ROOT}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_MUTATION_PREFLIGHT="${AEGIS_MUTATION_PREFLIGHT:-true}" \
    AEGIS_PREFLIGHT_CHANGED_FILES="${changed_files}" \
    bash "${preflight_script}" \
      "${AEGIS_EXECUTION_SURFACE_PATH}" \
      "${AIDER_CAPABILITY_PAYLOAD_DIR}"; then
    return 1
  fi

  assert_demand_tokens_in_mutation_diff "${surface_diff}"
}

# Preflight with bounded model fix retries. Prints the final surface diff
# on stdout (for artifact emission). First failure keeps the worktree so
# the model can repair compile errors; exhausted attempts abort+rollback.
# Default two fix attempts: floor models often need a second compile pass
# on multi-file net-new work (export shape + NodeNext import extension).
#
# Usage: diff="$(run_mutation_preflight_with_fix_attempts <edit_format> [targets...])"
run_mutation_preflight_with_fix_attempts() {
  local resolved_edit_format="$1"
  shift
  local mutation_targets=("$@")

  : "${AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS:=2}"
  local preflight_attempt=0
  local max_preflight_attempts=$((AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS + 1))
  local diff_content=""

  while true; do
    if run_mutation_preflight; then
      break
    fi

    preflight_attempt=$((preflight_attempt + 1))
    if [[ "${preflight_attempt}" -ge "${max_preflight_attempts}" ]] \
      || [[ "${#mutation_targets[@]}" -eq 0 ]]; then
      rollback_execution_surface
      aegis_fatal "mutation_preflight_failed"
    fi

    aegis_warn "mutation_preflight_failed — fix attempt ${preflight_attempt}/${AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS}"

    local fix_prompt
    fix_prompt="$(aider_mktemp)"
    assemble_preflight_fix_prompt \
      "${fix_prompt}" \
      "${resolved_edit_format}" \
      "${mutation_targets[@]}"

    invoke_aider "${fix_prompt}" "${resolved_edit_format}" "${mutation_targets[@]}"

    diff_content="$(capture_worktree_diff)"
    if [[ -z "${diff_content}" ]]; then
      rollback_execution_surface
      aegis_fatal "empty_diff: surface clean after preflight fix attempt"
    fi

    # Re-assert scope after fix attempts (model must not expand surface).
    assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"
  done

  # Auto-fix inside the lint gate may have rewritten files after the
  # last model edit; re-capture so the artifact matches the surface.
  diff_content="$(capture_worktree_diff)"
  if [[ -z "${diff_content}" ]]; then
    rollback_execution_surface
    aegis_fatal "empty_diff: surface clean after preflight"
  fi

  assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"
  printf '%s' "${diff_content}"
}

