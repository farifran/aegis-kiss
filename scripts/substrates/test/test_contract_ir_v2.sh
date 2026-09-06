#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="${ROOT_DIR}/scratch/contract-ir-v2"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

mkdir -p "${WORK_DIR}/src/.aegis" "${WORK_DIR}/governance" "${WORK_DIR}/src"
cp "${ROOT_DIR}/governance/architecture.policy.json" "${WORK_DIR}/governance/architecture.policy.json"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${WORK_DIR}/ARCHITECTURE.md"
cp "${ROOT_DIR}/src/index.ts" "${WORK_DIR}/src/index.ts"
policy_digest="$(shasum -a 256 "${WORK_DIR}/governance/architecture.policy.json" | awk '{print $1}')"

node --input-type=module - "${WORK_DIR}/src/.aegis/semantic-state.json" "${ROOT_DIR}" "${policy_digest}" <<'NODE'
import { writeFileSync } from 'node:fs';
const [path, root, policyDigest] = process.argv.slice(2);
const { canonicalDigest } = await import(`${root}/scripts/lib/canonical_json.mjs`);
const clarifiedDemand = {
  schema: 'aegis.clarified_demand.v2', changeKind: 'PRODUCT', normalizedDemandDigest: 'a'.repeat(64),
  intent: 'Exportar HealthStatus.', requirements: [{ id: 'REQ-HEALTH-001', statement: 'Exportar HealthStatus em src/index.ts.', provenance: 'USER' }],
  scope: { included: ['src/index.ts'], excluded: [] },
  inputCoverage: [{ unitId: 'UNIT-0001', disposition: 'REQUIREMENT', requirementIds: ['REQ-HEALTH-001'], rationale: 'Requisito explícito.' }],
  architecture: { policyDigest, ruleAssessments: [
    { ruleId: 'ARCH-FAILURE-EXPLICIT', verdict: 'NOT_APPLICABLE', evidence: 'Sem efeito externo.', sourceUnitIds: [] },
    { ruleId: 'ARCH-DETERMINISTIC-TIME', verdict: 'NOT_APPLICABLE', evidence: 'Sem tempo.', sourceUnitIds: [] },
  ] },
};
const contract = {
  schema: 'aegis.contract_ir.v2', changeKind: 'PRODUCT', clarifiedDemandDigest: canonicalDigest(clarifiedDemand),
  architecture: { policyDigest, appliedRuleIds: [], amendmentIds: [] }, scope: { authorizedPaths: ['src/index.ts'] },
  behavior: [{ id: 'BEH-HEALTH-001', statement: 'HealthStatus é exportado.' }],
  invariants: [{ id: 'INV-HEALTH-001', statement: 'A exportação é somente de tipo.', proofIds: ['PO-HEALTH-001'] }],
  proofObligations: [{ id: 'PO-HEALTH-001', risk: 'superfície pública incorreta', statement: 'A exportação é verificável.' }],
  requirementCoverage: [{ requirementId: 'REQ-HEALTH-001', contractIds: ['BEH-HEALTH-001', 'INV-HEALTH-001', 'PO-HEALTH-001'] }],
};
const proofRegistry = { proofs: [{ id: 'PO-HEALTH-001' }] };
const state = { schema: 'aegis.semantic_state.v1', clarifiedDemand, contract, proofRegistry };
state.digests = { clarifiedDemandSemanticDigest: canonicalDigest(clarifiedDemand), contractSemanticDigest: canonicalDigest(contract), proofRegistrySemanticDigest: canonicalDigest(proofRegistry) };
writeFileSync(path, `${JSON.stringify(state)}\n`);
NODE

node "${ROOT_DIR}/scripts/validate_contract_ir_v2.mjs" --root "${WORK_DIR}" >/dev/null

node --input-type=module - "${WORK_DIR}" "${ROOT_DIR}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [work, root] = process.argv.slice(2);
const { validateContract } = await import(`${root}/scripts/lib/contract_validator.mjs`);
const { canonicalDigest } = await import(`${root}/scripts/lib/canonical_json.mjs`);
const statePath = `${work}/src/.aegis/semantic-state.json`;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const policyText = readFileSync(`${work}/governance/architecture.policy.json`, 'utf8');
const policy = JSON.parse(policyText);
const mismatchedScope = structuredClone(state.contract);
mismatchedScope.scope.authorizedPaths.push('README.md');
let scopeRejected = false;
try { validateContract({ root: work, contract: mismatchedScope, clarified: state.clarifiedDemand, policy, policyText, previousContract: state.contract, phase: 'compile' }); }
catch (error) { scopeRejected = error instanceof Error && error.message === 'scope_binding_mismatch'; }
if (!scopeRejected) throw new Error('scope mismatch was accepted');
const nextContract = structuredClone(state.contract);
const nextClarified = structuredClone(state.clarifiedDemand);
nextClarified.scope.included = ['src/health.ts'];
nextContract.clarifiedDemandDigest = canonicalDigest(nextClarified);
nextContract.scope.authorizedPaths = ['src/health.ts'];
nextContract.invariants[0].proofIds = ['PO-HEALTH-002'];
nextContract.proofObligations = [{ id: 'PO-HEALTH-002', risk: 'superfície pública incorreta', statement: 'A nova exportação é verificável.' }];
nextContract.requirementCoverage[0].contractIds = ['BEH-HEALTH-001', 'INV-HEALTH-001', 'PO-HEALTH-002'];
let rejected = false;
try { validateContract({ root: work, contract: nextContract, clarified: nextClarified, policy, policyText, previousContract: state.contract, phase: 'compile' }); }
catch (error) { rejected = error instanceof Error && error.message === 'target_retirement_undeclared:src/index.ts'; }
if (!rejected) throw new Error('undeclared continuity was accepted');
nextContract.continuity = { retirements: [{ kind: 'target', id: 'src/index.ts', reason: 'Escopo substituído.', demandEvidence: 'Demanda esclarecida.' }, { kind: 'proof', id: 'PO-HEALTH-001', reason: 'Prova substituída.', demandEvidence: 'Demanda esclarecida.', successor: 'PO-HEALTH-002' }] };
validateContract({ root: work, contract: nextContract, clarified: nextClarified, policy, policyText, previousContract: state.contract, phase: 'compile' });
state.contract.requirementCoverage[0].contractIds = ['INV-UNKNOWN-001'];
state.digests.contractSemanticDigest = canonicalDigest(state.contract);
writeFileSync(statePath, `${JSON.stringify(state)}\n`);
NODE

if node "${ROOT_DIR}/scripts/validate_contract_ir_v2.mjs" --root "${WORK_DIR}" >/dev/null 2>&1; then
  echo 'contract validator accepted unknown requirement mapping' >&2
  exit 1
fi

echo '[AEGIS][TEST] contract ir v2: PASS'
