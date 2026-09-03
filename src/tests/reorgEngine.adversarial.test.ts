import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReorgEngine } from '../index.js';

describe('Blockchain Reorg Engine — provas adversariais', () => {
  it('não indexa uma transação de bloco rejeitado', () => {
    const engine = new ReorgEngine();
    const before = engine.snapshot();
    const result = engine.processBatch([{ hash: '', prevHash: '', height: 0, txids: ['tx_invalid'], timestampMs: 100n }], 100n);
    assert.equal(result.rejectedCount, 1);
    assert.deepEqual(engine.snapshot(), before);
    assert.equal(engine.verifyInvariants().valid, true);
  });

  it('não permite aliasing da lista de transações de entrada', () => {
    const engine = new ReorgEngine();
    const txids = ['tx_original'];
    engine.processBlock({ hash: 'alias_0', prevHash: '', height: 0, txids, timestampMs: 100n }, 100n);
    txids[0] = 'tx_mutated';
    const stored = Object.values(engine.snapshot().treeSnapshot.blocks).find((block) => block.hash === 'alias_0');
    assert.deepEqual(stored?.txids, ['tx_original']);
    assert.equal(engine.verifyInvariants().valid, true);
  });

  it('cobre a capacidade sem perder entradas silenciosamente', () => {
    const engine = new ReorgEngine(100, { maxPendingBlocks: 2 });
    const admission = engine.enqueueBlocks([
      { hash: 'queue_a', prevHash: '', height: 0, txids: [], timestampMs: 100n },
      { hash: 'queue_b', prevHash: '', height: 0, txids: [], timestampMs: 100n },
      { hash: 'queue_c', prevHash: '', height: 0, txids: [], timestampMs: 100n },
      { hash: 'queue_d', prevHash: '', height: 0, txids: [], timestampMs: 100n }
    ], 100n);
    assert.deepEqual(admission, { acceptedCount: 2, rejectedInvalidCount: 0, blockedCapacityCount: 2, pendingCount: 2 });
    const drained = engine.drainPending();
    assert.equal(drained.committedCount, 2);
    assert.equal(drained.rejectedCount + drained.blockedCapacityCount + drained.abortedCount + drained.committedCount, drained.processedCount);
    assert.equal(engine.pendingCount, 0);
    assert.equal(engine.verifyInvariants().valid, true);
  });

  it('não limita o limiar de confirmação aos dez blocos mais recentes', () => {
    const engine = new ReorgEngine();
    engine.subscribe('deep_sub', 'deep_tx', 'deep_user', 12);
    engine.processBlock({ hash: 'deep_0', prevHash: '', height: 0, txids: ['deep_tx'], timestampMs: 100n }, 100n);
    for (let height = 1; height <= 11; height++) {
      engine.processBlock({ hash: `deep_${height}`, prevHash: `deep_${height - 1}`, height, txids: [], timestampMs: BigInt(100 + height) }, BigInt(100 + height));
    }
    const subscription = engine.getSubscription('deep_sub');
    assert.equal(subscription?.isAlerted, true);
    assert.equal(engine.totalAlertsEmitted, 1n);
    assert.equal(engine.verifyInvariants().valid, true);
  });
});
