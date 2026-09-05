#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"

output="$(bash "${ROOT_DIR}/aegis" $'Atualizar `src/index.ts`\r\nsem rede externa.' --target src)"
printf '%s' "${output}" | jq -e '
  .schema == "aegis.ide_preflight.v1"
  and .status == "PENDING_SEMANTIC_PREFLIGHT"
  and (.normalizedDemandDigest | test("^[a-f0-9]{64}$"))
  and (.mechanicalFactsDigest | test("^[a-f0-9]{64}$"))
  and (.architecturePolicyDigest | test("^[a-f0-9]{64}$"))
  and .architectureSourceStatus == "CURRENT"
  and (.promptDigest | test("^[a-f0-9]{64}$"))
  and (.prompt | contains("\r") | not)
  and (.prompt | contains("src/index.ts"))
  and (.prompt | contains("directory_exists"))
  and (.prompt | contains("ARCH-FAILURE-EXPLICIT"))
  and (.prompt | contains("<REGRAS_ARQUITETURAIS_CANDIDATAS>"))
  and (.prompt | contains("# Aegis Preflight Prompt") | not)
  and (has("normalizedDemand") | not)
' >/dev/null
[[ ! -e "${RUNTIME_DIR}/ide_intake.json" ]] || {
  echo 'preflight persisted raw intake' >&2
  exit 1
}

output="$(bash "${ROOT_DIR}/aegis" 'Inspecionar `missing-file.txt`.' --target missing-target)"
printf '%s' "${output}" | jq -e '
  .status == "PENDING_SEMANTIC_PREFLIGHT"
  and (.prompt | contains("missing-target"))
  and (.prompt | contains("path_not_found"))
  and (.prompt | contains("missing-file.txt"))
' >/dev/null

printf '[AEGIS][TEST] preflight builder: PASS\n'
