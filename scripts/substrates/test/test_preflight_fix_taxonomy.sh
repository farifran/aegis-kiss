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

echo "[PASS] preflight fix taxonomy"
