#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { canonicalDigest } from './scripts/lib/canonical_json.mjs';
import {
  assertContractDocument,
  assertSemanticDraft,
  buildConfirmationRequest,
  buildSemanticRequest,
  compileSemanticContract,
  loadSemanticConstitution,
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
  'preflight-handoff.v2.schema.json',
  'rejection.v1.schema.json',
  'semantic-draft.v1.schema.json',
  'semantic-request.v1.schema.json',
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
assertSchema('aegis.semantic_request.v1', semanticRequest);
const expectedOutputSchema = schemaDocument('aegis.semantic_draft.v1');
expectedOutputSchema.properties.sourceContextDigest = { const: semanticRequest.contextDigest };
if (semanticRequest.constitution.digest !== constitution.digest
  || semanticRequest.constitution.rules.length !== 5
  || semanticRequest.outputSchema.digest !== canonicalDigest(expectedOutputSchema)
  || canonicalDigest(semanticRequest.outputSchema.document) !== canonicalDigest(expectedOutputSchema)
  || semanticRequest.outputSchema.document.properties.sourceContextDigest.const
    !== semanticRequest.contextDigest) {
  throw new Error('semantic_request_omitted_authoritative_inputs');
}

const draft = {
  schema: 'aegis.semantic_draft.v1',
  sourceContextDigest: semanticRequest.contextDigest,
  title: 'Comportamento observável de teste',
  interpretation: 'Definir uma operação pública sem implementar o produto.',
  changeKind: 'PRODUCT',
  scope: {
    inScope: ['Definir o resultado público da operação.'],
    outOfScope: ['Implementar o produto.'],
  },
  policyAssessments: loadedPolicy.policy.rules.map((rule) => ({
    ruleId: rule.id,
    status: ['ARCH-PRODUCT-BOUNDARY', 'ARCH-CONTRACT-ONLY', 'ARCH-FAILURE-EXPLICIT'].includes(rule.id)
      ? 'COMPLIANT'
      : 'NOT_APPLICABLE',
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
    provenance: 'USER',
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
  }],
  riskReview: {
    status: 'FOUND',
    rationale: 'Foi identificado risco de falha silenciosa.',
  },
  unknowns: [{
    id: 'UNKNOWN-FORMAT',
    statement: 'O formato final do resultado não foi definido.',
    material: true,
    decisionId: 'Q-FORMAT',
  }],
  decisions: [{
    questionId: 'Q-FORMAT',
    question: 'Qual formato público deve ser usado?',
    recommendedAnswerId: 'ANS-SIMPLE',
    answers: [
      { id: 'ANS-SIMPLE', label: 'Simples', rationale: 'Menor superfície pública.', recommended: true },
      { id: 'ANS-DETAIL', label: 'Detalhado', rationale: 'Expõe mais dados.', recommended: false },
    ],
  }],
};

assertSemanticDraft(draft, loadedPolicy.policy);
const contract = compileSemanticContract({
  draft,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitutionDigest: constitution.digest,
});
assertContractDocument({
  contract,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitutionDigest: constitution.digest,
});
if (contract.intent !== preflight.intent
  || contract.implementationAuthorized !== false
  || contract.constitutionDigest !== constitution.digest) {
  throw new Error('mechanical_contract_fields_were_not_injected');
}
if (schemaErrors('aegis.issue_contract.v3', { ...contract, implementationAuthorized: true }).length === 0) {
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
]) {
  const invalid = structuredClone(draft);
  mutate(invalid);
  let rejected = false;
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('invalid_semantic_draft_was_accepted');
}

const deliberableConflict = structuredClone(draft);
deliberableConflict.policyAssessments[0].status = 'CONFLICT_REQUIRES_DECISION';
deliberableConflict.policyAssessments[0].decisionId = 'Q-FORMAT';
assertSemanticDraft(deliberableConflict, loadedPolicy.policy);

const semanticState = {
  schema: 'aegis.semantic_state.v3',
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
