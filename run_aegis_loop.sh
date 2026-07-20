#!/usr/bin/env bash
# =========================================================
# AEGIS DEMAND LOOP (operator / Scout orchestration)
# =========================================================
# demand → (fit review) → run_aegis full mutation → review
#        → improve demand → repeat
#
# Does NOT live inside mode cognition. Does NOT skip optimize/
# adversarial. Reuses run_aegis.sh + fit_check + last_outcome.
#
# Usage:
#   ./run_aegis_loop.sh --issue N [--max 3]
#   ./run_aegis_loop.sh --demand-file path.md [--max 3]
#   ./run_aegis_loop.sh [--max 3] "free-text demand…"
#
# Env:
#   AEGIS_LOOP_MAX=3          max iterations (default 3)
#   AEGIS_LOOP_FIT=1          fit-check each iter (default 1)
#   AEGIS_LOOP_AUTO_FIX=1     apply fit fixed_demand when free-text (default 1)
#   AEGIS_LOOP_STOP_CLASSES   comma list that abort loop without re-run
#                             (default: environment,provider,harness_bug)
# =========================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

# shellcheck disable=SC1091
source "${ROOT}/scripts/lib/common.sh" 2>/dev/null || true
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib/run_outcome.sh" 2>/dev/null || true

usage() {
  cat <<'EOF'
Usage: ./run_aegis_loop.sh [options] [free-text demand…]

  demand → fit review → run_aegis (full mutation) → review outcome
         → improve demand → repeat

Options:
  --issue N           Seed demand from GitHub issue
  --demand-file PATH  Seed demand from markdown file
  --max N             Max iterations (default 3)
  --no-fit            Skip fit_check each iteration
  --help              This help

Env:
  AEGIS_LOOP_MAX=3
  AEGIS_LOOP_FIT=1
  AEGIS_LOOP_AUTO_FIX=1
  AEGIS_LOOP_STOP_CLASSES=environment,provider,harness_bug

Always uses: ./run_aegis.sh --fresh --pipeline mutation
Artifacts: .harness/runtime/loop/{demand.md,state.json,loop.jsonl,run_*.log}
EOF
}

MAX="${AEGIS_LOOP_MAX:-3}"
DO_FIT="${AEGIS_LOOP_FIT:-1}"
AUTO_FIX="${AEGIS_LOOP_AUTO_FIX:-1}"
STOP_CLASSES="${AEGIS_LOOP_STOP_CLASSES:-environment,provider,harness_bug}"
ISSUE=""
DEMAND_FILE=""
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --issue)
      ISSUE="${2:-}"
      shift 2
      ;;
    --demand-file)
      DEMAND_FILE="${2:-}"
      shift 2
      ;;
    --max)
      MAX="${2:-3}"
      shift 2
      ;;
    --no-fit)
      DO_FIT=0
      shift
      ;;
    --)
      shift
      POSITIONAL+=("$@")
      break
      ;;
    -*)
      echo "[LOOP][FATAL] unknown_flag:$1" >&2
      exit 2
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

[[ "${MAX}" =~ ^[1-9][0-9]*$ ]] || {
  echo "[LOOP][FATAL] invalid_max:${MAX}" >&2
  exit 2
}

RUNTIME_DIR="${ROOT}/.harness/runtime"
LOOP_DIR="${RUNTIME_DIR}/loop"
LOOP_DEMAND="${LOOP_DIR}/demand.md"
LOOP_LOG="${LOOP_DIR}/loop.jsonl"
LOOP_STATE="${LOOP_DIR}/state.json"
OUTCOME_FILE="${RUNTIME_DIR}/last_outcome.json"
FATAL_FILE="${RUNTIME_DIR}/last_fatal"

mkdir -p "${LOOP_DIR}"

log_line() {
  local msg="$*"
  echo "[LOOP] ${msg}"
  if command -v jq >/dev/null 2>&1; then
    jq -cn \
      --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      --arg msg "${msg}" \
      '{at:$at,msg:$msg}' >> "${LOOP_LOG}" 2>/dev/null || true
  fi
}

# Seed LOOP_DEMAND from issue, file, or free text.
seed_demand() {
  if [[ -n "${ISSUE}" ]]; then
    command -v gh >/dev/null 2>&1 || {
      echo "[LOOP][FATAL] missing_gh for --issue" >&2
      exit 2
    }
    local title body
    title="$(gh issue view "${ISSUE}" --json title -q .title 2>/dev/null || true)"
    body="$(gh issue view "${ISSUE}" --json body -q .body 2>/dev/null || true)"
    [[ -n "${body}" || -n "${title}" ]] || {
      echo "[LOOP][FATAL] issue_fetch_failed:${ISSUE}" >&2
      exit 1
    }
    {
      echo "# Issue #${ISSUE}: ${title}"
      echo
      printf '%s\n' "${body}"
    } > "${LOOP_DEMAND}"
    log_line "seed issue=#${ISSUE}"
    return 0
  fi

  if [[ -n "${DEMAND_FILE}" ]]; then
    [[ -f "${DEMAND_FILE}" ]] || {
      echo "[LOOP][FATAL] demand_file_missing:${DEMAND_FILE}" >&2
      exit 2
    }
    cp "${DEMAND_FILE}" "${LOOP_DEMAND}"
    log_line "seed file=${DEMAND_FILE}"
    return 0
  fi

  if [[ "${#POSITIONAL[@]}" -gt 0 ]]; then
    printf '%s\n' "${POSITIONAL[*]}" > "${LOOP_DEMAND}"
    log_line "seed free-text"
    return 0
  fi

  echo "[LOOP][FATAL] need --issue N | --demand-file path | free-text demand" >&2
  exit 2
}

# Fit review: optional auto-fix for free-text; issues stay check-only.
review_fit() {
  local iter="$1"
  [[ "${DO_FIT}" == "1" || "${DO_FIT}" == "true" ]] || return 0

  local fit_json fit_rc=0
  fit_json="$(
    bash "${ROOT}/scripts/fit_check_demand.sh" "${LOOP_DEMAND}" 2>"${LOOP_DIR}/fit_${iter}.err"
  )" || fit_rc=$?

  printf '%s\n' "${fit_json}" > "${LOOP_DIR}/fit_${iter}.json" 2>/dev/null || true

  local allowed score model_fit
  allowed="$(printf '%s' "${fit_json}" | jq -r '.run_allowed // false' 2>/dev/null || echo false)"
  score="$(printf '%s' "${fit_json}" | jq -r '.score // "?"' 2>/dev/null || echo '?')"
  model_fit="$(printf '%s' "${fit_json}" | jq -r '.model_fit // "?"' 2>/dev/null || echo '?')"
  log_line "fit iter=${iter} allowed=${allowed} score=${score} model_fit=${model_fit}"

  if [[ "${fit_rc}" -ne 0 || "${allowed}" != "true" ]]; then
    # Prefer fixed_demand or first proposed unit if auto-fix on.
    if [[ "${AUTO_FIX}" == "1" || "${AUTO_FIX}" == "true" ]]; then
      local fixed unit0
      fixed="$(printf '%s' "${fit_json}" | jq -r '.fixed_demand // empty' 2>/dev/null || true)"
      unit0="$(printf '%s' "${fit_json}" | jq -r '.proposed_units[0].demand // empty' 2>/dev/null || true)"
      if [[ -n "$(printf '%s' "${fixed}" | tr -d '[:space:]')" ]]; then
        printf '%s\n' "${fixed}" > "${LOOP_DEMAND}"
        log_line "improve fit: applied fixed_demand"
        return 0
      fi
      if [[ -n "$(printf '%s' "${unit0}" | tr -d '[:space:]')" ]]; then
        printf '%s\n' "${unit0}" > "${LOOP_DEMAND}"
        log_line "improve fit: applied proposed_units[0]"
        return 0
      fi
    fi
    log_line "fit blocked and no auto-fix available — continue with current demand (may fail run)"
  elif [[ "${AUTO_FIX}" == "1" || "${AUTO_FIX}" == "true" ]]; then
    local fixed
    fixed="$(printf '%s' "${fit_json}" | jq -r '.fixed_demand // empty' 2>/dev/null || true)"
    if [[ -n "$(printf '%s' "${fixed}" | tr -d '[:space:]')" ]]; then
      # Only replace if materially different and still allowed.
      if ! cmp -s <(printf '%s' "${fixed}") "${LOOP_DEMAND}" 2>/dev/null; then
        printf '%s\n' "${fixed}" > "${LOOP_DEMAND}"
        log_line "improve fit: refreshed fixed_demand"
      fi
    fi
  fi
}

run_aegis_once() {
  local iter="$1"
  local logf="${LOOP_DIR}/run_${iter}.log"
  log_line "run iter=${iter} pipeline=mutation --fresh"

  set +e
  # Full mutation only — never lite.
  bash "${ROOT}/run_aegis.sh" --fresh --pipeline mutation \
    "$(cat "${LOOP_DEMAND}")" \
    >"${logf}" 2>&1
  local rc=$?
  set -e

  # Keep a short tail for review
  tail -n 80 "${logf}" > "${LOOP_DIR}/run_${iter}.tail.txt" 2>/dev/null || true
  return "${rc}"
}

# Read last_outcome → status, reason_code, reason_class, next_step
review_outcome() {
  local status="UNKNOWN" reason="" class="unknown" next="inspecione stderr"

  if [[ -f "${OUTCOME_FILE}" ]]; then
    status="$(jq -r '.status // .pipeline_status // "UNKNOWN"' "${OUTCOME_FILE}" 2>/dev/null || echo UNKNOWN)"
    reason="$(jq -r '.reason_code // empty' "${OUTCOME_FILE}" 2>/dev/null || true)"
    class="$(jq -r '.reason_class // empty' "${OUTCOME_FILE}" 2>/dev/null || true)"
    next="$(jq -r '.next_step // empty' "${OUTCOME_FILE}" 2>/dev/null || true)"
  fi

  if [[ -z "${reason}" && -f "${FATAL_FILE}" ]]; then
    reason="$(tr -d '\r\n' < "${FATAL_FILE}" | head -c 200)"
  fi

  if [[ -z "${class}" || "${class}" == "null" ]] \
    && declare -f aegis_classify_reason >/dev/null 2>&1; then
    local tab
    tab="$(aegis_classify_reason "${reason}" 2>/dev/null || true)"
    class="$(printf '%s' "${tab}" | cut -f1)"
    [[ -n "${next}" && "${next}" != "null" ]] \
      || next="$(printf '%s' "${tab}" | cut -f2-)"
  fi

  [[ -n "${class}" && "${class}" != "null" ]] || class="unknown"
  [[ -n "${next}" && "${next}" != "null" ]] || next="inspecione stderr da run"

  AEGIS_LOOP_STATUS="${status}"
  AEGIS_LOOP_REASON="${reason}"
  AEGIS_LOOP_CLASS="${class}"
  AEGIS_LOOP_NEXT="${next}"

  log_line "review status=${status} class=${class} reason=${reason:-—}"
  log_line "next_step=${next}"
}

class_is_stop() {
  local c="$1"
  local item
  IFS=',' read -r -a _stop <<< "${STOP_CLASSES}"
  for item in "${_stop[@]}"; do
    item="$(printf '%s' "${item}" | tr -d ' ')"
    [[ -n "${item}" ]] || continue
    [[ "${c}" == "${item}" ]] && return 0
  done
  return 1
}

# Improve demand text using outcome (append LOOP FEEDBACK; keep prior body).
improve_demand() {
  local iter="$1"
  local status="${AEGIS_LOOP_STATUS}"
  local class="${AEGIS_LOOP_CLASS}"
  local reason="${AEGIS_LOOP_REASON}"
  local next="${AEGIS_LOOP_NEXT}"

  # Drop previous loop feedback block to avoid unbounded growth.
  if grep -q '^## LOOP FEEDBACK' "${LOOP_DEMAND}" 2>/dev/null; then
    # Keep content before first LOOP FEEDBACK
    local tmp
    tmp="$(mktemp)"
    sed '/^## LOOP FEEDBACK/,$d' "${LOOP_DEMAND}" > "${tmp}"
    mv "${tmp}" "${LOOP_DEMAND}"
  fi

  {
    echo
    echo "## LOOP FEEDBACK (iter ${iter} — harness review, not product code)"
    echo
    echo "- status: \`${status}\`"
    echo "- reason_class: \`${class}\`"
    echo "- reason_code: \`${reason:-—}\`"
    echo "- next_step: ${next}"
    echo
    echo "### Operator constraints for next Repair"
    case "${class}" in
      epistemic_halt|operator_input)
        echo "- Narrow Goal to one intent; one path under ## Targets."
        echo "- Acceptance = short tokens that must appear in the code."
        echo "- Change = explicit template or step list; no multi-file monsters."
        ;;
      mutation|budget|contract)
        echo "- Keep single-file target; simplify Change template."
        echo "- Avoid any / stubs; name exports exactly as Acceptance tokens."
        echo "- Do not expand scope beyond Targets."
        ;;
      scope)
        echo "- Align Targets paths with files that must change."
        echo "- Remove out-of-scope path mentions from Change."
        ;;
      *)
        echo "- Re-read next_step; tighten demand micro-scope."
        ;;
    esac
    echo
    echo "### Rules"
    echo "- Full mutation pipeline only (repair → optimize → adversarial → validation)."
    echo "- Do not invent new Targets outside the original intent."
  } >> "${LOOP_DEMAND}"

  log_line "improve demand: appended LOOP FEEDBACK iter=${iter}"

  # Optional: comment on GitHub issue (visible review)
  if [[ -n "${ISSUE}" ]] && command -v gh >/dev/null 2>&1; then
    gh issue comment "${ISSUE}" --body "$(cat <<EOF
### Aegis loop review (iter ${iter})

| | |
|--|--|
| status | \`${status}\` |
| class | \`${class}\` |
| reason | \`${reason:-—}\` |
| next | ${next} |

Demand refined in \`.harness/runtime/loop/demand.md\` for next iteration.
EOF
)" >/dev/null 2>&1 || true
  fi
}

write_state() {
  local iter="$1" final="$2"
  jq -n \
    --argjson iter "${iter}" \
    --arg final "${final}" \
    --arg status "${AEGIS_LOOP_STATUS:-}" \
    --arg class "${AEGIS_LOOP_CLASS:-}" \
    --arg reason "${AEGIS_LOOP_REASON:-}" \
    --arg next "${AEGIS_LOOP_NEXT:-}" \
    --arg demand "${LOOP_DEMAND}" \
    --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
      schema: "aegis.loop.v1",
      iter: $iter,
      final: $final,
      status: $status,
      reason_class: $class,
      reason_code: $reason,
      next_step: $next,
      demand_file: $demand,
      at: $at
    }' > "${LOOP_STATE}" 2>/dev/null || true
}

# ----- main -----
: > "${LOOP_LOG}"
seed_demand

AEGIS_LOOP_STATUS=""
AEGIS_LOOP_REASON=""
AEGIS_LOOP_CLASS=""
AEGIS_LOOP_NEXT=""

final_status="FAILED"
iter=0
while [[ "${iter}" -lt "${MAX}" ]]; do
  iter=$((iter + 1))
  log_line "======== iteration ${iter}/${MAX} ========"

  review_fit "${iter}"

  run_rc=0
  run_aegis_once "${iter}" || run_rc=$?

  review_outcome

  if [[ "${AEGIS_LOOP_STATUS}" == "SUCCESS" ]]; then
    final_status="SUCCESS"
    log_line "SUCCESS on iter=${iter}"
    write_state "${iter}" "SUCCESS"
    break
  fi

  if class_is_stop "${AEGIS_LOOP_CLASS}"; then
    log_line "stop class=${AEGIS_LOOP_CLASS} (not auto-retryable)"
    write_state "${iter}" "STOP_${AEGIS_LOOP_CLASS}"
    break
  fi

  if [[ "${iter}" -ge "${MAX}" ]]; then
    log_line "max iterations reached"
    write_state "${iter}" "MAX_ITER"
    break
  fi

  improve_demand "${iter}"
  write_state "${iter}" "CONTINUE"
done

echo
echo "══════════════════════════════"
echo "AEGIS DEMAND LOOP"
echo "══════════════════════════════"
echo "Final:     ${final_status}"
echo "Iters:     ${iter}/${MAX}"
echo "Status:    ${AEGIS_LOOP_STATUS:-—}"
echo "Class:     ${AEGIS_LOOP_CLASS:-—}"
echo "Reason:    ${AEGIS_LOOP_REASON:-—}"
echo "Next:      ${AEGIS_LOOP_NEXT:-—}"
echo "Demand:    ${LOOP_DEMAND}"
echo "State:     ${LOOP_STATE}"
echo "Log:       ${LOOP_LOG}"
echo "══════════════════════════════"

if [[ "${final_status}" == "SUCCESS" ]]; then
  exit 0
fi
exit 1
