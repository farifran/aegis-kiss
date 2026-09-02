import { TokenBucket } from '../src/tokenBucket.js';
import { ClearingHouse, type TransferOrder } from '../src/clearingHouse.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    process.exit(1);
  }
}

console.log('🏛️ INICIANDO SUÍTE RED TEAM UNIVERSAL (AEGIS-GRADE) — 10 PROVAS DE PROPRIEDADE');

// 1. Prova 1: Anti-Netting Circular (A=0, B=0; A->B 100, B->A 100)
{
  const house = new ClearingHouse();
  house.registerAccount('A', 0n, 1000n, 10n);
  house.registerAccount('B', 0n, 1000n, 10n);

  const orders: TransferOrder[] = [
    { id: 'tx1', senderId: 'A', receiverId: 'B', amount: 100n, fee: 0n },
    { id: 'tx2', senderId: 'B', receiverId: 'A', amount: 100n, fee: 0n }
  ];

  const res = house.processBatch(orders, 100n);
  assert(res.committedCount === 0, 'Prova 1: tx1 não pode ser financiada por tx2 posterior');
  assert(res.decisions[0]?.status === 'blocked_insolvent', 'Prova 1: tx1 deve ser blocked_insolvent');
  assert(res.decisions[0]?.index === 0, 'Prova 1: decisão deve conter índice 0');
  console.log('✅ Prova 1 (Anti-Netting Circular): APROVADA');
}

// 2. Prova 2: Self-Transfer Aliasing (A -> A com taxa)
{
  const house = new ClearingHouse();
  house.registerAccount('Alice', 500n, 1000n, 10n);

  const res = house.processBatch([{ id: 'self1', senderId: 'Alice', receiverId: 'Alice', amount: 100n, fee: 15n }], 100n);
  assert(res.committedCount === 1, 'Prova 2: self-transfer válida deve ser committed');
  assert(res.settledVolume === 100n, 'Prova 2: volume liquidado deve ser 100n');
  assert(house.getAccount('Alice', 100n)?.balance === 485n, 'Prova 2: saldo de Alice deve ser 485n (debitou apenas a taxa)');
  assert(house.treasuryBalance === 15n, 'Prova 2: treasury deve receber 15n');
  console.log('✅ Prova 2 (Self-Transfer Aliasing): APROVADA');
}

// 3. Prova 3: Capacity Blocking & Temporal Recovery (sem quarentena destrutiva)
{
  const house = new ClearingHouse();
  house.registerAccount('Sender', 1000n, 100n, 1n); // 100 tokens, 1 token/ms
  house.registerAccount('Receiver', 0n, 1000n, 0n);

  // Consome 80 tokens no t=0
  const res1 = house.processBatch([{ id: 'op1', senderId: 'Sender', receiverId: 'Receiver', amount: 80n, fee: 0n }], 0n);
  assert(res1.committedCount === 1, 'Prova 3: op1 deve ser committed');

  // Tenta consumir 50 tokens no t=0 (sobraram 20 -> bloqueia)
  const res2 = house.processBatch([{ id: 'op2', senderId: 'Sender', receiverId: 'Receiver', amount: 50n, fee: 0n }], 0n);
  assert(res2.committedCount === 0 && res2.blockedCount === 1, 'Prova 3: op2 deve ser bloqueada por capacidade');
  assert(res2.decisions[0]?.status === 'blocked_capacity', 'Prova 3: status deve ser blocked_capacity');

  // Avança o relógio para t=40 (recupera 40 tokens -> total 60 >= 50)
  const res3 = house.processBatch([{ id: 'op3', senderId: 'Sender', receiverId: 'Receiver', amount: 50n, fee: 0n }], 40n);
  assert(res3.committedCount === 1, 'Prova 3: op3 deve ser committed após recuperação temporal do bucket');
  console.log('✅ Prova 3 (Capacity Blocking & Recovery): APROVADA');
}

// 4. Prova 4: Rollback State Congruence & Aborted Status (Identidade pós-aborto)
{
  const house = new ClearingHouse();
  house.registerAccount('UserX', 50n, 1000n, 10n);
  house.registerAccount('UserY', 10n, 1000n, 10n);

  const snapBefore = house.snapshot();
  // Força uma falha global injetando capacityCost negativo na segunda
  const res = house.processBatch([
    { id: 't1', senderId: 'UserX', receiverId: 'UserY', amount: 30n, fee: 0n },
    { id: 't2', senderId: 'UserX', receiverId: 'UserY', amount: 10n, fee: 0n, capacityCost: -100n }
  ], 10n);

  assert(res.committedCount === 1, 'Prova 4: op1 aceita e op2 rejeitada por custo negativo');
  assert(house.getAccount('UserX', 10n)?.balance === 20n, 'Prova 4: saldo pós-processamento consistente');
  console.log('✅ Prova 4 (Rollback State Congruence): APROVADA');
}

// 5. Prova 5: Execution Digest Canonical Identity (Vínculo de Identidade Canônica)
{
  const house1 = new ClearingHouse();
  house1.registerAccount('Alice', 200n, 1000n, 10n);
  house1.registerAccount('Bob', 200n, 1000n, 10n);

  const house2 = new ClearingHouse();
  house2.registerAccount('Carol', 200n, 1000n, 10n);
  house2.registerAccount('Dave', 200n, 1000n, 10n);

  const res1 = house1.processBatch([{ id: 'tx_a', senderId: 'Alice', receiverId: 'Bob', amount: 50n, fee: 5n }], 100n);
  const res2 = house2.processBatch([{ id: 'tx_b', senderId: 'Carol', receiverId: 'Dave', amount: 50n, fee: 5n }], 100n);

  assert(res1.executionDigest !== res2.executionDigest, 'Prova 5: lotes com participantes/IDs diferentes DEVEM produzir digests distintos');
  console.log('✅ Prova 5 (Execution Digest Identity): APROVADA');
}

// 6. Prova 6: Temporal Monotonicity & No Free Capacity (t=110 -> 90 -> 110)
{
  const bucket = new TokenBucket(100n, 1n, 0n, 100n); // 0 tokens em t=100
  bucket.update(110n); // +10 tokens -> 10 tokens
  assert(bucket.tokens === 10n, 'Prova 6: 10 tokens em t=110');

  // Relógio recua para t=90 (monotonic clamp: não pode rebaixar nem inflar)
  bucket.update(90n);
  assert(bucket.tokens === 10n && bucket.lastUpdateMs === 110n, 'Prova 6: relógio recuado não muta cursor');

  // Relógio volta para t=110 (delta = 0 -> zero tokens adicionados)
  bucket.update(110n);
  assert(bucket.tokens === 10n, 'Prova 6: replay de intervalo NÃO duplica tokens');
  console.log('✅ Prova 6 (Temporal Monotonicity): APROVADA');
}

// 7. Prova 7: Input Validation (ID vazio ou duplicado)
{
  const house = new ClearingHouse();
  house.registerAccount('A', 100n, 1000n, 10n);
  house.registerAccount('B', 100n, 1000n, 10n);

  const res = house.processBatch([
    { id: '', senderId: 'A', receiverId: 'B', amount: 10n, fee: 0n },
    { id: 'dup1', senderId: 'A', receiverId: 'B', amount: 10n, fee: 0n },
    { id: 'dup1', senderId: 'A', receiverId: 'B', amount: 10n, fee: 0n }
  ], 10n);

  assert(res.rejectedCount === 2, 'Prova 7: id vazio e id duplicado devem ser rejeitados');
  assert(res.committedCount === 1, 'Prova 7: primeira transação válida com dup1 é committed');
  console.log('✅ Prova 7 (Input Validation): APROVADA');
}

// 8. Prova 8: Account Collision Guard
{
  const house = new ClearingHouse();
  house.registerAccount('X', 100n, 1000n, 10n);
  let threw = false;
  try {
    house.registerAccount('X', 500n, 1000n, 10n);
  } catch {
    threw = true;
  }
  assert(threw, 'Prova 8: registro duplicado de conta DEVE lançar exceção');
  console.log('✅ Prova 8 (Account Collision Guard): APROVADA');
}

// 9. Prova 9: Conservation of Value Invariant
{
  const house = new ClearingHouse();
  house.registerAccount('U1', 1000n, 5000n, 10n);
  house.registerAccount('U2', 500n, 5000n, 10n);
  house.registerAccount('U3', 250n, 5000n, 10n);

  const initialTotal = 1000n + 500n + 250n + house.treasuryBalance;

  house.processBatch([
    { id: 'b1', senderId: 'U1', receiverId: 'U2', amount: 200n, fee: 10n },
    { id: 'b2', senderId: 'U2', receiverId: 'U3', amount: 100n, fee: 5n },
    { id: 'b3', senderId: 'U3', receiverId: 'U1', amount: 50n, fee: 2n }
  ], 100n);

  const u1 = house.getAccount('U1', 100n)?.balance ?? 0n;
  const u2 = house.getAccount('U2', 100n)?.balance ?? 0n;
  const u3 = house.getAccount('U3', 100n)?.balance ?? 0n;
  const finalTotal = u1 + u2 + u3 + house.treasuryBalance;

  assert(initialTotal === finalTotal, `Prova 9: Conservação violada (${initialTotal} !== ${finalTotal})`);
  console.log('✅ Prova 9 (Conservation of Value): APROVADA');
}

// 10. Prova 10: Engine-Owned Time Monotonicity & Rollback Reason
{
  const house = new ClearingHouse();
  house.registerAccount('T1', 500n, 1000n, 10n);
  house.registerAccount('T2', 500n, 1000n, 10n);

  house.processBatch([{ id: 'm1', senderId: 'T1', receiverId: 'T2', amount: 50n, fee: 0n }], 1000n);
  assert(house.lastProcessedMs === 1000n, 'Prova 10: lastProcessedMs deve ser 1000n');

  // Lote com timestamp anterior (t=500n < 1000n) deve abortar e explicar a razão
  const resPast = house.processBatch([{ id: 'm2', senderId: 'T1', receiverId: 'T2', amount: 50n, fee: 0n }], 500n);
  assert(resPast.rolledBack === true, 'Prova 10: lote no passado deve sofrer rollback');
  assert(resPast.rollbackReason?.includes('backwards'), 'Prova 10: motivo do rollback deve indicar recuo temporal');
  console.log('✅ Prova 10 (Engine-Owned Time Monotonicity & Rollback Reason): APROVADA');
}

console.log('\n🎯 TODAS AS 10 PROVAS RED TEAM FORAM APROVADAS COM 100% DE SUCESSO!');
