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
{"targets":["src"]}
EOF
cat > "${repo}/.harness/proof_registry.json" <<'EOF'
{"proofs":[{"status":"active","targets":["src"]}]}
EOF
git -C "${repo}" init -q
git -C "${repo}" add .
git -C "${repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm baseline

printf 'export const version = 2;\n' > "${repo}/src/index.ts"
jq -n '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:["src/index.ts"]}}' > "${artifact}"

bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" create "${repo}" "${artifact}"
git -C "${repo}" add src/index.ts
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" requires "${repo}"
bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" verify "${repo}"

printf 'export const version = 3;\n' > "${repo}/src/index.ts"
git -C "${repo}" add src/index.ts
if bash "${AEGIS_TEST_ROOT}/scripts/formal_promotion_authorization.sh" verify "${repo}" >/dev/null 2>&1; then
  fail "changed_staged_content_was_authorized"
fi

echo "[PASS] formal promotion authorization"
