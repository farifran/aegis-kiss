#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.search_symbol
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - bounded repository symbol inspection
# - deterministic search evidence generation
# - payload provenance emission
# - bounded evidence exposure
# - evidence-safe payload generation
#
# This capability intentionally:
#
# - limits exposed matches;
# - limits payload size;
# - limits contextual evidence;
# - avoids unbounded repository dumping;
# - emits deterministic JSON payloads.
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly QUERY="${1:-}"

readonly SEARCH_ROOT="${2:-.}"

# =========================================================
# EVIDENCE LIMITS
# =========================================================

readonly MAX_MATCH_LINES="${AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES:-100}"

readonly MAX_PAYLOAD_BYTES="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-200000}"

readonly CONTEXT_LINES="${AEGIS_SEARCH_SYMBOL_CONTEXT_LINES:-2}"

# =========================================================
# VALIDATION
# =========================================================

[[ -n "${QUERY}" ]] || {

  jq -n \
    --arg capability "filesystem.search_symbol" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(
      date -u +"%Y-%m-%dT%H:%M:%SZ"
    )" \
    '
    {
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: {
        type: "missing_query"
      }
    }
    '

  exit 1
}

[[ -d "${SEARCH_ROOT}" ]] || {

  jq -n \
    --arg capability "filesystem.search_symbol" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(
      date -u +"%Y-%m-%dT%H:%M:%SZ"
    )" \
    --arg search_root "${SEARCH_ROOT}" \
    '
    {
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: {
        type: "missing_search_root",
        target: $search_root
      }
    }
    '

  exit 1
}

# =========================================================
# TEMP FILES
# =========================================================

TMP_MATCH_FILE="$(
  mktemp
)"

TMP_BOUNDED_FILE="$(
  mktemp
)"

cleanup() {

  rm -f \
    "${TMP_MATCH_FILE}" \
    "${TMP_BOUNDED_FILE}" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

# =========================================================
# SEARCH EXECUTION
# =========================================================

grep -Rni \
  -C "${CONTEXT_LINES}" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=.harness \
  --exclude-dir=.skills \
  --exclude-dir=scripts \
  --exclude-dir=.venv \
  --exclude='*.lock' \
  --exclude='*.log' \
  "${QUERY}" \
  "${SEARCH_ROOT}" \
  > "${TMP_MATCH_FILE}" || true

# =========================================================
# MATCH LIMITING
# =========================================================

head -n "${MAX_MATCH_LINES}" \
  "${TMP_MATCH_FILE}" \
  > "${TMP_BOUNDED_FILE}"

# =========================================================
# PAYLOAD SIZE LIMITING
# =========================================================

CURRENT_SIZE="$(
  wc -c < "${TMP_BOUNDED_FILE}"
)"

if [[ "${CURRENT_SIZE}" -gt "${MAX_PAYLOAD_BYTES}" ]]; then

  head -c "${MAX_PAYLOAD_BYTES}" \
    "${TMP_BOUNDED_FILE}" \
    > "${TMP_BOUNDED_FILE}.truncated"

  echo >> "${TMP_BOUNDED_FILE}.truncated"

  echo "[AEGIS][TRUNCATED_PAYLOAD]" \
    >> "${TMP_BOUNDED_FILE}.truncated"

  mv \
    "${TMP_BOUNDED_FILE}.truncated" \
    "${TMP_BOUNDED_FILE}"
fi

# =========================================================
# MATCH METADATA
# =========================================================

MATCH_COUNT="$(
  grep -c "${QUERY}" "${TMP_MATCH_FILE}" \
    2>/dev/null || echo 0
)"

BOUNDED_LINE_COUNT="$(
  wc -l < "${TMP_BOUNDED_FILE}"
)"

FINAL_SIZE_BYTES="$(
  wc -c < "${TMP_BOUNDED_FILE}"
)"

# =========================================================
# JSON EMISSION
# =========================================================

jq -n \
  --arg capability "filesystem.search_symbol" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
  --arg generated_at "$(
    date -u +"%Y-%m-%dT%H:%M:%SZ"
  )" \
  --arg query "${QUERY}" \
  --arg search_root "${SEARCH_ROOT}" \
  --argjson max_match_lines "${MAX_MATCH_LINES}" \
  --argjson context_lines "${CONTEXT_LINES}" \
  --argjson total_matches "${MATCH_COUNT}" \
  --argjson exposed_lines "${BOUNDED_LINE_COUNT}" \
  --argjson payload_size_bytes "${FINAL_SIZE_BYTES}" \
  --rawfile matches "${TMP_BOUNDED_FILE}" \
  '
  {
    success: true,
    capability: $capability,
    classification: $classification,
    execution_id: $execution_id,
    generated_at: $generated_at,
    payload: {
      query: $query,
      search_root: $search_root,
      total_matches: $total_matches,
      exposed_lines: $exposed_lines,
      context_lines: $context_lines,
      payload_size_bytes: $payload_size_bytes,
      max_match_lines: $max_match_lines,
      matches: $matches
    },
    error: null
  }
  '