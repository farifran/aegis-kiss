import test from "node:test";
import assert from "node:assert/strict";
import {
  TokenBucket,
  encodeBucketStatus,
  type TokenBucketConfig,
} from "./tokenBucket.js";
import {
  TokenBucketGate,
  decisionsSince,
  type GateDecision,
} from "./tokenBucketGate.js";
import { TokenBucketPlan } from "./tokenBucketPlan.js";
import { summarizeDecisions } from "./tokenBucketSummary.js";

const tinyConfig: TokenBucketConfig = {
  rateMBps: 1,
  capacityBits: 100n,
};

test("encodeBucketStatus packs empty + refillActive bits", () => {
  assert.equal(encodeBucketStatus(false, false), 0);
  assert.equal(encodeBucketStatus(true, false), 0b00000001);
  assert.equal(encodeBucketStatus(false, true), 0b00000010);
  assert.equal(encodeBucketStatus(true, true), 0b00000011);
});

test("TokenBucket starts full and consume drains", () => {
  const b = new TokenBucket(tinyConfig);
  assert.equal(b.consume(40n, 1_000n), true);
  assert.equal(b.consume(40n, 1_000n), true);
  assert.equal(b.consume(40n, 1_000n), false);
  assert.equal(b.statusMask(1_000n) & 0b01, 0); // not empty (20 left)
  assert.equal(b.statusMask(1_000n) & 0b10, 0b10); // refill active (partial)
});

test("TokenBucket refill over time restores capacity", () => {
  // rateMBps=1 → rateBitsPerMs = floor(1*1024*1024*8/1000) = 8388
  // capacity 100: first consume drains; wait enough ms to refill to full
  const b = new TokenBucket({ rateMBps: 1, capacityBits: 100n });
  assert.equal(b.consume(100n, 0n), true);
  assert.equal(b.consume(1n, 0n), false);
  // one ms of refill >> 100 capacity → full again
  assert.equal(b.consume(100n, 1n), true);
});

test("TokenBucket dt<=0 does not invent tokens", () => {
  const b = new TokenBucket(tinyConfig);
  assert.equal(b.consume(50n, 10n), true);
  // same clock / going backwards should not refill
  assert.equal(b.consume(50n, 10n), true);
  assert.equal(b.consume(1n, 5n), false);
});

test("TokenBucketGate clamps priority and stamps mask", () => {
  const g = new TokenBucketGate(tinyConfig);
  const d = g.tryConsume(10n, 99, 50n);
  assert.equal(d.priority, 63);
  assert.equal(d.allowed, true);
  assert.equal(d.nowMs, 50n);
  assert.equal((d.mask >> 2) & 63, 63);
  assert.equal(g.getLog().length, 1);
});

test("TokenBucketGate tryConsume without nowMs uses wall clock", () => {
  const g = new TokenBucketGate(tinyConfig);
  const before = BigInt(Date.now());
  const d = g.tryConsume(1n, 0);
  const after = BigInt(Date.now());
  assert.ok(d.nowMs >= before && d.nowMs <= after);
});

test("decisionsSince filters by nowMs", () => {
  const log: GateDecision[] = [
    { nowMs: 10n, bits: 1n, priority: 0, allowed: true, mask: 0 },
    { nowMs: 20n, bits: 2n, priority: 1, allowed: false, mask: 0 },
    { nowMs: 30n, bits: 3n, priority: 2, allowed: true, mask: 0 },
  ];
  const since = decisionsSince(log, 20n);
  assert.equal(since.length, 2);
  assert.equal(since[0]?.nowMs, 20n);
  assert.equal(since[1]?.nowMs, 30n);
});

test("summarizeDecisions aggregates counts and bit totals", () => {
  const log: GateDecision[] = [
    { nowMs: 1n, bits: 10n, priority: 0, allowed: true, mask: 0 },
    { nowMs: 2n, bits: 5n, priority: 0, allowed: false, mask: 0 },
    { nowMs: 3n, bits: 7n, priority: 0, allowed: true, mask: 0 },
  ];
  const s = summarizeDecisions(log);
  assert.equal(s.total, 3);
  assert.equal(s.allowed, 2);
  assert.equal(s.denied, 1);
  assert.equal(s.totalBitsAllowed, 17n);
  assert.equal(s.totalBitsDenied, 5n);
});

test("summarizeDecisions empty log", () => {
  const s = summarizeDecisions([]);
  assert.deepEqual(s, {
    total: 0,
    allowed: 0,
    denied: 0,
    totalBitsAllowed: 0n,
    totalBitsDenied: 0n,
  });
});

test("TokenBucketPlan sorts by atMs and drives offline clock", () => {
  const plan = new TokenBucketPlan({ rateMBps: 1, capacityBits: 100n });
  // out-of-order input; second item in time is huge and should deny after drain
  const result = plan.simulate([
    { bits: 60n, priority: 1, atMs: 200n },
    { bits: 60n, priority: 2, atMs: 100n },
    { bits: 60n, priority: 3, atMs: 300n },
  ]);
  assert.equal(result.items[0]?.atMs, 100n);
  assert.equal(result.items[1]?.atMs, 200n);
  assert.equal(result.items[2]?.atMs, 300n);
  // decisions use item clocks
  assert.equal(result.decisions[0]?.nowMs, 100n);
  assert.equal(result.decisions[1]?.nowMs, 200n);
  assert.equal(result.decisions[2]?.nowMs, 300n);
  // 60+60 ok, third denies (capacity 100, little refill in 200ms of tiny wait…
  // rateBitsPerMs is large so refill between 100→200 and 200→300 may refill fully.
  // Use capacity and times that isolate drain without full refill:
  assert.equal(result.decisions[0]?.allowed, true);
  // After first consume at 100: 40 left. At 200: huge refill → full 100; 60 ok.
  // At 300: refill again → full; 60 ok. So allAllowed may be true with rateMBps=1.
  // Re-assert with zero-rate-like: capacity only, consume all at same timeline spacing
  // that still refills. Better dedicated case below.
  assert.equal(result.decisions.length, 3);
});

test("TokenBucketPlan denies when capacity exhausted without refill room", () => {
  // capacity 50; two items 40 at same ms → second denies (dt=0 no refill)
  const plan = new TokenBucketPlan({ rateMBps: 1, capacityBits: 50n });
  const result = plan.simulate([
    { bits: 40n, priority: 0, atMs: 1_000n },
    { bits: 40n, priority: 0, atMs: 1_000n },
  ]);
  assert.equal(result.decisions[0]?.allowed, true);
  assert.equal(result.decisions[1]?.allowed, false);
  assert.equal(result.allAllowed, false);

  const since = plan.decisionsSinceMs(1_000n);
  assert.equal(since.length, 2);
});
