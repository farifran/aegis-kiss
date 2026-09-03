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

# The direct Git path must inspect the index, not the working tree.  This is
# the regression that used to let a staged deletion pass after local checks.
staged_repo="${work_dir}/staged-repository"
mkdir -p "${staged_repo}/.harness" "${staged_repo}/src"
git -C "${staged_repo}" init -q
git -C "${staged_repo}" config user.email aegis-test@example.invalid
git -C "${staged_repo}" config user.name aegis-test
printf 'export const proof = true;\n' > "${staged_repo}/src/proof.ts"
cat > "${staged_repo}/package.json" <<'EOF'
{"scripts":{"fixture-proof":"node -e \"process.exit(0)\""}}
EOF
cat > "${staged_repo}/.harness/proof_registry.json" <<'EOF'
{
  "schema":"aegis.proof_registry.v1",
  "policy":{"mode":"enforced","maxActiveProofsPerProfile":{"fast":1}},
  "profiles":[{"id":"fast","proofIds":["PO-FIXTURE-001"]}],
  "proofs":[{"id":"PO-FIXTURE-001","risk":"fixture risk","coverageKey":"fixture.coverage","authority":"fixture","cost":"low","cadence":"always","status":"active","targets":["src/proof.ts"],"executionKey":"fixture-proof","command":"npm run fixture-proof"}]
}
EOF
cat > "${staged_repo}/.harness/active_contract_ir.json" <<'EOF'
{"targets":["src/proof.ts"],"proofObligations":[{"id":"PO-FIXTURE-001"}]}
EOF
git -C "${staged_repo}" add .
git -C "${staged_repo}" commit -qm "fixture baseline"
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}"
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}"

jq '.proofs[0].command = "npm run missing-script"' "${staged_repo}/.harness/proof_registry.json" \
  > "${staged_repo}/.harness/invalid-command.json"
mv "${staged_repo}/.harness/invalid-command.json" "${staged_repo}/.harness/proof_registry.json"
git -C "${staged_repo}" add .harness/proof_registry.json
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "staged unresolved command was accepted" >&2
  exit 1
fi

git -C "${staged_repo}" restore --source=HEAD --staged --worktree .harness/proof_registry.json

jq '.scripts["fixture-proof-v2"] = "node -e \"process.exit(0)\""' "${staged_repo}/package.json" > "${staged_repo}/next-package.json"
mv "${staged_repo}/next-package.json" "${staged_repo}/package.json"
jq '.proofs[0].command = "npm run fixture-proof-v2"' "${staged_repo}/.harness/proof_registry.json" > "${staged_repo}/next-registry.json"
mv "${staged_repo}/next-registry.json" "${staged_repo}/.harness/proof_registry.json"
git -C "${staged_repo}" add package.json .harness/proof_registry.json
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}"
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "silent active proof change was accepted" >&2
  exit 1
fi
jq '.continuity = {proofChanges:[{id:"PO-FIXTURE-001",reason:"fixture command evolution",demandEvidence:"fixture demand"}]}' \
  "${staged_repo}/.harness/active_contract_ir.json" > "${staged_repo}/next-contract.json"
mv "${staged_repo}/next-contract.json" "${staged_repo}/.harness/active_contract_ir.json"
git -C "${staged_repo}" add .harness/active_contract_ir.json
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}"
git -C "${staged_repo}" restore --source=HEAD --staged --worktree package.json .harness/proof_registry.json .harness/active_contract_ir.json

git -C "${staged_repo}" rm --cached -q src/proof.ts
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "staged missing target was accepted" >&2
  exit 1
fi
git -C "${staged_repo}" restore --staged src/proof.ts

# A coherent new registry is still rejected when it silently retires an older
# obligation.  Adding the two retirement records is the only valid evolution.
printf 'export const successor = true;\n' > "${staged_repo}/src/successor.ts"
jq '
  .profiles[0].proofIds = ["PO-SUCCESSOR-001"]
  | .proofs[0].status = "retired"
  | .proofs += [{"id":"PO-SUCCESSOR-001","risk":"successor risk","coverageKey":"fixture.successor","authority":"fixture","cost":"low","cadence":"always","status":"active","targets":["src/successor.ts"],"executionKey":"fixture-proof","command":"npm run fixture-proof"}]
' "${staged_repo}/.harness/proof_registry.json" > "${staged_repo}/.harness/next-registry.json"
mv "${staged_repo}/.harness/next-registry.json" "${staged_repo}/.harness/proof_registry.json"
cat > "${staged_repo}/.harness/active_contract_ir.json" <<'EOF'
{"targets":["src/successor.ts"],"proofObligations":[{"id":"PO-SUCCESSOR-001"}]}
EOF
git -C "${staged_repo}" add .harness src/successor.ts
git -C "${staged_repo}" rm --cached -q src/proof.ts
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}"
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "silent proof retirement was accepted" >&2
  exit 1
fi

jq '.continuity = {retirements:[
  {kind:"proof",id:"PO-FIXTURE-001",reason:"fixture replacement",demandEvidence:"fixture demand",successor:"PO-SUCCESSOR-001"},
  {kind:"target",id:"src/proof.ts",reason:"fixture replacement",demandEvidence:"fixture demand",successor:"src/successor.ts"}
]}' "${staged_repo}/.harness/active_contract_ir.json" > "${staged_repo}/.harness/next-contract.json"
mv "${staged_repo}/.harness/next-contract.json" "${staged_repo}/.harness/active_contract_ir.json"
git -C "${staged_repo}" add .harness/active_contract_ir.json
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}"

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

auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'src/stateWal.ts')"
jq -e '.profile == "release" and ([.matchedProofs[].id] | index("PO-WAL-001"))' <<<"${auto_profile}" >/dev/null
auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'src/benchmarks/reorgEngine.benchmark.ts')"
jq -e '.profile == "forensic" and ([.matchedProofs[].id] | index("PO-BENCHMARK-001"))' <<<"${auto_profile}" >/dev/null
auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'.harness/active_contract_ir.json')"
jq -e '.profile == "release"' <<<"${auto_profile}" >/dev/null

key="$(AEGIS_ROOT_DIR="${ROOT_DIR}" AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_key PO-TYPE-001 fast "${valid_contract}" "${valid_registry}" "src/reorgEngine.ts")"
AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_store "${key}" PO-TYPE-001 PROVEN compiler >/dev/null
AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_lookup "${key}"

echo "[AEGIS][TEST][PASS] proof governance passed"
