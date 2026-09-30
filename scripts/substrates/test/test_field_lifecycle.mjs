import assert from 'node:assert/strict';
import process from 'node:process';
import {
  generateClosureCertificate,
  validateAggregationAndBoundaries,
  validateDecisionsWitness,
  validateFieldLifecycle,
  validateOperationTotality,
  validateProvenanceEnforcement,
  validateSemanticInventoryCoverage,
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
  assert.equal(Array.isArray(cert.gapLedger), true);
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

log('[CTDD TEST] Structural Field Lifecycle, Closure Certificate & Gap Ledger tests passed!');
