#!/usr/bin/env bash
# =========================================================
# Demand fit check (rails + model-risk heuristics)
# =========================================================
# Source-only. Produces JSON assessing whether a work unit fits
# Aegis rails and a weak-model budget; applies safe auto-fixes
# to demand markdown; proposes micro-units when needed.
#
# Does NOT call LLMs. Does NOT guarantee run success.
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] fit_check_lib_not_invocable" >&2
  exit 1
fi

# Defaults (override via env before source)
: "${AEGIS_FIT_MAX_TARGETS:=1}"
: "${AEGIS_FIT_MAX_OPEN_TASKS:=2}"
: "${AEGIS_FIT_MAX_ACCEPTANCE_LINE:=48}"
: "${AEGIS_FIT_MAX_CHANGE_LINES:=24}"
: "${AEGIS_FIT_MAX_BODY_CHARS:=3500}"
: "${AEGIS_FIT_POOR_SCORE:=6}"
: "${AEGIS_FIT_MARGINAL_SCORE:=3}"

# ---------------------------------------------------------
# Section helpers (local; demand.sh may also provide these)
# ---------------------------------------------------------

aegis_fit_md_section() {
  local heading="$1"
  local text="${2-}"
  [[ -n "${text}" ]] || return 0
  printf '%s\n' "${text}" | awk -v h="## ${heading}" '
    BEGIN { p = 0 }
    /^## / {
      if (p) { exit }
      if ($0 == h) { p = 1; next }
      next
    }
    p { print }
  '
}

aegis_fit_is_structured() {
  local text="${1-}"
  printf '%s\n' "${text}" | grep -qE '^## (Goal|Targets|Acceptance|Change|Out of scope|Constraints)\s*$'
}

aegis_fit_open_task_count() {
  local text="${1-}"
  local tasks
  tasks="$(aegis_fit_md_section "Tasks" "${text}")"
  if [[ -z "$(printf '%s' "${tasks}" | tr -d '[:space:]')" ]]; then
    printf '0'
    return 0
  fi
  printf '%s\n' "${tasks}" | grep -cE '^\s*-\s*\[\s*\]' || true
}

aegis_fit_target_paths() {
  local text="${1-}"
  local body
  if aegis_fit_is_structured "${text}"; then
    body="$(aegis_fit_md_section "Targets" "${text}")"
    if [[ -n "$(printf '%s' "${body}" | tr -d '[:space:]')" ]]; then
      text="${body}"
    fi
  fi
  if declare -f aegis_extract_operator_named_paths >/dev/null 2>&1; then
    # Temporarily disable Targets-only scope by passing targets body only
    aegis_extract_operator_named_paths "${text}"
  else
    printf '%s' "${text}" \
      | command grep -oE "${AEGIS_SOURCE_PATH_RE:-[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|mjs|cjs|sh|py)\\b}" 2>/dev/null \
      | command sed 's|^\./||' \
      | sort -u || true
  fi
}

# Paths mentioned outside ## Targets (ghost risk when structured).
aegis_fit_paths_outside_targets() {
  local text="${1-}"
  local targets_body other
  if ! aegis_fit_is_structured "${text}"; then
    return 0
  fi
  targets_body="$(aegis_fit_md_section "Targets" "${text}")"
  other="$(
    {
      aegis_fit_md_section "Goal" "${text}"
      aegis_fit_md_section "Change" "${text}"
      aegis_fit_md_section "Acceptance" "${text}"
      aegis_fit_md_section "Out of scope" "${text}"
      aegis_fit_md_section "Constraints" "${text}"
      aegis_fit_md_section "Notes" "${text}"
      aegis_fit_md_section "Tasks" "${text}"
    } | tr '\n' ' '
  )"
  local t o
  while IFS= read -r o; do
    [[ -n "${o}" ]] || continue
    if ! printf '%s\n' "${targets_body}" | grep -Fq "${o}"; then
      # package.json substring must not count as package.js after regex fix;
      # still flag bare non-target source paths in prose.
      printf '%s\n' "${o}"
    fi
  done < <(
    printf '%s' "${other}" \
      | command grep -oE "${AEGIS_SOURCE_PATH_RE:-[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|mjs|cjs|sh|py)\\b}" 2>/dev/null \
      | command sed 's|^\./||' \
      | sort -u || true
  )
}

# ---------------------------------------------------------
# Auto-fixes (return fixed markdown on stdout)
# ---------------------------------------------------------

# Replace long Acceptance prose lines with short identifier tokens.
aegis_fit_fix_acceptance_tokens() {
  local text="${1-}"
  local acc change goal
  local -a tokens=()
  local line t

  if ! aegis_fit_is_structured "${text}"; then
    printf '%s' "${text}"
    return 0
  fi

  acc="$(aegis_fit_md_section "Acceptance" "${text}")"
  change="$(aegis_fit_md_section "Change" "${text}")"
  goal="$(aegis_fit_md_section "Goal" "${text}")"

  # Collect candidate tokens from Change+Goal+Acceptance (code-like).
  while IFS= read -r t; do
    [[ -n "${t}" ]] || continue
    [[ "${#t}" -ge 3 ]] || continue
    tokens+=("${t}")
  done < <(
    {
      printf '%s\n' "${change}"
      printf '%s\n' "${goal}"
      printf '%s\n' "${acc}"
    } | command grep -oE '[A-Za-z_][A-Za-z0-9_]{2,}' 2>/dev/null \
      | command grep -Ev '^(the|and|for|with|from|this|that|only|when|then|else|type|number|boolean|string|export|class|function|return|private|public|const|true|false|null|undefined|Goal|Targets|Change|Acceptance|Tasks|Out|scope|Constraints)$' \
      | sort -u
  )

  # Also keep short path basenames from Targets.
  while IFS= read -r t; do
    [[ -n "${t}" ]] || continue
    tokens+=("$(basename "${t}")")
    tokens+=("${t}")
  done < <(aegis_fit_target_paths "${text}")

  # If any acceptance line is "prose-like", rebuild Acceptance from tokens.
  local needs=0
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    # strip list marker
    line="$(printf '%s' "${line}" | sed -E 's/^[[:space:]]*-[[:space:]]*//')"
    if [[ "${#line}" -gt "${AEGIS_FIT_MAX_ACCEPTANCE_LINE}" ]] \
      || printf '%s' "${line}" | grep -qiE '\bis\b|\bfrom\b|\bwith\b|\bshould\b|\bmust\b|\bthat\b'; then
      needs=1
      break
    fi
  done <<< "${acc}"

  if [[ "${needs}" -eq 0 ]]; then
    printf '%s' "${text}"
    return 0
  fi

  # Build new Acceptance (max 8 tokens).
  local new_acc=""
  local n=0
  local -A seen=()
  for t in "${tokens[@]}"; do
    [[ -z "${seen[$t]:-}" ]] || continue
    seen["${t}"]=1
    new_acc+="- ${t}"$'\n'
    n=$((n + 1))
    [[ "${n}" -ge 8 ]] && break
  done
  if [[ "${n}" -eq 0 ]]; then
    printf '%s' "${text}"
    return 0
  fi

  # Splice Acceptance section (ENV avoids awk newline-in -v issues).
  export AEGIS_FIT_NEW_ACC="${new_acc}"
  printf '%s\n' "${text}" | awk '
    BEGIN { p = 0; done = 0; new = ENVIRON["AEGIS_FIT_NEW_ACC"] }
    /^## Acceptance[[:space:]]*$/ {
      print
      printf "%s", new
      p = 1
      done = 1
      next
    }
    /^## / {
      if (p) p = 0
    }
    p { next }
    { print }
    END {
      if (!done) {
        print ""
        print "## Acceptance"
        printf "%s", new
      }
    }
  '
}

# Soften ghost-path prose: "package.json" stays (no longer matches .js);
# remove explicit "package.js" from non-target sections by renaming mention.
aegis_fit_fix_ghost_path_prose() {
  local text="${1-}"
  # Avoid recommending package.js as a path token in Out of scope / Notes.
  printf '%s' "${text}" \
    | sed -E 's/\bpackage\.js\b/the package entrypoint (not a target)/g'
}

# Ensure minimal structured skeleton from free-text.
aegis_fit_wrap_free_text() {
  local text="${1-}"
  local paths goal
  if aegis_fit_is_structured "${text}"; then
    printf '%s' "${text}"
    return 0
  fi
  paths="$(aegis_fit_target_paths "${text}")"
  goal="$(printf '%s' "${text}" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' | cut -c1-240)"
  {
    printf '## Goal\n%s\n\n' "${goal}"
    printf '## Targets\n'
    if [[ -n "${paths}" ]]; then
      while IFS= read -r p; do
        [[ -n "${p}" ]] && printf -- '- %s\n' "${p}"
      done <<< "${paths}"
    else
      printf -- '- src/\n'
    fi
    printf '\n## Tasks\n- [ ] Task 1 — apply demand\n\n'
    printf '## Change\n- Implement demand in Targets only\n\n'
    printf '## Acceptance\n'
    if [[ -n "${paths}" ]]; then
      while IFS= read -r p; do
        [[ -n "${p}" ]] && printf -- '- %s\n' "$(basename "${p}")"
      done <<< "${paths}"
    else
      printf -- '- src\n'
    fi
    printf '\n## Out of scope\n- unrelated files\n- network\n- UI\n\n'
    printf '## Constraints\n- no any\n- KISS\n'
  }
}

# ---------------------------------------------------------
# Split proposal (does not auto-open issues)
# ---------------------------------------------------------

aegis_fit_propose_units_json() {
  local text="${1-}"
  local paths
  paths="$(aegis_fit_target_paths "${text}")"
  local -a arr=()
  while IFS= read -r p; do
    [[ -n "${p}" ]] || continue
    arr+=("${p}")
  done <<< "${paths}"

  if [[ "${#arr[@]}" -le 1 ]]; then
    # Single path: still may split create vs reexport heuristics from Change text
    local change
    change="$(aegis_fit_md_section "Change" "${text}")$(aegis_fit_md_section "Goal" "${text}")"
    if printf '%s' "${change}" | grep -qiE 'reexport|re-export' \
      && printf '%s' "${change}" | grep -qiE 'create|new file|tokenBucket|module'; then
      jq -cn \
        --arg t "${arr[0]:-src/}" \
        '[
          {title:"create module only", targets:[$t], note:"omit reexport"},
          {title:"reexport only", targets:["src/index.ts"], note:"after create succeeds"}
        ]'
      return 0
    fi
    printf '[]'
    return 0
  fi

  # One unit per target path
  jq -cn --arg paths "$(printf '%s\n' "${arr[@]}")" '
    ($paths | split("\n") | map(select(length>0))) as $p
    | [ $p[] | {title: ("mutate " + .), targets: [.], note: "single-target micro unit"} ]
  '
}

# ---------------------------------------------------------
# Main: evaluate + fix → JSON on stdout
# ---------------------------------------------------------

aegis_fit_check_demand() {
  local raw="${1-}"
  local original fixed
  original="${raw}"
  fixed="${raw}"

  local -a blockers=()
  local -a warnings=()
  local -a fixes=()
  local score=0

  # --- auto wrap free-text ---
  if ! aegis_fit_is_structured "${fixed}"; then
    fixed="$(aegis_fit_wrap_free_text "${fixed}")"
    fixes+=("wrap_free_text_to_structured")
  fi

  local before
  before="${fixed}"
  fixed="$(aegis_fit_fix_ghost_path_prose "${fixed}")"
  if [[ "${fixed}" != "${before}" ]]; then
    fixes+=("neutralize_package_js_prose")
  fi

  before="${fixed}"
  fixed="$(aegis_fit_fix_acceptance_tokens "${fixed}")"
  if [[ "${fixed}" != "${before}" ]]; then
    fixes+=("tokenize_acceptance")
  fi

  # --- rails / structure ---
  if ! aegis_fit_is_structured "${fixed}"; then
    blockers+=("demand_not_structured")
    score=$((score + 3))
  fi

  local targets_n=0
  local t
  while IFS= read -r t; do
    [[ -n "${t}" ]] || continue
    targets_n=$((targets_n + 1))
  done < <(aegis_fit_target_paths "${fixed}")

  if [[ "${targets_n}" -eq 0 ]]; then
    blockers+=("no_targets")
    score=$((score + 3))
  elif [[ "${targets_n}" -gt "${AEGIS_FIT_MAX_TARGETS}" ]]; then
    blockers+=("targets_count:${targets_n}>${AEGIS_FIT_MAX_TARGETS}")
    score=$((score + 3))
  fi

  local tasks_n
  tasks_n="$(aegis_fit_open_task_count "${fixed}")"
  tasks_n="${tasks_n//[^0-9]/}"
  tasks_n="${tasks_n:-0}"
  if [[ "${tasks_n}" -gt "${AEGIS_FIT_MAX_OPEN_TASKS}" ]]; then
    blockers+=("open_tasks:${tasks_n}>${AEGIS_FIT_MAX_OPEN_TASKS}")
    score=$((score + 2))
  fi

  local ghosts
  ghosts="$(aegis_fit_paths_outside_targets "${fixed}" | paste -sd, - || true)"
  if [[ -n "${ghosts}" ]]; then
    warnings+=("paths_outside_targets:${ghosts}")
    score=$((score + 1))
  fi

  # --- model risk heuristics ---
  local change body_len change_lines
  change="$(aegis_fit_md_section "Change" "${fixed}")"
  change_lines="$(printf '%s\n' "${change}" | grep -c '.' || true)"
  body_len="${#fixed}"

  if [[ "${body_len}" -gt "${AEGIS_FIT_MAX_BODY_CHARS}" ]]; then
    warnings+=("body_chars:${body_len}>${AEGIS_FIT_MAX_BODY_CHARS}")
    score=$((score + 2))
  fi
  if [[ "${change_lines}" -gt "${AEGIS_FIT_MAX_CHANGE_LINES}" ]]; then
    warnings+=("change_lines:${change_lines}>${AEGIS_FIT_MAX_CHANGE_LINES}")
    score=$((score + 2))
  fi

  local blob
  blob="$(printf '%s\n' "${fixed}" | tr '[:upper:]' '[:lower:]')"
  local complex=0
  printf '%s' "${blob}" | grep -q 'bigint' && complex=$((complex + 1))
  printf '%s' "${blob}" | grep -qE 'bitmask|statusmask|bit0' && complex=$((complex + 1))
  printf '%s' "${blob}" | grep -qE 'reexport|re-export' && complex=$((complex + 1))
  printf '%s' "${blob}" | grep -qE 'offline-first|high.precision|nanos' && complex=$((complex + 1))
  printf '%s' "${blob}" | grep -qE 'create .+\.ts|new file|new module' && complex=$((complex + 1))
  if [[ "${complex}" -ge 3 && "${targets_n}" -ge 1 ]]; then
    warnings+=("complex_feature_bundle:${complex}")
    score=$((score + 2))
  fi
  if [[ "${complex}" -ge 4 && "${targets_n}" -gt 1 ]]; then
    blockers+=("monster_multi_target_complex")
    score=$((score + 2))
  fi

  # Recipe presence reduces risk for single-file rewrites
  if printf '%s' "${change}" | grep -qE '^[0-9]+\.|^[[:space:]]*[0-9]+\)' ; then
    score=$((score - 1))
    warnings+=("recipe_steps_present")
  fi
  [[ "${score}" -lt 0 ]] && score=0
  [[ "${score}" -gt 10 ]] && score=10

  local model_fit="ok"
  if [[ "${score}" -ge "${AEGIS_FIT_POOR_SCORE}" ]]; then
    model_fit="poor"
  elif [[ "${score}" -ge "${AEGIS_FIT_MARGINAL_SCORE}" ]]; then
    model_fit="marginal"
  fi

  local rails_ok="true"
  if [[ "${#blockers[@]}" -gt 0 ]]; then
    rails_ok="false"
  fi

  local proposed
  proposed="$(aegis_fit_propose_units_json "${fixed}")"
  if ! printf '%s' "${proposed}" | jq -e 'type=="array"' >/dev/null 2>&1; then
    proposed='[]'
  fi

  # If multi-target or poor fit, force non-empty split proposal when possible
  if [[ "${targets_n}" -gt 1 ]] || [[ "${model_fit}" == "poor" ]]; then
    if [[ "$(printf '%s' "${proposed}" | jq 'length')" -eq 0 && "${targets_n}" -gt 0 ]]; then
      proposed="$(aegis_fit_propose_units_json "${fixed}")"
    fi
  fi

  local needs_operator="false"
  local run_allowed="true"
  if [[ "${rails_ok}" != "true" ]]; then
    run_allowed="false"
    needs_operator="true"
  fi
  if [[ "${model_fit}" == "poor" ]]; then
    run_allowed="false"
    needs_operator="true"
  fi
  if [[ "${model_fit}" == "marginal" ]]; then
    needs_operator="true"
  fi
  if [[ "$(printf '%s' "${proposed}" | jq 'length')" -gt 0 && "${run_allowed}" == "false" ]]; then
    needs_operator="true"
  fi

  # JSON emit
  jq -cn \
    --argjson rails_ok "$( [[ "${rails_ok}" == "true" ]] && echo true || echo false )" \
    --arg model_fit "${model_fit}" \
    --argjson score "${score}" \
    --argjson blockers "$(printf '%s\n' "${blockers[@]+"${blockers[@]}"}" | jq -R -s -c 'split("\n")|map(select(length>0))')" \
    --argjson warnings "$(printf '%s\n' "${warnings[@]+"${warnings[@]}"}" | jq -R -s -c 'split("\n")|map(select(length>0))')" \
    --argjson auto_fixes_applied "$(printf '%s\n' "${fixes[@]+"${fixes[@]}"}" | jq -R -s -c 'split("\n")|map(select(length>0))')" \
    --argjson needs_operator "$( [[ "${needs_operator}" == "true" ]] && echo true || echo false )" \
    --argjson run_allowed "$( [[ "${run_allowed}" == "true" ]] && echo true || echo false )" \
    --arg fixed_demand "${fixed}" \
    --arg original_demand "${original}" \
    --argjson proposed_units "${proposed}" \
    --argjson targets_count "${targets_n}" \
    --argjson open_tasks "${tasks_n}" \
    '{
      schema: "aegis.fit_check.v1",
      rails_ok: $rails_ok,
      model_fit: $model_fit,
      score: $score,
      targets_count: $targets_count,
      open_tasks: $open_tasks,
      blockers: $blockers,
      warnings: $warnings,
      auto_fixes_applied: $auto_fixes_applied,
      needs_operator: $needs_operator,
      run_allowed: $run_allowed,
      fixed_demand: $fixed_demand,
      original_demand: $original_demand,
      proposed_units: $proposed_units,
      how_adjust_works: {
        automatic: [
          "wrap free-text into Goal/Targets/Tasks/Change/Acceptance skeleton",
          "rewrite long Acceptance prose into short code tokens",
          "neutralize package.js prose that is not a real target"
        ],
        proposed_only: [
          "split multi-target demands into one unit per path",
          "split create+reexport bundles into sequential micros",
          "operator must OK each micro before RUN"
        ],
        never_automatic: [
          "algorithm correctness (e.g. clamp vs modulo)",
          "semantic product review",
          "model upgrade"
        ]
      }
    }'
}
