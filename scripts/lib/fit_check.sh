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

# Filter parent Change/Goal lines so unit demands keep algorithm intent
# without naming sibling target paths (scope_violation risk).
# Args: parent_text, primary_path
aegis_fit_unit_change_lines() {
  local parent="${1-}"
  local primary="${2-}"
  local parent_change parent_goal
  local line sibling skip n=0
  local -a other_paths=()

  parent_change="$(aegis_fit_md_section "Change" "${parent}")"
  parent_goal="$(aegis_fit_md_section "Goal" "${parent}")"
  while IFS= read -r sibling; do
    [[ -n "${sibling}" ]] || continue
    other_paths+=("${sibling}")
  done < <(aegis_fit_target_paths "${parent}" | awk -v p="${primary}" 'NF && $0 != p { print }')

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="$(printf '%s' "${line}" | sed -E 's/^[[:space:]]*-[[:space:]]*//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -n "${line}" ]] || continue
    skip=0
    for sibling in "${other_paths[@]+"${other_paths[@]}"}"; do
      if printf '%s' "${line}" | grep -Fq "${sibling}"; then
        skip=1
        break
      fi
    done
    [[ "${skip}" -eq 0 ]] || continue
    # Drop pure reexport lines when primary is not the barrel.
    if [[ "${primary}" != "src/index.ts" ]] \
      && printf '%s' "${line}" | grep -qiE 're-?export'; then
      continue
    fi
    printf -- '- %s\n' "$(printf '%s' "${line}" | cut -c1-200)"
    n=$((n + 1))
    [[ "${n}" -ge 6 ]] && break
  done < <(
    {
      printf '%s\n' "${parent_goal}"
      printf '%s\n' "${parent_change}"
    }
  )
}

# Build a runnable micro demand markdown for one unit.
# Args: parent_demand, title, note, targets_json_array
#
# Keep algorithm intent from parent Goal/Change, but never name sibling
# target paths (that caused scope_violation). Prefer one public export.
aegis_fit_unit_demand_md() {
  local parent="${1-}"
  local title="${2-}"
  local note="${3-}"
  local targets_json="${4:-[]}"
  local parent_goal
  local targets_block acc_block change_block primary primary_base primary_pascal
  local is_reexport=0

  targets_block="$(
    printf '%s' "${targets_json}" | jq -r '.[]? | "- \(.)"' 2>/dev/null || true
  )"
  [[ -n "${targets_block}" ]] || targets_block="- src/"

  primary="$(
    printf '%s' "${targets_json}" \
      | jq -r 'map(select(type=="string" and length>0))[0] // "src/index.ts"' 2>/dev/null \
      || printf 'src/index.ts'
  )"
  primary_base="$(printf '%s' "${primary}" | sed -E 's|.*/||; s/\.[^.]+$//')"
  # PascalCase form (tokenBucket → TokenBucket) for export-like acceptance.
  primary_pascal="$(
    printf '%s' "${primary_base}" \
      | awk '{ if (length($0)>0) print toupper(substr($0,1,1)) substr($0,2) }'
  )"

  parent_goal="$(aegis_fit_md_section "Goal" "${parent}" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  # Scrub sibling paths from parent goal so unit0 does not name index reexport.
  while IFS= read -r sibling; do
    [[ -n "${sibling}" ]] || continue
    parent_goal="$(printf '%s' "${parent_goal}" | sed -E "s|${sibling}||g")"
  done < <(aegis_fit_target_paths "${parent}" | awk -v p="${primary}" 'NF && $0 != p { print }')
  parent_goal="$(printf '%s' "${parent_goal}" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' | cut -c1-220)"
  [[ -n "${parent_goal}" ]] || parent_goal="${title}"

  # Title "reexport only" wins; note "omit reexport" must NOT flip create units.
  if printf '%s' "${title}" | grep -qiE '^reexport|^re-export' \
    || { [[ "${primary}" == "src/index.ts" ]] \
      && ! printf '%s' "${note}" | grep -qiE 'omit reexport|create module' \
      && printf '%s' "${parent}" | grep -qiE 'reexport|re-export'; }; then
    is_reexport=1
  fi

  if [[ "${is_reexport}" -eq 1 ]]; then
    change_block="$(
      cat <<EOR
- Update ONLY \`${primary}\`.
- Import and re-export the public API already created in the sibling module (NodeNext \`.js\` relative import).
- Do not re-implement the algorithm in this file.
- Do not create or modify any other path.
- Scope note: ${note:-reexport after create}
EOR
    )"
    # Do NOT use barrel basename "index" as acceptance — it never appears in
    # file body and false-fails adversarial (reexport is export { Sibling }).
    acc_block="$(
      {
        # Sibling module names (TokenBucket) are the real acceptance tokens.
        aegis_fit_target_paths "${parent}" \
          | awk -v p="${primary}" 'NF && $0 != p {
              n=$0; sub(/^.*\//,"",n); sub(/\.[^.]+$/,"",n); print n
              # PascalCase form
              if (length(n)>0) print toupper(substr(n,1,1)) substr(n,2)
            }' | head -n 4
        printf '%s\n' "TokenBucket"
      } | awk 'NF && !seen[$0]++ {
          low=tolower($0)
          if (low=="index" || low=="export" || low=="main" || low=="src") next
          print "- " $0
        }' | head -n 4
    )"
    [[ -n "$(printf '%s' "${acc_block}" | tr -d '[:space:]')" ]] \
      || acc_block="- reexport"
  else
    local detail
    detail="$(aegis_fit_unit_change_lines "${parent}" "${primary}")"
    if [[ -z "$(printf '%s' "${detail}" | tr -d '[:space:]')" ]]; then
      detail="$(
        cat <<EOD
- Implement the demanded API for \`${primary_base}\` in this file alone.
- Prefer one public named export (class or function); methods on that export are fine.
EOD
      )"
    fi
    change_block="$(
      cat <<EOC
- Create or update ONLY \`${primary}\`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Prefer **one** new top-level export (avoid parallel public APIs; methods on one export ok).
${detail}
- Scope note: ${note:-single-target micro unit}
EOC
    )"
    # Acceptance: module tokens + parent Acceptance idents only (no hardcoded
    # BigInt/encodeState — those false-positive as "export-like" when methods
    # or language globals are the real intent).
    acc_block="$(
      {
        printf '%s\n' "${primary_base}"
        printf '%s\n' "${primary_pascal}"
        aegis_fit_md_section "Acceptance" "${parent}" \
          | sed -E 's/^[[:space:]]*-[[:space:]]*//' \
          | command grep -oE '[A-Za-z_][A-Za-z0-9_]{2,}' 2>/dev/null || true
      } | awk 'NF && !seen[$0]++ {
          low=tolower($0)
          if (low=="export" || low=="import" || low=="class" || low=="function") next
          print "- " $0
        }' | head -n 6
    )"
  fi
  [[ -n "${acc_block}" ]] || acc_block="- done"

  cat <<EOF
## Goal
Single-file micro: ${title}.
Edit only \`${primary}\`. Parent intent: ${parent_goal}

## Targets
${targets_block}

## Tasks
- [ ] Task 1 — ${title}

## Change
${change_block}

## Acceptance
${acc_block}

## Out of scope
- other source files
- network
- UI
- e2e
- multi-file stacks

## Constraints
- no any
- KISS
- single target micro unit only
- one primary public export preferred (methods allowed)
- NodeNext .js imports if this file imports siblings
- BigInt is global when high-precision time is required
EOF
}

# Enrich proposed_units[] with full .demand markdown for each unit.
aegis_fit_enrich_units_with_demand() {
  local parent="${1-}"
  local units_json="${2:-[]}"
  local n i title note targets_json demand
  n="$(printf '%s' "${units_json}" | jq 'length' 2>/dev/null || echo 0)"
  [[ "${n}" =~ ^[0-9]+$ ]] || { printf '%s' '[]'; return 0; }
  [[ "${n}" -gt 0 ]] || { printf '%s' '[]'; return 0; }

  local acc='[]'
  for ((i = 0; i < n; i++)); do
    title="$(printf '%s' "${units_json}" | jq -r --argjson i "${i}" '.[$i].title // "unit"')"
    note="$(printf '%s' "${units_json}" | jq -r --argjson i "${i}" '.[$i].note // ""')"
    targets_json="$(printf '%s' "${units_json}" | jq -c --argjson i "${i}" '.[$i].targets // []')"
    demand="$(aegis_fit_unit_demand_md "${parent}" "${title}" "${note}" "${targets_json}")"
    acc="$(
      jq -cn \
        --argjson acc "${acc}" \
        --argjson i "${i}" \
        --argjson unit "$(printf '%s' "${units_json}" | jq -c --argjson i "${i}" '.[$i]')" \
        --arg demand "${demand}" \
        '$acc + [($unit + {index:$i, demand:$demand})]'
    )"
  done
  printf '%s' "${acc}"
}

# Write fit.json + unit-N.md under dir. Args: fit_json, out_dir
aegis_fit_emit_micros() {
  local fit_json="${1-}"
  local out_dir="${2-}"
  local n i demand path
  [[ -n "${out_dir}" ]] || return 1
  mkdir -p "${out_dir}"

  # Ensure units carry demand bodies
  local units parent
  parent="$(printf '%s' "${fit_json}" | jq -r '.fixed_demand // .original_demand // empty')"
  units="$(printf '%s' "${fit_json}" | jq -c '.proposed_units // []')"
  if [[ "$(printf '%s' "${units}" | jq 'map(has("demand")) | all' 2>/dev/null)" != "true" ]]; then
    units="$(aegis_fit_enrich_units_with_demand "${parent}" "${units}")"
    fit_json="$(
      jq -cn --argjson fit "${fit_json}" --argjson units "${units}" \
        '$fit + {proposed_units: $units}'
    )"
  fi

  n="$(printf '%s' "${fit_json}" | jq '.proposed_units | length')"
  if [[ "${n}" -eq 0 ]]; then
    # No split needed — still emit unit-0 from fixed_demand for --from-fit UX.
    demand="$(printf '%s' "${fit_json}" | jq -r '.fixed_demand // empty')"
    fit_json="$(
      jq -cn --argjson fit "${fit_json}" --arg demand "${demand}" '
        $fit + {
          proposed_units: [{
            index: 0,
            title: "fixed_demand",
            targets: [],
            note: "no split required",
            demand: $demand
          }]
        }
      '
    )"
    n=1
  fi

  printf '%s\n' "${fit_json}" > "${out_dir}/fit.json"
  for ((i = 0; i < n; i++)); do
    demand="$(printf '%s' "${fit_json}" | jq -r --argjson i "${i}" '.proposed_units[$i].demand // empty')"
    path="${out_dir}/unit-${i}.md"
    printf '%s\n' "${demand}" > "${path}"
  done
  printf '%s' "${fit_json}"
}

aegis_fit_propose_units_json() {
  local text="${1-}"
  local paths
  paths="$(aegis_fit_target_paths "${text}")"
  local -a arr=()
  while IFS= read -r p; do
    [[ -n "${p}" ]] || continue
    arr+=("${p}")
  done <<< "${paths}"

  local units='[]'
  local blob change_l goal_l
  change_l="$(aegis_fit_md_section "Change" "${text}" | tr '[:upper:]' '[:lower:]')"
  goal_l="$(aegis_fit_md_section "Goal" "${text}" | tr '[:upper:]' '[:lower:]')"
  blob="$(printf '%s\n' "${change_l}${goal_l}")"
  # Positive reexport ask (Change/Goal). Negations in Change force off for single-file micros.
  local wants_reexport=0
  if printf '%s' "${blob}" | grep -qE 'reexport from|re-export from|reexport public|and reexport|and re-export|,\s*reexport|reexport public api'; then
    wants_reexport=1
  elif printf '%s' "${blob}" | grep -qE '(^|[^a-z-])(reexport|re-export)([^a-z]|$)' \
    && ! printf '%s' "${blob}" | grep -qE 'do not re-?export|omit reexport|without reexport|no reexport'; then
    wants_reexport=1
  fi
  # Multi-target with index present still treats barrel as reexport stage when word appears.
  if [[ "${#arr[@]}" -gt 1 ]] \
    && printf '%s\n' "${arr[@]}" | grep -qx 'src/index.ts' \
    && printf '%s' "${blob}" | grep -qE 'reexport|re-export'; then
    wants_reexport=1
  fi

  if [[ "${#arr[@]}" -le 1 ]]; then
    # Single-path micros that already say "do not re-export" must not re-split.
    if printf '%s' "${change_l}" | grep -qE 'do not re-?export|omit reexport|without reexport'; then
      printf '[]'
      return 0
    fi
    # Single path: still may split create vs reexport heuristics from Change text
    if [[ "${wants_reexport}" -eq 1 ]] \
      && printf '%s' "${blob}" | grep -qE 'create|new file|tokenbucket|module'; then
      local mod="${arr[0]:-src/}"
      # If the only target is already index, create still uses that path then reexport is same — skip split.
      if [[ "${mod}" == "src/index.ts" ]]; then
        printf '[]'
        return 0
      fi
      units="$(
        jq -cn \
          --arg t "${mod}" \
          '[
            {title:"create module only", targets:[$t], note:"omit reexport"},
            {title:"reexport only", targets:["src/index.ts"], note:"after create succeeds"}
          ]'
      )"
    else
      printf '[]'
      return 0
    fi
  else
    # One unit per target path. Order: create modules first, barrel reexport last.
    # Alphabetical path extract often yields src/index.ts before modules — wrong for RUN order.
    units="$(
      jq -cn \
        --arg paths "$(printf '%s\n' "${arr[@]}")" \
        --argjson rx "${wants_reexport}" \
        '
        ($paths | split("\n") | map(select(length>0))) as $raw
        | ($raw | map(select(. != "src/index.ts"))) as $mods
        | ($raw | map(select(. == "src/index.ts"))) as $idx
        | ($mods + $idx) as $p
        | [
            $p[]
            | . as $t
            | if ($t == "src/index.ts" and $rx == 1) then
                {title: "reexport only", targets: [$t], note: "after create succeeds"}
              elif ($t == "src/index.ts") then
                {title: ("mutate " + $t), targets: [$t], note: "single-target micro unit"}
              else
                {title: ("create " + $t), targets: [$t], note: "create module only; omit reexport"}
              end
          ]
        '
    )"
  fi

  aegis_fit_enrich_units_with_demand "${text}" "${units}"
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
