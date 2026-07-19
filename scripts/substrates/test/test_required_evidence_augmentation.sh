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

# Include resolve_mode_array + evidence augment helpers (stop before
# resolve_evidence_entry_capability).
source <(
  sed -n \
    '/^resolve_mode_array()/,/^resolve_evidence_entry_capability()/p' \
    scripts/execute_mode.sh \
    | sed '$d'
)

# Keep investigation empty so deterministic anchors do not add extras —
# this test owns only the required_evidence promotion contract.
export AEGIS_INVESTIGATION_INPUT=""

resolve_evidence_profile
augment_evidence_profile_from_handover

actual="$(
  printf '%s\n' "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" \
    | jq -R . \
    | jq -s -c '.'
)"

# Forensics base profile (config) + required_evidence reads from handover.
expected="$(
  jq -n -c '[
    "runtime.demand_anchors",
    "filesystem.read:epistemic_handover",
    "filesystem.search_symbol",
    "filesystem.read:src/index.ts",
    "filesystem.read:src/ui/index.ts"
  ]'
)"

[[ "${actual}" == "${expected}" ]] \
  || fail "unexpected_augmented_evidence_entries: ${actual}"

# required_evidence path still must NOT promote epistemic attention
# (anchors are a separate step; call it and only operator/attention
# source paths may appear — fixture attention is non-path-prefixed
# "filesystem.read:…" which anchors strip and accept if source-like).
# Explicitly assert the operational_context next_attention noise stays out
# of the required_evidence-only pass above (already covered by expected).

echo "[AEGIS][TEST] required evidence augmentation passed"
