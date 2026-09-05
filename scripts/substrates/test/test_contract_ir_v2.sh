#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="${ROOT_DIR}/scratch/contract-ir-v2"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$WORK_DIR/.harness"
cat > "$WORK_DIR/.harness/active_clarified_demand.json" <<'EOF'
{"schema":"aegis.clarified_demand.v1","normalizedDemandDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","intent":"Exportar HealthStatus.","requirements":[{"id":"REQ-HEALTH-001","statement":"Exportar HealthStatus em src/index.ts.","provenance":"USER"}],"scope":{"included":["src/index.ts"],"excluded":[]}}
EOF
clarified_digest="$(node -e 'const fs=require("fs"),crypto=require("crypto"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"))' "$WORK_DIR/.harness/active_clarified_demand.json")"
policy_digest="$(shasum -a 256 "$ROOT_DIR/governance/architecture.policy.json" | awk '{print $1}')"
cat > "$WORK_DIR/.harness/proof_registry.json" <<'EOF'
{"proofs":[{"id":"PO-HEALTH-001"}]}
EOF
jq -n --arg clarified "$clarified_digest" --arg policy "$policy_digest" '{schema:"aegis.contract_ir.v2",clarifiedDemandDigest:$clarified,architecture:{policyDigest:$policy,appliedRuleIds:[],amendmentIds:[]},scope:{authorizedPaths:["src/index.ts"]},behavior:[{id:"BEH-HEALTH-001",statement:"HealthStatus é exportado."}],invariants:[{id:"INV-HEALTH-001",statement:"A exportação é somente de tipo.",proofIds:["PO-HEALTH-001"]}],proofObligations:[{id:"PO-HEALTH-001",risk:"superfície pública incorreta",statement:"A exportação é verificável."}],requirementCoverage:[{requirementId:"REQ-HEALTH-001",contractIds:["BEH-HEALTH-001","INV-HEALTH-001","PO-HEALTH-001"]}]}' > "$WORK_DIR/.harness/active_contract_ir.json"
mkdir -p "$WORK_DIR/governance" "$WORK_DIR/src"
cp "$ROOT_DIR/governance/architecture.policy.json" "$WORK_DIR/governance/architecture.policy.json"
cp "$ROOT_DIR/ARCHITECTURE.md" "$WORK_DIR/ARCHITECTURE.md"
cp "$ROOT_DIR/src/index.ts" "$WORK_DIR/src/index.ts"
node "$ROOT_DIR/scripts/validate_contract_ir_v2.mjs" --root "$WORK_DIR" >/dev/null

jq '.requirementCoverage[0].contractIds = ["INV-UNKNOWN-001"]' "$WORK_DIR/.harness/active_contract_ir.json" > "$WORK_DIR/invalid.json"
mv "$WORK_DIR/invalid.json" "$WORK_DIR/.harness/active_contract_ir.json"
if node "$ROOT_DIR/scripts/validate_contract_ir_v2.mjs" --root "$WORK_DIR" >/dev/null 2>&1; then
  echo 'contract validator accepted unknown requirement mapping' >&2
  exit 1
fi

echo '[AEGIS][TEST] contract ir v2: PASS'
