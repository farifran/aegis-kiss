#!/usr/bin/env bash

# AEGIS TEST: final receipt binds contract, candidate, commit and post-commit state.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT_DIR}"

source scripts/lib/briefing.sh
source scripts/lib/final_receipt.sh
source "${ROOT_DIR}/aegis"

repo_dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis_receipt_repo.XXXXXX")"
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis_receipt_runtime.XXXXXX")"
cleanup() {
  rm -rf "${repo_dir}" "${runtime_dir}"
}
trap cleanup EXIT

git -C "${repo_dir}" init -q
git -C "${repo_dir}" config user.email "aegis-test@example.invalid"
git -C "${repo_dir}" config user.name "Aegis Test"
mkdir -p "${repo_dir}/src" "${repo_dir}/.harness"
printf '%s\n' 'export const value = 1;' > "${repo_dir}/src/feature.ts"
jq -n '{
  goal: "Update feature",
  targets: ["src/feature.ts"],
  exports: [{kind:"const",name:"value"}],
  contractReconciliation: {equivalent:true,status:"equivalent"}
}' > "${repo_dir}/.harness/active_contract_ir.json"
git -C "${repo_dir}" add src/feature.ts
git -C "${repo_dir}" add .harness/active_contract_ir.json
git -C "${repo_dir}" commit -qm "baseline"

printf '%s\n' 'export const value = 2;' > "${repo_dir}/src/feature.ts"
candidate_diff="$(git -C "${repo_dir}" diff --binary)"
git -C "${repo_dir}" add src/feature.ts
git -C "${repo_dir}" commit -qm "managed change"
commit="$(git -C "${repo_dir}" rev-parse --short HEAD)"

jq -n --arg diff "${candidate_diff}" '{
  artifact_snapshot: {operational_context: {
    verdict: "accepted",
    findings: [],
    validated_candidate: {diff:$diff,files_changed:["src/feature.ts"]}
  }}
}' > "${runtime_dir}/epistemic_handover.json"
jq -n '{status:"SUCCESS",pipeline_status:"SUCCESS"}' > "${runtime_dir}/last_outcome.json"

export AEGIS_ROOT_DIR="${repo_dir}"
export AEGIS_RUNTIME_DIR="${runtime_dir}"
receipt="$(aegis_write_final_receipt "${commit}" "test" "src/feature.ts" \
  "${repo_dir}/.harness/active_contract_ir.json" \
  "${runtime_dir}/epistemic_handover.json" \
  "${runtime_dir}/last_outcome.json" "${runtime_dir}/pipeline_metrics.jsonl")"

jq -e '
  .verification_status == "VERIFIED"
  and .verified == true
  and .contract.status == "equivalent"
  and .post_commit.contract_matches_commit == true
  and .post_commit.required_targets_present == true
  and .post_commit.scope_matches_candidate == true
  and .post_commit.candidate_patch_matches_commit == true
  and .post_commit.clean == true
  and .proofs.invariant_status == "not_applicable"
' "${receipt}" >/dev/null

gh_calls="${runtime_dir}/gh.calls"
gh_run() {
  printf '%s\n' "$*" >> "${gh_calls}"
  return 0
}

verified_result="$(
  AEGIS_ROOT_DIR="${repo_dir}" \
  AEGIS_RUNTIME_DIR="${runtime_dir}" \
  AEGIS_CONTRACT_FILE="${repo_dir}/.harness/active_contract_ir.json" \
  AEGIS_HANDOVER_FILE="${runtime_dir}/epistemic_handover.json" \
  AEGIS_OUTCOME_FILE="${runtime_dir}/last_outcome.json" \
  AEGIS_METRICS_FILE="${runtime_dir}/pipeline_metrics.jsonl" \
    aegis_finalize_commit "${commit}" "test" "src/feature.ts" "src/feature.ts"
)"
printf '%s' "${verified_result}" | jq -e \
  '.status == "SUCCESS" and .commit == "'"${commit}"'"' >/dev/null
[[ "$(grep -c '^issue close ' "${gh_calls}" || true)" -eq 1 ]] \
  || fail "verified finalization did not close the issue exactly once"

jq '.contractReconciliation.equivalent = false' \
  "${repo_dir}/.harness/active_contract_ir.json" > "${repo_dir}/.harness/active_contract_ir.next"
mv "${repo_dir}/.harness/active_contract_ir.next" "${repo_dir}/.harness/active_contract_ir.json"
set +e
unproven_result="$(
  AEGIS_ROOT_DIR="${repo_dir}" \
  AEGIS_RUNTIME_DIR="${runtime_dir}" \
  AEGIS_CONTRACT_FILE="${repo_dir}/.harness/active_contract_ir.json" \
  AEGIS_HANDOVER_FILE="${runtime_dir}/epistemic_handover.json" \
  AEGIS_OUTCOME_FILE="${runtime_dir}/last_outcome.json" \
  AEGIS_METRICS_FILE="${runtime_dir}/pipeline_metrics.jsonl" \
    aegis_finalize_commit "${commit}" "test" "src/feature.ts" "src/feature.ts"
)"
unproven_rc=$?
set -e
[[ "${unproven_rc}" -ne 0 ]] || fail "unproven finalization unexpectedly succeeded"
printf '%s' "${unproven_result}" | jq -e \
  '.status == "UNPROVEN" and .reason == "post_commit_validation"' >/dev/null
jq -e '.verification_status == "UNPROVEN" and .verified == false' "${receipt}" >/dev/null
if aegis_final_receipt_assert_verified "${receipt}"; then
  echo "[AEGIS][TEST][FAIL] unproven receipt was accepted" >&2
  exit 1
fi
[[ "$(grep -c '^issue close ' "${gh_calls}" || true)" -eq 1 ]] \
  || fail "unproven finalization closed the issue"

git -C "${repo_dir}" rm --cached -q .harness/active_contract_ir.json
git -C "${repo_dir}" commit -qm "commit without contract"
missing_contract_commit="$(git -C "${repo_dir}" rev-parse --short HEAD)"
aegis_write_final_receipt "${missing_contract_commit}" "test" "src/feature.ts" \
  "${repo_dir}/.harness/active_contract_ir.json" \
  "${runtime_dir}/epistemic_handover.json" \
  "${runtime_dir}/last_outcome.json" "${runtime_dir}/pipeline_metrics.jsonl" >/dev/null
jq -e '
  .verification_status == "UNPROVEN"
  and .post_commit.contract_present_in_commit == false
  and .post_commit.contract_matches_commit == false
' "${receipt}" >/dev/null

echo "[AEGIS][TEST][PASS] final receipt binding passed"
