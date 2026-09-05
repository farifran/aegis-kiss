#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-preflight-v2.XXXXXX")"
cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT

envelope_file="${WORK_DIR}/envelope.json"
cp -r "${ROOT_DIR}/governance" "${WORK_DIR}/"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${WORK_DIR}/ARCHITECTURE.md"
printf '\357\273\277# Criar\r\nUse BigInt(Date.now()) em `src/clock.ts`.\rConsulte https://example.test/spec\n' \
  | AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/preflight.mjs" --target src > "${envelope_file}"

node --input-type=module - "${envelope_file}" "${WORK_DIR}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const { sha256 } = await import(process.cwd() + '/scripts/lib/canonical_json.mjs');
const [envelopePath, workDir] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
if (envelope.schema !== 'aegis.ide_preflight.v2') throw new Error('unexpected envelope schema');
if (Object.hasOwn(envelope.normalizedDemand, 'rawDigest')) throw new Error('legacy normalizer residue');
if (envelope.normalizedDemand.text.includes('\r') || envelope.normalizedDemand.text.charCodeAt(0) === 0xfeff) throw new Error('normalization failed');
if (!envelope.normalizedDemand.references.some((item) => item.kind === 'symbol' && item.value === 'Date.now')) throw new Error('symbol extraction failed');
if (!envelope.mechanicalFacts.references.some((item) => item.kind === 'url' && item.status === 'UNPROVEN')) throw new Error('url fact failed');
if (!envelope.normalizedDemand.units.every((unit) => unit.range.endByte > unit.range.startByte)) throw new Error('invalid range');

const assessments = envelope.architecture.candidateRules.map((rule) => ({
  ruleId: rule.id,
  verdict: 'NOT_APPLICABLE',
  evidence: 'A demanda não descreve operação com efeito externo nem dependência temporal obrigatória.',
  sourceUnitIds: [],
}));
const requirement = { id: 'REQ-PREFLIGHT-001', statement: 'Implementar a alteração solicitada.', provenance: 'USER' };
const clarifiedDemandBody = {
  intent: 'Implementar a alteração solicitada.',
  requirements: [requirement],
  scope: { included: ['src/clock.ts'], excluded: [] },
  inputCoverage: envelope.normalizedDemand.units.map((unit) => ({
    unitId: unit.id,
    disposition: 'REQUIREMENT',
    requirementIds: [requirement.id],
    rationale: 'Unidade preservada como requisito explícito.',
  })),
};
const contractBody = {
  scope: { authorizedPaths: ['src/clock.ts'] },
  behavior: [{ id: 'BEH-PREFLIGHT-001', statement: 'A alteração solicitada fica disponível no caminho autorizado.' }],
  invariants: [],
  proofObligations: [{ id: 'PO-PREFLIGHT-001', risk: 'alteração ausente', statement: 'O comportamento solicitado deve ser observável por uma prova do projeto.' }],
  requirementCoverage: [{ requirementId: requirement.id, contractIds: ['BEH-PREFLIGHT-001', 'PO-PREFLIGHT-001'] }],
};
const decision = {
  schema: 'aegis.preflight_decision.v2',
  contextDigest: envelope.contextDigest,
  status: 'CLARIFIED',
  ruleAssessments: assessments,
  findings: [],
  questions: [],
  clarifiedDemandBody,
  contractBody,
};
writeFileSync(workDir + '/decision.json', JSON.stringify(decision));
writeFileSync(workDir + '/invalid-decision.json', JSON.stringify({ ...decision, ruleAssessments: assessments.slice(1) }));
const review = {
  schema: 'aegis.preflight_review.v2',
  normalizedDemandDigest: envelope.normalizedDemand.digest,
  decisionDigest: sha256(readFileSync(workDir + '/decision.json')),
  producerId: 'producer-model',
  reviewerId: 'independent-model',
  verdict: 'APPROVED',
  findings: [],
};
writeFileSync(workDir + '/review.json', JSON.stringify(review));
NODE

if AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" --decision invalid-decision.json < "${envelope_file}" >/dev/null 2>&1; then
  echo 'finalizer accepted incomplete architecture assessments' >&2
  exit 1
fi

AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision decision.json --independent-review review.json < "${envelope_file}" > "${WORK_DIR}/result.json"

jq -e '.schema == "aegis.preflight_finalization.v2" and .status == "SEMANTIC_STATE_PERSISTED" and .interpretationStatus == "NOT_REQUIRED" and (.clarifiedDemandDigest | test("^[a-f0-9]{64}$")) and (.contractDigest | test("^[a-f0-9]{64}$"))' "${WORK_DIR}/result.json" >/dev/null
jq -e '.schema == "aegis.clarified_demand.v2" and (.inputCoverage | length) > 0 and (.architecture.ruleAssessments | length) > 0' "${WORK_DIR}/.harness/active_clarified_demand.json" >/dev/null
jq -e '.schema == "aegis.contract_ir.v2" and .scope.authorizedPaths == ["src/clock.ts"] and (.clarifiedDemandDigest | test("^[a-f0-9]{64}$"))' "${WORK_DIR}/.harness/active_contract_ir.json" >/dev/null

for scenario in confirm correction; do
  scenario_dir="${WORK_DIR}/${scenario}"
  mkdir -p "${scenario_dir}/governance"
  cp "${ROOT_DIR}/ARCHITECTURE.md" "${scenario_dir}/ARCHITECTURE.md"
  cp "${ROOT_DIR}/governance/architecture.policy.json" "${scenario_dir}/governance/architecture.policy.json"
done

node --input-type=module - "${envelope_file}" "${WORK_DIR}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const { sha256 } = await import(process.cwd() + '/scripts/lib/canonical_json.mjs');
const [envelopePath, workDir] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const direct = JSON.parse(readFileSync(workDir + '/decision.json', 'utf8'));
const question = {
  id: 'Q-SCOPE-001',
  scope: 'SCOPE',
  prompt: 'O caminho solicitado deve ser mantido?',
  evidence: 'A demanda nomeia src/clock.ts.',
  impact: 'A resposta define o arquivo autorizado.',
  recommendation: 'Manter src/clock.ts.',
  interpretedAnswer: 'Sim, manter src/clock.ts como único arquivo novo.',
  sourceUnitIds: [envelope.normalizedDemand.units[1].id],
};
const decision = {
  schema: direct.schema,
  contextDigest: direct.contextDigest,
  status: 'NEEDS_CONFIRMATION',
  ruleAssessments: direct.ruleAssessments,
  findings: direct.findings,
  questions: [question],
  provisionalClarifiedDemandBody: direct.clarifiedDemandBody,
  provisionalContractBody: direct.contractBody,
};
for (const scenario of ['confirm', 'correction']) {
  const decisionPath = workDir + '/' + scenario + '/decision.json';
  writeFileSync(decisionPath, JSON.stringify(decision));
  const answer = scenario === 'confirm'
    ? { questionId: question.id, action: 'CONFIRM_INTERPRETATION' }
    : { questionId: question.id, action: 'CORRECT_INTERPRETATION', correction: 'Use src/time.ts.' };
  writeFileSync(workDir + '/' + scenario + '/resolution.json', JSON.stringify({
    schema: 'aegis.preflight_resolution.v2',
    decisionDigest: sha256(readFileSync(decisionPath)),
    preflightPromptDigest: envelope.promptDigest,
    answers: [answer],
  }));
}
NODE

AEGIS_ROOT="${WORK_DIR}/confirm" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision decision.json --resolution resolution.json < "${envelope_file}" > "${WORK_DIR}/confirm/result.json"
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and .interpretationStatus == "INTERPRETATION_CONFIRMED"' "${WORK_DIR}/confirm/result.json" >/dev/null
[[ -f "${WORK_DIR}/confirm/.harness/active_clarified_demand.json" && -f "${WORK_DIR}/confirm/.harness/active_contract_ir.json" ]]

AEGIS_ROOT="${WORK_DIR}/correction" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision decision.json --resolution resolution.json < "${envelope_file}" > "${WORK_DIR}/correction/result.json"
jq -e '.status == "SEMANTIC_REVISION_REQUIRED" and .corrections == [{"questionId":"Q-SCOPE-001","correction":"Use src/time.ts."}]' "${WORK_DIR}/correction/result.json" >/dev/null
[[ ! -e "${WORK_DIR}/correction/.harness/active_clarified_demand.json" && ! -e "${WORK_DIR}/correction/.harness/active_contract_ir.json" ]]

echo '[AEGIS][TEST] preflight v2: PASS'
