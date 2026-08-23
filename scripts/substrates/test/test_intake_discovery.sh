#!/usr/bin/env bash
# =========================================================
# AEGIS INTAKE DISCOVERY & FORENSICS TEST SUITE
# =========================================================
# Verifies that Step 1 (Pre-Intake Discovery & Forensics):
# 1. Discovers top-level exports (types, interfaces, enums, functions, classes)
# 2. Handles net-new files (exists: false)
# 3. Automatically includes the workspace entry point (barrel)
# 4. Respects the 16 KB byte budget without data corruption
# 5. Emits universal workspace topology
# 6. Safely handles comma/space delimited target lists
# =========================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEGIS_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Source demand and briefing helpers
# shellcheck disable=SC1091
source "${AEGIS_ROOT}/scripts/lib/demand.sh"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis_intake_test.XXXXXX")"
trap 'rm -rf "${tmp_dir}"' EXIT

cd "${tmp_dir}"
git init -q
git config user.name "Test"
git config user.email "test@example.com"

mkdir -p src

# 1. Create a rich barrel file with diverse export kinds
cat > src/index.ts <<'TS'
export type UserID = string;
export interface SessionConfig {
  timeoutMs: number;
}
export enum EngineState {
  Idle,
  Running,
  Stopped
}
export const DEFAULT_RATE = 1000;
export function calculateThroughput(bytes: number, sec: number): number {
  return bytes / sec;
}
export class EngineCore {
  private _running = false;
  start() { this._running = true; }
}
export { calculateThroughput as throughputCalc };
TS

git add src/index.ts
git commit -m "init test workspace" -q

echo "[AEGIS][TEST] 1. Testing full export extraction (types, interfaces, enums, classes, functions)..."
result_json="$(aegis_intake_discover_context "src/index.ts")"

exports_count="$(jq -r '.targets[0].exports | length' <<< "${result_json}")"
if [[ "${exports_count}" -lt 6 ]]; then
  echo "FAIL: Expected at least 6 exports, got ${exports_count}" >&2
  echo "${result_json}" >&2
  exit 1
fi

jq -e '.targets[0].exports | index("UserID")' <<< "${result_json}" >/dev/null
jq -e '.targets[0].exports | index("SessionConfig")' <<< "${result_json}" >/dev/null
jq -e '.targets[0].exports | index("EngineState")' <<< "${result_json}" >/dev/null
jq -e '.targets[0].exports | index("calculateThroughput")' <<< "${result_json}" >/dev/null
jq -e '.targets[0].exports | index("EngineCore")' <<< "${result_json}" >/dev/null
jq -e '.targets[0].exports | index("DEFAULT_RATE")' <<< "${result_json}" >/dev/null
echo "  ✓ All export kinds extracted successfully."

echo "[AEGIS][TEST] 2. Testing net-new target discovery..."
result_net_new="$(aegis_intake_discover_context "src/newModule.ts")"
jq -e '(.targets[] | select(.path == "src/newModule.ts")).exists == false' <<< "${result_net_new}" >/dev/null
jq -e '(.targets[] | select(.path == "src/newModule.ts")).snippet == ""' <<< "${result_net_new}" >/dev/null
echo "  ✓ Net-new file accurately marked as non-existent."

echo "[AEGIS][TEST] 3. Testing automatic entry-point (barrel) discovery..."
# Only pass src/newModule.ts, verify src/index.ts is auto-included in targets evidence
jq -e '(.targets[] | select(.path == "src/index.ts")).exists == true' <<< "${result_net_new}" >/dev/null
echo "  ✓ Entry-point (src/index.ts) auto-included for contextual awareness."

echo "[AEGIS][TEST] 4. Testing 16 KB byte budget & truncation flag..."
# Create a 20 KB file
cat > src/largeFile.ts <<'TS'
export function baseFn(): void {}
TS
# Pad with comments to exceed 16 KB (16384 bytes)
for i in $(seq 1 400); do
  printf '// Padding comment line %04d to test 16KB budget\n' "${i}" >> src/largeFile.ts
done
git add src/largeFile.ts
git commit -m "add large file" -q

result_large="$(aegis_intake_discover_context "src/largeFile.ts")"
jq -e '(.targets[] | select(.path == "src/largeFile.ts")).truncated == true' <<< "${result_large}" >/dev/null
jq -e '(.targets[] | select(.path == "src/largeFile.ts")).exports | index("baseFn")' <<< "${result_large}" >/dev/null
echo "  ✓ 16 KB budget respected; large file truncated gracefully without losing exports."

echo "[AEGIS][TEST] 5. Testing workspace pocket map topology..."
jq -e '.topology | index("src/index.ts")' <<< "${result_large}" >/dev/null
jq -e '.topology | index("src/largeFile.ts")' <<< "${result_large}" >/dev/null
echo "  ✓ Workspace topology accurately captured."

echo "[AEGIS][TEST] 6. Testing target list normalization (commas/spaces)..."
result_norm="$(aegis_intake_discover_context "src/largeFile.ts, src/index.ts")"
targets_len="$(jq '.targets | map(.path) | unique | length' <<< "${result_norm}")"
if [[ "${targets_len}" -ne 2 ]]; then
  echo "FAIL: Expected 2 unique targets, got ${targets_len}" >&2
  exit 1
fi
echo "  ✓ Target list normalization passed."

echo ""
echo "[AEGIS][TEST][PASS] All Step 1 Pre-Intake Discovery & Forensics tests passed with 100% precision!"
