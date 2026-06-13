#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
)"

cd "${TEST_ROOT}"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

if grep -Eq '(^|[[:space:]])rg([[:space:]]|$)' \
  scripts/audit_epistemic_pipeline.sh; then
  fail "audit_depends_on_ripgrep"
fi

output="$("${BASH}" scripts/audit_epistemic_pipeline.sh)"

printf '%s\n' "${output}" \
  | jq -e '
      .pipeline_ok == true
      and .mutation_pipeline_proven == true
      and .epistemic_pipeline_proven == true
      and (.boundaries | length == 6)
      and (.boundaries[0].boundary == "Discovery -> Forensics")
      and (.boundaries[0].status == "pass")
      and (.boundaries[0].next_mode_operates_from_contract_only == true)
      and (.boundaries[1].boundary == "Forensics -> Repair")
      and (.boundaries[1].status == "pass")
      and (.boundaries[1].next_mode_operates_from_contract_only == true)
      and (.boundaries[2].boundary == "Repair -> Optimize")
      and (.boundaries[2].status == "pass")
      and (.boundaries[2].next_mode_operates_from_contract_only == true)
      and (.boundaries[3].status == "pass")
      and (.boundaries[4].status == "pass")
      and (.boundaries[5].boundary == "Validation -> Promote")
      and (.boundaries[5].status == "pass")
      and (.boundaries[5].next_mode_operates_from_contract_only == true)
    ' >/dev/null \
  || fail "unexpected_epistemic_pipeline_audit"

echo "[PASS] epistemic pipeline audit"
