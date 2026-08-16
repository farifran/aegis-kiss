/**
 * TokenBucket class to manage token consumption and refill.
 */
export class TokenBucket {
  private _maxBytes: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastRefill: bigint;

  /**
   * Constructor to initialize the TokenBucket with maxBytes and rateBitsPerMs.
   * @param maxBytes The maximum number of bytes that can be consumed.
   * @param mbps The rate in megabits per second.
   */
  constructor(maxBytes: bigint, mbps: number) {
    this._rateBitsPerMs = BigInt(mbps * 8000);
    this._tokens = 0n;
    this._lastRefill = BigInt(Date.now());
    this._maxBytes = maxBytes;
  }

  /**
   * Update the token bucket by adding tokens based on the elapsed time since the last refill.
   */
  update(): void {
    const now = BigInt(Date.now());
    const elapsed = now - this._lastRefill;
    if (elapsed > 0n) {
      this._tokens += elapsed * this._rateBitsPerMs / 1000n;
      if (this._tokens > this._maxBytes) {
        this._tokens = this._maxBytes;
      }
    }
    this._lastRefill = now;
  }

  /**
   * Consume a certain number of bits from the token bucket.
   * @param bits The number of bits to consume.
   * @returns True if the consumption is successful, false otherwise.
   */
  consume(bits: bigint): boolean {
    this.update();
    if (this._tokens < bits) {
      return false;
    }
    this._tokens -= bits;
    return true;
  }

  /**
   * Get the maximum bytes that can be consumed.
   */
  getMaxBytes(): bigint {
    return this._maxBytes;
  }

  /**
   * Get the current tokens.
   */
  getTokens(): bigint {
    return this._tokens;
  }

  /**
   * Get the last refill time.
   */
  getLastRefill(): bigint {
    return this._lastRefill;
  }

  /**
   * Get the current tokens.
   */
  get tokens(): bigint {
    return this._tokens;
  }

  /**
   * Get the maximum bytes that can be consumed.
   */
  get maxBytes(): bigint {
    return this._maxBytes;
  }
}

/**
 * Get the current state of the token bucket as a bitmask.
 * @param bucket The TokenBucket instance.
 * @returns A bitmask representing the current state of the token bucket.
 */
export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
    mask |= 1;
  }
  if (bucket.tokens < bucket.maxBytes) {
    mask |= 2;
  }
  return mask;
}
