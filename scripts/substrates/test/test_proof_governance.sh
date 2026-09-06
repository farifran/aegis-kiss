#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "${ROOT_DIR}/scripts/lib/proof_governance.sh"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-proof-governance.XXXXXX")"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

write_state() {
  local root="$1" contract="$2" registry="$3"
  mkdir -p "${root}/src/.aegis"
  jq -n --slurpfile contract "${contract}" --slurpfile registry "${registry}" \
    '{schema:"aegis.semantic_state.v1",clarifiedDemand:{schema:"aegis.clarified_demand.v2"},contract:$contract[0],proofRegistry:$registry[0],digests:{}}' \
    > "${root}/src/.aegis/semantic-state.json"
}

fixture_root="${WORK_DIR}/fixture"
mkdir -p "${fixture_root}/src"
printf 'export const proof = true;\n' > "${fixture_root}/src/proof.ts"
printf '#!/usr/bin/env bash\nexit 0\n' > "${fixture_root}/src/proof.proof.sh"
chmod +x "${fixture_root}/src/proof.proof.sh"

registry="${WORK_DIR}/registry.json"
contract="${WORK_DIR}/contract.json"
cat > "${registry}" <<'EOF'
{"schema":"aegis.proof_registry.v1","policy":{"mode":"enforced","maxActiveProofsPerProfile":{"fast":1,"targeted":1,"release":1,"forensic":1}},"profiles":[{"id":"fast","proofIds":["PO-FAST"]},{"id":"targeted","proofIds":["PO-TARGETED"]},{"id":"release","proofIds":["PO-RELEASE"]},{"id":"forensic","proofIds":["PO-FORENSIC"]}],"proofs":[{"id":"PO-FAST","risk":"type","coverageKey":"fixture.type","authority":"compiler","cost":"low","cadence":"always","status":"active","targets":["src/proof.ts","src/proof.proof.sh"],"executionKey":"fixture-fast","executor":"bash","argv":["src/proof.proof.sh"]},{"id":"PO-TARGETED","risk":"targeted","coverageKey":"fixture.targeted","authority":"fixture","cost":"medium","cadence":"targeted","status":"active","targets":["src/proof.ts","src/proof.proof.sh"],"executionKey":"fixture-targeted","executor":"bash","argv":["src/proof.proof.sh"]},{"id":"PO-RELEASE","risk":"release","coverageKey":"fixture.release","authority":"fixture","cost":"high","cadence":"release","status":"active","targets":["src/proof.ts","src/proof.proof.sh"],"executionKey":"fixture-release","executor":"bash","argv":["src/proof.proof.sh"]},{"id":"PO-FORENSIC","risk":"forensic","coverageKey":"fixture.forensic","authority":"fixture","cost":"high","cadence":"forensic","status":"active","targets":["src/proof.ts","src/proof.proof.sh"],"executionKey":"fixture-forensic","executor":"bash","argv":["src/proof.proof.sh"]}]}
EOF
cat > "${contract}" <<'EOF'
{"schema":"aegis.contract_ir.v2","scope":{"authorizedPaths":["src/proof.ts","src/proof.proof.sh"]},"proofObligations":[{"id":"PO-FAST"}]}
EOF

AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_governance_validate "${registry}" "${contract}" >/dev/null

jq '.proofs[0].command = "bash src/proof.proof.sh"' "${registry}" > "${WORK_DIR}/legacy-command.json"
if AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_governance_validate "${WORK_DIR}/legacy-command.json" "${contract}" >/dev/null 2>&1; then
  echo 'legacy proof command was accepted' >&2
  exit 1
fi

git -C "${fixture_root}" init -q
git -C "${fixture_root}" config user.email aegis-test@example.invalid
git -C "${fixture_root}" config user.name aegis-test
write_state "${fixture_root}" "${contract}" "${registry}"
git -C "${fixture_root}" add .
git -C "${fixture_root}" commit -qm baseline

AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_governance_validate_staged "${fixture_root}"
AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_continuity_validate_staged "${fixture_root}"

printf 'outside contract\n' > "${fixture_root}/README.md"
git -C "${fixture_root}" add README.md
runtime_contract="$(AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_contract_path)"
if AEGIS_ROOT_DIR="${fixture_root}" aegis_staged_scope_validate "${fixture_root}" "${runtime_contract}" >/dev/null 2>&1; then
  echo 'staged path outside contract was accepted' >&2
  exit 1
fi
git -C "${fixture_root}" restore --staged README.md
rm -f "${fixture_root}/README.md"

jq '.proofs[0].authority = "changed"' "${registry}" > "${WORK_DIR}/changed-registry.json"
write_state "${fixture_root}" "${contract}" "${WORK_DIR}/changed-registry.json"
git -C "${fixture_root}" add src/.aegis/semantic-state.json
if AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_continuity_validate_staged "${fixture_root}" >/dev/null 2>&1; then
  echo 'silent active proof change was accepted' >&2
  exit 1
fi
jq '.continuity = {proofChanges:[{id:"PO-FAST",reason:"fixture authority change",demandEvidence:"fixture demand"}]}' "${contract}" > "${WORK_DIR}/changed-contract.json"
write_state "${fixture_root}" "${WORK_DIR}/changed-contract.json" "${WORK_DIR}/changed-registry.json"
git -C "${fixture_root}" add src/.aegis/semantic-state.json
AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_continuity_validate_staged "${fixture_root}"
git -C "${fixture_root}" restore --source=HEAD --staged --worktree src/.aegis/semantic-state.json

printf 'export const successor = true;\n' > "${fixture_root}/src/successor.ts"
jq '.profiles[0].proofIds=["PO-SUCCESSOR"] | .proofs[0].status="retired" | .proofs += [{id:"PO-SUCCESSOR",risk:"successor",coverageKey:"fixture.successor",authority:"fixture",cost:"low",cadence:"always",status:"active",targets:["src/successor.ts","src/proof.proof.sh"],executionKey:"fixture-successor",executor:"bash",argv:["src/proof.proof.sh"]}]' "${registry}" > "${WORK_DIR}/successor-registry.json"
jq '.scope.authorizedPaths=["src/successor.ts","src/proof.proof.sh"] | .proofObligations=[{id:"PO-SUCCESSOR"}]' "${contract}" > "${WORK_DIR}/successor-contract.json"
rm "${fixture_root}/src/proof.ts"
write_state "${fixture_root}" "${WORK_DIR}/successor-contract.json" "${WORK_DIR}/successor-registry.json"
git -C "${fixture_root}" add -A
if AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_continuity_validate_staged "${fixture_root}" >/dev/null 2>&1; then
  echo 'silent proof retirement was accepted' >&2
  exit 1
fi
jq '.continuity={retirements:[{kind:"proof",id:"PO-FAST",reason:"fixture replacement",demandEvidence:"fixture demand",successor:"PO-SUCCESSOR"},{kind:"target",id:"src/proof.ts",reason:"fixture replacement",demandEvidence:"fixture demand",successor:"src/successor.ts"}]}' "${WORK_DIR}/successor-contract.json" > "${WORK_DIR}/retired-contract.json"
write_state "${fixture_root}" "${WORK_DIR}/retired-contract.json" "${WORK_DIR}/successor-registry.json"
git -C "${fixture_root}" add -A
AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_continuity_validate_staged "${fixture_root}"

plan="$(AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_profile_plan fast "${registry}")"
jq -e '.profile == "fast" and .count == 1 and .proofs[0].id == "PO-FAST"' <<<"${plan}" >/dev/null
profile="$(AEGIS_ROOT_DIR="${fixture_root}" aegis_proof_profile_for_change "${registry}" $'src/proof.ts')"
jq -e '.profile == "forensic"' <<<"${profile}" >/dev/null

echo '[AEGIS][TEST][PASS] proof governance passed'
