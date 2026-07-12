#!/usr/bin/env bash

# =========================================================
# Mutation preflight — one-shot post-diff tsc/test evidence
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

PREFLIGHT="scripts/substrates/mutation_preflight.sh"
test_tmp="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

surface="${test_tmp}/surface"
payloads="${test_tmp}/payloads"
mkdir -p "${surface}" "${payloads}"

export AEGIS_EXECUTION_ID="preflight-test"
export AEGIS_SUBSTRATE_ROOT="${AEGIS_TEST_ROOT}"

# --- disabled flag ---
if ! AEGIS_MUTATION_PREFLIGHT=0 bash "${PREFLIGHT}" "${surface}" "${payloads}"; then
  fail "disabled_preflight_should_pass"
fi

# --- skip when no tsconfig / no meaningful package tests ---
cat > "${surface}/package.json" <<'JSON'
{
  "name": "preflight-fixture",
  "private": true,
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
JSON

if ! bash "${PREFLIGHT}" "${surface}" "${payloads}"; then
  fail "skip_only_surface_should_pass"
fi

# No typescript_check.json expected (no tsconfig)
[[ ! -f "${payloads}/typescript_check.json" ]] \
  || fail "tsc_payload_written_without_tsconfig"

# test.run should skip or pass with "no candidate tests"
# (npm script is the placeholder → capability treats as no tests)
if [[ -f "${payloads}/test_run.json" ]]; then
  jq -e '.payload.status == "passed"' "${payloads}/test_run.json" >/dev/null \
    || fail "placeholder_test_script_should_not_fail_preflight"
fi

[[ -f "${payloads}/mutation_preflight.json" ]] \
  || fail "missing_preflight_index"

jq -e '
  .payload.typescript_check == "skipped"
  and (.payload.test_run == "skipped" or .payload.test_run == "passed")
' "${payloads}/mutation_preflight.json" >/dev/null \
  || fail "unexpected_preflight_index: $(cat "${payloads}/mutation_preflight.json")"

# --- hard-fail when tsc reports failed ---
# Minimal tsconfig + broken TS; link root node_modules for tsc binary.
rm -rf "${payloads:?}"/*
mkdir -p "${payloads}"
cat > "${surface}/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true
  },
  "include": ["broken.ts"]
}
JSON
cat > "${surface}/broken.ts" <<'EOF'
export const x: number = "not-a-number";
EOF

if bash "${PREFLIGHT}" "${surface}" "${payloads}" 2>/dev/null; then
  fail "broken_typescript_should_fail_preflight"
fi

[[ -f "${payloads}/typescript_check.json" ]] \
  || fail "failed_tsc_should_still_materialize_payload"

jq -e '.payload.status == "failed"' "${payloads}/typescript_check.json" >/dev/null \
  || fail "tsc_payload_not_marked_failed"

jq -e '.payload.typescript_check == "failed"' \
  "${payloads}/mutation_preflight.json" >/dev/null \
  || fail "preflight_index_missing_tsc_failed"

echo "[PASS] mutation preflight"
