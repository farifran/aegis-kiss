#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
)"

cd "${TEST_ROOT}"

source ".harness/config.sh"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

handover_backup="$(mktemp)"
had_handover="false"
mock_curl_dir="$(mktemp -d)"

if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
  cp "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${handover_backup}"
  had_handover="true"
fi

cleanup() {
  set +e

  if [[ "${had_handover}" == "true" ]]; then
    cp "${handover_backup}" "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
  else
    rm -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}"
  fi

  rm -f "${handover_backup}"
  rm -rf "${mock_curl_dir}"
  rm -rf "${AEGIS_CAPABILITY_ENV_DIR}" "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
}

trap cleanup EXIT

ln -s \
  "${TEST_ROOT}/scripts/substrates/test/mock_openai_curl.sh" \
  "${mock_curl_dir}/curl"

mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

jq -n '
  {
    artifact_snapshot: {
      mode: "optimize",
      diff: "diff --git a/src/index.ts b/src/index.ts",
      files_changed: ["src/index.ts"],
      investigation_input: "adicione uma funcao soma",
      generated_at: "2026-06-13T00:00:00Z"
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "mutation_applied",
      attention_reason: "optimized candidate"
    }
  }
' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

output="$(
  PATH="${mock_curl_dir}:${PATH}" \
  OPENAI_API_KEY="aegis-test-key" \
  OPENAI_API_BASE="local-process://mock-openai" \
  OPENAI_MODEL_READONLY_COGNITION="aegis-test-model" \
  AEGIS_PROVIDER_MAX_RETRIES=1 \
  AEGIS_PROVIDER_RETRY_DELAY=0 \
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh adversarial
)"

artifact="$(
  printf '%s\n' "${output}" \
    | sed -n '/AEGIS_ARTIFACT_BEGIN/,/AEGIS_ARTIFACT_END/p' \
    | sed '1d;$d'
)"

printf '%s\n' "${artifact}" \
  | jq -e '
      .mode == "adversarial"
      and .status == "challenged"
      and .candidate_result.source_mode == "optimize"
      and (.candidate_result.diff | length > 0)
      and .candidate_result.files_changed == ["src/index.ts"]
      and (
        .observed_payloads
        | index("filesystem_read_epistemic_handover.json") != null
      )
    ' >/dev/null \
  || fail "adversarial_did_not_consume_optimize_candidate"

jq -e '
  .success == true
  and (
    (.payload.content | fromjson).artifact_snapshot.mode
    == "optimize"
  )
  and (
    (.payload.content | fromjson).artifact_snapshot.files_changed
    == ["src/index.ts"]
  )
' "${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json" \
  >/dev/null \
  || fail "optimize_candidate_was_not_exposed_to_adversarial"

echo "[PASS] Optimize to Adversarial contract"
