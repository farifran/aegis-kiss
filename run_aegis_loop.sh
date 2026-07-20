#!/usr/bin/env bash
# =========================================================
# AEGIS DEMAND LOOP (operator / Scout orchestration)
# =========================================================
# Dual purpose:
#   1) Converge a demand via: fit → full mutation → review → improve demand
#   2) Capture telemetry so the assistant can rethink harness improvements
#      (not only reword the demand).
#
# Does NOT live inside mode cognition. Does NOT skip optimize/adversarial.
# Reuses run_aegis.sh + fit_check + last_outcome + pipeline_metrics.jsonl.
#
# After a loop, read:
#   .harness/runtime/loop/insights.jsonl   # one record per iteration
#   .harness/runtime/loop/insights.md      # human digest + harness hypotheses
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

  demand → fit → full mutation → review → improve demand → repeat

  Also writes insights for harness learning (assistant reads insights.md).

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
Artifacts: .harness/runtime/loop/
  demand.md state.json loop.jsonl run_*.log
  insights.jsonl insights.md   ← harness learning digest
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
LOOP_INSIGHTS_JSONL="${LOOP_DIR}/insights.jsonl"
LOOP_INSIGHTS_MD="${LOOP_DIR}/insights.md"
METRICS_FILE="${RUNTIME_DIR}/pipeline_metrics.jsonl"
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
    --arg insights "${LOOP_INSIGHTS_MD}" \
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
      insights_md: $insights,
      at: $at
    }' > "${LOOP_STATE}" 2>/dev/null || true
}

# Snapshot one iteration for harness learning (machine-readable).
capture_iteration_insight() {
  local iter="$1"
  local run_rc="${2:-0}"
  local decision="${3:-}"

  local demand_bytes demand_sha modes_json total_s=""
  demand_bytes="$(wc -c < "${LOOP_DEMAND}" | tr -d ' ')"
  demand_sha="$(
    shasum -a 256 "${LOOP_DEMAND}" 2>/dev/null | awk '{print $1}' \
      || cksum "${LOOP_DEMAND}" | awk '{print $1}'
  )"

  modes_json="[]"
  total_s=""
  if [[ -f "${OUTCOME_FILE}" ]]; then
    modes_json="$(jq -c '.modes // []' "${OUTCOME_FILE}" 2>/dev/null || printf '[]')"
    total_s="$(jq -r '.total_seconds // empty' "${OUTCOME_FILE}" 2>/dev/null || true)"
  fi

  # Compact metrics histogram from this run's pipeline_metrics (best-effort).
  local metrics_summary="{}"
  if [[ -f "${METRICS_FILE}" ]]; then
    metrics_summary="$(
      jq -s -c '
        group_by(.kind // "other")
        | map({
            key: (.[0].kind // "other"),
            value: (
              group_by(.result // .status // "n/a")
              | map({key: (.[0].result // .[0].status // "n/a"), value: length})
              | from_entries
            )
          })
        | from_entries
      ' "${METRICS_FILE}" 2>/dev/null || printf '{}'
    )"
  fi

  local fit_score="" fit_allowed=""
  if [[ -f "${LOOP_DIR}/fit_${iter}.json" ]]; then
    fit_score="$(jq -r '.score // empty' "${LOOP_DIR}/fit_${iter}.json" 2>/dev/null || true)"
    fit_allowed="$(jq -r '.run_allowed // empty' "${LOOP_DIR}/fit_${iter}.json" 2>/dev/null || true)"
  fi

  # Grep log for mechanical vs LLM path tags (signals for harness design).
  local logf="${LOOP_DIR}/run_${iter}.log"
  local mech_tags
  mech_tags="$(
    {
      [[ -f "${logf}" ]] || exit 0
      grep -E 'optimize_mechanical|adversarial_mechanical|adversarial_llm|validation_mechanical|forensics_mechanical|forensics_llm|optimize_passthrough|optimize_mechanical_clean' \
        "${logf}" 2>/dev/null \
        | sed -E 's/.*\[AEGIS\](\[[A-Z_]+\])?[[:space:]]*//' \
        | head -n 40
    } | jq -R -s -c 'split("\n") | map(select(length>0))' 2>/dev/null || printf '[]'
  )"

  local failed_mode=""
  failed_mode="$(
    printf '%s' "${modes_json}" \
      | jq -r '[.[] | select(.status != "ok" and .status != null)] | last | .mode // empty' \
      2>/dev/null || true
  )"

  jq -nc \
    --argjson iter "${iter}" \
    --argjson run_rc "${run_rc}" \
    --arg decision "${decision}" \
    --arg status "${AEGIS_LOOP_STATUS:-}" \
    --arg class "${AEGIS_LOOP_CLASS:-}" \
    --arg reason "${AEGIS_LOOP_REASON:-}" \
    --arg next "${AEGIS_LOOP_NEXT:-}" \
    --argjson modes "${modes_json}" \
    --arg total_seconds "${total_s}" \
    --argjson demand_bytes "${demand_bytes:-0}" \
    --arg demand_sha "${demand_sha}" \
    --argjson metrics "${metrics_summary}" \
    --argjson mech_tags "${mech_tags}" \
    --arg fit_score "${fit_score}" \
    --arg fit_allowed "${fit_allowed}" \
    --arg failed_mode "${failed_mode}" \
    --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
      schema: "aegis.loop.insight.v1",
      iter: $iter,
      decision: $decision,
      run_rc: $run_rc,
      status: $status,
      reason_class: $class,
      reason_code: $reason,
      next_step: $next,
      failed_mode: $failed_mode,
      total_seconds: (if $total_seconds == "" then null else ($total_seconds|tonumber) end),
      modes: $modes,
      demand_bytes: $demand_bytes,
      demand_sha: $demand_sha,
      fit_score: (if $fit_score == "" then null else $fit_score end),
      fit_allowed: (if $fit_allowed == "" then null else $fit_allowed end),
      metrics_by_kind: $metrics,
      mechanical_log_tags: $mech_tags,
      at: $at
    }' >> "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || true

  # Per-iter copy of outcome + metrics for offline analysis
  mkdir -p "${LOOP_DIR}/iter_${iter}"
  [[ -f "${OUTCOME_FILE}" ]] && cp "${OUTCOME_FILE}" "${LOOP_DIR}/iter_${iter}/last_outcome.json" 2>/dev/null || true
  [[ -f "${METRICS_FILE}" ]] && cp "${METRICS_FILE}" "${LOOP_DIR}/iter_${iter}/pipeline_metrics.jsonl" 2>/dev/null || true
  [[ -f "${LOOP_DIR}/fit_${iter}.json" ]] && cp "${LOOP_DIR}/fit_${iter}.json" "${LOOP_DIR}/iter_${iter}/fit.json" 2>/dev/null || true
}

# Human + assistant digest: patterns that may justify harness changes.
write_insights_digest() {
  local final="${1:-UNKNOWN}"
  local iters="${2:-0}"

  {
    echo "# Aegis loop insights (harness learning)"
    echo
    echo "Generated for the **assistant / Scout** after a demand loop."
    echo "Purpose: improve **the harness**, not only reword the demand."
    echo
    echo "| | |"
    echo "|--|--|"
    echo "| final | \`${final}\` |"
    echo "| iterations | ${iters} |"
    echo "| demand | \`${LOOP_DEMAND}\` |"
    echo "| machine log | \`${LOOP_INSIGHTS_JSONL}\` |"
    echo
    echo "## Per-iteration summary"
    echo
    echo "| iter | status | class | reason | failed_mode | decision |"
    echo "|------|--------|-------|--------|-------------|----------|"
    if [[ -f "${LOOP_INSIGHTS_JSONL}" ]]; then
      jq -r '
        [.iter, .status, .reason_class, (.reason_code//"—"), (.failed_mode//"—"), .decision]
        | @tsv
      ' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null \
        | while IFS=$'\t' read -r i st cl rs fm dec; do
            echo "| ${i} | ${st} | ${cl} | \`${rs}\` | ${fm} | ${dec} |"
          done
    fi
    echo
    echo "## Frequency (reason_class)"
    echo
    if [[ -f "${LOOP_INSIGHTS_JSONL}" ]]; then
      jq -s -r '
        group_by(.reason_class // "unknown")
        | map("- **\(.[0].reason_class // "unknown")**: \(length)")
        | .[]
      ' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo "- (none)"
    fi
    echo
    echo "## Mechanical / LLM path tags (from run logs)"
    echo
    if [[ -f "${LOOP_INSIGHTS_JSONL}" ]]; then
      jq -s -r '
        [.[].mechanical_log_tags[]?] | group_by(.) | map("- `\(.[0])` ×\(length)") | .[]?
      ' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo "- (none captured)"
    fi
    echo
    echo "## Metrics kinds seen"
    echo
    if [[ -f "${LOOP_INSIGHTS_JSONL}" ]]; then
      jq -s -r '
        [.[].metrics_by_kind | keys[]] | unique | map("- \(.)") | .[]?
      ' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo "- (none)"
    fi
    echo
    echo "## Hypotheses for harness improvement (devil filter)"
    echo
    echo "Use evidence above. Prefer **runtime rails** over more LLM. Reject ideas that reintroduce lite/shortcuts."
    echo
    # Heuristic bullets from patterns
    if [[ -f "${LOOP_INSIGHTS_JSONL}" ]]; then
      local has_preflight has_precond has_budget has_contract has_halt has_intent
      has_preflight="$(jq -s 'any(.[]; (.reason_code//"")|test("preflight|mutation_preflight"))' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo false)"
      has_precond="$(jq -s 'any(.[]; (.reason_code//"")|test("precondition_"))' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo false)"
      has_budget="$(jq -s 'any(.[]; .reason_class=="budget")' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo false)"
      has_contract="$(jq -s 'any(.[]; .reason_class=="contract")' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo false)"
      has_halt="$(jq -s 'any(.[]; .reason_class=="epistemic_halt")' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo false)"
      has_intent="$(jq -s 'any(.[]; (.metrics_by_kind.intent//{})|length>0)' "${LOOP_INSIGHTS_JSONL}" 2>/dev/null || echo false)"

      [[ "${has_preflight}" == "true" ]] && echo "- **preflight failures**: strengthen tools-fix prompts or mechanical preflight classes — not more optimize LLM."
      [[ "${has_precond}" == "true" ]] && echo "- **precondition gaps**: mode handoff contract incomplete — fix runtime preconditions/enrich, not demand poetry."
      [[ "${has_budget}" == "true" ]] && echo "- **repair budget exhausted**: repair_feedback quality or intent soft-accept thrashing — tighten feedback codes / can_improve gate."
      [[ "${has_contract}" == "true" ]] && echo "- **artifact contract**: skill min-output vs enrich mismatch — densify skill or strengthen mechanical emit."
      [[ "${has_halt}" == "true" ]] && echo "- **forensics halt**: discovery/forensics anchors weak — improve path extraction / seed, not adversarial."
      [[ "${has_intent}" == "true" ]] && echo "- **intent metrics present**: review soft_accept vs fail rates in iter_*/pipeline_metrics.jsonl."
      echo "- If **mechanical_verified** dominates adversarial and bugs still ship: add greps (acceptance/body), not multi-agent."
      echo "- If **mechanical_improve** never fires but code has any/stubs: scan regex gap."
      echo "- If SUCCESS only after demand shrink: fit_check / INTAKE templates — harness demand rails, not model upgrade alone."
    fi
    echo
    echo "## Assistant checklist (after LOOP)"
    echo
    echo "1. Read this file + \`insights.jsonl\` + last failing \`iter_N/run\` tail."
    echo "2. Separate **demand smell** (micro/SPEC) vs **harness smell** (precondition, preflight, feedback, greps)."
    echo "3. Propose ≤3 KISS harness changes with evidence from classes/tags above."
    echo "4. Do **not** propose mutation_lite or skipping optimize/adversarial."
    echo "5. If only demand was wrong: update INTAKE examples; no code change required."
    echo
  } > "${LOOP_INSIGHTS_MD}"

  log_line "insights written: ${LOOP_INSIGHTS_MD}"
}

# ----- main -----
: > "${LOOP_LOG}"
: > "${LOOP_INSIGHTS_JSONL}"
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
    capture_iteration_insight "${iter}" "${run_rc}" "SUCCESS"
    write_state "${iter}" "SUCCESS"
    break
  fi

  if class_is_stop "${AEGIS_LOOP_CLASS}"; then
    log_line "stop class=${AEGIS_LOOP_CLASS} (not auto-retryable)"
    capture_iteration_insight "${iter}" "${run_rc}" "STOP_${AEGIS_LOOP_CLASS}"
    write_state "${iter}" "STOP_${AEGIS_LOOP_CLASS}"
    break
  fi

  if [[ "${iter}" -ge "${MAX}" ]]; then
    log_line "max iterations reached"
    capture_iteration_insight "${iter}" "${run_rc}" "MAX_ITER"
    write_state "${iter}" "MAX_ITER"
    break
  fi

  capture_iteration_insight "${iter}" "${run_rc}" "CONTINUE"
  improve_demand "${iter}"
  write_state "${iter}" "CONTINUE"
done

write_insights_digest "${final_status}" "${iter}"

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
echo "Insights:  ${LOOP_INSIGHTS_MD}"
echo "JSONL:     ${LOOP_INSIGHTS_JSONL}"
echo "Log:       ${LOOP_LOG}"
echo "══════════════════════════════"
echo
echo "Assistant: read Insights and propose harness KISS fixes if patterns are harness smells."
echo

if [[ "${final_status}" == "SUCCESS" ]]; then
  exit 0
fi
exit 1
