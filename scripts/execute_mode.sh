#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EXECUTION PROTOCOL VM
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
# Do not section-filter: headings drift, the whole contract must ship.
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

# Append evidence entry if not already present (O(n) over the small profile).
_append_evidence_entry_unique() {
  local entry="$1"
  local active
  [[ -n "${entry}" ]] || return 0
  for active in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
    [[ "${active}" == "${entry}" ]] && return 0
  done
  AEGIS_ACTIVE_EVIDENCE_ENTRIES+=("${entry}")
}

# Discovery-requested reads only (operational_context.required_evidence).
# Epistemic next_attention_targets are NOT promoted here — those are
# incomplete attention, materialised separately as deterministic anchors.
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

# Runtime-owned content seeds for modes that must interpret file bodies.
# Sources (mechanical only — never model-invented):
#   1. operator-named source paths in AEGIS_INVESTIGATION_INPUT
#   2. epistemic_state.next_attention_targets (path tokens)
# Caps at AEGIS_DETERMINISTIC_READ_MAX so budgets stay honest.
# Missing-on-disk paths still materialise as net-new placeholders
# (see materialize_capability_payloads).
augment_evidence_profile_from_anchors() {
  case "${AEGIS_MODE}" in
    forensics|repair|adversarial|optimize) ;;
    *) return 0 ;;
  esac

  local max_reads="${AEGIS_DETERMINISTIC_READ_MAX:-8}"
  local added=0
  local path entry before candidate_paths=""

  # Collect candidate path tokens (newline-separated), then apply.
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

# Rank evidence entries so budget cuts hit low-signal first.
# Lower rank number = higher priority (materialize + expose first).
#   15 layer0_facts  (must precede attention_seed — predecessor payload)
#   18 attention_seed
#   20 demand_anchors (after seed so seed_targets can be filled)
#   30 filesystem.read (content seeds + handover)
#   40 search_symbol
#   50 git
#   60 tools (tsc/eslint/test)
#   70 list_tree
#   80 other
_evidence_entry_priority_rank() {
  local entry="$1"
  local capability="${entry%%:*}"
  case "${capability}" in
    runtime.layer0_facts) echo 15 ;;
    runtime.attention_seed) echo 18 ;;
    runtime.demand_anchors) echo 20 ;;
    filesystem.read) echo 30 ;;
    filesystem.search_symbol) echo 40 ;;
    git.status|git.diff) echo 50 ;;
    typescript.check|eslint.check|test.run) echo 60 ;;
    filesystem.list_tree) echo 70 ;;
    *) echo 80 ;;
  esac
}

prioritize_evidence_entries() {
  local entry rank
  local -a ranked=()
  local -a ordered=()

  [[ "${#AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" -gt 0 ]] || return 0

  for entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do
    [[ -n "${entry}" ]] || continue
    rank="$(_evidence_entry_priority_rank "${entry}")"
    # Tab-separated: rank is numeric key; entry may contain spaces rarely.
    ranked+=("${rank}"$'\t'"${entry}")
  done

  mapfile -t ordered < <(
    printf '%s\n' "${ranked[@]}" \
      | LC_ALL=C sort -t $'\t' -k1,1n -k2,2 \
      | cut -f2-
  )
  AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${ordered[@]}")
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
    filesystem.search_symbol)
      # Bind search to demand tokens (not the static "AEGIS" default).
      # Fallback keeps config default when free-text yields no tokens.
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

# Isolated child process envelope: clean env with locale + PATH only.
# Callers pass additional KEY=value pairs then the command.
#   run_with_isolated_base_env FOO=bar bash script.sh args...
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

  local handler="$1"
  local capability_argument="$2"

  run_with_isolated_base_env \
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
    AEGIS_SEARCH_SYMBOL_PATHSPECS="${AEGIS_SEARCH_SYMBOL_PATHSPECS:-}" \
    bash "${handler}" "${capability_argument}"
}

invoke_raw_substrate() {

  local model="$1"
  local skill_file="$2"
  local selected_manifest="$3"
  local capability_payload_dir="$4"

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
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL:-}" \
    AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION:-}" \
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

  # Prunable payloads, largest first among low-priority evidence.
  # Protected (never pruned first): demand_anchors, epistemic handover,
  # and filesystem.read content seeds — these are the mechanical anchors.
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
      | while IFS= read -r p; do
          [[ -f "${p}" ]] || continue
          case "${p}" in
            *epistemic_handover*|*runtime_demand_anchors*|*filesystem_read_*)
              continue
              ;;
          esac
          printf '%s %s\n' "$(wc -c < "${p}" | tr -d ' ')" "${p}"
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

  # Discovery is always mechanical (no LLM, no skill file required).
  if [[ "${AEGIS_MODE}" == "discovery" ]]; then
    declare -f aegis_emit_mechanical_discovery_substrate >/dev/null 2>&1 \
      || aegis_fatal "discovery_mechanical_unavailable"
    substrate_output="$(
      aegis_emit_mechanical_discovery_substrate \
        "${AEGIS_INVESTIGATION_INPUT:-}" \
        "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}"
    )" || substrate_output=""
    [[ -n "${substrate_output}" ]] \
      || aegis_fatal "discovery_mechanical_failed"
    aegis_log "discovery_mechanical: runtime-only (no LLM)"
    AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
    return 0
  fi

  # Optimize mechanical paths (no LLM): after refine, or trivial repair.
  if [[ "${AEGIS_MODE}" == "optimize" ]]; then
    if [[ "${AEGIS_OPTIMIZE_REPAIR_COUNT:-0}" -ge 1 ]]; then
      declare -f aegis_emit_mechanical_optimize_passthrough >/dev/null 2>&1 \
        || aegis_fatal "optimize_passthrough_unavailable"
      substrate_output="$(
        aegis_emit_mechanical_optimize_passthrough \
          "optimize_passthrough_after_refine"
      )" || substrate_output=""
      [[ -n "${substrate_output}" ]] \
        || aegis_fatal "optimize_passthrough_failed"
      aegis_log "optimize_passthrough: after refine (count=${AEGIS_OPTIMIZE_REPAIR_COUNT}) — no LLM"
      if declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
        aegis_record_optimize_metric "passthrough_after_refine" \
          "count=${AEGIS_OPTIMIZE_REPAIR_COUNT}"
      fi
      AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
      return 0
    fi
    # Trivial repair: small clean diff — skip advisory LLM.
    if [[ "${AEGIS_OPTIMIZE_TRIVIAL_SKIP:-true}" != "0" ]] \
      && [[ "${AEGIS_OPTIMIZE_TRIVIAL_SKIP:-true}" != "false" ]] \
      && declare -f aegis_optimize_repair_is_trivial >/dev/null 2>&1 \
      && aegis_optimize_repair_is_trivial \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"; then
      declare -f aegis_emit_mechanical_optimize_passthrough >/dev/null 2>&1 \
        || aegis_fatal "optimize_passthrough_unavailable"
      substrate_output="$(
        aegis_emit_mechanical_optimize_passthrough \
          "optimize_trivial_skip"
      )" || substrate_output=""
      [[ -n "${substrate_output}" ]] \
        || aegis_fatal "optimize_trivial_skip_failed"
      aegis_log "optimize_trivial_skip: repair candidate small/clean — no LLM"
      if declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
        aegis_record_optimize_metric "trivial_skip" "mechanical"
      fi
      AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
      return 0
    fi
  fi

  # Forensics: AEGIS_FORENSICS_USE_LLM set once in main (evidence + substrate).
  # Search omitted on mechanical evidence path; re-materialize on LLM fallthrough.
  if [[ "${AEGIS_MODE}" == "forensics" ]] \
    && declare -f aegis_emit_mechanical_forensics_substrate >/dev/null 2>&1; then
    local _forensics_llm="${AEGIS_FORENSICS_USE_LLM:-}"
    if [[ -z "${_forensics_llm}" ]] \
      && declare -f aegis_forensics_needs_llm >/dev/null 2>&1; then
      if aegis_forensics_needs_llm \
        "${AEGIS_INVESTIGATION_INPUT:-}" \
        "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
        "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}"; then
        _forensics_llm=1
      else
        _forensics_llm=0
      fi
    fi

    if [[ "${_forensics_llm}" != "1" ]]; then
      substrate_output="$(
        aegis_emit_mechanical_forensics_substrate \
          "${AEGIS_INVESTIGATION_INPUT:-}" \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}"
      )" || substrate_output=""
      if [[ -n "${substrate_output}" ]]; then
        aegis_log "forensics_mechanical: skipped LLM+skill (unambiguous anchors)"
        AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
        return 0
      fi
      aegis_warn "forensics_mechanical_failed — falling back to LLM substrate (skill loaded)"
      if declare -f aegis_forensics_ensure_search_symbol_payload >/dev/null 2>&1; then
        aegis_forensics_ensure_search_symbol_payload || true
      fi
    else
      aegis_log "forensics_llm: ambiguity or AEGIS_FORENSICS_LLM force (skill loaded)"
    fi
    unset _forensics_llm
  fi

  case "${AEGIS_EXECUTION_ENGINE}" in

    raw)
      local raw_model="${OPENAI_MODEL_READONLY_COGNITION}"
      if [[ "${AEGIS_MODE}" == "optimize" ]]; then
        raw_model="${OPENAI_MODEL_OPTIMIZE:-${OPENAI_MODEL_READONLY_COGNITION}}"
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

  # Shell variable only — exporting this multi-hundred-KB blob into the
  # environment makes every subsequent fork/exec fail with E2BIG.
  AEGIS_SUBSTRATE_OUTPUT="${substrate_output}"
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
  augment_evidence_profile_from_anchors
  # Decide forensics path once (evidence profile + substrate share the flag).
  # Mechanical path does not consume search_symbol — omit before materialize.
  AEGIS_FORENSICS_USE_LLM=""
  if [[ "${AEGIS_MODE}" == "forensics" ]] \
    && declare -f aegis_forensics_needs_llm >/dev/null 2>&1; then
    if aegis_forensics_needs_llm \
      "${AEGIS_INVESTIGATION_INPUT:-}" \
      "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}"; then
      AEGIS_FORENSICS_USE_LLM=1
      aegis_log "forensics_evidence: keep search_symbol (LLM path)"
    else
      AEGIS_FORENSICS_USE_LLM=0
      local -a _fe_filtered=()
      local _fe
      for _fe in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
        [[ "${_fe}" == "filesystem.search_symbol" ]] && continue
        _fe_filtered+=("${_fe}")
      done
      AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${_fe_filtered[@]}")
      aegis_log "forensics_evidence: omitted search_symbol (mechanical path)"
      unset _fe _fe_filtered
    fi
    export AEGIS_FORENSICS_USE_LLM
  fi

  # Repair with a clear forensics ALVO does not need repo-wide search noise.
  if [[ "${AEGIS_MODE}" == "repair" ]] \
    && declare -f aegis_handover_has_repair_alvo >/dev/null 2>&1 \
    && aegis_handover_has_repair_alvo \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"; then
    local -a _re_filtered=()
    local _re
    for _re in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
      [[ "${_re}" == "filesystem.search_symbol" ]] && continue
      _re_filtered+=("${_re}")
    done
    AEGIS_ACTIVE_EVIDENCE_ENTRIES=("${_re_filtered[@]}")
    aegis_log "repair_evidence: omitted search_symbol (forensics ALVO present)"
    unset _re _re_filtered
  fi

  # Rank so materialize + budget exposure hit anchors/content before noise.
  prioritize_evidence_entries
  prepare_execution_state
  generate_pocket_map
  materialize_capability_environment
  measure "executor_capability_payloads" materialize_capability_payloads
  consume_runtime_owned_capability_manifest
  select_evidence_payloads
  enforce_context_token_budget
  materialize_selected_manifest

  # Adversarial KISS: tools already dirty on mutation files → mechanical
  # challenged findings (no LLM). Reused repair stamps feed the gate.
  if [[ "${AEGIS_MODE}" == "adversarial" ]] \
    && declare -f build_tribunal_tools_gate >/dev/null 2>&1 \
    && declare -f aegis_emit_mechanical_adversarial_from_tools_gate >/dev/null 2>&1; then
    local _adv_files _adv_gate _adv_clean _adv_out
    _adv_files="$(
      jq -c '
        .artifact_snapshot as $s
        | (
            if $s.mode == "optimize" then $s.operational_context.candidate_result.files_changed
            else $s.operational_context.files_changed
                  // $s.operational_context.candidate_result.files_changed
            end
          ) // []
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}" 2>/dev/null \
        || printf '[]'
    )"
    _adv_gate="$(build_tribunal_tools_gate "${_adv_files}")"
    _adv_clean="$(
      printf '%s' "${_adv_gate}" | jq -r '.mutation_clean // true' 2>/dev/null || printf 'true'
    )"
    if [[ "${_adv_clean}" == "false" ]]; then
      _adv_out="$(
        aegis_emit_mechanical_adversarial_from_tools_gate "${_adv_gate}"
      )" || _adv_out=""
      if [[ -n "${_adv_out}" ]]; then
        aegis_log "adversarial_mechanical: tools dirty — skip LLM (reuse stamp when hash matched)"
        AEGIS_SUBSTRATE_OUTPUT="${_adv_out}"
        if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
          jq -cn '{kind:"adversarial",result:"mechanical_tools_challenged"}' \
            >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
        fi
        measure "executor_artifact_validation" validate_artifact
        emit_output
        return 0
      fi
    fi
    unset _adv_files _adv_gate _adv_clean _adv_out
  fi

  measure "executor_execute_substrate" execute_substrate

  # Normalize substrate output first, so validate_artifact validates the corrected/enveloped JSON
  normalize_substrate_output

  case "${AEGIS_EXECUTION_ENGINE}" in
    aider) measure "executor_artifact_validation" validate_mutation_artifact ;;
    *)     measure "executor_artifact_validation" validate_artifact           ;;
  esac

  # Optimize LLM path: record final enrich status (mechanical paths record earlier).
  if [[ "${AEGIS_MODE}" == "optimize" ]] \
    && declare -f aegis_record_optimize_metric >/dev/null 2>&1; then
    local _opt_status _opt_basis
    _opt_status="$(
      printf '%s' "${AEGIS_SUBSTRATE_OUTPUT:-}" \
        | sed -n "/${AEGIS_ARTIFACT_BEGIN_MARKER}/,/${AEGIS_ARTIFACT_END_MARKER}/p" \
        | sed -e "1d" -e "\$d" \
        | jq -r '.status // empty' 2>/dev/null || true
    )"
    _opt_basis="$(
      printf '%s' "${AEGIS_SUBSTRATE_OUTPUT:-}" \
        | sed -n "/${AEGIS_ARTIFACT_BEGIN_MARKER}/,/${AEGIS_ARTIFACT_END_MARKER}/p" \
        | sed -e "1d" -e "\$d" \
        | jq -r '.basis // empty' 2>/dev/null || true
    )"
    case "${_opt_status}" in
      can_improve|no_improvement_needed)
        # Avoid double-count mechanical bases already recorded.
        if [[ "${_opt_basis}" != "optimize_passthrough_after_refine" \
          && "${_opt_basis}" != "optimize_trivial_skip" ]]; then
          aegis_record_optimize_metric "${_opt_status}" "${_opt_basis:0:120}"
        fi
        ;;
    esac
    unset _opt_status _opt_basis
  fi

  emit_output
}

main "$@"
