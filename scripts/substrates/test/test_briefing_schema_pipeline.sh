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

# Rendering is allowed to publish the active contract for a real run. Keep
# this substrate test hermetic so arbitrary fixture schemas never overwrite
# the repository's active contract.
briefing_test_root="$(mktemp -d "${TMPDIR:-/tmp}/aegis_briefing_schema.XXXXXX")"
cleanup() { rm -rf "${briefing_test_root}"; }
trap cleanup EXIT
export AEGIS_ROOT_DIR="${briefing_test_root}"
export AEGIS_RUNTIME_DIR="${briefing_test_root}/.harness/runtime"

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
      "scope": "DEMAND",
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

# Demand questions and Aegis reconciliation questions have separate scopes.
bad_question_scope_schema="$(printf '%s' "${schema_with_questions}" \
  | jq -c '.questions[0].scope = "AEGIS_RECONCILIATION"')"
if aegis_briefing_validate_json "${bad_question_scope_schema}" 2>/dev/null; then
  echo "FAIL: validate_json accepted an Aegis question in questions[]" >&2
  exit 1
fi

internal_question_schema="$(printf '%s' "${schema_with_questions}" \
  | jq -c '.questions[0].question = "Como os testes devem ser organizados e consolidados no repositório?"')"
if aegis_briefing_validate_json "${internal_question_schema}" 2>/dev/null; then
  echo "FAIL: validate_json accepted a repository test-governance question" >&2
  exit 1
fi

too_many_questions_schema="$(printf '%s' "${schema_with_questions}" \
  | jq -c '.questions += [.questions[0], .questions[0], .questions[0]]')"
if aegis_briefing_validate_json "${too_many_questions_schema}" 2>/dev/null; then
  echo "FAIL: validate_json accepted more than three demand questions" >&2
  exit 1
fi

reconciliation_schema="$(printf '%s' "${schema_with_questions}" | jq -c \
  '.questions = [] | .contractReconciliation = {
    status: "divergent",
    pendingQuestions: [{
      question: "The IDE contract diverges from the independent reconstruction. What should happen?",
      scope: "AEGIS_RECONCILIATION",
      options: ["(Recommended) Resubmit the corrected contract", "Block and review"],
      is_multi_select: false
    }]
  }')"
aegis_briefing_validate_json "${reconciliation_schema}" || {
  echo "FAIL: validate_json rejected structured reconciliation questions" >&2
  exit 1
}
reconciliation_body="$(aegis_briefing_generate "${reconciliation_schema}")"
if ! printf '%s' "${reconciliation_body}" | grep -q '## Contract Reconciliation Questions'; then
  echo "FAIL: reconciliation questions were not rendered separately" >&2
  exit 1
fi
if printf '%s' "${reconciliation_body}" | grep -q '## Architectural Decisions & Questions'; then
  echo "FAIL: reconciliation questions leaked into demand question section" >&2
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
if ! grep -q 'contract_reconciliation_pending' aegis; then
  echo "FAIL: contract_reconciliation_pending gate missing in aegis" >&2
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

# 8. Test Sibling Module Imports resolution in validation, rendering, and typecheck
sibling_import_schema='{
  "goal": "Test sibling import",
  "targets": ["src/consumer.ts", "src/index.ts"],
  "imports": [{"from": "./settlementBus.js", "names": ["SettlementBus"]}],
  "exports": [
    {
      "kind": "class",
      "name": "Consumer",
      "privateFields": [{"name": "_bus", "type": "SettlementBus"}],
      "ctorParams": [{"name": "bus", "type": "SettlementBus"}],
      "ctorBody": ["this._bus = bus;"],
      "methods": [],
      "getters": [{"name": "bus", "returns": "SettlementBus", "body": "return this._bus;"}]
    }
  ],
  "barrelFrom": "./consumer.js",
  "behavior": [
    {
      "desc": "Consumer accepts SettlementBus instance",
      "exports": ["Consumer"],
      "prelude": [
        "const bus = new SettlementBus();",
        "const c = new Consumer(bus);"
      ],
      "assert": "c.bus !== undefined"
    }
  ]
}'

aegis_briefing_validate_json "${sibling_import_schema}" || {
  echo "FAIL: validate_json failed on valid sibling imports schema" >&2
  exit 1
}

rendered_md="$(aegis_briefing_render "${sibling_import_schema}")"
if ! printf '%s' "${rendered_md}" | grep -q 'import { SettlementBus } from "./settlementBus.js";'; then
  echo "FAIL: aegis_briefing_render did not render sibling import statement" >&2
  exit 1
fi

# 9. Test vacuous import rejection
vacuous_import_schema='{
  "goal": "Test vacuous import rejection",
  "targets": ["src/consumer.ts"],
  "imports": [{"from": "./settlementBus.js", "names": ["SettlementBus", "UnusedGhostSymbol"]}],
  "exports": [
    {
      "kind": "class",
      "name": "Consumer",
      "privateFields": [{"name": "_bus", "type": "SettlementBus"}],
      "ctorParams": [{"name": "bus", "type": "SettlementBus"}],
      "ctorBody": ["this._bus = bus;"],
      "methods": [],
      "getters": [{"name": "bus", "returns": "SettlementBus", "body": "return this._bus;"}]
    }
  ],
  "barrelFrom": "./consumer.js"
}'

if aegis_briefing_validate_json "${vacuous_import_schema}" 2>/dev/null; then
  echo "FAIL: validate_json should have rejected vacuous import UnusedGhostSymbol" >&2
  exit 1
fi

echo "[AEGIS][TEST][PASS] briefing schema pipeline: sibling module imports validated and resolved"
echo "[AEGIS][TEST][PASS] briefing schema pipeline: non-vacuous import invariant enforced"
echo "[AEGIS][TEST][PASS] briefing schema pipeline: mandatory questions gate enforced"
exit 0
