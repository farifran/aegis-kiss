#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEGIS_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_DIR}"' EXIT

mkdir -p "${TEST_DIR}/src" "${TEST_DIR}/.harness" "${TEST_DIR}/scripts/capabilities" "${TEST_DIR}/scripts/lib"
ln -s "${AEGIS_ROOT}/node_modules" "${TEST_DIR}/node_modules"
cp "${AEGIS_ROOT}/scripts/uaam_assurance_loop.sh" "${TEST_DIR}/scripts/"
cp "${AEGIS_ROOT}/scripts/uaam_repair_aegis.sh" "${TEST_DIR}/scripts/"
cp "${AEGIS_ROOT}/scripts/capabilities/test_runner.sh" "${TEST_DIR}/scripts/capabilities/"
cp "${AEGIS_ROOT}/scripts/capabilities/_emit.sh" "${TEST_DIR}/scripts/capabilities/"
cp "${AEGIS_ROOT}/scripts/lib/uaam_risk_compiler.mjs" "${TEST_DIR}/scripts/lib/"

cat <<'EOF' > "${TEST_DIR}/package.json"
{
  "name": "uaam-repair-loop-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "aegis:typecheck": "node -e \"process.exit(0)\"",
    "aegis:lint": "node -e \"process.exit(0)\"",
    "aegis:test:uaam-v3": "bash scripts/capabilities/test_runner.sh",
    "aegis:test:uaam-runtime": "node -e \"process.exit(0)\"",
    "aegis:test:compositional-proofs": "node -e \"process.exit(0)\"",
    "aegis:test:evidence-compiler": "node -e \"process.exit(0)\"",
    "aegis:test:uaam-authority": "node -e \"process.exit(0)\""
  }
}
EOF

cat <<'EOF' > "${TEST_DIR}/src/index.ts"
export class ComplexSystem {
  capacity = 100;
  allocated = 0;
  balance = 100;
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
  "goal": "Repair loop integration fixture",
  "targets": ["src/index.ts"],
  "publicContract": { "exports": ["ComplexSystem"] },
  "requirements": [
    { "id": "REQ-COMPOSITION", "proofObligationId": "PO-COMPOSITION" },
    { "id": "REQ-COMMIT", "proofObligationId": "PO-COMMIT" },
    { "id": "REQ-RESULT", "proofObligationId": "PO-RESULT" },
    { "id": "REQ-LIFECYCLE", "proofObligationId": "PO-LIFECYCLE" }
  ],
  "operations": [
    { "id": "OP-COMPOSITION", "target": "ComplexSystem.allocate", "composition": { "sharedResources": [{ "resource": "system.capacity", "rule": "aggregate_demand <= available" }] } },
    { "id": "OP-COMMIT", "target": "ComplexSystem.commitWithPartialFailure", "transaction": { "atomic": true, "phases": ["PREPARE", "COMMIT"] } },
    { "id": "OP-RESULT", "target": "ComplexSystem.apply", "observability": { "resultMustMatchState": ["value"] } },
    { "id": "OP-LIFECYCLE", "target": "ComplexSystem.expire", "lifecycle": [{ "state": "quarantine", "scope": "BATCH" }] }
  ],
  "proofObligations": [
    { "id": "PO-CONTRACT-COVERAGE", "target": "contract", "domain": "CONTRACT", "kind": "contract_coverage", "oracle": "contract_coverage" },
    { "id": "PO-COMPOSITION", "target": "ComplexSystem.allocate", "domain": "COMPOSITION", "kind": "resource_composition", "oracle": "resource_composition", "prelude": ["const system = new ComplexSystem();", "const committed = system.allocate([60, 60]);", "__availableCapacity = system.capacity;", "__committedResources = committed;"] },
    { "id": "PO-COMMIT", "target": "ComplexSystem.commitWithPartialFailure", "domain": "COMMIT", "kind": "commit_atomicity", "oracle": "commit_atomicity", "observableState": ["balance"], "prelude": ["const system = new ComplexSystem();", "__targetInstance = system;", "__abortingBatchCall = () => system.commitWithPartialFailure();"] },
    { "id": "PO-RESULT", "target": "ComplexSystem.apply", "domain": "OBSERVABILITY", "kind": "result_state_consistency", "oracle": "result_state_consistency", "mapping": { "reported": { "state": "value", "relation": "equal" } }, "prelude": ["const system = new ComplexSystem();", "__resultTarget = system;", "__resultCall = () => system.apply(3);"] },
    { "id": "PO-LIFECYCLE", "target": "ComplexSystem.expire", "domain": "LIFECYCLE", "kind": "temporal_lifecycle", "oracle": "temporal_policy", "clockPolicy": "monotonic_clamp", "prelude": ["const system = new ComplexSystem();", "__temporalCheck = () => !system.nextScopeContainsState();"] }
  ]
}
EOF

cat <<'EOF' > "${TEST_DIR}/run_aegis_loop.sh"
#!/usr/bin/env bash
set -euo pipefail

case "${AEGIS_UAAM_ITERATION}" in
  1)
    perl -0pi -e 's/    const committed: number\[\] = \[\];\n    for \(const demand of demands\) \{\n      if \(demand <= this\.capacity\) \{\n        this\.allocated \+= demand;\n        committed\.push\(demand\);\n      \}\n    \}\n    return committed;/    const total = demands.reduce((sum, demand) => sum + demand, 0);\n    if (this.allocated + total > this.capacity) return [];\n    this.allocated += total;\n    return demands;/' src/index.ts
    ;;
  2)
    perl -0pi -e 's/    this\.balance -= 10;\n    throw new Error\('\''forced second-phase failure'\''\);/    const before = this.balance;\n    try {\n      this.balance -= 10;\n      throw new Error('\''forced second-phase failure'\'');\n    } catch {\n      this.balance = before;\n      throw new Error('\''forced second-phase failure'\'');\n    }/' src/index.ts
    ;;
  3)
    perl -0pi -e 's/return \{ reported: this\.value - amount \};/return { reported: this.value };/' src/index.ts
    ;;
  4)
    perl -0pi -e 's/nextScopeContainsState\(\): boolean \{ return true; \}/nextScopeContainsState(): boolean { return false; }/' src/index.ts
    ;;
  *)
    echo "unexpected provider iteration: ${AEGIS_UAAM_ITERATION}" >&2
    exit 2
    ;;
esac

jq -n \
  --arg iteration "${AEGIS_UAAM_ITERATION}" \
  --arg request "${AEGIS_UAAM_REPAIR_REQUEST}" \
  '{status:"APPLIED",iteration:($iteration|tonumber),request:$request,scope:["src/index.ts"],strategy:"official_mutation_provider_fixture"}' \
  > "${AEGIS_UAAM_LOOP_DIR}/iteration-${AEGIS_UAAM_ITERATION}/provider_result.json"
EOF
chmod +x "${TEST_DIR}/run_aegis_loop.sh"

cd "${TEST_DIR}"
output="$(AEGIS_UAAM_LOOP_MAX_ITERATIONS=5 AEGIS_UAAM_AUTO_REPAIR=true bash scripts/uaam_assurance_loop.sh 2>&1)"
printf '%s\n' "${output}"

printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[UAAM_LOOP\] REPAIR_APPLIED iteration=1'
printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[UAAM_LOOP\] REPAIR_APPLIED iteration=4'
printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[UAAM_LOOP\] SUCCESS iteration=5'
jq -e '.status == "SUCCESS" and .iteration == 5' .harness/runtime/uaam_loop/result.json >/dev/null
expected_failures=(4 3 2 1)
for iteration in 1 2 3 4; do
  jq -e '.repair.status == "APPLIED"' ".harness/runtime/uaam_loop/iteration-${iteration}/evidence.json" >/dev/null
  jq -e '(.failed_checks | length) >= 1' ".harness/runtime/uaam_loop/iteration-${iteration}/repair_request.json" >/dev/null
  jq -e --argjson iteration "${iteration}" '.status == "APPLIED" and .iteration == $iteration and .strategy == "official_mutation_provider_fixture"' \
    ".harness/runtime/uaam_loop/iteration-${iteration}/provider_result.json" >/dev/null
  grep -q 'delegating_to=run_aegis_loop.sh' ".harness/runtime/uaam_loop/iteration-${iteration}/repair.log"
  matrix="$(sed -n 's/^\[AEGIS\]\[EVIDENCE_MATRIX_JSON\]//p' ".harness/runtime/uaam_loop/iteration-${iteration}/uaam_v3.log" | tail -1)"
  jq -e --argjson expected "${expected_failures[$((iteration - 1))]}" \
    '[.[] | select(.status == "DISPROVEN" or .status == "UNPROVEN")] | length == $expected' <<<"${matrix}" >/dev/null
done
jq -e '(.checks | map(select(.status == "passed")) | length) == 7' .harness/runtime/uaam_loop/latest.json >/dev/null
jq -e '[.checks[] | select(.name == "uaam_v3") | .evidence_matrix[] | select(.status == "DISPROVEN" or .status == "UNPROVEN")] | length == 0' \
  .harness/runtime/uaam_loop/latest.json >/dev/null

echo "[AEGIS][TEST] uaam_repair_loop: PASS (repair→reprove iterations 1→5)"
