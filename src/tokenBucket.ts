class TokenBucket {
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private tokens: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = 0;
  }

  public async acquireToken(): Promise<boolean> {
    const now = Date.now();
    if (now === undefined) {
      return false;
    }
    const elapsed = now - this.tokens;
    const tokensToRefill = Math.floor(elapsed / this.refillRate) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToRefill);
    return this.tokens >= 1;
  }
}

export { TokenBucket };
