export class TokenBucket {
  private capacity: bigint;
  private tokens: bigint;
  private rateBitsPerMs: bigint;
  private lastRefill: bigint;

  constructor(config: { capacityMB: number; rateMBps: number }) {
    this.capacity = BigInt(config.capacityMB) * 8388608n;
    this.rateBitsPerMs = BigInt(Math.round(config.rateMBps * 8388.608));
    this.tokens = this.capacity;
    this.lastRefill = 0n;
  }

  private refill(): void {
    const now = BigInt(Date.now());
    if (this.lastRefill === 0n) {
      this.lastRefill = now;
      return;
    }
    const elapsed = now - this.lastRefill;
    if (elapsed > 0n) {
      this.tokens += elapsed * this.rateBitsPerMs;
      if (this.tokens > this.capacity) this.tokens = this.capacity;
      this.lastRefill = now;
    }
  }

  consume(bits: number): boolean {
    this.refill();
    const need = BigInt(bits);
    if (this.tokens >= need) {
      this.tokens -= need;
      return true;
    }
    return false;
  }

  encodeState(): number {
    if (this.tokens === 0n) return 1;
    if (this.tokens === this.capacity) return 4;
    return 2;
  }
}
