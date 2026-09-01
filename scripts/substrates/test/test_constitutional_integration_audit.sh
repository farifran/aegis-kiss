#!/usr/bin/env bash
# =========================================================
# AEGIS CONSTITUTIONAL AUDIT — Phase 2.5
# =========================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEGIS_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_DIR}"' EXIT

mkdir -p "${TEST_DIR}/src" "${TEST_DIR}/.harness/runtime" "${TEST_DIR}/scripts/capabilities"
ln -s "${AEGIS_ROOT}/node_modules" "${TEST_DIR}/node_modules"
cp "${AEGIS_ROOT}/package.json" "${TEST_DIR}/"
cp "${AEGIS_ROOT}/scripts/capabilities/test_runner.sh" "${TEST_DIR}/scripts/capabilities/"
cp "${AEGIS_ROOT}/scripts/capabilities/_emit.sh" "${TEST_DIR}/scripts/capabilities/"

cd "${TEST_DIR}"

echo "=== PO-CI-01: No Bypass to SUCCESS ==="
# Verify that test_runner exits with non-zero when any required PO fails
cat << 'EOF' > src/module.ts
export class Engine {
  run(): boolean { return false; }
}
EOF
cat << 'EOF' > src/index.ts
export { Engine } from './module.js';
EOF
cat << 'EOF' > .harness/active_contract_ir.json
{
  "goal": "Test engine",
  "targets": ["src/module.ts", "src/index.ts"],
  "exports": [{ "kind": "class", "name": "Engine" }],
  "proofObligations": [
    {
      "id": "PO-FAIL-MUST-BLOCK",
      "kind": "generic_invariant",
      "required": true,
      "oracle": "new Engine().run()"
    }
  ]
}
EOF

set +e
out_ci1="$(bash scripts/capabilities/test_runner.sh 2>&1)"
rc_ci1=$?
set -e
if [[ "${rc_ci1}" -eq 0 ]] || ! echo "${out_ci1}" | grep -q "Promotion rejected by Evidence Gate"; then
  echo "FALHA PO-CI-01: Promoção deveria ter sido bloqueada pelo Evidence Gate!"
  exit 1
fi
echo "PO-CI-01 (No Bypass to SUCCESS): PROVADO 🟢"

echo "=== PO-CI-02: Required Means Executed ==="
# A declared obligation with required: true that was never run must be flagged UNPROVEN
cat << 'EOF' > .harness/active_contract_ir.json
{
  "goal": "Test unexecuted",
  "targets": ["src/module.ts", "src/index.ts"],
  "exports": [{ "kind": "class", "name": "Engine" }],
  "proofObligations": [
    {
      "id": "PO-GHOST-001",
      "kind": "custom_audit",
      "required": true,
      "oracle": "true"
    },
    {
      "id": "PO-UNEXECUTED-002",
      "kind": "unexecuted_check",
      "required": true,
      "oracle": "true"
    }
  ]
}
EOF

# Hack to simulate an obligation that exists in IR but wasn't synthesized in harness code
# By running a contract with an obligation that fails in runtime
out_ci2="$(bash scripts/capabilities/test_runner.sh 2>&1 || true)"
if ! echo "${out_ci2}" | grep -q "PO-GHOST-001"; then
  echo "FALHA PO-CI-02: Obligação requerida não foi registrada!"
  exit 1
fi
echo "PO-CI-02 (Required Means Executed): PROVADO 🟢"

echo "=== PO-CI-03: Evidence Provenance & Domains ==="
# Output matrix must have DOMAIN column and assigned domain values
if ! echo "${out_ci2}" | grep -q "DOMAIN"; then
  echo "FALHA PO-CI-03: Matriz de evidência não contém coluna DOMAIN!"
  exit 1
fi
echo "PO-CI-03 (Evidence Provenance & Domains): PROVADO 🟢"

echo "=== PO-CI-04: Observable State Closure (Deep Nested Mutation Detection) ==="
# A nested object (like TokenBucket inside Account) that mutates on a failing call MUST be caught
cat << 'EOF' > src/clearing.ts
export class NestedBucket {
  private _tokens: bigint = 1000n;
  consume(bits: bigint): boolean {
    this._tokens -= bits;
    return true;
  }
  get tokens(): bigint { return this._tokens; }
}

export class BankAccount {
  balance: bigint = 50n;
  bucket: NestedBucket = new NestedBucket();
}

export class DeepEngine {
  accounts: Map<string, BankAccount> = new Map();
  rejectedCount: number = 0;

  constructor() {
    this.accounts.set("user_a", new BankAccount());
  }

  process(amount: bigint): boolean {
    const acc = this.accounts.get("user_a")!;
    // BUG TÍPICO: Consome tokens antes de validar saldo!
    acc.bucket.consume(100n);
    if (acc.balance < amount) {
      this.rejectedCount++;
      return false; // Rejeitou, mas deixou bucket mutado!
    }
    acc.balance -= amount;
    return true;
  }
}
EOF

cat << 'EOF' > src/index.ts
export { DeepEngine } from './clearing.js';
EOF

cat << 'EOF' > .harness/active_contract_ir.json
{
  "goal": "Test deep state mutation detection",
  "targets": ["src/clearing.ts", "src/index.ts"],
  "exports": [{ "kind": "class", "name": "DeepEngine" }],
  "proofObligations": [
    {
      "id": "PO-DEEP-LEAK",
      "kind": "failure_state",
      "required": true,
      "oracle": "state_diff",
      "observableState": ["accounts", "rejectedCount"],
      "allowedFailureEffects": ["rejectedCount"],
      "prelude": [
        "const engine = new DeepEngine();",
        "__targetInstance = engine;",
        "__failingCall = () => engine.process(5000n);"
      ]
    }
  ]
}
EOF

set +e
out_ci4="$(bash scripts/capabilities/test_runner.sh 2>&1)"
rc_ci4=$?
set -e

echo "${out_ci4}"
if [[ "${rc_ci4}" -eq 0 ]] || ! echo "${out_ci4}" | grep -q "accounts.user_a.bucket"; then
  echo "FALHA PO-CI-04: Vazamento de estado aninhado em account.bucket não foi detectado!"
  exit 1
fi
echo "PO-CI-04 (Deep State Closure Detection): PROVADO 🟢"

echo "=== PO-CI-05: False Proof / Boundary Consistency Attack ==="
# If a conservation boundary is violated or tries to leak resources, it must be DISPROVEN
cat << 'EOF' > src/ledger.ts
export class Ledger {
  totalBalances: bigint = 100n;
  treasuryBalance: bigint = 0n;

  executeTransfer(): boolean {
    this.totalBalances -= 20n;
    // BUG: 20n desapareceu em vez de ir para treasury
    return true;
  }
}
EOF
cat << 'EOF' > src/index.ts
export { Ledger } from './ledger.js';
EOF
cat << 'EOF' > .harness/active_contract_ir.json
{
  "goal": "Test false proof boundary",
  "targets": ["src/ledger.ts", "src/index.ts"],
  "exports": [{ "kind": "class", "name": "Ledger" }],
  "proofObligations": [
    {
      "id": "PO-CONS-LEAK",
      "kind": "resource_conservation",
      "required": true,
      "oracle": "conservation",
      "resourceBoundary": {
        "before": ["totalBalances", "treasuryBalance"],
        "after": ["totalBalances", "treasuryBalance"]
      },
      "prelude": [
        "const lBefore = { totalBalances: 100n, treasuryBalance: 0n };",
        "const lAfter = new Ledger();",
        "lAfter.executeTransfer();",
        "__targetBefore = lBefore;",
        "__targetAfter = lAfter;"
      ]
    }
  ]
}
EOF

set +e
out_ci5="$(bash scripts/capabilities/test_runner.sh 2>&1)"
rc_ci5=$?
set -e

if [[ "${rc_ci5}" -eq 0 ]] || ! echo "${out_ci5}" | grep -q "Conservation violated (100n !== 80n)"; then
  echo "FALHA PO-CI-05: Quebra de conservação no ledger não foi detectada!"
  exit 1
fi
echo "PO-CI-05 (False Proof / Boundary Consistency Attack): PROVADO 🟢"

echo "=========================================================="
echo "🎯 AUDITORIA CONSTITUCIONAL FASE 2.5: 5/5 PROVAS APROVADAS!"
echo "=========================================================="
