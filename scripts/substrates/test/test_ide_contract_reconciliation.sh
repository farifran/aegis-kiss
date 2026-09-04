#!/usr/bin/env bash

# AEGIS TEST: IDE contract proposal + independent reconstruction.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT_DIR}"

source scripts/lib/briefing.sh

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis_contract_reconcile.XXXXXX")"
cleanup() { rm -rf "${runtime_dir}"; }
trap cleanup EXIT
export AEGIS_ROOT_DIR="${ROOT_DIR}"
export AEGIS_RUNTIME_DIR="${runtime_dir}"

ide_contract='{
  "goal": "Create src/exampleService.ts",
  "targets": ["src/exampleService.ts", "src/index.ts"],
  "exports": [{
    "kind": "class",
    "name": "ExampleService",
    "privateFields": [{"name": "_state", "type": "string"}],
    "ctorParams": [],
    "ctorBody": ["this._state = \"\""],
    "methods": [{"name": "advance", "params": [], "returns": "void", "body": ["return"]}],
    "getters": [{"name": "state", "returns": "string", "body": "return this._state"}]
  }],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./exampleService.js",
  "invariants": [{"id": "INV-STATE", "predicate": "state remains valid"}],
  "proofObligations": [{"id": "PO-STATE", "kind": "state", "oracle": "state remains valid"}],
  "questions": [{
    "id": "Q-DOMAIN-001",
    "decision": "Whether the current state is observable to callers",
    "demandEvidence": "The demand does not specify whether callers inspect the state directly.",
    "whyUnresolved": "Both a getter and an internal-only state preserve the operation.",
    "contractImpact": ["ExampleService public API"],
    "recommendedRationale": "Expose read-only state for observability without mutation rights.",
    "question": "Should the service expose its current state?",
    "scope": "DEMAND",
    "options": ["(Recommended) Expose the state", "Keep the state internal"],
    "is_multi_select": false
  }]
}'

equivalent_reconstruction='{
  "goal": "Create src/exampleService.ts",
  "targets": ["src/index.ts", "src/exampleService.ts"],
  "exports": [{
    "kind": "class",
    "name": "ExampleService",
    "privateFields": [{"name": "_state", "type": "string"}],
    "ctorParams": [],
    "ctorBody": ["this._state = \"initial\""],
    "methods": [{"name": "advance", "params": [], "returns": "void", "body": ["this._state = \"next\""]}],
    "getters": [{"name": "state", "returns": "string", "body": "return this._state"}]
  }],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./exampleService.js",
  "invariants": [{"id": "OTHER-ID", "predicate": "state remains valid"}],
  "proofObligations": [{"id": "OTHER-PO", "kind": "state", "oracle": "state remains valid"}],
  "questionReview": [{
    "id": "Q-DOMAIN-001",
    "verdict": "DERIVE",
    "rationale": "Read-only observability is a KISS default for a stateful service.",
    "derivedDecision": "Expose a read-only state getter."
  }]
}'

different_reconstruction="$(printf '%s' "${equivalent_reconstruction}" | jq -c '.targets = ["src/other.ts", "src/index.ts"]')"

# Fast/targeted IDE contracts are checked mechanically.  A remote reviewer is
# reserved for an explicit or high-risk policy, otherwise a tiny demand would
# pay a second model call before mutation.
unset AEGIS_IDE_CONTRACT_RECONSTRUCTION 2>/dev/null || true
if aegis_briefing_ide_reconstruction_required "${ide_contract}"; then
  echo "FAIL: ordinary IDE contract unexpectedly requires reconstruction" >&2
  exit 1
fi
agentic_generate_block="$(sed -n '1618,1640p' scripts/lib/briefing.sh)"
printf '%s\n' "${agentic_generate_block}" | grep -q 'aegis_briefing_ide_reconstruction_required' \
  || { echo "FAIL: agentic contract path bypasses auto reconstruction policy" >&2; exit 1; }
printf '%s\n' "${agentic_generate_block}" | grep -q 'AEGIS_IDE_CONTRACT_RECONSTRUCTION:-1' \
  && { echo "FAIL: agentic contract path forces reconstruction by default" >&2; exit 1; }
if ! AEGIS_IDE_CONTRACT_RECONSTRUCTION=always \
  aegis_briefing_ide_reconstruction_required "${ide_contract}"; then
  echo "FAIL: explicit independent review was not selected" >&2
  exit 1
fi
high_risk_contract="$(printf '%s' "${ide_contract}" | jq -c '.verificationProfile = "release"')"
if ! aegis_briefing_ide_reconstruction_required "${high_risk_contract}"; then
  echo "FAIL: release contract did not select independent review" >&2
  exit 1
fi
compact_projection="$(aegis_briefing_contract_semantic_projection "${ide_contract}")"
printf '%s' "${compact_projection}" | jq -e '
  (.publicApi.exports[0].name == "ExampleService")
  and (tostring | contains("ctorBody") | not)
  and (tostring | contains("privateFields") | not)
' >/dev/null || {
  echo "FAIL: semantic review projection retained implementation detail" >&2
  exit 1
}

aegis_briefing_reconstruct_contract() {
  printf '%s' "${RECONSTRUCTION_JSON}"
}

export RECONSTRUCTION_JSON="${equivalent_reconstruction}"
equivalent_result="$(aegis_briefing_reconcile_ide_contract \
  "${ide_contract}" "Create the example service" "src/exampleService.ts" '{}')"
printf '%s' "${equivalent_result}" | jq -e \
  '(.questions | length) == 0 and .questionResolution.derived[0].id == "Q-DOMAIN-001"' >/dev/null
jq -e '.schema == "aegis.contract_reconciliation.v1" and .equivalent == true' \
  "${runtime_dir}/contract_reconciliation.json" >/dev/null

ask_reconstruction="$(printf '%s' "${equivalent_reconstruction}" | jq -c \
  '.questionReview[0].verdict = "ASK" | del(.questionReview[0].derivedDecision)')"
export RECONSTRUCTION_JSON="${ask_reconstruction}"
ask_result="$(aegis_briefing_reconcile_ide_contract \
  "${ide_contract}" "Create the example service" "src/exampleService.ts" '{}')"
printf '%s' "${ask_result}" | jq -e \
  '(.questions | length) == 1 and .questions[0].id == "Q-DOMAIN-001" and (.questionResolution | not)' >/dev/null

export RECONSTRUCTION_JSON="${different_reconstruction}"
divergent_result="$(aegis_briefing_reconcile_ide_contract \
  "${ide_contract}" "Create the example service" "src/exampleService.ts" '{}')"
printf '%s' "${divergent_result}" | jq -e \
  '(.questions | length) == 0 and .questionResolution.derived[0].status == "DERIVED"' >/dev/null
printf '%s' "${divergent_result}" | jq -e \
  '.contractReconciliation.pendingQuestions | length == 1 and .[0].scope == "AEGIS_RECONCILIATION"' >/dev/null
printf '%s' "${divergent_result}" \
  | jq -e '.contractReconciliation.equivalent == false and (.contractReconciliation.differences | map(.field) | index("targets") != null)' \
  >/dev/null
jq -e '.equivalent == false and (.differences | length) > 0' \
  "${runtime_dir}/contract_reconciliation.json" >/dev/null

if aegis_briefing_reconcile_ide_contract \
  '{"goal":"bad","targets":[],"exports":[]}' "Create the example service" "src/exampleService.ts" '{}' \
  >/dev/null 2>&1; then
  echo "FAIL: invalid IDE contract was accepted" >&2
  exit 1
fi

echo "[AEGIS][TEST][PASS] IDE contract reconciliation passed"
