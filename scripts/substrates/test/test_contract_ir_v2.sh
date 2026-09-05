#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="${ROOT_DIR}/scratch/contract-ir-v2"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$WORK_DIR/.harness"
policy_digest="$(shasum -a 256 "$ROOT_DIR/governance/architecture.policy.json" | awk '{print $1}')"
cat > "$WORK_DIR/.harness/active_clarified_demand.json" <<EOF
{"schema":"aegis.clarified_demand.v2","normalizedDemandDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","intent":"Exportar HealthStatus.","requirements":[{"id":"REQ-HEALTH-001","statement":"Exportar HealthStatus em src/index.ts.","provenance":"USER"}],"scope":{"included":["src/index.ts"],"excluded":[]},"inputCoverage":[{"unitId":"UNIT-0001","disposition":"REQUIREMENT","requirementIds":["REQ-HEALTH-001"],"rationale":"Requisito explícito."}],"architecture":{"policyDigest":"${policy_digest}","ruleAssessments":[{"ruleId":"ARCH-FAILURE-EXPLICIT","verdict":"NOT_APPLICABLE","evidence":"Sem efeito externo.","sourceUnitIds":[]},{"ruleId":"ARCH-DETERMINISTIC-TIME","verdict":"NOT_APPLICABLE","evidence":"Sem tempo.","sourceUnitIds":[]}]}}
EOF
clarified_digest="$(node --input-type=module -e 'const { canonicalDigest } = await import(process.cwd()+"/scripts/lib/canonical_json.mjs"); const fs = await import("node:fs"); process.stdout.write(canonicalDigest(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))))' "$WORK_DIR/.harness/active_clarified_demand.json")"
cat > "$WORK_DIR/.harness/proof_registry.json" <<'EOF'
{"proofs":[{"id":"PO-HEALTH-001"}]}
EOF
jq -n --arg clarified "$clarified_digest" --arg policy "$policy_digest" '{schema:"aegis.contract_ir.v2",clarifiedDemandDigest:$clarified,architecture:{policyDigest:$policy,appliedRuleIds:[],amendmentIds:[]},scope:{authorizedPaths:["src/index.ts"]},behavior:[{id:"BEH-HEALTH-001",statement:"HealthStatus é exportado."}],invariants:[{id:"INV-HEALTH-001",statement:"A exportação é somente de tipo.",proofIds:["PO-HEALTH-001"]}],proofObligations:[{id:"PO-HEALTH-001",risk:"superfície pública incorreta",statement:"A exportação é verificável."}],requirementCoverage:[{requirementId:"REQ-HEALTH-001",contractIds:["BEH-HEALTH-001","INV-HEALTH-001","PO-HEALTH-001"]}]}' > "$WORK_DIR/.harness/active_contract_ir.json"
mkdir -p "$WORK_DIR/governance" "$WORK_DIR/src"
cp "$ROOT_DIR/governance/architecture.policy.json" "$WORK_DIR/governance/architecture.policy.json"
cp "$ROOT_DIR/ARCHITECTURE.md" "$WORK_DIR/ARCHITECTURE.md"
cp "$ROOT_DIR/src/index.ts" "$WORK_DIR/src/index.ts"
node "$ROOT_DIR/scripts/validate_contract_ir_v2.mjs" --root "$WORK_DIR" >/dev/null

node --input-type=module - "$WORK_DIR" <<'NODE'
import { readFileSync } from 'node:fs';
const work = process.argv[2];
const { validateContract } = await import(process.cwd() + '/scripts/lib/contract_validator.mjs');
const { canonicalDigest } = await import(process.cwd() + '/scripts/lib/canonical_json.mjs');
const previousContract = JSON.parse(readFileSync(work + '/.harness/active_contract_ir.json', 'utf8'));
const clarified = JSON.parse(readFileSync(work + '/.harness/active_clarified_demand.json', 'utf8'));
const policyText = readFileSync(work + '/governance/architecture.policy.json', 'utf8');
const policy = JSON.parse(policyText);
const mismatchedScope = structuredClone(previousContract);
mismatchedScope.scope.authorizedPaths.push('README.md');
let scopeRejected = false;
try {
  validateContract({ root: work, contract: mismatchedScope, clarified, policy, policyText, previousContract, phase: 'compile' });
} catch (error) {
  scopeRejected = error instanceof Error && error.message === 'scope_binding_mismatch';
}
if (!scopeRejected) throw new Error('scope mismatch was accepted');
const nextContract = structuredClone(previousContract);
const nextClarified = structuredClone(clarified);
nextClarified.scope.included = ['src/health.ts'];
nextContract.clarifiedDemandDigest = canonicalDigest(nextClarified);
nextContract.scope.authorizedPaths = ['src/health.ts'];
nextContract.invariants[0].proofIds = ['PO-HEALTH-002'];
nextContract.proofObligations = [{ id: 'PO-HEALTH-002', risk: 'superfície pública incorreta', statement: 'A nova exportação é verificável.' }];
nextContract.requirementCoverage[0].contractIds = ['BEH-HEALTH-001', 'INV-HEALTH-001', 'PO-HEALTH-002'];
let rejected = false;
try {
  validateContract({ root: work, contract: nextContract, clarified: nextClarified, policy, policyText, previousContract, phase: 'compile' });
} catch (error) {
  rejected = error instanceof Error && error.message === 'target_retirement_undeclared:src/index.ts';
}
if (!rejected) throw new Error('undeclared continuity was accepted');
nextContract.continuity = {
  retirements: [
    { kind: 'target', id: 'src/index.ts', reason: 'Escopo substituído.', demandEvidence: 'Demanda esclarecida.' },
    { kind: 'proof', id: 'PO-HEALTH-001', reason: 'Prova substituída.', demandEvidence: 'Demanda esclarecida.', successor: 'PO-HEALTH-002' },
  ],
};
validateContract({ root: work, contract: nextContract, clarified: nextClarified, policy, policyText, previousContract, phase: 'compile' });
NODE

jq '.requirementCoverage[0].contractIds = ["INV-UNKNOWN-001"]' "$WORK_DIR/.harness/active_contract_ir.json" > "$WORK_DIR/invalid.json"
mv "$WORK_DIR/invalid.json" "$WORK_DIR/.harness/active_contract_ir.json"
if node "$ROOT_DIR/scripts/validate_contract_ir_v2.mjs" --root "$WORK_DIR" >/dev/null 2>&1; then
  echo 'contract validator accepted unknown requirement mapping' >&2
  exit 1
fi

echo '[AEGIS][TEST] contract ir v2: PASS'
