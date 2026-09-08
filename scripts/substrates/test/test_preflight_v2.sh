#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-preflight-v2.XXXXXX")"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

prepare_repository() {
  local directory="$1"
  mkdir -p "${directory}/src" "${directory}/.harness/runtime"
  cp -r "${ROOT_DIR}/governance" "${directory}/"
  cp "${ROOT_DIR}/AGENTS.md" "${directory}/AGENTS.md"
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
  promptDigest: envelope.promptDigest,
  status,
  rules: envelope.architecture.candidateRules.map((rule) => [rule.id, 'NOT_APPLICABLE', 'Sem incidência no comportamento solicitado.', []]),
  questions: status === 'NEEDS_CONFIRMATION'
    ? [['SCOPE', 'Manter somente src/clock.ts?', 'A demanda nomeia esse caminho.', 'Define o escopo.', 'KEEP_SCOPE', 'Somente src/clock.ts e sua prova.', [allUnits[0]], [
      ['KEEP_SCOPE', 'Manter escopo mínimo', 'Preserva a menor entrega compatível.', 'O escopo fica limitado a src/clock.ts e sua prova.', [], {}],
      ['EXPAND_SCOPE', 'Ampliar escopo', 'Autoriza arquivos adicionais quando necessário.', 'O escopo pode incluir arquivos adicionais explicitamente aprovados.', [], {}],
    ]]]
    : [],
  riskProfile: 'standard',
  stateModel: { kind: 'NONE', bindings: [] },
  stateSemantics: [],
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
cat > "${WORK_DIR}/direct/src/clockSupport.ts" <<'TS'
export const Clock = {
  now(): bigint {
    return 0n;
  },
};
TS
printf 'export const unrelated = true;\n' > "${WORK_DIR}/direct/src/unrelated.ts"
printf 'export const existing = true;\n' > "${WORK_DIR}/direct/src/existing.ts"
printf 'export const InferredAnchor = true;\n' > "${WORK_DIR}/direct/src/inferredOwner.ts"
mkdir -p "${WORK_DIR}/direct/src/space folder"
printf 'export const spaced = true;\n' > "${WORK_DIR}/direct/src/space folder/item.ts"
for fixture_index in $(seq -w 1 16); do
  printf 'export const SharedAnchor%s = true;\n' "${fixture_index}" \
    > "${WORK_DIR}/direct/src/shared-anchor-${fixture_index}.ts"
done
printf 'export const SharedAnchor = true;\n' > "${WORK_DIR}/direct/governance/hiddenDiscovery.ts"
ln -s 'clockSupport.ts' "${WORK_DIR}/direct/src/linked-clock.ts"
git -C "${WORK_DIR}/direct" add src governance/hiddenDiscovery.ts
git -C "${WORK_DIR}/direct" commit -qm 'add discovery fixtures'
demand=$'\357\273\277# Criar\r\nUse bigint de Clock.now() em `src/clock.ts`.\rConsulte https://example.test/spec\n'
printf '%s' "${demand}" | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --save-envelope --target src > "${WORK_DIR}/direct-request.json"
envelope="${WORK_DIR}/direct/.harness/runtime/preflight_envelope.json"

jq -e '
  .schema == "aegis.ide_semantic_request.v2"
  and .changeKind == "PRODUCT"
  and .timing.durationMs < 2000
  and (.constitutionDigest | test("^[a-f0-9]{64}$"))
  and (.prompt | contains("\"source\":\"AGENTS.md\""))
  and (.prompt | contains("\"rules\":\"# Aegis Cognitive Constitution"))
  and (.prompt | contains("changeKind=\"PRODUCT\""))
' "${WORK_DIR}/direct-request.json" >/dev/null
# The compact request now includes the frozen cognitive constitution.  Keep a
# strict fixture budget that still rejects accidental envelope/repository dumps.
[[ "$(wc -c < "${WORK_DIR}/direct-request.json" | tr -d ' ')" -lt 16384 ]]
jq -e '
  .baseline.clean == true
  and (.constitutionDigest | test("^[a-f0-9]{64}$"))
  and (.normalizedDemand.text | contains("\r") | not)
  and (.prompt | contains("\"source\":\"AGENTS.md\""))
  and (.prompt | contains("Use bigint de Clock.now() em `src/clock.ts`."))
  and (.prompt | contains("\"text\":"))
  and (.normalizedDemand.references | any(.kind == "symbol" and .value == "Clock.now"))
  and (.mechanicalFacts.references | any(.kind == "url" and .status == "UNPROVEN"))
  and .mechanicalFacts.discovery.status == "CANDIDATES"
  and .mechanicalFacts.discovery.schema == "aegis.discovery.v2"
  and .mechanicalFacts.discovery.scanner == {id:"aegis.layer0",version:2,algorithmDigest:.mechanicalFacts.discovery.scanner.algorithmDigest}
  and (.mechanicalFacts.discovery.scanner.algorithmDigest | test("^[a-f0-9]{64}$"))
  and .mechanicalFacts.discovery.incompleteReasons == []
  and .mechanicalFacts.discovery.demandDigest == .normalizedDemand.digest
  and .mechanicalFacts.discovery.baseCommit == .baseCommit
  and (.mechanicalFacts.discovery.candidates | length <= 12)
  and (.mechanicalFacts.discovery.candidates | any(.path == "src/clock.ts" and .exists == false and (.reasons | index("explicit_path"))))
  and (.mechanicalFacts.discovery.candidates | any(.path == "src/clockSupport.ts" and .exists == true and (.reasons | index("symbol_match"))))
  and (.prompt | contains("\"discovery\":[\"CANDIDATES\",[[\"src/clockSupport.ts\""))
' "${envelope}" >/dev/null

# Discovery is rebuilt locally in the preflight process. It has no model/IDE
# dependency, no separate cache and is deterministic for the same demand/base.
printf '%s' "${demand}" | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --internal-envelope --target src > "${WORK_DIR}/direct-discovery-repeat.json"
jq -S '.mechanicalFacts.discovery' "${envelope}" > "${WORK_DIR}/discovery-a.json"
jq -S '.mechanicalFacts.discovery' "${WORK_DIR}/direct-discovery-repeat.json" > "${WORK_DIR}/discovery-b.json"
cmp "${WORK_DIR}/discovery-a.json" "${WORK_DIR}/discovery-b.json"
[[ ! -e "${WORK_DIR}/direct/.harness/runtime/discovery.json" ]]

# An inferred identifier does not justify a full symbol scan when an explicit,
# tracked file already gives the IDE a strong starting point.
printf '%s' 'Atualize InferredAnchor em `src/existing.ts`.' \
  | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
    --kind PRODUCT --internal-envelope --target src/existing.ts \
    > "${WORK_DIR}/inferred-symbol.json"
jq -e '
  .mechanicalFacts.discovery.coverage.symbolAnchors == 0
  and (.mechanicalFacts.discovery.candidates | any(.path == "src/existing.ts"))
  and (.mechanicalFacts.discovery.candidates | all(.path != "src/inferredOwner.ts"))
' "${WORK_DIR}/inferred-symbol.json" >/dev/null

# A symbol explicitly marked by the user remains authoritative enough for one
# bounded Git search, even when an existing target is already known.
printf '%s' 'Atualize `SharedAnchor` em `src/existing.ts`.' \
  | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
    --kind PRODUCT --internal-envelope --target src/existing.ts \
    > "${WORK_DIR}/explicit-symbol.json"
jq -e '
  .mechanicalFacts.discovery.coverage.symbolAnchors >= 1
  and .mechanicalFacts.discovery.coverage.returnedCandidates == 12
  and (.mechanicalFacts.discovery.candidates | any(.path == "src/shared-anchor-01.ts" and (.reasons | index("symbol_match"))))
  and (.mechanicalFacts.discovery.candidates | all(.path | startswith("src/")))
' "${WORK_DIR}/explicit-symbol.json" >/dev/null

printf '%s' 'Ajuste zqxvbnm.' \
  | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
    --kind PRODUCT --internal-envelope > "${WORK_DIR}/unknown-discovery.json"
jq -e '
  .mechanicalFacts.discovery.status == "UNKNOWN"
  and .mechanicalFacts.discovery.candidates == []
' "${WORK_DIR}/unknown-discovery.json" >/dev/null

printf '%s' 'Atualize `src/space folder/item.ts`.' \
  | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
    --kind PRODUCT --internal-envelope > "${WORK_DIR}/space-path.json"
jq -e '
  .mechanicalFacts.discovery.candidates
  | any(.path == "src/space folder/item.ts" and .exists == true and (.reasons | index("explicit_path")))
' "${WORK_DIR}/space-path.json" >/dev/null

# Path facts are resolved from the frozen Git tree. A tracked symlink is never
# presented as a safe file merely because it exists in the live worktree.
printf '%s' 'Atualize `src/linked-clock.ts`.' \
  | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
    --kind PRODUCT --internal-envelope > "${WORK_DIR}/symlink-path.json"
jq -e '
  .mechanicalFacts.references
  | any(.kind == "path" and .value == "src/linked-clock.ts" and .status == "DISPROVEN" and .evidence == "symlink_not_allowed")
' "${WORK_DIR}/symlink-path.json" >/dev/null

# A large project never turns the layer-zero scan into an unbounded operation.
# It returns INCOMPLETE with explicit limits, leaving semantic investigation to
# the IDE instead of claiming exhaustive discovery.
prepare_repository "${WORK_DIR}/bounded"
mkdir -p "${WORK_DIR}/bounded-bin"
real_git="$(command -v git)"
cat > "${WORK_DIR}/bounded-bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${3:-}" == "ls-tree" ]]; then
  for index in $(seq 1 10001); do printf '100644 blob 0000000000000000000000000000000000000000\tsrc/many/file-%s.ts\0' "${index}"; done
  exit 0
fi
exec "${AEGIS_TEST_REAL_GIT}" "$@"
EOF
chmod +x "${WORK_DIR}/bounded-bin/git"
printf '%s' 'Ajuste zqxvbnm.' | PATH="${WORK_DIR}/bounded-bin:${PATH}" AEGIS_TEST_REAL_GIT="${real_git}" AEGIS_ROOT="${WORK_DIR}/bounded" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --internal-envelope > "${WORK_DIR}/bounded-discovery.json"
jq -e '
  .mechanicalFacts.discovery.status == "INCOMPLETE"
  and .mechanicalFacts.discovery.incompleteReasons == ["tracked_paths_limit"]
  and .mechanicalFacts.discovery.coverage.eligiblePaths >= 10001
  and .mechanicalFacts.discovery.coverage.consideredPaths == 10000
  and .mechanicalFacts.discovery.limits == {maxCandidates:12,maxTrackedPaths:10000,maxSymbolAnchors:8,maxLexicalTerms:64,maxGitBytes:4194304,budgetMs:3000}
' "${WORK_DIR}/bounded-discovery.json" >/dev/null

# The scanner stops the Git producer at the first path beyond its own bound; it
# does not wait for a pathological listing to reach the global deadline.
prepare_repository "${WORK_DIR}/incremental"
mkdir -p "${WORK_DIR}/incremental-bin"
cat > "${WORK_DIR}/incremental-bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${3:-}" == "ls-tree" ]]; then
  for index in $(seq 1 10001); do printf '100644 blob 0000000000000000000000000000000000000000\tsrc/stream/file-%s.ts\0' "${index}"; done
  while :; do :; done
fi
exec "${AEGIS_TEST_REAL_GIT}" "$@"
EOF
chmod +x "${WORK_DIR}/incremental-bin/git"
started_seconds=${SECONDS}
printf '%s' 'Ajuste stream.' | PATH="${WORK_DIR}/incremental-bin:${PATH}" AEGIS_TEST_REAL_GIT="${real_git}" AEGIS_ROOT="${WORK_DIR}/incremental" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --internal-envelope > "${WORK_DIR}/incremental-discovery.json"
((SECONDS - started_seconds < 3))
jq -e '
  .mechanicalFacts.discovery.status == "INCOMPLETE"
  and .mechanicalFacts.discovery.incompleteReasons == ["tracked_paths_limit"]
  and .mechanicalFacts.discovery.coverage.consideredPaths == 10000
' "${WORK_DIR}/incremental-discovery.json" >/dev/null

# An unavailable baseline tree produces unknown facts, never a false claim that
# an explicit path is absent. The semantic compiler can then request IDE help.
prepare_repository "${WORK_DIR}/tree-unavailable"
mkdir -p "${WORK_DIR}/tree-unavailable-bin"
cat > "${WORK_DIR}/tree-unavailable-bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${3:-}" == "ls-tree" ]]; then
  exit 2
fi
exec "${AEGIS_TEST_REAL_GIT}" "$@"
EOF
chmod +x "${WORK_DIR}/tree-unavailable-bin/git"
printf '%s' 'Atualize `src/example.ts`.' \
  | PATH="${WORK_DIR}/tree-unavailable-bin:${PATH}" AEGIS_TEST_REAL_GIT="${real_git}" AEGIS_ROOT="${WORK_DIR}/tree-unavailable" node "${ROOT_DIR}/scripts/preflight.mjs" \
    --kind PRODUCT --internal-envelope > "${WORK_DIR}/tree-unavailable.json"
jq -e '
  .mechanicalFacts.discovery.status == "INCOMPLETE"
  and .mechanicalFacts.discovery.incompleteReasons == ["git_failure"]
  and (.mechanicalFacts.references | any(.kind == "path" and .value == "src/example.ts" and .status == "UNPROVEN" and .evidence == "baseline_tree_incomplete"))
  and (.mechanicalFacts.discovery.candidates | any(.path == "src/example.ts" and .exists == null))
' "${WORK_DIR}/tree-unavailable.json" >/dev/null

node --input-type=module - "${envelope}" "${WORK_DIR}/direct/.harness/runtime/blocked.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [envelopePath, destination] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
writeFileSync(destination, JSON.stringify({
  schema: 'aegis.preflight_decision.v2',
  contextDigest: envelope.contextDigest,
  promptDigest: envelope.promptDigest,
  status: 'BLOCKED',
  rules: envelope.architecture.candidateRules.map((rule) => [rule.id, 'NOT_APPLICABLE', 'Sem decisão executável.', []]),
  questions: [],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/blocked.json < "${envelope}" > "${WORK_DIR}/direct/.harness/runtime/blocked-result.json"
jq -e '.status == "BLOCKED"' "${WORK_DIR}/direct/.harness/runtime/blocked-result.json" >/dev/null

write_decision "${envelope}" "${WORK_DIR}/direct/.harness/runtime/decision.json"
AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/build_preflight_review.mjs" \
  --decision .harness/runtime/decision.json --producer-id producer --reviewer-id reviewer \
  < "${envelope}" > "${WORK_DIR}/review-request.json"
jq -e --arg execution "$(jq -r '.executionId' "${envelope}")" '
  .schema == "aegis.preflight_review_request.v2"
  and .producerId == "producer"
  and .reviewerId == "reviewer"
  and .producerExecutionId == $execution
  and (.reviewExecutionId | test("^[a-f0-9]{64}$"))
  and (.reviewRequestDigest | test("^[a-f0-9]{64}$"))
' \
  "${WORK_DIR}/review-request.json" >/dev/null
node --input-type=module - "${WORK_DIR}/direct/.harness/runtime/decision.json" "${envelope}" "${WORK_DIR}/direct/.harness/runtime/preflight_review_request.json" "${WORK_DIR}/direct/.harness/runtime/review.json" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, envelopePath, requestPath, reviewPath] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
writeFileSync(reviewPath, JSON.stringify({
  schema: 'aegis.preflight_review.v2',
  normalizedDemandDigest: envelope.normalizedDemand.digest,
  decisionDigest: digest(readFileSync(decisionPath)),
  producerId: request.producerId,
  reviewerId: request.reviewerId,
  producerExecutionId: request.producerExecutionId,
  reviewExecutionId: request.reviewExecutionId,
  reviewRequestDigest: request.reviewRequestDigest,
  verdict: 'APPROVED',
  findings: [],
  stateSemantics: [],
  governanceAssessment: [],
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
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and .changeKind == "PRODUCT" and (.proofRegistryDigest | test("^[a-f0-9]{64}$")) and (.semanticStateDigest | test("^[a-f0-9]{64}$")) and (.semantic.reconciler == "structural_reconciliation.v2") and (.semantic.decisionArtifactBytesDigest | test("^[a-f0-9]{64}$"))' \
  "${WORK_DIR}/direct/.harness/runtime/result.json" >/dev/null
jq -e '.schema == "aegis.semantic_state.v1" and .contract.changeKind == "PRODUCT" and .contract.scope.authorizedPaths == ["src/clock.ts", "src/clock.proof.ts", "src/.aegis/semantic-state.json"] and .proofRegistry.proofs[0].executor == "node" and .proofRegistry.proofs[0].argv == ["--import", "tsx", "src/clock.proof.ts"] and .proofRegistry.proofs[0].targets == ["src/clock.ts", "src/clock.proof.ts"] and .contract.verification.riskProfile == "standard" and .contract.stateModel == {kind:"NONE",bindings:[],policies:[]}' \
  "${WORK_DIR}/direct/src/.aegis/semantic-state.json" >/dev/null
git -C "${WORK_DIR}/direct" add src/.aegis/semantic-state.json
git -C "${WORK_DIR}/direct" commit -qm 'persist semantic state'
printf 'Evoluir o relógio existente.\n' | AEGIS_ROOT="${WORK_DIR}/direct" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --save-envelope > /dev/null
jq -e '.previousContract != null and (.previousContractDigest | test("^[a-f0-9]{64}$"))' \
  "${WORK_DIR}/direct/.harness/runtime/preflight_envelope.json" >/dev/null
printf 'export const clock = 0n;\n' > "${WORK_DIR}/direct/src/clock.ts"
printf 'export {};\n' > "${WORK_DIR}/direct/src/clock.proof.ts"
git -C "${WORK_DIR}/direct" add src
AEGIS_ROOT_DIR="${WORK_DIR}/direct" bash "${ROOT_DIR}/scripts/contract_evidence_gate.sh" --staged

forensic_demand=$'O estado é uma tabela explícita de entidades.\nCada comando possui identidade única e campos completos.\nIdentidades externas são chaves opacas e entidades inativas são rejeitadas.\nCada custo consome somente capacidade e cada valor transfere saldo entre origem e destino.\nO instante é entrada explícita; igualdade não refila e regressão aborta.\nO resultado contém uma decisão por comando e agregados são a soma das decisões aceitas.\nTodos os passos falíveis ocorrem antes de publicar o estado projetado.\nA representação canônica ordena chaves por code units e cobre comandos, decisões e estado final.\n'
prepare_repository "${WORK_DIR}/forensic"
printf '%s' "${forensic_demand}" \
  | AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/preflight.mjs" --kind PRODUCT --save-envelope > /dev/null
forensic_envelope="${WORK_DIR}/forensic/.harness/runtime/preflight_envelope.json"
node --input-type=module - "${forensic_envelope}" "${WORK_DIR}/forensic/.harness/runtime/decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [envelopePath, destination] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const units = envelope.normalizedDemand.units.map((_, index) => index);
const bindings = [
  ['STATE', 'O estado é explícito e observável.', [0], [0]],
  ['COMMAND', 'Cada comando produz uma transição definida.', [0], [1]],
  ['IDENTITY', 'Identificadores externos são dados opacos.', [0], [2]],
  ['RESOURCE', 'Recursos são contabilizados no estado projetado.', [0], [3]],
  ['TEMPORAL', 'O tempo é entrada explícita da transição.', [0], [4]],
  ['RESULT', 'O resultado representa cada decisão e seus agregados.', [0], [5]],
  ['ATOMICITY', 'O estado só é publicado depois de todos os passos falíveis.', [0], [6]],
  ['CANONICALIZATION', 'A representação canônica vincula os observáveis declarados.', [0], [7]],
];
writeFileSync(destination, JSON.stringify({
  schema: 'aegis.preflight_decision.v2',
  contextDigest: envelope.contextDigest,
  promptDigest: envelope.promptDigest,
  status: 'NEEDS_CONFIRMATION',
  rules: envelope.architecture.candidateRules.map((rule) => [rule.id, 'APPLIED', 'A regra se aplica à transição.', units]),
  questions: [['DEMAND', 'Confirmar o contrato forense antes da promoção?', 'A transição combina estado, identidade, recursos, tempo, resultado, atomicidade e canonicalização.', 'Exige confirmação humana para a interpretação forense.', 'CONFIRM_FORENSIC', 'A interpretação forense será promovida somente após confirmação explícita.', units, [
    ['CONFIRM_FORENSIC', 'Confirmar contrato forense', 'Autoriza a promoção após a revisão independente.', 'A interpretação forense foi confirmada pelo operador.', [], {}],
    ['REJECT_FORENSIC', 'Não promover', 'Interrompe a demanda para nova formulação.', 'A interpretação forense não foi aprovada e deve ser revisada.', [], {}],
  ]]],
  riskProfile: 'forensic',
  stateModel: { kind: 'STATE_TRANSITION', bindings, governance: {
    authoritativeState: ['A tabela de entidades é o único estado autoritativo.', [0, 1]],
    publicationAuthorities: [['process', 'TRANSITION', 'Somente process publica a tabela projetada após validação.', [1]]],
    publicationBoundary: ['A troca da tabela projetada ocorre depois de resultado, digest e invariantes.', [1]],
    derivedObservables: [['acceptedCount', 'decisions.status', 'count(status == committed)', [1]]],
    digestIdentity: ['TRANSITION_IDENTITY', ['initialState', 'commands', 'time', 'finalState', 'result'], [1]],
  } },
  stateSemantics: bindings.map(([role, , , sourceIndexes]) => [role, 'EXPLICIT', envelope.normalizedDemand.units[sourceIndexes[0]].text.trim(), sourceIndexes]),
  intent: 'Processar transição de estado forense.',
  scope: ['src/state.ts', 'src/state.proof.ts'],
  excluded: [],
  requirements: [['Processar transição atômica, temporal e observável.', 'USER', units]],
  contextUnits: [],
  acceptance: ['A transição é verificável.'],
  failures: [['Falha de transição', 'Estado anterior preservado.', [0]]],
  behaviors: [['A transição é observável.', [0]]],
  preconditions: [['A entrada é válida.', [0]]],
  invariants: [['Estado e resultado permanecem consistentes.', [0], [0, 1]]],
  postconditions: [['A publicação é atômica.', [0]]],
  proofs: [
    ['state.behavior', 'Transição básica incorreta', 'Provar comportamento básico.', [0], 'src/state.proof.ts', ['src/state.ts'], 'low', 'always'],
    ['state.adversarial', 'Interação adversarial entre estado e resultado', 'Provar composição, identidade e rollback.', [0], 'src/state.proof.ts', ['src/state.ts'], 'high', 'forensic'],
  ],
  continuity: { retirements: [], proofChanges: [] },
}));
NODE
AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json < "${forensic_envelope}" > "${WORK_DIR}/forensic/.harness/runtime/questions.json"
jq -e '.status == "USER_CONFIRMATION_REQUIRED" and (.questions | length == 1)' \
  "${WORK_DIR}/forensic/.harness/runtime/questions.json" >/dev/null
# A forensic contract with no user choice must stop here even when every
# policy appears literal. This prevents a producer/reviewer pair from merely
# copying demand text and silently promoting an interpretation.
jq '.status = "CLARIFIED" | .questions = []' "${WORK_DIR}/forensic/.harness/runtime/decision.json" \
  > "${WORK_DIR}/forensic/.harness/runtime/unconfirmed-forensic.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/unconfirmed-forensic.json < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/unconfirmed-forensic.err"; then
  echo 'forensic contract was accepted without user confirmation' >&2
  exit 1
fi
grep -q 'forensic_user_confirmation_required' "${WORK_DIR}/forensic/.harness/runtime/unconfirmed-forensic.err"
node --input-type=module - "${WORK_DIR}/forensic/.harness/runtime/decision.json" "${forensic_envelope}" "${WORK_DIR}/forensic/.harness/runtime/resolution.json" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, envelopePath, resolutionPath] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
writeFileSync(resolutionPath, JSON.stringify({
  schema: 'aegis.preflight_resolution.v2',
  decisionDigest: createHash('sha256').update(readFileSync(decisionPath)).digest('hex'),
  preflightPromptDigest: envelope.promptDigest,
  confirmation: {
    channel: 'IDE_NATIVE_SELECTOR',
    confirmationId: createHash('sha256').update(['aegis.native_confirmation.v1', envelope.executionId, createHash('sha256').update(readFileSync(decisionPath)).digest('hex'), envelope.promptDigest].join('\n')).digest('hex'),
    selectedAtEpochMs: envelope.timing.startedAtEpochMs + 1,
  },
  answers: [{ questionId: 'Q-0001', action: 'SELECT_ANSWER', answerId: 'CONFIRM_FORENSIC' }],
}));
NODE
jq '.confirmation.confirmationId = ("0" * 64)' "${WORK_DIR}/forensic/.harness/runtime/resolution.json" \
  > "${WORK_DIR}/forensic/.harness/runtime/forged-resolution.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/forged-resolution.json \
  < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/forged-resolution.err"; then
  echo 'forged native confirmation was accepted' >&2
  exit 1
fi
grep -q 'native_confirmation_receipt_invalid' "${WORK_DIR}/forensic/.harness/runtime/forged-resolution.err"
jq '.riskProfile = "standard"' "${WORK_DIR}/forensic/.harness/runtime/decision.json" > "${WORK_DIR}/forensic/.harness/runtime/non-forensic.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/non-forensic.json < "${forensic_envelope}" > /dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/non-forensic.err"; then
  echo 'high-risk state transition was accepted outside forensic profile' >&2
  exit 1
fi
grep -q 'state_transition_requires_forensic' "${WORK_DIR}/forensic/.harness/runtime/non-forensic.err"
# A transition without an explicit publication model cannot be promoted merely
# because its broad state roles look complete.
jq 'del(.stateModel.governance)' "${WORK_DIR}/forensic/.harness/runtime/decision.json" > "${WORK_DIR}/forensic/.harness/runtime/missing-governance.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/missing-governance.json < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/missing-governance.err"; then
  echo 'state transition without governance was accepted' >&2
  exit 1
fi
grep -q 'malformed_decision' "${WORK_DIR}/forensic/.harness/runtime/missing-governance.err"
AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/build_preflight_review.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --producer-id producer --reviewer-id reviewer \
  < "${forensic_envelope}" > "${WORK_DIR}/forensic/.harness/runtime/review-request.json"
node --input-type=module - "${WORK_DIR}/forensic/.harness/runtime/decision.json" "${forensic_envelope}" "${WORK_DIR}/forensic/.harness/runtime/preflight_review_request.json" "${WORK_DIR}/forensic/.harness/runtime/review.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, envelopePath, requestPath, reviewPath] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
writeFileSync(reviewPath, JSON.stringify({
  schema: 'aegis.preflight_review.v2',
  normalizedDemandDigest: envelope.normalizedDemand.digest,
  decisionDigest: request.decisionDigest,
  producerId: request.producerId,
  reviewerId: request.reviewerId,
  producerExecutionId: request.producerExecutionId,
  reviewExecutionId: request.reviewExecutionId,
  reviewRequestDigest: request.reviewRequestDigest,
  verdict: 'APPROVED',
  findings: [],
  stateSemantics: envelope.normalizedDemand.units.length === 0 ? [] : decision.stateSemantics.map(([role, , statement]) => [role, 'EXPLICIT', statement, envelope.normalizedDemand.units.map((unit) => unit.id)]),
  governanceAssessment: [
    ['AUTHORITATIVE_STATE', 'COVERED', 'O estado autoritativo e sua prova foram declarados.'],
    ['PUBLICATION_AUTHORITIES', 'COVERED', 'A única autoridade de publicação foi declarada.'],
    ['PUBLICATION_BOUNDARY', 'COVERED', 'A publicação ocorre depois das etapas falíveis.'],
    ['DERIVED_OBSERVABLES', 'COVERED', 'O agregado observável possui derivação e prova.'],
    ['DIGEST_IDENTITY', 'COVERED', 'O digest declara propósito, cobertura e prova.'],
  ],
}));
NODE
# A transition cannot be marked clarified while any state policy still needs a
# user decision. This prevents a plausible-looking contract from inventing
# observable behavior (fees, eligibility, clock, rollback or digest semantics).
cp "${WORK_DIR}/forensic/.harness/runtime/decision.json" "${WORK_DIR}/forensic/.harness/runtime/semantic-gap.json"
node --input-type=module - "${WORK_DIR}/forensic/.harness/runtime/semantic-gap.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const decision = JSON.parse(readFileSync(path, 'utf8'));
decision.stateSemantics[0][1] = 'QUESTION_REQUIRED';
decision.status = 'CLARIFIED';
decision.questions = [];
writeFileSync(path, JSON.stringify(decision));
NODE
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/semantic-gap.json < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/semantic-gap.err"; then
  echo 'clarified transition accepted an unresolved semantic policy' >&2
  exit 1
fi
grep -Eq 'state_semantics_question_missing|clarified_state_semantics_not_explicit' "${WORK_DIR}/forensic/.harness/runtime/semantic-gap.err" || {
  cat "${WORK_DIR}/forensic/.harness/runtime/semantic-gap.err" >&2
  exit 1
}

# A state-policy label must contain a real policy, not merely repeat its role
# binding. This is the mechanical floor that prevents a plausible contract
# from treating an unresolved business choice as explicit.
cp "${WORK_DIR}/forensic/.harness/runtime/decision.json" "${WORK_DIR}/forensic/.harness/runtime/unrefined-policy.json"
node --input-type=module - "${WORK_DIR}/forensic/.harness/runtime/unrefined-policy.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const decision = JSON.parse(readFileSync(path, 'utf8'));
decision.stateSemantics[0][2] = decision.stateModel.bindings[0][1];
writeFileSync(path, JSON.stringify(decision));
NODE
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/unrefined-policy.json < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/unrefined-policy.err"; then
  echo 'transition accepted an unrefined state policy' >&2
  exit 1
fi
grep -q 'state_semantics_policy_not_refined:state' "${WORK_DIR}/forensic/.harness/runtime/unrefined-policy.err"

# A policy cannot smuggle an implementation decision behind a generic source
# reference. The earlier batch-engine demand failed exactly this way.
cp "${WORK_DIR}/forensic/.harness/runtime/decision.json" "${WORK_DIR}/forensic/.harness/runtime/invented-policy.json"
node --input-type=module - "${WORK_DIR}/forensic/.harness/runtime/invented-policy.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const decision = JSON.parse(readFileSync(path, 'utf8'));
decision.stateSemantics[3][2] = 'O custo consome capacidade e também é deduzido do saldo.';
writeFileSync(path, JSON.stringify(decision));
NODE
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/invented-policy.json < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/invented-policy.err"; then
  echo 'transition accepted an invented state policy' >&2
  exit 1
fi
grep -q 'state_semantics_policy_not_verbatim:resource' "${WORK_DIR}/forensic/.harness/runtime/invented-policy.err"

# A reviewer must inspect every declared semantic role; a generic APPROVED is
# not evidence for a high-risk transition.
jq '.stateSemantics = []' "${WORK_DIR}/forensic/.harness/runtime/review.json" > "${WORK_DIR}/forensic/.harness/runtime/incomplete-review.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --independent-review .harness/runtime/incomplete-review.json \
  < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/incomplete-review.err"; then
  echo 'forensic transition accepted a review without semantic-role coverage' >&2
  exit 1
fi
grep -q 'review_state_semantics_incomplete' "${WORK_DIR}/forensic/.harness/runtime/incomplete-review.err"

# An approval must explicitly cover authority, publication, projections and
# digest identity; a generic semantic-role approval is insufficient.
jq '.governanceAssessment = []' "${WORK_DIR}/forensic/.harness/runtime/review.json" > "${WORK_DIR}/forensic/.harness/runtime/incomplete-governance-review.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --independent-review .harness/runtime/incomplete-governance-review.json \
  < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/incomplete-governance-review.err"; then
  echo 'forensic transition accepted a review without transition governance' >&2
  exit 1
fi
grep -q 'review_transition_governance_incomplete' "${WORK_DIR}/forensic/.harness/runtime/incomplete-governance-review.err"

jq '.stateSemantics[0][1] = "QUESTION_REQUIRED"' "${WORK_DIR}/forensic/.harness/runtime/review.json" > "${WORK_DIR}/forensic/.harness/runtime/mismatched-review.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --independent-review .harness/runtime/mismatched-review.json \
  < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/mismatched-review.err"; then
  echo 'forensic transition accepted a semantic review that disagrees with its decision' >&2
  exit 1
fi
grep -q 'review_state_semantics_mismatch' "${WORK_DIR}/forensic/.harness/runtime/mismatched-review.err"

jq '.stateSemantics[0][2] = "A demanda determina esta política."' "${WORK_DIR}/forensic/.harness/runtime/review.json" > "${WORK_DIR}/forensic/.harness/runtime/paraphrased-review.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --independent-review .harness/runtime/paraphrased-review.json \
  < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/paraphrased-review.err"; then
  echo 'forensic transition accepted a paraphrased review evidence' >&2
  exit 1
fi
grep -q 'review_state_semantics_evidence_mismatch:state' "${WORK_DIR}/forensic/.harness/runtime/paraphrased-review.err"

# A review cannot be replayed or relabelled as another review execution.
jq '.reviewExecutionId = ("0" * 64)' "${WORK_DIR}/forensic/.harness/runtime/review.json" > "${WORK_DIR}/forensic/.harness/runtime/unbound-review.json"
if AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --independent-review .harness/runtime/unbound-review.json \
  < "${forensic_envelope}" >/dev/null 2> "${WORK_DIR}/forensic/.harness/runtime/unbound-review.err"; then
  echo 'forensic transition accepted an unbound review execution' >&2
  exit 1
fi
grep -q 'review_request_binding_mismatch' "${WORK_DIR}/forensic/.harness/runtime/unbound-review.err"
AEGIS_ROOT="${WORK_DIR}/forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json --independent-review .harness/runtime/review.json \
  < "${forensic_envelope}" > "${WORK_DIR}/forensic/.harness/runtime/result.json"
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and (.semantic.independentReviewDigest | test("^[a-f0-9]{64}$"))' \
  "${WORK_DIR}/forensic/.harness/runtime/result.json" >/dev/null
jq -e '.contract.verification.riskProfile == "forensic" and (.contract.verification.independentReviewDigest | test("^[a-f0-9]{64}$")) and .contract.verification.adversarialClasses == ["CONTINUITY","COMPOSITION","IDENTITY","BOUNDARIES","TIME","OBSERVABILITY","ATOMICITY"] and (.contract.stateModel.bindings | length == 8) and (.contract.stateModel.policies | length == 8) and (.contract.stateModel.governance.publicationAuthorities | length == 1) and .contract.stateModel.governance.digestIdentity.purpose == "TRANSITION_IDENTITY" and (.contract.stateModel.policies | all(.provenance == "USER"))' \
  "${WORK_DIR}/forensic/src/.aegis/semantic-state.json" >/dev/null
forensic_profile="$(jq '.proofRegistry' "${WORK_DIR}/forensic/src/.aegis/semantic-state.json" > "${WORK_DIR}/forensic/.harness/runtime/proof-registry.json"; AEGIS_ROOT_DIR="${WORK_DIR}/forensic" bash -c "source '${ROOT_DIR}/scripts/lib/proof_governance.sh'; aegis_proof_profile_for_change '${WORK_DIR}/forensic/.harness/runtime/proof-registry.json' 'src/state.ts'")"
printf '%s' "${forensic_profile}" | jq -e '.profile == "forensic"' >/dev/null

prepare_repository "${WORK_DIR}/confirm"
printf 'Criar src/clock.ts.\n' | AEGIS_ROOT="${WORK_DIR}/confirm" node "${ROOT_DIR}/scripts/preflight.mjs" \
  --kind PRODUCT --save-envelope --internal-envelope > "${WORK_DIR}/confirm-envelope-copy.json"
confirm_envelope="${WORK_DIR}/confirm/.harness/runtime/preflight_envelope.json"
write_decision "${confirm_envelope}" "${WORK_DIR}/confirm/.harness/runtime/decision.json" NEEDS_CONFIRMATION
node --input-type=module - "${WORK_DIR}/confirm/.harness/runtime/decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const { assertSchema } = await import(process.cwd() + '/scripts/lib/schema_validator.mjs');
const path = process.argv[2];
const decision = JSON.parse(readFileSync(path, 'utf8'));
decision.questions[0][0] = 'DEMAND';
for (let index = 2; index <= 4; index += 1) {
  const question = JSON.parse(JSON.stringify(decision.questions[0]));
  question[1] = `Decisão independente ${index}`;
  decision.questions.push(question);
}
assertSchema('aegis.preflight_decision.v2', decision);
decision.questions = [decision.questions[0]];
writeFileSync(path, JSON.stringify(decision));
NODE
AEGIS_ROOT="${WORK_DIR}/confirm" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json < "${confirm_envelope}" > "${WORK_DIR}/confirm/.harness/runtime/questions.json"
jq -e '.status == "USER_CONFIRMATION_REQUIRED" and .questions == [{id:"Q-0001",scope:"DEMAND",question:"Manter somente src/clock.ts?",evidence:"A demanda nomeia esse caminho.",impact:"Define o escopo.",interpreted:"Somente src/clock.ts e sua prova.",recommendedAnswerId:"KEEP_SCOPE",answers:[{id:"KEEP_SCOPE",label:"Manter escopo mínimo",rationale:"Preserva a menor entrega compatível.",resolutionClause:"O escopo fica limitado a src/clock.ts e sua prova.",contractPatchDigest:(.questions[0].answers[0].contractPatchDigest),recommended:true},{id:"EXPAND_SCOPE",label:"Ampliar escopo",rationale:"Autoriza arquivos adicionais quando necessário.",resolutionClause:"O escopo pode incluir arquivos adicionais explicitamente aprovados.",contractPatchDigest:(.questions[0].answers[1].contractPatchDigest),recommended:false}]}] and (.questions[0].answers | all(.contractPatchDigest | test("^[a-f0-9]{64}$")))' \
  "${WORK_DIR}/confirm/.harness/runtime/questions.json" >/dev/null
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
  confirmation: {
    channel: 'IDE_NATIVE_SELECTOR',
    confirmationId: createHash('sha256').update(['aegis.native_confirmation.v1', envelope.executionId, digest(readFileSync(decisionPath)), envelope.promptDigest].join('\n')).digest('hex'),
    selectedAtEpochMs: envelope.timing.startedAtEpochMs + 1,
  },
  answers: [{ questionId: 'Q-0001', action: 'SELECT_ANSWER', answerId: 'KEEP_SCOPE' }],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/confirm" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  < "${confirm_envelope}" > "${WORK_DIR}/confirm/.harness/runtime/result.json"
jq -e '.interpretationStatus == "INTERPRETATION_CONFIRMED"' "${WORK_DIR}/confirm/.harness/runtime/result.json" >/dev/null
jq -e '.clarifiedDemand.clarifications == [{questionId:"Q-0001",answerId:"KEEP_SCOPE",recommended:true,statement:"O escopo fica limitado a src/clock.ts e sua prova."}] and .contract.clarifications == .clarifiedDemand.clarifications' \
  "${WORK_DIR}/confirm/src/.aegis/semantic-state.json" >/dev/null

# A coupled ambiguity is one question, not a Cartesian product of separate
# selections. Its alternatives resolve every linked policy atomically; the
# forensic reviewer receives and attests that resolved candidate.
prepare_repository "${WORK_DIR}/selected-forensic"
printf '%s' "${forensic_demand}" \
  | AEGIS_ROOT="${WORK_DIR}/selected-forensic" node "${ROOT_DIR}/scripts/preflight.mjs" --kind PRODUCT --save-envelope > /dev/null
selected_envelope="${WORK_DIR}/selected-forensic/.harness/runtime/preflight_envelope.json"
node --input-type=module - "${WORK_DIR}/forensic/.harness/runtime/decision.json" "${selected_envelope}" "${WORK_DIR}/selected-forensic/.harness/runtime/decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [sourcePath, envelopePath, destination] = process.argv.slice(2);
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
source.contextDigest = envelope.contextDigest;
source.promptDigest = envelope.promptDigest;
source.status = 'NEEDS_CONFIRMATION';
source.stateSemantics = source.stateSemantics.map((entry) => (
  ['RESOURCE', 'TEMPORAL'].includes(entry[0]) ? [entry[0], 'QUESTION_REQUIRED', entry[2], entry[3]] : entry
));
const units = envelope.normalizedDemand.units.map((_, index) => index);
const capacityGovernance = {
  ...source.stateModel.governance,
  derivedObservables: [['acceptedCount', 'decisions.status', 'count(status == committed)', [1]]],
};
const feeGovernance = {
  ...source.stateModel.governance,
  derivedObservables: [['feeTotal', 'committed decisions', 'sum(cost for committed decisions)', [1]]],
};
// These provisional clauses deliberately conflict. Selection must replace,
// not append to, their policy roles.
source.behaviors.push(
  ['cost é débito financeiro implícito.', [0], ['RESOURCE']],
  ['o relógio pode usar a hora ambiente.', [0], ['TEMPORAL']],
);
source.questions = [[
  'DEMAND',
  'Qual política conjunta governa recurso consumido e tempo?',
  'A transição precisa definir, em conjunto, o consumo de capacidade e o relógio que o contabiliza.',
  'Define conservação observável, temporalidade e provas do lote.',
  'EXPLICIT_CAPACITY_TIME',
  'Interpretado: cost consome somente capacidade e now é entrada explícita, sem débito financeiro implícito.',
  units,
  [
    ['EXPLICIT_CAPACITY_TIME', 'Capacidade com tempo explícito', 'Preserva a menor semântica sem taxa financeira ou relógio implícito.', 'cost consome somente capacidade; amount é o único débito financeiro; now é entrada explícita e não pode regredir.', [['RESOURCE', 'cost consome somente capacidade; amount é o único débito financeiro.'], ['TEMPORAL', 'now é entrada explícita e não pode regredir.']], {replacesPolicyRoles: ['RESOURCE', 'TEMPORAL'], behaviors: [['cost consome somente capacidade; amount é o único débito financeiro.', [0], ['RESOURCE']], ['now é entrada explícita e não pode regredir.', [0], ['TEMPORAL']]], stateModelGovernance: capacityGovernance}],
    ['FINANCIAL_FEE_TIME', 'Taxa financeira com tempo explícito', 'Exige destino rastreável para a taxa e a mesma política temporal explícita.', 'cost é taxa financeira com destino rastreável e conservação explícita; now é entrada explícita e não pode regredir.', [['RESOURCE', 'cost é taxa financeira com destino rastreável e conservação explícita.'], ['TEMPORAL', 'now é entrada explícita e não pode regredir.']], {replacesPolicyRoles: ['RESOURCE', 'TEMPORAL'], behaviors: [['cost é taxa financeira com destino rastreável e conservação explícita.', [0], ['RESOURCE']], ['now é entrada explícita e não pode regredir.', [0], ['TEMPORAL']]], stateModelGovernance: feeGovernance}],
  ],
]];
writeFileSync(destination, JSON.stringify(source));
NODE
# A selectable policy may not be a cosmetic label. Every state-policy answer
# must carry the precompiled clauses that become authoritative on selection.
node --input-type=module - "${WORK_DIR}/selected-forensic/.harness/runtime/decision.json" "${WORK_DIR}/selected-forensic/.harness/runtime/missing-patch.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [sourcePath, destination] = process.argv.slice(2);
const decision = JSON.parse(readFileSync(sourcePath, 'utf8'));
decision.questions[0][7][0][5] = {};
writeFileSync(destination, JSON.stringify(decision));
NODE
if AEGIS_ROOT="${WORK_DIR}/selected-forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/missing-patch.json < "${selected_envelope}" >/dev/null 2> "${WORK_DIR}/selected-forensic/.harness/runtime/missing-patch.err"; then
  echo 'state-policy answer without a contract patch was accepted' >&2
  exit 1
fi
grep -q 'question_answer_contract_patch_missing' "${WORK_DIR}/selected-forensic/.harness/runtime/missing-patch.err"
node --input-type=module - "${WORK_DIR}/selected-forensic/.harness/runtime/decision.json" "${selected_envelope}" "${WORK_DIR}/selected-forensic/.harness/runtime/resolution.json" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, envelopePath, resolutionPath] = process.argv.slice(2);
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
writeFileSync(resolutionPath, JSON.stringify({
  schema: 'aegis.preflight_resolution.v2',
  decisionDigest: createHash('sha256').update(readFileSync(decisionPath)).digest('hex'),
  preflightPromptDigest: envelope.promptDigest,
  confirmation: {
    channel: 'IDE_NATIVE_SELECTOR',
    confirmationId: createHash('sha256').update(['aegis.native_confirmation.v1', envelope.executionId, createHash('sha256').update(readFileSync(decisionPath)).digest('hex'), envelope.promptDigest].join('\n')).digest('hex'),
    selectedAtEpochMs: envelope.timing.startedAtEpochMs + 1,
  },
  answers: [{ questionId: 'Q-0001', action: 'SELECT_ANSWER', answerId: 'EXPLICIT_CAPACITY_TIME' }],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/selected-forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  < "${selected_envelope}" > "${WORK_DIR}/selected-forensic/.harness/runtime/missing-review.json"
jq -e '.status == "INDEPENDENT_REVIEW_REQUIRED" and .interpretationStatus == "INTERPRETATION_CONFIRMED"' \
  "${WORK_DIR}/selected-forensic/.harness/runtime/missing-review.json" >/dev/null
AEGIS_ROOT="${WORK_DIR}/selected-forensic" node "${ROOT_DIR}/scripts/build_preflight_review.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  --producer-id producer --reviewer-id reviewer < "${selected_envelope}" > "${WORK_DIR}/selected-forensic/.harness/runtime/review-request.json"
node --input-type=module - "${WORK_DIR}/selected-forensic/.harness/runtime/decision.json" "${WORK_DIR}/selected-forensic/.harness/runtime/review-request.json" "${selected_envelope}" "${WORK_DIR}/selected-forensic/.harness/runtime/review.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [decisionPath, requestPath, envelopePath, reviewPath] = process.argv.slice(2);
const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const policies = new Map(decision.stateSemantics.map(([role, , statement]) => [role, statement]));
for (const [role, statement] of decision.questions[0][7][0][4]) policies.set(role, statement);
writeFileSync(reviewPath, JSON.stringify({
  schema: 'aegis.preflight_review.v2',
  normalizedDemandDigest: envelope.normalizedDemand.digest,
  decisionDigest: request.decisionDigest,
  producerId: request.producerId,
  reviewerId: request.reviewerId,
  producerExecutionId: request.producerExecutionId,
  reviewExecutionId: request.reviewExecutionId,
  reviewRequestDigest: request.reviewRequestDigest,
  verdict: 'APPROVED',
  findings: [],
  stateSemantics: ['STATE', 'COMMAND', 'IDENTITY', 'RESOURCE', 'TEMPORAL', 'RESULT', 'ATOMICITY', 'CANONICALIZATION']
    .map((role) => [role, 'EXPLICIT', policies.get(role), envelope.normalizedDemand.units.map((unit) => unit.id)]),
  governanceAssessment: [
    ['AUTHORITATIVE_STATE', 'COVERED', 'O estado autoritativo e sua prova foram declarados.'],
    ['PUBLICATION_AUTHORITIES', 'COVERED', 'A única autoridade de publicação foi declarada.'],
    ['PUBLICATION_BOUNDARY', 'COVERED', 'A publicação ocorre depois das etapas falíveis.'],
    ['DERIVED_OBSERVABLES', 'COVERED', 'O agregado observável possui derivação e prova.'],
    ['DIGEST_IDENTITY', 'COVERED', 'O digest declara propósito, cobertura e prova.'],
  ],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/selected-forensic" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  --independent-review .harness/runtime/review.json < "${selected_envelope}" \
  > "${WORK_DIR}/selected-forensic/.harness/runtime/result.json"
jq -e '.contract.clarifications == [{questionId:"Q-0001",answerId:"EXPLICIT_CAPACITY_TIME",recommended:true,statement:"cost consome somente capacidade; amount é o único débito financeiro; now é entrada explícita e não pode regredir."}] and ([.contract.stateModel.policies[] | select((.role == "RESOURCE" or .role == "TEMPORAL") and .provenance == "USER_CLARIFICATION")] | length == 2) and .contract.stateModel.governance.derivedObservables == [{name:"acceptedCount",sourceOfTruth:"decisions.status",derivation:"count(status == committed)",proofIds:["PO-STATE-ADVERSARIAL"]}] and ([.contract.behavior[].statement] | index("cost consome somente capacidade; amount é o único débito financeiro.")) and ([.contract.behavior[].statement] | index("cost é débito financeiro implícito.") | not) and ([.contract.behavior[].statement] | index("o relógio pode usar a hora ambiente.") | not)' \
  "${WORK_DIR}/selected-forensic/src/.aegis/semantic-state.json" >/dev/null

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
  promptDigest: envelope.promptDigest,
  status: 'CLARIFIED',
  rules: envelope.architecture.candidateRules.map((rule) => [
    rule.id,
    rule.id === 'ARCH-DETERMINISTIC-TIME' ? 'APPLIED' : 'NOT_APPLICABLE',
    'A regra foi considerada.',
    rule.id === 'ARCH-DETERMINISTIC-TIME' ? allUnits : [],
  ]),
  questions: [],
  riskProfile: 'standard',
  stateModel: { kind: 'NONE', bindings: [] },
  stateSemantics: [],
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
jq -e '.status == "SEMANTIC_REVISION_REQUIRED" and ([.corrections[].code] | index("hard_reference_requires_confirmation")) and ([.corrections[].code] | index("user_requirement_introduces_identifier") | not)' \
  "${WORK_DIR}/hard-signal/.harness/runtime/revision.json" >/dev/null
node --input-type=module - "${WORK_DIR}/hard-signal/.harness/runtime/decision.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const decision = JSON.parse(readFileSync(path, 'utf8'));
decision.status = 'NEEDS_CONFIRMATION';
decision.requirements[0][1] = 'ARCHITECTURE_DEFAULT';
decision.questions = [['ARCHITECTURE', 'A demanda pede Date.now(), mas a arquitetura exige tempo explícito. Confirmar initialTime e now?', 'Date.now foi detectado.', 'Altera a API pública.', 'EXPLICIT_TIME', 'Interpretado: substituir Date.now por parâmetros explícitos.', decision.requirements[0][2], [
  ['EXPLICIT_TIME', 'Usar tempo explícito', 'Preserva determinismo arquitetural.', 'A API recebe initialTime e now explícitos.', [], {}],
  ['REQUEST_AMENDMENT', 'Solicitar emenda', 'Mantém Date.now somente com exceção formal.', 'A mudança depende de emenda arquitetural aprovada.', [], {}],
]]];
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
  confirmation: {
    channel: 'IDE_NATIVE_SELECTOR',
    confirmationId: createHash('sha256').update(['aegis.native_confirmation.v1', envelope.executionId, digest(readFileSync(decisionPath)), envelope.promptDigest].join('\n')).digest('hex'),
    selectedAtEpochMs: envelope.timing.startedAtEpochMs + 1,
  },
  answers: [{ questionId: 'Q-0001', action: 'SELECT_ANSWER', answerId: 'EXPLICIT_TIME' }],
}));
NODE
AEGIS_ROOT="${WORK_DIR}/hard-signal" node "${ROOT_DIR}/scripts/finalize_preflight.mjs" \
  --decision .harness/runtime/decision.json --resolution .harness/runtime/resolution.json \
  < "${hard_envelope}" > "${WORK_DIR}/hard-signal/.harness/runtime/result.json"
jq -e '.status == "SEMANTIC_STATE_PERSISTED" and .interpretationStatus == "INTERPRETATION_CONFIRMED"' \
  "${WORK_DIR}/hard-signal/.harness/runtime/result.json" >/dev/null

echo '[AEGIS][TEST] preflight v2: PASS'
