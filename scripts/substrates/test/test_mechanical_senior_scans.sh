#!/usr/bin/env bash
# =========================================================
# Mechanical optimize / adversarial scans (senior greps)
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/demand.sh"

test_tmp="$(mktemp -d)"
handover="${test_tmp}/handover.json"
test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

write_repair_handover() {
  local diff="$1"
  jq -n --arg diff "${diff}" '
    {
      artifact_snapshot: {
        mode: "repair",
        operational_context: {
          diff: $diff,
          files_changed: ["src/index.ts"],
          intent_violations: []
        }
      },
      epistemic_state: {
        next_attention_targets: ["src/index.ts"],
        attention_scope: "mutation_applied",
        attention_reason: "test"
      }
    }
  ' > "${handover}"
}

# --- optimize: any → can_improve ---
write_repair_handover "$(cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
 export {};
+export const foo = (x: any): number => x;
EOF
)"

imp="$(aegis_mechanical_optimize_scan "${handover}")"
printf '%s' "${imp}" | jq -e '
  .code == "any_in_added_lines"
  and (.target_files | index("src/index.ts") != null)
  and (.change | length) >= 24
  and (.why_safe | length) > 0
' >/dev/null \
  || fail "optimize_scan_should_catch_any: ${imp}"

framed="$(aegis_emit_mechanical_optimize_can_improve "${imp}")"
printf '%s' "${framed}" | grep -q 'AEGIS_ARTIFACT_BEGIN' \
  || fail "optimize_can_improve_missing_frame"
body="$(
  printf '%s' "${framed}" \
    | sed -n '/AEGIS_ARTIFACT_BEGIN/,/AEGIS_ARTIFACT_END/p' \
    | sed -e '1d' -e '$d'
)"
printf '%s' "${body}" | jq -e '
  .status == "can_improve"
  and (.basis | startswith("optimize_mechanical:"))
  and (.improvements | length) == 1
' >/dev/null \
  || fail "optimize_can_improve_body: ${body}"

# --- optimize: clean → no improve ---
write_repair_handover "$(cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
 export {};
+export function add(a: number, b: number): number { return a + b; }
EOF
)"
imp_clean="$(aegis_mechanical_optimize_scan "${handover}")"
[[ -z "${imp_clean}" ]] \
  || fail "optimize_scan_should_be_empty_on_clean: ${imp_clean}"

# --- adversarial: stub ---
write_repair_handover "$(cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,3 @@
 export {};
+export function todo(): void {
+  throw new Error("not implemented");
+}
EOF
)"
# adversarial reads optimize candidate_result OR repair diff via mutation_diff
findings="$(aegis_mechanical_adversarial_diff_scan "${handover}" "")"
printf '%s' "${findings}" | jq -e '
  type == "array" and length >= 1
  and any(.[]; .type == "contract_violation")
  and any(.[]; (.fix|type=="string" and length>0))
' >/dev/null \
  || fail "adversarial_scan_should_catch_stub: ${findings}"

# --- adversarial: clean ---
write_repair_handover "$(cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
 export {};
+export const n = 1;
EOF
)"
findings_clean="$(aegis_mechanical_adversarial_diff_scan "${handover}" "")"
printf '%s' "${findings_clean}" | jq -e 'type == "array" and length == 0' >/dev/null \
  || fail "adversarial_scan_clean_should_be_empty: ${findings_clean}"

echo "[PASS] mechanical senior scans (optimize + adversarial)"
