#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"
INVENTORY_FIXTURE_DIR="${ROOT_DIR}/src/__aegis_inventory_fixture"

cleanup() {
  rm -f "${RUNTIME_DIR}/mechanical_inventory.json" "${RUNTIME_DIR}/review-envelope.json" "${RUNTIME_DIR}/review-decision.json"
  rm -rf "${INVENTORY_FIXTURE_DIR}"
}
trap cleanup EXIT

output="$(bash "${ROOT_DIR}/aegis" $'Criar uma biblioteca\r\ndeterminística.' --target src)"
[[ "$(printf '%s' "${output}" | wc -c | tr -d ' ')" -le 10000 ]] || {
  echo 'semantic request exceeded compact transport budget' >&2
  exit 1
}
printf '%s' "${output}" | jq -e '
  .schema == "aegis.ide_semantic_request.v2"
  and .status == "PENDING_SEMANTIC_COMPILATION"
  and (.executionId | length == 64)
  and ((.baseCommit == null) or (.baseCommit | length >= 40))
  and (.contextDigest | length == 64)
  and (.promptDigest | length == 64)
  and .timing.phase == "preflight"
  and (.timing.durationMs >= 0)
  and .protocol.decisionPath == ".harness/runtime/preflight_decision.json"
  and .protocol.promotion == ["implement authorized scope", "stage persistent changes", "./aegis authorize", "git commit"]
  and (.protocol.forbidden | index("verification before authorize"))
  and (.prompt | contains("\r") | not)
  and (has("normalizedDemand") | not)
  and (has("mechanicalFacts") | not)
  and (has("architecture") | not)
  and (has("previousContract") | not)
' >/dev/null
printf '%s' "${output}" | node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { assertSchema } from "./scripts/lib/schema_validator.mjs";
  const request = JSON.parse(readFileSync(0, "utf8"));
  assertSchema("aegis.ide_semantic_request.v2", request);
  if (!request.prompt.includes("\"trigger\":\"...\",\"observableOutcome\":\"...\"")) throw new Error("clarified failure shape absent");
  if (!request.prompt.includes("\"id\":\"PF-...\"")) throw new Error("finding id shape absent");
'
[[ ! -e "${RUNTIME_DIR}/ide_intake.json" ]] || {
  echo 'legacy intake artifact was persisted' >&2
  exit 1
}

printf '%s' "${output}" > "${RUNTIME_DIR}/review-envelope.json"
node --input-type=module - "${RUNTIME_DIR}/review-envelope.json" "${RUNTIME_DIR}/review-decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [envelopePath, decisionPath] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const context = envelope.prompt.match(/candidateRules=(\{.*\})\npreviousContract=/s);
if (context === null) throw new Error('semantic prompt does not expose candidate rules');
const candidates = JSON.parse(context[1]).candidateRules;
const assessments = candidates.map((rule) => ({
  ruleId: rule.id,
  verdict: 'NOT_APPLICABLE',
  evidence: 'Não aplicável à biblioteca pedida.',
  sourceUnitIds: [],
}));
const requirement = { id: 'REQ-REVIEW-001', statement: 'Criar a biblioteca determinística.', provenance: 'USER' };
const clarifiedDemandBody = {
  intent: requirement.statement,
  requirements: [requirement],
  scope: { included: ['src'], excluded: [] },
  inputCoverage: [{ unitId: 'UNIT-0001', disposition: 'REQUIREMENT', requirementIds: [requirement.id], rationale: 'Requisito.' }],
};
writeFileSync(decisionPath, JSON.stringify({
  schema: 'aegis.preflight_decision.v2',
  contextDigest: envelope.contextDigest,
  status: 'CLARIFIED',
  ruleAssessments: assessments,
  findings: [],
  questions: [],
  clarifiedDemandBody,
  contractBody: {
    scope: { authorizedPaths: ['src'] },
    behavior: [{ id: 'BEH-REVIEW-001', statement: 'A biblioteca determinística fica disponível.' }],
    invariants: [],
    proofObligations: [{ id: 'PO-REVIEW-001', risk: 'biblioteca ausente', statement: 'A biblioteca deve ser observável por prova.' }],
    requirementCoverage: [{ requirementId: requirement.id, contractIds: ['BEH-REVIEW-001', 'PO-REVIEW-001'] }],
  },
}));
NODE

output="$(bash "${ROOT_DIR}/aegis" review $'Criar uma biblioteca\r\ndeterminística.' --target src --decision .harness/runtime/review-decision.json --producer-id producer --reviewer-id reviewer)"
printf '%s' "${output}" | jq -e '.schema == "aegis.preflight_review_request.v2" and .producerId == "producer" and .reviewerId == "reviewer"' >/dev/null
if bash "${ROOT_DIR}/aegis" review 'demanda' --decision .harness/runtime/review-decision.json --producer-id same --reviewer-id same >/dev/null 2>&1; then
  echo 'review accepted non-independent authority' >&2
  exit 1
fi

if bash "${ROOT_DIR}/aegis" 'demanda' --target ../outside >/dev/null 2>&1; then
  echo 'unsafe target was accepted' >&2
  exit 1
fi

output="$(bash "${ROOT_DIR}/aegis" proofs --profile fast)"
if [[ -e "${ROOT_DIR}/.harness/active_contract_ir.json" && -e "${ROOT_DIR}/.harness/proof_registry.json" ]]; then
  printf '%s\n' "${output}" | grep -q '\[AEGIS\]\[PROOF\]'
else
  printf '%s\n' "${output}" | grep -qx '\[AEGIS\]\[PROOF\] NOT_APPLICABLE (no project contract or proof registry)'
fi
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
