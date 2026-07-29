// This file implements a high-precision token bucket algorithm for rate limiting.
// It accumulates tokens based on a specified consumption rate and provides a way to check if a certain amount of tokens is available.

export class TokenBucket {
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private tokens: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = 0;
  }

  public async acquireTokens(amount: number): Promise<boolean> {
    if (this.tokens >= amount) {
      this.tokens -= amount;
      return true;
    }

    const refillAmount = this.refillRate * Math.floor(Date.now() / 1000);
    this.tokens = Math.min(this.maxTokens, this.tokens + refillAmount);
    return this.tokens >= amount;
  }

  public refillTokenBucket(): void {
    const now = Math.floor(Date.now() / 1000);
    const refillAmount = this.maxTokens * (now - Math.floor(now / 60));
    this.tokens = Math.min(this.maxTokens, this.tokens + refillAmount);
  }
}

function refillTokenBucket(tokenBucket: TokenBucket): void {
  tokenBucket.refillTokenBucket();
}

export { refillTokenBucket as default };
