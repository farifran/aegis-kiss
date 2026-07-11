#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EXECUTION PROTOCOL VM
# =========================================================
#
# Version: 2.9
# Layer: Protocol VM
# Status: Evidence Transition Hardened
#
# Responsibilities:
#
# - capability envelope resolution
# - capability environment materialization
# - capability payload persistence
# - runtime-owned capability manifest consumption
# - evidence profile resolution
# - selective evidence payload selection
# - selected manifest materialization
# - capability invocation contracts
# - capability evidence generation
# - substrate invocation
# - protocol validation
# - candidate artifact validation
#
# The executor intentionally owns:
#
# - capability routing
# - payload persistence
# - evidence selection
# - runtime-owned capability manifest validation
# - selected manifest generation
# - capability invocation
# - protocol enforcement
# - capability evidence lifecycle
# - candidate artifact validation
#
# The executor intentionally does NOT:
#
# - own orchestration
# - own runtime lifecycle
# - own persistence decisions
# - own capability manifest generation
# - reason semantically
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# ROOT RESOLUTION
# =========================================================

readonly AEGIS_EXECUTOR_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"

cd "${AEGIS_EXECUTOR_ROOT}"

# =========================================================
# CONFIGURATION
# =========================================================

if [[ -f ".harness/local.env" ]] && [[ "${OPENAI_API_KEY:-}" != *test-key* ]]; then
    source ".harness/local.env"
fi

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][EXECUTOR][FATAL] missing_config" >&2
  exit 1
}

source ".harness/config.sh"

extract_agents_constitution() {
  local agents_file="${AEGIS_ROOT_DIR}/AGENTS.md"
  [[ -f "${agents_file}" ]] || return 0

  echo "### AEGIS CONSTITUTIONAL CONSTRAINTS (AGENTS.md) ###"

  # Extrai as seções de Princípios Constitucionais e de Restrições
  # Não-Negociáveis em uma única passada (dois flags independentes;
  # as regiões são disjuntas e ordenadas no documento).
  awk '
    /## Constitutional Principles/{principles=1;next}
    /## Constitutional Model/{principles=0}
    /## Non-Negotiable Constraints/{constraints=1;next}
    /## Summary/{constraints=0}
    principles||constraints' "${agents_file}"
}

export AEGIS_CONSTITUTIONAL_PREAMBLE
AEGIS_CONSTITUTIONAL_PREAMBLE="$(extract_agents_constitution)"


# =========================================================
# INPUTS
# =========================================================

readonly AEGIS_SKILL_FILE="${1:-}"
readonly AEGIS_MODE="${2:-}"
readonly AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${3:-}"

# =========================================================
# LOGGING
# =========================================================

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
AEGIS_LOG_TAG="EXECUTOR"


# =========================================================
# SIGNAL PROPAGATION
# =========================================================
#
# The executor owns no runtime-persistent state (the runtime remains
# sovereign over surfaces, payload retention and handover lifecycle),
# so there is nothing to clean up here: its only signal duty is to
# propagate a deterministic signal-based status code to the runtime.

trap 'aegis_warn "Interrupted by SIGINT"; trap - INT TERM; exit 130' INT
trap 'aegis_warn "Interrupted by SIGTERM"; trap - INT TERM; exit 143' TERM

# =========================================================
# VALIDATION
# =========================================================

validate_executor_inputs() {

  [[ -n "${AEGIS_EXECUTION_SURFACE_PATH:-}" ]] \
    || aegis_fatal "missing_execution_surface_path"

  [[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
    || aegis_fatal "missing_execution_id"

  [[ -n "${AEGIS_EXECUTION_TIMESTAMP:-}" ]] \
    || aegis_fatal "missing_execution_timestamp"

  [[ -f "${AEGIS_SKILL_FILE}" ]] \
    || aegis_fatal "missing_skill_contract"

  [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" ]] \
    || aegis_fatal "missing_epistemic_handover"

  [[ -n "${AEGIS_CAPABILITY_MANIFEST:-}" ]] \
    || aegis_fatal "missing_runtime_owned_capability_manifest"

  declare -p AEGIS_EXECUTION_ENGINES >/dev/null 2>&1 \
    || aegis_fatal "missing_execution_engine_registry"

  declare -p AEGIS_MODE_CAPABILITY_MAP >/dev/null 2>&1 \
    || aegis_fatal "missing_mode_capability_map"

  declare -p AEGIS_CAPABILITY_HANDLERS >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_handler_registry"

  declare -p AEGIS_CAPABILITY_ARGUMENTS >/dev/null 2>&1 \
    || aegis_fatal "missing_capability_argument_registry"

  declare -p AEGIS_MODE_EVIDENCE_PROFILE >/dev/null 2>&1 \
    || aegis_fatal "missing_evidence_profile_registry"

  [[ -n "${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}" ]] \
    || aegis_fatal "unknown_execution_mode"
}

# =========================================================
# EXECUTION ENGINE
# =========================================================

resolve_execution_engine() {

  export AEGIS_EXECUTION_ENGINE="${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]}"

  [[ -n "${AEGIS_EXECUTION_ENGINE}" ]] \
    || aegis_fatal "missing_execution_engine"

  aegis_log "Execution engine: ${AEGIS_EXECUTION_ENGINE}"
}

# =========================================================
# CAPABILITY ENVELOPE
# =========================================================

resolve_capability_envelope() {

  local envelope_name="${AEGIS_MODE_CAPABILITY_MAP[$AEGIS_MODE]:-}"

  [[ -n "${envelope_name}" ]] \
    || aegis_fatal "missing_capability_envelope"

  declare -n envelope_ref="${envelope_name}"

  [[ "${#envelope_ref[@]}" -gt 0 ]] \
    || aegis_fatal "empty_capability_envelope"

  AEGIS_ACTIVE_CAPABILITIES=("${envelope_ref[@]}")
}

# =========================================================
# EVIDENCE PROFILE
# =========================================================

resolve_evidence_profile() {

  local profile_name="${AEGIS_MODE_EVIDENCE_PROFILE[$AEGIS_MODE]:-}"

  [[ -n "${profile_name}" ]] \
    || aegis_fatal "missing_evidence_profile"

  declare -n evidence_ref="${profile_name}"

  [[ "${#evidence_ref[@]}" -gt 0 ]] \
    || aegis_fatal "empty_evidence_profile"

  AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${evidence_ref[@]}")
}

augment_evidence_profile_from_handover() {

  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
    local req_ev
    req_ev="$(
      jq -r '.artifact_snapshot.operational_context.required_evidence[]? // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null || true
    )"
    while IFS= read -r entry; do
      [[ -z "${entry}" ]] && continue
      local dup="false"
      local active
      for active in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
        if [[ "${active}" == "${entry}" ]]; then
          dup="true"
          break
        fi
      done
      if [[ "${dup}" == "false" ]]; then
        AEGIS_ACTIVE_EVIDENCE_ENTRIES+=("${entry}")
      fi
    done <<< "${req_ev}"
  fi
}

resolve_evidence_entry_capability() {

  local evidence_entry="$1"

  printf '%s' "${evidence_entry%%:*}"
}

resolve_evidence_entry_alias() {

  local evidence_entry="$1"

  if [[ "${evidence_entry}" == *:* ]]; then
    printf '%s' "${evidence_entry#*:}"
    return 0
  fi

  printf '%s' ""
}

resolve_evidence_payload_file() {

  local capability="$1"
  local evidence_alias="${2:-}"
  local payload_key="${capability}"

  if [[ -n "${evidence_alias}" ]]; then
    payload_key+="_${evidence_alias}"
  fi

  payload_key="${payload_key//./_}"
  printf '%s.json' "${payload_key//\//_}"
}

# =========================================================
# EXECUTION STATE
# =========================================================

prepare_execution_state() {

  aegis_log "Using runtime-prepared execution state..."

  if [[ ! -d "${AEGIS_CAPABILITY_ENV_DIR}" ]]; then
    mkdir -p "${AEGIS_CAPABILITY_ENV_DIR}" || aegis_fatal "failed_to_create_capability_environment"
  fi
  if [[ ! -d "${AEGIS_CAPABILITY_PAYLOAD_DIR}" ]]; then
    mkdir -p "${AEGIS_CAPABILITY_PAYLOAD_DIR}" || aegis_fatal "failed_to_create_capability_payload_dir"
  fi
}

# =========================================================
# PAYLOAD VALIDATION
# =========================================================

validate_materialized_payload() {

  local capability="$1"
  local payload_path="$2"
  local expected_classification

  expected_classification="${AEGIS_CAPABILITY_CLASSIFICATION[$capability]:-}"

  [[ -n "${expected_classification}" ]] \
    || aegis_fatal "missing_capability_classification"

  jq -e \
    --arg capability "${capability}" \
    --arg classification "${expected_classification}" \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
    '
      .success == true
      and .error == null
      and .payload != null
      and .capability == $capability
      and .classification == $classification
      and .execution_id == $execution_id
      and (.generated_at | type == "string" and length > 0)
    ' "${payload_path}" >/dev/null 2>&1 \
    || aegis_fatal "invalid_capability_payload_contract: ${capability}"
}

# =========================================================
# ARGUMENT CONTRACTS
# =========================================================

resolve_capability_argument() {

  local capability="$1"
  local evidence_alias="${2:-}"

  case "${capability}" in
    filesystem.read)
      if [[ -n "${evidence_alias}" ]]; then
        declare -p AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS >/dev/null 2>&1 \
          || aegis_fatal "missing_runtime_filesystem_read_target_registry"

        # Case A: Runtime-owned internal target
        if [[ -n "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[$evidence_alias]:-}" ]]; then
          printf '%s' "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[$evidence_alias]}"
          return 0
        fi

        # Case B: Workspace target file - return directly
        printf '%s' "${evidence_alias}"
        return 0
      fi

      printf '%s' "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"
      ;;
    filesystem.list_tree|filesystem.extract_import_graph|filesystem.extract_reference_graph|filesystem.extract_symbols|filesystem.extract_entrypoints|filesystem.extract_test_relationships|filesystem.extract_configuration_structure|filesystem.extract_responsibilities|structural.builder)
      printf '%s' "${AEGIS_EVIDENCE_TARGET_PATH:-.}"
      ;;
    *)
      printf '%s' "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"
      ;;
  esac
}

invoke_capability_handler() {

  local handler="$1"
  local capability_argument="$2"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_PATH}" \
    AEGIS_EPISTEMIC_HANDOVER_FILE="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_CAPABILITY_PAYLOAD_DIR="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
    AEGIS_POCKET_MAP_FILE="${AEGIS_POCKET_MAP_FILE:-}" \
    AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES="${AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES:-}" \
    AEGIS_FILE_CONTENT_MAX_BYTES="${AEGIS_FILE_CONTENT_MAX_BYTES:-}" \
    AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES="${AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES:-}" \
    AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-}" \
    AEGIS_SEARCH_SYMBOL_CONTEXT_LINES="${AEGIS_SEARCH_SYMBOL_CONTEXT_LINES:-}" \
    bash "${handler}" "${capability_argument}"
}

invoke_raw_substrate() {

  local model="$1"
  local skill_file="$2"
  local selected_manifest="$3"
  local capability_payload_dir="$4"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    AEGIS_MODE="${AEGIS_MODE}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_SELECTED_CAPABILITY_PAYLOADS="${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
    AEGIS_POCKET_MAP_FILE="${AEGIS_POCKET_MAP_FILE:-}" \
    AEGIS_CONSTITUTIONAL_PREAMBLE="${AEGIS_CONSTITUTIONAL_PREAMBLE:-}" \
    AEGIS_EVIDENCE_MAX_TOTAL_BYTES="${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" \
    AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES}" \
    AEGIS_PROVIDER_RESPONSE_TIMEOUT="${AEGIS_PROVIDER_RESPONSE_TIMEOUT}" \
    AEGIS_PROVIDER_CONNECT_TIMEOUT="${AEGIS_PROVIDER_CONNECT_TIMEOUT}" \
    AEGIS_PROVIDER_MAX_RETRIES="${AEGIS_PROVIDER_MAX_RETRIES}" \
    AEGIS_PROVIDER_RETRY_DELAY="${AEGIS_PROVIDER_RETRY_DELAY}" \
    AEGIS_EVIDENCE_MAX_FILES="${AEGIS_EVIDENCE_MAX_FILES}" \
    AEGIS_RAW_SUBSTRATE_TEMPERATURE="${AEGIS_RAW_SUBSTRATE_TEMPERATURE}" \
    AEGIS_CAPABILITY_MANIFEST_MAX_BYTES="${AEGIS_CAPABILITY_MANIFEST_MAX_BYTES}" \
    AEGIS_ARTIFACT_BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
    AEGIS_ARTIFACT_END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
    bash scripts/substrates/raw_llm.sh \
      "${model}" \
      "${skill_file}" \
      "${selected_manifest}" \
      "${capability_payload_dir}"
}

invoke_aider_substrate() {

  local skill_file="$1"
  local capability_payload_dir="$2"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    AEGIS_MODE="${AEGIS_MODE}" \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_PATH}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_SELECTED_CAPABILITY_PAYLOADS="${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" \
    AEGIS_POCKET_MAP_FILE="${AEGIS_POCKET_MAP_FILE:-}" \
    AEGIS_CONSTITUTIONAL_PREAMBLE="${AEGIS_CONSTITUTIONAL_PREAMBLE:-}" \
    AEGIS_AIDER_MODEL="${AEGIS_AIDER_MODEL:-}" \
    AEGIS_AIDER_BIN="${AEGIS_AIDER_BIN:-}" \
    AEGIS_MUTATION_GIT_DIR="${AEGIS_MUTATION_GIT_DIR:-}" \
    AEGIS_EPISTEMIC_HANDOVER_FILE="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" \
    AEGIS_ARTIFACT_BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
    AEGIS_ARTIFACT_END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
    AEGIS_PROVIDER_RESPONSE_TIMEOUT="${AEGIS_PROVIDER_RESPONSE_TIMEOUT:-}" \
    AEGIS_AIDER_TIMEOUT="${AEGIS_AIDER_TIMEOUT:-}" \
    AEGIS_AIDER_MAX_SECONDS="${AEGIS_AIDER_MAX_SECONDS:-}" \
    AEGIS_AIDER_EDIT_FORMAT="${AEGIS_AIDER_EDIT_FORMAT:-}" \
    bash scripts/substrates/aider_substrate.sh \
      "${skill_file}" \
      "${capability_payload_dir}"
}


# =========================================================
# CAPABILITY ENVIRONMENT
# =========================================================

materialize_capability_environment() {

  aegis_log "Materializing capability environment..."

  local capability
  local handler
  local capability_path

  for capability in "${AEGIS_ACTIVE_CAPABILITIES[@]}"; do

    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]:-}"

    [[ -n "${handler}" ]] \
      || aegis_fatal "missing_handler_for_capability"

    [[ -f "${handler}" ]] \
      || aegis_fatal "missing_capability_handler_file"

    capability_path="${AEGIS_CAPABILITY_ENV_DIR}/${capability}"

    cat > "${capability_path}" <<EOF
#!/usr/bin/env bash
exec bash "${AEGIS_EXECUTOR_ROOT}/${handler}" "\$@"
EOF

    chmod +x "${capability_path}"

  done
}

# =========================================================
# CAPABILITY PAYLOADS
# =========================================================

materialize_capability_payloads() {

  aegis_log "Materializing capability payloads..."

  local evidence_entry
  local capability
  local evidence_alias
  local handler
  local capability_argument
  local payload_output
  local payload_file
  local payload_path

  # Dynamic Attention Zoom scope for this execution (advanced modes).
  local attention_targets_json="[]"
  if mode_uses_attention_zoom; then
    attention_targets_json="$(resolve_attention_targets_json)"
  fi

  for evidence_entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do

    capability="$(
      resolve_evidence_entry_capability "${evidence_entry}"
    )"

    evidence_alias="$(
      resolve_evidence_entry_alias "${evidence_entry}"
    )"

    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]:-}"

    [[ -f "${handler}" ]] \
      || aegis_fatal "missing_capability_handler"

    capability_argument="$(
      resolve_capability_argument "${capability}" "${evidence_alias}"
    )"

    payload_file="$(
      resolve_evidence_payload_file "${capability}" "${evidence_alias}"
    )"

    payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${payload_file}"

    # Net-new evidence guard: Discovery may legitimately request a path
    # that does not exist yet (net-new file creation intents). The
    # filesystem.read capability correctly hard-fails on missing files,
    # which under set -e would abort the whole pipeline here. Intercept
    # ONLY in this aggregation loop: bypass the physical read and emit a
    # contract-shaped placeholder payload so context gathering completes
    # and downstream modes see the absence as evidence, not a crash.
    if [[ "${capability}" == "filesystem.read" ]] \
      && [[ -n "${capability_argument}" ]] \
      && [[ ! -f "${capability_argument}" ]]; then
      aegis_warn "evidence_target_missing_on_disk — emitting placeholder payload: ${capability_argument}"
      payload_output="$(
        jq -n \
          --arg capability "${capability}" \
          --arg classification "${AEGIS_CAPABILITY_CLASSIFICATION[$capability]:-readonly}" \
          --arg execution_id "${AEGIS_EXECUTION_ID}" \
          --arg generated_at "${AEGIS_EXECUTION_TIMESTAMP}" \
          --arg target "${capability_argument}" \
          '{
            success: true,
            capability: $capability,
            classification: $classification,
            execution_id: $execution_id,
            generated_at: $generated_at,
            error: null,
            payload: {
              target: $target,
              file_exists: false,
              net_new_target: true,
              content: "FILE_NOT_FOUND_IN_TOPOLOGY"
            }
          }'
      )"
    else
      payload_output="$(
        invoke_capability_handler \
          "${handler}" \
          "${capability_argument}"
      )"
    fi

    printf '%s\n' "${payload_output}" > "${payload_path}"

    jq empty "${payload_path}" \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_capability_payload_json"

    validate_materialized_payload \
      "${capability}" \
      "${payload_path}"

    # Layer 2: advanced modes never carry unpruned deep payloads —
    # deep metadata survives only for registered attention targets.
    if mode_uses_attention_zoom && capability_is_deep_payload "${capability}"; then
      apply_attention_zoom "${payload_path}" "${attention_targets_json}"
    fi

  done
}

# =========================================================
# TWO-LAYER CONTEXT FUSION
# =========================================================
#
# Layer 1 — Global Path Census ("Pocket Map"): a lightweight flat list
# of plain repository paths, globally available to every mode as
# permanent baseline context, replacing heavy nested topology JSON as
# the default global view.
#
# Layer 2 — Dynamic Attention Zoom: advanced downstream modes bypass
# unpruned deep capability payloads (graphs, multi-file maps, trees);
# deep entries survive only for files registered in the active
# handover's epistemic_state.next_attention_targets.

: "${AEGIS_POCKET_MAP_MAX_LINES:=400}"

generate_pocket_map() {

  local map_file="${AEGIS_CAPABILITY_ENV_DIR}/pocket_map.txt"

  local prune_expr=""
  local prune_path
  for prune_path in "${AEGIS_FILESYSTEM_PRUNE_PATHS[@]:-}"; do
    [[ -n "${prune_path}" ]] || continue
    prune_expr+="^${prune_path}/|"
  done
  prune_expr="${prune_expr%|}"

  git ls-files 2>/dev/null \
    | { if [[ -n "${prune_expr}" ]]; then grep -Ev "${prune_expr}"; else cat; fi } \
    | head -n "${AEGIS_POCKET_MAP_MAX_LINES}" \
    > "${map_file}" || true

  export AEGIS_POCKET_MAP_FILE="${map_file}"

  aegis_log "Pocket map: $(wc -l < "${map_file}" | tr -d ' ') paths"
}

mode_uses_attention_zoom() {
  case "${AEGIS_MODE}" in
    forensics|repair|optimize|adversarial|validation) return 0 ;;
    *) return 1 ;;
  esac
}

capability_is_deep_payload() {
  case "$1" in
    structural.builder|filesystem.list_tree|filesystem.extract_*) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_attention_targets_json() {

  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
    jq -c '
      [.epistemic_state.next_attention_targets[]?
        | select(type == "string" and length > 0)]
    ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null || printf '[]'
    return 0
  fi

  printf '[]'
}

# Prune a deep payload in place: object arrays keep only entries that
# reference an attention target; with no registered targets the deep
# structure is bypassed entirely (emptied). The capability envelope
# fields stay untouched.
apply_attention_zoom() {

  local payload_path="$1"
  local targets_json="$2"

  local zoomed_tmp
  zoomed_tmp="$(mktemp)"

  if jq \
    --argjson targets "${targets_json}" \
    '
      def mentions_target:
        tojson as $j
        | any($targets[]; . as $t | $j | contains($t));

      def zoom:
        walk(
          if type == "array"
             and length > 0
             and all(.[]?; type == "object")
          then
            if ($targets | length) == 0
            then []
            else [ .[] | select(mentions_target) ]
            end
          else .
          end
        );

      .payload = ((.payload // {}) | zoom)
      | .payload.attention_zoom_applied = true
      | .payload.attention_zoom_targets = $targets
    ' "${payload_path}" > "${zoomed_tmp}" 2>/dev/null; then
    mv "${zoomed_tmp}" "${payload_path}"
  else
    rm -f "${zoomed_tmp}"
    aegis_warn "attention_zoom_skipped_unparseable_payload: ${payload_path}"
  fi
}

# =========================================================
# RUNTIME-OWNED MANIFEST
# =========================================================

consume_runtime_owned_capability_manifest() {

  aegis_log "Consuming runtime-owned capability manifest..."

  [[ -n "${AEGIS_CAPABILITY_MANIFEST}" ]] \
    || aegis_fatal "missing_capability_manifest"

  printf '%s\n' "${AEGIS_CAPABILITY_MANIFEST}" \
    | jq empty \
      >/dev/null 2>&1 \
    || aegis_fatal "invalid_runtime_owned_capability_manifest"
}

# =========================================================
# EVIDENCE PAYLOAD SELECTION
# =========================================================

select_evidence_payloads() {

  local evidence_entry
  local capability
  local evidence_alias
  local payload_file
  local payload_path
  local payload_paths=()

  for evidence_entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do

    capability="$(
      resolve_evidence_entry_capability "${evidence_entry}"
    )"

    evidence_alias="$(
      resolve_evidence_entry_alias "${evidence_entry}"
    )"

    payload_file="$(
      resolve_evidence_payload_file "${capability}" "${evidence_alias}"
    )"

    payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${payload_file}"

    [[ -f "${payload_path}" ]] \
      || aegis_fatal "missing_evidence_payload: ${payload_path}"

    payload_paths+=("${payload_path}")
  done

  export AEGIS_SELECTED_CAPABILITY_PAYLOADS="$(
    jq -cn '$ARGS.positional' --args "${payload_paths[@]}"
  )"
}

# =========================================================
# TOKEN BUDGETER
# =========================================================
#
# Native size guard over the assembled prompt payload buffer: when the
# selected evidence payloads exceed AEGIS_MAX_CONTEXT_BYTES, lower-
# priority payloads are truncated (largest first; the epistemic
# handover read — the failure/candidate context — is never pruned)
# until the buffer fits. Pruned payloads and the selected manifest are
# flagged with context_budget_pruned: true.

: "${AEGIS_MAX_CONTEXT_BYTES:=32768}"

AEGIS_CONTEXT_BUDGET_PRUNED="false"

measure_selected_payload_bytes() {

  local total=0
  local payload_path

  while IFS= read -r payload_path; do
    [[ -f "${payload_path}" ]] || continue
    total=$((total + $(wc -c < "${payload_path}")))
  done < <(
    printf '%s' "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-[]}" | jq -r '.[]?'
  )

  printf '%s' "${total}"
}

truncate_payload_for_budget() {

  local payload_path="$1"

  local pruned_tmp
  pruned_tmp="$(mktemp)"

  # Envelope fields survive; the payload body collapses to a bounded
  # preview so verbose evidence blocks stop dominating the buffer.
  if jq -c '
      {
        success,
        capability,
        classification,
        execution_id,
        generated_at,
        error
      }
      + {
        payload: {
          context_budget_pruned: true,
          truncated_preview: ((.payload | tojson)[0:1024])
        }
      }
    ' "${payload_path}" > "${pruned_tmp}" 2>/dev/null; then
    mv "${pruned_tmp}" "${payload_path}"
  else
    rm -f "${pruned_tmp}"
    aegis_warn "context_budget_truncation_skipped: ${payload_path}"
  fi
}

enforce_context_token_budget() {

  local total_bytes
  total_bytes="$(measure_selected_payload_bytes)"

  if [[ "${total_bytes}" -le "${AEGIS_MAX_CONTEXT_BYTES}" ]]; then
    aegis_log "Context budget: ${total_bytes}/${AEGIS_MAX_CONTEXT_BYTES} bytes — within ceiling"
    return 0
  fi

  aegis_warn "Context budget exceeded: ${total_bytes}/${AEGIS_MAX_CONTEXT_BYTES} bytes — pruning lower-priority evidence"

  # Prunable payloads, largest first. The epistemic handover read is
  # priority context and exempt.
  local payload_path
  while IFS= read -r payload_path; do
    [[ -f "${payload_path}" ]] || continue

    truncate_payload_for_budget "${payload_path}"
    AEGIS_CONTEXT_BUDGET_PRUNED="true"

    total_bytes="$(measure_selected_payload_bytes)"
    if [[ "${total_bytes}" -le "${AEGIS_MAX_CONTEXT_BYTES}" ]]; then
      break
    fi
  done < <(
    printf '%s' "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-[]}" \
      | jq -r '.[]?' \
      | grep -v 'epistemic_handover' \
      | while IFS= read -r p; do
          [[ -f "${p}" ]] && printf '%s %s\n' "$(wc -c < "${p}" | tr -d ' ')" "${p}"
        done \
      | sort -rn \
      | cut -d' ' -f2-
  )

  if [[ "${total_bytes}" -gt "${AEGIS_MAX_CONTEXT_BYTES}" ]]; then
    aegis_warn "Context budget still above ceiling after pruning: ${total_bytes} bytes (handover context preserved)"
  else
    aegis_log "Context budget: ${total_bytes}/${AEGIS_MAX_CONTEXT_BYTES} bytes after pruning"
  fi
}

# =========================================================
# SELECTED MANIFEST
# =========================================================

materialize_selected_manifest() {

  [[ -n "${AEGIS_CAPABILITY_MANIFEST:-}" ]] \
    || aegis_fatal "missing_capability_manifest"

  # Shell variable only — consumed in-process and passed to substrates
  # as an explicit argument, never via the environment.
  AEGIS_SELECTED_MANIFEST="$(
    echo "${AEGIS_CAPABILITY_MANIFEST}" \
      | jq -c \
          --arg mode "${AEGIS_MODE}" \
          --argjson context_budget_pruned "${AEGIS_CONTEXT_BUDGET_PRUNED:-false}" \
          '{
            schema_version: .schema_version,
            runtime_model: .runtime_model,
            generated_at: .generated_at,
            execution_id: .execution_id,
            manifest_hash: .manifest_hash,
            mode: $mode,
            execution_engine: .modes[$mode].execution_engine,
            capability_envelope: .modes[$mode].capability_envelope,
            evidence_profile: .modes[$mode].evidence_profile,
            evidence_capabilities: .modes[$mode].evidence_capabilities,
            capabilities: .modes[$mode].capabilities,
            context_budget_pruned: $context_budget_pruned
          }'
  )"

  [[ -n "${AEGIS_SELECTED_MANIFEST}" ]] \
    || aegis_fatal "missing_selected_manifest"
}

# =========================================================
# SUBSTRATE
# =========================================================

execute_substrate() {

  local substrate_output

  case "${AEGIS_EXECUTION_ENGINE}" in

    raw)
      substrate_output="$(
        invoke_raw_substrate \
          "${OPENAI_MODEL_READONLY_COGNITION}" \
          "${AEGIS_SKILL_FILE}" \
          "${AEGIS_SELECTED_MANIFEST}" \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
      )"
      ;;

    aider)
      substrate_output="$(
        invoke_aider_substrate \
          "${AEGIS_SKILL_FILE}" \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
      )"
      ;;

    *)
      aegis_fatal "unknown_execution_engine"
      ;;

  esac

  # Shell variable only — exporting this multi-hundred-KB blob into the
  # environment makes every subsequent fork/exec fail with E2BIG.
  AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
}

# =========================================================
# ARTIFACT VALIDATION
# =========================================================

# Shared jq diff normalizer — tolerates escaping/whitespace/hunk-header
# drift when comparing candidate diffs across mode boundaries.
readonly AEGIS_JQ_DIFF_NORM='def norm(s): s | gsub("\\\\r"; "") | gsub("\\r"; "") | gsub("\\\\n"; "") | gsub("\\n"; "") | gsub("\\\\\\\\"; "") | gsub("\\\\"; "") | gsub("[[:space:]]+"; "") | gsub("Nonewlineatendoffile"; "") | gsub("@@[^@]+@@[^\n]*"; "@@");'

# Shared jq projection of the topology targets a Discovery handover
# authorizes for Forensics repair candidates.
readonly AEGIS_JQ_AUTHORIZED_TARGETS='def authorized_targets:
  [
    .artifact_snapshot.structural_context.observed_request_alignment.resolved_paths[]?,
    (.artifact_snapshot.operational_context.required_evidence[]?
      | select(type == "string" and startswith("filesystem.read:"))
      | ltrimstr("filesystem.read:")),
    (.artifact_snapshot.structural_context.ranked_targets[]?
      | select(.type == "explicit_request")
      | .file),
    .epistemic_state.next_attention_targets[]?,
    (.artifact_snapshot.structural_context.topology_index.boundaries[]?.file),
    (.artifact_snapshot.structural_context.topology_index.hotspots[]?.file),
    (.artifact_snapshot.structural_context.topology_index.entrypoints[]?.file),
    (.artifact_snapshot.structural_context.topology_index.bridges[]?.from),
    (.artifact_snapshot.structural_context.topology_index.bridges[]?.to),
    (.artifact_snapshot.structural_context.topology_index.surfaces[]?.members[]?)
  ]
  | unique;'

extract_substrate_artifact() {

  local output="${AEGIS_SUBSTRATE_OUTPUT}"

  [[ "${output}" == *"${AEGIS_ARTIFACT_BEGIN_MARKER}"* ]] || return 0
  [[ "${output}" == *"${AEGIS_ARTIFACT_END_MARKER}"* ]] || return 0

  output="${output#*"${AEGIS_ARTIFACT_BEGIN_MARKER}"}"
  printf '%s' "${output%%"${AEGIS_ARTIFACT_END_MARKER}"*}"
}

# Print a labelled mismatch dump: alternating description/JSON pairs.
dump_mismatch() {
  local label="$1"
  shift

  echo "[DEBUG] ${label} details:" >&2
  while [[ "$#" -gt 1 ]]; do
    echo "[DEBUG] $1:" >&2
    printf '%s\n' "$2" | jq -c '.' >&2 || printf '%s\n' "$2" >&2
    shift 2
  done
}

validate_artifact() {

  local artifact

  artifact="$(extract_substrate_artifact)"

  [[ -n "${artifact}" ]] \
    || aegis_fatal "missing_artifact_payload"

  echo "${artifact}" \
    | jq empty \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_artifact_json"

  local artifact_mode

  artifact_mode="$(
    echo "${artifact}" \
      | jq -r '.mode // empty'
  )"

  [[ "${artifact_mode}" == "${AEGIS_MODE}" ]] \
    || aegis_fatal "artifact_mode_mismatch"

  if [[ "${AEGIS_MODE}" == "forensics" ]]; then
    if ! echo "${artifact}" \
      | jq -e '
          (.status == "interpreted" or .status == "inconclusive")
          and (
            .repair_candidates
            | type == "array"
            and all(
              type == "object"
              and ((keys | sort) == ["evidence_refs", "id", "reason"])
              and (.id | type == "string" and length > 0)
              and (.reason | type == "string" and length > 0)
              and (.evidence_refs | type == "array" and length > 0)
              and all(.evidence_refs[]; type == "string" and length > 0)
            )
          )
          and (
            .handover_attention
            | type == "object"
            and (.next_attention_targets | type == "array")
            and (.attention_scope | type == "string" and length > 0)
            and (.attention_reason | type == "string" and length > 0)
          )
          and (
            .status == "inconclusive"
            or (
              [.repair_candidates[].id]
              == .handover_attention.next_attention_targets
            )
          )
        ' >/dev/null 2>&1; then
      dump_mismatch "invalid_forensics_artifact_contract" "Artifact" "${artifact}"
      aegis_fatal "invalid_forensics_artifact_contract"
    fi

    previous_discovery="$(
      jq -c '.' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_discovery "${previous_discovery}" \
        "${AEGIS_JQ_AUTHORIZED_TARGETS}"'
        ($previous_discovery.artifact_snapshot.mode == "discovery")
        and (
          $previous_discovery | authorized_targets
        ) as $authorized_targets
        | all(
            .repair_candidates[];
            . as $candidate
            | $authorized_targets
            | index($candidate.id) != null
          )
      ' >/dev/null 2>&1; then
      dump_mismatch "forensics_repair_candidate_outside_discovery_scope" \
        "Authorized targets" \
        "$(echo "${previous_discovery}" | jq -c "${AEGIS_JQ_AUTHORIZED_TARGETS} authorized_targets")" \
        "Forensics repair candidates" \
        "$(echo "${artifact}" | jq -c '.repair_candidates')"
      aegis_fatal "forensics_repair_candidate_outside_discovery_scope"
    fi
  fi

  if [[ "${AEGIS_MODE}" == "adversarial" ]]; then
    if ! echo "${artifact}" \
      | jq -e '
          (.status == "challenged" or .status == "verified" or .status == "inconclusive")
          and (
            .candidate_result
            | type == "object"
            and .source_mode == "optimize"
            and (.diff | type == "string" and length > 0)
            and (.files_changed | type == "array" and length > 0)
            and all(.files_changed[]; type == "string" and length > 0)
          )
          and (.findings | type == "array")
          and (.evidence_refs | type == "array")
          and (
            .handover_attention
            | type == "object"
            and (.next_attention_targets | type == "array")
            and (.attention_scope | type == "string" and length > 0)
            and (.attention_reason | type == "string" and length > 0)
          )
        ' >/dev/null 2>&1; then
      dump_mismatch "invalid_adversarial_artifact_contract" "Artifact" "${artifact}"
      aegis_fatal "invalid_adversarial_artifact_contract"
    fi

    previous_optimized_candidate="$(
      jq -c '
        .artifact_snapshot
        | {
            source_mode: .mode,
            diff: .operational_context.candidate_result.diff,
            files_changed: .operational_context.candidate_result.files_changed
          }
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_candidate "${previous_optimized_candidate}" \
        "${AEGIS_JQ_DIFF_NORM}"'
          (.candidate_result.source_mode == $previous_candidate.source_mode)
          and (.candidate_result.files_changed == $previous_candidate.files_changed)
          and (norm(.candidate_result.diff) == norm($previous_candidate.diff))
        ' >/dev/null 2>&1; then
      echo "[DEBUG] adversarial_candidate_mismatch details:" >&2
      echo "[DEBUG] Expected candidate:" >&2
      echo "${previous_optimized_candidate}" | jq -c '.' >&2
      echo "[DEBUG] Actual candidate received:" >&2
      echo "${artifact}" | jq -c '.candidate_result' >&2
      aegis_fatal "adversarial_candidate_mismatch"
    fi
  fi

  if [[ "${AEGIS_MODE}" == "validation" ]]; then
    if ! echo "${artifact}" \
      | jq -e '
          (.verdict == "accepted"
            or .verdict == "rejected"
            or .verdict == "insufficient")
          and (.findings | type == "array")
          and (.basis | type == "array")
          and (
            .validated_candidate
            | type == "object"
            and .source_mode == "optimize"
            and (.diff | type == "string" and length > 0)
            and (.files_changed | type == "array" and length > 0)
            and all(.files_changed[]; type == "string" and length > 0)
          )
          and (
            .handover_attention
            | type == "object"
            and (.next_attention_targets | type == "array")
            and (.attention_scope | type == "string" and length > 0)
            and (.attention_reason | type == "string" and length > 0)
          )
        ' >/dev/null 2>&1; then
      dump_mismatch "invalid_validation_artifact_contract" "Artifact" "${artifact}"
      aegis_fatal "invalid_validation_artifact_contract"
    fi

    previous_candidate="$(
      jq -c '.artifact_snapshot.operational_context.candidate_result // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    [[ -n "${previous_candidate}" ]] \
      || aegis_fatal "missing_adversarial_candidate_result"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_candidate "${previous_candidate}" \
        "${AEGIS_JQ_DIFF_NORM}"'
          (.validated_candidate.source_mode == $previous_candidate.source_mode)
          and (.validated_candidate.files_changed == $previous_candidate.files_changed)
          and (norm(.validated_candidate.diff) == norm($previous_candidate.diff))
        ' >/dev/null 2>&1; then
      aegis_fatal "validation_candidate_mismatch"
    fi

    previous_findings="$(
      jq -c '.artifact_snapshot.operational_context.findings // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
    )"

    [[ -n "${previous_findings}" ]] \
      || aegis_fatal "missing_findings"

    if ! echo "${artifact}" \
      | jq -e \
        --argjson previous_findings "${previous_findings}" \
        '.findings == $previous_findings' \
        >/dev/null 2>&1; then
      echo "[DEBUG] validation_findings_mismatch details:" >&2
      echo "[DEBUG] Expected findings:" >&2
      echo "${previous_findings}" | jq -c '.' >&2
      echo "[DEBUG] Actual findings received:" >&2
      echo "${artifact}" | jq -c '.findings' >&2
      aegis_fatal "validation_findings_mismatch"
    fi
  fi

  aegis_log "Payload validated successfully"
}

validate_mutation_artifact() {

  local artifact

  artifact="$(extract_substrate_artifact)"

  [[ -n "${artifact}" ]] \
    || aegis_fatal "missing_mutation_artifact_payload"

  echo "${artifact}" \
    | jq empty \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_mutation_artifact_json"

  local artifact_mode
  artifact_mode="$(
    echo "${artifact}" | jq -r '.mode // empty'
  )"

  [[ "${artifact_mode}" == "${AEGIS_MODE}" ]] \
    || aegis_fatal "mutation_artifact_mode_mismatch"

  echo "${artifact}" \
    | jq -e '
        (.diff | type == "string" and length > 0)
        and (.diff != "(no changes)")
      ' >/dev/null 2>&1 \
    || aegis_fatal "mutation_artifact_missing_diff"

  echo "${artifact}" \
    | jq -e '
        (.files_changed | type == "array" and length > 0)
      ' >/dev/null 2>&1 \
    || aegis_fatal "mutation_artifact_missing_files_changed"

  aegis_log "Mutation artifact validated successfully"
}

# =========================================================
# OUTPUT
# =========================================================

# =========================================================
# MINIMAL COGNITIVE ARTIFACT ENRICHMENT
#
# Models emit only their minimal cognitive payload; the runtime is the
# sole constructor of state: mode, evidence_refs, observed_payloads,
# candidates carried from the handover, attention routing and the
# ATTENTION_REASON_* enum are all injected deterministically here.
# =========================================================

normalize_substrate_output() {
  local raw_artifact
  raw_artifact="$(extract_substrate_artifact)"
  # If it is valid JSON, normalize/ensure the structural fields exist
  if printf '%s\n' "${raw_artifact}" | jq empty >/dev/null 2>&1; then
    # Runtime-owned evidence identity: refs from the active envelope,
    # observed payload filenames derived from the evidence entries.
    local evidence_refs_json
    evidence_refs_json="$(
      jq -cn '$ARGS.positional' --args "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"
    )"

    local -a observed_payloads_arr=()
    local entry
    for entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
      [[ -n "${entry}" ]] || continue
      observed_payloads_arr+=("$(
        resolve_evidence_payload_file \
          "$(resolve_evidence_entry_capability "${entry}")" \
          "$(resolve_evidence_entry_alias "${entry}")"
      )")
    done
    local observed_payloads_json
    observed_payloads_json="$(jq -cn '$ARGS.positional' --args "${observed_payloads_arr[@]}")"

    # One pass over the handover: previous candidate (source_mode coerced)
    # and previous findings — the runtime, not the model, carries them.
    local prev_candidate_json="null"
    local prev_findings_json="null"
    if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
      local handover_ctx=()
      mapfile -t handover_ctx < <(
        jq -c '
          .artifact_snapshot as $snap
          | ((
              $snap.operational_context.candidate_result
              // $snap.candidate_result
              // (if ($snap.operational_context.diff | type == "string") then
                   {
                     diff: $snap.operational_context.diff,
                     files_changed: ($snap.operational_context.files_changed // [])
                   }
                 else null end)
             )
             | if . != null then .source_mode = "optimize" else . end),
            ($snap.operational_context.findings // $snap.findings // null)
        ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null
      )
      prev_candidate_json="${handover_ctx[0]:-null}"
      prev_findings_json="${handover_ctx[1]:-null}"
    fi

    # Attention-seed scope/targets/conditions and builder priorities for
    # discovery enrichment.
    local seed_scope_json='{"scope_type":"none","scope_targets":[],"scope_confidence":"none"}'
    local seed_targets_json="[]"
    local seed_conditions_json="[]"
    local seed_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/runtime_attention_seed.json"
    if [[ -f "${seed_path}" ]]; then
      local seed_ctx=()
      mapfile -t seed_ctx < <(
        jq -c '
          (.payload.investigation_scope
            // {"scope_type":"none","scope_targets":[],"scope_confidence":"none"}),
          (.payload.attention_targets // []),
          (.payload.blocking_conditions // [])
        ' "${seed_path}" 2>/dev/null
      )
      seed_scope_json="${seed_ctx[0]:-${seed_scope_json}}"
      seed_targets_json="${seed_ctx[1]:-[]}"
      seed_conditions_json="${seed_ctx[2]:-[]}"
    fi

    local builder_priorities_json="[]"
    local builder_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/structural_builder.json"
    if [[ -f "${builder_path}" ]]; then
      builder_priorities_json="$(jq -c '.payload.suggested_evidence_priorities // []' "${builder_path}" 2>/dev/null || echo '[]')"
    fi

    local updated_artifact
    updated_artifact="$(
      printf '%s\n' "${raw_artifact}" | jq \
        --arg mode "${AEGIS_MODE}" \
        --arg attention_reason "ATTENTION_REASON_$(printf '%s' "${AEGIS_MODE}" | tr '[:lower:]' '[:upper:]')" \
        --argjson evidence_refs "${evidence_refs_json}" \
        --argjson observed_payloads "${observed_payloads_json}" \
        --argjson prev_candidate "${prev_candidate_json}" \
        --argjson prev_findings "${prev_findings_json}" \
        --argjson seed_scope "${seed_scope_json}" \
        --argjson seed_targets "${seed_targets_json}" \
        --argjson seed_conditions "${seed_conditions_json}" \
        --argjson builder_priorities "${builder_priorities_json}" \
        '
        def drop_empty:
          with_entries(select(
            (.value != null)
            and ((.value | type) != "array" or (.value | length) > 0)
          ));

        .mode = $mode
        | .evidence_refs = $evidence_refs
        | .observed_payloads = (.observed_payloads // $observed_payloads)
        | if .status? == null then
            if .verdict? then . else .status = "interpreted" end
          else . end
        | if $mode == "discovery" then
            (.operational_context // {}) as $oc
            | .operational_context = ({
                status: ($oc.status // "interpreted"),
                summary: ($oc.summary // "discovery operational context"),
                observed_payloads: ($oc.observed_payloads // $observed_payloads),
                investigation_scope: $seed_scope,
                attention_targets: $seed_targets,
                blocking_conditions: $seed_conditions,
                required_evidence: (.required_evidence // $oc.required_evidence // []),
                operational_observations: (.observations // $oc.operational_observations // []),
                rationale: ((.rationale // $oc.rationale // []) | if type == "string" then [.] else . end),
                evidence_priorities: (
                  if ($builder_priorities | length) > 0 then $builder_priorities
                  else ($oc.evidence_priorities // []) end
                )
              } | drop_empty)
            | del(.observations, .rationale, .required_evidence)
            | .handover_attention = {
                next_attention_targets: $seed_targets,
                attention_scope: ($seed_scope.scope_type // "exploratory"),
                attention_reason: $attention_reason
              }
          elif $mode == "forensics" then
            # Project candidates onto the exact contract shape: the model
            # supplies id+reason only; the runtime owns evidence identity.
            .repair_candidates = (.repair_candidates // [] | map({
              id,
              reason: (.reason // "unspecified"),
              evidence_refs: $evidence_refs
            }))
            | .handover_attention = {
                next_attention_targets: (
                  if .status == "interpreted"
                  then [.repair_candidates[].id]
                  else []
                  end
                ),
                attention_scope: "evidence-backed interpretation",
                attention_reason: $attention_reason
              }
          elif $mode == "optimize" then
            .status = (if .status == "optimized" then "optimized" else "no_optimization_needed" end)
            | .candidate_result = (
                $prev_candidate // {diff: "(no changes)", files_changed: []}
              )
            | del(.diff, .files_changed)
            | .handover_attention = {
                next_attention_targets: (.candidate_result.files_changed // []),
                attention_scope: "mutation_applied",
                attention_reason: $attention_reason
              }
          elif $mode == "adversarial" then
            .status = (.status // "challenged")
            | .candidate_result = ($prev_candidate // .candidate_result)
            | .findings = (.findings // [] | map(
                .supported_by_evidence = (.supported_by_evidence // true)
                | .evidence_refs = (.evidence_refs // $evidence_refs)
              ))
            | .handover_attention = {
                next_attention_targets: (.candidate_result.files_changed // []),
                attention_scope: "bounded falsification",
                attention_reason: $attention_reason
              }
          elif $mode == "validation" then
            .validated_candidate = ($prev_candidate // .validated_candidate)
            | .findings = ($prev_findings // .findings // [])
            | .basis = (.basis // [] | if type == "string" then [.] else . end)
            | .handover_attention = {
                next_attention_targets: (.validated_candidate.files_changed // []),
                attention_scope: "validation_result",
                attention_reason: $attention_reason
              }
          else
            .handover_attention = (
              .handover_attention // {
                next_attention_targets: [],
                attention_scope: "exploratory",
                attention_reason: $attention_reason
              }
            )
          end
        '
    )"
    
    # Reconstruct output around the normalized artifact using parameter expansion
    local prefix="${AEGIS_SUBSTRATE_OUTPUT%%"${AEGIS_ARTIFACT_BEGIN_MARKER}"*}"
    local suffix="${AEGIS_SUBSTRATE_OUTPUT#*"${AEGIS_ARTIFACT_END_MARKER}"}"

    AEGIS_SUBSTRATE_OUTPUT="$(
      printf '%s\n' "${prefix}"
      printf '%s\n' "${AEGIS_ARTIFACT_BEGIN_MARKER}"
      printf '%s\n' "${updated_artifact}"
      printf '%s\n' "${AEGIS_ARTIFACT_END_MARKER}"
      printf '%s\n' "${suffix}"
    )"
  else
    aegis_warn "substrate_artifact_not_normalizable"
  fi
}

emit_output() {
  echo "${AEGIS_SUBSTRATE_OUTPUT}"
}

# =========================================================
# MAIN
# =========================================================

main() {

  validate_executor_inputs
  resolve_execution_engine
  resolve_capability_envelope
  resolve_evidence_profile
  augment_evidence_profile_from_handover
  prepare_execution_state
  generate_pocket_map
  materialize_capability_environment
  measure "executor_capability_payloads" materialize_capability_payloads
  consume_runtime_owned_capability_manifest
  select_evidence_payloads
  enforce_context_token_budget
  materialize_selected_manifest
  measure "executor_execute_substrate" execute_substrate

  # Normalize substrate output first, so validate_artifact validates the corrected/enveloped JSON
  normalize_substrate_output

  case "${AEGIS_EXECUTION_ENGINE}" in
    aider) measure "executor_artifact_validation" validate_mutation_artifact ;;
    *)     measure "executor_artifact_validation" validate_artifact           ;;
  esac

  emit_output
}

main "$@"
