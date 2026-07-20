#!/usr/bin/env bash
# =========================================================
# AEGIS — demand fit check (CLI)
# =========================================================
# Usage:
#   bash scripts/fit_check_demand.sh                 # stdin
#   bash scripts/fit_check_demand.sh path/to.md
#   bash scripts/fit_check_demand.sh --issue N
#   bash scripts/fit_check_demand.sh --write-fixed out.md < demand.md
#   bash scripts/fit_check_demand.sh --emit-micros DIR [--issue N | file | stdin]
#        → DIR/fit.json + DIR/unit-0.md … unit-N.md (each unit has .demand)
#
# Then run one micro without manual issue edit:
#   ./run_aegis.sh --fresh --from-fit DIR --unit 0
#
# Exit:
#   0  run_allowed == true
#   1  run_allowed == false (split / rails blockers)
#   2  usage / infra error
#
# JSON schema: aegis.fit_check.v1 (see scripts/lib/fit_check.sh)
# =========================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib/fit_check.sh"

AEGIS_LOG_TAG="FIT"

usage() {
  sed -n '2,22p' "$0"
}

WRITE_FIXED=""
EMIT_MICROS=""
ISSUE=""
INPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --write-fixed)
      WRITE_FIXED="${2:-}"
      shift 2
      ;;
    --emit-micros)
      EMIT_MICROS="${2:-}"
      shift 2
      ;;
    --issue)
      ISSUE="${2:-}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "[AEGIS][FIT][FATAL] unknown_flag:$1" >&2
      exit 2
      ;;
    *)
      INPUT_FILE="$1"
      shift
      ;;
  esac
done

DEMAND=""
if [[ -n "${ISSUE}" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "[AEGIS][FIT][FATAL] missing_gh" >&2
    exit 2
  fi
  unset GITHUB_TOKEN || true
  DEMAND="$(gh issue view "${ISSUE}" --json body -q .body 2>/dev/null || true)"
  if [[ -z "$(printf '%s' "${DEMAND}" | tr -d '[:space:]')" ]]; then
    echo "[AEGIS][FIT][FATAL] issue_body_empty:${ISSUE}" >&2
    exit 2
  fi
elif [[ -n "${INPUT_FILE}" ]]; then
  DEMAND="$(cat "${INPUT_FILE}")"
else
  DEMAND="$(cat)"
fi

if [[ -z "$(printf '%s' "${DEMAND}" | tr -d '[:space:]')" ]]; then
  echo "[AEGIS][FIT][FATAL] empty_demand" >&2
  exit 2
fi

RESULT="$(aegis_fit_check_demand "${DEMAND}")"
if ! printf '%s' "${RESULT}" | jq -e '.schema == "aegis.fit_check.v1"' >/dev/null 2>&1; then
  echo "[AEGIS][FIT][FATAL] invalid_fit_json" >&2
  exit 2
fi

if [[ -n "${WRITE_FIXED}" ]]; then
  printf '%s' "${RESULT}" | jq -r '.fixed_demand' > "${WRITE_FIXED}"
  echo "[AEGIS][FIT] wrote_fixed:${WRITE_FIXED}" >&2
fi

if [[ -n "${EMIT_MICROS}" ]]; then
  RESULT="$(aegis_fit_emit_micros "${RESULT}" "${EMIT_MICROS}")"
  nprop="$(printf '%s' "${RESULT}" | jq '.proposed_units | length')"
  echo "[AEGIS][FIT] emit_micros dir=${EMIT_MICROS} units=${nprop}" >&2
  echo "[AEGIS][FIT] run one unit: ./run_aegis.sh --fresh --from-fit ${EMIT_MICROS} --unit 0" >&2
fi

# Human summary on stderr; machine JSON on stdout
{
  echo "[AEGIS][FIT] rails_ok=$(printf '%s' "${RESULT}" | jq -r '.rails_ok')"
  echo "[AEGIS][FIT] model_fit=$(printf '%s' "${RESULT}" | jq -r '.model_fit') score=$(printf '%s' "${RESULT}" | jq -r '.score')"
  echo "[AEGIS][FIT] run_allowed=$(printf '%s' "${RESULT}" | jq -r '.run_allowed') needs_operator=$(printf '%s' "${RESULT}" | jq -r '.needs_operator')"
  fixes="$(printf '%s' "${RESULT}" | jq -r '.auto_fixes_applied | join(", ")')"
  [[ -n "${fixes}" ]] && echo "[AEGIS][FIT] auto_fixes: ${fixes}"
  blockers="$(printf '%s' "${RESULT}" | jq -r '.blockers | join(", ")')"
  [[ -n "${blockers}" ]] && echo "[AEGIS][FIT] blockers: ${blockers}"
  warnings="$(printf '%s' "${RESULT}" | jq -r '.warnings | join(", ")')"
  [[ -n "${warnings}" ]] && echo "[AEGIS][FIT] warnings: ${warnings}"
  nprop="$(printf '%s' "${RESULT}" | jq '.proposed_units | length')"
  if [[ "${nprop}" -gt 0 ]]; then
    echo "[AEGIS][FIT] proposed_units (${nprop}):"
    printf '%s' "${RESULT}" | jq -r '.proposed_units[] | "  - [\(.index // 0)] \(.title) targets=\(.targets|join(","))"'
  fi
} >&2

printf '%s\n' "${RESULT}"
if printf '%s' "${RESULT}" | jq -e '.run_allowed == true' >/dev/null 2>&1; then
  exit 0
fi
exit 1
