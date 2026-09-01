#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOOP_DIR="$(mktemp -d)"
NO_RECEIPT_DIR=""
trap 'rm -rf "${LOOP_DIR}" "${NO_RECEIPT_DIR}"' EXIT

set +e
output="$(AEGIS_UAAM_LOOP_DIR="${LOOP_DIR}" bash "${ROOT_DIR}/scripts/uaam_assurance_loop.sh" 2>&1)"
loop_rc=$?
set -e
printf '%s\n' "${output}"
[[ "${loop_rc}" -ne 0 ]]
printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[UAAM_LOOP\] UNPROVEN iteration=1 failed_checks=proof'
jq -e '.status == "UNPROVEN" and .reason == "repair_provider_missing"' "${LOOP_DIR}/result.json" >/dev/null
jq -e '.status == "UNPROVEN" and (.checks | length) == 9 and ([.checks[] | select(.name == "contract" and .status == "passed")] | length) == 1 and ([.checks[] | select(.name == "proof" and .status == "failed")] | length) == 1' "${LOOP_DIR}/latest.json" >/dev/null

NO_RECEIPT_DIR="$(mktemp -d)"
set +e
AEGIS_UAAM_LOOP_DIR="${NO_RECEIPT_DIR}" AEGIS_UAAM_REPAIR_CMD=true bash "${ROOT_DIR}/scripts/uaam_assurance_loop.sh" >/dev/null 2>&1
no_receipt_rc=$?
set -e
[[ "${no_receipt_rc}" -ne 0 ]]
jq -e '.status == "UNPROVEN" and .reason == "repair_receipt_missing"' "${NO_RECEIPT_DIR}/result.json" >/dev/null

echo "[AEGIS][TEST] uaam_assurance_loop: PASS (semantic proof and receipt gates enforced)"
