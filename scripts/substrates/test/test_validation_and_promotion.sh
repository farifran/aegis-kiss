#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

test_tmp="$(mktemp -d)"
repo="${test_tmp}/repo"
artifact_file="${test_tmp}/validation.json"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

backup_epistemic_handover
start_mock_curl_provider

mkdir -p "${repo}/src"
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

set +e
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
