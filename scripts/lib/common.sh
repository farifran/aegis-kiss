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

# Epistemic cache-partition salt. Deterministic digest of the physical
# execution-surface state + epistemic generation boundary: any physical
# mutation (tracked diff or net-new file) or handover promotion rotates
# the salt, cryptographically partitioning downstream KV-cache prefix
# reuse (vLLM/LMCache `cache_salt`) so stale attention states are
# unreachable. Read-only cycles keep the salt stable for maximal prefix
# hits. Pure function of its arguments — no harness state is created.
derive_cache_salt() {

  local surface_path="$1"
  local handover_file="$2"

  local surface_head dirty_hash handover_gen

  surface_head="$(
    git -C "${surface_path}" rev-parse HEAD 2>/dev/null || echo none
  )"

  # Content-addressed digest of uncommitted mutation state: tracked
  # changes via diff, net-new files via ls-files -o (an additive-only
  # repair must still rotate the salt).
  dirty_hash="$(
    {
      git -C "${surface_path}" diff HEAD 2>/dev/null || true
      git -C "${surface_path}" ls-files -o --exclude-standard -z 2>/dev/null \
        | while IFS= read -r -d '' untracked_file; do
            git -C "${surface_path}" hash-object "${untracked_file}" 2>/dev/null || true
          done
    } | shasum -a 256 | cut -d' ' -f1
  )"

  handover_gen="$(
    jq -r '.artifact_snapshot.generated_at // "none"' \
      "${handover_file}" 2>/dev/null || echo none
  )"

  # \x1f unit separator prevents concatenation ambiguity between terms.
  printf '%s\x1f%s\x1f%s' \
    "${surface_head}" "${dirty_hash}" "${handover_gen}" \
    | shasum -a 256 | cut -d' ' -f1
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
