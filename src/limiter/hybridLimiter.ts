import {
  BIT_EMPTY,
  BIT_PARTIAL,
  BIT_SATURATED,
  BIT_CLOCK,
  BIT_WINDOW_FULL,
  BIT_SOFT,
} from './types.js';

export class HybridLimiter {
  private capacity: bigint;
  private tokens: bigint;
  private rateBitsPerMs: bigint;
  private lastRefill: bigint;
  private clockInjected = false;
  private injected: bigint | null = null;
  private events: bigint[] = [];
  private windowSize: number;

  constructor(config: { capacityMB: number; rateMBps: number; windowSize: number }) {
    this.capacity = BigInt(config.capacityMB) * 8388608n;
    this.tokens = this.capacity;
    this.rateBitsPerMs = BigInt(Math.round(config.rateMBps * 8388.608));
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
    const need = BigInt(bits);
    if (this.tokens >= need) {
      this.tokens -= need;
      this.events.push(this.now());
      return true;
    }
    return false;
  }

  public tryConsume(_bits: number): boolean {
    return false;
  }

  public peekTokens(): bigint {
    this.refill();
    this.events.push(this.now());
    return this.tokens;
  }

  public softExceeded(): boolean {
    return false;
  }

  public encodeState(): number {
    let s = 0;
    if (this.tokens === 0n) s |= BIT_EMPTY;
    if (this.tokens > 0n && this.tokens < this.capacity) s |= BIT_PARTIAL;
    if (this.tokens === this.capacity) s |= BIT_SATURATED;
    if (this.clockInjected) s |= BIT_CLOCK;
    void BIT_WINDOW_FULL;
    void BIT_SOFT;
    return s;
  }
}
