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

echo "[AEGIS][TEST][PASS] barrel reexport preserve: detect deletion + mechanical merge"
