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
      || aegis_fatal "missing_forensics_repair_candidates"
  elif [[ "${handover_mode}" == "repair" ]] && [[ "${AEGIS_MODE}" == "optimize" ]]; then
    collect < <(jq_lines "${handover}" \
      '.artifact_snapshot.operational_context.files_changed[]? // empty')
    [[ "${#targets[@]}" -gt 0 ]] \
      || aegis_fatal "missing_repair_files_changed"
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
      if ! mkdir -p "$(dirname "${AEGIS_EXECUTION_SURFACE_PATH}/${t}")" \
        || ! : > "${AEGIS_EXECUTION_SURFACE_PATH}/${t}"; then
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

assemble_mutation_prompt() {

  local prompt_file="$1"
  local resolved_edit_format="$2"
  shift 2
  local prompt_targets=("$@")

  local capability_evidence
  capability_evidence="$(inject_capability_evidence)"

  # File jail: the model must operate exclusively on the pre-loaded
  # targets. Evidence payloads mention many repository paths; without
  # this prohibition the model asks for them and --yes-always floods
  # the chat context with the whole repository.
  local target_list="(none — mutate only what the investigation input names among the files already in the chat)"
  if [[ "${#prompt_targets[@]}" -gt 0 ]]; then
    target_list="$(printf -- '- %s\n' "${prompt_targets[@]}")"
  fi

  local file_jail_instructions="FILE ACCESS CONSTRAINTS (NON-NEGOTIABLE):
The ONLY files you may edit are the ones already loaded into this chat:
${target_list}
You are FORBIDDEN from adding files to the chat.
Never ask for, request, suggest, or reference additional files to be added or edited.
File paths that appear inside the capability evidence payloads are READ-ONLY CONTEXT, not an invitation to open or edit them.
If the required change seems to involve a file that is not loaded, do NOT add it: apply the closest sufficient change within the loaded files only."

  # Anti-lazy-truncation constraint: under the whole edit format the
  # model must re-emit complete files; placeholder elision makes aider's
  # parser reject the reply and re-request it until the watchdog fires.
  # The format is resolved ONCE in main() and passed down, so prompt and
  # invocation can never disagree and target files are sized only once.
  local anti_truncation_instructions=""
  if [[ "${resolved_edit_format}" == "whole" ]]; then
    anti_truncation_instructions="ANTI-LAZY TRUNCATION CONSTRAINT (ABSOLUTE — WHOLE-FILE EDIT FORMAT):
When you emit a file, you MUST re-emit EVERY SINGLE LINE of that file from the first line to the last, exactly as it exists, with your requested change integrated.
You are FORBIDDEN from using placeholders, ellipses, or omission comments of any kind — including but not limited to:
- // ... existing code ...
- // rest of file stays the same
- /* unchanged */
- # ...
- ...
Every existing function, import, comment, and blank line MUST appear verbatim in your output alongside the new requested change.
If you omit, summarize, or abbreviate ANY existing line, aider's parsing engine WILL REJECT your response and the mutation WILL FAIL.
Do not shorten. Do not elide. Emit the complete file content, every time."
  fi

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

  local raw_prompt_file
  raw_prompt_file="$(aider_mktemp)"

  cat > "${raw_prompt_file}" << EOF
${AEGIS_CONSTITUTIONAL_PREAMBLE:+${AEGIS_CONSTITUTIONAL_PREAMBLE}

}You are executing inside Aegis Harness in bounded mutation mode.

Mode: ${AEGIS_MODE}
Execution ID: ${AEGIS_EXECUTION_ID}

(note: repository file paths in this prompt are rendered with the "$(printf '\342\210\225')" division-slash separator — read them as normal repository paths; they are read-only context)

Skill contract:
$(cat "${AIDER_SKILL_FILE}")

$(
  # Context slimming: the pocket map is a flat census of every repo path.
  # Once the exact mutation targets are loaded via --file, that census is
  # pure redundant context that inflates Time-To-First-Token. Emit it ONLY
  # in the no-targets fallback, where the model still needs a scope hint.
  if [[ "${#prompt_targets[@]}" -eq 0 ]] \
    && [[ -n "${AEGIS_POCKET_MAP_FILE:-}" ]] && [[ -s "${AEGIS_POCKET_MAP_FILE}" ]]; then
    echo "Repository pocket map (flat path census — read-only baseline context):"
    cat "${AEGIS_POCKET_MAP_FILE}"
  fi
)

---

${input_label}
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

invoke_aider() {

  local prompt_file="$1"
  local resolved_edit_format="$2"
  shift 2
  local file_args=("$@")

  local mutation_conf="${AEGIS_AIDER_SUBSTRATE_ROOT}/.aider.mutation.conf.yml"
  local aider_output
  local aider_status

  # Stalling-configuration precondition (was a passive comment): gemma-class
  # non-frontier models loop indefinitely in whole-file emission and only
  # ever surface as a 360s watchdog kill with an empty diff. Refuse the
  # combination up front with a loud, deterministic fatal instead of
  # burning the wall-clock budget on a known dead end.
  if [[ "${AEGIS_AIDER_MODEL,,}" == *gemma* ]] \
    && [[ "${resolved_edit_format}" == "whole" ]]; then
    aegis_fatal "stalling_model_configuration: '${AEGIS_AIDER_MODEL}' (gemma-class) stalls under whole edit format — configure a frontier mutation model or force AEGIS_AIDER_EDIT_FORMAT=diff"
  fi

  # Accelerated local validation loop: after each applied edit, aider
  # runs the per-file structural gate (bash -n / node --check / tsc
  # --noResolve single-file) on ONLY the modified delta and self-corrects
  # structural breakage in its bounded internal reflection step, before
  # the artifact ever reaches the runtime state machine. Quoted so the
  # absolute path survives shlex splitting.
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
    # Full headless mode: --yes auto-accepts every interactive check
    # (file-addition confirmations included) and --yes-always keeps the
    # session non-interactive across retries — no prompt may ever block
    # the pipeline waiting for a human.
    "--yes"
    "--yes-always"
    # No background git operations from aider: --no-auto-commit(s)
    # blocks auto-commit entirely, so no commit editor can ever spawn
    # and freeze the headless worktree until the watchdog fires.
    "--no-auto-commit"
    "--no-auto-commits"
    "--no-dirty-commits"
    # Git stays ENABLED so aider recognizes the ephemeral worktree
    # ("Git repo: none" otherwise). Repo-scanning costs are stripped
    # instead: no sanity check, no repo map, subtree-only discovery.
    "--git"
    "--skip-sanity-check-repo"
    "--subtree-only"
    "--map-tokens" "0"
    # Edit format is resolved dynamically (see resolve_aider_edit_format):
    # "whole" for small target surfaces so non-frontier models emit the
    # complete file instead of stalling in a diff-calculation loop;
    # "diff" only when the target surface is too large to re-emit.
    "--edit-format" "${resolved_edit_format}"
    # Proxy/network hang containment:
    # --no-stream forces atomic payload delivery — no infinite loops on
    #   broken chunk streams or missing EOF markers from the API proxy;
    # --no-check-update stops background internet pings in the headless
    #   runner;
    # --no-suggest-shell-commands disables interactive shell-command
    #   reasoning that can block non-interactive execution threads.
    "--no-stream"
    "--no-pretty"
    "--no-show-model-warnings"
    # Ultra-fast internal validation loop: structural gate on the edited
    # files only (no workspace-wide processes). Broad verification stays
    # with the adversarial/validation stages; the wall-clock watchdog
    # and aider's own reflection cap bound any correction loop.
    "--auto-lint"
    "--lint-cmd" "${lint_gate_cmd}"
    "--no-auto-test"
    # No prior-session chat history may be replayed into the message
    # stream: history injects volatile turns ahead of the prompt file
    # and breaks KV-cache prefix stability across invocations.
    "--no-restore-chat-history"
    "--no-check-update"
    "--no-detect-urls"
    "--no-suggest-shell-commands"
    # aider's analytics default is "random": suppress the PostHog
    # telemetry path entirely — no non-deterministic background network
    # evaluation in the headless runner.
    "--analytics-disable"
    "--exit"
  )

  # Mutation runs one bounded internal reflection loop: the per-file
  # structural lint gate above (milliseconds per check, capped by aider's
  # reflection limit and the wall-clock watchdog). Test suites and
  # workspace-wide verification remain owned by adversarial/validation.

  # Jail aider to exactly the mutation targets with a PHYSICAL deny-all
  # .aiderignore at the execution-surface root (aider's native discovery
  # location — not a CLI argument): every repository path is ignored
  # except the explicit targets, so neither git auto-discovery nor
  # LLM-induced /add requests can flood the chat context with tracked
  # files. The surface is ephemeral and the file is untracked, so it
  # never reaches the captured diff.
  # Surface liveness guard: the runtime owns the worktree and rapid
  # feedback loops can expunge/re-initialize it between input validation
  # and this invocation. Re-verify NOW — immediately before the first
  # write into the surface and the subshell cd — so a vanished surface
  # produces one deterministic fatal instead of a subshell cd crash.
  # A brief settle window absorbs an in-flight surface re-initialization.
  if [[ ! -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]]; then
    aegis_warn "execution_surface_missing_before_invocation — waiting for surface re-initialization"
    local settle
    for settle in 1 2 3; do
      sleep 1
      [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] && break
    done
    [[ -d "${AEGIS_EXECUTION_SURFACE_PATH}" ]] \
      || aegis_fatal "execution_surface_vanished: ${AEGIS_EXECUTION_SURFACE_PATH}"
  fi

  local aiderignore_file="${AEGIS_EXECUTION_SURFACE_PATH}/.aiderignore"

  # gitignore semantics: "*" excludes everything, "!*/" re-includes
  # directories so per-file negations below can take effect (a file
  # cannot be re-included while its parent directory is excluded).
  printf '*\n!*/\n' > "${aiderignore_file}"

  # Add mutation target files (guard against empty expansion)
  if [[ "${#file_args[@]}" -gt 0 ]]; then
    for f in "${file_args[@]}"; do
      [[ -z "${f}" ]] && continue
      aider_cmd+=("--file" "${f}")
      printf '!%s\n' "${f}" >> "${aiderignore_file}"
    done
  fi

  # History contamination guard: physically delete any aider chat/input
  # history residue inside the disposable surface before the invocation.
  # A leaked history file from a previous worktree (or a copied surface)
  # would be replayed into the token context of this repair loop.
  rm -f \
    "${AEGIS_EXECUTION_SURFACE_PATH}/.aider.chat.history.md" \
    "${AEGIS_EXECUTION_SURFACE_PATH}/.aider.input.history" \
    "${AEGIS_EXECUTION_SURFACE_PATH}/.aider.llm.history" \
    >/dev/null 2>&1 || true

  aegis_log "Invoking aider mutation substrate..."
  aegis_log "Model: ${AEGIS_AIDER_MODEL}"
  aegis_log "Edit format: ${resolved_edit_format}"
  aegis_log "Targets: ${file_args[*]:-<none>}"

  AEGIS_AIDER_OUTPUT_LOG="$(aider_mktemp)"

  # Portable timestamp via date subshell (macOS Bash 3.2 lacks printf %(...)T).
  local aider_start_time
  aider_start_time=$(date +%s)

  # Wall-clock watchdog: --timeout only bounds individual API requests,
  # so retry loops can still hang the pipeline. The watchdog kills the
  # whole aider process after AEGIS_AIDER_MAX_SECONDS.
  set +e
  (
    cd "${AEGIS_EXECUTION_SURFACE_PATH}" || {
      echo "[AEGIS][AIDER][FATAL] execution_surface_unreachable: ${AEGIS_EXECUTION_SURFACE_PATH}" >&2
      exit 97
    }

    # exec replaces the subshell with aider itself, so the watchdog's
    # kill reaches the real process instead of a wrapper shell.
    # GIT_EDITOR/EDITOR pinned to true: even if a git operation slips
    # through, no interactive editor can ever block the pipeline.
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    GIT_EDITOR=true \
    EDITOR=true \
      exec "${aider_cmd[@]}" >"${AEGIS_AIDER_OUTPUT_LOG}" 2>&1 </dev/null
  ) &
  local aider_pid=$!

  # stdout/stderr detached so the lingering sleep cannot hold the caller's
  # command-substitution pipe open after the watchdog is killed.
  # TERM first for a graceful stop, KILL escalation if aider ignores it.
  (
    sleep "${AEGIS_AIDER_MAX_SECONDS}"
    kill "${aider_pid}" 2>/dev/null
    sleep 5
    kill -9 "${aider_pid}" 2>/dev/null
  ) >/dev/null 2>&1 &
  local watchdog_pid=$!

  wait "${aider_pid}"
  aider_status=$?

  kill "${watchdog_pid}" 2>/dev/null
  wait "${watchdog_pid}" 2>/dev/null

  # The jail file is invocation-scoped: never leave it on the surface.
  rm -f "${aiderignore_file}" 2>/dev/null
  set -e

  local aider_end_time
  aider_end_time=$(date +%s)
  local aider_elapsed=$((aider_end_time - aider_start_time))
  echo "[AEGIS][TIMING] aider_substrate_call: ${aider_elapsed}s" >&2

  if [[ "${aider_status}" -ne 0 ]]; then
    # aider sometimes hangs after successfully applying its edits instead
    # of honoring --exit. The substrate's deliverable is the worktree diff,
    # not aider's exit code: if the watchdog killed it AFTER an applied
    # edit produced a diff, the mutation is usable — proceed.
    if [[ "${aider_elapsed}" -ge "${AEGIS_AIDER_MAX_SECONDS}" ]] \
      && grep -q "Applied edit" "${AEGIS_AIDER_OUTPUT_LOG}" \
      && [[ -n "$(capture_worktree_diff)" ]]; then
      aegis_warn "aider hung after applying edits — killed by watchdog, proceeding with captured diff"
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

  jq -n \
    --arg mode "${AEGIS_MODE}" \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
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
        attention_reason: "ATTENTION_REASON_REPAIR"
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

  local diff_content
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

  aegis_log "Emitting mutation artifact..."

  emit_mutation_artifact "${diff_content}"

  aegis_log "Aider mutation substrate completed"
}

main "$@"
