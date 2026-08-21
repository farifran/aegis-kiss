#!/usr/bin/env bash

# =========================================================
# Intake quality (DEFAULT path) — offline gates
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

aegis_cli="${AEGIS_TEST_ROOT}/aegis"
[[ -x "${aegis_cli}" ]] || fail "aegis is not executable"

# shellcheck disable=SC1090
source "${aegis_cli}"

# --- poison detector ---
aegis_intake_is_poison_accept_token "maxBytes" || fail "maxBytes should be poison"
aegis_intake_is_poison_accept_token "TokenBucket" && fail "TokenBucket must not be poison"
aegis_intake_is_poison_accept_token "timeDiff*rateBitsPerMs" || fail "star token should be poison"

# --- quality check: good demand ---
good="$(cat <<'EOF'
## Goal
Crie src/tokenBucket.ts e re-exporte em src/index.ts.

## Targets
- src/tokenBucket.ts
- src/index.ts

## Acceptance
- TokenBucket
- obterEstadoBitmask

## Briefing
1) export class TokenBucket:
   constructor(maxBytes: bigint, mbps: number): ...
   update(): void: ...
   consume(bits: bigint): boolean: ...
2) export function obterEstadoBitmask(bucket: TokenBucket): number:
   bit0 if tokens==0n; bit1 if refill
Em src/index.ts:
   import { TokenBucket, obterEstadoBitmask } from './tokenBucket.js'
   export { TokenBucket, obterEstadoBitmask }

## Out of scope
- e2e

## Constraints
- no any
EOF
)"
aegis_intake_quality_check "${good}" 2>/tmp/q_ok.err \
  || fail "good demand should pass quality: $(cat /tmp/q_ok.err)"

# --- poison acceptance ---
bad_poison="$(printf '%s\n' "${good}" | sed 's/- obterEstadoBitmask/- obterEstadoBitmask\n- maxBytes/')"
if aegis_intake_quality_check "${bad_poison}" 2>/tmp/q_poison.err; then
  fail "poison acceptance should fail"
fi
grep -q 'poison_acceptance:maxBytes' /tmp/q_poison.err \
  || fail "expected poison_acceptance:maxBytes got $(cat /tmp/q_poison.err)"

# --- empty briefing ---
bad_brief="$(printf '%s\n' "${good}" | awk '
  /^## Briefing/ { print; skip=1; next }
  /^## / { skip=0 }
  skip { next }
  { print }
')"
# ensure_briefing should fill stubs; quality on empty without inject fails
if aegis_intake_quality_check "${bad_brief}" 2>/tmp/q_empty.err; then
  fail "empty briefing should fail quality"
fi
grep -q 'empty_briefing' /tmp/q_empty.err \
  || fail "expected empty_briefing: $(cat /tmp/q_empty.err)"

# inject stubs then pass for simple accept
micro="$(cat <<'EOF'
## Goal
Add helper.

## Targets
- src/index.ts

## Acceptance
- converterGigabitsEmTerabits

## Briefing

## Out of scope
- e2e

## Constraints
- no any
EOF
)"
filled="$(aegis_intake_ensure_briefing "${micro}")"
printf '%s\n' "${filled}" | grep -q 'export function converterGigabitsEmTerabits' \
  || fail "ensure_briefing should stub export: ${filled}"
aegis_intake_quality_check "${filled}" 2>/tmp/q_micro.err \
  || fail "micro with stubs should pass: $(cat /tmp/q_micro.err)"

# --- CLI: quality default without API refuses free prose without --accept ---
export AEGIS_BRIEFING=0
unset AEGIS_INTAKE_RELAXED 2>/dev/null || true
export AEGIS_INTAKE_RELAXED=0
export AEGIS_AGENTIC=0


set +e
no_accept_out="$(
  "${aegis_cli}" go --goal "criar um token bucket complexo" --target src/index.ts 2>&1
)"
no_accept_rc=$?
set -e
[[ "${no_accept_rc}" -ne 0 ]] || fail "quality default should refuse free prose without accept"
printf '%s\n' "${no_accept_out}" | grep -q 'intake_failed' \
  || fail "expected intake_failed: ${no_accept_out}"

# --- CLI: --accept path works offline under quality default ---
set +e
accept_out="$(
  printf 'n\n' | "${aegis_cli}" go \
    --goal "adicionar converterGigabitsEmTerabits a src/index.ts" \
    --target src/index.ts \
    --accept converterGigabitsEmTerabits 2>&1
)"
accept_rc=$?
set -e
[[ "${accept_rc}" -ne 0 ]] || fail "declining should exit non-zero"
printf '%s\n' "${accept_out}" | grep -q 'intake: quality check ok\|intake: corpo a partir de --accept' \
  || fail "expected quality accept path: ${accept_out}"
printf '%s\n' "${accept_out}" | grep -q 'export function converterGigabitsEmTerabits' \
  || fail "briefing stub missing in draft: ${accept_out}"
printf '%s\n' "${accept_out}" | grep -qx -- '- converterGigabitsEmTerabits' \
  || fail "accept token missing: ${accept_out}"

# --- CLI: --relaxed still derives accept from camelCase goal ---
set +e
relaxed_out="$(
  printf 'n\n' | AEGIS_INTAKE_RELAXED=1 AEGIS_BRIEFING=0 "${aegis_cli}" go \
    "adicionar converterPetabitsEmBits a src/index.ts" \
    --target src/index.ts 2>&1
)"
relaxed_rc=$?
set -e
[[ "${relaxed_rc}" -ne 0 ]] || fail "decline should be non-zero"
printf '%s\n' "${relaxed_out}" | grep -qx -- '- converterPetabitsEmBits' \
  || fail "relaxed should derive accept: ${relaxed_out}"

echo "[AEGIS][TEST][PASS] intake quality: gates, stubs, fail-closed, --accept, --relaxed"
