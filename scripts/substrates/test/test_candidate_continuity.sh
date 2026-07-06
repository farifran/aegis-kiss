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
      mode: "repair",
      operational_context: {
        diff: $diff,
        files_changed: ["src/index.ts"]
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "mutation_applied",
      attention_reason: "repair candidate"
    }
  }' > "${handover}"

bash scripts/runtime/apply_candidate_diff.sh "${handover}" "${repo}"

grep -q "export const soma" "${repo}/src/index.ts" \
  || fail "repair_candidate_was_not_materialized"

jq '.artifact_snapshot.operational_context.files_changed = ["src/other.ts"]' \
  "${handover}" > "${handover}.invalid"

git -C "${repo}" restore src/index.ts

if bash scripts/runtime/apply_candidate_diff.sh \
  "${handover}.invalid" "${repo}" >/dev/null 2>&1; then
  fail "mismatched_candidate_files_were_accepted"
fi

echo "[PASS] Repair to Optimize candidate continuity"
