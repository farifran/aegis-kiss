#!/usr/bin/env bash
# Source-only — aider invoke, diff, emit (loaded by aider_substrate.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] aider_invoke_lib_not_invocable" >&2
  exit 1
fi

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

# Revert only paths outside the authorized jail. Keeps valid primary
# mutation work when a preflight fix leaks into sibling files (e.g. index.ts).
# Args: authorized target paths...
revert_unauthorized_surface_paths() {
  local -a authorized=("$@")
  local surface="${AEGIS_EXECUTION_SURFACE_PATH:-}"
  local git_dir="${AEGIS_MUTATION_GIT_DIR:-}"
  [[ -n "${surface}" && -d "${surface}" ]] || return 0
  [[ -n "${git_dir}" ]] || return 0

  local authorized_blob
  authorized_blob="$(printf '%s\n' "${authorized[@]}")"

  local scope_lib="${AEGIS_AIDER_SUBSTRATE_ROOT}/scripts/substrates/mutation_scope_gate.sh"
  if [[ -f "${scope_lib}" ]]; then
    # shellcheck disable=SC1090
    source "${scope_lib}"
  fi

  local path norm
  local -a offenders=()
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    path="${path#./}"
    if declare -f mutation_scope_is_authorized >/dev/null 2>&1; then
      if mutation_scope_is_authorized "${path}" "${authorized_blob}"; then
        continue
      fi
    else
      local ok=0 a
      for a in "${authorized[@]+"${authorized[@]}"}"; do
        a="${a#./}"
        [[ "${path}" == "${a}" ]] && { ok=1; break; }
      done
      [[ "${ok}" -eq 1 ]] && continue
    fi
    offenders+=("${path}")
  done < <(
    (
      cd "${surface}" || exit 0
      git --git-dir="${git_dir}" --work-tree=. status --porcelain -uall 2>/dev/null \
        | awk '{print substr($0,4)}' \
        | sed 's/^"//; s/"$//'
    )
  )

  [[ "${#offenders[@]}" -gt 0 ]] || return 0

  aegis_warn "Reverting unauthorized surface paths only: $(printf '%s ' "${offenders[@]}")"
  (
    cd "${surface}" || exit 0
    local o
    for o in "${offenders[@]}"; do
      # Tracked: restore. Untracked net-new leak: delete.
      if git --git-dir="${git_dir}" --work-tree=. ls-files --error-unmatch -- "${o}" \
        >/dev/null 2>&1; then
        git --git-dir="${git_dir}" --work-tree=. checkout -- "${o}" >/dev/null 2>&1 || true
      else
        rm -f -- "${o}" >/dev/null 2>&1 || true
        # Drop empty parent dirs created by leak (best-effort, stay under surface).
        rmdir "$(dirname -- "${o}")" >/dev/null 2>&1 || true
      fi
    done
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

  local diff_output untracked udiff
  local surface="${AEGIS_EXECUTION_SURFACE_PATH}"
  local gdir="${AEGIS_MUTATION_GIT_DIR}"

  # Tracked + intent-to-add paths (normal mutation stream).
  diff_output="$(
    git \
      --git-dir="${gdir}" \
      --work-tree="${surface}" \
      diff \
      HEAD \
      -- \
      2>/dev/null || true
  )"

  # Net-new untracked files are invisible to `git diff HEAD` when
  # --intent-to-add failed or was skipped. Aider may still "Applied edit"
  # them; without this, invoke fatals empty_diff and rolls back real work
  # (seen after summarizer crash on floor models).
  untracked="$(
    git --git-dir="${gdir}" --work-tree="${surface}" \
      ls-files --others --exclude-standard 2>/dev/null || true
  )"
  if [[ -n "${untracked}" && -d "${surface}" ]]; then
    udiff="$(
      (
        cd "${surface}" || exit 0
        while IFS= read -r rel; do
          [[ -n "${rel}" && -f "${rel}" ]] || continue
          case "${rel}" in
            node_modules|node_modules/*|.aider*|.DS_Store|*/.DS_Store) continue ;;
          esac
          # Space/colon "paths" are operational noise (see mutation_path_is_operational_noise).
          [[ "${rel}" == *" "* || "${rel}" == *":"* ]] && continue
          git diff --no-index -- /dev/null "${rel}" 2>/dev/null || true
        done <<< "${untracked}"
      )
    )"
    if [[ -n "${udiff}" ]]; then
      if [[ -n "${diff_output}" ]]; then
        diff_output+=$'\n'
      fi
      diff_output+="${udiff}"
    fi
  fi

  printf '%s' "${diff_output}"
}

# Operational residue on the disposable surface is not mutation authority.
# Preflight may symlink node_modules; aider may drop .aiderignore; NodeNext
# smoke may leave foo.js → foo.ts twins — none are model-authored paths.
mutation_path_is_operational_noise() {
  local p="${1:-}"
  p="${p#./}"
  case "${p}" in
    node_modules|node_modules/*|*/node_modules|*/node_modules/*) return 0 ;;
    .aiderignore|.aider*|.DS_Store|*/.DS_Store) return 0 ;;
  esac
  # Aider sometimes leaves untracked prose blobs as "filenames" (stress:
  # "Here is the updated file content"). Not real paths — ignore for scope.
  if [[ "${p}" == *" "* ]] || [[ "${p}" == *":"* ]]; then
    return 0
  fi
  if [[ ! "${p}" =~ ^[A-Za-z0-9_./@+-]+$ ]]; then
    return 0
  fi
  # Require source-ish extension or a directory slash (paths like src/foo.ts).
  case "${p}" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.sh|*.css|*.html) ;;
    */*) ;;
    *) return 0 ;;
  esac
  # Smoke / NodeNext twin: *.js symlink (or path) beside same-stem *.ts on surface.
  case "${p}" in
    *.js)
      local stem="${p%.js}"
      local surface="${AEGIS_EXECUTION_SURFACE_PATH:-.}"
      if [[ -L "${surface}/${p}" ]] \
        && { [[ -f "${surface}/${stem}.ts" ]] || [[ -f "${surface}/${stem}.tsx" ]]; }; then
        return 0
      fi
      # Also ignore untracked .js when authorized twin .ts exists in the same dir
      # and the .js is only a symlink residue (checked above) — if regular file,
      # keep it so real model-authored .js still trips scope when unauthorized.
      ;;
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
    # Keep authorized jail work (primary + prior good edits). Full surface
    # rollback here caused empty_diff after preflight when a tools-fix
    # leaked into index.ts and wiped the valid tokenBucket mutation.
    revert_unauthorized_surface_paths "${authorized_targets[@]}"

    # Re-evaluate after partial revert.
    diff_content="$(capture_worktree_diff 2>/dev/null || true)"
    changed_blob="$(list_mutation_changed_paths "${diff_content}")"
    if [[ -z "$(printf '%s' "${changed_blob}" | sed '/^$/d')" ]]; then
      aegis_warn "mutation_scope_violation: no authorized changes remain after strip"
      return 1
    fi
    if ! offenders="$(mutation_scope_check "${authorized_blob}" "${changed_blob}")"; then
      aegis_warn "mutation_scope_violation: residual offenders after strip — full rollback"
      rollback_execution_surface
      return 1
    fi
    aegis_warn "mutation_scope_violation: stripped offenders; kept authorized jail work"
    return 0
  fi

  aegis_log "mutation_scope_gate: ok ($(printf '%s\n' "${changed_blob}" | sed '/^$/d' | wc -l | tr -d ' ') path(s) within authorized set)"
  return 0
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

  # Soft-accepted intent misses → structured stamp for validation feedback (R3).
  # origin uses stable codes (demand_tokens|over_export|…) not umbrella labels.
  local intent_violations_json="[]"
  if [[ "${AEGIS_MUTATION_INTENT_SOFT_ACCEPTED:-0}" == "1" ]] \
    && [[ -n "${AEGIS_MUTATION_INTENT_DIAGNOSTICS:-}" ]]; then
    intent_violations_json="$(
      printf '%s\n' "${AEGIS_MUTATION_INTENT_DIAGNOSTICS}" \
        | awk 'NF' \
        | jq -R -s -c --argjson files "${files_changed}" '
            split("\n")
            | map(select(length > 0))
            | map(
                . as $line
                | (
                    if ($line | test("^over_export")) then "over_export"
                    elif ($line | test("^demand_tokens")) then "demand_tokens"
                    elif ($line | test("^path_scope")) then "path_scope"
                    elif ($line | test("^done_when")) then "done_when"
                    else "demand_tokens" end
                  ) as $code
                | {
                    origin: $code,
                    severity: "high",
                    target_files: $files,
                    structural_reason: $line,
                    evidence_refs: ["mutation.intent"]
                  }
              )
          ' 2>/dev/null || printf '[]'
    )"
  fi
  if ! printf '%s' "${intent_violations_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    intent_violations_json="[]"
  fi

  jq -n \
    --arg mode "${AEGIS_MODE}" \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
    --arg attention_reason "${attention_reason}" \
    --rawfile diff "${diff_tmp}" \
    --argjson files_changed "${files_changed}" \
    --argjson intent_violations "${intent_violations_json}" \
    '{
      mode: $mode,
      execution_id: $execution_id,
      diff: $diff,
      files_changed: $files_changed,
      intent_violations: $intent_violations,
      handover_attention: {
        next_attention_targets: $files_changed,
        attention_scope: "mutation_applied",
        attention_reason: $attention_reason
      }
    }' > "${artifact_tmp}"

  # Stamp post-preflight tools for adversarial reuse when candidate hash matches.
  # Skip when re-emitting a previous candidate after failed refine materialize
  # (no preflight ran; wiping the stamp would force a false tools re-run gap).
  if [[ "${AEGIS_SKIP_CANDIDATE_TOOLS_STAMP:-0}" != "1" ]] \
    && declare -f aegis_stamp_candidate_tools >/dev/null 2>&1; then
    aegis_stamp_candidate_tools \
      "$(cat "${diff_tmp}")" \
      "${AEGIS_MODE}" \
      "${AIDER_CAPABILITY_PAYLOAD_DIR:-}" \
      "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
      || true
  fi

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

