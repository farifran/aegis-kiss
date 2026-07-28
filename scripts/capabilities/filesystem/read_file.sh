#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.read
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - bounded file inspection
# - bounded output truncation
#
# =========================================================

set -Eeuo pipefail

readonly TARGET_FILE="${1:-}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.read"

# =========================================================
# LIMITS
# =========================================================

max_read_bytes="${AEGIS_FILE_CONTENT_MAX_BYTES:-50000}"
if [[ "$(basename "${TARGET_FILE}")" == "epistemic_handover.json" ]]; then
  # Read ceiling, not the validity gate — see .harness/config.sh.
  max_read_bytes="${AEGIS_EPISTEMIC_HANDOVER_READ_MAX_BYTES:-16384}"
fi
readonly MAX_READ_BYTES="${max_read_bytes}"

# =========================================================
# VALIDATION
# =========================================================

if [[ -z "${TARGET_FILE}" ]]; then
  fail "missing_target_file"
  exit 1
fi

# Jail constraint: the target must resolve inside AEGIS_ROOT_DIR before
# any raw content is emitted.
guard_path_containment "${TARGET_FILE}"

if [[ ! -f "${TARGET_FILE}" ]]; then
  fail "file_not_found" "${TARGET_FILE}"
  exit 1
fi

# =========================================================
# PAYLOAD GENERATION
# =========================================================

TMP_CONTENT_FILE="$(aegis_mktemp)"

if ! cat "${TARGET_FILE}" > "${TMP_CONTENT_FILE}"; then
  fail "read_failure" "${TARGET_FILE}"
  exit 1
fi

CONTENT_SIZE_BYTES="$(
  wc -c < "${TMP_CONTENT_FILE}"
)"

# Lossless whitespace reduction for JSON reads. The epistemic handover is
# stored pretty-printed and is the largest payload in every mode's context;
# embedding it verbatim spends ~27% of its bytes on indentation the model
# gains nothing from. Semantics are unchanged, the rendered payloads are
# already compact (jq -c) so the form is consistent, and compacting BEFORE
# the byte cap means more real content survives truncation.
# Non-JSON files are untouched.
if jq empty "${TMP_CONTENT_FILE}" >/dev/null 2>&1; then
  _compact_tmp="$(aegis_mktemp)"
  if jq -c . "${TMP_CONTENT_FILE}" > "${_compact_tmp}" 2>/dev/null \
    && [[ -s "${_compact_tmp}" ]]; then
    mv "${_compact_tmp}" "${TMP_CONTENT_FILE}"
  fi
fi

bound_file_bytes "${TMP_CONTENT_FILE}" "${MAX_READ_BYTES}" "[AEGIS][TRUNCATED]"

# =========================================================
# JSON EMISSION
# =========================================================

TMP_PAYLOAD_FILE="$(aegis_mktemp)"

jq -n \
  --arg target "${TARGET_FILE}" \
  --argjson content_size_bytes "${CONTENT_SIZE_BYTES}" \
  --argjson max_read_bytes "${MAX_READ_BYTES}" \
  --argjson truncated "${AEGIS_TRUNCATED}" \
  --rawfile content "${TMP_CONTENT_FILE}" \
  '{
    target: $target,
    content_size_bytes: $content_size_bytes,
    max_read_bytes: $max_read_bytes,
    truncated: $truncated,
    content: $content
  }' > "${TMP_PAYLOAD_FILE}"

emit_success_payload_file "${TMP_PAYLOAD_FILE}"
