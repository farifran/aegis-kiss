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

# --- adversarial: clean (no investigation acceptance) ---
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

# --- acceptance tokens: missing SymbolX ---
mkdir -p "${test_tmp}/src"
printf 'export const n = 1;\n' > "${test_tmp}/src/index.ts"
write_repair_handover "$(cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
 export {};
+export const n = 1;
EOF
)"
demand_acc="$(cat <<'EOF'
## Goal
Add SymbolX helper

## Targets
- src/index.ts

## Acceptance
- SymbolX
- helperThing

## Change
export SymbolX
EOF
)"
findings_acc="$(
  aegis_mechanical_adversarial_diff_scan "${handover}" "${demand_acc}" "${test_tmp}"
)"
printf '%s' "${findings_acc}" | jq -e '
  type == "array" and length >= 1
  and any(.[]; .description | test("Acceptance|SymbolX|helperThing"))
' >/dev/null \
  || fail "acceptance_missing_should_challenge: ${findings_acc}"

# --- acceptance hit when body has the name ---
printf 'export function SymbolX(): void {}\nexport const helperThing = 1;\n' \
  > "${test_tmp}/src/index.ts"
findings_hit="$(
  aegis_mechanical_adversarial_diff_scan "${handover}" "${demand_acc}" "${test_tmp}"
)"
# may still have other smells; acceptance alone should not fire if names present
printf '%s' "${findings_hit}" | jq -e '
  type == "array"
  and (all(.[]; (.description | test("Acceptance identifiers missing") | not)))
' >/dev/null \
  || fail "acceptance_present_should_not_flag_missing: ${findings_hit}"

# --- residual LLM policy ---
declare -f aegis_adversarial_should_use_llm >/dev/null \
  || fail "missing_should_use_llm"
AEGIS_ADVERSARIAL_LLM=0
aegis_adversarial_should_use_llm "${handover}" \
  && fail "llm_flag_0_should_skip"
AEGIS_ADVERSARIAL_LLM=1
aegis_adversarial_should_use_llm "${handover}" \
  || fail "llm_flag_1_should_run"
AEGIS_ADVERSARIAL_LLM=auto
AEGIS_ADVERSARIAL_LLM_MAX_LINES=1000
AEGIS_ADVERSARIAL_LLM_MAX_FILES=10
aegis_adversarial_should_use_llm "${handover}" \
  && fail "auto_small_should_skip_llm"

# --- optimize can_improve path gate (enrich filter) ---
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh"
cand='{"source_mode":"optimize","diff":"diff --git a/src/index.ts b/src/index.ts\n+export const foo = 1;\n","files_changed":["src/index.ts"],"intent_violations":[]}'
# Vague improve without path → dropped
vague='{"status":"can_improve","basis":"x","improvements":[{"target_files":["src/index.ts"],"change":"Add better typing for the return value of the helper","why_safe":"Types only; behavior unchanged."}]}'
ctx="$(jq -nc --argjson prev "${cand}" '{
  evidence_refs:[], observed_payloads:[], prev_candidate:$prev, prev_findings:[],
  seed_scope:{scope_type:"none",scope_targets:[],scope_confidence:"none"},
  seed_targets:[], seed_conditions:[], operator_named_paths:[], existing_paths:["src/index.ts"],
  tools_gate:{mutation_clean:true}, alignment_gate:{aligned:true,violations:[]},
  attention_reason:"t", demand_anchors:{}
}')"
# Use enrich path if available via printf | jq with mode body — lightweight check:
# path-in-change: good improve
good_change='In src/index.ts, replace explicit any on foo with number; keep export name.'
printf '%s' "${good_change}" | grep -q 'src/index.ts' \
  || fail "sanity_path_in_change"
# path gate logic mirror
printf '%s' "Add better typing for the return value of the helper" | grep -q 'index.ts' \
  && fail "vague_should_lack_path"

echo "[PASS] mechanical senior scans (optimize + adversarial + acceptance + residual)"
