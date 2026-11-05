import assert from 'node:assert/strict';
import process from 'node:process';
import {
  generateClosureCertificate,
  validateContradictionDetection,
  validateDecisionsWitness,
  validateFieldLifecycle,
  validateOperationTotality,
  validateProvenanceEnforcement,
  validateSemanticInventoryCoverage,
} from '../../lib/semantic_closure.mjs';
import { effectiveDeterminismStatus } from '../../lib/semantic_approval.mjs';
import { validateDeterminismCoverage } from '../../lib/semantic_draft_validator.mjs';

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
  architectureContexts = null,
  pathReferences = [],
} = {}) {
  return {
    architectureContexts: architectureContexts ?? (isStateful
      ? [{ tag: 'product-demand' }, { tag: 'stateful-operation' }]
      : [{ tag: 'product-demand' }]),
    pathReferences,
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

// TEST-40: generateClosureCertificate returns compliant Gap Ledger
{
  const fixture = createFixture({ isStateful: true, stateModel: null });
  const { gapLedger: gaps } = generateClosureCertificate({ specification: fixture });
  assert.ok(gaps.length > 0, 'TEST-40: generateClosureCertificate must return gaps');
  for (const gap of gaps) {
    assert.match(gap.gapId, /^GAP-[0-9]{4}$/);
    assert.ok(['TRANSITION_CONSISTENCY', 'OBSERVABLE_DEPENDENCY_CLOSURE', 'AUTHORITY_PROVENANCE', 'COVERAGE_ACCOUNTING'].includes(gap.layer));
    assert.ok(gap.witness && gap.witness.length > 0);
    assert.ok(['USER_INTENT', 'ARCHITECTURE_POLICY', 'USER_DECISION'].includes(gap.requiredAuthority));
  }
  log('  PASS: TEST-40 generateClosureCertificate returns compliant Gap Ledger');
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

// TEST-76: Public Surface Coverage Trap (EXTERNAL_EFFECT_COVERAGE_MISSING)
{
  const model = {
    entities: [{
      name: 'Ingestor',
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
    observables: [{ name: 'obs', derivedFrom: ['Ingestor.val'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const pathReferences = [{ path: 'quarantine/audit.log', role: 'PUBLIC_SURFACE' }];
  const fixture = createFixture({
    isStateful: true,
    stateModel: model,
    pathReferences,
    architectureContexts: [{ tag: 'external-effect' }],
  });

  const result = validateFieldLifecycle({
    stateModel: model,
    pathReferences,
    architectureContexts: [{ tag: 'external-effect' }],
  });
  assert.equal(result.valid, false, 'TEST-76: unmodeled public surface must be blocked');
  assert.ok(result.issues.some((i) => i.kind === 'EXTERNAL_EFFECT_COVERAGE_MISSING' && i.slotId.includes('quarantine/audit.log')));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'TRANSITION_CONSISTENCY' && g.witness?.includes('quarantine/audit.log'));
  assert.ok(gap, 'TEST-76: gapLedger must register unmodeled public surface witness');
  log('  PASS: TEST-76 Public surface without external physical effect blocked with EXTERNAL_EFFECT_COVERAGE_MISSING');
}

// TEST-77: Transaction / Rollback Coverage Trap (TRANSACTION_ROLLBACK_MISSING)
{
  const model = {
    entities: [{
      name: 'Ingestor',
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
      name: 'appendLedger',
      description: 'Append de linhas válidas no consolidado definitivo',
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: true,
          externalEffects: [
            { targetPath: 'processed/ledger.tsv', action: 'APPEND_CONTENT', confirmationCheck: 'FS_SYNC' },
          ],
        },
      ],
      // rollback AUSENTE!
    }],
    observables: [{ name: 'obs', derivedFrom: ['Ingestor.val'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const fixture = createFixture({
    isStateful: true,
    stateModel: model,
    architectureContexts: [{ tag: 'external-effect' }],
  });
  const result = validateFieldLifecycle({
    stateModel: model,
    architectureContexts: [{ tag: 'external-effect' }],
  });
  assert.equal(result.valid, false, 'TEST-77: external write without rollback strategy must be blocked');
  assert.ok(result.issues.some((i) => i.kind === 'TRANSACTION_ROLLBACK_MISSING'));

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.ok(cert.unresolvedTransitions >= 1);
  const gap = cert.gapLedger.find((g) => g.layer === 'TRANSITION_CONSISTENCY' && g.witness?.includes('rollback ou limpeza'));
  assert.ok(gap, 'TEST-77: gapLedger must register TRANSACTION_ROLLBACK_MISSING witness');
  log('  PASS: TEST-77 Operation modifying external state without rollback strategy blocked with TRANSACTION_ROLLBACK_MISSING');
}

// TEST-79: External effect missing confirmationCheck, onSuccess, or onFailure is blocked
// -------------------------------------------------------------------------------------------------
{
  const model = {
    entities: [{
      name: 'Ingestor',
      fields: [{
        name: 'processedCount',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '1000', boundaryBehavior: 'SATURATE' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        reset: { allowed: false },
        preservation: ['*'],
        readBy: ['obs'],
      }],
    }],
    operations: [{
      name: 'isolateQuarantine',
      description: 'Mover arquivo inválido para quarantine',
      guardPrecedence: ['GUARD_VALID'],
      rollback: { strategy: 'TRAP_PURGE_TEMPORARY', target: '/tmp/*', onSignal: ['SIGINT'] },
      branches: [
        { branchId: 'GUARD_VALID', outcomeKind: 'REJECTION', statusOrError: 'ERR_VAL', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: true,
          externalEffects: [
            {
              targetPath: 'quarantine',
              action: 'MOVE_FILE',
              preservesTimestamp: true,
              confirmationCheck: 'EXIT_CODE_ZERO',
              // Missing onSuccess and onFailure!
            },
          ],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Ingestor.processedCount'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const result = validateFieldLifecycle({
    stateModel: model,
    pathReferences: [{ path: 'quarantine', description: 'Diretório de quarentena' }],
    architectureContexts: [{ tag: 'external-effect' }],
  });

  assert.equal(result.valid, false, 'TEST-79 must fail when external effect lacks onSuccess/onFailure');
  const missingOnSuccess = result.issues.find((i) => i.kind === 'INCOMPLETE_EXTERNAL_EFFECT' && i.slotId.includes('onSuccess'));
  const missingOnFailure = result.issues.find((i) => i.kind === 'INCOMPLETE_EXTERNAL_EFFECT' && i.slotId.includes('onFailure'));
  assert.ok(missingOnSuccess, 'Expected INCOMPLETE_EXTERNAL_EFFECT for onSuccess');
  assert.ok(missingOnFailure, 'Expected INCOMPLETE_EXTERNAL_EFFECT for onFailure');
  log('  PASS: TEST-79 External effect missing onSuccess/onFailure blocked with INCOMPLETE_EXTERNAL_EFFECT');
}

// -------------------------------------------------------------------------------------------------
// TEST-87: Unbounded integer field (upperBound: null) with UNBOUNDED_ERROR passes without forced invented bounds
{
  const model = {
    entities: [{
      name: 'Counter',
      fields: [{
        name: 'volume',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'UNBOUNDED_ERROR' },
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
    observables: [{ name: 'obs', derivedFrom: ['Counter.volume'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, true, 'TEST-87: unbounded field with UNBOUNDED_ERROR must be valid with upperBound: null');
  assert.equal(result.issues.length, 0);
  log('  PASS: TEST-87 Unbounded integer field with upperBound: null passes without invented number');
}

// TEST-88: Saturated integer field (boundaryBehavior: 'SATURATE') with upperBound: null is blocked with UNRESOLVED_FIELD_BOUNDS
{
  const model = {
    entities: [{
      name: 'Counter',
      fields: [{
        name: 'volume',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'SATURATE' },
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
    observables: [{ name: 'obs', derivedFrom: ['Counter.volume'], representation: 'SCALAR', emptyBehavior: '0' }],
  };

  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-88: SATURATE without upperBound must be rejected');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_FIELD_BOUNDS'), 'Must flag UNRESOLVED_FIELD_BOUNDS when SATURATE lacks upper ceiling');
  log('  PASS: TEST-88 Saturated integer field with upperBound: null blocked with UNRESOLVED_FIELD_BOUNDS');
}

// TEST-89: Minimal sufficient closure: pure function computation without stateModel, transactionModel or identityGraph
{
  const fixture = createFixture({
    isStateful: false,
    stateModel: null,
    architectureContexts: ['product-demand', 'public-interface'],
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'TEST-89: pure stateless computation must not demand stateModel');

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedStateFields, 0);
  assert.equal(cert.unresolvedDependencies, 0);
  log('  PASS: TEST-89 Minimal sufficient closure: pure stateless computation certifies CERTIFIED_CLOSED');
}

// TEST-90: Unconditional token check blocks ungrounded terms even when computabilityGraph is null
{
  const model = {
    entities: [{
      name: 'Engine',
      fields: [
        {
          name: 'partialFillOccurred',
          type: 'BOOLEAN',
          bounds: null,
          initialization: { kind: 'EXPLICIT_VALUE', value: 'false' },
          mutations: [],
          reset: { allowed: false },
          preservation: ['*'],
          readBy: ['obs'],
        },
      ],
    }],
    operations: [{
      name: 'processBatch',
      parameters: [{ name: 'batch', type: 'ARRAY<Order>' }],
      guardPrecedence: ['GUARD_LOCK'],
      branches: [
        { branchId: 'GUARD_LOCK', outcomeKind: 'REJECTION', statusOrError: 'ERR_LOCK', defaultPreservation: true },
        {
          branchId: 'SUCCESS',
          outcomeKind: 'RETURN_VALUE',
          statusOrError: 'OK',
          defaultPreservation: false,
          stateEffects: [
            { field: 'Engine.partialFillOccurred', effect: 'SET', value: 'partialFillUsed' },
          ],
        },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Engine.partialFillOccurred'], representation: 'SCALAR', emptyBehavior: 'false' }],
  };

  const result = validateFieldLifecycle({ stateModel: model });
  assert.equal(result.valid, false, 'TEST-90: ungrounded term partialFillUsed must be invalid');
  assert.ok(result.issues.some((i) => i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY' && i.reason.includes('partialFillUsed')));
  log('  PASS: TEST-90 Unconditional token check blocks ungrounded terms in operation stateEffects');
}

// TEST-93: Determinism promise in rationale or claim without dimensions blocked in assertSemanticDraft
{
  const draft = {
    schema: 'aegis.semantic_draft.v4',
    title: 'Motor de Liquidez',
    interpretation: 'Interpretação válida.',
    changeKind: 'PRODUCT',
    sourceContextDigest: '0000000000000000000000000000000000000000000000000000000000000000',
    scope: { inScope: ['Motor'], outOfScope: ['UI'] },
    intentClaims: [{
      id: 'CLAIM-1',
      kind: 'OBLIGATION',
      disposition: 'NORMATIVE',
      quote: 'processar com determinismo estrito',
      contractEffect: 'Processar lote com determinismo estrito.',
      sourceFragmentIds: ['FRAG-1'],
      targetIds: ['REQ-1'],
    }],
    nonNormativeItems: [],
    pathReferences: [],
    architectureContexts: ['product-demand'],
    policyAssessments: [],
    complexityReview: { status: 'NO_EXCESS', rationale: 'Sem excesso.', alternatives: [] },
    requirements: [{
      id: 'REQ-1',
      kind: 'FUNCTIONAL',
      statement: 'Processar lote com determinismo estrito.',
      sourceFragmentIds: ['FRAG-1'],
      basis: [{ source: 'USER_INTENT', reference: 'Ref' }],
      measurement: null,
      acceptanceCases: [{
        id: 'AC-1',
        kind: 'HAPPY_PATH',
        given: 'Lote.',
        when: 'Executar.',
        then: 'Processar lote com determinismo estrito.',
        outcomeKind: 'RETURN_VALUE',
        decisionBinding: null,
        boundaryBinding: null,
      }],
    }],
    invariants: [],
    riskReview: { certainty: 'ASSESSED', rationale: 'Risco avaliado.' },
    adversarialReview: { rationale: 'Adversarial OK.', findings: [] },
    decisions: [],
    determinismReview: {
      status: 'NOT_APPLICABLE',
      rationale: 'O motor opera puramente em memória com determinismo estrito.',
      sourceFragmentIds: ['FRAG-1'],
      coverage: [{
        claimId: 'CLAIM-1',
        disposition: 'NO_DIMENSION_APPLICABLE',
        dimensions: [],
      }],
      dimensions: [],
    },
    boundaryRules: [],
    stateModel: null,
  };

  assert.throws(
    () => validateDeterminismCoverage(draft),
    /inapplicable_determinism_coverage_with_determinism_claim|determinism_dimensions_required_when_rationale_promises_determinism/,
    'TEST-93: claim promising determinism marked as NO_DIMENSION_APPLICABLE must be rejected'
  );
  log('  PASS: TEST-93 Determinism promise in rationale or claim without dimensions blocked in validateDeterminismCoverage');
}

// TEST-96: Gap ledger folds decision-owned DECISION_REQUIRED dimensions into pending decisions
{
  const fixture = createFixture({
    isStateful: false,
    decisions: [
      {
        questionId: 'Q-0001',
        question: 'Política de folhas ímpares Merkle?',
        semanticKey: 'domain.merkle_odd_policy',
        distinguishingCase: {
          given: 'Dado.',
          when: 'Quando.',
          outcomes: [{ answerId: 'ANS-1', then: 'A' }, { answerId: 'ANS-2', then: 'B' }],
        },
        answers: [{ id: 'ANS-1', label: 'A' }, { id: 'ANS-2', label: 'B' }],
      },
    ],
    dimensions: [
      {
        kind: 'REPRESENTATION',
        subjectId: 'REQ-0001',
        status: 'DECISION_REQUIRED',
        rationale: 'Folhas ímpares alteram o hash.',
        targetIds: ['REQ-0001', 'Q-0001'],
      },
      {
        kind: 'ORDERING',
        subjectId: 'REQ-0002',
        status: 'DECISION_REQUIRED',
        rationale: 'Ordem de ordenação sem decisão vinculada.',
        targetIds: ['REQ-0002'],
      },
    ],
  });

  const cert = generateClosureCertificate({ specification: fixture });
  // GAP-0001: Q-0001 folds the REPRESENTATION dimension
  // GAP-0002: ORDERING dimension without decision stays as an independent gap
  assert.equal(cert.gapLedger.length, 2, 'TEST-96: expected exactly 2 gaps (1 folded into decision, 1 independent dimension)');
  const decisionGap = cert.gapLedger.find((g) => g.slotId === 'decision/Q-0001');
  assert.ok(decisionGap, 'TEST-96: decision Q-0001 gap must exist');
  assert.ok(decisionGap.details.includes('REPRESENTATION'), 'TEST-96: related dimension must be folded into details');
  const dimGap = cert.gapLedger.find((g) => g.slotId === 'determinism/ORDERING/REQ-0002');
  assert.ok(dimGap, 'TEST-96: independent dimension must remain independent');
  log('  PASS: TEST-96 Gap ledger folds decision-owned DECISION_REQUIRED dimensions into decisions without duplicating gaps');
}

// TEST-100: Pure/stateless computational demand (e.g. cycle bitmask calculation) does not require stateModel.entities or computabilityGraph
{
  const fixture = createFixture({
    isStateful: false,
    architectureContexts: [{ tag: 'bounded-observability' }, { tag: 'public-interface' }],
    requirements: [{ statement: 'Calcular bitmask de descongestão de ciclos' }],
    stateModel: {
      entities: [],
      observables: [{
        name: 'bitmask',
        derivedFrom: ['*'],
        representation: 'SCALAR',
        emptyBehavior: '0',
      }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
    requirements: fixture.requirements,
  });
  assert.equal(result.valid, true, 'TEST-100: pure computational demand must be valid without computabilityGraph or entities');

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED', 'TEST-100: pure computation must certify closed without artificial state AST');
  assert.equal(cert.gapLedger.length, 0, 'TEST-100: gap ledger must be empty for pure computation');
  log('  PASS: TEST-100 Pure/stateless computation (cycle detection) certified closed without forced stateModel entities or computabilityGraph');
}

// TEST-101: Integer field with upperBound 500 allocated to 1-bit slice blocked with INVALID_BITMASK_ALLOCATION
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Device',
        fields: [{
          name: 'channels',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '500', boundaryBehavior: 'SATURATE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [],
          preservation: ['*'],
          readBy: ['statusBitmask'],
        }],
      }],
      observables: [{
        name: 'statusBitmask',
        derivedFrom: ['Device.channels'],
        representation: 'UINT32_BITMASK',
        emptyBehavior: '0',
        bitAllocation: [{ slice: '3..3', field: 'Device.channels', bitWidth: 1 }],
      }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-101: 1-bit slice for 500-capacity integer must fail validation');
  assert.ok(result.issues.some((i) => i.kind === 'INVALID_BITMASK_ALLOCATION' && i.slotId.includes('capacity')));
  log('  PASS: TEST-101 Integer field with upperBound 500 allocated to 1-bit slice blocked with INVALID_BITMASK_ALLOCATION');
}

// TEST-102: Mutation declared on field without matching branch effect or branchId blocked with UNRESOLVED_TRANSITION
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Sensor',
        fields: [{
          name: 'lastSeq',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '999', boundaryBehavior: 'PRESERVE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [{ operation: 'receiveFrame', condition: 'VALID_FRAME', effect: 'SET_VALUE', targetValue: 'seq' }],
          preservation: ['*'],
          readBy: ['receiveFrame'],
        }],
      }],
      operations: [{
        name: 'receiveFrame',
        guardPrecedence: ['GUARD_CORRUPTED'],
        branches: [
          { branchId: 'GUARD_CORRUPTED', outcomeKind: 'REJECTION', statusOrError: 'ERR', defaultPreservation: true },
          { branchId: 'SUCCESS', outcomeKind: 'RETURN_VALUE', statusOrError: 'OK', defaultPreservation: true },
        ],
      }],
    },
  });

  const result = validateOperationTotality({
    stateModel: fixture.stateModel,
  });
  assert.equal(result.valid, false, 'TEST-102: unmodeled mutation condition without branch effects must fail');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_TRANSITION' && i.slotId.includes('mutationCoverage')));
  log('  PASS: TEST-102 Mutation declared on field without matching branch effect or branchId blocked with UNRESOLVED_TRANSITION');
}

// TEST-107: Collection canonical serialization with non-identifier simple ordering key blocked
{
  const model = {
    entities: [{
      name: 'Gaveta',
      isCollection: true,
      admissionPolicy: 'ON_FRAME',
      capacityPolicy: { maxEntries: '10', overflowPolicy: 'REJECT_NEW' },
      fields: [
        {
          name: 'seloConferencia',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '1000', boundaryBehavior: 'PRESERVE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [],
          preservation: ['*'],
          readBy: ['*'],
        },
      ],
    }],
    canonicalSerializations: [{
      target: 'Gaveta',
      includedFields: ['Gaveta.seloConferencia'],
      fieldEncodings: [{ field: 'Gaveta.seloConferencia', encoding: 'BIGINT_64_BE' }],
      recordOrderingKey: 'Gaveta.seloConferencia ASC',
      emptyStateDigest: '0x0',
    }],
  };

  const result = validateFieldLifecycle({
    stateModel: model,
    architectureContexts: [{ tag: 'integrity-hash' }],
  });
  assert.equal(result.valid, false, 'TEST-107: non-unique order key without tie breaking must fail');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_CANONICAL_SERIALIZATION' && i.slotId.includes('tieBreaking')));
  log('  PASS: TEST-107 Collection canonical serialization with non-identifier simple ordering key blocked');
}

log('[CTDD TEST] Structural Field Lifecycle, Closure Certificate & Gap Ledger tests passed!');



