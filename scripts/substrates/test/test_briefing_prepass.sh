#!/usr/bin/env bash

# =========================================================
# Briefing pre-pass — supervisor output is advisory, never trusted
# =========================================================
# No network: every case drives aegis_briefing_validate directly. The gate is
# the whole point of the feature — a supervisor answer that slips through
# writes the promotion contract for the entire run.

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/briefing.sh"

good_body="$(cat <<'EOF'
## Goal
Crie src/eventEmitter.ts e re-exporte tudo no src/index.ts.

## Targets
- src/eventEmitter.ts
- src/index.ts

## Acceptance
- EventEmitter
- contarOuvintes

## Briefing
1) export class EventEmitter:
   Campos privados: _ouvintes: Map<string, unknown[]>
   constructor(): this._ouvintes = new Map()
2) export function contarOuvintes(e: EventEmitter): number:
   return 0

## Out of scope
- unrelated files

## Constraints
- no any
EOF
)"

assert_valid() {
  aegis_briefing_validate "$1" 2>/dev/null \
    || fail "should_accept: $2"
}

assert_rejected() {
  local body="$1" want="$2" got
  # pipefail would surface the validator's own rejection status and set -e
  # would kill the suite before the assertion runs.
  got="$(aegis_briefing_validate "${body}" 2>&1 >/dev/null | tail -n 1 || true)"
  if aegis_briefing_validate "${body}" 2>/dev/null; then
    fail "should_reject_but_accepted: ${want}"
  fi
  printf '%s' "${got}" | grep -q "${want}" \
    || fail "wrong_reject_reason: got '${got}', want '${want}'"
}

# --- the happy path must actually pass, or the feature is dead weight ---
assert_valid "${good_body}" "well_formed_supervisor_output"

# --- section structure ---
assert_rejected "" "empty_response"
assert_rejected "$(printf '%s' "${good_body}" | grep -v '^## Briefing$')" "missing_section:Briefing"
assert_rejected "$(printf '%s' "${good_body}" | grep -v '^## Acceptance$')" "missing_section:Acceptance"

# --- code fences would carry backticks into the permanent record ---
assert_rejected "$(printf '```markdown\n%s\n```' "${good_body}")" "contains_code_fence"

# --- Acceptance must be bare identifiers. A prose line makes fit_check throw
# the list away and rebuild it by grepping the Goal — the exact path that put
# maxBytes into the contract and killed issue #65. ---
assert_rejected \
  "${good_body//- contarOuvintes/- the emitter should count its listeners}" \
  "acceptance_not_identifier"

# --- and the supervisor must export what it calls public. This is the check
# that catches a private field promoted into the contract at generation time,
# before a single model call is spent on it. ---
assert_rejected \
  "${good_body//- contarOuvintes/- _ouvintes}" \
  "acceptance_not_exported_in_briefing"

# --- targets must stay inside the repo ---
assert_rejected \
  "${good_body//- src\/eventEmitter.ts/- /etc/passwd}" \
  "bad_target"
assert_rejected \
  "${good_body//- src\/eventEmitter.ts/- ../../escape.ts}" \
  "bad_target"

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
