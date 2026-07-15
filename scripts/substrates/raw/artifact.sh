#!/usr/bin/env bash
# Source-only — artifact extract + JSON repair (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_artifact_lib_not_invocable" >&2
  exit 1
fi

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

# Repair common LLM JSON slips (missing key quotes, truncated braces).
# Prints repaired JSON on success, original on failure.
repair_llm_json_payload() {
  local artifact_payload="$1"
  python3 - <<'PY' "${artifact_payload}"
import sys
import json
import re

raw = sys.argv[1]
fixed = re.sub(r'\"([a-zA-Z0-9_]+)(?<!\"):\s*\"', r'"\1": "', raw)
fixed = re.sub(r'\"([a-zA-Z0-9_]+)\s*:\s*\"', r'"\1": "', fixed)

try:
    parsed = json.loads(fixed)
    print(json.dumps(parsed))
    sys.exit(0)
except Exception:
    pass

stack = []
in_str = False
escape_next = False
for ch in fixed:
    if escape_next:
        escape_next = False
        continue
    if ch == '\\':
        escape_next = True
        continue
    if ch == '"':
        in_str = not in_str
        continue
    if in_str:
        continue
    if ch in ('{', '['):
        stack.append(ch)
    elif ch == '}':
        if stack and stack[-1] == '{':
            stack.pop()
    elif ch == ']':
        if stack and stack[-1] == '[':
            stack.pop()

closers = {'[': ']', '{': '}'}
truncation_suffix = ''.join(closers[c] for c in reversed(stack))
if truncation_suffix:
    candidate = fixed.rstrip().rstrip(',') + '\n' + truncation_suffix
    try:
        parsed = json.loads(candidate)
        print(json.dumps(parsed))
        sys.exit(0)
    except Exception:
        pass

print(raw)
PY
}

# Pull body between markers or first/last brace object from provider content.
slice_artifact_json_body() {
  local provider_content="$1"
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

  local artifact_payload
  artifact_payload="$(slice_artifact_json_body "${provider_content}")"

  [[ -n "${artifact_payload//[[:space:]]/}" ]] \
    || aegis_fatal "empty_artifact_payload"

  if ! echo "${artifact_payload}" | jq empty >/dev/null 2>&1; then
    local repaired_payload
    repaired_payload="$(repair_llm_json_payload "${artifact_payload}")"
    if echo "${repaired_payload}" | jq empty >/dev/null 2>&1; then
      artifact_payload="${repaired_payload}"
    else
      echo "[DEBUG] Failed to parse artifact JSON. Raw payload:" >&2
      echo "${artifact_payload}" >&2
      aegis_fatal "artifact_not_json"
    fi
  fi

  echo "${AEGIS_ARTIFACT_BEGIN_MARKER}"
  echo "${artifact_payload}"
  echo "${AEGIS_ARTIFACT_END_MARKER}"
}


