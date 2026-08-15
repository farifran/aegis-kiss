#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

test_tmp="$(mktemp -d)"
repo="${test_tmp}/repo"
handover="${test_tmp}/handover.json"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

mkdir -p "${repo}/src"
printf 'export {};\n' > "${repo}/src/index.ts"

git -C "${repo}" init -q
git -C "${repo}" add src/index.ts
git -C "${repo}" \
  -c user.name="Aegis Test" \
  -c user.email="aegis-test@example.invalid" \
  commit -qm "test fixture"

printf 'export const soma = (a: number, b: number): number => a + b;\n' \
  > "${repo}/src/index.ts"

diff_content="$(git -C "${repo}" diff HEAD --)"
git -C "${repo}" restore src/index.ts

jq -n \
  --arg diff "${diff_content}" \
  '{
    artifact_snapshot: {
      mode: "build",
      operational_context: {
        diff: $diff,
        files_changed: ["src/index.ts"]
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "mutation_applied",
      attention_reason: "build candidate"
    }
  }' > "${handover}"

bash scripts/runtime/apply_candidate_diff.sh "${handover}" "${repo}"

grep -q "export const soma" "${repo}/src/index.ts" \
  || fail "build_candidate_was_not_materialized"

jq '.artifact_snapshot.operational_context.files_changed = ["src/other.ts"]' \
  "${handover}" > "${handover}.invalid"

git -C "${repo}" restore src/index.ts

if bash scripts/runtime/apply_candidate_diff.sh \
  "${handover}.invalid" "${repo}" >/dev/null 2>&1; then
  fail "mismatched_candidate_files_were_accepted"
fi

# Static: soft-fail materialize must set KEEP flag; substrate must passthrough.
grep -q 'AEGIS_BUILD_KEEP_PREVIOUS_CANDIDATE=1' \
  "${AEGIS_TEST_ROOT}/runtime_aegis.sh" \
  || fail "materialize_missing_keep_previous_flag"
grep -q 'AEGIS_BUILD_KEEP_PREVIOUS_CANDIDATE' \
  "${AEGIS_TEST_ROOT}/scripts/substrates/aider_substrate.sh" \
  || fail "aider_substrate_missing_keep_previous_branch"
grep -q 'AEGIS_SKIP_CANDIDATE_TOOLS_STAMP' \
  "${AEGIS_TEST_ROOT}/scripts/substrates/aider/invoke.sh" \
  || fail "emit_mutation_missing_skip_stamp_guard"
# KEEP branch must run before invoke_aider (order lock).
_keep_line="$(grep -n 'AEGIS_BUILD_KEEP_PREVIOUS_CANDIDATE' \
  "${AEGIS_TEST_ROOT}/scripts/substrates/aider_substrate.sh" | head -1 | cut -d: -f1)"
_inv_line="$(grep -n 'invoke_aider' \
  "${AEGIS_TEST_ROOT}/scripts/substrates/aider_substrate.sh" | head -1 | cut -d: -f1)"
[[ -n "${_keep_line}" && -n "${_inv_line}" && "${_keep_line}" -lt "${_inv_line}" ]] \
  || fail "keep_previous_must_precede_invoke_aider"

# Functional: previous optimize candidate re-extracted for passthrough.
opt_diff="${diff_content}"
opt_handover="${test_tmp}/opt_handover.json"
jq -n --arg diff "${opt_diff}" '{
  artifact_snapshot: {
    mode: "optimize",
    operational_context: {
      status: "can_improve",
      candidate_result: {
        source_mode: "optimize",
        diff: $diff,
        files_changed: ["src/index.ts"]
      }
    }
  }
}' > "${opt_handover}"
prev="$(
  jq -r '
    .artifact_snapshot as $s
    | if $s.mode == "optimize" then
        $s.operational_context.candidate_result.diff // empty
      else empty end
  ' "${opt_handover}"
)"
[[ -n "${prev}" && "${prev}" == "${opt_diff}" ]] \
  || fail "passthrough_previous_candidate_extract_failed"

# Conflict-marker gate present after apply (3-way safety).
grep -q 'candidate_diff_apply_left_conflict_markers' \
  "${AEGIS_TEST_ROOT}/scripts/runtime/apply_candidate_diff.sh" \
  || fail "apply_candidate_missing_conflict_marker_gate"

# --- a net-new file must materialize. `git diff --name-only HEAD` never lists
# an untracked path, so counting only tracked changes left actual_files empty
# for the canonical target ("Create src/tokenBucket.ts") and rejected every
# creation as a files_changed mismatch. ---
newfile_diff="$(cat <<'EOF'
diff --git a/src/tokenBucket.ts b/src/tokenBucket.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/tokenBucket.ts
@@ -0,0 +1,2 @@
+export class TokenBucket {}
+export const marker = 1;
EOF
)"
newfile_handover="${test_tmp}/newfile_handover.json"
jq -n --arg diff "${newfile_diff}
" '{
  artifact_snapshot: {
    mode: "build",
    operational_context: {
      diff: $diff,
      files_changed: ["src/tokenBucket.ts"]
    }
  }
}' > "${newfile_handover}"

rm -f "${repo}/src/tokenBucket.ts"
# The earlier mismatch case applies its diff before failing, so the surface is
# still dirty here; the real pipeline always starts from a fresh worktree.
git -C "${repo}" restore src/index.ts 2>/dev/null || true
bash scripts/runtime/apply_candidate_diff.sh "${newfile_handover}" "${repo}" \
  || fail "net_new_file_candidate_should_materialize"
grep -q 'export class TokenBucket' "${repo}/src/tokenBucket.ts" \
  || fail "net_new_file_not_written"
rm -f "${repo}/src/tokenBucket.ts"

# --- validation carries the candidate as candidate_result, exactly like
# optimize. Matching on mode name meant every validation->build re-entry —
# the one validation itself asks for — was refused as an invalid contract. ---
val_handover="${test_tmp}/val_handover.json"
jq -n --arg diff "${diff_content}" '{
  artifact_snapshot: {
    mode: "validation",
    operational_context: {
      verdict: "rejected",
      candidate_result: {
        source_mode: "build",
        diff: $diff,
        files_changed: ["src/index.ts"]
      }
    }
  }
}' > "${val_handover}"

git -C "${repo}" restore src/index.ts 2>/dev/null || true
bash scripts/runtime/apply_candidate_diff.sh "${val_handover}" "${repo}" \
  || fail "validation_candidate_result_should_materialize"
grep -q "export const soma" "${repo}/src/index.ts" \
  || fail "validation_candidate_was_not_materialized"
git -C "${repo}" restore src/index.ts

# A handover with no usable candidate anywhere is still refused.
bad_handover="${test_tmp}/bad_handover.json"
jq -n '{artifact_snapshot: {mode: "validation", operational_context: {verdict: "rejected"}}}' \
  > "${bad_handover}"
if bash scripts/runtime/apply_candidate_diff.sh "${bad_handover}" "${repo}" >/dev/null 2>&1; then
  fail "handover_without_candidate_was_accepted"
fi

echo "[PASS] Build to Optimize candidate continuity"
