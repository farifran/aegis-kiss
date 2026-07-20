export class TokenBucket {
  private capacity: bigint;
  private tokens: bigint;
  private rateBitsPerMs: bigint;
  private lastRefillTime: bigint;

  constructor(config: { capacityMB: number; rateMBps: number }) {
    this.capacity = BigInt(config.capacityMB) * 8388608n; // MB to bits
    this.tokens = this.capacity;
    this.rateBitsPerMs = BigInt(config.rateMBps) * 8388n; // MB/s to bits/ms
    this.lastRefillTime = 0n;
  }

  private refill(): void {
    const now = BigInt(Date.now());
    if (this.lastRefillTime === 0n) {
      this.lastRefillTime = now;
      return;
    }
    const elapsed = now - this.lastRefillTime;
    const refillAmount = elapsed * this.rateBitsPerMs;
    this.tokens += refillAmount;
    if (this.tokens > this.capacity) {
      this.tokens = this.capacity;
    }
    this.lastRefillTime = now;
  }

  public consume(bits: number): boolean {
    this.refill();
    const bitsBigInt = BigInt(bits);
    if (this.tokens >= bitsBigInt) {
      this.tokens -= bitsBigInt;
      return true;
    }
    return false;
  }

  public encodeState(): number {
    let state = 0;
    if (this.tokens === 0n) {
      state |= 1; // bit0 empty
    }
    if (this.tokens < this.capacity) {
      state |= 2; // bit1 refill
    }
    // bits2-7 reserved
    return state;
  }
}
