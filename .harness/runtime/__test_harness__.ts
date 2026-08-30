// Aegis Ephemeral Invariant Harness
import { AuctionEngine, compileAuctionBitmask } from '../../src/index.js';

export async function __run_invariants() {
  const passed: string[] = [];
  const failed: string[] = [];

  // Behavior 1: Process 3-cycle circular batch and verify exact volume obliteration and zero double-settlement in partial fill
  try {
    const eng = new AuctionEngine(10n);
    const batch = [{ id: '1', from: 'A', to: 'B', amount: 1000n }, { id: '2', from: 'B', to: 'C', amount: 1000n }, { id: '3', from: 'C', to: 'A', amount: 1000n }];
    const res = eng.processBatch(batch, 3000n);
    const mask = compileAuctionBitmask(eng);
    const __ok = Boolean(res.cycleVolume === 3000n && res.fractionalVolume === 0n && res.settledVolume === 3000n && (mask & 2) === 2 && res.settledParticipantsCount === 3);
    if (!__ok) failed.push("BEHAVIOR_FAIL: Process 3-cycle circular batch and verify exact volume obliteration and zero double-settlement in partial fill");
    else passed.push("BEHAVIOR_PASS: Process 3-cycle circular batch and verify exact volume obliteration and zero double-settlement in partial fill");
  } catch (e: any) {
    failed.push("BEHAVIOR_EXC: Process 3-cycle circular batch and verify exact volume obliteration and zero double-settlement in partial fill (" + String(e?.message || e) + ")");
  }

  // Behavior 2: Process residual linear orders with partial fill and verify Merkle root derivation
  try {
    const eng = new AuctionEngine(10n);
    const batch = [{ id: '1', from: 'A', to: 'B', amount: 1000n }];
    const res = eng.processBatch(batch, 500n);
    const mask = compileAuctionBitmask(eng);
    const __ok = Boolean(res.fractionalVolume === 500n && (mask & 4) === 4 && res.merkleRoot > 0n);
    if (!__ok) failed.push("BEHAVIOR_FAIL: Process residual linear orders with partial fill and verify Merkle root derivation");
    else passed.push("BEHAVIOR_PASS: Process residual linear orders with partial fill and verify Merkle root derivation");
  } catch (e: any) {
    failed.push("BEHAVIOR_EXC: Process residual linear orders with partial fill and verify Merkle root derivation (" + String(e?.message || e) + ")");
  }

  // Behavior 3: Verify lock activation reflects in bitmask bit 0
  try {
    const eng = new AuctionEngine(1n);
    eng.lock();
    const mask = compileAuctionBitmask(eng);
    const __ok = Boolean(eng.isLocked === true && (mask & 1) === 1);
    if (!__ok) failed.push("BEHAVIOR_FAIL: Verify lock activation reflects in bitmask bit 0");
    else passed.push("BEHAVIOR_PASS: Verify lock activation reflects in bitmask bit 0");
  } catch (e: any) {
    failed.push("BEHAVIOR_EXC: Verify lock activation reflects in bitmask bit 0 (" + String(e?.message || e) + ")");
  }

  // Proof Obligation: PROOF-CONSERVATION-MAX-DEMAND
  try {
    const eng = new AuctionEngine(1n);
    const batch = [{ id: '1', from: 'A', to: 'B', amount: 1000n }, { id: '2', from: 'B', to: 'C', amount: 1000n }, { id: '3', from: 'C', to: 'A', amount: 1000n }];
    const res = eng.processBatch(batch, 3000n);
    const __ok = Boolean(res.settledVolume <= 3000n && res.fractionalVolume === 0n);
    if (!__ok) failed.push("PO_FAIL [PROOF-CONSERVATION-MAX-DEMAND] (satisfies N/A)");
    else passed.push("PO_PASS [PROOF-CONSERVATION-MAX-DEMAND]");
  } catch (e: any) {
    failed.push("PO_EXC [PROOF-CONSERVATION-MAX-DEMAND] (" + String(e?.message || e) + ")");
  }

  if (failed.length > 0) {
    console.error("[AEGIS][INVARIANT_HARNESS] FAILED INVARIANTS:\n" + failed.join("\n"));
    throw new Error("Invariant failures:\n" + failed.join("\n"));
  }
  console.log("[AEGIS][INVARIANT_HARNESS] ALL INVARIANTS VERIFIED (" + passed.length + " checked):\n" + passed.join("\n"));
}
void __run_invariants();
