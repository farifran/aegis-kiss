#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

backup_epistemic_handover
start_mock_curl_provider

mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

jq -n '
  {
    artifact_snapshot: {
      mode: "optimize",
      operational_context: {
        candidate_result: {
          source_mode: "optimize",
          diff: "diff --git a/src/index.ts b/src/index.ts",
          files_changed: ["src/index.ts"]
        }
      },
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
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh adversarial
)"

artifact="$(extract_first_artifact_payload "${output}")"

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
    (.payload.content | fromjson).artifact_snapshot.operational_context.candidate_result.files_changed
    == ["src/index.ts"]
  )
' "${AEGIS_CAPABILITY_PAYLOAD_DIR}/filesystem_read_epistemic_handover.json" \
  >/dev/null \
  || fail "optimize_candidate_was_not_exposed_to_adversarial"

echo "[PASS] Optimize to Adversarial contract"
