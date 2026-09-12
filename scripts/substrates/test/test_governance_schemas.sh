#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

node --input-type=module <<'NODE'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDigest } from './scripts/lib/canonical_json.mjs';
import {
  assertContractDocument,
  assertSemanticDraft,
  buildConfirmationRequest,
  buildSemanticRequest,
  compileSemanticContract,
  loadSemanticConstitution,
  renderSemanticContractMarkdown,
  resolutionRequiresRecompilation,
} from './scripts/lib/semantic_contract.mjs';
import { buildPreflightHandoff, discoverWorkspace, loadArchitecturePolicy } from './scripts/lib/issue_contract_core.mjs';
import { assertSchema, schemaDocument, schemaErrors } from './scripts/lib/schema_validator.mjs';
import { parseSemanticState, semanticStateRelativePath } from './scripts/lib/semantic_state.mjs';

const schemaFiles = [
  'architecture-policy.v1.schema.json',
  'confirmation-request.v1.schema.json',
  'constitution.v1.schema.json',
  'issue-contract.v3.schema.json',
  'issue-contract.v4.schema.json',
  'preflight-handoff.v2.schema.json',
  'rejection.v1.schema.json',
  'semantic-draft.v1.schema.json',
  'semantic-draft.v2.schema.json',
  'semantic-request.v1.schema.json',
  'semantic-request.v2.schema.json',
  'semantic-resolution.v1.schema.json',
];
for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(`governance/schemas/${file}`, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
    || !schema.$id.startsWith('aegis.')) {
    throw new Error(`invalid_schema_metadata:${file}`);
  }
}

const loadedPolicy = loadArchitecturePolicy(process.cwd());
const constitution = loadSemanticConstitution(process.cwd());
assertSchema('aegis.architecture_policy.v1', loadedPolicy.policy);
const preflight = buildPreflightHandoff({
  demand: 'Criar comportamento observável de teste.',
  discovery: discoverWorkspace(process.cwd(), 'Criar comportamento observável de teste.'),
});
const semanticRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight,
  policy: loadedPolicy.policy,
  constitution,
});
assertSchema('aegis.semantic_request.v2', semanticRequest);
const expectedOutputSchema = schemaDocument('aegis.semantic_draft.v2');
expectedOutputSchema.properties.sourceContextDigest = { const: semanticRequest.contextDigest };
if (semanticRequest.constitution.digest !== constitution.digest
  || semanticRequest.constitution.rules.length !== 5
  || semanticRequest.outputSchema.digest !== canonicalDigest(expectedOutputSchema)
  || canonicalDigest(semanticRequest.outputSchema.document) !== canonicalDigest(expectedOutputSchema)
  || semanticRequest.outputSchema.document.properties.sourceContextDigest.const
    !== semanticRequest.contextDigest) {
  throw new Error('semantic_request_omitted_authoritative_inputs');
}

const userBasis = [{ source: 'USER_INTENT', reference: 'comportamento observável' }];
const modelBasis = [{ source: 'MODEL_ANALYSIS', reference: 'analysis' }];
const semanticSchema = semanticRequest.outputSchema.document;
if (semanticSchema.properties.riskReview.required.includes('consideredKinds')
  || semanticSchema.properties.riskReview.properties.consideredKinds !== undefined
  || semanticSchema.properties.policyAssessments.items.properties.demandStatus.enum
    .includes('NOT_APPLICABLE')) {
  throw new Error('semantic_schema_retained_declarative_noise');
}

const largeRoot = mkdtempSync(join(tmpdir(), 'aegis-semantic-evidence.'));
try {
  mkdirSync(join(largeRoot, 'src'));
  writeFileSync(
    join(largeRoot, 'src/index.ts'),
    `${'const filler = 1;\n'.repeat(3_000)}export const needleterm = true;\n`,
  );
  const largePreflight = buildPreflightHandoff({
    demand: 'Encontrar needleterm.',
    discovery: discoverWorkspace(largeRoot, 'Encontrar needleterm.'),
  });
  const largeRequest = buildSemanticRequest({
    repositoryRoot: largeRoot,
    preflight: largePreflight,
    policy: loadedPolicy.policy,
    constitution,
  });
  const lexicalMatch = largeRequest.workspace.lexicalEvidence.matches[0];
  const sourceWindow = largeRequest.workspace.sourceEvidence[0];
  if (lexicalMatch.line < 3_000
    || sourceWindow.selection !== 'LEXICAL_WINDOW'
    || sourceWindow.startLine <= 1
    || !sourceWindow.content.includes('needleterm')) {
    throw new Error('lexical_window_omitted_match');
  }
} finally {
  rmSync(largeRoot, { recursive: true, force: true });
}

const draft = {
  schema: 'aegis.semantic_draft.v2',
  sourceContextDigest: semanticRequest.contextDigest,
  title: 'Comportamento observável de teste',
  interpretation: 'Definir uma operação pública sem implementar o produto.',
  changeKind: 'PRODUCT',
  scope: {
    inScope: ['Definir o resultado público da operação.'],
    outOfScope: ['Implementar o produto.'],
  },
  architectureContexts: [{
    tag: 'product-demand',
    rationale: 'A demanda define comportamento público do produto.',
    basis: userBasis,
  }],
  policyAssessments: loadedPolicy.policy.rules
    .filter((rule) => rule.appliesWhen.includes('product-demand'))
    .map((rule) => ({
    ruleId: rule.id,
    demandStatus: 'COMPLIANT',
    recommendedStatus: 'COMPLIANT',
    rationale: 'A regra foi confrontada explicitamente com a demanda.',
    decisionId: null,
    amendmentId: null,
  })),
  complexityReview: {
    status: 'NO_EXCESS',
    rationale: 'A demanda não exige estrutura técnica.',
    alternatives: [],
  },
  requirements: [{
    id: 'REQ-RESULT',
    statement: 'A operação deve retornar resultado explícito.',
    basis: userBasis,
    acceptanceCases: [
      {
        id: 'AC-RESULT-HAPPY',
        kind: 'HAPPY_PATH',
        given: 'Uma entrada válida.',
        when: 'A operação for solicitada.',
        then: 'Um resultado explícito deve ser observado.',
      },
      {
        id: 'AC-RESULT-FAILURE',
        kind: 'FAILURE',
        given: 'Uma entrada inválida.',
        when: 'A operação for solicitada.',
        then: 'Uma falha explícita deve ser observada.',
      },
    ],
  }],
  invariants: [{
    id: 'INV-EXPLICIT',
    statement: 'Nenhum resultado desaparece silenciosamente.',
    falsification: 'Uma execução termina sem resultado nem falha observável.',
    requirementIds: ['REQ-RESULT'],
  }],
  risks: [{
    id: 'RISK-SILENCE',
    kind: 'RELIABILITY',
    level: 'HIGH',
    statement: 'Uma falha pode desaparecer silenciosamente.',
    mitigation: 'Exigir resultado explícito em todos os casos.',
    requirementIds: ['REQ-RESULT'],
    basis: modelBasis,
  }],
  riskReview: {
    status: 'FOUND',
    rationale: 'Foi identificado risco de falha silenciosa.',
  },
  adversarialReview: {
    status: 'CHALLENGES_INTEGRATED',
    rationale: 'A recomendação foi confrontada com seu principal modo de falha.',
    findings: [{
      id: 'ADV-SILENT-RESULT',
      challenge: 'Um resultado simples pode ocultar a causa da falha.',
      response: 'O risco e o requisito exigem falha explícita.',
      targetIds: ['REQ-RESULT', 'RISK-SILENCE'],
      basis: modelBasis,
    }],
  },
  unknowns: [{
    id: 'UNKNOWN-FORMAT',
    statement: 'O formato final do resultado não foi definido.',
    material: true,
    decisionId: 'Q-FORMAT',
    basis: userBasis,
  }],
  decisions: [{
    questionId: 'Q-FORMAT',
    question: 'Qual formato público deve ser usado?',
    recommendedAnswerId: 'ANS-SIMPLE',
    requirementIds: ['REQ-RESULT'],
    invariantIds: ['INV-EXPLICIT'],
    riskIds: ['RISK-SILENCE'],
    answers: [
      { id: 'ANS-SIMPLE', label: 'Simples', rationale: 'Menor superfície pública.', recommended: true },
      { id: 'ANS-DETAIL', label: 'Detalhado', rationale: 'Expõe mais dados.', recommended: false },
    ],
  }],
};

const semanticValidationContext = {
  constitutionRules: constitution.rules,
  intent: preflight.intent,
  resolvedDecisionIds: [],
  workspaceEvidence: semanticRequest.workspace.sourceEvidence,
};
assertSemanticDraft(draft, loadedPolicy.policy, semanticValidationContext);
const contract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
assertContractDocument({
  repositoryRoot: process.cwd(),
  contract,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (contract.intent !== preflight.intent
  || contract.implementationAuthorized !== false
  || contract.constitutionDigest !== constitution.digest) {
  throw new Error('mechanical_contract_fields_were_not_injected');
}
const humanContract = renderSemanticContractMarkdown(contract, {
  policyRules: loadedPolicy.policy.rules,
});
if (humanContract.includes(preflight.intent)
  || humanContract.includes('## 8. Lacunas declaradas')
  || !humanContract.includes('**Lacuna:** O formato final do resultado não foi definido.')
  || !humanContract.includes('## 8. Parecer adversarial')) {
  throw new Error('human_contract_retained_redundant_sections');
}
if (schemaErrors('aegis.issue_contract.v4', { ...contract, implementationAuthorized: true }).length === 0) {
  throw new Error('contract_authorized_implementation');
}

const confirmation = buildConfirmationRequest(contract);
const recommendedResolution = {
  schema: 'aegis.semantic_resolution.v1',
  executionId: confirmation.executionId,
  contractDraftDigest: confirmation.contractDraftDigest,
  answers: [{ questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' }],
};
if (resolutionRequiresRecompilation({
  contract,
  request: confirmation,
  resolution: recommendedResolution,
})) throw new Error('recommended_path_required_recompilation');

const alternativeResolution = structuredClone(recommendedResolution);
alternativeResolution.answers[0].answerId = 'ANS-DETAIL';
if (!resolutionRequiresRecompilation({
  contract,
  request: confirmation,
  resolution: alternativeResolution,
})) throw new Error('alternative_path_did_not_require_recompilation');

for (const mutate of [
  (value) => value.requirements[0].acceptanceCases.pop(),
  (value) => { value.invariants[0].requirementIds = ['REQ-MISSING']; },
  (value) => value.policyAssessments.pop(),
  (value) => { value.unknowns[0].decisionId = null; },
  (value) => { value.complexityReview.status = 'SIMPLIFIED'; },
  (value) => { value.riskReview.status = 'NONE'; },
  (value) => { value.architectureContexts[0].tag = 'unknown-context'; },
  (value) => {
    value.policyAssessments.push({
      ruleId: 'ARCH-HARNESS-STATE',
      demandStatus: 'COMPLIANT',
      recommendedStatus: 'COMPLIANT',
      rationale: 'Regra não aplicável injetada indevidamente.',
      decisionId: null,
      amendmentId: null,
    });
  },
  (value) => { value.unknowns = []; },
  (value) => { value.unknowns[0].material = false; },
  (value) => { value.requirements[0].basis = modelBasis; },
  (value) => { value.unknowns[0].basis = [{ source: 'USER_INTENT', reference: 'invented' }]; },
  (value) => { value.risks[0].basis = [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-MISSING' }]; },
  (value) => { value.risks[0].basis = [{ source: 'CONSTITUTION', reference: 'CONST-MISSING' }]; },
  (value) => { value.risks[0].basis = [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/missing.ts:L1' }]; },
  (value) => { value.risks[0].basis = [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/index.ts:L999999' }]; },
  (value) => { value.requirements[0].basis = [{ source: 'USER_DECISION', reference: 'Q-GHOST' }]; },
  (value) => { value.adversarialReview.findings[0].targetIds = ['REQ-MISSING']; },
  (value) => { value.adversarialReview.status = 'NO_ADDITIONAL_FINDINGS'; },
  (value) => {
    value.adversarialReview = {
      status: 'NO_ADDITIONAL_FINDINGS',
      rationale: 'Nenhuma objeção adicional.',
      findings: [],
    };
  },
  (value) => {
    value.decisions[0].requirementIds = [];
    value.decisions[0].invariantIds = [];
    value.decisions[0].riskIds = [];
  },
]) {
  const invalid = structuredClone(draft);
  mutate(invalid);
  let rejected = false;
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy, semanticValidationContext);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('invalid_semantic_draft_was_accepted');
}

const enforcedHardConflict = structuredClone(draft);
enforcedHardConflict.policyAssessments[0].demandStatus = 'CONFLICT';
enforcedHardConflict.policyAssessments[0].rationale = 'O conflito hard foi corrigido sem virar pergunta.';
assertSemanticDraft(enforcedHardConflict, loadedPolicy.policy, semanticValidationContext);
const correctedContract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft: enforcedHardConflict,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (!renderSemanticContractMarkdown(correctedContract, {
  policyRules: loadedPolicy.policy.rules,
}).includes('ARCH-PRODUCT-BOUNDARY — CORREÇÃO OBRIGATÓRIA')) {
  throw new Error('hard_policy_correction_was_not_visible');
}

const invalidHardDecision = structuredClone(enforcedHardConflict);
invalidHardDecision.policyAssessments[0].decisionId = 'Q-FORMAT';
let hardDecisionRejected = false;
try {
  assertSemanticDraft(invalidHardDecision, loadedPolicy.policy, semanticValidationContext);
} catch {
  hardDecisionRejected = true;
}
if (!hardDecisionRejected) throw new Error('hard_policy_conflict_became_user_choice');

const deliberableDefaultConflict = structuredClone(draft);
deliberableDefaultConflict.architectureContexts.push({
  tag: 'typescript-form',
  rationale: 'A demanda exige uma forma TypeScript ainda ambígua.',
  basis: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/index.ts:L1' }],
});
deliberableDefaultConflict.policyAssessments.push({
  ruleId: 'ARCH-STRICT-EXPLICIT-MODULES',
  demandStatus: 'CONFLICT',
  recommendedStatus: 'COMPLIANT',
  rationale: 'Uma exigência explícita deixa escolha material sob regra default.',
  decisionId: 'Q-FORMAT',
  amendmentId: null,
});
assertSemanticDraft(deliberableDefaultConflict, loadedPolicy.policy, semanticValidationContext);

const redFlagIntent = 'Usar any, AbstractCycleResolver e try/catch vazios na operação.';
const redFlagPreflight = buildPreflightHandoff({
  demand: redFlagIntent,
  discovery: discoverWorkspace(process.cwd(), redFlagIntent),
});
const redFlagRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: redFlagPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const redFlagDraft = structuredClone(draft);
redFlagDraft.sourceContextDigest = redFlagRequest.contextDigest;
for (const claim of [
  ...redFlagDraft.architectureContexts,
  ...redFlagDraft.requirements,
  ...redFlagDraft.unknowns,
]) claim.basis = [{ source: 'USER_INTENT', reference: 'any' }];
redFlagDraft.policyAssessments = loadedPolicy.policy.rules
  .filter((rule) => rule.appliesWhen.includes('product-demand')
    || (rule.forbiddenReferences ?? []).some((reference) => (
      redFlagIntent.toLocaleLowerCase('pt-BR').includes(reference.toLocaleLowerCase('pt-BR'))
    )))
  .map((rule) => ({
    ruleId: rule.id,
    demandStatus: 'COMPLIANT',
    recommendedStatus: 'COMPLIANT',
    rationale: 'A regra ativada explicitamente foi confrontada com a demanda.',
    decisionId: null,
    amendmentId: null,
  }));
const redFlagContext = {
  constitutionRules: constitution.rules,
  intent: redFlagIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: redFlagRequest.workspace.sourceEvidence,
};
assertSemanticDraft(redFlagDraft, loadedPolicy.policy, redFlagContext);
redFlagDraft.policyAssessments = redFlagDraft.policyAssessments
  .filter(({ ruleId }) => ruleId !== 'ARCH-PARSIMONY');
let omittedTriggeredRuleRejected = false;
try {
  assertSemanticDraft(redFlagDraft, loadedPolicy.policy, redFlagContext);
} catch {
  omittedTriggeredRuleRejected = true;
}
if (!omittedTriggeredRuleRejected) throw new Error('explicit_policy_trigger_was_omitted');

const semanticState = {
  schema: 'aegis.semantic_state.v4',
  contract,
  contractDigest: canonicalDigest(contract),
};
parseSemanticState(semanticState);
if (semanticStateRelativePath !== '.harness/state/semantic-state.json') {
  throw new Error('semantic_state_escaped_harness');
}
NODE

grep -Fqx '# Aegis Cognitive Constitution' AGENTS.md
printf '[AEGIS][TEST] governance schemas and semantic interface: PASS\n'
