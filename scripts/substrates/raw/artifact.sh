#!/usr/bin/env bash
# Source-only — artifact extract + JSON build (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_artifact_lib_not_invocable" >&2
  exit 1
fi

readonly AEGIS_RAW_RECOVER_ARTIFACT_PY="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
)/recover_artifact.py"

extract_provider_content() {
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

normalize_decorated_markers() {
  local begin_rx end_rx
  begin_rx="$(printf '%s' "${AEGIS_ARTIFACT_BEGIN_MARKER}" | sed 's/_/[_ -]/g')"
  end_rx="$(printf '%s' "${AEGIS_ARTIFACT_END_MARKER}" | sed 's/_/[_ -]/g')"

  sed -E \
    -e "s/^[[:space:]#\`*]*${begin_rx}[[:space:]#\`*]*\$/${AEGIS_ARTIFACT_BEGIN_MARKER}/" \
    -e "s/^[[:space:]#\`*]*${end_rx}[[:space:]#\`*]*\$/${AEGIS_ARTIFACT_END_MARKER}/"
}

recover_artifact_json() {
  local provider_content="$1"
  [[ -f "${AEGIS_RAW_RECOVER_ARTIFACT_PY}" ]] || return 1

  printf '%s' "${provider_content}" \
    | BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER}" \
      END_MARKER="${AEGIS_ARTIFACT_END_MARKER}" \
      python3 "${AEGIS_RAW_RECOVER_ARTIFACT_PY}"
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
