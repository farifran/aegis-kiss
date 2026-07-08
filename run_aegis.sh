#!/usr/bin/env bash

# =========================================================
# AEGIS RUN ORCHESTRATOR (KISS)
# =========================================================
#
# Fail-fast pipeline driver over runtime_aegis.sh; run with
# --help for operator usage. Ends with a timing/verdict report.
#
# =========================================================

set -Eeuo pipefail

readonly HANDOVER_FILE=".harness/runtime/epistemic_handover.json"

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
  --help               Show this help

Any failure aborts immediately. A final report shows per-mode
timings, total duration, final mode, attention targets, and verdict.
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
ISSUE_NUMBER=""
INVESTIGATION_INPUT=""
declare -a POSITIONAL=()

declare -A MODE_TIMINGS
declare -a EXECUTION_MODES

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[RUN][FATAL] missing dependency: $1" >&2
    exit 1
  }
}

pipeline_contains_mutation() {
  [[ "${PIPELINE}" == "mutation" ]]
}

check_dependencies() {

  echo
  echo "Checking requirements..."
  echo

  require jq
  echo "jq           ✓"

  require git
  echo "git          ✓"

  if pipeline_contains_mutation; then
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

run_mode() {

  local mode="$1"

  echo
  echo "================================================="
  echo "MODE: ${mode}"
  echo "================================================="

  local start
  local end
  local duration

  # Fork-free epoch via the printf builtin (matches common.sh idiom).
  printf -v start '%(%s)T' -1

  local cmd=(bash runtime_aegis.sh "${mode}")
  if [[ -n "${TARGET}" ]]; then
    cmd+=("--target" "${TARGET}")
  fi
  if [[ -n "${ISSUE_NUMBER}" ]]; then
    cmd+=("--issue" "${ISSUE_NUMBER}")
  fi
  if [[ -n "${INVESTIGATION_INPUT}" ]]; then
    cmd+=("${INVESTIGATION_INPUT}")
  fi

  "${cmd[@]}"

  printf -v end '%(%s)T' -1

  duration=$((end-start))

  MODE_TIMINGS["${mode}"]="${duration}"

}

show_final_report() {

  local total=0
  local mode

  echo
  echo "══════════════════════════════"
  echo "AEGIS RUN REPORT"
  echo "══════════════════════════════"
  echo

  for mode in "${EXECUTION_MODES[@]}"; do

    local timing="${MODE_TIMINGS[$mode]:-0}"

    printf "%-12s ✓ %ss\n" \
      "${mode^}" \
      "${timing}"

    total=$((total + timing))
  done

  echo
  echo "Total: ${total}s"
  echo

  if [[ -f "${HANDOVER_FILE}" ]]; then

    echo "Final Mode:"
    jq -r '.artifact_snapshot.mode // "unknown"' \
      "${HANDOVER_FILE}"

    echo

    echo "Final Attention:"

    jq -r '
      .epistemic_state.next_attention_targets[]?
    ' "${HANDOVER_FILE}"

    echo

    if jq -e '
      .artifact_snapshot.operational_context.verdict?
    ' "${HANDOVER_FILE}" >/dev/null 2>&1; then

      echo "Verdict:"

      jq -r '
        .artifact_snapshot.operational_context.verdict
      ' "${HANDOVER_FILE}"

      echo
    fi

  fi

  echo "Pipeline Status:"
  echo "SUCCESS"

  echo
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

  local mode

  for mode in "${EXECUTION_MODES[@]}"; do
    if [[ "${mode}" == "repair" ]] && [[ -f "${HANDOVER_FILE}" ]]; then
      local candidate_count
      candidate_count="$(
        jq -r '.artifact_snapshot.operational_context.repair_candidates | length // 0' \
          "${HANDOVER_FILE}" 2>/dev/null || echo 0
      )"
      if [[ "${candidate_count}" -eq 0 ]]; then
        echo
        echo "[RUN] No repair candidates proposed. Halting pipeline to collect more evidence."
        break
      fi
    fi

    run_mode "${mode}"
    if [[ -n "${UNTIL:-}" ]] && [[ "${mode}" == "${UNTIL}" ]]; then
      echo "[RUN] Stopped at mode ${mode} due to --until limit."
      break
    fi
  done

  show_final_report
}

main "$@"
