#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EPISTEMIC HANDOVER PRIMITIVES (source-only)
# =========================================================
#
# Schema filters, size gates, and read/write helpers for
# .harness/runtime/epistemic_handover.json. Sourced by
# runtime_aegis.sh. Does not own promotion sequencing.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] epistemic_handover_lib_not_invocable" >&2
  exit 1
fi

# =========================================================
# EPISTEMIC HANDOVER
# =========================================================

epistemic_state_schema_filter() {
  cat <<'EOF'
type == "object"
and ((keys | sort) == [
  "attention_reason",
  "attention_scope",
  "next_attention_targets"
])
and (.next_attention_targets | type == "array")
and (.attention_scope | type == "string" and length > 0)
and (.attention_reason | type == "string" and length > 0)
and (
  [.next_attention_targets[]] | all(type == "string")
)
EOF
}

epistemic_handover_schema_filter() {
  cat <<EOF
type == "object"
and ((keys | sort) == [
  "artifact_snapshot",
  "epistemic_state"
])
and (
  (.artifact_snapshot == null)
  or (.artifact_snapshot | type == "object")
)
and (
  .epistemic_state
  | (
$(epistemic_state_schema_filter)
    )
)
EOF
}

handover_schema_is_valid() {

  local handover_file="$1"

  jq -e "$(epistemic_handover_schema_filter)" "${handover_file}" >/dev/null 2>&1
}

write_empty_epistemic_handover_state_json() {
  printf '%s' '{"next_attention_targets":[],"attention_scope":"none","attention_reason":"no active attention"}'
}

handover_size_is_valid() {

  local handover_file="$1"
  local handover_size_bytes

  [[ -f "${handover_file}" ]] || return 1

  handover_size_bytes="$(
    wc -c < "${handover_file}"
  )"

  [[ "${handover_size_bytes}" -le "${AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES}" ]]
}

runtime_owned_epistemic_handover_is_valid() {

  local handover_file="$1"

  [[ -f "${handover_file}" ]] \
    && handover_schema_is_valid "${handover_file}" \
    && handover_size_is_valid "${handover_file}"
}

assert_valid_runtime_owned_epistemic_handover() {

  local handover_file="$1"
  local invalid_error="$2"
  local size_error="$3"

  handover_schema_is_valid "${handover_file}" \
    || aegis_fatal "${invalid_error}"

  handover_size_is_valid "${handover_file}" \
    || aegis_fatal "${size_error}"
}

write_empty_epistemic_handover() {

  local handover_file="$1"

  write_runtime_owned_epistemic_handover \
    "${handover_file}" \
    'null' \
    "$(write_empty_epistemic_handover_state_json)"
}

write_runtime_owned_epistemic_handover() {

  local handover_file="$1"
  local artifact_snapshot_json="$2"
  local epistemic_state_json="$3"
  local tmp_handover_file

  tmp_handover_file="$(mktemp)"

  jq -n \
    --argjson artifact_snapshot "${artifact_snapshot_json}" \
    --argjson epistemic_state "${epistemic_state_json}" \
    '{
      artifact_snapshot: $artifact_snapshot,
      epistemic_state: $epistemic_state
    }' > "${tmp_handover_file}" \
    || aegis_fatal "failed_to_materialize_epistemic_handover"

  handover_size_is_valid "${tmp_handover_file}" \
    || aegis_fatal "epistemic_handover_runtime_state_exceeds_max_bytes"

  mv "${tmp_handover_file}" "${handover_file}" \
    || aegis_fatal "failed_to_commit_epistemic_handover"
}

remove_runtime_owned_execution_surface_if_present() {

  if git worktree list | grep -q "${AEGIS_EXECUTION_SURFACE_PATH}" \
    || [[ -d "${AEGIS_EXECUTION_SURFACE_PATH:-}" ]]; then
    git worktree remove \
      --force \
      "${AEGIS_EXECUTION_SURFACE_PATH}" \
      >/dev/null 2>&1 || true
    rm -rf "${AEGIS_EXECUTION_SURFACE_PATH}"
  fi

  git worktree prune \
    >/dev/null 2>&1 || true
}

remove_runtime_owned_capability_surfaces() {

  local respect_cleanup_policy="${1:-true}"

  if [[ "${respect_cleanup_policy}" == "false" ]] \
    || [[ "${AEGIS_RUNTIME_REMOVE_CAPABILITY_ENV}" == "true" ]]; then
    rm -rf "${AEGIS_CAPABILITY_ENV_DIR}" \
      >/dev/null 2>&1 || true
  fi

  if [[ "${respect_cleanup_policy}" == "false" ]] \
    || [[ "${AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS}" == "true" ]]; then
    rm -rf "${AEGIS_CAPABILITY_PAYLOAD_DIR}" \
      >/dev/null 2>&1 || true
  fi
}

prepare_runtime_owned_epistemic_handover() {

  local handover_file="$1"

  if ! runtime_owned_epistemic_handover_is_valid "${handover_file}"; then
    aegis_warn "invalid_epistemic_handover_detected_reinitializing"
    write_empty_epistemic_handover "${handover_file}"
  fi

  assert_valid_runtime_owned_epistemic_handover \
    "${handover_file}" \
    "invalid_epistemic_handover_runtime_state" \
    "epistemic_handover_runtime_state_exceeds_max_bytes"
}

reset_runtime_owned_epistemic_handover_for_new_investigation() {

  if ! mode_starts_new_investigation; then
    return
  fi

  aegis_log "Resetting runtime-owned epistemic handover for new investigation boundary..."

  write_empty_epistemic_handover "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
}
