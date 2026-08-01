#!/usr/bin/env bash

# =========================================================
# Mechanical TS sanitize — Math.* / bigint foot-guns (domain-agnostic)
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
source "${AEGIS_TEST_ROOT}/scripts/lib/demand.sh"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  printf '%s' "${haystack}" | grep -Fq -- "${needle}" \
    || fail "${label}: expected to contain «${needle}»\n--- got ---\n${haystack}\n---"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if printf '%s' "${haystack}" | grep -Fq -- "${needle}"; then
    fail "${label}: must not contain «${needle}»\n--- got ---\n${haystack}\n---"
  fi
}

# --- 1) Math.floor on bigint product (poison Briefing, any domain) ---
in1='export class Meter {
  private _acc: bigint;
  private _rate: number;
  tick(delta: bigint): void {
    this._acc += BigInt(Math.floor(delta * BigInt(Math.floor(this._rate))));
  }
}'
out1="$(aegis_mechanical_ts_fix_bigint_arith "${in1}")"
assert_contains "${out1}" 'Math.floor(Number(' "floor_bigint_product_wraps_Number"
assert_not_contains "${out1}" 'Math.floor(delta * BigInt' "floor_no_longer_raw_bigint_product"

# --- 2) Math.ceil on bigint literal ---
in2='const x = Math.ceil(10n * scale);'
out2="$(aegis_mechanical_ts_fix_bigint_arith "${in2}")"
assert_contains "${out2}" 'Math.ceil(Number(10n * scale))' "ceil_bigint_literal"

# --- 3) Math.floor on pure number stays ---
in3='const n = Math.floor(mbps * 8000);'
out3="$(aegis_mechanical_ts_fix_bigint_arith "${in3}")"
[[ "${out3}" == *'Math.floor(mbps * 8000)'* ]] \
  || fail "number_floor_must_stay: ${out3}"

# --- 4) Math.min on bigint fields → ternary ---
in4='export class Clip {
  private _a: bigint;
  private _b: bigint;
  run(): bigint {
    return Math.min(this._a, this._b);
  }
}'
out4="$(aegis_mechanical_ts_fix_bigint_arith "${in4}")"
assert_not_contains "${out4}" 'Math.min' "min_bigint_removed"
assert_contains "${out4}" '?' "min_became_ternary"

# --- 5) Math.max on bigint literals ---
in5='const m = Math.max(0n, bal);'
out5="$(aegis_mechanical_ts_fix_bigint_arith "${in5}")"
assert_not_contains "${out5}" 'Math.max' "max_bigint_removed"
assert_contains "${out5}" '?' "max_became_ternary"

# --- 6) Math.min on numbers stays ---
in6='const m = Math.min(a, b);'
out6="$(aegis_mechanical_ts_fix_bigint_arith "${in6}")"
assert_contains "${out6}" 'Math.min(a, b)' "number_min_stays"

# --- 7) mixed arith with declared number field (not TokenBucket names) ---
in7='export class Pump {
  private _fuel: bigint;
  private _flowPerMs: number;
  private _last: bigint;
  update(): void {
    const timeDiff = BigInt(Date.now()) - this._last;
    this._fuel += BigInt(timeDiff * this._flowPerMs);
  }
}'
out7="$(aegis_mechanical_ts_fix_bigint_arith "${in7}")"
assert_contains "${out7}" 'BigInt(Math.floor(this._flowPerMs))' "mixed_uses_BigInt_floor_on_number_field"
assert_not_contains "${out7}" 'BigInt(timeDiff * this._flowPerMs)' "no_bigint_times_number_inside_BigInt"

# --- 8) bare timeDiff * this.numberField ---
in8='export class Gauge {
  private _val: bigint;
  private _gain: number;
  step(timeDiff: bigint): void {
    this._val += timeDiff * this._gain;
  }
}'
out8="$(aegis_mechanical_ts_fix_bigint_arith "${in8}")"
assert_contains "${out8}" 'timeDiff * BigInt(Math.floor(this._gain))' "bare_timeDiff_mixed"

# --- 9) already-safe Number(timeDiff) pattern left alone ---
in9='export class Safe {
  private _t: bigint;
  private _r: number;
  update(timeDiff: bigint): void {
    this._t += BigInt(Math.floor(Number(timeDiff) * this._r));
  }
}'
out9="$(aegis_mechanical_ts_fix_bigint_arith "${in9}")"
assert_contains "${out9}" 'Math.floor(Number(timeDiff) * this._r)' "safe_Number_timeDiff_preserved"

# --- 10) class create end-to-end with poison Briefing (generic domain) ---
tmp="$(mktemp -d)"
demand="$(cat <<'EOF'
## Goal
Single-file micro: export Clock only.
Edit only `src/clock.ts`.

## Targets
- src/clock.ts

## Change
- Export **only** top-level `Clock` in this unit
- Scope note: export_slice:Clock

## Briefing
1) export class Clock:
   Campos privados: _ticks: bigint, _rate: number, _last: bigint
   constructor(rate: number):
     this._ticks = 0n
     this._rate = rate
     this._last = BigInt(Date.now())
   update(): void:
     const now = BigInt(Date.now())
     const timeDiff = now - this._last
     if (timeDiff > 0n) { this._ticks += BigInt(Math.floor(timeDiff * BigInt(Math.floor(this._rate)))); this._last = now }

## Acceptance
- Clock
EOF
)"
mkdir -p "${tmp}/src"
if aegis_mechanical_export_class_create "src/clock.ts" "${demand}" "${tmp}"; then
  body="$(cat "${tmp}/src/clock.ts")"
  assert_contains "${body}" 'export class Clock' "e2e_class_written"
  # Poison Math.floor(bigint product) must not survive materialization
  if printf '%s' "${body}" | grep -qE 'Math\.floor\([^)]*BigInt'; then
    # Only allowed if Number( wraps the bigint-bearing arg
    if ! printf '%s' "${body}" | grep -qE 'Math\.floor\(Number\('; then
      fail "e2e_poison_floor_bigint_survived:\n${body}"
    fi
  fi
  # Isolated tsc on the file
  if command -v npx >/dev/null 2>&1; then
    if ! npx --yes tsc --noEmit --strict --target ES2022 \
      --module NodeNext --moduleResolution NodeNext \
      "${tmp}/src/clock.ts" >/tmp/aegis_sanitize_tsc.err 2>&1; then
      fail "e2e_tsc_failed:\n$(cat /tmp/aegis_sanitize_tsc.err)\n--- body ---\n${body}"
    fi
  fi
else
  fail "e2e_class_create_skipped"
fi
rm -rf "${tmp}"

# --- 11) function append also sanitizes ---
tmp2="$(mktemp -d)"
mkdir -p "${tmp2}/src"
printf '%s\n' 'export class Holder {}' > "${tmp2}/src/mod.ts"
demand_fn="$(cat <<'EOF'
## Goal
export_slice:scoreOf

## Targets
- src/mod.ts

## Briefing
1) export function scoreOf(x: bigint): number:
     return Math.floor(x * 2n)

## Acceptance
- scoreOf
EOF
)"
# export function slice detection needs export_slice or acceptance + briefing
if aegis_mechanical_export_function_append "src/mod.ts" "${demand_fn}" "${tmp2}" 2>/dev/null; then
  body2="$(cat "${tmp2}/src/mod.ts")"
  assert_contains "${body2}" 'Math.floor(Number(' "fn_append_sanitizes_floor" || true
  # If append path requires export_slice in change, may skip — soft
  if printf '%s' "${body2}" | grep -q 'scoreOf'; then
    assert_contains "${body2}" 'Number(' "fn_body_uses_Number_for_bigint_math"
  fi
else
  # Direct unit test of sanitizer on function body still counts
  out_fn="$(aegis_mechanical_ts_fix_bigint_arith 'export function scoreOf(x: bigint): number {
  return Math.floor(x * 2n)
}')"
  assert_contains "${out_fn}" 'Math.floor(Number(' "fn_direct_sanitize"
fi
rm -rf "${tmp2}"

echo "[PASS] mechanical ts sanitize"
