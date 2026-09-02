import { MatchingEngine, type OrderCommand } from '../src/matchingEngine.js';
import { OrderBook } from '../src/orderBook.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    process.exit(1);
  }
}

console.log('🏛️ INICIANDO SUÍTE RED TEAM & BENCHMARK DE ALTA FREQUÊNCIA (MATCHING ENGINE)');

// 1. Prova 1: Price-Time Priority (FIFO Matching)
{
  const engine = new MatchingEngine();
  engine.registerSymbol('BTC/USDT');
  engine.registerUser('seller1', 10n, 0n);
  engine.registerUser('seller2', 10n, 0n);
  engine.registerUser('buyer', 0n, 200000n);

  // Seller 1 posta venda a 50.000 no t=100
  engine.processBatch([{ id: 's1', userId: 'seller1', symbol: 'BTC/USDT', side: 'SELL', price: 50000n, quantity: 1n }], 100n);
  // Seller 2 posta venda a 50.000 no t=200 (mesmo preço, tempo posterior)
  engine.processBatch([{ id: 's2', userId: 'seller2', symbol: 'BTC/USDT', side: 'SELL', price: 50000n, quantity: 1n }], 200n);

  // Buyer compra 1 BTC a 50.000 no t=300
  const res = engine.processBatch([{ id: 'b1', userId: 'buyer', symbol: 'BTC/USDT', side: 'BUY', price: 50000n, quantity: 1n }], 300n);

  assert(res.committedCount === 1, 'Prova 1: Ordem de compra deve ser committed');
  assert(res.tradesCount === 1, 'Prova 1: Deve gerar 1 trade');
  const report = res.reports[0];
  const trade = report?.matchResult?.trades[0];
  assert(trade?.sellOrderId === 's1', 'Prova 1: Deve casar com Seller 1 por prioridade FIFO temporal');
  assert(trade?.sellerId === 'seller1', 'Prova 1: Vendedor casado deve ser seller1');
  console.log('✅ Prova 1 (Price-Time Priority FIFO): APROVADA');
}

// 2. Prova 2: Simultaneous Atomic Settlement & Price Improvement
{
  const engine = new MatchingEngine();
  engine.registerSymbol('ETH/USDT');
  engine.registerUser('alice', 5n, 0n); // Alice tem 5 ETH
  engine.registerUser('bob', 0n, 15000n); // Bob tem 15.000 USDT

  // Alice vende 2 ETH a 3.000 USDT no t=100 (Total 6.000)
  engine.processBatch([{ id: 'ask1', userId: 'alice', symbol: 'ETH/USDT', side: 'SELL', price: 3000n, quantity: 2n }], 100n);

  // Bob envia BUY de 2 ETH com limite a 3.500 USDT (lockou 7.000 USDT) no t=200
  const res = engine.processBatch([{ id: 'bid1', userId: 'bob', symbol: 'ETH/USDT', side: 'BUY', price: 3500n, quantity: 2n }], 200n);

  assert(res.committedCount === 1 && res.tradesCount === 1, 'Prova 2: Trade deve ser executado');

  const alice = engine.getUser('alice');
  const bob = engine.getUser('bob');

  // Alice vendeu 2 ETH a 3.000 -> Restam 3 ETH disponíveis, ganhou 6.000 USDT
  assert(alice?.baseAvailable === 3n && alice?.baseLocked === 0n, 'Prova 2: Alice deve ter 3 ETH disponíveis e 0 locked');
  assert(alice?.quoteAvailable === 6000n, 'Prova 2: Alice deve ter 6.000 USDT disponíveis');

  // Bob comprou a 3.000 (preço do maker) -> Pagou 6.000 USDT, melhoria de preço devolveu 1.000 USDT de volta aos 8.000 restantes = 9.000 USDT
  assert(bob?.baseAvailable === 2n && bob?.baseLocked === 0n, 'Prova 2: Bob deve ter recebido 2 ETH');
  assert(bob?.quoteAvailable === 9000n && bob?.quoteLocked === 0n, 'Prova 2: Bob deve ter 9.000 USDT disponíveis (15.000 - 6.000)');
  console.log('✅ Prova 2 (Simultaneous Settlement & Price Improvement): APROVADA');
}

// 3. Prova 3: Idempotency & Anti-Double-Spending Guard (Ataque de 50 requisições idênticas)
{
  const engine = new MatchingEngine();
  engine.registerSymbol('SOL/USDT');
  engine.registerUser('attacker', 0n, 1000n); // Apenas 1.000 USDT (preço SOL = 100 -> compra max 10)

  // Dispara 50 requisições idênticas com o mesmo ID
  const attackOrders: OrderCommand[] = [];
  for (let i = 0; i < 50; i++) {
    attackOrders.push({ id: 'attack_order_1', userId: 'attacker', symbol: 'SOL/USDT', side: 'BUY', price: 100n, quantity: 10n });
  }

  const res = engine.processBatch(attackOrders, 1000n);
  assert(res.committedCount === 1, 'Prova 3: Apenas a primeira ordem deve ser aceita');
  assert(res.rejectedCount === 49, 'Prova 3: As outras 49 requisições idênticas devem ser rejeitadas como duplicadas');
  assert(res.reports[1]?.status === 'REJECTED_DUPLICATE', 'Prova 3: Status da duplicada deve ser REJECTED_DUPLICATE');

  const attackerAcc = engine.getUser('attacker');
  assert(attackerAcc?.quoteLocked === 1000n && attackerAcc?.quoteAvailable === 0n, 'Prova 3: Saldo lockado exatamente uma vez (1000n)');
  console.log('✅ Prova 3 (Idempotency & Anti-Double-Spending Guard): APROVADA');
}

// 4. Prova 4: Crash Recovery & Deterministic Snapshot Restore
{
  const engine = new MatchingEngine();
  engine.registerSymbol('BTC/USDT');
  engine.registerUser('traderA', 50n, 1000000n);
  engine.registerUser('traderB', 50n, 1000000n);

  engine.processBatch([
    { id: 'o1', userId: 'traderA', symbol: 'BTC/USDT', side: 'SELL', price: 60000n, quantity: 5n },
    { id: 'o2', userId: 'traderB', symbol: 'BTC/USDT', side: 'BUY', price: 59000n, quantity: 5n }
  ], 100n);

  const snapshot = engine.snapshot();

  // Cria um novo motor (simulando reinicialização pós-queda)
  const recoveredEngine = new MatchingEngine();
  recoveredEngine.registerSymbol('BTC/USDT');
  recoveredEngine.registerUser('traderA', 0n, 0n);
  recoveredEngine.registerUser('traderB', 0n, 0n);

  recoveredEngine.restore(snapshot);

  const recA = recoveredEngine.getUser('traderA');
  const recB = recoveredEngine.getUser('traderB');
  assert(recA?.baseLocked === 5n && recA?.baseAvailable === 45n, 'Prova 4: Estado de traderA restaurado perfeitamente');
  assert(recB?.quoteLocked === 295000n && recB?.quoteAvailable === 705000n, 'Prova 4: Estado de traderB restaurado perfeitamente');

  // Envia ordem de casamento no motor recuperado
  const matchRes = recoveredEngine.processBatch([
    { id: 'o3', userId: 'traderB', symbol: 'BTC/USDT', side: 'BUY', price: 60000n, quantity: 5n }
  ], 200n);

  assert(matchRes.committedCount === 1 && matchRes.tradesCount === 1, 'Prova 4: Motor recuperado executa matching normalmente');
  console.log('✅ Prova 4 (Crash Recovery & Deterministic Snapshot Restore): APROVADA');
}

// 5. Prova 5: Global Value Conservation
{
  const engine = new MatchingEngine();
  engine.registerSymbol('BTC/USDT');
  engine.registerUser('u1', 100n, 10000000n);
  engine.registerUser('u2', 100n, 10000000n);
  engine.registerUser('u3', 100n, 10000000n);

  const initialBase = 300n;
  const initialQuote = 30000000n;

  engine.processBatch([
    { id: 'tx1', userId: 'u1', symbol: 'BTC/USDT', side: 'SELL', price: 50000n, quantity: 10n },
    { id: 'tx2', userId: 'u2', symbol: 'BTC/USDT', side: 'BUY', price: 50000n, quantity: 5n },
    { id: 'tx3', userId: 'u3', symbol: 'BTC/USDT', side: 'BUY', price: 50000n, quantity: 5n }
  ], 100n);

  let currentBase = 0n;
  let currentQuote = 0n;
  for (const uid of ['u1', 'u2', 'u3']) {
    const acc = engine.getUser(uid)!;
    currentBase += acc.baseAvailable + acc.baseLocked;
    currentQuote += acc.quoteAvailable + acc.quoteLocked;
  }

  assert(currentBase === initialBase, `Prova 5: Conservação de Base violada (${currentBase} !== ${initialBase})`);
  assert(currentQuote === initialQuote, `Prova 5: Conservação de Quote violada (${currentQuote} !== ${initialQuote})`);
  console.log('✅ Prova 5 (Global Value Conservation): APROVADA');
}

// 6. Prova 6: 100% Slot Mapping (Bijective Decisions)
{
  const engine = new MatchingEngine();
  engine.registerSymbol('BTC/USDT');
  engine.registerUser('u1', 10n, 100000n);

  const rawOrders: any[] = [
    { id: 'v1', userId: 'u1', symbol: 'BTC/USDT', side: 'BUY', price: 1000n, quantity: 1n },
    undefined,
    { id: 'v2', userId: 'u1', symbol: 'BTC/USDT', side: 'BUY', price: 1000n, quantity: 1n }
  ];

  const res = engine.processBatch(rawOrders, 500n);
  assert(res.reports.length === rawOrders.length, 'Prova 6: reports.length deve ser exatamente igual a rawOrders.length');
  assert(res.reports[1]?.status === 'REJECTED_INVALID', 'Prova 6: slot undefined deve gerar REJECTED_INVALID');
  assert(res.reports[1]?.index === 1, 'Prova 6: índice 1 deve ser preservado');
  assert(res.committedCount === 2, 'Prova 6: as 2 ordens válidas devem ser committed');
  console.log('✅ Prova 6 (100% Slot Mapping & Bijective Reports): APROVADA');
}

// 7. Prova 7: Time Monotonicity & Rollback Protection
{
  const engine = new MatchingEngine();
  engine.registerSymbol('BTC/USDT');
  engine.registerUser('u1', 10n, 100000n);

  engine.processBatch([{ id: 't1', userId: 'u1', symbol: 'BTC/USDT', side: 'BUY', price: 1000n, quantity: 1n }], 1000n);
  assert(engine.lastProcessedMs === 1000n, 'Prova 7: lastProcessedMs deve ser 1000n');

  // Lote no passado (t=500n < 1000n) deve abortar
  const resPast = engine.processBatch([{ id: 't2', userId: 'u1', symbol: 'BTC/USDT', side: 'BUY', price: 1000n, quantity: 1n }], 500n);
  assert(resPast.abortedCount === 1 && resPast.committedCount === 0, 'Prova 7: lote no passado deve ser abortado');
  console.log('✅ Prova 7 (Time Monotonicity & Rollback Protection): APROVADA');
}

// 8. TESTE DE ESTRESSE DE ALTA CONCORRÊNCIA (100.000 OPERAÇÕES)
console.log('\n⚡ INICIANDO TESTE DE ESTRESSE & BENCHMARK (100.000 ORDENS CONCORRENTES)...');
{
  const engine = new MatchingEngine();
  engine.registerSymbol('BTC/USDT');

  const NUM_USERS = 1000;
  const NUM_ORDERS = 100000;

  for (let i = 0; i < NUM_USERS; i++) {
    engine.registerUser(`user_${i}`, 1000000n, 100000000000n);
  }

  const orders: OrderCommand[] = [];
  for (let i = 0; i < NUM_ORDERS; i++) {
    const uid = `user_${i % NUM_USERS}`;
    const side = i % 2 === 0 ? 'BUY' : 'SELL';
    const price = 50000n + BigInt((i % 50) * 10);
    const quantity = 1n + BigInt(i % 5);
    orders.push({
      id: `ord_${i}`,
      userId: uid,
      symbol: 'BTC/USDT',
      side,
      price,
      quantity
    });
  }

  const BATCH_SIZE = 1000;
  const latenciesMs: number[] = [];
  const startGlobal = performance.now();

  let totalCommitted = 0;
  let totalTrades = 0;

  for (let b = 0; b < NUM_ORDERS; b += BATCH_SIZE) {
    const chunk = orders.slice(b, b + BATCH_SIZE);
    const nowMs = BigInt(100000 + b);

    const t0 = performance.now();
    const res = engine.processBatch(chunk, nowMs);
    const t1 = performance.now();

    latenciesMs.push((t1 - t0) / BATCH_SIZE); // Latência média por ordem neste chunk
    totalCommitted += res.committedCount;
    totalTrades += res.tradesCount;
  }

  const totalTimeMs = performance.now() - startGlobal;
  const opsPerSec = (NUM_ORDERS / (totalTimeMs / 1000)).toFixed(0);

  latenciesMs.sort((a, b) => a - b);
  const p50 = (latenciesMs[Math.floor(latenciesMs.length * 0.50)]! * 1000).toFixed(2);
  const p95 = (latenciesMs[Math.floor(latenciesMs.length * 0.95)]! * 1000).toFixed(2);
  const p99 = (latenciesMs[Math.floor(latenciesMs.length * 0.99)]! * 1000).toFixed(2);

  console.log(`📊 RESULTADOS DO BENCHMARK:`);
  console.log(`   • Volume Processado: ${NUM_ORDERS.toLocaleString()} ordens`);
  console.log(`   • Ordens Casadas/Executadas: ${totalTrades.toLocaleString()} trades`);
  console.log(`   • Tempo Total: ${totalTimeMs.toFixed(2)} ms`);
  console.log(`   • Throughput: ${opsPerSec} ordens/segundo`);
  console.log(`   • Latência p50: ${p50} µs por ordem`);
  console.log(`   • Latência p95: ${p95} µs por ordem`);
  console.log(`   • Latência p99: ${p99} µs por ordem`);

  assert(totalCommitted === NUM_ORDERS, 'Benchmark: 100% das ordens devem ser committed');
  assert(totalTrades > 0, 'Benchmark: Trades devem ter ocorrido');
}

console.log('\n🎯 TODAS AS PROVAS RED TEAM E BENCHMARK DE ALTA FREQUÊNCIA APROVADOS COM SUCESSO!');
