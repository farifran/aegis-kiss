import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileStateWal, ReorgEngine } from '../index.js';

describe('Blockchain Reorg Engine — WAL direcionado', () => {
  it('recupera o último estado íntegro e ignora uma linha final truncada', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aegis-reorg-wal-'));
    const journalPath = join(directory, 'state.wal');
    try {
      const engine = new ReorgEngine(100, { journalPath });
      engine.subscribe('wal_sub', 'wal_tx', 'wal_user', 2);
      engine.processBlock({ hash: 'wal_0', prevHash: '', height: 0, txids: [], timestampMs: 100n }, 100n);
      engine.processBlock({ hash: 'wal_1', prevHash: 'wal_0', height: 1, txids: ['wal_tx'], timestampMs: 200n }, 200n);
      const expected = engine.snapshot();
      assert.equal(existsSync(journalPath), true);

      appendFileSync(journalPath, '{"version":1,"payload":"torn', 'utf8');
      const recovered = new ReorgEngine(100, { journalPath });
      assert.deepEqual(recovered.snapshot(), expected);
      assert.equal(recovered.verifyInvariants().valid, true);

      const wal = new FileStateWal(journalPath);
      wal.readLatest();
      const lineCountBefore = readFileSync(journalPath, 'utf8').trim().split('\n').length;
      wal.append(expected);
      const lineCountAfter = readFileSync(journalPath, 'utf8').trim().split('\n').length;
      assert.equal(lineCountAfter, lineCountBefore);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('grava uma transição aceita antes de disponibilizá-la no estado vivo', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aegis-reorg-wal-order-'));
    const journalPath = join(directory, 'state.wal');
    try {
      const engine = new ReorgEngine(100, { journalPath });
      assert.throws(() => engine.processBlock({ hash: '', prevHash: '', height: 0, txids: ['hidden_tx'], timestampMs: 100n }, 100n));
      assert.equal(Object.prototype.hasOwnProperty.call(engine.snapshot().txToBlockMap, 'hidden_tx'), false);
      assert.equal(existsSync(journalPath), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

