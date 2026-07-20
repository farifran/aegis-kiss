#!/usr/bin/env bash
# =========================================================
# Preflight tools-fix prompt: taxonomy + hard constraints
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/substrates/aider/preflight.sh"

# --- classify: syntax vs import ---
[[ "$(classify_preflight_diagnostic_line 'SyntaxError: Unexpected token function')" == "syntax" ]] \
  || fail "classify_syntax_unexpected_token"
[[ "$(classify_preflight_diagnostic_line 'smoke x.ts: SyntaxError: Unexpected eof')" == "syntax" ]] \
  || fail "classify_smoke_syntax"
[[ "$(classify_preflight_diagnostic_line 'Cannot find module ./foo.js')" == "import" ]] \
  || fail "classify_import"
[[ "$(classify_preflight_diagnostic_line 'Type X is not assignable to Y')" == "type" ]] \
  || fail "classify_type"

# --- assemble_preflight_fix_prompt contains HARD CONSTRAINTS + targets ---
tmp_payload="$(mktemp -d)"
export AIDER_CAPABILITY_PAYLOAD_DIR="${tmp_payload}"
export AEGIS_AIDER_SUBSTRATE_ROOT="${AEGIS_TEST_ROOT}"
export AEGIS_MODE="repair"
export AEGIS_EXECUTION_ID="test-exec"
export AEGIS_INVESTIGATION_INPUT="Add TokenBucketGate"

mkdir -p "${tmp_payload}"
cat > "${tmp_payload}/typescript_check.json" <<'JSON'
{
  "payload": {
    "errors": [
      {
        "file": "src/tokenBucketGate.ts",
        "line": 40,
        "message": "Unexpected token `function`. Expected * for generator"
      }
    ]
  }
}
JSON

prompt_f="$(mktemp)"
assemble_preflight_fix_prompt \
  "${prompt_f}" \
  "whole" \
  "src/tokenBucketGate.ts"

grep -q 'HARD CONSTRAINTS' "${prompt_f}" \
  || fail "missing_hard_constraints"
grep -q 'Edit ONLY' "${prompt_f}" \
  || fail "missing_edit_only"
grep -q 'src/tokenBucketGate.ts' "${prompt_f}" \
  || fail "missing_target_path"
grep -qi 'syntax' "${prompt_f}" \
  || fail "missing_syntax_class_block"
grep -qi 'nest' "${prompt_f}" \
  || fail "missing_nest_guidance"
grep -q 'Unexpected token' "${prompt_f}" \
  || fail "missing_diagnostic_line"

rm -f "${prompt_f}"
rm -rf "${tmp_payload}"

echo "[PASS] preflight tools-fix prompt"
