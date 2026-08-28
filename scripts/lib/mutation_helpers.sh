#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — MUTATION & AIDER PROMPT HELPERS
# =========================================================
#
# Helper library for Step 3 (Mutation / Aider):
#   - Prompt formatting & brief extraction
#   - Barrel reexport and export slicing
#   - TypeScript AST snippet assembly & alignment gates
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] mutation_helpers_lib_not_invocable" >&2
  exit 1
fi

aegis_format_demand_anchors_section() {
  local anchors_json="${1-}"
  if [[ -z "${anchors_json}" ]]; then
    anchors_json="$(aegis_materialize_demand_anchors_json)"
  fi
  if ! printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    anchors_json='{"operator_named_paths":[],"dense_tokens":[],"search_query":"AEGIS","seed_targets":[],"seed_source":"none","content_resonance":[],"goal":"","targets_header":[],"done_when":[]}'
  fi

  local seed_line tokens_line search_line ops_line goal_line targets_line done_line
  seed_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.seed_targets // []) | join(", ")) as $t
      | (.seed_source // "none") as $src
      | if ($t | length) == 0 then "(none)"
        elif $src == "none" then $t
        else $t + " (" + $src + ")"
        end
    ' 2>/dev/null || echo "(none)"
  )"
  tokens_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.dense_tokens // []) | join(", ")) as $t
      | if ($t | length) > 0 then $t else "(none)" end
    ' 2>/dev/null || echo "(none)"
  )"
  search_line="$(
    printf '%s' "${anchors_json}" | jq -r '.search_query // "AEGIS"' 2>/dev/null || echo "AEGIS"
  )"
  ops_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.operator_named_paths // []) | join(", ")) as $t
      | if ($t | length) > 0 then $t else "(none)" end
    ' 2>/dev/null || echo "(none)"
  )"
  goal_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      (.goal // "") as $g
      | if ($g | length) > 0 then $g else empty end
    ' 2>/dev/null || true
  )"
  targets_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.targets_header // []) | join(", ")) as $t
      | if ($t | length) > 0 then $t else empty end
    ' 2>/dev/null || true
  )"
  done_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.done_when // []) | join(" | ")) as $t
      | if ($t | length) > 0 then $t else empty end
    ' 2>/dev/null || true
  )"

  {
    echo "=== DEMAND ANCHORS (runtime-owned, mechanical) ==="
    echo
    echo "Authoritative. Prefer SEED/TOKENS over free-text. Do not invent paths."
    echo
    echo "SEED: ${seed_line}"
    echo "TOKENS: ${tokens_line}"
    echo "SEARCH: ${search_line}"
    echo "OPERATOR PATHS: ${ops_line}"
    if [[ -n "${goal_line}" ]]; then
      echo "GOAL: ${goal_line}"
    fi
    if [[ -n "${targets_line}" ]]; then
      echo "TARGETS (header): ${targets_line}"
    fi
    if [[ -n "${done_line}" ]]; then
      echo "DONE WHEN: ${done_line}"
    fi
    echo
  }
}

# Compact forensics→build handoff lines (alvo + reason + done_when).

aegis_format_forensics_handoff_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local lines
  lines="$(
    jq -r '
      .artifact_snapshot as $snap
      | ($snap.operational_context // {}) as $oc
      | ((($oc.mutation_candidates // $oc.build_candidates)) // []) as $cands
      | ($oc.demand_anchors // {}) as $da
      # TOKENS live in DEMAND ANCHORS above — handoff is alvo/reason only.
      | if ($cands | length) == 0 and (($da.seed_targets // []) | length) == 0
        then empty
        else
          "=== FORENSICS HANDOFF (runtime) ===",
          "",
          (
            if ($cands | length) > 0 then
              ($cands[] | "ALVO: \(.id) — \(.reason // "unspecified")")
            else
              "ALVO: \($da.seed_targets[0]) — Demand: \((($da.dense_tokens // [])[0:3] | join(" ")))"
            end
          ),
          (
            if (($da.done_when // []) | length) > 0 then
              "DONE WHEN: \($da.done_when | join(" | "))"
            else empty end
          ),
          ""
        end
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${lines}" ]] || return 0
  printf '%s\n' "${lines}"
}

# Exported identifiers in a source file (function/const), one per line, cap 12.

aegis_list_file_exports() {
  local file="${1-}"
  [[ -n "${file}" && -f "${file}" ]] || return 0
  grep -Eio \
    "export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[A-Za-z0-9_]+|export[[:space:]]+const[[:space:]]+[A-Za-z0-9_]+" \
    "${file}" 2>/dev/null \
    | sed -E 's/.*[[:space:]]([A-Za-z0-9_]+)$/\1/' \
    | awk 'NF && !seen[$0]++' \
    | head -n 12 \
    || true
}

# Build mutation brief: mechanical context for Aider (alvo body state).
# Complements FORENSICS HANDOFF — does not restate demand free-text.
# Args: [handover_path] [repo_root]

aegis_format_mutation_brief_section() {
  local handover="${1-}"
  local root="${2:-.}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local alvos_json tokens_nl done_line
  alvos_json="$(
    jq -c '
      ((.artifact_snapshot.operational_context.mutation_candidates // .artifact_snapshot.operational_context.build_candidates) // []) as $c
      | if ($c | length) > 0 then [$c[].id | select(type == "string" and length > 0)]
        else
          [.artifact_snapshot.operational_context.demand_anchors.seed_targets[]?
            | select(type == "string" and length > 0)][0:1]
        end
      | unique
    ' "${handover}" 2>/dev/null || printf '[]'
  )"
  if ! printf '%s' "${alvos_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    return 0
  fi

  tokens_nl="$(
    jq -r '
      (.artifact_snapshot.operational_context.demand_anchors.dense_tokens // [])[]?
    ' "${handover}" 2>/dev/null || true
  )"
  if [[ -z "${tokens_nl}" ]] && declare -f aegis_demand_dense_tokens >/dev/null 2>&1; then
    tokens_nl="$(aegis_demand_dense_tokens "${AEGIS_INVESTIGATION_INPUT:-}")"
  fi

  done_line="$(
    jq -r '
      (.artifact_snapshot.operational_context.demand_anchors.done_when // [])
      | map(select(type == "string" and length > 0))
      | if length > 0 then join(" | ") else empty end
    ' "${handover}" 2>/dev/null || true
  )"

  # Data only — edit policy lives in .skills/build.md (avoid prompt echo).
  local path probe state exports_line full
  {
    echo "=== MUTATION BRIEF (runtime) ==="
    echo
    while IFS= read -r path; do
      [[ -n "${path}" ]] || continue
      full="${root%/}/${path}"
      full="${full#./}"
      if declare -f aegis_discovery_probe_path >/dev/null 2>&1; then
        probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" "${root}")"
      else
        probe="unknown"
      fi
      case "${probe}" in
        missing)
          state="missing on disk — create only if operator-named"
          ;;
        present_no_hits)
          state="exists; demand tokens not in content yet (add the demand export)"
          ;;
        present_hits:*)
          state="exists; related symbols: ${probe#present_hits:} — confirm edit vs already-satisfied"
          ;;
        *)
          state="probe inconclusive — read file before editing"
          ;;
      esac
      exports_line="$(
        aegis_list_file_exports "${full}" \
          | paste -sd ', ' - 2>/dev/null || true
      )"
      [[ -n "${exports_line}" ]] || exports_line="(none)"
      echo "FILE: ${path}"
      echo "STATE: ${state}"
      echo "EXPORTS NOW: ${exports_line}"
      echo
    done < <(printf '%s' "${alvos_json}" | jq -r '.[]?' | head -n 3)

    if [[ -n "${done_line}" ]]; then
      echo "DONE WHEN: ${done_line}"
      echo
    fi
  }
}

# True if handover carries at least one forensics mutation_candidate id.

aegis_handover_has_mutation_alvo() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 1
  jq -e '
    [((.artifact_snapshot.operational_context.mutation_candidates // .artifact_snapshot.operational_context.build_candidates) // [])[]?.id
      | select(type == "string" and length > 0)]
    | length > 0
  ' "${handover}" >/dev/null 2>&1
}

aegis_handover_has_build_alvo() { aegis_handover_has_mutation_alvo "$@"; }

# Optimize: show the Mutation candidate delta as instance data (not policy).
# Handover must be post-mutation (mode=mutation or build, diff + files_changed).
# Args: [handover_path]  Env: AEGIS_OPTIMIZE_MUTATION_DIFF_MAX_BYTES (default 12000)

aegis_format_mutation_result_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local files_line diff_body max_bytes trunc_note=""
  : "${AEGIS_OPTIMIZE_MUTATION_DIFF_MAX_BYTES:=${AEGIS_OPTIMIZE_BUILD_DIFF_MAX_BYTES:-12000}}"
  max_bytes="${AEGIS_OPTIMIZE_MUTATION_DIFF_MAX_BYTES}"

  files_line="$(
    jq -r '
      .artifact_snapshot as $snap
      | select($snap.mode == "mutation" or $snap.mode == "build")
      | ($snap.operational_context.files_changed // [])
      | map(select(type == "string" and length > 0))
      | if length == 0 then empty else join(", ") end
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${files_line}" ]] || return 0

  diff_body="$(
    jq -r '
      .artifact_snapshot as $snap
      | select($snap.mode == "mutation" or $snap.mode == "build")
      | ($snap.operational_context.diff // empty)
      | select(type == "string" and length > 0 and . != "(no changes)")
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${diff_body}" ]] || return 0

  if [[ "${#diff_body}" -gt "${max_bytes}" ]]; then
    trunc_note="[AEGIS][MUTATION_DIFF_TRUNCATED:${#diff_body}->${max_bytes} bytes]"
    diff_body="${diff_body:0:${max_bytes}}"
  fi

  {
    echo "=== MUTATION RESULT (runtime) ==="
    echo "FILES CHANGED: ${files_line}"
    echo "CANDIDATE DIFF:"
    printf '%s\n' "${diff_body}"
    [[ -n "${trunc_note}" ]] && echo "${trunc_note}"
    echo
  }
}

aegis_format_build_result_section() { aegis_format_mutation_result_section "$@"; }

# Optimize after a refine pass: no second LLM — forward Build as no_improvement.

aegis_format_candidate_result_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  : "${AEGIS_ADVERSARIAL_CANDIDATE_DIFF_MAX_BYTES:=12000}"
  local max_bytes="${AEGIS_ADVERSARIAL_CANDIDATE_DIFF_MAX_BYTES}"
  local files_line diff_body trunc_note=""

  files_line="$(
    jq -r '
      .artifact_snapshot as $s
      | (
          if $s.mode == "optimize" then $s.operational_context.candidate_result.files_changed
          elif $s.mode == "build" then $s.operational_context.files_changed
          else $s.operational_context.candidate_result.files_changed
                // $s.operational_context.files_changed
          end
        ) // []
      | map(select(type == "string" and length > 0))
      | if length == 0 then empty else join(", ") end
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${files_line}" ]] || return 0

  diff_body="$(
    jq -r '
      .artifact_snapshot as $s
      | (
          if $s.mode == "optimize" then $s.operational_context.candidate_result.diff
          elif $s.mode == "build" then $s.operational_context.diff
          else $s.operational_context.candidate_result.diff // $s.operational_context.diff
          end
        ) // empty
      | select(type == "string" and length > 0 and . != "(no changes)")
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${diff_body}" ]] || return 0

  if [[ "${#diff_body}" -gt "${max_bytes}" ]]; then
    trunc_note="[AEGIS][CANDIDATE_DIFF_TRUNCATED:${#diff_body}->${max_bytes} bytes]"
    diff_body="${diff_body:0:${max_bytes}}"
  fi

  {
    echo "=== CANDIDATE RESULT (runtime) ==="
    echo
    echo "Falsify this candidate only. Quote exact full +lines for logic bugs. Tools may be reused from build when the candidate hash matches."
    echo
    echo "files_changed: ${files_line}"
    echo
    echo "diff:"
    printf '%s\n' "${diff_body}"
    if [[ -n "${trunc_note}" ]]; then
      echo
      echo "${trunc_note}"
    fi
    echo
  }
}

# files_changed for the mutation candidate on a handover (optimize/build shapes).
# Prints JSON array. Empty array when handover missing or unreadable.

aegis_handover_candidate_files_changed_json() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  if [[ -z "${handover}" || ! -f "${handover}" ]]; then
    printf '[]'
    return 0
  fi
  jq -c '
    .artifact_snapshot as $s
    | (
        if $s.mode == "optimize" then $s.operational_context.candidate_result.files_changed
        else $s.operational_context.files_changed
              // $s.operational_context.candidate_result.files_changed
        end
      ) // []
  ' "${handover}" 2>/dev/null || printf '[]'
}

# Mutation-scoped tools summary for adversarial (from current payload dir).

aegis_diff_added_export_names() {
  local diff_content="${1-}"
  local added
  added="$(
    printf '%s\n' "${diff_content}" \
      | grep -E '^\+' \
      | grep -vE '^\+\+\+' \
      || true
  )"
  [[ -n "${added}" ]] || return 0
  printf '%s\n' "${added}" \
    | grep -Ei \
      'export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[A-Za-z_]|export[[:space:]]+const[[:space:]]+[A-Za-z_]|export[[:space:]]+class[[:space:]]+[A-Za-z_]' \
    | sed -E \
      -e 's/^.*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\2/' \
      -e 's/^.*export[[:space:]]+const[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\1/' \
      -e 's/^.*export[[:space:]]+class[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\1/' \
    | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' \
    | awk '!seen[$0]++' \
    || true
}

# Export names removed in a unified diff (-export lines + removed export { X }).

aegis_diff_removed_export_names() {
  local diff_content="${1-}"
  local removed
  removed="$(
    printf '%s\n' "${diff_content}" \
      | grep -E '^-' \
      | grep -vE '^--- ' \
      || true
  )"
  [[ -n "${removed}" ]] || return 0
  {
    printf '%s\n' "${removed}" \
      | grep -Ei \
        'export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[A-Za-z_]|export[[:space:]]+const[[:space:]]+[A-Za-z_]|export[[:space:]]+class[[:space:]]+[A-Za-z_]' \
      | sed -E \
        -e 's/^.*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\2/' \
        -e 's/^.*export[[:space:]]+const[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\1/' \
        -e 's/^.*export[[:space:]]+class[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\1/' \
      || true
    # export { Foo, Bar } removals
    printf '%s\n' "${removed}" \
      | grep -E 'export[[:space:]]*\{' \
      | sed -E 's/.*\{([^}]*)\}.*/\1/' \
      | tr ',' '\n' \
      | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^type[[:space:]]+//; s/[[:space:]]+as[[:space:]].*$//' \
      || true
  } | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' | awk 'NF && !seen[$0]++' || true
}

# True when the unit/demand is a barrel reexport that must keep pre-existing API.
# Must NOT match create/export_slice units that only say "do not delete
# pre-existing barrel exports" in Constraints (every micro has that line).

aegis_demand_is_reexport_preserve() {
  local text="${1-}"
  [[ -n "${text}" ]] || return 1
  # Positive reexport intent (title/goal/change/briefing barrel block).
  if ! printf '%s' "${text}" | grep -Eiq \
    'reexport only|re-export only|barrel reexport|Import and re-export|import and re-export|Do not re-implement the algorithm|do not re-implement the algorithm|Em src/index\.ts|from ['\''"]\./[^'\''"]+\.js['\''"]'; then
    return 1
  fi
  # Explicit create/export_slice micros on a non-index module are never barrel-only.
  if printf '%s' "${text}" | grep -Eiq \
    'export_slice:|export class |export function '; then
    # Pure reexport units may still show Briefing Em index block only.
    printf '%s' "${text}" | grep -Eiq \
      'reexport only|re-export only|Do not re-implement the algorithm|do not re-implement the algorithm|Em src/index\.ts' \
      || return 1
  fi
  # Create-module wording without reexport title → not barrel.
  if printf '%s' "${text}" | grep -Eiq 'Create or update ONLY|omit reexport|Do not re-export from index' \
    && ! printf '%s' "${text}" | grep -Eiq 'reexport only|re-export only|Em src/index\.ts|Import and re-export'; then
    return 1
  fi
  return 0
}

# Top-level export names present in a TS file body (one per line).

aegis_mechanical_barrel_reexport_apply() {
  local rel="${1-}"
  local demand="${2-}"
  local root="${3:-${AEGIS_EXECUTION_SURFACE_PATH:-.}}"
  local force="${4:-0}"
  local surface head_body cur_body acc_names missing head_names cur_names
  local import_from import_line export_line name list

  [[ -n "${rel}" ]] || return 1
  aegis_demand_is_reexport_preserve "${demand}" || return 1

  surface="${root%/}/${rel}"
  local git_root
  git_root="${AEGIS_REPO_ROOT:-${AEGIS_PROJECT_ROOT:-${ROOT:-.}}}"
  # Prefer the worktree that owns the surface path when running in a jail.
  if [[ -d "${root}/.git" ]] || git -C "${root}" rev-parse --git-dir >/dev/null 2>&1; then
    git_root="${root}"
  fi
  head_body="$(git -C "${git_root}" show "HEAD:${rel}" 2>/dev/null || true)"
  local head_empty=0
  if [[ -z "$(printf '%s' "${head_body}" | tr -d '[:space:]')" ]]; then
    head_empty=1
    [[ "${force}" == "1" ]] || return 1
    head_body="// ${rel}"
  fi

  cur_body=""
  [[ -f "${surface}" ]] && cur_body="$(cat "${surface}" 2>/dev/null || true)"

  head_names="$(aegis_file_top_level_export_names "${head_body}")"
  cur_names="$(aegis_file_top_level_export_names "${cur_body}")"
  missing=""
  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    if ! printf '%s\n' "${cur_names}" | grep -Fxq -- "${name}"; then
      missing="${missing}${name}"$'\n'
    fi
  done <<< "${head_names}"

  # Also force reexport if HEAD exports survived but Acceptance names missing.
  acc_names="$(aegis_demand_acceptance_names "${demand}")"
  local need_reexport=0
  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    if ! printf '%s\n' "${cur_names}" | grep -Fxq -- "${name}"; then
      need_reexport=1
      break
    fi
  done <<< "${acc_names}"

  if [[ "${force}" != "1" ]] \
    && [[ -z "$(printf '%s' "${missing}" | tr -d '[:space:]')" && "${need_reexport}" -eq 0 ]]; then
    return 1
  fi
  # force=1 still skips if surface already matches desired HEAD+reexport shape
  # and acceptance names are present (no work).
  if [[ "${force}" == "1" && "${head_empty}" -eq 0 && "${need_reexport}" -eq 0 ]] \
    && [[ -z "$(printf '%s' "${missing}" | tr -d '[:space:]')" ]]; then
    return 1
  fi

  # Infer import path from Briefing (./foo.js) or sibling of index.
  import_from="$(
    printf '%s\n' "${demand}" \
      | grep -oE "from ['\"]\\./[^'\"]+['\"]" \
      | head -1 \
      | sed -E "s/from ['\"]([^'\"]+)['\"]/\\1/" \
      || true
  )"
  if [[ -z "${import_from}" ]]; then
    # Sibling module from Acceptance / Targets (tokenBucket → ./tokenBucket.js).
    local sib
    sib="$(
      printf '%s\n' "${demand}" \
        | grep -oE 'src/[A-Za-z0-9_./-]+\.ts' \
        | grep -v 'index\.ts' \
        | head -1 \
        | sed -E 's|^src/|./|; s|\.ts$|.js|' \
        || true
    )"
    import_from="${sib}"
  fi
  [[ -n "${import_from}" ]] || return 1
  if [[ "${import_from}" == "./index.js" || "${import_from}" == "index.js" || "${import_from}" == "./index" ]]; then
    return 1
  fi

  list="$(
    printf '%s\n' "${acc_names}" | awk 'NF && !seen[$0]++' | paste -sd',' - | sed 's/,/, /g'
  )"
  [[ -n "${list}" ]] || return 1

  import_line="import { ${list} } from '${import_from}';"
  export_line="export { ${list} };"

  # Rebuild from HEAD: drop prior import from the same module path and dangling imports,
  # then append import+export. Keeps valid pre-existing converter exports intact.
  local re_from="from[[:space:]]+['\"]\\./([^'\"]+)\\.js['\"]"
  local re_sym="\\{[[:space:]]*([^}]+)[[:space:]]*\\}"
  local re_exp="export[[:space:]]+\\{[[:space:]]*([^}]+)[[:space:]]*\\}"
  local filtered_head="" l imp_file imp_symbols
  local -a dropped_symbols=()

  while IFS= read -r l; do
    if [[ "${l}" =~ ${re_from} ]]; then
      imp_file="${BASH_REMATCH[1]}"
      if [[ ! -f "$(dirname "${surface}")/${imp_file}.ts" && ! -f "$(dirname "${surface}")/${imp_file}.js" ]]; then
        if [[ "${l}" =~ ${re_sym} ]]; then
          imp_symbols="${BASH_REMATCH[1]}"
          while IFS= read -r sym; do
            [[ -n "${sym}" ]] && dropped_symbols+=("${sym}")
          done < <(printf '%s\n' "${imp_symbols}" | tr ',' '\n' | sed -E 's/^[[:space:]]*|[[:space:]]*$//g')
        fi
        continue
      fi
    fi
    filtered_head="${filtered_head}${l}"$'\n'
  done <<< "${head_body}"

  if [[ "${#dropped_symbols[@]}" -gt 0 ]]; then
    local final_filtered=""
    while IFS= read -r l; do
      if [[ "${l}" != *"from"* ]] && [[ "${l}" =~ ${re_exp} ]]; then
        local exp_syms="${BASH_REMATCH[1]}"
        local -a kept_syms=()
        while IFS= read -r sym; do
          [[ -n "${sym}" ]] || continue
          if ! printf '%s\n' "${dropped_symbols[@]}" | grep -Fxq -- "${sym}"; then
            kept_syms+=("${sym}")
          fi
        done < <(printf '%s\n' "${exp_syms}" | tr ',' '\n' | sed -E 's/^[[:space:]]*|[[:space:]]*$//g')
        if [[ "${#kept_syms[@]}" -gt 0 ]]; then
          local kept_list
          kept_list="$(printf '%s, ' "${kept_syms[@]}" | sed 's/, $//')"
          final_filtered="${final_filtered}export { ${kept_list} };"$'\n'
        fi
        continue
      fi
      final_filtered="${final_filtered}${l}"$'\n'
    done <<< "${filtered_head}"
    filtered_head="${final_filtered}"
  fi

  if ! printf '%s' "${filtered_head}" | grep -qE 'export |import '; then
    head_empty=1
  fi

  local rebuilt
  rebuilt="$(
    printf '%s\n' "${filtered_head}" | awk -v from="${import_from}" '
      index($0, from) && $0 ~ /from/ && $0 ~ /import/ { next }
      { print }
    '
  )"
  # Strip aider whole-file junk and trailing blank lines.
  rebuilt="$(aegis_strip_aider_whole_file_junk "${rebuilt}")"
  while [[ "${rebuilt}" == *$'\n\n' ]]; do
    rebuilt="${rebuilt%$'\n'}"
  done
  # Empty-HEAD seed is just a comment — replace with clean barrel.
  if [[ "${head_empty}" -eq 1 ]]; then
    printf '%s\n%s\n%s\n' "// ${rel}" "${import_line}" "${export_line}" > "${surface}"
  else
    printf '%s\n\n%s\n%s\n' "${rebuilt}" "${import_line}" "${export_line}" > "${surface}"
  fi

  return 0
}

# Strip aider "whole" format noise and self-referential index imports that cause TS2303.

aegis_strip_aider_whole_file_junk() {
  local body="${1-}"
  printf '%s\n' "${body}" | awk '
    /^[[:space:]]*\/\/[[:space:]]*entire file content/ { next }
    /^[[:space:]]*\/\/[[:space:]]*\.\.\.[[:space:]]*goes in between/ { next }
    /^[[:space:]]*\/\/[[:space:]]*\.\.\.[[:space:]]*$/ { next }
    /^[[:space:]]*export[[:space:]]+\{[^}]+\}[[:space:]]+from[[:space:]]+[\x27"]\.\/index(\.js)?[\x27"];?/ { next }
    /^[[:space:]]*import[[:space:]]+\{[^}]+\}[[:space:]]+from[[:space:]]+[\x27"]\.\/index(\.js)?[\x27"];?/ { next }
    { print }
  '
}

# Apply junk strip to a surface file in place. Exit 0 if file changed.

aegis_strip_aider_whole_file_junk_path() {
  local path="${1-}"
  [[ -n "${path}" && -f "${path}" ]] || return 1
  local before after
  before="$(cat "${path}")"
  after="$(aegis_strip_aider_whole_file_junk "${before}")"
  [[ "${before}" != "${after}" ]] || return 1
  printf '%s\n' "${after}" > "${path}"
  return 0
}

# export_slice name from demand (Scope note / Change), if any.

aegis_demand_export_slice_name() {
  local text="${1-}"
  printf '%s\n' "${text}" \
    | grep -oE 'export_slice:[A-Za-z_][A-Za-z0-9_]*' \
    | head -1 \
    | sed -E 's/^export_slice://' \
    || true
}

# True when this micro is "add one top-level export function" (not class create).

aegis_demand_is_export_function_slice() {
  local text="${1-}"
  local name
  name="$(aegis_demand_export_slice_name "${text}")"
  [[ -n "${name}" ]] || {
    # Fallback: single Acceptance + briefing export function
    local n_acc
    n_acc="$(aegis_demand_acceptance_names "${text}" | grep -c . || true)"
    n_acc="${n_acc//[^0-9]/}"
    [[ "${n_acc:-0}" -eq 1 ]] || return 1
    name="$(aegis_demand_acceptance_names "${text}" | head -1)"
  }
  [[ -n "${name}" ]] || return 1
  # Briefing must declare export function Name (not only class).
  printf '%s\n' "${text}" \
    | awk '/^## Briefing[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
    | grep -qE "export[[:space:]]+function[[:space:]]+${name}([^A-Za-z0-9_]|$)" \
    || return 1
  # Prefer not to treat pure class slices as function append.
  if printf '%s\n' "${text}" \
    | awk '/^## Briefing[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
    | grep -qE "export[[:space:]]+class[[:space:]]+${name}([^A-Za-z0-9_]|$)"; then
    return 1
  fi
  return 0
}

# Convert a single ## Briefing export-function block into TS source.
# Args: demand_text, function_name

aegis_briefing_function_to_ts() {
  local text="${1-}"
  local name="${2-}"
  [[ -n "${name}" ]] || return 1
  local briefing
  briefing="$(
    printf '%s\n' "${text}" \
      | awk '/^## Briefing[[:space:]]*$/ {p=1;next} /^## / {p=0} p'
  )"
  # Prefer numbered item that declares export function Name.
  local block
  block="$(
    printf '%s\n' "${briefing}" | awk -v name="${name}" '
      BEGIN { keep=0 }
      /^[0-9]+\)/ {
        if ($0 ~ ("export[[:space:]]+function[[:space:]]+" name "([^A-Za-z0-9_]|$)")) {
          keep=1
        } else { keep=0 }
        if (keep) print
        next
      }
      /^Em[[:space:]]+/ { keep=0; next }
      keep { print }
    '
  )"
  [[ -n "$(printf '%s' "${block}" | tr -d '[:space:]')" ]] || return 1

  printf '%s\n' "${block}" | awk -v name="${name}" '
    BEGIN { in_body=0; opened=0 }
    /^[0-9]+\)/ {
      # 2) export function foo(a: T): number:
      line=$0
      sub(/^[0-9]+\)[[:space:]]*/, "", line)
      sub(/:[[:space:]]*$/, "", line)
      if (line ~ /^export[[:space:]]+function/) {
        print line " {"
        opened=1
        in_body=1
      }
      next
    }
    in_body {
      # Briefing body is indented with spaces; keep as method body.
      sub(/^[[:space:]]+/, "  ")
      if (NF) print
    }
    END {
      if (opened) print "}"
    }
  '
}

# Append a top-level export function from Briefing when the module already exists.
# Args: rel_path, demand_text [, surface_root]
# Exit 0 if appended; 1 if skip (need LLM / already present / not a function slice).

aegis_mechanical_export_function_append() {
  local rel="${1-}"
  local demand="${2-}"
  local root="${3:-${AEGIS_EXECUTION_SURFACE_PATH:-.}}"
  local surface name body ts names

  [[ -n "${rel}" ]] || return 1
  aegis_demand_is_export_function_slice "${demand}" || return 1

  name="$(aegis_demand_export_slice_name "${demand}")"
  [[ -n "${name}" ]] || name="$(aegis_demand_acceptance_names "${demand}" | head -1)"
  [[ -n "${name}" ]] || return 1

  surface="${root%/}/${rel}"
  mkdir -p "$(dirname "${surface}")" 2>/dev/null || true
  body=""
  [[ -f "${surface}" ]] && body="$(cat "${surface}" 2>/dev/null || true)"

  if [[ -n "${body}" ]]; then
    names="$(aegis_file_top_level_export_names "${body}")"
    if printf '%s\n' "${names}" | grep -Fxq -- "${name}"; then
      return 1
    fi
  fi

  ts="$(aegis_briefing_function_to_ts "${demand}" "${name}")" || return 1
  ts="$(aegis_mechanical_ts_fix_bigint_arith "${ts}")"
  [[ -n "$(printf '%s' "${ts}" | tr -d '[:space:]')" ]] || return 1

  body="$(aegis_strip_aider_whole_file_junk "${body}")"
  # Drop trailing blank lines for a clean join.
  while [[ "${body}" == *$'\n' ]]; do
    local _tail="${body##*$'\n'}"
    [[ -z "$(printf '%s' "${_tail}" | tr -d '[:space:]')" ]] || break
    body="${body%$'\n'}"
  done

  printf '%s\n\n%s\n' "${body}" "${ts}" > "${surface}"
  return 0
}

# True when this micro is create/export one class from Briefing (not function slice).

aegis_demand_is_export_class_slice() {
  local text="${1-}"
  local name
  name="$(aegis_demand_export_slice_name "${text}")"
  [[ -n "${name}" ]] || {
    local n_acc
    n_acc="$(aegis_demand_acceptance_names "${text}" | grep -c . || true)"
    n_acc="${n_acc//[^0-9]/}"
    [[ "${n_acc:-0}" -eq 1 ]] || return 1
    name="$(aegis_demand_acceptance_names "${text}" | head -1)"
  }
  [[ -n "${name}" ]] || return 1
  printf '%s\n' "${text}" \
    | awk '/^## Briefing[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
    | grep -qE "export[[:space:]]+class[[:space:]]+${name}([^A-Za-z0-9_]|$)" \
    || return 1
  # Function-only slices are handled elsewhere.
  if printf '%s\n' "${text}" \
    | awk '/^## Briefing[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
    | grep -qE "export[[:space:]]+function[[:space:]]+${name}([^A-Za-z0-9_]|$)"; then
    return 1
  fi
  return 0
}

# Convert ## Briefing export-class block into TypeScript source.
# Args: demand_text, class_name

aegis_briefing_class_to_ts() {
  local text="${1-}"
  local name="${2-}"
  [[ -n "${name}" ]] || return 1
  local briefing block
  briefing="$(
    printf '%s\n' "${text}" \
      | awk '/^## Briefing[[:space:]]*$/ {p=1;next} /^## / {p=0} p'
  )"
  block="$(
    printf '%s\n' "${briefing}" | awk -v name="${name}" '
      BEGIN { keep=0 }
      /^[0-9]+\)/ {
        if ($0 ~ ("export[[:space:]]+class[[:space:]]+" name "([^A-Za-z0-9_]|$)")) {
          keep=1
        } else { keep=0 }
        if (keep) print
        next
      }
      /^Em[[:space:]]+/ { keep=0; next }
      keep { print }
    '
  )"
  [[ -n "$(printf '%s' "${block}" | tr -d '[:space:]')" ]] || return 1

  local types
  types="$(
    printf '%s\n' "${briefing}" | awk '/^(type|interface)[[:space:]]+/ { if ($0 !~ /;[[:space:]]*$/) $0 = $0 ";"; print }'
  )"
  [[ -z "${types}" ]] || printf '%s\n\n' "${types}"

  # Deterministic pseudo-Briefing → TS class. Handles:
  #   Campos privados: _a: bigint, _b: number
  #   constructor(...): body lines
  #   method(...): ret: body lines
  #   get x(): T { return ... }  (already braced)
  printf '%s\n' "${block}" | awk -v name="${name}" '
    function trim(s) {
      sub(/^[[:space:]]+/, "", s)
      sub(/[[:space:]]+$/, "", s)
      return s
    }
    BEGIN {
      num_lines = 0
      num_fields = 0
    }
    {
      raw_line = $0
      sub(/^[[:space:]]+/, "", raw_line)
      sub(/[[:space:]]+$/, "", raw_line)
      lines[num_lines++] = raw_line
    }
    END {
      # Pass 1: Extract private fields and check which fields are mutated in methods
      for (l = 0; l < num_lines; l++) {
        ln = lines[l]
        if (ln ~ /^Campos privados:/) {
          sub(/^Campos privados:[[:space:]]*/, "", ln)
          n = 0
          cur_part = ""
          b_depth = 0
          len_ln = length(ln)
          for (c = 1; c <= len_ln; c++) {
            ch = substr(ln, c, 1)
            if (ch == "<" || ch == "(" || ch == "{") b_depth++
            else if (ch == ">" || ch == ")" || ch == "}") b_depth--
            if (ch == "," && b_depth == 0) {
              parts[++n] = cur_part
              cur_part = ""
            } else {
              cur_part = cur_part ch
            }
          }
          if (cur_part != "") parts[++n] = cur_part

          for (i = 1; i <= n; i++) {
            p = trim(parts[i])
            if (p == "") continue
            is_rd = 0
            if (p ~ /^readonly[[:space:]]+/) {
              is_rd = 1
              sub(/^readonly[[:space:]]+/, "", p)
            }
            colon_pos = index(p, ":")
            if (colon_pos > 0) {
              fn = trim(substr(p, 1, colon_pos - 1))
              ft = trim(substr(p, colon_pos + 1))
            } else {
              fn = p
              ft = "unknown"
            }
            fnames[num_fields] = fn
            ftypes[num_fields] = ft
            if (is_rd) is_mutated[fn] = 0; else is_mutated[fn] = -1
            num_fields++
          }
        }
      }

      # Scan method bodies for mutations: this.<fn> = / += / -= / *= / /= / %= / |= / &= / ^= / ++ / --
      in_m = 0
      for (l = 0; l < num_lines; l++) {
        ln = lines[l]
        if (ln ~ /^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(.*:[[:space:]]*$/ && ln !~ /^constructor[[:space:]]*\(/) {
          in_m = 1
          continue
        }
        if (ln ~ /^get[[:space:]]+[A-Za-z_]/ || ln ~ /^constructor[[:space:]]*\(/) {
          in_m = 0
          continue
        }
        if (in_m) {
          for (i = 0; i < num_fields; i++) {
            fn = fnames[i]
            if (ln ~ ("this\\." fn "[[:space:]]*[+\\-*/%|&^]?=") ||
                ln ~ ("this\\." fn "[[:space:]]*(\\+\\+|--)") ||
                ln ~ ("(\\+\\+|--)[[:space:]]*this\\." fn)) {
              is_mutated[fn] = 1
            }
          }
        }
      }

      # Pass 2: Emit the TypeScript class
      print "export class " name " {"
      need_blank = 0
      in_ctor = 0
      in_method = 0
      
      for (l = 0; l < num_lines; l++) {
        ln = lines[l]
        if (ln ~ /^[0-9]+\)/) continue
        
        # Emit Campos privados with inferred readonly
        if (ln ~ /^Campos privados:/) {
          for (i = 0; i < num_fields; i++) {
            fn = fnames[i]
            ft = ftypes[i]
            if (is_mutated[fn] == 1) {
              print "  private " fn ": " ft ";"
            } else {
              print "  private readonly " fn ": " ft ";"
            }
          }
          if (num_fields > 0) need_blank = 1
          continue
        }

        # Getter already fully braced
        if (ln ~ /^get[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([^)]*\)/) {
          if (in_ctor || in_method) { print "  }"; in_ctor = 0; in_method = 0; need_blank = 1 }
          if (need_blank) { print ""; need_blank = 0 }
          if (ln ~ /\{/ && ln ~ /\}/) {
            print "  " ln
          } else {
            sub(/:[[:space:]]*$/, "", ln)
            print "  " ln
          }
          need_blank = 1
          continue
        }

        # constructor
        if (ln ~ /^constructor[[:space:]]*\(.*:[[:space:]]*$/) {
          if (in_ctor || in_method) { print "  }"; in_ctor = 0; in_method = 0; need_blank = 1 }
          if (need_blank) { print ""; need_blank = 0 }
          sub(/:[[:space:]]*$/, "", ln)
          print "  " ln " {"
          in_ctor = 1
          in_method = 0
          continue
        }

        # method
        if (ln ~ /^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(.*:[[:space:]]*$/) {
          if (in_ctor || in_method) { print "  }"; in_ctor = 0; in_method = 0; need_blank = 1 }
          if (need_blank) { print ""; need_blank = 0 }
          sub(/:[[:space:]]*$/, "", ln)
          print "  " ln " {"
          in_method = 1
          in_ctor = 0
          continue
        }

        # body lines
        if (in_ctor || in_method) {
          if (ln != "") print "    " ln
          continue
        }
      }

      if (in_ctor || in_method) { print "  }" }
      print "}"
    }
  '
}

# Create net-new module with export class from Briefing (export_slice class).
# Args: rel_path, demand_text [, surface_root]
# Exit 0 if wrote; 1 if skip (file already has content / not class slice / no briefing).

aegis_mechanical_export_class_create() {
  local rel="${1-}"
  local demand="${2-}"
  local root="${3:-${AEGIS_EXECUTION_SURFACE_PATH:-.}}"
  local surface name ts body names

  [[ -n "${rel}" ]] || return 1
  aegis_demand_is_export_class_slice "${demand}" || return 1

  name="$(aegis_demand_export_slice_name "${demand}")"
  [[ -n "${name}" ]] || name="$(aegis_demand_acceptance_names "${demand}" | head -1)"
  [[ -n "${name}" ]] || return 1

  surface="${root%/}/${rel}"
  mkdir -p "$(dirname "${surface}")"

  # Only net-new / empty (or seed comment). Never overwrite real module body.
  if [[ -f "${surface}" ]]; then
    body="$(cat "${surface}" 2>/dev/null || true)"
    body="$(aegis_strip_aider_whole_file_junk "${body}")"
    names="$(aegis_file_top_level_export_names "${body}")"
    if printf '%s\n' "${names}" | grep -Fxq -- "${name}"; then
      return 1
    fi
    # Non-empty with other code but missing class — skip (unsafe to invent merge).
    if [[ -n "$(printf '%s' "${body}" | tr -d '[:space:]/')" ]]; then
      # allow only trivial seed "// path"
      if ! printf '%s' "${body}" | grep -qE '^[[:space:]]*//'; then
        return 1
      fi
      if printf '%s' "${body}" | grep -qE 'class |function |const |let |var '; then
        return 1
      fi
    fi
  fi

  ts="$(aegis_briefing_class_to_ts "${demand}" "${name}")" || return 1
  ts="$(aegis_mechanical_ts_fix_bigint_arith "${ts}")"
  [[ -n "$(printf '%s' "${ts}" | tr -d '[:space:]')" ]] || return 1

  printf '%s\n' "${ts}" > "${surface}"
  return 0
}

# Fail-closed shape gate for mechanical (and quality-first) candidates.
# Sensor: Acceptance exports must be top-level bindings in the corpus, and
# Node must load each non-noise target and resolve those names.
#
# Args: demand_text, surface_root, path1 [path2...]
# Exit 0 = ok; 1 = fail (reasons on stderr).
# Disable: AEGIS_MECHANICAL_SHAPE_GATE=0

aegis_mechanical_shape_gate() {
  local demand="${1-}"
  local root="${2-}"
  shift 2 || true
  local -a paths=("$@")

  case "${AEGIS_MECHANICAL_SHAPE_GATE:-1}" in
    0|false|no) return 0 ;;
  esac

  [[ -n "${demand}" && -n "${root}" ]] || {
    printf 'shape_gate: missing_demand_or_root\n' >&2
    return 1
  }
  [[ "${#paths[@]}" -gt 0 ]] || {
    printf 'shape_gate: no_paths\n' >&2
    return 1
  }

  local corpus="" p abs
  for p in "${paths[@]}"; do
    [[ -n "${p}" ]] || continue
    abs="${root%/}/${p#./}"
    [[ -f "${abs}" ]] || {
      printf 'shape_gate: missing_file:%s\n' "${p}" >&2
      return 1
    }
    corpus+="$(cat "${abs}" 2>/dev/null || true)"$'\n'
  done

  # 1) Static: every ## Acceptance token (except path noise) must be a
  # TOP-LEVEL export. Stricter than general acceptance_missing — listed
  # Acceptance items are the public surface for shape purposes (blocks
  # method-only poison for camelCase names like obterEstadoBitmask).
  local names=()
  local tok
  while IFS= read -r tok; do
    [[ -n "${tok}" ]] || continue
    aegis_acceptance_token_is_path_noise "${tok}" 2>/dev/null && continue
    names+=("${tok}")
  done < <(
    printf '%s\n' "${demand}" \
      | awk '/^## Acceptance[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
      | sed -E 's/^[[:space:]]*-[[:space:]]*//' \
      | command grep -oE '[A-Za-z_][A-Za-z0-9_]*' 2>/dev/null \
      | awk 'NF && !seen[$0]++' || true
  )

  # Auto-fix: if an acceptance identifier exists as a top-level column-0 declaration but lacks export, surgically add export
  local changed_fix=0
  for p in "${paths[@]}"; do
    [[ -n "${p}" ]] || continue
    abs="${root%/}/${p#./}"
    [[ -f "${abs}" ]] || continue
    for tok in "${names[@]}"; do
      if grep -Eq "^(class|function|const)[[:space:]]+${tok}\b" "${abs}" 2>/dev/null; then
        sed -i '' -E "s/^(class|function|const)[[:space:]]+${tok}\b/export \1 ${tok}/g" "${abs}" 2>/dev/null || true
        changed_fix=1
      fi
    done
  done

  if [[ "${changed_fix}" -eq 1 ]]; then
    corpus=""
    for p in "${paths[@]}"; do
      [[ -n "${p}" ]] || continue
      abs="${root%/}/${p#./}"
      [[ -f "${abs}" ]] || continue
      corpus+="$(cat "${abs}" 2>/dev/null || true)"$'\n'
    done
  fi

  missing_nl=""
  for tok in "${names[@]}"; do
    if ! aegis_acceptance_export_hit "${tok}" "${corpus}"; then
      if printf '%s\n' "${corpus}" | grep -Fiq -- "${tok}"; then
        missing_nl+="${tok}|not_exported"$'\n'
      else
        missing_nl+="${tok}|absent"$'\n'
      fi
    fi
  done

  if [[ -n "$(printf '%s' "${missing_nl}" | tr -d '[:space:]')" ]]; then
    printf 'shape_gate: acceptance_export_missing:\n%s' "${missing_nl}" >&2
    return 1
  fi

  # 2) Runtime smoke: import each loadable target; assert Acceptance names exist.
  command -v node >/dev/null 2>&1 || return 0

  [[ "${#names[@]}" -gt 0 ]] || return 0

  local strip=0
  if node --experimental-strip-types -e '1' >/dev/null 2>&1; then
    strip=1
  fi

  # NodeNext .js → .ts symlinks for smoke only.
  local -a _links=()
  local _ts _js
  while IFS= read -r _ts; do
    [[ -n "${_ts}" ]] || continue
    _js="${_ts%.ts}.js"
    if [[ ! -e "${root%/}/${_js}" && -f "${root%/}/${_ts}" ]]; then
      if ln -s "$(basename "${_ts}")" "${root%/}/${_js}" 2>/dev/null; then
        _links+=("${root%/}/${_js}")
      fi
    fi
  done < <(
    (cd "${root}" && find . -name '*.ts' ! -path '*/node_modules/*' 2>/dev/null | sed 's|^\./||') || true
  )

  local names_csv
  names_csv="$(printf '%s,' "${names[@]}" | sed 's/,$//')"
  local fail=0
  for p in "${paths[@]}"; do
    [[ -n "${p}" ]] || continue
    case "${p}" in
      *.ts|*.tsx)
        [[ "${strip}" -eq 1 ]] || continue
        ;;
      *.js|*.mjs|*.cjs) ;;
      *) continue ;;
    esac
    abs="${root%/}/${p#./}"
    local node_args=(node)
    [[ "${p}" == *.ts || "${p}" == *.tsx ]] && node_args+=(--experimental-strip-types)
    local out rc=0
    out="$(
      cd "${root}" || exit 97
      "${node_args[@]}" --input-type=module -e '
import { pathToFileURL } from "node:url";
const target = process.argv[1];
const want = (process.argv[2] || "").split(",").filter(Boolean);
import(pathToFileURL(target).href).then((mod) => {
  const missing = [];
  for (const n of want) {
    if (!(n in mod) || mod[n] === undefined) missing.push(n);
  }
  if (missing.length) {
    console.error("missing_exports:" + missing.join(","));
    process.exit(2);
  }
  process.exit(0);
}).catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
      ' "${abs}" "${names_csv}" 2>&1
    )" || rc=$?
    if [[ "${rc}" -ne 0 ]]; then
      fail=1
      printf 'shape_gate: smoke_failed:%s rc=%s\n%s\n' "${p}" "${rc}" "$(printf '%s' "${out}" | head -n 15)" >&2
    fi
  done

  local _l
  for _l in "${_links[@]+"${_links[@]}"}"; do
    [[ -L "${_l}" ]] && rm -f "${_l}" 2>/dev/null || true
  done

  [[ "${fail}" -eq 0 ]] || return 1
  return 0
}

# Sanitize Briefing→TS materialization for numeric/bigint foot-guns that tsc
# and runtime reject. Domain-agnostic (any class/function, any field names).
# Implementation: scripts/lib/mechanical_ts_sanitize.py
#
# Fixes (fail-closed mechanical must not emit these):
#   Math.floor/ceil/round/trunc/abs(<expr with bigint>)  → wrap arg in Number()
#   Math.min/max(a,b) when either side is bigint-ish       → ternary compare
#   BigInt(bigintish * this.numberField)                   → product of BigInts
#   timeDiff-like * this.numberField (bare)                → * BigInt(Math.floor(field))
#
# Does NOT invent Number(timeDiff) on pure bigint*bigint products that are
# already type-safe (quality rule: Briefing fidelity over wall-clock casts).

aegis_mechanical_ts_fix_bigint_arith() {
  local ts="${1-}"
  local helper=""
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${here}/mechanical_ts_sanitize.py" ]]; then
    helper="${here}/mechanical_ts_sanitize.py"
  elif [[ -f "${here}/scripts/lib/mechanical_ts_sanitize.py" ]]; then
    helper="${here}/scripts/lib/mechanical_ts_sanitize.py"
  elif [[ -n "${AEGIS_ROOT:-}" && -f "${AEGIS_ROOT}/scripts/lib/mechanical_ts_sanitize.py" ]]; then
    helper="${AEGIS_ROOT}/scripts/lib/mechanical_ts_sanitize.py"
  fi
  if [[ -z "${helper}" ]] || ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "${ts}"
    return 0
  fi
  printf '%s\n' "${ts}" | python3 "${helper}" 2>/dev/null || printf '%s\n' "${ts}"
}

# CamelCase / snake_case → lower tokens (one per line) for export↔demand match.

aegis_split_ident_tokens() {
  local name="${1-}"
  [[ -n "${name}" ]] || return 0
  printf '%s\n' "${name}" \
    | sed -E 's/([a-z0-9])([A-Z])/\1 \2/g; s/_+/ /g; s/-+/ /g' \
    | tr '[:upper:]' '[:lower:]' \
    | tr -s '[:space:]' '\n' \
    | awk 'length >= 3 { print }' \
    || true
}

# True (exit 0) when any demand token hits +lines, export names, or ident stems.

aegis_alignment_tokens_hit() {
  local added="${1-}"
  local tokens_nl="${2-}"
  local export_names_nl="${3-}"
  local token ename stem haystack

  haystack="$(
    printf '%s\n' "${added}"
    printf '%s\n' "${export_names_nl}"
    while IFS= read -r ename; do
      [[ -n "${ename}" ]] || continue
      aegis_split_ident_tokens "${ename}"
    done <<< "${export_names_nl}"
  )"

  while IFS= read -r token; do
    [[ -n "${token}" ]] || continue
    [[ "${#token}" -ge 4 ]] || continue
    if printf '%s' "${haystack}" | grep -Fqi -- "${token}"; then
      return 0
    fi
    # export name contains token or token contains export stem (≥4)
    while IFS= read -r ename; do
      [[ -n "${ename}" ]] || continue
      if printf '%s' "${ename}" | grep -Fqi -- "${token}"; then
        return 0
      fi
      if [[ "${#ename}" -ge 4 ]] \
        && printf '%s' "${token}" | grep -Fqi -- "${ename}"; then
        return 0
      fi
    done <<< "${export_names_nl}"
  done <<< "${tokens_nl}"
  return 1
}

# Minimal proof: final candidate still looks aligned with the demand.
# Prints JSON: {aligned:bool, violations:[{code,reason,fix,target_files}]}
# Origin codes are stable (demand_tokens|over_export|path_scope|done_when|empty_diff).
# Args: <diff_content> [files_changed_json] [investigation_input] [anchors_json]

aegis_candidate_alignment_gate() {
  local diff_content="${1-}"
  local files_json="${2:-[]}"
  local text="${3-${AEGIS_INVESTIGATION_INPUT:-}}"
  local anchors_json="${4-}"

  if [[ -z "${diff_content}" || "${diff_content}" == "(no changes)" ]]; then
    jq -nc '{
      aligned: false,
      violations: [{
        code: "empty_diff",
        reason: "alignment: candidate diff is empty",
        fix: "Produce a non-empty mutation that implements the demand",
        target_files: []
      }]
    }'
    return 0
  fi

  if ! printf '%s' "${files_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    files_json="[]"
  fi

  local -a violations=()
  local added tokens token_list export_n max_exports export_names
  local named_json seed_json done_json hit_path

  added="$(
    printf '%s\n' "${diff_content}" \
      | grep -E '^\+' \
      | grep -vE '^\+\+\+' \
      || true
  )"
  export_names="$(aegis_diff_added_export_names "${diff_content}")"

  # --- over-export ---
  # Cap defaults to 1, but multi-symbol Acceptance (class + helper) must be
  # allowed: TokenBucket + obterEstadoBitmask is a normal L7 demand.
  : "${AEGIS_MUTATION_MAX_NEW_EXPORTS:=1}"
  max_exports="${AEGIS_MUTATION_MAX_NEW_EXPORTS}"
  local acc_n
  acc_n="$(
    printf '%s\n' "${text}" \
      | awk '/^## Acceptance[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
      | sed -E 's/^[[:space:]]*-[[:space:]]*//' \
      | command grep -oE '[A-Za-z_][A-Za-z0-9_]{2,}' 2>/dev/null \
      | awk 'NF && !seen[$0]++' | grep -c . || true
  )"
  acc_n="${acc_n//[^0-9]/}"
  acc_n="${acc_n:-0}"
  if [[ "${acc_n}" -gt "${max_exports}" ]]; then
    max_exports="${acc_n}"
  fi
  if declare -f count_diff_added_exports >/dev/null 2>&1; then
    export_n="$(count_diff_added_exports "${diff_content}")"
  else
    export_n="$(
      printf '%s\n' "${export_names}" | awk 'NF' | wc -l | tr -d '[:space:]'
    )"
    [[ -n "${export_n}" ]] || export_n=0
  fi
  if [[ "${export_n}" -gt "${max_exports}" ]]; then
    violations+=("$(
      jq -nc --argjson n "${export_n}" --argjson max "${max_exports}" '{
        code: "over_export",
        reason: ("alignment: " + ($n|tostring) + " new exports in candidate (max " + ($max|tostring) + ")"),
        fix: "Keep demand-aligned exports only; remove parallel APIs beyond Acceptance",
        target_files: []
      }'
    )")
  fi

  # --- path intersection when demand names paths or seed targets exist ---
  if [[ -z "${anchors_json}" ]] || ! printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    if declare -f aegis_materialize_demand_anchors_json >/dev/null 2>&1; then
      anchors_json="$(
        aegis_materialize_demand_anchors_json "${text}" "" "" 2>/dev/null || printf '{}'
      )"
    else
      anchors_json="{}"
    fi
  fi
  named_json="$(printf '%s' "${anchors_json}" | jq -c '.operator_named_paths // []' 2>/dev/null || printf '[]')"
  seed_json="$(printf '%s' "${anchors_json}" | jq -c '.seed_targets // []' 2>/dev/null || printf '[]')"
  done_json="$(printf '%s' "${anchors_json}" | jq -c '.done_when // []' 2>/dev/null || printf '[]')"

  local expected_paths
  expected_paths="$(
    jq -nc --argjson n "${named_json}" --argjson s "${seed_json}" \
      '($n + $s) | unique | map(select(type == "string" and length > 0))'
  )"
  if printf '%s' "${expected_paths}" | jq -e 'length > 0' >/dev/null 2>&1 \
    && printf '%s' "${files_json}" | jq -e 'length > 0' >/dev/null 2>&1; then
    hit_path="$(
      jq -nc --argjson exp "${expected_paths}" --argjson got "${files_json}" '
        def norm: gsub("^\\./"; "");
        any($got[]?; . as $g | any($exp[];
          (.|norm) == ($g|norm)
          or (($g|norm) | startswith((.|norm) + "/"))
          or ((.|norm) | startswith(($g|norm) + "/"))
        ))
      ' 2>/dev/null || printf 'false'
    )"
    if [[ "${hit_path}" != "true" ]]; then
      violations+=("$(
        jq -nc --argjson exp "${expected_paths}" --argjson got "${files_json}" '{
          code: "path_scope",
          reason: ("alignment: files_changed " + ($got|tostring)
            + " does not intersect demand/seed paths " + ($exp|tostring)),
          fix: "Mutate a path named in the demand or seed targets",
          target_files: $got
        }'
      )")
    fi
  fi

  # --- dense demand tokens: +lines, export names, camelCase/snake stems ---
  if declare -f aegis_demand_dense_tokens >/dev/null 2>&1; then
    tokens="$(aegis_demand_dense_tokens "${text}")"
    if [[ -n "${tokens}" ]]; then
      if ! aegis_alignment_tokens_hit "${added}" "${tokens}" "${export_names}"; then
        token_list="$(printf '%s' "${tokens}" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
        violations+=("$(
          jq -nc --arg tl "${token_list}" '{
            code: "demand_tokens",
            reason: ("alignment: none of demand tokens [" + $tl
              + "] appear in +lines or export names"),
            fix: ("Put demand tokens from [" + $tl
              + "] into the export name or body"),
            target_files: []
          }'
        )")
      fi
    fi
  fi

  # --- done_when (soft): match identifier tokens from phrases, not full prose ---
  # Prose like "TokenBucket is exported from src/index.ts" must pass when
  # +lines contain TokenBucket / index.ts — not the whole sentence.
  if printf '%s' "${done_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    local done_hit=0 done_item done_list done_tokens_nl=""
    local done_tok
    while IFS= read -r done_item; do
      [[ -n "${done_item}" ]] || continue
      [[ "${#done_item}" -ge 3 ]] || continue
      # Full short bullet still matches (legacy + simple tokens).
      if [[ "${#done_item}" -le 48 ]] \
        && ! printf '%s' "${done_item}" | grep -qiE '[[:space:]](is|from|with|should|must|that|the)[[:space:]]'; then
        if printf '%s' "${added}" | grep -Fqi -- "${done_item}"; then
          done_hit=1
          break
        fi
        if printf '%s' "${export_names}" | grep -Fqi -- "${done_item}"; then
          done_hit=1
          break
        fi
      fi
      # Extract code-like tokens / path basenames from the phrase.
      while IFS= read -r done_tok; do
        [[ -n "${done_tok}" ]] || continue
        [[ "${#done_tok}" -ge 3 ]] || continue
        done_tokens_nl+="${done_tok}"$'\n'
      done < <(
        {
          printf '%s\n' "${done_item}" \
            | command grep -oE '[A-Za-z_][A-Za-z0-9_]{2,}' 2>/dev/null || true
          printf '%s\n' "${done_item}" \
            | command grep -oE "${AEGIS_SOURCE_PATH_RE:-[A-Za-z0-9_./-]+\\.(ts|tsx|js|jsx|mjs|cjs)\\b}" 2>/dev/null \
            | command sed 's|.*/||' || true
          # bare numbers like 1024 that often appear in formulas
          printf '%s\n' "${done_item}" \
            | command grep -oE '[0-9]{3,}' 2>/dev/null || true
        } | sort -u
      )
    done < <(printf '%s' "${done_json}" | jq -r '.[]? | select(type == "string")')

    if [[ "${done_hit}" -eq 0 && -n "${done_tokens_nl}" ]]; then
      if aegis_alignment_tokens_hit "${added}" "${done_tokens_nl}" "${export_names}"; then
        done_hit=1
      fi
    fi

    if [[ "${done_hit}" -eq 0 ]]; then
      done_list="$(printf '%s' "${done_json}" | jq -r 'map(select(type=="string")) | join(" | ")' 2>/dev/null || true)"
      violations+=("$(
        jq -nc --arg dl "${done_list}" '{
          code: "done_when",
          reason: ("alignment: none of done_when tokens/phrases appear in +lines: " + $dl),
          fix: ("Put done_when identifiers (not full prose) into the change: " + $dl),
          target_files: []
        }'
      )")
    fi
  fi

  if [[ "${#violations[@]}" -eq 0 ]]; then
    jq -nc '{aligned: true, violations: []}'
    if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
      jq -cn '{kind:"alignment",result:"pass"}' \
        >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
    fi
    return 0
  fi

  local vjson
  vjson="$(printf '%s\n' "${violations[@]}" | jq -s -c '.')"
  jq -nc --argjson v "${vjson}" '{aligned: false, violations: $v}'
  if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
    jq -cn --argjson v "${vjson}" \
      '{kind:"alignment",result:"fail",violations:$v}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  fi
  return 0
}

# Diff text from handover for build (op.diff) or optimize (candidate_result).

aegis_handover_mutation_diff() {
  local handover="${1-}"
  [[ -n "${handover}" && -f "${handover}" ]] || return 1
  jq -r '
    .artifact_snapshot as $s
    | if ($s.mode == "mutation" or $s.mode == "build") then
        ($s.operational_context.diff // empty)
      else
        ($s.operational_context.candidate_result.diff
          // $s.operational_context.diff // empty)
      end
  ' "${handover}" 2>/dev/null
}

# files_changed JSON array for mutation or optimize candidate.

aegis_handover_mutation_files_json() {
  local handover="${1-}"
  [[ -n "${handover}" && -f "${handover}" ]] || { printf '[]'; return 0; }
  jq -c '
    .artifact_snapshot as $s
    | if ($s.mode == "mutation" or $s.mode == "build") then
        [($s.operational_context.files_changed // [])[]?
          | select(type == "string" and length > 0)]
      else
        [($s.operational_context.candidate_result.files_changed
            // $s.operational_context.files_changed // [])[]?
          | select(type == "string" and length > 0)]
      end
  ' "${handover}" 2>/dev/null || printf '[]'
}

# Added unified-diff lines only (no +++ headers).

aegis_diff_added_lines() {
  local diff_content="${1-}"
  printf '%s\n' "${diff_content}" \
    | grep -E '^\+' \
    | grep -vE '^\+\+\+' \
    || true
}

# True when Mutation candidate is small/clean enough to skip optimize LLM.
# Heuristic: ≤N files, ≤M diff lines, no explicit any in added lines.

aegis_acceptance_ident_tokens() {
  local text="${1-}"
  [[ -n "${text}" ]] || return 0

  local anchors done_raw=""
  if declare -f aegis_materialize_demand_anchors_json >/dev/null 2>&1; then
    anchors="$(
      aegis_materialize_demand_anchors_json "${text}" "" "" 2>/dev/null || printf '{}'
    )"
    done_raw="$(
      printf '%s' "${anchors}" \
        | jq -r '(.done_when // [])[]?' 2>/dev/null || true
    )"
  fi
  if [[ -z "${done_raw}" ]] && declare -f aegis_demand_md_section >/dev/null 2>&1; then
    done_raw="$(
      aegis_demand_md_section "Acceptance" "${text}" 2>/dev/null \
        | sed -E 's/^[[:space:]]*[-*][[:space:]]*//; s/^[[:space:]]*[0-9]+[.)][[:space:]]*//' \
        || true
    )"
  fi
  [[ -n "${done_raw}" ]] || return 0

  local line tok
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    # Whole bullet is a single identifier.
    if [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      printf '%s\n' "${line}"
      continue
    fi
    # Extract CamelCase / snake identifiers (len ≥ 4).
    while IFS= read -r tok; do
      [[ -n "${tok}" ]] || continue
      [[ "${#tok}" -ge 4 && "${#tok}" -le 48 ]] || continue
      case "$(printf '%s' "${tok}" | tr '[:upper:]' '[:lower:]')" in
        string|number|boolean|export|const|class|function|return|import|type|async|await|true|false|null|undefined|files|target|change|scope|rules|write|valid|entire|using|same|body|block|never|other|network|single|private|inside|above|shape|assign|should|must|when|done|with|from|into|this|that) continue ;;
      esac
      printf '%s\n' "${tok}"
    done < <(
      printf '%s\n' "${line}" \
        | grep -Eo '[A-Za-z_][A-Za-z0-9_]{3,}' \
        || true
    )
  done <<< "${done_raw}" \
    | awk 'NF && !seen[$0]++' \
    | head -n 12
}

# Corpus for acceptance: +lines of diff + on-disk bodies of files_changed.
# Senior: open the final files, not only the green hunks.

aegis_candidate_files_corpus() {
  local files_json="${1:-[]}"
  local diff_content="${2-}"
  local root="${3:-.}"

  local added
  added="$(aegis_diff_added_lines "${diff_content}")"
  printf '%s\n' "${added}"

  local rel path
  while IFS= read -r rel; do
    [[ -n "${rel}" ]] || continue
    for path in \
      "${root%/}/${rel}" \
      "${rel}" \
      "./${rel}"
    do
      if [[ -f "${path}" && -r "${path}" ]]; then
        # Cap per file to keep scans cheap.
        head -c 100000 "${path}" 2>/dev/null || true
        printf '\n'
        break
      fi
    done
  done < <(
    printf '%s' "${files_json}" \
      | jq -r '.[]? | select(type=="string" and length>0)' 2>/dev/null || true
  )
}

# Language / Web API globals — presence in body is enough (not export bindings).

aegis_acceptance_token_is_language_global() {
  local tok="${1-}"
  case "$(printf '%s' "${tok}" | tr '[:upper:]' '[:lower:]')" in
    bigint|promise|map|set|date|error|array|object|json|math|symbol|number|string|boolean|regexp|weakmap|weakset|proxy|reflect|intl|buffer|uint8array|arraybuffer|dataview|url|console)
      return 0
      ;;
  esac
  return 1
}

# API-like tokens (PascalCase / CamelCase / long) must be public exports,
# not only a parameter name (stress B gaming: MustExistSymbolXYZ as param).
# True when the demand text itself puts the token behind an export verb —
# "Exporte a função obterEstadoBitmask", "export SymbolX". The window stops
# at a sentence break so a later clause cannot borrow an earlier verb.

aegis_acceptance_token_demands_export() {
  local tok="${1-}"
  local demand="${2-}"
  [[ -n "${tok}" && -n "${demand}" ]] || return 1
  printf '%s\n' "${demand}" | tr '\n' ' ' | grep -Eiq \
    "(exports?|exporte|exporta|exportar|exported|re-?exporte?|expose)[^.]{0,40}\\b${tok}\\b" \
    2>/dev/null
}

# Shape alone cannot tell an exported function from a constructor parameter:
# obterEstadoBitmask and maxBytes are both camelCase. Only PascalCase (types
# and classes) is required to be exported on shape; for everything else the
# demand decides. Requiring export from every camelCase token made demands
# like "Construtor aceita (maxBytes: bigint)" unsatisfiable — the model was
# told to publish its own internal state.

aegis_acceptance_token_is_export_like() {
  local tok="${1-}"
  local demand="${2-}"
  [[ -n "${tok}" ]] || return 1
  # Built-ins are never "must export".
  if aegis_acceptance_token_is_language_global "${tok}"; then
    return 1
  fi
  # PascalCase — class/type/interface names. Keeps the anti-gaming gate that
  # blocks satisfying an acceptance token with a bare parameter name.
  [[ "${tok}" =~ ^[A-Z] ]] && return 0
  # Otherwise the demand is the authority on what is public.
  aegis_acceptance_token_demands_export "${tok}" "${demand}"
}

# Token is part of the module's declared surface: a typed member, constructor
# parameter, binding, or assignment. Used only for tokens the demand does NOT
# mark for export — for those, appearing as declared state IS the compliance.

aegis_acceptance_declared_hit() {
  local tok="${1-}"
  local corpus="${2-}"
  [[ -n "${tok}" ]] || return 1
  printf '%s\n' "${corpus}" | grep -Eq \
    "(^|[[:space:];{(,])((public|private|protected|static|readonly|abstract|override|let|const|var)[[:space:]]+)*${tok}[[:space:]]*[?!]?[[:space:]]*[:=]|this\\.${tok}[[:space:]]*[=.]" \
    2>/dev/null
}

# Hit if token appears as export function/const/class/type/{ Tok }, or as a
# class/object method declaration (public encodeState(), encodeState(): …).
# Param-only gaming (SymbolX: number) does not match method form (needs '(').

aegis_acceptance_export_hit() {
  local tok="${1-}"
  local corpus="${2-}"
  # Escape tok for basic ERE (idents only expected).
  # TOP-LEVEL export only. A class method named obterEstadoBitmask must NOT
  # satisfy Acceptance for an exported function of that name — that poison
  # made issue #91/#92 task-1 "succeed" without the real export, then task-2
  # reexport failed forever (index cannot invent sibling exports).
  if printf '%s\n' "${corpus}" | grep -Eiq \
    "export[[:space:]]+(async[[:space:]]+)?(function|const|class|type|interface|enum)[[:space:]]+${tok}[[:space:](;=]|export[[:space:]]*\{[^}]*\b${tok}\b" \
    2>/dev/null; then
    return 0
  fi
  return 1
}

# Barrel / path basenames that are not API identifiers (never require in body).

aegis_acceptance_token_is_path_noise() {
  local tok="${1-}"
  case "$(printf '%s' "${tok}" | tr '[:upper:]' '[:lower:]')" in
    index|main|mod|module|src|lib|dist|app|server|client|util|utils|types|type|helpers|helper|common|shared|export|exports|import|imports|file|files|path|paths|ts|js|tsx|jsx)
      return 0
      ;;
  esac
  # Bare extensions / filenames like index.ts
  [[ "${tok}" =~ \.(ts|tsx|js|jsx|mjs|cjs)$ ]] && return 0
  return 1
}

# True (0) when every acceptance ident is satisfied in corpus.
# Export-like tokens require an export binding; others need substring presence.
# Prints missing tokens to stdout on failure.

aegis_acceptance_missing_in_corpus() {
  local investigation="${1-}"
  local corpus="${2-}"
  local tokens_nl missing=""
  tokens_nl="$(aegis_acceptance_ident_tokens "${investigation}")"
  [[ -n "${tokens_nl}" ]] || return 0

  local tok
  while IFS= read -r tok; do
    [[ -n "${tok}" ]] || continue
    # Skip path/barrel noise (e.g. Acceptance "- index" from micro templates).
    if aegis_acceptance_token_is_path_noise "${tok}"; then
      continue
    fi
    if aegis_acceptance_token_is_export_like "${tok}" "${investigation}"; then
      if ! aegis_acceptance_export_hit "${tok}" "${corpus}"; then
        # Distinguish "nowhere in the file" from "written, but not exported":
        # the two need opposite fixes, and reporting the second as the first
        # sends the model looking for code that is already there.
        if aegis_acceptance_declared_hit "${tok}" "${corpus}" \
          || printf '%s\n' "${corpus}" | grep -Fiq -- "${tok}"; then
          missing="${missing}${tok}|not_exported"$'\n'
        else
          missing="${missing}${tok}|absent"$'\n'
        fi
      fi
    else
      # Not demanded as an export: being declared state or a parameter IS the
      # compliance for demands like "Construtor aceita (maxBytes: bigint)".
      if ! aegis_acceptance_declared_hit "${tok}" "${corpus}" \
        && ! printf '%s\n' "${corpus}" | grep -Fiq -- "${tok}"; then
        missing="${missing}${tok}|absent"$'\n'
      fi
    fi
  done <<< "${tokens_nl}"

  if [[ -z "${missing}" ]]; then
    return 0
  fi
  printf '%s' "${missing}" | awk 'NF'
  return 1
}

# Pick a path from files_json that matches a basename fragment (else first path).

aegis_files_json_pick() {
  local files_json="${1:-[]}"
  local needle="${2-}"
  local fallback
  fallback="$(
    printf '%s' "${files_json}" \
      | jq -r 'map(select(type=="string" and length>0))[0] // empty' 2>/dev/null || true
  )"
  if [[ -n "${needle}" ]]; then
    local hit
    hit="$(
      printf '%s' "${files_json}" \
        | jq -r --arg n "${needle}" \
          'map(select(type=="string" and (contains($n))))[0] // empty' 2>/dev/null || true
    )"
    if [[ -n "${hit}" ]]; then
      printf '%s' "${hit}"
      return 0
    fi
  fi
  printf '%s' "${fallback}"
}

# True when investigation explicitly limits public surface to one export.

aegis_demand_limits_one_export() {
  local investigation="${1-}"
  [[ -n "${investigation}" ]] || return 1
  # Multi-export or barrel reexport demands must never enter the "delete extra
  # exports" surface path — index.ts often already has a public API.
  if printf '%s' "${investigation}" | grep -Eiq \
    'bitmask|função exportada|exportada que|funções exportadas|reexport only|re-export only|obterEstado|export function.*export class|export class.*export function'; then
    return 1
  fi
  if printf '%s' "${investigation}" | grep -Eiq \
    'do not delete pre-existing|pre-existing barrel|keep existing exports|barrel reexport'; then
    return 1
  fi
  printf '%s' "${investigation}" | grep -Eiq \
    'exactly[[:space:]]+one[[:space:]]+(top-level[[:space:]]+)?export|one[[:space:]]+primary[[:space:]]+public[[:space:]]+export|one[[:space:]]+export:|Only[[:space:]].*one[[:space:]]+export|single[[:space:]]+public[[:space:]]+export|Do[[:space:]]+\*\*not\*\*[[:space:]]+export[[:space:]]+constants'
}

# Count top-level export declarations in a TS/JS corpus (export function/class/const/type/…).

aegis_count_top_level_exports() {
  local corpus="${1-}"
  printf '%s\n' "${corpus}" \
    | grep -E '^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?(function|class|const|let|var|type|interface|enum|default)\b|^[[:space:]]*export[[:space:]]*\{' \
    | grep -cvE 'export[[:space:]]+(type[[:space:]]+)?\{[^}]*\}[[:space:]]*from' \
    || true
}

# First surface bloat improvement (multi-export when demand says one).
# Prints JSON {target_files,change,why_safe,code} or empty.

aegis_format_mutation_file_bodies_section() {
  local handover="${1-}"
  local root="${2:-.}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local max_bytes max_files
  : "${AEGIS_OPTIMIZE_FILE_BODY_MAX_BYTES:=8000}"
  : "${AEGIS_OPTIMIZE_FILE_BODY_MAX_FILES:=4}"
  max_bytes="${AEGIS_OPTIMIZE_FILE_BODY_MAX_BYTES}"
  max_files="${AEGIS_OPTIMIZE_FILE_BODY_MAX_FILES}"

  local diff_body files_json
  diff_body="$(
    jq -r '
      .artifact_snapshot as $snap
      | select($snap.mode == "mutation" or $snap.mode == "build")
      | ($snap.operational_context.diff // empty)
      | select(type == "string" and length > 0 and . != "(no changes)")
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${diff_body}" ]] || return 0

  files_json="$(
    jq -c '
      .artifact_snapshot as $snap
      | select($snap.mode == "mutation" or $snap.mode == "build")
      | [($snap.operational_context.files_changed // [])[]?
          | select(type == "string" and length > 0)][0:'"${max_files}"']
    ' "${handover}" 2>/dev/null || printf '[]'
  )"
  if ! printf '%s' "${files_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    return 0
  fi

  local tmp diff_file path full rel body trunc note n=0
  tmp="$(mktemp -d 2>/dev/null || true)"
  [[ -n "${tmp}" && -d "${tmp}" ]] || return 0
  diff_file="$(mktemp 2>/dev/null || true)"
  if [[ -z "${diff_file}" ]]; then
    rm -rf "${tmp}" 2>/dev/null || true
    return 0
  fi
  printf '%s\n' "${diff_body}" > "${diff_file}"

  {
    echo "=== POST-MUTATION FILE BODIES (runtime; after applying Mutation diff) ==="
    echo
    echo "Read-only snapshot for judgment. Prefer citing symbols from these bodies + MUTATION RESULT."
    echo
  }

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    n=$((n + 1))
    rel="${path#./}"
    full="${tmp}/${rel}"
    mkdir -p "$(dirname "${full}")" 2>/dev/null || true
    # Baseline from HEAD when tracked; empty for net-new.
    if git -C "${root}" cat-file -e "HEAD:${rel}" 2>/dev/null; then
      git -C "${root}" show "HEAD:${rel}" > "${full}" 2>/dev/null || : > "${full}"
    else
      : > "${full}"
    fi
  done < <(printf '%s' "${files_json}" | jq -r '.[]?')

  # Apply full mutation patch into the temp tree (paths match +++ b/...).
  # Use patch(1) from inside tmp (more portable than git apply --directory).
  if ! (
    cd "${tmp}" && patch -p1 --forward --batch --silent < "${diff_file}"
  ) >/dev/null 2>&1; then
    # Fallback: still show HEAD bodies if apply fails (better than silence).
    echo "(post-mutation apply failed — showing pre-mutation HEAD bodies where available)"
    echo
  fi

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    rel="${path#./}"
    full="${tmp}/${rel}"
    echo "--- file: ${rel} ---"
    if [[ ! -f "${full}" ]]; then
      echo "(missing after apply)"
      echo
      continue
    fi
    body="$(head -c "$((max_bytes + 1))" "${full}" 2>/dev/null || true)"
    if [[ "${#body}" -gt "${max_bytes}" ]]; then
      trunc_note="[AEGIS][FILE_BODY_TRUNCATED:${#body}->${max_bytes}]"
      body="${body:0:${max_bytes}}"
      printf '%s\n' "${body}"
      echo
      echo "${trunc_note}"
    else
      printf '%s\n' "${body}"
    fi
    echo
  done < <(printf '%s' "${files_json}" | jq -r '.[]?')

  rm -f "${diff_file}" 2>/dev/null || true
  rm -rf "${tmp}" 2>/dev/null || true
}

aegis_format_build_file_bodies_section() { aegis_format_mutation_file_bodies_section "$@"; }

# Local re-mutation feedback from rejected validation (stable tribunal codes).

aegis_format_mutation_feedback_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local lines
  lines="$(
    jq -r '
      .artifact_snapshot as $snap
      | select($snap.mode == "validation")
      | ((($snap.operational_context.mutation_feedback // $snap.operational_context.build_feedback)) // empty) as $rf
      | select($rf | type == "object")
      | ($rf.violations // []) as $v
      | select(($v | length) > 0)
      | "=== MUTATION FEEDBACK (runtime) ===",
        "",
        "Fix ONLY these violations inside authorized scopes. No rediscovery.",
        (
          ($rf.authorized_scopes // []) as $s
          | if ($s | length) > 0 then "SCOPES: " + ($s | join(", ")) else empty end
        ),
        (
          $v[]
          | "- [\(.origin // "unspecified")] \(.structural_reason // .description // "")"
            + (
                if ((.target_files // []) | length) > 0
                then " @ " + (.target_files | join(", "))
                else "" end
              )
        ),
        ""
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${lines}" ]] || return 0
  printf '%s\n' "${lines}"
}

aegis_format_build_feedback_section() { aegis_format_mutation_feedback_section "$@"; }


# ---------------------------------------------------------
# Mechanical discovery / forensics (default — no LLM)
# ---------------------------------------------------------
# One seed authority: aegis_materialize_demand_anchors_json
#   handover > attention_seed > layer0_resonance > prior
# Mechanical modes only project that object — no re-ranking.
#
# Discovery: always mechanical content-aware gap projection (no LLM).
# Forensics: {id, reason}; multi named → one each; else Alvo Único
#   (1 seed, or multi-seed unique probe winner, else first seed if forced).
# AEGIS_FORENSICS_LLM:
#   auto (default) — LLM only on multi-seed probe tie / no signal
#   1|llm          — always LLM
#   0|mechanical   — always mechanical
# Search evidence: forensics LLM path only (see execute_mode + ensure_search).
#
# Call shape (execute_mode): text, payload_dir, handover
# (materialize itself takes text, handover, payload_dir).

# Resolve anchors for mechanical modes. Arg order: text, payload_dir, handover.
# Explicit empty strings pin "no file" (no env leak in tests).
