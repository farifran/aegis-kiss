#!/usr/bin/env bash
# Source-only — system prompt + request assembly (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_prompt_lib_not_invocable" >&2
  exit 1
fi

raw_mode_minimal_artifact_instructions() {
  case "${AEGIS_MODE}" in
    forensics)
      printf '%s' "MINIMAL FORENSICS ARTIFACT: emit ONLY {\"status\": \"interpreted|inconclusive\", \"repair_candidates\": [{\"id\": \"<file>\", \"reason\": \"<3-6 words>\"}]}. When status is 'inconclusive', repair_candidates MUST be []. When status is 'interpreted', default to ONE candidate (Alvo Único) from active topology evidence — UNLESS the investigation input explicitly names multiple paths (e.g. create src/feature/widget.ts AND re-export from src/index.ts), in which case emit one candidate per named path (net-new first). A net-new path is valid ONLY when the investigation input names that exact path — never invent or copy example paths. Interpret only the evidence Discovery provided. The runtime injects mode, evidence identity, and attention routing — do NOT emit them."
      ;;
    discovery)
      printf '%s' "MINIMAL DISCOVERY ARTIFACT: emit ONLY {\"observations\": [\"...\"], \"rationale\": \"...\", \"required_evidence\": [\"filesystem.read:<file>\"]}. The subject of every observation is the INVESTIGATION (gaps, priorities, next evidence), never the system under investigation: no counts/metrics repetition, no architectural role labels (orchestrator/controller/gateway), no semantic domain inference, no risk assessment, no inferring module function from topology position. The runtime injects mode, scope, attention, priorities, and evidence identity — do NOT emit them."
      ;;
    optimize)
      printf '%s' "MINIMAL OPTIMIZE ARTIFACT: emit ONLY {\"status\": \"optimized|unoptimized|no_optimization_needed\", \"notes\": \"...\", \"candidate_result\": {\"diff\": \"...\", \"files_changed\": [\"...\"]}}. The runtime injects mode, evidence_refs, and handover_attention — do NOT emit them."
      ;;
    adversarial)
      printf '%s' "MINIMAL ADVERSARIAL ARTIFACT: emit ONLY {\"status\": \"challenged|verified\", \"findings\": [{\"type\": \"...\", \"severity\": \"...\", \"description\": \"...\", \"supported_by_evidence\": true|false, \"evidence_refs\": [\"...\"]}]}. Set status to 'challenged' ONLY for defects proven by (a) in-scope tool failures on files_changed, or (b) a logic error whose description quotes the EXACT added expression from the candidate diff. If tools pass for mutation files, prefer status 'verified' with findings []. NEVER invent an 'actual implementation' that is not a full +line of the diff. The runtime tribunal will downgrade fabricated quotes. Do NOT emit mode/candidate_result/handover_attention."
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

  # Byte 0 of the stream is the constitutional preamble — static and
  # clean so any serving-side prefix cache (including the hosted
  # provider's automatic layer) reuses the stable prompt head.
  cat > "${TMP_SYSTEM_PROMPT_FILE}" <<EOF
${AEGIS_CONSTITUTIONAL_PREAMBLE:+${AEGIS_CONSTITUTIONAL_PREAMBLE}

}You are executing inside Aegis Harness.

Mode:
${AEGIS_MODE}

Execution model:
- protocol oriented
- bounded cognition
- capability exposure
- runtime governed
- evidence bounded
- selective capability payload exposure only

The runtime provides one operator-defined investigation input.

You must treat that investigation input as the current investigation demand without distinguishing whether it originated from an issue or an informal prompt.

${mode_specific_instructions}

Skill contract:

$(cat "${SKILL_FILE}")

You must:
- consume only runtime-selected evidence
- avoid assumptions
- avoid hidden repository inheritance
- avoid architecture redesign
- emit only JSON
- remain bounded

You must emit the output in this exact format:

${AEGIS_ARTIFACT_BEGIN_MARKER}
{
  "mode": "${AEGIS_MODE}",
  ...
}
${AEGIS_ARTIFACT_END_MARKER}

The payload MUST:
- be a valid JSON object ONLY.
- contain no HTML tags, no XML tags, no markdown block wrappers (do NOT wrap the JSON in triple-backtick code blocks, do NOT use "json" or "<json>" tag wrappers).
- contain no prose, no conversational explanations, no markdown notes.
- have the opening brace '{' of the JSON object immediately on the line after ${AEGIS_ARTIFACT_BEGIN_MARKER}.
- have the closing brace '}' of the JSON object immediately on the line before ${AEGIS_ARTIFACT_END_MARKER}.

The investigation input is provided under the "=== INVESTIGATION INPUT ===" header of the user message. Execution identity is provided under the "=== EXECUTION IDENTITY ===" header of the user message.
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

assemble_bounded_capability_context() {

  # Monotonic token-stacking: segments ordered by decreasing half-life so
  # the KV-cache prefix survives across executions. Stable segments
  # (pocket map, stable manifest) at the head; volatile segments
  # (investigation input, volatile manifest, execution identity) at the
  # tail, appended after the payload loop. The skill contract lives in
  # the system prompt (assemble_system_prompt).
  {
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

    echo "=== SELECTED CAPABILITY MANIFEST ==="
    echo
    cat "${TMP_MANIFEST_FILE}"

    echo
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

    # Per-mode evidence budget — constitutional guard against prompt explosion.
    # Falls back to AEGIS_EVIDENCE_MAX_TOTAL_BYTES if no mode-specific budget.
    case "${AEGIS_MODE}" in
      discovery)  mode_budget="${AEGIS_MAX_DISCOVERY_BYTES:-${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}}" ;;
      forensics)  mode_budget="${AEGIS_MAX_FORENSICS_BYTES:-${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}}" ;;
      *)          mode_budget="${AEGIS_EVIDENCE_MAX_TOTAL_BYTES}" ;;
    esac

    if [[ "${total_bytes}" -ge "${mode_budget}" ]]; then
      {
        echo
        echo "[AEGIS][MODE_EVIDENCE_BUDGET_REACHED:${AEGIS_MODE}:${mode_budget}]"
      } >> "${TMP_CAPABILITY_CONTEXT_FILE}"
      break
    fi

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
    if declare -f aegis_format_demand_anchors_section >/dev/null 2>&1; then
      aegis_format_demand_anchors_section
    fi

    echo "=== INVESTIGATION INPUT ==="
    echo
    printf '%s\n' "${AEGIS_INVESTIGATION_INPUT}"

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

assemble_provider_request() {

  local effective_max_tokens
  effective_max_tokens="$(resolve_raw_max_tokens)"
  aegis_log "raw_substrate_max_tokens[${AEGIS_MODE}]=${effective_max_tokens}"

  local want_json_object=0
  if raw_want_json_object_format; then
    want_json_object=1
  fi
  aegis_log "raw_json_object_format=${want_json_object}"

  jq -n \
    --arg model "${MODEL}" \
    --rawfile system_prompt "${TMP_SYSTEM_PROMPT_FILE}" \
    --rawfile capability_context "${TMP_CAPABILITY_CONTEXT_FILE}" \
    --argjson temperature "${AEGIS_RAW_SUBSTRATE_TEMPERATURE}" \
    --argjson max_tokens "${effective_max_tokens}" \
    --argjson want_json_object "${want_json_object}" \
    '
    {
      model: $model,
      temperature: $temperature,
      max_tokens: $max_tokens,
      messages: [
        {
          role: "system",
          content: $system_prompt
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


