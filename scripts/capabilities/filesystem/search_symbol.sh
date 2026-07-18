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

# Always fixed-string. Demand multi-token queries use ";;" (demand.sh
# AEGIS_DEMAND_TOKEN_SEP) so dots in identifiers never become ERE.
readonly _TOKEN_SEP="${AEGIS_DEMAND_TOKEN_SEP:-;;}"

# Prefer git grep over tracked files (same universe as layer0 census):
# orders of magnitude faster than grep -R on trees with node_modules /
# local venvs. Fallback: recursive grep with harness excludes.
_use_git_grep=0
if command -v git >/dev/null 2>&1 \
  && git -C "${SEARCH_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  _use_git_grep=1
fi

_grep_fixed_into() {
  local pattern="$1"
  local out="$2"
  [[ -n "${pattern}" ]] || return 0

  if [[ "${_use_git_grep}" -eq 1 ]]; then
    # -C SEARCH_ROOT: pathspecs and printed paths relative to that root.
    # -I skip binary; -F fixed-string; -i case-insensitive; -n line numbers.
    git -C "${SEARCH_ROOT}" grep \
      -n -i -F -I \
      -C "${CONTEXT_LINES}" \
      -- "${pattern}" \
      -- . \
      >> "${out}" 2>/dev/null || true
    return 0
  fi

  grep -Rni \
    -F \
    -C "${CONTEXT_LINES}" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=.harness \
    --exclude-dir=.skills \
    --exclude-dir=scripts \
    --exclude-dir=.venv \
    --exclude-dir=.venv-mlx \
    --exclude-dir=dist \
    --exclude-dir=build \
    --exclude-dir=coverage \
    --exclude='*.lock' \
    --exclude='*.log' \
    -- \
    "${pattern}" \
    "${SEARCH_ROOT}" \
    >> "${out}" || true
}

# Line count helper (macOS wc pads spaces).
_match_lines_so_far() {
  wc -l < "${TMP_MATCH_FILE}" 2>/dev/null | tr -d '[:space:]'
}

: > "${TMP_MATCH_FILE}"
if [[ "${QUERY}" == *"${_TOKEN_SEP}"* ]]; then
  # Multi-char split (IFS cannot use ";;" as a single delimiter).
  _rest="${QUERY}"
  while [[ -n "${_rest}" ]]; do
    if [[ "${_rest}" == *"${_TOKEN_SEP}"* ]]; then
      _tok="${_rest%%"${_TOKEN_SEP}"*}"
      _rest="${_rest#*"${_TOKEN_SEP}"}"
    else
      _tok="${_rest}"
      _rest=""
    fi
    [[ -n "${_tok}" ]] || continue
    _grep_fixed_into "${_tok}" "${TMP_MATCH_FILE}"
    # Stop once the expose budget is filled — more tokens cannot add
    # exposed lines and multi-token walks used to dominate forensics time.
    if [[ "$(_match_lines_so_far)" -ge "${MAX_MATCH_LINES}" ]]; then
      break
    fi
  done
  unset _rest _tok
else
  _grep_fixed_into "${QUERY}" "${TMP_MATCH_FILE}"
fi

# =========================================================
# MATCH AND PAYLOAD SIZE LIMITING
# =========================================================

head -n "${MAX_MATCH_LINES}" \
  "${TMP_MATCH_FILE}" \
  > "${TMP_BOUNDED_FILE}"

TRUNCATED="false"

TOTAL_MATCH_LINES="$(wc -l < "${TMP_MATCH_FILE}" | tr -d '[:space:]')"
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

# Line count of the grep dump (context included). Never use
# `grep -c … || echo 0` — zero matches still print 0 and exit 1,
# which would produce "0\n0" and break jq --argjson.
MATCH_COUNT="${TOTAL_MATCH_LINES}"
[[ -n "${MATCH_COUNT}" ]] || MATCH_COUNT=0

# macOS wc pads with spaces; jq --argjson requires a bare JSON number.
BOUNDED_LINE_COUNT="$(wc -l < "${TMP_BOUNDED_FILE}" | tr -d '[:space:]')"
FINAL_SIZE_BYTES="$(wc -c < "${TMP_BOUNDED_FILE}" | tr -d '[:space:]')"

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
