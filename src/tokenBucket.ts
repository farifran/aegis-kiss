// This file implements a high-precision token bucket algorithm for rate limiting.
// It accumulates tokens based on a specified consumption rate for offline-first control.

export class TokenBucket {
  private tokens: bigint;
  private interval: number;
  private lastUpdate: number;

  constructor(interval: number, tokens: bigint) {
    this.tokens = tokens;
    this.interval = interval;
    this.lastUpdate = Date.now();
  }

  public getTokens(): bigint {
    const now = Date.now();
    const elapsed = now - this.lastUpdate;
    const tokensToAdd = elapsed * this.interval;
    this.tokens += BigInt(tokensToAdd);
    this.lastUpdate = now;
    return this.tokens;
  }

  public consumeTokens(amount: bigint): boolean {
    if (this.tokens >= amount) {
      this.tokens -= amount;
      return true;
    }
    return false;
  }
}
