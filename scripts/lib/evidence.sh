#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EVIDENCE MATERIALIZATION (source-only)
# =========================================================
#
# Capability payload materialization, intra-pipeline cache,
# pocket map, and attention zoom. Sourced by execute_mode.sh.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] evidence_lib_not_invocable" >&2
  exit 1
fi

# =========================================================
# CAPABILITY PAYLOADS
# =========================================================

# Stable cache key for deterministic, mode-stable evidence payloads.
# Includes investigation input so Layer 0 / attention_seed never leak
# across unrelated pipeline demands.
evidence_cache_key() {
  local capability="$1"
  local capability_argument="$2"
  local seed
  seed="$(
    printf '%s\0%s\0%s\0%s' \
      "${capability}" \
      "${capability_argument}" \
      "${AEGIS_INVESTIGATION_INPUT:-}" \
      "${AEGIS_EVIDENCE_TARGET_PATH:-.}" \
      | shasum -a 256 2>/dev/null \
      | awk '{print $1}'
  )"
  # Fallback when shasum is unavailable: compact printable token.
  if [[ -z "${seed}" ]]; then
    seed="$(printf '%s' "${capability}_${capability_argument}" | tr -c 'A-Za-z0-9._-' '_')"
  fi
  printf '%s' "${seed}"
}

capability_is_cacheable() {
  local capability="$1"
  local entry
  for entry in "${AEGIS_CACHEABLE_CAPABILITIES[@]:-}"; do
    [[ "${entry}" == "${capability}" ]] && return 0
  done
  return 1
}

# Late materialize of filesystem.search_symbol for forensics LLM fallthrough
# when the mechanical evidence path omitted it. Writes payload + appends to
# AEGIS_SELECTED_CAPABILITY_PAYLOADS when present.
aegis_forensics_ensure_search_symbol_payload() {
  local payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"
  local payload_path handler query payload_output selected

  [[ -n "${payload_dir}" ]] || return 1
  payload_path="${payload_dir}/filesystem_search_symbol.json"
  if [[ -f "${payload_path}" ]] && jq empty "${payload_path}" >/dev/null 2>&1; then
    return 0
  fi

  handler="${AEGIS_CAPABILITY_HANDLERS[filesystem.search_symbol]:-}"
  [[ -f "${handler}" ]] || return 1

  if declare -f aegis_export_search_symbol_pathspecs >/dev/null 2>&1; then
    aegis_export_search_symbol_pathspecs \
      "${AEGIS_INVESTIGATION_INPUT:-}" \
      "${payload_dir}" \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  fi

  if declare -f resolve_capability_argument >/dev/null 2>&1; then
    query="$(resolve_capability_argument "filesystem.search_symbol" "")"
  elif declare -f aegis_demand_search_query >/dev/null 2>&1; then
    query="$(aegis_demand_search_query "${AEGIS_INVESTIGATION_INPUT:-}" "AEGIS")"
  else
    query="AEGIS"
  fi

  if declare -f invoke_capability_handler >/dev/null 2>&1; then
    payload_output="$(invoke_capability_handler "${handler}" "${query}")" || return 1
  else
    payload_output="$(
      AEGIS_SEARCH_SYMBOL_PATHSPECS="${AEGIS_SEARCH_SYMBOL_PATHSPECS:-}" \
        bash "${handler}" "${query}"
    )" || return 1
  fi

  printf '%s\n' "${payload_output}" > "${payload_path}"
  jq empty "${payload_path}" >/dev/null 2>&1 || return 1

  if [[ -n "${AEGIS_SELECTED_CAPABILITY_PAYLOADS:-}" ]]; then
    selected="$(
      printf '%s' "${AEGIS_SELECTED_CAPABILITY_PAYLOADS}" \
        | jq -c --arg p "${payload_path}" \
          'if (map(select(. == $p)) | length) > 0 then . else . + [$p] end' \
          2>/dev/null || true
    )"
    if [[ -n "${selected}" ]]; then
      export AEGIS_SELECTED_CAPABILITY_PAYLOADS="${selected}"
    fi
  fi

  aegis_log "forensics_evidence: late search_symbol for LLM fallthrough"
  return 0
}

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
  local cache_hit=0
  local cache_path=""

  # Dynamic Attention Zoom scope for this execution (advanced modes).
  local attention_targets_json="[]"
  if mode_uses_attention_zoom; then
    attention_targets_json="$(resolve_attention_targets_json)"
  fi

  if [[ "${AEGIS_EVIDENCE_CACHE_ENABLED:-true}" == "true" ]]; then
    mkdir -p "${AEGIS_EVIDENCE_CACHE_DIR:-.harness/runtime/evidence_cache}" \
      || aegis_warn "evidence_cache_dir_unavailable"
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
    cache_hit=0
    cache_path=""

    # Intra-pipeline cache: skip re-running deterministic Layer 0 work.
    if [[ "${AEGIS_EVIDENCE_CACHE_ENABLED:-true}" == "true" ]] \
      && capability_is_cacheable "${capability}" \
      && [[ -d "${AEGIS_EVIDENCE_CACHE_DIR:-}" ]]; then
      cache_path="${AEGIS_EVIDENCE_CACHE_DIR}/$(evidence_cache_key "${capability}" "${capability_argument}").json"
      if [[ -f "${cache_path}" ]] && jq empty "${cache_path}" >/dev/null 2>&1; then
        # Rewrite execution identity so the payload contract matches this
        # mode run (cache body is deterministic; identity is per-execution).
        if jq \
          --arg execution_id "${AEGIS_EXECUTION_ID}" \
          --arg generated_at "${AEGIS_EXECUTION_TIMESTAMP}" \
          '.execution_id = $execution_id | .generated_at = $generated_at' \
          "${cache_path}" > "${payload_path}"; then
          cache_hit=1
          aegis_log "evidence_cache_hit: ${capability}"
        else
          rm -f "${payload_path}" 2>/dev/null || true
        fi
      fi
    fi

    if [[ "${cache_hit}" -eq 0 ]]; then
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
        # Scope search_symbol to mechanical attention targets (not whole tree).
        if [[ "${capability}" == "filesystem.search_symbol" ]] \
          && declare -f aegis_export_search_symbol_pathspecs >/dev/null 2>&1; then
          aegis_export_search_symbol_pathspecs \
            "${AEGIS_INVESTIGATION_INPUT:-}" \
            "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
            "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
          if [[ -n "${AEGIS_SEARCH_SYMBOL_PATHSPECS:-}" ]]; then
            aegis_log "search_symbol_pathspecs: $(
              printf '%s' "${AEGIS_SEARCH_SYMBOL_PATHSPECS}" | tr '\n' ' '
            )"
          fi
        fi
        payload_output="$(
          invoke_capability_handler \
            "${handler}" \
            "${capability_argument}"
        )"
      fi

      printf '%s\n' "${payload_output}" > "${payload_path}"
    fi

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

    # Store only post-validation, post-zoom payloads so consumers match.
    if [[ "${cache_hit}" -eq 0 ]] \
      && [[ -n "${cache_path}" ]] \
      && capability_is_cacheable "${capability}"; then
      cp "${payload_path}" "${cache_path}" 2>/dev/null \
        || aegis_warn "evidence_cache_store_failed: ${capability}"
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

# Marker line written at the head of a focused pocket map so substrates
# can label the prompt section without an extra env-var surface.
readonly AEGIS_POCKET_MAP_FOCUSED_MARKER="# attention-focused — full path census omitted"

generate_pocket_map() {

  local map_file="${AEGIS_CAPABILITY_ENV_DIR}/pocket_map.txt"
  local attention_targets_json="[]"
  local target_count=0

  # When a downstream mode already carries explicit attention targets,
  # the full flat path census is noise: collapse the pocket map to those
  # targets only. Discovery (and any mode without registered attention)
  # keeps the baseline census.
  if mode_uses_attention_zoom; then
    attention_targets_json="$(resolve_attention_targets_json)"
    target_count="$(
      printf '%s' "${attention_targets_json}" | jq 'length'
    )"
  fi

  if [[ "${target_count}" -gt 0 ]]; then
    {
      printf '%s\n' "${AEGIS_POCKET_MAP_FOCUSED_MARKER}"
      printf '%s' "${attention_targets_json}" \
        | jq -r '.[]?' \
        | sort -u
    } > "${map_file}"

    export AEGIS_POCKET_MAP_FILE="${map_file}"
    aegis_log "Pocket map: focused on ${target_count} attention target(s) (full census omitted)"
    return 0
  fi

  local prune_expr=""
  local prune_path
  for prune_path in "${AEGIS_FILESYSTEM_PRUNE_PATHS[@]:-}"; do
    [[ -n "${prune_path}" ]] || continue
    prune_expr+="^${prune_path}/|"
  done
  prune_expr="${prune_expr%|}"

  # When an evidence target directory is set (default: src), the census
  # should describe the system under investigation — not the harness tree.
  local target_prefix="${AEGIS_EVIDENCE_TARGET_PATH:-.}"
  target_prefix="${target_prefix#./}"
  target_prefix="${target_prefix%/}"

  git ls-files 2>/dev/null \
    | { if [[ -n "${prune_expr}" ]]; then grep -Ev "${prune_expr}"; else cat; fi } \
    | {
        if [[ -n "${target_prefix}" && "${target_prefix}" != "." ]]; then
          grep -E "^(${target_prefix}|${target_prefix}/)" || true
        else
          cat
        fi
      } \
    | head -n "${AEGIS_POCKET_MAP_MAX_LINES}" \
    > "${map_file}" || true

  export AEGIS_POCKET_MAP_FILE="${map_file}"

  if [[ -n "${target_prefix}" && "${target_prefix}" != "." ]]; then
    aegis_log "Pocket map: $(wc -l < "${map_file}" | tr -d ' ') paths (target=${target_prefix})"
  else
    aegis_log "Pocket map: $(wc -l < "${map_file}" | tr -d ' ') paths (full census)"
  fi
}

mode_uses_attention_zoom() {
  case "${AEGIS_MODE}" in
    forensics|repair|optimize|adversarial|validation) return 0 ;;
    *) return 1 ;;
  esac
}

capability_is_deep_payload() {
  case "$1" in
    filesystem.list_tree) return 0 ;;
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
