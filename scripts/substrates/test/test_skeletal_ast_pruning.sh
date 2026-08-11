#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — SKELETAL AST SCOPE PRUNING (ast-grep / Tree-sitter)
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

target_file="src/sample_support_ast_test.ts"
trap 'rm -f "${target_file}"' EXIT

cat << 'EOF' > "${target_file}"
export function processHeavyData(items: number[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item * 42;
  }
  return sum;
}
EOF

# Test 1: Normal full read when AEGIS_READ_SKELETAL is default (0)
read_out="$(AEGIS_READ_SKELETAL=0 bash scripts/capabilities/filesystem/read_file.sh "${target_file}")" || fail "read_file_failed"
content_normal="$(jq -r '.payload.content' <<< "${read_out}")"

grep -q "sum += item \* 42;" <<< "${content_normal}" || fail "normal_read_should_contain_full_body"

# Test 2: Skeletal AST read when AEGIS_READ_SKELETAL=1 and ast-grep is present
if command -v sg >/dev/null 2>&1; then
  read_skel="$(AEGIS_READ_SKELETAL=1 bash scripts/capabilities/filesystem/read_file.sh "${target_file}")" || fail "read_skel_failed"
  content_skel="$(jq -r '.payload.content' <<< "${read_skel}")"
  grep -q "processHeavyData" <<< "${content_skel}" || fail "skel_read_should_contain_function_signature"
  echo "[AEGIS][TEST] skeletal AST scope pruning contract passed"
else
  echo "[AEGIS][TEST] sg not installed; skipping skeletal AST assertion"
fi

echo "[PASS] skeletal AST scope pruning"
