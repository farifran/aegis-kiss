import assert from 'node:assert/strict';
import process from 'node:process';
import {
  generateClosureCertificate,
  validateAggregationAndBoundaries,
  validateContradictionDetection,
  validateDecisionsWitness,
  validateFieldLifecycle,
  validateInputDomainClosure,
  validateOperationTotality,
  validatePipelineCrossCheck,
  validateProvenanceEnforcement,
  validateSemanticInventoryCoverage,
  validateStateMutationOwnership,
} from '../../lib/semantic_closure.mjs';
import { effectiveDeterminismStatus, getEffectiveGapLedger } from '../../lib/semantic_approval.mjs';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

log('[CTDD TEST] Starting Field Lifecycle & Closure Certificate traps test suite...');

// Semantics must not depend on identifiers or language. Explicit links still must resolve.
{
  for (const name of ['tokens', 'balance', 'rejectStreak', 'batch', 'timestamp', 'remainder', 'saldo', '余额', 'opaque']) {
    const fieldKey = `Record.${name}`;
    const model = {
      entities: [{ name: 'Record', fields: [{ name, type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '10', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        reset: { allowed: false }, mutations: [], preservation: ['*'], readBy: ['observe'] }] }],
      operations: [{ name: 'observe', guardPrecedence: ['拒绝'], branches: [
        { branchId: '拒绝', outcomeKind: 'REJECTION', defaultPreservation: true,
          stateEffects: [{ field: fieldKey, effect: 'DECREMENT', value: '1' }] },
        { branchId: '成功', outcomeKind: 'RETURN_VALUE', defaultPreservation: true },
      ] }],
      observables: [{ name: 'result', derivedFrom: [fieldKey], representation: 'SCALAR', emptyBehavior: '0' }],
    };
    assert.equal(validateFieldLifecycle({ stateModel: model }).valid, true, name);
    const reportedGap = createFixture({ stateModel: model,
      unknowns: [{ id: 'UNKNOWN-1', material: true, decisionId: null,
        statement: 'A revisão semântica identificou contradição entre rejeição e preservação.' }] });
    assert.equal(generateClosureCertificate({ specification: reportedGap }).status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
    // Whether a rejection may decrement this field is a semantic judgment, not its name.
    const invalid = globalThis.structuredClone(model);
    invalid.operations[0].guardPrecedence = ['拒'];
    assert.ok(validateOperationTotality({ stateModel: invalid }).issues.some(i => i.kind === 'MISSING_GUARD_REJECTION_BRANCH'));
    invalid.operations[0].guardPrecedence = ['拒绝'];
    invalid.operations[0].branches[0].stateEffects.push({ field: fieldKey, effect: 'PRESERVE' });
    assert.ok(validateOperationTotality({ stateModel: invalid }).issues.some(i => i.kind === 'CONFLICTING_STATE_DECLARATIONS'));
    const unresolved = globalThis.structuredClone(model);
    unresolved.entities[0].fields[0].initialization.value = null;
    assert.ok(validateFieldLifecycle({ stateModel: unresolved }).issues.some(i => i.kind === 'UNRESOLVED_INITIALIZATION'));
  }
  assert.equal(validateSemanticInventoryCoverage({ architectureContexts: ['time-dependent'],
    literalFacts: [{ kind: 'BIT_RANGE', attributes: { start: 0, end: 31 } }],
    boundaryRules: [{ subject: 'unclassified prose' }] }).valid, true);
  log('  PASS: identifier/language invariance; literal mentions are not normative declarations');
}

// Explicit non-applicability must not invent guards or a numerical capacity.
{
  const model = {
    entities: [{ name: 'Items', fields: [], isCollection: true, admissionPolicy: 'Explicit ingress',
      capacityPolicy: { maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT',
        unboundedRationale: 'The public contract does not impose a maximum collection size.' } }],
    operations: [{ name: 'read', guardPrecedence: [],
      noGuardsRationale: 'Read accepts every valid state without a rejection condition.',
      branches: [{ branchId: 'read', outcomeKind: 'RETURN_VALUE', defaultPreservation: true }] }],
    observables: [],
  };
  assert.equal(validateFieldLifecycle({ stateModel: model }).valid, true);
  for (const rationale of [undefined, '', '   ']) {
    const invalid = globalThis.structuredClone(model);
    invalid.entities[0].capacityPolicy.unboundedRationale = rationale;
    assert.ok(validateFieldLifecycle({ stateModel: invalid }).issues.some(i => i.kind === 'UNRESOLVED_COLLECTION_CAPACITY'));
    const guards = globalThis.structuredClone(model);
    guards.operations[0].noGuardsRationale = rationale;
    assert.ok(validateFieldLifecycle({ stateModel: guards }).issues.some(i => i.kind === 'UNRESOLVED_GUARD_PRECEDENCE'));
  }
  const rejection = globalThis.structuredClone(model);
  rejection.operations[0].branches.push({ branchId: 'reject', outcomeKind: 'REJECTION' });
  assert.ok(validateFieldLifecycle({ stateModel: rejection }).issues.some(i => i.kind === 'UNRESOLVED_GUARD_PRECEDENCE'));
  const bounded = globalThis.structuredClone(model);
  bounded.entities[0].capacityPolicy.maxEntries = '5';
  assert.ok(validateFieldLifecycle({ stateModel: bounded }).issues.some(i => i.kind === 'UNRESOLVED_COLLECTION_CAPACITY'));
  log('  PASS: explicit absence of contractual limits/guards; missing and contradictory exemptions blocked');
}

// Base stateful specification fixture
function createFixture({
  isStateful = true,
  stateModel = null,
  dimensions = [{ kind: 'ORDERING', subjectId: 'PUBLIC_CONTRACT', status: 'SPECIFIED' }],
  unknowns = [],
  decisions = [],
  boundaryRules = [],
  literalFacts = [],
  requirements = [],
  invariants = [],
} = {}) {
  return {
    architectureContexts: isStateful
      ? [{ tag: 'product-demand' }, { tag: 'stateful-operation' }]
      : [{ tag: 'product-demand' }],
    stateModel,
    unknowns,
    decisions,
    boundaryRules,
    literalFacts,
    requirements,
    invariants,
    determinismReview: {
      status: 'SEMANTICALLY_CLOSED',
      dimensions,
    },
  };
}


// TEST-01: Stateful demand without stateModel MUST be blocked
{
  const fixture = createFixture({ isStateful: true, stateModel: null });
  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-01: stateful demand without stateModel must be invalid');
  assert.equal(result.issues[0]?.kind, 'UNRESOLVED_STATE_MODEL');

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedStateFields, 1);

  const status = effectiveDeterminismStatus(fixture, []);
  assert.equal(status, 'BLOCKED_BY_GAP', 'TEST-01: effective status must be BLOCKED_BY_GAP');
  log('  PASS: TEST-01 Stateful without stateModel is blocked');
}

// TEST-02: Unresolved initialization MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'UNRESOLVED', value: null, rationale: 'Não decidido' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest', 'observabilityBitmask'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: ['LOCK', 'BALANCE'] }],
      observables: [{ name: 'observabilityBitmask', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-02: tokens with UNRESOLVED init must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_INITIALIZATION'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedStateFields, 1);
  assert.equal(effectiveDeterminismStatus(fixture, []), 'BLOCKED_BY_GAP');
  log('  PASS: TEST-02 Unresolved initialization is blocked');
}

// TEST-03: Counter/streak without reset trigger MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'insufficientStreak',
          type: 'INTEGER',
          isCounter: true,
          bounds: { lowerBound: '0', upperBound: '31', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Começa em zero' },
          mutations: [{ operation: 'evaluateRequest', condition: 'REJECT', effect: 'INCREMENT', targetValue: null }],
          reset: { allowed: true, trigger: null, resetValue: null }, // GATILHO AUSENTE
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'decision', derivedFrom: ['Badge.insufficientStreak'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-03: counter without reset trigger must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_RESET'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.unresolvedStateFields, 1);
  assert.equal(effectiveDeterminismStatus(fixture, []), 'BLOCKED_BY_GAP');
  log('  PASS: TEST-03 Counter without reset trigger is blocked');
}

// TEST-04: Operation without mutation or preserve coverage MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'fractionalRemainder',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999', boundaryBehavior: 'ROLLOVER_MODULO' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Sem carry residual inicial' },
          mutations: [{ operation: 'evaluateRequest', condition: 'TICK', effect: 'CUSTOM', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['lockSystem'], // Falta 'unquarantine'
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [
        { name: 'evaluateRequest', guardPrecedence: ['LOCK'] },
        { name: 'unquarantine', guardPrecedence: ['ADMIN'] },
      ],
      observables: [{ name: 'decision', derivedFrom: ['Badge.fractionalRemainder'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-04: field without unquarantine coverage must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_TRANSITION'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.unresolvedTransitions, 1);
  assert.equal(effectiveDeterminismStatus(fixture, []), 'BLOCKED_BY_GAP');
  log('  PASS: TEST-04 Missing transition coverage is blocked');
}

// TEST-05: Missing guard precedence in operation MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: [] }], // PRECEDÊNCIA VAZIA
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-05: empty guardPrecedence must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_GUARD_PRECEDENCE'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.unresolvedTransitions, 1);
  assert.equal(effectiveDeterminismStatus(fixture, []), 'BLOCKED_BY_GAP');
  log('  PASS: TEST-05 Missing guard precedence is blocked');
}

// TEST-06: Observable referencing unknown field MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'bitmask', derivedFrom: ['Badge.ghostField'], representation: 'SCALAR', emptyBehavior: '0' }], // CAMPO FANTASMA
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-06: unknown observable dependency must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_OBSERVABLE_DEPENDENCY'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.unresolvedObservables, 1);
  assert.equal(effectiveDeterminismStatus(fixture, []), 'BLOCKED_BY_GAP');
  log('  PASS: TEST-06 Unknown observable dependency is blocked');
}

// TEST-07: Fully specified state model passes and certifies SEMANTICALLY_CLOSED
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [
          {
            name: 'tokens',
            type: 'INTEGER',
            bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
            initialization: { kind: 'EXPLICIT_VALUE', value: 'capacity', rationale: 'Inicia cheio no teto máximo' },
            mutations: [
              { operation: 'evaluateRequest', condition: 'SUFFICIENT_FUNDS', effect: 'DECREMENT', targetValue: null },
              { operation: 'evaluateRequest', condition: 'REFILL_TICK', effect: 'INCREMENT', targetValue: null },
            ],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['unquarantine'],
            readBy: ['evaluateRequest', 'observabilityBitmask'],
          },
          {
            name: 'insufficientStreak',
            type: 'INTEGER',
            isCounter: true,
            bounds: { lowerBound: '0', upperBound: '31', boundaryBehavior: 'SATURATE' },
            initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Inicia em zero recusas' },
            mutations: [
              { operation: 'evaluateRequest', condition: 'INSUFFICIENT_FUNDS', effect: 'INCREMENT', targetValue: null },
            ],
            reset: { allowed: true, trigger: 'REQUEST_AUTHORIZED_OR_ADMIN_UNQUARANTINE', resetValue: '0' },
            preservation: ['*'],
            readBy: ['evaluateRequest', 'observabilityBitmask'],
          },
        ],
      }],
      operations: [
        { name: 'evaluateRequest', guardPrecedence: ['GLOBAL_LOCK', 'QUARANTINE', 'TIME_REGRESSION', 'REFILL', 'BALANCE'] },
        { name: 'unquarantine', guardPrecedence: ['ADMIN_AUTH'] },
      ],
      observables: [
        {
          name: 'observabilityBitmask',
          derivedFrom: ['Badge.tokens', 'Badge.insufficientStreak'],
          representation: 'UINT32_BITMASK',
          emptyBehavior: '0',
          bitAllocation: [
            { slice: '0..15', field: 'Badge.tokens', bitWidth: 16 },
            { slice: '16..31', field: 'Badge.insufficientStreak', bitWidth: 16 },
          ],
        },
      ],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'TEST-07: fully specified state model must be valid');
  assert.equal(result.issues.length, 0);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedStateFields, 0);
  assert.equal(cert.unresolvedTransitions, 0);
  assert.equal(cert.unresolvedObservables, 0);

  const status = effectiveDeterminismStatus(fixture, []);
  assert.equal(status, 'SEMANTICALLY_CLOSED', 'TEST-07: fully certified contract receives SEMANTICALLY_CLOSED');
  log('  PASS: TEST-07 Fully closed state model certifies SEMANTICALLY_CLOSED');
}

// TEST-08: Stateless demand passes without needing stateModel
{
  const fixture = createFixture({
    isStateful: false,
    stateModel: null,
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'TEST-08: stateless demand must be valid without stateModel');

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(effectiveDeterminismStatus(fixture, []), 'SEMANTICALLY_CLOSED');
  log('  PASS: TEST-08 Stateless demand passes cleanly');
}

// TEST-09: Operation with branches missing guard rejection branch MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{
        name: 'evaluateRequest',
        guardPrecedence: ['GLOBAL_LOCK', 'INSUFFICIENT_CREDITS'],
        branches: [
          // Só define rejeição de LOCK e sucesso, falta rejeição de INSUFFICIENT_CREDITS!
          { branchId: 'GUARD_GLOBAL_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_GLOBAL_LOCK', defaultPreservation: true },
          { branchId: 'SUCCESS_AUTHORIZED', outcomeKind: 'RETURN_VALUE', statusOrError: 'AUTHORIZED', defaultPreservation: true },
        ],
      }],
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const totality = validateOperationTotality({ stateModel: fixture.stateModel });
  assert.equal(totality.valid, false, 'TEST-09: validateOperationTotality must detect missing guard rejection');

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-09: missing guard rejection branch must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'MISSING_GUARD_REJECTION_BRANCH'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedTransitions >= 1, true);
  log('  PASS: TEST-09 Missing guard rejection branch is blocked');
}

// TEST-11: Branch without defaultPreservation missing next-state for field MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [
          {
            name: 'tokens',
            type: 'INTEGER',
            bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
            initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
            mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['*'],
            readBy: ['evaluateRequest'],
          },
          {
            name: 'quarantined',
            type: 'BOOLEAN',
            initialization: { kind: 'EXPLICIT_VALUE', value: 'false', rationale: 'Livre' },
            mutations: [{ operation: 'evaluateRequest', condition: 'STREAK', effect: 'SET', targetValue: 'true' }],
            reset: { allowed: true, trigger: 'ADMIN', resetValue: 'false' },
            preservation: ['*'],
            readBy: ['evaluateRequest'],
          },
        ],
      }],
      operations: [{
        name: 'evaluateRequest',
        guardPrecedence: ['LOCK'],
        branches: [
          { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
          {
            branchId: 'SUCCESS_AUTHORIZED',
            outcomeKind: 'RETURN_VALUE',
            statusOrError: 'AUTHORIZED',
            defaultPreservation: false, // Sem defaultPreservation
            stateEffects: [{ field: 'Badge.tokens', effect: 'DECREMENT', value: '1' }], // Falta Badge.quarantined!
          },
        ],
      }],
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens', 'Badge.quarantined'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-11: branch with undetermined next-state field must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNDETERMINED_BRANCH_NEXT_STATE'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedTransitions >= 1, true);
  log('  PASS: TEST-11 Branch with undetermined next-state is blocked');
}

// TEST-12: Operation with only rejection branches and no success branch MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{
        name: 'evaluateRequest',
        guardPrecedence: ['LOCK'],
        branches: [
          // Só rejeição, sem branch de sucesso!
          { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        ],
      }],
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-12: operation without success branch must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'MISSING_SUCCESS_BRANCH'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  log('  PASS: TEST-12 Missing success branch is blocked');
}

// TEST-16: Fully closed state model with complete branches and zero mutations certifies SEMANTICALLY_CLOSED
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [
          {
            name: 'tokens',
            type: 'INTEGER',
            bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
            initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Inicia cheio' },
            mutations: [
              { operation: 'evaluateRequest', condition: 'SUFFICIENT_FUNDS', effect: 'DECREMENT', targetValue: null },
            ],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['*'],
            readBy: ['evaluateRequest', 'observabilityBitmask'],
          },
          {
            name: 'insufficientStreak',
            type: 'INTEGER',
            isCounter: true,
            bounds: { lowerBound: '0', upperBound: '31', boundaryBehavior: 'SATURATE' },
            initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Zero inicial' },
            mutations: [
              { operation: 'evaluateRequest', condition: 'INSUFFICIENT_FUNDS', effect: 'INCREMENT', targetValue: null },
            ],
            reset: { allowed: true, trigger: 'REQUEST_AUTHORIZED', resetValue: '0' },
            preservation: ['*'],
            readBy: ['evaluateRequest', 'observabilityBitmask'],
          },
        ],
      }],
      operations: [
        {
          name: 'evaluateRequest',
          guardPrecedence: ['GUARD_GLOBAL_LOCK', 'GUARD_INSUFFICIENT_FUNDS'],
          branches: [
            {
              branchId: 'GUARD_GLOBAL_LOCK',
              outcomeKind: 'REJECTION',
              statusOrError: 'ERR_GLOBAL_LOCK',
              defaultPreservation: true,
              stateEffects: [],
            },
            {
              branchId: 'GUARD_INSUFFICIENT_FUNDS',
              outcomeKind: 'REJECTION',
              statusOrError: 'ERR_INSUFFICIENT_FUNDS',
              defaultPreservation: false,
              stateEffects: [
                { field: 'Badge.tokens', effect: 'PRESERVE', value: null },
                { field: 'Badge.insufficientStreak', effect: 'INCREMENT', value: '1' },
              ],
            },
            {
              branchId: 'SUCCESS_AUTHORIZED',
              outcomeKind: 'RETURN_VALUE',
              statusOrError: 'AUTHORIZED',
              defaultPreservation: false,
              stateEffects: [
                { field: 'Badge.tokens', effect: 'DECREMENT', value: '1' },
                { field: 'Badge.insufficientStreak', effect: 'SET', value: '0' },
              ],
            },
          ],
        },
      ],
      observables: [
        {
          name: 'observabilityBitmask',
          derivedFrom: ['Badge.tokens', 'Badge.insufficientStreak'],
          representation: 'UINT32_BITMASK',
          emptyBehavior: '0',
          bitAllocation: [
            { slice: '0..15', field: 'Badge.tokens', bitWidth: 16 },
            { slice: '16..31', field: 'Badge.insufficientStreak', bitWidth: 16 },
          ],
        },
      ],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'TEST-16: complete state model with branches must be valid');
  assert.equal(result.issues.length, 0);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedStateFields, 0);
  assert.equal(cert.unresolvedTransitions, 0);
  assert.equal(cert.contradictoryRules, 0);

  const status = effectiveDeterminismStatus(fixture, []);
  assert.equal(status, 'SEMANTICALLY_CLOSED');
  log('  PASS: TEST-16 Fully closed state model with branches certifies SEMANTICALLY_CLOSED');
}

// TEST-17: Integer field without bounds MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          // bounds AUSENTE!
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-17: field without bounds must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_FIELD_BOUNDS'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedStateFields >= 1, true);
  log('  PASS: TEST-17 Integer field without bounds is blocked');
}

// TEST-18: Dynamic collection without admissionPolicy MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        isCollection: true,
        // admissionPolicy AUSENTE!
        capacityPolicy: { maxEntries: '1000', overflowPolicy: 'REJECT_NEW' },
        fields: [{
          name: 'id',
          type: 'STRING',
          initialization: { kind: 'EXPLICIT_VALUE', value: 'badge-1', rationale: 'ID' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.id'], representation: 'SCALAR', emptyBehavior: 'null' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-18: collection without admissionPolicy must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_COLLECTION_ADMISSION'), true);
  log('  PASS: TEST-18 Dynamic collection without admissionPolicy is blocked');
}

// TEST-19: Dynamic collection without capacityPolicy MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        isCollection: true,
        admissionPolicy: 'ON_FIRST_REQUEST',
        // capacityPolicy AUSENTE!
        fields: [{
          name: 'id',
          type: 'STRING',
          initialization: { kind: 'EXPLICIT_VALUE', value: 'badge-1', rationale: 'ID' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.id'], representation: 'SCALAR', emptyBehavior: 'null' }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-19: collection without capacityPolicy must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_COLLECTION_CAPACITY'), true);
  log('  PASS: TEST-19 Dynamic collection without capacityPolicy is blocked');
}

// TEST-20: Observable without representation MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'active',
          type: 'BOOLEAN',
          initialization: { kind: 'EXPLICIT_VALUE', value: 'true', rationale: 'Ativo' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['obs'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{
        name: 'obs',
        derivedFrom: ['Badge.active'],
        // representation AUSENTE!
        emptyBehavior: 'false',
      }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-20: observable without representation must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_OBSERVABLE_REPRESENTATION'), true);
  log('  PASS: TEST-20 Observable without representation is blocked');
}

// TEST-21: Observable without emptyBehavior MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'active',
          type: 'BOOLEAN',
          initialization: { kind: 'EXPLICIT_VALUE', value: 'true', rationale: 'Ativo' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['obs'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{
        name: 'obs',
        derivedFrom: ['Badge.active'],
        representation: 'BOOLEAN',
        // emptyBehavior AUSENTE!
      }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-21: observable without emptyBehavior must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_OBSERVABLE_EMPTY_BEHAVIOR'), true);
  log('  PASS: TEST-21 Observable without emptyBehavior is blocked');
}

// TEST-22: Bitmask observable with overlapping bitAllocation MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [
          {
            name: 'lock',
            type: 'BOOLEAN',
            initialization: { kind: 'EXPLICIT_VALUE', value: 'false', rationale: 'Livre' },
            mutations: [],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['*'],
            readBy: ['bitmask'],
          },
          {
            name: 'quarantine',
            type: 'BOOLEAN',
            initialization: { kind: 'EXPLICIT_VALUE', value: 'false', rationale: 'Livre' },
            mutations: [],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['*'],
            readBy: ['bitmask'],
          },
        ],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{
        name: 'bitmask',
        derivedFrom: ['Badge.lock', 'Badge.quarantine'],
        representation: 'UINT32_BITMASK',
        emptyBehavior: '0',
        bitAllocation: [
          { slice: '0..1', field: 'Badge.lock', bitWidth: 2 },
          { slice: '1..2', field: 'Badge.quarantine', bitWidth: 2 }, // SOBREPOSIÇÃO NO BIT 1!
        ],
      }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-22: overlapping bit allocation must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'INVALID_BITMASK_ALLOCATION'), true);
  log('  PASS: TEST-22 Bitmask observable with overlapping bitAllocation is blocked');
}

// TEST-23: Integrity hash requirement without canonicalSerializations MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Saldo' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['obs'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
      // canonicalSerializations AUSENTE sob integrity-hash!
    },
  });
  fixture.architectureContexts.push({ tag: 'integrity-hash' });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-23: integrity-hash without canonicalSerializations must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'UNRESOLVED_CANONICAL_SERIALIZATION'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedTransitions >= 1, true);
  log('  PASS: TEST-23 Integrity hash requirement without canonicalSerializations is blocked');
}

// TEST-24: Full contract with collection capacity, bounds, bit allocation, and canonical serialization certifies SEMANTICALLY_CLOSED
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        isCollection: true,
        admissionPolicy: 'ON_FIRST_REQUEST',
        capacityPolicy: { maxEntries: '1000', overflowPolicy: 'REJECT_NEW' },
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Saldo' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['bitmask'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{
        name: 'bitmask',
        derivedFrom: ['Badge.tokens'],
        representation: 'UINT32_BITMASK',
        emptyBehavior: '0',
        bitAllocation: [
          { slice: '0..15', field: 'Badge.tokens', bitWidth: 16 },
          { slice: '16..31', field: 'RESERVED', bitWidth: 16 },
        ],
      }],
      canonicalSerializations: [
        {
          target: 'FNV1A_64_BALANCES',
          includedFields: ['Badge.tokens'],
          fieldEncodings: [{ field: 'Badge.tokens', encoding: 'UINT64_BE' }],
          recordOrderingKey: 'Badge.id ASC',
          emptyStateDigest: '0xcbf29ce484222325',
        },
      ],
    },
  });
  fixture.architectureContexts.push({ tag: 'integrity-hash' });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'TEST-24: full state model with all structural properties must be valid');
  assert.equal(result.issues.length, 0);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedStateFields, 0);
  assert.equal(cert.unresolvedObservables, 0);
  assert.equal(cert.unresolvedTransitions, 0);

  const status = effectiveDeterminismStatus(fixture, []);
  assert.equal(status, 'SEMANTICALLY_CLOSED');
  log('  PASS: TEST-24 Full contract with all structural properties certifies SEMANTICALLY_CLOSED');
}

// TEST-27: Bounded observability does not imply a bitmask or a global lock.
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Saldo' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'tokensObs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
  });
  fixture.architectureContexts.push({ tag: 'bounded-observability' });

  const result = validateSemanticInventoryCoverage({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'A scalar is not mechanically reinterpreted as a bitmask');
  assert.equal(validateAggregationAndBoundaries({ stateModel: fixture.stateModel, architectureContexts: fixture.architectureContexts }).valid, true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedInventorySlots, 0);
  log('  PASS: TEST-27 Bounded observability does not invent a bitmask or lock');
}

// TEST-30: Integrity-hash demand without canonicalSerializations in inventory MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Saldo' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{ name: 'eval', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'tokensObs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
      canonicalSerializations: [],
    },
  });
  fixture.architectureContexts.push({ tag: 'integrity-hash' });

  const result = validateSemanticInventoryCoverage({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-30: missing canonicalSerializations in inventory must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'MISSING_CANONICAL_SERIALIZATION_INVENTORY'), true);
  log('  PASS: TEST-30 Integrity-hash demand without canonicalSerializations is blocked');
}

// TEST-31: Decision without distinguishing witness or non-divergent outcomes MUST be blocked
{
  const nonDivergentDecision = {
    questionId: 'DEC-01',
    answers: [{ id: 'OPT_A' }, { id: 'OPT_B' }],
    distinguishingCase: {
      given: 'Saldo zerado',
      when: 'evaluateRequest chamado',
      outcomes: [
        { answerId: 'OPT_A', then: 'rejeita com ZERO_BALANCE' },
        { answerId: 'OPT_B', then: 'rejeita com ZERO_BALANCE' },
      ],
    },
  };

  const result = validateDecisionsWitness({
    decisions: [nonDivergentDecision],
  });
  assert.equal(result.valid, false, 'TEST-31: non-divergent outcomes must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'NON_DISTINGUISHING_DECISION_WITNESS'), true);

  const fixture = createFixture({
    isStateful: false,
    decisions: [nonDivergentDecision],
  });
  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedInventorySlots >= 1, true);
  log('  PASS: TEST-31 Decision with non-divergent witness outcomes is blocked');
}

// TEST-32: Decision with incomplete witness coverage or invalid semanticKey MUST be blocked
{
  const incompleteDecision = {
    questionId: 'DEC-02',
    semanticKey: 'invalid_key_no_dot',
    answers: [{ id: 'OPT_A' }, { id: 'OPT_B' }],
    distinguishingCase: {
      given: 'Saldo zerado',
      when: 'evaluateRequest chamado',
      outcomes: [
        { answerId: 'OPT_A', then: 'rejeita com ZERO_BALANCE' },
      ],
    },
  };

  const result = validateDecisionsWitness({
    decisions: [incompleteDecision],
  });
  assert.equal(result.valid, false, 'TEST-32: incomplete coverage and invalid semanticKey must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'INCOMPLETE_WITNESS_OUTCOMES'), true);
  assert.equal(result.issues.some((i) => i.kind === 'INVALID_SEMANTIC_KEY'), true);
  log('  PASS: TEST-32 Decision with incomplete witness coverage or invalid semanticKey is blocked');
}

// TEST-33: Full contract with complete inventory coverage and valid decision witness certifies SEMANTICALLY_CLOSED
{
  const fixture = createFixture({
    isStateful: true,
    boundaryRules: [
      { id: 'BR-TOKENS', subject: 'Badge.tokens' },
      { id: 'BR-TIME', subject: 'Badge.lastRefillTimestamp' },
    ],
    literalFacts: [
      { kind: 'BIT_RANGE', reference: 'Status bitmask', attributes: { start: 0, end: 15 } },
    ],
    decisions: [
      {
        questionId: 'DEC-REFILL',
        semanticKey: 'rate_limit.refill_policy',
        answers: [{ id: 'PROPORTIONAL' }, { id: 'DISCRETE' }],
        distinguishingCase: {
          given: 'Tempo decorrido dt=150ms com taxa 1 token a cada 100ms',
          when: 'evaluateRequest chamado',
          outcomes: [
            { answerId: 'PROPORTIONAL', then: 'concede 1 token e preserva resto 50ms' },
            { answerId: 'DISCRETE', then: 'descarta resto fracionário de 50ms' },
          ],
        },
      },
    ],
    stateModel: {
      entities: [{
        name: 'Badge',
        isCollection: true,
        admissionPolicy: 'ON_FIRST_REQUEST',
        capacityPolicy: {
          maxEntries: '1000',
          overflowPolicy: 'REJECT_NEW',
          provenance: [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-LOCAL-DETERMINISTIC-CORE' }],
        },
        fields: [
          {
            name: 'tokens',
            type: 'INTEGER',
            bounds: {
              lowerBound: '0',
              upperBound: '100',
              boundaryBehavior: 'SATURATE',
              provenance: [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-LOCAL-DETERMINISTIC-CORE' }],
            },
            initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Saldo inicial' },
            mutations: [{ operation: 'evaluateRequest', condition: 'SUCCESS', effect: 'DECREMENT', targetValue: null }],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['*'],
            readBy: ['evaluateRequest', 'bitmask'],
          },
          {
            name: 'lastRefillTimestamp',
            type: 'INTEGER',
            bounds: {
              lowerBound: '0',
              upperBound: '9223372036854775807',
              boundaryBehavior: 'SATURATE',
              provenance: [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-DETERMINISTIC-TIME' }],
            },
            initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Epoch de admissão' },
            mutations: [{ operation: 'evaluateRequest', condition: 'SUCCESS', effect: 'UPDATE', targetValue: 'now' }],
            reset: { allowed: false, trigger: null, resetValue: null },
            preservation: ['*'],
            readBy: ['evaluateRequest', 'bitmask'],
          },
        ],
      }],
      operations: [{
        name: 'evaluateRequest',
        guardPrecedence: ['GUARD_CLOCK_REGRESSION', 'GUARD_LOCK', 'GUARD_BALANCE'],
        branches: [
          {
            branchId: 'GUARD_CLOCK_REGRESSION',
            outcomeKind: 'REJECTION',
            statusOrError: 'REJECT_CLOCK_REGRESSION',
            defaultPreservation: true,
          },
          {
            branchId: 'GUARD_LOCK',
            outcomeKind: 'REJECTION',
            statusOrError: 'REJECT_LOCKED',
            defaultPreservation: true,
          },
          {
            branchId: 'GUARD_BALANCE',
            outcomeKind: 'REJECTION',
            statusOrError: 'REJECT_NO_CREDIT',
            defaultPreservation: true,
          },
          {
            branchId: 'SUCCESS_AUTHORIZED',
            outcomeKind: 'RETURN_VALUE',
            statusOrError: 'ALLOW',
            defaultPreservation: false,
            stateEffects: [
              { field: 'Badge.tokens', effect: 'DECREMENT', value: '1' },
              { field: 'Badge.lastRefillTimestamp', effect: 'SET', value: 'now' },
            ],
          },
        ],
      }],
      observables: [{
        name: 'bitmask',
        derivedFrom: ['Badge.tokens', 'Badge.lastRefillTimestamp'],
        representation: 'UINT32_BITMASK',
        emptyBehavior: '0',
        bitAllocation: [
          { slice: '0..15', field: 'Badge.tokens', bitWidth: 16 },
          { slice: '16..31', field: 'RESERVED', bitWidth: 16 },
        ],
      }],
      canonicalSerializations: [
        {
          target: 'FNV1A_64_BALANCES',
          includedFields: ['Badge.tokens'],
          fieldEncodings: [{ field: 'Badge.tokens', encoding: 'UINT64_BE' }],
          recordOrderingKey: 'Badge.id ASC',
          emptyStateDigest: '0xcbf29ce484222325',
        },
      ],
      producerConsumerBoundaries: [
        {
          signalName: 'globalLock',
          producer: 'SYSTEM_ADMINISTRATION',
          consumer: 'evaluateRequest',
          ownership: 'SYSTEM_CONFIGURATION',
          recomputableByConsumer: false,
          provenance: [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-PRODUCT-BOUNDARY' }],
        },
      ],
    },
  });
  fixture.architectureContexts.push(
    { tag: 'time-dependent' },
    { tag: 'bounded-observability' },
    { tag: 'integrity-hash' },
  );

  const inventoryResult = validateSemanticInventoryCoverage({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
    boundaryRules: fixture.boundaryRules,
    literalFacts: fixture.literalFacts,
    requirements: fixture.requirements,
  });
  assert.equal(inventoryResult.valid, true, `TEST-33: inventory must be valid, got: ${JSON.stringify(inventoryResult.issues)}`);

  const decisionsResult = validateDecisionsWitness({
    decisions: fixture.decisions,
  });
  assert.equal(decisionsResult.valid, true, `TEST-33: decisions must be valid, got: ${JSON.stringify(decisionsResult.issues)}`);

  const lifecycleResult = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(lifecycleResult.valid, true, `TEST-33: lifecycle must be valid, got: ${JSON.stringify(lifecycleResult.issues)}`);

  const humanResolutions = [{ questionId: 'DEC-REFILL', answerId: 'PROPORTIONAL' }];
  const cert = generateClosureCertificate({ specification: fixture, humanResolutions });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedInventorySlots, 0);
  assert.equal(cert.unresolvedStateFields, 0);
  assert.equal(cert.unresolvedObservables, 0);
  assert.equal(cert.unresolvedTransitions, 0);

  const status = effectiveDeterminismStatus(fixture, humanResolutions);
  assert.equal(status, 'SEMANTICALLY_CLOSED');
  log('  PASS: TEST-33 Full contract with complete inventory coverage and valid decision witness certifies SEMANTICALLY_CLOSED');
}

// TEST-36: Numeric literals without authorized provenance MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        isCollection: true,
        capacityPolicy: {
          maxEntries: 100000,
          overflowPolicy: 'REJECT_NEW',
          provenance: [{ source: 'USER_INTENT', reference: 'FACT-INVENTED' }],
        },
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: {
            lowerBound: '0',
            upperBound: '999',
            boundaryBehavior: 'SATURATE',
            provenance: [{ source: 'USER_INTENT', reference: 'FACT-001' }],
          },
          initialization: { kind: 'EXPLICIT_VALUE', value: '10', rationale: 'Config' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{
        name: 'eval',
        guardPrecedence: ['GUARD'],
        branches: [
          { branchId: 'ALLOW', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
        ],
      }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    },
    literalFacts: [
      { id: 'FACT-001', kind: 'NUMBER_LITERAL', attributes: { value: 10 } },
    ],
  });

  const provResult = validateProvenanceEnforcement({
    stateModel: fixture.stateModel,
    literalFacts: fixture.literalFacts,
  });
  assert.equal(provResult.valid, false, 'TEST-36: unbacked numeric literal must be invalid');
  assert.equal(provResult.issues.some((i) => i.kind === 'UNAUTHORIZED_NUMERIC_LITERAL'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.unresolvedAuthorities >= 1, true);
  log('  PASS: TEST-36 Numeric literals without authorized provenance are blocked');
}

// TEST-38: BLOCKED_BY_GAP must emit structured Gap Ledger across all 4 layers
{
  // 1. Coverage accounting gap
  const covFixture = createFixture({ isStateful: true, stateModel: null });
  const covCert = generateClosureCertificate({ specification: covFixture });
  assert.equal(covCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(effectiveDeterminismStatus(covFixture, []), 'BLOCKED_BY_GAP');
  assert.ok(covCert.gapLedger.length > 0, 'TEST-38: gapLedger must be non-empty');
  const covGap = covCert.gapLedger.find((g) => g.layer === 'COVERAGE_ACCOUNTING');
  assert.ok(covGap, 'TEST-38: COVERAGE_ACCOUNTING gap must exist');
  assert.match(covGap.gapId, /^GAP-[0-9]{4}$/);
  assert.ok(covGap.witness.length > 0);
  assert.equal(covGap.requiredAuthority, 'ARCHITECTURE_POLICY');

  // 2. Transition consistency gap
  const transFixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'fractionalRemainder',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999', boundaryBehavior: 'ROLLOVER_MODULO', provenance: [{ source: 'USER_INTENT', reference: 'FACT-001' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Sem carry residual inicial' },
          mutations: [{ operation: 'evaluateRequest', condition: 'TICK', effect: 'CUSTOM', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['lockSystem'], // missing 'unquarantine' coverage
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [
        { name: 'evaluateRequest', guardPrecedence: ['LOCK'] },
        { name: 'unquarantine', guardPrecedence: ['ADMIN'] },
      ],
      observables: [{ name: 'decision', derivedFrom: ['Badge.fractionalRemainder'], representation: 'SCALAR', emptyBehavior: '0' }],
      aggregations: [],
      producerConsumerBoundaries: [],
    },
    literalFacts: [{ id: 'FACT-001', kind: 'NUMBER_LITERAL', attributes: { value: 999 } }],
  });
  const transCert = generateClosureCertificate({ specification: transFixture });
  assert.equal(transCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(effectiveDeterminismStatus(transFixture, []), 'BLOCKED_BY_GAP');
  const transGap = transCert.gapLedger.find((g) => g.layer === 'TRANSITION_CONSISTENCY');
  assert.ok(transGap, 'TEST-38: TRANSITION_CONSISTENCY gap must exist');
  assert.match(transGap.gapId, /^GAP-[0-9]{4}$/);
  assert.ok(transGap.witness.length > 0);
  assert.ok(['USER_INTENT', 'USER_DECISION'].includes(transGap.requiredAuthority));

  // 3. Observable dependency closure gap
  const obsFixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '10', boundaryBehavior: 'SATURATE', provenance: [{ source: 'USER_INTENT', reference: 'FACT-001' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '10', rationale: 'Config' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{
        name: 'eval',
        guardPrecedence: ['GUARD'],
        branches: [{ branchId: 'ALLOW', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true }],
      }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.nonexistent'], representation: 'SCALAR', emptyBehavior: '0' }],
      aggregations: [],
      producerConsumerBoundaries: [],
    },
    literalFacts: [{ id: 'FACT-001', kind: 'NUMBER_LITERAL', attributes: { value: 10 } }],
  });
  const obsCert = generateClosureCertificate({ specification: obsFixture });
  assert.equal(obsCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(effectiveDeterminismStatus(obsFixture, []), 'BLOCKED_BY_GAP');
  const obsGap = obsCert.gapLedger.find((g) => g.layer === 'OBSERVABLE_DEPENDENCY_CLOSURE');
  assert.ok(obsGap, 'TEST-38: OBSERVABLE_DEPENDENCY_CLOSURE gap must exist');
  assert.match(obsGap.gapId, /^GAP-[0-9]{4}$/);
  assert.ok(obsGap.witness.length > 0);
  assert.equal(obsGap.requiredAuthority, 'USER_INTENT');

  // 4. Authority provenance gap
  const provFixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999999', boundaryBehavior: 'SATURATE', provenance: [{ source: 'USER_INTENT', reference: 'FACT-001' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '10', rationale: 'Config' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['eval'],
        }],
      }],
      operations: [{
        name: 'eval',
        guardPrecedence: ['GUARD'],
        branches: [{ branchId: 'ALLOW', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true }],
      }],
      observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
      aggregations: [],
      producerConsumerBoundaries: [],
    },
    literalFacts: [{ id: 'FACT-001', kind: 'NUMBER_LITERAL', attributes: { value: 10 } }], // 999999 is missing!
  });
  const provCert = generateClosureCertificate({ specification: provFixture });
  assert.equal(provCert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(effectiveDeterminismStatus(provFixture, []), 'BLOCKED_BY_GAP');
  const provGap = provCert.gapLedger.find((g) => g.layer === 'AUTHORITY_PROVENANCE');
  assert.ok(provGap, 'TEST-38: AUTHORITY_PROVENANCE gap must exist');
  assert.match(provGap.gapId, /^GAP-[0-9]{4}$/);
  assert.ok(provGap.witness.length > 0);
  assert.equal(provGap.requiredAuthority, 'USER_INTENT');

  log('  PASS: TEST-38 BLOCKED_BY_GAP emits compliant Gap Ledger across all 4 layers');
}

// TEST-39: CERTIFIED_CLOSED specification must have empty gapLedger
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        description: 'Conta individual',
        isCollection: true,
        admissionPolicy: 'ON_FIRST_REQUEST',
        capacityPolicy: { maxEntries: 100, overflowPolicy: 'REJECT_NEW', provenance: [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-LOCAL' }] },
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE', provenance: [{ source: 'USER_INTENT', reference: 'FACT-001' }] },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Config' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest', 'observabilityBitmask'],
        }],
      }],
      operations: [{
        name: 'evaluateRequest',
        guardPrecedence: ['GUARD_BALANCE'],
        branches: [
          { branchId: 'ALLOW', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
          { branchId: 'GUARD_BALANCE', outcomeKind: 'REJECTION', statusOrError: 'ERR_INSUFFICIENT_CREDITS', defaultPreservation: true },
        ],
      }],
      observables: [{
        name: 'observabilityBitmask',
        derivedFrom: ['Badge.tokens'],
        representation: 'UINT32_BITMASK',
        emptyBehavior: '0',
        bitAllocation: [{ slice: '0..7', field: 'Badge.tokens', bitWidth: 8, mapping: 'IDENTITY' }],
      }],
      aggregations: [],
      producerConsumerBoundaries: [],
    },
    boundaryRules: [{
      id: 'BOUND-0001',
      subject: 'Badge.tokens',
      lowerBound: '0',
      upperBound: '100',
      overflowBehavior: 'SATURATE',
      underflowBehavior: 'SATURATE',
      representationKind: 'BOUNDED_INTEGER',
    }],
    literalFacts: [
      { id: 'FACT-001', kind: 'NUMBER_LITERAL', attributes: { value: 100 } },
      { id: 'FACT-002', kind: 'BIT_RANGE', attributes: { slice: '0..7', bitWidth: 8 } },
    ],
    requirements: [{
      id: 'REQ-0001',
      statement: 'Controle de saldo',
      basis: [{ source: 'USER_INTENT', reference: 'demanda' }],
      acceptanceCases: [{
        id: 'AC-0001-01',
        kind: 'HAPPY_PATH',
        outcomeKind: 'RETURN_VALUE',
        given: 'Um saldo válido',
        when: 'Requisitar',
        then: 'Autoriza',
        decisionBinding: null,
      }],
    }],
  });
  fixture.policy = { rules: [{ id: 'ARCH-LOCAL' }] };

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.gapLedger.length, 0, 'TEST-39: closed contract gapLedger must be empty');
  for (const removed of ['inventoryAudit', 'unresolvedSlots', 'regressedSemanticDimensions']) {
    assert.equal(Object.hasOwn(cert, removed), false, `Certificate must not emit ${removed}`);
  }
  assert.equal(Array.isArray(cert.gapLedger), true);
  const pending = generateClosureCertificate({ specification: {
    ...fixture,
    determinismReview: { ...fixture.determinismReview, dimensions: [{
      kind: 'ORDERING', subjectId: 'SUBJECT-1', status: 'DECISION_REQUIRED',
      rationale: 'Uma decisão humana ainda deve fixar a ordem observável.',
    }] },
  } });
  assert.equal(pending.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(pending.gapLedger.some(({ slotId }) => slotId === 'determinism/ORDERING/SUBJECT-1'),
    'Canonical ledger must include pending dimensions even without a decision record');
  log('  PASS: TEST-39 CERTIFIED_CLOSED contract emits empty gapLedger');
}

// TEST-40: getEffectiveGapLedger utility returns compliant Gap Ledger
{
  const fixture = createFixture({ isStateful: true, stateModel: null });
  const gaps = getEffectiveGapLedger(fixture);
  assert.ok(gaps.length > 0, 'TEST-40: getEffectiveGapLedger must return gaps');
  assert.equal(effectiveDeterminismStatus.lastGapLedger.length, gaps.length);
  for (const gap of gaps) {
    assert.match(gap.gapId, /^GAP-[0-9]{4}$/);
    assert.ok(['TRANSITION_CONSISTENCY', 'OBSERVABLE_DEPENDENCY_CLOSURE', 'AUTHORITY_PROVENANCE', 'COVERAGE_ACCOUNTING'].includes(gap.layer));
    assert.ok(gap.witness && gap.witness.length > 0);
    assert.ok(['USER_INTENT', 'ARCHITECTURE_POLICY', 'USER_DECISION'].includes(gap.requiredAuthority));
  }
  log('  PASS: TEST-40 getEffectiveGapLedger returns compliant Gap Ledger');
}

// TEST-41: Rejects executionPipeline that inverts guardPrecedence or omits declared guards (PIPELINE_PRECEDENCE_CONTRADICTION)
{
  const baseModel = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
        reset: { allowed: false },
        mutations: [],
        preservation: ['*'],
        readBy: ['evaluateRequest'],
      }],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_LOCK', 'GUARD_BALANCE'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'GUARD_BALANCE', outcomeKind: 'REJECTION', statusOrError: 'ERR_BALANCE', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
      executionPipeline: [
        { stage: 'GUARD', id: 'GUARD_BALANCE' }, // INVERTED: BALANCE before LOCK!
        { stage: 'GUARD', id: 'GUARD_LOCK' },
      ],
    }],
    observables: [{ name: 'result', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const invertedResult = validatePipelineCrossCheck({ stateModel: baseModel });
  assert.equal(invertedResult.valid, false, 'TEST-41: inverted executionPipeline must be invalid');
  assert.ok(invertedResult.issues.some((i) => i.kind === 'PIPELINE_PRECEDENCE_CONTRADICTION'));

  const omittedModel = globalThis.structuredClone(baseModel);
  omittedModel.operations[0].executionPipeline = [
    { stage: 'GUARD', id: 'GUARD_LOCK' }, // GUARD_BALANCE omitted
  ];
  const omittedResult = validatePipelineCrossCheck({ stateModel: omittedModel });
  assert.equal(omittedResult.valid, false, 'TEST-41: omitted guard in executionPipeline must be invalid');
  assert.ok(omittedResult.issues.some((i) => i.kind === 'PIPELINE_PRECEDENCE_CONTRADICTION'));

  const fixture = createFixture({ isStateful: true, stateModel: baseModel });
  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  assert.ok(cert.gapLedger.some((g) => g.layer === 'TRANSITION_CONSISTENCY' && g.slotId?.includes('executionPipeline')));
  log('  PASS: TEST-41 Inverted or omitted guards in executionPipeline blocked with PIPELINE_PRECEDENCE_CONTRADICTION');
}

// TEST-42: Rejects numeric operation parameter missing bounds or missing onInvalid on REJECT (UNRESOLVED_PARAMETER_DOMAIN)
{
  const missingBoundsModel = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
        reset: { allowed: false },
        mutations: [],
        preservation: ['*'],
        readBy: ['requestCredits'],
      }],
    }],
    operations: [{
      name: 'requestCredits',
      guardPrecedence: ['GUARD_AUTH'],
      branches: [
        { branchId: 'GUARD_AUTH', outcomeKind: 'REJECTION', statusOrError: 'ERR_AUTH', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
      parameters: [{
        name: 'amount',
        type: 'INTEGER',
        // Missing bounds!
      }],
    }],
    observables: [{ name: 'result', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const missingResult = validateInputDomainClosure({ stateModel: missingBoundsModel });
  assert.equal(missingResult.valid, false, 'TEST-42: numeric parameter missing bounds must be invalid');
  assert.ok(missingResult.issues.some((i) => i.kind === 'UNRESOLVED_PARAMETER_DOMAIN' && i.slotId?.includes('bounds')));

  const missingOnInvalidModel = globalThis.structuredClone(missingBoundsModel);
  missingOnInvalidModel.operations[0].parameters[0].bounds = {
    lowerBound: '1',
    upperBound: '100',
    boundaryBehavior: 'REJECT',
  };
  // Missing onInvalid!
  const missingOnInvalidResult = validateInputDomainClosure({ stateModel: missingOnInvalidModel });
  assert.equal(missingOnInvalidResult.valid, false, 'TEST-42: REJECT boundaryBehavior without onInvalid must be invalid');
  assert.ok(missingOnInvalidResult.issues.some((i) => i.kind === 'UNRESOLVED_PARAMETER_DOMAIN' && i.slotId?.includes('onInvalid')));

  const fixture = createFixture({ isStateful: true, stateModel: missingOnInvalidModel });
  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  assert.ok(cert.gapLedger.some((g) => g.layer === 'TRANSITION_CONSISTENCY' && g.slotId?.includes('parameter')));
  log('  PASS: TEST-42 Parameter missing bounds or onInvalid blocked with UNRESOLVED_PARAMETER_DOMAIN');
}

// TEST-43: Rejects field reset trigger without matching operation/branch/boundary (ORPHAN_STATE_MUTATION_OWNER)
{
  const orphanResetModel = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'streak',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '10', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        reset: { allowed: true, trigger: 'COMPLETELY_ORPHAN_TRIGGER_XYZ', resetValue: '0' },
        mutations: [],
        preservation: ['*'],
        readBy: ['evaluateRequest'],
      }],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'result', derivedFrom: ['Badge.streak'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const orphanResult = validateStateMutationOwnership({ stateModel: orphanResetModel });
  assert.equal(orphanResult.valid, false, 'TEST-43: orphan reset trigger must be invalid');
  assert.ok(orphanResult.issues.some((i) => i.kind === 'ORPHAN_STATE_MUTATION_OWNER'));

  const fixture = createFixture({ isStateful: true, stateModel: orphanResetModel });
  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  assert.ok(cert.gapLedger.some((g) => g.layer === 'TRANSITION_CONSISTENCY' && g.slotId?.includes('reset/trigger')));
  log('  PASS: TEST-43 Orphan reset trigger blocked with ORPHAN_STATE_MUTATION_OWNER');
}

// TEST-44: Rejects operation performing unguarded decrement on field protected by invariant (CONTRADICTORY_RULE_DETECTED)
{
  const contradictoryModel = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '10' },
        reset: { allowed: false },
        mutations: [{ operation: 'consume', effect: 'DECREMENT' }],
        preservation: [],
        readBy: ['consume'],
      }],
    }],
    operations: [{
      name: 'consume',
      guardPrecedence: [], // Unguarded!
      noGuardsRationale: 'Executa decremento sem conferir guards',
      branches: [
        {
          branchId: 'DO_CONSUME',
          outcomeKind: 'RETURN_VALUE',
          defaultPreservation: true,
          stateEffects: [{ field: 'Badge.tokens', effect: 'DECREMENT', value: '1' }],
        },
      ],
    }],
    observables: [{ name: 'result', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const invariants = [{
    id: 'INV-0001',
    statement: 'O saldo de tokens do Badge nunca fica negativo',
    falsification: 'Badge.tokens < 0',
    requirementIds: ['REQ-0001'],
  }];

  const contradictionResult = validateContradictionDetection({
    stateModel: contradictoryModel,
    invariants,
  });
  assert.equal(contradictionResult.valid, false, 'TEST-44: unguarded decrement on invariant-protected field must be invalid');
  assert.ok(contradictionResult.issues.some((i) => i.kind === 'CONTRADICTORY_RULE_DETECTED'));

  const fixture = createFixture({
    isStateful: true,
    stateModel: contradictoryModel,
    invariants,
  });
  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.contradictoryRules >= 1);
  assert.ok(cert.gapLedger.some((g) => g.layer === 'TRANSITION_CONSISTENCY' && g.witness?.includes('DECREMENT')));
  log('  PASS: TEST-44 Unguarded decrement on invariant-protected field blocked with CONTRADICTORY_RULE_DETECTED');
}

// TEST-45: Admission Policy ON_FIRST_REQUEST with observable emptyBehavior of rejection blocked with CONTRADICTORY_RULE_DETECTED
{
  const model = {
    entities: [{
      name: 'Badge',
      isCollection: true,
      admissionPolicy: 'ON_FIRST_REQUEST',
      capacityPolicy: { maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT', unboundedRationale: 'Sem limite contratual' },
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
        mutations: [],
        preservation: ['*'],
        readBy: ['decision'],
      }],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{
      name: 'decision',
      derivedFrom: ['Badge.tokens'],
      representation: 'ENUM',
      emptyBehavior: 'REJECT_UNREGISTERED_OR_EMPTY', // Contradiz ON_FIRST_REQUEST!
    }],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-45: admission policy vs observable rejection contradiction must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'CONTRADICTORY_RULE_DETECTED' && i.slotId?.includes('admissionContradiction')));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.contradictoryRules >= 1);
  log('  PASS: TEST-45 Admission Policy ON_FIRST_REQUEST vs observable rejection blocked with CONTRADICTORY_RULE_DETECTED');
}

// TEST-46: Bitmask declaring emptyBehavior: '0' with non-zero canonical emptyStateDigest blocked with CONTRADICTORY_RULE_DETECTED
{
  const model = {
    entities: [{
      name: 'Badge',
      isCollection: true,
      admissionPolicy: 'ON_FIRST_REQUEST',
      capacityPolicy: { maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT', unboundedRationale: 'Sem limite contratual' },
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
        mutations: [],
        preservation: ['*'],
        readBy: ['observabilityBitmask'],
      }],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{
      name: 'observabilityBitmask',
      derivedFrom: ['Badge.tokens'],
      representation: 'UINT32_BITMASK',
      emptyBehavior: '0', // Contradiz emptyStateDigest 0xcbf29ce484222325!
      bitAllocation: [
        { slice: '16..31', field: 'Badge.tokens', bitWidth: 16, mapping: 'FNV1A_64_BALANCES_HIGH_16' },
      ],
    }],
    canonicalSerializations: [{
      target: 'FNV1A_64_BALANCES',
      includedFields: ['Badge.tokens'],
      fieldEncodings: [{ field: 'Badge.tokens', encoding: 'UINT64_BE' }],
      recordOrderingKey: 'Badge.badgeId ASC',
      emptyStateDigest: '0xcbf29ce484222325',
    }],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-46: bitmask emptyBehavior = 0 contradiction with non-zero digest must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'CONTRADICTORY_RULE_DETECTED' && i.slotId?.includes('bitmaskEmptyDigestContradiction')));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.contradictoryRules >= 1);
  log('  PASS: TEST-46 Bitmask emptyBehavior = 0 with non-zero canonical digest blocked with CONTRADICTORY_RULE_DETECTED');
}

// TEST-47: Operation with refill context omitting REFILL stage before balance check blocked with PIPELINE_PRECEDENCE_CONTRADICTION
{
  const model = {
    entities: [{
      name: 'Badge',
      fields: [
        {
          name: 'tokens',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
          mutations: [],
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        },
        {
          name: 'refillRate',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '10' },
          mutations: [],
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        },
      ],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_BALANCE'],
      executionPipeline: [
        // Omite STAGE_REFILL antes de GUARD_BALANCE!
        { stage: 'GUARD', id: 'GUARD_BALANCE', description: 'Verifica saldo' },
        { stage: 'MUTATION', id: 'STAGE_DEDUCT', description: 'Deduz saldo' },
      ],
      parameters: [{
        name: 'requestedCredits',
        type: 'INTEGER',
        bounds: { lowerBound: '1', upperBound: '100', boundaryBehavior: 'REJECT' },
        onInvalid: { outcomeKind: 'REJECTION', error: 'ERR_INVALID_CREDITS' },
      }],
      branches: [
        { branchId: 'GUARD_BALANCE', outcomeKind: 'REJECTION', statusOrError: 'ERR_INSUFFICIENT', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-47: omitted refill stage in pipeline must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'PIPELINE_PRECEDENCE_CONTRADICTION' && i.slotId?.includes('missingRefill')));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  log('  PASS: TEST-47 Omitted REFILL stage before balance evaluation blocked with PIPELINE_PRECEDENCE_CONTRADICTION');
}

// TEST-48: Operation decrementing balance with parameter lowerBound < 1 blocked with UNRESOLVED_PARAMETER_DOMAIN
{
  const model = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
        mutations: [],
        preservation: ['*'],
        readBy: ['evaluateRequest'],
      }],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_BALANCE'],
      parameters: [{
        name: 'requestedCredits',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'REJECT' }, // <= 0 allows negative credits!
        onInvalid: { outcomeKind: 'REJECTION', error: 'ERR_INVALID_CREDITS' },
      }],
      branches: [
        { branchId: 'GUARD_BALANCE', outcomeKind: 'REJECTION', statusOrError: 'ERR_INSUFFICIENT', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: false,
          stateEffects: [{ field: 'Badge.tokens', effect: 'DECREMENT', value: 'tokens - requestedCredits' }],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-48: debit parameter with lowerBound < 1 must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_PARAMETER_DOMAIN' && i.slotId?.includes('domain')));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  log('  PASS: TEST-48 Debit parameter with lowerBound < 1 blocked with UNRESOLVED_PARAMETER_DOMAIN');
}

// TEST-49: Boundary signal with consumer operation that does not model the signal blocked with UNRESOLVED_BOUNDARY_CONSUMPTION
{
  const model = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '100' },
        mutations: [],
        preservation: ['*'],
        readBy: ['evaluateRequest'],
      }],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'], representation: 'SCALAR', emptyBehavior: '0' }],
    producerConsumerBoundaries: [{
      signalName: 'batchBoundary',
      producer: 'BATCH_INGRESS',
      consumer: 'evaluateRequest',
      ownership: 'SYSTEM_CONFIGURATION',
      recomputableByConsumer: false,
      provenance: [{ source: 'ARCHITECTURE_POLICY', reference: 'ARCH-PRODUCT-BOUNDARY' }],
    }],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-49: boundary signal not modeled by consumer must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_BOUNDARY_CONSUMPTION'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  log('  PASS: TEST-49 Boundary signal unmodeled in consumer operation blocked with UNRESOLVED_BOUNDARY_CONSUMPTION');
}

// TEST-50: Derived field without total derivation function blocked with UNRESOLVED_DERIVATION_FUNCTION
{
  const model = {
    entities: [{
      name: 'Badge',
      fields: [{
        name: 'accruedCarry',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '999', boundaryBehavior: 'ROLLOVER_MODULO' },
        initialization: { kind: 'DERIVED', value: '0', rationale: 'Valor derivado sem função total' },
        mutations: [],
        preservation: ['*'],
        readBy: ['eval'],
      }],
    }],
    operations: [{
      name: 'eval',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Badge.accruedCarry'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-50: derived field without total derivation function must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_DERIVATION_FUNCTION'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  log('  PASS: TEST-50 Derived field without total derivation function blocked with UNRESOLVED_DERIVATION_FUNCTION');
}

// TEST-51: Abstract category without closed membership definition in stateModel.categories blocked with UNRESOLVED_CATEGORY_MEMBERSHIP
{
  const model = {
    entities: [{
      name: 'Metrics',
      fields: [{
        name: 'rejectStreak',
        type: 'INTEGER',
        isCounter: true,
        bounds: { lowerBound: '0', upperBound: '255', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [
          { operation: 'eval', condition: 'BATCH_REJECTION', effect: 'INCREMENT', targetValue: 'rejectStreak + 1' },
        ],
        reset: { allowed: false },
        preservation: [],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'eval',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Metrics.rejectStreak'], representation: 'SCALAR', emptyBehavior: '0' }],
    // categories AUSENTE! BATCH_REJECTION é categoria abstrata sem enumeração
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-51: category without membership definition must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_CATEGORY_MEMBERSHIP'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  log('  PASS: TEST-51 Abstract category without closed membership definition blocked with UNRESOLVED_CATEGORY_MEMBERSHIP');
}

// TEST-52: Operation state effect assigning ungrounded term blocked with OPEN_COMPUTATIONAL_DEPENDENCY
{
  const model = {
    entities: [{
      name: 'Portfolio',
      fields: [{
        name: 'balance',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '999999', boundaryBehavior: 'REJECT' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '1000' },
        mutations: [
          { operation: 'trade', condition: 'ORDER_FILLED', effect: 'SET_VALUE', targetValue: 'balance + positionProceeds' },
        ],
        reset: { allowed: false },
        preservation: [],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'trade',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: false,
          stateEffects: [
            { field: 'Portfolio.balance', effect: 'SET', value: 'balance + positionProceeds' },
          ],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Portfolio.balance'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'PORTFOLIO_BALANCE',
        category: 'STATE_FIELD',
        target: 'Portfolio.balance',
        dependencies: [],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-52: ungrounded term positionProceeds must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('positionProceeds'));
  assert.ok(gap, 'TEST-52: gapLedger must register positionProceeds witness');
  assert.equal(gap.layer, 'COMPUTABILITY_DEPENDENCY_CLOSURE');
  log('  PASS: TEST-52 Operation state effect with ungrounded term blocked with OPEN_COMPUTATIONAL_DEPENDENCY');
}

// TEST-53: Computability node referencing STATE_FIELD absent from entity inventory blocked with OPEN_COMPUTATIONAL_DEPENDENCY
{
  const model = {
    entities: [{
      name: 'RsiEngine',
      fields: [
        {
          name: 'position',
          type: 'STRING',
          bounds: null,
          initialization: { kind: 'EXPLICIT_VALUE', value: 'NONE' },
          mutations: [],
          reset: { allowed: false },
          preservation: ['*'],
          readBy: ['obs'],
        },
      ],
    }],
    operations: [{
      name: 'eval',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['RsiEngine.position'], representation: 'SCALAR', emptyBehavior: 'NONE' }],
    computabilityGraph: [
      {
        nodeId: 'SMOOTHED_AVG_GAIN',
        category: 'STATE_FIELD',
        target: 'smoothedAvgGain', // Absent from RsiEngine.fields!
        dependencies: [],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-53: missing state field in inventory must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('smoothedAvgGain'));
  assert.ok(gap, 'TEST-53: gapLedger must register missing smoothedAvgGain in inventory');
  assert.equal(gap.layer, 'COMPUTABILITY_DEPENDENCY_CLOSURE');
  log('  PASS: TEST-53 Computability node referencing state field absent from inventory blocked with OPEN_COMPUTATIONAL_DEPENDENCY');
}

// TEST-54: Computability node with explicit OPEN_DEPENDENCY status blocked
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'state',
        type: 'STRING',
        bounds: null,
        initialization: { kind: 'EXPLICIT_VALUE', value: 'INIT' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.state'], representation: 'SCALAR', emptyBehavior: 'NONE' }],
    computabilityGraph: [
      {
        nodeId: 'LIQUIDITY_FEED',
        category: 'EXTERNAL_INPUT',
        target: 'liquidity',
        dependencies: [],
        status: 'OPEN_DEPENDENCY', // Explicit open dependency!
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-54: explicit open dependency must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  log('  PASS: TEST-54 Computability node with status OPEN_DEPENDENCY blocked with OPEN_COMPUTATIONAL_DEPENDENCY');
}

// TEST-55: Circular dependency in computability graph blocked with COMPUTATIONAL_DEPENDENCY_CYCLE
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'state',
        type: 'STRING',
        bounds: null,
        initialization: { kind: 'EXPLICIT_VALUE', value: 'INIT' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.state'], representation: 'SCALAR', emptyBehavior: 'NONE' }],
    computabilityGraph: [
      {
        nodeId: 'NODE_A',
        category: 'DERIVED_VALUE',
        target: 'termA',
        dependencies: ['NODE_B'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'NODE_B',
        category: 'DERIVED_VALUE',
        target: 'termB',
        dependencies: ['NODE_A'], // Cycle A -> B -> A!
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-55: cyclic dependency must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'COMPUTATIONAL_DEPENDENCY_CYCLE'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  log('  PASS: TEST-55 Circular dependency in computability graph blocked with COMPUTATIONAL_DEPENDENCY_CYCLE');
}

// TEST-56: Fully closed computability graph with all terminal nodes grounded certifies CERTIFIED_CLOSED
{
  const model = {
    entities: [{
      name: 'Oscillator',
      fields: [
        {
          name: 'previousClose',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999999', boundaryBehavior: 'REJECT' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'step', condition: 'STEP_OK', effect: 'SET_VALUE', targetValue: 'candleClose' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
        {
          name: 'smoothedGain',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999999', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'step', condition: 'STEP_OK', effect: 'SET_VALUE', targetValue: 'newGain' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
      ],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      parameters: [
        {
          name: 'candleClose',
          type: 'INTEGER',
          domain: 'POSITIVE_INTEGERS',
          nullability: 'NOT_NULL',
          bounds: { lowerBound: '1', upperBound: '999999', boundaryBehavior: 'REJECT' },
          onInvalid: { outcomeKind: 'REJECTION', error: 'ERR_PRICE' },
        },
      ],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: false,
          stateEffects: [
            { field: 'Oscillator.previousClose', effect: 'SET', value: 'candleClose' },
            { field: 'Oscillator.smoothedGain', effect: 'SET', value: 'newGain' },
          ],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Oscillator.previousClose', 'Oscillator.smoothedGain'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'CANDLE_CLOSE',
        category: 'EXTERNAL_INPUT',
        target: 'candleClose',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'PREVIOUS_CLOSE',
        category: 'STATE_FIELD',
        target: 'Oscillator.previousClose',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'PRICE_GAIN',
        category: 'DERIVED_VALUE',
        target: 'priceGain',
        formula: 'max(0, candleClose - previousClose)',
        dependencies: ['CANDLE_CLOSE', 'PREVIOUS_CLOSE'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'SMOOTHED_GAIN',
        category: 'STATE_FIELD',
        target: 'Oscillator.smoothedGain',
        dependencies: ['PRICE_GAIN'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'NEW_GAIN',
        category: 'DERIVED_VALUE',
        target: 'newGain',
        formula: '((smoothedGain * 13) + priceGain) / 14',
        dependencies: ['SMOOTHED_GAIN', 'PRICE_GAIN'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, true, `TEST-56: must be valid, got: ${JSON.stringify(result.issues)}`);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedDependencies, 0);
  assert.equal(cert.gapLedger.length, 0);
  log('  PASS: TEST-56 Fully closed computability graph with all terminal nodes grounded certifies CERTIFIED_CLOSED');
}

// TEST-57: Computed variable missing derivation rule blocked with MISSING_DERIVATION_RULE
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.val'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'BASE_INPUT',
        category: 'EXTERNAL_INPUT',
        target: 'baseInput',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'AVG_GAIN',
        category: 'COMPUTED_VARIABLE',
        target: 'avgGain',
        // derivationRule AUSENTE!
        dependencies: ['BASE_INPUT'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-57: missing derivationRule must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'MISSING_DERIVATION_RULE'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'COMPUTABILITY_DEPENDENCY_CLOSURE' && g.witness?.includes('AVG_GAIN'));
  assert.ok(gap, 'TEST-57: gapLedger must register MISSING_DERIVATION_RULE witness');
  log('  PASS: TEST-57 Computed variable missing derivation rule blocked with MISSING_DERIVATION_RULE');
}

// TEST-58: Formula using operand missing from dependencies (fio solto) blocked with DISCONNECTED_CIRCUIT_OPERAND
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.val'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'PRICE_INPUT',
        category: 'EXTERNAL_INPUT',
        target: 'priceInput',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'AVG_GAIN',
        category: 'COMPUTED_VARIABLE',
        target: 'avgGain',
        formula: '((previousGain * 13) + currentGain) / 14', // previousGain e currentGain NÃO ESTÃO NAS DEPENDÊNCIAS!
        dependencies: ['PRICE_INPUT'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-58: disconnected operand must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'DISCONNECTED_CIRCUIT_OPERAND'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('previousGain') || g.witness?.includes('currentGain'));
  assert.ok(gap, 'TEST-58: gapLedger must register DISCONNECTED_CIRCUIT_OPERAND witness');
  log('  PASS: TEST-58 Formula using operand missing from dependencies blocked with DISCONNECTED_CIRCUIT_OPERAND');
}

// TEST-59: Pivot/extrema node without tie-breaking policy for identical consecutive values blocked with PIVOT_TIE_POLICY_UNRESOLVED
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.val'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'PRICE_SERIES',
        category: 'EXTERNAL_INPUT',
        target: 'priceSeries',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'PIVOT_HIGHS', // Contém PIVOT!
        category: 'COMPUTED_VARIABLE',
        target: 'pivotHighs',
        formula: 'findPeaks(priceSeries)',
        dependencies: ['PRICE_SERIES'],
        // edgeCaseRules.tieBreaking ausente!
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-59: missing tieBreaking for pivot must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'PIVOT_TIE_POLICY_UNRESOLVED'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('PIVOT_HIGHS') || g.witness?.includes('desempate'));
  assert.ok(gap, 'TEST-59: gapLedger must register PIVOT_TIE_POLICY_UNRESOLVED witness');
  log('  PASS: TEST-59 Pivot node without tie-breaking policy blocked with PIVOT_TIE_POLICY_UNRESOLVED');
}

// TEST-60: Division by variable without zero-divisor rule blocked with UNRESOLVED_ZERO_DIVISOR
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.val'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'GAIN',
        category: 'EXTERNAL_INPUT',
        target: 'gain',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'LOSS',
        category: 'EXTERNAL_INPUT',
        target: 'loss',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'RS_RATIO',
        category: 'COMPUTED_VARIABLE',
        target: 'rsRatio',
        formula: 'gain / loss', // Divisão por 'loss' variável sem edgeCaseRules.zeroDivisor!
        dependencies: ['GAIN', 'LOSS'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-60: variable division without zeroDivisor rule must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_ZERO_DIVISOR'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('divisor zero') || g.witness?.includes('RS_RATIO'));
  assert.ok(gap, 'TEST-60: gapLedger must register UNRESOLVED_ZERO_DIVISOR witness');
  log('  PASS: TEST-60 Division by variable without zero-divisor rule blocked with UNRESOLVED_ZERO_DIVISOR');
}

// TEST-61: Execution/order node without feedbackConfirmation blocked with UNCONFIRMED_FEEDBACK_LOOP
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.val'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'SIGNAL',
        category: 'EXTERNAL_INPUT',
        target: 'signal',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'ORDER_DISPATCH', // Execution node!
        category: 'COMPUTED_VARIABLE',
        target: 'orderDispatch',
        formula: 'dispatchOrder(signal)',
        dependencies: ['SIGNAL'],
        // feedbackConfirmation AUSENTE!
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-61: order dispatch without feedbackConfirmation must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'UNCONFIRMED_FEEDBACK_LOOP'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('ORDER_DISPATCH') || g.witness?.includes('feedbackConfirmation'));
  assert.ok(gap, 'TEST-61: gapLedger must register UNCONFIRMED_FEEDBACK_LOOP witness');
  log('  PASS: TEST-61 Execution node without feedback confirmation blocked with UNCONFIRMED_FEEDBACK_LOOP');
}

// TEST-62: Broken causal circuit blocks downstream nodes with NON_COMPUTABLE_PRECURSOR
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.val'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'FEED',
        category: 'EXTERNAL_INPUT',
        target: 'feed',
        dependencies: [],
        status: 'OPEN_DEPENDENCY', // Fio quebrado na origem!
      },
      {
        nodeId: 'STEP_1',
        category: 'COMPUTED_VARIABLE',
        target: 'step1',
        formula: 'feed * 2',
        dependencies: ['FEED'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'STEP_FINAL',
        category: 'COMPUTED_VARIABLE',
        target: 'stepFinal',
        formula: 'step1 + 10',
        dependencies: ['STEP_1'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-62: broken precursor must propagate NOT_COMPUTABLE');
  assert.ok(result.issues.some((i) => i.kind === 'NON_COMPUTABLE_PRECURSOR'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.witness?.includes('Corrente causal interrompida'));
  assert.ok(gap, 'TEST-62: gapLedger must register broken causal current witness');
  log('  PASS: TEST-62 Broken causal circuit blocks downstream nodes with NON_COMPUTABLE_PRECURSOR');
}

// TEST-63: Complete Level 3 circuit with edge cases, tie breaking and feedback loop certifies CERTIFIED_CLOSED
{
  const model = {
    entities: [{
      name: 'RsiEngine',
      fields: [
        {
          name: 'position',
          type: 'STRING',
          bounds: null,
          initialization: { kind: 'EXPLICIT_VALUE', value: 'NONE' },
          mutations: [{ operation: 'step', condition: 'DIV_OK', effect: 'SET_VALUE', targetValue: "'BUY'" }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
        {
          name: 'previousClose',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999999', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'step', condition: 'DIV_OK', effect: 'SET_VALUE', targetValue: 'candle.close' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
        {
          name: 'previousAvgGain',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999999', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'step', condition: 'DIV_OK', effect: 'SET_VALUE', targetValue: 'avgGain' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
      ],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: false,
          stateEffects: [
            { field: 'RsiEngine.position', effect: 'SET', value: "'BUY'" },
            { field: 'RsiEngine.previousClose', effect: 'SET', value: 'candle.close' },
            { field: 'RsiEngine.previousAvgGain', effect: 'SET', value: 'avgGain' },
          ],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['RsiEngine.position'], representation: 'SCALAR', emptyBehavior: 'NONE' }],
    computabilityGraph: [
      {
        nodeId: 'CANDLE_FEED',
        category: 'EXTERNAL_INPUT',
        target: 'candle.close',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'PREVIOUS_CLOSE',
        category: 'STATE_FIELD',
        target: 'RsiEngine.previousClose',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'CURRENT_GAIN',
        category: 'COMPUTED_VARIABLE',
        target: 'currentGain',
        formula: 'max(0, candle.close - previousClose)',
        dependencies: ['CANDLE_FEED', 'PREVIOUS_CLOSE'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'PREVIOUS_AVG_GAIN',
        category: 'STATE_FIELD',
        target: 'RsiEngine.previousAvgGain',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'AVG_GAIN',
        category: 'COMPUTED_VARIABLE',
        target: 'avgGain',
        formula: '((previousAvgGain * 13) + currentGain) / 14',
        dependencies: ['PREVIOUS_AVG_GAIN', 'CURRENT_GAIN'],
        edgeCaseRules: {
          unfilledBuffer: 'ACCUMULATE_RAW_SUM',
        },
        status: 'GROUNDED',
      },
      {
        nodeId: 'PIVOT_HIGHS',
        category: 'COMPUTED_VARIABLE',
        target: 'pivotHighs',
        formula: 'localPeak(candle.close, 14)',
        dependencies: ['CANDLE_FEED'],
        edgeCaseRules: {
          tieBreaking: 'STRICT_LOCAL_EXTREMUM',
        },
        status: 'GROUNDED',
      },
      {
        nodeId: 'ORDER_DISPATCH',
        category: 'COMPUTED_VARIABLE',
        target: 'orderDispatch',
        formula: 'emitOrder(PIVOT_HIGHS, AVG_GAIN)',
        dependencies: ['PIVOT_HIGHS', 'AVG_GAIN'],
        feedbackConfirmation: {
          executionMode: 'LOCAL_SYNCHRONOUS_FILL',
          confirmedBy: 'ORDER_ROUTER',
        },
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, true, `TEST-63 must be valid, got issues: ${JSON.stringify(result.issues)}`);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedDependencies, 0);
  assert.equal(cert.gapLedger.length, 0);
  log('  PASS: TEST-63 Complete Level 3 circuit with edge cases and feedback loop certifies CERTIFIED_CLOSED');
}

// TEST-64: Dimensional mismatch between distinct unit families blocked with DIMENSIONAL_UNIT_MISMATCH
{
  const model = {
    entities: [{
      name: 'Yard',
      fields: [{
        name: 'volume',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '10000', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Yard.volume'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'VOLUME_FEED',
        category: 'EXTERNAL_INPUT',
        target: 'dockVolume',
        unit: { family: 'PHYSICAL_VOLUME', label: 'M3' },
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'RATE_FEED',
        category: 'EXTERNAL_INPUT',
        target: 'feePerPallet',
        unit: { family: 'CURRENCY', label: 'CENTS' },
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'INVALID_SUM',
        category: 'COMPUTED_VARIABLE',
        target: 'invalidSum',
        formula: 'dockVolume + feePerPallet',
        unit: { family: 'PHYSICAL_VOLUME', label: 'M3' },
        dependencies: ['VOLUME_FEED', 'RATE_FEED'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-64: dimensional mismatch must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'DIMENSIONAL_UNIT_MISMATCH'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'COMPUTABILITY_DEPENDENCY_CLOSURE' && g.witness?.includes('INVALID_SUM'));
  assert.ok(gap, 'TEST-64: gapLedger must register DIMENSIONAL_UNIT_MISMATCH witness');
  log('  PASS: TEST-64 Dimensional mismatch between distinct unit families blocked with DIMENSIONAL_UNIT_MISMATCH');
}

// TEST-65: Member-level allocation with only aggregate inputs blocked with COLLECTION_MEMBERS_MISSING
{
  const model = {
    entities: [{
      name: 'Yard',
      fields: [{
        name: 'capacity',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '10000', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '10000' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Yard.capacity'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'AVAILABLE_CAPACITY',
        category: 'EXTERNAL_INPUT',
        target: 'availableCapacity',
        cardinality: 'SCALAR',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'TOTAL_DEMAND',
        category: 'EXTERNAL_INPUT',
        target: 'totalDemand',
        cardinality: 'AGGREGATE',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'ORDER_APPORTIONMENT',
        category: 'COMPUTED_VARIABLE',
        target: 'orderApportionment',
        cardinality: 'COLLECTION',
        formula: '(availableCapacity * 10000n) / totalDemand',
        dependencies: ['AVAILABLE_CAPACITY', 'TOTAL_DEMAND'],
        edgeCaseRules: { zeroDivisor: 'REJECT_ALL' },
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-65: member allocation with aggregate inputs must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'COLLECTION_MEMBERS_MISSING'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'COMPUTABILITY_DEPENDENCY_CLOSURE' && g.witness?.includes('ORDER_APPORTIONMENT'));
  assert.ok(gap, 'TEST-65: gapLedger must register COLLECTION_MEMBERS_MISSING witness');
  log('  PASS: TEST-65 Member-level allocation with only aggregate inputs blocked with COLLECTION_MEMBERS_MISSING');
}

// TEST-66: Selective entity penalty using anonymous boolean flag blocked with IDENTITY_PRESERVATION_MISSING
{
  const model = {
    entities: [{
      name: 'CarrierRegistry',
      fields: [{
        name: 'carrierIsPenalized',
        type: 'BOOLEAN',
        bounds: null,
        initialization: { kind: 'EXPLICIT_VALUE', value: 'false' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['CarrierRegistry.carrierIsPenalized'], representation: 'SCALAR', emptyBehavior: 'false' }],
    computabilityGraph: [
      {
        nodeId: 'INFRACTION_FEED',
        category: 'EXTERNAL_INPUT',
        target: 'infractionDetected',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'PENALIZE_CARRIER',
        category: 'COMPUTED_VARIABLE',
        target: 'CarrierRegistry.carrierIsPenalized',
        formula: 'infractionDetected == true',
        cardinality: 'SCALAR',
        dependencies: ['INFRACTION_FEED'],
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-66: selective action with boolean flag must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'IDENTITY_PRESERVATION_MISSING'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'COMPUTABILITY_DEPENDENCY_CLOSURE' && g.witness?.includes('PENALIZE_CARRIER'));
  assert.ok(gap, 'TEST-66: gapLedger must register IDENTITY_PRESERVATION_MISSING witness');
  log('  PASS: TEST-66 Selective entity penalty using anonymous boolean flag blocked with IDENTITY_PRESERVATION_MISSING');
}

// TEST-67: Multi-leg triangulation without canonical transaction block blocked with TRANSACTION_BOUNDARY_UNCLOSED
{
  const model = {
    entities: [{
      name: 'Yard',
      fields: [{
        name: 'heldVolume',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '10000', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'step',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Yard.heldVolume'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'VOLUME_AB',
        category: 'EXTERNAL_INPUT',
        target: 'volumeAB',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'EXECUTE_TRIANGULATION',
        category: 'COMPUTED_VARIABLE',
        target: 'executeTriangulation',
        formula: 'volumeAB > 0',
        dependencies: ['VOLUME_AB'],
        status: 'GROUNDED',
        // transaction AUSENTE!
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-67: multi-leg triangulation without transaction must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'TRANSACTION_BOUNDARY_UNCLOSED'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedDependencies >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'COMPUTABILITY_DEPENDENCY_CLOSURE' && g.witness?.includes('EXECUTE_TRIANGULATION'));
  assert.ok(gap, 'TEST-67: gapLedger must register TRANSACTION_BOUNDARY_UNCLOSED witness');
  log('  PASS: TEST-67 Multi-leg triangulation without canonical transaction block blocked with TRANSACTION_BOUNDARY_UNCLOSED');
}

// TEST-68: Full Aegis Semantic Circuit v2 with dimensional units, collections, identity preservation & transaction certifies CERTIFIED_CLOSED
{
  const model = {
    entities: [{
      name: 'Yard',
      fields: [
        {
          name: 'dockA_volume',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '10000', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'step', condition: 'OK', effect: 'SET_VALUE', targetValue: 'volumeA' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
        {
          name: 'dockB_volume',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '10000', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'step', condition: 'OK', effect: 'SET_VALUE', targetValue: 'volumeB' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
        {
          name: 'penalizedCarrierSet',
          type: 'STRING',
          bounds: null,
          initialization: { kind: 'EXPLICIT_VALUE', value: "'EMPTY_SET'" },
          mutations: [{ operation: 'step', condition: 'OK', effect: 'SET_VALUE', targetValue: 'carrierPenalty' }],
          reset: { allowed: false },
          preservation: [],
          readBy: ['obs'],
        },
      ],
    }],
    operations: [{
      name: 'step',
      parameters: [{ name: 'volumeA' }, { name: 'volumeB' }, { name: 'orderQueue' }],
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: false,
          stateEffects: [
            { field: 'Yard.dockA_volume', effect: 'SET', value: 'volumeA' },
            { field: 'Yard.dockB_volume', effect: 'SET', value: 'volumeB' },
            { field: 'Yard.penalizedCarrierSet', effect: 'SET', value: 'carrierPenalty' },
          ],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Yard.dockA_volume'], representation: 'SCALAR', emptyBehavior: '0' }],
    computabilityGraph: [
      {
        nodeId: 'VOLUME_A',
        category: 'EXTERNAL_INPUT',
        target: 'volumeA',
        semanticType: 'VALUE',
        unit: { family: 'PHYSICAL_VOLUME', label: 'M3' },
        cardinality: 'SCALAR',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'VOLUME_B',
        category: 'EXTERNAL_INPUT',
        target: 'volumeB',
        semanticType: 'VALUE',
        unit: { family: 'PHYSICAL_VOLUME', label: 'M3' },
        cardinality: 'SCALAR',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'ORDER_QUEUE',
        category: 'EXTERNAL_INPUT',
        target: 'orderQueue',
        semanticType: 'COLLECTION',
        cardinality: 'COLLECTION',
        dependencies: [],
        status: 'GROUNDED',
      },
      {
        nodeId: 'COMBINED_VOLUME',
        category: 'COMPUTED_VARIABLE',
        target: 'combinedVolume',
        semanticType: 'VALUE',
        unit: { family: 'PHYSICAL_VOLUME', label: 'M3' },
        cardinality: 'SCALAR',
        formula: 'volumeA + volumeB',
        dependencies: ['VOLUME_A', 'VOLUME_B'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'ORDER_APPORTIONMENT',
        category: 'COMPUTED_VARIABLE',
        target: 'orderApportionment',
        semanticType: 'COLLECTION',
        cardinality: 'COLLECTION',
        formula: 'allocateOrders(combinedVolume, orderQueue)',
        dependencies: ['COMBINED_VOLUME', 'ORDER_QUEUE'],
        feedbackConfirmation: {
          executionMode: 'LOCAL_SYNCHRONOUS_FILL',
        },
        status: 'GROUNDED',
      },
      {
        nodeId: 'CARRIER_PENALTY',
        category: 'COMPUTED_VARIABLE',
        target: 'carrierPenalty',
        semanticType: 'IDENTITY',
        cardinality: 'COLLECTION',
        identityScope: { entity: 'Carrier', identifierField: 'carrierId', isPreservedSet: true },
        formula: 'extractOffendingCarriers(ORDER_QUEUE)',
        dependencies: ['ORDER_QUEUE'],
        status: 'GROUNDED',
      },
      {
        nodeId: 'EXECUTE_TRIANGULATION',
        category: 'COMPUTED_VARIABLE',
        target: 'executeTriangulation',
        semanticType: 'TRANSACTION',
        formula: 'commitTriangulation(volumeA, volumeB)',
        dependencies: ['VOLUME_A', 'VOLUME_B'],
        transaction: {
          scope: 'TRIANGULATION_CLOSURE',
          candidateFields: ['Yard.dockA_volume', 'Yard.dockB_volume'],
          commitGuard: 'ALL_LEGS_CONFIRMED',
          onCommit: 'COMMIT_VOLUMES',
          onRollback: 'ROLLBACK_VOLUMES',
        },
        status: 'GROUNDED',
      },
    ],
  };

  const fixture = createFixture({ isStateful: true, stateModel: model });
  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, true, `TEST-68 must be valid, got issues: ${JSON.stringify(result.issues)}`);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedDependencies, 0);
  assert.equal(cert.gapLedger.length, 0);
  log('  PASS: TEST-68 Full Aegis Semantic Circuit v2 with dimensional units, collections, identity preservation & transaction certifies CERTIFIED_CLOSED');
}

log('[CTDD TEST] Structural Field Lifecycle, Closure Certificate & Gap Ledger tests passed!');
