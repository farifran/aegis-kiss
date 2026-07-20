#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

test_tmp="$(mktemp -d)"
repo="${test_tmp}/repo"
artifact_file="${test_tmp}/validation.json"
metrics_file="${test_tmp}/metrics.jsonl"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

write_accepted_artifact() {
  jq -n --arg diff "$1" '
    {
      mode: "validation",
      verdict: "accepted",
      validated_candidate: {
        source_mode: "optimize",
        diff: $diff,
        files_changed: ["src/index.ts"]
      }
    }
  ' > "${artifact_file}"
}

# Edit on disk → diff string → restore HEAD content (restore outside $()).
edit_diff_restore() {
  local content="$1"
  printf '%s\n' "${content}" > "${repo}/src/index.ts"
  git -C "${repo}" diff HEAD --
  git -C "${repo}" restore src/index.ts
}

# Valid unified diff shape for tribunal (+++ b/ required).
make_soma_diff() {
  cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
-export {};
+export const soma = (a: number, b: number): number => a + b;
EOF
}

backup_epistemic_handover
start_mock_curl_provider

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/demand.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh"

# ---------------------------------------------------------------------
# Mechanical emit + tribunal enrich (no runtime / no workspace mutate)
# ---------------------------------------------------------------------

declare -f aegis_emit_mechanical_validation_substrate >/dev/null 2>&1 \
  || fail "missing_aegis_emit_mechanical_validation_substrate"

mech_out="$(aegis_emit_mechanical_validation_substrate)" \
  || fail "mechanical_validation_emit_failed"
printf '%s' "${mech_out}" | grep -q "${AEGIS_ARTIFACT_BEGIN_MARKER:-AEGIS_ARTIFACT_BEGIN}" \
  || fail "mechanical_validation_missing_begin_marker"
mech_body="$(
  printf '%s' "${mech_out}" \
    | sed -n "/${AEGIS_ARTIFACT_BEGIN_MARKER:-AEGIS_ARTIFACT_BEGIN}/,/${AEGIS_ARTIFACT_END_MARKER:-AEGIS_ARTIFACT_END}/p" \
    | sed -e "1d" -e "\$d"
)"
printf '%s' "${mech_body}" | jq -e '
  .verdict == "accepted"
  and (.basis | type == "array")
  and (.findings | type == "array")
' >/dev/null \
  || fail "mechanical_validation_body_shape: ${mech_body}"

soma_diff="$(make_soma_diff)"
prev_cand_json="$(
  jq -nc --arg diff "${soma_diff}" '{
    source_mode: "optimize",
    diff: $diff,
    files_changed: ["src/index.ts"],
    intent_violations: []
  }'
)"
val_ctx="$(
  jq -nc --argjson prev "${prev_cand_json}" '{
    evidence_refs: ["filesystem.read:epistemic_handover"],
    observed_payloads: [],
    prev_candidate: $prev,
    prev_findings: [],
    seed_scope: {scope_type:"none",scope_targets:[],scope_confidence:"none"},
    seed_targets: [],
    seed_conditions: [],
    operator_named_paths: [],
    existing_paths: ["src/index.ts"],
    tools_gate: {
      mutation_clean: true,
      typescript_status: "skipped",
      eslint_status: "skipped",
      test_status: "skipped",
      typescript_errors_in_scope: [],
      eslint_errors_in_scope: []
    },
    demand_anchors: {
      dense_tokens: ["soma"],
      operator_named_paths: [],
      seed_targets: ["src/index.ts"],
      done_when: []
    },
    alignment_gate: {aligned: true, violations: []}
  }'
)"
export AEGIS_MODE="validation"
val_accept="$(enrich_cognitive_artifact "${mech_body}" "${val_ctx}")"
echo "${val_accept}" | jq -e '
  .verdict == "accepted"
  and (.validated_candidate.files_changed | index("src/index.ts") != null)
  and ((.repair_feedback | not) or .repair_feedback == null)
' >/dev/null \
  || fail "mechanical_tribunal_should_accept: ${val_accept}"

# intent_violations stamp → reject + demand_mismatch feedback
prev_intent="$(
  jq -nc --arg diff "${soma_diff}" '{
    source_mode: "optimize",
    diff: $diff,
    files_changed: ["src/index.ts"],
    intent_violations: [{
      origin: "demand_mismatch",
      severity: "high",
      target_files: ["src/index.ts"],
      structural_reason: "demand_tokens: missing",
      evidence_refs: ["mutation.intent"]
    }]
  }'
)"
val_ctx_intent="$(
  printf '%s' "${val_ctx}" | jq -c --argjson prev "${prev_intent}" \
    '.prev_candidate = $prev'
)"
val_reject="$(enrich_cognitive_artifact "${mech_body}" "${val_ctx_intent}")"
echo "${val_reject}" | jq -e '
  .verdict == "rejected"
  and (.basis | map(test("demand_tokens")) | any)
  and (.repair_feedback.violations | map(.origin) | index("demand_tokens") != null)
  and (.repair_feedback.authorized_scopes | index("src/index.ts") != null)
' >/dev/null \
  || fail "mechanical_tribunal_should_reject_intent: ${val_reject}"

# alignment_gate fail → stable origin demand_tokens
val_ctx_align="$(
  printf '%s' "${val_ctx}" | jq -c '
    .alignment_gate = {
      aligned: false,
      violations: [{
        code: "demand_tokens",
        reason: "alignment: none of demand tokens appear",
        fix: "Put demand tokens into the change",
        target_files: ["src/index.ts"]
      }]
    }
  '
)"
val_align="$(enrich_cognitive_artifact "${mech_body}" "${val_ctx_align}")"
echo "${val_align}" | jq -e '
  .verdict == "rejected"
  and (.basis | map(test("demand_tokens")) | any)
  and (.repair_feedback.violations | map(.origin) | index("demand_tokens") != null)
' >/dev/null \
  || fail "mechanical_tribunal_should_reject_alignment: ${val_align}"

# Accept when export name carries demand token (no literal in body required)
export_token_diff="$(
  cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
-export {};
+export function terabitsToMegabits(t: number): number { return t * 1000; }
EOF
)"
prev_export="$(
  jq -nc --arg diff "${export_token_diff}" '{
    source_mode: "optimize",
    diff: $diff,
    files_changed: ["src/index.ts"],
    intent_violations: []
  }'
)"
# alignment_gate pass simulated after export-name hit
val_ctx_export="$(
  jq -nc --argjson prev "${prev_export}" '{
    evidence_refs: ["filesystem.read:epistemic_handover"],
    observed_payloads: [],
    prev_candidate: $prev,
    prev_findings: [],
    seed_scope: {scope_type:"none",scope_targets:[],scope_confidence:"none"},
    seed_targets: ["src/index.ts"],
    seed_conditions: [],
    operator_named_paths: [],
    existing_paths: ["src/index.ts"],
    tools_gate: {mutation_clean: true, typescript_errors_in_scope: [], eslint_errors_in_scope: []},
    demand_anchors: {dense_tokens: ["terabits"], seed_targets: ["src/index.ts"]},
    alignment_gate: {aligned: true, violations: []}
  }'
)"
val_export="$(enrich_cognitive_artifact "${mech_body}" "${val_ctx_export}")"
echo "${val_export}" | jq -e '
  .verdict == "accepted"
  and (.basis | map(test("accepted")) | any)
' >/dev/null \
  || fail "mechanical_tribunal_should_accept_export_token: ${val_export}"

# Live alignment gate: export name matches dense token
if declare -f aegis_candidate_alignment_gate >/dev/null 2>&1; then
  align_live="$(
    AEGIS_INVESTIGATION_INPUT="funções de conversão terabits para megabits" \
      aegis_candidate_alignment_gate \
        "${export_token_diff}" \
        '["src/index.ts"]' \
        "funções de conversão terabits para megabits" \
        '{"seed_targets":["src/index.ts"],"operator_named_paths":[],"done_when":[]}'
  )"
  echo "${align_live}" | jq -e '.aligned == true' >/dev/null \
    || fail "alignment_export_name_should_pass: ${align_live}"

  bad_diff="$(
    cat <<'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
-export {};
+export function power(x: number): number { return x; }
EOF
  )"
  align_bad="$(
    aegis_candidate_alignment_gate \
      "${bad_diff}" \
      '["src/index.ts"]' \
      "funções de conversão terabits para megabits" \
      '{"seed_targets":["src/index.ts"],"operator_named_paths":[],"done_when":[]}'
  )"
  echo "${align_bad}" | jq -e '
    .aligned == false
    and (.violations | map(.code) | index("demand_tokens") != null)
  ' >/dev/null \
    || fail "alignment_should_reject_unrelated_export: ${align_bad}"

  align_path="$(
    aegis_candidate_alignment_gate \
      "${export_token_diff}" \
      '["src/other.ts"]' \
      "terabits conversion in src/index.ts" \
      '{"seed_targets":["src/index.ts"],"operator_named_paths":["src/index.ts"],"done_when":[]}'
  )"
  echo "${align_path}" | jq -e '
    .aligned == false
    and (.violations | map(.code) | index("path_scope") != null)
  ' >/dev/null \
    || fail "alignment_should_reject_path_scope: ${align_path}"

  # done_when prose must pass when identifier tokens hit +lines
  prose_diff="$(
    cat <<'EOF'
diff --git a/src/tokenBucket.ts b/src/tokenBucket.ts
--- a/src/tokenBucket.ts
+++ b/src/tokenBucket.ts
@@ -0,0 +1,3 @@
+export class TokenBucket {
+  consume(bits: bigint): boolean { return true; }
+}
EOF
  )"
  align_prose="$(
    aegis_candidate_alignment_gate \
      "${prose_diff}" \
      '["src/tokenBucket.ts"]' \
      $'## Goal\nTokenBucket\n## Targets\n- src/tokenBucket.ts\n## Acceptance\n- TokenBucket is exported from src/tokenBucket.ts with typed consume\n' \
      '{"seed_targets":[],"operator_named_paths":["src/tokenBucket.ts"],"dense_tokens":["tokenbucket","consume"],"done_when":["TokenBucket is exported from src/tokenBucket.ts with typed consume"]}'
  )"
  echo "${align_prose}" | jq -e '.aligned == true' >/dev/null \
    || fail "alignment_done_when_prose_should_pass_on_tokens: ${align_prose}"

  # done_when with zero token overlap still fails
  align_prose_miss="$(
    aegis_candidate_alignment_gate \
      "${prose_diff}" \
      '["src/tokenBucket.ts"]' \
      "unrelated demand" \
      '{"seed_targets":[],"operator_named_paths":["src/tokenBucket.ts"],"dense_tokens":[],"done_when":["CompletelyUnrelatedSymbolXYZ must exist"]}'
  )"
  echo "${align_prose_miss}" | jq -e '
    .aligned == false
    and (.violations | map(.code) | index("done_when") != null)
  ' >/dev/null \
    || fail "alignment_done_when_should_still_fail_when_no_tokens: ${align_prose_miss}"
fi

# ---------------------------------------------------------------------
# Runtime: bad handover still fails; good reject path is mechanical
# ---------------------------------------------------------------------

mkdir -p "${repo}/src"
printf 'export {};\n' > "${repo}/src/index.ts"

git -C "${repo}" init -q
git -C "${repo}" config user.name "Aegis Test"
git -C "${repo}" config user.email "aegis-test@example.invalid"
git -C "${repo}" add src/index.ts
git -C "${repo}" commit -qm "test fixture"

diff_content="$(edit_diff_restore \
  'export const soma = (a: number, b: number): number => a + b;')"

mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"
jq -n --arg diff "${diff_content}" '
  {
    artifact_snapshot: {
      mode: "adversarial",
      candidate_result: {
        source_mode: "optimize",
        diff: $diff,
        files_changed: ["src/index.ts"]
      },
      adversarial_findings: [],
      evidence_refs: ["filesystem.read:epistemic_handover"],
      investigation_input: "adicione uma funcao soma",
      generated_at: "2026-06-13T00:00:00Z"
    },
    epistemic_state: {
      next_attention_targets: [],
      attention_scope: "bounded falsification",
      attention_reason: "challenge completed"
    }
  }
' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

set +e
bash runtime_aegis.sh validation >/dev/null
validation_status=$?
set -e
[[ "${validation_status}" -ne 0 ]] \
  || fail "validation_accepted_mismatched_candidate"

# Mechanical end-to-end reject (intent stamp) without repair re-entry / promote.
: > "${metrics_file}"
jq -n --arg diff "${soma_diff}" '
  {
    artifact_snapshot: {
      mode: "adversarial",
      investigation_input: "adicione uma funcao soma",
      operational_context: {
        candidate_result: {
          source_mode: "optimize",
          diff: $diff,
          files_changed: ["src/index.ts"],
          intent_violations: [{
            origin: "demand_mismatch",
            severity: "high",
            target_files: ["src/index.ts"],
            structural_reason: "demand_tokens: missing",
            evidence_refs: ["mutation.intent"]
          }]
        },
        findings: [],
        evidence_refs: ["filesystem.read:epistemic_handover"]
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "bounded falsification",
      attention_reason: "challenge completed"
    }
  }
' > "${AEGIS_EPISTEMIC_HANDOVER_FILE}"

set +e
AEGIS_REPAIR_FEEDBACK_LOOP=false \
AEGIS_VALIDATION_LLM=0 \
AEGIS_METRICS_FILE="${metrics_file}" \
AEGIS_INVESTIGATION_INPUT="adicione uma funcao soma" \
  bash runtime_aegis.sh validation >"${test_tmp}/val_mech.out" 2>"${test_tmp}/val_mech.err"
mech_rc=$?
set -e
[[ "${mech_rc}" -eq 0 ]] \
  || fail "mechanical_validation_runtime_failed: $(cat "${test_tmp}/val_mech.err")"
grep -q "validation_mechanical" "${test_tmp}/val_mech.err" \
  || fail "mechanical_validation_log_missing: $(cat "${test_tmp}/val_mech.err")"
jq -e 'select(.kind=="validation" and .result=="mechanical")' "${metrics_file}" >/dev/null \
  || fail "mechanical_validation_metric_missing: $(cat "${metrics_file}")"
jq -e 'select(.kind=="validation" and .result=="rejected")' "${metrics_file}" >/dev/null \
  || fail "mechanical_validation_reject_metric_missing: $(cat "${metrics_file}")"
# Artifact in handover / stdout should be rejected demand_mismatch
artifact_out="$(extract_first_artifact_payload "$(cat "${test_tmp}/val_mech.out")")"
echo "${artifact_out}" | jq -e '
  .verdict == "rejected"
  and (.basis | map(test("demand_tokens")) | any)
' >/dev/null \
  || fail "mechanical_runtime_reject_artifact: ${artifact_out}"

write_accepted_artifact "${diff_content}"

# Flags off → apply only
n0="$(git -C "${repo}" rev-list --count HEAD)"
bash scripts/runtime/promote_validated_candidate.sh "${artifact_file}" "${repo}"
grep -q "export const soma" "${repo}/src/index.ts" \
  || fail "validated_candidate_was_not_promoted"
[[ "$(git -C "${repo}" rev-list --count HEAD)" -eq "${n0}" ]] \
  || fail "auto_commit_ran_with_flags_off"

# Auto-commit only promoted paths
git -C "${repo}" add src/index.ts
git -C "${repo}" commit -qm "manual: baseline soma"

diff2="$(edit_diff_restore \
  'export const soma = (a: number, b: number): number => a + b;
export const n = 1;')"
write_accepted_artifact "${diff2}"
printf 'dirt\n' > "${repo}/src/unrelated.txt"

n0="$(git -C "${repo}" rev-list --count HEAD)"
AEGIS_AUTO_COMMIT=1 AEGIS_ISSUE_NUMBER=42 AEGIS_ISSUE_TASK=2 \
  bash scripts/runtime/promote_validated_candidate.sh "${artifact_file}" "${repo}"

[[ "$(git -C "${repo}" rev-list --count HEAD)" -eq $((n0 + 1)) ]] \
  || fail "auto_commit_did_not_create_commit"
log_body="$(git -C "${repo}" log -1 --format=%B)"
echo "${log_body}" | grep -q 'Aegis-Promoted: true' \
  || fail "auto_commit_missing_promoted_trailer"
echo "${log_body}" | grep -qE 'issue#42|Aegis-Issue: 42' \
  || fail "auto_commit_missing_issue_marker"
echo "${log_body}" | grep -q 'src/index.ts' \
  || fail "auto_commit_missing_paths_trailer"
git -C "${repo}" cat-file -e "HEAD:src/unrelated.txt" 2>/dev/null \
  && fail "auto_commit_included_unrelated_path"
grep -q "export const n = 1" "${repo}/src/index.ts" \
  || fail "auto_commit_promotion_lost_apply"

# Issue comment via mock gh
mock_gh_dir="${test_tmp}/mock_bin"
mkdir -p "${mock_gh_dir}"
cat > "${mock_gh_dir}/gh" <<'EOS'
#!/usr/bin/env bash
[[ "$1" == "issue" && "$2" == "comment" ]] || exit 1
body="" num=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --body) shift; body="${1:-}" ;;
    [0-9]*) num="$1" ;;
  esac
  shift || true
done
printf '%s\n' "${num}" > "${AEGIS_TEST_GH_OUT}.num"
printf '%s\n' "${body}" > "${AEGIS_TEST_GH_OUT}.body"
EOS
chmod +x "${mock_gh_dir}/gh"

diff3="$(edit_diff_restore \
  'export const soma = (a: number, b: number): number => a + b;
export const n = 2;')"
write_accepted_artifact "${diff3}"

export AEGIS_TEST_GH_OUT="${test_tmp}/gh_capture"
PATH="${mock_gh_dir}:${PATH}" \
  AEGIS_AUTO_COMMIT=0 AEGIS_ISSUE_COMMENT=1 \
  AEGIS_ISSUE_NUMBER=99 AEGIS_ISSUE_TASK=3 \
  bash scripts/runtime/promote_validated_candidate.sh "${artifact_file}" "${repo}"

[[ -f "${AEGIS_TEST_GH_OUT}.body" ]] || fail "issue_comment_mock_not_invoked"
grep -q '99' "${AEGIS_TEST_GH_OUT}.num" || fail "issue_comment_wrong_number"
grep -q 'SUCCESS' "${AEGIS_TEST_GH_OUT}.body" || fail "issue_comment_missing_success"
grep -q 'task: 3' "${AEGIS_TEST_GH_OUT}.body" || fail "issue_comment_missing_task"

# ---------------------------------------------------------------------
# Adversarial mechanical short-circuit must enrich before validate.
# Thin emit is {status,findings:[]}; enrich injects tool findings + mode.
# execute_mode early path previously skipped normalize → contract fatal.
# ---------------------------------------------------------------------

declare -f aegis_emit_mechanical_adversarial_from_tools_gate >/dev/null 2>&1 \
  || fail "missing_aegis_emit_mechanical_adversarial_from_tools_gate"

# Static lock: mechanical dirty-tools path calls normalize before validate.
_adv_block="$(
  awk '
    /adversarial_mechanical: tools dirty/ { on=1 }
    on { print }
    on && /return 0/ { exit }
  ' "${AEGIS_TEST_ROOT}/scripts/execute_mode.sh"
)"
printf '%s' "${_adv_block}" | grep -q 'normalize_substrate_output' \
  || fail "adversarial_mechanical_path_missing_normalize_substrate_output"
# normalize must appear before validate_artifact in that block
_norm_line="$(printf '%s\n' "${_adv_block}" | grep -n 'normalize_substrate_output' | head -1 | cut -d: -f1)"
_val_line="$(printf '%s\n' "${_adv_block}" | grep -n 'validate_artifact' | head -1 | cut -d: -f1)"
[[ -n "${_norm_line}" && -n "${_val_line}" && "${_norm_line}" -lt "${_val_line}" ]] \
  || fail "adversarial_mechanical_normalize_must_precede_validate"

dirty_gate='{
  "mutation_clean": false,
  "typescript_status": "ok",
  "eslint_status": "skipped",
  "test_status": "failed",
  "typescript_errors_in_scope": [],
  "eslint_errors_in_scope": []
}'
mech_adv_out="$(aegis_emit_mechanical_adversarial_from_tools_gate "${dirty_gate}")" \
  || fail "mechanical_adversarial_emit_failed"
mech_adv_body="$(
  printf '%s' "${mech_adv_out}" \
    | sed -n "/${AEGIS_ARTIFACT_BEGIN_MARKER:-AEGIS_ARTIFACT_BEGIN}/,/${AEGIS_ARTIFACT_END_MARKER:-AEGIS_ARTIFACT_END}/p" \
    | sed -e "1d" -e "\$d"
)"
# Thin body intentionally lacks mode / candidate_result (enrich owns them).
printf '%s' "${mech_adv_body}" | jq -e '
  .status == "challenged"
  and (.findings | type == "array" and length == 0)
  and (.mode | not)
' >/dev/null \
  || fail "mechanical_adversarial_thin_body_shape: ${mech_adv_body}"

adv_ctx="$(
  jq -nc --arg diff "${soma_diff}" --argjson gate "${dirty_gate}" '{
    evidence_refs: ["test.run"],
    observed_payloads: ["test_run.json"],
    prev_candidate: {
      source_mode: "optimize",
      diff: $diff,
      files_changed: ["src/index.ts"]
    },
    prev_findings: [],
    seed_scope: {scope_type:"none",scope_targets:[],scope_confidence:"none"},
    seed_targets: [],
    seed_conditions: [],
    operator_named_paths: [],
    existing_paths: ["src/index.ts"],
    tools_gate: $gate,
    demand_anchors: {dense_tokens:["soma"],operator_named_paths:[],seed_targets:["src/index.ts"],done_when:[]},
    alignment_gate: {aligned: true, violations: []}
  }'
)"
export AEGIS_MODE="adversarial"
adv_enriched="$(enrich_cognitive_artifact "${mech_adv_body}" "${adv_ctx}")"
echo "${adv_enriched}" | jq -e '
  .mode == "adversarial"
  and .status == "challenged"
  and (.candidate_result.source_mode == "optimize")
  and (.candidate_result.files_changed | index("src/index.ts") != null)
  and (.findings | map(select(.type == "tool_failure")) | length) > 0
  and (.evidence_refs | type == "array")
  and (.handover_attention | type == "object")
' >/dev/null \
  || fail "mechanical_adversarial_enrich_should_inject_tool_findings: ${adv_enriched}"

# Stamp path jail: refuse non-stamp and traversal dirs (no data-loss rm).
stamp_probe="${test_tmp}/not_a_stamp_dir"
mkdir -p "${stamp_probe}"
AEGIS_CANDIDATE_TOOLS_STAMP_DIR="${stamp_probe}" \
  aegis_remove_candidate_tools_stamp
[[ -d "${stamp_probe}" ]] \
  || fail "stamp_jail_deleted_non_stamp_dir"

stamp_trav="${test_tmp}/candidate_tools_stamp/../escape_probe"
mkdir -p "${test_tmp}/escape_probe"
AEGIS_CANDIDATE_TOOLS_STAMP_DIR="${stamp_trav}" \
  aegis_remove_candidate_tools_stamp
[[ -d "${test_tmp}/escape_probe" ]] \
  || fail "stamp_jail_allowed_dotdot_traversal"

echo "[PASS] Adversarial to Validation contract, mechanical tribunal, and promotion"
