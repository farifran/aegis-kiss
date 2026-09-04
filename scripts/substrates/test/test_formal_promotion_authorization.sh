#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

temp_dir="$(mktemp -d)"
repo="${temp_dir}/repo"
artifact="${temp_dir}/validation.json"

test_cleanup_extra() {
  rm -rf "${temp_dir}"
}

mkdir -p "${repo}/src" "${repo}/.harness"
printf 'export const version = 1;\n' > "${repo}/src/index.ts"
cat > "${repo}/.harness/active_contract_ir.json" <<'EOF'
{"targets":["src"],"proofObligations":[{"id":"PO-FIXTURE-001"}]}
EOF
cat > "${repo}/.harness/proof_registry.json" <<'EOF'
{
  "schema":"aegis.proof_registry.v1",
  "policy":{"mode":"enforced","maxActiveProofsPerProfile":{"fast":1}},
  "profiles":[{"id":"fast","proofIds":["PO-FIXTURE-001"]}],
  "proofs":[{
    "id":"PO-FIXTURE-001","risk":"fixture risk","coverageKey":"fixture.coverage",
    "authority":"fixture","cost":"low","cadence":"always","status":"active",
    "targets":["src"],"executionKey":"fixture-proof","command":"npm run fixture-proof"
  }]
}
EOF
cat > "${repo}/package.json" <<'EOF'
{"scripts":{"fixture-proof":"node -e \"process.exit(0)\""}}
EOF
git -C "${repo}" init -q
git -C "${repo}" add .
git -C "${repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline

printf 'export const version = 2;\n' > "${repo}/src/index.ts"
jq -n '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:["src/index.ts"]}}' > "${artifact}"

bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" create "${repo}" "${artifact}"
receipt="$(git -C "${repo}" rev-parse --git-path aegis/precommit_receipt.json)"
jq -e '
  .schema == "aegis.precommit_receipt.v1"
  and .status == "PROVEN"
  and .proofProfile == "fast"
  and .validationAuthority.kind == "deterministic_tribunal"
' "${receipt}" >/dev/null
git -C "${repo}" add src/index.ts
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" requires "${repo}"
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" verify "${repo}"

printf 'export const version = 3;\n' > "${repo}/src/index.ts"
git -C "${repo}" add src/index.ts
if bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" verify "${repo}" >/dev/null 2>&1; then
  fail "changed_staged_content_was_authorized"
fi

# A model validator may supplement the tribunal, but it cannot be the same
# identity as the mutation model.
if AEGIS_VALIDATION_LLM=1 AEGIS_VALIDATION_MODEL="model-a" AEGIS_AIDER_MODEL="model-a" \
  bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" create "${repo}" "${artifact}" >/dev/null 2>&1; then
  fail "self_validating_model_was_accepted"
fi

# The receipt is a commit-boundary control, not a source-directory heuristic.
# Moving orchestration logic outside src must not create a bypass.
printf 'evidence\n' > "${repo}/README.md"
git -C "${repo}" add README.md
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" requires "${repo}"

# A full clean is a valid boundary without a receipt only when it retires the
# whole governed unit: prior targets, contract and proof registry together.
reset_repo="${temp_dir}/reset-repo"
mkdir -p "${reset_repo}/src" "${reset_repo}/.harness"
printf 'export const feature = 1;\n' > "${reset_repo}/src/feature.ts"
printf 'export const index = 1;\n' > "${reset_repo}/src/index.ts"
printf '%s\n' '{"targets":["src/feature.ts","src/index.ts"]}' \
  > "${reset_repo}/.harness/active_contract_ir.json"
printf '%s\n' '{"proofs":[]}' > "${reset_repo}/.harness/proof_registry.json"
git -C "${reset_repo}" init -q
git -C "${reset_repo}" add .
git -C "${reset_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline

rm -f "${reset_repo}/src/feature.ts" \
  "${reset_repo}/.harness/active_contract_ir.json" \
  "${reset_repo}/.harness/proof_registry.json"
printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${reset_repo}/src/index.ts"
git -C "${reset_repo}" add -A
if bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" requires "${reset_repo}"; then
  fail "complete_baseline_reset_still_required_a_receipt"
fi

git -C "${reset_repo}" restore --source=HEAD --staged --worktree .harness/active_contract_ir.json .harness/proof_registry.json
git -C "${reset_repo}" add -A
if ! bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" requires "${reset_repo}"; then
  fail "partial_reset_bypassed_formal_authorization"
fi

# A universal harness baseline has no product contract or proof registry yet,
# but it still needs a receipt before its own scripts can be promoted.
baseline_repo="${temp_dir}/baseline-repo"
mkdir -p "${baseline_repo}/src"
printf 'export const version = 1;\n' > "${baseline_repo}/src/index.ts"
git -C "${baseline_repo}" init -q
git -C "${baseline_repo}" add .
git -C "${baseline_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline

printf 'export const version = 2;\n' > "${baseline_repo}/src/index.ts"
git -C "${baseline_repo}" add src/index.ts
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" create "${baseline_repo}"
baseline_receipt="$(git -C "${baseline_repo}" rev-parse --git-path aegis/precommit_receipt.json)"
jq -e '.proofProfile == "fast" and (.proofs | length) == 0' "${baseline_receipt}" >/dev/null
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" verify "${baseline_repo}"

echo "[PASS] formal promotion authorization"
