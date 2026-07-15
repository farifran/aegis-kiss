#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — CAPABILITY MANIFEST GENERATOR
# =========================================================
#
# Version: 2.8
# Layer: Capability Topology
# Status: Hardened
#
# Responsibilities:
#
# - deterministic manifest generation
# - capability topology materialization
# - execution engine mapping
# - evidence profile mapping
# - capability provenance
# - manifest integrity
# - topology serialization
#
# The manifest intentionally represents:
#
# - runtime-owned authority
# - capability envelopes
# - evidence profiles
# - execution routing
# - bounded execution topology
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# ROOT RESOLUTION
# =========================================================

readonly AEGIS_MANIFEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

cd "${AEGIS_MANIFEST_ROOT}"

# =========================================================
# CONFIGURATION
# =========================================================

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][MANIFEST][FATAL] missing_config" >&2
  exit 1
}

source ".harness/config.sh"

# =========================================================
# EXECUTION IDENTITY
# =========================================================

readonly AEGIS_MANIFEST_GENERATED_AT="$(
  date -u +"%Y-%m-%dT%H:%M:%SZ"
)"

readonly AEGIS_MANIFEST_EXECUTION_ID="${AEGIS_EXECUTION_ID:-manifest-standalone}"

# =========================================================
# LOGGING
# =========================================================

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
AEGIS_LOG_TAG="MANIFEST"

# =========================================================
# VALIDATION
# =========================================================

validate_environment() {

  command -v jq >/dev/null 2>&1 \
    || aegis_fatal "missing_jq"

  command -v sha256sum >/dev/null 2>&1 \
    || aegis_fatal "missing_sha256sum"

  declare -p AEGIS_EXECUTION_ENGINES >/dev/null 2>&1 \
    || aegis_fatal "missing_execution_engines"

  declare -p AEGIS_MODE_CAPABILITY_MAP >/dev/null 2>&1 \
    || aegis_fatal "missing_mode_capability_map"

  declare -p AEGIS_CAPABILITY_HANDLERS >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_registry"

  declare -p AEGIS_CAPABILITY_CLASSIFICATION >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_classification_registry"

  declare -p AEGIS_MODE_EVIDENCE_PROFILE >/dev/null 2>&1 \
    || aegis_fatal "missing_evidence_profile_registry"
}

validate_handler_registry() {

  local capability
  for capability in "${!AEGIS_CAPABILITY_HANDLERS[@]}"; do

    local handler
    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]}"

    [[ -f "${handler}" ]] \
      || aegis_fatal "missing_handler_file: ${handler}"
  done

  [[ -f "${AEGIS_SHARED_CAPABILITY_UTILS}" ]] \
    || aegis_fatal "missing_shared_capability_utils: ${AEGIS_SHARED_CAPABILITY_UTILS}"

  [[ -f "${AEGIS_SHARED_WALK_SNIPPET}" ]] \
    || aegis_fatal "missing_shared_walk_snippet: ${AEGIS_SHARED_WALK_SNIPPET}"

  [[ -f "${AEGIS_SHARED_CAPABILITY_EMIT}" ]] \
    || aegis_fatal "missing_shared_capability_emit: ${AEGIS_SHARED_CAPABILITY_EMIT}"
}

validate_evidence_profiles() {

  local mode
  local profile_name

  for mode in "${!AEGIS_MODE_EVIDENCE_PROFILE[@]}"; do

    profile_name="${AEGIS_MODE_EVIDENCE_PROFILE[$mode]}"

    declare -p "${profile_name}" >/dev/null 2>&1 || {
      aegis_fatal "missing_evidence_profile_array: ${profile_name}"
    }

    declare -n profile_ref="${profile_name}"

    [[ "${#profile_ref[@]}" -gt 0 ]] || {
      aegis_fatal "empty_evidence_profile_array: ${profile_name}"
    }
  done
}

# =========================================================
# HELPERS
# =========================================================

sorted_mode_names() {
  printf '%s\n' "${!AEGIS_EXECUTION_ENGINES[@]}" | sort
}

build_capabilities_json() {

  local capability_list_name="$1"

  declare -n capability_ref="${capability_list_name}"

  local tmp_caps_file
  tmp_caps_file="$(mktemp)"

  local capability
  for capability in "${capability_ref[@]}"; do

    local handler
    local classification
    local argument_contract

    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]:-}"
    classification="${AEGIS_CAPABILITY_CLASSIFICATION[$capability]:-unknown}"
    argument_contract="${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"

    [[ -n "${handler}" ]] \
      || aegis_fatal "missing_handler_for_capability: ${capability}"

    jq -n \
      --arg capability "${capability}" \
      --arg classification "${classification}" \
      --arg handler "${handler}" \
      --arg argument_contract "${argument_contract}" \
      '{
        capability: $capability,
        classification: $classification,
        handler: $handler,
        argument_contract: $argument_contract
      }' >> "${tmp_caps_file}"
  done

  jq -s '.' "${tmp_caps_file}"
  rm -f "${tmp_caps_file}" >/dev/null 2>&1 || true
}

build_evidence_capabilities_json() {

  local evidence_list_name="$1"

  declare -n evidence_ref="${evidence_list_name}"

  local tmp_evidence_file
  tmp_evidence_file="$(mktemp)"

  local -A seen_capabilities=()

  local evidence_entry
  for evidence_entry in "${evidence_ref[@]}"; do
    local capability
    capability="${evidence_entry%%:*}"

    if [[ -n "${seen_capabilities[$capability]:-}" ]]; then
      continue
    fi

    seen_capabilities["${capability}"]="true"
    printf '%s\n' "${capability}" >> "${tmp_evidence_file}"
  done

  jq -R . < "${tmp_evidence_file}" | jq -s '.'
  rm -f "${tmp_evidence_file}" >/dev/null 2>&1 || true
}

build_mode_object() {

  local mode="$1"

  local engine
  local envelope_name
  local evidence_profile_name
  local capabilities_json
  local evidence_capabilities_json

  engine="${AEGIS_EXECUTION_ENGINES[$mode]:-}"
  [[ -n "${engine}" ]] \
    || aegis_fatal "missing_execution_engine: ${mode}"

  envelope_name="${AEGIS_MODE_CAPABILITY_MAP[$mode]:-}"
  [[ -n "${envelope_name}" ]] \
    || aegis_fatal "missing_capability_envelope: ${mode}"

  evidence_profile_name="${AEGIS_MODE_EVIDENCE_PROFILE[$mode]:-}"
  [[ -n "${evidence_profile_name}" ]] \
    || aegis_fatal "missing_evidence_profile: ${mode}"

  capabilities_json="$(
    build_capabilities_json "${envelope_name}"
  )"

  evidence_capabilities_json="$(
    build_evidence_capabilities_json "${evidence_profile_name}"
  )"

  jq -n \
    --arg mode "${mode}" \
    --arg execution_engine "${engine}" \
    --arg capability_envelope "${envelope_name}" \
    --arg evidence_profile "${evidence_profile_name}" \
    --argjson capabilities "${capabilities_json}" \
    --argjson evidence_capabilities "${evidence_capabilities_json}" \
    '{
      mode: $mode,
      execution_engine: $execution_engine,
      capability_envelope: $capability_envelope,
      evidence_profile: $evidence_profile,
      capabilities: $capabilities,
      evidence_capabilities: $evidence_capabilities
    }'
}

build_modes_object() {

  local modes_json='{}'
  local mode
  local mode_object

  while IFS= read -r mode; do

    mode_object="$(
      build_mode_object "${mode}"
    )"

    modes_json="$(
      jq -n \
        --argjson acc "${modes_json}" \
        --arg mode "${mode}" \
        --argjson mode_object "${mode_object}" \
        '$acc + {($mode): $mode_object}'
    )"

  done < <(sorted_mode_names)

  printf '%s\n' "${modes_json}"
}

# Shared helpers sourced by capability surfaces. Their content participates
# in manifest integrity so envelope/walk changes re-hash the contract.
readonly AEGIS_SHARED_CAPABILITY_UTILS="scripts/capabilities/filesystem/_shared_utils.sh"
readonly AEGIS_SHARED_WALK_SNIPPET="scripts/capabilities/filesystem/_walk.py"
readonly AEGIS_SHARED_CAPABILITY_EMIT="scripts/capabilities/_emit.sh"

compute_manifest_hash() {

  local manifest_body_file="$1"

  cat "${manifest_body_file}" \
    "${AEGIS_SHARED_CAPABILITY_UTILS}" \
    "${AEGIS_SHARED_WALK_SNIPPET}" \
    "${AEGIS_SHARED_CAPABILITY_EMIT}" \
    | sha256sum \
    | awk '{print $1}'
}

# =========================================================
# MANIFEST GENERATION
# =========================================================

generate_manifest() {

  local manifest_body_file
  manifest_body_file="$(mktemp)"

  local modes_object
  modes_object="$(
    build_modes_object
  )"

  jq -n \
    --arg schema_version "2.8" \
    --arg runtime_model "runtime_owned_capability_payload_execution" \
    --arg generated_at "${AEGIS_MANIFEST_GENERATED_AT}" \
    --arg execution_id "${AEGIS_MANIFEST_EXECUTION_ID}" \
    --argjson modes "${modes_object}" \
    '{
      schema_version: $schema_version,
      runtime_model: $runtime_model,
      generated_at: $generated_at,
      execution_id: $execution_id,
      modes: $modes
    }' > "${manifest_body_file}"

  jq empty "${manifest_body_file}" >/dev/null 2>&1 \
    || aegis_fatal "invalid_manifest_structure"

  local manifest_hash
  manifest_hash="$(
    compute_manifest_hash "${manifest_body_file}"
  )"

  jq \
    --arg manifest_hash "${manifest_hash}" \
    '. + {manifest_hash: $manifest_hash}' \
    "${manifest_body_file}"
}

# =========================================================
# MAIN
# =========================================================

main() {

  aegis_log "Generating capability manifest..."

  validate_environment
  validate_handler_registry
  validate_evidence_profiles

  generate_manifest
}

main "$@"