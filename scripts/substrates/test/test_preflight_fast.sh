#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

FIXTURE_DIR="scratch/preflight-fast"
ACTIVE_PATH=".harness/active_clarified_demand.json"
BACKUP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$FIXTURE_DIR"
  if [[ -f "$BACKUP_DIR/active.json" ]]; then
    mkdir -p "$(dirname "$ACTIVE_PATH")"
    cp "$BACKUP_DIR/active.json" "$ACTIVE_PATH"
  else
    rm -f "$ACTIVE_PATH"
  fi
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

if [[ -f "$ACTIVE_PATH" ]]; then
  cp "$ACTIVE_PATH" "$BACKUP_DIR/active.json"
fi
mkdir -p "$FIXTURE_DIR"

DEMAND='Exportar somente o tipo HealthStatus em src/index.ts.'
PREFLIGHT_JSON="$(bash aegis "$DEMAND" --target src)"
printf '%s\n' "$PREFLIGHT_JSON" > "$FIXTURE_DIR/preflight.json"

NORMALIZED_DIGEST="$(jq -r '.normalizedDemandDigest' "$FIXTURE_DIR/preflight.json")"
MECHANICAL_DIGEST="$(jq -r '.mechanicalFactsDigest' "$FIXTURE_DIR/preflight.json")"
ARCHITECTURE_DIGEST="$(jq -r '.architecturePolicyDigest' "$FIXTURE_DIR/preflight.json")"

jq -n \
  --arg normalized "$NORMALIZED_DIGEST" \
  --arg mechanical "$MECHANICAL_DIGEST" \
  --arg architecture "$ARCHITECTURE_DIGEST" \
  '{
    schema: "aegis.preflight_decision.v1",
    normalizedDemandDigest: $normalized,
    mechanicalFactsDigest: $mechanical,
    architecturePolicyDigest: $architecture,
    appliedRuleIds: [],
    hardConflictRuleIds: [],
    status: "CLARIFIED",
    findings: [],
    questions: [],
    clarifiedDemand: {
      schema: "aegis.clarified_demand.v1",
      normalizedDemandDigest: $normalized,
      intent: "Exportar somente o tipo HealthStatus em src/index.ts.",
      requirements: [{ id: "REQ-HEALTH-001", statement: "Exportar somente o tipo HealthStatus em src/index.ts.", provenance: "USER" }],
      scope: { included: ["src/index.ts"], excluded: ["runtime"] }
    }
  }' > "$FIXTURE_DIR/decision.json"

FINAL_JSON="$(bash aegis finalize "$DEMAND" --target src --decision "$FIXTURE_DIR/decision.json")"
[[ "$(jq -r '.status' <<<"$FINAL_JSON")" == "CLARIFIED_DEMAND_PERSISTED" ]]
[[ "$(jq -r '.intent' "$ACTIVE_PATH")" == 'Exportar somente o tipo HealthStatus em src/index.ts.' ]]
[[ "$(jq 'has("demand")' "$ACTIVE_PATH")" == "false" ]]

echo "[PASS] preflight fast path"
