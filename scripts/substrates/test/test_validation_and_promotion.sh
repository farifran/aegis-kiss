#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

test_tmp="$(mktemp -d)"
repo="${test_tmp}/repo"
artifact_file="${test_tmp}/validation.json"

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

backup_epistemic_handover
start_mock_curl_provider

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

echo "[PASS] Adversarial to Validation contract and promotion"
