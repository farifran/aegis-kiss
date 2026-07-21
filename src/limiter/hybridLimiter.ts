// INTENTIONAL HOLES (acceptance names present; fidelity incomplete):
// - does NOT import BIT_* / converters from ./types.js (local redefs)
// - does NOT import SlidingWindow from ./window.js (inline array)
// - constructor calls Date.now()
// - no tryConsume, no softExceeded
// - encodeState missing bit4/bit5
// - consume has no non-positive guard
// - peekTokens pushes window (must not)

import { BIT_EMPTY, BIT_PARTIAL, BIT_SATURATED, BIT_CLOCK } from './types.js';

export class HybridLimiter {
  private capacity: bigint;
  private tokens: bigint;
  private rateBitsPerMs: bigint;
  private lastRefill: bigint;
  private clockInjected = false;
  private injected: bigint | null = null;
  private window: bigint[] = [];
  private windowSize: number;

  constructor(config: { capacityMB: number; rateMBps: number; windowSize: number }) {
    // HOLE: should use mbToBits / mbpsToBitsPerMs from types
    this.capacity = BigInt(config.capacityMB) * 8388608n;
    this.tokens = this.capacity;
    this.rateBitsPerMs = BigInt(Math.round(config.rateMBps * 8388.608));
    // HOLE: Date.now in constructor
    this.lastRefill = BigInt(Date.now());
    this.windowSize = config.windowSize;
  }

  private now(): bigint {
    if (this.clockInjected && this.injected !== null) {
      return this.injected;
    }
    return BigInt(Date.now());
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0n) {
      this.tokens += elapsed * this.rateBitsPerMs;
      if (this.tokens > this.capacity) {
        this.tokens = this.capacity;
      }
      this.lastRefill = t;
    }
  }

  public setClock(ms: bigint): void {
    this.injected = ms;
    this.clockInjected = true;
  }

  public consume(bits: number): boolean {
    this.refill();
    // HOLE: no bits <= 0 guard
    const need = BigInt(bits);
    if (this.tokens >= need) {
      this.tokens -= need;
      this.window.push(this.now());
      return true;
    }
    return false;
  }

  // HOLE: tryConsume missing

  public peekTokens(): bigint {
    this.refill();
    // HOLE: must not push window
    this.window.push(this.now());
    return this.tokens;
  }

  // HOLE: softExceeded missing

  public encodeState(): number {
    let s = 0;
    if (this.tokens === 0n) s |= BIT_EMPTY;
    if (this.tokens > 0n && this.tokens < this.capacity) s |= BIT_PARTIAL;
    if (this.tokens === this.capacity) s |= BIT_SATURATED;
    if (this.clockInjected) s |= BIT_CLOCK;
    // HOLE: BIT_WINDOW_FULL and BIT_SOFT not applied
    return s;
  }
}
