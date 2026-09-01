#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"
source scripts/lib/mechanical_scans.sh

aegis_emit_framed_json_artifact() {
  if [[ "$#" -gt 0 ]]; then printf '%s\n' "$1"; else cat; fi
}
VERDICT_FILE="$(mktemp)"
trap 'rm -f "${VERDICT_FILE}"' EXIT

jq -n '{status:"approved",basis:"model_claimed_clean"}' > "${VERDICT_FILE}"
clean_artifact="$(aegis_synthesize_agentic_verdict_artifact adversarial "${VERDICT_FILE}")"
jq -e '.status == "inconclusive" and .authority == "runtime"' <<<"${clean_artifact}" >/dev/null

jq -n '{status:"approved",basis:"model_claimed_clean",attacks:[{id:"ATTACK-1",description:"forced partial failure"}]}' > "${VERDICT_FILE}"
attack_artifact="$(aegis_synthesize_agentic_verdict_artifact adversarial "${VERDICT_FILE}")"
jq -e '.status == "challenged" and .authority == "runtime" and (.findings | length) == 1' <<<"${attack_artifact}" >/dev/null

echo "[AEGIS][TEST] uaam_authority: PASS"
