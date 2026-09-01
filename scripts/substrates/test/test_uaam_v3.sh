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
cd "${TEST_DIR}"

cat <<'EOF' > src/index.ts
export class Counter {
  private _value: number;
  constructor(initial: number) { this._value = initial; }
  consume(amount: number): boolean {
    if (amount <= 0 || amount > this._value) return false;
    this._value -= amount;
    return true;
  }
  get value(): number { return this._value; }
}

export class Accumulator {
  private _value = 0;
  apply(amount: number): { delta: number } {
    this._value += amount;
    return { delta: amount };
  }
  get value(): number { return this._value; }
}
EOF

cat <<'EOF' > .harness/active_contract_ir.json
{
  "version": "3.0",
  "goal": "Universal contract",
  "targets": ["src/index.ts"],
  "publicContract": { "exports": ["Counter", "Accumulator"] },
  "requirements": [
    { "id": "REQ-ADMISSION", "proofObligationId": "PO-ADMISSION" },
    { "id": "REQ-RESULT", "proofObligationId": "PO-RESULT-CONSISTENCY" },
    { "id": "REQ-TEMPORAL", "proofObligationId": "PO-TEMPORAL" }
  ],
  "operations": [{
    "id": "OP-001", "target": "Counter.consume",
    "admission": { "preconditions": ["amount > 0"] },
    "composition": { "sharedResources": [] },
    "lifecycle": [{ "state": "probe", "scope": "CALL" }]
  }, {
    "id": "OP-002", "target": "Accumulator.apply",
    "observability": { "resultMustMatchState": ["value"] },
    "lifecycle": [{ "state": "clock", "scope": "CALL" }]
  }],
  "proofObligations": [
    { "id": "PO-CONTRACT-COVERAGE", "target": "contract", "domain": "CONTRACT", "kind": "contract_coverage", "oracle": "contract_coverage" },
    { "id": "PO-ADMISSION", "target": "Counter.consume", "domain": "ADMISSION", "oracle": "admission_reject",
      "prelude": ["const c = new Counter(10);", "__invalidCall = () => c.consume(0);"] },
    { "id": "PO-COMPOSITION", "target": "Counter.consume", "domain": "COMPOSITION", "oracle": "resource_composition",
      "notApplicable": true, "naJustification": "derived:no_shared_resources" },
    { "id": "PO-LIFECYCLE", "target": "Counter.consume", "domain": "LIFECYCLE", "oracle": "lifecycle_expiry",
      "prelude": ["const nextScope = new Set<string>();", "__lifecycleCheck = () => !nextScope.has('probe');"] }
    ,{ "id": "PO-RESULT-CONSISTENCY", "target": "Accumulator.apply", "domain": "OBSERVABILITY", "kind": "result_state_consistency", "oracle": "result_state_consistency",
      "mapping": { "delta": { "state": "value", "relation": "delta" } },
      "prelude": ["const accumulator = new Accumulator();", "__resultTarget = accumulator;", "__resultCall = () => accumulator.apply(3);"] }
    ,{ "id": "PO-TEMPORAL", "target": "Accumulator.apply", "domain": "LIFECYCLE", "kind": "temporal_lifecycle", "oracle": "temporal_policy",
      "clockPolicy": "monotonic_clamp",
      "prelude": ["__temporalCheck = () => true;"] }
  ]
}
EOF

out="$(bash scripts/capabilities/test_runner.sh 2>&1)"
echo "${out}"
grep -q 'PO-ADMISSION.*EXECUTABLY_PROVEN' <<<"${out}"
grep -q 'PO-COMPOSITION.*NOT_APPLICABLE' <<<"${out}"
grep -q 'PO-LIFECYCLE.*EXECUTABLY_PROVEN' <<<"${out}"
grep -q 'ALL 6 PROOF OBLIGATIONS VERIFIED' <<<"${out}"
json_out="$(AEGIS_EXECUTION_ID=uaam-test bash scripts/capabilities/test_runner.sh)"
jq -e '.payload.contract_version == "3.0" and (.payload.evidence_matrix | length) == 6' <<<"${json_out}" >/dev/null

cat <<'EOF' > .harness/active_contract_ir.json
{
  "version": "3.0", "goal": "Incomplete universal contract", "targets": ["src/index.ts"],
  "publicContract": { "exports": ["Counter"] },
  "operations": [{ "id": "OP-001", "target": "Counter.consume", "admission": { "preconditions": ["amount > 0"] } }],
  "proofObligations": []
}
EOF
set +e
invalid_out="$(bash scripts/capabilities/test_runner.sh 2>&1)"
invalid_rc=$?
set -e
echo "${invalid_out}"
[[ "${invalid_rc}" -ne 0 ]]
grep -q 'missing_explicit_obligation:OP-001:ADMISSION' <<<"${invalid_out}"
echo "[AEGIS][TEST] uaam_v3: PASS"
