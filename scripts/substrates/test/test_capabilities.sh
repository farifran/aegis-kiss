#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

TMP_TEST_DIR="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${TMP_TEST_DIR}" >/dev/null 2>&1 || true
}

export AEGIS_EXECUTION_ID="capability-harness"
export AEGIS_EXECUTION_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

export AEGIS_EPISTEMIC_HANDOVER_FILE="${TMP_TEST_DIR}/epistemic_handover.json"

jq -n \
  '{
    artifact_snapshot: null,
    epistemic_state: {
      next_attention_targets: [],
      attention_scope: "none",
      attention_reason: "no active attention"
    }
  }' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

assert_capability_success() {
  local capability="$1"
  local filter="$2"
  shift 2

  local output
  output="$("${BASH}" "$@")" || fail "capability_execution_failed: ${capability}"

  printf '%s\n' "${output}" | jq -e "${filter}" >/dev/null \
    || fail "unexpected_capability_output: ${capability}"
}

assert_capability_success \
  "filesystem.read" \
  '.success == true and .capability == "filesystem.read" and .payload.target == "AGENTS.md"' \
  scripts/capabilities/filesystem/read_file.sh \
  AGENTS.md

assert_capability_success \
  "filesystem.list_tree" \
  '.success == true and .capability == "filesystem.list_tree" and .error == null' \
  scripts/capabilities/filesystem/list_tree.sh \
  .

assert_capability_success \
  "filesystem.search_symbol" \
  '.success == true and .capability == "filesystem.search_symbol" and .error == null' \
  scripts/capabilities/filesystem/search_symbol.sh \
  AEGIS

assert_capability_success \
  "git.status" \
  '.success == true and .capability == "git.status" and .error == null' \
  scripts/capabilities/git/git_status.sh

assert_capability_success \
  "git.diff" \
  '.success == true and .capability == "git.diff" and .error == null' \
  scripts/capabilities/git/git_diff.sh

handover_output="$("${BASH}" scripts/capabilities/filesystem/read_file.sh "${AEGIS_EPISTEMIC_HANDOVER_FILE}")" \
  || fail "capability_execution_failed: filesystem.read epistemic_handover"

printf '%s\n' "${handover_output}" | jq -e \
  --arg path "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
  '.success == true and .capability == "filesystem.read" and .payload.target == $path and ((.payload.content | fromjson).epistemic_state.next_attention_targets == []) and ((.payload.content | fromjson).epistemic_state.attention_scope == "none") and ((.payload.content | fromjson).epistemic_state.attention_reason == "no active attention") and ((.payload.content | fromjson).artifact_snapshot == null)' \
  >/dev/null || fail "unexpected_capability_output: filesystem.read epistemic_handover"

echo "[AEGIS][TEST] capability harness passed"
