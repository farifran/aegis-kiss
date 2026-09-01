#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOOP_DIR="$(mktemp -d)"
trap 'rm -rf "${LOOP_DIR}"' EXIT

output="$(AEGIS_UAAM_LOOP_DIR="${LOOP_DIR}" bash "${ROOT_DIR}/scripts/uaam_assurance_loop.sh" 2>&1)"
printf '%s\n' "${output}"
printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[UAAM_LOOP\] SUCCESS iteration='
jq -e '.status == "SUCCESS" and .version == "uaam-loop-v1"' "${LOOP_DIR}/result.json" >/dev/null
jq -e '.status == "SUCCESS" and (.checks | length) == 7' "${LOOP_DIR}/latest.json" >/dev/null

echo "[AEGIS][TEST] uaam_assurance_loop: PASS"
