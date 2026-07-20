/**
 * High-precision offline-first Token Bucket.
 */
export class TokenBucket {
  private refillTimestamp: bigint;
  private rate: bigint;
  private tokens: bigint;

  constructor(rate: number) {
    this.rate = BigInt(rate);
    this.refillTimestamp = BigInt(Date.now());
    this.tokens = 0n;
  }

  public consume(amount: number): boolean {
    const now = BigInt(Date.now());
    const timeElapsed = now - this.refillTimestamp;
    const tokensAvailable = (timeElapsed * this.rate) / 1000n;
    if (this.tokens + tokensAvailable >= amount) {
      this.tokens += BigInt(amount);
      this.refillTimestamp = now;
      return true;
    }
    return false;
  }

  public encodeState(): number {
    const state = (this.tokens & 0xFFn) | ((this.refillTimestamp & 0xFFFFFFFFn) >> 32n);
    return Number(state);
  }
}
