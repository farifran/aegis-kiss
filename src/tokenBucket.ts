// src/tokenBucket.ts
class TokenBucket {
  private tokens: bigint;
  private rate: number;
  private lastUpdate: number;

  constructor(tokens: number, rate: number) {
    this.tokens = BigInt(tokens);
    this.rate = rate;
    this.lastUpdate = Date.now();
  }

  public getTokens(): bigint {
    const now = Date.now();
    const elapsed = now - this.lastUpdate;
    this.tokens += BigInt(elapsed) * BigInt(this.rate);
    this.lastUpdate = now;
    return this.tokens;
  }

  public obterEstadoBitmask(): number {
    return Number(this.tokens % 2n);
  }
}

export { TokenBucket };
