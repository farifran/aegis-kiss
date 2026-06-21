#!/usr/bin/env bash

# =========================================================
# AEGIS RUN ORCHESTRATOR (KISS)
# =========================================================
#
# OPERATOR GUIDE
#
# ---------------------------------------------------------
# FULL MUTATION PIPELINE
# ---------------------------------------------------------
#
# ./run_aegis.sh
#
# Executes:
#
# discovery
# -> forensics
# -> repair
# -> optimize
# -> adversarial
# -> validation
#
#
# ---------------------------------------------------------
# READONLY PIPELINE
# ---------------------------------------------------------
#
# ./run_aegis.sh readonly
#
# Executes:
#
# discovery
# -> forensics
#
#
# ---------------------------------------------------------
# RESUME PIPELINE
# ---------------------------------------------------------
#
# ./run_aegis.sh --resume
#
# Reads:
#
# .harness/runtime/epistemic_handover.json
#
# Continues from next mode.
#
#
# ---------------------------------------------------------
# TARGET REPOSITORY
# ---------------------------------------------------------
#
# ./run_aegis.sh \
#   --target tests/scenarios/python
#
#
# ---------------------------------------------------------
# FAIL FAST
# ---------------------------------------------------------
#
# Any failure immediately aborts execution.
#
#
# ---------------------------------------------------------
# REPORT
# ---------------------------------------------------------
#
# Shows:
#
# - mode timings
# - total duration
# - final mode
# - final attention targets
# - status
#
# =========================================================

set -Eeuo pipefail

readonly HANDOVER_FILE=".harness/runtime/epistemic_handover.json"

declare -A PIPELINES

PIPELINE="mutation"
TARGET=""
RESUME=false

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

load_pipelines_from_runtime() {
  local modes_json
  modes_json="$(bash runtime_aegis.sh modes 2>/dev/null)" || {
    echo "[RUN][FATAL] failed to retrieve modes registry from runtime" >&2
    exit 1
  }

  PIPELINES[readonly]="$(echo "${modes_json}" | jq -r '.readonly | join(" ")')"
  PIPELINES[mutation]="$(echo "${modes_json}" | jq -r '.mutation | join(" ")')"
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

resolve_resume() {

  local status_json
  status_json="$(bash runtime_aegis.sh status 2>/dev/null)" || {
    echo "[RUN][FATAL] failed to retrieve pipeline status from runtime" >&2
    exit 1
  }

  local resume_from
  resume_from="$(echo "${status_json}" | jq -r '.next_mode // empty')"

  [[ -n "${resume_from}" && "${resume_from}" != "null" ]] || {
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

  start=$(date +%s)

  if [[ -n "${TARGET}" ]]; then
    bash runtime_aegis.sh \
      "${mode}" \
      --target "${TARGET}" \
      "Run Aegis Pipeline"
  else
    bash runtime_aegis.sh \
      "${mode}" \
      "Run Aegis Pipeline"
  fi

  end=$(date +%s)

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

parse_cli() {

  while [[ $# -gt 0 ]]; do

    case "$1" in

      readonly)
        PIPELINE="readonly"
        ;;

      --resume)
        RESUME=true
        ;;

      --target)
        shift
        TARGET="$1"
        ;;

      *)
        echo "[RUN][FATAL] unknown argument: $1"
        exit 1
        ;;

    esac

    shift
  done

}

main() {

  parse_cli "$@"

  load_pipelines_from_runtime

  check_dependencies

  if $RESUME; then
    resolve_resume
  else
    build_mode_list
  fi

  local mode

  for mode in "${EXECUTION_MODES[@]}"; do
    run_mode "${mode}"
  done

  show_final_report
}

main "$@"
