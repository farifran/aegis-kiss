/**
 * High-precision Token Bucket rate limiter for offline-first control.
 */
export class TokenBucket {
  private capacity: bigint;
  private rateInBitsPerMs: bigint;
  private tokens: bigint;
  private lastRefillTime: bigint;

  constructor(capacityInMB: number, refillRateInMBs: number) {
    // 1 MB = 1,000,000 Bytes = 8,000,000 bits
    this.capacity = BigInt(Math.round(capacityInMB * 8000000));
    this.rateInBitsPerMs = BigInt(Math.round(refillRateInMBs * 8000));
    this.tokens = this.capacity;
    this.lastRefillTime = TokenBucket.getHighPrecisionTimestamp();
  }

  private static getHighPrecisionTimestamp(): bigint {
    if (
      typeof process !== 'undefined' &&
      process.hrtime &&
      typeof process.hrtime.bigint === 'function'
    ) {
      return process.hrtime.bigint();
    }
    // Fallback to milliseconds converted to nanoseconds
    return BigInt(Date.now()) * 1000000n;
  }

  private refill(): void {
    const now = TokenBucket.getHighPrecisionTimestamp();
    const elapsed = now - this.lastRefillTime;
    if (elapsed <= 0n) {
      return;
    }

    // rate is in bits per ms. 1 ms = 1,000,000 ns.
    // tokens to add = (elapsed ns * rate in bits/ms) / 1,000,000
    const tokensToAdd = (elapsed * this.rateInBitsPerMs) / 1000000n;
    if (tokensToAdd > 0n) {
      this.tokens = this.tokens + tokensToAdd;
      if (this.tokens > this.capacity) {
        this.tokens = this.capacity;
      }
      this.lastRefillTime = now;
    }
  }

  /**
   * Consumes the specified number of bits.
   * Returns true if consumed successfully, false otherwise.
   */
  public consume(bits: number | bigint): boolean {
    this.refill();
    const bitsToConsume = BigInt(bits);
    if (this.tokens >= bitsToConsume) {
      this.tokens -= bitsToConsume;
      return true;
    }
    return false;
  }

  /**
   * Consumes the specified number of MegaBytes.
   * Returns true if consumed successfully, false otherwise.
   */
  public consumeMB(mb: number): boolean {
    const bits = BigInt(Math.round(mb * 8000000));
    return this.consume(bits);
  }

  /**
   * Returns the current number of tokens (bits) in the bucket after refilling.
   */
  public getTokens(): bigint {
    this.refill();
    return this.tokens;
  }

  /**
   * Returns the maximum capacity of the bucket in bits.
   */
  public getCapacity(): bigint {
    return this.capacity;
  }
}

/**
 * Encodes the current state of the bucket into an 8-bit bitmask.
 * - bit 0: exhausted (1 if tokens == 0, 0 otherwise)
 * - bit 1: active refill (1 if tokens < capacity, 0 otherwise)
 * - bits 2-7: reserved for priority flags (0-63)
 */
export function getBucketStateMask(bucket: TokenBucket, priorityFlags = 0): number {
  const tokens = bucket.getTokens();
  const capacity = bucket.getCapacity();

  let mask = 0;

  // bit 0: esgotado
  if (tokens === 0n) {
    mask |= 1;
  }

  // bit 1: em refil ativo
  if (tokens < capacity) {
    mask |= 2;
  }

  // bits 2-7: flags de prioridade
  const cleanPriority = priorityFlags & 0x3f;
  mask |= (cleanPriority << 2);

  return mask;
}
