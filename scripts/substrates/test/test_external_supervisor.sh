#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-external-supervisor.XXXXXX")"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

mkdir -p "${WORK_DIR}/src" "${WORK_DIR}/.harness/runtime"
cp -r "${ROOT_DIR}/governance" "${WORK_DIR}/governance"
cp "${ROOT_DIR}/AGENTS.md" "${WORK_DIR}/AGENTS.md"
cp "${ROOT_DIR}/ARCHITECTURE.md" "${WORK_DIR}/ARCHITECTURE.md"
printf '.harness/runtime/\n.harness/supervisor.json\n' > "${WORK_DIR}/.gitignore"
printf 'export {};\n' > "${WORK_DIR}/src/index.ts"
git -C "${WORK_DIR}" init -q
git -C "${WORK_DIR}" config user.name Aegis
git -C "${WORK_DIR}" config user.email aegis@example.invalid
git -C "${WORK_DIR}" add .
git -C "${WORK_DIR}" commit -qm baseline

AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" \
  external --endpoint https://fixture.invalid/v1 --model fixture-llama-11b --timeout-ms 5000 > /dev/null
setup="$(AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" show)"
mode="$(jq -r '.supervisor.mode' <<< "${setup}")"
model="$(jq -r '.supervisor.id' <<< "${setup}")"
config_digest="$(jq -r '.supervisor.configDigest' <<< "${setup}")"
request_path="${WORK_DIR}/.harness/runtime/request.json"
decision_path="${WORK_DIR}/.harness/runtime/decision.json"

printf 'Criar src/clock.ts com tempo explícito.\n' \
  | AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/preflight.mjs" \
      --kind PRODUCT --save-envelope --supervisor-mode "${mode}" --supervisor-id "${model}" --supervisor-config-digest "${config_digest}" \
      > "${request_path}"
envelope="${WORK_DIR}/.harness/runtime/preflight_envelope.json"

node --input-type=module - "${envelope}" "${decision_path}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [envelopePath, decisionPath] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const units = envelope.normalizedDemand.units.map((_, index) => index);
writeFileSync(decisionPath, JSON.stringify({
  schema: 'aegis.preflight_decision.v2', contextDigest: envelope.contextDigest, promptDigest: envelope.promptDigest,
  status: 'CLARIFIED', rules: envelope.architecture.candidateRules.map((rule) => [rule.id, 'NOT_APPLICABLE', 'Sem incidência.', []]),
  questions: [], riskProfile: 'standard', stateModel: { kind: 'NONE', bindings: [] }, stateSemantics: [],
  intent: 'Criar relógio.', scope: ['src/clock.ts', 'src/clock.proof.ts'], excluded: [],
  requirements: [['Criar relógio.', 'USER', units]], contextUnits: [], acceptance: ['API observável.'],
  failures: [['Entrada inválida', 'Erro explícito.', [0]]], behaviors: [['API existe.', [0]]],
  preconditions: [['Entrada válida.', [0]]], invariants: [['Estado não regride.', [0], [0]]],
  postconditions: [['Resultado observável.', [0]]],
  proofs: [['clock.behavior', 'Relógio incorreto', 'Provar comportamento.', [0], 'src/clock.proof.ts', ['src/clock.ts'], 'low', 'always']],
  continuity: { retirements: [], proofChanges: [] },
}));
NODE

AEGIS_ROOT="${WORK_DIR}" node --input-type=module - "${ROOT_DIR}" "${request_path}" "${decision_path}" > /dev/null <<'NODE'
import { readFileSync } from 'node:fs';
const [root, requestPath, decisionPath] = process.argv.slice(2);
const { runExternalSupervisor } = await import(`${root}/scripts/external_supervisor.mjs`);
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const decision = readFileSync(decisionPath, 'utf8');
const result = await runExternalSupervisor(request, {
  repositoryRoot: process.env.AEGIS_ROOT,
  requestFn: async (url, init) => {
    if (url !== 'https://fixture.invalid/v1/chat/completions') throw new Error('unexpected_endpoint');
    const body = JSON.parse(init.body);
    if (body.model !== 'fixture-llama-11b') throw new Error('unexpected_model');
    return new Response(JSON.stringify({ choices: [{ message: { content: decision } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }), { status: 200 });
  },
});
process.stdout.write(JSON.stringify(result));
NODE

jq -e '.schema == "aegis.supervisor_execution.v1" and .supervisor == {mode:"EXTERNAL",id:"fixture-llama-11b",configDigest:.supervisor.configDigest} and .usage == {promptTokens:11,completionTokens:7}' \
  "${WORK_DIR}/.harness/runtime/supervisor_execution.json" >/dev/null
AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/preflight_decision.json < "${envelope}" > "${WORK_DIR}/.harness/runtime/finalization-result.json"
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and .supervisor.mode == "EXTERNAL" and (.supervisor.executionArtifactBytesDigest | test("^[a-f0-9]{64}$"))' \
  "${WORK_DIR}/.harness/runtime/finalization-result.json" >/dev/null

echo '[AEGIS][TEST][PASS] external supervisor passed'
