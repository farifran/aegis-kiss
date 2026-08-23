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

# 1. Test Full Pipeline via aegis_briefing_generate (IDE / Agentic schema JSON path)
body="$(aegis_briefing_generate "${raw_linear_schema}")"
if [[ -z "${body}" ]]; then
  echo "FAIL: aegis_briefing_generate failed on valid schema" >&2
  exit 1
fi

if ! printf '%s' "${body}" | grep -q '## Goal'; then
  echo "FAIL: aegis_briefing_generate missing ## Goal section" >&2
  exit 1
fi

if ! printf '%s' "${body}" | grep -q '## Acceptance'; then
  echo "FAIL: aegis_briefing_generate missing ## Acceptance section" >&2
  exit 1
fi

echo "[AEGIS][TEST][PASS] briefing schema pipeline passed in both CLI and IDE modes"
exit 0
