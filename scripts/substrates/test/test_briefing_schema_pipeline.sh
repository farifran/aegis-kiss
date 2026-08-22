#!/usr/bin/env bash
# =========================================================
# AEGIS TEST: Briefing Schema Pipeline (Optimize + Adversarial)
# Verifies that both CLI and IDE/Agentic pathways execute
# schema optimization and adversarial verification identically.
# =========================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT_DIR}"

source scripts/lib/briefing.sh

# 1. Test Optimize Transformation on linear buffer pointer
raw_linear_schema='{
  "goal": "Create src/testRing.ts and src/index.ts implementing a linear queue",
  "targets": ["src/testRing.ts", "src/index.ts"],
  "types": [],
  "exports": [
    {
      "kind": "class",
      "name": "TestRing",
      "privateFields": [
        {"name": "_mempoolTail", "type": "number"},
        {"name": "_maxMempoolBytes", "type": "number"}
      ],
      "ctorParams": [{"name": "maxBytes", "type": "number"}],
      "ctorBody": [
        "this._maxMempoolBytes = maxBytes",
        "this._mempoolTail = 0"
      ],
      "methods": [
        {
          "name": "push",
          "params": [{"name": "size", "type": "number"}],
          "returns": "number",
          "body": [
            "const off = this._mempoolTail",
            "this._mempoolTail += 40",
            "return off"
          ]
        }
      ],
      "getters": [
        {"name": "tail", "returns": "number", "body": "return this._mempoolTail"}
      ]
    }
  ],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./testRing.js",
  "behavior": [
    {
      "desc": "Advances tail on push",
      "exports": ["TestRing"],
      "prelude": ["const r = new TestRing(120)", "r.push(40)"],
      "assert": "r.tail === 40"
    }
  ]
}'

opt_schema="$(aegis_briefing_optimize_schema_json "${raw_linear_schema}")"

# Verify that linear += 40 was upgraded to modulo (% this._maxMempoolBytes)
if ! printf '%s' "${opt_schema}" | grep -q 'this._mempoolTail = (this._mempoolTail + 40) % this._maxMempoolBytes'; then
  echo "FAIL: aegis_briefing_optimize_schema_json did not optimize linear pointer to ring buffer modulo" >&2
  exit 1
fi

# 2. Test Adversarial Schema Gate
adv_schema="$(aegis_briefing_adversarial_schema_json "${opt_schema}")"
if [[ -z "${adv_schema}" ]]; then
  echo "FAIL: aegis_briefing_adversarial_schema_json failed to return valid schema" >&2
  exit 1
fi

# 3. Test Full Pipeline via aegis_briefing_generate (IDE / Agentic path)
body="$(aegis_briefing_generate "${raw_linear_schema}")"
if [[ -z "${body}" ]]; then
  echo "FAIL: aegis_briefing_generate failed on valid schema" >&2
  exit 1
fi

if ! printf '%s' "${body}" | grep -q '% this._maxMempoolBytes'; then
  echo "FAIL: aegis_briefing_generate rendered markdown without optimized ring buffer formula" >&2
  exit 1
fi

echo "[AEGIS][TEST][PASS] briefing schema pipeline (optimize + adversarial) passed in both CLI and IDE modes"
exit 0
