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

# --- layer-2: Math.min/max on bigint bodies is rejectable (monstro #92) ---
assert_rejected \
  "$(mutate '.exports[0].methods[0].body = ["this._tokens = Math.min(this._tokens + 1n, 10n)"]')" \
  "math_on_bigint"
# Math.floor on numbers then BigInt() must still be allowed
aegis_briefing_validate_json "$(mutate '.exports[0].methods[0].body = ["this._tokens += BigInt(Math.floor(3 * 8000))"]')" 2>/dev/null \
  || fail "math_floor_on_number_should_be_accepted"

# --- layer-2 stable constraints always land in rendered Constraints ---
printf '%s' "${rendered}" | grep -q 'NEVER Math.min' \
  || fail "render_missing_stable_math_rule"
printf '%s' "${rendered}" | grep -q 'never BigInt/Number' \
  || fail "render_missing_stable_type_rule"

# --- sanitize rewrites Math.min to a clamp ternary before validate ---
sanitized="$(aegis_briefing_sanitize_json "$(mutate '.exports[0].methods[0].body = ["this._tokens = Math.min(this._tokens + 1n, this._max)"]')")"
printf '%s' "${sanitized}" | jq -e '
  .exports[0].methods[0].body[0] | test("Math\\.min") | not
' >/dev/null \
  || fail "sanitize_should_rewrite_math_min: ${sanitized}"
aegis_briefing_validate_json "${sanitized}" 2>/dev/null \
  || fail "sanitized_math_min_should_validate"

# --- the schema has no private helpers: a call the class never declares is a
# TS2339 the coder cannot fix from the Briefing (bitset loop, _checkIndex) ---
assert_rejected \
  "$(mutate '.exports[0].methods[0].body = ["this._checkIndex(bits)", "return true"]')" \
  "undeclared_member:_checkIndex"
aegis_briefing_validate_json \
  "$(mutate '.exports[0].methods += [{"name":"_checkIndex","params":[{"name":"i","type":"bigint"}],"returns":"void","body":["return"]}] | .exports[0].methods[0].body = ["this._checkIndex(bits)", "return true"]')" \
  2>/dev/null || fail "declared_underscore_method_should_be_accepted"
aegis_briefing_validate_json \
  "$(mutate '.exports[0].methods[0].body = ["return this._tokens.toString(2).length > 0"]')" \
  2>/dev/null || fail "member_call_on_field_should_be_accepted"

# --- a named data shape is expressible without an interface export: it
# renders into the Briefing but never reaches Acceptance or the barrel,
# because a type has no runtime symbol for the smoke test to import ---
_typed="$(mutate '.types = [{"name":"FieldProblem","shape":"{ field: string; reason: string }"}] | .exports[1].returns = "FieldProblem[]"')"
aegis_briefing_validate_json "${_typed}" 2>/dev/null || fail "types_array_should_be_accepted"
_typed_render="$(aegis_briefing_render "${_typed}")"
printf '%s' "${_typed_render}" | grep -q '^type FieldProblem = { field: string; reason: string }$' \
  || fail "render_missing_named_type: ${_typed_render}"
printf '%s' "${_typed_render}" \
  | awk '/^## Acceptance$/ {p=1; next} /^## / {p=0} p' | grep -q 'FieldProblem' \
  && fail "named_type_must_not_reach_acceptance"
printf '%s' "${_typed_render}" | grep -q 'import { TokenBucket, obterEstadoBitmask }' \
  || fail "named_type_must_not_enter_the_barrel"
assert_rejected "$(mutate '.types = [{"name":"Bad Name","shape":"{}"}]')"        "type_not_identifier"
assert_rejected "$(mutate '.types = [{"name":"FieldProblem","shape":""}]')"      "type_without_shape"

# --- the tsc gate: the schema is compiled before the coder sees it. Fatal
# codes reject; strict-null residue never does, because ## Constraints already
# tells the coder to bind and guard, and rejecting would cost every honest
# briefing that indexes an array ---
aegis_briefing_typecheck_json "${good_json}" >/dev/null \
  || fail "compilable_schema_should_pass_typecheck"
aegis_briefing_typecheck_json \
  "$(mutate '.exports[1].params[0].type = "TokenBucketMissing"')" >/dev/null \
  && fail "unknown_type_should_fail_typecheck"
aegis_briefing_typecheck_json \
  "$(mutate '.exports[1].body = ["const rows: string[][] = []", "return rows[0].length"]')" >/dev/null \
  || fail "strictnull_residue_must_not_reject"
(
  export AEGIS_BRIEFING_TYPECHECK=0
  aegis_briefing_typecheck_json "$(mutate '.exports[1].params[0].type = "TokenBucketMissing"')" >/dev/null
) || fail "AEGIS_BRIEFING_TYPECHECK=0_should_disable"
# config.sh marks AEGIS_ROOT_DIR readonly, so fail-open is proven in a child
# process pointed at a directory with no tsc and no tsconfig.
env AEGIS_ROOT_DIR="$(mktemp -d)" bash -c '
  source "$0/scripts/lib/briefing.sh"
  aegis_briefing_typecheck_json "$1" >/dev/null
' "${AEGIS_TEST_ROOT}" "$(mutate '.exports[1].params[0].type = "TokenBucketMissing"')" \
  || fail "typecheck_should_fail_open_without_tsc"

# --- sanitize aligns barrelFrom casing with the target: ./tokenbucket.js
# against src/tokenBucket.ts is TS2307 everywhere except macOS ---
[[ "$(aegis_briefing_sanitize_json "$(mutate '.barrelFrom = "./tokenbucket.js"')" \
      | jq -r '.barrelFrom')" == "./tokenBucket.js" ]] \
  || fail "sanitize_should_fix_barrel_casing"

# --- a body may declare as many distinct consts as it needs; only the same
# name twice in one scope is the decode glitch worth rejecting ---
aegis_briefing_quality_check \
  "$(mutate '.exports[1].body = ["const a = 1", "const b = 2", "const c = 3", "return a + b + c"]')" \
  || fail "distinct_consts_should_pass_quality"
aegis_briefing_quality_check \
  "$(mutate '.exports[1].body = ["const end = 1", "const end = 2", "return end"]')" \
  && fail "redeclared_const_should_fail_quality"
# two loops may each declare their own const: block scope is not one scope
aegis_briefing_quality_check \
  "$(mutate '.exports[1].body = ["for (let i = 0; i < 2; i++) {", "  const x = i", "}", "for (let j = 0; j < 2; j++) {", "  const x = j", "}", "return 0"]')" \
  || fail "block_scoped_consts_should_pass_quality"

# --- `!` is banned repo-wide (enforcement/rules/no-non-null-assertion.yml).
# Rewriting beats rejecting: the briefing survives, the static gate stays green ---
_nn="$(aegis_briefing_sanitize_json \
  "$(mutate '.exports[0].methods[0].body = ["return this._map.get(bits)!.value"] | .behavior = [{"desc":"x","exports":["TokenBucket"],"prelude":["const i = new TokenBucket(1n)"],"assert":"i.find()!.tokens === 1n"}]')")"
printf '%s' "${_nn}" | grep -q '!\.' && fail "sanitize_should_rewrite_nonnull_assertion: ${_nn}"
printf '%s' "${_nn}" | jq -e '.exports[0].methods[0].body[0] | test("get\\(bits\\)\\?\\.value")' >/dev/null \
  || fail "nonnull_body_should_become_optional_chain: ${_nn}"
printf '%s' "${_nn}" | jq -e '.behavior[0].assert | test("find\\(\\)\\?\\.tokens")' >/dev/null \
  || fail "nonnull_assert_should_become_optional_chain: ${_nn}"

# negation and strict inequality are not assertions and must survive untouched
printf '%s' "$(aegis_briefing_sanitize_json \
  "$(mutate '.exports[1].body = ["if (b.tokens !== 0n) return 1", "return !b.tokens ? 0 : 1"]')")" \
  | jq -e '.exports[1].body | join(" ") | test("!==") and test("!b.tokens")' >/dev/null \
  || fail "negation_and_strict_inequality_must_survive_sanitize"

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

# --- the supervisor model must not inherit the coder's. Filling this schema
# is a small constrained task the 8B does in 3-4s; the 70B took 100-120s to
# make the same mistakes. Inheriting OPENAI_MODEL_MUTATION would silently put
# whatever the coder runs in front of every single run. ---
(
  unset AEGIS_SUPERVISOR_MODEL
  export OPENAI_MODEL_MUTATION="meta/llama-3.3-70b-instruct"
  export AEGIS_MUTATION_MODEL="meta/llama-3.3-70b-instruct"
  [[ "$(aegis_briefing_model)" == "z-ai/glm-5.2" ]]
) || fail "default_supervisor_should_not_inherit_mutation_model"

(
  export AEGIS_SUPERVISOR_MODEL="some/other-model"
  [[ "$(aegis_briefing_model)" == "some/other-model" ]]
) || fail "AEGIS_SUPERVISOR_MODEL_should_override"

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
