#!/usr/bin/env bash

# =========================================================
# Deterministic filesystem.read anchors (operator + attention)
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"

readonly TMP_HANDOVER_FILE="$(mktemp)"

test_cleanup_extra() {
  rm -f "${TMP_HANDOVER_FILE}" >/dev/null 2>&1 || true
}

jq -n '{
  artifact_snapshot: {
    operational_context: {
      required_evidence: [
        "filesystem.read:src/ui/fake_import.ts"
      ]
    }
  },
  epistemic_state: {
    next_attention_targets: [
      "src/index.ts",
      "filesystem.read:src/index.ts",
      "not-a-source-file.md",
      "README"
    ],
    attention_scope: "test",
    attention_reason: "anchor fixture"
  }
}' > "${TMP_HANDOVER_FILE}"

export AEGIS_MODE="forensics"
export AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${TMP_HANDOVER_FILE}"
export AEGIS_INVESTIGATION_INPUT="create src/feature/widget.ts and re-export from src/index.ts"
export AEGIS_DETERMINISTIC_READ_MAX=8

# Pull only the profile helpers from execute_mode (same pattern as
# test_required_evidence_augmentation.sh).
source <(
  sed -n \
    '/^resolve_mode_array()/,/^resolve_evidence_entry_capability()/p' \
    scripts/execute_mode.sh \
    | sed '$d'
)

# Ensure config-backed maps resolve.
resolve_evidence_profile
augment_evidence_profile_from_handover
augment_evidence_profile_from_anchors

actual="$(
  printf '%s\n' "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" \
    | jq -R . \
    | jq -s -c 'sort'
)"

# Base profile + required_evidence + operator paths + attention (deduped).
# src/index.ts appears in investigation + attention → one entry.
# src/feature/widget.ts is operator-named net-new.
# src/ui/fake_import.ts from required_evidence.
# Forensics base profile: demand_anchors + read + search_symbol (no git.status).
# Anchors append operator/attention/required filesystem.read entries.
for must in \
  "runtime.demand_anchors" \
  "filesystem.search_symbol" \
  "filesystem.read:epistemic_handover" \
  "filesystem.read:src/ui/fake_import.ts" \
  "filesystem.read:src/index.ts" \
  "filesystem.read:src/feature/widget.ts"
do
  printf '%s' "${actual}" | jq -e --arg e "${must}" 'index($e) != null' >/dev/null \
    || fail "missing_evidence_entry:${must} actual=${actual}"
done

# Non-source attention tokens must not become reads.
printf '%s' "${actual}" | jq -e 'index("filesystem.read:not-a-source-file.md") == null' >/dev/null \
  || fail "non_source_attention_promoted"
printf '%s' "${actual}" | jq -e 'index("filesystem.read:README") == null' >/dev/null \
  || fail "readme_attention_promoted"

# discovery must NOT seed content anchors from operator/attention
# (required_evidence from handover is a separate, intentional channel).
export AEGIS_MODE="discovery"
export AEGIS_INVESTIGATION_INPUT="create src/feature/widget.ts and fix src/index.ts"
jq -n '{
  artifact_snapshot: { operational_context: {} },
  epistemic_state: {
    next_attention_targets: ["src/index.ts"],
    attention_scope: "test",
    attention_reason: "discovery must ignore attention for content seeds"
  }
}' > "${TMP_HANDOVER_FILE}"
AEGIS_ACTIVE_EVIDENCE_ENTRIES=()
resolve_evidence_profile
augment_evidence_profile_from_handover
augment_evidence_profile_from_anchors
disc_actual="$(
  printf '%s\n' "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" \
    | jq -R . \
    | jq -s -c '.'
)"
printf '%s' "${disc_actual}" | jq -e 'map(select(startswith("filesystem.read:src/"))) | length == 0' >/dev/null \
  || fail "discovery_should_not_seed_src_reads: ${disc_actual}"

# Cap is honored.
export AEGIS_MODE="forensics"
export AEGIS_DETERMINISTIC_READ_MAX=1
export AEGIS_INVESTIGATION_INPUT="touch src/a.ts and src/b.ts and src/c.ts"
AEGIS_ACTIVE_EVIDENCE_ENTRIES=()
# Minimal handover without required_evidence noise.
jq -n '{
  artifact_snapshot: { operational_context: {} },
  epistemic_state: {
    next_attention_targets: [],
    attention_scope: "none",
    attention_reason: "cap fixture"
  }
}' > "${TMP_HANDOVER_FILE}"
resolve_evidence_profile
augment_evidence_profile_from_handover
augment_evidence_profile_from_anchors
cap_reads="$(
  printf '%s\n' "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}" \
    | grep -c '^filesystem\.read:src/' || true
)"
[[ "${cap_reads}" -eq 1 ]] \
  || fail "cap_not_honored: got ${cap_reads} src reads"

echo "[AEGIS][TEST] deterministic read anchors passed"
