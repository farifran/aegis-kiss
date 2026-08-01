#!/usr/bin/env bash

# =========================================================
# Barrel reexport preserve — offline mechanical gate
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/demand.sh"

# --- detect reexport demand ---
aegis_demand_is_reexport_preserve "## Change
- reexport only
- Do not delete pre-existing barrel exports
" || fail "should detect reexport preserve"

aegis_demand_is_reexport_preserve "## Goal
create TokenBucket class only
" && fail "plain create must not be reexport preserve"

# Shared Constraints line alone must NOT trigger barrel path (issue #101 bug).
aegis_demand_is_reexport_preserve "## Goal
export TokenBucket only
## Change
- Create or update ONLY \`src/tokenBucket.ts\`
- Scope note: export_slice:TokenBucket
## Constraints
- do not delete pre-existing barrel exports unrelated to this demand
" && fail "export_slice unit must not be reexport_preserve"

# --- removed export names from wipe diff ---
wipe_diff="$(cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,12 +1,3 @@
-// src/index.ts
-export function converterGigabitsEmTerabits(gigabits: bigint): bigint {
-  return gigabits * 1024n;
-}
-export function converterMegabitsEmTerabits(megabits: bigint): bigint {
-  return megabits * 1024n;
-}
+import { TokenBucket, obterEstadoBitmask } from './tokenBucket.js'
+export { TokenBucket, obterEstadoBitmask }
EOF
)"
removed="$(aegis_diff_removed_export_names "${wipe_diff}")"
printf '%s\n' "${removed}" | grep -Fxq 'converterGigabitsEmTerabits' \
  || fail "should detect removed converterGigabitsEmTerabits: ${removed}"
printf '%s\n' "${removed}" | grep -Fxq 'converterMegabitsEmTerabits' \
  || fail "should detect removed converterMegabitsEmTerabits: ${removed}"

# --- mechanical merge from HEAD ---
repo="$(mktemp -d)"
git -C "${repo}" init --quiet
git -C "${repo}" config user.email "test@aegis.local"
git -C "${repo}" config user.name "Aegis Test"
mkdir -p "${repo}/src"
cat > "${repo}/src/index.ts" <<'EOF'
// src/index.ts
export function converterGigabitsEmTerabits(gigabits: bigint): bigint {
  return gigabits * 1024n;
}

export function converterMegabitsEmTerabits(megabits: bigint): bigint {
  return megabits * 1024n;
}
EOF
git -C "${repo}" add -A
git -C "${repo}" commit --quiet -m "seed"

# botched whole-file rewrite
cat > "${repo}/src/index.ts" <<'EOF'
// entire file content ...
import { TokenBucket, obterEstadoBitmask } from './tokenBucket.js'
export { TokenBucket, obterEstadoBitmask }
// ... goes in between
EOF

demand="$(cat <<'EOF'
## Goal
reexport only

## Targets
- src/index.ts

## Change
- reexport only
- Import and re-export TokenBucket, obterEstadoBitmask
- Do not delete pre-existing barrel exports

## Acceptance
- TokenBucket
- obterEstadoBitmask

## Briefing
Em src/index.ts:
   import { TokenBucket, obterEstadoBitmask } from './tokenBucket.js'
   export { TokenBucket, obterEstadoBitmask }
EOF
)"

(
  cd "${repo}" || exit 1
  export AEGIS_REPO_ROOT="${repo}"
  export AEGIS_EXECUTION_SURFACE_PATH="${repo}"
  aegis_mechanical_barrel_reexport_apply "src/index.ts" "${demand}" "${repo}" \
    || exit 1
  grep -q 'converterGigabitsEmTerabits' src/index.ts || exit 1
  grep -q 'converterMegabitsEmTerabits' src/index.ts || exit 1
  grep -q "from './tokenBucket.js'" src/index.ts || exit 1
  grep -q 'TokenBucket' src/index.ts || exit 1
  grep -q 'obterEstadoBitmask' src/index.ts || exit 1
  # no placeholder junk
  grep -q 'entire file content' src/index.ts && exit 1
  exit 0
) || fail "mechanical barrel reexport preserve failed: $(cat "${repo}/src/index.ts")"

rm -rf "${repo}"

# --- empty HEAD reexport (force=1) ---
repo="$(mktemp -d)"
git -C "${repo}" init --quiet
git -C "${repo}" config user.email "test@aegis.local"
git -C "${repo}" config user.name "Aegis Test"
mkdir -p "${repo}/src"
# no index.ts on HEAD
git -C "${repo}" commit --allow-empty --quiet -m "empty"
(
  cd "${repo}" || exit 1
  export AEGIS_REPO_ROOT="${repo}"
  export AEGIS_EXECUTION_SURFACE_PATH="${repo}"
  mkdir -p src
  aegis_mechanical_barrel_reexport_apply "src/index.ts" "${demand}" "${repo}" "1" \
    || exit 1
  grep -q "from './tokenBucket.js'" src/index.ts || exit 1
  grep -q 'TokenBucket' src/index.ts || exit 1
  grep -q 'obterEstadoBitmask' src/index.ts || exit 1
  exit 0
) || fail "force reexport on empty HEAD failed: $(cat "${repo}/src/index.ts" 2>/dev/null)"
rm -rf "${repo}"

# --- junk strip ---
junked="$(cat <<'EOF'
// entire file content ...
export class Foo {}
// ... goes in between
export function bar() { return 1 }
// ...
EOF
)"
clean="$(aegis_strip_aider_whole_file_junk "${junked}")"
printf '%s' "${clean}" | grep -q 'entire file content' && fail "junk strip left entire file content"
printf '%s' "${clean}" | grep -q 'goes in between' && fail "junk strip left goes in between"
printf '%s' "${clean}" | grep -q 'export class Foo' || fail "junk strip ate class"
printf '%s' "${clean}" | grep -q 'export function bar' || fail "junk strip ate function"

# --- export_slice function append ---
repo="$(mktemp -d)"
git -C "${repo}" init --quiet
git -C "${repo}" config user.email "test@aegis.local"
git -C "${repo}" config user.name "Aegis Test"
mkdir -p "${repo}/src"
cat > "${repo}/src/tokenBucket.ts" <<'EOF'
// entire file content ...
export class TokenBucket {
  private _tokens: bigint = 0n;
  get tokens(): bigint { return this._tokens }
  get refillActive(): boolean { return false }
}
EOF
git -C "${repo}" add -A
git -C "${repo}" commit --quiet -m "class only"

fn_demand="$(cat <<'EOF'
## Goal
export obterEstadoBitmask only

## Targets
- src/tokenBucket.ts

## Change
- Scope note: export_slice:obterEstadoBitmask
- Export only top-level obterEstadoBitmask

## Briefing
2) export function obterEstadoBitmask(bucket: TokenBucket): number:
     let mask = 0
     if (bucket.tokens === 0n) { mask |= 1 }
     if (bucket.refillActive) { mask |= 2 }
     return mask

## Acceptance
- obterEstadoBitmask
EOF
)"

aegis_demand_is_export_function_slice "${fn_demand}" \
  || fail "should detect export function slice"
aegis_demand_is_export_function_slice "## Goal
export TokenBucket only
## Briefing
1) export class TokenBucket:
   constructor(): this._x = 0n
## Acceptance
- TokenBucket
" && fail "class slice must not be function slice"

(
  cd "${repo}" || exit 1
  export AEGIS_REPO_ROOT="${repo}"
  export AEGIS_EXECUTION_SURFACE_PATH="${repo}"
  aegis_mechanical_export_function_append "src/tokenBucket.ts" "${fn_demand}" "${repo}" \
    || exit 1
  grep -q 'export function obterEstadoBitmask' src/tokenBucket.ts || exit 1
  grep -q 'export class TokenBucket' src/tokenBucket.ts || exit 1
  grep -q 'mask |= 1' src/tokenBucket.ts || exit 1
  grep -q 'entire file content' src/tokenBucket.ts && exit 1
  # second append is no-op
  if aegis_mechanical_export_function_append "src/tokenBucket.ts" "${fn_demand}" "${repo}"; then
    exit 1
  fi
  exit 0
) || fail "mechanical export function append failed: $(cat "${repo}/src/tokenBucket.ts")"

rm -rf "${repo}"

echo "[AEGIS][TEST][PASS] barrel reexport preserve: detect deletion + mechanical merge + function append"
