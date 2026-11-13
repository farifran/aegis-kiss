import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import {
  computeDeterminismReviewStatus,
  evaluateBatchWitnessError,
  normalizeKey,
} from '../../lib/closure/v7_rules.mjs';
import { assertPreparedEffectsDisjoint, cartesianProduct } from '../../lib/prepared_effects.mjs';
import { effectiveDeterminismStatus } from '../../lib/semantic_approval.mjs';
import { compileSemanticContract } from '../../lib/semantic_contract_lifecycle.mjs';
import { assertSemanticDraft } from '../../lib/semantic_draft_validator.mjs';
import { semanticSupervisorInstructions } from '../../lib/semantic_gateway.mjs';
import { compileSemanticOpinion } from '../../lib/semantic_opinion.mjs';
import { buildSemanticRequest, loadSemanticConstitution } from '../../lib/semantic_request.mjs';

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
    intentClaims: [
      {
        quote: anchor,
        fragmentIndexes: [0],
        kind: 'OBLIGATION',
        disposition: 'NORMATIVE',
        contractEffect: 'Executar validacao de dominio.',
        targets: [{ kind: 'REQUIREMENT', index: 0 }],
        rationale: 'Obrigacao explicita da demanda.',
      },
    ],
    nonNormativeItems: [],
    pathReferences: [],
    architectureContexts: [
      {
        contextIndex: 0,
        rationale: 'Logica pura de dominio.',
        basis: [{ source: 'USER_INTENT', reference: anchor }],
      },
    ],
    policyAssessments: [],
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
      coverage: [],
      dimensions: [],
      arithmetic: null,
    },
    boundaryRules: [],
    unknowns: [],
    decisions: [],
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
  });
  assert.equal(skeletonPresentCert.status, 'CERTIFIED_CLOSED');

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
  assert.equal(generateClosureCertificate({ specification: constantScalarSpec }).status, 'CERTIFIED_CLOSED');
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

  const closedExtCert = generateClosureCertificate({ specification: makeExternalSpec(true, true) });
  assert.equal(closedExtCert.status, 'CERTIFIED_CLOSED');
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
  assert.equal(generateClosureCertificate({ specification: policyOnlySpec }).status, 'CERTIFIED_CLOSED');
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
  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: ['payload'], paramType: 'OBJECT', additionalPropertiesPolicy: 'REJECT_UNKNOWN', branchRef: 'BR-OK' }) }).status, 'CERTIFIED_CLOSED');
  // Bilateral anti-false-block: scalar INTEGER param needs NO additionalPropertiesPolicy!
  assert.equal(generateClosureCertificate({ specification: makeOpSpec({ evaluatedInputs: ['payload'], paramType: 'INTEGER', additionalPropertiesPolicy: undefined, branchRef: 'BR-OK' }) }).status, 'CERTIFIED_CLOSED');
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
  const validCross = generateClosureCertificate({ specification: makeCrossSpec('150') });
  assert.equal(validCross.status, 'CERTIFIED_CLOSED');
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
  });
  assert.equal(makeKeyCert('TRIM_AND_CASE_INSENSITIVE', '  Foo ', 'foo', 'DISTINCT').status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  // Bilateral equivalence: both TRIM_AND_CASE_INSENSITIVE->MATCH and EXACT_CASE_SENSITIVE_NO_TRIM->DISTINCT certify closed!
  assert.equal(makeKeyCert('TRIM_AND_CASE_INSENSITIVE', '  Foo ', 'foo', 'MATCH').status, 'CERTIFIED_CLOSED');
  assert.equal(makeKeyCert('EXACT_CASE_SENSITIVE_NO_TRIM', 'Foo', 'foo', 'DISTINCT').status, 'CERTIFIED_CLOSED');
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
  });

  // Pure BIGINT_EXACT addition dispenses extra division/overflow rules
  const bigAdd = { operations: ['ADD'], numericRepresentation: 'BIGINT_EXACT', operandBoundsDeclared: false };
  assert.equal(computeDeterminismReviewStatus([], { arithmetic: null }), 'NOT_APPLICABLE');
  assert.equal(computeDeterminismReviewStatus([], { arithmetic: bigAdd }), 'SEMANTICALLY_CLOSED');
  assert.equal(makeArithCert(bigAdd).status, 'CERTIFIED_CLOSED');

  // DECIMAL_BOUNDED is rejected by audit & compile validator
  const decimalDiv = { operations: ['DIVIDE'], numericRepresentation: 'SAFE_INTEGER_BOUNDED', operandBoundsDeclared: true, operandMin: '1', operandMax: '100', quotientPolicy: 'DECIMAL_BOUNDED', remainderPolicy: 'DISCARD', zeroDivisorPolicy: 'REJECT' };
  assert.equal(makeArithCert(decimalDiv).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');

  // Valid SAFE_INTEGER_BOUNDED division passes
  const safeDiv = { ...decimalDiv, quotientPolicy: 'TRUNC_ZERO' };
  assert.equal(makeArithCert(safeDiv).status, 'CERTIFIED_CLOSED');

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

  // Valid prose-only invariant (without computable falsificationSpec) emits SEMANTIC_REVIEW_REQUIRED and still certifies CERTIFIED_CLOSED!
  const proseInvCert = generateClosureCertificate({
    specification: makeBaseSpec({
      invariants: [{
        id: 'INV-0001',
        statement: 'Comportamento puro.',
        falsification: 'Falsificado se duas chamadas identicas divergirem.',
        requirementIds: ['REQ-0001'],
      }],
    }),
  });
  assert.equal(proseInvCert.status, 'CERTIFIED_CLOSED');
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
  const baselineCert = generateClosureCertificate({ specification: makeBaseSpec() });
  const mutatedCert = generateClosureCertificate({ specification: proseMutatedSpec });
  assert.equal(baselineCert.status, 'CERTIFIED_CLOSED');
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

console.log('[AEGIS][TEST] HARNESS v7 & Six-Hats Bilateral tests passed!');
