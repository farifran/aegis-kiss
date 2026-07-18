#!/usr/bin/env bash
# Source-only — mutation prompt assembly (loaded by aider_substrate.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] aider_prompt_lib_not_invocable" >&2
  exit 1
fi

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
trap 'aegis_warn "Interrupted"; exit 130' INT TERM

inject_capability_evidence() {

  # Optional basename filter: when mutation targets are already loaded
  # into the chat via --file, most evidence payloads are redundant noise
  # that drowns small (floor) models — the caller then restricts the
  # evidence to the payloads matching this substring (e.g. the epistemic
  # handover, which carries repair_feedback on feedback iterations).
  local only_matching="${1:-}"

  [[ -n "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" ]] || return 0

  local payload_paths
  mapfile -t payload_paths < <(
    printf '%s' "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
      | jq -r '.[]?' 2>/dev/null || true
  )

  [[ "${#payload_paths[@]}" -gt 0 ]] || return 0

  printf '\n---\n\nCapability evidence payloads:\n'

  # set -u safe: optional operator override, else payload budget, else floor.
  local max_bytes="${AEGIS_AIDER_EVIDENCE_MAX_BYTES:-${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-12000}}"

  local payload_path payload_bytes
  for payload_path in "${payload_paths[@]}"; do
    [[ -f "${payload_path}" ]] || continue
    if [[ -n "${only_matching}" ]] \
      && [[ "$(basename "${payload_path}")" != *"${only_matching}"* ]]; then
      continue
    fi
    printf '\n### %s\n\n' "$(basename "${payload_path}" .json)"
    payload_bytes="$(wc -c < "${payload_path}")"
    if [[ "${payload_bytes}" -le "${max_bytes}" ]]; then
      cat "${payload_path}"
    else
      head -c "${max_bytes}" "${payload_path}"
      printf '\n[AEGIS][EVIDENCE_TRUNCATED:%s->%s bytes]\n' \
        "${payload_bytes}" "${max_bytes}"
    fi
    printf '\n'
  done
}

# Aider regex-sniffs prompt text for path-shaped strings and, under
# --yes-always, force-adds every match to the chat. Repository paths
# occur throughout the assembled prompt (evidence payloads, the skill
# contract, the constitutional preamble, the investigation input), so
# the "/" delimiter is swapped for the visually identical division
# slash (U+2215) across the WHOLE prompt: no longer path-shaped to
# aider's sniffer, still perfectly readable path context for the LLM.
obfuscate_evidence_paths() {
  local division_slash
  division_slash="$(printf '\342\210\225')"
  sed "s|/|${division_slash}|g"
}

# =========================================================
# MUTATION PROMPT ASSEMBLY
# =========================================================

# Emit file-jail block for the loaded mutation targets.
mutation_prompt_file_jail() {
  local -a prompt_targets=("$@")
  local target_list="(none — mutate only what the investigation input names among the files already in the chat)"
  if [[ "${#prompt_targets[@]}" -gt 0 ]]; then
    target_list="$(printf -- '- %s\n' "${prompt_targets[@]}")"
  fi
  # Path list is the corrective power; skill owns edit policy.
  cat <<EOF
FILE JAIL — edit ONLY these loaded files:
${target_list}
Do not add files to the chat. Paths in evidence are read-only. If a needed path is not listed, change only within the list above.
EOF
}

# Whole-format anti-truncation instructions (empty string when not whole).
mutation_prompt_anti_truncation() {
  local resolved_edit_format="$1"
  shift
  local -a prompt_targets=("$@")

  [[ "${resolved_edit_format}" == "whole" ]] || return 0

  local shape_blocks=""
  local shape_target
  if [[ "${#prompt_targets[@]}" -eq 0 ]]; then
    shape_blocks="<target file>
\`\`\`
<the ENTIRE new content>
\`\`\`"
  else
    for shape_target in "${prompt_targets[@]}"; do
      shape_blocks+="${shape_target}
\`\`\`
<the ENTIRE new content of ${shape_target}, from the very first line to the very last line>
\`\`\`

"
    done
  fi
  # Format-only: policy (TS, one-export, demand) lives in the skill contract.
  cat <<EOF
CRITICAL — WHOLE-FILE EDIT FORMAT RULE:
Your reply MUST emit one filename + fenced block per target file (in any order):

${shape_blocks}
Rules:
- Use each filename EXACTLY as written above.
- Write the complete file content — never placeholders like '// ...' or '... rest of file'.
- Do NOT copy code from this prompt's instructions or evidence.
- Empty/stub loaded targets: write the full implementation the demand needs.

If you use placeholders or omit code, the parser will fail and your changes will be discarded.
EOF
}

# Writes default (or mode-overridden) label + instructions into the two files.
mutation_prompt_resolve_mode_copy() {
  local label_file="$1"
  local instructions_file="$2"

  # Default = first-pass repair. Policy lives in the skill; this is only the close cue.
  printf '%s' "Investigation input (operator mutation demand):" \
    > "${label_file}"
  cat > "${instructions_file}" <<'EOF'
Apply the investigation input to the loaded target file(s) once. Follow the skill contract. Edits only — stop.
EOF

  # Local repair feedback: fix only structured violations inside authorized_scopes.
  if [[ "${AEGIS_MODE}" == "repair" ]] \
    && [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}" ]] \
    && jq -e '
        .artifact_snapshot.mode == "validation"
        and .artifact_snapshot.operational_context.verdict == "rejected"
        and (.artifact_snapshot.operational_context.repair_feedback | type == "object")
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1; then
    local feedback_summary
    feedback_summary="$(
      jq -r '
        .artifact_snapshot.operational_context.repair_feedback as $rf
        | "authorized_scopes: " + (($rf.authorized_scopes // []) | join(", "))
          + "\nviolations:\n"
          + (
              ($rf.violations // [])
              | map("  - [" + (.severity // "?") + "] " + (.origin // "?")
                    + ": " + (.structural_reason // ""))
              | join("\n")
            )
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE}" 2>/dev/null || true
    )"
    printf '%s' "Original investigation input (repair feedback iteration — fix only listed violations):" > "${label_file}"
    cat > "${instructions_file}" <<EOF
CRITICAL — LOCAL REPAIR FEEDBACK (no rediscovery):
A prior validation REJECTED the candidate. Fix ONLY the structured violations below inside authorized_scopes.
Do NOT re-implement the whole demand from scratch unless a violation requires it.
Do NOT expand scope beyond authorized_scopes / loaded targets.
Do NOT add features unrelated to the violations.
Emit edits only — no narration.

${feedback_summary}

Apply the minimal fix and stop.
EOF
  fi

  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    printf '%s' "Original investigation input (already applied by Repair — do NOT re-implement):" > "${label_file}"
    cat > "${instructions_file}" <<'EOF'
CRITICAL — OPTIMIZE MODE (recognize → refine):
1. The Repair candidate is ALREADY applied on this workspace. Read the loaded files as the post-Repair truth.
2. First recognize what changed relative to the demand: which behavior Repair introduced and where.
3. Then apply ONLY safe, functionality-preserving improvements inside the loaded files:
   - remove redundancy / dead code introduced by Repair
   - tighten types, naming, and local structure without changing behavior
   - collapse obvious duplication
4. If the post-Repair code is already minimal and correct, make NO edits and stop.
5. Forbidden: re-implementing the investigation demand from scratch; removing Repair features; new files; renames; speculative features; narration.
Simplify in place or leave unchanged. Stop.
EOF
  fi
}

mutation_prompt_skill_contract() {
  # Single source of truth: .skills/<mode>.md (kept short for floor models).
  # Always inject the skill file — no hardcoded DISTILLED that drifts from it.
  echo "Skill contract:"
  if [[ -n "${AIDER_SKILL_FILE:-}" && -f "${AIDER_SKILL_FILE}" ]]; then
    cat "${AIDER_SKILL_FILE}"
    return 0
  fi
  # Fallback if skill path missing (should not happen in normal runs).
  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    cat <<'DISTILLED'
* Repair already applied the demand — REFINE only; same behavior.
* Mutate ONLY loaded targets. No new files, renames, or re-implementation.
* Output only file edits — no JSON, no questions.
DISTILLED
  else
    cat <<'DISTILLED'
* Implement EXACTLY the investigation demand on loaded targets only.
* One demand → one change. No parallel APIs, no narration.
* TypeScript: export function for new APIs; no any; NodeNext .js imports.
DISTILLED
  fi
}

mutation_prompt_pocket_map_section() {
  local -a prompt_targets=("$@")
  # Once exact targets are loaded, the census is pure redundant context.
  if [[ "${#prompt_targets[@]}" -eq 0 ]] \
    && [[ -n "${AEGIS_POCKET_MAP_FILE:-}" ]] && [[ -s "${AEGIS_POCKET_MAP_FILE}" ]]; then
    echo "Repository pocket map (flat path census — read-only baseline context):"
    cat "${AEGIS_POCKET_MAP_FILE}"
  fi
}

assemble_mutation_prompt() {

  local prompt_file="$1"
  local resolved_edit_format="$2"
  shift 2
  local prompt_targets=("$@")

  # Floor-model noise control: with explicit targets already loaded into
  # the chat, keep only the epistemic handover. Full evidence only in
  # the no-targets fallback.
  local capability_evidence
  if [[ "${#prompt_targets[@]}" -gt 0 ]]; then
    capability_evidence="$(inject_capability_evidence "epistemic_handover")"
  else
    capability_evidence="$(inject_capability_evidence)"
  fi

  local file_jail_instructions anti_truncation_instructions
  file_jail_instructions="$(mutation_prompt_file_jail "${prompt_targets[@]:-}")"
  anti_truncation_instructions="$(
    mutation_prompt_anti_truncation "${resolved_edit_format}" "${prompt_targets[@]:-}"
  )"

  local label_file instructions_file
  label_file="$(aider_mktemp)"
  instructions_file="$(aider_mktemp)"
  mutation_prompt_resolve_mode_copy "${label_file}" "${instructions_file}"
  local input_label mode_instructions
  input_label="$(cat "${label_file}")"
  mode_instructions="$(cat "${instructions_file}")"

  local skill_contract pocket_section
  skill_contract="$(mutation_prompt_skill_contract "${prompt_targets[@]:-}")"
  pocket_section="$(mutation_prompt_pocket_map_section "${prompt_targets[@]:-}")"

  local demand_anchors_section=""
  if declare -f aegis_format_demand_anchors_section >/dev/null 2>&1; then
    demand_anchors_section="$(aegis_format_demand_anchors_section)"
  fi

  # Repair: forensics handoff + mutation brief + optional validation feedback.
  local forensics_handoff_section=""
  local mutation_brief_section=""
  local repair_feedback_section=""
  if [[ "${AEGIS_MODE}" == "repair" ]]; then
    if declare -f aegis_format_repair_feedback_section >/dev/null 2>&1; then
      repair_feedback_section="$(
        aegis_format_repair_feedback_section "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
      )"
    fi
    if declare -f aegis_format_forensics_handoff_section >/dev/null 2>&1; then
      forensics_handoff_section="$(
        aegis_format_forensics_handoff_section "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"
      )"
    fi
    if declare -f aegis_format_mutation_brief_section >/dev/null 2>&1; then
      # Prefer execution surface for exports/probe; fall back to cwd.
      local _brief_root="${AEGIS_EXECUTION_SURFACE_PATH:-.}"
      mutation_brief_section="$(
        aegis_format_mutation_brief_section \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-}" \
          "${_brief_root}"
      )"
      unset _brief_root
    fi
  fi

  local raw_prompt_file
  raw_prompt_file="$(aider_mktemp)"

  # Ownership (no policy echo):
  #   skill = edit policy | anchors/ALVO/BRIEF/feedback = instance data
  #   jail = path list | anti-truncation = whole format only | mode_instructions = close cue
  cat > "${raw_prompt_file}" << EOF
${AEGIS_CONSTITUTIONAL_PREAMBLE:+${AEGIS_CONSTITUTIONAL_PREAMBLE}

}You are executing inside Aegis Harness in bounded mutation mode.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

(note: repository file paths in this prompt are rendered with the "$(printf '\342\210\225')" division-slash separator — read them as normal repository paths; they are read-only context)

${skill_contract}

${pocket_section}

---

${demand_anchors_section}${repair_feedback_section}${forensics_handoff_section}${mutation_brief_section}${input_label}
${AEGIS_INVESTIGATION_INPUT}
${capability_evidence}
---

${file_jail_instructions}

${anti_truncation_instructions:+${anti_truncation_instructions}

}${mode_instructions}
EOF

  # Whole-prompt path obfuscation: every source above (skill contract,
  # preamble, evidence, investigation input) may carry real repository
  # paths that aider's mention-sniffer would otherwise pick up.
  obfuscate_evidence_paths < "${raw_prompt_file}" > "${prompt_file}"

  # CRITICAL de-obfuscation of the MUTATION TARGETS themselves: the jail
  # list and edit instructions must show the REAL path, because floor
  # models echo the filename verbatim in their whole-format reply — an
  # obfuscated name (src∕index.ts, U+2215) makes aider write a junk file
  # with that literal name instead of editing the tracked target, which
  # then captures as an empty diff. The targets are already loaded in the
  # chat, so the mention-sniffer re-detecting them is harmless.
  if [[ "${#prompt_targets[@]}" -gt 0 ]]; then
    local t obf_t restored_file
    restored_file="$(aider_mktemp)"
    cp "${prompt_file}" "${restored_file}"
    for t in "${prompt_targets[@]}"; do
      obf_t="${t//\//$(printf '\342\210\225')}"
      sed -i.bak "s|${obf_t}|${t}|g" "${restored_file}" 2>/dev/null \
        && rm -f "${restored_file}.bak"
    done
    mv "${restored_file}" "${prompt_file}"
  fi
}



