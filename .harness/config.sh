#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — OPERATIONAL TOPOLOGY CONFIGURATION
# =========================================================
#
# Version: 2.9
# Layer: Constitutional Runtime Topology
# Status: Hardened
#
# Responsibilities:
#
# - runtime topology source
# - capability registry
# - capability contracts
# - execution engine registry
# - provider operational policy
# - substrate defaults
# - protocol constants
# - cleanup policy
# - evidence budgets
# - evidence exposure policy
# - mode evidence profiles
# - filesystem pruning policy
#
# =========================================================

# =========================================================
# ROOT TOPOLOGY
# =========================================================

readonly AEGIS_ROOT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"

# =========================================================
# SYSTEM METADATA
# =========================================================

export PATH="/Users/rafaelfarias/.gemini/antigravity/bin:$PATH"

# =========================================================
# RUNTIME TOPOLOGY
# =========================================================

export AEGIS_RUNTIME_DIR="${AEGIS_ROOT_DIR}/.harness/runtime"
export AEGIS_EXECUTION_SURFACE_ROOT="${AEGIS_ROOT_DIR}/.harness/execution_surfaces"

export AEGIS_CAPABILITY_ENV_DIR="${AEGIS_ROOT_DIR}/.harness/runtime/capability_env"
export AEGIS_CAPABILITY_PAYLOAD_DIR="${AEGIS_ROOT_DIR}/.harness/runtime/capability_payloads"

export AEGIS_EPISTEMIC_HANDOVER_FILE="${AEGIS_ROOT_DIR}/.harness/runtime/epistemic_handover.json"

: "${AEGIS_DEFAULT_INVESTIGATION_INPUT:=Analyze repository structure and identify highest-value investigation targets}"
: "${AEGIS_INVESTIGATION_INPUT:=}"
if [[ -d "${AEGIS_ROOT_DIR}/src" ]]; then
  : "${AEGIS_EVIDENCE_TARGET_PATH:=src}"
else
  : "${AEGIS_EVIDENCE_TARGET_PATH:=.}"
fi

export AEGIS_DEFAULT_INVESTIGATION_INPUT
export AEGIS_INVESTIGATION_INPUT
export AEGIS_EVIDENCE_TARGET_PATH

# =========================================================
# ARTIFACT PROTOCOL
# =========================================================

export AEGIS_ARTIFACT_BEGIN_MARKER="AEGIS_ARTIFACT_BEGIN"
export AEGIS_ARTIFACT_END_MARKER="AEGIS_ARTIFACT_END"

# =========================================================
# PROVIDER DEFAULTS
# =========================================================

: "${OPENAI_API_BASE:=https://integrate.api.nvidia.com/v1}"
export OPENAI_API_BASE

# =========================================================
# MODEL CONFIGURATION (KISS UNIFIED MODEL)
# =========================================================
# All modes utilize the unified frontier model.

: "${OPENAI_MODEL_READONLY_COGNITION:=${OPENAI_MODEL_ANALYSIS:-google/gemma-4-31b-it}}"
export OPENAI_MODEL_READONLY_COGNITION

export AEGIS_MUTATION_MODEL="${OPENAI_MODEL_READONLY_COGNITION}"

if [[ "${AEGIS_MUTATION_MODEL}" == */* ]] \
  && [[ "${AEGIS_MUTATION_MODEL}" != openai/* ]]; then
  export AEGIS_AIDER_MODEL="openai/${AEGIS_MUTATION_MODEL}"
else
  export AEGIS_AIDER_MODEL="${AEGIS_MUTATION_MODEL}"
fi

: "${AEGIS_AIDER_BIN:=${AEGIS_ROOT_DIR}/.venv/bin/aider}"
: "${AEGIS_MUTATION_GIT_DIR:=${AEGIS_ROOT_DIR}/.git}"

export OPENAI_API_BASE
export OPENAI_MODEL_READONLY_COGNITION
export AEGIS_MUTATION_MODEL
export AEGIS_AIDER_MODEL
export AEGIS_AIDER_BIN
export AEGIS_MUTATION_GIT_DIR

# =========================================================
# RAW SUBSTRATE POLICY
# =========================================================

: "${AEGIS_RAW_SUBSTRATE_TEMPERATURE:=0.1}"
# Output token budget — prevents model truncation of structured JSON artifacts.
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS:=4096}"

export AEGIS_RAW_SUBSTRATE_TEMPERATURE
export AEGIS_RAW_SUBSTRATE_MAX_TOKENS

# =========================================================
# PROVIDER POLICY
# =========================================================

: "${AEGIS_PROVIDER_MAX_RETRIES:=3}"
: "${AEGIS_PROVIDER_RETRY_DELAY:=2}"
: "${AEGIS_PROVIDER_CONNECT_TIMEOUT:=15}"
: "${AEGIS_PROVIDER_RESPONSE_TIMEOUT:=120}"

export AEGIS_PROVIDER_MAX_RETRIES
export AEGIS_PROVIDER_RETRY_DELAY
export AEGIS_PROVIDER_CONNECT_TIMEOUT
export AEGIS_PROVIDER_RESPONSE_TIMEOUT

# =========================================================
# CLEANUP POLICY
# =========================================================

: "${AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE:=true}"
: "${AEGIS_RUNTIME_REMOVE_CAPABILITY_ENV:=true}"
: "${AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS:=true}"

export AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE
export AEGIS_RUNTIME_REMOVE_CAPABILITY_ENV
export AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS

# =========================================================
# EVIDENCE BUDGETS
# =========================================================

: "${AEGIS_EVIDENCE_MAX_FILES:=25}"
: "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:=45000}"
: "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES:=150000}"
: "${AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES:=100}"
: "${AEGIS_FILE_CONTENT_MAX_BYTES:=50000}"
: "${AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES:=150000}"
: "${AEGIS_CAPABILITY_MANIFEST_MAX_BYTES:=75000}"

# Per-mode evidence budgets — constitutional guard against prompt explosion.
# Discovery is bounded to 50KB of evidence (topology snapshot + attention seed).
# Forensics gets 80KB (needs more context for interpretation).
# These are enforced by the substrate before the prompt is assembled.
: "${AEGIS_MAX_DISCOVERY_BYTES:=50000}"
: "${AEGIS_MAX_FORENSICS_BYTES:=80000}"

export AEGIS_EVIDENCE_MAX_FILES
export AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES
export AEGIS_EVIDENCE_MAX_TOTAL_BYTES
export AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES
export AEGIS_FILE_CONTENT_MAX_BYTES
export AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES
export AEGIS_CAPABILITY_MANIFEST_MAX_BYTES
export AEGIS_MAX_DISCOVERY_BYTES
export AEGIS_MAX_FORENSICS_BYTES

# =========================================================
# CAPABILITY DEFAULTS
# =========================================================

: "${AEGIS_LIST_TREE_MAX_DEPTH:=4}"
: "${AEGIS_SEARCH_SYMBOL_CONTEXT_LINES:=2}"

export AEGIS_LIST_TREE_MAX_DEPTH
export AEGIS_SEARCH_SYMBOL_CONTEXT_LINES

# =========================================================
# FILESYSTEM PRUNE POLICY
# =========================================================

declare -ar AEGIS_FILESYSTEM_PRUNE_PATHS=(
  "node_modules"
  ".git"
  ".harness"
  ".skills"
  "scripts/substrates/test"
  ".venv"
  ".aider.tags.cache.v4"
  "tests/benchmark"
  "tests/golden"
)

export AEGIS_FILESYSTEM_PRUNE_PATHS

# =========================================================
# EXECUTION ENGINES
# =========================================================

declare -Ar AEGIS_EXECUTION_ENGINES=(
  ["discovery"]="raw"
  ["forensics"]="raw"
  ["validation"]="raw"
  ["adversarial"]="raw"
  ["repair"]="aider"
  ["optimize"]="raw"
)

# =========================================================
# CAPABILITY SETS
# =========================================================

declare -ar AEGIS_BASE_CAPABILITIES=(
  "filesystem.list_tree"
  "filesystem.read"
  "filesystem.search_symbol"
  "git.status"
  "typescript.check"
  "eslint.check"
  "test.run"
)

declare -ar AEGIS_MUTATION_EXTRA_CAPABILITIES=(
  "git.diff"
)

declare -ar AEGIS_MUTATION_CAPABILITIES=(
  "${AEGIS_BASE_CAPABILITIES[@]}"
  "${AEGIS_MUTATION_EXTRA_CAPABILITIES[@]}"
)

# Structural extraction capabilities — readonly, discovery-only
declare -ar AEGIS_STRUCTURAL_EXTRACT_CAPABILITIES=(
  "filesystem.extract_import_graph"
  "filesystem.extract_reference_graph"
  "filesystem.extract_symbols"
  "filesystem.extract_entrypoints"
  "filesystem.extract_test_relationships"
  "filesystem.extract_configuration_structure"
  "filesystem.extract_responsibilities"
  "structural.builder"
  "runtime.attention_seed"
)

# Discovery envelope = base + structural extraction
declare -ar AEGIS_DISCOVERY_CAPABILITIES=(
  "${AEGIS_BASE_CAPABILITIES[@]}"
  "${AEGIS_STRUCTURAL_EXTRACT_CAPABILITIES[@]}"
)

# =========================================================
# RUNTIME-OWNED FILESYSTEM READ TARGETS
# =========================================================

declare -Ar AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS=(
  ["epistemic_handover"]="${AEGIS_EPISTEMIC_HANDOVER_FILE}"
)

# =========================================================
# MODE → CAPABILITY ENVELOPE
# =========================================================

declare -Ar AEGIS_MODE_CAPABILITY_MAP=(
  ["discovery"]="AEGIS_DISCOVERY_CAPABILITIES"
  ["forensics"]="AEGIS_BASE_CAPABILITIES"
  ["validation"]="AEGIS_BASE_CAPABILITIES"
  ["adversarial"]="AEGIS_BASE_CAPABILITIES"
  ["repair"]="AEGIS_MUTATION_CAPABILITIES"
  ["optimize"]="AEGIS_MUTATION_CAPABILITIES"
)

# =========================================================
# CAPABILITY HANDLERS
# =========================================================

declare -Ar AEGIS_CAPABILITY_HANDLERS=(
  ["filesystem.list_tree"]="scripts/capabilities/filesystem/list_tree.sh"
  ["filesystem.read"]="scripts/capabilities/filesystem/read_file.sh"
  ["filesystem.search_symbol"]="scripts/capabilities/filesystem/search_symbol.sh"
  ["git.diff"]="scripts/capabilities/git/git_diff.sh"
  ["git.status"]="scripts/capabilities/git/git_status.sh"
  ["filesystem.extract_import_graph"]="scripts/capabilities/filesystem/extract_import_graph.sh"
  ["filesystem.extract_reference_graph"]="scripts/capabilities/filesystem/extract_reference_graph.sh"
  ["filesystem.extract_symbols"]="scripts/capabilities/filesystem/extract_symbols.sh"
  ["filesystem.extract_entrypoints"]="scripts/capabilities/filesystem/extract_entrypoints.sh"
  ["filesystem.extract_test_relationships"]="scripts/capabilities/filesystem/extract_test_relationships.sh"
  ["filesystem.extract_configuration_structure"]="scripts/capabilities/filesystem/extract_configuration_structure.sh"
  ["filesystem.extract_responsibilities"]="scripts/capabilities/filesystem/extract_responsibilities.sh"
  ["structural.builder"]="scripts/capabilities/structural/builder.sh"
  ["runtime.attention_seed"]="scripts/capabilities/runtime/attention_seed.sh"
  ["typescript.check"]="scripts/capabilities/typescript_check.sh"
  ["eslint.check"]="scripts/capabilities/eslint_check.sh"
  ["test.run"]="scripts/capabilities/test_runner.sh"
)

# =========================================================
# CAPABILITY CLASSIFICATION
# =========================================================

declare -Ar AEGIS_CAPABILITY_CLASSIFICATION=(
  ["filesystem.list_tree"]="readonly"
  ["filesystem.read"]="readonly"
  ["filesystem.search_symbol"]="readonly"
  ["git.diff"]="readonly"
  ["git.status"]="readonly"
  ["filesystem.extract_import_graph"]="readonly"
  ["filesystem.extract_reference_graph"]="readonly"
  ["filesystem.extract_symbols"]="readonly"
  ["filesystem.extract_entrypoints"]="readonly"
  ["filesystem.extract_test_relationships"]="readonly"
  ["filesystem.extract_configuration_structure"]="readonly"
  ["filesystem.extract_responsibilities"]="readonly"
  ["structural.builder"]="readonly"
  ["runtime.attention_seed"]="readonly"
  ["typescript.check"]="readonly"
  ["eslint.check"]="readonly"
  ["test.run"]="readonly"
)

# =========================================================
# CAPABILITY INVOCATION CONTRACTS
# =========================================================

declare -Ar AEGIS_CAPABILITY_ARGUMENTS=(
  ["filesystem.list_tree"]="."
  ["filesystem.read"]="AGENTS.md"
  ["filesystem.search_symbol"]="AEGIS"
  ["git.diff"]="HEAD~1"
  ["git.status"]="."
  ["filesystem.extract_import_graph"]="."
  ["filesystem.extract_reference_graph"]="."
  ["filesystem.extract_symbols"]="."
  ["filesystem.extract_entrypoints"]="."
  ["filesystem.extract_test_relationships"]="."
  ["filesystem.extract_configuration_structure"]="."
  ["filesystem.extract_responsibilities"]="."
  ["structural.builder"]="."
  ["runtime.attention_seed"]="."
  ["typescript.check"]="."
  ["eslint.check"]="src"
  ["test.run"]="."
)

# =========================================================
# MODE EVIDENCE PROFILES
# =========================================================

declare -ar AEGIS_DISCOVERY_EVIDENCE=(
  "filesystem.list_tree"
  "filesystem.read:epistemic_handover"
  "filesystem.extract_responsibilities"
  "structural.builder"
  "runtime.attention_seed"
)

declare -ar AEGIS_FORENSICS_EVIDENCE=(
  "filesystem.search_symbol"
  "git.status"
  "filesystem.read:epistemic_handover"  # Forensics must only interpret evidence provided by Discovery
)

declare -ar AEGIS_VALIDATION_EVIDENCE=(
  "filesystem.read:epistemic_handover"
)

declare -ar AEGIS_ADVERSARIAL_EVIDENCE=(
  "filesystem.search_symbol"
  "filesystem.read:epistemic_handover"
)

declare -ar AEGIS_MUTATION_EVIDENCE=(
  "filesystem.search_symbol"
  "filesystem.read:epistemic_handover"
  "git.diff"
  "git.status"
  "typescript.check"
  "eslint.check"
  "test.run"
)

declare -ar AEGIS_OPTIMIZE_EVIDENCE=(
  "filesystem.read:epistemic_handover"
)

declare -Ar AEGIS_MODE_EVIDENCE_PROFILE=(
  ["discovery"]="AEGIS_DISCOVERY_EVIDENCE"
  ["forensics"]="AEGIS_FORENSICS_EVIDENCE"
  ["validation"]="AEGIS_VALIDATION_EVIDENCE"
  ["adversarial"]="AEGIS_ADVERSARIAL_EVIDENCE"
  ["repair"]="AEGIS_MUTATION_EVIDENCE"
  ["optimize"]="AEGIS_OPTIMIZE_EVIDENCE"
)

# =========================================================
# VALIDATION HELPERS
# =========================================================

validate_provider_configuration() {

  [[ -n "${OPENAI_API_BASE}" ]] || {
    echo "[AEGIS][CONFIG][FATAL] missing_openai_api_base" >&2
    return 1
  }

  [[ -n "${OPENAI_MODEL_READONLY_COGNITION}" ]] || {
    echo "[AEGIS][CONFIG][FATAL] missing_readonly_cognition_model" >&2
    return 1
  }

  [[ -n "${AEGIS_PROVIDER_MAX_RETRIES}" ]] || {
    echo "[AEGIS][CONFIG][FATAL] missing_provider_max_retries" >&2
    return 1
  }

  [[ -n "${AEGIS_PROVIDER_RETRY_DELAY}" ]] || {
    echo "[AEGIS][CONFIG][FATAL] missing_provider_retry_delay" >&2
    return 1
  }

  [[ -n "${AEGIS_PROVIDER_CONNECT_TIMEOUT}" ]] || {
    echo "[AEGIS][CONFIG][FATAL] missing_provider_connect_timeout" >&2
    return 1
  }

  [[ -n "${AEGIS_PROVIDER_RESPONSE_TIMEOUT}" ]] || {
    echo "[AEGIS][CONFIG][FATAL] missing_provider_response_timeout" >&2
    return 1
  }
}

validate_evidence_policy() {

  [[ "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" -gt 0 ]] || {
    echo "[AEGIS][CONFIG][FATAL] invalid_evidence_total_budget" >&2
    return 1
  }

  [[ "${AEGIS_EVIDENCE_MAX_FILES}" -gt 0 ]] || {
    echo "[AEGIS][CONFIG][FATAL] invalid_evidence_file_budget" >&2
    return 1
  }

  [[ "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES}" -gt 0 ]] || {
    echo "[AEGIS][CONFIG][FATAL] invalid_capability_payload_budget" >&2
    return 1
  }
}

validate_capability_registry() {

  local -A seen=()
  local capability

  for capability in \
    "${AEGIS_BASE_CAPABILITIES[@]}" \
    "${AEGIS_MUTATION_CAPABILITIES[@]}" \
    "${AEGIS_STRUCTURAL_EXTRACT_CAPABILITIES[@]}"; do

    [[ -n "${seen[$capability]:-}" ]] && continue
    seen["$capability"]=1

    [[ -n "${AEGIS_CAPABILITY_HANDLERS[$capability]:-}" ]] || {
      echo "[AEGIS][CONFIG][FATAL] unregistered_capability_handler: ${capability}" >&2
      return 1
    }

    [[ -n "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}" ]] || {
      echo "[AEGIS][CONFIG][FATAL] missing_capability_argument_contract: ${capability}" >&2
      return 1
    }

  done
}

validate_evidence_profiles() {

  local mode
  local profile_name
  local envelope_name
  local capability
  local base_capability
  local envelope_capability
  local capability_is_authorized

  for mode in "${!AEGIS_MODE_EVIDENCE_PROFILE[@]}"; do

    profile_name="${AEGIS_MODE_EVIDENCE_PROFILE[$mode]}"
    envelope_name="${AEGIS_MODE_CAPABILITY_MAP[$mode]:-}"

    [[ -n "${envelope_name}" ]] || {
      echo "[AEGIS][CONFIG][FATAL] missing_capability_envelope_for_mode: ${mode}" >&2
      return 1
    }

    declare -p "${profile_name}" >/dev/null 2>&1 || {
      echo "[AEGIS][CONFIG][FATAL] missing_evidence_profile_array: ${profile_name}" >&2
      return 1
    }

    declare -n profile_ref="${profile_name}"
    declare -n envelope_ref="${envelope_name}"

    [[ "${#profile_ref[@]}" -gt 0 ]] || {
      echo "[AEGIS][CONFIG][FATAL] empty_evidence_profile_array: ${profile_name}" >&2
      return 1
    }

    for capability in "${profile_ref[@]}"; do

      base_capability="${capability%%:*}"

      capability_is_authorized="false"

      for envelope_capability in "${envelope_ref[@]}"; do
        if [[ "${envelope_capability}" == "${base_capability}" ]]; then
          capability_is_authorized="true"
          break
        fi
      done

      [[ "${capability_is_authorized}" == "true" ]] || {
        echo "[AEGIS][CONFIG][FATAL] evidence_capability_outside_envelope: ${mode}:${capability}" >&2
        return 1
      }

    done

  done
}

validate_filesystem_prune_policy() {

  [[ "${#AEGIS_FILESYSTEM_PRUNE_PATHS[@]}" -gt 0 ]] || {
    echo "[AEGIS][CONFIG][FATAL] empty_filesystem_prune_policy" >&2
    return 1
  }
}

validate_aegis_configuration() {

  validate_provider_configuration || return 1
  validate_evidence_policy || return 1
  validate_capability_registry || return 1
  validate_evidence_profiles || return 1
  validate_filesystem_prune_policy || return 1
}

# =========================================================
# CONSTITUTIONAL STATE REGISTRY
# =========================================================

declare -ar AEGIS_PROVEN_SURFACES=(
  "payload_provenance_tracking"
  "readonly_execution_surface_elision"
  "runtime_owned_artifact_snapshot_handover"
)

declare -ar AEGIS_INTENDED_SURFACES=(
  "bounded_mutation_hardening"
)

declare -ar AEGIS_DEFERRED_SURFACES=(
  "advanced_capability_sandboxing"
)

# =========================================================
# VALIDATE IMMEDIATELY
# =========================================================

validate_aegis_configuration
