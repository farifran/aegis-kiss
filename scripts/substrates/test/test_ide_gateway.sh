#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"

cleanup() { rm -f "${RUNTIME_DIR}/ide_intake.json"; }
trap cleanup EXIT

output="$(bash "${ROOT_DIR}/aegis" 'Criar uma biblioteca determinística.' --target src)"
printf '%s\n' "${output}" | grep -qx '\[AEGIS\]\[IDE\] intake=PENDING_IDE_CONTRACT file=.harness/runtime/ide_intake.json'
jq -e '
  .schema == "aegis.ide_intake.v1"
  and .status == "PENDING_IDE_CONTRACT"
  and .requestedTarget == "src"
  and (.demandDigest | length == 64)
' "${RUNTIME_DIR}/ide_intake.json" >/dev/null

if bash "${ROOT_DIR}/aegis" 'demanda' --target ../outside >/dev/null 2>&1; then
  echo 'unsafe target was accepted' >&2
  exit 1
fi

output="$(bash "${ROOT_DIR}/aegis" proofs)"
printf '%s\n' "${output}" | grep -qx '\[AEGIS\]\[PROOF\] NOT_APPLICABLE (no project contract or proof registry)'

for forbidden in "a""ider" "raw_""llm" "run_""aegis"; do
  if rg -n -i "${forbidden}" \
    "${ROOT_DIR}/aegis" \
    "${ROOT_DIR}/scripts/ide_gateway.sh" \
    "${ROOT_DIR}/package.json" >/dev/null; then
    echo 'IDE gateway still depends on a removed CLI executor' >&2
    exit 1
  fi
done

echo '[AEGIS][TEST][PASS] IDE gateway passed'
