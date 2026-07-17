#!/usr/bin/env bash

# =========================================================
# Artifact recovery — marker noise, key-wrap, bare JSON
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"

export AEGIS_ARTIFACT_BEGIN_MARKER="${AEGIS_ARTIFACT_BEGIN_MARKER:-AEGIS_ARTIFACT_BEGIN}"
export AEGIS_ARTIFACT_END_MARKER="${AEGIS_ARTIFACT_END_MARKER:-AEGIS_ARTIFACT_END}"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/substrates/raw/artifact.sh"

assert_recovers() {
  local name="$1"
  local input="$2"
  local out

  out="$(recover_artifact_json "${input}")" \
    || fail "${name}: recover_exited_nonzero"

  echo "${out}" | jq -e '
    type == "object"
    and (.observations | type == "array")
    and (.rationale | type == "string")
  ' >/dev/null \
    || fail "${name}: bad_shape: ${out}"
}

assert_recovers "classic_markers" \
  "${AEGIS_ARTIFACT_BEGIN_MARKER}
{\"observations\":[\"a\"],\"rationale\":\"r\",\"required_evidence\":[]}
${AEGIS_ARTIFACT_END_MARKER}"

assert_recovers "marker_as_json_key" \
  "{\"${AEGIS_ARTIFACT_BEGIN_MARKER}\":{\"observations\":[\"a\"],\"rationale\":\"r\",\"required_evidence\":[\"filesystem.read:src/index.ts\"]},\"${AEGIS_ARTIFACT_END_MARKER}\":\"\"}"

# Exact failure shape from operator log (BEGIN/END with key-noise mid-body).
assert_recovers "marker_key_noise" \
  "${AEGIS_ARTIFACT_BEGIN_MARKER}
\":
{
  \"observations\": [\"a\"],
  \"rationale\": \"Operator nam src/index.ts\",
  \"required_evidence\": [\"filesystem.read:src/index.ts\"]
},
\"
${AEGIS_ARTIFACT_END_MARKER}"

assert_recovers "bare_json_object" \
  '{"observations":["a"],"rationale":"r","required_evidence":[]}'

assert_recovers "fenced_json" \
  $'```json\n{"observations":["a"],"rationale":"r","required_evidence":[]}\n```'

# Non-recovery should fail cleanly.
if recover_artifact_json "not json at all, no braces" >/dev/null 2>&1; then
  fail "garbage_should_not_recover"
fi

echo "[AEGIS][TEST] artifact recovery passed"
