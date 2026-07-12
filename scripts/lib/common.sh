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
  local breadcrumb_dir="${AEGIS_RUNTIME_ROOT:-.harness/runtime}"
  if [[ -d "${breadcrumb_dir}" ]]; then
    printf '%s\n' "${msg}" > "${breadcrumb_dir}/last_fatal" 2>/dev/null || true
  fi
  exit 1
}

# Timestamps via portable date subshells: the printf '%(%s)T' builtin
# token requires Bash >= 4.2 and evaluates empty on macOS stock Bash 3.2,
# which would break the $((end-start)) arithmetic below.
measure() {
  local label="$1"
  local start end
  start=$(date +%s)
  shift
  "$@"
  end=$(date +%s)
  echo "[AEGIS][TIMING] ${label}: $((end-start))s" >&2
}
