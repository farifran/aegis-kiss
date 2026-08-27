#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — MECHANICAL TRIBUNAL SCANS & GATES
# =========================================================
#
# Helper library for Steps 4, 5 & 6 (Optimize, Adversarial, Validation):
#   - Optimize mechanical scans (complexity O(1), fidelity)
#   - Adversarial diff scans & fuzzing gates
#   - Candidate tools stamping & behavior validation
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] mechanical_scans_lib_not_invocable" >&2
  exit 1
fi

aegis_emit_mechanical_optimize_passthrough() {
  local basis="${1:-optimize_passthrough_after_refine}"
  local body
  body="$(
    jq -nc --arg basis "${basis}" '{
      status: "no_improvement_needed",
      basis: $basis,
      improvements: []
    }'
  )" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Append kind:"optimize" metric line (shared metrics file).
# result: trivial_skip | passthrough_after_refine | no_improvement_needed | can_improve

aegis_record_optimize_metric() {
  local result="${1-}"
  local detail="${2-}"
  [[ -n "${result}" ]] || return 0
  [[ -n "${AEGIS_METRICS_FILE:-}" ]] || return 0
  jq -cn \
    --arg kind "optimize" \
    --arg result "${result}" \
    --arg detail "${detail}" \
    --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{kind:$kind,result:$result,detail:$detail,at:$at}' \
    >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

# =========================================================
# CANDIDATE TOOLS STAMP (build → adversarial reuse)
# =========================================================
# After a green mutation preflight, stamp tsc/test/(eslint) keyed by
# candidate diff hash. Adversarial reuses when the candidate diff is
# unchanged (no pointless re-run). If optimize refined the patch, hash
# differs → tools re-run.


aegis_candidate_tools_stamp_dir() {
  printf '%s' "${AEGIS_CANDIDATE_TOOLS_STAMP_DIR:-.harness/runtime/candidate_tools_stamp}"
}

# Drop stamp after a finished run (not between modes of a pipeline driver).
# Safe: only removes a path that contains candidate_tools_stamp and no "..".

aegis_remove_candidate_tools_stamp() {
  local stamp_dir
  stamp_dir="$(aegis_candidate_tools_stamp_dir)"
  [[ -n "${stamp_dir}" ]] || return 0
  case "${stamp_dir}" in
    *..*) return 0 ;;
  esac
  case "${stamp_dir}" in
    *candidate_tools_stamp*) ;;
    *) return 0 ;;
  esac
  [[ -e "${stamp_dir}" ]] || return 0
  rm -rf "${stamp_dir}" 2>/dev/null || true
}


aegis_hash_candidate_diff() {
  local diff_content="${1-}"
  local h
  h="$(
    printf '%s' "${diff_content}" \
      | shasum -a 256 2>/dev/null \
      | awk '{print $1}'
  )"
  if [[ -z "${h}" ]]; then
    h="$(printf '%s' "${diff_content}" | cksum | awk '{print $1}')"
  fi
  printf '%s' "${h}"
}

# Stamp tool payloads from one or more payload dirs for this candidate hash.
# Args: <diff_content> <source_mode> [payload_dir ...]

aegis_stamp_candidate_tools() {
  local diff_content="${1-}"
  local source_mode="${2:-build}"
  shift 2 || true
  local -a dirs=("$@")
  [[ -n "${diff_content}" ]] || return 0
  [[ "${#dirs[@]}" -gt 0 ]] || return 0

  local stamp_dir hash meta
  hash="$(aegis_hash_candidate_diff "${diff_content}")"
  [[ -n "${hash}" ]] || return 0
  stamp_dir="$(aegis_candidate_tools_stamp_dir)"
  mkdir -p "${stamp_dir}" 2>/dev/null || return 0

  local name src dest d
  for name in typescript_check.json test_run.json eslint_check.json smoke_import.json; do
    dest="${stamp_dir}/${name}"
    rm -f "${dest}" 2>/dev/null || true
    for d in "${dirs[@]}"; do
      [[ -n "${d}" && -d "${d}" ]] || continue
      src="${d}/${name}"
      if [[ -f "${src}" ]] && jq empty "${src}" >/dev/null 2>&1; then
        cp "${src}" "${dest}" 2>/dev/null || true
        break
      fi
    done
  done

  meta="${stamp_dir}/meta.json"
  jq -n \
    --arg hash "${hash}" \
    --arg source_mode "${source_mode}" \
    --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{candidate_hash:$hash,source_mode:$source_mode,at:$at}' \
    > "${meta}" 2>/dev/null || true

  if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
    jq -cn \
      --arg kind "candidate_tools_stamp" \
      --arg hash "${hash}" \
      --arg source_mode "${source_mode}" \
      '{kind:$kind,candidate_hash:$hash,source_mode:$source_mode}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  fi
  return 0
}

# If stamp matches want_hash, copy capability payload into dest_path. Exit 0 on reuse.
# Args: <capability> <dest_payload_path> <want_hash>

aegis_try_reuse_stamped_tool_payload() {
  local capability="${1-}"
  local dest_path="${2-}"
  local want_hash="${3-}"
  [[ -n "${capability}" && -n "${dest_path}" && -n "${want_hash}" ]] || return 1

  local stamp_dir meta stamped_hash name src
  stamp_dir="$(aegis_candidate_tools_stamp_dir)"
  meta="${stamp_dir}/meta.json"
  [[ -f "${meta}" ]] || return 1
  stamped_hash="$(jq -r '.candidate_hash // empty' "${meta}" 2>/dev/null || true)"
  [[ -n "${stamped_hash}" && "${stamped_hash}" == "${want_hash}" ]] || return 1

  case "${capability}" in
    typescript.check) name="typescript_check.json" ;;
    eslint.check) name="eslint_check.json" ;;
    test.run) name="test_run.json" ;;
    *) return 1 ;;
  esac
  src="${stamp_dir}/${name}"
  [[ -f "${src}" ]] || return 1
  jq empty "${src}" >/dev/null 2>&1 || return 1

  if jq \
    --arg execution_id "${AEGIS_EXECUTION_ID:-stamp-reuse}" \
    --arg generated_at "${AEGIS_EXECUTION_TIMESTAMP:-}" \
    '.execution_id = $execution_id | .generated_at = $generated_at' \
    "${src}" > "${dest_path}" 2>/dev/null; then
    aegis_log "candidate_tools_reuse: ${capability} (hash=${want_hash:0:12}…)"
    if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
      jq -cn \
        --arg kind "candidate_tools_reuse" \
        --arg capability "${capability}" \
        --arg hash "${want_hash}" \
        '{kind:$kind,capability:$capability,candidate_hash:$hash}' \
        >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
    fi
    return 0
  fi
  rm -f "${dest_path}" 2>/dev/null || true
  return 1
}

# Candidate hash from handover (build op_ctx or optimize candidate_result).

aegis_handover_candidate_diff_hash() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 1
  local diff_body
  diff_body="$(
    jq -r '
      .artifact_snapshot as $s
      | if $s.mode == "optimize" then
          $s.operational_context.candidate_result.diff // empty
        elif $s.mode == "build" then
          $s.operational_context.diff // empty
        else
          $s.operational_context.candidate_result.diff
            // $s.operational_context.diff // empty
        end
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${diff_body}" && "${diff_body}" != "(no changes)" ]] || return 1
  aegis_hash_candidate_diff "${diff_body}"
}

# Compact candidate for adversarial prompt (diff + files).

aegis_format_adversarial_tools_summary_section() {
  local payload_dir="${1:-${AEGIS_CAPABILITY_PAYLOAD_DIR:-}}"
  local handover="${2-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${payload_dir}" && -d "${payload_dir}" ]] || return 0

  local files_json
  files_json="$(aegis_handover_candidate_files_changed_json "${handover}")"

  if ! declare -f build_tribunal_tools_gate >/dev/null 2>&1; then
    return 0
  fi
  local gate
  # build_tribunal_tools_gate reads AEGIS_CAPABILITY_PAYLOAD_DIR
  local _saved="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"
  export AEGIS_CAPABILITY_PAYLOAD_DIR="${payload_dir}"
  gate="$(build_tribunal_tools_gate "${files_json}")" || gate="{}"
  export AEGIS_CAPABILITY_PAYLOAD_DIR="${_saved}"

  local reuse_note=""
  local stamp_dir meta shash want
  stamp_dir="$(aegis_candidate_tools_stamp_dir)"
  meta="${stamp_dir}/meta.json"
  if [[ -f "${meta}" ]]; then
    shash="$(jq -r '.candidate_hash // empty' "${meta}" 2>/dev/null || true)"
    want="$(aegis_handover_candidate_diff_hash "${handover}" 2>/dev/null || true)"
    if [[ -n "${shash}" && -n "${want}" && "${shash}" == "${want}" ]]; then
      reuse_note="tools_source: reused_from_build_stamp (candidate hash match)"
    else
      reuse_note="tools_source: fresh_run (candidate changed or no stamp)"
    fi
  else
    reuse_note="tools_source: fresh_run (no stamp)"
  fi

  {
    echo "=== TOOLS SUMMARY (mutation-scoped) ==="
    echo
    echo "${reuse_note}"
    printf '%s\n' "${gate}" | jq -r '
      "mutation_clean: \(.mutation_clean // true)",
      "typescript: \(.typescript_status // "skipped") (in_scope_errors=\((.typescript_errors_in_scope // [])|length))",
      "eslint: \(.eslint_status // "skipped") (in_scope_errors=\((.eslint_errors_in_scope // [])|length))",
      "test: \(.test_status // "skipped")",
      (
        (.typescript_errors_in_scope // [])[0:5]
        | map("- ts \(.file // "?"):\(.line // "?"): \(.message // .)")
        | .[]?
      ),
      (
        (.eslint_errors_in_scope // [])[0:5]
        | map("- eslint \(.file // "?"):\(.line // "?"): \(.message // .)")
        | .[]?
      )
    ' 2>/dev/null || echo "(tools summary unavailable)"
    echo
  }
}

# Mechanical adversarial when tools already prove mutation unclean: skip LLM only.
# Findings are built solely by AEGIS_JQ_ENRICH_ADVERSARIAL from tools_gate (no dual map).
# Args: tools_gate_json (must be object; caller gates on mutation_clean=false)

aegis_emit_mechanical_adversarial_from_tools_gate() {
  local gate_json="${1-}"
  if ! printf '%s' "${gate_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    return 1
  fi
  aegis_emit_framed_json_artifact '{"status":"challenged","findings":[]}'
}

# Mechanical validation: tribunal (enrich) owns the real verdict.
# Model path is opt-in via AEGIS_VALIDATION_LLM=1. Placeholder fields are
# overwritten by AEGIS_JQ_ENRICH_VALIDATION (candidate, findings, verdict).

aegis_emit_mechanical_validation_substrate() {
  local behavior_findings
  behavior_findings="$(aegis_mechanical_behavior_gate)" || true
  if [[ -n "${behavior_findings}" ]]; then
    aegis_emit_framed_json_artifact \
      "{\"verdict\":\"rejected\",\"basis\":[],\"findings\":${behavior_findings}}"
    return 0
  fi
  aegis_emit_framed_json_artifact \
    '{"verdict":"accepted","basis":[],"findings":[]}'
}

# P2 executable behavioral oracle. Parses the demand's ## Behavior section,
# scopes each assert to the unit's ## Acceptance exports, compiles a temporary
# Node test importing the unit's first ## Target, and executes the asserts.
# Prints a JSON findings array (empty when every in-scope assert passes).
# Returns 0 always — the validation substrate converts non-empty findings
# into a rejected verdict that feeds build_feedback.

aegis_mechanical_behavior_gate() {
  local demand="${AEGIS_INVESTIGATION_INPUT:-}"
  local behavior acceptance targets target
  behavior="$(aegis_demand_md_section "Behavior" "${demand}")"
  [[ -n "$(printf '%s' "${behavior}" | tr -d '[:space:]')" ]] || return 0

  acceptance="$(aegis_demand_md_section "Acceptance" "${demand}")"
  targets="$(aegis_demand_md_section "Targets" "${demand}")"
  target="$(
    printf '%s\n' "${targets}" \
      | command grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx|mts|mjs)' 2>/dev/null \
      | command sed 's|^\./||' \
      | awk '!seen[$0]++' | head -1 || true
  )"
  [[ -n "${target}" ]] || return 0

  command -v node >/dev/null 2>&1 || return 0
  node --experimental-strip-types -e '1' >/dev/null 2>&1 || return 0
  local root="${AEGIS_ROOT_DIR:-.}"
  local test_root="${root}"
  local tmp_workdir=""
  local handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  if [[ -f "${handover}" ]] && declare -f aegis_handover_candidate_diff_hash >/dev/null 2>&1; then
    local cand_diff
    cand_diff="$(jq -r '.artifact_snapshot.operational_context.candidate_result.diff // .artifact_snapshot.operational_context.diff // empty' "${handover}" 2>/dev/null || true)"
    if [[ -n "${cand_diff}" && "${cand_diff}" != "(no changes)" ]]; then
      tmp_workdir="$(mktemp -d "${TMPDIR:-/tmp}/aegis_behave.XXXXXX" 2>/dev/null || true)"
      if [[ -d "${tmp_workdir}" ]]; then
        cp -r "${root%/}/src" "${tmp_workdir}/" 2>/dev/null || true
        find "${tmp_workdir}" -type f -size 0 -delete 2>/dev/null || true
        cp "${root%/}/tsconfig.json" "${tmp_workdir}/" 2>/dev/null || true
        cp "${root%/}/package.json" "${tmp_workdir}/" 2>/dev/null || true
        if [[ -d "${root%/}/node_modules" ]]; then
          ln -s "${root%/}/node_modules" "${tmp_workdir}/node_modules" 2>/dev/null || true
        fi
        printf '%s\n' "${cand_diff}" | patch -p1 -d "${tmp_workdir}" >/dev/null 2>&1 || true
        test_root="${tmp_workdir}"
      fi
    fi
  fi

  if [[ ! -f "${test_root%/}/${target}" ]]; then
    [[ -n "${tmp_workdir}" && -d "${tmp_workdir}" ]] && rm -rf "${tmp_workdir}"
    return 0
  fi

  # Ensure Node can resolve ESM relative imports with .js extension to .ts files.
  local _ts _js
  while IFS= read -r _ts; do
    [[ -n "${_ts}" ]] || continue
    _js="${_ts%.ts}.js"
    if [[ ! -e "${_js}" ]]; then
      ln -s "$(basename "${_ts}")" "${_js}" 2>/dev/null || true
    fi
  done < <(
    find "${test_root}" \( -name '*.ts' -o -name '*.tsx' \) \
      ! -path '*/node_modules/*' 2>/dev/null || true
  )

  local acc_names
  acc_names="$(
    printf '%s\n' "${acceptance}" \
      | sed -E 's/^[[:space:]]*-[[:space:]]*//' \
      | command grep -oE '[A-Za-z_][A-Za-z0-9_]*' 2>/dev/null \
      | awk 'NF && !seen[$0]++' || true
  )"
  local acc_csv
  acc_csv="$(printf '%s,' ${acc_names} | sed 's/,$//')"
  if [[ -z "${acc_csv}" ]]; then
    [[ -n "${tmp_workdir}" && -d "${tmp_workdir}" ]] && rm -rf "${tmp_workdir}"
    return 0
  fi

  # Parse ## Behavior items into parallel arrays.
  local -a b_desc=() b_pre=() b_assert=() b_exp=()
  local cur_desc="" cur_pre="" cur_assert="" cur_exp="" in_item=0
  local line
  while IFS= read -r line; do
    case "${line}" in
      "- "*) 
        if [[ "${in_item}" -eq 1 ]]; then
          b_desc+=("${cur_desc}"); b_pre+=("${cur_pre}")
          b_assert+=("${cur_assert}"); b_exp+=("${cur_exp}")
        fi
        cur_desc="${line#- }"; cur_pre=""; cur_assert=""; cur_exp=""; in_item=1
        ;;
      "   exports: "*) cur_exp="${line#   exports: }" ;;
      "   prelude: "*) cur_pre+="${line#   prelude: }"$'\n' ;;
      "   assert: "*)  cur_assert="${line#   assert: }" ;;
    esac
  done < <(printf '%s\n' "${behavior}")
  if [[ "${in_item}" -eq 1 ]]; then
    b_desc+=("${cur_desc}"); b_pre+=("${cur_pre}")
    b_assert+=("${cur_assert}") b_exp+=("${cur_exp}")
  fi

  # Scope + import union. Item scope = the unit accepts the FIRST listed export
  # (the export under test); the remaining names are dependencies the
  # prelude/assert uses and are added to the import list. export_slice units
  # therefore enforce only their own export while still importing siblings.
  local findings=() i=0 n=${#b_desc[@]}
  local -a import_union=() in_scope_item=()
  local exp_name primary first
  for ((i=0; i<n; i++)); do
    primary=""
    if [[ -n "${b_exp[$i]}" ]]; then
      first=1
      while IFS= read -r exp_name; do
        [[ -n "${exp_name}" ]] || continue
        if [[ "${first}" -eq 1 ]]; then
          primary="${exp_name}"; first=0
        fi
        if ! printf '%s\n' "${import_union[@]}" | grep -Fqx -- "${exp_name}" \
          || [[ "${#import_union[@]}" -eq 0 ]]; then
          import_union+=("${exp_name}")
        fi
      done < <(printf '%s\n' "${b_exp[$i]}" | tr ',' '\n' | sed -E 's/^[[:space:]]*|[[:space:]]*$//g')
    fi
    in_scope_item[$i]=0
    if [[ -n "${primary}" ]] && printf '%s\n' "${acc_names}" | grep -Fqx -- "${primary}"; then
      in_scope_item[$i]=1
    fi
  done
  for ((i=0; i<n; i++)); do
    [[ -z "${b_exp[$i]}" ]] && in_scope_item[$i]=1
  done
  for exp_name in ${acc_names}; do
    if ! printf '%s\n' "${import_union[@]}" | grep -Fqx -- "${exp_name}" \
      || [[ "${#import_union[@]}" -eq 0 ]]; then
      import_union+=("${exp_name}")
    fi
  done
  
  for ((i=0; i<n; i++)); do
    [[ "${in_scope_item[$i]}" -eq 1 ]] || continue
    local item_csv=""
    if [[ -n "${b_exp[$i]}" ]]; then
      local -a item_exp_arr=()
      while IFS= read -r exp_name; do
        [[ -n "${exp_name}" ]] || continue
        if ! printf '%s\n' "${item_exp_arr[@]}" | grep -Fqx -- "${exp_name}" \
          || [[ "${#item_exp_arr[@]}" -eq 0 ]]; then
          item_exp_arr+=("${exp_name}")
        fi
      done < <(printf '%s\n' "${b_exp[$i]}" | tr ',' '\n' | sed -E 's/^[[:space:]]*|[[:space:]]*$//g')
      item_csv="$(printf '%s,' "${item_exp_arr[@]}" | sed 's/,$//')"
    fi
    [[ -n "${item_csv}" ]] || item_csv="${acc_csv}"
    [[ -n "${item_csv}" ]] || continue

    local tmp
    tmp="$(mktemp "${test_root%/}/.aegis_behavior_XXXXXX" 2>/dev/null || true)"
    [[ -n "${tmp}" ]] || continue
    mv "${tmp}" "${tmp}.mts"
    tmp="${tmp}.mts"
    {
      printf 'import { %s } from "./%s";\n' "${item_csv}" "${target}"
      printf 'function __aegis_behave(c: unknown, d: string): void {\n'
      printf '  if (!c) { throw new Error("BEHAVIOR_FAIL: " + d) }\n'
      printf '}\n'
      [[ -n "${b_pre[$i]}" ]] && printf '%s\n' "${b_pre[$i]}"
      printf '__aegis_behave(%s, %s);\n' \
        "${b_assert[$i]}" \
        "$(printf '%s' "${b_desc[$i]}" | jq -Rsa . 2>/dev/null || printf '%s' "\"behavior assert $((i + 1))\"")"
    } > "${tmp}"
    if [[ "${AEGIS_BEHAVIOR_DEBUG:-0}" == "1" ]]; then
      printf 'behavior_gate: unit=%s item=%s import=%s\n' "${target}" "${i}" "${item_csv}" >&2
      cat "${tmp}" >&2
    fi

    local out rc=0
    out="$(cd "${test_root}" && node --experimental-strip-types "${tmp}" 2>&1)" || rc=$?
    rm -f "${tmp}"
    if [[ "${rc}" -ne 0 ]]; then
      local fail_desc
      fail_desc="$(
        printf '%s\n' "${out}" \
          | command grep -m1 'BEHAVIOR_FAIL' \
          | sed -E 's/.*BEHAVIOR_FAIL: //' || true
      )"
      [[ -n "${fail_desc}" ]] || fail_desc="${b_desc[$i]}"
      findings+=(
        "$(jq -cn \
          --arg sev "high" \
          --arg type "behavior_failure" \
          --arg desc "behavior: ${fail_desc} (assert: ${b_assert[$i]})" \
          --arg fix "implement the behavior: ${fail_desc}" \
          --arg tf "${target}" \
          '{severity:$sev,type:$type,supported_by_evidence:true,description:$desc,fix:$fix,target_files:[$tf],evidence_refs:["validation.behavior"]}')"
      )
    fi
  done

  [[ -n "${tmp_workdir}" && -d "${tmp_workdir}" ]] && rm -rf "${tmp_workdir}"

  if [[ "${#findings[@]}" -gt 0 ]]; then
    if declare -f aegis_record_validation_metric >/dev/null 2>&1; then
      aegis_record_validation_metric "behavior_gate" "${#findings[@]} failures"
    fi
    printf '%s\n' "${findings[@]}" | jq -s .
  fi
  return 0
}

# Append kind:"validation" metric line.
# result: mechanical | llm | accepted | rejected | …

aegis_record_validation_metric() {
  local result="${1-}"
  local detail="${2-}"
  [[ -n "${result}" ]] || return 0
  [[ -n "${AEGIS_METRICS_FILE:-}" ]] || return 0
  jq -cn \
    --arg kind "validation" \
    --arg result "${result}" \
    --arg detail "${detail}" \
    --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{kind:$kind,result:$result,detail:$detail,at:$at}' \
    >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

# New export names from unified-diff +lines (function/const only).
# Prints one name per line (may be empty).

aegis_optimize_mutation_is_trivial() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 1

  : "${AEGIS_OPTIMIZE_TRIVIAL_MAX_FILES:=1}"
  : "${AEGIS_OPTIMIZE_TRIVIAL_MAX_LINES:=60}"

  local n_files n_lines has_any diff_content
  n_files="$(
    printf '%s' "$(aegis_handover_mutation_files_json "${handover}")" \
      | jq -r 'length' 2>/dev/null || printf '0'
  )"
  [[ "${n_files}" -ge 1 ]] || return 1
  [[ "${n_files}" -le "${AEGIS_OPTIMIZE_TRIVIAL_MAX_FILES}" ]] || return 1

  diff_content="$(aegis_handover_mutation_diff "${handover}" 2>/dev/null || true)"
  [[ -n "${diff_content}" && "${diff_content}" != "(no changes)" ]] || return 1

  n_lines="$(printf '%s\n' "${diff_content}" | wc -l | tr -d ' ')"
  [[ -n "${n_lines}" && "${n_lines}" -ge 1 ]] || return 1
  [[ "${n_lines}" -le "${AEGIS_OPTIMIZE_TRIVIAL_MAX_LINES}" ]] || return 1

  # Non-trivial if added lines introduce explicit any / as any.
  has_any="$(
    aegis_diff_added_lines "${diff_content}" \
      | grep -Eiq '(:[[:space:]]*any\b|as[[:space:]]+any\b|@ts-ignore|@ts-expect-error)' \
      && printf '1' || printf '0'
  )"
  [[ "${has_any}" == "0" ]] || return 1
  return 0
}

# Senior-equivalent greps on Build delta: at most one mechanical improve.
# Prints JSON {target_files,change,why_safe,code} or empty string.

aegis_mechanical_optimize_scan() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local diff_content files_json primary added
  diff_content="$(aegis_handover_mutation_diff "${handover}" 2>/dev/null || true)"
  files_json="$(aegis_handover_mutation_files_json "${handover}")"
  [[ -n "${diff_content}" && "${diff_content}" != "(no changes)" ]] || return 0

  primary="$(
    printf '%s' "${files_json}" \
      | jq -r 'map(select(type=="string" and length>0))[0] // empty' 2>/dev/null || true
  )"
  [[ -n "${primary}" ]] || return 0

  added="$(aegis_diff_added_lines "${diff_content}")"
  [[ -n "${added}" ]] || return 0

  # 1) Explicit any / suppressions in new lines (types hygiene).
  if printf '%s\n' "${added}" \
    | grep -Eiq '(:[[:space:]]*any\b|as[[:space:]]+any\b|@ts-ignore|@ts-expect-error)'; then
    jq -nc --arg f "${primary}" '{
      target_files: [$f],
      change: (
        "In " + $f
        + ", remove explicit any / as any / @ts-ignore / @ts-expect-error introduced in the Build diff; use concrete types or proper narrowing."
      ),
      why_safe: "Types-only edit; preserves runtime behavior when any was already type-erased.",
      code: "any_in_added_lines"
    }'
    return 0
  fi

  # 2) Stub / unfinished markers left in the delivery.
  if printf '%s\n' "${added}" \
    | grep -Eiq \
      '(TODO|FIXME|XXX|not[[:space:]]+implemented|throw[[:space:]]+new[[:space:]]+Error\([[:space:]]*["'\'']not implemented)'; then
    jq -nc --arg f "${primary}" '{
      target_files: [$f],
      change: (
        "In " + $f
        + ", replace TODO/FIXME/not-implemented stubs introduced in the Build diff with the real demanded implementation (or remove dead stub paths)."
      ),
      why_safe: "Removes incomplete delivery; does not expand scope beyond files_changed.",
      code: "stub_in_added_lines"
    }'
    return 0
  fi

  # 3) Public surface bloat when demand limits exports (frontier often ships fat-correct).
  local inv root corpus_full
  inv="${AEGIS_INVESTIGATION_INPUT:-}"
  root="."
  if [[ -n "${AEGIS_EXECUTION_SURFACE:-}" && -d "${AEGIS_EXECUTION_SURFACE}" ]]; then
    root="${AEGIS_EXECUTION_SURFACE}"
  elif [[ -n "${AEGIS_EXECUTION_TARGET_PATH:-}" && -d "${AEGIS_EXECUTION_TARGET_PATH}" ]]; then
    root="${AEGIS_EXECUTION_TARGET_PATH}"
  fi
  corpus_full="$(aegis_candidate_files_corpus "${files_json}" "${diff_content}" "${root}")"
  if [[ -n "${inv}" ]] && declare -f aegis_mechanical_surface_first_improve >/dev/null 2>&1; then
    local _surf_imp
    _surf_imp="$(
      aegis_mechanical_surface_first_improve "${inv}" "${corpus_full}" "${files_json}" "${diff_content}"
    )" || _surf_imp=""
    if [[ -n "${_surf_imp}" ]] \
      && printf '%s' "${_surf_imp}" | jq -e 'type == "object" and (.change|type=="string")' >/dev/null 2>&1; then
      printf '%s\n' "${_surf_imp}"
      return 0
    fi
  fi

  # 4) Demand fidelity witnesses (Change/ALVO cues → body must show them).
  # Prefer corpus (final files), not only +lines — seed holes may pre-exist.
  if [[ -n "${inv}" ]] && declare -f aegis_mechanical_fidelity_first_improve >/dev/null 2>&1; then
    local _fid_imp
    _fid_imp="$(
      aegis_mechanical_fidelity_first_improve "${inv}" "${corpus_full}" "${files_json}"
    )" || _fid_imp=""
    if [[ -n "${_fid_imp}" ]] \
      && printf '%s' "${_fid_imp}" | jq -e 'type == "object" and (.change|type=="string")' >/dev/null 2>&1; then
      printf '%s\n' "${_fid_imp}"
      return 0
    fi
  fi

  return 0
}

# Emit optimize can_improve from one mechanical improvement object.

aegis_emit_mechanical_optimize_can_improve() {
  local improvement_json="${1-}"
  local code
  code="$(printf '%s' "${improvement_json}" | jq -r '.code // "mechanical"' 2>/dev/null || printf 'mechanical')"
  local body
  body="$(
    jq -nc \
      --argjson imp "${improvement_json}" \
      --arg basis "optimize_mechanical:${code}" \
      '{
        status: "can_improve",
        basis: $basis,
        improvements: [{
          target_files: $imp.target_files,
          change: $imp.change,
          why_safe: $imp.why_safe
        }]
      }'
  )" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Short identifiers from Acceptance / done_when (senior: "names that must show up").
# Prints one token per line (may be empty).

aegis_mechanical_surface_first_improve() {
  local investigation="${1-}"
  local corpus="${2-}"
  local files_json="${3:-[]}"
  local diff_content="${4-}"
  [[ -n "${investigation}" ]] || return 0
  aegis_demand_limits_one_export "${investigation}" || return 0

  local n primary export_names extras
  # Prefer NEW exports in the candidate diff. Counting the whole file falsely
  # flags barrel reexports on src/index.ts that already ship many public APIs.
  n=0
  if [[ -n "${diff_content}" ]] && declare -f count_diff_added_exports >/dev/null 2>&1; then
    n="$(count_diff_added_exports "${diff_content}" 2>/dev/null | tr -d '[:space:]')"
  fi
  [[ "${n}" =~ ^[0-9]+$ ]] || n=0
  if [[ "${n}" -le 1 ]]; then
    n="$(aegis_count_top_level_exports "${corpus}" | tr -d '[:space:]')"
    [[ "${n}" =~ ^[0-9]+$ ]] || n=0
    # Whole-file count only when the diff is empty/unavailable; if the demand
    # is a reexport micro, still bail (limits_one_export should have returned).
  fi
  [[ "${n}" -gt 1 ]] || return 0

  primary="$(
    printf '%s' "${files_json}" \
      | jq -r 'map(select(type=="string" and length>0))[0] // "src/unknown.ts"' 2>/dev/null || printf 'src/unknown.ts'
  )"
  export_names="$(
    printf '%s\n' "${corpus}" \
      | grep -Eo 'export[[:space:]]+(async[[:space:]]+)?(function|class|const|let|var)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' \
      | sed -E 's/.*[[:space:]]//' \
      | awk 'NF && !seen[$0]++' \
      | head -n 8 \
      | tr '\n' ',' \
      | sed 's/,$//'
  )"
  [[ -n "${export_names}" ]] || export_names="(multiple exports)"
  extras="keep only the single demand-named public export; demote or delete the other top-level exports (${export_names})"
  jq -nc \
    --arg f "${primary}" \
    --arg ch "In ${primary}, ${extras}." \
    --arg w "Demand limits public surface to one export; extras are non-required surface." \
    --argjson n "${n}" \
    '{
      target_files: [$f],
      change: $ch,
      why_safe: $w,
      code: ("surface_over_export_" + ($n|tostring))
    }'
}

# Surface findings as adversarial JSON array (max 1).

aegis_mechanical_surface_findings_json() {
  local investigation="${1-}"
  local corpus="${2-}"
  local files_json="${3:-[]}"
  local diff_content="${4-}"
  local imp
  imp="$(
    aegis_mechanical_surface_first_improve \
      "${investigation}" "${corpus}" "${files_json}" "${diff_content}" 2>/dev/null || true
  )"
  if [[ -z "${imp}" ]] \
    || ! printf '%s' "${imp}" | jq -e 'type=="object" and (.change|type=="string")' >/dev/null 2>&1; then
    printf '[]'
    return 0
  fi
  jq -nc --argjson imp "${imp}" '[{
    type: "contract_violation",
    severity: "high",
    description: ("Demand limits public surface to one export; candidate has multiple: " + ($imp.change // "")),
    supported_by_evidence: true,
    evidence_refs: ["files_changed.body", "candidate.diff"],
    target_files: $imp.target_files,
    fix: $imp.change,
    code: ($imp.code // "surface_over_export")
  }]'
}

# Demand-cued fidelity witnesses (KISS greps). Only fire when the demand text
# itself contains the cue — never invent obligations.
# Prints lines: code<TAB>target_hint<TAB>description<TAB>fix_suffix
# (target_hint is a basename fragment or empty).

aegis_demand_fidelity_witness_rows() {
  local investigation="${1-}"
  local corpus="${2-}"
  [[ -n "${investigation}" ]] || return 0

  # Helper: one TSV row (tabs between fields).
  _fid_row() {
    printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"
  }

  # 1024n factor chain (explicit in demand)
  if printf '%s' "${investigation}" | grep -Fq '1024n'; then
    if ! printf '%s' "${corpus}" | grep -Fq '1024n'; then
      _fid_row "factor_1024" "types" \
        "Demand requires 1024n in unit conversion; candidate body has no 1024n" \
        "implement conversion with BigInt(...) * 1024n * 1024n * 8n (not a single magic constant)"
    fi
  fi

  # /1000n rate scale
  if printf '%s' "${investigation}" | grep -Eq '/[[:space:]]*1000n'; then
    if ! printf '%s' "${corpus}" | grep -Eq '/[[:space:]]*1000n'; then
      _fid_row "rate_div_1000" "types" \
        "Demand requires /1000n in rate conversion; candidate body missing it" \
        "implement rate bits-per-ms with ... * 8n / 1000n"
    fi
  fi

  # Must import SlidingWindow / ./window.js
  if printf '%s' "${investigation}" | grep -Eiq "from ['\"]\\./window\\.js['\"]|import.*SlidingWindow|Must import.*window"; then
    if ! printf '%s' "${corpus}" | grep -Eq "from[[:space:]]+['\"]\\./window\\.js['\"]"; then
      _fid_row "import_window" "hybridLimiter" \
        "Demand requires importing SlidingWindow from ./window.js; no such import in candidate" \
        "import { SlidingWindow } from './window.js' and use it (do not keep a parallel local array)"
    fi
  fi

  # Must call mbToBits (not only define it)
  if printf '%s' "${investigation}" | grep -Fq 'mbToBits'; then
    local calls
    calls="$(
      printf '%s' "${corpus}" \
        | grep -E 'mbToBits[[:space:]]*\(' \
        | grep -vE 'function[[:space:]]+mbToBits|export[[:space:]]+function[[:space:]]+mbToBits' \
        || true
    )"
    if [[ -z "${calls}" ]]; then
      _fid_row "use_mbToBits" "hybridLimiter" \
        "Demand requires mbToBits; candidate never calls it" \
        "set capacity via mbToBits(config.capacityMB) from ./types.js"
    fi
  fi

  if printf '%s' "${investigation}" | grep -Fq 'mbpsToBitsPerMs'; then
    local calls2
    calls2="$(
      printf '%s' "${corpus}" \
        | grep -E 'mbpsToBitsPerMs[[:space:]]*\(' \
        | grep -vE 'function[[:space:]]+mbpsToBitsPerMs|export[[:space:]]+function[[:space:]]+mbpsToBitsPerMs' \
        || true
    )"
    if [[ -z "${calls2}" ]]; then
      _fid_row "use_mbpsToBitsPerMs" "hybridLimiter" \
        "Demand requires mbpsToBitsPerMs; candidate never calls it" \
        "set rate via mbpsToBitsPerMs(config.rateMBps) from ./types.js"
    fi
  fi

  # Non-positive consume guard
  if printf '%s' "${investigation}" | grep -Eq 'bits[[:space:]]*<=[[:space:]]*0'; then
    if ! printf '%s' "${corpus}" | grep -Eq 'bits[[:space:]]*<=[[:space:]]*0|bits[[:space:]]*<[[:space:]]*1'; then
      _fid_row "nonpos_guard" "hybridLimiter" \
        "Demand requires bits<=0 return false without debit; no such guard in body" \
        "in consume/tryConsume, if (bits <= 0) return false before debit"
    fi
  fi

  # softExceeded half-capacity (tokens * 2n < capacity)
  if printf '%s' "${investigation}" | grep -Eiq 'softExceeded|half capacity|tokens \* 2n'; then
    if ! printf '%s' "${corpus}" | grep -Eq '\*[[:space:]]*2n|2n[[:space:]]*\*|/[[:space:]]*2n|>>[[:space:]]*1n'; then
      _fid_row "half_capacity" "hybridLimiter" \
        "Demand requires softExceeded half-capacity test (tokens*2n < capacity); missing from body" \
        "implement softExceeded as window full AND tokens * 2n < capacity"
    fi
  fi

  # window size clamp
  if printf '%s' "${investigation}" | grep -Eiq 'clamp size to|size to ≥ 1|size to >= 1|windowSize.*clamp'; then
    if ! printf '%s' "${corpus}" | grep -Eq 'size[[:space:]]*<[[:space:]]*1|Math\.max[[:space:]]*\([[:space:]]*1|size[[:space:]]*<=[[:space:]]*0'; then
      _fid_row "window_clamp" "window" \
        "Demand requires window size clamped to >=1; no clamp in body" \
        "in SlidingWindow constructor, clamp size with Math.max(1, size) or equivalent"
    fi
  fi
}

# First fidelity hole as optimize improvement JSON (or empty).

aegis_mechanical_fidelity_first_improve() {
  local investigation="${1-}"
  local corpus="${2-}"
  local files_json="${3:-[]}"
  local row code hint desc fix_s path
  row="$(aegis_demand_fidelity_witness_rows "${investigation}" "${corpus}" | head -1)"
  [[ -n "${row}" ]] || return 0
  IFS=$'\t' read -r code hint desc fix_s <<<"${row}"
  path="$(aegis_files_json_pick "${files_json}" "${hint}")"
  [[ -n "${path}" ]] || path="src/unknown.ts"
  jq -nc \
    --arg f "${path}" \
    --arg c "${code}" \
    --arg ch "In ${path}, ${fix_s}" \
    --arg w "Implements a constraint already stated in the investigation Change; stays inside files_changed." \
    '{
      target_files: [$f],
      change: $ch,
      why_safe: $w,
      code: ("fidelity_" + $c)
    }'
}

# Fidelity holes as adversarial findings JSON array (max 2).

aegis_mechanical_fidelity_findings_json() {
  local investigation="${1-}"
  local corpus="${2-}"
  local files_json="${3:-[]}"
  local -a items=()
  local row code hint desc fix_s path n=0
  while IFS= read -r row; do
    [[ -n "${row}" ]] || continue
    IFS=$'\t' read -r code hint desc fix_s <<<"${row}"
    path="$(aegis_files_json_pick "${files_json}" "${hint}")"
    [[ -n "${path}" ]] || path="src/unknown.ts"
    items+=(
      "$(
        jq -nc \
          --arg f "${path}" \
          --arg d "${desc}" \
          --arg fix "In ${path}, ${fix_s}" \
          --arg c "${code}" \
          '{
            type: "contract_violation",
            severity: "high",
            description: $d,
            supported_by_evidence: true,
            evidence_refs: ["files_changed.body", "candidate.diff"],
            target_files: [$f],
            fix: $fix,
            code: ("fidelity_" + $c)
          }'
      )"
    )
    n=$((n + 1))
    [[ "${n}" -ge 2 ]] && break
  done < <(aegis_demand_fidelity_witness_rows "${investigation}" "${corpus}")

  if [[ "${#items[@]}" -eq 0 ]]; then
    printf '[]'
    return 0
  fi
  printf '%s\n' "${items[@]}" | jq -s -c '.'
}

# Mechanical adversarial findings from candidate +lines / bodies (tools clean).
# Prints JSON array of findings (may be empty []).

aegis_mechanical_adversarial_diff_scan() {
  local handover="${1-}"
  local investigation="${2-}"
  local root="${3:-.}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || { printf '[]'; return 0; }

  local diff_content files_json primary added corpus
  diff_content="$(aegis_handover_mutation_diff "${handover}" 2>/dev/null || true)"
  files_json="$(aegis_handover_mutation_files_json "${handover}")"
  primary="$(
    printf '%s' "${files_json}" \
      | jq -r 'map(select(type=="string" and length>0))[0] // "unknown"' 2>/dev/null || printf 'unknown'
  )"
  added="$(aegis_diff_added_lines "${diff_content}")"
  corpus="$(aegis_candidate_files_corpus "${files_json}" "${diff_content}" "${root}")"

  local -a findings=()

  # Stub / unfinished delivery in added lines.
  if [[ -n "${added}" ]] && printf '%s\n' "${added}" \
    | grep -Eiq \
      '(TODO|FIXME|not[[:space:]]+implemented|throw[[:space:]]+new[[:space:]]+Error\([[:space:]]*["'\'']not implemented)'; then
    findings+=(
      "$(
        jq -nc --arg f "${primary}" '{
          type: "contract_violation",
          severity: "high",
          description: "Candidate adds TODO/FIXME/not-implemented stub in added lines",
          supported_by_evidence: true,
          evidence_refs: ["candidate.diff"],
          target_files: [$f],
          fix: ("In " + $f + ", implement or remove stub paths left in the Build/optimize candidate.")
        }'
      )"
    )
  fi

  # Explicit any as contract smell when tools are otherwise clean.
  if [[ -n "${added}" ]] && printf '%s\n' "${added}" \
    | grep -Eiq '(:[[:space:]]*any\b|as[[:space:]]+any\b)'; then
    findings+=(
      "$(
        jq -nc --arg f "${primary}" '{
          type: "contract_violation",
          severity: "medium",
          description: "Candidate introduces explicit any in added lines",
          supported_by_evidence: true,
          evidence_refs: ["candidate.diff"],
          target_files: [$f],
          fix: ("In " + $f + ", replace explicit any with concrete types on lines added by the candidate.")
        }'
      )"
    )
  fi

  # Public surface bloat when demand limits exports (before fidelity greps).
  if [[ -n "${investigation}" ]] \
    && declare -f aegis_mechanical_surface_findings_json >/dev/null 2>&1; then
    local surf_json
    surf_json="$(
      aegis_mechanical_surface_findings_json \
        "${investigation}" "${corpus}" "${files_json}" "${diff_content}" 2>/dev/null || printf '[]'
    )"
    if printf '%s' "${surf_json}" | jq -e 'type=="array" and length>0' >/dev/null 2>&1; then
      local surf_item
      while IFS= read -r surf_item; do
        [[ -n "${surf_item}" ]] || continue
        findings+=("${surf_item}")
      done < <(printf '%s' "${surf_json}" | jq -c '.[]' 2>/dev/null || true)
    fi
  fi

  # Demand fidelity witnesses (Change cues → body). Prefer over acceptance-name-only.
  if [[ -n "${investigation}" ]] \
    && declare -f aegis_mechanical_fidelity_findings_json >/dev/null 2>&1; then
    local fid_json
    fid_json="$(
      aegis_mechanical_fidelity_findings_json \
        "${investigation}" "${corpus}" "${files_json}" 2>/dev/null || printf '[]'
    )"
    if printf '%s' "${fid_json}" | jq -e 'type=="array" and length>0' >/dev/null 2>&1; then
      # Prepend fidelity findings (high signal).
      local fid_item
      while IFS= read -r fid_item; do
        [[ -n "${fid_item}" ]] || continue
        findings+=("${fid_item}")
      done < <(printf '%s' "${fid_json}" | jq -c '.[]' 2>/dev/null || true)
    fi
  fi

  # Acceptance idents missing from final body (+lines ∪ on-disk files_changed).
  local missing_nl="" accept_rc=0
  if [[ -n "${investigation}" ]]; then
    missing_nl="$(
      aegis_acceptance_missing_in_corpus "${investigation}" "${corpus}" 2>/dev/null
    )" || accept_rc=$?
    if [[ "${accept_rc}" -ne 0 && -n "${missing_nl}" ]]; then
      local miss_list fix_hint headline
      local absent_list="" notexp_list="" mt reason
      while IFS= read -r mt; do
        [[ -n "${mt}" ]] || continue
        reason="${mt##*|}"
        mt="${mt%%|*}"
        if [[ "${reason}" == "not_exported" ]]; then
          notexp_list="${notexp_list}${mt} "
        else
          absent_list="${absent_list}${mt} "
        fi
      done <<< "${missing_nl}"
      absent_list="${absent_list% }"
      notexp_list="${notexp_list% }"

      # Two different defects, two different messages. Reporting a written-but-
      # private identifier as "missing from body" sends the model hunting for
      # code that is already there.
      headline=""
      [[ -n "${absent_list}" ]] \
        && headline="Acceptance identifiers missing from candidate body: ${absent_list}"
      if [[ -n "${notexp_list}" ]]; then
        [[ -n "${headline}" ]] && headline="${headline} | "
        headline="${headline}Acceptance identifiers present but not exported: ${notexp_list}"
      fi
      miss_list="$(printf '%s %s' "${absent_list}" "${notexp_list}" | tr -s ' ' | sed 's/^ //; s/ $//')"

      fix_hint=""
      for mt in ${absent_list}; do
        if aegis_acceptance_token_is_language_global "${mt}"; then
          fix_hint="${fix_hint}use ${mt} in the implementation (e.g. ${mt}(Date.now()) / 0n), not as export; "
        else
          fix_hint="${fix_hint}include identifier ${mt} in the candidate body; "
        fi
      done
      for mt in ${notexp_list}; do
        fix_hint="${fix_hint}${mt} is already in the file — add top-level export function/class/const ${mt} (a class method does not satisfy Acceptance); "
      done
      [[ -n "${fix_hint}" ]] || fix_hint="Add missing Acceptance identifiers to ${primary}: ${miss_list}"
      findings+=(
        "$(
          jq -nc --arg f "${primary}" --arg d "${headline}" --arg fix "${fix_hint}" '{
            type: "contract_violation",
            severity: "high",
            description: $d,
            supported_by_evidence: true,
            evidence_refs: ["candidate.diff", "files_changed.body"],
            target_files: [$f],
            fix: ("In " + $f + ", " + $fix)
          }'
        )"
      )
    fi
  fi

  if [[ "${#findings[@]}" -eq 0 ]]; then
    printf '[]'
    return 0
  fi
  # At most 2 mechanical findings (precision over volume).
  printf '%s\n' "${findings[@]:0:2}" | jq -s -c '.'
}


aegis_emit_mechanical_adversarial_findings() {
  local findings_json="${1-[]}"
  if ! printf '%s' "${findings_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    return 1
  fi
  local body
  body="$(
    jq -nc --argjson f "${findings_json}" '{status:"challenged",findings:$f}'
  )" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Tools+greps+acceptance clean: stage still runs (verified), no residual LLM.

aegis_emit_mechanical_adversarial_verified() {
  local basis="${1:-mechanical_verified}"
  local body
  body="$(
    jq -nc --arg b "${basis}" '{
      status: "verified",
      findings: [],
      basis: $b
    }'
  )" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Etapa 5/6 — optimize/adversarial agêntico: o assistente preenche o verdict
# em <stage>_verdict.json e este helper sintetiza o artifact a partir dele.
# Nunca chama o LLM interno. Verdict schema (aegis.verdict.v1):
#   {status: "approved"|"rejected", basis: "...", suggestions?: ["..."]}
# Mapeia para o mesmo shape dos artifacts mecânicos que o validation espera.

aegis_synthesize_agentic_verdict_artifact() {
  local mode="${1-}"
  local verdict_file="${2-}"
  [[ -f "${verdict_file}" ]] || return 1
  local status basis suggestions
  status="$(jq -r '.status // empty' "${verdict_file}" 2>/dev/null || true)"
  basis="$(jq -r '.basis // "agentic_verdict"' "${verdict_file}" 2>/dev/null || true)"
  suggestions="$(jq -c '[.suggestions // [] | .[]? | select(type == "string")]' "${verdict_file}" 2>/dev/null || printf '[]')"
  [[ -n "${status}" ]] || return 1

  case "${mode}" in
    optimize)
      case "${status}" in
        approved)
          aegis_emit_mechanical_optimize_passthrough "agentic:${basis}" ;;
        rejected)
          local body
          body="$(jq -nc --arg b "agentic:${basis}" --argjson sug "${suggestions}" '{
            status: "can_improve",
            basis: $b,
            improvements: [{
              target_files: [],
              change: ($sug | if length > 0 then .[0] else "refine per assistant verdict" end),
              why_safe: "assistant-verdict"
            }]
          }')" || return 1
          aegis_emit_framed_json_artifact "${body}" ;;
        *) return 1 ;;
      esac
      ;;
    adversarial)
      case "${status}" in
        approved)
          aegis_emit_mechanical_adversarial_verified "agentic:${basis}" ;;
        rejected)
          local findings
          findings="$(jq -c '
            if (.findings // [] | length) > 0 then
              .findings | map(
                if type == "string" then {severity: "medium", reason: ., fix: .}
                elif type == "object" then
                  {
                    id: (.id // "adversarial_invariant_violation"),
                    severity: (.severity // "medium"),
                    reason: (.reason // .finding // "invariant violation detected"),
                    target_files: (.target_files // []),
                    fix: (.fix // .suggestion // "")
                  }
                else empty end
              )
            elif (.suggestions // [] | length) > 0 then
              .suggestions | map({severity: "medium", reason: ., fix: .})
            else
              [{severity: "medium", reason: (.basis // "rejected by adversarial devil advocate"), fix: ""}]
            end
          ' "${verdict_file}" 2>/dev/null || printf '[]')"
          aegis_emit_mechanical_adversarial_findings "${findings}" ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

# Whether adversarial residual LLM should run (tools/greps already clean).
# Env AEGIS_ADVERSARIAL_LLM: auto|0|1 (default auto).
# auto: LLM only when candidate is "large" (lines/files thresholds).

aegis_adversarial_should_use_llm() {
  local handover="${1-}"
  # Agentic handover: adversarial falsification is the assistant's job; never
  # run the adversarial LLM internally.
  if [[ "${AEGIS_AGENTIC:-0}" == "1" ]]; then
    return 1
  fi
  local flag
  flag="$(printf '%s' "${AEGIS_ADVERSARIAL_LLM:-auto}" | tr '[:upper:]' '[:lower:]')"
  case "${flag}" in
    0|false|no|off|mechanical)
      return 1
      ;;
    1|true|yes|always|llm)
      return 0
      ;;
  esac

  # auto
  : "${AEGIS_ADVERSARIAL_LLM_MAX_LINES:=60}"
  : "${AEGIS_ADVERSARIAL_LLM_MAX_FILES:=1}"
  local diff_content files_json n_lines n_files
  diff_content="$(aegis_handover_mutation_diff "${handover}" 2>/dev/null || true)"
  files_json="$(aegis_handover_mutation_files_json "${handover}")"
  n_files="$(printf '%s' "${files_json}" | jq -r 'length' 2>/dev/null || printf '0')"
  n_lines="$(printf '%s\n' "${diff_content}" | wc -l | tr -d ' ')"
  [[ "${n_files}" =~ ^[0-9]+$ ]] || n_files=0
  [[ "${n_lines}" =~ ^[0-9]+$ ]] || n_lines=0
  if [[ "${n_files}" -gt "${AEGIS_ADVERSARIAL_LLM_MAX_FILES}" ]] \
    || [[ "${n_lines}" -gt "${AEGIS_ADVERSARIAL_LLM_MAX_LINES}" ]]; then
    return 0
  fi
  return 1
}

# Post-Build file bodies for optimize (apply candidate on temp copies of HEAD).
# Args: [handover_path] [repo_root]

aegis_optimize_build_is_trivial() { aegis_optimize_mutation_is_trivial "$@"; }

# Env: AEGIS_OPTIMIZE_FILE_BODY_MAX_BYTES (default 8000 per file)
#      AEGIS_OPTIMIZE_FILE_BODY_MAX_FILES (default 4)

aegis_format_tribunal_summary_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  jq -r '
    .artifact_snapshot as $snap
    | ($snap.operational_context // {}) as $oc
    | ($oc.findings // $snap.findings // []) as $f
    | ($oc.candidate_result // {}) as $c
    | ($c.files_changed // $oc.files_changed // []) as $files
    | "=== TRIBUNAL SUMMARY (runtime) ===",
      "",
      "candidate_files: " + (if ($files | length) > 0 then ($files | join(", ")) else "(none)" end),
      "findings_count: " + (($f | length) | tostring),
      "blocking_findings: " + ([ $f[]? | select(
          (.supported_by_evidence == true)
          and ((.severity == "high") or (.severity == "medium"))
        )] | length | tostring),
      "adversarial_status: " + (
        if ($snap.mode == "adversarial") then ($oc.status // $snap.status // "?")
        else ($oc.status // "n/a") end
      ),
      "Prefer tools + evidence-backed findings; do not invent new defects.",
      ""
  ' "${handover}" 2>/dev/null || true
}

# =========================================================
# MECHANICAL DISCOVERY & FORENSICS SUBSTRATE EMITTERS
# =========================================================

# Prints: missing | present_no_hits | present_hits:<id1,id2,...>

aegis_discovery_probe_path() {
  local path="$1"
  local tokens_nl="$2"
  local root="${3:-.}"
  local full hits hit_list token

  full="${root%/}/${path}"
  full="${full#./}"
  if [[ ! -f "${full}" ]]; then
    printf 'missing'
    return 0
  fi

  hits=""
  while IFS= read -r token; do
    [[ -n "${token}" ]] || continue
    [[ "${#token}" -ge 4 ]] || continue
    if grep -Fqi -- "${token}" "${full}" 2>/dev/null; then
      # Prefer exported identifiers that contain the token (KISS signal).
      local exports
      exports="$(
        grep -Eio "export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[A-Za-z0-9_]+|export[[:space:]]+const[[:space:]]+[A-Za-z0-9_]+" \
          "${full}" 2>/dev/null \
          | grep -Fi -- "${token}" \
          | sed -E 's/.*[[:space:]]([A-Za-z0-9_]+)$/\1/' \
          | head -n 3 \
          || true
      )"
      if [[ -n "${exports}" ]]; then
        while IFS= read -r hit; do
          [[ -n "${hit}" ]] || continue
          hits="${hits}${hits:+,}${hit}"
        done <<< "${exports}"
      else
        hits="${hits}${hits:+,}~${token}"
      fi
    fi
  done <<< "${tokens_nl}"

  if [[ -z "${hits}" ]]; then
    printf 'present_no_hits'
  else
    # unique, cap 4 identifiers for observation density
    hit_list="$(
      printf '%s' "${hits}" | tr ',' '\n' | awk 'NF && !seen[$0]++' | head -n 4 | paste -sd ',' -
    )"
    printf 'present_hits:%s' "${hit_list}"
  fi
}


aegis_build_mechanical_discovery_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local anchors_json named_json seed_json paths_json
  local tokens_nl dense_json search_q seed_source
  local probes_json path probe status hits obs

  anchors_json="$(aegis_mechanical_demand_anchors_json "$@")"

  named_json="$(printf '%s' "${anchors_json}" | jq -c '.operator_named_paths // []')"
  seed_json="$(printf '%s' "${anchors_json}" | jq -c '.seed_targets // []')"
  dense_json="$(printf '%s' "${anchors_json}" | jq -c '.dense_tokens // []')"
  search_q="$(printf '%s' "${anchors_json}" | jq -r '.search_query // "AEGIS"')"
  seed_source="$(printf '%s' "${anchors_json}" | jq -r '.seed_source // "none"')"
  paths_json="$(
    jq -n --argjson n "${named_json}" --argjson s "${seed_json}" \
      '($n + $s) | unique'
  )"
  tokens_nl="$(printf '%s' "${dense_json}" | jq -r '.[]?' 2>/dev/null || true)"

  # Per-path content probes (deterministic; no LLM).
  probes_json="[]"
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" ".")"
    case "${probe}" in
      missing)
        status="missing"
        hits="[]"
        obs="Path ${path} is absent on disk (net-new or missing) — filesystem.read still required; forensics may create if operator-named."
        ;;
      present_no_hits)
        status="present_no_hits"
        hits="[]"
        obs="Path ${path} exists; demand tokens not found in content — likely mutation target; forensics needs file body."
        ;;
      present_hits:*)
        status="present_hits"
        hits="$(
          printf '%s' "${probe#present_hits:}" \
            | tr ',' '\n' \
            | awk 'NF' \
            | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null \
            || printf '[]'
        )"
        obs="Path ${path} exists and already contains demand-related identifiers ($(printf '%s' "${probe#present_hits:}")) — forensics must confirm edit vs already-satisfied."
        ;;
      *)
        status="unknown"
        hits="[]"
        obs="Path ${path}: probe inconclusive — forensics needs filesystem.read."
        ;;
    esac
    probes_json="$(
      jq -n -c \
        --argjson acc "${probes_json}" \
        --arg path "${path}" \
        --arg status "${status}" \
        --argjson hits "${hits}" \
        --arg observation "${obs}" \
        '$acc + [{path: $path, status: $status, hits: $hits, observation: $observation}]'
    )"
  done < <(printf '%s' "${paths_json}" | jq -r '.[]?')

  jq -n \
    --argjson paths "${paths_json}" \
    --argjson named "${named_json}" \
    --argjson seed "${seed_json}" \
    --argjson dense "${dense_json}" \
    --argjson probes "${probes_json}" \
    --arg seed_source "${seed_source}" \
    --arg search_query "${search_q}" \
    '
      def rationale_line:
        if ($named | length) > 0 then
          "Operator-named path(s): " + ($named | join(", "))
            + (if ($seed | length) > 0 then "; seed: " + ($seed | join(", ")) else "" end)
        elif ($seed | length) > 0 then
          "Attention seed (" + $seed_source + "): " + ($seed | join(", "))
        else
          "empty demand path anchors"
        end
        + (if ($dense | length) > 0 then "; tokens: " + ($dense | join(", ")) else "" end);

      if ($probes | length) > 0 then
        {
          observations: [ $probes[].observation ],
          rationale: rationale_line,
          required_evidence: [ $probes[].path | "filesystem.read:" + . ]
        }
      else
        {
          observations: (
            if ($dense | length) > 0 then
              [
                "No mechanical path anchor (operator-named or Layer0/attention seed); forensics targeting will be weak.",
                "Demand tokens available for search_symbol: " + ($dense | join(", "))
                  + " (query " + $search_query + ")."
              ]
            else
              [
                "No mechanical path anchor and no dense demand tokens; forensics targeting will be weak."
              ]
            end
          ),
          rationale: rationale_line,
          required_evidence: []
        }
      end
    '
}


aegis_emit_mechanical_discovery_substrate() {
  local body
  body="$(aegis_build_mechanical_discovery_json "$@")" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Thin projection for needs_llm / forensics body: named + seed + dense.

aegis_forensics_anchor_sets_json() {
  local anchors_json
  anchors_json="$(aegis_mechanical_demand_anchors_json "$@")"
  printf '%s' "${anchors_json}" | jq -c '
    {
      named: (.operator_named_paths // []),
      seed: (.seed_targets // []),
      dense: (.dense_tokens // [])
    }
  ' 2>/dev/null || printf '{"named":[],"seed":[],"dense":[]}'
}

# Rank a content probe for multi-seed discrimination (higher = stronger).
#   missing          → 0
#   present_no_hits  → 5
#   present_hits:…   → 10 + hit count

aegis_forensics_probe_score() {
  local probe="${1-}"
  local n
  case "${probe}" in
    missing)
      printf '0'
      ;;
    present_no_hits)
      printf '5'
      ;;
    present_hits:*)
      n="$(
        printf '%s' "${probe#present_hits:}" \
          | tr ',' '\n' \
          | awk 'NF' \
          | wc -l \
          | tr -d '[:space:]'
      )"
      [[ -n "${n}" ]] || n=0
      printf '%s' "$((10 + n))"
      ;;
    *)
      printf '0'
      ;;
  esac
}

# Among seed paths, print unique winner by probe score, or empty if tie / no signal.
# Args: tokens_nl, seeds_json_array [, root]

aegis_forensics_discriminate_seeds() {
  local tokens_nl="${1-}"
  local seeds_json="${2:-[]}"
  local root="${3:-.}"
  local path probe score
  local best_score=-1
  local best_path=""
  local tie=0

  if ! printf '%s' "${seeds_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    printf ''
    return 0
  fi

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" "${root}")"
    score="$(aegis_forensics_probe_score "${probe}")"
    if [[ "${score}" -gt "${best_score}" ]]; then
      best_score="${score}"
      best_path="${path}"
      tie=0
    elif [[ "${score}" -eq "${best_score}" ]]; then
      tie=1
    fi
  done < <(printf '%s' "${seeds_json}" | jq -r '.[]?')

  # No unique positive winner → empty (caller may use LLM or first-seed force).
  if [[ "${best_score}" -le 0 || "${tie}" -eq 1 || -z "${best_path}" ]]; then
    printf ''
    return 0
  fi
  printf '%s' "${best_path}"
}

# Exit 0 → use LLM. Exit 1 → mechanical is enough.

aegis_forensics_needs_llm() {
  local mode_flag sets named_n seed_n tokens_nl seed_json winner

  mode_flag="$(printf '%s' "${AEGIS_FORENSICS_LLM:-auto}" | tr '[:upper:]' '[:lower:]')"
  case "${mode_flag}" in
    1|true|yes|on|llm) return 0 ;;
    0|false|no|off|mechanical|mech) return 1 ;;
  esac

  # auto: LLM only when multi-seed cannot be discriminated by content probes.
  sets="$(aegis_forensics_anchor_sets_json "$@")"
  named_n="$(printf '%s' "${sets}" | jq -r '.named | length')"
  seed_n="$(printf '%s' "${sets}" | jq -r '.seed | length')"

  if [[ "${named_n}" -ge 1 ]]; then
    return 1
  fi
  if [[ "${seed_n}" -le 1 ]]; then
    # 0 seeds → inconclusive mechanical (do not invent); 1 seed → Alvo Único.
    return 1
  fi

  tokens_nl="$(printf '%s' "${sets}" | jq -r '.dense[]?' 2>/dev/null || true)"
  seed_json="$(printf '%s' "${sets}" | jq -c '.seed // []')"
  winner="$(aegis_forensics_discriminate_seeds "${tokens_nl}" "${seed_json}" ".")"
  if [[ -n "${winner}" ]]; then
    # Unique probe winner → mechanical Alvo Único on that path.
    return 1
  fi
  # True ambiguity (tie / no signal) → LLM guarantee.
  return 0
}


aegis_forensics_mechanical_reason() {
  local text="${1-}"
  local path="${2-}"
  local probe="${3-}"
  local tokens_nl="${4-}"
  local from_u to_u reason token_line low

  # Directed phrase: "X para Y" / "X to Y" (ASCII fold via lower).
  low="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${low}" =~ ([a-z][a-z0-9_]{3,})[[:space:]]+(para|to)[[:space:]]+([a-z][a-z0-9_]{3,}) ]]; then
    from_u="${BASH_REMATCH[1]}"
    to_u="${BASH_REMATCH[3]}"
    reason="Demand: convert ${from_u} to ${to_u} (one new export in ${path})"
  else
    token_line="$(printf '%s\n' "${tokens_nl}" | head -n 3 | paste -sd ' ' -)"
    if [[ -n "${token_line}" ]]; then
      reason="Demand: ${token_line} (one new export in ${path})"
    else
      reason="Demand: apply investigation (one new export in ${path})"
    fi
  fi

  case "${probe}" in
    missing)
      reason="${reason}; path missing — create if operator-named"
      ;;
    present_hits:*)
      reason="${reason}; related symbols exist — confirm edit vs already-satisfied"
      ;;
    present_no_hits)
      reason="${reason}; no demand-token hits yet"
      ;;
  esac
  printf '%s' "${reason}"
}


aegis_build_mechanical_forensics_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local sets named_json seed_json paths_json tokens_nl
  local cands_json="[]"
  local path probe reason winner

  sets="$(aegis_forensics_anchor_sets_json "$@")"
  named_json="$(printf '%s' "${sets}" | jq -c '.named // []')"
  seed_json="$(printf '%s' "${sets}" | jq -c '.seed // []')"
  tokens_nl="$(printf '%s' "${sets}" | jq -r '.dense[]?' 2>/dev/null || true)"

  # Multi operator-named → one candidate each.
  # Else Alvo Único: single seed, or multi-seed probe winner, else first seed.
  if printf '%s' "${named_json}" | jq -e 'length >= 1' >/dev/null 2>&1; then
    paths_json="${named_json}"
  elif printf '%s' "${seed_json}" | jq -e 'length == 1' >/dev/null 2>&1; then
    paths_json="${seed_json}"
  elif printf '%s' "${seed_json}" | jq -e 'length > 1' >/dev/null 2>&1; then
    winner="$(aegis_forensics_discriminate_seeds "${tokens_nl}" "${seed_json}" ".")"
    if [[ -n "${winner}" ]]; then
      paths_json="$(jq -n -c --arg p "${winner}" '[ $p ]')"
    else
      # Force-mechanical / fallthrough: first seed only (never invent).
      paths_json="$(printf '%s' "${seed_json}" | jq -c '.[0:1]')"
    fi
  else
    paths_json='[]'
  fi

  if ! printf '%s' "${paths_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    jq -n '{status: "inconclusive", mutation_candidates: []}'
    return 0
  fi

  local tmp_cands
  tmp_cands="$(mktemp)"
  printf '[]' > "${tmp_cands}"

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" ".")"
    reason="$(aegis_forensics_mechanical_reason "${text}" "${path}" "${probe}" "${tokens_nl}")"
    if jq --arg id "${path}" --arg reason "${reason}" '. + [{id: $id, reason: $reason}]' "${tmp_cands}" > "${tmp_cands}.tmp" 2>/dev/null; then
      mv "${tmp_cands}.tmp" "${tmp_cands}"
    fi
  done < <(printf '%s' "${paths_json}" | jq -r '.[]?')

  cands_json="$(cat "${tmp_cands}")"
  rm -f "${tmp_cands}" "${tmp_cands}.tmp" 2>/dev/null || true

  jq -n --argjson cands "${cands_json:-[]}" \
    '{status: "interpreted", mutation_candidates: $cands}'
}


aegis_emit_mechanical_forensics_substrate() {
  local body
  body="$(aegis_build_mechanical_forensics_json "$@")" || return 1
  aegis_emit_framed_json_artifact "${body}"
}
