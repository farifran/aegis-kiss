#!/usr/bin/env bash
# Source-only — provider HTTP invoke (loaded by raw_llm.sh)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] raw_provider_lib_not_invocable" >&2
  exit 1
fi

# Drop response_format from the staged request and mark the capability
# unsupported for the rest of this process (and any parent that reuses env).
raw_strip_json_object_format() {
  local stripped
  stripped="$(
    jq 'del(.response_format)' "${TMP_REQUEST_FILE}" 2>/dev/null
  )" || return 1
  [[ -n "${stripped}" ]] || return 1
  printf '%s\n' "${stripped}" > "${TMP_REQUEST_FILE}"
  export AEGIS_RAW_JSON_OBJECT_FORMAT_SUPPORTED=0
  return 0
}

request_has_json_object_format() {
  jq -e '.response_format.type == "json_object"' "${TMP_REQUEST_FILE}" \
    >/dev/null 2>&1
}

execute_provider_request() {

  aegis_log "Executing raw cognition substrate..."

  local attempt=1
  local http_code
  local error_message
  local curl_stats
  local t_connect
  local t_starttransfer
  local t_total

  # Empty-body retry state: long non-streaming generations (>70s) can be
  # dropped or truncated by upstream gateways/proxies, yielding HTTP 200
  # with an empty payload. That volatility is transient infrastructure
  # noise, not a protocol failure — re-fire the exact same request up to
  # 3 attempts with progressive backoff before the terminal
  # empty_provider_response fatal is allowed to fire downstream.
  local empty_response_attempt=1
  local empty_response_max_attempts=3
  local empty_response_backoff

  while [[ "${attempt}" -le "${AEGIS_PROVIDER_MAX_RETRIES}" ]]; do

    curl_stats="$(
      curl \
        --silent \
        --show-error \
        --connect-timeout "${AEGIS_PROVIDER_CONNECT_TIMEOUT}" \
        --max-time "${AEGIS_PROVIDER_RESPONSE_TIMEOUT}" \
        --output "${TMP_RESPONSE_FILE}" \
        --write-out "%{http_code} %{time_connect} %{time_starttransfer} %{time_total}" \
        -X POST \
        "${OPENAI_API_BASE}/chat/completions" \
        -H "Authorization: Bearer ${OPENAI_API_KEY}" \
        -H "Content-Type: application/json" \
        --data @"${TMP_REQUEST_FILE}"
    )"

    read -r http_code t_connect t_starttransfer t_total <<< "${curl_stats}"

    t_connect="${t_connect:-0.000000}"
    t_starttransfer="${t_starttransfer:-0.000000}"
    t_total="${t_total:-0.000000}"

    case "${http_code}" in

      200)
        # Non-streaming request: the provider sends the body only after
        # generation finishes, so time_starttransfer ≈ time_total. This is
        # server-side prefill + FULL decode, not true time-to-first-token.
        echo "[AEGIS][TIMING] curl_connect: ${t_connect}s" >&2
        echo "[AEGIS][TIMING] provider_generation (prefill+decode, non-streaming): ${t_starttransfer}s" >&2
        echo "[AEGIS][TIMING] response_complete: ${t_total}s" >&2

        # Empty/whitespace-only body on HTTP 200: transient gateway drop.
        # Re-fire the identical request payload with progressive backoff;
        # after the final attempt, fall through so the deterministic
        # empty_provider_response fatal fires in extract_artifact_payload.
        if [[ -z "$(extract_provider_content | tr -d '[:space:]')" ]]; then
          if [[ "${empty_response_attempt}" -lt "${empty_response_max_attempts}" ]]; then
            if [[ "${empty_response_attempt}" -eq 1 ]]; then
              empty_response_backoff=2
            else
              empty_response_backoff=5
            fi
            echo "[AEGIS][RAW][WARN] Empty provider response detected on attempt ${empty_response_attempt}/${empty_response_max_attempts} — retrying in ${empty_response_backoff}s..." >&2
            empty_response_attempt=$((empty_response_attempt + 1))
            sleep "${empty_response_backoff}"
            continue
          fi
          echo "[AEGIS][RAW][WARN] Empty provider response persisted after ${empty_response_max_attempts}/${empty_response_max_attempts} attempts — surfacing terminal failure" >&2
        fi

        return 0
        ;;

      401|403)
        cat "${TMP_RESPONSE_FILE}" >&2 || true
        aegis_fatal "provider_authentication_failure"
        ;;

      400)
        error_message="$(
          jq -r '
            .error.message
            // .message
            // .error
            // empty
            | if type == "string" then .
              else tostring
              end
          ' "${TMP_RESPONSE_FILE}" 2>/dev/null || true
        )"

        if [[ "${error_message}" == *"maximum context length"* ]]; then
          cat "${TMP_RESPONSE_FILE}" >&2 || true
          aegis_fatal "provider_context_length_exceeded"
        fi

        # Pareto fallback: many local OpenAI-compat servers reject
        # response_format. Strip once and re-fire without burning the
        # provider retry budget on a permanent capability gap.
        if request_has_json_object_format; then
          if raw_strip_json_object_format; then
            echo "[AEGIS][RAW][WARN] provider rejected response_format=json_object — retrying without it (${error_message:-no message})" >&2
            continue
          fi
        fi

        cat "${TMP_RESPONSE_FILE}" >&2 || true
        aegis_fatal "provider_http_failure"
        ;;

      429|500|502|503|504)
        aegis_warn "provider_transient_failure"

        attempt=$((attempt + 1))

        sleep "${AEGIS_PROVIDER_RETRY_DELAY}"
        ;;

      *)
        cat "${TMP_RESPONSE_FILE}" >&2 || true
        aegis_fatal "provider_http_failure"
        ;;

    esac
  done

  aegis_fatal "provider_retry_limit_exceeded"
}

# =========================================================
# RESPONSE EXTRACTION
# =========================================================


