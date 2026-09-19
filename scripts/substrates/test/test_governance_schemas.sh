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
  assertContractApprovalEvidence,
  assertSemanticDraft,
  buildConfirmationRequest,
  buildSemanticRequest,
  compileSemanticContract,
  finalizeContractApproval,
  loadSemanticConstitution,
  renderSemanticContractMarkdown,
  resolutionRequiresRecompilation,
} from './scripts/lib/semantic_contract.mjs';
import { buildPreflightHandoff, discoverWorkspace, loadArchitecturePolicy } from './scripts/lib/issue_contract_core.mjs';
import { assertSchema, schemaDocument, schemaErrors } from './scripts/lib/schema_validator.mjs';
import { parseSemanticState, semanticStateRelativePath } from './scripts/lib/semantic_state.mjs';
import { buildRejectionReport } from './scripts/lib/rejection_report.mjs';
import { detectIntentSignals } from './scripts/lib/intent_signals.mjs';
import {
  assertRoleAssignment,
  publicRoleAssignmentSummary,
} from './scripts/lib/role_assignment.mjs';

const schemaFiles = [
  'architecture-policy.v1.schema.json',
  'architecture-policy.v2.schema.json',
  'architecture-policy.v3.schema.json',
  'confirmation-request.v4.schema.json',
  'constitution.v1.schema.json',
  'issue-contract.v3.schema.json',
  'issue-contract.v4.schema.json',
  'issue-contract.v5.schema.json',
  'issue-contract.v6.schema.json',
  'issue-contract.v7.schema.json',
  'issue-contract.v8.schema.json',
  'issue-contract.v9.schema.json',
  'issue-contract.v10.schema.json',
  'issue-contract.v11.schema.json',
  'issue-contract.v12.schema.json',
  'preflight-handoff.v2.schema.json',
  'rejection.v1.schema.json',
  'role-assignment.v1.schema.json',
  'semantic-draft.v1.schema.json',
  'semantic-draft.v2.schema.json',
  'semantic-draft.v3.schema.json',
  'semantic-draft.v4.schema.json',
  'semantic-draft.v5.schema.json',
  'semantic-draft.v6.schema.json',
  'semantic-draft.v7.schema.json',
  'semantic-opinion.v1.schema.json',
  'semantic-request.v1.schema.json',
  'semantic-request.v2.schema.json',
  'semantic-request.v3.schema.json',
  'semantic-request.v4.schema.json',
  'semantic-request.v5.schema.json',
  'semantic-request.v6.schema.json',
  'semantic-request.v7.schema.json',
  'semantic-request.v8.schema.json',
  'semantic-worksheet.v1.schema.json',
  'semantic-resolution.v2.schema.json',
];
for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(`governance/schemas/${file}`, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
    || !schema.$id.startsWith('aegis.')) {
    throw new Error(`invalid_schema_metadata:${file}`);
  }
}

for (const rejection of [
  buildRejectionReport({
    phase: 'SEMANTIC',
    reason: 'INVALID_SEMANTIC_OPINION',
    detail: 'decision_answers_semantically_equivalent:Q-0001',
  }),
  buildRejectionReport({ phase: 'SETUP', reason: 'SETUP_VALUE_REQUIRED' }),
]) {
  assertSchema('aegis.rejection.v1', rejection);
}
const equivalentDecisionRejection = buildRejectionReport({
  phase: 'SEMANTIC',
  reason: 'INVALID_SEMANTIC_OPINION',
  detail: 'decision_answers_semantically_equivalent:Q-0001',
});
if (equivalentDecisionRejection.cause !== 'DECISION_ANSWERS_SEMANTICALLY_EQUIVALENT'
  || equivalentDecisionRejection.ruleId !== 'CONST-DECISIONS'
  || !equivalentDecisionRejection.remediation.includes('alternativas')) {
  throw new Error('semantic_rejection_is_not_actionable');
}
const unresolvedGapRejection = buildRejectionReport({
  phase: 'SEMANTIC',
  reason: 'unresolved_semantic_gap',
  detail: 'CANONICALIZATION',
});
if (unresolvedGapRejection.reason !== 'UNRESOLVED_SEMANTIC_GAP'
  || unresolvedGapRejection.ruleId !== 'CONST-OBSERVABLE'
  || !unresolvedGapRejection.remediation.includes('Wizard')) {
  throw new Error('unresolved_gap_rejection_is_not_actionable');
}

const roleAssignment = {
  schema: 'aegis.role_assignment.v1',
  roles: {
    contractSupervisor: {
      channel: 'API',
      adapter: 'openai-compatible',
      model: 'supervisor-model',
      credentialEnv: 'AEGIS_SUPERVISOR_API_KEY',
    },
    codingAgent: {
      channel: 'IDE',
      adapter: 'codex',
      model: null,
      credentialEnv: null,
    },
  },
};
assertRoleAssignment(roleAssignment);
const roleSummary = publicRoleAssignmentSummary(roleAssignment);
if (roleSummary.roles.contractSupervisor.credentialEnv !== 'AEGIS_SUPERVISOR_API_KEY'
  || roleSummary.roles.contractSupervisor.credentialAvailable !== false
  || roleSummary.roles.codingAgent.credentialEnv !== undefined
  || roleSummary.executionBoundary !== 'EXTERNAL_HUMAN_AUTHORIZATION_REQUIRED') {
  throw new Error('role_assignment_exposed_or_omitted_public_configuration');
}
if (schemaErrors('aegis.role_assignment.v1', {
  ...roleAssignment,
  roles: {
    ...roleAssignment.roles,
    contractSupervisor: { ...roleAssignment.roles.contractSupervisor, credentialEnv: null },
  },
}).length === 0) {
  throw new Error('role_assignment_accepted_api_without_environment_key');
}

const loadedPolicy = loadArchitecturePolicy(process.cwd());
const constitution = loadSemanticConstitution(process.cwd());
assertSchema('aegis.architecture_policy.v3', loadedPolicy.policy);
const preflight = buildPreflightHandoff({
  demand: 'Criar comportamento observável de teste com formato ainda a escolher.',
  discovery: discoverWorkspace(process.cwd(), 'Criar comportamento observável de teste com formato ainda a escolher.'),
});
const semanticRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight,
  policy: loadedPolicy.policy,
  constitution,
});
assertSchema('aegis.semantic_request.v8', semanticRequest);
const { requestDigest: semanticRequestDigest, ...semanticRequestPayload } = semanticRequest;
const expectedOutputSchema = schemaDocument('aegis.semantic_opinion.v1');
expectedOutputSchema.properties.worksheetDigest = { const: semanticRequest.worksheetDigest };
if (semanticRequest.constitution.digest !== constitution.digest
  || semanticRequest.constitution.rules.length !== 5
  || semanticRequestDigest !== canonicalDigest(semanticRequestPayload)
  || semanticRequest.outputSchema.digest !== canonicalDigest(expectedOutputSchema)
  || canonicalDigest(semanticRequest.outputSchema.document) !== canonicalDigest(expectedOutputSchema)
  || semanticRequest.outputSchema.document.properties.worksheetDigest.const
    !== semanticRequest.worksheetDigest
  || semanticRequest.worksheetDigest !== canonicalDigest(semanticRequest.worksheet)
  || semanticRequest.worksheet.contextDigest !== semanticRequest.contextDigest
  || semanticRequest.intentSignals.status !== 'CLEAR'
  || semanticRequest.intentSignals.signals.length !== 0
  || semanticRequest.policy.signalSemantics.verdict !== 'SEMANTIC_NOT_LEXICAL'
  || semanticRequest.policy.signalSemantics.residualReview
    !== 'SEPARATE_FROM_POLICY_ASSESSMENT') {
  throw new Error('semantic_request_omitted_authoritative_inputs');
}

const userBasis = [{ source: 'USER_INTENT', reference: 'comportamento observável' }];
const modelBasis = [{ source: 'MODEL_ANALYSIS', reference: 'analysis' }];
const determinismBasis = [{ source: 'CONSTITUTION', reference: 'CONST-OBSERVABLE' }];
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
  schema: 'aegis.semantic_draft.v7',
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
  riskReview: {
    status: 'FOUND',
    rationale: 'Foi identificado risco de falha silenciosa.',
  },
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
    rationale: 'A demanda não promete determinismo.',
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
      { id: 'ANS-SIMPLE', label: 'Simples', rationale: 'Menor superfície pública.', contractEffect: 'Um resultado explícito deve ser observado.', recommended: true },
      { id: 'ANS-DETAIL', label: 'Detalhado', rationale: 'Expõe mais dados.', contractEffect: 'Um resultado detalhado com metadados deve ser observado.', recommended: false },
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

const unresolvedNormativeExpression = structuredClone(draft);
unresolvedNormativeExpression.requirements[0].acceptanceCases[1].then = 'Uma falha explícita deve ser observada ().';
let unresolvedNormativeExpressionRejected = false;
try {
  assertSemanticDraft(unresolvedNormativeExpression, loadedPolicy.policy, semanticValidationContext);
} catch (error) {
  unresolvedNormativeExpressionRejected = error.message.startsWith(
    'unresolved_expression_in_normative_text:',
  );
}
if (!unresolvedNormativeExpressionRejected) {
  throw new Error('incomplete_marker_survived_in_normative_contract');
}

const pendingDecisionClaimedAsResolved = structuredClone(draft);
pendingDecisionClaimedAsResolved.adversarialReview.findings[0] = {
  ...pendingDecisionClaimedAsResolved.adversarialReview.findings[0],
  response: 'Um resultado explícito deve ser observado.',
  targetIds: ['REQ-RESULT'],
};
let pendingDecisionClaimedAsResolvedRejected = false;
try {
  assertSemanticDraft(pendingDecisionClaimedAsResolved, loadedPolicy.policy, semanticValidationContext);
} catch (error) {
  pendingDecisionClaimedAsResolvedRejected = error.message.startsWith(
    'pending_decision_presented_as_resolved:',
  );
}
if (!pendingDecisionClaimedAsResolvedRejected) {
  throw new Error('adversarial_review_preapproved_pending_decision');
}

const equivalentIntegerDecision = structuredClone(draft);
equivalentIntegerDecision.decisions[0].answers[0].contractEffect = 'O bit deve ativar quando o volume for estritamente maior que 0.';
equivalentIntegerDecision.decisions[0].answers[1].contractEffect = 'O bit deve ativar quando o volume for maior ou igual a 1.';
equivalentIntegerDecision.requirements[0].acceptanceCases[0].then = equivalentIntegerDecision
  .decisions[0].answers[0].contractEffect;
equivalentIntegerDecision.unknowns[0].basis.push({
  source: 'USER_INTENT',
  reference: 'maior que 0 ou maior ou igual a 1',
});
let equivalentIntegerDecisionRejected = false;
try {
  assertSemanticDraft(equivalentIntegerDecision, loadedPolicy.policy, {
    ...semanticValidationContext,
    intent: `${preflight.intent} Usar BigInt com maior que 0 ou maior ou igual a 1.`,
  });
} catch (error) {
  equivalentIntegerDecisionRejected = error.message.startsWith(
    'decision_answers_semantically_equivalent:',
  ) && error.message.includes('ANS-SIMPLE=MIN:1')
    && error.message.includes('ANS-DETAIL=MIN:1');
}
if (!equivalentIntegerDecisionRejected) {
  throw new Error('equivalent_integer_thresholds_reached_wizard');
}
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
  || contract.sourceSemanticRequestDigest !== semanticRequest.requestDigest
  || contract.semanticRevision !== null
  || contract.constitutionDigest !== constitution.digest
  || contract.schema !== 'aegis.issue_contract.v12'
  || contract.approval !== null
  || contract.humanResolutions.length !== 0
  || contract.specification.decisions[0].recommendedAnswerId !== 'ANS-SIMPLE') {
  throw new Error('mechanical_contract_fields_were_not_injected');
}
const tamperedSemanticRequestDigest = {
  ...contract,
  sourceSemanticRequestDigest: '0'.repeat(64),
};
let semanticRequestTamperRejected = false;
try {
  assertContractDocument({
    repositoryRoot: process.cwd(),
    contract: tamperedSemanticRequestDigest,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
  });
} catch {
  semanticRequestTamperRejected = true;
}
if (!semanticRequestTamperRejected) throw new Error('semantic_request_digest_was_not_bound');
const humanContract = renderSemanticContractMarkdown(contract, {
  policyRules: loadedPolicy.policy.rules,
});
if (humanContract.includes(preflight.intent)
  || humanContract.includes('## 8. Lacunas declaradas')
  || !humanContract.includes('**Lacuna:** O formato final do resultado não foi definido.')
  || !humanContract.includes('## 8. Parecer adversarial')) {
  throw new Error('human_contract_retained_redundant_sections');
}
if (schemaErrors('aegis.issue_contract.v12', { ...contract, implementationAuthorized: true }).length === 0) {
  throw new Error('contract_authorized_implementation');
}

const gapIntent = 'Processar em alta frequência com fração cuja fórmula ainda deve ser escolhida () e volume acima de .';
const gapPreflight = buildPreflightHandoff({
  demand: gapIntent,
  discovery: discoverWorkspace(process.cwd(), gapIntent),
});
const gapRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: gapPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const gapSignals = gapRequest.intentSignals.signals;
if (gapRequest.intentSignals.status !== 'REVIEW_REQUIRED'
  || gapSignals.length !== 3
  || gapSignals[0].kind !== 'QUALITY_GOAL'
  || gapSignals[0].handling !== 'NON_NORMATIVE_GOAL'
  || gapSignals.slice(1).some(({ kind }) => kind !== 'INCOMPLETE_EXPRESSION')
  || detectIntentSignals('Executar calcular() e usar () => valor.').length !== 0) {
  throw new Error('intent_review_signals_are_not_conservative');
}
const quantifiedQualitySignals = detectIntentSignals('Latência máxima de 10 ms e zero-GC friendly.');
if (quantifiedQualitySignals.length !== 2
  || quantifiedQualitySignals[0].handling !== 'MEASURABLE_REQUIREMENT'
  || quantifiedQualitySignals[1].handling !== 'NON_NORMATIVE_GOAL') {
  throw new Error('quality_goal_was_promoted_to_fabricated_target');
}
const allocationSignals = detectIntentSignals('Executar sem recorrer a ponto flutuante, bibliotecas externas ou alocações intermediárias de buffers no hot path (Zero-GC friendly).');
if (allocationSignals.length !== 2
  || allocationSignals[0].kind !== 'QUALITY_CONSTRAINT'
  || allocationSignals[0].handling !== 'MEASURABLE_REQUIREMENT'
  || allocationSignals[1].kind !== 'QUALITY_GOAL'
  || allocationSignals[1].handling !== 'NON_NORMATIVE_GOAL') {
  throw new Error('explicit_allocation_prohibition_was_weakened_to_goal');
}
const arithmeticSignals = detectIntentSignals('Calcular uma saída de 64 bits usando multiplicação e XOR.');
if (!arithmeticSignals.some(({ kind }) => kind === 'BOUNDED_VALUE')
  || arithmeticSignals.filter(({ kind }) => kind === 'ARITHMETIC_SEMANTICS').length !== 2) {
  throw new Error('bounded_arithmetic_was_confused_with_output_width');
}

const gapDraft = structuredClone(draft);
gapDraft.sourceContextDigest = gapRequest.contextDigest;
gapDraft.intentClaims = [
  {
    id: 'CLAIM-PROCESS',
    quote: 'Processar',
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: 'Processar com resultado público explícito.',
    targetIds: ['REQ-RESULT'],
    rationale: 'A demanda solicita processamento observável.',
  },
  {
    id: 'CLAIM-HIGH-FREQUENCY',
    quote: 'alta frequência',
    kind: 'GOAL',
    disposition: 'NON_NORMATIVE',
    contractEffect: null,
    targetIds: ['NOTE-HIGH-FREQUENCY'],
    rationale: 'Não há alvo quantitativo autorizado.',
  },
  {
    id: 'CLAIM-FRACTION-GAP',
    quote: 'fórmula ainda deve ser escolhida ()',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-FORMAT'],
    rationale: 'A fórmula está ausente.',
  },
  {
    id: 'CLAIM-LIMIT-GAP',
    quote: 'acima de',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-EXPRESSION'],
    rationale: 'O comparador não informa o limite.',
  },
];
gapDraft.nonNormativeItems = [{
  id: 'NOTE-HIGH-FREQUENCY',
  kind: 'GOAL',
  statement: 'Favorecer alta frequência sem converter o adjetivo em SLO.',
  status: 'NON_NORMATIVE',
  intentSignalIds: [gapSignals[0].id],
  basis: [{ source: 'USER_INTENT', reference: 'alta frequência' }],
}];
gapDraft.architectureContexts[0].basis = [{ source: 'USER_INTENT', reference: 'Processar' }];
gapDraft.requirements[0].statement = 'Processar com resultado público explícito.';
gapDraft.requirements[0].basis = [{ source: 'USER_INTENT', reference: 'Processar' }];
gapDraft.requirements[0].intentSignalIds = [];
gapDraft.requirements[0].acceptanceCases[0].then = 'A fração deve seguir a fórmula explicitamente escolhida.';
gapDraft.requirements[0].acceptanceCases[1].then = 'O limite comparado deve ser o valor explicitamente escolhido.';
gapDraft.unknowns = [
  {
    id: 'UNKNOWN-FRACTION',
    statement: 'A fórmula da fração está ausente.',
    material: true,
    decisionId: 'Q-FORMAT',
    intentSignalIds: [gapSignals[1].id],
    basis: [{ source: 'USER_INTENT', reference: 'fórmula ainda deve ser escolhida ()' }],
  },
  {
    id: 'UNKNOWN-LIMIT',
    statement: 'O limite comparado está ausente.',
    material: true,
    decisionId: 'Q-EXPRESSION',
    intentSignalIds: [gapSignals[2].id],
    basis: [{ source: 'USER_INTENT', reference: 'acima de' }],
  },
];
gapDraft.decisions = [
  {
    questionId: 'Q-FORMAT',
    question: 'Qual fórmula deve calcular a fração?',
    recommendedAnswerId: 'ANS-SIMPLE',
    requirementIds: ['REQ-RESULT'],
    invariantIds: ['INV-EXPLICIT'],
    riskIds: [],
    distinguishingCase: {
      given: 'Uma ordem com liquidação parcial.',
      when: 'A fração for calculada.',
      outcomes: [
        { answerId: 'ANS-SIMPLE', then: 'Uma fração calculada deve ser observada.' },
        { answerId: 'ANS-DETAIL', then: 'Nenhum cálculo fracionário deve ser observado.' },
      ],
    },
    answers: [
      {
        id: 'ANS-SIMPLE',
        label: 'Fórmula explícita',
        rationale: 'Define o comportamento antes da assinatura.',
        contractEffect: 'A fração deve seguir a fórmula explicitamente escolhida.',
        recommended: true,
      },
      {
        id: 'ANS-DETAIL',
        label: 'Remover a fração',
        rationale: 'Retira o comportamento incompleto.',
        contractEffect: 'O contrato não deve exigir cálculo fracionário.',
        recommended: false,
      },
    ],
  },
  {
    questionId: 'Q-EXPRESSION',
    question: 'Qual valor deve ser comparado?',
    recommendedAnswerId: 'ANS-EXPLICIT',
    requirementIds: ['REQ-RESULT'],
    invariantIds: ['INV-EXPLICIT'],
    riskIds: [],
    distinguishingCase: {
      given: 'Um volume candidato à comparação.',
      when: 'A regra de limite for avaliada.',
      outcomes: [
        { answerId: 'ANS-EXPLICIT', then: 'O valor deve ser comparado com o limite escolhido.' },
        { answerId: 'ANS-REMOVE', then: 'Nenhuma comparação de volume deve ser realizada.' },
      ],
    },
    answers: [
      {
        id: 'ANS-EXPLICIT',
        label: 'Limite explícito',
        rationale: 'Elimina o comparador incompleto.',
        contractEffect: 'O limite comparado deve ser o valor explicitamente escolhido.',
        recommended: true,
      },
      {
        id: 'ANS-REMOVE',
        label: 'Remover comparação',
        rationale: 'Retira o comportamento incompleto.',
        contractEffect: 'O contrato não deve exigir comparação de volume.',
        recommended: false,
      },
    ],
  },
];
gapDraft.requirements[0].acceptanceCases[0].decisionBinding = {
  questionId: 'Q-FORMAT',
  answerId: 'ANS-SIMPLE',
};
gapDraft.requirements[0].acceptanceCases[1].decisionBinding = {
  questionId: 'Q-EXPRESSION',
  answerId: 'ANS-EXPLICIT',
};
const gapContext = {
  constitutionRules: constitution.rules,
  intent: gapIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: gapRequest.workspace.sourceEvidence,
};
assertSemanticDraft(gapDraft, loadedPolicy.policy, gapContext);

const fabricatedQualityDraft = structuredClone(gapDraft);
fabricatedQualityDraft.requirements[0].kind = 'QUALITY';
fabricatedQualityDraft.requirements[0].intentSignalIds = [gapSignals[0].id];
fabricatedQualityDraft.requirements[0].measurement = {
  method: 'Benchmark local.',
  metric: 'Operações por segundo.',
  target: {
    value: '100000 operações/s',
    source: 'MODEL_PROPOSAL',
    reference: 'analysis',
    evidenceStatus: 'UNVERIFIED',
  },
  conditions: 'Ambiente fixo.',
};
let fabricatedQualityRejected = false;
try {
  assertSemanticDraft(fabricatedQualityDraft, loadedPolicy.policy, gapContext);
} catch {
  fabricatedQualityRejected = true;
}
if (!fabricatedQualityRejected) throw new Error('model_proposal_became_normative_requirement');

const resolvedGapDraft = structuredClone(gapDraft);
resolvedGapDraft.requirements[0].intentSignalIds = gapSignals.slice(1).map(({ id }) => id);
resolvedGapDraft.requirements[0].basis = [
  { source: 'USER_DECISION', reference: 'Q-FORMAT' },
  { source: 'USER_DECISION', reference: 'Q-EXPRESSION' },
];
for (const acceptanceCase of resolvedGapDraft.requirements[0].acceptanceCases) {
  acceptanceCase.decisionBinding = null;
}
resolvedGapDraft.unknowns = [];
resolvedGapDraft.decisions = [];
assertSemanticDraft(resolvedGapDraft, loadedPolicy.policy, {
  ...gapContext,
  resolvedDecisionIds: ['Q-FORMAT', 'Q-EXPRESSION'],
  humanResolutions: [
    {
      questionId: 'Q-FORMAT',
      kind: 'ANSWER',
      label: 'Fórmula explícita',
      contractEffect: 'A fração deve seguir a fórmula explicitamente escolhida.',
    },
    {
      questionId: 'Q-EXPRESSION',
      kind: 'ANSWER',
      label: 'Limite explícito',
      contractEffect: 'O limite comparado deve ser o valor explicitamente escolhido.',
    },
  ],
});

for (const mutate of [
  (value) => { value.unknowns[1].intentSignalIds = []; },
  (value) => { value.nonNormativeItems = []; },
  (value) => { value.intentClaims = value.intentClaims.filter(({ id }) => id !== 'CLAIM-HIGH-FREQUENCY'); },
  (value) => { value.requirements[0].acceptanceCases[0].decisionBinding = null; },
  (value) => { value.decisions[0].answers[0].contractEffect = 'Efeito apenas nominal.'; },
  (value) => { value.scope.inScope = ['src/index.ts']; },
  (value) => { value.requirements[0].statement += ' usando BigUint64Array.'; },
  (value) => { value.intentClaims[0].contractEffect = 'Efeito que omite a citação literal.'; },
  (value) => { value.requirements[0].statement = 'Resultado público explícito.'; },
  (value) => {
    value.intentClaims.find(({ id }) => id === 'CLAIM-FRACTION-GAP').quote = '()';
    value.unknowns.find(({ id }) => id === 'UNKNOWN-FRACTION').basis = [
      { source: 'USER_INTENT', reference: '()' },
    ];
  },
  (value) => {
    const decision = value.decisions.find(({ questionId }) => questionId === 'Q-EXPRESSION');
    const inventedEffect = 'O limite comparado deve ser 1000000.';
    decision.answers.find(({ id }) => id === decision.recommendedAnswerId).contractEffect = inventedEffect;
    value.requirements[0].acceptanceCases
      .find(({ decisionBinding }) => decisionBinding?.questionId === decision.questionId).then = inventedEffect;
  },
]) {
  const invalid = structuredClone(gapDraft);
  mutate(invalid);
  let rejected = false;
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy, gapContext);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('intent_completeness_gate_accepted_false_precision');
}
const gapContract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft: gapDraft,
  preflight: gapPreflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (canonicalDigest(gapContract.intentSignals) !== canonicalDigest(gapSignals)
  || !renderSemanticContractMarkdown(gapContract).includes('Itens não normativos')) {
  throw new Error('contract_omitted_intent_signals_or_quality_goal');
}

const determinismAbsenceRules = {
  DUPLICATES: 'Não existem elementos duplicados na fronteira pública contratada.',
  EMPTY_INPUT: 'Não existe coleção vazia na fronteira pública contratada.',
  ODD_CARDINALITY: 'Não existe coleção de cardinalidade ímpar na fronteira pública contratada.',
  ROUNDING: 'Não existe divisão não exata na fronteira pública contratada.',
  REMAINDER_DISTRIBUTION: 'Não existe distribuição de resto na fronteira pública contratada.',
  ZERO_DIVISOR: 'Não existe divisor zero na fronteira pública contratada.',
  TIE_BREAKING: 'Não existem candidatos empatados na fronteira pública contratada.',
  COUNTING_IDENTITY: 'Não existe contagem de identidades na fronteira pública contratada.',
  BOUNDED_ARITHMETIC: 'Não existe aritmética limitada na fronteira pública contratada.',
};
const orderingRule = 'Os campos ordenados alfabeticamente são preservados após permutar elementos equivalentes.';
const determinismAbsenceRule = Object.values(determinismAbsenceRules).join(' ');
const deterministicIntent = `Produzir saída determinística e manter o formato ainda a escolher. ${orderingRule} ${determinismAbsenceRule}`;
const deterministicPreflight = buildPreflightHandoff({
  demand: deterministicIntent,
  discovery: discoverWorkspace(process.cwd(), deterministicIntent),
});
const deterministicRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: deterministicPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const deterministicSignal = deterministicRequest.intentSignals.signals
  .find(({ kind }) => kind === 'DETERMINISM_CLAIM');
if (deterministicSignal?.handling !== 'DETERMINISM_REVIEW') {
  throw new Error('determinism_claim_was_not_detected');
}
if (deterministicRequest.worksheet.requiredDeterminismDimensions.length !== 11
  || deterministicRequest.worksheet.counterexampleWitnesses.length !== 11) {
  throw new Error('deterministic_worksheet_omitted_review_slots');
}
const deterministicWitnesses = new Map(deterministicRequest.worksheet.counterexampleWitnesses
  .map((witness) => [witness.dimension, witness]));
const deterministicDraft = structuredClone(draft);
deterministicDraft.sourceContextDigest = deterministicRequest.contextDigest;
deterministicDraft.intentClaims = [
  {
    id: 'CLAIM-DETERMINISTIC-OUTPUT',
    quote: 'saída determinística',
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: 'A saída determinística deve ser explícita.',
    targetIds: ['REQ-RESULT'],
    rationale: 'A demanda promete resultado determinístico.',
  },
  {
    id: 'CLAIM-DETERMINISTIC-ORDER',
    quote: orderingRule,
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: orderingRule,
    targetIds: ['REQ-RESULT'],
    rationale: 'A demanda fornece uma regra concreta de ordenação.',
  },
  {
    id: 'CLAIM-DETERMINISTIC-FORMAT',
    quote: 'formato ainda a escolher',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-FORMAT'],
    rationale: 'O formato permanece aberto.',
  },
];
deterministicDraft.architectureContexts[0].basis = [{ source: 'USER_INTENT', reference: 'saída determinística' }];
deterministicDraft.requirements[0].statement = `A saída determinística deve ser explícita. ${orderingRule}`;
deterministicDraft.requirements[0].basis = [{ source: 'USER_INTENT', reference: 'saída determinística' }];
deterministicDraft.requirements[0].acceptanceCases.push({
  id: 'AC-DETERMINISTIC-REPLAY',
  kind: 'HAPPY_PATH',
  given: `${deterministicWitnesses.get('ORDERING').baseline} ${deterministicWitnesses.get('ORDERING').variation}`,
  when: 'As duas variações forem processadas sob o mesmo contexto.',
  then: orderingRule,
  outcomeKind: 'RETURN_VALUE',
  decisionBinding: null,
  boundaryBinding: null,
});
deterministicDraft.unknowns[0].basis = [{ source: 'USER_INTENT', reference: 'formato ainda a escolher' }];
deterministicDraft.adversarialReview.findings[0].kind = 'DETERMINISM_GAP';
deterministicDraft.adversarialReview.findings[0].challenge = 'Representações equivalentes podem divergir enquanto o formato público estiver em aberto.';
deterministicDraft.determinismReview = {
  status: 'GAPS_FOUND',
  rationale: 'Todas as dimensões universais foram classificadas; canonicalização depende da escolha humana de formato.',
  intentSignalIds: [deterministicSignal.id],
  dimensions: [
    {
      kind: 'ORDERING',
      subjectId: 'REQ-RESULT',
      status: 'SPECIFIED',
      rationale: orderingRule,
      targetIds: ['REQ-RESULT'],
      basis: [{ source: 'USER_INTENT', reference: orderingRule }],
      acceptanceCaseId: 'AC-DETERMINISTIC-REPLAY',
      proofObligation: {
        witnessId: 'WITNESS-ORDERING',
        relation: 'OUTPUTS_EQUAL',
        observables: ['campos ordenados alfabeticamente'],
      },
      closureAuthority: 'AUTHORITATIVE_RULE',
      counterexampleWitness: deterministicWitnesses.get('ORDERING'),
      inapplicabilityProof: null,
    },
    {
      kind: 'CANONICALIZATION',
      subjectId: 'REQ-RESULT',
      status: 'DECISION_REQUIRED',
      rationale: 'A representação canônica depende do formato público ainda não escolhido.',
      targetIds: ['REQ-RESULT', 'Q-FORMAT'],
      basis: [{ source: 'MODEL_ANALYSIS', reference: 'analysis' }],
      acceptanceCaseId: null,
      proofObligation: null,
      closureAuthority: 'MODEL_ARGUMENT',
      counterexampleWitness: deterministicWitnesses.get('CANONICALIZATION'),
      inapplicabilityProof: null,
    },
    ...['DUPLICATES', 'EMPTY_INPUT', 'ODD_CARDINALITY', 'ROUNDING', 'REMAINDER_DISTRIBUTION', 'ZERO_DIVISOR', 'TIE_BREAKING', 'COUNTING_IDENTITY', 'BOUNDED_ARITHMETIC'].map((kind) => ({
      kind,
      subjectId: 'PUBLIC_CONTRACT',
      status: 'NOT_APPLICABLE',
      rationale: determinismAbsenceRules[kind],
      targetIds: [],
      basis: [{ source: 'USER_INTENT', reference: determinismAbsenceRules[kind] }],
      acceptanceCaseId: null,
      proofObligation: null,
      closureAuthority: 'AUTHORITATIVE_RULE',
      counterexampleWitness: deterministicWitnesses.get(kind),
      inapplicabilityProof: {
        proofKind: 'STRUCTURAL_ABSENCE',
        absentStructure: deterministicWitnesses.get(kind).inputClass,
        evidence: determinismAbsenceRules[kind],
      },
    })),
  ],
};
const deterministicContext = {
  constitutionRules: constitution.rules,
  intent: deterministicIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: deterministicRequest.workspace.sourceEvidence,
};
assertSemanticDraft(deterministicDraft, loadedPolicy.policy, deterministicContext);
const pendingDeterminismContract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft: deterministicDraft,
  preflight: deterministicPreflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (pendingDeterminismContract.effectiveDeterminismStatus !== 'PENDING_HUMAN_DECISIONS') {
  throw new Error('pending_determinism_was_reported_as_complete');
}
const pendingDeterminismRequest = buildConfirmationRequest(pendingDeterminismContract);
const approvedDeterminismContract = finalizeContractApproval({
  contract: pendingDeterminismContract,
  request: pendingDeterminismRequest,
  resolution: {
    schema: 'aegis.semantic_resolution.v2',
    executionId: pendingDeterminismRequest.executionId,
    contractDraftDigest: pendingDeterminismRequest.contractDraftDigest,
    method: 'INTERACTIVE_WIZARD',
    attestation: 'CONTRACT_REVIEWED_AND_APPROVED',
    answers: [{ questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' }],
  },
});
if (approvedDeterminismContract.effectiveDeterminismStatus !== 'SEMANTICALLY_CLOSED') {
  throw new Error('human_determinism_decision_did_not_close_effective_status');
}

const unresolvedDeterminismDraft = structuredClone(deterministicDraft);
const unresolvedCanonicalization = unresolvedDeterminismDraft.determinismReview.dimensions
  .find(({ kind }) => kind === 'CANONICALIZATION');
unresolvedCanonicalization.status = 'GAP_FOUND';
unresolvedCanonicalization.rationale = 'Não existe evidência suficiente para fechar canonicalização nem alternativas maduras para decisão.';
unresolvedCanonicalization.targetIds = ['REQ-RESULT'];
const unresolvedDeterminismContract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft: unresolvedDeterminismDraft,
  preflight: deterministicPreflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (unresolvedDeterminismContract.effectiveDeterminismStatus !== 'BLOCKED_BY_GAP') {
  throw new Error('unresolved_determinism_gap_was_not_fail_closed');
}
let unresolvedGapReachedWizard = false;
try {
  buildConfirmationRequest(unresolvedDeterminismContract);
  unresolvedGapReachedWizard = true;
} catch (error) {
  if (!error.message.startsWith('unresolved_semantic_gap:CANONICALIZATION')) throw error;
}
if (unresolvedGapReachedWizard) throw new Error('unresolved_semantic_gap_reached_wizard');

const omittedDeterminismReview = structuredClone(deterministicDraft);
omittedDeterminismReview.determinismReview = {
  status: 'NOT_APPLICABLE',
  rationale: 'Revisão omitida.',
  intentSignalIds: [],
  dimensions: [],
};
let omittedDeterminismRejected = false;
try {
  assertSemanticDraft(omittedDeterminismReview, loadedPolicy.policy, deterministicContext);
} catch {
  omittedDeterminismRejected = true;
}
if (!omittedDeterminismRejected) throw new Error('determinism_review_was_optional');

const falselySpecifiedDeterminism = structuredClone(deterministicDraft);
falselySpecifiedDeterminism.determinismReview.dimensions
  .find(({ kind }) => kind === 'CANONICALIZATION').status = 'SPECIFIED';
falselySpecifiedDeterminism.determinismReview.dimensions
  .find(({ kind }) => kind === 'CANONICALIZATION').targetIds = ['REQ-RESULT'];
let falseClosureRejected = false;
try {
  assertSemanticDraft(falselySpecifiedDeterminism, loadedPolicy.policy, deterministicContext);
} catch {
  falseClosureRejected = true;
}
if (!falseClosureRejected) throw new Error('determinism_dimension_closed_by_reference_only');

const selfCertifiedDeterminism = structuredClone(deterministicDraft);
const selfCertifiedOrdering = selfCertifiedDeterminism.determinismReview.dimensions
  .find(({ kind }) => kind === 'ORDERING');
selfCertifiedOrdering.basis = modelBasis;
selfCertifiedOrdering.closureAuthority = 'MODEL_ARGUMENT';
let selfCertificationRejected = false;
try {
  assertSemanticDraft(selfCertifiedDeterminism, loadedPolicy.policy, deterministicContext);
} catch (error) {
  selfCertificationRejected = error.message.startsWith(
    'specified_determinism_dimension_without_exact_proof:',
  );
}
if (!selfCertificationRejected) throw new Error('model_certified_its_own_determinism_claim');

const tamperedCounterexample = structuredClone(deterministicDraft);
tamperedCounterexample.determinismReview.dimensions
  .find(({ kind }) => kind === 'ODD_CARDINALITY').counterexampleWitness.inputClass = 'EMPTY_COLLECTION';
let tamperedCounterexampleRejected = false;
try {
  assertSemanticDraft(tamperedCounterexample, loadedPolicy.policy, deterministicContext);
} catch (error) {
  tamperedCounterexampleRejected = error.message.startsWith(
    'determinism_dimension_witness_mismatch:',
  );
}
if (!tamperedCounterexampleRejected) throw new Error('model_replaced_mechanical_counterexample');

const genericDeterminismAsAbsence = structuredClone(deterministicDraft);
const genericDuplicateDimension = genericDeterminismAsAbsence.determinismReview.dimensions
  .find(({ kind }) => kind === 'DUPLICATES');
genericDuplicateDimension.rationale = 'Produzir saída determinística';
genericDuplicateDimension.basis = [{ source: 'USER_INTENT', reference: 'Produzir saída determinística' }];
genericDuplicateDimension.inapplicabilityProof.evidence = 'Produzir saída determinística';
let genericDeterminismRejected = false;
try {
  assertSemanticDraft(genericDeterminismAsAbsence, loadedPolicy.policy, deterministicContext);
} catch (error) {
  genericDeterminismRejected = error.message.startsWith(
    'inapplicable_determinism_dimension_without_structural_absence:',
  );
}
if (!genericDeterminismRejected) throw new Error('global_determinism_claim_proved_structural_absence');

const invariantMisclassifiedAsInapplicable = structuredClone(deterministicDraft);
const inapplicableOrdering = invariantMisclassifiedAsInapplicable.determinismReview.dimensions
  .find(({ kind }) => kind === 'ORDERING');
const orderingAbsenceClaim = 'Não existe ordenação na fronteira pública contratada.';
inapplicableOrdering.subjectId = 'PUBLIC_CONTRACT';
inapplicableOrdering.status = 'NOT_APPLICABLE';
inapplicableOrdering.rationale = orderingAbsenceClaim;
inapplicableOrdering.targetIds = [];
inapplicableOrdering.basis = [{ source: 'USER_INTENT', reference: orderingAbsenceClaim }];
inapplicableOrdering.acceptanceCaseId = null;
inapplicableOrdering.proofObligation = null;
inapplicableOrdering.inapplicabilityProof = {
  proofKind: 'STRUCTURAL_ABSENCE',
  absentStructure: 'PERMUTED_EQUIVALENT_INPUTS',
  evidence: orderingAbsenceClaim,
};
let invariantMisclassificationRejected = false;
try {
  assertSemanticDraft(invariantMisclassifiedAsInapplicable, loadedPolicy.policy, {
    ...deterministicContext,
    intent: `${deterministicIntent} ${orderingAbsenceClaim}`,
  });
} catch (error) {
  invariantMisclassificationRejected = error.message.startsWith(
    'inapplicable_determinism_dimension_without_structural_absence:',
  );
}
if (!invariantMisclassificationRejected) throw new Error('specified_invariance_was_treated_as_not_applicable');

const applicableZeroDivisor = structuredClone(deterministicDraft);
applicableZeroDivisor.requirements[0].acceptanceCases.push({
  id: 'AC-ZERO-DIVISOR',
  kind: 'FAILURE',
  given: 'Um denominador igual a zero.',
  when: 'A operação aritmética for solicitada.',
  then: 'Um denominador igual a zero deve causar rejeição explícita.',
  outcomeKind: 'REJECTION',
  decisionBinding: null,
  boundaryBinding: null,
});
let applicableZeroDivisorRejected = false;
try {
  assertSemanticDraft(applicableZeroDivisor, loadedPolicy.policy, deterministicContext);
} catch (error) {
  applicableZeroDivisorRejected = error.message.startsWith(
    'inapplicable_determinism_dimension_without_structural_absence:ZERO_DIVISOR',
  );
  if (!applicableZeroDivisorRejected) throw error;
}
if (!applicableZeroDivisorRejected) throw new Error('specified_zero_divisor_was_treated_as_not_applicable');

const unboundMetamorphicWitness = structuredClone(deterministicDraft);
unboundMetamorphicWitness.requirements[0].acceptanceCases
  .find(({ id }) => id === 'AC-DETERMINISTIC-REPLAY').given = 'Somente o caso base foi descrito.';
let unboundMetamorphicWitnessRejected = false;
try {
  assertSemanticDraft(unboundMetamorphicWitness, loadedPolicy.policy, deterministicContext);
} catch (error) {
  unboundMetamorphicWitnessRejected = error.message.startsWith(
    'specified_determinism_dimension_without_exact_proof:',
  );
}
if (!unboundMetamorphicWitnessRejected) throw new Error('specified_dimension_omitted_witness_variation');

const genericMetamorphicObservable = structuredClone(deterministicDraft);
genericMetamorphicObservable.determinismReview.dimensions
  .find(({ kind }) => kind === 'ORDERING').proofObligation.observables = ['resultado'];
let genericMetamorphicObservableRejected = false;
try {
  assertSemanticDraft(genericMetamorphicObservable, loadedPolicy.policy, deterministicContext);
} catch (error) {
  genericMetamorphicObservableRejected = error.message.startsWith(
    'specified_determinism_dimension_without_exact_proof:',
  );
}
if (!genericMetamorphicObservableRejected) throw new Error('generic_result_was_accepted_as_observable_proof');

const missingIndependenceProof = structuredClone(deterministicDraft);
missingIndependenceProof.determinismReview.dimensions
  .find(({ kind }) => kind === 'DUPLICATES').inapplicabilityProof = null;
let missingIndependenceProofRejected = false;
try {
  assertSemanticDraft(missingIndependenceProof, loadedPolicy.policy, deterministicContext);
} catch (error) {
  missingIndependenceProofRejected = error.message.startsWith(
    'inapplicable_determinism_dimension_without_structural_absence:',
  );
}
if (!missingIndependenceProofRejected) {
  throw new Error('not_applicable_closed_without_independence_proof');
}

const tautologicalDeterminism = structuredClone(deterministicDraft);
const orderingDimension = tautologicalDeterminism.determinismReview.dimensions
  .find(({ kind }) => kind === 'ORDERING');
orderingDimension.rationale = 'A mesma entrada deve produzir a mesma saída.';
orderingDimension.closureAuthority = 'MODEL_ARGUMENT';
tautologicalDeterminism.requirements[0].acceptanceCases
  .find(({ id }) => id === 'AC-DETERMINISTIC-REPLAY').then = orderingDimension.rationale;
let tautologicalDeterminismRejected = false;
try {
  assertSemanticDraft(tautologicalDeterminism, loadedPolicy.policy, deterministicContext);
} catch (error) {
  tautologicalDeterminismRejected = error.message.startsWith(
    'specified_determinism_dimension_without_exact_proof:',
  );
}
if (!tautologicalDeterminismRejected) {
  throw new Error('tautology_was_accepted_as_determinism_rule');
}

const ambiguousOutcomeDraft = structuredClone(draft);
ambiguousOutcomeDraft.requirements[0].acceptanceCases[0].then = 'A operação deve retornar zero ou rejeitar a entrada.';
let ambiguousOutcomeRejected = false;
try {
  assertSemanticDraft(ambiguousOutcomeDraft, loadedPolicy.policy, {
    constitutionRules: constitution.rules,
    intent: preflight.intent,
    resolvedDecisionIds: [],
    workspaceEvidence: semanticRequest.workspace.sourceEvidence,
  });
} catch (error) {
  ambiguousOutcomeRejected = error.message.startsWith('ambiguous_observable_outcome:');
}
if (!ambiguousOutcomeRejected) throw new Error('alternative_outcomes_were_treated_as_specified');

const conflictingOutcomeDraft = structuredClone(draft);
conflictingOutcomeDraft.requirements[0].acceptanceCases.push({
  ...structuredClone(conflictingOutcomeDraft.requirements[0].acceptanceCases[0]),
  id: 'AC-RESULT-CONFLICT',
  then: 'A operação deve rejeitar a mesma entrada.',
  outcomeKind: 'REJECTION',
});
let conflictingOutcomeRejected = false;
try {
  assertSemanticDraft(conflictingOutcomeDraft, loadedPolicy.policy, {
    constitutionRules: constitution.rules,
    intent: preflight.intent,
    resolvedDecisionIds: [],
    workspaceEvidence: semanticRequest.workspace.sourceEvidence,
  });
} catch (error) {
  conflictingOutcomeRejected = error.message.startsWith('conflicting_observable_outcomes:');
}
if (!conflictingOutcomeRejected) throw new Error('conflicting_observable_outcomes_were_accepted');

const unsupportedInapplicability = structuredClone(deterministicDraft);
unsupportedInapplicability.determinismReview.dimensions
  .find(({ kind }) => kind === 'DUPLICATES').basis = modelBasis;
unsupportedInapplicability.determinismReview.dimensions
  .find(({ kind }) => kind === 'DUPLICATES').closureAuthority = 'MODEL_ARGUMENT';
let unsupportedInapplicabilityRejected = false;
try {
  assertSemanticDraft(unsupportedInapplicability, loadedPolicy.policy, deterministicContext);
} catch (error) {
  unsupportedInapplicabilityRejected = error.message.startsWith(
    'inapplicable_determinism_dimension_without_structural_absence:',
  );
}
if (!unsupportedInapplicabilityRejected) {
  throw new Error('model_analysis_closed_inapplicable_dimension');
}

const inventedSafeDefault = structuredClone(deterministicDraft);
inventedSafeDefault.determinismReview.dimensions
  .find(({ kind }) => kind === 'DUPLICATES').basis = [{
    source: 'SAFE_MECHANICAL_DEFAULT',
    reference: 'ARCH-NOT-REAL',
  }];
let inventedSafeDefaultRejected = false;
try {
  assertSemanticDraft(inventedSafeDefault, loadedPolicy.policy, deterministicContext);
} catch {
  inventedSafeDefaultRejected = true;
}
if (!inventedSafeDefaultRejected) throw new Error('unbound_safe_default_was_accepted');

const exampleIntent = 'Garantir integridade criptográfica (como FNV-1a), com primitiva ainda a escolher.';
const examplePreflight = buildPreflightHandoff({
  demand: exampleIntent,
  discovery: discoverWorkspace(process.cwd(), exampleIntent),
});
const exampleRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: examplePreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const exampleSignal = exampleRequest.intentSignals.signals
  .find(({ kind }) => kind === 'EXAMPLE');
if (exampleSignal?.handling !== 'NON_NORMATIVE_EXAMPLE') {
  throw new Error('explicit_example_was_not_detected');
}
const exampleDraft = structuredClone(draft);
exampleDraft.sourceContextDigest = exampleRequest.contextDigest;
exampleDraft.intentClaims = [
  {
    id: 'CLAIM-INTEGRITY',
    quote: 'integridade criptográfica',
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: 'A operação deve garantir integridade criptográfica.',
    targetIds: ['REQ-RESULT'],
    rationale: 'A garantia observável é normativa.',
  },
  {
    id: 'CLAIM-HASH-EXAMPLE',
    quote: 'como FNV-1a',
    kind: 'EXAMPLE',
    disposition: 'NON_NORMATIVE',
    contractEffect: null,
    targetIds: ['NOTE-HASH-EXAMPLE'],
    rationale: 'O marcador “como” apresenta exemplo, não obrigação.',
  },
  {
    id: 'CLAIM-PRIMITIVE-GAP',
    quote: 'primitiva ainda a escolher',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-FORMAT'],
    rationale: 'A primitiva material permanece aberta.',
  },
];
exampleDraft.nonNormativeItems = [{
  id: 'NOTE-HASH-EXAMPLE',
  kind: 'EXAMPLE',
  statement: 'FNV-1a foi citado apenas como exemplo e não constitui obrigação contratual.',
  status: 'NON_NORMATIVE',
  intentSignalIds: [exampleSignal.id],
  basis: [{ source: 'USER_INTENT', reference: 'como FNV-1a' }],
}];
exampleDraft.architectureContexts[0].basis = [{ source: 'USER_INTENT', reference: 'integridade criptográfica' }];
exampleDraft.requirements[0].statement = 'A operação deve garantir integridade criptográfica.';
exampleDraft.requirements[0].basis = [{ source: 'USER_INTENT', reference: 'integridade criptográfica' }];
exampleDraft.requirements[0].acceptanceCases[0].then = 'A primitiva escolhida deve satisfazer a garantia criptográfica declarada.';
exampleDraft.unknowns[0].statement = 'A garantia e o exemplo podem exigir primitivas incompatíveis.';
exampleDraft.unknowns[0].basis = [{ source: 'USER_INTENT', reference: 'primitiva ainda a escolher' }];
exampleDraft.decisions[0].question = 'A garantia é criptográfica ou apenas um fingerprint determinístico?';
exampleDraft.decisions[0].answers = [
  {
    id: 'ANS-SIMPLE',
    label: 'Garantia criptográfica',
    rationale: 'Preserva a obrigação explícita e trata o algoritmo citado como exemplo.',
    contractEffect: 'A primitiva escolhida deve satisfazer a garantia criptográfica declarada.',
    recommended: true,
  },
  {
    id: 'ANS-DETAIL',
    label: 'Fingerprint determinístico',
    rationale: 'Reduz a garantia pública, exigindo recompilação.',
    contractEffect: 'A saída deve ser declarada apenas como fingerprint determinístico.',
    recommended: false,
  },
];
exampleDraft.adversarialReview = {
  status: 'CHALLENGES_INTEGRATED',
  rationale: 'A revisão residual separou a garantia da tecnologia apresentada como exemplo.',
  findings: [{
    id: 'ADV-GUARANTEE-EXAMPLE-TENSION',
    kind: 'CONTRADICTION',
    disposition: 'DECISION',
    challenge: 'A garantia criptográfica pode ser incompatível com o exemplo de algoritmo.',
    response: 'A primitiva escolhida deve satisfazer a garantia criptográfica declarada.',
    targetIds: ['Q-FORMAT'],
    basis: [{ source: 'MODEL_ANALYSIS', reference: 'analysis' }],
  }],
};
const exampleContext = {
  constitutionRules: constitution.rules,
  intent: exampleIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: exampleRequest.workspace.sourceEvidence,
};
assertSemanticDraft(exampleDraft, loadedPolicy.policy, exampleContext);

const pathIntent = 'Expor o resultado por src/index.ts; src/engine.ts é somente uma sugestão; formato ainda a escolher.';
const pathPreflight = buildPreflightHandoff({
  demand: pathIntent,
  discovery: discoverWorkspace(process.cwd(), pathIntent),
});
const pathRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: pathPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const pathDraft = structuredClone(draft);
pathDraft.sourceContextDigest = pathRequest.contextDigest;
pathDraft.intentClaims = [
  {
    id: 'CLAIM-PUBLIC-PATH',
    quote: 'Expor o resultado por src/index.ts',
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: 'Expor o resultado por src/index.ts como superfície pública.',
    targetIds: ['REQ-RESULT'],
    rationale: 'A superfície pública foi exigida.',
  },
  {
    id: 'CLAIM-SUGGESTED-PATH',
    quote: 'src/engine.ts é somente uma sugestão',
    kind: 'OPTION',
    disposition: 'NON_NORMATIVE',
    contractEffect: null,
    targetIds: ['PATH-ENGINE-SUGGESTION'],
    rationale: 'A própria demanda declara o caminho como sugestão.',
  },
  {
    id: 'CLAIM-PATH-FORMAT',
    quote: 'formato ainda a escolher',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-FORMAT'],
    rationale: 'O formato continua aberto.',
  },
];
pathDraft.pathReferences = [
  {
    id: 'PATH-PUBLIC-INDEX',
    path: 'src/index.ts',
    role: 'PUBLIC_SURFACE',
    rationale: 'Ponto público exigido pela demanda; não limita a topologia interna.',
    requirementIds: ['REQ-RESULT'],
    basis: [{ source: 'USER_INTENT', reference: 'src/index.ts' }],
  },
  {
    id: 'PATH-ENGINE-SUGGESTION',
    path: 'src/engine.ts',
    role: 'IMPLEMENTATION_SUGGESTION',
    rationale: 'Exemplo não normativo fornecido pelo usuário.',
    requirementIds: [],
    basis: [{ source: 'USER_INTENT', reference: 'src/engine.ts' }],
  },
];
pathDraft.architectureContexts[0].basis = [{ source: 'USER_INTENT', reference: 'src/index.ts' }];
pathDraft.requirements[0].basis = [{ source: 'USER_INTENT', reference: 'Expor o resultado por src/index.ts' }];
pathDraft.requirements[0].statement = 'Expor o resultado por src/index.ts como superfície pública.';
pathDraft.unknowns[0].basis = [{ source: 'USER_INTENT', reference: 'formato ainda a escolher' }];
const pathContext = {
  constitutionRules: constitution.rules,
  intent: pathIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: pathRequest.workspace.sourceEvidence,
};
assertSemanticDraft(pathDraft, loadedPolicy.policy, pathContext);
for (const mutate of [
  (value) => value.pathReferences.pop(),
  (value) => { value.requirements[0].statement = 'O resultado deve ser público.'; },
  (value) => { value.requirements[0].statement += ' A implementação deve residir em src/engine.ts.'; },
]) {
  const invalid = structuredClone(pathDraft);
  mutate(invalid);
  let rejected = false;
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy, pathContext);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('path_role_gate_accepted_ambiguous_topology');
}

const boundedIntent = 'Expor a quantidade nos Bits 4–9 da bitmask; a política fora do limite ainda deve ser escolhida.';
const boundedPreflight = buildPreflightHandoff({
  demand: boundedIntent,
  discovery: discoverWorkspace(process.cwd(), boundedIntent),
});
const boundedRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: boundedPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const boundedSignals = boundedRequest.intentSignals.signals;
if (boundedSignals.length !== 1
  || boundedSignals[0].kind !== 'BOUNDED_VALUE'
  || boundedSignals[0].handling !== 'BOUNDARY_RULE') {
  throw new Error('bounded_value_signal_was_not_detected');
}
if (boundedRequest.worksheet.bitFields.length !== 1
  || boundedRequest.worksheet.bitFields[0].startBit !== 4
  || boundedRequest.worksheet.bitFields[0].endBit !== 9
  || boundedRequest.worksheet.bitFields[0].width !== 6
  || boundedRequest.worksheet.bitFields[0].patternCount !== '64'
  || boundedRequest.worksheet.bitFields[0].unsignedMaximum !== '63') {
  throw new Error('deterministic_worksheet_miscalculated_bit_field');
}
const boundedDraft = structuredClone(draft);
boundedDraft.sourceContextDigest = boundedRequest.contextDigest;
boundedDraft.intentClaims = [
  {
    id: 'CLAIM-BIT-FIELD',
    quote: 'Bits 4–9',
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: 'Bits 4–9 devem representar a quantidade pública.',
    targetIds: ['REQ-RESULT', 'BOUND-PARTICIPANTS'],
    rationale: 'A demanda define uma representação pública finita.',
  },
  {
    id: 'CLAIM-BOUNDARY-POLICY',
    quote: 'política fora do limite ainda deve ser escolhida',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-FORMAT'],
    rationale: 'O comportamento fora da faixa permanece aberto.',
  },
];
boundedDraft.architectureContexts[0].basis = [{ source: 'USER_INTENT', reference: 'Bits 4–9' }];
boundedDraft.requirements[0].basis = [{ source: 'USER_INTENT', reference: 'Bits 4–9' }];
boundedDraft.requirements[0].statement = 'Bits 4–9 devem representar a quantidade pública.';
boundedDraft.requirements[0].acceptanceCases[0].decisionBinding = null;
boundedDraft.requirements[0].acceptanceCases[1] = {
  id: 'AC-RESULT-FAILURE',
  kind: 'BOUNDARY',
  given: 'Uma quantidade igual a 64.',
  when: 'O campo público for compilado.',
  then: 'Valores abaixo de 0 devem ser rejeitados e valores acima de 63 devem saturar em 63.',
  outcomeKind: 'OBSERVABLE_EFFECT',
  decisionBinding: { questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' },
  boundaryBinding: {
    ruleId: 'BOUND-PARTICIPANTS',
    side: 'OVERFLOW',
    expectedBehavior: 'SATURATE',
    expectedValue: '63',
  },
};
boundedDraft.requirements[0].acceptanceCases.push({
  id: 'AC-RESULT-UNDERFLOW',
  kind: 'BOUNDARY',
  given: 'Uma quantidade abaixo de 0.',
  when: 'O campo público for compilado.',
  then: 'Valores abaixo de 0 devem ser rejeitados e valores acima de 63 devem saturar em 63.',
  outcomeKind: 'OBSERVABLE_EFFECT',
  decisionBinding: { questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' },
  boundaryBinding: {
    ruleId: 'BOUND-PARTICIPANTS',
    side: 'UNDERFLOW',
    expectedBehavior: 'REJECT',
    expectedValue: null,
  },
});
boundedDraft.boundaryRules = [{
  id: 'BOUND-PARTICIPANTS',
  subject: 'Quantidade de participantes no campo de seis bits',
  representationKind: 'ENCODED_VALUE',
  lowerBound: '0',
  upperBound: '63',
  underflowBehavior: 'REJECT',
  overflowBehavior: 'SATURATE',
  decisionId: 'Q-FORMAT',
  requirementIds: ['REQ-RESULT'],
  acceptanceCaseIds: ['AC-RESULT-FAILURE', 'AC-RESULT-UNDERFLOW'],
  intentSignalIds: [boundedSignals[0].id],
  basis: [
    { source: 'USER_INTENT', reference: 'Bits 4–9' },
    { source: 'CONSTITUTION', reference: 'CONST-OBSERVABLE' },
  ],
}];
boundedDraft.unknowns[0].statement = 'O comportamento fora da capacidade de seis bits precisa de decisão.';
boundedDraft.unknowns[0].basis = [{ source: 'USER_INTENT', reference: 'política fora do limite ainda deve ser escolhida' }];
boundedDraft.decisions[0] = {
  ...boundedDraft.decisions[0],
  question: 'Como representar quantidades acima de 63?',
  distinguishingCase: {
    given: 'Uma quantidade igual a 64.',
    when: 'O campo de seis bits for compilado.',
    outcomes: [
      { answerId: 'ANS-SIMPLE', then: 'O campo deve conter 63.' },
      { answerId: 'ANS-DETAIL', then: 'A operação deve ser rejeitada.' },
    ],
  },
  answers: [
    { id: 'ANS-SIMPLE', label: 'Rejeitar abaixo e saturar acima', rationale: 'Evita wrap e mantém a faixa observável.', contractEffect: 'Valores abaixo de 0 devem ser rejeitados e valores acima de 63 devem saturar em 63.', recommended: true },
    { id: 'ANS-DETAIL', label: 'Rejeitar fora da faixa', rationale: 'Não aproxima valores excedentes.', contractEffect: 'Todo valor fora de 0 a 63 deve ser rejeitado.', recommended: false },
  ],
};
const boundedContext = {
  constitutionRules: constitution.rules,
  intent: boundedIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: boundedRequest.workspace.sourceEvidence,
};
assertSemanticDraft(boundedDraft, loadedPolicy.policy, boundedContext);
for (const mutate of [
  (value) => { value.boundaryRules = []; },
  (value) => { value.requirements[0].acceptanceCases[1].decisionBinding = null; },
  (value) => { value.boundaryRules[0].decisionId = null; },
  (value) => { value.boundaryRules[0].overflowBehavior = 'WRAP'; },
  (value) => { value.requirements[0].acceptanceCases[1].boundaryBinding.expectedValue = '62'; },
]) {
  const invalid = structuredClone(boundedDraft);
  mutate(invalid);
  let rejected = false;
  try {
    assertSemanticDraft(invalid, loadedPolicy.policy, boundedContext);
  } catch {
    rejected = true;
  }
if (!rejected) throw new Error('boundary_gate_accepted_undefined_or_silent_overflow');
}

const fixedWidthIntent = 'Expor identificador de 64 bits.';
const fixedWidthPreflight = buildPreflightHandoff({
  demand: fixedWidthIntent,
  discovery: discoverWorkspace(process.cwd(), fixedWidthIntent),
});
const fixedWidthRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: fixedWidthPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const fixedWidthSignal = fixedWidthRequest.intentSignals.signals[0];
const fixedWidthDraft = structuredClone(draft);
fixedWidthDraft.sourceContextDigest = fixedWidthRequest.contextDigest;
fixedWidthDraft.intentClaims = [{
  id: 'CLAIM-FIXED-WIDTH',
  quote: '64 bits',
  kind: 'OBLIGATION',
  disposition: 'NORMATIVE',
  contractEffect: 'O identificador público deve ter exatamente 64 bits.',
  targetIds: ['REQ-RESULT', 'BOUND-FIXED-WIDTH'],
  rationale: 'A demanda exige largura pública exata.',
}];
fixedWidthDraft.architectureContexts[0].basis = [{ source: 'USER_INTENT', reference: '64 bits' }];
fixedWidthDraft.requirements[0].statement = 'O identificador público deve ter exatamente 64 bits.';
fixedWidthDraft.requirements[0].basis = [{ source: 'USER_INTENT', reference: '64 bits' }];
fixedWidthDraft.requirements[0].acceptanceCases = [
  {
    id: 'AC-FIXED-HAPPY',
    kind: 'HAPPY_PATH',
    given: 'Um identificador válido.',
    when: 'Ele for exposto.',
    then: 'O identificador deve ser exposto.',
    outcomeKind: 'RETURN_VALUE',
    decisionBinding: null,
    boundaryBinding: null,
  },
  {
    id: 'AC-FIXED-WIDTH',
    kind: 'BOUNDARY',
    given: 'Qualquer identificador público.',
    when: 'Sua representação for observada.',
    then: 'A representação deve ter exatamente 64 bits.',
    outcomeKind: 'OBSERVABLE_EFFECT',
    decisionBinding: null,
    boundaryBinding: {
      ruleId: 'BOUND-FIXED-WIDTH',
      side: 'EXACT_WIDTH',
      expectedBehavior: 'NOT_APPLICABLE',
      expectedValue: '64 bits',
    },
  },
];
fixedWidthDraft.boundaryRules = [{
  id: 'BOUND-FIXED-WIDTH',
  subject: 'Largura do identificador público',
  representationKind: 'REPRESENTATION_WIDTH',
  lowerBound: '64 bits',
  upperBound: '64 bits',
  underflowBehavior: 'NOT_APPLICABLE',
  overflowBehavior: 'NOT_APPLICABLE',
  decisionId: null,
  requirementIds: ['REQ-RESULT'],
  acceptanceCaseIds: ['AC-FIXED-WIDTH'],
  intentSignalIds: [fixedWidthSignal.id],
  basis: [{ source: 'USER_INTENT', reference: '64 bits' }],
}];
fixedWidthDraft.unknowns = [];
fixedWidthDraft.decisions = [];
const fixedWidthContext = {
  constitutionRules: constitution.rules,
  intent: fixedWidthIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: fixedWidthRequest.workspace.sourceEvidence,
};
assertSemanticDraft(fixedWidthDraft, loadedPolicy.policy, fixedWidthContext);
const widthMisclassifiedAsEncodedValue = structuredClone(fixedWidthDraft);
widthMisclassifiedAsEncodedValue.boundaryRules[0].representationKind = 'ENCODED_VALUE';
let widthMisclassificationRejected = false;
try {
  assertSemanticDraft(widthMisclassifiedAsEncodedValue, loadedPolicy.policy, fixedWidthContext);
} catch (error) {
  widthMisclassificationRejected = error.message.startsWith(
    'encoded_value_without_both_range_policies:',
  );
}
if (!widthMisclassificationRejected) {
  throw new Error('representation_width_was_treated_as_encoded_value_without_policy');
}

const tamperedIntentSignals = structuredClone(gapContract);
tamperedIntentSignals.intentSignals.pop();
let tamperedIntentSignalsRejected = false;
try {
  assertContractDocument({
    repositoryRoot: process.cwd(),
    contract: tamperedIntentSignals,
    preflight: gapPreflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
  });
} catch {
  tamperedIntentSignalsRejected = true;
}
if (!tamperedIntentSignalsRejected) throw new Error('tampered_intent_signals_were_accepted');

const confirmation = buildConfirmationRequest(contract);
const recommendedResolution = {
  schema: 'aegis.semantic_resolution.v2',
  executionId: confirmation.executionId,
  contractDraftDigest: confirmation.contractDraftDigest,
  method: 'INTERACTIVE_WIZARD',
  attestation: 'CONTRACT_REVIEWED_AND_APPROVED',
  answers: [{ questionId: 'Q-FORMAT', answerId: 'ANS-SIMPLE' }],
};
if (confirmation.schema !== 'aegis.confirmation_request.v4'
  || confirmation.recommendationPolicy !== 'RECOMMENDATIONS_ARE_NOT_HUMAN_DECISIONS'
  || confirmation.questions[0].gaps[0] !== 'O formato final do resultado não foi definido.'
  || confirmation.questions[0].requirementIds[0] !== 'REQ-RESULT'
  || confirmation.questions[0].acceptanceCaseIds[0] !== 'AC-RESULT-HAPPY') {
  throw new Error('confirmation_request_blurred_recommendation_and_consent');
}
if (resolutionRequiresRecompilation({
  contract,
  request: confirmation,
  resolution: recommendedResolution,
})) throw new Error('recommended_path_required_recompilation');

const directDecisionResolution = { ...recommendedResolution, method: 'DIRECT_COMMAND' };
let directDecisionRejected = false;
try {
  resolutionRequiresRecompilation({
    contract,
    request: confirmation,
    resolution: directDecisionResolution,
  });
} catch {
  directDecisionRejected = true;
}
if (!directDecisionRejected) throw new Error('direct_command_bypassed_human_wizard');

const unapprovedAttestation = {
  ...recommendedResolution,
  attestation: 'DECISIONS_REVIEWED_AND_CONFIRMED',
};
let missingApprovalAttestationRejected = false;
try {
  finalizeContractApproval({
    contract,
    request: confirmation,
    resolution: unapprovedAttestation,
  });
} catch {
  missingApprovalAttestationRejected = true;
}
if (!missingApprovalAttestationRejected) {
  throw new Error('decision_confirmation_was_treated_as_contract_approval');
}

const approvedContract = finalizeContractApproval({
  contract,
  request: confirmation,
  resolution: recommendedResolution,
});
assertContractApprovalEvidence(approvedContract, { required: true });
if (approvedContract.approval.contractDraftDigest !== confirmation.contractDraftDigest
  || approvedContract.approval.method !== 'INTERACTIVE_WIZARD'
  || approvedContract.humanResolutions[0].question !== 'Qual formato público deve ser usado?'
  || approvedContract.humanResolutions[0].label !== 'Simples'
  || approvedContract.humanResolutions[0].contractEffect !== 'Um resultado explícito deve ser observado.'
  || approvedContract.humanResolutions[0].sourceContractDigest !== confirmation.contractDraftDigest
  || !renderSemanticContractMarkdown(approvedContract, {
    contractDigest: canonicalDigest(approvedContract),
  }).includes('[ESCOLHA HUMANA]')) {
  throw new Error('approved_contract_omitted_human_evidence');
}
const tamperedApproval = structuredClone(approvedContract);
tamperedApproval.approval.contractDraftDigest = '0'.repeat(64);
let tamperedApprovalRejected = false;
try {
  assertContractApprovalEvidence(tamperedApproval, { required: true });
} catch {
  tamperedApprovalRejected = true;
}
if (!tamperedApprovalRejected) throw new Error('tampered_human_approval_was_accepted');

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
  (value) => { value.intentClaims = value.intentClaims.filter(({ id }) => id !== 'CLAIM-RESULT'); },
  (value) => { value.intentClaims[0].quote = 'texto inexistente'; },
  (value) => { value.decisions[0].answers[1].contractEffect = value.decisions[0].answers[0].contractEffect; },
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
enforcedHardConflict.intentClaims.push({
  id: 'CLAIM-HARD-CORRECTION',
  quote: 'Criar',
  kind: 'OBLIGATION',
  disposition: 'POLICY_CORRECTION',
  contractEffect: null,
  targetIds: ['ARCH-PRODUCT-BOUNDARY'],
  rationale: 'O teste torna explícita a correção constitucional aplicada.',
});
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
deliberableDefaultConflict.intentClaims.push({
  id: 'CLAIM-DEFAULT-CORRECTION',
  quote: 'teste',
  kind: 'OBLIGATION',
  disposition: 'POLICY_CORRECTION',
  contractEffect: null,
  targetIds: ['ARCH-STRICT-EXPLICIT-MODULES'],
  rationale: 'A forma técnica conflitante precisa de disposição explícita.',
});
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

const redFlagIntent = 'Usar any, AbstractCycleResolver e try/catch vazios em src/index.ts; formato ainda a escolher.';
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
redFlagDraft.intentClaims = [
  {
    id: 'CLAIM-RED-FLAG-PATH',
    quote: 'src/index.ts',
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: 'O resultado público deve ser exposto por src/index.ts com tipagem e falhas explícitas.',
    targetIds: ['REQ-RESULT'],
    rationale: 'A demanda exige esta superfície de produto.',
  },
  {
    id: 'CLAIM-RED-FLAGS',
    quote: 'any, AbstractCycleResolver e try/catch vazios',
    kind: 'OBLIGATION',
    disposition: 'POLICY_CORRECTION',
    contractEffect: null,
    targetIds: [
      'ARCH-STRICT-EXPLICIT-MODULES',
      'ARCH-PARSIMONY',
      'ARCH-FAILURE-EXPLICIT',
    ],
    rationale: 'As formas pedidas conflitam com regras confiáveis e são corrigidas.',
  },
  {
    id: 'CLAIM-RED-FLAG-FORMAT',
    quote: 'formato ainda a escolher',
    kind: 'AMBIGUITY',
    disposition: 'DECISION',
    contractEffect: null,
    targetIds: ['Q-FORMAT'],
    rationale: 'A forma pública final permanece aberta.',
  },
];
redFlagDraft.pathReferences = [{
  id: 'PATH-RED-FLAG-INDEX',
  path: 'src/index.ts',
  role: 'IMPLEMENTATION_CONSTRAINT',
  rationale: 'A demanda cita explicitamente este local.',
  requirementIds: ['REQ-RESULT'],
  basis: [{ source: 'USER_INTENT', reference: 'src/index.ts' }],
}];
for (const context of redFlagDraft.architectureContexts) {
  context.basis = [{ source: 'USER_INTENT', reference: 'src/index.ts' }];
}
redFlagDraft.requirements[0].statement = 'O resultado público deve ser exposto por src/index.ts com tipagem e falhas explícitas.';
redFlagDraft.requirements[0].basis = [
  { source: 'USER_INTENT', reference: 'src/index.ts' },
  { source: 'ARCHITECTURE_POLICY', reference: 'ARCH-STRICT-EXPLICIT-MODULES' },
  { source: 'ARCHITECTURE_POLICY', reference: 'ARCH-FAILURE-EXPLICIT' },
];
redFlagDraft.unknowns[0].basis = [{
  source: 'USER_INTENT',
  reference: 'formato ainda a escolher',
}];
redFlagDraft.complexityReview = {
  status: 'SIMPLIFIED',
  rationale: 'A abstração opcional foi podada pela regra KISS.',
  alternatives: [{
    requested: 'AbstractCycleResolver',
    simpler: 'Composição direta de funções',
    rationale: 'Evita hierarquia sem necessidade observável.',
    basis: [
      { source: 'USER_INTENT', reference: 'AbstractCycleResolver' },
      { source: 'ARCHITECTURE_POLICY', reference: 'ARCH-PARSIMONY' },
    ],
  }],
};
redFlagDraft.adversarialReview = {
  status: 'CHALLENGES_INTEGRATED',
  rationale: 'A revisão residual examinou o risco que permaneceu após as correções de política.',
  findings: [{
    id: 'ADV-RED-FLAG-RESIDUAL',
    kind: 'TECHNICAL_RISK',
    disposition: 'REQUIREMENT',
    challenge: 'A correção arquitetural ainda pode deixar uma falha pública sem resultado.',
    response: 'Exigir resultado explícito em todos os casos.',
    targetIds: ['REQ-RESULT', 'RISK-SILENCE'],
    basis: [{ source: 'MODEL_ANALYSIS', reference: 'analysis' }],
  }],
};
redFlagDraft.policyAssessments = loadedPolicy.policy.rules
  .filter((rule) => rule.appliesWhen.includes('product-demand')
    || [...rule.reviewReferences, ...rule.forbiddenReferences].some((reference) => (
      redFlagIntent.toLocaleLowerCase('pt-BR').includes(reference.toLocaleLowerCase('pt-BR'))
    )))
  .map((rule) => {
    const conflict = [
      'ARCH-STRICT-EXPLICIT-MODULES',
      'ARCH-PARSIMONY',
      'ARCH-FAILURE-EXPLICIT',
    ].includes(rule.id);
    return {
      ruleId: rule.id,
      demandStatus: conflict ? 'CONFLICT' : 'COMPLIANT',
      recommendedStatus: 'COMPLIANT',
      rationale: conflict
        ? 'A exigência foi corrigida pela política aplicável.'
        : 'A regra ativada foi confrontada e permaneceu conforme.',
      decisionId: null,
      amendmentId: null,
    };
  });

const redFlagContext = {
  constitutionRules: constitution.rules,
  intent: redFlagIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: redFlagRequest.workspace.sourceEvidence,
};
const observedSignals = new Set(redFlagRequest.policy.signals
  .map(({ ruleId, kind, reference }) => `${ruleId}:${kind}:${reference}`));
for (const expectedSignal of [
  'ARCH-PRODUCT-BOUNDARY:REVIEW:src/',
  'ARCH-STRICT-EXPLICIT-MODULES:POSSIBLE_CONFLICT:any',
  'ARCH-PARSIMONY:REVIEW:AbstractCycleResolver',
  'ARCH-FAILURE-EXPLICIT:POSSIBLE_CONFLICT:try/catch',
]) {
  if (!observedSignals.has(expectedSignal)) throw new Error(`missing_policy_signal:${expectedSignal}`);
}
assertSemanticDraft(redFlagDraft, loadedPolicy.policy, redFlagContext);
const redFlagContract = compileSemanticContract({
  repositoryRoot: process.cwd(),
  draft: redFlagDraft,
  preflight: redFlagPreflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
if (canonicalDigest(redFlagContract.policySignals)
  !== canonicalDigest(redFlagRequest.policy.signals)
  || !renderSemanticContractMarkdown(redFlagContract, {
    policyRules: loadedPolicy.policy.rules,
  }).includes('ARCH-FAILURE-EXPLICIT/POSSIBLE_CONFLICT: try/catch')) {
  throw new Error('contract_omitted_mechanical_policy_signals');
}
assertContractDocument({
  repositoryRoot: process.cwd(),
  contract: redFlagContract,
  preflight: redFlagPreflight,
  policy: loadedPolicy.policy,
  policyDigest: loadedPolicy.policyDigest,
  constitution,
  constitutionDigest: constitution.digest,
});
const tamperedSignalsContract = structuredClone(redFlagContract);
tamperedSignalsContract.policySignals.pop();
let tamperedSignalsRejected = false;
try {
  assertContractDocument({
    repositoryRoot: process.cwd(),
    contract: tamperedSignalsContract,
    preflight: redFlagPreflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
  });
} catch {
  tamperedSignalsRejected = true;
}
if (!tamperedSignalsRejected) throw new Error('tampered_policy_signals_were_accepted');

let excessiveIntentSignalsRejected = false;
try {
  detectIntentSignals(Array.from({ length: 33 }, () => 'fórmula ()').join(' '));
} catch {
  excessiveIntentSignalsRejected = true;
}
if (!excessiveIntentSignalsRejected) throw new Error('intent_signal_limit_was_silently_truncated');
const omittedAssessment = structuredClone(redFlagDraft);
omittedAssessment.policyAssessments = omittedAssessment.policyAssessments
  .filter(({ ruleId }) => ruleId !== 'ARCH-PARSIMONY');
let omittedTriggeredRuleRejected = false;
try {
  assertSemanticDraft(omittedAssessment, loadedPolicy.policy, redFlagContext);
} catch {
  omittedTriggeredRuleRejected = true;
}
if (!omittedTriggeredRuleRejected) throw new Error('explicit_policy_trigger_was_omitted');

const policySeparatedFromResidualReview = structuredClone(redFlagDraft);
if (policySeparatedFromResidualReview.adversarialReview.findings[0].basis
  .some(({ source }) => source === 'ARCHITECTURE_POLICY')) {
  throw new Error('residual_review_repeated_policy_assessment');
}
assertSemanticDraft(policySeparatedFromResidualReview, loadedPolicy.policy, redFlagContext);

const parsimonyIntent = 'Projetar com AbstractCycleResolver.';
const parsimonyPreflight = buildPreflightHandoff({
  demand: parsimonyIntent,
  discovery: discoverWorkspace(process.cwd(), parsimonyIntent),
});
const parsimonyRequest = buildSemanticRequest({
  repositoryRoot: process.cwd(),
  preflight: parsimonyPreflight,
  policy: loadedPolicy.policy,
  constitution,
});
const parsimonyDraft = structuredClone(draft);
parsimonyDraft.sourceContextDigest = parsimonyRequest.contextDigest;
parsimonyDraft.intentClaims = [{
  id: 'CLAIM-EXPLICIT-ABSTRACTION',
  quote: 'AbstractCycleResolver',
  kind: 'OBLIGATION',
  disposition: 'NORMATIVE',
  contractEffect: 'A solução deve usar AbstractCycleResolver conforme exigência humana explícita.',
  targetIds: ['REQ-RESULT'],
  rationale: 'A forma técnica foi exigida textualmente neste cenário de teste.',
}];
parsimonyDraft.architectureContexts[0].basis = [{
  source: 'USER_INTENT',
  reference: 'AbstractCycleResolver',
}];
parsimonyDraft.requirements[0].basis = [{
  source: 'USER_INTENT',
  reference: 'AbstractCycleResolver',
}];
parsimonyDraft.requirements[0].statement = 'A solução deve usar AbstractCycleResolver conforme exigência humana explícita.';
parsimonyDraft.policyAssessments = parsimonyDraft.policyAssessments.concat({
  ruleId: 'ARCH-PARSIMONY',
  demandStatus: 'COMPLIANT',
  recommendedStatus: 'COMPLIANT',
  rationale: 'A abstração foi justificada pela demanda.',
  decisionId: null,
  amendmentId: null,
});
parsimonyDraft.complexityReview = {
  status: 'JUSTIFIED',
  rationale: 'A forma técnica foi explicitamente solicitada.',
  alternatives: [],
};
parsimonyDraft.risks = [];
parsimonyDraft.riskReview = { status: 'NONE', rationale: 'Nenhum risco material adicional.' };
parsimonyDraft.unknowns = [];
parsimonyDraft.decisions = [];
parsimonyDraft.requirements[0].acceptanceCases[0].decisionBinding = null;
parsimonyDraft.adversarialReview = {
  status: 'NO_ADDITIONAL_FINDINGS',
  rationale: 'Nenhuma objeção adicional.',
  findings: [],
};
const parsimonyContext = {
  constitutionRules: constitution.rules,
  intent: parsimonyIntent,
  resolvedDecisionIds: [],
  workspaceEvidence: parsimonyRequest.workspace.sourceEvidence,
};
assertSemanticDraft(parsimonyDraft, loadedPolicy.policy, parsimonyContext);

const semanticState = {
  schema: 'aegis.semantic_state.v12',
  contract: approvedContract,
  contractDigest: canonicalDigest(approvedContract),
};
parseSemanticState(semanticState);
if (semanticStateRelativePath !== '.harness/state/semantic-state.json') {
  throw new Error('semantic_state_escaped_harness');
}
NODE

grep -Fqx '# Aegis Cognitive Constitution' AGENTS.md
printf '[AEGIS][TEST] governance schemas and semantic interface: PASS\n'
