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

test_tmp="$(mktemp -d)"
repo="${test_tmp}/repo"
artifact_file="${test_tmp}/validation.json"
handover_backup="${test_tmp}/handover.backup"
mock_curl_dir="${test_tmp}/bin"
had_handover="false"

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

  rm -rf "${test_tmp}"
  rm -rf "${AEGIS_CAPABILITY_ENV_DIR}" "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
}

trap cleanup EXIT

mkdir -p "${repo}/src" "${mock_curl_dir}"
printf 'export {};\n' > "${repo}/src/index.ts"

git -C "${repo}" init -q
git -C "${repo}" add src/index.ts
git -C "${repo}" \
  -c user.name="Aegis Test" \
  -c user.email="aegis-test@example.invalid" \
  commit -qm "test fixture"

printf 'export const soma = (a: number, b: number): number => a + b;\n' \
  > "${repo}/src/index.ts"

diff_content="$(git -C "${repo}" diff HEAD --)"
git -C "${repo}" restore src/index.ts

mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

jq -n \
  --arg diff "${diff_content}" '
  {
    artifact_snapshot: {
      mode: "adversarial",
      candidate_result: {
        source_mode: "optimize",
        diff: $diff,
        files_changed: ["src/index.ts"]
      },
      adversarial_findings: [],
      evidence_refs: ["filesystem.read:epistemic_handover"],
      investigation_input: "adicione uma funcao soma",
      generated_at: "2026-06-13T00:00:00Z"
    },
    epistemic_state: {
      next_attention_targets: [],
      attention_scope: "bounded falsification",
      attention_reason: "challenge completed"
    }
  }
' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

ln -s \
  "${TEST_ROOT}/scripts/substrates/test/mock_openai_curl.sh" \
  "${mock_curl_dir}/curl"

set +e
PATH="${mock_curl_dir}:${PATH}" \
OPENAI_API_KEY="aegis-test-key" \
OPENAI_API_BASE="local-process://mock-openai" \
OPENAI_MODEL_READONLY_COGNITION="aegis-test-model" \
AEGIS_PROVIDER_MAX_RETRIES=1 \
AEGIS_PROVIDER_RETRY_DELAY=0 \
bash runtime_aegis.sh validation >/dev/null
validation_status=$?
set -e

[[ "${validation_status}" -ne 0 ]] \
  || fail "validation_accepted_mismatched_candidate"

jq -n \
  --arg diff "${diff_content}" '
  {
    mode: "validation",
    verdict: "accepted",
    adversarial_findings: [],
    validated_candidate: {
      source_mode: "optimize",
      diff: $diff,
      files_changed: ["src/index.ts"]
    },
    basis: ["candidate passed bounded validation"],
    handover_attention: {
      next_attention_targets: [],
      attention_scope: "none",
      attention_reason: "validation completed"
    }
  }
' > "${artifact_file}"

bash scripts/runtime/promote_validated_candidate.sh \
  "${artifact_file}" "${repo}"

grep -q "export const soma" "${repo}/src/index.ts" \
  || fail "validated_candidate_was_not_promoted"

echo "[PASS] Adversarial to Validation contract and promotion"
