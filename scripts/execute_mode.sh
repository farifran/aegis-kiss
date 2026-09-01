#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EXECUTION PROTOCOL VM (KISS Refactored)
# =========================================================
#
# Capability envelope → evidence payloads → substrate →
# artifact normalize/validate. Does not own orchestration
# or handover lifecycle (runtime_aegis.sh).
#
# =========================================================

set -Eeuo pipefail

readonly AEGIS_EXECUTOR_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"

cd "${AEGIS_EXECUTOR_ROOT}"

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][EXECUTOR][FATAL] missing_config" >&2
  exit 1
}

# Allow config to load .harness/local.env once (never in env -i children).
export AEGIS_LOAD_LOCAL_ENV=1
source ".harness/config.sh"

# Full AGENTS.md is the constitutional preamble (short, always current).
load_agents_constitution() {
  local agents_file="${AEGIS_ROOT_DIR}/AGENTS.md"
  [[ -f "${agents_file}" ]] || return 0
  cat "${agents_file}"
}

export AEGIS_CONSTITUTIONAL_PREAMBLE
AEGIS_CONSTITUTIONAL_PREAMBLE="$(load_agents_constitution)"

readonly AEGIS_SKILL_FILE="${1:-}"
readonly AEGIS_MODE="${2:-}"
readonly AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${3:-}"

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
source "scripts/lib/demand.sh"
source "scripts/lib/evidence.sh"
source "scripts/lib/artifact_protocol.sh"
AEGIS_LOG_TAG="EXECUTOR"

# Executor holds no durable state — only propagate signal exit codes.
trap 'aegis_warn "Interrupted by SIGINT"; trap - INT TERM; exit 130' INT
trap 'aegis_warn "Interrupted by SIGTERM"; trap - INT TERM; exit 143' TERM

# =========================================================
# INPUT & ENGINE RESOLUTION
# =========================================================

validate_executor_inputs() {
  local pair name fatal_tag
  for pair in \
    "AEGIS_EXECUTION_SURFACE_PATH:missing_execution_surface_path" \
    "AEGIS_EXECUTION_ID:missing_execution_id" \
    "AEGIS_EXECUTION_TIMESTAMP:missing_execution_timestamp" \
    "AEGIS_CAPABILITY_MANIFEST:missing_runtime_owned_capability_manifest"
  do
    name="${pair%%:*}"
    fatal_tag="${pair#*:}"
    [[ -n "${!name:-}" ]] || aegis_fatal "${fatal_tag}"
  done

  # Discovery never loads a skill into a model; file is optional docs only.
  if [[ "${AEGIS_MODE}" != "discovery" ]]; then
    [[ -f "${AEGIS_SKILL_FILE}" ]] \
      || aegis_fatal "missing_skill_contract"
  fi

  [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" ]] \
    || aegis_fatal "missing_epistemic_handover"

  for pair in \
    "AEGIS_EXECUTION_ENGINES:missing_execution_engine_registry" \
    "AEGIS_MODE_CAPABILITY_MAP:missing_mode_capability_map" \
    "AEGIS_CAPABILITY_HANDLERS:missing_capability_handler_registry" \
    "AEGIS_CAPABILITY_ARGUMENTS:missing_capability_argument_registry" \
    "AEGIS_MODE_EVIDENCE_PROFILE:missing_evidence_profile_registry"
  do
    name="${pair%%:*}"
    fatal_tag="${pair#*:}"
    declare -p "${name}" >/dev/null 2>&1 || aegis_fatal "${fatal_tag}"
  done

  [[ -n "${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]:-}" ]] \
    || aegis_fatal "unknown_execution_mode"
}

resolve_execution_engine() {
  export AEGIS_EXECUTION_ENGINE="${AEGIS_EXECUTION_ENGINES[$AEGIS_MODE]}"
  [[ -n "${AEGIS_EXECUTION_ENGINE}" ]] \
    || aegis_fatal "missing_execution_engine"
  aegis_log "Execution engine: ${AEGIS_EXECUTION_ENGINE}"
}

# Bind mode array from config map: map_name → dest nameref.
resolve_mode_array() {
  local -n _mode_map="$1"
  local -n _dest="$2"
  local missing_tag="$3"
  local empty_tag="$4"
  local ref_name="${_mode_map[$AEGIS_MODE]:-}"

  [[ -n "${ref_name}" ]] || aegis_fatal "${missing_tag}"
  local -n _src="${ref_name}"
  [[ "${#_src[@]}" -gt 0 ]] || aegis_fatal "${empty_tag}"
  _dest=("${_src[@]}")
}

resolve_capability_envelope() {
  resolve_mode_array AEGIS_MODE_CAPABILITY_MAP AEGIS_ACTIVE_CAPABILITIES \
    "missing_capability_envelope" "empty_capability_envelope"
}

resolve_evidence_profile() {
  resolve_mode_array AEGIS_MODE_EVIDENCE_PROFILE AEGIS_ACTIVE_EVIDENCE_ENTRIES \
    "missing_evidence_profile" "empty_evidence_profile"
}

# =========================================================
# EVIDENCE PROFILE AUGMENTATION & RANKING
# =========================================================

_append_evidence_entry_unique() {
  local entry="$1"
  local active
  [[ -n "${entry}" ]] || return 0
  for active in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
    [[ "${active}" == "${entry}" ]] && return 0
  done
  AEGIS_ACTIVE_EVIDENCE_ENTRIES+=("${entry}")
}

# Drop a capability id from the active evidence list (in-place).
omit_active_evidence_entry() {
  local drop="${1-}"
  local -a kept=()
  local e
  [[ -n "${drop}" ]] || return 0
  for e in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
    [[ "${e}" == "${drop}" ]] && continue
    kept+=("${e}")
  done
  AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${kept[@]}")
}

augment_evidence_profile_from_handover() {
  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
    local req_ev
    req_ev="$(
      jq -r '.artifact_snapshot.operational_context.required_evidence[]? // empty' \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null || true
    )"
    while IFS= read -r entry; do
      _append_evidence_entry_unique "${entry}"
    done <<< "${req_ev}"
  fi
}

augment_evidence_profile_from_anchors() {
  case "${AEGIS_MODE}" in
    forensics|mutation|build|adversarial|optimize) ;;
    *) return 0 ;;
  esac

  local max_reads="${AEGIS_DETERMINISTIC_READ_MAX:-8}"
  local added=0
  local path entry before candidate_paths=""

  candidate_paths="$(
    {
      aegis_extract_operator_named_paths "${AEGIS_INVESTIGATION_INPUT:-}"
      if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
        jq -r '.epistemic_state.next_attention_targets[]? // empty' \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null || true
      fi
    } | sed 's|^filesystem\.read:||' | awk 'NF' | sort -u
  )"

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    [[ "${added}" -lt "${max_reads}" ]] || break
    if ! printf '%s' "${path}" | grep -qE "^${AEGIS_SOURCE_PATH_RE}\$"; then
      continue
    fi
    if [[ "${path}" == /* ]] || [[ "${path}" == *..* ]]; then
      continue
    fi
    entry="filesystem.read:${path}"
    before="${#AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"
    _append_evidence_entry_unique "${entry}"
    if [[ "${#AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" -gt "${before}" ]]; then
      added=$((added + 1))
    fi
  done <<< "${candidate_paths}"

  if [[ "${added}" -gt 0 ]]; then
    aegis_log "deterministic_read_anchors: +${added} (cap ${max_reads})"
  fi
}

_evidence_entry_priority_rank() {
  local capability="${1%%:*}"
  case "${capability}" in
    runtime.layer0_facts) REPLY=15 ;;
    runtime.attention_seed) REPLY=18 ;;
    runtime.demand_anchors) REPLY=20 ;;
    filesystem.read) REPLY=30 ;;
    filesystem.search_symbol) REPLY=40 ;;
    git.status|git.diff) REPLY=50 ;;
    typescript.check|eslint.check|test.run) REPLY=60 ;;
    filesystem.list_tree) REPLY=70 ;;
    *) REPLY=80 ;;
  esac
}

prioritize_evidence_entries() {
  local entry
  local -a ranked=()
  local -a ordered=()

  [[ "${#AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" -gt 0 ]] || return 0

  for entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do
    [[ -n "${entry}" ]] || continue
    _evidence_entry_priority_rank "${entry}"
    ranked+=("${REPLY}"$'\t'"${entry}")
  done

  mapfile -t ordered < <(
    printf '%s\n' "${ranked[@]}" \
      | LC_ALL=C sort -t $'\t' -k1,1n -k2,2 \
      | cut -f2-
  )
  AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${ordered[@]}")
}

resolve_evidence_entry_capability() {
  printf '%s' "${1%%:*}"
}

resolve_evidence_entry_alias() {
  if [[ "$1" == *:* ]]; then
    printf '%s' "${1#*:}"
  else
    printf '%s' ""
  fi
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
# PAYLOAD & ENVIRONMENT MATERIALIZATION
# =========================================================

prepare_execution_state() {
  aegis_log "Using runtime-prepared execution state..."
  mkdir -p "${AEGIS_CAPABILITY_ENV_DIR}" || aegis_fatal "failed_to_create_capability_environment"
  mkdir -p "${AEGIS_CAPABILITY_PAYLOAD_DIR}" || aegis_fatal "failed_to_create_capability_payload_dir"
}

validate_materialized_payload() {
  local capability="$1" payload_path="$2" expected_classification
  expected_classification="${AEGIS_CAPABILITY_CLASSIFICATION[$capability]:-}"
  [[ -n "${expected_classification}" ]] || aegis_fatal "missing_capability_classification"

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

resolve_capability_argument() {
  local capability="$1"
  local evidence_alias="${2:-}"

  case "${capability}" in
    filesystem.read)
      if [[ -n "${evidence_alias}" ]]; then
        declare -p AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS >/dev/null 2>&1 \
          || aegis_fatal "missing_runtime_filesystem_read_target_registry"
        if [[ -n "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[$evidence_alias]:-}" ]]; then
          printf '%s' "${AEGIS_RUNTIME_FILESYSTEM_READ_TARGETS[$evidence_alias]}"
          return 0
        fi
        printf '%s' "${evidence_alias}"
        return 0
      fi
      printf '%s' "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"
      ;;
    filesystem.search_symbol)
      aegis_demand_search_query \
        "${AEGIS_INVESTIGATION_INPUT:-}" \
        "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-AEGIS}"
      ;;
    filesystem.list_tree|runtime.layer0_facts|runtime.attention_seed|runtime.demand_anchors)
      printf '%s' "${AEGIS_EVIDENCE_TARGET_PATH:-.}"
      ;;
    *)
      printf '%s' "${AEGIS_CAPABILITY_ARGUMENTS[$capability]:-}"
      ;;
  esac
}

run_with_isolated_base_env() {
  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    LC_ALL="${LC_ALL:-}" \
    "$@"
}

invoke_capability_handler() {
  local handler="$1" capability_argument="$2"
  run_with_isolated_base_env \
    AEGIS_EXECUTION_ID="${AEGIS_EXECUTION_ID}" \
    AEGIS_EXECUTION_TIMESTAMP="${AEGIS_EXECUTION_TIMESTAMP}" \
    AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_EXECUTION_SURFACE_PATH}" \
    AEGIS_EPISTEMIC_HANDOVER_FILE="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" \
    AEGIS_INVESTIGATION_INPUT="${AEGIS_INVESTIGATION_INPUT:-}" \
    AEGIS_EVIDENCE_TARGET_PATH="${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
    AEGIS_CAPABILITY_PAYLOAD_DIR="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
    AEGIS_POCKET_MAP_FILE="${AEGIS_POCKET_MAP_FILE:-}" \
    AEGIS_EPISTEMIC_HANDOVER_READ_MAX_BYTES="${AEGIS_EPISTEMIC_HANDOVER_READ_MAX_BYTES:-}" \
    AEGIS_FILE_CONTENT_MAX_BYTES="${AEGIS_FILE_CONTENT_MAX_BYTES:-}" \
    AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES="${AEGIS_SEARCH_SYMBOL_MAX_MATCH_LINES:-}" \
    AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES="${AEGIS_CAPABILITY_PAYLOAD_MAX_BYTES:-}" \
    AEGIS_SEARCH_SYMBOL_CONTEXT_LINES="${AEGIS_SEARCH_SYMBOL_CONTEXT_LINES:-}" \
    AEGIS_SEARCH_SYMBOL_PATHSPECS="${AEGIS_SEARCH_SYMBOL_PATHSPECS:-}" \
    bash "${handler}" "${capability_argument}"
}

materialize_capability_environment() {
  aegis_log "Materializing capability environment..."
  local capability handler capability_path

  for capability in "${AEGIS_ACTIVE_CAPABILITIES[@]}"; do
    handler="${AEGIS_CAPABILITY_HANDLERS[$capability]:-}"
    [[ -n "${handler}" ]] || aegis_fatal "missing_handler_for_capability"
    [[ -f "${handler}" ]] || aegis_fatal "missing_capability_handler_file"

    capability_path="${AEGIS_CAPABILITY_ENV_DIR}/${capability}"
    cat > "${capability_path}" <<EOF
#!/usr/bin/env bash
exec bash "${AEGIS_EXECUTOR_ROOT}/${handler}" "\$@"
EOF
    chmod +x "${capability_path}"
  done
}

consume_runtime_owned_capability_manifest() {
  aegis_log "Consuming runtime-owned capability manifest..."
  [[ -n "${AEGIS_CAPABILITY_MANIFEST:-}" ]] \
    || aegis_fatal "missing_capability_manifest"
  printf '%s\n' "${AEGIS_CAPABILITY_MANIFEST}" | jq empty >/dev/null 2>&1 \
    || aegis_fatal "invalid_runtime_owned_capability_manifest"
}

select_evidence_payloads() {
  local evidence_entry capability evidence_alias payload_file payload_path
  local payload_paths=()

  for evidence_entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do
    capability="$(resolve_evidence_entry_capability "${evidence_entry}")"
    evidence_alias="$(resolve_evidence_entry_alias "${evidence_entry}")"
    payload_file="$(resolve_evidence_payload_file "${capability}" "${evidence_alias}")"
    payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${payload_file}"

    [[ -f "${payload_path}" ]] || aegis_fatal "missing_evidence_payload: ${payload_path}"
    payload_paths+=("${payload_path}")
  done

  export AEGIS_SELECTED_CAPABILITY_PAYLOADS="$(
    jq -cn '$ARGS.positional' --args "${payload_paths[@]}"
  )"
}

# =========================================================
# TOKEN BUDGETER & SELECTED MANIFEST
# =========================================================

: "${AEGIS_MAX_CONTEXT_BYTES:=32768}"
AEGIS_CONTEXT_BUDGET_PRUNED="false"
AEGIS_CONTEXT_BUDGET_EXCEEDED="false"

measure_selected_payload_bytes() {
  local total=0 payload_path
  while IFS= read -r payload_path; do
    [[ -f "${payload_path}" ]] || continue
    total=$((total + $(wc -c < "${payload_path}")))
  done < <(printf '%s' "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-[]}" | jq -r '.[]?')
  printf '%s' "${total}"
}

truncate_payload_for_budget() {
  local payload_path="$1" pruned_tmp full_dir full_path=""
  pruned_tmp="$(mktemp)"
  full_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}/.full"

  if [[ -n "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" ]] && mkdir -p "${full_dir}" 2>/dev/null; then
    full_path="${full_dir}/$(basename "${payload_path}")"
    cp "${payload_path}" "${full_path}" 2>/dev/null || full_path=""
  fi

  if jq -c --arg full_path "${full_path}" '
      { success, capability, classification, execution_id, generated_at, error }
      + { payload: ({ context_budget_pruned: true, truncated_preview: ((.payload | tojson)[0:1024]) }
          + (if $full_path == "" then {} else {recoverable_from: $full_path} end)) }
    ' "${payload_path}" > "${pruned_tmp}" 2>/dev/null; then
    mv "${pruned_tmp}" "${payload_path}"
  else
    rm -f "${pruned_tmp}"
    aegis_warn "context_budget_truncation_skipped: ${payload_path}"
  fi
}

enforce_context_token_budget() {
  local total_bytes payload_path
  total_bytes="$(measure_selected_payload_bytes)"

  if [[ "${total_bytes}" -le "${AEGIS_MAX_CONTEXT_BYTES}" ]]; then
    aegis_log "Context budget: ${total_bytes}/${AEGIS_MAX_CONTEXT_BYTES} bytes — within ceiling"
    return 0
  fi

  aegis_warn "Context budget exceeded: ${total_bytes}/${AEGIS_MAX_CONTEXT_BYTES} bytes — pruning lower-priority evidence"

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
      | jq -r 'reverse | .[]?' \
      | while IFS= read -r p; do
          [[ -f "${p}" ]] || continue
          case "${p}" in
            *epistemic_handover*|*runtime_demand_anchors*|*filesystem_read_*) continue ;;
          esac
          printf '%s\n' "${p}"
        done
  )

  if [[ "${total_bytes}" -gt "${AEGIS_MAX_CONTEXT_BYTES}" ]]; then
    AEGIS_CONTEXT_BUDGET_EXCEEDED="true"
    aegis_warn "Context budget still above ceiling after pruning: ${total_bytes} bytes (handover context preserved)"
  else
    aegis_log "Context budget: ${total_bytes}/${AEGIS_MAX_CONTEXT_BYTES} bytes after pruning"
  fi
}

emit_context_budget_metric() {
  [[ -n "${AEGIS_METRICS_FILE:-}" ]] || return 0
  jq -cn \
    --arg mode "${AEGIS_MODE:-}" \
    --argjson context_bytes "$(measure_selected_payload_bytes)" \
    --argjson ceiling_bytes "${AEGIS_MAX_CONTEXT_BYTES}" \
    --argjson evidence_cache_hits "${AEGIS_EVIDENCE_CACHE_HITS:-0}" \
    --argjson evidence_cache_bytes "${AEGIS_EVIDENCE_CACHE_BYTES:-0}" \
    --argjson budget_pruned "${AEGIS_CONTEXT_BUDGET_PRUNED:-false}" \
    --argjson budget_exceeded "${AEGIS_CONTEXT_BUDGET_EXCEEDED:-false}" \
    '{kind:"cache",mode:$mode,context_bytes:$context_bytes,
      ceiling_bytes:$ceiling_bytes,evidence_cache_hits:$evidence_cache_hits,
      evidence_cache_bytes:$evidence_cache_bytes,
      budget_pruned:$budget_pruned,budget_exceeded:$budget_exceeded}' \
    >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

materialize_selected_manifest() {
  [[ -n "${AEGIS_CAPABILITY_MANIFEST:-}" ]] || aegis_fatal "missing_capability_manifest"
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
  [[ -n "${AEGIS_SELECTED_MANIFEST}" ]] || aegis_fatal "missing_selected_manifest"
}

# =========================================================
# SUBSTRATE INVOCATIONS (RAW & AIDER)
# =========================================================

invoke_raw_substrate() {
  local model="$1" skill_file="$2" selected_manifest="$3" capability_payload_dir="$4"
  run_with_isolated_base_env \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    AEGIS_SKIP_LOCAL_ENV="${AEGIS_SKIP_LOCAL_ENV:-}" \
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
    AEGIS_RAW_JSON_OBJECT_FORMAT="${AEGIS_RAW_JSON_OBJECT_FORMAT:-1}" \
    AEGIS_RAW_JSON_OBJECT_FORMAT_SUPPORTED="${AEGIS_RAW_JSON_OBJECT_FORMAT_SUPPORTED:-1}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS:-}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_DISCOVERY="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_DISCOVERY:-}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_FORENSICS="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_FORENSICS:-}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_OPTIMIZE="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_OPTIMIZE:-}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL:-}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION:-}" \
    AEGIS_CAPABILITY_MANIFEST_MAX_BYTES="${AEGIS_CAPABILITY_MANIFEST_MAX_BYTES}" \
    AEGIS_ARTIFACT_BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
    AEGIS_ARTIFACT_END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
    AEGIS_METRICS_FILE="${AEGIS_METRICS_FILE:-}" \
    AEGIS_PROVIDER_EXTRA_HEADER="${AEGIS_PROVIDER_EXTRA_HEADER:-}" \
    bash scripts/substrates/raw_llm.sh \
      "${model}" \
      "${skill_file}" \
      "${selected_manifest}" \
      "${capability_payload_dir}"
}

invoke_aider_substrate() {
  local skill_file="$1" capability_payload_dir="$2"
  run_with_isolated_base_env \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    OPENAI_API_BASE="${OPENAI_API_BASE:-}" \
    AEGIS_SKIP_LOCAL_ENV="${AEGIS_SKIP_LOCAL_ENV:-}" \
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
    AEGIS_MUTATION_PREFLIGHT="${AEGIS_MUTATION_PREFLIGHT:-true}" \
    AEGIS_MUTATION_INTENT_PREFLIGHT="${AEGIS_MUTATION_INTENT_PREFLIGHT:-}" \
    AEGIS_MUTATION_INTENT_FIX_ATTEMPTS="${AEGIS_MUTATION_INTENT_FIX_ATTEMPTS:-}" \
    AEGIS_MUTATION_MAX_NEW_EXPORTS="${AEGIS_MUTATION_MAX_NEW_EXPORTS:-}" \
    AEGIS_DEMAND_TOKEN_PREFLIGHT="${AEGIS_DEMAND_TOKEN_PREFLIGHT:-}" \
    AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS="${AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS:-}" \
    AEGIS_METRICS_FILE="${AEGIS_METRICS_FILE:-}" \
    bash scripts/substrates/aider_substrate.sh \
      "${skill_file}" \
      "${capability_payload_dir}"
}

# =========================================================
# MECHANICAL SUBSTRATE DISPATCH
# =========================================================

execute_mechanical_mode() {
  local out=""
  case "${AEGIS_MODE}" in
    discovery)
      declare -f aegis_emit_mechanical_discovery_substrate >/dev/null 2>&1 \
        || aegis_fatal "discovery_mechanical_unavailable"
      out="$(aegis_emit_mechanical_discovery_substrate \
        "${AEGIS_INVESTIGATION_INPUT:-}" \
        "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}")" || out=""
      [[ -n "${out}" ]] || aegis_fatal "discovery_mechanical_failed"
      aegis_log "discovery_mechanical: runtime-only (no LLM)"
      AEGIS_SUBSTRATE_OUTPUT="${out}"
      return 0
      ;;

    validation)
      case "$(printf '%s' "${AEGIS_VALIDATION_LLM:-0}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on|llm) aegis_log "validation_llm: force (skill loaded)"; return 1 ;;
      esac
      declare -f aegis_emit_mechanical_validation_substrate >/dev/null 2>&1 \
        || aegis_fatal "validation_mechanical_unavailable"
      out="$(aegis_emit_mechanical_validation_substrate)" || out=""
      [[ -n "${out}" ]] || aegis_fatal "validation_mechanical_failed"
      aegis_log "validation_mechanical: tribunal-only (no LLM)"
      if declare -f aegis_record_validation_metric >/dev/null 2>&1; then
        aegis_record_validation_metric "mechanical" "tribunal"
      fi
      AEGIS_SUBSTRATE_OUTPUT="${out}"
      return 0
      ;;

    optimize)
      local h="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
      if [[ "${AEGIS_AGENTIC:-0}" == "1" ]] && [[ -f "${AEGIS_AGENTIC_VERDICT_FILE:-}" ]]; then
        out="$(aegis_synthesize_agentic_verdict_artifact "optimize" "${AEGIS_AGENTIC_VERDICT_FILE}")" || out=""
        if [[ -n "${out}" ]]; then
          aegis_log "optimize_agentic: artifact sintetizado do assistente"
          if declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
            aegis_record_optimize_metric "agentic_verdict" "$(printf '%s' "${out}" | jq -r '.basis // empty' 2>/dev/null || true)"
          fi
          AEGIS_SUBSTRATE_OUTPUT="${out}"
          return 0
        fi
      fi
      if [[ "${AEGIS_OPTIMIZE_BUILD_COUNT:-0}" -ge 1 ]]; then
        declare -f aegis_emit_mechanical_optimize_passthrough >/dev/null 2>&1 || aegis_fatal "optimize_passthrough_unavailable"
        out="$(aegis_emit_mechanical_optimize_passthrough "optimize_passthrough_after_refine")" || out=""
        [[ -n "${out}" ]] || aegis_fatal "optimize_passthrough_failed"
        aegis_log "optimize_passthrough: after refine (count=${AEGIS_OPTIMIZE_BUILD_COUNT}) — no LLM"
        if declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
          aegis_record_optimize_metric "passthrough_after_refine" "count=${AEGIS_OPTIMIZE_BUILD_COUNT}"
        fi
        AEGIS_SUBSTRATE_OUTPUT="${out}"
        return 0
      fi
      if declare -f aegis_mechanical_optimize_scan >/dev/null 2>&1 \
        && declare -f aegis_emit_mechanical_optimize_can_improve >/dev/null 2>&1; then
        local imp
        imp="$(aegis_mechanical_optimize_scan "${h}" 2>/dev/null || true)"
        if [[ -n "${imp}" ]] && printf '%s' "${imp}" | jq -e 'type == "object" and (.change|type=="string")' >/dev/null 2>&1; then
          out="$(aegis_emit_mechanical_optimize_can_improve "${imp}")" || out=""
          [[ -n "${out}" ]] || aegis_fatal "optimize_mechanical_improve_failed"
          aegis_log "optimize_mechanical: $(printf '%s' "${imp}" | jq -r '.code // "improve"' 2>/dev/null || echo improve) — no LLM"
          if declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
            aegis_record_optimize_metric "mechanical_improve" "$(printf '%s' "${imp}" | jq -r '.code // empty' 2>/dev/null || true)"
          fi
          AEGIS_SUBSTRATE_OUTPUT="${out}"
          return 0
        fi
      fi
      if [[ "${AEGIS_OPTIMIZE_TRIVIAL_SKIP:-true}" != "0" && "${AEGIS_OPTIMIZE_TRIVIAL_SKIP:-true}" != "false" ]] \
        && (declare -f aegis_optimize_mutation_is_trivial >/dev/null 2>&1 || declare -f aegis_optimize_build_is_trivial >/dev/null 2>&1) \
        && (aegis_optimize_mutation_is_trivial "${h}" 2>/dev/null || aegis_optimize_build_is_trivial "${h}"); then
        declare -f aegis_emit_mechanical_optimize_passthrough >/dev/null 2>&1 || aegis_fatal "optimize_passthrough_unavailable"
        out="$(aegis_emit_mechanical_optimize_passthrough "optimize_mechanical_clean")" || out=""
        [[ -n "${out}" ]] || aegis_fatal "optimize_mechanical_clean_failed"
        aegis_log "optimize_mechanical_clean: no greppable issues — no LLM"
        if declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
          aegis_record_optimize_metric "mechanical_clean" "trivial"
        fi
        AEGIS_SUBSTRATE_OUTPUT="${out}"
        return 0
      fi
      return 1
      ;;

    forensics)
      if declare -f aegis_emit_mechanical_forensics_substrate >/dev/null 2>&1; then
        if [[ "${AEGIS_FORENSICS_USE_LLM:-0}" != "1" ]]; then
          out="$(aegis_emit_mechanical_forensics_substrate \
            "${AEGIS_INVESTIGATION_INPUT:-}" \
            "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
            "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}")" || out=""
          if [[ -n "${out}" ]]; then
            aegis_log "forensics_mechanical: skipped LLM+skill (unambiguous anchors)"
            AEGIS_SUBSTRATE_OUTPUT="${out}"
            return 0
          fi
          aegis_warn "forensics_mechanical_failed — falling back to LLM"
          if declare -f aegis_forensics_ensure_search_symbol_payload >/dev/null 2>&1; then
            aegis_forensics_ensure_search_symbol_payload || true
          fi
        else
          aegis_log "forensics_llm: ambiguity or AEGIS_FORENSICS_LLM force (skill loaded)"
        fi
      fi
      return 1
      ;;
  esac
  return 1
}

# =========================================================
# ADVERSARIAL MECHANICAL PATH (ISOLATED)
# =========================================================

execute_adversarial_mechanical() {
  [[ "${AEGIS_MODE}" == "adversarial" ]] || return 1
  declare -f build_tribunal_tools_gate >/dev/null 2>&1 || return 1

  local handover root="." files="[]" gate clean out="" diff_findings
  handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"

  # Agentic verdict synthesis
  if [[ "${AEGIS_AGENTIC:-0}" == "1" ]] && [[ -f "${AEGIS_AGENTIC_VERDICT_FILE:-}" ]]; then
    out="$(aegis_synthesize_agentic_verdict_artifact "adversarial" "${AEGIS_AGENTIC_VERDICT_FILE}")" || out=""
    if [[ -n "${out}" ]]; then
      aegis_log "adversarial_agentic: artifact sintetizado do assistente"
      if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
        jq -cn '{kind:"adversarial",result:"agentic_verdict"}' >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
      fi
      AEGIS_SUBSTRATE_OUTPUT="${out}"
      local agentic_artifact agentic_mechanical_findings
      agentic_artifact="$(extract_substrate_artifact)"
      agentic_mechanical_findings="[]"
      if declare -f aegis_mechanical_adversarial_diff_scan >/dev/null 2>&1; then
        agentic_mechanical_findings="$(aegis_mechanical_adversarial_diff_scan "${handover}" "${AEGIS_INVESTIGATION_INPUT:-}" ".")" || agentic_mechanical_findings="[]"
      fi
      if printf '%s' "${agentic_mechanical_findings}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
        agentic_artifact="$(jq -c --argjson mechanical "${agentic_mechanical_findings}" '.findings = ((.findings // []) + $mechanical) | .status = "challenged"' <<<"${agentic_artifact}")"
        rewrite_substrate_output_with_artifact "${agentic_artifact}"
      fi
      normalize_substrate_output
      measure "executor_artifact_validation" validate_artifact
      emit_output
      return 0
    fi
  fi

  handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  if declare -f aegis_handover_candidate_files_changed_json >/dev/null 2>&1; then
    files="$(aegis_handover_candidate_files_changed_json "${handover}")"
  fi
  gate="$(build_tribunal_tools_gate "${files}")"
  clean="$(printf '%s' "${gate}" | jq -r '.mutation_clean // true' 2>/dev/null || printf 'true')"

  if [[ -n "${AEGIS_EXECUTION_SURFACE:-}" && -d "${AEGIS_EXECUTION_SURFACE}" ]]; then
    root="${AEGIS_EXECUTION_SURFACE}"
  elif [[ -n "${AEGIS_EXECUTION_TARGET_PATH:-}" && -d "${AEGIS_EXECUTION_TARGET_PATH}" ]]; then
    root="${AEGIS_EXECUTION_TARGET_PATH}"
  fi

  # 1. Fidelity/diff greps ALWAYS (highest priority)
  if declare -f aegis_mechanical_adversarial_diff_scan >/dev/null 2>&1 \
    && declare -f aegis_emit_mechanical_adversarial_findings >/dev/null 2>&1; then
    diff_findings="$(aegis_mechanical_adversarial_diff_scan "${handover}" "${AEGIS_INVESTIGATION_INPUT:-}" "${root}")" || diff_findings="[]"
    if printf '%s' "${diff_findings}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
      out="$(aegis_emit_mechanical_adversarial_findings "${diff_findings}")" || out=""
      if [[ -n "${out}" ]]; then
        aegis_log "adversarial_mechanical: fidelity/diff smells — skip LLM"
        AEGIS_SUBSTRATE_OUTPUT="${out}"
        if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
          jq -cn --argjson n "$(printf '%s' "${diff_findings}" | jq 'length')" \
            '{kind:"adversarial",result:"mechanical_diff_challenged",findings:$n}' >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
        fi
        normalize_substrate_output
        measure "executor_artifact_validation" validate_artifact
        emit_output
        return 0
      fi
    fi
  fi

  # 2. Tools dirty
  if [[ "${clean}" == "false" ]] && declare -f aegis_emit_mechanical_adversarial_from_tools_gate >/dev/null 2>&1; then
    out="$(aegis_emit_mechanical_adversarial_from_tools_gate "${gate}")" || out=""
    if [[ -n "${out}" ]]; then
      aegis_log "adversarial_mechanical: tools dirty — skip LLM"
      AEGIS_SUBSTRATE_OUTPUT="${out}"
      if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
        jq -cn '{kind:"adversarial",result:"mechanical_tools_challenged"}' >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
      fi
      normalize_substrate_output
      measure "executor_artifact_validation" validate_artifact
      emit_output
      return 0
    fi
  fi

  # 3. Clean tools + greps: check if verified clean without LLM
  if [[ "${clean}" == "true" ]]; then
    if declare -f aegis_adversarial_should_use_llm >/dev/null 2>&1 \
      && declare -f aegis_emit_mechanical_adversarial_verified >/dev/null 2>&1 \
      && ! aegis_adversarial_should_use_llm "${handover}"; then
      out="$(aegis_emit_mechanical_adversarial_verified "mechanical_verified_clean")" || out=""
      if [[ -n "${out}" ]]; then
        aegis_log "adversarial_mechanical: verified clean (LLM residual skipped)"
        AEGIS_SUBSTRATE_OUTPUT="${out}"
        if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
          jq -cn '{kind:"adversarial",result:"mechanical_verified"}' >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
        fi
        normalize_substrate_output
        measure "executor_artifact_validation" validate_artifact
        emit_output
        return 0
      fi
    else
      aegis_log "adversarial_llm: residual falsification (clean tools/greps, risk or force)"
    fi
  fi

  return 1
}

# =========================================================
# SUBSTRATE EXECUTION
# =========================================================

execute_substrate() {
  local substrate_output

  if execute_mechanical_mode; then
    return 0
  fi

  case "${AEGIS_EXECUTION_ENGINE}" in
    raw)
      local raw_model="${OPENAI_MODEL_READONLY_COGNITION:-${AEGIS_SUPERVISOR_MODEL:-z-ai/glm-5.2}}"
      if [[ "${AEGIS_MODE}" == "optimize" ]]; then
        raw_model="${OPENAI_MODEL_OPTIMIZE:-${AEGIS_SUPERVISOR_MODEL:-z-ai/glm-5.2}}"
      elif [[ "${AEGIS_MODE}" == "adversarial" ]]; then
        raw_model="${OPENAI_MODEL_ADVERSARIAL:-${AEGIS_SUPERVISOR_MODEL:-z-ai/glm-5.2}}"
      fi
      substrate_output="$(
        invoke_raw_substrate \
          "${raw_model}" \
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

  AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
}

# Extract field from artifact JSON for metrics
_extract_artifact_field() {
  local query="$1"
  printf '%s' "${AEGIS_SUBSTRATE_OUTPUT:-}" \
    | sed -n "/${AEGIS_ARTIFACT_BEGIN_MARKER}/,/${AEGIS_ARTIFACT_END_MARKER}/p" \
    | sed -e "1d" -e "\$d" \
    | jq -r "${query}" 2>/dev/null || true
}

record_mode_metrics() {
  if [[ "${AEGIS_MODE}" == "validation" ]] && declare -f aegis_record_validation_metric >/dev/null 2>&1; then
    local v b
    v="$(_extract_artifact_field '.verdict // empty')"
    b="$(_extract_artifact_field '(.basis // []) | if type == "array" then join("; ") else tostring end')"
    case "${v}" in
      accepted|rejected|insufficient) aegis_record_validation_metric "${v}" "${b:0:160}" ;;
    esac
  elif [[ "${AEGIS_MODE}" == "optimize" ]] && declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
    local s b
    s="$(_extract_artifact_field '.status // empty')"
    b="$(_extract_artifact_field '.basis // empty')"
    case "${s}" in
      can_improve|no_improvement_needed)
        case "${b}" in
          optimize_passthrough_after_refine|optimize_trivial_skip|optimize_mechanical_clean|optimize_mechanical:*) ;;
          *) aegis_record_optimize_metric "${s}" "${b:0:120}" ;;
        esac
        ;;
    esac
  fi
}

# =========================================================
# MAIN ENTRY POINT (KISS PIPELINE)
# =========================================================

main() {
  validate_executor_inputs
  resolve_execution_engine
  resolve_capability_envelope
  resolve_evidence_profile
  augment_evidence_profile_from_handover
  augment_evidence_profile_from_anchors

  # Decide forensics search policy before materialize
  AEGIS_FORENSICS_USE_LLM=""
  if [[ "${AEGIS_MODE}" == "forensics" ]] && declare -f aegis_forensics_needs_llm >/dev/null 2>&1; then
    if [[ "${AEGIS_AGENTIC:-0}" == "1" ]]; then
      AEGIS_FORENSICS_USE_LLM=0
      omit_active_evidence_entry "filesystem.search_symbol"
      aegis_log "forensics_evidence: agentic — mechanical path (no LLM)"
    elif aegis_forensics_needs_llm \
      "${AEGIS_INVESTIGATION_INPUT:-}" \
      "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}"; then
      AEGIS_FORENSICS_USE_LLM=1
      aegis_log "forensics_evidence: keep search_symbol (LLM path)"
    else
      AEGIS_FORENSICS_USE_LLM=0
      omit_active_evidence_entry "filesystem.search_symbol"
      aegis_log "forensics_evidence: omitted search_symbol (mechanical path)"
    fi
    export AEGIS_FORENSICS_USE_LLM
  fi

  # Mutation with a clear forensics ALVO does not need repo-wide search noise.
  if [[ "${AEGIS_MODE}" == "mutation" || "${AEGIS_MODE}" == "build" ]] \
    && (declare -f aegis_handover_has_mutation_alvo >/dev/null 2>&1 || declare -f aegis_handover_has_build_alvo >/dev/null 2>&1) \
    && (aegis_handover_has_mutation_alvo "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}" 2>/dev/null \
        || aegis_handover_has_build_alvo "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"); then
    omit_active_evidence_entry "filesystem.search_symbol"
    aegis_log "mutation_evidence: omitted search_symbol (forensics ALVO present)"
  fi

  prioritize_evidence_entries
  prepare_execution_state
  generate_pocket_map
  materialize_capability_environment
  measure "executor_capability_payloads" materialize_capability_payloads
  consume_runtime_owned_capability_manifest
  select_evidence_payloads
  enforce_context_token_budget
  emit_context_budget_metric
  materialize_selected_manifest

  # Adversarial mechanical fast-path check
  if execute_adversarial_mechanical; then
    return 0
  fi

  measure "executor_execute_substrate" execute_substrate
  normalize_substrate_output

  case "${AEGIS_EXECUTION_ENGINE}" in
    aider) measure "executor_artifact_validation" validate_mutation_artifact ;;
    *)     measure "executor_artifact_validation" validate_artifact           ;;
  esac

  record_mode_metrics
  emit_output
}

main "$@"
