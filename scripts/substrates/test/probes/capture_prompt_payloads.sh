#!/usr/bin/env bash

# =========================================================
# AEGIS PROBE — CAPTURE REAL PROVIDER REQUEST PAYLOADS
# =========================================================
#
# Runs the same demand through the pipeline twice and persists the exact
# request body each run would have sent, using the mock-curl shim — no
# network, no provider cost, no API key.
#
# The captures feed prefix_cache_probe.py, which replays them against a
# provider that reports cache usage. Replaying a captured payload is
# preferable to re-running the pipeline against a paid endpoint: it
# isolates the variable under test and costs cents.
#
#   AEGIS_CAPTURE_OUT=/tmp/caps \
#     bash scripts/substrates/test/probes/capture_prompt_payloads.sh
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/../_test_lib.sh"

CAPTURE_OUT="${AEGIS_CAPTURE_OUT:-${TEST_ROOT}/.harness/runtime/prompt_captures}"
mkdir -p "${CAPTURE_OUT}"
rm -f "${CAPTURE_OUT}"/request_*.json

export AEGIS_REPAIR_FEEDBACK_LOOP="false"
readonly FIXED_INVESTIGATION_INPUT="cache idempotency smoke investigation"

CAPTURE_CURL_DIR="$(mktemp -d)"

# Persist every request body, then delegate to the shared mock provider
# so the runtime completes normally.
cat > "${CAPTURE_CURL_DIR}/curl" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
capture_dir="${CAPTURE_OUT}"
mock_curl="${AEGIS_MOCK_PROVIDER_DIR}/mock_openai_curl.sh"
args=("\$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [[ "\${args[\$i]}" == "--data" ]]; then
    request_file="\${args[\$((i + 1))]#@}"
    cp "\${request_file}" "\${capture_dir}/request_\$(date +%s%N).json"
  fi
done
exec "\${mock_curl}" "\$@"
EOF
chmod +x "${CAPTURE_CURL_DIR}/curl"

export PATH="${CAPTURE_CURL_DIR}:${PATH}"
export OPENAI_API_BASE="local-process://mock-openai"
_export_mock_provider_env

backup_epistemic_handover

test_cleanup_extra() {
  rm -rf "${CAPTURE_CURL_DIR}" >/dev/null 2>&1 || true
}

# Discovery is mechanical (no provider call). Seed it, then force the
# forensics LLM residual so a request body is actually assembled. The
# reseed between runs makes the second forensics a peer of the first
# (same mode entry), not a re-entry on forensics output.
bash runtime_aegis.sh discovery "${FIXED_INVESTIGATION_INPUT}" \
  >/dev/null 2>&1 || fail "seed_discovery_run_failed"

rm -f "${CAPTURE_OUT}"/request_*.json

AEGIS_FORENSICS_LLM=1 bash runtime_aegis.sh forensics \
  >/dev/null 2>&1 || fail "first_forensics_llm_run_failed"

bash runtime_aegis.sh discovery "${FIXED_INVESTIGATION_INPUT}" \
  >/dev/null 2>&1 || fail "reseed_discovery_run_failed"

AEGIS_FORENSICS_LLM=1 bash runtime_aegis.sh forensics \
  >/dev/null 2>&1 || fail "second_forensics_llm_run_failed"

captured_count="$(ls -1 "${CAPTURE_OUT}"/request_*.json 2>/dev/null | wc -l | tr -d ' ')"
[[ "${captured_count}" -ge 2 ]] \
  || fail "expected_two_captured_requests_got_${captured_count}"

echo "[AEGIS][PROBE] captured ${captured_count} request payloads in ${CAPTURE_OUT}"
