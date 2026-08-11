#!/usr/bin/env bash
# =========================================================
# AEGIS TEST — MECHANICAL LANGUAGE DETECTOR
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"
source "scripts/lib/language_detector.sh"

test_tmp="$(mktemp -d)"

cleanup_test() {
  rm -rf "${test_tmp}"
}
trap cleanup_test EXIT

# 1. Test TypeScript sentinel detection
mkdir -p "${test_tmp}/ts_proj"
touch "${test_tmp}/ts_proj/tsconfig.json"
ts_lang="$(aegis_detect_target_language "${test_tmp}/ts_proj")"
[[ "${ts_lang}" == "typescript" ]] || fail "expected typescript, got ${ts_lang}"

# 2. Test Python sentinel detection
mkdir -p "${test_tmp}/py_proj"
touch "${test_tmp}/py_proj/requirements.txt"
py_lang="$(aegis_detect_target_language "${test_tmp}/py_proj")"
[[ "${py_lang}" == "python" ]] || fail "expected python, got ${py_lang}"

# 3. Test Rust sentinel detection
mkdir -p "${test_tmp}/rs_proj"
touch "${test_tmp}/rs_proj/Cargo.toml"
rs_lang="$(aegis_detect_target_language "${test_tmp}/rs_proj")"
[[ "${rs_lang}" == "rust" ]] || fail "expected rust, got ${rs_lang}"

# 4. Test Go sentinel detection
mkdir -p "${test_tmp}/go_proj"
touch "${test_tmp}/go_proj/go.mod"
go_lang="$(aegis_detect_target_language "${test_tmp}/go_proj")"
[[ "${go_lang}" == "go" ]] || fail "expected go, got ${go_lang}"

echo "[PASS] language detector test"
