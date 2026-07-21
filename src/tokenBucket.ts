export class TokenBucket {
  private capacity: bigint;
  private tokens: bigint;
  private ratePerMs: bigint;
  private lastRefill: bigint;

  constructor(config: { capacity: number; rateMBps: number }) {
    this.capacity = BigInt(config.capacity) * 8n * 1000000n;
    this.tokens = this.capacity;
    this.ratePerMs = BigInt(config.rateMBps) * 8n * 1000n;
    this.lastRefill = 0n;
  }

  private refill(): void {
    if (this.lastRefill === 0n) {
      this.lastRefill = BigInt(Date.now());
      return;
    }

    const now = BigInt(Date.now());
    const elapsed = now - this.lastRefill;
    
    if (elapsed > 0n) {
      const refillAmount = elapsed * this.ratePerMs;
      this.tokens = refillAmount + this.tokens;
      
      if (this.tokens > this.capacity) {
        this.tokens = this.capacity;
      }
      
      this.lastRefill = now;
    }
  }

  public consume(amount: number): boolean {
    this.refill();
    
    const amountBig = BigInt(amount) * 8n * 1000000n;
    
    if (this.tokens >= amountBig) {
      this.tokens -= amountBig;
      return true;
    }
    
    return false;
  }

  public encodeState(): number {
    let state = 0;
    
    if (this.tokens === 0n) {
      state |= 1 << 0;
    }
    
    if (this.lastRefill !== 0n) {
      state |= 1 << 1;
    }
    
    return state;
  }
}
