import assert from 'node:assert/strict';
import process from 'node:process';
import { BatchEngine, executeBatch, type Entity, type Operation } from './index.js';

// ============================================================================
// 1. PO-BATCH-ENGINE-CONSERVATION: Conservação de valor e saldos não-negativos
// ============================================================================
{
  const engine = new BatchEngine();
  engine.registerEntity({
    id: 'alice',
    balance: 10_000n,
    capacity: 500n,
    maxCapacity: 1_000n,
    refillRatePerMs: 1n,
    lastTimestamp: 1_000n,
  });
  engine.registerEntity({
    id: 'bob',
    balance: 5_000n,
    capacity: 500n,
    maxCapacity: 1_000n,
    refillRatePerMs: 1n,
    lastTimestamp: 1_000n,
  });
  engine.registerEntity({
    id: 'charlie',
    balance: 2_000n,
    capacity: 500n,
    maxCapacity: 1_000n,
    refillRatePerMs: 1n,
    lastTimestamp: 1_000n,
  });

  const sumBefore = 17_000n;

  const ops: Operation[] = [
    { id: 'op1', source: 'alice', target: 'bob', amount: 3_000n, cost: 50n },
    { id: 'op2', source: 'bob', target: 'charlie', amount: 2_000n, cost: 30n },
    { id: 'op3', source: 'charlie', target: 'alice', amount: 500n, cost: 10n },
  ];

  const result = executeBatch(engine, ops, 1_000n);
  assert.equal(result.rolledBack, false);
  assert.equal(result.acceptedCount, 3);
  assert.equal(result.totalCost, 90n);
  assert.equal(result.totalVolume, 5_500n);

  const entities = engine.getAllEntities();
  let sumAfter = 0n;
  for (const e of entities) {
    assert.ok(e.balance >= 0n, `entity ${e.id} balance must be non-negative`);
    sumAfter += e.balance;
  }
  assert.equal(sumAfter + result.totalCost, sumBefore, 'financial value conservation invariant holds');
}

// ============================================================================
// 2. PO-BATCH-ENGINE-CAPACITY: Controle temporal e limites de capacidade
// ============================================================================
{
  const engine = new BatchEngine();
  engine.registerEntity({
    id: 'dana',
    balance: 10_000n,
    capacity: 100n,
    maxCapacity: 300n,
    refillRatePerMs: 2n,
    lastTimestamp: 1_000n,
  });
  engine.registerEntity({
    id: 'sink',
    balance: 1_000n,
    capacity: 500n,
    maxCapacity: 500n,
    refillRatePerMs: 0n,
    lastTimestamp: 1_000n,
  });

  // Avanço de 50ms: capacidade recomposta = 100n + (50 * 2n) = 200n
  const ops1: Operation[] = [
    { id: 'op-cap-1', source: 'dana', target: 'sink', amount: 100n, cost: 150n },
  ];
  const res1 = executeBatch(engine, ops1, 1_050n);
  assert.equal(res1.acceptedCount, 1);
  const danaAfter1 = engine.getEntity('dana');
  assert.ok(danaAfter1);
  assert.equal(danaAfter1.capacity, 50n); // 200n - 150n

  // Avanço extremo no tempo (1_000_000ms): capacidade deve ficar limitada ao maxCapacity (300n)
  const ops2: Operation[] = [
    { id: 'op-cap-overflow', source: 'dana', target: 'sink', amount: 100n, cost: 400n },
  ];
  const res2 = executeBatch(engine, ops2, 1_000_000n);
  assert.ok(res2.decisions[0]);
  assert.equal(res2.decisions[0].status, 'blocked_capacity');

  const danaAfter2 = engine.getEntity('dana');
  assert.ok(danaAfter2);
  assert.equal(danaAfter2.capacity, 300n, 'capacity capped at maxCapacity');
}

// ============================================================================
// 3. PO-BATCH-ENGINE-ATOMICITY: Reversão atômica sem resíduos em caso de falha
// ============================================================================
{
  const engine = new BatchEngine();
  const initialEntity: Entity = {
    id: 'eve',
    balance: 5_000n,
    capacity: 200n,
    maxCapacity: 500n,
    refillRatePerMs: 1n,
    lastTimestamp: 2_000n,
  };
  engine.registerEntity(initialEntity);
  engine.registerEntity({
    id: 'peer',
    balance: 1_000n,
    capacity: 200n,
    maxCapacity: 500n,
    refillRatePerMs: 1n,
    lastTimestamp: 2_000n,
  });

  // Operação válida seguida por regressão temporal (1_900n < 2_000n)
  const ops: Operation[] = [
    { id: 'op-valid', source: 'eve', target: 'peer', amount: 1_000n, cost: 50n },
  ];

  const regressiveTime = 1_900n;
  const result = executeBatch(engine, ops, regressiveTime);
  assert.equal(result.rolledBack, true);
  assert.equal(result.acceptedCount, 0);
  const d0 = result.decisions[0];
  assert.ok(d0);
  assert.equal(d0.status, 'aborted');

  // O estado deve coincidir estritamente com S0
  const eveAfter = engine.getEntity('eve');
  assert.ok(eveAfter);
  assert.equal(eveAfter.balance, initialEntity.balance);
  assert.equal(eveAfter.capacity, initialEntity.capacity);
  assert.equal(eveAfter.lastTimestamp, initialEntity.lastTimestamp);
}

// ============================================================================
// 4. PO-BATCH-ENGINE-COMPOSITION: Composição acumulada de recursos e bijetividade
// ============================================================================
{
  const engine = new BatchEngine();
  engine.registerEntity({
    id: 'frank',
    balance: 100n,
    capacity: 50n,
    maxCapacity: 50n,
    refillRatePerMs: 0n,
    lastTimestamp: 1_000n,
  });
  engine.registerEntity({
    id: 'recipient',
    balance: 0n,
    capacity: 50n,
    maxCapacity: 50n,
    refillRatePerMs: 0n,
    lastTimestamp: 1_000n,
  });

  // Duas operações individualmente viáveis contra saldo 100n, mas cuja soma excede
  const ops: Operation[] = [
    { id: 'c1', source: 'frank', target: 'recipient', amount: 70n, cost: 10n }, // precisa de 80n -> resta 20n
    { id: 'c2', source: 'frank', target: 'recipient', amount: 30n, cost: 10n }, // precisa de 40n -> insuficiente
    { id: 'c3', source: 'frank', target: 'nonexistent', amount: 5n, cost: 0n }, // entidade inexistente
  ];

  const result = executeBatch(engine, ops, 1_000n);
  assert.equal(result.decisions.length, ops.length, 'bijetividade total de decisões');
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.rejectedCount, 1);

  const d0 = result.decisions[0];
  const d1 = result.decisions[1];
  const d2 = result.decisions[2];
  assert.ok(d0 && d1 && d2);

  assert.equal(d0.status, 'committed');
  assert.equal(d1.status, 'blocked_insolvent');
  assert.equal(d2.status, 'rejected_invalid');

  const frank = engine.getEntity('frank');
  assert.ok(frank);
  assert.equal(frank.balance, 20n);
  assert.equal(frank.capacity, 40n);

  const recipient = engine.getEntity('recipient');
  assert.ok(recipient);
  assert.equal(recipient.balance, 70n);
}

// ============================================================================
// 5. PO-BATCH-ENGINE-DETERMINISM: Determinismo de execução e digest
// ============================================================================
{
  const createTestEngine = () => {
    const eng = new BatchEngine();
    eng.registerEntity({
      id: 'e1',
      balance: 10_000n,
      capacity: 500n,
      maxCapacity: 1_000n,
      refillRatePerMs: 2n,
      lastTimestamp: 1_000n,
    });
    eng.registerEntity({
      id: 'e2',
      balance: 5_000n,
      capacity: 500n,
      maxCapacity: 1_000n,
      refillRatePerMs: 2n,
      lastTimestamp: 1_000n,
    });
    return eng;
  };

  const ops: Operation[] = [
    { id: 'det1', source: 'e1', target: 'e2', amount: 200n, cost: 20n },
    { id: 'det2', source: 'e2', target: 'e1', amount: 100n, cost: 10n },
  ];

  const timestamp = 1_500n;

  const engA = createTestEngine();
  const resA = executeBatch(engA, ops, timestamp);

  const engB = createTestEngine();
  const resB = executeBatch(engB, ops, timestamp);

  assert.equal(resA.executionDigest, resB.executionDigest, 'mesmo estado e entradas geram digests idênticos');
  assert.deepEqual(engA.getAllEntities(), engB.getAllEntities(), 'estados finais são estritamente idênticos');
}

process.stdout.write('[AEGIS][PROOF][PASS] BatchEngine obligations verified.\n');
