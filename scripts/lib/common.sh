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
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}][FATAL] $*" >&2
  exit 1
}

# Timestamps via the printf builtin — no fork, so timing keeps working
# even when the shell carries very large variables.
measure() {
  local label="$1"
  local start end
  printf -v start '%(%s)T' -1
  shift
  "$@"
  printf -v end '%(%s)T' -1
  echo "[AEGIS][TIMING] ${label}: $((end-start))s" >&2
}
