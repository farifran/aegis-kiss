import assert from 'node:assert/strict';
import process from 'node:process';
import {
  generateClosureCertificate,
  validateFieldLifecycle,
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

log('[CTDD TEST] All 8 Field Lifecycle & Closure Certificate traps passed successfully!');
