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
  finalizeContractApproval,
  loadSemanticConstitution,
  renderSemanticContractMarkdown,
} from './scripts/lib/semantic_contract.mjs';
import {
  buildPreflightHandoff,
  discoverWorkspace,
  loadArchitecturePolicy,
} from './scripts/lib/issue_contract_core.mjs';
import { assertSchema } from './scripts/lib/schema_validator.mjs';
import { parseSemanticState } from './scripts/lib/semantic_state.mjs';

const currentSchemas = [
  'architecture-policy.v3.schema.json',
  'confirmation-request.v4.schema.json',
  'constitution.v1.schema.json',
  'issue-contract.v13.schema.json',
  'preflight-handoff.v2.schema.json',
  'rejection.v1.schema.json',
  'role-assignment.v1.schema.json',
  'semantic-draft.v8.schema.json',
  'semantic-opinion.v2.schema.json',
  'semantic-request.v9.schema.json',
  'semantic-resolution.v2.schema.json',
  'semantic-worksheet.v1.schema.json',
];
for (const file of currentSchemas) {
  const schema = JSON.parse(readFileSync(`governance/schemas/${file}`, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
    || !schema.$id.startsWith('aegis.')) throw new Error(`invalid_schema_metadata:${file}`);
}

const loadedPolicy = loadArchitecturePolicy(process.cwd());
const constitution = loadSemanticConstitution(process.cwd());
const demand = 'Criar comportamento observável de teste com formato ainda a escolher.';
const preflight = buildPreflightHandoff({
  demand,
  discovery: discoverWorkspace(process.cwd(), demand),
});
const semanticRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight,
  policy: loadedPolicy.policy,
  constitution,
});
assertSchema('aegis.semantic_request.v9', semanticRequest);
const { requestDigest, ...requestPayload } = semanticRequest;
if (requestDigest !== canonicalDigest(requestPayload)
  || semanticRequest.outputSchema.digest !== canonicalDigest(semanticRequest.outputSchema.document)
  || semanticRequest.outputSchema.document.$id !== 'aegis.semantic_opinion.v2'
  || Object.hasOwn(semanticRequest.outputSchema.document, 'description')
  || semanticRequest.worksheet.requiredDeterminismDimensions.length !== 0
  || semanticRequest.worksheet.counterexampleWitnesses.length !== 0) {
  throw new Error('semantic_request_is_not_minimal_or_bound');
}

const userBasis = [{ source: 'USER_INTENT', reference: 'comportamento observável' }];
const modelBasis = [{ source: 'MODEL_ANALYSIS', reference: 'analysis' }];
const applicableRules = loadedPolicy.policy.rules.filter((rule) => (
  rule.appliesWhen.includes('product-demand')
  || [...rule.reviewReferences, ...rule.forbiddenReferences]
    .some((reference) => demand.toLocaleLowerCase('pt-BR')
      .includes(reference.toLocaleLowerCase('pt-BR')))
));

const draft = {
  schema: 'aegis.semantic_draft.v8',
  sourceContextDigest: semanticRequest.contextDigest,
  title: 'Comportamento observável de teste',
  interpretation: 'Definir uma operação pública sem implementar o produto.',
  changeKind: 'PRODUCT',
  scope: {
    inScope: ['Definir o resultado público da operação.'],
    outOfScope: ['Implementar o produto.'],
  },
  intentClaims: [
    {
      id: 'CLAIM-RESULT',
      quote: 'comportamento observável',
      kind: 'OBLIGATION',
      disposition: 'NORMATIVE',
      contractEffect: 'A operação deve produzir comportamento observável para toda entrada.',
      targetIds: ['REQ-RESULT'],
      rationale: 'A demanda solicita comportamento público observável.',
    },
    {
      id: 'CLAIM-FORMAT',
      quote: 'formato ainda a escolher',
      kind: 'AMBIGUITY',
      disposition: 'DECISION',
      contractEffect: null,
      targetIds: ['Q-FORMAT'],
      rationale: 'A demanda declara que o formato permanece aberto.',
    },
  ],
  nonNormativeItems: [],
  pathReferences: [],
  architectureContexts: [{
    tag: 'product-demand',
    rationale: 'A demanda define comportamento público do produto.',
    basis: userBasis,
  }],
  policyAssessments: applicableRules.map((rule) => ({
    ruleId: rule.id,
    demandStatus: 'COMPLIANT',
    recommendedStatus: 'COMPLIANT',
    rationale: 'A regra foi confrontada com a demanda.',
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
    kind: 'FUNCTIONAL',
    statement: 'A operação deve produzir comportamento observável para toda entrada.',
    basis: userBasis,
    intentSignalIds: [],
    measurement: null,
    acceptanceCases: [
      {
        id: 'AC-RESULT-HAPPY',
        kind: 'HAPPY_PATH',
        given: 'Uma entrada válida.',
        when: 'A operação for solicitada.',
        then: 'Um resultado explícito deve ser observado.',
        outcomeKind: 'RETURN_VALUE',
        decisionBinding: { questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' },
        boundaryBinding: null,
      },
      {
        id: 'AC-RESULT-FAILURE',
        kind: 'FAILURE',
        given: 'Uma entrada inválida.',
        when: 'A operação for solicitada.',
        then: 'Uma falha explícita deve ser observada.',
        outcomeKind: 'REJECTION',
        decisionBinding: null,
        boundaryBinding: null,
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
  riskReview: { status: 'FOUND', rationale: 'Foi identificado risco de falha silenciosa.' },
  adversarialReview: {
    status: 'CHALLENGES_INTEGRATED',
    rationale: 'A recomendação foi confrontada com seu principal modo de falha.',
    findings: [{
      id: 'ADV-SILENT-RESULT',
      kind: 'TECHNICAL_RISK',
      disposition: 'REQUIREMENT',
      challenge: 'Um resultado simples pode ocultar a causa da falha.',
      response: 'Exigir resultado explícito em todos os casos.',
      targetIds: ['REQ-RESULT', 'RISK-SILENCE'],
      basis: modelBasis,
    }],
  },
  determinismReview: {
    status: 'NOT_APPLICABLE',
    rationale: 'Nenhuma dimensão material de determinismo foi identificada.',
    intentSignalIds: [],
    dimensions: [],
  },
  boundaryRules: [],
  unknowns: [{
    id: 'UNKNOWN-FORMAT',
    statement: 'O formato final do resultado não foi definido.',
    material: true,
    decisionId: 'Q-FORMAT',
    intentSignalIds: [],
    basis: [{ source: 'USER_INTENT', reference: 'formato ainda a escolher' }],
  }],
  decisions: [{
    questionId: 'Q-FORMAT',
    question: 'Qual formato público deve ser usado?',
    recommendedAnswerId: 'ANS-SIMPLE',
    requirementIds: ['REQ-RESULT'],
    invariantIds: ['INV-EXPLICIT'],
    riskIds: ['RISK-SILENCE'],
    distinguishingCase: {
      given: 'Uma operação válida concluída.',
      when: 'O resultado público for observado.',
      outcomes: [
        { answerId: 'ANS-SIMPLE', then: 'Somente o resultado essencial é observado.' },
        { answerId: 'ANS-DETAIL', then: 'O resultado e metadados adicionais são observados.' },
      ],
    },
    answers: [
      {
        id: 'ANS-SIMPLE',
        label: 'Simples',
        rationale: 'Menor superfície pública.',
        contractEffect: 'Um resultado explícito deve ser observado.',
        recommended: true,
      },
      {
        id: 'ANS-DETAIL',
        label: 'Detalhado',
        rationale: 'Expõe mais dados.',
        contractEffect: 'Um resultado detalhado com metadados deve ser observado.',
        recommended: false,
      },
    ],
  }],
};

const validationContext = {
  constitutionRules: constitution.rules,
  intent: demand,
  workspaceEvidence: semanticRequest.workspace.sourceEvidence,
};
assertSemanticDraft(draft, loadedPolicy.policy, validationContext);

function expectDraftFailure(mutator, expectedPrefix) {
  const invalid = structuredClone(draft);
  mutator(invalid);
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy, validationContext);
  } catch (error) {
    if (error.message.startsWith(expectedPrefix)) return;
    throw error;
  }
  throw new Error(`semantic_draft_was_not_rejected:${expectedPrefix}`);
}

expectDraftFailure(
  (invalid) => { invalid.intentClaims[0].quote = 'texto inexistente'; },
  'intent_claim_not_literal:',
);
expectDraftFailure(
  (invalid) => { invalid.requirements[0].basis = modelBasis; },
  'requirement_without_authoritative_basis:',
);
expectDraftFailure(
  (invalid) => { invalid.decisions[0].recommendedAnswerId = 'ANS-DETAIL'; },
  'invalid_recommendation:',
);
expectDraftFailure(
  (invalid) => { invalid.decisions[0].requirementIds = ['REQ-MISSING']; },
  'decision:Q-FORMAT_references_unknown_target:',
);
expectDraftFailure(
  (invalid) => { invalid.decisions[0].answers[1].contractEffect = invalid.decisions[0].answers[0].contractEffect; },
  'decision_answers_without_distinct_effects:',
);

const contract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
  semanticRequest,
});
if (contract.implementationAuthorized !== false
  || contract.effectiveDeterminismStatus !== 'PENDING_HUMAN_DECISIONS') {
  throw new Error('contract_did_not_preserve_pending_human_decision');
}
assertContractDocument({
  repositoryRoot: process.cwd(),
  contract,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (!renderSemanticContractMarkdown(contract).includes('Q-FORMAT')) {
  throw new Error('contract_markdown_omitted_decision');
}

const confirmation = buildConfirmationRequest(contract);
const resolution = {
  schema: 'aegis.semantic_resolution.v2',
  executionId: confirmation.executionId,
  contractDraftDigest: confirmation.contractDraftDigest,
  method: 'INTERACTIVE_WIZARD',
  attestation: 'CONTRACT_REVIEWED_AND_APPROVED',
  answers: [{ questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' }],
};
const approved = finalizeContractApproval({ contract, request: confirmation, resolution });
if (approved.approval === null || approved.effectiveDeterminismStatus !== 'NOT_APPLICABLE') {
  throw new Error('approved_contract_has_invalid_state');
}
parseSemanticState({
  schema: 'aegis.semantic_state.v13',
  contractDigest: canonicalDigest(approved),
  contract: approved,
});

const blocked = structuredClone(draft);
blocked.decisions = [];
blocked.intentClaims = blocked.intentClaims.filter(({ disposition }) => disposition !== 'DECISION');
blocked.unknowns[0].decisionId = null;
blocked.requirements[0].acceptanceCases[0].decisionBinding = null;
const blockedContract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft: blocked,
  preflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
  semanticRequest,
});
if (blockedContract.effectiveDeterminismStatus !== 'BLOCKED_BY_GAP') {
  throw new Error('material_gap_did_not_block_contract');
}
try {
  buildConfirmationRequest(blockedContract);
  throw new Error('wizard_accepted_material_gap');
} catch (error) {
  if (!error.message.startsWith('unresolved_semantic_gap:')) throw error;
}

console.log('governance schema tests passed');
NODE
