import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BlockTree, ReorgEngine, type BlockHeader } from '../index.js';

function block(hash: string, prevHash: string, height: number, txids: readonly string[] = []): BlockHeader {
  return { hash, prevHash, height, txids, timestampMs: BigInt(height + 1) };
}

describe('Blockchain Reorg Engine — resiliência operacional', () => {
  it('não altera o estado vivo quando uma transição falha na projeção', () => {
    const engine = new ReorgEngine();
    engine.subscribe('s1', 'tx1', 'u1', 2);
    engine.processBlock(block('g', '', 0), 1n);
    const before = engine.snapshot();

    assert.throws(() => engine.processBlock({ ...block('', 'g', 1), txids: ['tx1'] }, 2n), /invalid block input/);
    assert.deepEqual(engine.snapshot(), before);
    assert.equal(engine.verifyInvariants().valid, true);
  });

  it('expõe a cobertura total da entrada ao aplicar capacidade e rejeição', () => {
    const engine = new ReorgEngine(100, { maxPendingBlocks: 2 });
    const result = engine.processBatch([
      block('g', '', 0),
      block('b1', 'g', 1),
      block('b2', 'b1', 2)
    ], 10n);

    assert.equal(result.processedCount, 3);
    assert.equal(result.committedCount, 2);
    assert.equal(result.rejectedCount, 0);
    assert.equal(result.blockedCapacityCount, 1);
    assert.equal(result.abortedCount, 0);
    assert.equal(result.committedCount + result.rejectedCount + result.blockedCapacityCount + result.abortedCount, result.processedCount);

    const invalid = engine.processBatch([{ ...block('bad', 'g', 1), txids: [''] }], 11n);
    assert.equal(invalid.committedCount, 0);
    assert.equal(invalid.rejectedCount, 1);
    assert.equal(invalid.committedCount + invalid.rejectedCount + invalid.blockedCapacityCount + invalid.abortedCount, invalid.processedCount);
  });

  it('mantém uma fila limitada e classifica entradas bloqueadas', () => {
    const engine = new ReorgEngine(100, { maxPendingBlocks: 2 });
    const admission = engine.enqueueBlocks([
      block('g', '', 0),
      block('b1', 'g', 1),
      block('b2', 'b1', 2),
      { ...block('invalid', '', 0), txids: [''] }
    ], 20n);

    assert.deepEqual(admission, {
      acceptedCount: 2,
      rejectedInvalidCount: 1,
      blockedCapacityCount: 1,
      pendingCount: 2
    });
    const drained = engine.drainPending();
    assert.equal(drained.committedCount, 2);
    assert.equal(drained.blockedCapacityCount, 0);
    assert.equal(engine.pendingCount, 0);
  });

  it('reconstrói o estado a partir do WAL e não reenvia alertas', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aegis-wal-'));
    const journalPath = join(directory, 'engine.wal');
    try {
      const engine = new ReorgEngine(100, { journalPath });
      engine.subscribe('s1', 'tx1', 'u1', 2);
      engine.processBlock(block('g', '', 0), 1n);
      engine.processBlock(block('b1', 'g', 1, ['tx1']), 2n);

      const recovered = new ReorgEngine(100, { journalPath });
      assert.deepEqual(recovered.snapshot(), engine.snapshot());
      const confirmation = recovered.processBlock(block('b2', 'b1', 2), 3n);
      assert.equal(confirmation.alerts.length, 1);
      assert.equal(confirmation.alerts[0]?.type, 'CONFIRMED');

      const restarted = new ReorgEngine(100, { journalPath });
      const duplicate = restarted.processBlock(block('b3', 'b2', 3), 4n);
      assert.equal(duplicate.alerts.length, 0);
      assert.equal(restarted.verifyInvariants().valid, true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('limita a quantidade de órfãos retidos com ordem determinística', () => {
    const tree = new BlockTree(2);
    tree.addBlock(block('g', '', 0));
    tree.addBlock(block('a1', 'g', 1));
    tree.addBlock(block('b1', 'g', 1));
    tree.addBlock(block('c1', 'g', 1));
    tree.addBlock(block('d1', 'g', 1));
    assert.equal(tree.orphanCount <= 2, true);
    assert.equal(tree.getCanonicalChain().at(-1)?.hash, 'a1');
  });

  it('processa um lote de estresse sem crescimento de decisões ou quebra de invariantes', () => {
    const engine = new ReorgEngine(100, { maxPendingBlocks: 5000 });
    const blocks: BlockHeader[] = [];
    for (let height = 0; height < 5000; height++) {
      blocks.push(block(`stress_${height}`, height === 0 ? '' : `stress_${height - 1}`, height));
    }
    const result = engine.processBatch(blocks, 5000n);
    assert.equal(result.processedCount, 5000);
    assert.equal(result.committedCount, 5000);
    assert.equal(result.committedCount + result.rejectedCount + result.blockedCapacityCount + result.abortedCount, result.processedCount);
    assert.equal(engine.tipHeight, 4999);
    assert.equal(engine.verifyInvariants().valid, true);
  });
});
