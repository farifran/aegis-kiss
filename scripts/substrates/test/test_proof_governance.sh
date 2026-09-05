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
cat > "${valid_registry}" <<'EOF'
{
  "schema": "aegis.proof_registry.v1",
  "policy": {
    "mode": "enforced",
    "maxActiveProofsPerProfile": {"fast": 1, "targeted": 1, "release": 1, "forensic": 1}
  },
  "profiles": [
    {"id": "fast", "proofIds": ["PO-FIXTURE-FAST"]},
    {"id": "targeted", "proofIds": ["PO-FIXTURE-TARGETED"]},
    {"id": "release", "proofIds": ["PO-FIXTURE-RELEASE"]},
    {"id": "forensic", "proofIds": ["PO-FIXTURE-FORENSIC"]}
  ],
  "proofs": [
    {"id": "PO-FIXTURE-FAST", "risk": "fixture type safety", "coverageKey": "fixture.type", "authority": "compiler", "cost": "low", "cadence": "always", "status": "active", "targets": ["src/index.ts"], "executionKey": "fixture-fast", "command": "npm run aegis:typecheck"},
    {"id": "PO-FIXTURE-TARGETED", "risk": "fixture IDE gateway behavior", "coverageKey": "fixture.ide_gateway", "authority": "targeted-check", "cost": "medium", "cadence": "targeted", "status": "active", "targets": ["scripts/ide_gateway.sh"], "executionKey": "fixture-targeted", "command": "npm run aegis:typecheck"},
    {"id": "PO-FIXTURE-RELEASE", "risk": "fixture governance behavior", "coverageKey": "fixture.governance", "authority": "release-check", "cost": "high", "cadence": "release", "status": "active", "targets": ["scripts/lib/proof_governance.sh"], "executionKey": "fixture-release", "command": "npm run aegis:typecheck"},
    {"id": "PO-FIXTURE-FORENSIC", "risk": "fixture forensic behavior", "coverageKey": "fixture.forensic", "authority": "forensic-check", "cost": "high", "cadence": "forensic", "status": "active", "targets": ["scripts/proof_governance.sh"], "executionKey": "fixture-forensic", "command": "npm run aegis:typecheck"}
  ]
}
EOF
cat > "${valid_contract}" <<'EOF'
{
  "targets": ["src/index.ts"],
  "proofObligations": [{"id": "PO-FIXTURE-FAST"}]
}
EOF

AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_governance_validate "${valid_registry}" "${valid_contract}" >/dev/null

node_fixture_root="${work_dir}/node-command-fixture"
mkdir -p "${node_fixture_root}/src/tests"
printf 'export const proof = true;\n' > "${node_fixture_root}/src/tests/direct.proof.ts"
cat > "${work_dir}/node-registry.json" <<'EOF'
{
  "schema": "aegis.proof_registry.v1",
  "policy": {
    "mode": "enforced",
    "maxActiveProofsPerProfile": {"fast": 1}
  },
  "profiles": [
    {"id": "fast", "proofIds": ["PO-FIXTURE-DIRECT"]}
  ],
  "proofs": [
    {
      "id": "PO-FIXTURE-DIRECT",
      "risk": "direct proof command resolution",
      "coverageKey": "fixture.direct_command",
      "authority": "fixture",
      "cost": "low",
      "cadence": "always",
      "status": "active",
      "targets": ["src/tests/direct.proof.ts"],
      "executionKey": "fixture-direct",
      "command": "node --import tsx src/tests/direct.proof.ts"
    }
  ]
}
EOF
printf '%s\n' '{"targets":["src/tests/direct.proof.ts"],"proofObligations":[{"id":"PO-FIXTURE-DIRECT"}]}' \
  > "${work_dir}/node-contract.json"
AEGIS_ROOT_DIR="${node_fixture_root}" aegis_proof_governance_validate \
  "${work_dir}/node-registry.json" "${work_dir}/node-contract.json" >/dev/null

# One governed migration moves demand records out of the harness without
# weakening continuity against the previous commit.
migration_repo="${work_dir}/metadata-migration"
mkdir -p "${migration_repo}/.harness" "${migration_repo}/src"
printf 'export const proof = true;\n' > "${migration_repo}/src/proof.ts"
printf '%s\n' '{"targets":["src/proof.ts"],"proofObligations":[{"id":"PO-MIGRATION-001"}]}' \
  > "${migration_repo}/.harness/active_contract_ir.json"
cat > "${migration_repo}/.harness/proof_registry.json" <<'EOF'
{"schema":"aegis.proof_registry.v1","policy":{"mode":"enforced","maxActiveProofsPerProfile":{"fast":1}},"profiles":[{"id":"fast","proofIds":["PO-MIGRATION-001"]}],"proofs":[{"id":"PO-MIGRATION-001","risk":"migration","coverageKey":"migration.metadata","authority":"fixture","cost":"low","cadence":"always","status":"active","targets":["src/proof.ts"],"executionKey":"migration-proof","command":"bash src/proof.sh"}]}
EOF
git -C "${migration_repo}" init -q
git -C "${migration_repo}" config user.email aegis-test@example.invalid
git -C "${migration_repo}" config user.name aegis-test
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit -qm baseline
mkdir -p "${migration_repo}/src/.aegis"
mv "${migration_repo}/.harness/active_contract_ir.json" "${migration_repo}/src/.aegis/contract-ir.json"
mv "${migration_repo}/.harness/proof_registry.json" "${migration_repo}/src/.aegis/proof-registry.json"
git -C "${migration_repo}" add -A
AEGIS_ROOT_DIR="${migration_repo}" aegis_proof_continuity_validate_staged "${migration_repo}"
AEGIS_ROOT_DIR="${migration_repo}" aegis_staged_scope_validate \
  "${migration_repo}" "${migration_repo}/src/.aegis/contract-ir.json"

# The direct Git path must inspect the index, not the working tree.  This is
# the regression that used to let a staged deletion pass after local checks.
staged_repo="${work_dir}/staged-repository"
mkdir -p "${staged_repo}/src/.aegis"
git -C "${staged_repo}" init -q
git -C "${staged_repo}" config user.email aegis-test@example.invalid
git -C "${staged_repo}" config user.name aegis-test
printf 'export const proof = true;\n' > "${staged_repo}/src/proof.ts"
cat > "${staged_repo}/package.json" <<'EOF'
{"scripts":{"fixture-proof":"node -e \"process.exit(0)\""}}
EOF
cat > "${staged_repo}/src/.aegis/proof-registry.json" <<'EOF'
{
  "schema":"aegis.proof_registry.v1",
  "policy":{"mode":"enforced","maxActiveProofsPerProfile":{"fast":1}},
  "profiles":[{"id":"fast","proofIds":["PO-FIXTURE-001"]}],
  "proofs":[{"id":"PO-FIXTURE-001","risk":"fixture risk","coverageKey":"fixture.coverage","authority":"fixture","cost":"low","cadence":"always","status":"active","targets":["src/proof.ts"],"executionKey":"fixture-proof","command":"npm run fixture-proof"}]
}
EOF
cat > "${staged_repo}/src/.aegis/contract-ir.json" <<'EOF'
{"targets":["src/proof.ts"],"proofObligations":[{"id":"PO-FIXTURE-001"}]}
EOF
git -C "${staged_repo}" add .
git -C "${staged_repo}" commit -qm "fixture baseline"
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}"
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}"

printf 'outside contract\n' > "${staged_repo}/README.md"
git -C "${staged_repo}" add README.md
if AEGIS_ROOT_DIR="${staged_repo}" aegis_staged_scope_validate \
  "${staged_repo}" "${staged_repo}/src/.aegis/contract-ir.json" >/dev/null 2>&1; then
  echo "staged path outside contract was accepted" >&2
  exit 1
fi
git -C "${staged_repo}" restore --staged README.md
rm -f "${staged_repo}/README.md"

jq '.proofs[0].command = "npm run missing-script"' "${staged_repo}/src/.aegis/proof-registry.json" \
  > "${staged_repo}/src/.aegis/invalid-command.json"
mv "${staged_repo}/src/.aegis/invalid-command.json" "${staged_repo}/src/.aegis/proof-registry.json"
git -C "${staged_repo}" add src/.aegis/proof-registry.json
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "staged unresolved command was accepted" >&2
  exit 1
fi

git -C "${staged_repo}" restore --source=HEAD --staged --worktree src/.aegis/proof-registry.json

jq '.scripts["fixture-proof-v2"] = "node -e \"process.exit(0)\""' "${staged_repo}/package.json" > "${staged_repo}/next-package.json"
mv "${staged_repo}/next-package.json" "${staged_repo}/package.json"
jq '.proofs[0].command = "npm run fixture-proof-v2"' "${staged_repo}/src/.aegis/proof-registry.json" > "${staged_repo}/next-registry.json"
mv "${staged_repo}/next-registry.json" "${staged_repo}/src/.aegis/proof-registry.json"
git -C "${staged_repo}" add package.json src/.aegis/proof-registry.json
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}"
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "silent active proof change was accepted" >&2
  exit 1
fi
jq '.continuity = {proofChanges:[{id:"PO-FIXTURE-001",reason:"fixture command evolution",demandEvidence:"fixture demand"}]}' \
  "${staged_repo}/src/.aegis/contract-ir.json" > "${staged_repo}/next-contract.json"
mv "${staged_repo}/next-contract.json" "${staged_repo}/src/.aegis/contract-ir.json"
git -C "${staged_repo}" add src/.aegis/contract-ir.json
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}"
git -C "${staged_repo}" restore --source=HEAD --staged --worktree package.json src/.aegis/proof-registry.json src/.aegis/contract-ir.json

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
' "${staged_repo}/src/.aegis/proof-registry.json" > "${staged_repo}/src/.aegis/next-registry.json"
mv "${staged_repo}/src/.aegis/next-registry.json" "${staged_repo}/src/.aegis/proof-registry.json"
cat > "${staged_repo}/src/.aegis/contract-ir.json" <<'EOF'
{"targets":["src/successor.ts"],"proofObligations":[{"id":"PO-SUCCESSOR-001"}]}
EOF
git -C "${staged_repo}" add src/.aegis src/successor.ts
git -C "${staged_repo}" rm --cached -q src/proof.ts
AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_governance_validate_staged "${staged_repo}"
if AEGIS_ROOT_DIR="${staged_repo}" aegis_proof_continuity_validate_staged "${staged_repo}" >/dev/null 2>&1; then
  echo "silent proof retirement was accepted" >&2
  exit 1
fi

jq '.continuity = {retirements:[
  {kind:"proof",id:"PO-FIXTURE-001",reason:"fixture replacement",demandEvidence:"fixture demand",successor:"PO-SUCCESSOR-001"},
  {kind:"target",id:"src/proof.ts",reason:"fixture replacement",demandEvidence:"fixture demand",successor:"src/successor.ts"}
]}' "${staged_repo}/src/.aegis/contract-ir.json" > "${staged_repo}/src/.aegis/next-contract.json"
mv "${staged_repo}/src/.aegis/next-contract.json" "${staged_repo}/src/.aegis/contract-ir.json"
git -C "${staged_repo}" add src/.aegis/contract-ir.json
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
jq -e '.profile == "fast" and .count == 1 and .proofs[0].id == "PO-FIXTURE-FAST"' <<<"${plan}" >/dev/null

auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'scripts/ide_gateway.sh')"
jq -e '.profile == "targeted" and ([.matchedProofs[].id] | index("PO-FIXTURE-TARGETED"))' <<<"${auto_profile}" >/dev/null
auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'scripts/lib/proof_governance.sh')"
jq -e '.profile == "release" and ([.matchedProofs[].id] | index("PO-FIXTURE-RELEASE"))' <<<"${auto_profile}" >/dev/null
auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'scripts/proof_governance.sh')"
jq -e '.profile == "forensic" and ([.matchedProofs[].id] | index("PO-FIXTURE-FORENSIC"))' <<<"${auto_profile}" >/dev/null
auto_profile="$(AEGIS_ROOT_DIR="${ROOT_DIR}" aegis_proof_profile_for_change "${valid_registry}" $'src/.aegis/contract-ir.json')"
jq -e '.profile == "fast" and (.matchedProofs | length) == 0' <<<"${auto_profile}" >/dev/null

key="$(AEGIS_ROOT_DIR="${ROOT_DIR}" AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_key PO-FIXTURE-FAST fast "${valid_contract}" "${valid_registry}" "src/index.ts")"
AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_store "${key}" PO-FIXTURE-FAST PROVEN compiler >/dev/null
AEGIS_RUNTIME_DIR="${runtime_dir}" aegis_proof_cache_lookup "${key}"

echo "[AEGIS][TEST][PASS] proof governance passed"
