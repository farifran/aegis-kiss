class TokenBucket {
  private rate: bigint;
  private refillTimestamp: number;
  private tokens: number;

  constructor(rate: number) {
    this.rate = BigInt(rate);
    this.refillTimestamp = Math.floor(Date.now() / 1000);
    this.tokens = 0;
  }

  public consume(amount: number): boolean {
    if (this.tokens >= amount) {
      this.tokens -= amount;
      return true;
    } else {
      return false;
    }
  }

  public encodeState(): number {
    const state = (this.tokens << 8) | (this.refillTimestamp % 256);
    return state;
  }
}

export { TokenBucket };
