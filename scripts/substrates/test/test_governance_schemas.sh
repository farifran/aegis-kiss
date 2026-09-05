#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCHEMA_DIR="${ROOT_DIR}/governance/schemas"

schemas=(
  architecture-policy.v1.schema.json
  normalized-demand.v1.schema.json
  clarified-demand.v1.schema.json
  preflight-decision.v1.schema.json
  contract-ir.v2.schema.json
)

for schema in "${schemas[@]}"; do
  path="${SCHEMA_DIR}/${schema}"
  [[ -s "${path}" ]] || { echo "missing schema: ${schema}" >&2; exit 1; }
  jq -e '
    .["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    and (.["$id"] | type == "string" and startswith("aegis."))
    and .type == "object"
    and .additionalProperties == false
    and (.required | type == "array" and length > 0)
  ' "${path}" >/dev/null
done

jq -e '
  .properties.schema.const == "aegis.architecture_policy.v1"
  and (.properties.rules.items["$ref"] == "#/$defs/rule")
  and (."$defs".rule.properties.level.enum == ["hard", "default", "preference"])
' "${SCHEMA_DIR}/architecture-policy.v1.schema.json" >/dev/null

jq -e '
  .properties.schema.const == "aegis.normalized_demand.v1"
  and (."$defs".correctionCandidate.properties.semanticEffect.enum == ["none", "possible", "yes"])
  and (."$defs".reference.properties.kind.enum == ["path", "symbol", "url", "attachment"])
' "${SCHEMA_DIR}/normalized-demand.v1.schema.json" >/dev/null

jq -e '
  .properties.schema.const == "aegis.clarified_demand.v1"
  and (."$defs".requirement.properties.provenance.enum | index("USER") and index("KISS_DERIVATION"))
  and (."$defs".failureSemantic.properties.observableOutcome.type == "string")
' "${SCHEMA_DIR}/clarified-demand.v1.schema.json" >/dev/null

jq -e '
  .properties.schema.const == "aegis.preflight_decision.v1"
  and (.properties.status.enum == ["CLARIFIED", "NEEDS_CONFIRMATION", "BLOCKED"])
  and (."$defs".question.properties.scope.enum == ["INPUT", "SCOPE", "ARCHITECTURE", "DEMAND"])
' "${SCHEMA_DIR}/preflight-decision.v1.schema.json" >/dev/null

jq -e '
  .properties.schema.const == "aegis.contract_ir.v2"
  and (.properties.clarifiedDemandDigest.type == "string")
  and (."$defs".invariant.properties.proofIds.items.pattern == "^PO-[A-Z0-9][A-Z0-9-]+$")
' "${SCHEMA_DIR}/contract-ir.v2.schema.json" >/dev/null

grep -Fqx 'Demanda bruta              → transitória, apenas em memória' "${ROOT_DIR}/governance/INTERFACE_AUDIT.md"
grep -Fqx 'Contract IR                → durável e semântico' "${ROOT_DIR}/governance/INTERFACE_AUDIT.md"
grep -Fqx '#### 1. PREFLIGHT, ALINHAMENTO E CONTRATO' "${ROOT_DIR}/AGENTS.md"
grep -Fqx 'Para novas demandas, o único formato ativo é `aegis.contract_ir.v2`. Contratos' "${ROOT_DIR}/AGENTS.md"
grep -Fqx '  `ARCHITECTURE` antes do briefing quando a resposta for necessária para' "${ROOT_DIR}/AGENTS.md"
grep -Fqx 'Produza somente JSON compatível com `aegis.preflight_decision.v1`.' "${ROOT_DIR}/governance/prompts/preflight.v1.md"
grep -Fqx '4. Recomende a menor solução que satisfaça integralmente a demanda.' "${ROOT_DIR}/governance/prompts/preflight.v1.md"

printf '[AEGIS][TEST] governance schemas: PASS\n'
