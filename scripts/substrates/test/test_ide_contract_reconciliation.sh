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
  "goal": "Create src/reorgEngine.ts",
  "targets": ["src/reorgEngine.ts", "src/index.ts"],
  "exports": [{
    "kind": "class",
    "name": "ReorgEngine",
    "privateFields": [{"name": "_tip", "type": "string"}],
    "ctorParams": [],
    "ctorBody": ["this._tip = \"\""],
    "methods": [{"name": "processBlock", "params": [], "returns": "void", "body": ["return"]}],
    "getters": [{"name": "tip", "returns": "string", "body": "return this._tip"}]
  }],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./reorgEngine.js",
  "invariants": [{"id": "INV-TIP", "predicate": "tip is canonical"}],
  "proofObligations": [{"id": "PO-TIP", "kind": "state", "oracle": "tip is canonical"}],
  "questions": [{
    "id": "Q-DOMAIN-001",
    "decision": "Whether the canonical tip is observable to callers",
    "demandEvidence": "The demand does not specify whether callers inspect the tip directly.",
    "whyUnresolved": "Both a getter and an internal-only tip preserve canonical processing.",
    "contractImpact": ["ReorgEngine public API"],
    "recommendedRationale": "Expose read-only state for observability without mutation rights.",
    "question": "Should the engine expose the current canonical tip?",
    "scope": "DEMAND",
    "options": ["(Recommended) Expose the tip", "Keep the tip internal"],
    "is_multi_select": false
  }]
}'

equivalent_reconstruction='{
  "goal": "Create src/reorgEngine.ts",
  "targets": ["src/index.ts", "src/reorgEngine.ts"],
  "exports": [{
    "kind": "class",
    "name": "ReorgEngine",
    "privateFields": [{"name": "_tip", "type": "string"}],
    "ctorParams": [],
    "ctorBody": ["this._tip = \"genesis\""],
    "methods": [{"name": "processBlock", "params": [], "returns": "void", "body": ["this._tip = \"next\""]}],
    "getters": [{"name": "tip", "returns": "string", "body": "return this._tip"}]
  }],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./reorgEngine.js",
  "invariants": [{"id": "OTHER-ID", "predicate": "tip is canonical"}],
  "proofObligations": [{"id": "OTHER-PO", "kind": "state", "oracle": "tip is canonical"}],
  "questionReview": [{
    "id": "Q-DOMAIN-001",
    "verdict": "DERIVE",
    "rationale": "Read-only observability is a KISS default for a stateful engine.",
    "derivedDecision": "Expose a read-only canonical tip getter."
  }]
}'

different_reconstruction="$(printf '%s' "${equivalent_reconstruction}" | jq -c '.targets = ["src/other.ts", "src/index.ts"]')"

aegis_briefing_reconstruct_contract() {
  printf '%s' "${RECONSTRUCTION_JSON}"
}

export RECONSTRUCTION_JSON="${equivalent_reconstruction}"
equivalent_result="$(aegis_briefing_reconcile_ide_contract \
  "${ide_contract}" "Create the engine" "src/reorgEngine.ts" '{}')"
printf '%s' "${equivalent_result}" | jq -e \
  '(.questions | length) == 0 and .questionResolution.derived[0].id == "Q-DOMAIN-001"' >/dev/null
jq -e '.schema == "aegis.contract_reconciliation.v1" and .equivalent == true' \
  "${runtime_dir}/contract_reconciliation.json" >/dev/null

ask_reconstruction="$(printf '%s' "${equivalent_reconstruction}" | jq -c \
  '.questionReview[0].verdict = "ASK" | del(.questionReview[0].derivedDecision)')"
export RECONSTRUCTION_JSON="${ask_reconstruction}"
ask_result="$(aegis_briefing_reconcile_ide_contract \
  "${ide_contract}" "Create the engine" "src/reorgEngine.ts" '{}')"
printf '%s' "${ask_result}" | jq -e \
  '(.questions | length) == 1 and .questions[0].id == "Q-DOMAIN-001" and (.questionResolution | not)' >/dev/null

export RECONSTRUCTION_JSON="${different_reconstruction}"
divergent_result="$(aegis_briefing_reconcile_ide_contract \
  "${ide_contract}" "Create the engine" "src/reorgEngine.ts" '{}')"
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
  '{"goal":"bad","targets":[],"exports":[]}' "Create the engine" "src/reorgEngine.ts" '{}' \
  >/dev/null 2>&1; then
  echo "FAIL: invalid IDE contract was accepted" >&2
  exit 1
fi

echo "[AEGIS][TEST][PASS] IDE contract reconciliation passed"
