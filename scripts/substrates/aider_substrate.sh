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

# Cognition substrate: a model is mandatory here. Declare it before
# sourcing config so a missing/unconfigured model fails loudly at the
# config gate instead of silently downgrading to a stalling default.
export AEGIS_REQUIRE_MODEL=1

source ".harness/config.sh"

# Mutation timeouts: per-request (aider --timeout) and total wall clock
# (watchdog kill). Both operator-overridable. The wall clock defaults to
# whichever is larger: 300s, or three per-request timeouts — so raising
# AEGIS_AIDER_TIMEOUT can never make the watchdog clip a legitimate
# request/retry sequence.
: "${AEGIS_AIDER_TIMEOUT:=${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-120}}"
_aider_wallclock_floor=$(( AEGIS_AIDER_TIMEOUT * 3 ))
[[ "${_aider_wallclock_floor}" -lt 300 ]] && _aider_wallclock_floor=300
: "${AEGIS_AIDER_MAX_SECONDS:=${_aider_wallclock_floor}}"
unset _aider_wallclock_floor

# =========================================================
# INPUTS
# =========================================================

readonly AIDER_SKILL_FILE="${1:-}"
readonly AIDER_CAPABILITY_PAYLOAD_DIR="${2:-}"

AEGIS_AIDER_OUTPUT_LOG=""

# =========================================================
# LOGGING
# =========================================================

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
AEGIS_LOG_TAG="AIDER"

# =========================================================
# VALIDATION
# =========================================================

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

# =========================================================
# TARGET RESOLUTION
# =========================================================
#
# Resolve mutation targets from (in order, then dedupe):
# 1. Forensics repair_candidates / optimize files_changed (contract-mandatory)
# 2. UNION — operator-named paths in investigation input (multi-file demands)
# 3. UNION — required_evidence filesystem.read paths from handover
# 4. Fallback chain when still empty (builder / attention / search)
#

# jq over a file that may be absent or malformed; emits zero lines then.
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

  if [[ "${handover_mode}" == "repair" ]] && [[ "${AEGIS_MODE}" == "optimize" ]]; then
    mutation_jq_lines "${handover}" \
      '.artifact_snapshot.operational_context.files_changed[]? // empty'
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
  if [[ "${handover_mode}" == "repair" ]] && [[ "${AEGIS_MODE}" == "optimize" ]] \
    && [[ "${count}" -eq 0 ]]; then
    aegis_fatal "missing_repair_files_changed"
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
trap 'aegis_warn "Interrupted"; exit 130' INT TERM

# =========================================================
# CAPABILITY EVIDENCE INJECTION
# =========================================================

# Renders capability payload content into the mutation prompt.
# AEGIS_SELECTED_CAPABILITY_PAYLOADS is a JSON array of payload file paths.
# Each payload is a capability evidence document (git.diff, git.status,
# epistemic_handover, search_symbol, etc.) that the raw substrate sees.
# Without this, Aider only gets the investigation input string but not the
# structured evidence that defines what and why to mutate.

# Per-payload byte ceiling: a single verbose evidence blob (search_symbol
# match dumps, test.run stdout) can dwarf the small candidate/failure
# context that actually drives the edit and blow up Time-To-First-Token.
# Each payload is bounded independently; core context always survives.
: "${AEGIS_AIDER_EVIDENCE_MAX_BYTES:=8192}"

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

  local payload_path payload_bytes
  for payload_path in "${payload_paths[@]}"; do
    [[ -f "${payload_path}" ]] || continue
    if [[ -n "${only_matching}" ]] \
      && [[ "$(basename "${payload_path}")" != *"${only_matching}"* ]]; then
      continue
    fi
    printf '\n### %s\n\n' "$(basename "${payload_path}" .json)"
    payload_bytes="$(wc -c < "${payload_path}")"
    if [[ "${payload_bytes}" -le "${AEGIS_AIDER_EVIDENCE_MAX_BYTES}" ]]; then
      cat "${payload_path}"
    else
      head -c "${AEGIS_AIDER_EVIDENCE_MAX_BYTES}" "${payload_path}"
      printf '\n[AEGIS][EVIDENCE_TRUNCATED:%s->%s bytes]\n' \
        "${payload_bytes}" "${AEGIS_AIDER_EVIDENCE_MAX_BYTES}"
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
  cat <<EOF
FILE ACCESS CONSTRAINTS (NON-NEGOTIABLE):
The ONLY files you may edit are the ones already loaded into this chat:
${target_list}
You are FORBIDDEN from adding files to the chat.
Never ask for, request, suggest, or reference additional files to be added or edited.
File paths that appear inside the capability evidence payloads are READ-ONLY CONTEXT, not an invitation to open or edit them.
If the required change seems to involve a file that is not loaded, do NOT add it: apply the closest sufficient change within the loaded files only.
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
  cat <<EOF
CRITICAL — WHOLE-FILE EDIT FORMAT RULE:
Your reply MUST emit one filename + fenced block per target file (in any order):

${shape_blocks}
Rules:
- Use each filename EXACTLY as written above.
- Write the complete file content — never placeholders like '// ...' or '... rest of file'.
- Do NOT copy any code from this prompt's instructions or evidence; write only the code the task requires.
- If a file is currently a stub or empty (net-new), replace it with the full implementation the task demands.
- TypeScript (NodeNext): relative imports MUST use the .js extension (e.g. from './mod.js').
- TypeScript: keep export names that existing importers already use unless the demand renames them.
- TypeScript: new top-level functions use \`export function\` (not a bare unexported function) unless the demand forbids export.
- TypeScript: prefer strict, compilable code — explicit types, BigInt for high-precision counters when demanded, no any unless unavoidable.
- Implement ONLY what the investigation input demands. Do not create or keep unrelated modules.

If you use placeholders or omit code, the parser will fail and your changes will be discarded.
EOF
}

# Writes default (or mode-overridden) label + instructions into the two files.
mutation_prompt_resolve_mode_copy() {
  local label_file="$1"
  local instructions_file="$2"

  printf '%s' "Investigation input (operator mutation demand — single demand, apply once):" \
    > "${label_file}"
  cat > "${instructions_file}" <<'EOF'
Apply the minimal sufficient mutation described in the investigation input ONCE.
If the demand names one conversion or one behavior, implement exactly one function/change — not a family of variants.
TypeScript/JavaScript: new top-level functions SHOULD be `export function` (importable API), not a bare function, unless the demand forbids export.
Preserve runtime sovereignty, protocol integrity, and containment integrity.
Do not introduce speculative changes beyond what is explicitly requested.
Do not add explanations or narration.
Apply the change and stop.
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
  local -a prompt_targets=("$@")

  # Floor-model context control: full skill is hundreds of lines; with
  # explicit targets distill to binding core; full contract only in
  # no-targets fallback.
  if [[ "${#prompt_targets[@]}" -gt 0 ]]; then
    if [[ "${AEGIS_MODE}" == "optimize" ]]; then
      cat <<'DISTILLED'
Skill contract (bounded optimize core):
* Repair already applied the demand — RECOGNIZE the current files, then REFINE only.
* Mutate ONLY the target files already loaded in this chat.
* Safe simplifications only: less redundancy, clearer structure, tighter types — same behavior.
* If already minimal, make NO edits.
* No re-implementation of the demand, no feature removal, no new files, no renames.
* Output only file edits — no JSON, no explanations, no questions.
DISTILLED
    else
      cat <<'DISTILLED'
Skill contract (bounded mutation core):
* Implement EXACTLY what the investigation input demands — nothing more.
* Mutate ONLY the target files already loaded in this chat.
* No new files, no renames, no scope expansion, no unsolicited functions or logic.
* One demand → one change (no parallel variants).
* TypeScript: new top-level functions use export function (importable API).
* Preserve all existing code and behavior not named by the demand.
* Output only the file edits — no JSON, no explanations, no questions.
* NEVER ask for clarification. If the demand allows more than one reading, implement the most literal, minimal one and stop.

Type hygiene (always — any domain):
* Never use `any`, `as any`, or `@ts-ignore` / bare `@ts-expect-error`. Prefer precise types or `unknown` + narrowing.
* Public APIs: explicit parameter and return types on exported functions.
* Do not silence the typechecker; fix the type.

Module hygiene (always — any domain):
* Relative imports use NodeNext `.js` extension: `from './mod.js'` (even when the source file is `.ts`).
* Only import packages declared in package.json (or Node builtins). Never invent package names for language builtins.
* Language builtins (e.g. BigInt, JSON, Math) are globals — do not import them as npm packages.
* Keep existing export names stable unless the demand renames them.
DISTILLED
    fi
  else
    echo "Skill contract:"
    cat "${AIDER_SKILL_FILE}"
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

  local recency_anchor=""
  # Repair only — restating in optimize would invite re-implementation.
  if [[ "${AEGIS_MODE}" == "repair" ]]; then
    recency_anchor="YOUR TASK NOW: apply the single investigation demand stated above to the loaded target file(s) only. One minimal sufficient change — do not invent a second parallel API or duplicate the same conversion."
  fi

  local raw_prompt_file
  raw_prompt_file="$(aider_mktemp)"

  cat > "${raw_prompt_file}" << EOF
${AEGIS_CONSTITUTIONAL_PREAMBLE:+${AEGIS_CONSTITUTIONAL_PREAMBLE}

}You are executing inside Aegis Harness in bounded mutation mode.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

(note: repository file paths in this prompt are rendered with the "$(printf '\342\210\225')" division-slash separator — read them as normal repository paths; they are read-only context)

${skill_contract}

${pocket_section}

---

${input_label}
${AEGIS_INVESTIGATION_INPUT}
${capability_evidence}
---

${file_jail_instructions}

${anti_truncation_instructions:+${anti_truncation_instructions}

}${recency_anchor}

${mode_instructions}
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


# =========================================================
# SURFACE ROLLBACK
# =========================================================

# On mutation failure the execution surface must be restored to HEAD with
# no transient residue: tracked files reset, untracked leftovers removed.
rollback_execution_surface() {

  aegis_warn "Rolling back execution surface mutations..."

  (
    cd "${AEGIS_EXECUTION_SURFACE_PATH}" || exit 0
    # Clear intent-to-add index entries (net-new pre-materialized targets)
    # first: they block git clean from sweeping the file and make
    # checkout error on the blobless path.
    git --git-dir="${AEGIS_MUTATION_GIT_DIR}" --work-tree=. \
      reset -q >/dev/null 2>&1 || true
    git --git-dir="${AEGIS_MUTATION_GIT_DIR}" --work-tree=. \
      checkout -- . >/dev/null 2>&1 || true
    git --git-dir="${AEGIS_MUTATION_GIT_DIR}" --work-tree=. \
      clean -fd >/dev/null 2>&1 || true
  )
}

# =========================================================
# EDIT FORMAT RESOLUTION
# =========================================================

# Non-frontier models (gemma-class) stall in algorithmic diff-calculation
# loops under edit-format=diff. "whole" makes the model re-emit complete
# file content — reliable, and cheap while the target surface is small.
# "diff" is used only when re-emitting the targets would exceed the
# whole-format byte budget. Operator-overridable via
# AEGIS_AIDER_EDIT_FORMAT / AEGIS_AIDER_WHOLE_FORMAT_MAX_BYTES.
: "${AEGIS_AIDER_WHOLE_FORMAT_MAX_BYTES:=49152}"

resolve_aider_edit_format() {

  local targets=("$@")

  if [[ -n "${AEGIS_AIDER_EDIT_FORMAT:-}" ]]; then
    printf '%s' "${AEGIS_AIDER_EDIT_FORMAT}"
    return 0
  fi

  local total_bytes=0
  local t
  local size

  for t in "${targets[@]:-}"; do
    [[ -n "${t}" ]] || continue
    [[ -f "${AEGIS_EXECUTION_SURFACE_PATH}/${t}" ]] || continue
    size="$(wc -c < "${AEGIS_EXECUTION_SURFACE_PATH}/${t}")"
    total_bytes=$((total_bytes + size))
  done

  if [[ "${total_bytes}" -le "${AEGIS_AIDER_WHOLE_FORMAT_MAX_BYTES}" ]]; then
    printf 'whole'
  else
    printf 'diff'
  fi
}

# =========================================================
# AIDER INVOCATION
# =========================================================

assert_aider_not_stalling_config() {
  local resolved_edit_format="$1"
  # gemma-class non-frontier models loop indefinitely in whole-file emission.
  if [[ "${AEGIS_AIDER_MODEL,,}" == *gemma* ]] \
    && [[ "${resolved_edit_format}" == "whole" ]]; then
    aegis_fatal "stalling_model_configuration: '${AEGIS_AIDER_MODEL}' (gemma-class) stalls under whole edit format — configure a frontier mutation model or force AEGIS_AIDER_EDIT_FORMAT=diff"
  fi
}

# Ensure the disposable surface still exists (feedback loops may expunge it).
ensure_execution_surface_live() {
  if [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]]; then
    return 0
  fi
  aegis_warn "execution_surface_missing_before_invocation — waiting for surface re-initialization"
  local settle
  for settle in 1 2 3; do
    sleep 1
    [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] && return 0
  done
  aegis_fatal "execution_surface_vanished: ${AEGIS_EXECUTION_SURFACE_PATH}"
}

# Physical deny-all .aiderignore with per-target allow. Writes the file.
write_aiderignore_jail() {
  local aiderignore_file="$1"
  shift
  local file_args=("$@")

  # gitignore semantics: "*" excludes everything, "!*/" re-includes
  # directories so per-file negations can take effect.
  printf '*\n!*/\n' > "${aiderignore_file}"
  local f
  for f in "${file_args[@]:-}"; do
    [[ -z "${f}" ]] && continue
    printf '!%s\n' "${f}" >> "${aiderignore_file}"
  done
}

clear_aider_history_residue() {
  rm -f \
    "${AEGIS_EXECUTION_SURFACE_PATH}/.aider.chat.history.md" \
    "${AEGIS_EXECUTION_SURFACE_PATH}/.aider.input.history" \
    "${AEGIS_EXECUTION_SURFACE_PATH}/.aider.llm.history" \
    >/dev/null 2>&1 || true
}

# Run aider under a wall-clock watchdog.
# Side effects (must NOT run under command substitution — need parent shell):
#   AEGIS_AIDER_OUTPUT_LOG, AEGIS_AIDER_LAST_STATUS, AEGIS_AIDER_LAST_ELAPSED
AEGIS_AIDER_LAST_STATUS=0
AEGIS_AIDER_LAST_ELAPSED=0

run_aider_with_watchdog() {
  local aider_cmd=("$@")
  local aider_status=0
  local aider_pid watchdog_pid
  local aider_start_time aider_end_time

  AEGIS_AIDER_OUTPUT_LOG="$(aider_mktemp)"
  aider_start_time=$(date +%s)

  set +e
  (
    cd "${AEGIS_EXECUTION_SURFACE_PATH}" || {
      echo "[AEGIS][AIDER][FATAL] execution_surface_unreachable: ${AEGIS_EXECUTION_SURFACE_PATH}" >&2
      exit 97
    }

    # exec so the watchdog kill reaches aider, not a wrapper shell.
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    GIT_EDITOR=true \
    EDITOR=true \
      exec "${aider_cmd[@]}" >"${AEGIS_AIDER_OUTPUT_LOG}" 2>&1 </dev/null
  ) &
  aider_pid=$!

  (
    sleep "${AEGIS_AIDER_MAX_SECONDS}"
    kill "${aider_pid}" 2>/dev/null
    sleep 5
    kill -9 "${aider_pid}" 2>/dev/null
  ) >/dev/null 2>&1 &
  watchdog_pid=$!

  wait "${aider_pid}"
  aider_status=$?

  kill "${watchdog_pid}" 2>/dev/null
  wait "${watchdog_pid}" 2>/dev/null
  set -e

  aider_end_time=$(date +%s)
  AEGIS_AIDER_LAST_ELAPSED=$((aider_end_time - aider_start_time))
  AEGIS_AIDER_LAST_STATUS="${aider_status}"
  echo "[AEGIS][TIMING] aider_substrate_call: ${AEGIS_AIDER_LAST_ELAPSED}s" >&2
}

# Interpret non-zero aider exit: tolerate post-edit summarizer crash when
# edits landed; otherwise rollback + fatal.
interpret_aider_exit_status() {
  local aider_status="$1"
  local aider_elapsed="$2"

  [[ "${aider_status}" -eq 0 ]] && return 0

  # Deliverable is the worktree diff — if edits applied, proceed.
  if grep -q "Applied edit" "${AEGIS_AIDER_OUTPUT_LOG}" \
    && [[ -n "$(capture_worktree_diff)" ]]; then
    aegis_warn "aider exited with status ${aider_status} (possibly due to post-edit summarizer crash) but applied edits successfully — proceeding"
    return 0
  fi

  if [[ "${aider_elapsed}" -ge "${AEGIS_AIDER_MAX_SECONDS}" ]]; then
    aegis_warn "aider exceeded ${AEGIS_AIDER_MAX_SECONDS}s wall clock — killed by watchdog"
  else
    aegis_warn "aider invocation failed with exit status ${aider_status}"
  fi
  tail -n 60 "${AEGIS_AIDER_OUTPUT_LOG}" >&2
  rollback_execution_surface
  aegis_fatal "aider_execution_failed"
}

invoke_aider() {

  local prompt_file="$1"
  local resolved_edit_format="$2"
  shift 2
  local file_args=("$@")

  local mutation_conf="${AEGIS_AIDER_SUBSTRATE_ROOT}/.aider.mutation.conf.yml"

  assert_aider_not_stalling_config "${resolved_edit_format}"

  # Per-file structural lint gate (syntax → prettier → eslint → static_gate).
  # Project-wide tsc/tests run once in mutation_preflight after the diff.
  local lint_gate_cmd
  printf -v lint_gate_cmd 'bash "%s"' \
    "${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/aider_lint_gate.sh"

  local aider_cmd=(
    "${AEGIS_AIDER_BIN}"
    "--config" "${mutation_conf}"
    "--model" "${AEGIS_AIDER_MODEL}"
    "--openai-api-base" "${OPENAI_API_BASE}"
    "--message-file" "${prompt_file}"
    "--timeout" "${AEGIS_AIDER_TIMEOUT}"
    "--yes"
    "--yes-always"
    "--no-auto-commit"
    "--no-auto-commits"
    "--no-dirty-commits"
    "--git"
    "--skip-sanity-check-repo"
    "--subtree-only"
    "--map-tokens" "0"
    "--edit-format" "${resolved_edit_format}"
    "--no-stream"
    "--no-pretty"
    "--no-show-model-warnings"
    "--auto-lint"
    "--lint-cmd" "${lint_gate_cmd}"
    "--no-auto-test"
    "--no-restore-chat-history"
    "--no-check-update"
    "--no-detect-urls"
    "--no-suggest-shell-commands"
    "--analytics-disable"
    "--exit"
  )

  ensure_execution_surface_live

  local aiderignore_file="${AEGIS_EXECUTION_SURFACE_PATH}/.aiderignore"
  write_aiderignore_jail "${aiderignore_file}" "${file_args[@]:-}"

  if [[ "${#file_args[@]}" -gt 0 ]]; then
    local f
    for f in "${file_args[@]}"; do
      [[ -z "${f}" ]] && continue
      aider_cmd+=("--file" "${f}")
    done
  fi

  clear_aider_history_residue

  aegis_log "Invoking aider mutation substrate..."
  aegis_log "Model: ${AEGIS_AIDER_MODEL}"
  aegis_log "Edit format: ${resolved_edit_format}"
  aegis_log "Targets: ${file_args[*]:-<none>}"

  run_aider_with_watchdog "${aider_cmd[@]}"

  # Jail file is invocation-scoped — never leave it on the surface.
  rm -f "${aiderignore_file}" 2>/dev/null || true

  interpret_aider_exit_status "${AEGIS_AIDER_LAST_STATUS}" "${AEGIS_AIDER_LAST_ELAPSED}"
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

# Operational residue on the disposable surface is not mutation authority.
# Preflight may symlink node_modules; aider may drop .aiderignore — neither
# is a model-authored path and must not trip the hard scope gate.
mutation_path_is_operational_noise() {
  case "${1:-}" in
    node_modules|node_modules/*|*/node_modules|*/node_modules/*) return 0 ;;
    .aiderignore|.aider*|.DS_Store|*/.DS_Store) return 0 ;;
  esac
  return 1
}

# Paths touched by the mutation: unified-diff +++ b/ lines plus untracked
# residue (net-new files not yet in the diff stream).
list_mutation_changed_paths() {

  local diff_content="${1:-}"
  local from_diff=""
  local untracked=""
  local p

  if [[ -n "${diff_content}" ]]; then
    from_diff="$(
      printf '%s\n' "${diff_content}" \
        | command sed -n 's|^+++ b/||p' \
        | command sed 's|^\./||' \
        | command sed '/^$/d' \
        || true
    )"
  fi

  untracked="$(
    git -C "${AEGIS_EXECUTION_SURFACE_PATH}" ls-files --others --exclude-standard 2>/dev/null \
      | command sed 's|^\./||' \
      || true
  )"

  {
    printf '%s\n' "${from_diff}"
    printf '%s\n' "${untracked}"
  } | while IFS= read -r p; do
    [[ -n "${p}" ]] || continue
    mutation_path_is_operational_noise "${p}" && continue
    printf '%s\n' "${p}"
  done | sort -u
}

# Hard authority gate: every changed path must be ⊆ authorized targets.
# Soft jail (.aiderignore + prompt) is not enough — the real diff is truth.
# Empty authorized set skips (no-targets fallback already warned).
assert_mutation_diff_scope() {

  local diff_content="${1:-}"
  shift
  local -a authorized_targets=("$@")

  if [[ "${#authorized_targets[@]}" -eq 0 ]]; then
    aegis_warn "mutation_scope_gate_skipped: no authorized targets resolved"
    return 0
  fi

  local scope_lib="${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/mutation_scope_gate.sh"
  if [[ ! -f "${scope_lib}" ]]; then
    aegis_warn "mutation_scope_gate_missing — skipping hard scope check"
    return 0
  fi

  # shellcheck disable=SC1090
  source "${scope_lib}"

  local authorized_blob changed_blob offenders
  authorized_blob="$(printf '%s\n' "${authorized_targets[@]}")"
  changed_blob="$(list_mutation_changed_paths "${diff_content}")"

  if [[ -z "$(printf '%s' "${changed_blob}" | sed '/^$/d')" ]]; then
    return 0
  fi

  offenders=""
  if ! offenders="$(mutation_scope_check "${authorized_blob}" "${changed_blob}")"; then
    local offender_csv
    offender_csv="$(printf '%s\n' "${offenders}" | paste -sd ',' - | sed 's/,/, /g')"
    aegis_warn "mutation_scope_violation offenders: ${offender_csv}"
    aegis_warn "authorized targets were: $(printf '%s ' "${authorized_targets[@]}")"
    rollback_execution_surface
    aegis_fatal "mutation_scope_violation: ${offender_csv}"
  fi

  aegis_log "mutation_scope_gate: ok ($(printf '%s\n' "${changed_blob}" | sed '/^$/d' | wc -l | tr -d ' ') path(s) within authorized set)"
}

# =========================================================
# ARTIFACT EMISSION
# =========================================================

# The model declares nothing: files_changed and attention routing are
# parsed from the real worktree diff (Minimal Cognitive Artifacts).
emit_mutation_artifact() {

  local diff_content="$1"

  local files_changed
  files_changed="$(
    printf '%s\n' "${diff_content}" \
      | jq -cRn '[inputs | select(startswith("+++ b/")) | ltrimstr("+++ b/")]'
  )"

  local artifact_tmp
  artifact_tmp="$(aider_mktemp)"

  local diff_tmp
  diff_tmp="$(aider_mktemp)"
  printf '%s' "${diff_content}" > "${diff_tmp}"

  local attention_reason
  attention_reason="ATTENTION_REASON_$(printf '%s' "${AEGIS_MODE}" | tr '[:lower:]' '[:upper:]')"

  jq -n \
    --arg mode "${AEGIS_MODE}" \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
    --arg attention_reason "${attention_reason}" \
    --rawfile diff "${diff_tmp}" \
    --argjson files_changed "${files_changed}" \
    '{
      mode: $mode,
      execution_id: $execution_id,
      diff: $diff,
      files_changed: $files_changed,
      handover_attention: {
        next_attention_targets: $files_changed,
        attention_scope: "mutation_applied",
        attention_reason: $attention_reason
      }
    }' > "${artifact_tmp}"

  echo "${AEGIS_ARTIFACT_BEGIN_MARKER}"
  cat "${artifact_tmp}"
  echo "${AEGIS_ARTIFACT_END_MARKER}"
}

# =========================================================
# MAIN
# =========================================================

# The execution surface is a disposable `git worktree` with its own index
# (.git/worktrees/<mode>/index). Scope EVERY mutation git operation to that
# index instead of the operator's main .git so the net-new intent-to-add
# pre-materialization can never leave a phantom staged entry in the
# operator's index. The worktree index is destroyed when the surface is
# expunged, so no residue survives on any exit path — success, failure, or
# signal. Without this, a successful net-new creation (which never takes the
# rollback path that clears intent-to-add) permanently pollutes the main
# index, and that phantom path resurfaces in `git ls-files` → pocket map.
scope_mutation_git_dir_to_surface() {

  local surface_git_dir
  surface_git_dir="$(
    git -C "${AEGIS_EXECUTION_SURFACE_PATH}" rev-parse --absolute-git-dir 2>/dev/null
  )" || true

  if [[ -n "${surface_git_dir}" && -d "${surface_git_dir}" ]]; then
    AEGIS_MUTATION_GIT_DIR="${surface_git_dir}"
    aegis_log "Mutation git-dir scoped to disposable surface index: ${AEGIS_MUTATION_GIT_DIR}"
  else
    aegis_warn "surface_git_dir_unresolved — mutation ops retain ${AEGIS_MUTATION_GIT_DIR}"
  fi
}

# Classify a single diagnostic line into a stable error family for floor models.
# Families: any | import | type | runtime_load | other
# Order matters: more specific families first. Avoid bare *any* (false positives).
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

  # ---------------------------------------------------------
  # OPTIMIZE SHORT-CIRCUIT (KISS)
  # ---------------------------------------------------------
  # Runtime already applied the Repair candidate onto this surface.
  # When that diff is small, a second LLM pass almost always returns
  # no_optimization_needed (observed ~17–20s wasted). Forward the
  # surface diff without calling the model. Set AEGIS_OPTIMIZE_LLM=1
  # to force a refine pass, or raise AEGIS_OPTIMIZE_MIN_LINES.
  # ---------------------------------------------------------
  local diff_content=""
  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    : "${AEGIS_OPTIMIZE_MIN_LINES:=24}"
    : "${AEGIS_OPTIMIZE_LLM:=0}"
    local baseline_diff baseline_lines
    baseline_diff="$(capture_worktree_diff)"
    baseline_lines="$(printf '%s\n' "${baseline_diff}" | wc -l | tr -d ' ')"
    if [[ -z "${baseline_diff}" ]]; then
      rollback_execution_surface
      aegis_fatal "empty_diff: optimize surface has no repair candidate applied"
    fi
    if [[ "${AEGIS_OPTIMIZE_LLM}" != "1" ]] \
      && [[ "${baseline_lines}" -le "${AEGIS_OPTIMIZE_MIN_LINES}" ]]; then
      aegis_log "optimize_shortcircuit: repair diff is ${baseline_lines} lines (≤ ${AEGIS_OPTIMIZE_MIN_LINES}); forwarding without LLM (AEGIS_OPTIMIZE_LLM=1 to force refine)"
      emit_mutation_artifact "${baseline_diff}"
      aegis_log "Aider mutation substrate completed (optimize short-circuit)"
      return 0
    fi
    aegis_log "optimize_llm_refine: lines=${baseline_lines} AEGIS_OPTIMIZE_LLM=${AEGIS_OPTIMIZE_LLM}"
  fi

  # Edit format resolved exactly once (one wc -c pass over the targets);
  # prompt assembly and the invocation both consume the same value.
  local resolved_edit_format
  resolved_edit_format="$(resolve_aider_edit_format "${mutation_targets[@]:-}")"

  local prompt_file
  prompt_file="$(aider_mktemp)"
  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    assemble_mutation_prompt "${prompt_file}" "${resolved_edit_format}" "${mutation_targets[@]}"
  else
    assemble_mutation_prompt "${prompt_file}" "${resolved_edit_format}"
  fi

  if [[ "${#mutation_targets[@]}" -gt 0 ]]; then
    invoke_aider "${prompt_file}" "${resolved_edit_format}" "${mutation_targets[@]}"
  else
    invoke_aider "${prompt_file}" "${resolved_edit_format}"
  fi

  aegis_log "Capturing worktree diff..."

  diff_content="$(capture_worktree_diff)"

  if [[ -z "${diff_content}" ]]; then
    if [[ -n "${AEGIS_AIDER_OUTPUT_LOG:-}" && -f "${AEGIS_AIDER_OUTPUT_LOG}" ]]; then
      echo "[DEBUG] Aider output log:" >&2
      cat "${AEGIS_AIDER_OUTPUT_LOG}" >&2
    fi
    # No tracked changes, but aider may still have left untracked residue.
    rollback_execution_surface
    aegis_fatal "empty_diff: aider produced no changes"
  fi

  # Hard scope gate before any preflight spend (authority, not style).
  assert_mutation_diff_scope "${diff_content}" "${mutation_targets[@]:-}"

  # Post-diff preflight + bounded fix retries; returns final surface diff.
  diff_content="$(
    run_mutation_preflight_with_fix_attempts \
      "${resolved_edit_format}" \
      "${mutation_targets[@]:-}"
  )"

  aegis_log "Emitting mutation artifact..."
  emit_mutation_artifact "${diff_content}"
  aegis_log "Aider mutation substrate completed"
}

# =========================================================
# POST-DIFF PREFLIGHT (runtime evidence, not aider reflection)
# =========================================================

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
  changed_files="$(
    list_mutation_changed_paths "$(capture_worktree_diff)"
  )"

  # Return status only — caller owns rollback / fix-retry policy.
  AEGIS_SUBSTRATE_ROOT="${AEGIS_AIDER_SUBSTRATE_ROOT}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_MUTATION_PREFLIGHT="${AEGIS_MUTATION_PREFLIGHT:-true}" \
    AEGIS_PREFLIGHT_CHANGED_FILES="${changed_files}" \
    bash "${preflight_script}" \
      "${AEGIS_EXECUTION_SURFACE_PATH}" \
      "${AIDER_CAPABILITY_PAYLOAD_DIR}"
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

main "$@"
