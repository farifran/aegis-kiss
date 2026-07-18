#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — runtime.demand_anchors
# =========================================================
#
# Classification: readonly
#
# Emits the mechanical demand projection (operator paths, dense tokens,
# search query, seed targets, content resonance). Same helper used for
# prompt injection and handover — no LLM, no source dumps.
#
# =========================================================

set -Eeuo pipefail

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../filesystem/_shared_utils.sh"
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/common.sh"
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/demand.sh"

aegis_capability_init "runtime.demand_anchors"

handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"

anchors_json="$(
  aegis_materialize_demand_anchors_json \
    "${AEGIS_INVESTIGATION_INPUT:-}" \
    "${handover}" \
    "${payload_dir}"
)"

if ! printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
  fail "demand_anchors_materialization_failed" "${TARGET_PATH}"
  exit 1
fi

# Single nested object — no flattened duplicates of the same fields.
tmp_payload="$(aegis_mktemp)"
jq -n \
  --arg target "${TARGET_PATH}" \
  --argjson demand_anchors "${anchors_json}" \
  '{
    target: $target,
    demand_anchors: $demand_anchors
  }' > "${tmp_payload}"

emit_success_payload_file "${tmp_payload}"
