#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — SHARED FILESYSTEM SURFACE UTILITIES
# =========================================================
#
# Classification:
# readonly (helper — not an invocable capability)
#
# Responsibilities:
#
# - capability envelope JSON emission (success/failure)
# - configuration sourcing and identity propagation
# - prune policy validation and exposure
# - bounded payload truncation
# - temp file lifecycle
#
# This helper intentionally:
#
# - carries no capability authority of its own;
# - is sourced only by thin capability surfaces;
# - is included in manifest integrity hashing.
#
# =========================================================

# Must be sourced, never executed.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][CAPABILITY][FATAL] shared_utils_not_invocable" >&2
  exit 1
fi

AEGIS_CAPABILITY_NAME=""
AEGIS_TRUNCATED="false"
AEGIS_TMP_FILES=()

# ---------------------------------------------------------
# Identity and configuration
# ---------------------------------------------------------

# Config is sourced at file scope so its declare'd registries stay global
# (declare inside a function would make them function-local).
[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][CAPABILITY][FATAL] missing_config" >&2
  exit 1
}

# Runtime-owned handover location as delivered by the executor's env
# whitelist — captured BEFORE config sourcing overwrites it, so the
# path-containment jail can honor the runtime's explicit authority even
# when the runtime relocates the handover (e.g. test surfaces).
AEGIS_ENV_EPISTEMIC_HANDOVER_FILE="${AEGIS_EPISTEMIC_HANDOVER_FILE:-}"

# shellcheck disable=SC1091
source ".harness/config.sh"

aegis_capability_init() {
  AEGIS_CAPABILITY_NAME="$1"
}

aegis_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# ---------------------------------------------------------
# Failure envelopes
# ---------------------------------------------------------

fail() {
  local error_type="$1"
  local target="${2:-}"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
    --arg error_type "${error_type}" \
    --arg target "${target}" \
    '{
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: {
        type: $error_type,
        target: $target
      }
    }'
}

fail_without_target() {
  local error_type="$1"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
    --arg error_type "${error_type}" \
    '{
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: {
        type: $error_type
      }
    }'
}

# ---------------------------------------------------------
# Common validation
# ---------------------------------------------------------

require_directory_target() {
  local target="$1"

  guard_path_containment "${target}"

  if [[ ! -d "${target}" ]]; then
    fail "missing_directory" "${target}"
    exit 1
  fi
}

# ---------------------------------------------------------
# Path containment jail
# ---------------------------------------------------------

# Canonicalize a path that may not exist yet. Prefers `realpath -m`
# (GNU/coreutils); falls back to python3 on platforms whose native
# realpath lacks -m (macOS/BSD). Both resolve symlinks and ../ segments.
aegis_canonicalize_path() {
  local path="$1"

  if realpath -m / >/dev/null 2>&1; then
    realpath -m -- "${path}"
  else
    python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${path}"
  fi
}

# guard_path_containment <target>
#
# Jail constraint: the resolved absolute target must live strictly under
# AEGIS_ROOT_DIR. Any escape (absolute out-of-tree path, ../ traversal,
# symlink hop) emits the standard failure envelope and exits fatally.
guard_path_containment() {
  local target="$1"

  local resolved_root
  local resolved_target

  resolved_root="$(aegis_canonicalize_path "${AEGIS_ROOT_DIR}")" || {
    fail "path_containment_resolution_failure" "${AEGIS_ROOT_DIR}"
    exit 1
  }

  resolved_target="$(aegis_canonicalize_path "${target}")" || {
    fail "path_containment_resolution_failure" "${target}"
    exit 1
  }

  if [[ "${resolved_target}" == "${resolved_root}" ]] \
    || [[ "${resolved_target}" == "${resolved_root}/"* ]]; then
    return 0
  fi

  # Runtime-owned read targets are explicit authority registered in
  # .harness/config.sh (plus the executor-delivered handover location);
  # they are exempt from the workspace jail by exact canonical match.
  local runtime_target
  for runtime_target in \
    "${AEGIS_ENV_EPISTEMIC_HANDOVER_FILE}" \
    "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[@]:-}"; do
    [[ -n "${runtime_target}" ]] || continue
    if [[ "${resolved_target}" == "$(aegis_canonicalize_path "${runtime_target}")" ]]; then
      return 0
    fi
  done

  fail "path_containment_violation" "${target}"
  exit 1
}

require_prune_policy() {

  declare -p AEGIS_FILESYSTEM_PRUNE_PATHS >/dev/null 2>&1 || {
    fail "missing_prune_policy"
    exit 1
  }

  export PRUNE_PATHS="${AEGIS_FILESYSTEM_PRUNE_PATHS[*]}"
}

# ---------------------------------------------------------
# Python extraction
# ---------------------------------------------------------

readonly AEGIS_FS_WALK_SNIPPET="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_walk.py"

# Run a Python extractor body (stdin) prefixed with the shared file-walk
# prologue (_walk.py). Positional args are forwarded to the program.
run_python_extractor() {
  cat "${AEGIS_FS_WALK_SNIPPET}" - | python3 - "$@"
}

# ---------------------------------------------------------
# Temp file lifecycle
# ---------------------------------------------------------

aegis_mktemp() {
  local tmp
  tmp="$(mktemp)"
  AEGIS_TMP_FILES+=("${tmp}")
  printf '%s' "${tmp}"
}

aegis_cleanup_tmp() {
  rm -f "${AEGIS_TMP_FILES[@]:-}" "${AEGIS_TMP_FILES[@]/%/.bounded}" \
    >/dev/null 2>&1 || true
}

trap aegis_cleanup_tmp EXIT

# ---------------------------------------------------------
# Payload boundaries
# ---------------------------------------------------------

# Truncate a file in place to max_bytes and append a marker line.
# Sets AEGIS_TRUNCATED="true" when truncation occurred.
bound_file_bytes() {
  local file="$1"
  local max_bytes="$2"
  local marker="$3"

  local current_size
  current_size="$(wc -c < "${file}")"

  if [[ "${current_size}" -le "${max_bytes}" ]]; then
    return 0
  fi

  head -c "${max_bytes}" "${file}" > "${file}.bounded"
  printf '\n%s\n' "${marker}" >> "${file}.bounded"
  mv "${file}.bounded" "${file}"

  AEGIS_TRUNCATED="true"
}

# ---------------------------------------------------------
# Success envelopes
# ---------------------------------------------------------

# Wrap a pre-built payload object (stored in a file) in the
# standard capability envelope.
emit_success_payload_file() {
  local payload_file="$1"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
    --slurpfile payload "${payload_file}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: $payload[0],
      error: null
    }'
}

# Wrap extractor output (a JSON document passed as a string) in the
# standard envelope with payload {target, <key>: <document>}.
emit_extraction_result() {
  local payload_key="$1"
  local target="$2"
  local extraction_json="$3"

  local tmp
  tmp="$(aegis_mktemp)"
  printf '%s' "${extraction_json}" > "${tmp}"

  jq -n \
    --arg capability "${AEGIS_CAPABILITY_NAME}" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(aegis_now)" \
    --arg target "${target}" \
    --arg key "${payload_key}" \
    --slurpfile extraction "${tmp}" \
    '{
      success: true,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: {
        target: $target,
        ($key): $extraction[0]
      },
      error: null
    }'

  rm -f "${tmp}" >/dev/null 2>&1 || true
}
