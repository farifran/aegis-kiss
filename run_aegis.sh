#!/usr/bin/env bash

# =========================================================
# AEGIS RUN ORCHESTRATOR (KISS Refactored)
# =========================================================
#
# Fail-fast pipeline driver over runtime_aegis.sh; run with
# --help for operator usage. Always ends with an honest
# timing/verdict report (SUCCESS | HALTED | FAILED).
#
# =========================================================

set -Eeuo pipefail

readonly HANDOVER_FILE=".harness/runtime/epistemic_handover.json"
readonly LAST_FATAL_FILE=".harness/runtime/last_fatal"
readonly METRICS_FILE=".harness/runtime/pipeline_metrics.jsonl"
readonly LAST_GOOD_HANDOVER_FILE=".harness/runtime/last_good_epistemic_handover.json"

# Pipeline driver owns the single run-level outcome projection.
export AEGIS_PIPELINE_DRIVER=1

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
source "scripts/lib/run_outcome.sh"
AEGIS_LOG_TAG="RUN"

# Build stamps tools for adversarial reuse during the pipeline.
aegis_run_remove_candidate_tools_stamp() {
  if [[ "${AEGIS_RUNTIME_REMOVE_CANDIDATE_TOOLS_STAMP:-true}" == "0" ]] \
    || [[ "${AEGIS_RUNTIME_REMOVE_CANDIDATE_TOOLS_STAMP:-true}" == "false" ]]; then
    return 0
  fi
  local stamp_dir="${AEGIS_CANDIDATE_TOOLS_STAMP_DIR:-.harness/runtime/candidate_tools_stamp}"
  [[ -n "${stamp_dir}" ]] || return 0
  case "${stamp_dir}" in
    *..*) return 0 ;;
    *candidate_tools_stamp*) ;;
    *) return 0 ;;
  esac
  [[ -e "${stamp_dir}" ]] || return 0
  rm -rf "${stamp_dir}" 2>/dev/null || true
}
trap aegis_run_remove_candidate_tools_stamp EXIT

usage() {
  cat <<'EOF'
Usage: ./run_aegis.sh [readonly] [options] [investigation input...]

Pipelines:
  (default)            mutation: discovery -> forensics -> mutation
                       -> optimize -> adversarial -> validation
  readonly             discovery -> forensics

Options:
  --pipeline NAME      mutation|readonly
  --resume             Continue from the mode after the last
                       .harness/runtime/epistemic_handover.json snapshot
  --fresh              Start a new investigation: wipe handover (and
                       last_good_*) before the pipeline, then bind the
                       new demand from discovery. Mutually exclusive
                       with --resume. Metrics: truncate unless parent
                       set AEGIS_METRICS_APPEND=1 (./aegis multi-unit).
  --until MODE         Stop after MODE completes
  --target PATH        Evidence target directory (default: src or .)
  --issue N            Fetch GitHub issue #N (title+body via gh) as demand
  --task K             Scope demand to checklist task K (1-based) of the
                       issue body; keeps issue Goal/Targets/Constraints as
                       context and omits other tasks. Sets AEGIS_ISSUE_TASK.
  --from-fit PATH      fit.json or directory from fit_check --emit-micros
  --unit N             Run proposed_units[N].demand from --from-fit
  --force-apply        Operator override: on the FINAL executed mode of a
                       partial run (e.g. with --until optimize), promote the
                       candidate diff into the working directory even without
                       an accepted validation verdict.
  --help               Show this help
EOF
}

declare -A PIPELINES=(
  [readonly]="discovery forensics"
  [mutation]="mutation optimize adversarial validation"
)

PIPELINE="mutation"
FIT_CHECK_JSON=""
FROM_FIT=""
FIT_UNIT=""
TARGET=""
RESUME=false
FRESH_INVESTIGATION=false
UNTIL=""
FORCE_APPLY=false
ISSUE_NUMBER=""
ISSUE_TASK=""
INVESTIGATION_INPUT=""
declare -a POSITIONAL=()

declare -A MODE_TIMINGS
declare -A MODE_STATUS
declare -a EXECUTION_MODES

PIPELINE_STATUS="SUCCESS"
PIPELINE_REASON=""

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[RUN][FATAL] missing dependency: $1" >&2
    exit 1
  }
}

check_dependencies() {
  require jq
  require git
  if [[ "${PIPELINE}" == "mutation" ]]; then
    require aider
  fi
}

next_mode() {
  printf '%s\n' "$(aegis_next_in_sequence "$1" "${PIPELINES[$PIPELINE]}")"
}

# True when runtime internal feedback already advanced the handover past the mode just ran
pipeline_handover_past_mode() {
  local just_ran="$1"
  [[ -f "${HANDOVER_FILE}" ]] || return 1
  local hmode
  hmode="$(jq -r '.artifact_snapshot.mode // empty' "${HANDOVER_FILE}" 2>/dev/null || true)"
  [[ -n "${hmode}" && "${hmode}" != "${just_ran}" ]] || return 1

  local seq="${PIPELINES[$PIPELINE]:-}"
  [[ -n "${seq}" ]] || return 1
  local m idx_ran=-1 idx_h=-1 i=0
  for m in ${seq}; do
    if [[ "${m}" == "${just_ran}" ]]; then idx_ran="${i}"; fi
    if [[ "${m}" == "${hmode}" ]]; then idx_h="${i}"; fi
    i=$((i + 1))
  done
  [[ "${idx_ran}" -ge 0 && "${idx_h}" -ge 0 && "${idx_h}" -gt "${idx_ran}" ]]
}

resolve_resume() {
  [[ -f "${HANDOVER_FILE}" ]] || {
    echo "[RUN][FATAL] handover not found" >&2
    exit 1
  }
  local last_mode resume_from found=false mode
  last_mode="$(jq -r '.artifact_snapshot.mode // empty' "${HANDOVER_FILE}")"
  resume_from="$(next_mode "${last_mode}")"
  [[ -n "${resume_from}" ]] || {
    echo "[RUN] nothing to resume"
    exit 0
  }
  for mode in ${PIPELINES[$PIPELINE]}; do
    if [[ "${mode}" == "${resume_from}" ]]; then found=true; fi
    $found && EXECUTION_MODES+=("${mode}")
  done
}

build_mode_list() {
  local mode skip_df=false
  if [[ -f "${HANDOVER_FILE}" ]]; then
    local h_status
    h_status="$(jq -r '.artifact_snapshot.status // .status // empty' "${HANDOVER_FILE}" 2>/dev/null || true)"
    case "${h_status}" in
      interpreted|issue_materialized|verified) skip_df=true ;;
    esac
  fi

  for mode in ${PIPELINES[$PIPELINE]}; do
    if ${skip_df}; then
      case "${mode}" in
        discovery|forensics)
          MODE_STATUS["${mode}"]="ok"
          MODE_TIMINGS["${mode}"]="0"
          continue
          ;;
      esac
    fi
    EXECUTION_MODES+=("${mode}")
  done
}

mark_remaining_skipped() {
  local mode
  for mode in "${EXECUTION_MODES[@]}"; do
    if [[ -z "${MODE_STATUS[$mode]:-}" ]]; then
      MODE_STATUS["${mode}"]="skipped"
    fi
  done
}

mark_modes_nested_after() {
  local just_ran="$1" end_mode="$2" seq="${PIPELINES[$PIPELINE]:-}" m past=0
  [[ -n "${end_mode}" ]] || return 0
  for m in ${seq}; do
    if [[ "${m}" == "${just_ran}" ]]; then past=1; continue; fi
    if [[ "${past}" -eq 1 ]]; then
      if [[ -z "${MODE_STATUS[$m]:-}" ]]; then
        MODE_STATUS["${m}"]="nested"
        MODE_TIMINGS["${m}"]="${MODE_TIMINGS[$m]:-}"
      fi
      [[ "${m}" == "${end_mode}" ]] && break
    fi
  done
}

# Auto-create empty stub files for operator-named net-new paths in src/
ensure_operator_named_src_stubs() {
  command -v git >/dev/null 2>&1 || return 0
  local path
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if [[ "${path}" == src/* || "${path}" == src ]]; then
      if [[ ! -e "${path}" ]]; then
        mkdir -p "$(dirname "${path}")" 2>/dev/null || true
        touch "${path}" 2>/dev/null || true
        echo "[AEGIS][DEMAND] Stub de novo arquivo em src/ criado: ${path}" >&2
      fi
    fi
  done < <(aegis_extract_operator_named_paths "${INVESTIGATION_INPUT:-}" 2>/dev/null || true)
}

assert_demand_targets_not_dirty() {
  [[ "${PIPELINE}" == "mutation" ]] || return 0
  [[ "${AEGIS_PROMOTION_RESET_DIRTY:-false}" != "true" ]] || return 0
  command -v git >/dev/null 2>&1 || return 0
  git rev-parse --git-dir >/dev/null 2>&1 || return 0

  ensure_operator_named_src_stubs

  local -a dirty=()
  local path status_line
  while IFS= read -r path; do
    [[ -n "${path}" && -f "${path}" ]] || continue
    if ! git diff --quiet HEAD -- "${path}" 2>/dev/null; then
      status_line="$(git status --short -- "${path}" 2>/dev/null | head -1)"
      dirty+=("${path} (${status_line:-modified})")
    fi
  done < <(aegis_extract_operator_named_paths "${INVESTIGATION_INPUT:-}" 2>/dev/null || true)

  [[ "${#dirty[@]}" -gt 0 ]] || return 0

  local entry
  for entry in "${dirty[@]}"; do
    echo "[AEGIS][PIPELINE][WARN] demand target has uncommitted work: ${entry}" >&2
  done

  if [[ "${AEGIS_NON_INTERACTIVE:-0}" != "1" && ( -t 0 || -p /dev/stdin ) ]]; then
    echo -n "[AEGIS][PIPELINE] Deseja realizar stash/commit temporário para continuar? [y/N]: " >&2
    local ans="n"
    read -r ans <&0 || ans="n"
    if [[ "${ans}" =~ ^[Yy] ]]; then
      git stash push -m "aegis-auto-stash-$(date +%s)" >/dev/null 2>&1 || true
      echo "[AEGIS][PIPELINE] Stash temporário realizado com sucesso." >&2
      return 0
    fi
  fi

  echo "[AEGIS][PIPELINE] commit ou stash it, ou re-run com AEGIS_PROMOTION_RESET_DIRTY=true para descartar." >&2
  mkdir -p "$(dirname "${LAST_FATAL_FILE}")" 2>/dev/null || true
  printf '%s\n' "promotion_target_is_dirty" > "${LAST_FATAL_FILE}" 2>/dev/null || true
  return 1
}

clear_operator_breadcrumbs() {
  rm -f "${LAST_FATAL_FILE}" 2>/dev/null || true
  if [[ "${FRESH_INVESTIGATION}" == "true" ]]; then
    rm -f "${HANDOVER_FILE}" "${LAST_GOOD_HANDOVER_FILE}" 2>/dev/null || true
  fi
}

: "${AEGIS_EVIDENCE_CACHE_MAX_AGE_DAYS:=7}"
prune_pipeline_evidence_cache() {
  local cache_dir="${AEGIS_EVIDENCE_CACHE_DIR:-.harness/runtime/evidence_cache}"
  mkdir -p "${cache_dir}" 2>/dev/null || true
  find "${cache_dir}" -type f -name '*.json' \
    -mtime "+${AEGIS_EVIDENCE_CACHE_MAX_AGE_DAYS}" -delete 2>/dev/null || true
}

append_pipeline_budget_metric() {
  [[ -n "${AEGIS_METRICS_FILE:-}" && -f "${AEGIS_METRICS_FILE}" ]] || return 0
  local slice
  slice="$(metrics_since_last_run_start "${AEGIS_METRICS_FILE}")"
  [[ -n "${slice}" ]] || return 0

  printf '%s' "${slice}" | jq -s -c '
    map(select(.kind == "cache" and (.substrate | not)))
    | {
        kind: "pipeline_budget",
        modes: length,
        context_bytes_total: (map(.context_bytes // 0) | add // 0),
        context_bytes_peak: (map(.context_bytes // 0) | max // 0),
        ceiling_bytes: (map(.ceiling_bytes // 0) | max // 0),
        evidence_cache_hits: (map(.evidence_cache_hits // 0) | add // 0),
        evidence_cache_bytes: (map(.evidence_cache_bytes // 0) | add // 0),
        budget_pruned_modes: (map(select(.budget_pruned == true)) | length)
      }
  ' >> "${AEGIS_METRICS_FILE}.tmp" 2>/dev/null || return 0

  cat "${AEGIS_METRICS_FILE}.tmp" >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  rm -f "${AEGIS_METRICS_FILE}.tmp" 2>/dev/null || true
}

ensure_pipeline_metrics_path() {
  mkdir -p "$(dirname "${METRICS_FILE}")" 2>/dev/null || true
  export AEGIS_METRICS_FILE="$(cd "$(dirname "${METRICS_FILE}")" && pwd)/$(basename "${METRICS_FILE}")"
}

append_metrics_run_start() {
  ensure_pipeline_metrics_path
  jq -cn \
    --arg pipeline "${PIPELINE}" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{kind:"run_start",pipeline:$pipeline,ts:$ts}' \
    >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

metrics_since_last_run_start() {
  local f="${1:-}"
  [[ -n "${f}" && -f "${f}" ]] || return 0
  awk '
    BEGIN { buf = "" }
    /"kind":[[:space:]]*"run_start"/ { buf = ""; next }
    { buf = buf $0 "\n" }
    END { printf "%s", buf }
  ' "${f}" 2>/dev/null || cat "${f}" 2>/dev/null || true
}

clear_pipeline_metrics() {
  if [[ "${AEGIS_METRICS_APPEND:-0}" == "1" || "${AEGIS_METRICS_APPEND:-0}" == "true" ]]; then
    append_metrics_run_start
    return 0
  fi
  ensure_pipeline_metrics_path
  : > "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  append_metrics_run_start
}

agentic_verdict_file_for() {
  local mode="$1" dir=".harness/runtime/agentic"
  mkdir -p "${dir}" 2>/dev/null || true
  printf '%s/%s_verdict.json' "${dir}" "${mode}"
}

emit_agentic_mode_pause() {
  local mode="$1" vfile="$2"
  echo
  echo "══════════════════════════════════════════════════════════════"
  echo "=== PENDING ASSISTANT (${mode}) ==="
  echo "══════════════════════════════════════════════════════════════"
  echo
  echo "Modo ${mode} agêntico pausado."
  echo "Escreva seu veredito em formato JSON no arquivo:"
  echo "  ${vfile}"
  echo
  echo "E retome com:"
  echo "  ./aegis --resume"
  echo
  emit_result_json "PENDING_ASSISTANT" "${ISSUE_NUMBER:-}" "" "agentic_requires_${mode}_verdict"
}

emit_result_json() {
  jq -cn \
    --arg status "${1}" \
    --arg issue "${2}" \
    --arg commit "${3}" \
    --arg reason "${4}" \
    '{schema:"aegis.go.v1",status:$status,issue:$issue,commit:$commit,reason:$reason}'
}

pipeline_should_halt_after_mode() {
  local mode="$1"
  [[ "${AEGIS_NO_SKIP:-1}" == "1" || "${AEGIS_FORCE_FULL_PIPELINE:-1}" == "1" ]] && return 1
  [[ "${mode}" == "forensics" && -f "${HANDOVER_FILE}" ]] || return 1

  local forensics_status candidate_count
  forensics_status="$(jq -r '.artifact_snapshot.operational_context.status // .artifact_snapshot.status // empty' "${HANDOVER_FILE}" 2>/dev/null || true)"
  candidate_count="$(jq -r '((.artifact_snapshot.operational_context.mutation_candidates // .artifact_snapshot.operational_context.build_candidates) // []) | length' "${HANDOVER_FILE}" 2>/dev/null || echo 0)"

  if [[ "${forensics_status}" == "inconclusive" ]]; then
    echo
    echo "[RUN] Forensics inconclusive — no mutation surface justified. Halting before mutation."
    PIPELINE_STATUS="HALTED"
    PIPELINE_REASON="forensics inconclusive"
    return 0
  fi

  if [[ "${candidate_count}" -eq 0 ]]; then
    echo
    echo "[RUN] No mutation candidates proposed. Halting pipeline to collect more evidence."
    PIPELINE_STATUS="HALTED"
    PIPELINE_REASON="no mutation candidates in forensics handover"
    return 0
  fi

  return 1
}

record_mode_handover_metric() {
  local mode="$1" duration="$2" status="$3"
  [[ -n "${AEGIS_METRICS_FILE:-}" ]] || return 0
  [[ -f "${HANDOVER_FILE}" ]] || {
    jq -cn \
      --arg mode "${mode}" \
      --argjson seconds "${duration:-0}" \
      --arg status "${status}" \
      '{kind:"mode",mode:$mode,seconds:$seconds,status:$status}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
    return 0
  }

  jq -c \
    --arg mode "${mode}" \
    --argjson seconds "${duration:-0}" \
    --arg status "${status}" '
      {
        kind: "mode",
        mode: $mode,
        seconds: $seconds,
        status: $status,
        handover_mode: (.artifact_snapshot.mode // null),
        verdict: (.artifact_snapshot.operational_context.verdict // null),
        forensics_status: (if $mode == "forensics" then (.artifact_snapshot.operational_context.status // null) else null end),
        mutation_candidates: (((.artifact_snapshot.operational_context.mutation_candidates // .artifact_snapshot.operational_context.build_candidates) // []) | length),
        findings: ((.artifact_snapshot.operational_context.findings // []) | length),
        files_changed: ((.artifact_snapshot.operational_context.candidate_result.files_changed // .artifact_snapshot.operational_context.files_changed // .artifact_snapshot.operational_context.validated_candidate.files_changed // []) | length)
      }
    ' "${HANDOVER_FILE}" >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

run_mode() {
  local mode="$1" is_final_mode="${2:-false}"
  echo
  echo "================================================="
  echo "MODE: ${mode}"
  echo "================================================="

  local start end duration rc=0
  start=$(date +%s)

  local cmd=(bash runtime_aegis.sh "${mode}")
  [[ -n "${TARGET}" ]] && cmd+=("--target" "${TARGET}")
  [[ "${FORCE_APPLY}" == "true" && "${is_final_mode}" == "true" ]] && cmd+=("--force-apply")
  [[ -n "${ISSUE_NUMBER}" ]] && cmd+=("--issue" "${ISSUE_NUMBER}")
  [[ -n "${ISSUE_TASK}" ]] && cmd+=("--task" "${ISSUE_TASK}")
  [[ -n "${INVESTIGATION_INPUT}" ]] && cmd+=("${INVESTIGATION_INPUT}")

  set +e
  "${cmd[@]}"
  rc=$?
  set -e

  end=$(date +%s)
  duration=$((end - start))
  MODE_TIMINGS["${mode}"]="${duration}"

  if [[ "${rc}" -ne 0 ]]; then
    MODE_STATUS["${mode}"]="failed"
    PIPELINE_STATUS="FAILED"
    PIPELINE_REASON="mode '${mode}' exited ${rc}"
    record_mode_handover_metric "${mode}" "${duration}" "failed"
    return "${rc}"
  fi

  MODE_STATUS["${mode}"]="ok"
  record_mode_handover_metric "${mode}" "${duration}" "ok"
  return 0
}

handover_report_fields() {
  [[ -f "${HANDOVER_FILE}" ]] || { printf '%s\n' '{}'; return; }
  jq -c '
    {
      mode: (.artifact_snapshot.mode // empty),
      verdict: (.artifact_snapshot.operational_context.verdict // empty),
      attention: (.epistemic_state.next_attention_targets // [] | map(select(type == "string" and length > 0)) | .[0:8]),
      violations: (((.artifact_snapshot.operational_context.mutation_feedback // .artifact_snapshot.operational_context.build_feedback).violations // [])
        | map({severity: (.severity // "unspecified"), origin: (.origin // "unspecified"), reason: (.structural_reason // ""), files: (.target_files // [])}) | .[0:5]),
      basis: (.artifact_snapshot.operational_context.basis // [] | if type == "string" then [.] else . end | map(select(type == "string" and length > 0)) | .[0:5])
    }
  ' "${HANDOVER_FILE}" 2>/dev/null || printf '%s\n' '{}'
}

show_final_report() {
  local total=0 mode status mark timing fields last_fatal=""

  echo
  echo "══════════════════════════════"
  echo "AEGIS RUN REPORT"
  echo "══════════════════════════════"
  echo
  echo "Pipeline: ${PIPELINE}"
  echo "Status:   ${PIPELINE_STATUS}"
  [[ -n "${PIPELINE_REASON}" ]] && echo "Reason:   ${PIPELINE_REASON}"
  if [[ -f "${LAST_FATAL_FILE}" ]]; then
    last_fatal="$(tr -d '\r' < "${LAST_FATAL_FILE}" | head -n 1)"
    [[ -n "${last_fatal}" ]] && echo "Fatal:    ${last_fatal}"
  fi
  echo
  echo "Modes:"

  for mode in "${EXECUTION_MODES[@]}"; do
    status="${MODE_STATUS[$mode]:-skipped}"
    timing="${MODE_TIMINGS[$mode]:-}"
    case "${status}" in
      ok) mark="✓" ;;
      nested) mark="↳" ;;
      failed) mark="✗" ;;
      halted) mark="◼" ;;
      *) mark="—" ;;
    esac

    if [[ "${status}" == "nested" ]]; then
      printf "  %-12s %s  %s\n" "${mode}" "${mark}" "nested (ran in prior feedback)"
    elif [[ -n "${timing}" ]]; then
      printf "  %-12s %s  %ss\n" "${mode}" "${mark}" "${timing}"
      total=$((total + timing))
    else
      printf "  %-12s %s  %s\n" "${mode}" "${mark}" "${status}"
    fi
  done

  local metrics_view
  metrics_view="$(metrics_since_last_run_start "${METRICS_FILE}")"

  if [[ -n "${metrics_view}" ]] && printf '%s' "${metrics_view}" | grep -q '"kind":"optimize"' 2>/dev/null; then
    echo
    echo "Optimize:"
    printf '%s' "${metrics_view}" | jq -r '
      select(.kind == "optimize")
      | "  - \(.result)" + (if (.detail // "") != "" then " (\(.detail))" else "" end)
    ' 2>/dev/null | tail -n 8 || true
  fi

  echo
  echo "Total: ${total}s"
  echo

  if [[ -n "${metrics_view}" ]]; then
    echo "Stage budget:"
    printf '%s' "${metrics_view}" | jq -r -s --argjson total "${total}" '
      map(select(.kind == "mode"))
      | .[]
      | (.seconds // 0) as $s
      | (if $total > 0 then (($s * 100 / $total) | floor) else 0 end) as $pct
      | "  \(.mode)\t\($s)s\t\($pct)%"
        + (if .verdict != null then "  verdict=\(.verdict)" else "" end)
        + (if .forensics_status != null then "  status=\(.forensics_status)" else "" end)
        + (if (((.mutation_candidates // .build_candidates) // 0)) > 0 then "  candidates=\((.mutation_candidates // .build_candidates))" else "" end)
        + (if (.findings // 0) > 0 then "  findings=\(.findings)" else "" end)
        + (if (.files_changed // 0) > 0 then "  files=\(.files_changed)" else "" end)
    ' 2>/dev/null || true

    local top_timing
    top_timing="$(printf '%s' "${metrics_view}" | jq -r -s '
      map(select(.kind == "timing")) | sort_by(-.seconds) | .[0:5] | .[] | "  \(.label): \(.seconds)s"
    ' 2>/dev/null || true)"
    if [[ -n "${top_timing}" ]]; then
      echo
      echo "Hot spans (top timing labels):"
      printf '%s\n' "${top_timing}"
    fi
    echo
  fi

  fields="$(handover_report_fields)"
  if [[ "${fields}" != "{}" ]]; then
    local h_mode h_verdict
    h_mode="$(jq -r '.mode // empty' <<<"${fields}")"
    h_verdict="$(jq -r '.verdict // empty' <<<"${fields}")"
    [[ -n "${h_mode}" ]] && echo "Final Mode: ${h_mode}"
    [[ -n "${h_verdict}" ]] && echo "Verdict:    ${h_verdict}"

    if jq -e '(.basis | length) > 0' <<<"${fields}" >/dev/null 2>&1; then
      echo; echo "Basis:"; jq -r '.basis[] | "  - \(.)"' <<<"${fields}"
    fi
    if jq -e '(.violations | length) > 0' <<<"${fields}" >/dev/null 2>&1; then
      echo; echo "Build Feedback (top violations):"
      jq -r '.violations[] | "  - [\(.severity)] \(.origin): \(.reason)" + (if (.files | length) > 0 then " (" + (.files | join(", ")) + ")" else "" end)' <<<"${fields}"
    fi
    if jq -e '(.attention | length) > 0' <<<"${fields}" >/dev/null 2>&1; then
      echo; echo "Attention:"; jq -r '.attention[] | "  - \(.)"' <<<"${fields}"
    fi
    echo
  fi

  echo "══════════════════════════════"

  local outcome_status outcome_reason outcome_class outcome_mode=""
  for mode in "${EXECUTION_MODES[@]}"; do
    if [[ "${MODE_STATUS[$mode]:-}" =~ ^(failed|ok|halted)$ ]]; then
      outcome_mode="${mode}"
    fi
  done

  if [[ -n "${last_fatal}" ]]; then
    outcome_status="FAILED"; outcome_reason="${last_fatal}"
  elif [[ "${PIPELINE_STATUS}" == "FAILED" ]]; then
    outcome_status="FAILED"; outcome_reason="mode_exit_without_fatal_breadcrumb"
  elif [[ "${PIPELINE_STATUS}" == "HALTED" ]]; then
    outcome_status="HALTED"; outcome_reason="${PIPELINE_REASON}"
  elif [[ "${PIPELINE_STATUS}" == "PENDING_ASSISTANT" ]]; then
    outcome_status="PENDING_ASSISTANT"; outcome_reason="${PIPELINE_REASON}"
  else
    outcome_status="SUCCESS"; outcome_reason=""
  fi

  if [[ "${outcome_status}" == "SUCCESS" ]]; then
    outcome_class=""
  else
    aegis_classify_reason "${outcome_reason}" >/dev/null
    outcome_class="${AEGIS_OUTCOME_CLASS:-unknown}"
  fi

  aegis_emit_outcome_block "${outcome_status}" "${outcome_reason}"
  aegis_append_outcome_metric "${outcome_status}" "${outcome_reason}" "${outcome_class}" "${outcome_mode}"
  append_pipeline_budget_metric

  local modes_json="[]"
  modes_json="$(
    {
      for mode in "${EXECUTION_MODES[@]}"; do
        status="${MODE_STATUS[$mode]:-skipped}"
        timing="${MODE_TIMINGS[$mode]:-}"
        if [[ -n "${timing}" ]]; then
          jq -cn --arg mode "${mode}" --arg status "${status}" --argjson seconds "${timing}" '{mode:$mode,status:$status,seconds:$seconds}'
        else
          jq -cn --arg mode "${mode}" --arg status "${status}" '{mode:$mode,status:$status}'
        fi
      done
    } | jq -s -c '.' 2>/dev/null || printf '[]'
  )"
  aegis_write_last_outcome \
    "${outcome_status}" "${outcome_reason}" "${outcome_class}" "${outcome_mode}" \
    "${PIPELINE}" "${PIPELINE_STATUS}" "${total}" "${modes_json}"
}

resolve_default_target() {
  [[ -n "${TARGET}" ]] && return 0
  if [[ -d "src" ]]; then
    TARGET="src"
  else
    TARGET="."
  fi
}

parse_cli() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      readonly|mutation)
        PIPELINE="$1"
        shift
        ;;
      --pipeline)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --pipeline requires an argument" >&2; exit 1; }
        PIPELINE="$2"
        shift 2
        ;;
      --resume)
        RESUME=true
        shift
        ;;
      --fresh)
        FRESH_INVESTIGATION=true
        shift
        ;;
      --until)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --until requires a mode argument" >&2; exit 1; }
        UNTIL="$2"
        shift 2
        ;;
      --target)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --target requires a path argument" >&2; exit 1; }
        TARGET="$2"
        shift 2
        ;;
      --issue)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --issue requires an issue number argument" >&2; exit 1; }
        ISSUE_NUMBER="$2"
        shift 2
        ;;
      --task)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --task requires a 1-based task number" >&2; exit 1; }
        ISSUE_TASK="$2"
        shift 2
        ;;
      --from-fit)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --from-fit requires a path argument" >&2; exit 1; }
        FROM_FIT="$2"
        shift 2
        ;;
      --unit)
        [[ $# -ge 2 ]] || { echo "[RUN][FATAL] --unit requires an index argument" >&2; exit 1; }
        FIT_UNIT="$2"
        shift 2
        ;;
      --force-apply)
        FORCE_APPLY=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        POSITIONAL+=("$1")
        shift
        ;;
    esac
  done
}

resolve_pipeline_input() {
  if [[ -n "${FROM_FIT}" ]]; then
    local fit_path="${FROM_FIT}"
    [[ -d "${FROM_FIT}" ]] && fit_path="${FROM_FIT}/fit.json"
    [[ -f "${fit_path}" ]] || { echo "[RUN][FATAL] from_fit_missing: ${fit_path}" >&2; exit 1; }
    FIT_CHECK_JSON="$(cat "${fit_path}")"
    local unit_idx="${FIT_UNIT:-0}"
    [[ "${unit_idx}" =~ ^[0-9]+$ ]] || { echo "[RUN][FATAL] unit_not_integer: ${unit_idx}" >&2; exit 1; }
    local n_units
    n_units="$(printf '%s' "${FIT_CHECK_JSON}" | jq '.proposed_units | length' 2>/dev/null || echo 0)"
    if [[ "${unit_idx}" -ge "${n_units}" ]]; then
      echo "[RUN][FATAL] unit_out_of_range: ${unit_idx} (have ${n_units})" >&2
      exit 1
    fi
    INVESTIGATION_INPUT="$(printf '%s' "${FIT_CHECK_JSON}" | jq -r --argjson i "${unit_idx}" '.proposed_units[$i].demand // empty')"
    if [[ -z "$(printf '%s' "${INVESTIGATION_INPUT}" | tr -d '[:space:]')" ]]; then
      local unit_md="$(dirname "${fit_path}")/unit-${unit_idx}.md"
      [[ -f "${unit_md}" ]] && INVESTIGATION_INPUT="$(cat "${unit_md}")"
    fi
    [[ -n "$(printf '%s' "${INVESTIGATION_INPUT}" | tr -d '[:space:]')" ]] || {
      echo "[RUN][FATAL] from_fit_unit_empty: ${unit_idx}" >&2
      exit 1
    }
    ISSUE_NUMBER=""
    ISSUE_TASK=""
    FRESH_INVESTIGATION=true
    echo "[RUN] from_fit unit=${unit_idx} title=$(printf '%s' "${FIT_CHECK_JSON}" | jq -r --argjson i "${unit_idx}" '.proposed_units[$i].title // "?"')"
  elif [[ -n "${ISSUE_NUMBER}" ]]; then
    INVESTIGATION_INPUT=""
    if [[ -n "${ISSUE_TASK}" ]]; then
      [[ "${ISSUE_TASK}" =~ ^[1-9][0-9]*$ ]] || { echo "[RUN][FATAL] invalid_task_number: ${ISSUE_TASK}" >&2; exit 1; }
      export AEGIS_ISSUE_NUMBER="${ISSUE_NUMBER}"
      export AEGIS_ISSUE_TASK="${ISSUE_TASK}"
    else
      export AEGIS_ISSUE_NUMBER="${ISSUE_NUMBER}"
      unset AEGIS_ISSUE_TASK 2>/dev/null || true
    fi
  elif [[ "${#POSITIONAL[@]}" -gt 0 ]]; then
    INVESTIGATION_INPUT="${POSITIONAL[*]}"
    if [[ -n "${ISSUE_TASK}" ]]; then
      [[ "${ISSUE_TASK}" =~ ^[1-9][0-9]*$ ]] || { echo "[RUN][FATAL] invalid_task_number: ${ISSUE_TASK}" >&2; exit 1; }
      export AEGIS_ISSUE_TASK="${ISSUE_TASK}"
    fi
  else
    INVESTIGATION_INPUT="Analyze repository"
  fi

  if [[ -n "${ISSUE_TASK}" && -z "${ISSUE_NUMBER}" && -z "${FROM_FIT}" && "${#POSITIONAL[@]}" -eq 0 ]]; then
    echo "[RUN][FATAL] task_requires_issue_or_demand" >&2
    exit 1
  fi
}

main() {
  parse_cli "$@"

  if [[ "${FRESH_INVESTIGATION}" == "true" && "${RESUME}" == "true" ]]; then
    mkdir -p "$(dirname "${LAST_FATAL_FILE}")" 2>/dev/null || true
    printf '%s\n' "fresh_resume_conflict" > "${LAST_FATAL_FILE}" 2>/dev/null || true
    echo "[RUN][FATAL] fresh_resume_conflict" >&2
    exit 1
  fi

  resolve_default_target
  [[ -n "${PIPELINES[$PIPELINE]:-}" ]] || { echo "[RUN][FATAL] unknown pipeline: ${PIPELINE}" >&2; exit 1; }

  resolve_pipeline_input
  check_dependencies

  # Optional demand fit check gate
  if [[ "${AEGIS_FIT_CHECK:-0}" == "1" || "${AEGIS_FIT_CHECK:-0}" == "true" ]] \
    && [[ "${PIPELINE}" == "mutation" && "${RESUME}" != "true" ]]; then
    local fit_json fit_rc=0
    if [[ -n "${ISSUE_NUMBER}" ]]; then
      fit_json="$(bash scripts/fit_check_demand.sh --issue "${ISSUE_NUMBER}" 2>/tmp/aegis_fit_err.txt)" || fit_rc=$?
    else
      fit_json="$(printf '%s' "${INVESTIGATION_INPUT}" | bash scripts/fit_check_demand.sh 2>/tmp/aegis_fit_err.txt)" || fit_rc=$?
      if [[ "${fit_rc}" -eq 0 ]]; then
        INVESTIGATION_INPUT="$(printf '%s' "${fit_json}" | jq -r '.fixed_demand')"
      fi
    fi
    if [[ "${fit_rc}" -ne 0 ]]; then
      echo "[RUN][FATAL] fit_check_blocked — demand does not fit rails/model budget" >&2
      [[ -f /tmp/aegis_fit_err.txt ]] && cat /tmp/aegis_fit_err.txt >&2 || true
      printf '%s\n' "${fit_json}" | jq '{run_allowed,model_fit,score,blockers,warnings,proposed_units,auto_fixes_applied}' 2>/dev/null || true
      exit 1
    fi
    FIT_CHECK_JSON="${fit_json}"
    echo "[RUN] fit_check ok model_fit=$(printf '%s' "${fit_json}" | jq -r '.model_fit') score=$(printf '%s' "${fit_json}" | jq -r '.score')"
  fi

  if $RESUME; then
    resolve_resume
  else
    build_mode_list
  fi

  clear_pipeline_metrics

  if ! assert_demand_targets_not_dirty; then
    PIPELINE_STATUS="FAILED"
    PIPELINE_REASON="demand target has uncommitted work"
    show_final_report
    exit 1
  fi

  if [[ "${FRESH_INVESTIGATION}" == "true" ]]; then
    if [[ ! -f "${HANDOVER_FILE}" ]] || [[ -z "$(jq -r '.artifact_snapshot.mode // empty' "${HANDOVER_FILE}" 2>/dev/null || true)" ]]; then
      clear_operator_breadcrumbs
    fi
  else
    clear_operator_breadcrumbs
  fi
  prune_pipeline_evidence_cache

  local mode
  local final_mode="${EXECUTION_MODES[${#EXECUTION_MODES[@]}-1]}"
  if [[ -n "${UNTIL:-}" ]]; then
    final_mode="${UNTIL}"
  fi

  for mode in "${EXECUTION_MODES[@]}"; do
    # Agentic pause check for optimize / adversarial
    if [[ "${AEGIS_AGENTIC:-0}" == "1" ]] && { [[ "${mode}" == "optimize" ]] || [[ "${mode}" == "adversarial" ]]; }; then
      local _vfile
      _vfile="$(agentic_verdict_file_for "${mode}")"
      if [[ -n "${_vfile}" && ! -f "${_vfile}" ]]; then
        emit_agentic_mode_pause "${mode}" "${_vfile}"
        mark_remaining_skipped
        MODE_STATUS["${mode}"]="paused"
        PIPELINE_STATUS="PENDING_ASSISTANT"
        PIPELINE_REASON="${mode}_awaiting_assistant"
        break
      fi
      export AEGIS_AGENTIC_VERDICT_FILE="${_vfile}"
      aegis_log "agentic ${mode}: verdict file presente — sintetizando artifact"
    fi

    # Pre-mode check: halt before mutation if forensics was empty/inconclusive
    if [[ "${mode}" == "mutation" && -f "${HANDOVER_FILE}" ]]; then
      if pipeline_should_halt_after_mode "forensics"; then
        MODE_STATUS["${mode}"]="halted"
        mark_remaining_skipped
        break
      fi
    fi

    if [[ "${mode}" == "${final_mode}" ]]; then
      if ! run_mode "${mode}" true; then
        mark_remaining_skipped
        break
      fi
    else
      if ! run_mode "${mode}"; then
        mark_remaining_skipped
        break
      fi
    fi

    # Post-mode check
    if pipeline_should_halt_after_mode "${mode}"; then
      mark_remaining_skipped
      local m
      for m in "${EXECUTION_MODES[@]}"; do
        if [[ "${MODE_STATUS[$m]:-}" == "skipped" ]]; then
          MODE_STATUS["${m}"]="halted"
          break
        fi
      done
      break
    fi

    # Check if internal feedback already ran subsequent modes
    if pipeline_handover_past_mode "${mode}"; then
      local _hmode
      _hmode="$(jq -r '.artifact_snapshot.mode // empty' "${HANDOVER_FILE}" 2>/dev/null || true)"
      echo "[RUN] Handover already at ${_hmode} after ${mode} (internal feedback) — not re-running remainder."
      mark_modes_nested_after "${mode}" "${_hmode}"
      mark_remaining_skipped
      unset _hmode
      break
    fi

    if [[ -n "${UNTIL:-}" && "${mode}" == "${UNTIL}" ]]; then
      echo "[RUN] Stopped at mode ${mode} due to --until limit."
      mark_remaining_skipped
      break
    fi
  done

  show_final_report

  if [[ "${PIPELINE_STATUS}" == "FAILED" ]]; then
    exit 1
  fi
  if [[ "${PIPELINE_STATUS}" == "PENDING_ASSISTANT" ]]; then
    exit 3
  fi
}

main "$@"
