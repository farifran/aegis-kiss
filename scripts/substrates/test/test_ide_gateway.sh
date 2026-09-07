#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-ide-gateway.XXXXXX")"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

mkdir -p "${WORK_DIR}/src" "${WORK_DIR}/.harness/runtime"
cp "${ROOT_DIR}/aegis" "${WORK_DIR}/aegis"
cp -r "${ROOT_DIR}/scripts" "${WORK_DIR}/scripts"
cp -r "${ROOT_DIR}/governance" "${WORK_DIR}/governance"
cp "${ROOT_DIR}/AGENTS.md" "${WORK_DIR}/AGENTS.md"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${WORK_DIR}/ARCHITECTURE.md"
ln -s "${ROOT_DIR}/node_modules" "${WORK_DIR}/node_modules"
printf '.harness/runtime/\n.harness/supervisor.json\nnode_modules\n' > "${WORK_DIR}/.gitignore"
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
printf '%s' "${output}" | jq -e '.supervisor == {mode:"IDE",id:"ide-active-model",configDigest:.supervisor.configDigest}' >/dev/null
[[ -s "${WORK_DIR}/.harness/runtime/preflight_envelope.json" ]]
# The semantic request contains the compact frozen constitution, but must stay
# far below a full repository or preflight-envelope transfer.
[[ "$(printf '%s' "${output}" | wc -c | tr -d ' ')" -lt 16384 ]]

output="$(bash "${WORK_DIR}/aegis" setup show)"
printf '%s' "${output}" | jq -e '.supervisor.mode == "IDE"' >/dev/null
output="$(bash "${WORK_DIR}/aegis" setup)"
printf '%s' "${output}" | jq -e '
  .schema == "aegis.ide_setup_request.v1"
  and .status == "PENDING_USER_SELECTION"
  and .executor == "IDE"
  and (.questions | length == 1)
  and .questions[0].recommendedAnswerId == "IDE"
  and ([.questions[0].answers[].id] | sort == ["EXTERNAL", "IDE"])
  and ([.questions[0].answers[] | select(.id == "EXTERNAL") | (.requiredFields | length)] == [4])
' >/dev/null
[[ ! -e "${WORK_DIR}/.harness/supervisor.json" ]]
output="$(bash "${WORK_DIR}/aegis" setup ide)"
printf '%s' "${output}" | jq -e '.status == "CONFIGURED" and .supervisor.mode == "IDE"' >/dev/null
output="$(bash "${WORK_DIR}/aegis" status)"
printf '%s' "${output}" | jq -e '.supervisor.mode == "IDE"' >/dev/null

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
if bash "${WORK_DIR}/aegis" status >/dev/null 2>&1; then
  echo 'legacy semantic metadata was accepted as baseline' >&2
  exit 1
fi
rm "${WORK_DIR}/src/.aegis/contract-ir.json"
printf '{"schema":"aegis.semantic_state.v1","clarifiedDemand":{},"contract":{},"proofRegistry":{}}\n' > "${WORK_DIR}/src/.aegis/semantic-state.json"
bash "${WORK_DIR}/aegis" clean | grep -qx '\[AEGIS\]\[IDE\] clean=PASS source_reset=1'
[[ "$(cat "${WORK_DIR}/src/index.ts")" == $'// Ponto de entrada canônico para a próxima demanda.\nexport {};' ]]
[[ -z "$(find "${WORK_DIR}/.harness/runtime" -mindepth 1 -print -quit)" ]]
[[ ! -e "${WORK_DIR}/src/.aegis" ]]

if bash "${WORK_DIR}/aegis" verify >/dev/null 2>&1 || bash "${WORK_DIR}/aegis" proofs >/dev/null 2>&1; then
  echo 'redundant promotion command remains public' >&2
  exit 1
fi

echo '[AEGIS][TEST][PASS] IDE gateway passed'
