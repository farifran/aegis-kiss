#!/usr/bin/env bash
# =========================================================
# mutation_lite: validation accepts repair handoff (no adversarial)
# =========================================================
# Regresses the fix where validation required adversarial findings +
# candidate_result and fatally aborted repair → validation lite runs.

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh"

test_tmp="$(mktemp -d)"
handover="${test_tmp}/handover.json"
test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

make_diff() {
  cat <<'EOF'
diff --git a/src/tokenBucketSummary.ts b/src/tokenBucketSummary.ts
new file mode 100644
index 0000000..10a3f48
--- /dev/null
+++ b/src/tokenBucketSummary.ts
@@ -0,0 +1,3 @@
+export type DecisionSummary = { total: number };
+export function summarizeDecisions(): DecisionSummary {
+  return { total: 0 };
+}
EOF
}

diff_content="$(make_diff)"

# --- repair-shaped handover (mutation_lite): diff/files_changed, no findings ---
jq -n --arg diff "${diff_content}" '
  {
    artifact_snapshot: {
      mode: "repair",
      investigation_input: "create TokenBucketSummary",
      operational_context: {
        diff: $diff,
        files_changed: ["src/tokenBucketSummary.ts"],
        intent_violations: [],
        status: "interpreted",
        evidence_refs: ["git.diff"]
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/tokenBucketSummary.ts"],
      attention_scope: "mutation_applied",
      attention_reason: "repair candidate"
    }
  }
' > "${handover}"

export AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${handover}"

# Same synthesis enrich uses (source_mode forced to optimize).
prev_candidate="$(
  jq -c '
    .artifact_snapshot as $snap
    | (
        $snap.operational_context.candidate_result
        // $snap.candidate_result
        // (if ($snap.operational_context.diff | type == "string") then
             {
               diff: $snap.operational_context.diff,
               files_changed: ($snap.operational_context.files_changed // []),
               intent_violations: (
                 $snap.operational_context.intent_violations // []
               )
             }
           else null end)
      )
    | if . != null then
        .source_mode = "optimize"
        | .intent_violations = (.intent_violations // [])
      else empty end
  ' "${handover}"
)"
[[ -n "${prev_candidate}" ]] \
  || fail "repair_handover_did_not_synthesize_candidate"

# Validation artifact as enrich would emit after mechanical tribunal.
val_artifact="$(
  jq -nc --argjson cand "${prev_candidate}" '
    {
      verdict: "accepted",
      basis: ["tribunal:accepted"],
      findings: [],
      validated_candidate: $cand,
      handover_attention: {
        next_attention_targets: ["src/tokenBucketSummary.ts"],
        attention_scope: "validation_result",
        attention_reason: "ATTENTION_REASON_VALIDATION"
      }
    }
  '
)"

if ! validate_validation_artifact "${val_artifact}"; then
  fail "validate_validation_artifact_rejected_repair_handoff"
fi

# Empty findings on repair handoff must not fatal (was missing_findings).
prev_findings="$(
  jq -c '
    .artifact_snapshot.operational_context.findings
    // .artifact_snapshot.findings
    // []
  ' "${handover}"
)"
[[ "${prev_findings}" == "[]" ]] \
  || fail "expected_empty_findings_from_repair_handover: ${prev_findings}"

# --- adversarial-shaped handover still works ---
jq -n --arg diff "${diff_content}" '
  {
    artifact_snapshot: {
      mode: "adversarial",
      investigation_input: "create TokenBucketSummary",
      operational_context: {
        candidate_result: {
          source_mode: "optimize",
          diff: $diff,
          files_changed: ["src/tokenBucketSummary.ts"],
          intent_violations: []
        },
        findings: [],
        evidence_refs: ["filesystem.read:epistemic_handover"]
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/tokenBucketSummary.ts"],
      attention_scope: "bounded falsification",
      attention_reason: "challenge completed"
    }
  }
' > "${handover}"

val_artifact_adv="$(
  jq -nc --arg diff "${diff_content}" '
    {
      verdict: "accepted",
      basis: ["tribunal:accepted"],
      findings: [],
      validated_candidate: {
        source_mode: "optimize",
        diff: $diff,
        files_changed: ["src/tokenBucketSummary.ts"],
        intent_violations: []
      },
      handover_attention: {
        next_attention_targets: ["src/tokenBucketSummary.ts"],
        attention_scope: "validation_result",
        attention_reason: "ATTENTION_REASON_VALIDATION"
      }
    }
  '
)"

if ! validate_validation_artifact "${val_artifact_adv}"; then
  fail "validate_validation_artifact_rejected_adversarial_handoff"
fi

# --- precondition filter: repair mode accepted (mirrors runtime_aegis.sh) ---
export AEGIS_EPISTEMIC_HANDOVER_FILE="${handover}"
# put repair shape back for precondition check
jq -n --arg diff "${diff_content}" '
  {
    artifact_snapshot: {
      mode: "repair",
      operational_context: {
        diff: $diff,
        files_changed: ["src/tokenBucketSummary.ts"]
      }
    }
  }
' > "${handover}"

AEGIS_JQ_HANDOVER_CANDIDATE_RESULT='
  (.artifact_snapshot.operational_context.candidate_result | type == "object")
  and (.artifact_snapshot.operational_context.candidate_result.diff
        | type == "string" and length > 0 and . != "(no changes)")
  and (.artifact_snapshot.operational_context.candidate_result.files_changed
        | type == "array" and length > 0)
'

if ! jq -e "
  .artifact_snapshot != null
  and (
    (
      .artifact_snapshot.mode == \"adversarial\"
      and (${AEGIS_JQ_HANDOVER_CANDIDATE_RESULT})
      and (.artifact_snapshot.operational_context.findings | type == \"array\")
    )
    or (
      .artifact_snapshot.mode == \"optimize\"
      and (${AEGIS_JQ_HANDOVER_CANDIDATE_RESULT})
    )
    or (
      .artifact_snapshot.mode == \"repair\"
      and (.artifact_snapshot.operational_context.diff
           | type == \"string\" and length > 0 and . != \"(no changes)\")
      and (.artifact_snapshot.operational_context.files_changed
           | type == \"array\" and length > 0)
    )
  )
" "${handover}" >/dev/null; then
  fail "validation_precondition_filter_rejects_repair_handoff"
fi

# Empty handover (no candidate) must still fail continuity path
jq -n '{artifact_snapshot:{mode:"repair",operational_context:{}}}' > "${handover}"
empty_art="$(
  jq -nc --arg diff "${diff_content}" '
    {
      verdict: "accepted",
      basis: [],
      findings: [],
      validated_candidate: {
        source_mode: "optimize",
        diff: $diff,
        files_changed: ["src/tokenBucketSummary.ts"],
        intent_violations: []
      },
      handover_attention: {
        next_attention_targets: [],
        attention_scope: "validation_result",
        attention_reason: "x"
      }
    }
  '
)"
# aegis_fatal uses exit — isolate in a subshell so the suite continues.
set +e
( validate_validation_artifact "${empty_art}" ) >/dev/null 2>&1
empty_rc=$?
set -e
[[ "${empty_rc}" -ne 0 ]] \
  || fail "validate_validation_artifact_should_reject_empty_repair_context"

echo "[PASS] mutation_lite validation handoff (repair without adversarial)"
