#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

fail() {
  echo "[AEGIS][TEST][FATAL] $*" >&2
  exit 1
}

temp_dir="$(mktemp -d)"
repo="${temp_dir}/repo"
artifact="${temp_dir}/validation.json"

trap 'rm -rf "${temp_dir}"' EXIT

mkdir -p "${repo}/src"
printf 'export const version = 1;\n' > "${repo}/src/index.ts"
git -C "${repo}" init -q
git -C "${repo}" add .
git -C "${repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline

printf 'export const version = 2;\n' > "${repo}/src/index.ts"
git -C "${repo}" add src/index.ts
mkdir -p "${repo}/.harness/runtime"
base_commit="$(git -C "${repo}" rev-parse HEAD)"
jq -n --arg base "${base_commit}" '{schema:"aegis.mechanical_inventory.v1",baseCommit:$base}' \
  > "${repo}/.harness/runtime/mechanical_inventory.json"
inventory_digest="$(shasum -a 256 "${repo}/.harness/runtime/mechanical_inventory.json" | awk '{print $1}')"
jq -n '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:["src/index.ts"]}}' > "${artifact}"

bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${repo}" "${artifact}"
receipt="$(git -C "${repo}" rev-parse --path-format=absolute --git-path aegis/precommit_receipt.json)"
jq -e '
  .schema == "aegis.precommit_receipt.v1"
  and .status == "PROVEN"
  and .changeKind == "BASELINE"
  and .proofProfile == "fast"
  and (.executionId | test("^[a-f0-9]{64}$"))
  and (.issuedAtEpoch | type == "number")
  and (.verificationDurationMs | type == "number")
  and (.clarifiedDemandDigest | test("^[a-f0-9]{64}$"))
  and (.architecturePolicyDigest | test("^[a-f0-9]{64}$"))
  and .validationAuthority.kind == "deterministic_tribunal"
  and .supplementalEvidence.inventoryArtifactBytesDigest == $inventory
' --arg inventory "${inventory_digest}" "${receipt}" >/dev/null
git -C "${repo}" add src/index.ts
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" requires "${repo}"
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${repo}"

printf 'export const version = 3;\n' > "${repo}/src/index.ts"
git -C "${repo}" add src/index.ts
if bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${repo}" >/dev/null 2>&1; then
  fail "changed_staged_content_was_authorized"
fi

# The receipt is a commit-boundary control, not a source-directory heuristic.
# Moving orchestration logic outside src must not create a bypass.
printf 'evidence\n' > "${repo}/README.md"
git -C "${repo}" add README.md
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" requires "${repo}"

# A forensic contract may be promoted only through a forensic proof profile.
# This binds the independent preflight review to the eventual commit instead
# of treating it as a report that can be ignored after implementation.
forensic_repo="${temp_dir}/forensic-repo"
forensic_artifact="${temp_dir}/forensic-validation.json"
mkdir -p "${forensic_repo}/src/.aegis" "${forensic_repo}/governance"
cp "${ROOT_DIR}/governance/architecture.policy.json" "${forensic_repo}/governance/architecture.policy.json"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${forensic_repo}/ARCHITECTURE.md"
printf 'export const foo = 1;\n' > "${forensic_repo}/src/foo.ts"
printf 'export const other = 1;\n' > "${forensic_repo}/src/other.ts"
printf '#!/usr/bin/env bash\nexit 0\n' > "${forensic_repo}/src/foo.proof.sh"
chmod +x "${forensic_repo}/src/foo.proof.sh"
forensic_policy_digest="$(shasum -a 256 "${forensic_repo}/governance/architecture.policy.json" | awk '{print $1}')"
jq -n --arg policy "${forensic_policy_digest}" '
  {schema:"aegis.clarified_demand.v2",changeKind:"PRODUCT",normalizedDemandDigest:("a" * 64),intent:"Transição forense.",requirements:[{id:"REQ-STATE-001",statement:"A transição é atômica.",provenance:"USER"}],scope:{included:["src/foo.ts","src/other.ts","src/foo.proof.sh"],excluded:[]},inputCoverage:[{unitId:"UNIT-0001",disposition:"REQUIREMENT",requirementIds:["REQ-STATE-001"],rationale:"Requisito explícito."}],architecture:{policyDigest:$policy,ruleAssessments:[{ruleId:"ARCH-FAILURE-EXPLICIT",verdict:"APPLIED",evidence:"Estado atômico.",sourceUnitIds:["UNIT-0001"]},{ruleId:"ARCH-DETERMINISTIC-TIME",verdict:"NOT_APPLICABLE",evidence:"Sem tempo.",sourceUnitIds:[]}]}}' \
  > "${forensic_repo}/src/.aegis/clarified-demand.json"
forensic_clarified_digest="$(node --input-type=module -e 'const { canonicalDigest } = await import(process.cwd()+"/scripts/lib/canonical_json.mjs"); const fs = await import("node:fs"); process.stdout.write(canonicalDigest(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))))' "${forensic_repo}/src/.aegis/clarified-demand.json")"
forensic_review_digest="$(printf '%064d' 0 | tr '0' b)"
jq -n --arg clarified "${forensic_clarified_digest}" --arg policy "${forensic_policy_digest}" --arg review "${forensic_review_digest}" '
  {schema:"aegis.contract_ir.v2",changeKind:"PRODUCT",clarifiedDemandDigest:$clarified,architecture:{policyDigest:$policy,appliedRuleIds:["ARCH-FAILURE-EXPLICIT"],amendmentIds:[]},verification:{riskProfile:"forensic",independentReviewDigest:$review,adversarialClasses:["CONTINUITY","COMPOSITION","BOUNDARIES","OBSERVABILITY","ATOMICITY"]},stateModel:{kind:"STATE_TRANSITION",bindings:[{role:"STATE",statement:"Estado explícito.",requirementIds:["REQ-STATE-001"]},{role:"COMMAND",statement:"Comando explícito.",requirementIds:["REQ-STATE-001"]},{role:"RESOURCE",statement:"Recurso projetado.",requirementIds:["REQ-STATE-001"]},{role:"RESULT",statement:"Resultado observável.",requirementIds:["REQ-STATE-001"]},{role:"ATOMICITY",statement:"Publicação final.",requirementIds:["REQ-STATE-001"]}],governance:{authoritativeState:{statement:"A tabela interna é o estado autoritativo.",proofIds:["PO-STATE-BEHAVIOR"]},publicationAuthorities:[{operation:"process",kind:"TRANSITION",statement:"Somente process publica a transição validada.",proofIds:["PO-STATE-FORENSIC"]}],publicationBoundary:{statement:"A publicação ocorre após todas as etapas falíveis.",proofIds:["PO-STATE-FORENSIC"]},derivedObservables:[],digestIdentity:null}},scope:{authorizedPaths:["src/foo.ts","src/other.ts","src/foo.proof.sh"]},behavior:[{id:"BEH-STATE-001",statement:"A transição é observável."}],invariants:[{id:"INV-STATE-001",statement:"O estado preserva atomicidade.",proofIds:["PO-STATE-BEHAVIOR","PO-STATE-FORENSIC"]}],proofObligations:[{id:"PO-STATE-BEHAVIOR",risk:"transição básica",statement:"Provar comportamento."},{id:"PO-STATE-FORENSIC",risk:"interação adversarial",statement:"Provar rollback."}],requirementCoverage:[{requirementId:"REQ-STATE-001",contractIds:["BEH-STATE-001","INV-STATE-001","PO-STATE-BEHAVIOR","PO-STATE-FORENSIC"]}]}' \
  > "${forensic_repo}/src/.aegis/contract-ir.json"
jq -n '
  {schema:"aegis.proof_registry.v1",policy:{mode:"enforced",maxActiveProofsPerProfile:{fast:10,targeted:10,release:10,forensic:10}},profiles:[{id:"fast",proofIds:["PO-STATE-BEHAVIOR"]},{id:"targeted",proofIds:["PO-STATE-BEHAVIOR"]},{id:"release",proofIds:["PO-STATE-BEHAVIOR"]},{id:"forensic",proofIds:["PO-STATE-BEHAVIOR","PO-STATE-FORENSIC"]}],proofs:[{id:"PO-STATE-BEHAVIOR",risk:"transição básica",coverageKey:"state.behavior",authority:"fixture",cost:"low",cadence:"always",status:"active",targets:["src/foo.ts","src/foo.proof.sh"],executionKey:"state-behavior",executor:"bash",argv:["src/foo.proof.sh"]},{id:"PO-STATE-FORENSIC",risk:"interação adversarial",coverageKey:"state.forensic",authority:"fixture",cost:"high",cadence:"forensic",status:"active",targets:["src/foo.ts","src/foo.proof.sh"],executionKey:"state-forensic",executor:"bash",argv:["src/foo.proof.sh"]}]}' \
  > "${forensic_repo}/src/.aegis/proof-registry.json"
node --input-type=module - "${forensic_repo}/src/.aegis" "${ROOT_DIR}" <<'NODE'
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
const [directory, root] = process.argv.slice(2);
const { canonicalDigest } = await import(`${root}/scripts/lib/canonical_json.mjs`);
const clarifiedDemand = JSON.parse(readFileSync(`${directory}/clarified-demand.json`, 'utf8'));
const contract = JSON.parse(readFileSync(`${directory}/contract-ir.json`, 'utf8'));
const proofRegistry = JSON.parse(readFileSync(`${directory}/proof-registry.json`, 'utf8'));
const state = { schema: 'aegis.semantic_state.v1', clarifiedDemand, contract, proofRegistry };
state.digests = { clarifiedDemandSemanticDigest: canonicalDigest(clarifiedDemand), contractSemanticDigest: canonicalDigest(contract), proofRegistrySemanticDigest: canonicalDigest(proofRegistry) };
writeFileSync(`${directory}/semantic-state.json`, `${JSON.stringify(state)}\n`);
for (const name of ['clarified-demand.json', 'contract-ir.json', 'proof-registry.json']) rmSync(`${directory}/${name}`);
NODE
git -C "${forensic_repo}" init -q
git -C "${forensic_repo}" add .
git -C "${forensic_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline
printf 'export const other = 2;\n' > "${forensic_repo}/src/other.ts"
git -C "${forensic_repo}" add src/other.ts
jq -n '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:["src/other.ts"]}}' > "${forensic_artifact}"
if bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${forensic_repo}" "${forensic_artifact}" > /dev/null 2> "${temp_dir}/forensic.err"; then
  fail "forensic contract was promoted through a non-forensic profile"
fi
grep -q 'forensic_profile_required' "${temp_dir}/forensic.err"
git -C "${forensic_repo}" restore --staged --worktree src/other.ts
printf 'export const foo = 2;\n' > "${forensic_repo}/src/foo.ts"
git -C "${forensic_repo}" add src/foo.ts
jq -n '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:["src/foo.ts"]}}' > "${forensic_artifact}"
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${forensic_repo}" "${forensic_artifact}"
forensic_receipt="$(git -C "${forensic_repo}" rev-parse --path-format=absolute --git-path aegis/precommit_receipt.json)"
jq -e '.proofProfile == "forensic"' "${forensic_receipt}" >/dev/null

# The atomic semantic-state record is the only source of authority for new
# demands. Promotion must read its nested contract, proof registry and demand
# digests from both the index and the committed tree.
semantic_repo="${temp_dir}/semantic-state-repo"
mkdir -p "${semantic_repo}/src/.aegis" "${semantic_repo}/governance"
cp "${ROOT_DIR}/governance/architecture.policy.json" "${semantic_repo}/governance/architecture.policy.json"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${semantic_repo}/ARCHITECTURE.md"
printf 'export const semantic = 1;\n' > "${semantic_repo}/src/semantic.ts"
printf '#!/usr/bin/env bash\nexit 0\n' > "${semantic_repo}/src/semantic.proof.sh"
chmod +x "${semantic_repo}/src/semantic.proof.sh"
semantic_policy_digest="$(shasum -a 256 "${semantic_repo}/governance/architecture.policy.json" | awk '{print $1}')"
node --input-type=module - "${semantic_repo}/src/.aegis/semantic-state.json" "${semantic_policy_digest}" "${ROOT_DIR}" <<'NODE'
import { writeFileSync } from 'node:fs';
const [path, policyDigest, root] = process.argv.slice(2);
const { canonicalDigest } = await import(`${root}/scripts/lib/canonical_json.mjs`);
const clarifiedDemand = {
  schema: 'aegis.clarified_demand.v2', changeKind: 'PRODUCT', normalizedDemandDigest: 'c'.repeat(64),
  intent: 'Estado semântico atômico.', requirements: [{ id: 'REQ-SEMANTIC-001', statement: 'A prova é executável.', provenance: 'USER' }],
  scope: { included: ['src/semantic.ts', 'src/semantic.proof.sh', 'src/.aegis/semantic-state.json'], excluded: [] },
  inputCoverage: [{ unitId: 'UNIT-0001', disposition: 'REQUIREMENT', requirementIds: ['REQ-SEMANTIC-001'], rationale: 'Requisito explícito.' }],
  architecture: { policyDigest, ruleAssessments: [{ ruleId: 'ARCH-FAILURE-EXPLICIT', verdict: 'NOT_APPLICABLE', evidence: 'Sem falha especial.', sourceUnitIds: [] }] },
};
const contract = {
  schema: 'aegis.contract_ir.v2', changeKind: 'PRODUCT', clarifiedDemandDigest: canonicalDigest(clarifiedDemand),
  architecture: { policyDigest, appliedRuleIds: [], amendmentIds: [] }, verification: { riskProfile: 'standard' }, stateModel: { kind: 'NONE', bindings: [] },
  scope: { authorizedPaths: ['src/semantic.ts', 'src/semantic.proof.sh', 'src/.aegis/semantic-state.json'] },
  behavior: [{ id: 'BEH-SEMANTIC-001', statement: 'A prova é executável.' }], invariants: [{ id: 'INV-SEMANTIC-001', statement: 'A prova permanece vinculada.', proofIds: ['PO-SEMANTIC-001'] }],
  proofObligations: [{ id: 'PO-SEMANTIC-001', risk: 'prova ausente', statement: 'Executar a prova declarada.' }],
  requirementCoverage: [{ requirementId: 'REQ-SEMANTIC-001', contractIds: ['BEH-SEMANTIC-001', 'INV-SEMANTIC-001', 'PO-SEMANTIC-001'] }],
};
const proofRegistry = {
  schema: 'aegis.proof_registry.v1', policy: { mode: 'enforced', maxActiveProofsPerProfile: { fast: 10, targeted: 10, release: 10, forensic: 10 } },
  profiles: ['fast', 'targeted', 'release', 'forensic'].map((id) => ({ id, proofIds: ['PO-SEMANTIC-001'] })),
  proofs: [{ id: 'PO-SEMANTIC-001', risk: 'prova ausente', coverageKey: 'semantic.proof', authority: 'fixture', cost: 'low', cadence: 'always', status: 'active', targets: ['src/semantic.ts', 'src/semantic.proof.sh'], executionKey: 'semantic-proof', executor: 'bash', argv: ['src/semantic.proof.sh'] }],
};
const state = { schema: 'aegis.semantic_state.v1', clarifiedDemand, contract, proofRegistry };
state.digests = { clarifiedDemandSemanticDigest: canonicalDigest(clarifiedDemand), contractSemanticDigest: canonicalDigest(contract), proofRegistrySemanticDigest: canonicalDigest(proofRegistry) };
writeFileSync(path, `${JSON.stringify(state)}\n`);
NODE
git -C "${semantic_repo}" init -q
git -C "${semantic_repo}" add .
git -C "${semantic_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline
printf 'export const semantic = 2;\n' > "${semantic_repo}/src/semantic.ts"
git -C "${semantic_repo}" add src/semantic.ts
jq -n '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:["src/semantic.ts"]}}' > "${temp_dir}/semantic-validation.json"
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${semantic_repo}" "${temp_dir}/semantic-validation.json"
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${semantic_repo}"
git -C "${semantic_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm semantic
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify-commit "${semantic_repo}"
rm -f "${semantic_repo}/src/semantic.ts" "${semantic_repo}/src/semantic.proof.sh" "${semantic_repo}/src/.aegis/semantic-state.json"
printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${semantic_repo}/src/index.ts"
git -C "${semantic_repo}" add -A
if bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" requires "${semantic_repo}"; then
  fail "semantic_complete_baseline_reset_still_required_a_receipt"
fi

# A universal harness baseline has no product contract or proof registry yet,
# but it still needs a receipt before its own scripts can be promoted.
baseline_repo="${temp_dir}/baseline-repo"
mkdir -p "${baseline_repo}/src"
printf 'export const version = 1;\n' > "${baseline_repo}/src/index.ts"
git -C "${baseline_repo}" init -q
git -C "${baseline_repo}" add .
git -C "${baseline_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline

printf 'export const version = 2;\n' > "${baseline_repo}/src/index.ts"
git -C "${baseline_repo}" add src/index.ts
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${baseline_repo}"
baseline_receipt="$(git -C "${baseline_repo}" rev-parse --path-format=absolute --git-path aegis/precommit_receipt.json)"
jq -e '.proofProfile == "fast" and (.proofs | length) == 0' "${baseline_receipt}" >/dev/null
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${baseline_repo}"

# A governed product may coexist with harness maintenance, but both transitions
# must receive distinct, explicit receipts. HARNESS cannot authorize src/.
harness_repo="${temp_dir}/harness-repo"
mkdir -p "${harness_repo}/src/.aegis" "${harness_repo}/governance" "${harness_repo}/scripts"
cp "${ROOT_DIR}/governance/architecture.policy.json" "${harness_repo}/governance/architecture.policy.json"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${harness_repo}/ARCHITECTURE.md"
git -C "${semantic_repo}" show HEAD:src/.aegis/semantic-state.json > "${harness_repo}/src/.aegis/semantic-state.json"
printf 'export const semantic = 1;\n' > "${harness_repo}/src/semantic.ts"
printf '#!/usr/bin/env bash\nexit 0\n' > "${harness_repo}/src/semantic.proof.sh"
chmod +x "${harness_repo}/src/semantic.proof.sh"
printf 'echo baseline\n' > "${harness_repo}/scripts/marker.sh"
git -C "${harness_repo}" init -q
git -C "${harness_repo}" add .
git -C "${harness_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline
printf 'echo governed-harness\n' > "${harness_repo}/scripts/marker.sh"
git -C "${harness_repo}" add scripts/marker.sh
jq -n '{mode:"validation",changeKind:"HARNESS",verdict:"accepted",validated_candidate:{files_changed:["scripts/marker.sh"]}}' > "${temp_dir}/harness-validation.json"
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${harness_repo}" "${temp_dir}/harness-validation.json"
harness_receipt="$(git -C "${harness_repo}" rev-parse --path-format=absolute --git-path aegis/precommit_receipt.json)"
jq -e '.changeKind == "HARNESS" and .validationAuthority.id == "harness_validation.v1"' "${harness_receipt}" >/dev/null
bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${harness_repo}"
git -C "${harness_repo}" restore --staged scripts/marker.sh
printf 'export const semantic = 2;\n' > "${harness_repo}/src/semantic.ts"
git -C "${harness_repo}" add src/semantic.ts
jq -n '{mode:"validation",changeKind:"HARNESS",verdict:"accepted",validated_candidate:{files_changed:["src/semantic.ts"]}}' > "${temp_dir}/invalid-harness-validation.json"
if bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${harness_repo}" "${temp_dir}/invalid-harness-validation.json" >/dev/null 2>&1; then
  fail "harness_authorized_product_path"
fi

# A direct VS Code commit must renew a stale or missing receipt through the
# hook. The operator should never have to race a 15-minute expiry window.
hook_repo="${temp_dir}/hook-repo"
mkdir -p "${hook_repo}/src" "${hook_repo}/.githooks" "${hook_repo}/scripts/lib"
for file_name in \
  aegis \
  .githooks/pre-commit \
  .githooks/post-commit \
  scripts/ide_gateway.sh \
  scripts/contract_evidence_gate.sh \
  scripts/formal_promotion_authorization.sh \
  scripts/proof_governance.sh \
  scripts/proof_runner.sh \
  scripts/lib/proof_governance.sh; do
  mkdir -p "${hook_repo}/$(dirname "${file_name}")"
  cp "${ROOT_DIR}/${file_name}" "${hook_repo}/${file_name}"
done
chmod +x "${hook_repo}/aegis" "${hook_repo}/.githooks/pre-commit" "${hook_repo}/.githooks/post-commit"
printf 'export const version = 1;\n' > "${hook_repo}/src/index.ts"
printf '{"scripts":{}}\n' > "${hook_repo}/package.json"
git -C "${hook_repo}" init -q
git -C "${hook_repo}" add .
git -C "${hook_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline
git -C "${hook_repo}" config core.hooksPath .githooks
printf 'export const version = 2;\n' > "${hook_repo}/src/index.ts"
git -C "${hook_repo}" add src/index.ts
git -C "${hook_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm promoted
[[ "$(git -C "${hook_repo}" log -1 --format=%s)" == "promoted" ]] || fail "hook_did_not_authorize_direct_commit"
postcommit_receipt="$(git -C "${hook_repo}" rev-parse --path-format=absolute --git-path aegis/postcommit_receipt.json)"
jq -e '.schema == "aegis.postcommit_receipt.v1" and .status == "PROVEN" and (.executionId | length) == 64' "${postcommit_receipt}" >/dev/null
if git -C "${hook_repo}" ls-files .harness/runtime | grep -q .; then
  fail "transient_runtime_artifact_was_staged"
fi

# Staging a file and then modifying it further on disk (e.g. IDE auto-save or
# format) must synchronize and promote without baseline_worktree_index_mismatch.
printf 'export const version = 3;\n' > "${hook_repo}/src/index.ts"
git -C "${hook_repo}" add src/index.ts
printf 'export const version = 4;\n' > "${hook_repo}/src/index.ts"
git -C "${hook_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm "promoted-with-worktree-sync"
[[ "$(git -C "${hook_repo}" log -1 --format=%s)" == "promoted-with-worktree-sync" ]] || fail "worktree_sync_commit_failed"
[[ "$(git -C "${hook_repo}" show HEAD:src/index.ts)" == $'export const version = 4;' ]] || fail "committed_content_not_synced"
AEGIS_ROOT="${hook_repo}" node "${ROOT_DIR}/scripts/forensic_report.mjs" \
  | jq -e '.schema == "aegis.forensic_report.v1" and .status == "PROVEN" and .transition.worktreeClean == true' >/dev/null

# Report telemetry keeps the two digest domains distinct; a byte digest must
# never disappear because a legacy field name is still being read.
mkdir -p "${hook_repo}/.harness/runtime"
hook_execution="$(jq -r '.executionId' "$(git -C "${hook_repo}" rev-parse --path-format=absolute --git-path aegis/precommit_receipt.json)")"
jq -n --arg execution "${hook_execution}" \
  '{executionId:$execution,timing:{durationMs:1},semantic:{decisionArtifactBytesDigest:("a" * 64),decisionSemanticDigest:("b" * 64)}}' \
  > "${hook_repo}/.harness/runtime/finalization.json"
AEGIS_ROOT="${hook_repo}" node "${ROOT_DIR}/scripts/forensic_report.mjs" \
  | jq -e '.evidence.semantic.decisionArtifactBytesDigest == ("a" * 64) and .evidence.semantic.decisionSemanticDigest == ("b" * 64)' >/dev/null

echo "[PASS] formal promotion authorization"
