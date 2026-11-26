import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  buildPreflightHandoff,
  captureDemand,
  loadArchitecturePolicy,
  observeWorkspace,
} from '../../lib/issue_contract_core.mjs';
import { generateClosureCertificate } from '../../lib/closure/gap_ledger.mjs';
import { validateOperationTotality } from '../../lib/closure/operation_totality.mjs';
import { validateProvenanceEnforcement } from '../../lib/closure/provenance.mjs';
import {
  computeDeterminismReviewStatus,
  evaluateBatchWitnessError,
  isCompletePayloadDescriptor,
  normalizeKey,
} from '../../lib/closure/v7_rules.mjs';
import { applyPreparedAnswers, assertPreparedEffectsDisjoint, cartesianProduct } from '../../lib/prepared_effects.mjs';
import { buildErrorRejectionReport } from '../../lib/rejection_report.mjs';
import { assertRevisionApplied, buildQuestionRequest, effectiveDeterminismStatus } from '../../lib/semantic_approval.mjs';
import { compileSemanticContract } from '../../lib/semantic_contract_lifecycle.mjs';
import { renderSemanticContractMarkdown } from '../../lib/semantic_contract_markdown.mjs';
import { assertSemanticDraft } from '../../lib/semantic_draft_validator.mjs';
import { semanticSupervisorInstructions } from '../../lib/semantic_gateway.mjs';
import { compileEarlyClarification, compileSemanticOpinion } from '../../lib/semantic_opinion.mjs';
import { standaloneSchemaDocument } from '../../lib/schema_validator.mjs';
import { buildSemanticOutputSchema, omitOptionalNulls } from '../../lib/semantic_output_schema.mjs';
import { buildCompactSemanticRequest, buildSemanticRequest, loadSemanticConstitution } from '../../lib/semantic_request.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const runnerPath = resolve(repositoryRoot, 'scripts/issue_contract_runner.mjs');
const policyLoaded = loadArchitecturePolicy(repositoryRoot);
const constitution = loadSemanticConstitution(repositoryRoot);

function pass(label) {
  console.log(`  PASS: ${label}`);
}

function makeBaseReq(overrides = {}) {
  return {
    id: 'REQ-0001',
    kind: 'FUNCTIONAL',
    statement: 'Operacao deterministica de dominio; rejeitar com BR-ERR.',
    basis: [{ source: 'CONSTITUTION', reference: 'CONST-OBSERVABLE' }],
    sourceFragmentIds: ['FRAG-0001'],
    measurement: null,
    acceptanceCases: [
      {
        id: 'AC-0001-01',
        kind: 'HAPPY_PATH',
        given: 'Entrada valida.',
        when: 'Executar operacao.',
        then: 'Retorna resultado esperado.',
        outcomeKind: 'RETURN_VALUE',
        branchRef: null,
        decisionBinding: null,
        boundaryBinding: null,
      },
      {
        id: 'AC-0001-02',
        kind: 'FAILURE',
        given: 'Entrada invalida.',
        when: 'Executar operacao.',
        then: 'Rejeita deterministica.',
        outcomeKind: 'REJECTION',
        branchRef: null,
        decisionBinding: null,
        boundaryBinding: null,
      },
    ],
    ...overrides,
  };
}

function makeBaseSpec(overrides = {}) {
  return {
    architectureContexts: [{ tag: 'pure-computation', rationale: 'Base.', basis: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] }],
    determinismReview: {
      status: 'NOT_APPLICABLE',
      rationale: 'Escopo deterministico fechado.',
      sourceFragmentIds: ['FRAG-0001'],
      coverage: [],
      dimensions: [],
      ...(overrides.determinismReview ?? {}),
    },
    requirements: overrides.requirements ?? [makeBaseReq()],
    invariants: overrides.invariants ?? [
      {
        id: 'INV-0001',
        statement: 'Comportamento puro sem mutacao oculta.',
        falsification: 'Falsificado se execucoes identicas divergirem.',
        falsificationSpec: {
          polarity: 'VIOLATION',
          observableEffect: 'Duas chamadas com entradas identicas retornam valores diferentes.',
          acceptanceCaseId: null,
        },
        requirementIds: ['REQ-0001'],
      },
    ],
    boundaryRules: overrides.boundaryRules ?? [],
    decisions: overrides.decisions ?? [],
    unknowns: overrides.unknowns ?? [],
    pathReferences: overrides.pathReferences ?? [],
    literalFacts: overrides.literalFacts ?? [],
    fragments: overrides.fragments ?? [],
    workspaceEvidence: overrides.workspaceEvidence ?? [],
    workspaceSkeleton: overrides.workspaceSkeleton ?? null,
    payloadSchemas: overrides.payloadSchemas ?? null,
    policy: policyLoaded.policy,
    intent: overrides.intent ?? 'Validar operacao.',
    stateModel: overrides.stateModel ?? { entities: [], operations: [], observables: [] },
  };
}

function makeMinimalOpinion(request, overrides = {}) {
  const fragment = request.intentEvidence.fragments[0];
  const anchor = fragment.anchor;
  const architectureContexts = overrides.architectureContexts ?? [
    {
      contextIndex: 0,
      rationale: 'Logica pura de dominio.',
      basis: [{ source: 'USER_INTENT', reference: anchor }],
    },
  ];
  const activeTags = new Set(
    architectureContexts.map((ctx) => policyLoaded.policy.contexts[ctx.contextIndex]?.tag).filter(Boolean),
  );
  const policyAssessments = overrides.policyAssessments ?? policyLoaded.policy.rules
    .map((rule, ruleIndex) => ({ rule, ruleIndex }))
    .filter(({ rule }) => (rule.appliesMode === 'all'
      ? rule.appliesWhen.every((tag) => activeTags.has(tag))
      : rule.appliesWhen.some((tag) => activeTags.has(tag))))
    .map(({ ruleIndex }) => ({
      ruleIndex,
      demandStatus: 'COMPLIANT',
      recommendedStatus: 'COMPLIANT',
      rationale: 'Regra confrontada na base bilateral.',
      decisionIndex: null,
      amendmentIndex: null,
    }));
  const intentClaims = overrides.intentClaims ?? [
    {
      quote: anchor,
      fragmentIndexes: [0],
      kind: 'OBLIGATION',
      disposition: 'NORMATIVE',
      contractEffect: 'Executar validacao de dominio.',
      targets: [{ kind: 'REQUIREMENT', index: 0 }],
      rationale: 'Obrigacao explicita da demanda.',
    },
  ];
  const defaultCoverage = intentClaims.map((claim, claimIndex) => ({
    claimIndex,
    disposition: 'NO_DIMENSION_APPLICABLE',
    dimensionIndexes: [],
    rationale: 'Cobertura bilateral minima.',
  }));
  const base = {
    schema: 'aegis.semantic_opinion.v3',
    sourceEvidenceDigest: request.intentEvidence.evidenceDigest,
    title: 'Operacao bilateral v7',
    interpretation: 'Especificacao minima.',
    changeKind: 'PRODUCT',
    scope: {
      inScope: ['Validacao bilateral v7 do dominio.'],
      outOfScope: ['Infraestrutura nao autorizada.'],
    },
    intentClaims,
    nonNormativeItems: [],
    pathReferences: [],
    architectureContexts,
    policyAssessments,
    complexityReview: {
      status: 'NO_EXCESS',
      rationale: 'Menor modelo suficiente.',
      alternatives: [],
    },
    requirements: [
      {
        kind: 'FUNCTIONAL',
        statement: 'Validar entrada e retornar resultado esperado.',
        basis: [{ source: 'USER_INTENT', reference: anchor }],
        fragmentIndexes: [0],
        measurement: null,
        acceptanceCases: [
          {
            kind: 'HAPPY_PATH',
            given: 'Entrada valida',
            when: 'Executar op',
            then: 'Retorna ok',
            outcomeKind: 'RETURN_VALUE',
            branchRef: null,
            decisionBinding: null,
            boundaryBinding: null,
          },
          {
            kind: 'FAILURE',
            given: 'Entrada invalida',
            when: 'Executar op',
            then: 'Rejeita erro',
            outcomeKind: 'REJECTION',
            branchRef: null,
            decisionBinding: null,
            boundaryBinding: null,
          },
        ],
      },
    ],
    invariants: [
      {
        statement: 'Resultado deterministico para mesmas entradas.',
        falsification: 'Falsificado se chamadas identicas produzirem saidas distintas.',
        falsificationSpec: {
          polarity: 'VIOLATION',
          observableEffect: 'Mesmas entradas produzem saidas diferentes.',
          acceptanceCaseId: null,
        },
        requirementIndexes: [0],
      },
    ],
    riskReview: {
      certainty: 'ASSESSED',
      rationale: 'Nenhum risco residual material.',
    },
    risks: [],
    adversarialReview: {
      rationale: 'Sem contradicoes restantes.',
      findings: [],
    },
    determinismReview: {
      rationale: 'Sem dimensoes pendentes.',
      fragmentIndexes: [0],
      coverage: defaultCoverage,
      dimensions: [],
      arithmetic: null,
    },
    boundaryRules: [],
    unknowns: [],
    decisions: [],
    stateModel: {
      entities: [],
      operations: [],
      observables: [],
    },
  };
  return { ...base, ...overrides };
}

function makeTempWorkspace(demand = 'Implementar operacao deterministica em src/ledger.js.') {
  const dir = mkdtempSync(resolve(tmpdir(), 'aegis-v7-bilateral-'));
  mkdirSync(resolve(dir, 'src'), { recursive: true });
  writeFileSync(
    resolve(dir, 'src/ledger.js'),
    'export function processLedger(amount, count) {\n  if (count <= 0) throw new Error("ERR_ZERO");\n  return Math.trunc(amount / count);\n}\n',
    'utf8',
  );
  cpSync(resolve(repositoryRoot, 'AGENTS.md'), resolve(dir, 'AGENTS.md'));
  cpSync(resolve(repositoryRoot, 'governance'), resolve(dir, 'governance'), { recursive: true });
  const preflight = buildPreflightHandoff({
    demand: captureDemand([demand]),
    discovery: observeWorkspace(dir, demand).discovery,
    version: 'v3',
  });
  const request = buildSemanticRequest({
    repositoryRoot: dir,
    preflight,
    policy: policyLoaded.policy,
    constitution,
  });
  return { dir, preflight, request };
}

console.log('[AEGIS][TEST] Starting HARNESS v7 & Six-Hats Bilateral test suite...');

// 1. semanticSupervisorInstructions (emitIdeBriefing supervision guidance)
{
  const instr = semanticSupervisorInstructions({ policy: policyLoaded.policy, constitution });
  assert.ok(instr.includes('temporalRole'));
  assert.ok(instr.includes('evaluatedInputs'));
  assert.ok(instr.includes('additionalPropertiesPolicy'));
  assert.ok(instr.includes('falsificationSpec'));
  pass('Briefing supervision instructions expose v7 structured fields');
}

// 2. REQ-0001: Temporal trigger floor + PROJECTION_ONLY anti-false-block
{
  const { dir, request, preflight } = makeTempWorkspace('Registrar evento com timestamp e somar valores.');
  try {
    const context = {
      constitutionRules: constitution.rules,
      intent: preflight.intent,
      intentEvidence: request.intentEvidence,
      workspaceEvidence: request.workspace.sourceEvidence,
    };
    const makeTimestampOpinion = (temporalRole, includeTimeDependent) => {
      const timeIdx = policyLoaded.policy.contexts.findIndex((c) => c.tag === 'time-dependent');
      const stateIdx = policyLoaded.policy.contexts.findIndex((c) => c.tag === 'stateful-operation');
      assert.ok(timeIdx >= 0 && stateIdx >= 0);
      return compileSemanticOpinion(makeMinimalOpinion(request, {
        architectureContexts: [
          { contextIndex: stateIdx, rationale: 'Possui entidade persistida.', basis: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] },
          ...(includeTimeDependent
            ? [{ contextIndex: timeIdx, rationale: 'Calculo temporal.', basis: [{ source: 'CONSTITUTION', reference: 'CONST-OBSERVABLE' }] }]
            : []),
        ],
        requirements: [
          {
            kind: 'FUNCTIONAL',
            statement: 'Registrar createdAt em evento.',
            basis: [{ source: 'USER_INTENT', reference: request.intentEvidence.fragments[0].anchor }],
            fragmentIndexes: [0],
            measurement: null,
            acceptanceCases: [
              { kind: 'HAPPY_PATH', given: 'Evento.', when: 'Registrar.', then: 'Sucesso.', outcomeKind: 'STATE_CHANGE', branchRef: 'BR-SAVE', decisionBinding: null, boundaryBinding: null },
              { kind: 'FAILURE', given: 'Nulo.', when: 'Registrar.', then: 'Erro.', outcomeKind: 'REJECTION', branchRef: 'BR-ERR', decisionBinding: null, boundaryBinding: null },
            ],
          },
        ],
        stateModel: {
          entities: [
            {
              name: 'EventLog',
              isCollection: false,
              admissionPolicy: null,
              capacityPolicy: { maxEntries: null, overflowPolicy: 'STATIC_SINGLETON', unboundedRationale: 'Singleton.' },
              fields: [
                {
                  name: 'createdAt',
                  type: 'TIMESTAMP',
                  ...(temporalRole !== undefined ? { temporalRole } : {}),
                  temporalUnit: 'MILLISECONDS',
                  initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Inicial.' },
                  mutations: [{ operation: 'recordEvent', condition: 'valid', effect: 'SET_VALUE', targetValue: 'now' }],
                  reset: { allowed: false, trigger: null, resetValue: null },
                  preservation: ['Sem efeito em invalidacao'],
                  readBy: ['recordEvent'],
                },
              ],
            },
          ],
          operations: [
            {
              name: 'recordEvent',
              parameters: [{
                name: 'ts',
                type: 'INTEGER',
                nullability: 'NOT_NULL',
                bounds: {
                  lowerBound: '0',
                  upperBound: null,
                  boundaryBehavior: 'REJECT',
                  provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }],
                },
                onInvalid: { outcomeKind: 'REJECTION', error: 'ERR_TS' },
              }],
              evaluatedInputs: ['ts'],
              guardPrecedence: ['ts < 0'],
              branches: [
                { branchId: 'BR-SAVE', condition: 'ts >= 0', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'EventLog.createdAt', effect: 'SET', value: 'ts' }] },
                { branchId: 'BR-ERR', condition: 'ts < 0', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              ],
              returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
            },
          ],
          observables: [],
        },
      }), request, true);
    };

    assert.throws(() => assertSemanticDraft(makeTimestampOpinion(undefined, false), policyLoaded.policy, context), /missing_temporal_role:/);
    assert.throws(() => assertSemanticDraft(makeTimestampOpinion('COMPUTATION_OR_COMPARISON', false), policyLoaded.policy, context), /missing_required_architecture_context:time-dependent/);
    assertSemanticDraft(makeTimestampOpinion('PROJECTION_ONLY', false), policyLoaded.policy, context);
    assertSemanticDraft(makeTimestampOpinion('COMPUTATION_OR_COMPARISON', true), policyLoaded.policy, context);
    pass('REQ-0001 temporalRole missing & COMPUTATION_OR_COMPARISON rejected; PROJECTION_ONLY accepted without false-block');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. REQ-0002: Producer-consumer symmetry + workspaceSkeleton & constant scalar anti-false-block
{
  const statefulReqs = [makeBaseReq({
    acceptanceCases: [
      { ...makeBaseReq().acceptanceCases[0], branchRef: 'BR-OK' },
      { ...makeBaseReq().acceptanceCases[1], branchRef: 'BR-ERR' },
    ],
  })];
  const missingProducerSpec = makeBaseSpec({
    intent: 'Controlar Wallet com mapa de entradas, cota de 100 e BR-ERR.',
    requirements: statefulReqs,
    stateModel: {
      entities: [{
        name: 'Wallet',
        isCollection: true,
        admissionPolicy: 'ON_FIRST_REQUEST',
        capacityPolicy: { maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT', unboundedRationale: 'Ilimitado.' },
        fields: [{
          name: 'entries',
          type: 'MAP',
          initialization: { kind: 'EXPLICIT_VALUE', value: '{}', rationale: 'Mapa vazio.' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['readTotal'],
          readBy: ['readTotal'],
        }],
      }],
      operations: [{
        name: 'readTotal',
        parameters: [],
        evaluatedInputs: [],
        guardPrecedence: ['BR-ERR'],
        branches: [
          { branchId: 'BR-OK', condition: 'always', outcomeKind: 'RETURN_VALUE', defaultPreservation: true, stateEffects: [] },
          { branchId: 'BR-ERR', condition: 'invalid', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
        returnContract: { successType: 'number', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
      }],
      observables: [],
    },
  });
  const missingCert = generateClosureCertificate({ specification: missingProducerSpec });
  assert.equal(missingCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(missingCert.gapLedger.some((g) => g.slotId.includes('Wallet.entries/producer')));

  const skeletonPresentCert = generateClosureCertificate({
    specification: {
      ...missingProducerSpec,
      workspaceSkeleton: { symbols: [{ name: 'Wallet', path: 'src/wallet.js' }], entries: [] },
    },
    semanticReviewAcknowledged: true,
  });
  assert.equal(skeletonPresentCert.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');

  const constantScalarSpec = makeBaseSpec({
    intent: 'Controlar Wallet com mapa de entradas, cota de 100 e BR-ERR.',
    requirements: statefulReqs,
    stateModel: {
      ...missingProducerSpec.stateModel,
      entities: [{
        ...missingProducerSpec.stateModel.entities[0],
        fields: [{
          name: 'defaultQuota',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'REJECT', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Constante.' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['readTotal'],
          readBy: ['readTotal'],
        }],
      }],
    },
  });
  assert.equal(generateClosureCertificate({ specification: constantScalarSpec, semanticReviewAcknowledged: true }).status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  pass('REQ-0002 producer-consumer symmetry blocks dynamic fields without producer and accepts workspaceSkeleton / constant scalars');
}

// 4. REQ-0003: Logical EXTERNAL_OPERATION port contract + missing adapter unknown
{
  const makeExternalSpec = (withPayloads, withUnknown) => makeBaseSpec({
    intent: 'Despachar webhook externo com url, BR-DELIVERED e BR-TIMEOUT.',
    workspaceSkeleton: { files: [], symbols: [] },
    requirements: [makeBaseReq({
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], outcomeKind: 'OBSERVABLE_EFFECT', branchRef: 'BR-DELIVERED' },
        { ...makeBaseReq().acceptanceCases[1], outcomeKind: 'REJECTION', branchRef: 'BR-TIMEOUT' },
      ],
    })],
    unknowns: withUnknown ? [{
      id: 'UNK-0001',
      statement: 'Sem adaptador HTTP concreto encontrado em src/.',
      material: false,
      decisionId: null,
      sourceFragmentIds: ['FRAG-0001'],
      basis: [{ source: 'CONSTITUTION', reference: 'CONST-EVIDENCE' }],
    }] : [],
    stateModel: {
      entities: [],
      operations: [{
        name: 'dispatchWebhook',
        parameters: [{
          name: 'url',
          type: 'STRING',
          nullability: 'NOT_NULL',
          bounds: { lowerBound: '1', upperBound: null, boundaryBehavior: 'NOT_APPLICABLE', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] },
          onInvalid: { outcomeKind: 'REJECTION', error: 'ERR_URL' },
        }],
        evaluatedInputs: ['url'],
        guardPrecedence: ['BR-TIMEOUT'],
        branches: [
          {
            branchId: 'BR-DELIVERED',
            condition: 'url.length > 0',
            outcomeKind: 'OBSERVABLE_EFFECT',
            defaultPreservation: true,
            stateEffects: [],
            externalEffects: [{
              action: 'EXTERNAL_OPERATION',
              targetSurface: 'webhook',
              rationale: 'Notifica webhook externo.',
              executionOrder: 'AFTER_VALIDATION',
              possibleOutcomes: ['DELIVERED', 'TIMEOUT'],
              ...(withPayloads ? {
                requestPayload: [
                  { field: 'url', type: 'STRING', required: true, nullable: false, constraints: 'non-empty' },
                ],
                outcomePayloads: [
                  { outcome: 'DELIVERED', fields: [{ field: 'receiptId', type: 'STRING', required: true, nullable: false, constraints: 'uuid' }] },
                  { outcome: 'TIMEOUT', fields: [{ field: 'retryAfterMs', type: 'INTEGER', required: true, nullable: false, constraints: '>= 0' }] },
                ],
              } : {}),
            }],
          },
          { branchId: 'BR-TIMEOUT', condition: 'url.length === 0', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
        returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
      }],
      observables: [],
    },
  });
  const missingPayloadRes = validateOperationTotality({
    stateModel: makeExternalSpec(false, true).stateModel,
    requirements: makeExternalSpec(false, true).requirements,
    unknowns: makeExternalSpec(false, true).unknowns,
    workspaceSkeleton: { files: [], symbols: [] },
  });
  assert.equal(missingPayloadRes.valid, false);
  assert.ok(missingPayloadRes.issues.some((i) => i.kind === 'INCOMPLETE_EXTERNAL_EFFECT'));

  const missingAdapterRes = validateOperationTotality({
    stateModel: makeExternalSpec(true, false).stateModel,
    requirements: makeExternalSpec(true, false).requirements,
    unknowns: [],
    workspaceSkeleton: { files: [], symbols: [] },
  });
  assert.equal(missingAdapterRes.valid, false);

  const closedExtCert = generateClosureCertificate({ specification: makeExternalSpec(true, true), semanticReviewAcknowledged: true });
  assert.equal(closedExtCert.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  pass('REQ-0003 logical external ports require payloads + adapter unknown and certify closed when declared');
}

// 5. REQ-0004: Unified symbolic provenance + multi-value status partition
{
  const realRuleId = policyLoaded.policy.rules[0].id;
  const policyOnlySpec = makeBaseSpec({
    intent: 'Transicionar Ticket entre PENDING, ACTIVE e CLOSED com teto 3 de maxRetries ou rejeitar BR-ERR.',
    requirements: [makeBaseReq({
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], branchRef: 'BR-OK' },
        { ...makeBaseReq().acceptanceCases[1], branchRef: 'BR-ERR' },
      ],
    })],
    stateModel: {
      entities: [{
        name: 'Ticket',
        isCollection: true,
        admissionPolicy: 'ON_FIRST_REQUEST',
        capacityPolicy: { maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT', unboundedRationale: 'Sem limite.' },
        fields: [
          {
            name: 'status',
            type: 'STRING',
            allowedValues: ['PENDING', 'ACTIVE', 'CLOSED'],
            initialization: { kind: 'EXPLICIT_VALUE', value: 'PENDING', rationale: 'Inicial.' },
            mutations: [{ operation: 'advanceTicket', condition: 'BR-OK', effect: 'SET_VALUE', targetValue: null }],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['advanceTicket'],
            readBy: ['advanceTicket'],
          },
          {
            name: 'maxRetries',
            type: 'INTEGER',
            bounds: { lowerBound: '0', upperBound: '3', boundaryBehavior: 'REJECT', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] },
            initialization: { kind: 'EXPLICIT_VALUE', value: '3', rationale: 'Limite.' },
            mutations: [],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['advanceTicket'],
            readBy: ['advanceTicket'],
          },
          {
            name: 'retries',
            type: 'INTEGER',
            bounds: { lowerBound: '0', upperBound: 'maxRetries', boundaryBehavior: 'REJECT', provenance: [{ source: 'ARCHITECTURE_POLICY', reference: realRuleId }] },
            initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Zero.' },
            mutations: [{ operation: 'advanceTicket', condition: 'BR-OK', effect: 'INCREMENT', targetValue: '1' }],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['advanceTicket'],
            readBy: ['advanceTicket'],
          },
        ],
      }],
      operations: [{
        name: 'advanceTicket',
        parameters: [],
        evaluatedInputs: [],
        guardPrecedence: ['BR-ERR'],
        branches: [
          { branchId: 'BR-OK', condition: 'status === PENDING && retries < maxRetries', guardedField: 'status', guardedValues: ['PENDING', 'ACTIVE'], outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'Ticket.status', effect: 'SET', value: '1' }, { field: 'Ticket.maxRetries', effect: 'PRESERVE' }, { field: 'Ticket.retries', effect: 'INCREMENT', value: '1' }] },
          { branchId: 'BR-ERR', condition: 'retries >= maxRetries', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
        returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
      }],
      observables: [],
    },
  });
  const blockedCert = generateClosureCertificate({ specification: policyOnlySpec });
  assert.equal(blockedCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(blockedCert.gapLedger.some((g) => g.slotId.includes('statusPartition')));
  assert.ok(blockedCert.gapLedger.some((g) => g.slotId.includes('Ticket.retries/bounds/upperBound')));

  // Authorized via USER_INTENT + full partition
  policyOnlySpec.stateModel.entities[0].fields[2].bounds.provenance = [{ source: 'USER_INTENT', reference: 'maxRetries' }];
  policyOnlySpec.stateModel.operations[0].branches[1].guardedField = 'status';
  policyOnlySpec.stateModel.operations[0].branches[1].guardedValues = ['CLOSED'];
  assert.equal(generateClosureCertificate({ specification: policyOnlySpec, semanticReviewAcknowledged: true }).status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  pass('REQ-0004 symbolic provenance rejects ARCHITECTURE_POLICY-only symbols and partial status partitions; certifies closed when grounded and partitioned');
}

// 6. REQ-0005: evaluatedInputs, additionalPropertiesPolicy (OBJECT vs scalar bilateral!), branchRef
{
  const makeOpSpec = ({ evaluatedInputs, paramType, additionalPropertiesPolicy, branchRef }) => makeBaseSpec({
    intent: 'Validar payload e rejeitar via BR-ERR.',
    requirements: [makeBaseReq({
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], branchRef },
        { ...makeBaseReq().acceptanceCases[1], branchRef: 'BR-ERR' },
      ],
    })],
    stateModel: {
      entities: [],
      operations: [{
        name: 'submitPayload',
        parameters: [{
          name: 'payload',
          type: paramType,
          nullability: 'NOT_NULL',
          ...(paramType === 'INTEGER' ? {
            bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'NOT_APPLICABLE', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] },
            onInvalid: { outcomeKind: 'REJECTION', error: 'ERR_PAYLOAD' },
          } : {}),
        }],
        ...(additionalPropertiesPolicy !== undefined ? { additionalPropertiesPolicy } : {}),
        ...(evaluatedInputs !== undefined ? { evaluatedInputs } : {}),
        guardPrecedence: ['BR-ERR'],
        branches: [
          { branchId: 'BR-OK', condition: 'valid', outcomeKind: 'RETURN_VALUE', defaultPreservation: true, stateEffects: [] },
          { branchId: 'BR-ERR', condition: 'invalid', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
        returnContract: { successType: 'boolean', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
      }],
      observables: [],
    },
  });

  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: undefined, paramType: 'OBJECT', additionalPropertiesPolicy: 'REJECT_UNKNOWN', branchRef: 'BR-OK' }) }).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: ['payload'], paramType: 'OBJECT', additionalPropertiesPolicy: undefined, branchRef: 'BR-OK' }) }).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: ['payload'], paramType: 'OBJECT', additionalPropertiesPolicy: 'REJECT_UNKNOWN', branchRef: null }) }).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: ['payload'], paramType: 'OBJECT', additionalPropertiesPolicy: 'REJECT_UNKNOWN', branchRef: 'BR-OK' }), semanticReviewAcknowledged: true }).status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  // Bilateral anti-false-block: scalar INTEGER param needs NO additionalPropertiesPolicy!
  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: ['payload'], paramType: 'INTEGER', additionalPropertiesPolicy: undefined, branchRef: 'BR-OK' }), semanticReviewAcknowledged: true }).status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  pass('REQ-0005 enforces evaluatedInputs, branchRef, and OBJECT-only additionalPropertiesPolicy without false-blocking scalars');
}

// 7. REQ-0006: Batch witness algebraic laws across all 3 policies + underflow length
{
  assert.notEqual(evaluateBatchWitnessError('ALL_OR_NOTHING', { itemOutcomes: ['OK', 'FAILURE', 'OK'], appliedCount: 0, rejectedCount: 1, skippedCount: 2, terminalStatus: 'ROLLED_BACK' }), null);
  assert.equal(evaluateBatchWitnessError('ALL_OR_NOTHING', { itemOutcomes: ['OK', 'FAILURE', 'OK'], appliedCount: 0, rejectedCount: 3, skippedCount: 0, terminalStatus: 'ROLLED_BACK' }), null);
  assert.equal(evaluateBatchWitnessError('FAIL_FAST', { itemOutcomes: ['OK', 'FAILURE', 'OK'], appliedCount: 1, rejectedCount: 1, skippedCount: 1, terminalStatus: 'PARTIAL_STOPPED_ON_FAILURE' }), null);
  assert.equal(evaluateBatchWitnessError('CONTINUE_ON_ERROR', { itemOutcomes: ['OK', 'FAILURE', 'OK'], appliedCount: 2, rejectedCount: 1, skippedCount: 0, terminalStatus: 'PARTIAL_COMPLETED_WITH_ERRORS' }), null);
  assert.notEqual(evaluateBatchWitnessError('FAIL_FAST', { itemOutcomes: ['OK', 'FAILURE'], appliedCount: 1, rejectedCount: 1, skippedCount: 0, terminalStatus: 'PARTIAL_STOPPED_ON_FAILURE' }), null);
  pass('REQ-0006 batchWitness algebraic counts and length >= 3 verified for ALL_OR_NOTHING, FAIL_FAST, CONTINUE_ON_ERROR');
}

// 8. REQ-0007: crossOperationWitness rejects opaque labels and records SEMANTIC_REVIEW_REQUIRED when valid
{
  const makeCrossSpec = (expectedFinalValue) => makeBaseSpec({
    intent: 'Operar saldo entre 0 e 1000 começando em 100 com amount minimo 1, debitando 20 e creditando 70; rejeitar em BR-ERR ou BR-CERR.',
    requirements: [makeBaseReq({
      acceptanceCases: [
        {
          ...makeBaseReq().acceptanceCases[0],
          outcomeKind: 'STATE_CHANGE',
          branchRef: 'BR-CREDIT',
          crossOperationWitness: {
            sharedField: 'Ledger.balance',
            operationSequence: ['debit', 'credit'],
            initialValue: '100',
            expectedFinalValue,
            expectedOutcome: 'STATE_CHANGE',
          },
        },
        { ...makeBaseReq().acceptanceCases[1], branchRef: 'BR-ERR' },
        { id: 'AC-0001-03', kind: 'HAPPY_PATH', given: 'Saldo 100.', when: 'debit(20).', then: 'Debita 20.', outcomeKind: 'STATE_CHANGE', branchRef: 'BR-DEBIT', decisionBinding: null, boundaryBinding: null },
        { id: 'AC-0001-04', kind: 'FAILURE', given: 'amount <= 0.', when: 'credit.', then: 'Rejeita BR-CERR.', outcomeKind: 'REJECTION', branchRef: 'BR-CERR', decisionBinding: null, boundaryBinding: null },
      ],
    })],
    stateModel: {
      entities: [{
        name: 'Ledger',
        isCollection: false,
        admissionPolicy: null,
        capacityPolicy: { maxEntries: null, overflowPolicy: 'STATIC_SINGLETON', unboundedRationale: 'Singleton.' },
        fields: [{
          name: 'balance',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '1000', boundaryBehavior: 'REJECT', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Inicial.' },
          mutations: [
            { operation: 'debit', condition: 'amount > 0', effect: 'DECREMENT', targetValue: 'amount' },
            { operation: 'credit', condition: 'amount > 0', effect: 'INCREMENT', targetValue: 'amount' },
          ],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['debit', 'credit'],
          readBy: ['debit', 'credit'],
        }],
      }],
      operations: [
        {
          name: 'debit',
          parameters: [{ name: 'amount', type: 'INTEGER', nullability: 'NOT_NULL', bounds: { lowerBound: '1', upperBound: '1000', boundaryBehavior: 'REJECT', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] }, onInvalid: { outcomeKind: 'REJECTION', error: 'BR-ERR' } }],
          evaluatedInputs: ['amount'],
          guardPrecedence: ['BR-ERR'],
          branches: [
            { branchId: 'BR-DEBIT', condition: 'ok', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'Ledger.balance', effect: 'DECREMENT', value: 'amount' }] },
            { branchId: 'BR-ERR', condition: 'amount <= 0', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
          ],
          returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
        },
        {
          name: 'credit',
          parameters: [{ name: 'amount', type: 'INTEGER', nullability: 'NOT_NULL', bounds: { lowerBound: '1', upperBound: '1000', boundaryBehavior: 'REJECT', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }] }, onInvalid: { outcomeKind: 'REJECTION', error: 'BR-CERR' } }],
          evaluatedInputs: ['amount'],
          guardPrecedence: ['BR-CERR'],
          branches: [
            { branchId: 'BR-CREDIT', condition: 'ok', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'Ledger.balance', effect: 'INCREMENT', value: 'amount' }] },
            { branchId: 'BR-CERR', condition: 'amount <= 0', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
          ],
          returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
        },
      ],
      observables: [],
    },
  });
  assert.equal(generateClosureCertificate({ specification: makeCrossSpec('DEBITED_THEN_CREDITED') }).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  const validCross = generateClosureCertificate({ specification: makeCrossSpec('150'), semanticReviewAcknowledged: true });
  assert.equal(validCross.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  assert.ok(validCross.closureAudit.items.some((x) => x.classification === 'SEMANTIC_REVIEW_REQUIRED' && x.category === 'CROSS_OPERATION_SEMANTICS'));
  pass('REQ-0007 crossOperationWitness rejects opaque labels and marks concrete witnesses SEMANTIC_REVIEW_REQUIRED while certifying closed');
}

// 9. REQ-0008: keyNormalizationPolicy + stateless standalone keyComparisonWitness bilateral equivalence
{
  assert.equal(normalizeKey('  Foo  ', 'TRIM_AND_CASE_INSENSITIVE'), normalizeKey('foo', 'TRIM_AND_CASE_INSENSITIVE'));
  assert.notEqual(normalizeKey('Foo', 'EXACT_CASE_SENSITIVE_NO_TRIM'), normalizeKey('foo', 'EXACT_CASE_SENSITIVE_NO_TRIM'));

  const makeKeyCert = (comparisonRule, baselineKey, variationKey, expectedMatchResult) => generateClosureCertificate({
    specification: makeBaseSpec({
      requirements: [makeBaseReq({
        acceptanceCases: [
          {
            ...makeBaseReq().acceptanceCases[0],
            keyComparisonWitness: { baselineKey, variationKey, comparisonRule, expectedMatchResult },
          },
          makeBaseReq().acceptanceCases[1],
        ],
      })],
    }),
    semanticReviewAcknowledged: true,
  });
  assert.equal(makeKeyCert('TRIM_AND_CASE_INSENSITIVE', '  Foo ', 'foo', 'DISTINCT').status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  // Bilateral equivalence: both TRIM_AND_CASE_INSENSITIVE->MATCH and EXACT_CASE_SENSITIVE_NO_TRIM->DISTINCT certify closed!
  assert.equal(makeKeyCert('TRIM_AND_CASE_INSENSITIVE', '  Foo ', 'foo', 'MATCH').status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  assert.equal(makeKeyCert('EXACT_CASE_SENSITIVE_NO_TRIM', 'Foo', 'foo', 'DISTINCT').status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  pass('REQ-0008 keyComparisonWitness rejects contradiction and accepts equivalent explicit normalization variants');
}

// 10. REQ-0009: Arithmetic BIGINT_EXACT dispensing vs SAFE_INTEGER_BOUNDED division vs PENDING_DECISION
{
  const makeArithCert = (arithmetic, decisions = []) => generateClosureCertificate({
    specification: makeBaseSpec({
      decisions,
      determinismReview: {
        status: computeDeterminismReviewStatus([], { arithmetic }),
        rationale: 'Aritmetica.',
        sourceFragmentIds: ['FRAG-0001'],
        coverage: [],
        dimensions: [],
        arithmetic,
      },
    }),
    semanticReviewAcknowledged: true,
  });

  // Pure BIGINT_EXACT addition dispenses extra division/overflow rules
  const bigAdd = { operations: ['ADD'], numericRepresentation: 'BIGINT_EXACT', operandBoundsDeclared: false };
  assert.equal(computeDeterminismReviewStatus([], { arithmetic: null }), 'NOT_APPLICABLE');
  assert.equal(computeDeterminismReviewStatus([], { arithmetic: bigAdd }), 'SEMANTICALLY_CLOSED');
  assert.equal(makeArithCert(bigAdd).status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');

  // DECIMAL_BOUNDED is rejected by audit & compile validator
  const decimalDiv = { operations: ['DIVIDE'], numericRepresentation: 'SAFE_INTEGER_BOUNDED', operandBoundsDeclared: true, operandMin: '1', operandMax: '100', quotientPolicy: 'DECIMAL_BOUNDED', remainderPolicy: 'DISCARD', zeroDivisorPolicy: 'REJECT' };
  assert.equal(makeArithCert(decimalDiv).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');

  // Valid SAFE_INTEGER_BOUNDED division passes
  const safeDiv = { ...decimalDiv, quotientPolicy: 'TRUNC_ZERO' };
  assert.equal(makeArithCert(safeDiv).status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');

  // Pending zeroDivisorPolicy decision triggers PENDING_HUMAN_DECISIONS cleanly
  const pendingSpec = makeBaseSpec({
    decisions: [{
      questionId: 'Q-0001',
      question: 'Politica para divisor zero?',
      requirementIds: ['REQ-0001'],
      invariantIds: [],
      riskIds: [],
      distinguishingCase: {
        given: 'Divisor igual a zero.',
        when: 'Dividir 10 por 0.',
        outcomes: [
          { answerId: 'ANS-A', then: 'Lanca rejeicao deterministica.' },
          { answerId: 'ANS-B', then: 'Retorna zero.' },
        ],
      },
      answers: [
        { id: 'ANS-A', label: 'Rejeitar', rationale: 'Seguro.', contractEffect: 'Rejeita erro.', recommended: true },
        { id: 'ANS-B', label: 'Retornar zero', rationale: 'Alternativa.', contractEffect: 'Retorna 0.', recommended: false },
      ],
    }],
    determinismReview: {
      status: 'DECISION_REQUIRED',
      rationale: 'Decisao pendente.',
      sourceFragmentIds: ['FRAG-0001'],
      coverage: [],
      dimensions: [{
        kind: 'ARITHMETIC',
        subjectId: 'PUBLIC_CONTRACT',
        status: 'DECISION_REQUIRED',
        closureAuthority: 'HUMAN_DECISION',
        rationale: 'Divisor zero pendente.',
        targetIds: ['Q-0001'],
        basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
      }],
      arithmetic: { ...safeDiv, zeroDivisorPolicy: 'PENDING_DECISION' },
    },
  });
  const pendingCert = generateClosureCertificate({ specification: pendingSpec });
  assert.equal(pendingCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(pendingCert.closureAudit.counts.AWAITING_HUMAN_DECISION > 0);
  assert.equal(effectiveDeterminismStatus(pendingSpec, []), 'PENDING_HUMAN_DECISIONS');
  pass('REQ-0009 arithmetic handles BIGINT_EXACT dispensation, closed SAFE_INTEGER_BOUNDED division, DECIMAL_BOUNDED rejection, and PENDING_HUMAN_DECISIONS');
}

// 11. REQ-0010: Disjointness across all 5 targets (including dimensions) + 2x2 Cartesian product dry-run
{
  const sharedDimDecisions = [
    { questionId: 'Q-0001', answers: [{ id: 'ANS-A', preparedEffect: { requirements: [], invariants: [], risks: [], boundaryRules: [], dimensions: [{ index: 0, value: {} }] } }] },
    { questionId: 'Q-0002', answers: [{ id: 'ANS-B', preparedEffect: { requirements: [], invariants: [], risks: [], boundaryRules: [], dimensions: [{ index: 0, patch: {} }] } }] },
  ];
  assert.throws(() => assertPreparedEffectsDisjoint(sharedDimDecisions), /shared_prepared_effect_target:dimensions:0:Q-0001:Q-0002/);
  assert.equal(cartesianProduct([['A', 'B'], ['C', 'D']]).length, 4);

  // End-to-end compileSemanticContract 2x2 Cartesian dry-run (detecting 1 broken branch out of 4!)
  const { dir, preflight, request } = makeTempWorkspace('Calcular taxa e politica de arredondamento inteira.');
  try {
    const anchor = request.intentEvidence.fragments[0].anchor;
    const baseReq = makeMinimalOpinion(request).requirements[0];
    const make2x2Opinion = (badCombo) => compileSemanticOpinion(makeMinimalOpinion(request, {
      intentClaims: [{
        quote: anchor,
        fragmentIndexes: [0],
        kind: 'AMBIGUITY',
        disposition: 'DECISION',
        contractEffect: null,
        targets: [{ kind: 'DECISION', index: 0 }, { kind: 'DECISION', index: 1 }],
        rationale: 'Ambiguidade material dupla.',
      }],
      determinismReview: {
        rationale: 'Duas decisoes pendentes.',
        fragmentIndexes: [0],
        coverage: [{ claimIndex: 0, disposition: 'DIMENSIONS_DECLARED', dimensionIndexes: [0, 1], rationale: 'Cobre decisoes.' }],
        dimensions: [
          {
            kind: 'BOUNDARY_BEHAVIOR',
            subject: { kind: 'REQUIREMENT', index: 0 },
            status: 'DECISION_REQUIRED',
            rationale: 'Dimensao 1.',
            targets: [{ kind: 'REQUIREMENT', index: 0 }, { kind: 'DECISION', index: 0 }],
            basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
            acceptanceCase: null,
            proofObligation: null,
            inapplicabilityProof: null,
            counterexampleWitness: { inputClass: 'limite-1', baseline: 'Modo A1', variation: 'Modo A2' },
          },
          {
            kind: 'ROUNDING_POLICY',
            subject: { kind: 'REQUIREMENT', index: 1 },
            status: 'DECISION_REQUIRED',
            rationale: 'Dimensao 2.',
            targets: [{ kind: 'REQUIREMENT', index: 1 }, { kind: 'DECISION', index: 1 }],
            basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
            acceptanceCase: null,
            proofObligation: null,
            inapplicabilityProof: null,
            counterexampleWitness: { inputClass: 'limite-2', baseline: 'Modo B1', variation: 'Modo B2' },
          },
        ],
        arithmetic: null,
      },
      requirements: [
        {
          ...baseReq,
          acceptanceCases: [
            baseReq.acceptanceCases[0],
            baseReq.acceptanceCases[1],
            {
              ...baseReq.acceptanceCases[0],
              kind: 'HAPPY_PATH',
              given: 'Entrada padrao vinculada a Q-0001.',
              when: 'Executar alternativa recomendada A1.',
              then: 'Produz saida esperada de A1.',
              decisionBinding: { decisionIndex: 0, answerIndex: 0 },
            },
          ],
        },
        {
          ...baseReq,
          statement: 'Aplicar politica de arredondamento inteiro.',
          acceptanceCases: [
            baseReq.acceptanceCases[0],
            baseReq.acceptanceCases[1],
            {
              ...baseReq.acceptanceCases[0],
              kind: 'HAPPY_PATH',
              given: 'Entrada padrao vinculada a Q-0002.',
              when: 'Executar alternativa recomendada B1.',
              then: 'Produz saida esperada de B1.',
              decisionBinding: { decisionIndex: 1, answerIndex: 0 },
            },
          ],
        },
      ],
      invariants: [
        { statement: 'Comportamento estavel de Q1.', falsification: 'Falsificado se divergir.', falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Diverge Q1.', acceptanceCaseId: null }, requirementIndexes: [0] },
        { statement: 'Comportamento estavel de Q2.', falsification: 'Falsificado se divergir.', falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Diverge Q2.', acceptanceCaseId: null }, requirementIndexes: [1] },
      ],
      decisions: [
        {
          question: 'Escolha modo A?',
          presentation: {
            context: 'Contexto de decisao material para politica de entrada do primeiro requisito.',
            whyHumanDecision: 'Ha interpretacoes publicas distintas que exigem escolha humana explicita.',
            observableImpact: 'Altera o resultado observavel do requisito 1 sob a mesma entrada.',
            recommendationReasoning: 'Opcao recomendada preserva compatibilidade contratual sem ambiguidade.',
            glossary: [],
          },
          recommendedAnswerIndex: 0,
          requirementIndexes: [0],
          invariantIndexes: [0],
          riskIndexes: [],
          distinguishingCase: { given: 'Entrada', when: 'Acao', outcomes: [{ answerIndex: 0, then: 'Modo A1' }, { answerIndex: 1, then: 'Modo A2' }] },
          answers: [
            {
              label: 'A1',
              rationale: 'Opcao 1',
              contractEffect: 'Define A1.',
              preparedEffect: {
                requirements: [{ index: 0, patch: { statement: 'Modo A1 fechado. Define A1.' } }],
                invariants: [],
                risks: [],
                dimensions: [{
                  index: 0,
                  patch: {
                    status: 'SPECIFIED',
                    rationale: 'Fechado A1.',
                    acceptanceCase: { requirementIndex: 0, caseIndex: 0 },
                    proofObligation: {
                      relation: 'DEFINED_RESULT',
                      resolutionKind: 'EXPLICIT_POLICY',
                      resolutionParameter: null,
                      baselineOutcome: 'Modo A1 aplicado.',
                      variationOutcome: 'Modo A1 consistente.',
                      observables: ['result'],
                    },
                  },
                }],
              },
            },
            {
              label: 'A2',
              rationale: 'Opcao 2',
              contractEffect: 'Define A2.',
              preparedEffect: {
                requirements: [{ index: 0, patch: { statement: 'Modo A2 fechado. Define A2.' } }],
                invariants: [],
                risks: [],
                dimensions: [{
                  index: 0,
                  patch: {
                    status: 'SPECIFIED',
                    rationale: 'Fechado A2.',
                    acceptanceCase: { requirementIndex: 0, caseIndex: 0 },
                    proofObligation: {
                      relation: 'DEFINED_RESULT',
                      resolutionKind: 'EXPLICIT_POLICY',
                      resolutionParameter: null,
                      baselineOutcome: 'Modo A2 aplicado.',
                      variationOutcome: 'Modo A2 consistente.',
                      observables: ['result'],
                    },
                  },
                }],
              },
            },
          ],
        },
        {
          question: 'Escolha modo B?',
          presentation: {
            context: 'Contexto de decisao material para politica de arredondamento do segundo requisito.',
            whyHumanDecision: 'Ha interpretacoes publicas distintas que exigem escolha humana explicita.',
            observableImpact: 'Altera o resultado observavel do requisito 2 sob a mesma entrada.',
            recommendationReasoning: 'Opcao recomendada preserva compatibilidade contratual sem ambiguidade.',
            glossary: [],
          },
          recommendedAnswerIndex: 0,
          requirementIndexes: [1],
          invariantIndexes: [1],
          riskIndexes: [],
          distinguishingCase: { given: 'Entrada B', when: 'Acao B', outcomes: [{ answerIndex: 0, then: 'Modo B1' }, { answerIndex: 1, then: 'Modo B2' }] },
          answers: [
            {
              label: 'B1',
              rationale: 'Opcao 1',
              contractEffect: 'Define B1.',
              preparedEffect: {
                requirements: [{ index: 1, patch: { statement: 'Modo B1 fechado. Define B1.' } }],
                invariants: [],
                risks: [],
                dimensions: [{
                  index: 1,
                  patch: {
                    status: 'SPECIFIED',
                    rationale: 'Fechado B1.',
                    acceptanceCase: { requirementIndex: 1, caseIndex: 0 },
                    proofObligation: {
                      relation: 'DEFINED_RESULT',
                      resolutionKind: 'EXPLICIT_POLICY',
                      resolutionParameter: null,
                      baselineOutcome: 'Modo B1 aplicado.',
                      variationOutcome: 'Modo B1 consistente.',
                      observables: ['result'],
                    },
                  },
                }],
              },
            },
            {
              label: 'B2',
              rationale: 'Opcao 2',
              contractEffect: 'Define B2.',
              preparedEffect: {
                requirements: [{ index: 1, patch: { statement: 'Modo B2 fechado. Define B2.' } }],
                // When badCombo is true, ANS-D sets dimension status to GAP_FOUND, failing preparedEffect dry-run!
                invariants: [],
                risks: [],
                dimensions: [{
                  index: 1,
                  patch: {
                    status: badCombo ? 'GAP_FOUND' : 'SPECIFIED',
                    rationale: badCombo ? 'Gap residual.' : 'Fechado B2.',
                    acceptanceCase: badCombo ? null : { requirementIndex: 1, caseIndex: 0 },
                    proofObligation: badCombo ? null : {
                      relation: 'DEFINED_RESULT',
                      resolutionKind: 'EXPLICIT_POLICY',
                      resolutionParameter: null,
                      baselineOutcome: 'Modo B2 aplicado.',
                      variationOutcome: 'Modo B2 consistente.',
                      observables: ['result'],
                    },
                  },
                }],
              },
            },
          ],
        },
      ],
    }), request);

    assert.throws(
      () => compileSemanticContract({
        repositoryRoot: dir,
        draft: make2x2Opinion(true),
        preflight,
        policy: policyLoaded.policy,
        policyDigest: policyLoaded.policyDigest,
        constitution,
        constitutionDigest: constitution.digest,
        semanticRequest: request,
      }),
      /preparedEffect\(Q-0001\/ANS-0001-01,Q-0002\/ANS-0002-02\)/,
    );
    const compiledOk = compileSemanticContract({
      repositoryRoot: dir,
      draft: make2x2Opinion(false),
      preflight,
      policy: policyLoaded.policy,
      policyDigest: policyLoaded.policyDigest,
      constitution,
      constitutionDigest: constitution.digest,
      semanticRequest: request,
    });
    assert.equal(compiledOk.schema, 'aegis.issue_contract.v14');
    pass('REQ-0010 validates disjoint preparedEffect targets across dimensions and full 2x2 Cartesian product dry-run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 12. REQ-0011 + INV-0001..INV-0005: Tripartite Audit, Inverted Falsification, Broken Ref, Duplicate ID & Prose Invariance
{
  // Inverted falsificationSpec rejected
  const invertedCert = generateClosureCertificate({
    specification: makeBaseSpec({
      invariants: [{
        id: 'INV-0001',
        statement: 'Determinismo.',
        falsification: 'Execucoes repetidas produzem o mesmo resultado.',
        falsificationSpec: { polarity: 'CONFIRMATION', observableEffect: 'Resultados iguais.', acceptanceCaseId: null },
        requirementIds: ['REQ-0001'],
      }],
    }),
  });
  assert.equal(invertedCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');

  // Duplicate ID & broken ref rejected
  const brokenRefCert = generateClosureCertificate({
    specification: makeBaseSpec({
      invariants: [{
        id: 'INV-0001',
        statement: 'Ok.',
        falsification: 'Falsificado se violar.',
        requirementIds: ['REQ-9999'],
      }],
    }),
  });
  assert.equal(brokenRefCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');

  // Valid prose-only invariant (without computable falsificationSpec) emits SEMANTIC_REVIEW_REQUIRED and closes once acknowledged; zero semantic review items certifies CERTIFIED_CLOSED directly
  assert.equal(generateClosureCertificate({ specification: makeBaseSpec({ invariants: [] }) }).status, 'CERTIFIED_CLOSED');
  const proseInvCert = generateClosureCertificate({
    specification: makeBaseSpec({
      invariants: [{
        id: 'INV-0001',
        statement: 'Comportamento puro.',
        falsification: 'Falsificado se duas chamadas identicas divergirem.',
        requirementIds: ['REQ-0001'],
      }],
    }),
    semanticReviewAcknowledged: true,
  });
  assert.equal(proseInvCert.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  assert.ok(proseInvCert.closureAudit.counts.SEMANTIC_REVIEW_REQUIRED >= 1);
  assert.ok(proseInvCert.closureAudit.counts.MECHANICALLY_VERIFIED >= 1);

  // INV-0001 Prose Invariance: changing natural-language prose words NEVER changes structural verdict
  const proseMutatedSpec = makeBaseSpec({
    requirements: [makeBaseReq({
      statement: 'Processar timestamp divisao lote normalizacao chave http externa.',
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], given: 'Lote com timestamp e divisao.', when: 'Dividir e normalizar chave.', then: 'Sem erro.' },
        { ...makeBaseReq().acceptanceCases[1], given: 'Timestamp invalido.', when: 'Dividir por zero.', then: 'Falha.' },
      ],
    })],
  });
  const baselineCert = generateClosureCertificate({ specification: makeBaseSpec(), semanticReviewAcknowledged: true });
  const mutatedCert = generateClosureCertificate({ specification: proseMutatedSpec, semanticReviewAcknowledged: true });
  assert.equal(baselineCert.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
  assert.equal(mutatedCert.status, baselineCert.status);
  assert.equal(mutatedCert.gapLedger.length, 0);
  pass('REQ-0011 & INV-0001..INV-0005 tripartite audit, falsification direction, prose-invariant closure & stateless pass verified');
}

// 13. Isolated CLI E2E flow: draft -> semantic-request -> semantic-compile (reject broken, accept valid) -> approve -> verify
{
  const { dir } = makeTempWorkspace('Executar divisao inteira consistente em src/ledger.js.');
  try {
    mkdirSync(resolve(dir, '.harness/runtime'), { recursive: true });
    mkdirSync(resolve(dir, 'src'), { recursive: true });
    writeFileSync(resolve(dir, 'src/ledger.js'), 'export function dividir(a, b) { return a / b; }\n');
    cpSync(resolve(repositoryRoot, 'ARCHITECTURE.md'), resolve(dir, 'ARCHITECTURE.md'));
    const cli = (cmd, args = [], stdinJson = null) => execFileSync(
      process.execPath,
      [runnerPath, cmd, ...args],
      {
        cwd: dir,
        env: { ...process.env, AEGIS_ROOT: dir, AEGIS_TEST_AUTOMATION: '1' },
        input: stdinJson === null ? undefined : JSON.stringify(stdinJson),
        encoding: 'utf8',
      },
    );

    cli('draft', ['Executar divisao inteira consistente em src/ledger.js.']);
    const reqJson = JSON.parse(cli('semantic-request'));
    const brokenOpinion = makeMinimalOpinion(reqJson, {
      determinismReview: {
        ...makeMinimalOpinion(reqJson).determinismReview,
        arithmetic: {
          operations: ['DIVIDE'],
          numericRepresentation: 'SAFE_INTEGER_BOUNDED',
          operandBoundsDeclared: true,
          operandMin: '1',
          operandMax: '1000',
          quotientPolicy: 'DECIMAL_BOUNDED',
          remainderPolicy: 'DISCARD',
          zeroDivisorPolicy: 'REJECT',
        },
      },
    });
    assert.throws(() => cli('semantic-compile', [], brokenOpinion), /issue_runner_failed|quotientPolicy|DECIMAL_BOUNDED/);

    const validOpinion = makeMinimalOpinion(reqJson, {
      determinismReview: {
        ...makeMinimalOpinion(reqJson).determinismReview,
        arithmetic: {
          operations: ['DIVIDE'],
          numericRepresentation: 'SAFE_INTEGER_BOUNDED',
          operandBoundsDeclared: true,
          operandMin: '1',
          operandMax: '1000',
          quotientPolicy: 'TRUNC_ZERO',
          remainderPolicy: 'DISCARD',
          zeroDivisorPolicy: 'REJECT',
        },
      },
    });
    cli('semantic-compile', [], validOpinion);
    cli('approve');
    const verifyOut = JSON.parse(cli('verify'));
    assert.equal(verifyOut.status, 'VALID');
    assert.equal(reqJson.schema, 'aegis.semantic_request.v10');
    pass('Isolated E2E CLI flow (draft -> semantic-request -> semantic-compile -> approve -> verify) passed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 14. Fase 0 regressions: intent provenance forwarding (0.2), optional null constraints (0.3), :L line ref normalization (0.4)
{
  const provenanceSpec = makeBaseSpec({
    intent: 'Limite maximo 100 na operacao.',
    stateModel: {
      entities: [{
        name: 'Conta',
        keyField: 'id',
        fields: [{
          name: 'saldo',
          type: 'integer',
          nullable: false,
          unit: 'BRL',
          bounds: {
            lowerBound: 0,
            upperBound: 100,
            unit: 'BRL',
            overflowPolicy: 'REJECT',
            provenance: [{ source: 'USER_INTENT', reference: 'referencia ausente da demanda' }],
          },
          persistence: 'IN_MEMORY',
          lifecycle: { createdAt: 'INIT', updatedAt: 'ON_OPERATION', boundedBy: 'BOUNDED_BY_CAP', resetPolicy: 'NEVER' },
          serialization: 'JSON_STRING',
        }],
        capacityPolicy: { kind: 'UNBOUNDED', reason: 'Entidade unica.' },
      }],
      operations: [{ name: 'debitar', inputs: [], outputs: [], errors: [], sideEffects: [], idempotency: 'NONE', executionModel: 'SYNCHRONOUS_IN_MEMORY' }],
      observables: [{ name: 'saldoFinal', kind: 'RETURN_VALUE', unit: 'BRL' }],
    },
  });
  const provenanceCert = generateClosureCertificate({ specification: provenanceSpec, semanticReviewAcknowledged: true });
  assert.equal(provenanceCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(provenanceCert.gapLedger.some((g) => g.layer === 'AUTHORITY_PROVENANCE' && /referencia ausente da demanda/.test(g.witness ?? '')));

  const wireOpinion = { stateModel: { operations: [{ branches: [{ externalEffects: [{ requestPayload: [{ field: 'amount', type: 'number', required: true, nullable: false, constraints: null }] }] }] }] } };
  omitOptionalNulls(wireOpinion, standaloneSchemaDocument('aegis.semantic_opinion.v3'));
  const normalizedPayloadField = wireOpinion.stateModel.operations[0].branches[0].externalEffects[0].requestPayload[0];
  assert.equal(Object.hasOwn(normalizedPayloadField, 'constraints'), false);
  assert.equal(isCompletePayloadDescriptor(normalizedPayloadField), true);

  const { dir } = makeTempWorkspace('Normalizar referencias em src/ledger.js.');
  try {
    mkdirSync(resolve(dir, 'src'), { recursive: true });
    writeFileSync(resolve(dir, 'src/ledger.js'), 'export function dividir(a, b) { return a / b; }\n');
    const demand = captureDemand(['Normalizar referencias em src/ledger.js.']);
    const workspaceObserved = observeWorkspace(dir, demand.rawText);
    const preflight = buildPreflightHandoff({ demand, discovery: workspaceObserved.discovery });
    const req = buildSemanticRequest({
      repositoryRoot: dir,
      preflight,
      policy: policyLoaded.policy,
      constitution,
      workspaceObservation: workspaceObserved,
    });
    const opinion = makeMinimalOpinion(req);
    opinion.architectureContexts[0].basis = [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger.js:1' }];
    opinion.requirements[0].basis = [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger.js:1-1' }];
    const compiled = compileSemanticOpinion(opinion, req);
    assert.equal(compiled.architectureContexts[0].basis[0].reference, 'src/ledger.js:L1');
    assert.equal(compiled.requirements[0].basis[0].reference, 'src/ledger.js:L1-L1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  pass('Fase 0 regressions (intent provenance, omitted null constraints, WORKSPACE_EVIDENCE :L normalization) verified');
}

// 15. Fase 1 bilateral guarantees: batch defect collection (1.1), explicit provenance & outcome binding without substring trap (1.2), JS safe-integer constants (1.3), prompt alignment (1.4)
{
  // 1.1 Batch collection across normalization + semantic draft checks + clean rejection cause extraction
  const { dir, request, preflight } = makeTempWorkspace('Registrar operacao deterministica em src/core.ts.');
  try {
    const context = {
      constitutionRules: constitution.rules,
      intent: preflight.intent,
      intentEvidence: request.intentEvidence,
      workspaceEvidence: request.workspace.sourceEvidence,
    };
    const multiBadOpinion = makeMinimalOpinion(request);
    multiBadOpinion.policyAssessments = [{ ruleIndex: 0, demandStatus: 'COMPLIANT' }];
    multiBadOpinion.determinismReview.coverage[0].dimensionIndexes = 'bad';
    let normError;
    assert.throws(() => compileSemanticOpinion(multiBadOpinion, request), (err) => {
      normError = err;
      return true;
    });
    assert.ok(normError.message.includes('incomplete_policy_assessment'));
    assert.ok(normError.message.includes('incomplete_determinism_coverage'));
    const normReport = buildErrorRejectionReport('SEMANTIC', normError, 'INVALID_SEMANTIC_OPINION');
    assert.equal(normReport.reason, 'SEMANTIC_REVIEW_REQUIRED');
    const runnerReport = buildErrorRejectionReport('SEMANTIC', Object.assign(new Error('INVALID_SEMANTIC_OPINION'), { detail: normError.message }), 'INVALID_SEMANTIC_OPINION');
    assert.equal(runnerReport.cause, 'SEMANTIC_REVIEW_REQUIRED');

    const badDraft = compileSemanticOpinion(makeMinimalOpinion(request), request);
    badDraft.intentClaims[0].quote = 'trecho inexistente na demanda';
    badDraft.requirements[0].acceptanceCases[1].kind = 'HAPPY_PATH';
    badDraft.riskReview.status = 'FOUND';
    let draftError;
    assert.throws(() => assertSemanticDraft(badDraft, policyLoaded.policy, context), (err) => {
      draftError = err;
      return true;
    });
    assert.ok(draftError.message.includes('intent_claim_not_literal'));
    assert.ok(draftError.message.includes('requirement_without_dual_acceptance'));
    assert.ok(draftError.message.includes('risk_review_status_mismatch'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 1.2a isCodeGrounded bilateral pair: grounded PT-BR guard accepted via REQ/FRAG link; unlinked or inner-substring code rejected
  const groundedPtSpec = makeBaseSpec({
    intent: 'Rejeitar solicitacao que ultrapassar o teto autorizado.',
    fragments: [{ id: 'FRAG-0001', anchor: 'Rejeitar solicitacao que ultrapassar o teto autorizado.' }],
    requirements: [makeBaseReq({
      id: 'REQ-0001',
      sourceFragmentIds: ['FRAG-0001'],
      basis: [{ source: 'USER_INTENT', reference: 'FRAG-0001' }],
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], branchRef: 'BR_OK' },
        { ...makeBaseReq().acceptanceCases[1], outcomeKind: 'REJECTION', branchRef: 'ERR_TETO_ULTRAPASSADO' },
      ],
    })],
    stateModel: {
      entities: [],
      operations: [{
        name: 'aplicarTeto',
        guardPrecedence: ['ERR_TETO_ULTRAPASSADO'],
        branches: [
          { branchId: 'BR_OK', condition: 'valor <= teto', outcomeKind: 'RETURN', defaultPreservation: true, stateEffects: [] },
          { branchId: 'ERR_TETO_ULTRAPASSADO', condition: 'valor > teto', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
        parameters: [],
      }],
      observables: [],
    },
  });
  assert.equal(validateProvenanceEnforcement(groundedPtSpec).valid, true);

  const unlinkedCodeSpec = {
    ...groundedPtSpec,
    stateModel: {
      ...groundedPtSpec.stateModel,
      operations: [{
        ...groundedPtSpec.stateModel.operations[0],
        guardPrecedence: ['ERR_ATE', 'ERR_SEM_LASTRO'],
        branches: [
          ...groundedPtSpec.stateModel.operations[0].branches,
          { branchId: 'ERR_ATE', condition: 'false', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
          { branchId: 'ERR_SEM_LASTRO', condition: 'false', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
      }],
    },
  };
  const unlinkedRes = validateProvenanceEnforcement(unlinkedCodeSpec);
  assert.equal(unlinkedRes.valid, false);
  assert.ok(unlinkedRes.issues.some((i) => i.slotId.includes('ERR_ATE')));
  assert.ok(unlinkedRes.issues.some((i) => i.slotId.includes('ERR_SEM_LASTRO')));

  // 1.2b branchMatchesOutcome: no substring collision ('NOT_SENT' must NOT satisfy 'SENT'); explicit statusOrError matches cleanly
  const makeOutcomeTotality = (okBranch) => validateOperationTotality({
    unknowns: [{ id: 'UNK-0001', material: false, statement: 'Sem adaptador concreto.', basis: [{ source: 'CONSTITUTION', reference: 'CONST-EVIDENCE' }] }],
    workspaceSkeleton: { files: [], symbols: [] },
    requirements: [makeBaseReq({
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], outcomeKind: 'OBSERVABLE_EFFECT', branchRef: 'BR_ENVIO' },
        { ...makeBaseReq().acceptanceCases[1], outcomeKind: 'REJECTION', branchRef: 'NOT_SENT' },
      ],
    })],
    stateModel: {
      entities: [],
      operations: [{
        name: 'notificar',
        parameters: [],
        evaluatedInputs: [],
        guardPrecedence: ['NOT_SENT'],
        returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
        branches: [
          okBranch,
          { branchId: 'NOT_SENT', condition: 'falhou', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
        ],
      }],
    },
  });
  const collisionEffect = {
    action: 'EXTERNAL_OPERATION',
    targetSurface: 'webhook',
    executionOrder: 'AFTER_VALIDATION',
    possibleOutcomes: ['SENT', 'NOT_SENT'],
    requestPayload: [{ field: 'id', type: 'STRING', required: true, nullable: false, constraints: null }],
    outcomePayloads: [
      { outcome: 'SENT', fields: [{ field: 'ok', type: 'BOOLEAN', required: true, nullable: false, constraints: null }] },
      { outcome: 'NOT_SENT', fields: [{ field: 'err', type: 'STRING', required: true, nullable: false, constraints: null }] },
    ],
  };
  const collisionFail = makeOutcomeTotality({
    branchId: 'BR_ENVIO',
    condition: 'true',
    outcomeKind: 'OBSERVABLE_EFFECT',
    statusOrError: 'OK_CUSTOM',
    defaultPreservation: true,
    stateEffects: [],
    externalEffects: [collisionEffect],
  });
  assert.equal(collisionFail.valid, false);
  assert.ok(collisionFail.issues.some((i) => i.slotId.includes('outcomeBranch/SENT')));

  const explicitBindPass = makeOutcomeTotality({
    branchId: 'BR_ENVIO',
    condition: 'true',
    outcomeKind: 'OBSERVABLE_EFFECT',
    statusOrError: 'SENT',
    defaultPreservation: true,
    stateEffects: [],
    externalEffects: [collisionEffect],
  });
  assert.equal(explicitBindPass.valid, true);

  // 1.3 Standard JS safe-integer constant recognition in workspaceSupportsValue
  const safeIntRes = validateProvenanceEnforcement({
    intent: 'Validar valor seguro.',
    workspaceEvidence: [{ path: 'src/limits.ts', startLine: 1, content: 'export const ok = (n: number) => Number.isSafeInteger(n);' }],
    stateModel: {
      entities: [{
        name: 'Envio',
        fields: [{
          name: 'valor',
          type: 'INTEGER',
          bounds: {
            lowerBound: '0',
            upperBound: '9007199254740991',
            boundaryBehavior: 'REJECT',
            provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/limits.ts:L1' }],
          },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [],
          preservation: ['*'],
          readBy: ['*'],
        }],
      }],
      operations: [],
      observables: [],
    },
  });
  assert.equal(safeIntRes.valid, true);

  const badSafeIntRes = validateProvenanceEnforcement({
    intent: 'Validar valor seguro.',
    workspaceEvidence: [{ path: 'src/limits.ts', startLine: 1, content: 'export const ok = (n: number) => Number.isSafeInteger(n);' }],
    stateModel: {
      entities: [{
        name: 'Envio',
        fields: [{
          name: 'valor',
          type: 'INTEGER',
          bounds: {
            lowerBound: '0',
            upperBound: '123456',
            boundaryBehavior: 'REJECT',
            provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/limits.ts:L1' }],
          },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [],
          preservation: ['*'],
          readBy: ['*'],
        }],
      }],
      operations: [],
      observables: [],
    },
  });
  assert.equal(badSafeIntRes.valid, false);

  // 1.4 Gateway prompt aligned with stripped schema & trimmed block count
  const gatewayPrompt = semanticSupervisorInstructions({ constitution });
  assert.equal(gatewayPrompt.includes('coverage, disposição'), false);
  assert.ok(gatewayPrompt.split('\n').length <= 20);
  pass('Fase 1 bilateral guarantees (batch defects, explicit provenance/outcome match, safe-integer constants, prompt alignment) verified');
}

// 16. Fase 2 bilateral guarantees: auto-derivation (2.1), decoupled preparedEffect wording (2.2), multi-decision single requirement (2.3), schema shrink & D1/D2 stateless lens (2.4)
{
  // 2.1 Auto-derivation of fragmentIndexes, COMPLIANT policyAssessments, NO_DIMENSION_APPLICABLE coverage + strict DECISION check
  const d1 = makeTempWorkspace('Somar dois inteiros seguros sem estado.');
  try {
    const { request, preflight } = d1;
    const d1Context = {
      constitutionRules: constitution.rules,
      intent: preflight.intent,
      intentEvidence: request.intentEvidence,
      workspaceEvidence: request.workspace.sourceEvidence,
    };
    const leanOpinion = makeMinimalOpinion(request);
    leanOpinion.policyAssessments = [];
    delete leanOpinion.determinismReview.fragmentIndexes;
    leanOpinion.determinismReview.coverage = [];
    const compiledLean = compileSemanticOpinion(leanOpinion, request);
    assertSemanticDraft(compiledLean, policyLoaded.policy, d1Context);
    assert.deepEqual(compiledLean.determinismReview.sourceFragmentIds, ['FRAG-0001']);
    assert.ok(compiledLean.policyAssessments.some((a) => a.ruleId === 'ARCH-PRODUCT-BOUNDARY' && a.recommendedStatus === 'COMPLIANT'));
    assert.equal(compiledLean.determinismReview.coverage[0].disposition, 'NO_DIMENSION_APPLICABLE');
    assert.equal(compiledLean.decisions.length, 0);
    assert.equal(compiledLean.unknowns.length, 0);
    const certD1 = generateClosureCertificate({ specification: { ...compiledLean, intent: preflight.intent, intentEvidence: request.intentEvidence }, semanticReviewAcknowledged: true });
    assert.equal(certD1.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
    assert.equal(certD1.gapLedger.length, 0);

    // Bilateral strict guard: omitting coverage for a DECISION claim MUST still fail
    const badDecisionCov = makeMinimalOpinion(request, {
      intentClaims: [{
        quote: request.intentEvidence.fragments[0].anchor,
        fragmentIndexes: [0],
        kind: 'AMBIGUITY',
        disposition: 'DECISION',
        contractEffect: null,
        targets: [{ kind: 'DECISION', index: 0 }],
        rationale: 'Decisao aberta.',
      }],
      determinismReview: {
        rationale: 'Pendente.',
        coverage: [],
        dimensions: [],
        arithmetic: null,
      },
    });
    assert.throws(() => compileSemanticOpinion(badDecisionCov, request), /missing_determinism_claim_coverage/);
  } finally {
    rmSync(d1.dir, { recursive: true, force: true });
  }

  // 2.2 + 2.3 Multiple independent decisions patching distinct acceptanceCases of ONE REQ-0001 without repeating contractEffect
  const sameReqConflict = [
    { questionId: 'Q-0001', answers: [{ id: 'ANS-A', preparedEffect: { requirements: [{ index: 0, patch: { statement: 'A' } }] } }] },
    { questionId: 'Q-0002', answers: [{ id: 'ANS-B', preparedEffect: { requirements: [{ index: 0, patch: { statement: 'B' } }] } }] },
  ];
  assert.throws(() => assertPreparedEffectsDisjoint(sameReqConflict), /shared_prepared_effect_target:requirements:0:Q-0001:Q-0002/);

  const multi = makeTempWorkspace('Calcular desconto em lote com duas politicas configuraveis.');
  try {
    const { dir, preflight, request } = multi;
    const anchor = request.intentEvidence.fragments[0].anchor;
    const baseReq = makeMinimalOpinion(request).requirements[0];
    const sharedReqOpinion = makeMinimalOpinion(request, {
      intentClaims: [{
        quote: anchor,
        fragmentIndexes: [0],
        kind: 'AMBIGUITY',
        disposition: 'DECISION',
        contractEffect: null,
        targets: [{ kind: 'DECISION', index: 0 }, { kind: 'DECISION', index: 1 }],
        rationale: 'Duas escolhas no mesmo requisito.',
      }],
      determinismReview: {
        rationale: 'Duas escolhas.',
        coverage: [{ claimIndex: 0, dimensionIndexes: [0, 1], rationale: 'Cobre ambas.' }],
        dimensions: [
          {
            kind: 'ROUNDING_POLICY',
            subject: { kind: 'REQUIREMENT', index: 0 },
            status: 'DECISION_REQUIRED',
            rationale: 'Escolha 1.',
            targets: [{ kind: 'REQUIREMENT', index: 0 }, { kind: 'DECISION', index: 0 }],
            basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
            acceptanceCase: null,
            proofObligation: null,
            inapplicabilityProof: null,
            counterexampleWitness: { inputClass: 'divisao', baseline: 'Trunca', variation: 'Rejeita' },
          },
          {
            kind: 'EMPTY_BATCH_POLICY',
            subject: { kind: 'REQUIREMENT', index: 0 },
            status: 'DECISION_REQUIRED',
            rationale: 'Escolha 2.',
            targets: [{ kind: 'REQUIREMENT', index: 0 }, { kind: 'DECISION', index: 1 }],
            basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
            acceptanceCase: null,
            proofObligation: null,
            inapplicabilityProof: null,
            counterexampleWitness: { inputClass: 'lote-vazio', baseline: 'Noop', variation: 'Erro' },
          },
        ],
        arithmetic: null,
      },
      requirements: [{
        ...baseReq,
        acceptanceCases: [
          baseReq.acceptanceCases[0],
          baseReq.acceptanceCases[1],
          { ...baseReq.acceptanceCases[0], kind: 'HAPPY_PATH', given: 'Q1 recomendado', when: 'Truncar resto.', then: 'Retorna inteiro truncado.', decisionBinding: { decisionIndex: 0, answerIndex: 0 } },
          { ...baseReq.acceptanceCases[0], kind: 'HAPPY_PATH', given: 'Q2 recomendado', when: 'Lote vazio.', then: 'Retorna noop.', decisionBinding: { decisionIndex: 1, answerIndex: 0 } },
        ],
      }],
      decisions: [
        {
          question: 'Como tratar resto?',
          presentation: {
            context: 'Resto de divisao inteira no requisito unico de desconto em lote.',
            whyHumanDecision: 'Ha interpretacoes publicas distintas que exigem escolha humana sobre o residual.',
            observableImpact: 'Altera o valor retornado quando a divisao em lote gera resto.',
            recommendationReasoning: 'Truncar preserva regra simples e deterministica sem redistribuicao.',
            glossary: [],
          },
          recommendedAnswerIndex: 0,
          requirementIndexes: [0],
          invariantIndexes: [0],
          riskIndexes: [],
          distinguishingCase: { given: '10 / 3', when: 'Calcular', outcomes: [{ answerIndex: 0, then: '3' }, { answerIndex: 1, then: 'Erro' }] },
          answers: [
            {
              label: 'Truncar',
              rationale: 'Simples',
              contractEffect: 'Descricao livre Q1A sem substring literal',
              preparedEffect: {
                requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 2, then: 'Devolve quociente inteiro 3.' }] } }],
                dimensions: [{ index: 0, patch: { status: 'SPECIFIED', rationale: 'Fechado.', acceptanceCase: { requirementIndex: 0, caseIndex: 2 }, proofObligation: { relation: 'DEFINED_RESULT', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: '3', variationOutcome: '3', observables: ['out'] } } }],
              },
            },
            {
              label: 'Rejeitar',
              rationale: 'Estrito',
              contractEffect: 'Descricao livre Q1B sem substring literal',
              preparedEffect: {
                requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 2, outcomeKind: 'REJECTION', then: 'Lanca erro explicito.' }] } }],
                dimensions: [{ index: 0, patch: { status: 'SPECIFIED', rationale: 'Fechado.', acceptanceCase: { requirementIndex: 0, caseIndex: 2 }, proofObligation: { relation: 'EXPLICIT_REJECTION', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: 'Rejeita', variationOutcome: 'Rejeita', observables: ['out'] } } }],
              },
            },
          ],
        },
        {
          question: 'Como tratar lote vazio?',
          presentation: {
            context: 'Tratamento de lote vazio no requisito unico de desconto em lote.',
            whyHumanDecision: 'Ha interpretacoes publicas distintas entre noop idempotente e rejeicao explicita.',
            observableImpact: 'Altera a resposta publica quando o lote de entrada chega sem itens.',
            recommendationReasoning: 'Retornar noop evita erro espurio mantendo compatibilidade.',
            glossary: [],
          },
          recommendedAnswerIndex: 0,
          requirementIndexes: [0],
          invariantIndexes: [0],
          riskIndexes: [],
          distinguishingCase: { given: 'Lote []', when: 'Calcular', outcomes: [{ answerIndex: 0, then: 'Noop' }, { answerIndex: 1, then: 'Erro' }] },
          answers: [
            {
              label: 'Noop',
              rationale: 'Idempotente',
              contractEffect: 'Descricao livre Q2A sem substring literal',
              preparedEffect: {
                requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 3, then: 'Nao altera estado em lote vazio.' }] } }],
                dimensions: [{ index: 1, patch: { status: 'SPECIFIED', rationale: 'Fechado.', acceptanceCase: { requirementIndex: 0, caseIndex: 3 }, proofObligation: { relation: 'DEFINED_RESULT', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: 'Noop', variationOutcome: 'Noop', observables: ['out'] } } }],
              },
            },
            {
              label: 'Erro',
              rationale: 'Valida nao vazio',
              contractEffect: 'Descricao livre Q2B sem substring literal',
              preparedEffect: {
                requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 3, outcomeKind: 'REJECTION', then: 'Rejeita lote vazio.' }] } }],
                dimensions: [{ index: 1, patch: { status: 'SPECIFIED', rationale: 'Fechado.', acceptanceCase: { requirementIndex: 0, caseIndex: 3 }, proofObligation: { relation: 'EXPLICIT_REJECTION', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: 'Rejeita', variationOutcome: 'Rejeita', observables: ['out'] } } }],
              },
            },
          ],
        },
      ],
    });
    const compiledShared = compileSemanticOpinion(sharedReqOpinion, request);
    assertPreparedEffectsDisjoint(compiledShared.decisions);
    const contractShared = compileSemanticContract({
      repositoryRoot: dir,
      draft: compiledShared,
      preflight,
      policy: policyLoaded.policy,
      policyDigest: policyLoaded.policyDigest,
      constitution,
      constitutionDigest: constitution.digest,
      semanticRequest: request,
    });
    assert.equal(contractShared.specification.decisions.length, 2);
  } finally {
    rmSync(multi.dir, { recursive: true, force: true });
  }
  pass('Fase 2 bilateral guarantees (auto-derivation, decoupled preparedEffect, multi-decision single requirement, stateless D1/D2) verified');
}

// 17. Fase 3 bilateral guarantees: Early-Stop <= 5 KB (3.1), UNBOUND_ABSTRACT_BOUNDARY (3.2), unified question protocol (3.3)
{
  // 3.1 Early-Stop <= 5 KB isolated CLI E2E + byte-cap & path-hallucination rejections
  const { dir, request } = makeTempWorkspace('Reverter liquidacao com persistencia externa.');
  try {
    mkdirSync(resolve(dir, '.harness/runtime'), { recursive: true });
    mkdirSync(resolve(dir, 'src'), { recursive: true });
    writeFileSync(resolve(dir, 'src/ledger.js'), 'export function revert() { return true; }\n');
    cpSync(resolve(repositoryRoot, 'ARCHITECTURE.md'), resolve(dir, 'ARCHITECTURE.md'));
    const cli = (cmd, args = [], stdinJson = null) => execFileSync(
      process.execPath,
      [runnerPath, cmd, ...args],
      {
        cwd: dir,
        env: { ...process.env, AEGIS_ROOT: dir, AEGIS_TEST_AUTOMATION: '1' },
        input: stdinJson === null ? undefined : JSON.stringify(stdinJson),
        encoding: 'utf8',
      },
    );
    cli('draft', ['Reverter liquidacao com persistencia externa em src/ledger.js.']);
    const reqJson = JSON.parse(cli('semantic-request'));
    const earlyOpinion = {
      schema: 'aegis.early_clarification_opinion.v1',
      sourceEvidenceDigest: reqJson.intentEvidence.evidenceDigest,
      summary: 'A demanda pede reversao de liquidacao sobre ledger sem definir politica de residual.',
      questions: [{
        question: 'Qual regra aplicar quando houver valor residual em centavos?',
        materialEffect: 'Altera o valor publico devolvido ao usuario em divisao inexata.',
        fragmentIndexes: [0],
        sourcePaths: ['src/ledger.js'],
        options: [
          { label: 'Preservar liquido original', effect: 'Mantem taxa e liquido originais sem arredondar.' },
          { label: 'Rejeitar residual nao exato', effect: 'Retorna erro explicito antes de persistir.' },
        ],
      }],
    };
    const earlyBytes = Buffer.byteLength(JSON.stringify(earlyOpinion), 'utf8');
    assert.ok(earlyBytes <= 5120, `Expected <= 5120 bytes, got ${earlyBytes}`);
    const earlyOut = JSON.parse(cli('semantic-compile', [], {
      sourceSemanticRequestDigest: reqJson.requestDigest,
      opinion: earlyOpinion,
    }));
    assert.equal(earlyOut.schema, 'aegis.clarification_request.v1');
    assert.equal(earlyOut.mode, 'EARLY_CLARIFICATION');
    assert.equal(earlyOut.earlyStop, true);
    assert.equal(earlyOut.questions[0].sourcePaths[0], 'src/ledger.js');
    assert.equal(existsSync(resolve(dir, '.harness/runtime/user_clarification_request.json')), true);
    assert.equal(existsSync(resolve(dir, '.harness/runtime/contract.json')), false);

    // Bilateral rejects on Early-Stop: oversized packet & hallucinated src/ path
    assert.throws(() => compileEarlyClarification({
      ...earlyOpinion,
      summary: 'x'.repeat(5200),
    }, request), /early_clarification_too_large/);
    assert.throws(() => compileEarlyClarification({
      ...earlyOpinion,
      questions: [{ ...earlyOpinion.questions[0], sourcePaths: ['src/nao_existe.ts'] }],
    }, reqJson), /invalid_early_clarification_path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 3.2 UNBOUND_ABSTRACT_BOUNDARY bilateral tests: accepts missing adapter + closed states; rejects when adapter exists or branch missing
  const makeAbstractPortSpec = ({ skeletonFiles, includeCompBranch }) => validateOperationTotality({
    unknowns: [{ id: 'UNK-0001', material: false, statement: 'Adaptador externo livre.', basis: [{ source: 'CONSTITUTION', reference: 'CONST-EVIDENCE' }] }],
    workspaceSkeleton: { files: skeletonFiles, symbols: [] },
    requirements: [makeBaseReq({
      acceptanceCases: [
        { ...makeBaseReq().acceptanceCases[0], outcomeKind: 'OBSERVABLE_EFFECT', branchRef: 'REV_SUCCESS' },
        { ...makeBaseReq().acceptanceCases[1], outcomeKind: 'REJECTION', branchRef: 'REV_PARTIAL_FAILURE' },
        ...(includeCompBranch ? [{ ...makeBaseReq().acceptanceCases[1], outcomeKind: 'REJECTION', branchRef: 'REV_COMPENSATION_INCOMPLETE' }] : []),
      ],
    })],
    stateModel: {
      entities: [],
      operations: [{
        name: 'revertRemote',
        parameters: [],
        evaluatedInputs: [],
        guardPrecedence: includeCompBranch ? ['REV_PARTIAL_FAILURE', 'REV_COMPENSATION_INCOMPLETE'] : ['REV_PARTIAL_FAILURE'],
        returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'Error' },
        branches: [
          {
            branchId: 'REV_SUCCESS',
            condition: 'ok',
            outcomeKind: 'OBSERVABLE_EFFECT',
            defaultPreservation: true,
            stateEffects: [],
            externalEffects: [{
              action: 'EXTERNAL_OPERATION',
              externalInterfaceStatus: 'UNBOUND_ABSTRACT_BOUNDARY',
              targetSurface: 'webhook',
              executionOrder: 'AFTER_STATE',
              possibleOutcomes: ['SUCCESS', 'PARTIAL_FAILURE', 'COMPENSATION_INCOMPLETE'],
              requestPayload: null,
              outcomePayloads: null,
            }],
          },
          { branchId: 'REV_PARTIAL_FAILURE', condition: 'partial', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
          ...(includeCompBranch ? [{ branchId: 'REV_COMPENSATION_INCOMPLETE', condition: 'comp_fail', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] }] : []),
        ],
      }],
    },
  });
  assert.equal(makeAbstractPortSpec({ skeletonFiles: ['src/index.ts'], includeCompBranch: true }).valid, true);
  const adapterExistsRes = makeAbstractPortSpec({ skeletonFiles: ['src/webhook.ts'], includeCompBranch: true });
  assert.equal(adapterExistsRes.valid, false);
  assert.ok(adapterExistsRes.issues.some((i) => i.slotId.includes('externalInterfaceStatus')));
  const missingOutcomeBranch = makeAbstractPortSpec({ skeletonFiles: ['src/index.ts'], includeCompBranch: false });
  assert.equal(missingOutcomeBranch.valid, false);
  assert.ok(missingOutcomeBranch.issues.some((i) => i.slotId.includes('outcomeBranch/COMPENSATION_INCOMPLETE')));

  // 3.3 Unified question protocol mode checks
  const savedState = JSON.parse(readFileSync(resolve(repositoryRoot, '.harness/state/semantic-state.json'), 'utf8'));
  const contractBase = { ...savedState.contract, approval: null, specification: { ...savedState.contract.specification, closureCertificate: { ...savedState.contract.specification.closureCertificate } } };
  const openProto = buildQuestionRequest({
    ...contractBase,
    specification: {
      ...contractBase.specification,
      unknowns: [{
        id: 'UNKNOWN-0001',
        statement: 'Como autenticar cliente?',
        material: true,
        materialEffect: 'Muda esquema de autenticacao.',
        decisionId: null,
        sourceFragmentIds: [contractBase.intentEvidence.fragments[0].id],
        basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
      }],
    },
  }, { mode: 'OPEN_CLARIFICATION' });
  assert.equal(openProto.schema, 'aegis.clarification_request.v1');
  assert.equal(openProto.mode, 'OPEN_CLARIFICATION');
  const finiteProto = buildQuestionRequest(contractBase, { mode: 'FINITE_DECISION' });
  assert.equal(finiteProto.schema, 'aegis.confirmation_request.v5');
  assert.equal(finiteProto.mode, 'FINITE_DECISION');
  pass('Fase 3 bilateral guarantees (Early-Stop <= 5 KB, UNBOUND_ABSTRACT_BOUNDARY, unified question protocol) verified');
}

// 18. Fase 4 bilateral guarantees: stateModel derivation (4.1), allowedValues grounding (4.2), selective workspace dispatch (4.3), actionable rejections (4.4)
{
  // 4.1 Auto-derive mutations/preservation/readBy + unique short field name, without hiding missing branch preservation
  const s4 = makeTempWorkspace('Incrementar counter e bloquear quando limite exceder.');
  try {
    const { request, preflight } = s4;
    const anchor = request.intentEvidence.fragments[0].anchor;
    const derivedOpinion = makeMinimalOpinion(request, {
      architectureContexts: [
        { contextIndex: 0, rationale: 'Demanda produto.', basis: [{ source: 'USER_INTENT', reference: anchor }] },
        { contextIndex: policyLoaded.policy.contexts.findIndex((c) => c.tag === 'stateful-operation'), rationale: 'Estado mutavel.', basis: [{ source: 'USER_INTENT', reference: anchor }] },
      ],
      policyAssessments: [],
      determinismReview: { rationale: 'Fechado.', coverage: [], dimensions: [], arithmetic: null },
      requirements: [{
        kind: 'FUNCTIONAL',
        statement: 'Incrementar counter com limite 3 e estado BLOQUEADA.',
        basis: [{ source: 'USER_INTENT', reference: anchor }],
        fragmentIndexes: [0],
        measurement: null,
        acceptanceCases: [
          { kind: 'HAPPY_PATH', given: 'Ok', when: 'inc', then: 'Soma', outcomeKind: 'STATE_CHANGE', branchRef: 'INC_OK', decisionBinding: null, boundaryBinding: null },
          { kind: 'FAILURE', given: 'Bloqueado', when: 'inc', then: 'Rejeita', outcomeKind: 'REJECTION', branchRef: 'INC_BLOCKED', decisionBinding: null, boundaryBinding: null },
        ],
      }],
      stateModel: {
        entities: [{
          name: 'LimitState',
          isCollection: false,
          fields: [
            {
              name: 'counter',
              type: 'INTEGER',
              bounds: { lowerBound: '0', upperBound: '3', boundaryBehavior: 'SATURATE', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-OBSERVABLE' }] },
              initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Zero.' },
              reset: { allowed: false, trigger: null, resetValue: null },
            },
            {
              name: 'status',
              type: 'STRING',
              allowedValues: ['ACTIVE', 'BLOQUEADA'],
              initialization: { kind: 'EXPLICIT_VALUE', value: 'ACTIVE', rationale: 'Ativo.' },
              reset: { allowed: false, trigger: null, resetValue: null },
            },
          ],
        }],
        operations: [{
          name: 'inc',
          executionModel: 'SYNCHRONOUS_IN_MEMORY',
          evaluatedInputs: [],
          parameters: [],
          returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'ERR' },
          guardPrecedence: ['INC_BLOCKED'],
          branches: [
            { branchId: 'INC_BLOCKED', condition: 'blocked', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
            { branchId: 'INC_OK', condition: 'ok', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'counter', effect: 'INCREMENT', value: '1' }, { field: 'status', effect: 'SET', value: 'BLOQUEADA' }] },
          ],
        }],
        observables: [],
      },
    });
    const compiled = compileSemanticOpinion(derivedOpinion, request);
    const counterField = compiled.stateModel.entities[0].fields[0];
    assert.equal(counterField.mutations.length, 1);
    assert.equal(counterField.mutations[0].operation, 'inc');
    assert.deepEqual(counterField.readBy, ['inc']);
    const cert = generateClosureCertificate({ specification: { ...compiled, intent: preflight.intent, intentEvidence: request.intentEvidence }, semanticReviewAcknowledged: true });
    assert.equal(cert.status, 'CLOSED_WITH_ACKNOWLEDGED_SEMANTIC_REVIEW');
    assert.equal(cert.gapLedger.length, 0);

    // Bilateral negative check: unpreserved non-mutating branch must NOT be silently auto-marked as preserved
    const unpreservedOpinion = makeMinimalOpinion(request, {
      ...derivedOpinion,
      stateModel: {
        ...derivedOpinion.stateModel,
        operations: [
          ...derivedOpinion.stateModel.operations,
          {
            name: 'peek',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: [],
            parameters: [],
            returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'ERR' },
            guardPrecedence: [],
            noGuardsRationale: 'Leitura.',
            branches: [{ branchId: 'PEEK_OK', condition: 'always', outcomeKind: 'RETURN_VALUE', defaultPreservation: false, stateEffects: [] }],
          },
        ],
      },
    });
    const compiledUnpreserved = compileSemanticOpinion(unpreservedOpinion, request);
    assert.deepEqual(compiledUnpreserved.stateModel.entities[0].fields[0].preservation, []);
    const blockedCert = generateClosureCertificate({ specification: { ...compiledUnpreserved, intent: preflight.intent, intentEvidence: request.intentEvidence }, semanticReviewAcknowledged: true });
    assert.equal(blockedCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  } finally {
    rmSync(s4.dir, { recursive: true, force: true });
  }

  // 4.3 Selective workspace dispatch in multi-file smallWorkspace (greenfield vs targeted)
  const preflightRepo = buildPreflightHandoff({ demand: 'Calcular desconto de produto puro sem ler codigo', discovery: observeWorkspace(repositoryRoot, 'Calcular desconto de produto puro sem ler codigo').discovery, version: 'v3' });
  const reqGreenfield = buildSemanticRequest({ repositoryRoot, preflight: preflightRepo, policy: policyLoaded.policy, constitution });
  assert.deepEqual(reqGreenfield.workspace.sourceEvidence.map((e) => e.path), ['src/index.ts']);
  assert.equal(reqGreenfield.workspace.workspaceSkeleton, undefined);

  const preflightTargeted = buildPreflightHandoff({ demand: 'Alterar reverseSettlement em settlement_engine.ts e velocity_guard.ts', discovery: observeWorkspace(repositoryRoot, 'Alterar reverseSettlement em settlement_engine.ts e velocity_guard.ts').discovery, version: 'v3' });
  const reqTargeted = buildSemanticRequest({ repositoryRoot, preflight: preflightTargeted, policy: policyLoaded.policy, constitution });
  assert.ok(reqTargeted.workspace.sourceEvidence.some((e) => e.path === 'src/ledger/settlement_engine.ts'));
  assert.ok((reqTargeted.workspace.workspaceSkeleton?.symbols?.length ?? 0) <= 30);
  pass('Fase 4 bilateral guarantees (stateModel derivation, allowedValues grounding, selective workspace dispatch) verified');
}

// =========================================================================
// 19. Fase 6 guarantees: preparedEffect closure dry-run, compact request, schema hints, modular witnesses
// =========================================================================
{
  // Rec 2: --compact envelope preserves requestDigest and eliminates policy/constitution/schema bloat
  const greenPreflight = buildPreflightHandoff({
    demand: 'Calcular desconto de produto dado preco base >= 0.',
    discovery: observeWorkspace(repositoryRoot, 'Calcular desconto de produto dado preco base >= 0.').discovery,
    version: 'v3',
  });
  const fullReq = buildSemanticRequest({ repositoryRoot, preflight: greenPreflight, policy: policyLoaded.policy, constitution });
  const compactReq = buildCompactSemanticRequest(fullReq);
  assert.equal(compactReq.requestDigest, fullReq.requestDigest);
  assert.equal(compactReq.contextDigest, fullReq.contextDigest);
  assert.equal(compactReq.outputSchema.document, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(compactReq), 'utf8') < 6000);

  // Rec 3: Output schema exposes conditional hints on known trap fields
  const outSchema = buildSemanticOutputSchema({ shared: false });
  assert.match(outSchema.properties.intentClaims.items.properties.contractEffect.description ?? '', /NORMATIVE/);
  const arithBranch = outSchema.properties.determinismReview.properties.arithmetic.anyOf.find((b) => b.properties);
  assert.match(arithBranch.properties.operandMax.description ?? '', /SAFE_INTEGER_BOUNDED/);
  assert.match(
    outSchema.properties.stateModel.properties.operations.items.properties.branches.items.properties.externalEffects.items.properties.externalInterfaceStatus.description ?? '',
    /UNBOUND_ABSTRACT_BOUNDARY/,
  );

  // Rec 1: preparedEffect that breaks closure (e.g. non-existent field in stateEffects -> BLOCKED_BY_GAP) is rejected at compile time
  const demandWithDecision = 'Contar tentativas de login ate limite diario configuravel.';
  const ws = observeWorkspace(repositoryRoot, demandWithDecision);
  const pf = buildPreflightHandoff({ demand: demandWithDecision, discovery: ws.discovery, version: 'v3' });
  const req = buildSemanticRequest({ repositoryRoot, preflight: pf, policy: policyLoaded.policy, constitution });
  const f0 = req.intent.slice(req.intentEvidence.fragments[0].startOffset, req.intentEvidence.fragments[0].endOffset);
  const ctxProd = policyLoaded.policy.contexts.findIndex((c) => c.tag === 'product-demand');
  const ctxState = policyLoaded.policy.contexts.findIndex((c) => c.tag === 'stateful-operation');
  const baseOp = {
    schema: 'aegis.semantic_opinion.v3',
    sourceEvidenceDigest: req.intentEvidence.evidenceDigest,
    title: 'Teste preparedEffect closure',
    interpretation: 'Conta tentativas com escolha de limite.',
    changeKind: 'PRODUCT',
    scope: { inScope: ['Contar tentativas'], outOfScope: ['Nada adicional'] },
    intentClaims: [{ quote: f0, fragmentIndexes: [0], kind: 'AMBIGUITY', disposition: 'DECISION', contractEffect: null, targets: [{ kind: 'DECISION', index: 0 }], rationale: 'Limite em aberto' }],
    nonNormativeItems: [],
    pathReferences: [],
    architectureContexts: [
      { contextIndex: ctxProd, rationale: 'Demanda de produto', basis: [{ source: 'USER_INTENT', reference: f0 }] },
      { contextIndex: ctxState, rationale: 'Estado do contador', basis: [{ source: 'USER_INTENT', reference: f0 }] },
    ],
    policyAssessments: [],
    complexityReview: { status: 'NO_EXCESS', rationale: 'Simples', alternatives: [] },
    requirements: [{
      kind: 'FUNCTIONAL',
      statement: 'Contar tentativas e rejeitar quando limite configurado for atingido.',
      basis: [{ source: 'USER_INTENT', reference: f0 }],
      fragmentIndexes: [0],
      measurement: null,
      acceptanceCases: [
        { kind: 'HAPPY_PATH', given: 'Contador abaixo do limite', when: 'Registrar tentativa', then: 'Incrementa contador.', outcomeKind: 'STATE_CHANGE', branchRef: 'INC_OK', decisionBinding: { decisionIndex: 0, answerIndex: 0 }, boundaryBinding: null },
        { kind: 'FAILURE', given: 'Contador no limite', when: 'Registrar tentativa', then: 'Rejeita excesso.', outcomeKind: 'REJECTION', branchRef: 'REJECT_MAX', decisionBinding: null, boundaryBinding: null },
      ],
    }],
    invariants: [{ statement: 'Contador nunca ultrapassa o limite', falsification: 'Falsificado se ultrapassar', falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Contador excede limite', acceptanceCaseId: null }, requirementIndexes: [0] }],
    riskReview: { certainty: 'ASSESSED', rationale: 'OK' },
    risks: [],
    adversarialReview: { rationale: 'OK', findings: [] },
    determinismReview: { rationale: 'Depende do limite escolhido.', coverage: [{ claimIndex: 0, dimensionIndexes: [], rationale: 'Aguardando Q-0001.' }], dimensions: [], arithmetic: null },
    boundaryRules: [],
    unknowns: [],
    decisions: [{
      question: 'Qual comportamento ao atingir limite?',
      presentation: {
        context: 'Contador de tentativas de autenticacao controlado pelo modulo de login.',
        whyHumanDecision: 'A demanda nao especifica se novas tentativas saturam ou reiniciam o fluxo.',
        observableImpact: 'Altera a resposta publica e a transicao observavel de LoginState.',
        recommendationReasoning: 'Manter a semantica de saturacao protege o sistema sem complexidade adicional.',
        glossary: [],
      },
      recommendedAnswerIndex: 0,
      requirementIndexes: [0],
      invariantIndexes: [0],
      riskIndexes: [],
      distinguishingCase: { given: 'No limite configurado', when: 'Registrar tentativa', outcomes: [{ answerIndex: 0, then: 'Incrementa dentro do ramo INC_OK.' }, { answerIndex: 1, then: 'Aplica comportamento alternativo.' }] },
      answers: [
        {
          label: 'Manter ramo existente INC_OK',
          rationale: 'Preserva o ramo valido definido em operations.',
          contractEffect: 'Incrementa attempts no ramo INC_OK.',
          preparedEffect: {
            requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 0, then: 'Incrementa LoginState.attempts normalmente.' }] } }],
          },
        },
        {
          label: 'Patch que aponta branchRef inexistente em operations',
          rationale: 'Teste de lacuna no preparedEffect detectada apenas pelo closure/.',
          contractEffect: 'Aponta para ramo inexistente GHOST_BRANCH.',
          preparedEffect: {
            requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 0, then: 'Tenta usar GHOST_BRANCH.', branchRef: 'GHOST_BRANCH' }] } }],
          },
        },
      ],
    }],
    stateModel: {
      entities: [{
        name: 'LoginState',
        isCollection: false,
        fields: [{
          name: 'attempts',
          type: 'INTEGER',
          isCounter: true,
          bounds: { lowerBound: '0', upperBound: '3', boundaryBehavior: 'SATURATE', provenance: [{ source: 'CONSTITUTION', reference: 'CONST-OBSERVABLE' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Inicia zerado' },
          reset: { allowed: false, trigger: null, resetValue: null },
        }],
      }],
      operations: [{
        name: 'recordAttempt',
        executionModel: 'SYNCHRONOUS_IN_MEMORY',
        evaluatedInputs: [],
        parameters: [],
        returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'LIMIT' },
        guardPrecedence: ['REJECT_MAX'],
        branches: [
          { branchId: 'REJECT_MAX', condition: 'attempts >= 3', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
          { branchId: 'INC_OK', condition: 'attempts < 3', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'attempts', effect: 'INCREMENT', value: '1' }] },
        ],
      }],
      observables: [],
    },
  };
  const brokenDraft = compileSemanticOpinion(baseOp, req);
  assert.throws(() => compileSemanticContract({
    repositoryRoot,
    draft: brokenDraft,
    preflight: pf,
    policy: policyLoaded.policy,
    policyDigest: policyLoaded.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    semanticRequest: req,
    workspaceObservation: ws,
  }), /prepared_effect_blocked_by_gap:preparedEffect\(Q-0001\/ANS-0001-02\)/);

  // Clean preparedEffect with valid branchRef compiles cleanly
  delete baseOp.decisions[0].answers[1].preparedEffect.requirements[0].patch.acceptanceCases[0].branchRef;
  const cleanDraft = compileSemanticOpinion(baseOp, req);
  const compiledClean = compileSemanticContract({
    repositoryRoot,
    draft: cleanDraft,
    preflight: pf,
    policy: policyLoaded.policy,
    policyDigest: policyLoaded.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    semanticRequest: req,
    workspaceObservation: ws,
  });
  assert.equal(compiledClean.effectiveDeterminismStatus, 'PENDING_HUMAN_DECISIONS');

  // Rec 4 & Rec 6: generateClosureCertificate reads explicit context and state_witnesses blocks structural bitmask even without tags
  const untaggedBitmaskSpec = {
    requirements: [],
    invariants: [],
    decisions: [],
    architectureContexts: [],
    stateModel: {
      entities: [{
        name: 'Flags',
        isCollection: false,
        fields: [{
          name: 'active',
          type: 'BOOLEAN',
          initialization: { kind: 'EXPLICIT_VALUE', value: 'false', rationale: 'init' },
          reset: { allowed: false, trigger: null, resetValue: null },
          mutations: [{ operation: 'setFlag', condition: 'valid', effect: 'SET_VALUE', targetValue: 'true' }],
          preservation: ['setFlag'],
          readBy: ['flagMask'],
        }],
      }],
      operations: [{
        name: 'setFlag',
        guardPrecedence: [],
        noGuardsRationale: 'Pure setter',
        evaluatedInputs: [],
        branches: [{ branchId: 'OK', outcomeKind: 'STATE_CHANGE', defaultPreservation: true, stateEffects: [] }],
      }],
      observables: [{
        name: 'flagMask',
        derivedFrom: ['Flags.active'],
        representation: 'UINT32_BITMASK',
        emptyBehavior: '0',
        bitAllocation: [{ slice: '0..1', bitWidth: 2, field: 'Flags.active' }],
      }],
    },
  };
  const bitmaskCert = generateClosureCertificate({ specification: untaggedBitmaskSpec, intent: demandWithDecision, workspaceEvidence: [] });
  assert.equal(bitmaskCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(bitmaskCert.gapLedger.some((g) => g.slotId.includes('bitAllocation')));

  pass('Fase 6 bilateral guarantees (preparedEffect closure dry-run, compact request, schema hints, modular witnesses) verified');
}

// =========================================================================
// 20. Fase 7 guarantees: explicit smallWorkspace filtering, compilePrepared skip & prompt alignment
// =========================================================================
{
  // 7.1 Targeted explicit paths in smallWorkspace drop unrelated subdirs (audit_csv_exporter.ts) without losing targets/entrypoints
  const d11Targeted = 'Estender src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts preservando fee_calculator.ts.';
  const pfD11 = buildPreflightHandoff({ demand: d11Targeted, discovery: observeWorkspace(repositoryRoot, d11Targeted).discovery, version: 'v3' });
  const reqD11 = buildSemanticRequest({ repositoryRoot, preflight: pfD11, policy: policyLoaded.policy, constitution });
  const d11Paths = reqD11.workspace.sourceEvidence.map((e) => e.path);
  assert.ok(d11Paths.includes('src/ledger/settlement_engine.ts'));
  assert.ok(d11Paths.includes('src/risk/velocity_guard.ts'));
  assert.ok(d11Paths.includes('src/index.ts'));
  assert.equal(d11Paths.includes('src/reporting/audit_csv_exporter.ts'), false);

  // Explicit mention of nonexistent new file preserves entrypoint anchor safely
  const newModuleDemand = 'Criar src/billing/invoice_service.ts sem alterar modulos existentes.';
  const pfNew = buildPreflightHandoff({ demand: newModuleDemand, discovery: observeWorkspace(repositoryRoot, newModuleDemand).discovery, version: 'v3' });
  const reqNew = buildSemanticRequest({ repositoryRoot, preflight: pfNew, policy: policyLoaded.policy, constitution });
  assert.ok(reqNew.workspace.sourceEvidence.some((e) => e.path === 'src/index.ts'));

  // 7.3 Instructions clarify BOUND_ADAPTER vs UNBOUND_ABSTRACT_BOUNDARY without dropping --compact guidance
  const instr = semanticSupervisorInstructions({ policy: policyLoaded.policy, constitution });
  assert.match(instr, /BOUND_ADAPTER/);
  assert.match(instr, /UNBOUND_ABSTRACT_BOUNDARY/);
  assert.ok(instr.includes('temporalRole'));
  pass('Fase 7 bilateral guarantees (smallWorkspace explicit isolation, schema cache/internal variant skip & prompt alignment) verified');
}

// =========================================================================
// 21. Audit hardening guarantees: src/ root scope, preparedEffect stateModel/placeholders, PUBLIC_SURFACE TS & multi-ref provenance
// =========================================================================
{
  // 21.1 Real PT-BR demand mentioning src/ and meta-words does not leak audit_csv_exporter.ts or mark src/ undiscovered
  const realStyleDemand = 'No produto de src/, proteja lotes de liquidacao rejeitados por guardas mantendo comportamento observavel, alternativas comparaveis e complexidade livre.';
  const pfReal = buildPreflightHandoff({
    demand: realStyleDemand,
    discovery: observeWorkspace(repositoryRoot, realStyleDemand).discovery,
    version: 'v3',
  });
  const reqReal = buildSemanticRequest({
    repositoryRoot,
    preflight: pfReal,
    policy: policyLoaded.policy,
    constitution,
  });
  assert.deepEqual(reqReal.workspace.evidenceCoverage.referencedPathsNotDiscovered, []);
  const excerpted = reqReal.workspace.sourceEvidence.map((e) => e.path);
  assert.equal(excerpted.includes('src/reporting/audit_csv_exporter.ts'), false);

  // 21.2 preparedEffect.stateModel + interpretation + STATE_CHANGE outcomeKind apply cleanly & unresolved placeholders fail
  const baseSpec = {
    interpretation: 'Pendente Q-0001',
    requirements: [{
      id: 'REQ-0001',
      kind: 'FUNCTIONAL',
      statement: 'Aguarda Q-0001.',
      basis: [{ source: 'USER_INTENT', reference: 'FRAG-0001' }],
      sourceFragmentIds: ['FRAG-0001'],
      measurement: null,
      acceptanceCases: [{
        id: 'AC-0001-01',
        kind: 'HAPPY_PATH',
        given: 'Estado inicial',
        when: 'Executa op',
        then: 'Aplica estado final',
        outcomeKind: 'STATE_CHANGE',
        branchRef: null,
        batchWitness: null,
        crossOperationWitness: null,
        keyComparisonWitness: null,
        decisionBinding: { questionId: 'Q-0001', answerId: 'ANS-0001-01' },
        boundaryBinding: null,
      }],
    }],
    invariants: [],
    risks: [],
    boundaryRules: [],
    stateModel: {
      entities: [{
        name: 'Ledger',
        fields: [{
          name: 'locked',
          type: 'BOOLEAN',
          mutations: [{ operation: 'op', condition: 'COND', effect: 'SET_VALUE', targetValue: 'true' }],
          preservation: ['op'],
          readBy: ['op'],
        }],
      }],
      operations: [{
        name: 'op',
        guardPrecedence: ['LOCK'],
        branches: [
          { branchId: 'LOCK', condition: 'locked', outcomeKind: 'REJECTION', statusOrError: 'PENDING_Q0001_LOCK', defaultPreservation: true },
          { branchId: 'OK', condition: '!locked', outcomeKind: 'STATE_CHANGE', statusOrError: 'OK', defaultPreservation: true },
        ],
      }],
      observables: [],
      canonicalSerializations: [],
    },
    determinismReview: {
      status: 'GAPS_FOUND',
      rationale: 'Pendente Q-0001',
      coverage: [],
      dimensions: [{
        kind: 'LOCK_POLICY',
        subjectId: 'REQ-0001',
        status: 'DECISION_REQUIRED',
        closureAuthority: 'MODEL_ARGUMENT',
        rationale: 'Depende Q-0001',
        basis: [{ source: 'USER_INTENT', reference: 'FRAG-0001' }],
        targetIds: ['REQ-0001', 'Q-0001'],
        acceptanceCaseId: null,
        proofObligation: null,
        inapplicabilityProof: null,
        counterexampleWitness: { id: 'W-1', dimension: 'LOCK_POLICY', inputClass: 'locked', baseline: 'reject', variation: 'allow' },
      }],
      arithmetic: null,
    },
    decisions: [{
      questionId: 'Q-0001',
      recommendedAnswerId: 'ANS-0001-01',
      requirementIds: ['REQ-0001'],
      invariantIds: [],
      riskIds: [],
      answers: [{
        id: 'ANS-0001-01',
        label: 'Lock',
        rationale: 'Lock explicit',
        contractEffect: 'REQ-0001 aplica STREAK_LOCK e stateModel atualizado.',
        recommended: true,
        preparedEffect: {
          interpretation: 'Contrato fechado com STREAK_LOCK.',
          requirements: [{
            index: 0,
            patch: {
              statement: 'Ao bloquear, op rejeita com STREAK_LOCK mantendo estado.',
              acceptanceCases: [{ index: 0, outcomeKind: 'STATE_CHANGE', then: 'Muda estado de bloqueio com STREAK_LOCK.', branchRef: 'OK' }],
            },
          }],
          stateModel: {
            operations: [{
              index: 0,
              patch: {
                guardPrecedence: ['LOCK'],
                branches: [
                  { branchId: 'LOCK', condition: 'locked', outcomeKind: 'REJECTION', statusOrError: 'STREAK_LOCK', defaultPreservation: true },
                  { branchId: 'OK', condition: '!locked', outcomeKind: 'STATE_CHANGE', statusOrError: 'OK', defaultPreservation: true },
                ],
              },
            }],
            fields: [{
              entityIndex: 0,
              fieldIndex: 0,
              patch: { mutations: [] },
            }],
          },
          dimensions: [{
            index: 0,
            patch: { status: 'SPECIFIED', acceptanceCaseId: 'AC-0001-01', rationale: 'Selado LOCK' },
          }],
        },
      }],
    }],
    unknowns: [],
    scope: { inScope: [], outOfScope: [] },
    policyAssessments: [],
    adversarialReview: { rationale: 'ok', findings: [] },
  };
  assertPreparedEffectsDisjoint(baseSpec.decisions);
  assert.throws(
    () => assertPreparedEffectsDisjoint([
      ...baseSpec.decisions,
      {
        questionId: 'Q-0002',
        answers: [{
          id: 'ANS-0002-01',
          preparedEffect: { stateModel: { operations: [{ index: 0, patch: { guardPrecedence: ['X'] } }] } },
        }],
      },
    ]),
    /shared_prepared_effect_target:stateModel\.operations/,
  );

  const patched = applyPreparedAnswers(
    baseSpec,
    [{ questionId: 'Q-0001', answerId: 'ANS-0001-01', contractEffect: 'REQ-0001 aplica STREAK_LOCK e stateModel atualizado.' }],
    [],
    { evidenceDigest: '0'.repeat(64), fragments: [{ id: 'FRAG-0001', startOffset: 0, endOffset: 5 }], literalFacts: [] },
  );
  assert.equal(patched.interpretation, 'Contrato fechado com STREAK_LOCK.');
  assert.equal(patched.requirements[0].acceptanceCases[0].outcomeKind, 'STATE_CHANGE');
  assert.equal(patched.stateModel.operations[0].branches[0].statusOrError, 'STREAK_LOCK');
  assert.deepEqual(patched.stateModel.entities[0].fields[0].mutations, []);
  assert.doesNotThrow(() => assertRevisionApplied(patched, {
    answers: [{ questionId: 'Q-0001', answerId: 'ANS-0001-01', contractEffect: 'REQ-0001 aplica STREAK_LOCK e stateModel atualizado.' }],
  }, baseSpec));

  const staleSpec = globalThis.structuredClone(patched);
  staleSpec.stateModel.operations[0].branches[0].statusOrError = 'PENDING_Q0001_STALE';
  assert.throws(
    () => assertRevisionApplied(staleSpec, {
      answers: [{ questionId: 'Q-0001', answerId: 'ANS-0001-01', contractEffect: 'REQ-0001 aplica STREAK_LOCK e stateModel atualizado.' }],
    }, baseSpec),
    /unresolved_placeholder_after_decision/,
  );

  // 21.3 PUBLIC_SURFACE on src/*.ts without external-effect does not demand physical I/O while non-code paths still block
  const mkPubCert = (pubPath) => generateClosureCertificate({
    specification: {
      requirements: [],
      invariants: [],
      decisions: [],
      unknowns: [],
      determinismReview: { dimensions: [], status: 'NOT_APPLICABLE' },
      architectureContexts: [{ tag: 'public-interface' }],
      pathReferences: [{ path: pubPath, role: 'PUBLIC_SURFACE' }],
      stateModel: {
        entities: [],
        operations: [{
          name: 'check',
          evaluatedInputs: [],
          guardPrecedence: ['LOCK'],
          branches: [
            { branchId: 'LOCK', outcomeKind: 'REJECTION', statusOrError: 'LOCK', defaultPreservation: true },
            { branchId: 'OK', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
          ],
        }],
        observables: [],
        canonicalSerializations: [],
      },
    },
  });
  const memCert = mkPubCert('src/index.ts');
  assert.equal(memCert.gapLedger.some((g) => g.witness?.includes('src/index.ts')), false);
  const fileCert = mkPubCert('quarantine/audit.log');
  assert.equal(fileCert.gapLedger.some((g) => g.witness?.includes('quarantine/audit.log')), true);

  // 21.4 Multi-reference WORKSPACE_EVIDENCE passes when at least one cited valid excerpt contains the literal
  const multiProv = validateProvenanceEnforcement({
    stateModel: {
      entities: [{
        name: 'Guard',
        fields: [{
          name: 'streak',
          type: 'INTEGER',
          bounds: {
            lowerBound: '0',
            upperBound: '5',
            boundaryBehavior: 'SATURATE',
            provenance: [
              { source: 'WORKSPACE_EVIDENCE', reference: 'src/guard.ts:L1' },
              { source: 'WORKSPACE_EVIDENCE', reference: 'src/guard.ts:L2-L3' },
            ],
          },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [],
          preservation: ['*'],
          readBy: ['*'],
        }],
      }],
    },
    workspaceEvidence: [{
      path: 'src/guard.ts',
      startLine: 1,
      endLine: 3,
      content: 'export const MAX_STREAK = 5;\nexport function sat(n: number) {\n  return Math.min(MAX_STREAK, n);\n}',
    }],
  });
  assert.equal(multiProv.valid, true);

  // 21.5 Schema output hints expose semanticKey pattern & preservation names
  const builtSchema = buildSemanticOutputSchema({ shared: false });
  assert.ok(builtSchema.properties.decisions.items.properties.semanticKey.description.includes('snake_case'));
  assert.ok(builtSchema.properties.stateModel.properties.entities.items.properties.fields.items.properties.preservation.description.includes('operations'));

  pass('Audit hardening guarantees (src/ root scope, preparedEffect stateModel/placeholders, PUBLIC_SURFACE TS, multi-ref provenance & schema hints) verified');
}

// 22. Fase 9 KISS: Anti-Explosão Cartesiana, Honestidade Epistêmica & Roteamento EARLY_CLARIFICATION
{
  const { dir, preflight, request } = makeTempWorkspace('Calcular taxa deterministica com arredondamento.');
  try {
    const anchor = request.intentEvidence.fragments[0].anchor;
    const baseOp = makeMinimalOpinion(request);
    const makeMultiAnswerDraft = (decisionCount, answerCountPerDecision) => compileSemanticOpinion({
      ...baseOp,
      intentClaims: [{
        quote: anchor,
        fragmentIndexes: [0],
        kind: 'AMBIGUITY',
        disposition: 'DECISION',
        contractEffect: null,
        targets: Array.from({ length: decisionCount }, (_, dIdx) => ({ kind: 'DECISION', index: dIdx })),
        rationale: 'Decisoes materiais distintas.',
      }],
      requirements: Array.from({ length: decisionCount }, (_, dIdx) => ({
        ...baseOp.requirements[0],
        statement: `Calcular regra conforme escolha Q${dIdx + 1}.`,
        acceptanceCases: [
          baseOp.requirements[0].acceptanceCases[0],
          baseOp.requirements[0].acceptanceCases[1],
          {
            ...baseOp.requirements[0].acceptanceCases[0],
            kind: 'HAPPY_PATH',
            given: `Entrada padrao vinculada a Q${dIdx + 1}.`,
            when: `Executar opcao recomendada R${dIdx + 1}.`,
            then: `Produz saida esperada de R${dIdx + 1}-A0.`,
            decisionBinding: { decisionIndex: dIdx, answerIndex: 0 },
          },
        ],
      })),
      invariants: Array.from({ length: decisionCount }, (_, dIdx) => ({
        statement: `Comportamento estavel da regra Q${dIdx + 1}.`,
        falsification: `Falsificado se divergir em Q${dIdx + 1}.`,
        falsificationSpec: { polarity: 'VIOLATION', observableEffect: `Diverge Q${dIdx + 1}.`, acceptanceCaseId: null },
        requirementIndexes: [dIdx],
      })),
      decisions: Array.from({ length: decisionCount }, (_, dIdx) => ({
        question: `Qual politica publica usar na dimensao ${dIdx + 1}?`,
        presentation: {
          context: `Contexto material detalhado da dimensao ${dIdx + 1} sem especificacao na demanda original.`,
          whyHumanDecision: 'Existem interpretacoes publicas igualmente conformes com efeitos observaveis divergentes.',
          observableImpact: `Altera diretamente o resultado observavel retornado pelo requisito ${dIdx + 1} na API.`,
          recommendationReasoning: 'A opcao recomendada preserva simplicidade e compatibilidade sem introduzir efeitos ocultos.',
          glossary: [],
        },
        recommendedAnswerIndex: 0,
        requirementIndexes: [dIdx],
        invariantIndexes: [dIdx],
        riskIndexes: [],
        distinguishingCase: {
          given: `Entrada padrao D${dIdx + 1}.`,
          when: 'Avalia regra.',
          outcomes: Array.from({ length: answerCountPerDecision }, (_, aIdx) => ({
            answerIndex: aIdx,
            then: `Produz resultado distinto D${dIdx + 1}-A${aIdx}.`,
          })),
        },
        answers: Array.from({ length: answerCountPerDecision }, (_, aIdx) => ({
          label: `Opcao ${dIdx + 1}-${aIdx}`,
          rationale: `Justificativa ${dIdx + 1}-${aIdx}.`,
          contractEffect: `Requisito ${dIdx + 1} fixa variante ${aIdx}.`,
          preparedEffect: {
            requirements: [{ index: dIdx, patch: { statement: `Requisito ${dIdx + 1} variante ${aIdx}.` } }],
            dimensions: [{
              index: dIdx,
              patch: {
                status: 'SPECIFIED',
                rationale: `Fechado D${dIdx + 1}-${aIdx}.`,
                acceptanceCase: { requirementIndex: dIdx, caseIndex: 0 },
                proofObligation: {
                  relation: 'DEFINED_RESULT',
                  resolutionKind: 'EXPLICIT_POLICY',
                  resolutionParameter: null,
                  baselineOutcome: `Base ${aIdx}`,
                  variationOutcome: `Var ${aIdx}`,
                  observables: ['result'],
                },
              },
            }],
          },
        })),
      })),
      determinismReview: {
        status: 'GAPS_FOUND',
        rationale: 'Decisoes materiais pendentes.',
        coverage: [{
          claimIndex: 0,
          dimensionIndexes: Array.from({ length: decisionCount }, (_, dIdx) => dIdx),
          rationale: 'Cobre todas as decisoes abertas.',
        }],
        dimensions: Array.from({ length: decisionCount }, (_, dIdx) => ({
          kind: `DIM_${dIdx + 1}`,
          subject: { kind: 'REQUIREMENT', index: dIdx },
          status: 'DECISION_REQUIRED',
          rationale: `Decisao D${dIdx + 1} aberta.`,
          targets: [
            { kind: 'REQUIREMENT', index: dIdx },
            { kind: 'DECISION', index: dIdx },
          ],
          basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
          acceptanceCase: null,
          proofObligation: null,
          inapplicabilityProof: null,
          counterexampleWitness: { inputClass: `in-${dIdx + 1}`, baseline: `B${dIdx + 1}`, variation: `V${dIdx + 1}` },
        })),
        arithmetic: null,
      },
    }, request);

    // 22.1 > 32 Cartesian combinations rejected before combinatorial explosion; <= 32 accepted cleanly
    const explodedDraft = makeMultiAnswerDraft(3, 4); // 4 * 4 * 4 = 64 > 32
    assert.throws(
      () => compileSemanticContract({
        repositoryRoot: dir,
        draft: explodedDraft,
        preflight,
        policy: policyLoaded.policy,
        policyDigest: policyLoaded.policyDigest,
        constitution,
        constitutionDigest: constitution.digest,
        semanticRequest: request,
      }),
      /prepared_effect_combinatorial_explosion:64:32/,
    );
    const explosionReport = buildErrorRejectionReport(
      'SEMANTIC',
      new Error('prepared_effect_combinatorial_explosion:64:32'),
    );
    assert.equal(explosionReport.reason, 'PREPARED_EFFECT_COMBINATORIAL_EXPLOSION');
    assert.ok(explosionReport.remediation.includes('EARLY_CLARIFICATION'));

    const smallDraft = makeMultiAnswerDraft(2, 2); // 2 * 2 = 4 <= 32
    const compiledSmall = compileSemanticContract({
      repositoryRoot: dir,
      draft: smallDraft,
      preflight,
      policy: policyLoaded.policy,
      policyDigest: policyLoaded.policyDigest,
      constitution,
      constitutionDigest: constitution.digest,
      semanticRequest: request,
    });
    assert.equal(compiledSmall.effectiveDeterminismStatus, 'PENDING_HUMAN_DECISIONS');

    // 22.2 Epistemic honesty in rendered Markdown while keeping legacy enum compatibility
    const md = renderSemanticContractMarkdown(compiledSmall, { policyRules: policyLoaded.policy.rules });
    assert.ok(md.includes('Verificação Mecânica (Estrutural & Custódia)'));
    assert.ok(md.includes('não prova verdade semântica'));
    assert.ok(md.includes('Auditoria Estrutural'));
    assert.ok(md.includes('Nota epistêmica:'));

    // 22.3 Proactive EARLY_CLARIFICATION guidance in supervisor instructions
    const sysInstructions = semanticSupervisorInstructions(request);
    assert.ok(sysInstructions.includes('>= 2 decisões materiais acopladas'));
    assert.ok(sysInstructions.includes('aegis.early_clarification_opinion.v1'));
    assert.ok(sysInstructions.includes('não a verdade semântica'));

    // 22.4 End-to-end --verify exposes verificationScope STRUCTURAL_AND_CUSTODY_ONLY
    mkdirSync(resolve(dir, '.harness/runtime'), { recursive: true });
    cpSync(resolve(repositoryRoot, 'ARCHITECTURE.md'), resolve(dir, 'ARCHITECTURE.md'));
    const cliRun = (cmd, args = [], input = null) => execFileSync(
      'node',
      [runnerPath, cmd, ...args],
      {
        cwd: dir,
        env: { ...process.env, AEGIS_ROOT: dir, AEGIS_TEST_AUTOMATION: '1' },
        input: input === null ? undefined : JSON.stringify(input),
        encoding: 'utf8',
      },
    );
    cliRun('draft', ['Retornar soma simples de dois numeros inteiros.']);
    const reqStateless = JSON.parse(cliRun('semantic-request'));
    const statelessOp = makeMinimalOpinion(reqStateless);
    cliRun('semantic-compile', [], { sourceSemanticRequestDigest: reqStateless.requestDigest, opinion: statelessOp });
    const finalized = JSON.parse(cliRun('approve'));
    assert.equal(finalized.verificationScope, 'STRUCTURAL_AND_CUSTODY_ONLY');
    const verified = JSON.parse(cliRun('verify'));
    assert.equal(verified.status, 'VALID');
    assert.equal(verified.verificationScope, 'STRUCTURAL_AND_CUSTODY_ONLY');
    assert.ok(Number.isInteger(verified.semanticReviewCount) && verified.semanticReviewCount >= 1);

    pass('Fase 9 KISS guarantees (cartesian ceiling > 32, single-pass closure, epistemic honesty & EARLY_CLARIFICATION routing) verified');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 23. Fase 10 KISS: --clarify ergonomics for EARLY_CLARIFICATION (bilateral positive + negative + canonical ordering)
{
  const { dir } = makeTempWorkspace('Proteger processamento de lotes em src/ledger.js com retomada explicita.');
  try {
    mkdirSync(resolve(dir, '.harness/runtime'), { recursive: true });
    mkdirSync(resolve(dir, 'src'), { recursive: true });
    writeFileSync(resolve(dir, 'src/ledger.js'), 'export const MAX_REJECTIONS = 5;\nexport function processBatch(state) { return state; }\n');
    cpSync(resolve(repositoryRoot, 'ARCHITECTURE.md'), resolve(dir, 'ARCHITECTURE.md'));
    const cli = (cmd, args = [], input = null) => execFileSync(
      process.execPath,
      [runnerPath, cmd, ...args],
      {
        cwd: dir,
        env: { ...process.env, AEGIS_ROOT: dir, AEGIS_TEST_AUTOMATION: '1' },
        input: input === null ? undefined : JSON.stringify(input),
        encoding: 'utf8',
      },
    );

    // 23.1 Rejects --clarify when no clarification request exists
    assert.throws(() => cli('clarify', ['ECQ-0001=teste']), /MISSING_USER_CLARIFICATION/);

    cli('draft', ['Proteger processamento de lotes em src/ledger.js com retomada explicita.']);
    const req1 = JSON.parse(cli('semantic-request'));
    const earlyOpinion = {
      schema: 'aegis.early_clarification_opinion.v1',
      sourceEvidenceDigest: req1.intentEvidence.evidenceDigest,
      summary: 'Duas decisoes acopladas exigem esclarecimento antes da modelagem completa.',
      questions: [
        {
          question: 'O que acontece ao atingir MAX_REJECTIONS = 5?',
          materialEffect: 'Altera status publico e se novas entradas sao barradas.',
          fragmentIndexes: [0],
          sourcePaths: ['src/ledger.js'],
          options: [
            { label: 'Bloqueio dedicado por sequencia', effect: 'Mantem accountFrozen inalterado e bloqueia chamadas.' },
            { label: 'Congelar conta automaticamente', effect: 'Define accountFrozen = true.' },
          ],
        },
        {
          question: 'Qual condicao explicita encerra o bloqueio?',
          materialEffect: 'Define assinatura publica e condicao de retomada.',
          fragmentIndexes: [0],
          sourcePaths: ['src/ledger.js'],
          options: [
            { label: 'Operacao explicita condicionada', effect: 'Exige accountFrozen === false antes de zerar contador.' },
            { label: 'Reset administrativo incondicional', effect: 'Zera contador independente da flag de conta.' },
          ],
        },
      ],
    };
    const earlyOut = JSON.parse(cli('semantic-compile', [], {
      sourceSemanticRequestDigest: req1.requestDigest,
      opinion: earlyOpinion,
    }));
    assert.equal(earlyOut.mode, 'EARLY_CLARIFICATION');
    assert.equal(earlyOut.questionCount, 2);
    assert.equal(existsSync(resolve(dir, '.harness/runtime/user_clarification_request.json')), true);

    // 23.2 Bilateral rejects: unknown ID, duplicate ID, empty response, incomplete set
    assert.throws(() => cli('clarify', ['ECQ-9999=invalido']), /UNKNOWN_CLARIFICATION_QUESTION/);
    assert.throws(() => cli('clarify', ['ECQ-0001=um', 'ECQ-0001=dois']), /DUPLICATE_CLARIFICATION_ANSWER/);
    assert.throws(() => cli('clarify', ['ECQ-0001=   ', 'ECQ-0002=ok']), /EMPTY_CLARIFICATION_RESPONSE/);
    assert.throws(() => cli('clarify', ['ECQ-0001=so uma resposta']), /INCOMPLETE_CLARIFICATION/);

    // 23.3 Positive out-of-order clarify with '=' inside answer preserves canonical order & refreshes preflight
    cli('clarify', [
      'ECQ-0002=Operacao explicita exigindo accountFrozen === false',
      'ECQ-0001=Bloqueio dedicado mantendo accountFrozen = false',
    ]);
    assert.equal(existsSync(resolve(dir, '.harness/runtime/user_clarification_request.json')), false);
    const req2 = JSON.parse(cli('semantic-request'));
    assert.notEqual(req2.requestDigest, req1.requestDigest);
    assert.ok(req2.intent.startsWith('Proteger processamento de lotes em src/ledger.js com retomada explicita.'));
    const idx1 = req2.intent.indexOf('- ECQ-0001: Bloqueio dedicado mantendo accountFrozen = false');
    const idx2 = req2.intent.indexOf('- ECQ-0002: Operacao explicita exigindo accountFrozen === false');
    assert.ok(idx1 > 0 && idx2 > idx1, 'Clarifications must be appended in canonical question order');

    // 23.4 Flat early_clarification envelope & malformed envelope rejection + --json clarify mode
    assert.throws(
      () => cli('semantic-compile', [], { sourceSemanticRequestDigest: req2.requestDigest }),
      /missing_opinion_envelope_field/,
    );
    const early2 = {
      ...earlyOpinion,
      sourceSemanticRequestDigest: req2.requestDigest,
      sourceEvidenceDigest: req2.intentEvidence.evidenceDigest,
      questions: [earlyOpinion.questions[0]],
    };
    cli('semantic-compile', [], early2);
    cli('clarify', ['--json', JSON.stringify([{ id: 'ECQ-0001', response: 'Confirmado via JSON' }])]);
    const req3 = JSON.parse(cli('semantic-request'));
    assert.ok(req3.intent.includes('- ECQ-0001: Confirmado via JSON'));

    pass('Fase 10 --clarify ergonomics (EARLY_CLARIFICATION bilateral validation, flat envelope, = preservation, canonical ordering & --json) verified');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('[AEGIS][TEST] HARNESS v7 & Six-Hats Bilateral tests passed!');
