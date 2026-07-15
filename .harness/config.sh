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

# Provider credentials (gitignored). Opt-in via AEGIS_LOAD_LOCAL_ENV=1 so
# isolated capability children that re-source config under env -i never pull
# secrets from disk. Entry points (runtime/executor/raw) set the flag.
# Also skip when AEGIS_SKIP_LOCAL_ENV=1 (local MLX) or test-key sentinels.
if [[ "${AEGIS_LOAD_LOCAL_ENV:-0}" == "1" ]] \
  && [[ "${AEGIS_SKIP_LOCAL_ENV:-0}" != "1" ]] \
  && [[ -f "${AEGIS_ROOT_DIR}/.harness/local.env" ]] \
  && [[ "${OPENAI_API_KEY:-}" != *test-key* ]]; then
  # shellcheck disable=SC1091
  source "${AEGIS_ROOT_DIR}/.harness/local.env"
fi

# =========================================================
# CONFIG FATAL HELPER
# =========================================================
# Prefer shared aegis_fatal when the common lib is already loaded;
# otherwise emit a stable CONFIG-tagged fatal without machine-local
# PATH hacks or duplicated logging conventions.

# Soft reject for validate_* helpers (return 1 to the caller).
aegis_config_reject() {
  echo "[AEGIS][CONFIG][FATAL] $*" >&2
  return 1
}

# Hard fatal for unrecoverable config resolution failures.
aegis_config_fatal() {
  if declare -f aegis_fatal >/dev/null 2>&1; then
    AEGIS_LOG_TAG="${AEGIS_LOG_TAG:-CONFIG}" aegis_fatal "$@"
  fi
  echo "[AEGIS][CONFIG][FATAL] $*" >&2
  exit 1
}

# =========================================================
# RUNTIME TOPOLOGY
# =========================================================

# Honor pre-injected values (tests, stripped env -i substrates) so a
# re-source of config never clobbers an operator/test-provided surface.
: "${AEGIS_RUNTIME_DIR:=${AEGIS_ROOT_DIR}/.harness/runtime}"
: "${AEGIS_EXECUTION_SURFACE_ROOT:=${AEGIS_ROOT_DIR}/.harness/execution_surfaces}"
: "${AEGIS_CAPABILITY_ENV_DIR:=${AEGIS_ROOT_DIR}/.harness/runtime/capability_env}"
: "${AEGIS_CAPABILITY_PAYLOAD_DIR:=${AEGIS_ROOT_DIR}/.harness/runtime/capability_payloads}"
: "${AEGIS_EPISTEMIC_HANDOVER_FILE:=${AEGIS_ROOT_DIR}/.harness/runtime/epistemic_handover.json}"

export AEGIS_RUNTIME_DIR
export AEGIS_EXECUTION_SURFACE_ROOT
export AEGIS_CAPABILITY_ENV_DIR
export AEGIS_CAPABILITY_PAYLOAD_DIR
export AEGIS_EPISTEMIC_HANDOVER_FILE

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

# Snapshot of the RAW operator-provided model, captured BEFORE any
# derivation/defaulting so validate_provider_configuration can assert on
# genuine operator intent instead of a post-default tautology.
AEGIS_OPERATOR_MODEL_RAW="${OPENAI_MODEL_READONLY_COGNITION:-${OPENAI_MODEL_ANALYSIS:-${AEGIS_AIDER_MODEL:-${AEGIS_MUTATION_MODEL:-}}}}"
export AEGIS_OPERATOR_MODEL_RAW

# =========================================================
# MODEL CONFIGURATION (KISS UNIFIED MODEL)
# =========================================================
# Idempotent, clobber-safe resolution. Every assignment honors an
# already-set/injected value, so a re-source inside a stripped env -i
# substrate boundary can NEVER clobber an injected model back to a
# default. There is NO non-frontier fallback: in a model-requiring
# context (cognition substrates export AEGIS_REQUIRE_MODEL=1) with no
# model in any form, resolution is a hard fatal — a mis-set model fails
# loudly instead of silently downgrading to a stalling default. The
# observation layer (capability handlers, manifest generation) never
# sets AEGIS_REQUIRE_MODEL, so it sources config model-less without fatal.
# AEGIS_MODEL_RESOLVED=1 marks an upstream resolution and, propagated
# across env -i whitelists, lets a stripped re-source trust that a model
# was already validated upstream.

if [[ "${AEGIS_REQUIRE_MODEL:-}" == "1" ]] \
  && [[ "${AEGIS_MODEL_RESOLVED:-}" != "1" ]] \
  && [[ -z "${AEGIS_OPERATOR_MODEL_RAW}" ]]; then
  aegis_config_fatal "missing_model_configuration"
fi

if [[ -z "${OPENAI_MODEL_READONLY_COGNITION:-}" ]] \
  && [[ -n "${OPENAI_MODEL_ANALYSIS:-}" ]]; then
  OPENAI_MODEL_READONLY_COGNITION="${OPENAI_MODEL_ANALYSIS}"
fi

# Honor any pre-set/injected value; derive only when unset.
: "${AEGIS_MUTATION_MODEL:=${OPENAI_MODEL_READONLY_COGNITION:-}}"

if [[ -z "${AEGIS_AIDER_MODEL:-}" ]] && [[ -n "${AEGIS_MUTATION_MODEL}" ]]; then
  if [[ "${AEGIS_MUTATION_MODEL}" == */* ]] \
    && [[ "${AEGIS_MUTATION_MODEL}" != openai/* ]]; then
    AEGIS_AIDER_MODEL="openai/${AEGIS_MUTATION_MODEL}"
  else
    AEGIS_AIDER_MODEL="${AEGIS_MUTATION_MODEL}"
  fi
fi

export AEGIS_MODEL_RESOLVED=1
export OPENAI_MODEL_READONLY_COGNITION="${OPENAI_MODEL_READONLY_COGNITION:-}"
export AEGIS_MUTATION_MODEL="${AEGIS_MUTATION_MODEL:-}"
export AEGIS_AIDER_MODEL="${AEGIS_AIDER_MODEL:-}"

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
# Output token budget — default ceiling for unknown modes. Prefer the
# per-mode caps below for the hot readonly path: short JSON artifacts
# must not pay full decode budgets (adversarial was 84s → 12s at 1024).
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS:=4096}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_DISCOVERY:=1024}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_FORENSICS:=1024}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL:=1024}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION:=512}"

export AEGIS_RAW_SUBSTRATE_TEMPERATURE
export AEGIS_RAW_SUBSTRATE_MAX_TOKENS
export AEGIS_RAW_SUBSTRATE_MAX_TOKENS_DISCOVERY
export AEGIS_RAW_SUBSTRATE_MAX_TOKENS_FORENSICS
export AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL
export AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION

# =========================================================
# PROVIDER POLICY
# =========================================================

: "${AEGIS_PROVIDER_MAX_RETRIES:=3}"
: "${AEGIS_PROVIDER_RETRY_DELAY:=2}"
: "${AEGIS_PROVIDER_CONNECT_TIMEOUT:=15}"
: "${AEGIS_PROVIDER_RESPONSE_TIMEOUT:=120}"

# Local repair feedback (no rediscovery): max re-entries into the
# repair→optimize→adversarial→validation stack after a rejected verdict.
: "${AEGIS_MAX_REPAIR_ATTEMPTS:=2}"
: "${AEGIS_REPAIR_FEEDBACK_LOOP:=true}"

# Optimize short-circuit: when the Repair surface diff has at most this
# many lines, skip the second LLM and forward the candidate (set
# AEGIS_OPTIMIZE_LLM=1 to always run a refine pass).
: "${AEGIS_OPTIMIZE_MIN_LINES:=24}"
: "${AEGIS_OPTIMIZE_LLM:=0}"

export AEGIS_PROVIDER_MAX_RETRIES
export AEGIS_PROVIDER_RETRY_DELAY
export AEGIS_PROVIDER_CONNECT_TIMEOUT
export AEGIS_PROVIDER_RESPONSE_TIMEOUT
export AEGIS_MAX_REPAIR_ATTEMPTS
export AEGIS_REPAIR_FEEDBACK_LOOP
export AEGIS_OPTIMIZE_MIN_LINES
export AEGIS_OPTIMIZE_LLM

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
# INTRA-PIPELINE EVIDENCE CACHE
# =========================================================
# Deterministic, mode-stable payloads (list_tree, layer0, attention_seed)
# are reused across modes within one pipeline run. Cache is wiped at
# pipeline start by run_aegis.sh; never treated as cross-run memory.

: "${AEGIS_EVIDENCE_CACHE_DIR:=${AEGIS_ROOT_DIR}/.harness/runtime/evidence_cache}"
: "${AEGIS_EVIDENCE_CACHE_ENABLED:=true}"

export AEGIS_EVIDENCE_CACHE_DIR
export AEGIS_EVIDENCE_CACHE_ENABLED

declare -ar AEGIS_CACHEABLE_CAPABILITIES=(
  "filesystem.list_tree"
  "runtime.layer0_facts"
  "runtime.attention_seed"
)

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
  # Optimize is a real mutation pass: recognize the Repair result on a
  # disposable surface and refine it (or leave it) under the same rails.
  ["optimize"]="aider"
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

# ---------------------------------------------------------
# TOPOLOGY CAPABILITIES (fine core + deep satellite)
# ---------------------------------------------------------
# Product path (AEGIS_DISCOVERY_DEPTH=fine, default):
#   AEGIS_LAYER0_CAPABILITIES only in the evidence profile
#   (see AEGIS_DISCOVERY_EVIDENCE_FINE). No graph extractors run.
#
# Satellite path (AEGIS_DISCOVERY_DEPTH=deep or required_evidence):
#   AEGIS_DEEP_TOPOLOGY_CAPABILITIES (~2k LOC under
#   scripts/capabilities/{filesystem/extract_*,structural/}).
#   Handlers stay registered so deep opt-in and authority audits work
#   without re-wiring; they are NOT the product core and must not grow
#   the fine hot path.
#
# Maintenance rule: prefer Layer 0 / attention_seed fixes over expanding
# builder/extractors unless an investigation explicitly needs composition.
# ---------------------------------------------------------

# Fine-path topology priors (always cheap, always on the product path).
declare -ar AEGIS_LAYER0_CAPABILITIES=(
  "runtime.attention_seed"
  "runtime.layer0_facts"
)

# Deep satellite only — not materialized on fine discovery.
declare -ar AEGIS_DEEP_TOPOLOGY_CAPABILITIES=(
  "filesystem.extract_import_graph"
  "filesystem.extract_reference_graph"
  "filesystem.extract_symbols"
  "filesystem.extract_entrypoints"
  "filesystem.extract_test_relationships"
  "filesystem.extract_configuration_structure"
  "filesystem.extract_responsibilities"
  "structural.builder"
)

# Full topology authority envelope = deep satellite + Layer 0.
# Prefer AEGIS_LAYER0_* / AEGIS_DEEP_* when choosing what to materialize.
declare -ar AEGIS_STRUCTURAL_EXTRACT_CAPABILITIES=(
  "${AEGIS_DEEP_TOPOLOGY_CAPABILITIES[@]}"
  "${AEGIS_LAYER0_CAPABILITIES[@]}"
)

# Discovery envelope = base + structural (authority surface for deep
# opt-in). Evidence profile still decides what is materialized.
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
  ["runtime.layer0_facts"]="scripts/capabilities/runtime/layer0_facts.sh"
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
  ["runtime.layer0_facts"]="readonly"
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
  ["runtime.layer0_facts"]="."
  ["typescript.check"]="."
  ["eslint.check"]="src"
  ["test.run"]="."
)

# =========================================================
# MODE EVIDENCE PROFILES
# =========================================================
#
# Discovery evidence depth (KISS default = fine):
#   fine — Layer 0 baseline only (cheap, no graph extractors)  ← product path
#   deep — full structural composition (builder + extractors) ← satellite
#
# Deep extractors remain in the discovery capability envelope so
# required_evidence augmentation and AEGIS_DISCOVERY_DEPTH=deep can
# still request them without re-registering handlers. Prefer fine
# unless an investigation explicitly needs topology composition.

: "${AEGIS_DISCOVERY_DEPTH:=fine}"
export AEGIS_DISCOVERY_DEPTH

# Fine default: topology census + handover + deterministic Layer 0
# priors + attention seed. structural.builder is NOT required.
declare -ar AEGIS_DISCOVERY_EVIDENCE_FINE=(
  "filesystem.list_tree"
  "filesystem.read:epistemic_handover"
  "runtime.layer0_facts"
  "runtime.attention_seed"
)

# Deep profile: prior fine set plus second-order topology composition.
# structural.builder materializes its extractor dependencies as a side
# effect; extract_responsibilities is listed so it also enters the
# selected evidence set for the model when operators opt into depth.
declare -ar AEGIS_DISCOVERY_EVIDENCE_DEEP=(
  "filesystem.list_tree"
  "filesystem.read:epistemic_handover"
  "runtime.layer0_facts"
  "filesystem.extract_responsibilities"
  "structural.builder"
  "runtime.attention_seed"
)

if [[ "${AEGIS_DISCOVERY_DEPTH}" == "deep" ]]; then
  declare -ar AEGIS_DISCOVERY_EVIDENCE=(
    "${AEGIS_DISCOVERY_EVIDENCE_DEEP[@]}"
  )
else
  declare -ar AEGIS_DISCOVERY_EVIDENCE=(
    "${AEGIS_DISCOVERY_EVIDENCE_FINE[@]}"
  )
fi

declare -ar AEGIS_FORENSICS_EVIDENCE=(
  "filesystem.search_symbol"
  "git.status"
  "filesystem.read:epistemic_handover"  # Forensics must only interpret evidence provided by Discovery
)

# Validation is a deterministic tribunal, free of noise: it judges only
# the typed adversarial findings and the deterministic handover state.
# Build/test/lint evidence belongs to the adversarial falsification stage,
# NOT here — admitting it would make the verdict probabilistic.
declare -ar AEGIS_VALIDATION_EVIDENCE=(
  "filesystem.read:epistemic_handover"
)

declare -ar AEGIS_ADVERSARIAL_EVIDENCE=(
  "filesystem.search_symbol"
  "filesystem.read:epistemic_handover"
  "typescript.check"
  "eslint.check"
  "test.run"
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

# Optimize runs on the disposable surface after the Repair candidate is
# applied. Evidence stays lean: the handover carries the Repair diff and
# files_changed; tools confirm the surface is still sound after refine.
declare -ar AEGIS_OPTIMIZE_EVIDENCE=(
  "filesystem.read:epistemic_handover"
  "git.status"
  "typescript.check"
  "eslint.check"
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

  [[ -n "${OPENAI_API_BASE}" ]] \
    || aegis_config_reject "missing_openai_api_base" \
    || return 1

  # Model presence is only demanded in model-requiring contexts
  # (AEGIS_REQUIRE_MODEL=1). When demanded, assert on AEGIS_OPERATOR_MODEL_RAW
  # — the snapshot captured BEFORE any derivation/defaulting — so this
  # validates genuine operator/injected configuration rather than the
  # post-default tautology of checking a variable the model block just set.
  if [[ "${AEGIS_REQUIRE_MODEL:-}" == "1" ]]; then
    [[ -n "${AEGIS_OPERATOR_MODEL_RAW:-}" ]] \
      || aegis_config_reject "missing_readonly_cognition_model" \
      || return 1
  fi

  [[ -n "${AEGIS_PROVIDER_MAX_RETRIES}" ]] \
    || aegis_config_reject "missing_provider_max_retries" \
    || return 1

  [[ -n "${AEGIS_PROVIDER_RETRY_DELAY}" ]] \
    || aegis_config_reject "missing_provider_retry_delay" \
    || return 1

  [[ -n "${AEGIS_PROVIDER_CONNECT_TIMEOUT}" ]] \
    || aegis_config_reject "missing_provider_connect_timeout" \
    || return 1

  [[ -n "${AEGIS_PROVIDER_RESPONSE_TIMEOUT}" ]] \
    || aegis_config_reject "missing_provider_response_timeout" \
    || return 1
}

validate_evidence_policy() {

  [[ "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" -gt 0 ]] \
    || aegis_config_reject "invalid_evidence_total_budget" \
    || return 1

  [[ "${AEGIS_EVIDENCE_MAX_FILES}" -gt 0 ]] \
    || aegis_config_reject "invalid_evidence_file_budget" \
    || return 1

  [[ "${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES}" -gt 0 ]] \
    || aegis_config_reject "invalid_capability_payload_budget" \
    || return 1
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

    [[ -n "${AEGIS_CAPABILITY_HANDLERS[$capability]:-}" ]] \
      || aegis_config_reject "unregistered_capability_handler: ${capability}" \
      || return 1

    [[ -n "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}" ]] \
      || aegis_config_reject "missing_capability_argument_contract: ${capability}" \
      || return 1

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

    [[ -n "${envelope_name}" ]] \
      || aegis_config_reject "missing_capability_envelope_for_mode: ${mode}" \
      || return 1

    declare -p "${profile_name}" >/dev/null 2>&1 \
      || aegis_config_reject "missing_evidence_profile_array: ${profile_name}" \
      || return 1

    declare -n profile_ref="${profile_name}"
    declare -n envelope_ref="${envelope_name}"

    [[ "${#profile_ref[@]}" -gt 0 ]] \
      || aegis_config_reject "empty_evidence_profile_array: ${profile_name}" \
      || return 1

    for capability in "${profile_ref[@]}"; do

      base_capability="${capability%%:*}"

      capability_is_authorized="false"

      for envelope_capability in "${envelope_ref[@]}"; do
        if [[ "${envelope_capability}" == "${base_capability}" ]]; then
          capability_is_authorized="true"
          break
        fi
      done

      [[ "${capability_is_authorized}" == "true" ]] \
        || aegis_config_reject "evidence_capability_outside_envelope: ${mode}:${capability}" \
        || return 1

    done

  done
}

validate_filesystem_prune_policy() {

  [[ "${#AEGIS_FILESYSTEM_PRUNE_PATHS[@]}" -gt 0 ]] \
    || aegis_config_reject "empty_filesystem_prune_policy" \
    || return 1
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
