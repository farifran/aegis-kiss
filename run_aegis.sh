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

usage() {
  cat <<'EOF'
Usage: ./run_aegis.sh [readonly] [options] [investigation input...]

Pipelines:
  (default)            mutation: discovery -> forensics -> repair
                       -> optimize -> adversarial -> validation
  readonly             discovery -> forensics

Options:
  --pipeline NAME      Select pipeline by name (mutation|readonly)
  --resume             Continue from the mode after the last
                       .harness/runtime/epistemic_handover.json snapshot
  --until MODE         Stop after MODE completes
  --target PATH        Evidence target directory (default: src or .)
  --issue N            Investigate GitHub issue #N
  --force-apply        Operator override: on the FINAL executed mode of a
                       partial run (e.g. with --until optimize), promote the
                       candidate diff into the working directory even without
                       an accepted validation verdict. All structural rails
                       (path jail, files_changed cross-check, dirty-target
                       refusal, atomic apply) still gate the promotion.
  --help               Show this help

Any mode failure aborts the remaining pipeline. The final report always
shows per-mode status/timings, total duration, verdict, structured
repair feedback (when present), and pipeline status
(SUCCESS | HALTED | FAILED).
EOF
}

declare -A PIPELINES=(
  [readonly]="discovery forensics"
  [mutation]="discovery forensics repair optimize adversarial validation"
)

PIPELINE="mutation"
TARGET=""
RESUME=false
UNTIL=""
FORCE_APPLY=false
ISSUE_NUMBER=""
INVESTIGATION_INPUT=""
declare -a POSITIONAL=()

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

check_dependencies() {

  echo
  echo "Checking requirements..."
  echo

  require jq
  echo "jq           ✓"

  require git
  echo "git          ✓"

  if [[ "${PIPELINE}" == "mutation" ]]; then
    require aider
    echo "aider        ✓"
  fi

  echo
}

# Successor lookup derived from the authoritative PIPELINES definition —
# the full mutation sequence is the single source of mode order.
next_mode() {

  local -a sequence
  read -r -a sequence <<< "${PIPELINES[mutation]}"

  local i
  for i in "${!sequence[@]}"; do
    if [[ "${sequence[$i]}" == "$1" ]]; then
      echo "${sequence[$((i + 1))]:-}"
      return
    fi
  done

  echo ""
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

clear_operator_breadcrumbs() {
  rm -f "${LAST_FATAL_FILE}" 2>/dev/null || true
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
    return "${rc}"
  fi

  MODE_STATUS["${mode}"]="ok"
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
      failed) mark="✗" ;;
      halted) mark="◼" ;;
      *) mark="—" ;;
    esac

    if [[ -n "${timing}" ]]; then
      printf "  %-12s %s  %ss\n" "${mode}" "${mark}" "${timing}"
      total=$((total + timing))
    else
      printf "  %-12s %s  %s\n" "${mode}" "${mark}" "${status}"
    fi
  done

  echo
  echo "Total: ${total}s"
  echo

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

  if $RESUME; then
    resolve_resume
  else
    build_mode_list
  fi

  clear_operator_breadcrumbs
  clear_pipeline_evidence_cache

  local mode
  local final_mode="${EXECUTION_MODES[${#EXECUTION_MODES[@]}-1]}"
  if [[ -n "${UNTIL:-}" ]]; then
    final_mode="${UNTIL}"
  fi

  for mode in "${EXECUTION_MODES[@]}"; do
    if [[ "${mode}" == "repair" ]] && [[ -f "${HANDOVER_FILE}" ]]; then
      local candidate_count
      candidate_count="$(
        jq -r '
          (.artifact_snapshot.operational_context.repair_candidates // [])
          | length
        ' "${HANDOVER_FILE}" 2>/dev/null || echo 0
      )"
      if [[ "${candidate_count}" -eq 0 ]]; then
        echo
        echo "[RUN] No repair candidates proposed. Halting pipeline to collect more evidence."
        MODE_STATUS["${mode}"]="halted"
        PIPELINE_STATUS="HALTED"
        PIPELINE_REASON="no repair candidates in forensics handover"
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

    if [[ -n "${UNTIL:-}" ]] && [[ "${mode}" == "${UNTIL}" ]]; then
      echo "[RUN] Stopped at mode ${mode} due to --until limit."
      mark_remaining_skipped
      break
    fi
  done

  show_final_report

  if [[ "${PIPELINE_STATUS}" == "FAILED" ]]; then
    exit 1
  fi
}

main "$@"
