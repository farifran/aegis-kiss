#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — SHARED SCRIPT LIBRARY
# =========================================================
#
# Source-only. Provides tagged logging (AEGIS_LOG_TAG) and
# timing shared by every script family.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] common_lib_not_invocable" >&2
  exit 1
fi

aegis_log() {
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}] $*" >&2
}

aegis_warn() {
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}][WARN] $*" >&2
}

aegis_fatal() {
  local msg="$*"
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}][FATAL] ${msg}" >&2
  # Best-effort operator breadcrumb for the pipeline report. Never blocks
  # the fatal path; never invents a runtime root that does not exist.
  # Canonical path: AEGIS_RUNTIME_DIR (.harness/runtime), NOT AEGIS_RUNTIME_ROOT
  # (repo root). run_aegis.sh reads .harness/runtime/last_fatal.
  local breadcrumb_dir="${AEGIS_RUNTIME_DIR:-.harness/runtime}"
  if [[ -d "${breadcrumb_dir}" ]]; then
    printf '%s\n' "${msg}" > "${breadcrumb_dir}/last_fatal" 2>/dev/null || true
  fi
  exit 1
}

# ---------------------------------------------------------
# Operator-named source paths (single regex family)
# ---------------------------------------------------------
# Shared by mutation target resolution and artifact authorization.
# grep -oE and jq match() must stay byte-equivalent on this pattern.
readonly AEGIS_SOURCE_PATH_RE='[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|mjs|cjs|sh|py)'

# Newline-separated unique paths; strips leading ./. Empty text → no lines.
aegis_extract_operator_named_paths() {
  local text="${1-}"
  [[ -n "${text}" ]] || return 0
  printf '%s' "${text}" \
    | command grep -oE "${AEGIS_SOURCE_PATH_RE}" 2>/dev/null \
    | command sed 's|^\./||' \
    | command grep -Ev '[<>]' \
    | sort -u \
    || true
}

# Always emits a compact JSON array (possibly empty).
aegis_extract_operator_named_paths_json() {
  local text="${1-}"
  local raw=""
  raw="$(aegis_extract_operator_named_paths "${text}")"
  if [[ -z "${raw}" ]]; then
    printf '[]'
    return 0
  fi
  if ! printf '%s\n' "${raw}" \
    | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null; then
    printf '[]'
  fi
}

# Successor of $1 in whitespace-separated sequence $2 (empty if last/missing).
aegis_next_in_sequence() {
  local current="$1"
  local -a sequence=()
  local i
  read -r -a sequence <<< "${2:-}"
  for i in "${!sequence[@]}"; do
    if [[ "${sequence[$i]}" == "${current}" ]]; then
      printf '%s' "${sequence[$((i + 1))]:-}"
      return 0
    fi
  done
  printf ''
}

# Timestamps via portable date subshells: the printf '%(%s)T' builtin
# token requires Bash >= 4.2 and evaluates empty on macOS stock Bash 3.2,
# which would break the $((end-start)) arithmetic below.
# When AEGIS_METRICS_FILE is set, append one JSON line for pipeline reports.
measure() {
  local label="$1"
  local start end elapsed
  start=$(date +%s)
  shift
  "$@"
  end=$(date +%s)
  elapsed=$((end - start))
  echo "[AEGIS][TIMING] ${label}: ${elapsed}s" >&2
  if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
    jq -cn \
      --arg label "${label}" \
      --argjson seconds "${elapsed}" \
      --arg mode "${AEGIS_MODE:-}" \
      --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      '{kind:"timing",label:$label,seconds:$seconds,mode:$mode,at:$at}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  fi
}
