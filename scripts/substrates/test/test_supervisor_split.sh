#!/usr/bin/env bash

# =========================================================
# Supervisor split — offline (no network)
# validate + emit + unit render from canned JSON
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/briefing.sh"

parent="$(cat <<'EOF'
## Goal
TokenBucket in src/tokenBucket.ts reexported from src/index.ts.

## Targets
- src/tokenBucket.ts
- src/index.ts

## Acceptance
- TokenBucket

## Briefing
1) export class TokenBucket:
   Campos privados: _x: bigint
   constructor(): this._x = 0n
Em src/tokenBucket.ts:
   (module)
Em src/index.ts:
   import { TokenBucket } from './tokenBucket.js'
   export { TokenBucket }

## Out of scope
- e2e

## Constraints
- no any
EOF
)"

good_split="$(cat <<'EOF'
{
  "units": [
    {
      "title": "create TokenBucket only",
      "targets": ["src/tokenBucket.ts"],
      "depends_on": [],
      "kind": "create",
      "exports": [
        {
          "kind": "class",
          "name": "TokenBucket",
          "privateFields": [{"name": "_x", "type": "bigint"}],
          "ctorParams": [],
          "ctorBody": ["this._x = 0n"],
          "methods": [],
          "getters": []
        }
      ]
    },
    {
      "title": "reexport only",
      "targets": ["src/index.ts"],
      "depends_on": [1],
      "kind": "reexport",
      "reexport_names": ["TokenBucket"],
      "barrelFrom": "./tokenBucket.js"
    }
  ]
}
EOF
)"

aegis_supervisor_split_validate_json "${good_split}" "${parent}" \
  || fail "good_split should validate"

# Too few units
bad_few='{"units":[{"title":"only","targets":["src/tokenBucket.ts"],"depends_on":[],"kind":"create","exports":[{"kind":"function","name":"f","params":[],"returns":"void","body":["return"]}]}]}'
if aegis_supervisor_split_validate_json "${bad_few}" "${parent}" 2>/dev/null; then
  fail "too_few_units should reject"
fi

# Invented path
bad_path="$(cat <<'EOF'
{
  "units": [
    {
      "title": "evil",
      "targets": ["src/evil.ts"],
      "depends_on": [],
      "kind": "create",
      "exports": [{"kind": "function", "name": "f", "params": [], "returns": "void", "body": ["return"]}]
    },
    {
      "title": "reexport",
      "targets": ["src/index.ts"],
      "depends_on": [1],
      "kind": "reexport",
      "reexport_names": ["f"],
      "barrelFrom": "./evil.js"
    }
  ]
}
EOF
)"
if aegis_supervisor_split_validate_json "${bad_path}" "${parent}" 2>/dev/null; then
  fail "invented path should reject"
fi

# BigInt as type
bad_type="$(printf '%s' "${good_split}" | jq '
  .units[0].exports[0].privateFields[0].type = "BigInt"
')"
if aegis_supervisor_split_validate_json "${bad_type}" "${parent}" 2>/dev/null; then
  fail "BigInt type should reject"
fi

# Emit micros
out="$(mktemp -d)"
n="$(aegis_supervisor_split_emit "${good_split}" "${parent}" "${out}")" \
  || fail "emit failed"
[[ "${n}" == "2" ]] || fail "emit count: ${n}"
[[ -f "${out}/unit-0.md" && -f "${out}/unit-1.md" && -f "${out}/fit.json" ]] \
  || fail "missing emit artifacts"

u0="${out}/unit-0.md"
u1="${out}/unit-1.md"
grep -q 'TokenBucket' "${u0}" || fail "unit-0 missing TokenBucket"
grep -q '## Briefing' "${u0}" || fail "unit-0 missing Briefing"
grep -q 'src/tokenBucket.ts' "${u0}" || fail "unit-0 should target tokenBucket"
grep -q 'Reexport only' "${u0}" && fail "unit-0 should not be reexport"

grep -q 'export {' "${u1}" || fail "unit-1 missing export brace"
grep -q 'constructor' "${u1}" && fail "unit-1 should not carry class ctor"
grep -q 'src/index.ts' "${u1}" || fail "unit-1 should target index"

jq -e '.source == "supervisor_split" and (.proposed_units | length) == 2' \
  "${out}/fit.json" >/dev/null \
  || fail "fit.json shape bad"

# depends reverse in JSON should still emit create first (topo)
reversed="$(printf '%s' "${good_split}" | jq '
  .units = [
    .units[1] + {depends_on: [2], title: "reexport first in array"},
    .units[0] + {depends_on: [], title: "create second in array"}
  ]
')"
out2="$(mktemp -d)"
aegis_supervisor_split_emit "${reversed}" "${parent}" "${out2}" >/dev/null \
  || fail "emit reversed failed"
grep -q 'create second in array' "${out2}/unit-0.md" \
  || fail "topo should put create first: $(head -15 "${out2}/unit-0.md")"
grep -q 'reexport first in array' "${out2}/unit-0.md" \
  && fail "topo failed — reexport became unit-0"

rm -rf "${out}" "${out2}"

echo "[AEGIS][TEST][PASS] supervisor split: validate, emit, topo, scoped units"
