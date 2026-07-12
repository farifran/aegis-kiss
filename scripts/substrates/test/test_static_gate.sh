#!/usr/bin/env bash

# =========================================================
# Static structural gate — mechanical contract tests
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

GATE="scripts/substrates/static_gate.sh"
test_tmp="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

mkdir -p "${test_tmp}/src"
# Minimal package.json so undeclared-import checks have a dependency table.
cat > "${test_tmp}/package.json" <<'JSON'
{
  "name": "static-gate-fixture",
  "private": true,
  "dependencies": {
    "left-pad": "1.0.0"
  }
}
JSON

# --- clean file passes ---
cat > "${test_tmp}/src/clean.ts" <<'EOF'
import leftPad from 'left-pad';
import * as fs from 'fs';
import { join } from 'path';
import { localHelper } from './helper';

export function ok(x: number): number {
  try {
    return x + 1;
  } catch (err) {
    console.error(err);
    return 0;
  }
}
EOF

if ! bash "${GATE}" "${test_tmp}/src/clean.ts"; then
  fail "clean_file_was_rejected"
fi

# --- empty catch fails (type-valid body so tsc is not the failure mode) ---
cat > "${test_tmp}/src/empty_catch.ts" <<'EOF'
export function bad(fn: () => void): void {
  try {
    fn();
  } catch (err) {
  }
}
EOF

if bash "${GATE}" "${test_tmp}/src/empty_catch.ts" 2>/dev/null; then
  fail "empty_catch_was_accepted"
fi

# --- eval fails ---
cat > "${test_tmp}/src/uses_eval.ts" <<'EOF'
export const x: unknown = eval('1+1');
EOF

if bash "${GATE}" "${test_tmp}/src/uses_eval.ts" 2>/dev/null; then
  fail "eval_was_accepted"
fi

# --- undeclared bare import fails ---
cat > "${test_tmp}/src/undeclared.ts" <<'EOF'
import express from 'express';
export default express;
EOF

if bash "${GATE}" "${test_tmp}/src/undeclared.ts" 2>/dev/null; then
  fail "undeclared_import_was_accepted"
fi

# --- declared + node builtin + relative pass ---
cat > "${test_tmp}/src/declared.ts" <<'EOF'
import leftPad from 'left-pad';
import fs from 'fs';
import { helper } from './helper';
export const v = leftPad('a', 2);
void fs;
void helper;
EOF

if ! bash "${GATE}" "${test_tmp}/src/declared.ts"; then
  fail "declared_imports_were_rejected"
fi

# --- lint gate wires static gate (empty catch after syntax-clean TS) ---
# Run from fixture root so local tsc resolution, if any, stays harmless.
LINT="scripts/substrates/aider_lint_gate.sh"
export AEGIS_MODE="repair"
if (
  cd "${test_tmp}"
  bash "${OLDPWD}/${LINT}" "src/empty_catch.ts" 2>/dev/null
); then
  fail "lint_gate_did_not_surface_static_violation"
fi

# --- workspace mode rejects dirty tree ---
if bash "${GATE}" --workspace "${test_tmp}/src" 2>/dev/null; then
  fail "workspace_mode_accepted_violations"
fi

# clean-only workspace slice
mkdir -p "${test_tmp}/clean_only"
cp "${test_tmp}/src/clean.ts" "${test_tmp}/clean_only/clean.ts"
cp "${test_tmp}/package.json" "${test_tmp}/clean_only/package.json"
if ! bash "${GATE}" --workspace "${test_tmp}/clean_only"; then
  fail "clean_workspace_was_rejected"
fi

echo "[PASS] static structural gate"
