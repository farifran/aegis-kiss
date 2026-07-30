#!/usr/bin/env bash

# =========================================================
# Preflight fix taxonomy — classify diagnostics by family
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# Source classify from the preflight module (no main).
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/substrates/aider/preflight.sh"

assert_class() {
  local line="$1"
  local want="$2"
  local got
  got="$(classify_preflight_diagnostic_line "${line}")"
  [[ "${got}" == "${want}" ]] \
    || fail "classify('${line}') -> '${got}', want '${want}'"
}

assert_class 'src/a.ts:1: Unexpected any. Specify a different type.' 'any'
assert_class "src/a.ts:2: Parameter 'x' implicitly has an 'any' type." 'any'
assert_class 'src/a.ts:3: Cannot find module ./foo or its corresponding type declarations.' 'import'
assert_class 'Cannot find package bigint imported from src/x.ts' 'import'
assert_class 'src/a.ts:4: Type string is not assignable to type number.' 'type'
assert_class 'smoke src/index.ts: ERR_MODULE_NOT_FOUND' 'runtime_load'
assert_class 'something unrelated from a custom tool' 'other'

# --- tsc phrases parse errors as "';' expected.", not "expected ;" ---
# Matching the latter meant no tsc syntax diagnostic ever reached `syntax`,
# so the policy about unbalanced braces and nested exports never shipped.
assert_class "src/a.ts:2: TS1005: ';' expected." 'syntax'
assert_class 'src/a.ts:3: TS1109: Expression expected.' 'syntax'
assert_class 'src/a.ts:4: TS1128: Declaration or statement expected.' 'syntax'
assert_class "smoke src/a.ts: /p/a.ts:2 '}' expected." 'syntax'

# --- bigint/number mixing gets its own policy ---
assert_class "src/a.ts:5: TS2365: Operator '*' cannot be applied to types 'number' and 'bigint'." 'numeric'
assert_class 'src/a.ts:6: TS2363: The right-hand side of an arithmetic operation must be of type any, number, bigint or an enum type.' 'numeric'

# --- type errors that used to fall through to `other` ---
assert_class "src/a.ts:7: TS2564: Property 'x' has no initializer and is not definitely assigned in the constructor." 'type'
assert_class "src/a.ts:8: TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value." 'type'
assert_class "src/a.ts:9: TS2540: Cannot assign to 'x' because it is a read-only property." 'type'
assert_class 'src/a.ts:10: TS2554: Expected 2 arguments, but got 1.' 'type'
assert_class "src/a.ts:11: TS18048: 'x' is possibly 'undefined'." 'type'
assert_class "src/a.ts:12: TS2739: Type '{}' is missing the following properties from type 'T'." 'type'
assert_class "src/a.ts:13: TS2304: Cannot find name 'BigInt'." 'import'

# --- previously-correct classes must not regress ---
assert_class 'src/a.ts:14: TS2322: Type string is not assignable to type number.' 'type'
assert_class "src/a.ts:15: TS2339: Property 'foo' does not exist on type 'Bar'." 'type'
assert_class "src/a.ts:16: TS6133: 'x' is declared but its value is never read." 'other'

# Every class must resolve to a non-empty policy line.
# preflight_class_policy reads the policy file relative to the substrate root.
export AEGIS_AIDER_SUBSTRATE_ROOT="${AEGIS_TEST_ROOT}"
for _cls in syntax any import numeric type runtime_load other; do
  [[ -n "$(preflight_class_policy "${_cls}")" ]] \
    || fail "empty_policy_for_class:${_cls}"
done
unset _cls

echo "[PASS] preflight fix taxonomy"
