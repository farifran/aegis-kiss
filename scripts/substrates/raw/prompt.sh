#!/usr/bin/env bash
# Source-only — system prompt + request assembly (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_prompt_lib_not_invocable" >&2
  exit 1
fi

# Hard one-liners for the LLM substrate only.
# Discovery never reaches raw (runtime-only mechanical). Forensics reaches
# raw only on multi-seed probe tie / force. Detail: .skills/<mode>.md.
raw_mode_minimal_artifact_instructions() {
  case "${AEGIS_MODE}" in
    forensics)
      printf '%s' "MINIMAL FORENSICS (LLM residual only): emit ONLY status + mutation_candidates[{id,reason}]. Prefer ONE anchor path. Reason = demand (tokens or X-to-Y), never invent features/paths. Runtime injects mode/evidence_refs/handover_attention — do NOT emit them. Full contract: skill file."
      ;;
    discovery)
      # Guard if raw is ever invoked by mistake — discovery has no LLM path.
      printf '%s' "DISCOVERY IS RUNTIME-ONLY: do not invent discovery JSON. If you see this prompt, the harness mis-routed; emit {\"observations\":[],\"rationale\":\"runtime_only\",\"required_evidence\":[]}."
      ;;
    optimize)
      printf '%s' "MINIMAL OPTIMIZE (SYSTEMS & RUNTIME PHYSICS, advise only): emit ONLY status+basis+improvements. status=no_improvement_needed|can_improve. Evaluate strictly on: (1) closed-form O(1) math vs loops, (2) zero hot-path GC allocations, (3) reference confinement, (4) arithmetic density. STRICT KISS: no esoteric bit-packing, no factories/frameworks, max 1 surgical change (<=5 lines). can_improve with 1 sharp item: target_files exact from MUTATION RESULT files_changed, change=imperative surgical edit, why_safe=why behavior unchanged. No edits, no diff. Full contract: skill file."
      ;;
    adversarial)
      printf '%s' "MINIMAL ADVERSARIAL (DEVIL'S ADVOCATE, DEPTH: ${AEGIS_ADVERSARIAL_DEPTH:-medium}): emit ONLY status+findings. Act as Devil's Advocate falsifying domain invariants (non-negativity, temporal drift, boundary crashes). STRICT KISS: never propose factories/frameworks/layers; emit minimal surgical 1-line fixes. Challenged only for (a) in-scope tool failures or (b) invariant violations with full +line quote in backticks. Prefer verified+[] when clean. Include target_files+fix (imperative) so Mutation can act. Tools may be reused from mutation stamp — trust TOOLS SUMMARY. No mode/candidate_result/handover_attention. Full contract: skill file."
      ;;
    validation)
      printf '%s' "MINIMAL VALIDATION ARTIFACT: emit ONLY {\"verdict\": \"accepted|rejected\", \"basis\": \"...\"}. Prefer 'accepted' when there are no evidence-supported high/medium findings that survive the candidate-diff quotation gate. Reject only for real blocking findings or in-scope tool failures. Ignore baseline TS errors outside files_changed and ignore adversarial hallucinations. The runtime may override the verdict deterministically. Do NOT emit mode/validated_candidate/findings/handover_attention."
      ;;
    *)
      printf '%s' ""
      ;;
  esac
}

assemble_system_prompt() {

  local mode_specific_instructions
  mode_specific_instructions="$(raw_mode_minimal_artifact_instructions)"

  local target_architecture_section
  target_architecture_section="$(
    aegis_resolve_architecture_section \
      "${AEGIS_EXECUTION_SURFACE_PATH:-}" \
      "${AEGIS_SUBSTRATE_ROOT:-.}"
  )"

  cat > "${TMP_SYSTEM_PROMPT_FILE}" <<EOF
${AEGIS_CONSTITUTIONAL_PREAMBLE:+${AEGIS_CONSTITUTIONAL_PREAMBLE}

}
${target_architecture_section}

[Aegis mode:${AEGIS_MODE}]

${mode_specific_instructions}

Skill contract:
$(cat "${SKILL_FILE}")

You must: consume runtime-selected evidence, avoid assumptions, emit valid JSON between markers only.

Format:
${AEGIS_ARTIFACT_BEGIN_MARKER}
{ ... mode fields ... }
${AEGIS_ARTIFACT_END_MARKER}

Rules: Valid JSON object only between markers. No prose, no markdown code block wrappers.
EOF
}


# =========================================================
# MANIFEST BOUNDING
# =========================================================

assemble_bounded_manifest() {

  # Stable projection: deterministic per (mode, configuration). Emitted
  # high in the prompt so it participates in the KV-cache prefix.
  printf '%s\n' "${CAPABILITY_MANIFEST}" \
    | jq -c \
    '{
      schema_version: .schema_version,
      runtime_model: .runtime_model,
      mode: .mode,
      execution_engine: .execution_engine,
      capability_envelope: .capability_envelope,
      evidence_profile: .evidence_profile,
      evidence_capabilities: .evidence_capabilities,
      capabilities: .capabilities
    }' \
    > "${TMP_MANIFEST_FILE}"

  truncate_file_bytes \
    "${TMP_MANIFEST_FILE}" \
    "${AEGIS_CAPABILITY_MANIFEST_MAX_BYTES}" \
    "${TMP_MANIFEST_FILE}.bounded"

  mv "${TMP_MANIFEST_FILE}.bounded" "${TMP_MANIFEST_FILE}"
}

# =========================================================
# SELECTIVE CAPABILITY PAYLOAD EXPOSURE
# =========================================================

# Boundary between the byte-identical prefix and everything that changes
# per execution. Also the measurement point for the kind:"cache" metric.
readonly AEGIS_LIVE_ZONE_MARKER="=== LIVE ZONE (everything below changes per execution) ==="

# Report the frozen prefix so its stability is measured, not assumed. A
# prefix that is genuinely frozen repeats this hash across executions of
# the same mode; a drifting one shows a new hash every run. Whether the
# provider exploits the stability is server-side and not observable here.
#
# The prefix a provider cache can reuse starts at byte 0 of the SYSTEM
# message, not at byte 0 of the user message. Measuring only the user
# message — as this did — understated the real frozen prefix by roughly
# 3x (306 vs 998 tokens on a forensics run) and made the number
# useless for deciding whether the prompt clears a provider's minimum
# cacheable length. Both segments are reported now, separately and
# summed, because only the sum is comparable against that threshold.
emit_raw_prefix_metric() {
  [[ -n "${AEGIS_METRICS_FILE:-}" ]] || return 0
  [[ -f "${TMP_CAPABILITY_CONTEXT_FILE}" ]] || return 0

  local system_bytes=0 system_hash=""
  if [[ -f "${TMP_SYSTEM_PROMPT_FILE}" ]]; then
    system_bytes="$(wc -c < "${TMP_SYSTEM_PROMPT_FILE}" | tr -d ' ')"
    system_hash="$(aegis_hash_file "${TMP_SYSTEM_PROMPT_FILE}")"
  fi

  local prefix_file prefix_hash prefix_bytes
  prefix_file="$(mktemp)"
  awk -v marker="${AEGIS_LIVE_ZONE_MARKER}" \
    '$0 == marker { exit } { print }' \
    "${TMP_CAPABILITY_CONTEXT_FILE}" > "${prefix_file}"
  prefix_bytes="$(wc -c < "${prefix_file}" | tr -d ' ')"
  prefix_hash="$(aegis_hash_file "${prefix_file}")"
  rm -f "${prefix_file}"

  # What a byte-0 prefix cache actually sees: system message followed by
  # the user-message frozen zone.
  local frozen_prefix_bytes=$((system_bytes + prefix_bytes))

  # rendered_bytes is what the model actually receives; the budgeter upstream
  # only ever saw the capability payload JSON. Formatted sections (candidate
  # diff, tools summary, anchors, investigation input) are assembled here,
  # after pruning, so they are invisible to AEGIS_MAX_CONTEXT_BYTES. Report
  # both so the gap is measurable instead of assumed.
  local rendered_bytes
  rendered_bytes="$(wc -c < "${TMP_CAPABILITY_CONTEXT_FILE}" | tr -d ' ')"

  jq -cn \
    --arg mode "${AEGIS_MODE:-}" \
    --arg prefix_hash "${prefix_hash:0:16}" \
    --arg system_hash "${system_hash:0:16}" \
    --argjson prefix_bytes "${prefix_bytes:-0}" \
    --argjson system_bytes "${system_bytes:-0}" \
    --argjson frozen_prefix_bytes "${frozen_prefix_bytes:-0}" \
    --argjson rendered_bytes "${rendered_bytes:-0}" \
    '{kind:"cache",mode:$mode,substrate:"raw",
      system_hash:$system_hash,system_bytes:$system_bytes,
      prefix_hash:$prefix_hash,prefix_bytes:$prefix_bytes,
      frozen_prefix_bytes:$frozen_prefix_bytes,
      rendered_bytes:$rendered_bytes}' \
    >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
}

assemble_bounded_capability_context() {

  # FROZEN ZONE / LIVE ZONE split.
  #
  # Prefix reuse dies at the first changed byte, so everything above the
  # AEGIS_LIVE_ZONE_MARKER must be byte-identical for a given (mode,
  # configuration) — that is the only part a provider-side prefix cache can
  # ever reuse across executions. The manifest projection qualifies: it is
  # a deterministic function of mode and config.
  #
  # The pocket map does NOT qualify. It switches between full census and
  # attention-focused form depending on the mode (see generate_pocket_map),
  # so keeping it at the head — as this function used to — rewrote the very
  # first bytes on every mode transition and invalidated everything after
  # it. It now lives below the marker, where churn is free.
  {
    echo "=== SELECTED CAPABILITY MANIFEST ==="
    echo
    cat "${TMP_MANIFEST_FILE}"
    echo
    printf '%s\n' "${AEGIS_LIVE_ZONE_MARKER}"
    echo

    if [[ -n "${AEGIS_POCKET_MAP_FILE:-}" ]] && [[ -s "${AEGIS_POCKET_MAP_FILE}" ]]; then
      if head -n 1 "${AEGIS_POCKET_MAP_FILE}" 2>/dev/null \
        | grep -q '^# attention-focused'; then
        echo "=== REPOSITORY POCKET MAP (attention-focused — full census omitted) ==="
      else
        echo "=== REPOSITORY POCKET MAP (flat path census — baseline context) ==="
      fi
      echo
      cat "${AEGIS_POCKET_MAP_FILE}"
      echo
    fi

    echo "=== EXPOSED CAPABILITY PAYLOADS ==="
    echo
    printf 'Exposed capability payload count: %s\n' "${#SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"
    echo
  } > "${TMP_CAPABILITY_CONTEXT_FILE}"

  local payload_count=0
  local payload_path
  local total_bytes

  for payload_path in "${SELECTED_CAPABILITY_PAYLOAD_PATHS[@]}"; do

    [[ -f "${payload_path}" ]] \
      || aegis_fatal "missing_exposed_capability_payload: ${payload_path}"

    [[ "${payload_path}" == "${CAPABILITY_PAYLOAD_DIR}/"* ]] \
      || aegis_fatal "exposed_capability_payload_out_of_scope: ${payload_path}"

    payload_count=$((payload_count + 1))

    if [[ "${payload_count}" -gt "${AEGIS_EVIDENCE_MAX_FILES}" ]]; then
      {
        echo
        echo "[AEGIS][CAPABILITY_PAYLOAD_LIMIT_REACHED]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi

    render_bounded_payload_section \
      "${payload_path}" \
      "${TMP_CAPABILITY_CONTEXT_FILE}"

    echo >> "${TMP_CAPABILITY_CONTEXT_FILE}"

    total_bytes="$(
      wc -c < "${TMP_CAPABILITY_CONTEXT_FILE}"
    )"

    # Rendered backstop on the single context budget (see .harness/config.sh).
    # The budgeter already pruned by priority upstream; this only guards
    # against a rendering blow-up, so one ceiling is enough.
    if [[ "${total_bytes}" -ge "${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" ]]; then
      {
        echo
        echo "[AEGIS][TOTAL_EVIDENCE_BUDGET_REACHED]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi
  done

  # Volatile tail: everything below this line changes per run/request and
  # must never precede the stable segments above.
  {
    echo
    # Mechanical demand projection — before free-text so floor models
    # bind to operator paths / dense tokens / seed without re-parsing prose.
    # Optimize / adversarial: omit anchors (demand closed; falsify candidate only).
    if [[ "${AEGIS_MODE}" != "optimize" && "${AEGIS_MODE}" != "adversarial" ]] \
      && declare -f aegis_format_demand_anchors_section >/dev/null 2>&1; then
      aegis_format_demand_anchors_section
    fi

    # Validation: compact tribunal view from handover (tools already ran upstream).
    if [[ "${AEGIS_MODE}" == "validation" ]] \
      && declare -f aegis_format_tribunal_summary_section >/dev/null 2>&1; then
      aegis_format_tribunal_summary_section
    fi

    # Optimize: Mutation delta + post-mutation file bodies (advise only).
    if [[ "${AEGIS_MODE}" == "optimize" ]]; then
      if declare -f aegis_format_mutation_result_section >/dev/null 2>&1; then
        aegis_format_mutation_result_section \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
      elif declare -f aegis_format_build_result_section >/dev/null 2>&1; then
        aegis_format_build_result_section \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
      fi
      if declare -f aegis_format_mutation_file_bodies_section >/dev/null 2>&1; then
        aegis_format_mutation_file_bodies_section \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}" \
          "${AEGIS_EVIDENCE_TARGET_PATH:-.}"
      elif declare -f aegis_format_build_file_bodies_section >/dev/null 2>&1; then
        aegis_format_build_file_bodies_section \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}" \
          "${AEGIS_EVIDENCE_TARGET_PATH:-.}"
      fi
    fi

    # Adversarial: candidate + mutation-scoped tools summary (reuse stamp when match) + commit record.
    if [[ "${AEGIS_MODE}" == "adversarial" ]]; then
      if declare -f aegis_format_candidate_result_section >/dev/null 2>&1; then
        aegis_format_candidate_result_section \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
      fi
      if declare -f aegis_format_adversarial_tools_summary_section >/dev/null 2>&1; then
        aegis_format_adversarial_tools_summary_section \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
      fi
      if [[ "${AEGIS_ADVERSARIAL_DEPTH:-medium}" != "low" ]] \
        && declare -f aegis_record_digest >/dev/null 2>&1; then
        echo
        echo "=== HISTORICAL MANAGED COMMIT DIGEST (PROTECTED TOKENS) ==="
        echo
        aegis_record_digest "${AEGIS_EVIDENCE_TARGET_PATH:-.}"
      fi
    fi

    if [[ "${AEGIS_MODE}" == "optimize" ]]; then
      echo "=== INVESTIGATION INPUT (closed — already satisfied by Build) ==="
      echo
      echo "Do not re-open or re-implement this demand. Judge BUILD RESULT only."
      echo
      printf '%s\n' "${AEGIS_INVESTIGATION_INPUT}"
    elif [[ "${AEGIS_MODE}" == "adversarial" ]]; then
      echo "=== INVESTIGATION INPUT (context only — falsify CANDIDATE) ==="
      echo
      echo "Do not re-implement the demand. Falsify CANDIDATE RESULT + TOOLS SUMMARY only."
      echo
      printf '%s\n' "${AEGIS_INVESTIGATION_INPUT}"
    else
      echo "=== INVESTIGATION INPUT ==="
      echo
      printf '%s\n' "${AEGIS_INVESTIGATION_INPUT}"
    fi

    echo
    echo "=== MANIFEST EXECUTION METADATA ==="
    echo
    # Volatile identity wrappers projected inline at the tail — no temp
    # file: the stable manifest above is the only bounded artifact.
    printf '%s\n' "${CAPABILITY_MANIFEST}" \
      | jq -c '{generated_at, execution_id, manifest_hash}'

    echo
    echo "=== EXECUTION IDENTITY ==="
    echo
    printf 'Execution identity:\n%s\n' "${AEGIS_EXECUTION_ID}"
    echo
    printf 'Execution timestamp:\n%s\n' "${AEGIS_EXECUTION_TIMESTAMP}"
  } >> "${TMP_CAPABILITY_CONTEXT_FILE}"

  aegis_log "Capability payload evidence size bytes: $(wc -c < "${TMP_CAPABILITY_CONTEXT_FILE}")"

  emit_raw_prefix_metric
}

# =========================================================
# REQUEST ASSEMBLY
# =========================================================

# Per-mode decode budget: short JSON artifacts must not pay the default ceiling.
resolve_raw_max_tokens() {
  : "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS:=4096}"
  local effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS}"
  case "${AEGIS_MODE}" in
    discovery)
      effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_DISCOVERY:-1024}"
      ;;
    forensics)
      effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_FORENSICS:-1024}"
      ;;
    adversarial)
      effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL:-1024}"
      ;;
    validation)
      effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION:-512}"
      ;;
    optimize)
      effective_max_tokens="${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_OPTIMIZE:-768}"
      ;;
  esac
  printf '%s' "${effective_max_tokens}"
}

# Returns 1 when the raw request should include response_format json_object.
raw_want_json_object_format() {
  case "${AEGIS_RAW_JSON_OBJECT_FORMAT:-1}" in
    0|false|no|off) return 1 ;;
  esac
  case "${AEGIS_RAW_JSON_OBJECT_FORMAT_SUPPORTED:-1}" in
    0|false|no|off) return 1 ;;
  esac
  return 0
}

# Returns 0 when raw substrate should format system message with Anthropic cache_control.
raw_want_anthropic_cache_control() {
  case "${AEGIS_RAW_CACHE_CONTROL_SUPPORTED:-1}" in
    0|false|no|off) return 1 ;;
  esac
  case "${AEGIS_PROVIDER_CACHE_CONTROL:-auto}" in
    1|true|yes|on) return 0 ;;
    0|false|no|off) return 1 ;;
  esac
  local base_lower="${OPENAI_API_BASE,,}"
  local model_lower="${MODEL,,}"
  if [[ "${base_lower}" == *anthropic* ]] \
    || [[ "${model_lower}" == *claude* ]] \
    || [[ "${model_lower}" == *anthropic* ]]; then
    return 0
  fi
  return 1
}

assemble_provider_request() {

  local effective_max_tokens
  effective_max_tokens="$(resolve_raw_max_tokens)"
  aegis_log "raw_substrate_max_tokens[${AEGIS_MODE}]=${effective_max_tokens}"

  local want_json_object=0
  if raw_want_json_object_format; then
    want_json_object=1
  fi
  aegis_log "raw_json_object_format=${want_json_object}"

  local want_cache_control=0
  if raw_want_anthropic_cache_control; then
    want_cache_control=1
  fi
  aegis_log "raw_anthropic_cache_control=${want_cache_control}"

  jq -n \
    --arg model "${MODEL}" \
    --rawfile system_prompt "${TMP_SYSTEM_PROMPT_FILE}" \
    --rawfile capability_context "${TMP_CAPABILITY_CONTEXT_FILE}" \
    --argjson temperature "${AEGIS_RAW_SUBSTRATE_TEMPERATURE}" \
    --argjson max_tokens "${effective_max_tokens}" \
    --argjson want_json_object "${want_json_object}" \
    --argjson want_cache_control "${want_cache_control}" \
    '
    {
      model: $model,
      temperature: $temperature,
      max_tokens: $max_tokens,
      messages: [
        {
          role: "system",
          content: (
            if $want_cache_control == 1 then
              [
                {
                  type: "text",
                  text: $system_prompt,
                  cache_control: {type: "ephemeral"}
                }
              ]
            else
              $system_prompt
            end
          )
        },
        {
          role: "user",
          content: $capability_context
        }
      ]
    }
    + (if $want_json_object == 1 then
        {response_format: {type: "json_object"}}
      else
        {}
      end)
    ' > "${TMP_REQUEST_FILE}"

  aegis_log "Request size bytes: $(wc -c < "${TMP_REQUEST_FILE}")"
}


# =========================================================
# PROVIDER EXECUTION
# =========================================================


