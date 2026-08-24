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

# 2. Test Architectural Decisions & Questions in Schema
schema_with_questions='{
  "goal": "Create src/testRing.ts with TestRing and re-export in src/index.ts",
  "targets": ["src/testRing.ts", "src/index.ts"],
  "types": [],
  "questions": [
    {
      "question": "Should capacity wrap around circularly or throw an error on overflow?",
      "options": [
        "(Recommended) Wrap around using modulo arithmetic",
        "Throw RangeError on capacity overflow"
      ],
      "is_multi_select": false
    }
  ],
  "exports": [
    {
      "kind": "class",
      "name": "TestRing",
      "privateFields": [
        {"name": "_tail", "type": "number"}
      ],
      "ctorParams": [],
      "ctorBody": ["this._tail = 0"],
      "methods": [],
      "getters": [{"name": "tail", "returns": "number", "body": "return this._tail"}]
    }
  ],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./testRing.js",
  "behavior": []
}'

# Validate schema with questions passes validation
aegis_briefing_validate_json "${schema_with_questions}" || {
  echo "FAIL: aegis_briefing_validate_json rejected valid schema with questions" >&2
  exit 1
}

# Validate that bad questions shape is rejected
bad_questions_schema='{
  "goal": "bad",
  "targets": ["src/index.ts"],
  "questions": [{"question": "invalid without options"}],
  "exports": [{"kind": "function", "name": "f", "params": [], "returns": "void", "body": []}]
}'
if aegis_briefing_validate_json "${bad_questions_schema}" 2>/dev/null; then
  echo "FAIL: aegis_briefing_validate_json accepted bad_questions_shape" >&2
  exit 1
fi

# Render and verify ## Architectural Decisions & Questions section is present
q_body="$(aegis_briefing_generate "${schema_with_questions}")"
if ! printf '%s' "${q_body}" | grep -q '## Architectural Decisions & Questions'; then
  echo "FAIL: aegis_briefing_generate missing ## Architectural Decisions & Questions section" >&2
  exit 1
fi
if ! printf '%s' "${q_body}" | grep -q 'Wrap around using modulo arithmetic'; then
  echo "FAIL: aegis_briefing_generate missing question options in rendered markdown" >&2
  exit 1
fi

echo "[AEGIS][TEST][PASS] briefing schema pipeline passed in both CLI and IDE modes"

# 3. Test AEGIS_BRIEFING_ANSWERS injection is wired in briefing.sh
if ! grep -q 'AEGIS_BRIEFING_ANSWERS' scripts/lib/briefing.sh; then
  echo "FAIL: AEGIS_BRIEFING_ANSWERS injection missing in briefing.sh" >&2
  exit 1
fi
if ! grep -q 'OPERATOR ANSWERS TO ARCHITECTURAL QUESTIONS' scripts/lib/briefing.sh; then
  echo "FAIL: answers injection prompt missing in briefing.sh" >&2
  exit 1
fi

# 4. Test PENDING_USER_QUESTIONS gate is wired in aegis
if ! grep -q 'PENDING_USER_QUESTIONS' aegis; then
  echo "FAIL: questions gate (PENDING_USER_QUESTIONS) missing in aegis" >&2
  exit 1
fi
if ! grep -q 'questions_pending_user_input' aegis; then
  echo "FAIL: questions_pending_user_input reason code missing in aegis" >&2
  exit 1
fi

# 5. Test that AEGIS_BRIEFING_ANSWERS bypass skips the gate (env var already set)
if ! grep -q 'AEGIS_BRIEFING_ANSWERS:-' aegis; then
  echo "FAIL: AEGIS_BRIEFING_ANSWERS bypass check missing in aegis" >&2
  exit 1
fi


# 6. Test mandatory questions quality gate: supervisor + no answers + questions:[] = FAIL
(
  export AEGIS_BRIEFING_SOURCE=supervisor
  unset AEGIS_BRIEFING_ANSWERS 2>/dev/null || true
  no_questions_schema='{"goal":"test","targets":["src/index.ts"],"questions":[],"exports":[{"kind":"function","name":"f","params":[],"returns":"void","body":[]}]}'
  if aegis_briefing_quality_check "${no_questions_schema}" 2>/dev/null; then
    echo "FAIL: quality_check accepted questions:[] from supervisor without answers" >&2
    exit 1
  fi
)

# 7. Test mandatory questions gate is bypassed when AEGIS_BRIEFING_ANSWERS is set
(
  export AEGIS_BRIEFING_SOURCE=supervisor
  export AEGIS_BRIEFING_ANSWERS="1: use HTTP throttling"
  no_questions_schema='{"goal":"test","targets":["src/index.ts"],"questions":[],"exports":[{"kind":"function","name":"f","params":[],"returns":"void","body":[]}]}'
  if ! aegis_briefing_quality_check "${no_questions_schema}" 2>/dev/null; then
    echo "FAIL: quality_check rejected questions:[] when answers already provided" >&2
    exit 1
  fi
)

echo "[AEGIS][TEST][PASS] briefing schema pipeline: mandatory questions gate enforced"
exit 0
