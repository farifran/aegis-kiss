import { ReorgEngine } from '../src/reorgEngine.js';
import { type BlockHeader } from '../src/blockTree.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    process.exit(1);
  }
}

console.log('🏛️ INICIANDO SUÍTE RED TEAM & BENCHMARK: BLOCKCHAIN REORG ENGINE');

// 1. Prova 1: Confirmação Progressiva Normal (4 Confirmações -> Disparo de CONFIRMED)
{
  const engine = new ReorgEngine();
  engine.subscribe('sub_1', 'tx_alpha', 'user_1', 4);

  // Bloco Gênesis H=0
  engine.processBlock({ hash: 'blk_0', prevHash: '', height: 0, txids: [], timestampMs: 100n }, 100n);
  // Bloco 1 com a transação
  engine.processBlock({ hash: 'blk_1', prevHash: 'blk_0', height: 1, txids: ['tx_alpha'], timestampMs: 110n }, 110n);
  // Bloco 2
  engine.processBlock({ hash: 'blk_2', prevHash: 'blk_1', height: 2, txids: [], timestampMs: 120n }, 120n);
  // Bloco 3
  engine.processBlock({ hash: 'blk_3', prevHash: 'blk_2', height: 3, txids: [], timestampMs: 130n }, 130n);

  assert(engine.getSubscription('sub_1')?.isAlerted === false, 'Prova 1: Em H=3 são 3 confirmações (tip 3 - 1 + 1 = 3 < 4), não deve disparar');

  // Bloco 4 (tip 4 - 1 + 1 = 4 confirmações -> DISPARA CONFIRMED)
  const res4 = engine.processBlock({ hash: 'blk_4', prevHash: 'blk_3', height: 4, txids: [], timestampMs: 140n }, 140n);
  assert(res4.alerts.length === 1, 'Prova 1: Deve emitir 1 alerta');
  assert(res4.alerts[0]?.type === 'CONFIRMED', 'Prova 1: Tipo do alerta deve ser CONFIRMED');
  assert(res4.alerts[0]?.currentConfirmations === 4, 'Prova 1: Deve constar 4 confirmações');
  assert(engine.getSubscription('sub_1')?.isAlerted === true, 'Prova 1: Subscription deve marcar isAlerted=true');
  console.log('✅ Prova 1 (Confirmação Progressiva Normal): APROVADA');
}

// 2. Prova 2: Reorganização Profunda (Reorg) & Revogação Atômica (REORG_REVOKED)
{
  const engine = new ReorgEngine();
  engine.subscribe('sub_reorg', 'tx_special', 'user_vip', 3);

  // Cadeia Principal A: 0 -> A1(tx) -> A2 -> A3 (atinge 3 confirmações em A3)
  engine.processBlock({ hash: 'gen', prevHash: '', height: 0, txids: [], timestampMs: 1000n }, 1000n);
  engine.processBlock({ hash: 'A1', prevHash: 'gen', height: 1, txids: ['tx_special'], timestampMs: 1010n }, 1010n);
  engine.processBlock({ hash: 'A2', prevHash: 'A1', height: 2, txids: [], timestampMs: 1020n }, 1020n);
  const resA3 = engine.processBlock({ hash: 'A3', prevHash: 'A2', height: 3, txids: [], timestampMs: 1030n }, 1030n);

  assert(resA3.alerts.length === 1 && resA3.alerts[0]?.type === 'CONFIRMED', 'Prova 2: Deve disparar CONFIRMED em A3');
  assert(engine.getSubscription('sub_reorg')?.isAlerted === true, 'Prova 2: Estado deve ser alerted=true');

  // Fork Competidor B nascendo em gen: gen -> B1 -> B2 -> B3 -> B4 (mais longa!)
  engine.processBlock({ hash: 'B1', prevHash: 'gen', height: 1, txids: [], timestampMs: 1015n }, 1015n);
  engine.processBlock({ hash: 'B2', prevHash: 'B1', height: 2, txids: [], timestampMs: 1025n }, 1025n);
  engine.processBlock({ hash: 'B3', prevHash: 'B2', height: 3, txids: [], timestampMs: 1035n }, 1035n);

  // B4 supera a altura de A3 (height 4 > 3 -> GATILHO DO REORG)
  const resB4 = engine.processBlock({ hash: 'B4', prevHash: 'B3', height: 4, txids: [], timestampMs: 1045n }, 1045n);

  assert(resB4.isReorg === true, 'Prova 2: Deve detectar Reorg');
  assert(resB4.reorgDetails?.commonAncestorHash === 'gen', 'Prova 2: Ancestral comum deve ser gen');
  assert(resB4.alerts.length === 1, 'Prova 2: Deve emitir 1 alerta de revogação');
  assert(resB4.alerts[0]?.type === 'REORG_REVOKED', 'Prova 2: Tipo de alerta deve ser REORG_REVOKED');
  assert(resB4.alerts[0]?.currentConfirmations === 0, 'Prova 2: Confirmações da tx órfã devem zerar');
  assert(engine.getSubscription('sub_reorg')?.isAlerted === false, 'Prova 2: Estado de sub_reorg deve voltar para isAlerted=false');
  console.log('✅ Prova 2 (Reorganização Profunda & Revogação REORG_REVOKED): APROVADA');
}

// 3. Prova 3: Idempotência Estrita (Sem Duplicação de Alertas em Blocos Subsequentes)
{
  const engine = new ReorgEngine();
  engine.subscribe('sub_idem', 'tx_test', 'user_2', 2);

  engine.processBlock({ hash: 'g', prevHash: '', height: 0, txids: [], timestampMs: 100n }, 100n);
  engine.processBlock({ hash: 'b1', prevHash: 'g', height: 1, txids: ['tx_test'], timestampMs: 110n }, 110n);
  const res2 = engine.processBlock({ hash: 'b2', prevHash: 'b1', height: 2, txids: [], timestampMs: 120n }, 120n);
  assert(res2.alerts.length === 1, 'Prova 3: Disparo em H=2 (2 confirmações)');

  // Novos blocos chegam (H=3, H=4, H=5)
  const res3 = engine.processBlock({ hash: 'b3', prevHash: 'b2', height: 3, txids: [], timestampMs: 130n }, 130n);
  const res4 = engine.processBlock({ hash: 'b4', prevHash: 'b3', height: 4, txids: [], timestampMs: 140n }, 140n);

  assert(res3.alerts.length === 0, 'Prova 3: H=3 NÃO pode re-emitir alerta');
  assert(res4.alerts.length === 0, 'Prova 3: H=4 NÃO pode re-emitir alerta');
  console.log('✅ Prova 3 (Idempotência Estrita de Alertas): APROVADA');
}

// 4. Prova 4: Crash Recovery & Deterministic Snapshot Restore
{
  const engine = new ReorgEngine();
  engine.subscribe('s1', 'tx_persist', 'u1', 3);
  engine.processBlock({ hash: 'b0', prevHash: '', height: 0, txids: [], timestampMs: 100n }, 100n);
  engine.processBlock({ hash: 'b1', prevHash: 'b0', height: 1, txids: ['tx_persist'], timestampMs: 110n }, 110n);
  engine.processBlock({ hash: 'b2', prevHash: 'b1', height: 2, txids: [], timestampMs: 120n }, 120n);

  const snapshot = engine.snapshot();

  const recovered = new ReorgEngine();
  recovered.restore(snapshot);

  assert(recovered.tipHeight === 2, 'Prova 4: Altura da ponta recuperada deve ser 2');
  assert(recovered.tipHash === 'b2', 'Prova 4: Hash da ponta recuperada deve ser b2');

  // Adiciona H=3 no recuperado -> atinge 3 confirmações -> dispara alerta
  const res = recovered.processBlock({ hash: 'b3', prevHash: 'b2', height: 3, txids: [], timestampMs: 130n }, 130n);
  assert(res.alerts.length === 1 && res.alerts[0]?.type === 'CONFIRMED', 'Prova 4: Engine recuperada continua emitindo alertas perfeitamente');
  console.log('✅ Prova 4 (Crash Recovery & Deterministic Snapshot Restore): APROVADA');
}

// 5. Prova 5: Poda Automática de Ramos Órfãos (Zero-OOM / Backpressure)
{
  const engine = new ReorgEngine(5); // Mantém no máximo 5 blocos de profundidade órfã

  engine.processBlock({ hash: 'g', prevHash: '', height: 0, txids: [], timestampMs: 100n }, 100n);
  // Bloco órfão em H=1
  engine.processBlock({ hash: 'orphan_1', prevHash: 'g', height: 1, txids: [], timestampMs: 105n }, 105n);

  // Cadeia principal avança até H=10
  let prev = 'g';
  for (let h = 1; h <= 10; h++) {
    const curr = `main_${h}`;
    engine.processBlock({ hash: curr, prevHash: prev, height: h, txids: [], timestampMs: BigInt(100 + h * 10) }, BigInt(100 + h * 10));
    prev = curr;
  }

  // orphan_1 (H=1) deve ter sido podado da memória (10 - 5 = 5 > 1)
  const snap = engine.snapshot();
  assert(snap.treeSnapshot.blocks['orphan_1'] === undefined, 'Prova 5: Ramo órfão antigo DEVE ser podado da memória');
  console.log('✅ Prova 5 (Poda Automática de Órfãos & Zero-OOM): APROVADA');
}

// 6. Prova 6: Time Monotonicity & Rollback Protection
{
  const engine = new ReorgEngine();
  engine.processBatch([{ hash: 'b0', prevHash: '', height: 0, txids: [], timestampMs: 1000n }], 1000n);
  assert(engine.lastProcessedMs === 1000n, 'Prova 6: lastProcessedMs deve ser 1000n');

  // Lote no passado (t=500n < 1000n) deve abortar
  const resPast = engine.processBatch([{ hash: 'b1', prevHash: 'b0', height: 1, txids: [], timestampMs: 500n }], 500n);
  assert(resPast.abortedCount === 1 && resPast.committedCount === 0, 'Prova 6: lote no passado deve ser abortado');
  console.log('✅ Prova 6 (Time Monotonicity & Rollback Protection): APROVADA');
}

// 7. TESTE DE ESTRESSE DE ALTA CONCORRÊNCIA (100.000 TRANSAÇÕES / ASSINATURAS REATIVAS)
console.log('\n⚡ INICIANDO TESTE DE ESTRESSE & BENCHMARK (100.000 TRANSAÇÕES & ASSINATURAS)...');
{
  const engine = new ReorgEngine(50);
  const NUM_SUBS = 50000;
  const NUM_BLOCKS = 1000;
  const TX_PER_BLOCK = 100;

  for (let i = 0; i < NUM_SUBS; i++) {
    engine.subscribe(`sub_${i}`, `tx_${i}`, `user_${i % 1000}`, 4);
  }

  const blocks: BlockHeader[] = [];
  let prevHash = '';
  for (let h = 0; h < NUM_BLOCKS; h++) {
    const hash = `block_${h}`;
    const txids: string[] = [];
    for (let t = 0; t < TX_PER_BLOCK; t++) {
      txids.push(`tx_${(h * TX_PER_BLOCK + t) % NUM_SUBS}`);
    }
    blocks.push({
      hash,
      prevHash,
      height: h,
      txids,
      timestampMs: BigInt(10000 + h * 10)
    });
    prevHash = hash;
  }

  const start = performance.now();
  let totalAlerts = 0;
  for (let h = 0; h < NUM_BLOCKS; h++) {
    const b = blocks[h]!;
    const res = engine.processBlock(b, b.timestampMs);
    totalAlerts += res.alerts.length;
  }
  const totalTimeMs = performance.now() - start;
  const totalTxs = NUM_BLOCKS * TX_PER_BLOCK;
  const txsPerSec = (totalTxs / (totalTimeMs / 1000)).toFixed(0);

  console.log(`📊 RESULTADOS DO BENCHMARK:`);
  console.log(`   • Transações Processadas: ${totalTxs.toLocaleString()} txs`);
  console.log(`   • Assinaturas Monitoradas: ${NUM_SUBS.toLocaleString()} subs`);
  console.log(`   • Blocos Processados: ${NUM_BLOCKS.toLocaleString()} blocos`);
  console.log(`   • Alertas Reativos Emitidos: ${totalAlerts.toLocaleString()} alertas`);
  console.log(`   • Tempo Total: ${totalTimeMs.toFixed(2)} ms`);
  console.log(`   • Throughput: ${txsPerSec} txs / segundo`);

  assert(totalAlerts > 0, 'Benchmark: Alertas devem ter sido emitidos');
}

console.log('\n🎯 TODAS AS PROVAS RED TEAM E BENCHMARK DE BLOCKCHAIN APROVADOS COM SUCESSO!');
