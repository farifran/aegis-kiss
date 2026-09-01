#!/usr/bin/env bash

# =========================================================
# AEGIS — UAAM CONTRACT COMPLETENESS GATE
# =========================================================

set -Eeuo pipefail

contract_file="${AEGIS_UAAM_CONTRACT_FILE:-.harness/active_contract_ir.json}"
[[ -s "${contract_file}" ]] || {
  echo "[AEGIS][UAAM][CONTRACT] missing_active_contract" >&2
  exit 1
}

jq -e '
  . as $ir |
  (.version == "3.0")
  and (.goal | type == "string" and length > 0)
  and (.targets | type == "array" and length > 0)
  and (.publicContract | type == "object")
  and (.requirements | type == "array" and length > 0)
  and (.operations | type == "array" and length > 0)
  and (.proofObligations | type == "array" and length > 0)
  and any(.proofObligations[]; .domain == "CONTRACT" and (.oracle | type == "string" and length > 0))
  and all(.proofObligations[];
    (.id | type == "string" and length > 0)
    and (.domain | type == "string" and length > 0)
    and (.oracle | type == "string" and length > 0)
    and ((has("status") | not))
  )
  and all(.requirements[];
    (.id | type == "string" and length > 0)
    and ((.proofObligationId // .obligationId) | type == "string" and length > 0)
    and ((.proofObligationId // .obligationId) as $ref | [$ir.proofObligations[]?.id] | index($ref) != null)
  )
' "${contract_file}" >/dev/null || {
  echo "[AEGIS][UAAM][CONTRACT] UNPROVEN: Contract IR v3 incompleto, sem requisitos mapeados ou sem contract_coverage" >&2
  exit 1
}

echo "[AEGIS][UAAM][CONTRACT] contract_completeness: PASS"
