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

HARD SCOPE: edit ONLY these files (never create or touch other paths):
${target_list}
If a prior edit introduced duplicate exports, remove the duplicate — do not redeclare existing names.

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

# ---------------------------------------------------------
# Mutation intent gates (repair) — demand fidelity on the diff
# ---------------------------------------------------------
# AEGIS_MUTATION_INTENT_PREFLIGHT:
#   soft (default) — fail preflight to trigger fix retry; if still dirty
#                    after max attempts, warn and allow (tsc already green)
#   hard           — fail until clean; exhaust → fatal
#   off            — warn only, never fail
# AEGIS_MUTATION_MAX_NEW_EXPORTS (default 1) — over-delivery cap on +exports
# AEGIS_DEMAND_TOKEN_PREFLIGHT=hard — legacy alias for intent hard on tokens
#   (prefer AEGIS_MUTATION_INTENT_PREFLIGHT)

# Added-line body of a unified diff (lowercase optional via caller).
_mutation_diff_added_lines() {
  printf '%s\n' "${1-}" \
    | grep -E '^\+' \
    | grep -vE '^\+\+\+' \
    || true
}

# Count new export function/const declarations in added lines.
count_diff_added_exports() {
  local added n
  added="$(_mutation_diff_added_lines "${1-}")"
  [[ -n "${added}" ]] || {
    printf '0'
    return 0
  }
  n="$(
    printf '%s\n' "${added}" \
      | grep -Eic \
        'export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[A-Za-z_]|export[[:space:]]+const[[:space:]]+[A-Za-z_]' \
      || true
  )"
  n="$(printf '%s' "${n}" | tr -d '[:space:]')"
  [[ -n "${n}" ]] || n=0
  printf '%s' "${n}"
}

# Collect intent violations into AEGIS_MUTATION_INTENT_DIAGNOSTICS (newline).
# Exit 0 = clean. Exit 1 = has violations (caller applies soft/hard policy).
collect_mutation_intent_violations() {
  local diff_content="${1-}"
  AEGIS_MUTATION_INTENT_DIAGNOSTICS=""
  export AEGIS_MUTATION_INTENT_DIAGNOSTICS
  [[ -n "${diff_content}" ]] || return 0
  [[ "${AEGIS_MODE:-}" == "repair" ]] || return 0

  local -a violations=()
  local added tokens token hit=0 token_list
  local export_n max_exports

  added="$(_mutation_diff_added_lines "${diff_content}")"
  [[ -n "${added}" ]] || return 0

  # --- dense demand tokens must appear in +lines ---
  if declare -f aegis_demand_dense_tokens >/dev/null 2>&1; then
    tokens="$(aegis_demand_dense_tokens "${AEGIS_INVESTIGATION_INPUT:-}")"
    if [[ -n "${tokens}" ]]; then
      hit=0
      while IFS= read -r token; do
        [[ -n "${token}" ]] || continue
        [[ "${#token}" -ge 4 ]] || continue
        if printf '%s' "${added}" | grep -Fqi -- "${token}"; then
          hit=1
          break
        fi
      done <<< "${tokens}"
      if [[ "${hit}" -eq 0 ]]; then
        token_list="$(printf '%s' "${tokens}" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
        violations+=("demand_tokens: none of [${token_list}] appear in added lines — align the edit with the demand/ALVO reason")
      fi
    fi
  fi

  # --- over-delivery: too many new exports ---
  : "${AEGIS_MUTATION_MAX_NEW_EXPORTS:=1}"
  max_exports="${AEGIS_MUTATION_MAX_NEW_EXPORTS}"
  export_n="$(count_diff_added_exports "${diff_content}")"
  if [[ "${export_n}" -gt "${max_exports}" ]]; then
    violations+=("over_export: ${export_n} new exports in diff (max ${max_exports}) — keep one demand-aligned export; remove parallels")
  fi

  if [[ "${#violations[@]}" -eq 0 ]]; then
    return 0
  fi

  AEGIS_MUTATION_INTENT_DIAGNOSTICS="$(printf '%s\n' "${violations[@]}")"
  export AEGIS_MUTATION_INTENT_DIAGNOSTICS
  return 1
}

# Policy wrapper: maps soft/hard/off → pass/fail for the preflight loop.
# Exit 0 = do not block. Exit 1 = intent failure (retry or hard-fail).
assert_mutation_intent_gates() {
  local diff_content="${1-}"
  local mode

  # Legacy: AEGIS_DEMAND_TOKEN_PREFLIGHT=hard upgrades intent to hard.
  mode="${AEGIS_MUTATION_INTENT_PREFLIGHT:-soft}"
  if [[ "${AEGIS_DEMAND_TOKEN_PREFLIGHT:-}" == "hard" ]]; then
    mode="hard"
  fi

  if ! collect_mutation_intent_violations "${diff_content}"; then
    case "$(printf '%s' "${mode}" | tr '[:upper:]' '[:lower:]')" in
      off|0|false|no|warn)
        aegis_warn "mutation_intent (warn-only): ${AEGIS_MUTATION_INTENT_DIAGNOSTICS//$'\n'/; }"
        return 0
        ;;
      hard|soft|retry|*)
        aegis_warn "mutation_intent: ${AEGIS_MUTATION_INTENT_DIAGNOSTICS//$'\n'/; }"
        return 1
        ;;
    esac
  fi
  return 0
}

# Legacy name: warn-only unless hard mode is set. Prefer assert_mutation_intent_gates.
assert_demand_tokens_in_mutation_diff() {
  local diff_content="${1-}"
  if [[ "${AEGIS_MUTATION_INTENT_PREFLIGHT:-}" == "hard" ]] \
    || [[ "${AEGIS_DEMAND_TOKEN_PREFLIGHT:-}" == "hard" ]]; then
    assert_mutation_intent_gates "${diff_content}"
    return $?
  fi
  if ! collect_mutation_intent_violations "${diff_content}"; then
    aegis_warn "demand_token_preflight_miss: ${AEGIS_MUTATION_INTENT_DIAGNOSTICS//$'\n'/; }"
  fi
  return 0
}

# Fix prompt when intent gates fail (tsc already green).
assemble_intent_fix_prompt() {
  local prompt_file="$1"
  local resolved_edit_format="$2"
  shift 2
  local prompt_targets=("$@")
  local target_list diagnostics handoff_line

  target_list="$(printf -- '- %s\n' "${prompt_targets[@]:-}")"
  diagnostics="${AEGIS_MUTATION_INTENT_DIAGNOSTICS:-"(intent mismatch)"}"
  handoff_line=""
  if declare -f aegis_format_forensics_handoff_section >/dev/null 2>&1; then
    handoff_line="$(
      aegis_format_forensics_handoff_section \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}" 2>/dev/null || true
    )"
  fi

  cat > "${prompt_file}" << EOF
You are fixing a demand-intent mismatch after a prior mutation inside Aegis Harness.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

HARD SCOPE: edit ONLY these files:
${target_list}

Original demand:
${AEGIS_INVESTIGATION_INPUT}

${handoff_line}
Intent violations (fix ONLY these):
$(printf '%s\n' "${diagnostics}" | sed 's/^/- /')

Rules:
- One demand → one minimal change; prefer exactly one new export matching the ALVO reason.
- Remove parallel/extra exports (Foo + FooExact, power helpers, etc.).
- Added lines must reflect demand tokens / directed conversion from the reason.
- Do not invent features absent from DEMAND / ALVO reason.
- Keep the surface compiling; do not expand scope.

YOUR TASK NOW: rewrite the loaded target so every intent violation above is resolved.
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

run_mutation_preflight() {

  local preflight_script="${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/mutation_preflight.sh"
  # AEGIS_MUTATION_PREFLIGHT_LAST: tools | intent | ok  (for fix-prompt routing)
  AEGIS_MUTATION_PREFLIGHT_LAST="ok"

  if [[ ! -f "${preflight_script}" ]]; then
    aegis_warn "mutation_preflight_script_missing — skipping tools; intent only"
  else
    aegis_log "Running one-shot mutation preflight (typescript.check + test.run + smoke.import)..."

    local changed_files=""
    local surface_diff=""
    surface_diff="$(capture_worktree_diff)"
    changed_files="$(
      list_mutation_changed_paths "${surface_diff}"
    )"

    if ! AEGIS_SUBSTRATE_ROOT="${AEGIS_AIDER_SUBSTRATE_ROOT}" \
      AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
      AEGIS_MUTATION_PREFLIGHT="${AEGIS_MUTATION_PREFLIGHT:-true}" \
      AEGIS_PREFLIGHT_CHANGED_FILES="${changed_files}" \
      bash "${preflight_script}" \
        "${AEGIS_EXECUTION_SURFACE_PATH}" \
        "${AIDER_CAPABILITY_PAYLOAD_DIR}"; then
      AEGIS_MUTATION_PREFLIGHT_LAST="tools"
      export AEGIS_MUTATION_PREFLIGHT_LAST
      return 1
    fi
  fi

  local surface_diff=""
  surface_diff="$(capture_worktree_diff)"
  if ! assert_mutation_intent_gates "${surface_diff}"; then
    AEGIS_MUTATION_PREFLIGHT_LAST="intent"
    export AEGIS_MUTATION_PREFLIGHT_LAST
    return 1
  fi

  AEGIS_MUTATION_PREFLIGHT_LAST="ok"
  export AEGIS_MUTATION_PREFLIGHT_LAST
  return 0
}

# Preflight with bounded model fix retries. Prints the final surface diff
# on stdout (for artifact emission). Tools failures use taxonomy fix prompt;
# intent failures use demand-alignment fix prompt. Soft intent may pass after
# exhausting retries (tsc green); hard intent / tools still fatal.
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
  local intent_mode

  intent_mode="${AEGIS_MUTATION_INTENT_PREFLIGHT:-soft}"
  if [[ "${AEGIS_DEMAND_TOKEN_PREFLIGHT:-}" == "hard" ]]; then
    intent_mode="hard"
  fi
  intent_mode="$(printf '%s' "${intent_mode}" | tr '[:upper:]' '[:lower:]')"

  while true; do
    if run_mutation_preflight; then
      break
    fi

    preflight_attempt=$((preflight_attempt + 1))
    if [[ "${preflight_attempt}" -ge "${max_preflight_attempts}" ]] \
      || [[ "${#mutation_targets[@]}" -eq 0 ]]; then
      # Soft intent only: accept diff after retries if tools are green.
      if [[ "${AEGIS_MUTATION_PREFLIGHT_LAST:-}" == "intent" ]] \
        && [[ "${intent_mode}" == "soft" || "${intent_mode}" == "retry" ]]; then
        aegis_warn "mutation_intent_soft_accept: still dirty after ${preflight_attempt} attempt(s) — emitting with warnings"
        break
      fi
      rollback_execution_surface
      aegis_fatal "mutation_preflight_failed:${AEGIS_MUTATION_PREFLIGHT_LAST:-unknown}"
    fi

    aegis_warn "mutation_preflight_failed (${AEGIS_MUTATION_PREFLIGHT_LAST:-?}) — fix attempt ${preflight_attempt}/${AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS}"

    local fix_prompt
    fix_prompt="$(aider_mktemp)"
    if [[ "${AEGIS_MUTATION_PREFLIGHT_LAST:-}" == "intent" ]]; then
      assemble_intent_fix_prompt \
        "${fix_prompt}" \
        "${resolved_edit_format}" \
        "${mutation_targets[@]}"
    else
      assemble_preflight_fix_prompt \
        "${fix_prompt}" \
        "${resolved_edit_format}" \
        "${mutation_targets[@]}"
    fi

    invoke_aider "${fix_prompt}" "${resolved_edit_format}" "${mutation_targets[@]}"

    diff_content="$(capture_worktree_diff)"
    if [[ -z "${diff_content}" ]]; then
      rollback_execution_surface
      aegis_warn "empty_diff after preflight fix attempt — continuing if retries left"
      continue
    fi

    if ! assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"; then
      aegis_warn "mutation_scope_violation on preflight fix — retry remaining attempts"
      continue
    fi
  done

  # Auto-fix inside the lint gate may have rewritten files after the
  # last model edit; re-capture so the artifact matches the surface.
  diff_content="$(capture_worktree_diff)"
  if [[ -z "${diff_content}" ]]; then
    rollback_execution_surface
    aegis_fatal "empty_diff: surface clean after preflight"
  fi

  if ! assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"; then
    aegis_fatal "mutation_scope_violation: after preflight"
  fi
  printf '%s' "${diff_content}"
}

