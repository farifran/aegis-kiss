#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT_DIR}"

source scripts/lib/proof_governance.sh

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis-proof-governance.XXXXXX")"
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis-proof-runtime.XXXXXX")"
cleanup() { rm -rf "${work_dir}" "${runtime_dir}"; }
trap cleanup EXIT

valid_registry="${work_dir}/registry.json"
valid_contract="${work_dir}/contract.json"
cp .harness/proof_registry.json "${valid_registry}"
jq '.targets = ["src/reorgEngine.ts", "src/blockTree.ts", "src/index.ts"]' \
  .harness/active_contract_ir.json > "${valid_contract}"

AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate "${valid_registry}" "${valid_contract}" >/dev/null

jq '.proofs[1].coverageKey = .proofs[0].coverageKey' "${valid_registry}" > "${work_dir}/duplicate.json"
if AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate "${work_dir}/duplicate.json" "${valid_contract}" >/dev/null 2>&1; then
  echo "duplicate coverage was accepted" >&2
  exit 1
fi

jq '.targets = ["src/does-not-exist.ts"]' "${valid_contract}" > "${work_dir}/missing-target.json"
if AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate "${valid_registry}" "${work_dir}/missing-target.json" >/dev/null 2>&1; then
  echo "missing contract target was accepted" >&2
  exit 1
fi

plan="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_plan fast "${valid_registry}")"
jq -e '.profile == "fast" and .count == 3 and ([.proofs[].id] | length == 3)' <<<"${plan}" >/dev/null

key="$(AEGIS_ROOT_DIR="${ROOT_DIR}" AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_key PO-TYPE-001 fast "${valid_contract}" "${valid_registry}" "src/reorgEngine.ts")"
AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_store "${key}" PO-TYPE-001 PROVEN compiler >/dev/null
AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_lookup "${key}"

echo "[AEGIS][TEST][PASS] proof governance passed"
