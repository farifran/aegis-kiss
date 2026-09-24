#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { canonicalDigest } from './scripts/lib/canonical_json.mjs';
import {
  assertJevAssessment,
  buildJevDecisionBatch,
} from './scripts/lib/jev_projection.mjs';
import {
  compileJevAssessment,
  requestJevAssessment,
} from './scripts/lib/jev_gateway.mjs';
import {
  assertJevAdvisory,
  compileJevAdvisory,
} from './scripts/lib/jev_advisory.mjs';
import { compileJevComparison } from './scripts/lib/jev_comparison.mjs';
import {
  buildSemanticGatewayPayload,
  requestSemanticOpinion,
} from './scripts/lib/semantic_gateway.mjs';
import { counterexampleForDimension } from './scripts/lib/semantic_authority.mjs';
import {
  assertContractDocument,
  assertSemanticDraft,
  buildConfirmationRequest,
  buildSemanticRequest,
  compileSemanticContract,
  finalizeContractApproval,
  loadSemanticConstitution,
  renderSemanticContractMarkdown,
  resolutionRequiresRecompilation,
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
  'confirmation-request.v5.schema.json',
  'constitution.v1.schema.json',
  'intent-evidence.v1.schema.json',
  'issue-contract.v14.schema.json',
  'jev-advisory.v2.schema.json',
  'jev-assessment.v1.schema.json',
  'jev-comparison.v1.schema.json',
  'jev-decision-batch.v2.schema.json',
  'preflight-handoff.v2.schema.json',
  'rejection.v1.schema.json',
  'role-assignment.v1.schema.json',
  'semantic-draft.v9.schema.json',
  'semantic-execution.v1.schema.json',
  'semantic-opinion.v3.schema.json',
  'semantic-request.v10.schema.json',
  'semantic-resolution.v2.schema.json',
  'wizard-question.v1.schema.json',
];
for (const file of currentSchemas) {
  const schema = JSON.parse(readFileSync(`governance/schemas/${file}`, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
    || !schema.$id.startsWith('aegis.')) throw new Error(`invalid_schema_metadata:${file}`);
}

const loadedPolicy = loadArchitecturePolicy(process.cwd());
const constitution = loadSemanticConstitution(process.cwd());
const demand = 'Definir comportamento observável de teste com saída ainda a escolher.';
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
assertSchema('aegis.semantic_request.v10', semanticRequest);
const { requestDigest, ...requestPayload } = semanticRequest;
if (requestDigest !== canonicalDigest(requestPayload)
  || semanticRequest.outputSchema.digest !== canonicalDigest(semanticRequest.outputSchema.document)
  || semanticRequest.outputSchema.document.$id !== 'aegis.semantic_opinion.v3'
  || Object.hasOwn(semanticRequest.outputSchema.document, 'description')
  || Object.hasOwn(
    semanticRequest.outputSchema.document.properties,
    'worksheetDigest',
  )
  || JSON.stringify(semanticRequest.outputSchema.document).includes('"$ref"')
  || JSON.stringify(semanticRequest.outputSchema.document).includes('"oneOf"')
  || JSON.stringify(semanticRequest.outputSchema.document).includes('"allOf"')
  || JSON.stringify(semanticRequest.outputSchema.document).includes('"if"')
  || semanticRequest.intentEvidence.fragments.length !== 1
  || semanticRequest.intentEvidence.literalFacts.length !== 0) {
  throw new Error('semantic_request_is_not_minimal_or_bound');
}

const jevDemand = 'Definir comportamento observável usando uma factory opcional e hash de 64 bits.';
const jevPreflight = buildPreflightHandoff({
  demand: jevDemand,
  discovery: discoverWorkspace(process.cwd(), jevDemand),
});
const jevSemanticRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: jevPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const jevBatch = buildJevDecisionBatch(jevSemanticRequest);
if (jevBatch.schema !== 'aegis.jev_decision_batch.v2'
  || jevBatch.sourceSemanticRequestDigest !== jevSemanticRequest.requestDigest
  || jevBatch.sourceEvidenceDigest !== jevSemanticRequest.intentEvidence.evidenceDigest
  || jevBatch.protocol.authority !== 'ADVISORY_ONLY'
  || jevBatch.protocol.purpose !== 'SHADOW_EVALUATION'
  || jevBatch.projection.questionCount !== Object.keys(jevBatch.questions).length
  || jevBatch.projection.questionCount !== jevSemanticRequest.intentEvidence.fragments.length
  || !Object.values(jevBatch.bindings).every(({ allowedUse }) => allowedUse === 'SHADOW_METRIC_ONLY')
  || Object.hasOwn(jevBatch.state, 'intent')
  || Object.hasOwn(jevBatch.state, 'sourceEvidence')
  || Object.hasOwn(jevBatch.state, 'outputSchema')) {
  throw new Error('jev_projection_is_not_compact_or_advisory');
}
const jevAnswers = Object.fromEntries(Object.entries(jevBatch.questions).map(([id, question]) => {
  const optionIds = Object.keys(question.criteria);
  return [id, {
    type: 'choice',
    choice: optionIds[0],
    probabilities: Object.fromEntries(optionIds.map((optionId, index) => [
      optionId,
      index === 0 ? 1 : 0,
    ])),
    confidence: 1,
  }];
}));
const jevAssessmentPayload = {
  schema: 'aegis.jev_assessment.v1',
  sourceBatchDigest: jevBatch.batchDigest,
  authority: 'ADVISORY_ONLY',
  provider: 'TYPESAFE_JEV',
  transport: 'VERCEL_AI_GATEWAY',
  model: 'jev-test-pinned',
  answers: jevAnswers,
  usage: { inputTokens: 10, outputTokens: 0 },
};
const jevAssessment = {
  ...jevAssessmentPayload,
  assessmentDigest: canonicalDigest(jevAssessmentPayload),
};
assertJevAssessment(jevAssessment, jevBatch);
const compiledJevAssessment = compileJevAssessment(jevBatch, {
  model: 'jev-test-pinned',
  answers: jevAnswers,
  usage: { input_tokens: 10, output_tokens: 0 },
});
if (compiledJevAssessment.assessmentDigest !== jevAssessment.assessmentDigest) {
  throw new Error('jev_gateway_response_was_not_compiled_deterministically');
}
const roundedAnswers = structuredClone(jevAnswers);
for (const answer of Object.values(roundedAnswers)) {
  const optionIds = Object.keys(answer.probabilities);
  answer.probabilities = Object.fromEntries(optionIds.map((optionId, index) => [
    optionId,
    index < 2 ? 0.499 : 0,
  ]));
}
const normalizedAssessment = compileJevAssessment(jevBatch, {
  model: 'jev-test-pinned',
  answers: roundedAnswers,
  usage: { input_tokens: 10, output_tokens: 0 },
});
for (const answer of Object.values(normalizedAssessment.answers)) {
  const total = Object.values(answer.probabilities).reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error('jev_probabilities_were_not_normalized');
}
const jevAdvisory = compileJevAdvisory(jevSemanticRequest, jevBatch, jevAssessment);
assertJevAdvisory(jevAdvisory, jevSemanticRequest, jevBatch);
if (jevAdvisory.purpose !== 'SHADOW_EVALUATION') throw new Error('jev_not_shadow_only');
const forgedAdvisory = structuredClone(jevAdvisory);
forgedAdvisory.sourceSemanticRequestDigest = '0'.repeat(64);
const { advisoryDigest: discardedAdvisoryDigest, ...forgedAdvisoryPayload } = forgedAdvisory;
void discardedAdvisoryDigest;
forgedAdvisory.advisoryDigest = canonicalDigest(forgedAdvisoryPayload);
try {
  assertJevAdvisory(forgedAdvisory, jevSemanticRequest, jevBatch);
  throw new Error('forged_jev_advisory_was_accepted');
} catch (error) {
  if (error.message !== 'jev_advisory_source_mismatch') throw error;
}
try {
  await requestJevAssessment(jevBatch, {
    apiKey: 'test-key',
    client: {
      async systemOne() {
        const error = new Error('AI Gateway requires a valid credit card on file');
        error.status = 403;
        throw error;
      },
    },
  });
  throw new Error('jev_gateway_billing_failure_was_not_normalized');
} catch (error) {
  if (!error.message.startsWith('jev_gateway_billing_required:')) throw error;
}
const invalidJevAssessment = structuredClone(jevAssessment);
const firstJevQuestionId = Object.keys(jevBatch.questions).sort()[0];
invalidJevAssessment.answers[firstJevQuestionId].choice = 'FORGED_OPTION';
const { assessmentDigest: previousAssessmentDigest, ...invalidJevAssessmentPayload } = invalidJevAssessment;
void previousAssessmentDigest;
invalidJevAssessment.assessmentDigest = canonicalDigest(invalidJevAssessmentPayload);
try {
  assertJevAssessment(invalidJevAssessment, jevBatch);
  throw new Error('forged_jev_choice_was_accepted');
} catch (error) {
  if (!error.message.startsWith('jev_assessment_choice_space_mismatch:')) throw error;
}
const nonMaximalJevAssessment = structuredClone(jevAssessment);
const firstJevOptions = Object.keys(jevBatch.questions[firstJevQuestionId].criteria);
nonMaximalJevAssessment.answers[firstJevQuestionId].choice = firstJevOptions[1];
const { assessmentDigest: previousNonMaximalDigest, ...nonMaximalPayload } = nonMaximalJevAssessment;
void previousNonMaximalDigest;
nonMaximalJevAssessment.assessmentDigest = canonicalDigest(nonMaximalPayload);
try {
  assertJevAssessment(nonMaximalJevAssessment, jevBatch);
  throw new Error('non_maximal_jev_choice_was_accepted');
} catch (error) {
  if (!error.message.startsWith('jev_assessment_selected_choice_mismatch:')) throw error;
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
  schema: 'aegis.semantic_draft.v9',
  sourceContextDigest: semanticRequest.contextDigest,
  sourceEvidenceDigest: semanticRequest.intentEvidence.evidenceDigest,
  title: 'Comportamento observável de teste',
  interpretation: 'Definir uma operação pública sem implementar o produto.',
  changeKind: 'PRODUCT',
  scope: {
    inScope: ['Definir o resultado público da operação.'],
    outOfScope: ['Implementar o produto.'],
  },
  fragmentDispositions: [{
    fragmentId: 'FRAG-0001',
    status: 'CLAIMS_EXTRACTED',
    claimIds: ['CLAIM-RESULT', 'CLAIM-FORMAT'],
    rationale: 'As duas afirmações materiais do fragmento foram classificadas.',
  }],
  intentClaims: [
    {
      id: 'CLAIM-RESULT',
      quote: 'comportamento observável',
      sourceFragmentIds: ['FRAG-0001'],
      kind: 'OBLIGATION',
      disposition: 'NORMATIVE',
      contractEffect: 'A operação deve produzir comportamento observável para toda entrada.',
      targetIds: ['REQ-RESULT'],
      rationale: 'A demanda solicita comportamento público observável.',
    },
    {
      id: 'CLAIM-FORMAT',
      quote: 'saída ainda a escolher',
      sourceFragmentIds: ['FRAG-0001'],
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
    sourceFragmentIds: ['FRAG-0001'],
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
    sourceFragmentIds: [],
    dimensions: [],
  },
  boundaryRules: [],
  unknowns: [{
    id: 'UNKNOWN-FORMAT',
    statement: 'O formato final do resultado não foi definido.',
    material: true,
    decisionId: 'Q-FORMAT',
    sourceFragmentIds: ['FRAG-0001'],
    basis: [{ source: 'USER_INTENT', reference: 'saída ainda a escolher' }],
  }],
  decisions: [{
    questionId: 'Q-FORMAT',
    question: 'Qual formato público deve ser usado?',
    presentation: {
      context: 'A demanda deixa abertas duas formas de apresentar o resultado público da mesma operação concluída.',
      whyHumanDecision: 'Nenhuma fonte confiável escolhe entre um resultado mínimo e um resultado acrescido de metadados observáveis.',
      observableImpact: 'A escolha muda os dados devolvidos ao consumidor e a superfície pública protegida pelo contrato.',
      recommendationReasoning: 'A forma simples é recomendada porque entrega o valor solicitado e evita ampliar a API sem necessidade demonstrada.',
      glossary: [{ term: 'superfície pública', meaning: 'Parte do comportamento que consumidores externos conseguem observar.' }],
    },
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
  intentEvidence: semanticRequest.intentEvidence,
  workspaceEvidence: semanticRequest.workspace.sourceEvidence,
};
assertSemanticDraft(draft, loadedPolicy.policy, validationContext);

const semanticBatch = buildJevDecisionBatch(semanticRequest);
const semanticAnswers = Object.fromEntries(Object.entries(semanticBatch.questions).map(([id, question]) => {
  const optionIds = Object.keys(question.criteria);
  return [id, {
    type: 'choice',
    choice: 'NORMATIVE',
    probabilities: Object.fromEntries(optionIds.map((optionId) => [
      optionId,
      optionId === 'NORMATIVE' ? 1 : 0,
    ])),
    confidence: 1,
  }];
}));
const semanticAssessment = compileJevAssessment(semanticBatch, {
  model: 'jev-test-pinned',
  answers: semanticAnswers,
  usage: { input_tokens: 1, output_tokens: 1 },
});
const semanticAdvisory = compileJevAdvisory(semanticRequest, semanticBatch, semanticAssessment);
const jevComparison = compileJevComparison(semanticRequest, draft, semanticAdvisory);
if (jevComparison.authority !== 'EVALUATION_ONLY'
  || jevComparison.totals.fragments !== semanticRequest.intentEvidence.fragments.length
  || jevComparison.totals.disagreements !== 1) {
  throw new Error('jev_shadow_comparison_is_not_mechanical');
}

const gatewayRole = {
  channel: 'API',
  adapter: 'ai-gateway',
  model: 'openai/test-model',
  credentialEnv: 'TEST_GATEWAY_KEY',
};
const gatewayPayload = buildSemanticGatewayPayload(semanticRequest, gatewayRole);
const gatewayUserContext = JSON.parse(gatewayPayload.messages[1].content);
if (gatewayPayload.messages.length !== 2
  || gatewayPayload.response_format.json_schema.schema !== semanticRequest.outputSchema.document
  || Object.hasOwn(gatewayUserContext, 'outputSchema')
  || Object.hasOwn(gatewayUserContext, 'constitution')) {
  throw new Error('semantic_gateway_payload_duplicates_or_omits_context');
}
let semanticCalls = 0;
const gatewayResult = await requestSemanticOpinion(semanticRequest, gatewayRole, {
  environment: { TEST_GATEWAY_KEY: 'secret' },
  fetchImplementation: async () => {
    semanticCalls += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          model: 'openai/test-model',
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        });
      },
    };
  },
});
if (semanticCalls !== 1 || JSON.stringify(gatewayResult.opinion) !== '{}'
  || gatewayResult.execution.usage.inputTokens !== 3) {
  throw new Error('semantic_gateway_did_not_make_exactly_one_call');
}

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
expectDraftFailure(
  (invalid) => {
    invalid.requirements[0].basis = [{
      source: 'SAFE_MECHANICAL_DEFAULT',
      reference: 'ARCH-PRODUCT-BOUNDARY',
    }];
  },
  'mechanical_default_references_non_default_rule:',
);
expectDraftFailure(
  (invalid) => {
    invalid.intentClaims = invalid.intentClaims.filter(({ disposition }) => disposition !== 'DECISION');
    invalid.unknowns[0].basis = modelBasis;
  },
  'decision_without_material_unknown:',
);

const deterministicDraft = structuredClone(draft);
const proof = {
  witnessId: 'WITNESS-ORDERING',
  relation: 'OUTPUTS_EQUAL',
  resolutionKind: 'PERMUTATION_INVARIANT',
  resolutionParameter: null,
  baselineOutcome: 'resultado estável',
  variationOutcome: 'resultado estável',
  observables: ['resultado público'],
};
deterministicDraft.requirements[0].acceptanceCases.push({
  id: 'AC-ORDERING-PROOF',
  kind: 'BOUNDARY',
  given: 'Duas entradas equivalentes em ordens diferentes.',
  when: 'A operação for executada.',
  then: 'Base: resultado estável; Variação: resultado estável; Resolução: PERMUTATION_INVARIANT.',
  outcomeKind: 'RETURN_VALUE',
  decisionBinding: null,
  boundaryBinding: null,
});
deterministicDraft.determinismReview = {
  status: 'SEMANTICALLY_CLOSED',
  rationale: 'A ordem não altera o resultado público.',
  sourceFragmentIds: ['FRAG-0001'],
  dimensions: [{
    kind: 'ORDERING',
    subjectId: 'REQ-RESULT',
    status: 'SPECIFIED',
    rationale: 'Entradas equivalentes produzem o mesmo resultado em qualquer ordem.',
    targetIds: ['REQ-RESULT'],
    basis: userBasis,
    acceptanceCaseId: 'AC-ORDERING-PROOF',
    proofObligation: proof,
    inapplicabilityProof: null,
    closureAuthority: 'AUTHORITATIVE_RULE',
    counterexampleWitness: counterexampleForDimension('ORDERING'),
  }],
};
assertSemanticDraft(deterministicDraft, loadedPolicy.policy, validationContext);

function expectDeterminismFailure(mutator, expectedPrefix) {
  const invalid = structuredClone(deterministicDraft);
  mutator(invalid.determinismReview.dimensions[0], invalid);
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy, validationContext);
  } catch (error) {
    if (error.message.startsWith(expectedPrefix)) return;
    throw error;
  }
  throw new Error(`determinism_mismatch_was_not_rejected:${expectedPrefix}`);
}

expectDeterminismFailure(
  (dimension) => { dimension.proofObligation.resolutionKind = 'OVERFLOW_SATURATE'; },
  'determinism_resolution_kind_mismatch:',
);
expectDeterminismFailure(
  (dimension) => { dimension.proofObligation.relation = 'DEFINED_RESULT'; },
  'determinism_resolution_relation_mismatch:',
);
expectDeterminismFailure(
  (_dimension, invalid) => {
    invalid.requirements[0].acceptanceCases[2].then = 'Texto apenas relacionado ao tema.';
  },
  'determinism_proof_outcome_mismatch:',
);
expectDeterminismFailure(
  (dimension) => { dimension.targetIds = []; },
  'determinism_dimension_does_not_target_subject:',
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
if (confirmation.schema !== 'aegis.confirmation_request.v5'
  || confirmation.questionCount !== confirmation.questions.length
  || confirmation.bulkRecommendationAction.id !== 'ACCEPT_RECOMMENDED_REMAINING'
  || !confirmation.questions[0].presentation.context.includes('duas formas')
  || !confirmation.questions[0].presentation.whyHumanDecision.includes('Nenhuma fonte confiável')
  || !confirmation.questions[0].presentation.observableImpact.includes('dados devolvidos')
  || !confirmation.questions[0].presentation.recommendationReasoning.includes('forma simples')
  || confirmation.questions[0].distinguishingCase.outcomes.length !== 2
  || confirmation.questions[0].traceability.requirements[0].id !== 'REQ-RESULT'
  || confirmation.questions[0].traceability.requirements[0].statement.length === 0
  || confirmation.questions[0].traceability.acceptanceCases[0].id !== 'AC-RESULT-HAPPY'
  || confirmation.questions[0].traceability.invariants[0].id !== 'INV-EXPLICIT'
  || confirmation.questions[0].traceability.risks[0].id !== 'RISK-SILENCE') {
  throw new Error('wizard_question_omits_human_decision_context');
}
const resolution = {
  schema: 'aegis.semantic_resolution.v2',
  executionId: confirmation.executionId,
  contractDraftDigest: confirmation.contractDraftDigest,
  method: 'INTERACTIVE_WIZARD',
  attestation: 'DECISIONS_REVIEWED_AND_CONFIRMED',
  answers: [{ questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' }],
};
if (!resolutionRequiresRecompilation({ contract, request: confirmation, resolution })) {
  throw new Error('recommended_decision_bypassed_semantic_recompilation');
}
try {
  finalizeContractApproval({ contract, request: confirmation, resolution });
  throw new Error('contract_with_active_decision_was_approved');
} catch (error) {
  if (error.message !== 'semantic_recompilation_required') throw error;
}

const blocked = structuredClone(draft);
blocked.decisions = [];
blocked.intentClaims = blocked.intentClaims.filter(({ disposition }) => disposition !== 'DECISION');
blocked.fragmentDispositions[0].claimIds = ['CLAIM-RESULT'];
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
