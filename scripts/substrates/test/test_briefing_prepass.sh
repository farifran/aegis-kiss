#!/usr/bin/env bash

# =========================================================
# Briefing pre-pass — supervisor fills a schema, this side renders
# =========================================================
# No network: every case drives the validator and the renderer directly.
# The gate decides the promotion contract for the whole run, so a bad answer
# slipping through is worse than no pre-pass at all.

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/briefing.sh"

good_json='{
  "goal": "Crie src/tokenBucket.ts e re-exporte no src/index.ts.",
  "targets": ["src/tokenBucket.ts", "src/index.ts"],
  "exports": [
    {"kind": "class", "name": "TokenBucket",
     "privateFields": [{"name": "_tokens", "type": "bigint"}],
     "ctorParams": [{"name": "maxBytes", "type": "bigint"}],
     "ctorBody": ["this._tokens = maxBytes"],
     "methods": [{"name": "consume", "params": [{"name": "bits", "type": "bigint"}],
                  "returns": "boolean", "body": ["return this._tokens >= bits"]}],
     "getters": [{"name": "tokens", "returns": "bigint", "body": "return this._tokens"}]},
    {"kind": "function", "name": "obterEstadoBitmask",
     "params": [{"name": "b", "type": "TokenBucket"}], "returns": "number",
     "body": ["return b.tokens === 0n ? 1 : 0"]}
  ],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./tokenBucket.js"
}'

assert_rejected() {
  local json="$1" want="$2" got
  # pipefail would surface the validator's own rejection status and set -e
  # would kill the suite before the assertion runs.
  got="$(aegis_briefing_validate_json "${json}" 2>&1 >/dev/null | tail -n 1 || true)"
  if aegis_briefing_validate_json "${json}" 2>/dev/null; then
    fail "should_reject_but_accepted: ${want}"
  fi
  printf '%s' "${got}" | grep -q "${want}" \
    || fail "wrong_reject_reason: got '${got}', want '${want}'"
}

mutate() {
  printf '%s' "${good_json}" | jq -c "$1"
}

# --- the happy path must pass, or the feature is dead weight ---
aegis_briefing_validate_json "${good_json}" 2>/dev/null \
  || fail "well_formed_schema_should_be_accepted"

# --- Acceptance is DERIVED, never authored. This is the invariant that makes
# the failure which killed issue #65 unrepresentable rather than merely
# checked: a private field cannot reach the contract because the contract is
# the exports list. ---
rendered="$(aegis_briefing_render "${good_json}")"
acceptance="$(printf '%s\n' "${rendered}" \
  | awk '/^## Acceptance$/ {p=1; next} /^## / {p=0} p' | sed -E '/^[[:space:]]*$/d')"

printf '%s' "${acceptance}" | grep -q '^- TokenBucket$' \
  || fail "acceptance_missing_class: ${acceptance}"
printf '%s' "${acceptance}" | grep -q '^- obterEstadoBitmask$' \
  || fail "acceptance_missing_function: ${acceptance}"
printf '%s' "${acceptance}" | grep -qE '_tokens|maxBytes|bits' \
  && fail "internal_name_reached_acceptance: ${acceptance}"
[[ "$(printf '%s\n' "${acceptance}" | wc -l | tr -d ' ')" == "2" ]] \
  || fail "acceptance_should_have_exactly_two_lines: ${acceptance}"

# Every acceptance line must be a bare identifier, or fit_check throws the
# list away and rebuilds it by grepping the Goal.
while IFS= read -r line; do
  [[ -n "${line}" ]] || continue
  printf '%s' "${line#- }" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*$' \
    || fail "acceptance_line_not_identifier: ${line}"
done <<< "${acceptance}"

# --- the rendered body must carry what the pipeline reads downstream ---
printf '%s' "${rendered}" | grep -q '^## Briefing$' || fail "render_missing_briefing"
printf '%s' "${rendered}" | grep -q '^## Targets$'  || fail "render_missing_targets"
printf '%s' "${rendered}" | grep -q "from './tokenBucket.js'" \
  || fail "render_missing_nodenext_barrel"
printf '%s' "${rendered}" | grep -q '```' && fail "render_emitted_code_fence"

# --- structural rejections ---
assert_rejected 'not json at all'            "invalid_json"
assert_rejected "$(mutate '.goal = ""')"      "empty_goal"
assert_rejected "$(mutate '.targets = []')"   "empty_targets"
assert_rejected "$(mutate '.exports = []')"   "empty_exports"

# --- a constructor is not a type. Both models tested wrote `_tokens: BigInt`
# consistently; in prose that was invisible, as a field it is rejectable. ---
assert_rejected \
  "$(mutate '.exports[0].privateFields[0].type = "BigInt"')" \
  "constructor_used_as_type:BigInt"
assert_rejected \
  "$(mutate '.exports[0].ctorParams[0].type = "Number"')" \
  "constructor_used_as_type:Number"
assert_rejected \
  "$(mutate '.exports[1].params[0].type = "String"')" \
  "constructor_used_as_type:String"

# --- identifiers. The 8B emitted `TokenBucketState.Bitmask` as an export. ---
assert_rejected \
  "$(mutate '.exports[1].name = "TokenBucketState.Bitmask"')" \
  "name_not_identifier"
assert_rejected \
  "$(mutate '.exports[1].name = "_privateThing"')" \
  "private_as_export"
assert_rejected \
  "$(mutate '.exports[0].methods[0].name = "method(refill()"')" \
  "method_not_identifier"

# --- over-delivery: the 8B invented rebitmask and getBit unprompted ---
assert_rejected \
  "$(mutate '.exports += [{"kind":"function","name":"extraOne","params":[],"returns":"void","body":["return"]},{"kind":"function","name":"extraTwo","params":[],"returns":"void","body":["return"]}]')" \
  "too_many_exports"

# --- paths must stay inside the repo, barrels must be NodeNext ---
assert_rejected "$(mutate '.targets = ["/etc/passwd"]')"      "bad_target"
assert_rejected "$(mutate '.targets = ["../escape.ts"]')"     "bad_target"
assert_rejected "$(mutate '.barrelFrom = "./tokenBucket"')"   "barrel_not_nodenext"
assert_rejected "$(mutate '.exports[0].kind = "interface"')"  "bad_kind"

# --- the pre-pass must be disableable and must not fire without a key ---
(
  export AEGIS_BRIEFING=0 OPENAI_API_KEY=x
  aegis_briefing_enabled && exit 1 || exit 0
) || fail "AEGIS_BRIEFING=0_should_disable"

(
  unset OPENAI_API_KEY NVIDIA_API_KEY
  export AEGIS_BRIEFING=1
  aegis_briefing_enabled && exit 1 || exit 0
) || fail "no_api_key_should_disable"

# --- the CLI must fall back, never hard-fail, when the supervisor is absent ---
grep -q 'body="$(render_body' "${AEGIS_TEST_ROOT}/aegis" \
  || fail "cli_lost_mechanical_fallback"
grep -q 'aegis_briefing_enabled' "${AEGIS_TEST_ROOT}/aegis" \
  || fail "cli_does_not_call_prepass"

# The pre-pass has to run BEFORE Acceptance is derived from prose, otherwise
# a goal that names no code dies in derive_accept_tokens before the
# supervisor ever gets a chance to structure it.
_pre_line="$(grep -n 'aegis_briefing_enabled' "${AEGIS_TEST_ROOT}/aegis" | head -1 | cut -d: -f1)"
_der_line="$(grep -n 'derived="$(derive_accept_tokens' "${AEGIS_TEST_ROOT}/aegis" | head -1 | cut -d: -f1)"
[[ -n "${_pre_line}" && -n "${_der_line}" && "${_pre_line}" -lt "${_der_line}" ]] \
  || fail "prepass_must_precede_derive_accept_tokens"

echo "[PASS] briefing pre-pass"
