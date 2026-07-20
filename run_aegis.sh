#!/usr/bin/env bash

# =========================================================
# AEGIS RUN ORCHESTRATOR (KISS)
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

# Pipeline driver owns the single run-level outcome projection.
# Runtime cleanup must not emit outcome when this is set (avoids
# double human block + N mode-level outcome lines).
export AEGIS_PIPELINE_DRIVER=1

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
source "scripts/lib/run_outcome.sh"
AEGIS_LOG_TAG="RUN"

# Repair stamps tools for adversarial reuse during the pipeline.
# Drop after the orchestrator exits (success, fail, halt, or signal).
# Path jail: only remove dirs whose path contains candidate_tools_stamp and
# no ".." segments — never rm -rf an arbitrary AEGIS_CANDIDATE_TOOLS_STAMP_DIR.
aegis_run_remove_candidate_tools_stamp() {
  if [[ "${AEGIS_RUNTIME_REMOVE_CANDIDATE_TOOLS_STAMP:-true}" == "0" ]] \
    || [[ "${AEGIS_RUNTIME_REMOVE_CANDIDATE_TOOLS_STAMP:-true}" == "false" ]]; then
    return 0
  fi
  local stamp_dir="${AEGIS_CANDIDATE_TOOLS_STAMP_DIR:-.harness/runtime/candidate_tools_stamp}"
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
trap aegis_run_remove_candidate_tools_stamp EXIT

usage() {
  cat <<'EOF'
Usage: ./run_aegis.sh [readonly] [options] [investigation input...]

Pipelines:
  (default)            mutation: discovery -> forensics -> repair
                       -> optimize -> adversarial -> validation
  mutation_lite        discovery -> forensics -> repair -> validation
                       (no optimize/adversarial; good for weak models)
  readonly             discovery -> forensics

  Env: AEGIS_MUTATION_LITE=1|true  force lite when pipeline is mutation
       AEGIS_MUTATION_LITE=auto    lite if fit_check score is low (needs
                                   AEGIS_FIT_CHECK=1) and targets_count<=1

Options:
  --pipeline NAME      mutation|mutation_lite|readonly
  --resume             Continue from the mode after the last
                       .harness/runtime/epistemic_handover.json snapshot
  --fresh              Start a new investigation: wipe handover (and
                       last_good_*) before the pipeline, then bind the
                       new demand from discovery. Mutually exclusive
                       with --resume.
  --until MODE         Stop after MODE completes
  --target PATH        Evidence target directory (default: src or .)
  --issue N            Fetch GitHub issue #N (title+body via gh) as demand
  --force-apply        Operator override: on the FINAL executed mode of a
                       partial run (e.g. with --until optimize), promote the
                       candidate diff into the working directory even without
                       an accepted validation verdict. All structural rails
                       (path jail, files_changed cross-check, dirty-target
                       refusal, atomic apply) still gate the promotion.
  --help               Show this help

Any mode failure aborts the remaining pipeline. Intelligent early-exit
halts mutation after forensics when status is inconclusive or no
repair_candidates exist (no wasted repair/optimize LLM). Rejected
validation re-enters a local repair feedback loop (no rediscovery).

The final report always shows per-mode status/timings, stage budget
share, hot timing spans, verdict, structured repair feedback (when
present), and pipeline status (SUCCESS | HALTED | FAILED).
EOF
}

declare -A PIPELINES=(
  [readonly]="discovery forensics"
  [mutation]="discovery forensics repair optimize adversarial validation"
  [mutation_lite]="discovery forensics repair validation"
)

PIPELINE="mutation"
# Last fit-check JSON (optional); used by AEGIS_MUTATION_LITE=auto
FIT_CHECK_JSON=""
TARGET=""
RESUME=false
FRESH_INVESTIGATION=false
UNTIL=""
FORCE_APPLY=false
ISSUE_NUMBER=""
INVESTIGATION_INPUT=""
declare -a POSITIONAL=()

readonly LAST_GOOD_HANDOVER_FILE=".harness/runtime/last_good_epistemic_handover.json"

declare -A MODE_TIMINGS
declare -A MODE_STATUS
declare -a EXECUTION_MODES

# Pipeline outcome — honest operator signal, not cosmetic SUCCESS.
PIPELINE_STATUS="SUCCESS"
PIPELINE_REASON=""

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[RUN][FATAL] missing dependency: $1" >&2
    exit 1
  }
}

pipeline_is_mutation_family() {
  case "${PIPELINE}" in
    mutation|mutation_lite) return 0 ;;
    *) return 1 ;;
  esac
}

check_dependencies() {
  require jq
  require git
  if pipeline_is_mutation_family; then
    require aider
  fi
}

# Successor in the active pipeline order (mutation vs mutation_lite).
next_mode() {
  printf '%s\n' "$(aegis_next_in_sequence "$1" "${PIPELINES[$PIPELINE]}")"
}

# Apply AEGIS_MUTATION_LITE / auto after optional fit check.
maybe_apply_mutation_lite() {
  local flag="${AEGIS_MUTATION_LITE:-0}"
  [[ "${PIPELINE}" == "mutation" ]] || return 0

  case "${flag}" in
    1|true|yes|lite)
      PIPELINE="mutation_lite"
      echo "[RUN] mutation_lite enabled (AEGIS_MUTATION_LITE=${flag})"
      return 0
      ;;
    auto)
      if [[ -n "${FIT_CHECK_JSON}" ]]; then
        local score tc
        score="$(printf '%s' "${FIT_CHECK_JSON}" | jq -r '.score // 99' 2>/dev/null || echo 99)"
        tc="$(printf '%s' "${FIT_CHECK_JSON}" | jq -r '.targets_count // 99' 2>/dev/null || echo 99)"
        local max_score="${AEGIS_MUTATION_LITE_MAX_SCORE:-2}"
        if [[ "${score}" =~ ^[0-9]+$ && "${tc}" =~ ^[0-9]+$ ]] \
          && [[ "${score}" -le "${max_score}" ]] \
          && [[ "${tc}" -le 1 ]]; then
          PIPELINE="mutation_lite"
          echo "[RUN] mutation_lite auto (fit score=${score} targets=${tc} max_score=${max_score})"
        else
          echo "[RUN] mutation_lite auto skipped (score=${score} targets=${tc})"
        fi
      else
        echo "[RUN] mutation_lite auto skipped (no fit_check JSON; set AEGIS_FIT_CHECK=1)"
      fi
      ;;
  esac
}

# True when runtime internal feedback already advanced the handover past
# the mode we just ran (e.g. optimize can_improve → repair → … → validation
# inside one process). Prevents re-running adversarial/validation.
pipeline_handover_past_mode() {
  local just_ran="$1"
  [[ -f "${HANDOVER_FILE}" ]] || return 1
  local hmode
  hmode="$(jq -r '.artifact_snapshot.mode // empty' "${HANDOVER_FILE}" 2>/dev/null || true)"
  [[ -n "${hmode}" ]] || return 1
  [[ "${hmode}" != "${just_ran}" ]] || return 1

  local seq="${PIPELINES[$PIPELINE]:-}"
  [[ -n "${seq}" ]] || return 1
  local m idx_ran=-1 idx_h=-1 i=0
  for m in ${seq}; do
    if [[ "${m}" == "${just_ran}" ]]; then idx_ran="${i}"; fi
    if [[ "${m}" == "${hmode}" ]]; then idx_h="${i}"; fi
    i=$((i + 1))
  done
  [[ "${idx_ran}" -ge 0 && "${idx_h}" -ge 0 ]] || return 1
  [[ "${idx_h}" -gt "${idx_ran}" ]]
}

resolve_resume() {

  [[ -f "${HANDOVER_FILE}" ]] || {
    echo "[RUN][FATAL] handover not found"
    exit 1
  }

  local last_mode

  last_mode="$(
    jq -r '.artifact_snapshot.mode // empty' \
      "${HANDOVER_FILE}"
  )"

  local resume_from

  resume_from="$(next_mode "${last_mode}")"

  [[ -n "${resume_from}" ]] || {
    echo "[RUN] nothing to resume"
    exit 0
  }

  local found=false
  local mode

  for mode in ${PIPELINES[$PIPELINE]}; do

    if [[ "${mode}" == "${resume_from}" ]]; then
      found=true
    fi

    $found && EXECUTION_MODES+=("${mode}")
  done

}

build_mode_list() {

  local mode

  for mode in ${PIPELINES[$PIPELINE]}; do
    EXECUTION_MODES+=("${mode}")
  done

}

# Mark every mode after the first without a status as skipped.
mark_remaining_skipped() {
  local mode
  for mode in "${EXECUTION_MODES[@]}"; do
    if [[ -z "${MODE_STATUS[$mode]:-}" ]]; then
      MODE_STATUS["${mode}"]="skipped"
    fi
  done
}

# Modes between just_ran (exclusive) and end_mode (inclusive) ran inside
# the just_ran process as internal feedback — not as outer orchestrator steps.
mark_modes_nested_after() {
  local just_ran="$1"
  local end_mode="$2"
  local seq="${PIPELINES[$PIPELINE]:-}"
  local m past=0
  [[ -n "${end_mode}" ]] || return 0
  for m in ${seq}; do
    if [[ "${m}" == "${just_ran}" ]]; then
      past=1
      continue
    fi
    if [[ "${past}" -eq 1 ]]; then
      if [[ -z "${MODE_STATUS[$m]:-}" ]]; then
        MODE_STATUS["${m}"]="nested"
        MODE_TIMINGS["${m}"]="${MODE_TIMINGS[$m]:-}"
      fi
      [[ "${m}" == "${end_mode}" ]] && break
    fi
  done
}

clear_operator_breadcrumbs() {
  rm -f "${LAST_FATAL_FILE}" 2>/dev/null || true

  # --fresh: atomic investigation rebind at the orchestrator only.
  # Total reset — last_good_* must go too so recovery cannot resurrect
  # the previous demand. Runtime resolve_runtime_investigation_input
  # stays fail-hard and is never relaxed.
  if [[ "${FRESH_INVESTIGATION}" == "true" ]]; then
    rm -f "${HANDOVER_FILE}" "${LAST_GOOD_HANDOVER_FILE}" 2>/dev/null || true
  fi
}

# Wipe the intra-pipeline evidence cache so modes never reuse payloads
# from a previous pipeline run (investigation input may have changed).
clear_pipeline_evidence_cache() {
  local cache_dir="${AEGIS_EVIDENCE_CACHE_DIR:-.harness/runtime/evidence_cache}"
  if [[ -d "${cache_dir}" ]]; then
    rm -rf "${cache_dir}"
  fi
  mkdir -p "${cache_dir}" 2>/dev/null || true
}

clear_pipeline_metrics() {
  mkdir -p "$(dirname "${METRICS_FILE}")" 2>/dev/null || true
  : > "${METRICS_FILE}"
  export AEGIS_METRICS_FILE="${METRICS_FILE}"
}

# Post-forensics early-exit. 0 = HALT (status set); 1 = continue.
pipeline_should_halt_after_mode() {
  local mode="$1"
  [[ "${mode}" == "forensics" ]] || return 1
  [[ -f "${HANDOVER_FILE}" ]] || return 1

  local forensics_status candidate_count
  forensics_status="$(
    jq -r '
      .artifact_snapshot.operational_context.status
      // .artifact_snapshot.status // empty
    ' "${HANDOVER_FILE}" 2>/dev/null || true
  )"
  candidate_count="$(
    jq -r '
      (.artifact_snapshot.operational_context.repair_candidates // []) | length
    ' "${HANDOVER_FILE}" 2>/dev/null || echo 0
  )"

  if [[ "${forensics_status}" == "inconclusive" ]]; then
    echo
    echo "[RUN] Forensics inconclusive — no mutation surface justified. Halting before repair."
    PIPELINE_STATUS="HALTED"
    PIPELINE_REASON="forensics inconclusive"
    return 0
  fi

  if [[ "${candidate_count}" -eq 0 ]]; then
    echo
    echo "[RUN] No repair candidates proposed. Halting pipeline to collect more evidence."
    PIPELINE_STATUS="HALTED"
    PIPELINE_REASON="no repair candidates in forensics handover"
    return 0
  fi

  return 1
}

record_mode_handover_metric() {
  local mode="$1"
  local duration="$2"
  local status="$3"

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
        forensics_status: (
          if $mode == "forensics" then
            (.artifact_snapshot.operational_context.status // null)
          else null end
        ),
        repair_candidates: (
          (.artifact_snapshot.operational_context.repair_candidates // [])
          | length
        ),
        findings: (
          (.artifact_snapshot.operational_context.findings // [])
          | length
        ),
        files_changed: (
          (
            .artifact_snapshot.operational_context.candidate_result.files_changed
            // .artifact_snapshot.operational_context.files_changed
            // .artifact_snapshot.operational_context.validated_candidate.files_changed
            // []
          ) | length
        )
      }
    ' "${HANDOVER_FILE}" >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

run_mode() {

  local mode="$1"
  local is_final_mode="${2:-false}"

  echo
  echo "================================================="
  echo "MODE: ${mode}"
  echo "================================================="

  local start
  local end
  local duration
  local rc=0

  # Portable epoch via date subshell (macOS Bash 3.2 lacks printf %(...)T).
  start=$(date +%s)

  local cmd=(bash runtime_aegis.sh "${mode}")
  if [[ -n "${TARGET}" ]]; then
    cmd+=("--target" "${TARGET}")
  fi
  # Force-apply is scoped to the FINAL executed mode only, so an operator
  # override can never promote an intermediate candidate mid-pipeline.
  if [[ "${FORCE_APPLY}" == "true" ]] && [[ "${is_final_mode}" == "true" ]]; then
    cmd+=("--force-apply")
  fi
  if [[ -n "${ISSUE_NUMBER}" ]]; then
    cmd+=("--issue" "${ISSUE_NUMBER}")
  fi
  if [[ -n "${INVESTIGATION_INPUT}" ]]; then
    cmd+=("${INVESTIGATION_INPUT}")
  fi

  # Capture failure without losing timing or the final report path.
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

# Single jq projection: all operator-facing handover fields, or empty object.
handover_report_fields() {
  if [[ ! -f "${HANDOVER_FILE}" ]]; then
    printf '%s\n' '{}'
    return
  fi

  jq -c '
    {
      mode: (.artifact_snapshot.mode // empty),
      verdict: (.artifact_snapshot.operational_context.verdict // empty),
      attention: (
        .epistemic_state.next_attention_targets // []
        | map(select(type == "string" and length > 0))
        | .[0:8]
      ),
      violations: (
        .artifact_snapshot.operational_context.repair_feedback.violations // []
        | map({
            severity: (.severity // "unspecified"),
            origin: (.origin // "unspecified"),
            reason: (.structural_reason // ""),
            files: (.target_files // [])
          })
        | .[0:5]
      ),
      basis: (
        .artifact_snapshot.operational_context.basis // []
        | if type == "string" then [.] else . end
        | map(select(type == "string" and length > 0))
        | .[0:5]
      )
    }
  ' "${HANDOVER_FILE}" 2>/dev/null || printf '%s\n' '{}'
}

show_final_report() {

  local total=0
  local mode
  local status
  local mark
  local timing
  local fields
  local last_fatal=""

  echo
  echo "══════════════════════════════"
  echo "AEGIS RUN REPORT"
  echo "══════════════════════════════"
  echo
  echo "Pipeline: ${PIPELINE}"
  echo "Status:   ${PIPELINE_STATUS}"
  if [[ -n "${PIPELINE_REASON}" ]]; then
    echo "Reason:   ${PIPELINE_REASON}"
  fi
  if [[ -f "${LAST_FATAL_FILE}" ]]; then
    last_fatal="$(tr -d '\r' < "${LAST_FATAL_FILE}" | head -n 1)"
    if [[ -n "${last_fatal}" ]]; then
      echo "Fatal:    ${last_fatal}"
    fi
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

  # Optimize metrics (if any) — clarifies can_improve vs trivial skip vs LLM.
  if [[ -f "${METRICS_FILE}" ]] \
    && grep -q '"kind":"optimize"' "${METRICS_FILE}" 2>/dev/null; then
    echo
    echo "Optimize:"
    jq -r '
      select(.kind == "optimize")
      | "  - \(.result)"
        + (if (.detail // "") != "" then " (\(.detail))" else "" end)
    ' "${METRICS_FILE}" 2>/dev/null | tail -n 8 || true
  fi

  echo
  echo "Total: ${total}s"
  echo

  # Stage budget telemetry (Tier 2): wall time share + handover signals.
  if [[ -f "${METRICS_FILE}" ]] && [[ -s "${METRICS_FILE}" ]]; then
    echo "Stage budget:"
    jq -r -s --argjson total "${total}" '
      map(select(.kind == "mode"))
      | .[]
      | (.seconds // 0) as $s
      | (if $total > 0 then (($s * 100 / $total) | floor) else 0 end) as $pct
      | "  \(.mode)\t\($s)s\t\($pct)%"
        + (if .verdict != null then "  verdict=\(.verdict)" else "" end)
        + (if .forensics_status != null then "  status=\(.forensics_status)" else "" end)
        + (if (.repair_candidates // 0) > 0 then "  candidates=\(.repair_candidates)" else "" end)
        + (if (.findings // 0) > 0 then "  findings=\(.findings)" else "" end)
        + (if (.files_changed // 0) > 0 then "  files=\(.files_changed)" else "" end)
    ' "${METRICS_FILE}" 2>/dev/null || true

    local top_timing
    top_timing="$(
      jq -r -s '
        map(select(.kind == "timing"))
        | sort_by(-.seconds)
        | .[0:5]
        | .[]
        | "  \(.label): \(.seconds)s"
      ' "${METRICS_FILE}" 2>/dev/null || true
    )"
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

    if [[ -n "${h_mode}" ]]; then
      echo "Final Mode: ${h_mode}"
    fi
    if [[ -n "${h_verdict}" ]]; then
      echo "Verdict:    ${h_verdict}"
    fi

    if jq -e '(.basis | length) > 0' <<<"${fields}" >/dev/null 2>&1; then
      echo
      echo "Basis:"
      jq -r '.basis[] | "  - \(.)"' <<<"${fields}"
    fi

    if jq -e '(.violations | length) > 0' <<<"${fields}" >/dev/null 2>&1; then
      echo
      echo "Repair Feedback (top violations):"
      jq -r '
        .violations[]
        | "  - [\(.severity)] \(.origin): \(.reason)"
          + (if (.files | length) > 0
             then " (" + (.files | join(", ")) + ")"
             else "" end)
      ' <<<"${fields}"
    fi

    if jq -e '(.attention | length) > 0' <<<"${fields}" >/dev/null 2>&1; then
      echo
      echo "Attention:"
      jq -r '.attention[] | "  - \(.)"' <<<"${fields}"
    fi

    echo
  fi

  echo "══════════════════════════════"

  # Outcome projection (Fable path D): classify + human block + metrics line.
  # Precedence: last_fatal → FAILED; FAILED without breadcrumb → harness_bug
  # token; PIPELINE_STATUS HALTED → halt reason; else SUCCESS.
  local outcome_status outcome_reason outcome_class outcome_mode
  outcome_mode=""
  for mode in "${EXECUTION_MODES[@]}"; do
    if [[ "${MODE_STATUS[$mode]:-}" == "failed" ]] \
      || [[ "${MODE_STATUS[$mode]:-}" == "ok" ]] \
      || [[ "${MODE_STATUS[$mode]:-}" == "halted" ]]; then
      outcome_mode="${mode}"
    fi
  done

  if [[ -n "${last_fatal}" ]]; then
    outcome_status="FAILED"
    outcome_reason="${last_fatal}"
  elif [[ "${PIPELINE_STATUS}" == "FAILED" ]]; then
    # set -u / bare exit often leave no aegis_fatal breadcrumb — still
    # classify so the operator is not left with Class: unknown / Reason: —.
    outcome_status="FAILED"
    outcome_reason="mode_exit_without_fatal_breadcrumb"
  elif [[ "${PIPELINE_STATUS}" == "HALTED" ]]; then
    outcome_status="HALTED"
    outcome_reason="${PIPELINE_REASON}"
  else
    outcome_status="SUCCESS"
    outcome_reason=""
  fi

  if [[ "${outcome_status}" == "SUCCESS" ]]; then
    outcome_class=""
  else
    aegis_classify_reason "${outcome_reason}" >/dev/null
    outcome_class="${AEGIS_OUTCOME_CLASS:-unknown}"
  fi

  aegis_emit_outcome_block "${outcome_status}" "${outcome_reason}"
  aegis_append_outcome_metric \
    "${outcome_status}" \
    "${outcome_reason}" \
    "${outcome_class}" \
    "${outcome_mode}"

  # Compact machine-readable summary for operators/CI (gitignored).
  local modes_json="[]"
  modes_json="$(
    {
      for mode in "${EXECUTION_MODES[@]}"; do
        status="${MODE_STATUS[$mode]:-skipped}"
        timing="${MODE_TIMINGS[$mode]:-}"
        if [[ -n "${timing}" ]]; then
          jq -cn \
            --arg mode "${mode}" \
            --arg status "${status}" \
            --argjson seconds "${timing}" \
            '{mode:$mode,status:$status,seconds:$seconds}'
        else
          jq -cn \
            --arg mode "${mode}" \
            --arg status "${status}" \
            '{mode:$mode,status:$status}'
        fi
      done
    } | jq -s -c '.' 2>/dev/null || printf '[]'
  )"
  aegis_write_last_outcome \
    "${outcome_status}" \
    "${outcome_reason}" \
    "${outcome_class}" \
    "${outcome_mode}" \
    "${PIPELINE}" \
    "${PIPELINE_STATUS}" \
    "${total}" \
    "${modes_json}"
}

resolve_default_target() {

  [[ -n "${TARGET:-}" ]] && return

  if [[ -d "src" ]]; then
    TARGET="src"
  else
    TARGET="."
  fi
}

parse_cli() {

  while [[ $# -gt 0 ]]; do

    case "$1" in

      readonly)
        PIPELINE="readonly"
        ;;

      --pipeline)
        shift
        [[ $# -gt 0 ]] || { echo "[RUN][FATAL] missing pipeline value" >&2; exit 1; }
        PIPELINE="$1"
        ;;

      --until)
        shift
        [[ $# -gt 0 ]] || { echo "[RUN][FATAL] missing until value" >&2; exit 1; }
        UNTIL="$1"
        ;;

      --resume)
        RESUME=true
        ;;

      --fresh)
        FRESH_INVESTIGATION=true
        ;;

      --force-apply)
        FORCE_APPLY=true
        ;;

      --help|-h)
        usage
        exit 0
        ;;

      --target)
        shift
        [[ $# -gt 0 ]] || { echo "[RUN][FATAL] missing target value" >&2; exit 1; }
        TARGET="$1"
        ;;

      --issue)
        shift
        [[ $# -gt 0 ]] || { echo "[RUN][FATAL] missing issue value" >&2; exit 1; }
        ISSUE_NUMBER="$1"
        ;;

      -*)
        echo "[RUN][FATAL] unknown argument: $1" >&2
        exit 1
        ;;

      *)
        POSITIONAL+=("$1")
        ;;

    esac

    shift
  done

}

main() {

  parse_cli "$@"

  # --fresh wipes the handover that --resume needs — operator contradiction.
  if [[ "${FRESH_INVESTIGATION}" == "true" ]] && [[ "${RESUME}" == "true" ]]; then
    mkdir -p "$(dirname "${LAST_FATAL_FILE}")" 2>/dev/null || true
    printf '%s\n' "fresh_resume_conflict" > "${LAST_FATAL_FILE}" 2>/dev/null || true
    echo "[RUN][FATAL] fresh_resume_conflict" >&2
    exit 1
  fi

  resolve_default_target

  [[ -n "${PIPELINES[$PIPELINE]:-}" ]] || {
    echo "[RUN][FATAL] unknown pipeline: ${PIPELINE}" >&2
    exit 1
  }

  # Resolve investigation input priority
  if [[ -n "${ISSUE_NUMBER}" ]]; then
    INVESTIGATION_INPUT=""
  elif [[ "${#POSITIONAL[@]}" -gt 0 ]]; then
    INVESTIGATION_INPUT="${POSITIONAL[*]}"
  else
    INVESTIGATION_INPUT="Analyze repository"
  fi

  check_dependencies

  # Optional demand fit gate (rails + weak-model budget). Scout / CI:
  #   AEGIS_FIT_CHECK=1 ./run_aegis.sh --fresh --pipeline mutation --issue N
  # Free-text: auto-fixed demand may replace INVESTIGATION_INPUT.
  # Issue bodies: check only — edit GitHub if blocked. See fit_check_demand.sh.
  if [[ "${AEGIS_FIT_CHECK:-0}" == "1" || "${AEGIS_FIT_CHECK:-0}" == "true" ]] \
    && pipeline_is_mutation_family \
    && [[ "${RESUME}" != "true" ]]; then
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

  maybe_apply_mutation_lite

  if $RESUME; then
    resolve_resume
  else
    build_mode_list
  fi

  clear_operator_breadcrumbs
  clear_pipeline_evidence_cache
  clear_pipeline_metrics

  local mode
  local final_mode="${EXECUTION_MODES[${#EXECUTION_MODES[@]}-1]}"
  if [[ -n "${UNTIL:-}" ]]; then
    final_mode="${UNTIL}"
  fi

  for mode in "${EXECUTION_MODES[@]}"; do
    # Pre-mode gate: entering repair re-checks the forensics handover so
    # we never spend mutation budget on inconclusive / empty candidates.
    if [[ "${mode}" == "repair" ]] && [[ -f "${HANDOVER_FILE}" ]]; then
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

    # Post-mode early-exit (forensics inconclusive / empty candidates).
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

    # Internal feedback consumed downstream modes in this process.
    if pipeline_handover_past_mode "${mode}"; then
      local _hmode
      _hmode="$(jq -r '.artifact_snapshot.mode // empty' "${HANDOVER_FILE}" 2>/dev/null || true)"
      echo "[RUN] Handover already at ${_hmode} after ${mode} (internal feedback) — not re-running remainder."
      mark_modes_nested_after "${mode}" "${_hmode}"
      mark_remaining_skipped
      unset _hmode
      break
    fi

    if [[ -n "${UNTIL:-}" ]] && [[ "${mode}" == "${UNTIL}" ]]; then
      echo "[RUN] Stopped at mode ${mode} due to --until limit."
      mark_remaining_skipped
      break
    fi
  done

  show_final_report
  # candidate_tools_stamp removed by EXIT trap (aegis_run_remove_candidate_tools_stamp)

  if [[ "${PIPELINE_STATUS}" == "FAILED" ]]; then
    exit 1
  fi
}

main "$@"
