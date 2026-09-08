import assert from 'node:assert/strict';
import process from 'node:process';
import {
  BIT_GLOBAL_LOCK,
  BIT_ISOLATED_ACCOUNTS,
  BIT_VOLUME_ALERT,
  OrderBus,
  isBitSet,
  type Transaction,
} from './index.js';

function makeBus(): OrderBus {
  const bus = new OrderBus('treasury', 0n);
  bus.registerAccount('alice', 2_000_000n);
  bus.registerAccount('bob', 0n);
  return bus;
}

// PO-ORDER-BUS-CONSERVATION: conservação, não negatividade e isolamento de estado interno.
{
  const bus = makeBus();
  const initial = bus.getTotalBalance();
  const result = bus.processBatch([
    { id: 'a', sender: 'alice', recipient: 'bob', amount: 10_000n },
    { id: 'b', sender: 'bob', recipient: 'alice', amount: 2_000n },
  ], 1n);

  assert.equal(result.settledCount, 2);
  assert.equal(result.rejectedCount, 0);
  assert.equal(bus.getTotalBalance(), initial);
  assert.throws(() => {
    const account = bus.getAccount('alice');
    if (account === undefined) throw new Error('missing account');
    (account as { balance: bigint }).balance = -1n;
  }, TypeError);
  assert.equal(bus.getAccount('alice')?.balance! >= 0n, true);
  assert.throws(() => {
    const accounts = bus.getAllAccounts() as Record<string, unknown>;
    Object.defineProperty(accounts, 'injected', { value: 'forbidden' });
  }, TypeError);
}

// PO-ORDER-BUS-ISOLATION: o instante 0 é válido e não reinicia artificialmente a janela.
{
  const bus = makeBus();
  const orders: Transaction[] = [];
  for (let index = 0; index < 12; index += 1) {
    orders.push({ id: `zero-${index}`, sender: 'alice', recipient: 'bob', amount: 1n });
  }
  const result = bus.processBatch(orders, 0n);
  assert.equal(result.settledCount, 10);
  assert.equal(result.discardedCount, 2);
  assert.equal(isBitSet(result.healthBitmask, BIT_ISOLATED_ACCOUNTS), true);
}

// PO-ORDER-BUS-ATOMICITY: uma rejeição não deixa crédito parcial; a ordem seguinte continua íntegra.
{
  const bus = makeBus();
  const total = bus.getTotalBalance();
  const result = bus.processBatch([
    { id: 'bad', sender: 'bob', recipient: 'alice', amount: 1n },
    { id: 'good', sender: 'alice', recipient: 'bob', amount: 10n },
  ], 1n);
  assert.deepEqual(result.decisions.map((decision) => decision.status), ['rejected_insolvent', 'settled']);
  assert.equal(bus.getAccount('bob')?.balance, 10n);
  assert.equal(bus.getTotalBalance(), total);
}

// PO-ORDER-BUS-DYNAMIC-FEES: escalonamento e consulta de saúde não mutam o estado.
{
  const bus = makeBus();
  const first = bus.processBatch([{ id: 'v1', sender: 'alice', recipient: 'bob', amount: 1_000_001n }], 1n);
  assert.equal(first.decisions[0]?.fee, 1_000n);
  const health = bus.getHealthBitmask(2n);
  assert.equal(isBitSet(health, BIT_VOLUME_ALERT), true);
  const second = bus.processBatch([{ id: 'v2', sender: 'alice', recipient: 'bob', amount: 100_000n }], 2n);
  assert.equal(second.decisions[0]?.fee, 250n);
  bus.setGlobalLock(true);
  assert.equal(isBitSet(bus.getHealthBitmask(2n), BIT_GLOBAL_LOCK), true);
  assert.equal(bus.processBatch([{ id: 'v3', sender: 'alice', recipient: 'bob', amount: 1n }], 3n).settledCount, 1);
}

// PO-ORDER-BUS-DETERMINISM-HEALTH: digest é identidade da transição, não só do saldo final.
{
  const digestFor = (now: bigint, order: Transaction): string => {
    const bus = makeBus();
    return bus.processBatch([order], now).executionDigest;
  };
  const selfTransfer = { id: 'same', sender: 'alice', recipient: 'alice', amount: 1n };
  const missingSender = { id: 'same', sender: 'missing', recipient: 'bob', amount: 1n };
  assert.notEqual(digestFor(1n, selfTransfer), digestFor(2n, selfTransfer));
  assert.notEqual(digestFor(1n, selfTransfer), digestFor(1n, missingSender));

  const one = makeBus();
  const two = makeBus();
  const order = [{ id: 'replay', sender: 'alice', recipient: 'bob', amount: 10n }];
  assert.equal(one.processBatch(order, 3n).executionDigest, two.processBatch(order, 3n).executionDigest);
  assert.throws(() => one.processBatch(order, 2n), RangeError);
}

process.stdout.write('[AEGIS][PROOF] OrderBus forensic obligations: PASS\n');
