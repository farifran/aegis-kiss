// src/tests/reorgEngine.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReorgEngine } from '../index.js';

describe('Blockchain Reorg Engine — Tríade Canônica', () => {
  // PILAR 1: Contrato da API Pública (Threshold & Alerta Progressivo)
  it('Pilar 1 [Contrato]: deve emitir CONFIRMED exatamente quando a transação atingir o limiar configurado', () => {
    const engine = new ReorgEngine();
    engine.subscribe('sub_alpha', 'tx_100', 'user_alice', 3);

    // Bloco 1 com a transação (1 confirmação: tip 1 - 1 + 1 = 1)
    const b1 = engine.processBlock({ hash: 'blk_1', prevHash: '', height: 1, txids: ['tx_100'], timestampMs: 1000n }, 1000n);
    assert.equal(b1.alerts.length, 0);
    assert.equal(engine.getSubscription('sub_alpha')?.isAlerted, false);

    // Bloco 2 (2 confirmações: tip 2 - 1 + 1 = 2)
    const b2 = engine.processBlock({ hash: 'blk_2', prevHash: 'blk_1', height: 2, txids: [], timestampMs: 2000n }, 2000n);
    assert.equal(b2.alerts.length, 0);

    // Bloco 3 (3 confirmações: tip 3 - 1 + 1 = 3 >= 3) -> Disparo do Alerta
    const b3 = engine.processBlock({ hash: 'blk_3', prevHash: 'blk_2', height: 3, txids: [], timestampMs: 3000n }, 3000n);
    assert.equal(b3.alerts.length, 1);
    assert.equal(b3.alerts[0]?.type, 'CONFIRMED');
    assert.equal(b3.alerts[0]?.currentConfirmations, 3);
    assert.equal(engine.getSubscription('sub_alpha')?.isAlerted, true);
  });

  // PILAR 2: Invariante Crítico de Reversão (Bifurcação & REORG_REVOKED)
  it('Pilar 2 [Invariante]: deve revogar alertas (REORG_REVOKED) se a rede sofrer reorganização descartando o bloco', () => {
    const engine = new ReorgEngine();
    engine.subscribe('sub_reorg', 'tx_beta', 'user_bob', 1);

    // Bloco na cadeia A (atinge 1 confirmação)
    const a1 = engine.processBlock({ hash: 'blk_a1', prevHash: '', height: 1, txids: ['tx_beta'], timestampMs: 1000n }, 1000n);
    assert.equal(a1.alerts.length, 1);
    assert.equal(a1.alerts[0]?.type, 'CONFIRMED');

    // Ramo concorrente B (fork) nasce sem a transação
    engine.processBlock({ hash: 'blk_b1', prevHash: '', height: 1, txids: [], timestampMs: 1100n }, 1100n);

    // Ramo B ultrapassa ramo A (altura 2 > altura 1) -> Reorganização de Rede
    const b2 = engine.processBlock({ hash: 'blk_b2', prevHash: 'blk_b1', height: 2, txids: [], timestampMs: 1200n }, 1200n);

    assert.equal(b2.isReorg, true);
    assert.equal(b2.alerts.length, 1);
    assert.equal(b2.alerts[0]?.type, 'REORG_REVOKED');
    assert.equal(b2.alerts[0]?.currentConfirmations, 0);
    assert.equal(engine.getSubscription('sub_reorg')?.isAlerted, false);
  });

  // PILAR 3: Resiliência, Recuperação e Idempotência Estrita
  it('Pilar 3 [Resiliência]: deve recuperar estado idêntico via snapshot e garantir idempotência sob novos blocos', () => {
    const engine = new ReorgEngine();
    engine.subscribe('sub_res', 'tx_gamma', 'user_charlie', 2);
    engine.processBlock({ hash: 'blk_c0', prevHash: '', height: 0, txids: [], timestampMs: 100n }, 100n);
    engine.processBlock({ hash: 'blk_c1', prevHash: 'blk_c0', height: 1, txids: ['tx_gamma'], timestampMs: 200n }, 200n);

    // Congela estado em snapshot (backup antes de queda forçada)
    const snapshot = engine.snapshot();

    // Cria nova instância e restaura estado intacto
    const recovered = new ReorgEngine();
    recovered.restore(snapshot);

    assert.equal(recovered.tipHash, 'blk_c1');
    assert.equal(recovered.tipHeight, 1);

    // Bloco 2 atinge limiar de 2 confirmações -> emite CONFIRMED
    const b2 = recovered.processBlock({ hash: 'blk_c2', prevHash: 'blk_c1', height: 2, txids: [], timestampMs: 300n }, 300n);
    assert.equal(b2.alerts.length, 1);
    assert.equal(b2.alerts[0]?.type, 'CONFIRMED');

    // Idempotência estrita: bloco 3 avança a cadeia mas NÃO re-emite alerta
    const b3 = recovered.processBlock({ hash: 'blk_c3', prevHash: 'blk_c2', height: 3, txids: [], timestampMs: 400n }, 400n);
    assert.equal(b3.alerts.length, 0);
  });
});
