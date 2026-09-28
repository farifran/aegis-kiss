import assert from 'node:assert/strict';
import process from 'node:process';
import {
  generateClosureCertificate,
  runSemanticMutationTests,
  validateFieldLifecycle,
  validateOperationTotality,
} from '../../lib/semantic_closure.mjs';
import { effectiveDeterminismStatus } from '../../lib/semantic_approval.mjs';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

log('[CTDD TEST] Starting Field Lifecycle & Closure Certificate traps test suite...');

// Base stateful specification fixture
function createFixture({
  isStateful = true,
  stateModel = null,
  dimensions = [{ kind: 'ORDERING', subjectId: 'PUBLIC_CONTRACT', status: 'SPECIFIED' }],
  unknowns = [],
  decisions = [],
} = {}) {
  return {
    architectureContexts: isStateful
      ? [{ tag: 'product-demand' }, { tag: 'stateful-operation' }]
      : [{ tag: 'product-demand' }],
    stateModel,
    unknowns,
    decisions,
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
          initialization: { kind: 'UNRESOLVED', value: null, rationale: 'Não decidido' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest', 'observabilityBitmask'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: ['LOCK', 'BALANCE'] }],
      observables: [{ name: 'observabilityBitmask', derivedFrom: ['Badge.tokens'] }],
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
          initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Começa em zero' },
          mutations: [{ operation: 'evaluateRequest', condition: 'REJECT', effect: 'INCREMENT', targetValue: null }],
          reset: { allowed: true, trigger: null, resetValue: null }, // GATILHO AUSENTE
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'decision', derivedFrom: ['Badge.insufficientStreak'] }],
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
      observables: [{ name: 'decision', derivedFrom: ['Badge.fractionalRemainder'] }],
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
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: [] }], // PRECEDÊNCIA VAZIA
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'] }],
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
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{ name: 'evaluateRequest', guardPrecedence: ['LOCK'] }],
      observables: [{ name: 'bitmask', derivedFrom: ['Badge.ghostField'] }], // CAMPO FANTASMA
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
        { name: 'observabilityBitmask', derivedFrom: ['Badge.tokens', 'Badge.insufficientStreak'] },
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
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'] }],
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

// TEST-10: Guard rejection branch with mutating side effect on balance MUST be blocked
{
  const fixture = createFixture({
    isStateful: true,
    stateModel: {
      entities: [{
        name: 'Badge',
        fields: [{
          name: 'tokens',
          type: 'INTEGER',
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Configurado' },
          mutations: [{ operation: 'evaluateRequest', condition: 'ALLOW', effect: 'DECREMENT', targetValue: null }],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        }],
      }],
      operations: [{
        name: 'evaluateRequest',
        guardPrecedence: ['GLOBAL_LOCK'],
        branches: [
          {
            branchId: 'GUARD_GLOBAL_LOCK',
            outcomeKind: 'REJECTION',
            statusOrError: 'ERR_GLOBAL_LOCK',
            defaultPreservation: false,
            stateEffects: [{ field: 'Badge.tokens', effect: 'DECREMENT', value: '1' }], // EFEITO COLATERAL PROIBIDO EM REJEIÇÃO
          },
          { branchId: 'SUCCESS_AUTHORIZED', outcomeKind: 'RETURN_VALUE', statusOrError: 'AUTHORIZED', defaultPreservation: true },
        ],
      }],
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'] }],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, false, 'TEST-10: guard rejection side effect must be invalid');
  assert.equal(result.issues.some((i) => i.kind === 'GUARD_REJECTION_SIDE_EFFECT'), true);

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'BLOCKED_BY_UNRESOLVED_SLOTS');
  assert.equal(cert.contradictoryRules >= 1, true);
  log('  PASS: TEST-10 Guard rejection side effect is blocked');
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
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens', 'Badge.quarantined'] }],
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
      observables: [{ name: 'decision', derivedFrom: ['Badge.tokens'] }],
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

// TEST-13: Mutation test ZERO vs CAPACITY ambiguity detected
{
  const stateModel = {
    entities: [{
      name: 'Account',
      fields: [{
        name: 'tokens',
        type: 'INTEGER',
        initialization: { kind: 'UNRESOLVED', value: null, rationale: 'Não decidido' },
        mutations: [],
        reset: { allowed: false, trigger: null, resetValue: null },
        preservation: ['*'],
        readBy: ['eval'],
      }],
    }],
    operations: [{ name: 'eval', guardPrecedence: ['GUARD'] }],
    observables: [{ name: 'obs', derivedFrom: ['Account.tokens'] }],
  };

  const mutation = runSemanticMutationTests({ stateModel });
  assert.equal(mutation.passed, false, 'TEST-13: ZERO vs CAPACITY mutation must fail');
  assert.equal(mutation.divergences.some((d) => d.mutationId === 'MUTATION_ZERO_VS_CAPACITY'), true);
  log('  PASS: TEST-13 Mutation test ZERO vs CAPACITY ambiguity detected');
}

// TEST-14: Mutation test TRAILING vs MAXIMUM streak ambiguity detected
{
  const stateModel = {
    entities: [{
      name: 'Account',
      fields: [{
        name: 'rejectStreak',
        type: 'INTEGER',
        isCounter: true,
        initialization: { kind: 'EXPLICIT_VALUE', value: '0', rationale: 'Zero inicial' },
        mutations: [],
        reset: { allowed: false, trigger: null, resetValue: null }, // Allowed: false para streak!
        preservation: ['*'],
        readBy: ['eval'],
      }],
    }],
    operations: [{ name: 'eval', guardPrecedence: ['GUARD'] }],
    observables: [{ name: 'obs', derivedFrom: ['Account.rejectStreak'] }],
  };

  const mutation = runSemanticMutationTests({ stateModel });
  assert.equal(mutation.passed, false, 'TEST-14: TRAILING vs MAXIMUM mutation must fail');
  assert.equal(mutation.divergences.some((d) => d.mutationId === 'MUTATION_TRAILING_VS_MAXIMUM'), true);
  log('  PASS: TEST-14 Mutation test TRAILING vs MAXIMUM streak ambiguity detected');
}

// TEST-15: Mutation test FREEZE vs ACCRUE temporal ambiguity detected
{
  const stateModel = {
    entities: [{
      name: 'Badge',
      fields: [
        {
          name: 'tokens',
          type: 'INTEGER',
          initialization: { kind: 'EXPLICIT_VALUE', value: '100', rationale: 'Cheio' },
          mutations: [],
          reset: { allowed: false, trigger: null, resetValue: null },
          preservation: ['*'],
          readBy: ['evaluateRequest'],
        },
      ],
    }],
    operations: [{
      name: 'evaluateRequest',
      guardPrecedence: ['QUARANTINE', 'REFILL'],
      branches: [
        {
          branchId: 'GUARD_QUARANTINE',
          outcomeKind: 'REJECTION',
          statusOrError: 'ERR_QUARANTINED',
          defaultPreservation: false,
          stateEffects: [{ field: 'Badge.tokens', effect: 'INCREMENT', value: '10' }], // MUTA REFILL EM QUARENTENA!
        },
        { branchId: 'SUCCESS_AUTHORIZED', outcomeKind: 'RETURN_VALUE', statusOrError: 'AUTHORIZED', defaultPreservation: true },
      ],
    }],
    observables: [{ name: 'obs', derivedFrom: ['Badge.tokens'] }],
  };

  const mutation = runSemanticMutationTests({ stateModel });
  assert.equal(mutation.passed, false, 'TEST-15: FREEZE vs ACCRUE mutation must fail');
  assert.equal(mutation.divergences.some((d) => d.mutationId === 'MUTATION_FREEZE_VS_ACCRUE'), true);
  log('  PASS: TEST-15 Mutation test FREEZE vs ACCRUE temporal ambiguity detected');
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
          guardPrecedence: ['GLOBAL_LOCK', 'INSUFFICIENT_FUNDS'],
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
        { name: 'observabilityBitmask', derivedFrom: ['Badge.tokens', 'Badge.insufficientStreak'] },
      ],
    },
  });

  const result = validateFieldLifecycle({
    stateModel: fixture.stateModel,
    architectureContexts: fixture.architectureContexts,
  });
  assert.equal(result.valid, true, 'TEST-16: complete state model with branches must be valid');
  assert.equal(result.issues.length, 0);

  const mutation = runSemanticMutationTests({
    stateModel: fixture.stateModel,
    specification: fixture,
  });
  assert.equal(mutation.passed, true, 'TEST-16: mutation tests must pass with zero divergence');

  const cert = generateClosureCertificate({ specification: fixture });
  assert.equal(cert.status, 'CERTIFIED_CLOSED');
  assert.equal(cert.unresolvedStateFields, 0);
  assert.equal(cert.unresolvedTransitions, 0);
  assert.equal(cert.contradictoryRules, 0);

  const status = effectiveDeterminismStatus(fixture, []);
  assert.equal(status, 'SEMANTICALLY_CLOSED');
  log('  PASS: TEST-16 Fully closed state model with branches certifies SEMANTICALLY_CLOSED');
}

log('[CTDD TEST] All 16 Field Lifecycle & Closure Certificate traps passed successfully!');
