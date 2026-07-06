#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — SHARED MOCK PROVIDER
# =========================================================
#
# Source-only helper. Provides:
#
# - start_mock_provider       — local HTTP mock of the chat completions API
# - start_mock_curl_provider  — PATH-shadowed curl backed by mock_openai_curl.sh
# - stop_mock_provider        — teardown for either variant
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][TEST][FATAL] mock_provider_not_invocable" >&2
  exit 1
fi

readonly AEGIS_MOCK_PROVIDER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_export_mock_provider_env() {
  export OPENAI_API_KEY="aegis-test-key"
  export OPENAI_MODEL_READONLY_COGNITION="aegis-test-model"
  export AEGIS_PROVIDER_CONNECT_TIMEOUT=3
  export AEGIS_PROVIDER_RESPONSE_TIMEOUT=5
  export AEGIS_PROVIDER_MAX_RETRIES=1
  export AEGIS_PROVIDER_RETRY_DELAY=0
}

start_mock_curl_provider() {
  MOCK_CURL_DIR="$(mktemp -d)"

  ln -s \
    "${AEGIS_MOCK_PROVIDER_DIR}/mock_openai_curl.sh" \
    "${MOCK_CURL_DIR}/curl"

  export PATH="${MOCK_CURL_DIR}:${PATH}"
  export OPENAI_API_BASE="local-process://mock-openai"
  _export_mock_provider_env
}

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

  if mode == "adversarial":
    return {
      "next_attention_targets": ["observable_failure_modes"],
      "attention_scope": "bounded falsification",
      "attention_reason": "challenge current result",
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

        if mode == "discovery":
            artifact = {
                "mode": mode,
                "operational_context": {
                    "status": "ok",
                    "summary": f"mock {mode} artifact",
                    "observed_payloads": payload_names,
                    "investigation_scope": {
                        "scope_type": "exploratory",
                        "scope_targets": [],
                        "scope_confidence": "high"
                    },
                    "attention_targets": [],
                    "blocking_conditions": [],
                    "required_evidence": [],
                    "operational_observations": [],
                    "rationale": [],
                    "escalation_reason": None,
                    "recommended_next_actions": [],
                    "evidence_priorities": [],
                    "confidence_drivers": []
                },
                "handover_attention": build_handover_attention(mode),
            }
        else:
            artifact = {
                "mode": mode,
                "status": "ok",
                "summary": f"mock {mode} artifact",
                "observed_payloads": payload_names,
                "handover_attention": build_handover_attention(mode),
            }

        if mode == "forensics":
            artifact.update({
                "status": "inconclusive",
                "evidence": [],
                "interpretations": [],
                "observations": [],
                "unresolved_questions": [],
                "confidence": "low",
                "investigation_hypotheses": [],
                "investigation_risks": [],
                "repair_candidates": [],
                "handover_attention": {
                    "next_attention_targets": [],
                    "attention_scope": "evidence-backed interpretation",
                    "attention_reason": "no evidence-backed repair candidate",
                },
            })

        if mode == "adversarial":
            artifact.update({
                "status": "challenged",
                "candidate_result": {
                    "source_mode": "optimize",
                    "diff": "diff --git a/src/index.ts b/src/index.ts",
                    "files_changed": ["src/index.ts"],
                },
                "findings": [],
                "evidence_refs": ["filesystem.read:epistemic_handover"],
                "handover_attention": {
                    "next_attention_targets": [],
                    "attention_scope": "bounded falsification",
                    "attention_reason": "challenge completed",
                },
            })

        if mode == "validation":
            artifact.update({
                "verdict": "rejected",
                "findings": [],
                "validated_candidate": {
                    "source_mode": "optimize",
                    "diff": "diff --git a/src/index.ts b/src/index.ts",
                    "files_changed": ["src/index.ts"],
                },
                "basis": ["mock validation basis"],
                "handover_attention": {
                    "next_attention_targets": [],
                    "attention_scope": "none",
                    "attention_reason": "validation completed",
                },
            })

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

  export OPENAI_API_BASE="http://127.0.0.1:${MOCK_PROVIDER_PORT}"
  _export_mock_provider_env
}

stop_mock_provider() {
  if [[ -n "${MOCK_PROVIDER_PID:-}" ]]; then
    kill "${MOCK_PROVIDER_PID}" >/dev/null 2>&1 || true
    wait "${MOCK_PROVIDER_PID}" >/dev/null 2>&1 || true
    MOCK_PROVIDER_PID=""
  fi

  rm -f \
    "${MOCK_PROVIDER_PORT_FILE:-}" \
    "${MOCK_PROVIDER_LOG_FILE:-}" \
    >/dev/null 2>&1 || true

  rm -rf "${MOCK_CURL_DIR:-}" >/dev/null 2>&1 || true
}
