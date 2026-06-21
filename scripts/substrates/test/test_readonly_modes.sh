#!/usr/bin/env bash

set -Eeuo pipefail

readonly AEGIS_TEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
)"

cd "${AEGIS_TEST_ROOT}"

fail() {
  echo "[AEGIS][TEST][FATAL] $*" >&2
  exit 1
}

readonly TEST_INVESTIGATION_INPUT="readonly smoke investigation"
readonly DEFAULT_INVESTIGATION_INPUT="Enumerate runtime-exposed evidence and observable system structure."

assert_manifest_contract() {
  local manifest

  manifest="$(
    bash scripts/capabilities/generate_manifest.sh
  )"

  printf '%s\n' "${manifest}" | jq -e '
    (.modes | keys | sort == ["adversarial", "discovery", "forensics", "optimize", "repair", "validation"])
    and ([.modes[].capabilities | length > 0] | all)
    and ([.modes[].evidence_capabilities | length > 0] | all)
    and ([.modes[].capabilities[].capability] | index("topology.read_graph") == null)
    and ([.modes[].evidence_capabilities[]] | index("topology.read_graph") == null)
    and ([.modes[].capabilities[].handler] | index("scripts/capabilities/topology/read_graph.sh") == null)
    and (.modes.discovery.evidence_capabilities == [
      "filesystem.list_tree",
      "filesystem.read",
      "filesystem.extract_responsibilities",
      "structural.builder",
      "runtime.attention_seed"
    ])
    and (.modes.forensics.evidence_capabilities == ["filesystem.search_symbol", "git.status", "filesystem.read"])
    and (.modes.validation.evidence_capabilities == ["filesystem.read"])
    and (.modes.adversarial.evidence_capabilities == ["filesystem.search_symbol", "filesystem.read"])
  ' >/dev/null || fail "invalid_manifest_contract"
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
                "handover_attention": {
                    "next_attention_targets": [],
                    "attention_scope": "none",
                    "attention_reason": "no active attention"
                }
            }
        else:
            artifact = {
                "mode": mode,
                "status": "ok",
                "summary": f"mock {mode} artifact",
                "observed_payloads": payload_names,
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
                "adversarial_findings": [],
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
                "adversarial_findings": [],
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

  rm -rf \
    .harness/runtime/capability_env \
    .harness/runtime/capability_payloads \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

assert_discovery_uses_default_investigation_input() {
  local runtime_log_file
  local status

  runtime_log_file="$(mktemp)"

  set +e
  env -u AEGIS_INVESTIGATION_INPUT \
    bash runtime_aegis.sh discovery >"${runtime_log_file}" 2>&1
  status=$?
  set -e

  if [[ "${status}" -ne 0 ]]; then
    echo "STATUS: ${status}, LOG FILE: ${runtime_log_file}" >&2
    cat "${runtime_log_file}" >&2
    fail "discovery_failed_missing_investigation_input"
  fi

  grep -q "^\[AEGIS\]\[RUNTIME\]$" "${runtime_log_file}" \
    || fail "missing_runtime_default_investigation_prefix"

  grep -q "No investigation input provided\." "${runtime_log_file}" \
    || fail "missing_runtime_default_investigation_notice"

  grep -q "Using default exploratory investigation\." "${runtime_log_file}" \
    || fail "missing_runtime_default_investigation_log"

  jq -e \
    --arg investigation_input "${DEFAULT_INVESTIGATION_INPUT}" \
    '
      .artifact_snapshot.investigation_input == $investigation_input
    ' .harness/runtime/epistemic_handover.json >/dev/null \
    || fail "missing_default_investigation_input_persistence"

  rm -f "${runtime_log_file}"
}

assert_discovery_accepts_informal_cli_investigation_input() {
  local runtime_log_file
  local status
  local cli_investigation_input="Mapear arquitetura do runtime"

  runtime_log_file="$(mktemp)"

  set +e
  env -u AEGIS_INVESTIGATION_INPUT \
    bash runtime_aegis.sh discovery "${cli_investigation_input}" >/dev/null 2>"${runtime_log_file}"
  status=$?
  set -e

  [[ "${status}" -eq 0 ]] \
    || fail "discovery_failed_informal_cli_investigation_input"

  if grep -q "No investigation input provided\." "${runtime_log_file}"; then
    fail "informal_cli_investigation_input_fell_back_to_default"
  fi

  jq -e \
    --arg investigation_input "${cli_investigation_input}" \
    '
      .artifact_snapshot.investigation_input == $investigation_input
    ' .harness/runtime/epistemic_handover.json >/dev/null \
    || fail "missing_informal_cli_investigation_input_persistence"

  rm -f "${runtime_log_file}"
}

assert_discovery_accepts_issue_cli_investigation_input() {
  local runtime_log_file
  local status
  local expected_investigation_input="issue #123"

  runtime_log_file="$(mktemp)"

  set +e
  env -u AEGIS_INVESTIGATION_INPUT \
    bash runtime_aegis.sh discovery --issue 123 >/dev/null 2>"${runtime_log_file}"
  status=$?
  set -e

  [[ "${status}" -eq 0 ]] \
    || fail "discovery_failed_issue_cli_investigation_input"

  if grep -q "No investigation input provided\." "${runtime_log_file}"; then
    fail "issue_cli_investigation_input_fell_back_to_default"
  fi

  jq -e \
    --arg investigation_input "${expected_investigation_input}" \
    '
      .artifact_snapshot.investigation_input == $investigation_input
    ' .harness/runtime/epistemic_handover.json >/dev/null \
    || fail "missing_issue_cli_investigation_input_persistence"

  rm -f "${runtime_log_file}"
}

list_directory_files_json() {
  local directory_path="$1"

  if [[ ! -d "${directory_path}" ]]; then
    jq -n '[]'
    return
  fi

  find "${directory_path}" -maxdepth 1 -type f \
    | sed 's#.*/##' \
    | sort \
    | jq -R . \
    | jq -s '.'
}

seed_required_predecessor() {
  local mode="$1"
  local handover_file=".harness/runtime/epistemic_handover.json"

  mkdir -p "$(dirname "${handover_file}")"

  case "${mode}" in
    adversarial)
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "optimize",
            investigation_input: $investigation_input,
            operational_context: {
              diff: "diff --git a/src/index.ts b/src/index.ts",
              files_changed: ["src/index.ts"]
            }
          },
          epistemic_state: {
            next_attention_targets: ["src/index.ts"],
            attention_scope: "mutation_applied",
            attention_reason: "optimized candidate"
          }
        }
      ' > "${handover_file}"
      ;;
    validation)
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "adversarial",
            investigation_input: $investigation_input,
            operational_context: {
              candidate_result: {
                source_mode: "optimize",
                diff: "diff --git a/src/index.ts b/src/index.ts",
                files_changed: ["src/index.ts"]
              },
              adversarial_findings: [],
              evidence_refs: ["filesystem.read:epistemic_handover"]
            }
          },
          epistemic_state: {
            next_attention_targets: [],
            attention_scope: "bounded falsification",
            attention_reason: "challenge completed"
          }
        }
      ' > "${handover_file}"
      ;;
  esac
}

assert_no_execution_surface_for_mode() {
  local mode="$1"
  local runtime_log_file
  local execution_surface_path=".harness/execution_surfaces/${mode}"

  runtime_log_file="$(mktemp)"

  rm -rf "${execution_surface_path}"
  seed_required_predecessor "${mode}"

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE=false \
  bash runtime_aegis.sh "${mode}" >/dev/null 2>"${runtime_log_file}"

  [[ ! -d "${execution_surface_path}" ]] \
    || fail "unexpected_execution_surface_for_mode: ${mode}"

  grep -q "Skipping disposable execution surface" "${runtime_log_file}" \
    || fail "missing_execution_surface_skip_log_for_mode: ${mode}"

  grep -q "Preparing disposable execution surface" "${runtime_log_file}" \
    && fail "unexpected_execution_surface_preparation_for_mode: ${mode}"

  rm -f "${runtime_log_file}"
}

assert_mode_output() {
  local mode="$1"
  local expected_payloads_json="$2"
  local output
  local artifact

  seed_required_predecessor "${mode}"

  output="$(
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
      bash runtime_aegis.sh "${mode}"
  )"

  artifact="$(
    printf '%s\n' "${output}" | awk '
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
  )"

  [[ -n "${artifact}" ]] || fail "missing_artifact_for_mode: ${mode}"

  if ! printf '%s\n' "${artifact}" | jq -e \
    --arg mode "${mode}" \
    --argjson expected_payloads "${expected_payloads_json}" \
    '
      .mode == $mode
      and (
        if $mode == "discovery" then
          (.operational_context.status == "ok" and .operational_context.observed_payloads == $expected_payloads)
        else
          ((.status == "ok" or .status == "inconclusive" or .status == "challenged") and .observed_payloads == $expected_payloads)
        end
      )
    ' >/dev/null; then
    echo "EXPECTED payloads: ${expected_payloads_json}" >&2
    echo "ACTUAL artifact: ${artifact}" >&2
    fail "unexpected_artifact_for_mode: ${mode}"
  fi
}

assert_materialized_runtime_state() {
  local mode="$1"
  local expected_payloads_json="$2"
  local actual_payloads_json

  rm -rf .harness/runtime/capability_env .harness/runtime/capability_payloads

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh "${mode}" >/dev/null

  actual_payloads_json="$(
    list_directory_files_json .harness/runtime/capability_payloads
  )"

  jq -n \
    --argjson actual_payloads "${actual_payloads_json}" \
    --argjson expected_payloads "${expected_payloads_json}" \
    '
      $actual_payloads == $expected_payloads
    ' >/dev/null || fail "unexpected_materialized_runtime_state: ${mode}"

  rm -rf .harness/runtime/capability_env .harness/runtime/capability_payloads
}

main() {
  assert_manifest_contract
  start_mock_provider
  assert_discovery_uses_default_investigation_input
  assert_discovery_accepts_informal_cli_investigation_input
  assert_discovery_accepts_issue_cli_investigation_input

  assert_mode_output "discovery" '["filesystem_list_tree.json", "filesystem_read_epistemic_handover.json", "filesystem_extract_responsibilities.json", "structural_builder.json", "runtime_attention_seed.json"]'
  assert_mode_output "forensics" '["filesystem_search_symbol.json", "git_status.json", "filesystem_read_epistemic_handover.json"]'
  assert_mode_output "validation" '["filesystem_read_epistemic_handover.json"]'
  assert_mode_output "adversarial" '["filesystem_search_symbol.json", "filesystem_read_epistemic_handover.json"]'

  assert_materialized_runtime_state \
    "discovery" \
    '["filesystem_extract_configuration_structure.json", "filesystem_extract_entrypoints.json", "filesystem_extract_import_graph.json", "filesystem_extract_reference_graph.json", "filesystem_extract_responsibilities.json", "filesystem_extract_symbols.json", "filesystem_extract_test_relationships.json", "filesystem_list_tree.json", "filesystem_read_epistemic_handover.json", "runtime_attention_seed.json", "structural_builder.json"]'

  assert_materialized_runtime_state \
    "forensics" \
    '["filesystem_read_epistemic_handover.json", "filesystem_search_symbol.json", "git_status.json"]'

  assert_no_execution_surface_for_mode "discovery"

  echo "[AEGIS][TEST] readonly smoke suite passed"
}

main "$@"
