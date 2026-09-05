#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-ide-gateway.XXXXXX")"
cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT

mkdir -p "${WORK_DIR}/src" "${WORK_DIR}/.harness/runtime"
cp "${ROOT_DIR}/aegis" "${WORK_DIR}/aegis"
cp -r "${ROOT_DIR}/scripts" "${WORK_DIR}/scripts"
cp -r "${ROOT_DIR}/governance" "${WORK_DIR}/governance"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${WORK_DIR}/ARCHITECTURE.md"
ln -s "${ROOT_DIR}/node_modules" "${WORK_DIR}/node_modules"
printf '.harness/runtime/\nnode_modules\n' > "${WORK_DIR}/.gitignore"
printf 'export {};\n' > "${WORK_DIR}/src/index.ts"
git -C "${WORK_DIR}" init -q
git -C "${WORK_DIR}" config user.name Aegis
git -C "${WORK_DIR}" config user.email aegis@example.invalid
git -C "${WORK_DIR}" add .
git -C "${WORK_DIR}" commit -qm baseline

output="$(bash "${WORK_DIR}/aegis" 'Criar uma biblioteca determinística em src/library.ts.' --target src)"
printf '%s' "${output}" | jq -e '
  .schema == "aegis.ide_semantic_request.v2"
  and .changeKind == "PRODUCT"
  and .protocol.promotion == ["implement authorized scope", "stage persistent changes", "./aegis authorize", "git commit"]
  and (.protocol.forbidden | index("verification before authorize"))
  and (has("normalizedDemand") | not)
' >/dev/null
[[ -s "${WORK_DIR}/.harness/runtime/preflight_envelope.json" ]]
[[ "$(printf '%s' "${output}" | wc -c | tr -d ' ')" -lt 7000 ]]

output="$(bash "${WORK_DIR}/aegis" harness 'Atualizar a validação interna do Aegis.')"
printf '%s' "${output}" | jq -e '.changeKind == "HARNESS"' >/dev/null
jq -e '.changeKind == "HARNESS" and .baseline.clean == true' "${WORK_DIR}/.harness/runtime/preflight_envelope.json" >/dev/null
frozen_digest="$(shasum -a 256 "${WORK_DIR}/.harness/runtime/preflight_envelope.json" | awk '{print $1}')"

printf 'mudança não contratada\n' > "${WORK_DIR}/src/dirty.ts"
if bash "${WORK_DIR}/aegis" 'Outra demanda.' >/dev/null 2>&1; then
  echo 'intake accepted dirty worktree' >&2
  exit 1
fi
[[ "$(shasum -a 256 "${WORK_DIR}/.harness/runtime/preflight_envelope.json" | awk '{print $1}')" == "${frozen_digest}" ]]
rm "${WORK_DIR}/src/dirty.ts"

mkdir -p "${WORK_DIR}/src/inventory"
printf 'alpha-content\n' > "${WORK_DIR}/src/inventory/alpha.txt"
printf 'beta-content\n' > "${WORK_DIR}/src/inventory/beta.txt"
output="$(bash "${WORK_DIR}/aegis" evidence --path src/inventory --max-files 2 --max-total-bytes 12 --max-file-bytes 6)"
printf '%s\n' "${output}" | grep -q '^\[AEGIS\]\[EVIDENCE\] inventory=READY materialization=FRESH files=2/2 bytes=12 '
jq -e '.coverage.complete == true and .coverage.previewBytes == 12' "${WORK_DIR}/.harness/runtime/mechanical_inventory.json" >/dev/null
if bash "${WORK_DIR}/aegis" evidence --path ../outside >/dev/null 2>&1; then
  echo 'unsafe inventory path was accepted' >&2
  exit 1
fi

mkdir -p "${WORK_DIR}/src/.aegis"
printf '{}\n' > "${WORK_DIR}/src/.aegis/contract-ir.json"
printf '{}\n' > "${WORK_DIR}/src/.aegis/clarified-demand.json"
printf '{}\n' > "${WORK_DIR}/src/.aegis/proof-registry.json"
bash "${WORK_DIR}/aegis" clean | grep -qx '\[AEGIS\]\[IDE\] clean=PASS source_reset=1'
[[ "$(cat "${WORK_DIR}/src/index.ts")" == $'// Ponto de entrada canônico para a próxima demanda.\nexport {};' ]]
[[ -z "$(find "${WORK_DIR}/.harness/runtime" -mindepth 1 -print -quit)" ]]
[[ ! -e "${WORK_DIR}/src/.aegis" ]]

if bash "${WORK_DIR}/aegis" verify >/dev/null 2>&1 || bash "${WORK_DIR}/aegis" proofs >/dev/null 2>&1; then
  echo 'redundant promotion command remains public' >&2
  exit 1
fi

echo '[AEGIS][TEST][PASS] IDE gateway passed'
