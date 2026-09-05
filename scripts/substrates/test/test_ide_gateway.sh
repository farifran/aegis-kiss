#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"
INVENTORY_FIXTURE_DIR="${ROOT_DIR}/src/__aegis_inventory_fixture"

cleanup() {
  rm -f "${RUNTIME_DIR}/ide_intake.json" "${RUNTIME_DIR}/mechanical_inventory.json"
  rm -rf "${INVENTORY_FIXTURE_DIR}"
}
trap cleanup EXIT

output="$(bash "${ROOT_DIR}/aegis" $'Criar uma biblioteca\r\ndeterminística.' --target src)"
printf '%s' "${output}" | jq -e '
  .schema == "aegis.ide_preflight.v1"
  and .status == "PENDING_SEMANTIC_PREFLIGHT"
  and (.normalizedDemandDigest | length == 64)
  and (.prompt | contains("\r") | not)
  and (has("demand") | not)
' >/dev/null
[[ ! -e "${RUNTIME_DIR}/ide_intake.json" ]] || {
  echo 'intake persisted raw demand' >&2
  exit 1
}

if bash "${ROOT_DIR}/aegis" 'demanda' --target ../outside >/dev/null 2>&1; then
  echo 'unsafe target was accepted' >&2
  exit 1
fi

output="$(bash "${ROOT_DIR}/aegis" proofs)"
printf '%s\n' "${output}" | grep -qx '\[AEGIS\]\[PROOF\] NOT_APPLICABLE (no project contract or proof registry)'
git check-ignore -q .harness/runtime/ide_validation.json

mkdir -p "${INVENTORY_FIXTURE_DIR}"
printf 'alpha-content\n' > "${INVENTORY_FIXTURE_DIR}/alpha.txt"
printf 'beta-content\n' > "${INVENTORY_FIXTURE_DIR}/beta.txt"
printf 'gamma-content\n' > "${INVENTORY_FIXTURE_DIR}/gamma.txt"

output="$(bash "${ROOT_DIR}/aegis" evidence --path src/__aegis_inventory_fixture --max-files 3 --max-total-bytes 16 --max-file-bytes 8)"
printf '%s\n' "${output}" | grep -q '^\[AEGIS\]\[EVIDENCE\] inventory=READY materialization=FRESH files=3/3 bytes=16 '
jq -e '
  .schema == "aegis.mechanical_inventory.v1"
  and .coverage.complete == true
  and .coverage.selectedFiles == 3
  and .coverage.previewBytes == 16
  and ([.files[] | .previewEncoding == "base64"] | all)
' "${RUNTIME_DIR}/mechanical_inventory.json" >/dev/null

output="$(bash "${ROOT_DIR}/aegis" evidence --path src/__aegis_inventory_fixture --max-files 3 --max-total-bytes 16 --max-file-bytes 8)"
printf '%s\n' "${output}" | grep -q '^\[AEGIS\]\[EVIDENCE\] inventory=READY materialization=FRESH files=3/3 '

printf 'changed\n' >> "${INVENTORY_FIXTURE_DIR}/alpha.txt"
output="$(bash "${ROOT_DIR}/aegis" evidence --path src/__aegis_inventory_fixture --max-files 3 --max-total-bytes 16 --max-file-bytes 8)"
printf '%s\n' "${output}" | grep -q '^\[AEGIS\]\[EVIDENCE\] inventory=READY materialization=FRESH files=3/3 '

output="$(bash "${ROOT_DIR}/aegis" evidence --path src/__aegis_inventory_fixture --max-files 2)"
printf '%s\n' "${output}" | grep -q '^\[AEGIS\]\[EVIDENCE\] inventory=READY materialization=FRESH files=2/3 '
jq -e '(.coverage.complete == false and .coverage.omittedFiles == 1 and (has("cache") | not))' "${RUNTIME_DIR}/mechanical_inventory.json" >/dev/null

printf 'space-safe\n' > "${INVENTORY_FIXTURE_DIR}/name with spaces.txt"
output="$(bash "${ROOT_DIR}/aegis" evidence --path 'src/__aegis_inventory_fixture/name with spaces.txt')"
printf '%s\n' "${output}" | grep -q '^\[AEGIS\]\[EVIDENCE\] inventory=READY materialization=FRESH files=1/1 '
jq -e '.files[0].path == "src/__aegis_inventory_fixture/name with spaces.txt"' "${RUNTIME_DIR}/mechanical_inventory.json" >/dev/null

if bash "${ROOT_DIR}/aegis" evidence --path ../outside >/dev/null 2>&1; then
  echo 'unsafe inventory path was accepted' >&2
  exit 1
fi

if bash "${ROOT_DIR}/aegis" evidence >/dev/null 2>&1; then
  echo 'inventory accepted no explicit paths' >&2
  exit 1
fi

git check-ignore -q .harness/runtime/mechanical_inventory.json

bash "${ROOT_DIR}/aegis" 'Nova demanda deve iniciar sem inventário anterior.' >/dev/null
[[ ! -e "${RUNTIME_DIR}/mechanical_inventory.json" ]] || {
  echo 'new demand retained prior mechanical inventory' >&2
  exit 1
}

search_cmd() {
  if command -v rg >/dev/null 2>&1; then
    rg -n -i "$@"
  else
    grep -n -i -E "$@"
  fi
}

for forbidden in "a""ider" "raw_""llm" "run_""aegis"; do
  if search_cmd "${forbidden}" \
    "${ROOT_DIR}/aegis" \
    "${ROOT_DIR}/scripts/ide_gateway.sh" \
    "${ROOT_DIR}/package.json" >/dev/null; then
    echo 'IDE gateway still depends on a removed CLI executor' >&2
    exit 1
  fi
done

echo '[AEGIS][TEST][PASS] IDE gateway passed'
