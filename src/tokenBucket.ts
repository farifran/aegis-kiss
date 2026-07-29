// This file implements a high-precision token bucket algorithm for rate limiting.
// It accumulates tokens based on a specified consumption rate and provides a way to check if a request is allowed.

export class TokenBucket {
  private readonly capacity: bigint;
  private readonly refillRate: bigint;
  private tokens: bigint;

  constructor(capacity: bigint, refillRate: bigint) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = 0n;
  }

  // Add tokens to the bucket based on the refill rate.
  public refill(refillRate: bigint): void {
    this.tokens = BigInt(Math.min(Number(this.capacity), Number(this.tokens + refillRate)));
  }

  // Check if a request is allowed based on the current token count.
  public isAllowed(): boolean {
    return this.tokens >= 1n;
  }
}
