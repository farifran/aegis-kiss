#!/usr/bin/env bash
# Source-only — artifact extract + JSON repair (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_artifact_lib_not_invocable" >&2
  exit 1
fi

# Capture absolute helper path at source time — raw_llm later cds into an
# isolated temp workspace, so dirname(BASH_SOURCE) is no longer resolvable
# relative to $PWD during extract_artifact_payload.
readonly AEGIS_RAW_RECOVER_ARTIFACT_PY="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
)/recover_artifact.py"

extract_provider_content() {

  # Prefer message.content. Reasoning-class models on NVIDIA NIM (e.g.
  # stepfun-ai/step-3.7-flash) can exhaust max_tokens in reasoning_content
  # and return an empty content field on large prompts — fall back so the
  # substrate can still extract an artifact when the provider split output.
  jq -r '
    .choices[0].message as $m
    | (
        ($m.content // "")
        | if length > 0 then .
          else ($m.reasoning_content // $m.reasoning // "")
          end
      )
  ' "${TMP_RESPONSE_FILE}"
}

# =========================================================
# ARTIFACT EXTRACTION
# =========================================================

# Probabilistic models decorate the protocol markers with markdown despite
# instructions: '### AEGIS ARTIFACT BEGIN', '`AEGIS_ARTIFACT_END`', fenced
# code blocks around the JSON. Normalize any line that is a decorated
# variant of a marker (leading hashes/backticks/whitespace, '_' rendered as
# space, trailing decoration) back to the literal marker token so the
# deterministic extraction below never dies on cosmetic noise.
normalize_decorated_markers() {

  local begin_rx end_rx
  # '_' in the canonical marker may be rendered as space or hyphen.
  begin_rx="$(printf '%s' "${AEGIS_ARTIFACT_BEGIN_MARKER}" | sed 's/_/[_ -]/g')"
  end_rx="$(printf '%s' "${AEGIS_ARTIFACT_END_MARKER}" | sed 's/_/[_ -]/g')"

  sed -E \
    -e "s/^[[:space:]#\`*]*${begin_rx}[[:space:]#\`*]*\$/${AEGIS_ARTIFACT_BEGIN_MARKER}/" \
    -e "s/^[[:space:]#\`*]*${end_rx}[[:space:]#\`*]*\$/${AEGIS_ARTIFACT_END_MARKER}/"
}

# Multi-strategy JSON recovery (see recover_artifact.py).
# Prints one compact JSON object on stdout; exit 0 on success, 1 on failure.
recover_artifact_json() {
  local provider_content="$1"
  [[ -f "${AEGIS_RAW_RECOVER_ARTIFACT_PY}" ]] || return 1

  printf '%s' "${provider_content}" \
    | BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
      END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
      python3 "${AEGIS_RAW_RECOVER_ARTIFACT_PY}"
}

# Pull body between markers or first/last brace object from provider content.
# Prefer recover_artifact_json; this remains a thin fallback/debug helper.
slice_artifact_json_body() {
  local provider_content="$1"
  local recovered=""

  if recovered="$(recover_artifact_json "${provider_content}" 2>/dev/null)"; then
    printf '%s\n' "${recovered}"
    return 0
  fi

  local has_markers=true
  if [[ "${provider_content}" != *"${AEGIS_ARTIFACT_BEGIN_MARKER}"* ]] \
    || [[ "${provider_content}" != *"${AEGIS_ARTIFACT_END_MARKER}"* ]]; then
    has_markers=false
  fi

  local artifact_payload=""
  if [[ "${has_markers}" == "true" ]]; then
    artifact_payload="${provider_content#*"${AEGIS_ARTIFACT_BEGIN_MARKER}"}"
    artifact_payload="${artifact_payload%%"${AEGIS_ARTIFACT_END_MARKER}"*}"
  else
    local first_brace last_brace
    first_brace="$(echo "${provider_content}" | grep -n "{" | head -n 1 | cut -d: -f1)"
    last_brace="$(echo "${provider_content}" | grep -n "}" | tail -n 1 | cut -d: -f1)"
    if [[ -n "${first_brace}" ]] && [[ -n "${last_brace}" ]] && [[ "${first_brace}" -le "${last_brace}" ]]; then
      artifact_payload="$(echo "${provider_content}" | sed -n "${first_brace},${last_brace}p")"
    else
      echo "[DEBUG] Raw LLM content (markers and JSON braces missing):" >&2
      echo "${provider_content}" >&2
      aegis_fatal "missing_artifact_markers"
    fi
  fi

  printf '%s\n' "${artifact_payload}" \
    | sed -E '/^[[:space:]]*`{3,}[a-zA-Z]*[[:space:]]*$/d'
}

extract_artifact_payload() {

  local provider_content
  provider_content="$(
    extract_provider_content | normalize_decorated_markers
  )"

  [[ -n "${provider_content}" ]] \
    || aegis_fatal "empty_provider_response"

  local artifact_payload=""
  if ! artifact_payload="$(recover_artifact_json "${provider_content}")"; then
    echo "[DEBUG] Failed to parse artifact JSON. Raw provider content:" >&2
    echo "${provider_content}" >&2
    aegis_fatal "artifact_not_json"
  fi

  if ! echo "${artifact_payload}" | jq empty >/dev/null 2>&1; then
    echo "[DEBUG] recover_artifact_json returned non-JSON:" >&2
    echo "${artifact_payload}" >&2
    aegis_fatal "artifact_not_json"
  fi

  # Compact single-line object for downstream envelope stability.
  artifact_payload="$(echo "${artifact_payload}" | jq -c '.')"

  echo "${AEGIS_ARTIFACT_BEGIN_MARKER}"
  echo "${artifact_payload}"
  echo "${AEGIS_ARTIFACT_END_MARKER}"
}
