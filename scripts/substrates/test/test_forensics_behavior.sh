#!/usr/bin/env bash

set -Eeuo pipefail

readonly AEGIS_TEST_ROOT="$({
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
})"

cd "${AEGIS_TEST_ROOT}"

source ".harness/config.sh"

fail() {
  echo "[AEGIS][TEST][FATAL] $*" >&2
  exit 1
}

readonly TEST_INVESTIGATION_INPUT="forensics behavior investigation"

readonly HANDOOVER_BACKUP_FILE="$(mktemp)"

HAD_EPISTEMIC_HANDOVER_FILE="false"

if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
  cp "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${HANDOOVER_BACKUP_FILE}"
  HAD_EPISTEMIC_HANDOVER_FILE="true"
fi

start_mock_provider() {
  MOCK_PROVIDER_PORT_FILE="$(mktemp)"
  MOCK_PROVIDER_LOG_FILE="$(mktemp)"

  python3 - "${MOCK_PROVIDER_PORT_FILE}" <<'PY' >"${MOCK_PROVIDER_LOG_FILE}" 2>&1 &
import http.server
import json
import re
import socketserver
import sys

PORT_FILE = sys.argv[1]
BEGIN = "AEGIS_ARTIFACT_BEGIN"
END = "AEGIS_ARTIFACT_END"
MODE_PATTERN = re.compile(r'"mode"\s*:\s*"(discovery|forensics|validation|adversarial)"')
SYSTEM_MODE_PATTERN = re.compile(r'Mode:\s*(discovery|forensics|validation|adversarial)')
PAYLOAD_PATTERN = re.compile(r'^--- PAYLOAD: ([^\n]+) ---$', re.MULTILINE)


def build_handover_attention(mode):
  if mode == "discovery":
    return {
      "next_attention_targets": [
        "filesystem.read:epistemic_handover",
        "filesystem.search_symbol",
      ],
      "attention_scope": "runtime-exposed evidence inventory",
      "attention_reason": "initial investigation boundary",
    }

  if mode == "forensics":
    return {
      "next_attention_targets": ["observable_containment_anomalies"],
      "attention_scope": "evidence-backed interpretation",
      "attention_reason": "narrowed from discovery observations",
    }

  return {
    "next_attention_targets": [],
    "attention_scope": "none",
    "attention_reason": "no active attention",
  }


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)
        request = json.loads(raw_body.decode("utf-8") or "{}")

        mode = "discovery"
        payload_names = []

        for message in request.get("messages", []):
            content = message.get("content", "")
            manifest_match = MODE_PATTERN.search(content)
            if manifest_match:
                mode = manifest_match.group(1)
                break

            system_match = SYSTEM_MODE_PATTERN.search(content)
            if system_match:
                mode = system_match.group(1)

        for message in request.get("messages", []):
            payload_names.extend(PAYLOAD_PATTERN.findall(message.get("content", "")))

        artifact = {
            "mode": mode,
            "status": "ok",
            "summary": f"mock {mode} artifact",
            "observed_payloads": payload_names,
          "handover_attention": build_handover_attention(mode),
        }

        response = {
            "choices": [
                {
                    "message": {
                        "content": BEGIN + "\n" + json.dumps(artifact) + "\n" + END
                    }
                }
            ]
        }

        encoded = json.dumps(response).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        return


with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    with open(PORT_FILE, "w", encoding="utf-8") as handle:
        handle.write(str(server.server_address[1]))
    server.serve_forever()
PY

  MOCK_PROVIDER_PID="$!"

  while [[ ! -s "${MOCK_PROVIDER_PORT_FILE}" ]]; do
    kill -0 "${MOCK_PROVIDER_PID}" >/dev/null 2>&1 \
      || fail "mock_provider_failed_to_start"
  done

  MOCK_PROVIDER_PORT="$(cat "${MOCK_PROVIDER_PORT_FILE}")"

  export OPENAI_API_KEY="aegis-test-key"
  export OPENAI_API_BASE="http://127.0.0.1:${MOCK_PROVIDER_PORT}"
  export OPENAI_MODEL_READONLY_COGNITION="aegis-test-model"
  export AEGIS_PROVIDER_CONNECT_TIMEOUT=3
  export AEGIS_PROVIDER_RESPONSE_TIMEOUT=5
  export AEGIS_PROVIDER_MAX_RETRIES=1
  export AEGIS_PROVIDER_RETRY_DELAY=0
}

cleanup() {
  set +e

  if [[ -n "${MOCK_PROVIDER_PID:-}" ]]; then
    kill "${MOCK_PROVIDER_PID}" >/dev/null 2>&1 || true
    wait "${MOCK_PROVIDER_PID}" >/dev/null 2>&1 || true
  fi

  rm -f \
    "${MOCK_PROVIDER_PORT_FILE:-}" \
    "${MOCK_PROVIDER_LOG_FILE:-}" \
    >/dev/null 2>&1 || true

  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  if [[ "${HAD_EPISTEMIC_HANDOVER_FILE}" == "true" ]]; then
    cp "${HANDOOVER_BACKUP_FILE}" "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
      >/dev/null 2>&1 || true
  else
    rm -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
      >/dev/null 2>&1 || true
  fi

  rm -f \
    "${HANDOOVER_BACKUP_FILE:-}" \
    >/dev/null 2>&1 || true

  rm -rf \
    "${AEGIS_CAPABILITY_ENV_DIR}" \
    "${AEGIS_CAPABILITY_PAYLOAD_DIR}" \
    ".harness/execution_surfaces/discovery" \
    ".harness/execution_surfaces/forensics" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

extract_first_artifact_payload() {
  local runtime_output="$1"

  printf '%s\n' "${runtime_output}" | awk '
    $0 == "AEGIS_ARTIFACT_BEGIN" {
      if (seen == 0) {
        seen = 1
        next
      }
    }

    $0 == "AEGIS_ARTIFACT_END" {
      if (seen == 1) {
        exit
      }
    }

    seen == 1 {
      print
    }
  '
}

seed_fake_handover() {
  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  jq -n \
    '{
      artifact_snapshot: {
        mode: "fake",
        status: "stale",
        summary: "old issue",
        observed_payloads: ["stale_payload.json"],
        generated_at: "1970-01-01T00:00:00Z"
      },
      epistemic_state: {
        next_attention_targets: ["old issue"],
        attention_scope: "stale scope",
        attention_reason: "stale attention"
      }
    }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
}

assert_runtime_read_handover_is_empty() {
  local payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json"

  [[ -f "${payload_file}" ]] \
    || fail "missing_runtime_read_handover_payload"

  jq -e '
    .success == true
    and .error == null
    and ((.payload.content | fromjson).artifact_snapshot == null)
    and ((.payload.content | fromjson).epistemic_state.next_attention_targets == [])
    and ((.payload.content | fromjson).epistemic_state.attention_scope == "none")
    and ((.payload.content | fromjson).epistemic_state.attention_reason == "no active attention")
  ' "${payload_file}" >/dev/null \
    || fail "discovery_did_not_start_from_empty_handover"
}

assert_handover_snapshot_matches_artifact() {
  local handover_file="$1"
  local artifact_payload="$2"

  jq -e \
    --argjson expected_artifact_payload "${artifact_payload}" \
    --arg expected_investigation_input "${TEST_INVESTIGATION_INPUT}" \
    '
      type == "object"
      and ((keys | sort) == ["artifact_snapshot", "epistemic_state"])
      and (.artifact_snapshot | type == "object")
      and (.artifact_snapshot.mode == $expected_artifact_payload.mode)
      and (.artifact_snapshot.status == $expected_artifact_payload.status)
      and (.artifact_snapshot.summary == $expected_artifact_payload.summary)
      and (.artifact_snapshot.investigation_input == $expected_investigation_input)
      and (.artifact_snapshot.observed_payloads == $expected_artifact_payload.observed_payloads)
      and (.artifact_snapshot.generated_at | type == "string" and length > 0)
      and ((.artifact_snapshot | has("handover_attention")) == false)
      and (.epistemic_state == $expected_artifact_payload.handover_attention)
    ' "${handover_file}" >/dev/null \
    || fail "unexpected_runtime_handover_state: ${handover_file}"
}

assert_runtime_read_handover_matches_artifact() {
  local artifact_payload="$1"
  local payload_file="${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json"

  [[ -f "${payload_file}" ]] \
    || fail "missing_runtime_read_handover_payload"

  jq -e \
    --argjson expected_artifact_payload "${artifact_payload}" \
    --arg expected_investigation_input "${TEST_INVESTIGATION_INPUT}" \
    '
      .success == true
      and .error == null
      and (((.payload.content | fromjson).artifact_snapshot) | type == "object")
      and (((.payload.content | fromjson).artifact_snapshot).mode == $expected_artifact_payload.mode)
      and (((.payload.content | fromjson).artifact_snapshot).status == $expected_artifact_payload.status)
      and (((.payload.content | fromjson).artifact_snapshot).summary == $expected_artifact_payload.summary)
      and (((.payload.content | fromjson).artifact_snapshot).investigation_input == $expected_investigation_input)
      and (((.payload.content | fromjson).artifact_snapshot).observed_payloads == $expected_artifact_payload.observed_payloads)
      and (((.payload.content | fromjson).artifact_snapshot).generated_at | type == "string" and length > 0)
      and ((((.payload.content | fromjson).artifact_snapshot) | has("handover_attention")) == false)
      and (((.payload.content | fromjson).epistemic_state) == $expected_artifact_payload.handover_attention)
    ' "${payload_file}" >/dev/null \
    || fail "forensics_did_not_consume_discovery_handover"
}

assert_artifact_mode() {
  local artifact_payload="$1"
  local expected_mode="$2"

  jq -e --arg expected_mode "${expected_mode}" '
    .mode == $expected_mode
  ' <<<"${artifact_payload}" >/dev/null \
    || fail "unexpected_artifact_mode: ${expected_mode}"
}

main() {
  local discovery_output
  local discovery_artifact_payload
  local forensics_output
  local forensics_artifact_payload

  start_mock_provider
  seed_fake_handover

  discovery_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh discovery
  })"

  discovery_artifact_payload="$({
    extract_first_artifact_payload "${discovery_output}"
  })"

  [[ -n "${discovery_artifact_payload}" ]] \
    || fail "missing_discovery_artifact"

  assert_artifact_mode "${discovery_artifact_payload}" "discovery"
  assert_runtime_read_handover_is_empty
  assert_handover_snapshot_matches_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${discovery_artifact_payload}"

  if grep -q 'old issue' "${AEGIS_EPISTEMIC_HANDOVER_FILE}"; then
    fail "stale_handover_state_survived_discovery"
  fi

  forensics_output="$({
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
    AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
    bash runtime_aegis.sh forensics
  })"

  forensics_artifact_payload="$({
    extract_first_artifact_payload "${forensics_output}"
  })"

  [[ -n "${forensics_artifact_payload}" ]] \
    || fail "missing_forensics_artifact"

  assert_artifact_mode "${forensics_artifact_payload}" "forensics"
  assert_runtime_read_handover_matches_artifact "${discovery_artifact_payload}"
  assert_handover_snapshot_matches_artifact "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${forensics_artifact_payload}"

  jq -n \
    --argjson discovery_artifact_payload "${discovery_artifact_payload}" \
    --argjson forensics_artifact_payload "${forensics_artifact_payload}" \
    '
      $discovery_artifact_payload.mode == "discovery"
      and $forensics_artifact_payload.mode == "forensics"
      and $discovery_artifact_payload != $forensics_artifact_payload
    ' >/dev/null || fail "forensics_did_not_replace_discovery_snapshot"

  echo "[AEGIS][TEST] forensics behavior passed"
}

main "$@"