#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEGIS_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_DIR}"' EXIT

mkdir -p "${TEST_DIR}/src" "${TEST_DIR}/.harness/runtime" "${TEST_DIR}/scripts/capabilities" "${TEST_DIR}/scripts/lib"
ln -s "${AEGIS_ROOT}/node_modules" "${TEST_DIR}/node_modules"
cp "${AEGIS_ROOT}/package.json" "${TEST_DIR}/"
cp "${AEGIS_ROOT}/scripts/capabilities/test_runner.sh" "${TEST_DIR}/scripts/capabilities/"
cp "${AEGIS_ROOT}/scripts/capabilities/_emit.sh" "${TEST_DIR}/scripts/capabilities/"
cp "${AEGIS_ROOT}/scripts/lib/uaam_risk_compiler.mjs" "${TEST_DIR}/scripts/lib/"

cat <<'EOF' > "${TEST_DIR}/src/index.ts"
export class ComplexSystem {
  capacity = 100;
  allocated = 0;
  balance = 100;
  aborted = false;
  value = 0;

  allocate(demands: number[]): number[] {
    const committed: number[] = [];
    for (const demand of demands) {
      if (demand <= this.capacity) {
        this.allocated += demand;
        committed.push(demand);
      }
    }
    return committed;
  }

  commitWithPartialFailure(): void {
    this.balance -= 10;
    this.aborted = true;
    throw new Error('forced second-phase failure');
  }

  apply(amount: number): { reported: number } {
    this.value += amount;
    return { reported: this.value - amount };
  }

  nextScopeContainsState(): boolean { return true; }
}
EOF

cat <<'EOF' > "${TEST_DIR}/.harness/active_contract_ir.json"
{
  "version": "3.0",
  "goal": "Progressive universal assurance fixture",
  "targets": ["src/index.ts"],
  "publicContract": { "exports": ["ComplexSystem"] },
  "requirements": [
    { "id": "REQ-COMPOSITION", "proofObligationId": "PO-COMPOSITION" },
    { "id": "REQ-COMMIT", "proofObligationId": "PO-COMMIT" },
    { "id": "REQ-RESULT", "proofObligationId": "PO-RESULT" },
    { "id": "REQ-LIFECYCLE", "proofObligationId": "PO-LIFECYCLE" }
  ],
  "operations": [
    {
      "id": "OP-COMPOSITION",
      "target": "ComplexSystem.allocate",
      "composition": { "sharedResources": [{ "resource": "system.capacity", "rule": "aggregate_demand <= available" }] }
    },
    {
      "id": "OP-COMMIT",
      "target": "ComplexSystem.commitWithPartialFailure",
      "transaction": { "atomic": true, "phases": ["PREPARE", "COMMIT"] }
    },
    {
      "id": "OP-RESULT",
      "target": "ComplexSystem.apply",
      "observability": { "resultMustMatchState": ["value"] }
    },
    {
      "id": "OP-LIFECYCLE",
      "target": "ComplexSystem.expire",
      "lifecycle": [{ "state": "quarantine", "scope": "BATCH" }]
    }
  ],
  "proofObligations": [
    { "id": "PO-CONTRACT-COVERAGE", "target": "contract", "domain": "CONTRACT", "kind": "contract_coverage", "oracle": "contract_coverage" },
    { "id": "PO-COMPOSITION", "target": "ComplexSystem.allocate", "domain": "COMPOSITION", "kind": "resource_composition", "oracle": "resource_composition",
      "prelude": ["const system = new ComplexSystem();", "const committed = system.allocate([60, 60]);", "__availableCapacity = system.capacity;", "__committedResources = committed;"] },
    { "id": "PO-COMMIT", "target": "ComplexSystem.commitWithPartialFailure", "domain": "COMMIT", "kind": "commit_atomicity", "oracle": "commit_atomicity",
      "observableState": ["balance", "aborted"], "allowedFailureEffects": ["aborted"],
      "prelude": ["const system = new ComplexSystem();", "__targetInstance = system;", "__abortingBatchCall = () => system.commitWithPartialFailure();"] },
    { "id": "PO-RESULT", "target": "ComplexSystem.apply", "domain": "OBSERVABILITY", "kind": "result_state_consistency", "oracle": "result_state_consistency",
      "mapping": { "reported": { "state": "value", "relation": "equal" } },
      "prelude": ["const system = new ComplexSystem();", "__resultTarget = system;", "__resultCall = () => system.apply(3);"] },
    { "id": "PO-LIFECYCLE", "target": "ComplexSystem.expire", "domain": "LIFECYCLE", "kind": "temporal_lifecycle", "oracle": "temporal_policy", "clockPolicy": "monotonic_clamp",
      "prelude": ["const system = new ComplexSystem();", "__temporalCheck = () => !system.nextScopeContainsState();"] }
  ]
}
EOF

cd "${TEST_DIR}"

run_stage() {
  local stage="$1"
  local output matrix
  output="$(bash scripts/capabilities/test_runner.sh 2>&1 || true)"
  matrix="$(printf '%s\n' "${output}" | sed -n 's/^\[AEGIS\]\[EVIDENCE_MATRIX_JSON\]//p' | tail -1)"
  [[ -n "${matrix}" ]] || { echo "missing evidence matrix at stage ${stage}" >&2; echo "${output}" >&2; exit 1; }
  printf '%s\n' "${matrix}" > ".harness/runtime/stage-${stage}.json"
  printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[EVIDENCE_GATE\] FAILED' || {
    echo "stage ${stage} unexpectedly passed before final repair" >&2
    exit 1
  }
}

assert_status() {
  local stage="$1" id="$2" expected="$3"
  jq -e --arg id "${id}" --arg expected "${expected}" 'any(.[]; .id == $id and .status == $expected)' \
    ".harness/runtime/stage-${stage}.json" >/dev/null \
    || { echo "stage ${stage}: ${id} expected ${expected}" >&2; cat ".harness/runtime/stage-${stage}.json" >&2; exit 1; }
}

run_stage 0
assert_status 0 PO-COMPOSITION DISPROVEN
assert_status 0 PO-COMMIT DISPROVEN
assert_status 0 PO-RESULT DISPROVEN
assert_status 0 PO-LIFECYCLE DISPROVEN

perl -0pi -e 's/    const committed: number\[\] = \[\];\n    for \(const demand of demands\) \{\n      if \(demand <= this\.capacity\) \{\n        this\.allocated \+= demand;\n        committed\.push\(demand\);\n      \}\n    \}\n    return committed;/    const total = demands.reduce((sum, demand) => sum + demand, 0);\n    if (this.allocated + total > this.capacity) return [];\n    this.allocated += total;\n    return demands;/' src/index.ts
run_stage 1
assert_status 1 PO-COMPOSITION EXECUTABLY_PROVEN
assert_status 1 PO-COMMIT DISPROVEN
assert_status 1 PO-RESULT DISPROVEN
assert_status 1 PO-LIFECYCLE DISPROVEN

perl -0pi -e 's/    this\.balance -= 10;\n    this\.aborted = true;\n    throw new Error\('\''forced second-phase failure'\''\);/    const before = this.balance;\n    try {\n      this.balance -= 10;\n      throw new Error('\''forced second-phase failure'\'');\n    } catch {\n      this.balance = before;\n      this.aborted = true;\n      throw new Error('\''forced second-phase failure'\'');\n    }/' src/index.ts
run_stage 2
assert_status 2 PO-COMPOSITION EXECUTABLY_PROVEN
assert_status 2 PO-COMMIT EXECUTABLY_PROVEN
assert_status 2 PO-RESULT DISPROVEN
assert_status 2 PO-LIFECYCLE DISPROVEN

perl -0pi -e 's/return \{ reported: this\.value - amount \};/return { reported: this.value };/' src/index.ts
run_stage 3
assert_status 3 PO-COMPOSITION EXECUTABLY_PROVEN
assert_status 3 PO-COMMIT EXECUTABLY_PROVEN
assert_status 3 PO-RESULT EXECUTABLY_PROVEN
assert_status 3 PO-LIFECYCLE DISPROVEN

perl -0pi -e 's/nextScopeContainsState\(\): boolean \{ return true; \}/nextScopeContainsState(): boolean { return false; }/' src/index.ts
final_output="$(bash scripts/capabilities/test_runner.sh 2>&1 || true)"
final_matrix="$(printf '%s\n' "${final_output}" | sed -n 's/^\[AEGIS\]\[EVIDENCE_MATRIX_JSON\]//p' | tail -1)"
printf '%s\n' "${final_matrix}" > ".harness/runtime/stage-4.json"
printf '%s\n' "${final_output}" | grep -q '\[AEGIS\]\[EVIDENCE_GATE\] ALL 5 PROOF OBLIGATIONS VERIFIED' \
  || { echo "final progressive proof did not reach SUCCESS" >&2; echo "${final_output}" >&2; exit 1; }
jq -e 'all(.[]; .status == "STATIC_PROVEN" or .status == "EXECUTABLY_PROVEN" or .status == "NOT_APPLICABLE")' ".harness/runtime/stage-4.json" >/dev/null

echo "[AEGIS][TEST] uaam_complex_loop: PASS (stages 0→4)"
