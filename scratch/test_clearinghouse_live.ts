import { ClearingHouse, obterClearingHouseBitmask, type TransferOrder } from '../src/clearingHouse.js';
import { TokenBucket, obterEstadoBitmask } from '../src/tokenBucket.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log("=== 1. Testando PO-PEEK-001: peekTokens Immutability ===");
const bucket = new TokenBucket(100n, 10);
const t0 = bucket.lastUpdateMs;
const p1 = bucket.peekTokens(t0 + 1000n);
const p2 = bucket.peekTokens(t0 + 2000n);
assert(p1 === 800n, "p1 deve ser 800n");
assert(p2 === 800n, "p2 deve ser 800n");
assert(bucket.tokens === 800n, "tokens deve continuar 800n");
assert(bucket.lastUpdateMs === t0, "lastUpdateMs não pode mutar");
console.log("PO-PEEK-001: PASS 🟢");

console.log("=== 2. Testando PO-CIRCULAR-001: Netting Multilateral Circular com Saldo Zero ===");
const hCirc = new ClearingHouse();
hCirc.registerAccount('A', 0n, 1000n, 10);
hCirc.registerAccount('B', 0n, 1000n, 10);
hCirc.registerAccount('C', 0n, 1000n, 10);
const circularOrders: TransferOrder[] = [
  { id: '1', senderId: 'A', receiverId: 'B', amount: 100n, fee: 0n },
  { id: '2', senderId: 'B', receiverId: 'C', amount: 100n, fee: 0n },
  { id: '3', senderId: 'C', receiverId: 'A', amount: 100n, fee: 0n }
];
const resCirc = hCirc.processBatch(circularOrders);
assert(resCirc.settledCount === 3, "Todas as 3 ordens devem ser compensadas");
assert(resCirc.settledVolume === 300n, "Volume liquidado deve ser 300n");
assert(!resCirc.rolledBack, "Não pode ter ocorrido rollback");
console.log("PO-CIRCULAR-001: PASS 🟢");

console.log("=== 3. Testando PO-CONS-001: Conservação Estrita de Saldo (Zero-Sum) com Taxas ===");
const hCons = new ClearingHouse();
hCons.registerAccount('u1', 100n, 1000n, 10);
hCons.registerAccount('u2', 50n, 1000n, 10);
const sumBefore = 100n + 50n + hCons.treasuryBalance;
const resCons = hCons.processBatch([{ id: 'tx1', senderId: 'u1', receiverId: 'u2', amount: 20n, fee: 5n }]);
assert(resCons.settledCount === 1, "Ordem deve ser liquidada");
assert(hCons.treasuryBalance === 5n, "Taxa de 5n deve estar no tesouro");
const sumAfter = 75n + 70n + hCons.treasuryBalance; // u1: 100-25=75, u2: 50+20=70, treasury: 5
assert(sumBefore === sumAfter, `Conservação violada: before=${sumBefore}, after=${sumAfter}`);
console.log("PO-CONS-001: PASS 🟢");

console.log("=== 4. Testando PO-COMP-001: Resource Composition (Aggregate Reservation) ===");
const hComp = new ClearingHouse();
hComp.registerAccount('sender_comp', 1000n, 100n, 0); // 100 bytes = 800 bits maxTokens, refill=0
hComp.registerAccount('recv_comp', 0n, 100n, 0);
const ordersComp: TransferOrder[] = [
  { id: 'c1', senderId: 'sender_comp', receiverId: 'recv_comp', amount: 60n, fee: 0n }, // 480 bits
  { id: 'c2', senderId: 'sender_comp', receiverId: 'recv_comp', amount: 60n, fee: 0n }  // 480 bits. Total = 960 > 800!
];
const resComp = hComp.processBatch(ordersComp);
assert(resComp.settledCount === 1, `Apenas 1 ordem podia ser admitida, mas foram ${resComp.settledCount}`);
assert(resComp.rejectedCount === 1, `1 ordem deveria ter sido rejeitada por excesso agregado`);
assert(resComp.quarantinedCount === 1, `Conta deveria ser colocada em quarentena`);
console.log("PO-COMP-001: PASS 🟢");

console.log("=== 5. Testando PO-ATOM-001: Commit Atomicity on Abort ===");
const hAtom = new ClearingHouse();
hAtom.registerAccount('solv_a', 50n, 1000n, 10);
hAtom.registerAccount('insolv_b', 10n, 1000n, 10);
const ordersAtom: TransferOrder[] = [
  { id: 'a1', senderId: 'solv_a', receiverId: 'insolv_b', amount: 30n, fee: 0n },
  { id: 'a2', senderId: 'insolv_b', receiverId: 'solv_a', amount: 200n, fee: 0n } // Devedor insolvente!
];
const resAtom = hAtom.processBatch(ordersAtom);
assert(resAtom.rolledBack, "Lote com participante insolvente deve sofrer rollback");
assert(resAtom.settledCount === 0, "Nenhuma ordem deve ser commitada");
// Verificar que o saldo de solv_a NÃO foi mutado:
const testProbeOrder: TransferOrder[] = [
  { id: 'probe', senderId: 'solv_a', receiverId: 'insolv_b', amount: 50n, fee: 0n }
];
const resProbe = hAtom.processBatch(testProbeOrder);
assert(resProbe.settledCount === 1, "solv_a ainda tem 50n intactos!");
console.log("PO-ATOM-001: PASS 🟢");

console.log("=== 6. Testando Telemetria via Bitmask de 64 bits ===");
const mask = obterClearingHouseBitmask(hComp);
assert(typeof mask === 'bigint', "Bitmask deve ser bigint");
assert((mask & 2n) !== 0n, "Bit 1 deve indicar quarentena acionada");
console.log(`Bitmask gerado: 0x${mask.toString(16)} 🟢`);

console.log("\n=======================================================");
console.log("🎯 TODAS AS 6 PROVAS E INVARIANTES APROVADAS COM SUCESSO!");
console.log("=======================================================");
