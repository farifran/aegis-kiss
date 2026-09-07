/**
 * Tribunal de Provas Físicas e Auditoria Adversarial do Barramento (Aegis Proofs).
 * Valida rigorosamente as 5 obrigações de prova contratuais registradas em semantic-state.json.
 */
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  OrderBus,
  type Transaction,
  BIT_GLOBAL_LOCK,
  BIT_ISOLATED_ACCOUNTS,
  BIT_VOLUME_ALERT,
  isBitSet,
} from './index.js';

// ============================================================================
// 1. PO-ORDER-BUS-CONSERVATION: Conservação de saldo e integridade de dupla entrada
// ============================================================================
{
  const bus = new OrderBus('treasury', 0n);
  bus.registerAccount('alice', 100_000n);
  bus.registerAccount('bob', 50_000n);
  bus.registerAccount('charlie', 20_000n);

  const initialTotal = bus.getTotalBalance();
  assert.equal(initialTotal, 170_000n);

  const orders: Transaction[] = [
    { id: 'tx-1', sender: 'alice', recipient: 'bob', amount: 10_000n },
    { id: 'tx-2', sender: 'bob', recipient: 'charlie', amount: 5_000n },
  ];

  const result = bus.processBatch(orders, 1_000n);
  assert.equal(result.settledCount, 2);
  assert.equal(result.discardedCount, 0);
  assert.equal(result.rejectedCount, 0);

  // Invariante de conservação estrita
  assert.equal(bus.getTotalBalance(), initialTotal);

  const alice = bus.getAccount('alice');
  const bob = bus.getAccount('bob');
  const charlie = bus.getAccount('charlie');
  const treasury = bus.getAccount('treasury');

  assert(alice !== undefined && bob !== undefined && charlie !== undefined && treasury !== undefined);
  assert(alice.balance >= 0n);
  assert(bob.balance >= 0n);
  assert(charlie.balance >= 0n);
  assert(treasury.balance >= 0n);

  // Tentativa com saldo insuficiente (insolvente)
  const insolventOrder: Transaction[] = [
    { id: 'tx-fail', sender: 'charlie', recipient: 'alice', amount: 1_000_000n },
  ];
  const insolventResult = bus.processBatch(insolventOrder, 2_000n);
  assert.equal(insolventResult.rejectedCount, 1);
  assert.equal(insolventResult.decisions[0]?.status, 'rejected_insolvent');

  // Saldo permanece estritamente conservado
  assert.equal(bus.getTotalBalance(), initialTotal);
}

// ============================================================================
// 2. PO-ORDER-BUS-ISOLATION: Detecção de anomalia, isolamento e descarte sumário
// ============================================================================
{
  const bus = new OrderBus('treasury', 0n);
  bus.registerAccount('attacker', 100n);
  bus.registerAccount('innocent', 50_000n);
  bus.registerAccount('victim', 50_000n);

  // 1ª e 2ª falhas consecutivas
  bus.processBatch([{ id: 'bad-1', sender: 'attacker', recipient: 'victim', amount: 500n }], 1_000n);
  bus.processBatch([{ id: 'bad-2', sender: 'attacker', recipient: 'victim', amount: 500n }], 2_000n);
  const attackerAccBefore = bus.getAccount('attacker');
  assert(attackerAccBefore !== undefined);
  assert.equal(attackerAccBefore.consecutiveFailures, 2);
  assert.equal(attackerAccBefore.isolatedUntil, 0n);

  // 3ª falha consecutiva dispara isolamento temporário (+30.000 ms = até 33.000 ms)
  bus.processBatch([{ id: 'bad-3', sender: 'attacker', recipient: 'victim', amount: 500n }], 3_000n);
  const attackerAccAfter = bus.getAccount('attacker');
  assert(attackerAccAfter !== undefined);
  assert.equal(attackerAccAfter.consecutiveFailures, 3);
  assert.equal(attackerAccAfter.isolatedUntil, 33_000n);

  // Lote contendo ordem da conta isolada e ordem de conta saudável
  const mixedBatch: Transaction[] = [
    { id: 'bad-4', sender: 'attacker', recipient: 'victim', amount: 10n },
    { id: 'good-1', sender: 'innocent', recipient: 'victim', amount: 1_000n },
  ];

  const mixedResult = bus.processBatch(mixedBatch, 5_000n);
  // Ordem de atacante isolado é descartada sumariamente
  assert.equal(mixedResult.discardedCount, 1);
  assert.equal(mixedResult.decisions[0]?.status, 'discarded_isolated');

  // Ordem da conta saudável é liquidada sem interrupção do lote
  assert.equal(mixedResult.settledCount, 1);
  assert.equal(mixedResult.decisions[1]?.status, 'settled');

  // Bitmask indica conta isolada presente
  assert.equal(isBitSet(mixedResult.healthBitmask, BIT_ISOLATED_ACCOUNTS), true);

  // Após expirar o isolamento (> 33.000 ms), a conta pode voltar a transacionar
  const recoveredResult = bus.processBatch(
    [{ id: 'rec-1', sender: 'attacker', recipient: 'victim', amount: 10n }],
    35_000n,
  );
  assert.equal(recoveredResult.settledCount, 1);
  assert.equal(recoveredResult.decisions[0]?.status, 'settled');

  // Teste de disparo por burst rate limit (> 10 ordens na janela de 10s)
  bus.registerAccount('spammer', 100_000n);
  const burstOrders: Transaction[] = [];
  for (let i = 0; i < 12; i++) {
    burstOrders.push({ id: `burst-${i}`, sender: 'spammer', recipient: 'victim', amount: 10n });
  }
  const burstResult = bus.processBatch(burstOrders, 40_000n);
  // Primeiras 10 ordens passam, as subsequentes acionam isolamento por burst
  assert(burstResult.discardedCount >= 1);
  const spammerAcc = bus.getAccount('spammer');
  assert(spammerAcc !== undefined && spammerAcc.isolatedUntil > 40_000n);
}

// ============================================================================
// 3. PO-ORDER-BUS-ATOMICITY: Atomicidade de dupla entrada e ausência de resíduos
// ============================================================================
{
  const bus = new OrderBus('treasury', 0n);
  bus.registerAccount('sender_fail', 100n);
  bus.registerAccount('dest_safe', 500n);

  const totalBefore = bus.getTotalBalance();

  // Ordem com montante maior que o saldo do remetente
  const result = bus.processBatch(
    [{ id: 'tx-fail-atomic', sender: 'sender_fail', recipient: 'dest_safe', amount: 200n }],
    1_000n,
  );

  assert.equal(result.settledCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.decisions[0]?.status, 'rejected_insolvent');

  // O destinatário NÃO recebe nada parcialmente
  const dest = bus.getAccount('dest_safe');
  const sender = bus.getAccount('sender_fail');
  const treasury = bus.getAccount('treasury');

  assert(dest !== undefined && sender !== undefined && treasury !== undefined);
  assert.equal(dest.balance, 500n);
  assert.equal(sender.balance, 100n);
  assert.equal(treasury.balance, 0n);
  assert.equal(bus.getTotalBalance(), totalBefore);

  // Ordem inválida (remetente desconhecido ou destino desconhecido)
  const invalidResult = bus.processBatch(
    [{ id: 'tx-invalid', sender: 'unknown_sender', recipient: 'dest_safe', amount: 50n }],
    2_000n,
  );
  assert.equal(invalidResult.rejectedCount, 1);
  assert.equal(invalidResult.decisions[0]?.status, 'rejected_invalid');
  assert.equal(bus.getTotalBalance(), totalBefore);
}

// ============================================================================
// 4. PO-ORDER-BUS-DYNAMIC-FEES: Escalonamento de taxas por volume na janela
// ============================================================================
{
  const bus = new OrderBus('treasury', 0n);
  bus.registerAccount('whale', 50_000_000n);
  bus.registerAccount('market', 10_000_000n);

  // Volume inicial = 0 (<= 1.000.000n): taxa é 10 bps (0,10%)
  // Para 200.000n -> taxa = 200.000 * 10 / 10000 = 200n
  const batch1 = bus.processBatch(
    [{ id: 'tx-vol-1', sender: 'whale', recipient: 'market', amount: 200_000n }],
    1_000n,
  );
  assert.equal(batch1.settledCount, 1);
  assert.equal(batch1.decisions[0]?.fee, 200n);

  // Nova ordem de 900.000n -> eleva o volume acumulado da janela para 1.100.000n (> 1.000.000n)
  bus.processBatch(
    [{ id: 'tx-vol-2', sender: 'whale', recipient: 'market', amount: 900_000n }],
    2_000n,
  );

  // Agora volume da janela recente > 1.000.000n -> taxa escalonada para 25 bps (0,25%)
  // Para 100.000n -> taxa = 100.000 * 25 / 10000 = 250n
  const batch3 = bus.processBatch(
    [{ id: 'tx-vol-3', sender: 'whale', recipient: 'market', amount: 100_000n }],
    3_000n,
  );
  assert.equal(batch3.settledCount, 1);
  assert.equal(batch3.decisions[0]?.fee, 250n);
  assert.equal(isBitSet(batch3.healthBitmask, BIT_VOLUME_ALERT), true);

  // Avanço do tempo além da janela recente de 60 segundos (> 63.000n)
  // O volume antigo expira e o volume da janela cai para 0 <= 1.000.000n
  const batch4 = bus.processBatch(
    [{ id: 'tx-vol-4', sender: 'whale', recipient: 'market', amount: 100_000n }],
    65_000n,
  );
  // Taxa volta a ser 10 bps (0,10%): 100n
  assert.equal(batch4.settledCount, 1);
  assert.equal(batch4.decisions[0]?.fee, 100n);
  assert.equal(isBitSet(batch4.healthBitmask, BIT_VOLUME_ALERT), false);
}

// ============================================================================
// 5. PO-ORDER-BUS-DETERMINISM-HEALTH: Determinismo e sumário compacto de saúde
// ============================================================================
{
  // Teste de reprodução determinística em instâncias independentes
  const createTwinInstance = () => {
    const b = new OrderBus('treasury', 100n);
    b.registerAccount('user_a', 10_000n);
    b.registerAccount('user_b', 10_000n);
    return b;
  };

  const bus1 = createTwinInstance();
  const bus2 = createTwinInstance();

  const testOrders: Transaction[] = [
    { id: 'det-1', sender: 'user_a', recipient: 'user_b', amount: 2_500n },
    { id: 'det-2', sender: 'user_b', recipient: 'user_a', amount: 1_200n },
  ];

  const res1 = bus1.processBatch(testOrders, 10_000n);
  const res2 = bus2.processBatch(testOrders, 10_000n);

  assert.equal(res1.executionDigest, res2.executionDigest);
  assert.equal(res1.healthBitmask, res2.healthBitmask);
  assert.equal(res1.totalVolume, res2.totalVolume);
  assert.equal(res1.totalFees, res2.totalFees);

  // Teste de trava global (Emergency Lock)
  bus1.setGlobalLock(true);
  assert.equal(bus1.isGlobalLockActive(), true);
  const lockedRes = bus1.processBatch(
    [{ id: 'det-lock', sender: 'user_a', recipient: 'user_b', amount: 100n }],
    11_000n,
  );
  assert.equal(lockedRes.rejectedCount, 1);
  assert.equal(lockedRes.decisions[0]?.status, 'blocked_global_lock');
  assert.equal(isBitSet(lockedRes.healthBitmask, BIT_GLOBAL_LOCK), true);

  // Teste de regressão temporal (ARCH-DETERMINISTIC-TIME)
  assert.throws(() => {
    bus1.processBatch([{ id: 'time-regress', sender: 'user_a', recipient: 'user_b', amount: 10n }], 5_000n);
  }, RangeError);
}

process.stdout.write('[AEGIS][PROOF] 5/5 physical proof obligations passed successfully.\n');
