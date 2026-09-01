#!/usr/bin/env bash
# =========================================================
# AEGIS TEST — Evidence Compiler & Deterministic Oracles
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

echo "=== 1. Testando Caso A (PASS: Tipagem + State Diff + Conservação Válida) ==="
cat << 'EOF' > src/wallet.ts
export class Wallet {
  private _balance: bigint;
  private _treasury: bigint;
  private _rejectedCount: number;

  constructor(initial: bigint) {
    this._balance = initial;
    this._treasury = 0n;
    this._rejectedCount = 0;
  }

  transferTo(receiver: Wallet, amount: bigint, fee: bigint): boolean {
    if (amount <= 0n || fee < 0n || this._balance < (amount + fee)) {
      this._rejectedCount++;
      return false;
    }
    this._balance -= (amount + fee);
    receiver._balance += amount;
    this._treasury += fee;
    return true;
  }

  get balance(): bigint { return this._balance; }
  get treasury(): bigint { return this._treasury; }
  get rejectedCount(): number { return this._rejectedCount; }
}
EOF

cat << 'EOF' > src/index.ts
export { Wallet } from './wallet.js';
EOF

cat << 'EOF' > .harness/active_contract_ir.json
{
  "goal": "Test wallet",
  "targets": ["src/wallet.ts", "src/index.ts"],
  "exports": [{ "kind": "class", "name": "Wallet" }],
  "proofObligations": [
    {
      "id": "PO-TYPE-001",
      "kind": "type_safety",
      "required": true,
      "oracle": "typecheck"
    },
    {
      "id": "PO-FAIL-001",
      "kind": "failure_state",
      "required": true,
      "oracle": "state_diff",
      "observableState": ["balance", "treasury", "rejectedCount"],
      "allowedFailureEffects": ["rejectedCount"],
      "prelude": [
        "const w1 = new Wallet(100n);",
        "const w2 = new Wallet(0n);",
        "__targetInstance = w1;",
        "__failingCall = () => w1.transferTo(w2, 500n, 10n);"
      ]
    },
    {
      "id": "PO-CONS-001",
      "kind": "resource_conservation",
      "required": true,
      "oracle": "conservation",
      "resourceBoundary": {
        "before": ["balance", "treasury"],
        "after": ["balance", "treasury"]
      },
      "prelude": [
        "const sender = new Wallet(100n);",
        "const receiver = new Wallet(0n);",
        "const totalBefore = { balance: sender.balance + receiver.balance, treasury: sender.treasury + receiver.treasury };",
        "sender.transferTo(receiver, 30n, 10n);",
        "const totalAfter = { balance: sender.balance + receiver.balance, treasury: sender.treasury + receiver.treasury };",
        "__targetBefore = totalBefore;",
        "__targetAfter = totalAfter;"
      ]
    }
  ]
}
EOF

out_a="$(bash scripts/capabilities/test_runner.sh 2>&1)"
echo "${out_a}"
if ! echo "${out_a}" | grep -q "ALL 3 PROOF OBLIGATIONS VERIFIED"; then
  echo "FALHA: Caso A deveria ter passado com 3 obrigações verificadas!"
  exit 1
fi
echo "Caso A: APROVADO 🟢"

echo "=== 2. Testando Caso B (FAILURE LEAK: mutação de saldo em chamada rejeitada) ==="
cat << 'EOF' > src/wallet.ts
export class Wallet {
  private _balance: bigint;
  private _treasury: bigint;
  private _rejectedCount: number;

  constructor(initial: bigint) {
    this._balance = initial;
    this._treasury = 0n;
    this._rejectedCount = 0;
  }

  transferTo(receiver: Wallet, amount: bigint, fee: bigint): boolean {
    if (amount <= 0n || fee < 0n || this._balance < (amount + fee)) {
      this._rejectedCount++;
      this._balance -= 5n; // BUG: vazamento de mutação de saldo em falha!
      return false;
    }
    this._balance -= (amount + fee);
    receiver._balance += amount;
    this._treasury += fee;
    return true;
  }

  get balance(): bigint { return this._balance; }
  get treasury(): bigint { return this._treasury; }
  get rejectedCount(): number { return this._rejectedCount; }
}
EOF

set +e
out_b="$(bash scripts/capabilities/test_runner.sh 2>&1)"
rc_b=$?
set -e

echo "${out_b}"
if [[ "${rc_b}" -eq 0 ]] || ! echo "${out_b}" | grep -q "DISPROVEN"; then
  echo "FALHA: Caso B deveria ter sido rejeitado com PO DISPROVEN!"
  exit 1
fi
echo "Caso B (Rejeição de Vazamento de Estado): APROVADO 🟢"

echo "=== 3. Testando Caso C (CONSERVATION BREAK: taxa desaparece do sistema) ==="
cat << 'EOF' > src/wallet.ts
export class Wallet {
  private _balance: bigint;
  private _treasury: bigint;
  private _rejectedCount: number;

  constructor(initial: bigint) {
    this._balance = initial;
    this._treasury = 0n;
    this._rejectedCount = 0;
  }

  transferTo(receiver: Wallet, amount: bigint, fee: bigint): boolean {
    if (amount <= 0n || fee < 0n || this._balance < (amount + fee)) {
      this._rejectedCount++;
      return false;
    }
    this._balance -= (amount + fee);
    receiver._balance += amount;
    // BUG: fee não foi creditada em lugar nenhum, dinheiro sumiu!
    return true;
  }

  get balance(): bigint { return this._balance; }
  get treasury(): bigint { return this._treasury; }
  get rejectedCount(): number { return this._rejectedCount; }
}
EOF

set +e
out_c="$(bash scripts/capabilities/test_runner.sh 2>&1)"
rc_c=$?
set -e

echo "${out_c}"
if [[ "${rc_c}" -eq 0 ]] || ! echo "${out_c}" | grep -q "Conservation violated"; then
  echo "FALHA: Caso C deveria ter sido rejeitado por quebra de conservação!"
  exit 1
fi
echo "Caso C (Rejeição de Quebra de Conservação): APROVADO 🟢"

echo "=== 4. Testando Caso D (TYPE FAILURE: erro de tipo TypeScript) ==="
cat << 'EOF' > src/wallet.ts
export class Wallet {
  private _balance: bigint;
  constructor(initial: bigint) {
    this._balance = "not a bigint"; // BUG: erro de tipo
  }
  get balance(): bigint { return this._balance; }
}
EOF

set +e
out_d="$(bash scripts/capabilities/test_runner.sh 2>&1)"
rc_d=$?
set -e

echo "${out_d}"
if [[ "${rc_d}" -eq 0 ]] || ! echo "${out_d}" | grep -q "TypeScript compilation error"; then
  echo "FALHA: Caso D deveria ter sido rejeitado por erro de tipo!"
  exit 1
fi
echo "Caso D (Rejeição por Erro de Tipo): APROVADO 🟢"

echo "=========================================================="
echo "🎯 TODOS OS 4 CASOS DO EVIDENCE COMPILER APROVADOS COM SUCESSO!"
echo "=========================================================="
