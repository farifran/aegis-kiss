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
# - bounded evidence exposure
#
# =========================================================

set -Eeuo pipefail

readonly QUERY="${1:-}"
readonly SEARCH_ROOT="${2:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.search_symbol"

# =========================================================
# EVIDENCE LIMITS
# =========================================================

# Aggressive context budget ceiling: generic queries ("byte") can match
# hundreds of lines repo-wide; evidence exposure is hard-capped at a
# small number of match lines AND a tight byte budget, whichever bites
# first. The operator line budget is honored only below the ceiling.
readonly HARD_MAX_MATCH_LINES="${AEGIS_SEARCH_SYMBOL_HARD_MAX_MATCH_LINES:-30}"
readonly HARD_MAX_MATCH_BYTES="${AEGIS_SEARCH_SYMBOL_HARD_MAX_MATCH_BYTES:-16384}"

_operator_match_lines="${AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES:-100}"
if [[ "${_operator_match_lines}" -gt "${HARD_MAX_MATCH_LINES}" ]]; then
  _operator_match_lines="${HARD_MAX_MATCH_LINES}"
fi
readonly MAX_MATCH_LINES="${_operator_match_lines}"
unset _operator_match_lines

_operator_payload_bytes="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-200000}"
if [[ "${_operator_payload_bytes}" -gt "${HARD_MAX_MATCH_BYTES}" ]]; then
  _operator_payload_bytes="${HARD_MAX_MATCH_BYTES}"
fi
readonly MAX_PAYLOAD_BYTES="${_operator_payload_bytes}"
unset _operator_payload_bytes

readonly CONTEXT_LINES="${AEGIS_SEARCH_SYMBOL_CONTEXT_LINES:-2}"

# =========================================================
# VALIDATION
# =========================================================

[[ -n "${QUERY}" ]] || {
  fail_without_target "missing_query"
  exit 1
}

guard_path_containment "${SEARCH_ROOT}"

[[ -d "${SEARCH_ROOT}" ]] || {
  fail "missing_search_root" "${SEARCH_ROOT}"
  exit 1
}

# =========================================================
# SEARCH EXECUTION
# =========================================================

TMP_MATCH_FILE="$(aegis_mktemp)"
TMP_BOUNDED_FILE="$(aegis_mktemp)"

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
# MATCH AND PAYLOAD SIZE LIMITING
# =========================================================

head -n "${MAX_MATCH_LINES}" \
  "${TMP_MATCH_FILE}" \
  > "${TMP_BOUNDED_FILE}"

TRUNCATED="false"

TOTAL_MATCH_LINES="$(wc -l < "${TMP_MATCH_FILE}")"
if [[ "${TOTAL_MATCH_LINES}" -gt "${MAX_MATCH_LINES}" ]]; then
  TRUNCATED="true"
fi

bound_file_bytes "${TMP_BOUNDED_FILE}" "${MAX_PAYLOAD_BYTES}" "[AEGIS][TRUNCATED_PAYLOAD]"

if [[ "${AEGIS_TRUNCATED}" == "true" ]]; then
  TRUNCATED="true"
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

TMP_PAYLOAD_FILE="$(aegis_mktemp)"

jq -n \
  --arg query "${QUERY}" \
  --arg search_root "${SEARCH_ROOT}" \
  --argjson max_match_lines "${MAX_MATCH_LINES}" \
  --argjson context_lines "${CONTEXT_LINES}" \
  --argjson total_matches "${MATCH_COUNT}" \
  --argjson exposed_lines "${BOUNDED_LINE_COUNT}" \
  --argjson payload_size_bytes "${FINAL_SIZE_BYTES}" \
  --argjson truncated "${TRUNCATED}" \
  --rawfile matches "${TMP_BOUNDED_FILE}" \
  '{
    query: $query,
    search_root: $search_root,
    total_matches: $total_matches,
    exposed_lines: $exposed_lines,
    context_lines: $context_lines,
    payload_size_bytes: $payload_size_bytes,
    max_match_lines: $max_match_lines,
    truncated: $truncated,
    matches: $matches
  }' > "${TMP_PAYLOAD_FILE}"

emit_success_payload_file "${TMP_PAYLOAD_FILE}"
