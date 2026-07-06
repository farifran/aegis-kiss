#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

executor_fatal() {
  fail "$*"
}

readonly TMP_HANDOVER_FILE="$(mktemp)"

test_cleanup_extra() {
  rm -f "${TMP_HANDOVER_FILE}" >/dev/null 2>&1 || true
}

jq -n '{
  artifact_snapshot: {
    operational_context: {
      required_evidence: [
        "filesystem.read:src/index.ts",
        "filesystem.read:src/index.ts",
        "filesystem.read:src/ui/index.ts"
      ],
      next_attention_targets: [
        "filesystem.read:src/should-not-promote.ts"
      ],
      investigation_scope: {
        scope_targets: [
          "src/also-should-not-promote.ts"
        ]
      },
      recommended_next_actions: [
        "filesystem.read:src/nope.ts"
      ]
    }
  },
  epistemic_state: {
    next_attention_targets: [
      "filesystem.read:src/not-from-epistemic-state.ts"
    ]
  }
}' > "${TMP_HANDOVER_FILE}"

export AEGIS_MODE="forensics"
export AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${TMP_HANDOVER_FILE}"

source <(
  sed -n \
    '/^resolve_evidence_profile()/,/^# EXECUTION STATE/p' \
    scripts/execute_mode.sh
)

resolve_evidence_profile
augment_evidence_profile_from_handover

actual="$(
  printf '%s\n' "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" \
    | jq -R . \
    | jq -s -c '.'
)"

expected="$(
  jq -n -c '[
    "filesystem.search_symbol",
    "git.status",
    "filesystem.read:epistemic_handover",
    "filesystem.read:src/index.ts",
    "filesystem.read:src/ui/index.ts"
  ]'
)"

[[ "${actual}" == "${expected}" ]] \
  || fail "unexpected_augmented_evidence_entries: ${actual}"

echo "[AEGIS][TEST] required evidence augmentation passed"
