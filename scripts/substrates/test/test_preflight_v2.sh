#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-preflight-v2.XXXXXX")"
cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT

prepare_repository() {
  local directory="$1"
  mkdir -p "${directory}/src" "${directory}/.harness/runtime"
  cp -r "${ROOT_DIR}/governance" "${directory}/"
  cp "${ROOT_DIR}/ARCHITECTURE.md" "${directory}/ARCHITECTURE.md"
  printf '.harness/runtime/\n' > "${directory}/.gitignore"
  git -C "${directory}" init -q
  git -C "${directory}" config user.name Aegis
  git -C "${directory}" config user.email aegis@example.invalid
  git -C "${directory}" add .
  git -C "${directory}" commit -qm baseline
}

write_decision() {
  local envelope="$1" destination="$2" status="${3:-CLARIFIED}"
  node --input-type=module - "${envelope}" "${destination}" "${status}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [envelopePath, destination, status] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const allUnits = envelope.normalizedDemand.units.map((_, index) => index);
const decision = {
  schema: 'aegis.preflight_decision.v2',
  contextDigest: envelope.contextDigest,
  status,
  rules: envelope.architecture.candidateRules.map((rule) => [rule.id, 'NOT_APPLICABLE', 'Sem incidência no comportamento solicitado.', []]),
  questions: status === 'NEEDS_CONFIRMATION'
    ? [['SCOPE', 'Manter somente src/clock.ts?', 'A demanda nomeia esse caminho.', 'Define o escopo.', 'Sim.', 'Somente src/clock.ts e sua prova.', [allUnits[0]]]]
    : [],
  intent: 'Criar o relógio solicitado.',
  scope: ['src/clock.ts', 'src/clock.proof.ts'],
  excluded: [],
  requirements: [['Criar src/clock.ts com tempo explícito.', 'USER', allUnits]],
  contextUnits: [],
  acceptance: ['A API solicitada é observável.'],
  failures: [['Tempo inválido', 'RangeError', [0]]],
  behaviors: [['A API de relógio fica disponível.', [0]]],
  preconditions: [['Tempo é bigint.', [0]]],
  invariants: [['Tempo não regride.', [0], [0]]],
  postconditions: [['O tempo informado é preservado.', [0]]],
  proofs: [['clock.behavior', 'Relógio incorreto', 'Provar API e monotonicidade.', [0], 'src/clock.proof.ts', ['src/clock.ts'], 'low', 'always']],
  continuity: { retirements: [], proofChanges: [] },
};
writeFileSync(destination, JSON.stringify(decision));
NODE
}

prepare_repository "${WORK_DIR}/direct"
demand=$'\357\273\277# Criar\r\nUse bigint de Clock.now() em `src/clock.ts`.\rConsulte https://example.test/spec\n'
printf '%s' "${demand}" | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --save-envelope --target src > "${WORK_DIR}/direct-request.json"
envelope="${WORK_DIR}/direct/.harness/runtime/preflight_envelope.json"

jq -e '
  .schema == "aegis.ide_semantic_request.v2"
  and .changeKind == "PRODUCT"
  and (.prompt | contains("changeKind=\"PRODUCT\""))
' "${WORK_DIR}/direct-request.json" >/dev/null
[[ "$(wc -c < "${WORK_DIR}/direct-request.json" | tr -d ' ')" -lt 7000 ]]
jq -e '
  .baseline.clean == true
  and (.normalizedDemand.text | contains("\r") | not)
  and (.normalizedDemand.references | any(.kind == "symbol" and .value == "Clock.now"))
  and (.mechanicalFacts.references | any(.kind == "url" and .status == "UNPROVEN"))
' "${envelope}" >/dev/null

write_decision "${envelope}" "${WORK_DIR}/direct/.harness/runtime/decision.json"
AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/build_preflight_review.mjs" \
  --decision .harness/runtime/decision.json --producer-id producer --reviewer-id reviewer \
  < "${envelope}" > "${WORK_DIR}/review-request.json"
jq -e '.schema == "aegis.preflight_review_request.v2" and .producerId == "producer" and .reviewerId == "reviewer"' \
  "${WORK_DIR}/review-request.json" >/dev/null
node --input-type=module - "${WORK_DIR}/direct/.harness/runtime/decision.json" "${envelope}" "${WORK_DIR}/direct/.harness/runtime/review.json" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, envelopePath, reviewPath] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
writeFileSync(reviewPath, JSON.stringify({
  schema: 'aegis.preflight_review.v2',
  normalizedDemandDigest: envelope.normalizedDemand.digest,
  decisionDigest: digest(readFileSync(decisionPath)),
  producerId: 'producer',
  reviewerId: 'reviewer',
  verdict: 'APPROVED',
  findings: [],
}));
NODE
cp "${WORK_DIR}/direct/.harness/runtime/decision.json" "${WORK_DIR}/direct/.harness/runtime/invalid.json"
node --input-type=module - "${WORK_DIR}/direct/.harness/runtime/invalid.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const value = JSON.parse(readFileSync(path, 'utf8'));
value.rules.pop();
writeFileSync(path, JSON.stringify(value));
NODE
if AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/invalid.json < "${envelope}" >/dev/null 2>&1; then
  echo 'finalizer accepted incomplete architecture assessment' >&2
  exit 1
fi

jq '.scope += ["package.json"]' "${WORK_DIR}/direct/.harness/runtime/decision.json" \
  > "${WORK_DIR}/direct/.harness/runtime/outside-src.json"
if AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/outside-src.json < "${envelope}" >/dev/null 2>&1; then
  echo 'PRODUCT finalizer accepted a path outside src' >&2
  exit 1
fi

printf 'drift\n' > "${WORK_DIR}/direct/src/drift.ts"
if AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json < "${envelope}" >/dev/null 2>&1; then
  echo 'finalizer accepted worktree drift' >&2
  exit 1
fi
rm "${WORK_DIR}/direct/src/drift.ts"

AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --independent-review .harness/runtime/review.json \
  < "${envelope}" > "${WORK_DIR}/direct/.harness/runtime/result.json"
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and .changeKind == "PRODUCT" and (.proofRegistryDigest | test("^[a-f0-9]{64}$")) and (.semantic.reconciler == "mechanical_reconciliation.v1") and (.semantic.decisionDigest | test("^[a-f0-9]{64}$"))' \
  "${WORK_DIR}/direct/.harness/runtime/result.json" >/dev/null
jq -e '.changeKind == "PRODUCT" and .scope.authorizedPaths == ["src/clock.ts", "src/clock.proof.ts", "src/.aegis/clarified-demand.json", "src/.aegis/contract-ir.json", "src/.aegis/proof-registry.json"]' \
  "${WORK_DIR}/direct/src/.aegis/contract-ir.json" >/dev/null
jq -e '.proofs[0].command == "node --import tsx src/clock.proof.ts" and .proofs[0].targets == ["src/clock.ts", "src/clock.proof.ts"]' \
  "${WORK_DIR}/direct/src/.aegis/proof-registry.json" >/dev/null

prepare_repository "${WORK_DIR}/confirm"
printf 'Criar src/clock.ts.\n' | AEGIS_ROOT="${WORK_DIR}/confirm" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --save-envelope --internal-envelope > "${WORK_DIR}/confirm-envelope-copy.json"
confirm_envelope="${WORK_DIR}/confirm/.harness/runtime/preflight_envelope.json"
write_decision "${confirm_envelope}" "${WORK_DIR}/confirm/.harness/runtime/decision.json" NEEDS_CONFIRMATION
node --input-type=module - "${WORK_DIR}/confirm/.harness/runtime/decision.json" "${confirm_envelope}" "${WORK_DIR}/confirm/.harness/runtime/resolution.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [decisionPath, envelopePath, resolutionPath] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
writeFileSync(resolutionPath, JSON.stringify({
  schema: 'aegis.preflight_resolution.v2',
  decisionDigest: digest(readFileSync(decisionPath)),
  preflightPromptDigest: envelope.promptDigest,
  answers: [{ questionId: 'Q-0001', action: 'CONFIRM_INTERPRETATION' }],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/confirm" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  < "${confirm_envelope}" > "${WORK_DIR}/confirm/.harness/runtime/result.json"
jq -e '.interpretationStatus == "INTERPRETATION_CONFIRMED"' "${WORK_DIR}/confirm/.harness/runtime/result.json" >/dev/null

# A hard architecture signal cannot be silently rewritten into a new public API.
# The mechanical reconciler must request revision first, then accept the same
# interpretation only after the user confirms it.
prepare_repository "${WORK_DIR}/hard-signal"
token_demand='Crie src/tokenBucket.ts com a classe TokenBucket. Use bigint com BigInt(Date.now()). Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPerMs limitando ao maxTokens. Em consume(bits: bigint), atualize e deduza saldo. Exporte a função obterEstadoBitmask(bucket: TokenBucket): number com bit 0 se tokens==0n e bit 1 se refil ativo. Re-exporte no src/index.ts.'
printf '%s' "${token_demand}" | AEGIS_ROOT="${WORK_DIR}/hard-signal" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --save-envelope --internal-envelope > "${WORK_DIR}/hard-signal-envelope-copy.json"
hard_envelope="${WORK_DIR}/hard-signal/.harness/runtime/preflight_envelope.json"
jq -e '(.normalizedDemand.units | length) >= 7 and (.architecture.candidateRules[] | select(.id == "ARCH-DETERMINISTIC-TIME") | .forbiddenReferences == ["Date.now"])' \
  "${hard_envelope}" >/dev/null
node --input-type=module - "${hard_envelope}" "${WORK_DIR}/hard-signal/.harness/runtime/decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [envelopePath, destination] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const allUnits = envelope.normalizedDemand.units.map((_, index) => index);
writeFileSync(destination, JSON.stringify({
  schema: 'aegis.preflight_decision.v2',
  contextDigest: envelope.contextDigest,
  status: 'CLARIFIED',
  rules: envelope.architecture.candidateRules.map((rule) => [rule.id, 'APPLIED', 'A regra foi considerada.', allUnits]),
  questions: [],
  intent: 'Implementar TokenBucket determinístico.',
  scope: ['src/tokenBucket.ts', 'src/tokenBucket.proof.ts', 'src/index.ts'],
  excluded: [],
  requirements: [['TokenBucket aceita (maxBytes: bigint, mbps: number, initialTime: bigint).', 'USER', allUnits]],
  contextUnits: [],
  acceptance: ['A API é observável.'],
  failures: [['Tempo regressivo', 'RangeError', [0]]],
  behaviors: [['update(now: bigint) atualiza o saldo.', [0]]],
  preconditions: [['initialTime e now são bigint.', [0]]],
  invariants: [['0n <= tokens.', [0], [0]]],
  postconditions: [['consume(bits: bigint, now: bigint) retorna boolean.', [0]]],
  proofs: [['token_bucket.behavior', 'Saldo incorreto', 'Provar saldo.', [0], 'src/tokenBucket.proof.ts', ['src/tokenBucket.ts'], 'low', 'always']],
  continuity: { retirements: [], proofChanges: [] },
}));
NODE
AEGIS_ROOT="${WORK_DIR}/hard-signal" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json < "${hard_envelope}" > "${WORK_DIR}/hard-signal/.harness/runtime/revision.json"
jq -e '.status == "SEMANTIC_REVISION_REQUIRED" and ([.corrections[].code] | index("hard_reference_requires_confirmation")) and ([.corrections[].code] | index("user_requirement_introduces_identifier"))' \
  "${WORK_DIR}/hard-signal/.harness/runtime/revision.json" >/dev/null
node --input-type=module - "${WORK_DIR}/hard-signal/.harness/runtime/decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const decision = JSON.parse(readFileSync(path, 'utf8'));
decision.status = 'NEEDS_CONFIRMATION';
decision.requirements[0][1] = 'ARCHITECTURE_DEFAULT';
decision.questions = [['ARCHITECTURE', 'A demanda pede Date.now(), mas a arquitetura exige tempo explícito. Confirmar initialTime e now?', 'Date.now foi detectado.', 'Altera a API pública.', 'Usar initialTime e now explícitos.', 'Interpretado: substituir Date.now por parâmetros explícitos.', decision.requirements[0][2]]];
writeFileSync(path, JSON.stringify(decision));
NODE
node --input-type=module - "${WORK_DIR}/hard-signal/.harness/runtime/decision.json" "${hard_envelope}" "${WORK_DIR}/hard-signal/.harness/runtime/resolution.json" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, envelopePath, resolutionPath] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
writeFileSync(resolutionPath, JSON.stringify({
  schema: 'aegis.preflight_resolution.v2',
  decisionDigest: digest(readFileSync(decisionPath)),
  preflightPromptDigest: envelope.promptDigest,
  answers: [{ questionId: 'Q-0001', action: 'CONFIRM_INTERPRETATION' }],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/hard-signal" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  < "${hard_envelope}" > "${WORK_DIR}/hard-signal/.harness/runtime/result.json"
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and .interpretationStatus == "INTERPRETATION_CONFIRMED"' \
  "${WORK_DIR}/hard-signal/.harness/runtime/result.json" >/dev/null

echo '[AEGIS][TEST] preflight v2: PASS'
