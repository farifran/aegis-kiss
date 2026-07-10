// High-precision, offline-first Token Bucket rate limiter.
//
// Tokens are counted in BITS and refilled lazily (computed on each
// request) at a rate expressed in bits per millisecond. Timestamps and
// token counts are BigInt to avoid floating-point drift over long runs.
//
// Deterministic unit convention (kept consistent throughout):
//   1 MB   = 1_000_000 bytes
//   1 byte = 8 bits
// so 1 MB/s = 8_000_000 bits/s = 8_000 bits/ms.

const BITS_PER_BYTE = 8n;
const BYTES_PER_MEGABYTE = 1_000_000;
const MILLISECONDS_PER_SECOND = 1_000n;

export interface TokenBucketConfig {
  /** Sustained refill rate in MegaBytes per second (MB/s). Must be >= 0. */
  mbPerSecond: number;
  /** Maximum bucket capacity in MegaBytes (MB). Must be >= 0. */
  capacityMb: number;
}

export class TokenBucket {
  private tokens: bigint;
  private lastRefillTime: bigint;
  private readonly capacity: bigint;
  private readonly refillRateBitMs: bigint;

  constructor(config: TokenBucketConfig) {
    const { mbPerSecond, capacityMb } = config;

    if (!Number.isFinite(mbPerSecond) || mbPerSecond < 0) {
      throw new Error(
        `TokenBucket: mbPerSecond must be a non-negative finite number, got ${mbPerSecond}`
      );
    }
    if (!Number.isFinite(capacityMb) || capacityMb < 0) {
      throw new Error(
        `TokenBucket: capacityMb must be a non-negative finite number, got ${capacityMb}`
      );
    }

    // MB/s -> bits/ms: (MB * 1_000_000 * 8) / 1_000
    this.refillRateBitMs =
      (BigInt(Math.floor(mbPerSecond * BYTES_PER_MEGABYTE)) * BITS_PER_BYTE) /
      MILLISECONDS_PER_SECOND;

    // MB -> bits: MB * 1_000_000 * 8
    this.capacity =
      BigInt(Math.floor(capacityMb * BYTES_PER_MEGABYTE)) * BITS_PER_BYTE;

    this.tokens = this.capacity;
    this.lastRefillTime = this.getCurrentTimestamp();
  }

  private getCurrentTimestamp(): bigint {
    // Millisecond epoch as BigInt; only deltas are consumed, so an
    // epoch-based clock is sufficient and portable across JS runtimes.
    return BigInt(Date.now());
  }

  /** Lazily accrue tokens for the elapsed time, capped at capacity. */
  private refill(): void {
    const now = this.getCurrentTimestamp();
    const delta = now - this.lastRefillTime;

    if (delta > 0n) {
      const refillAmount = delta * this.refillRateBitMs;
      this.tokens += refillAmount;
      if (this.tokens > this.capacity) {
        this.tokens = this.capacity;
      }
      this.lastRefillTime = now;
    }
  }

  /**
   * Attempt to consume `bits` tokens.
   * @returns true if consumed, false if insufficient tokens.
   * @throws if `bits` is negative.
   */
  public consume(bits: number): boolean {
    if (!Number.isFinite(bits) || bits < 0) {
      throw new Error(
        `TokenBucket: cannot consume a negative or non-finite amount, got ${bits}`
      );
    }

    this.refill();
    const requested = BigInt(Math.floor(bits));

    if (this.tokens >= requested) {
      this.tokens -= requested;
      return true;
    }
    return false;
  }

  /**
   * Encode the current bucket state into an 8-bit mask.
   *   Bit 0 (1 << 0): Exhausted        — tokens == 0n
   *   Bit 1 (1 << 1): Active refill     — tokens < capacity
   *   Bits 2-7:       Reserved priority flags (default 0)
   * @param priorityFlags 0-63; occupies bits 2-7 of the returned mask.
   */
  public getStateMask(priorityFlags: number = 0): number {
    this.refill();
    let mask = 0;

    if (this.tokens === 0n) {
      mask |= 1 << 0;
    }

    if (this.tokens < this.capacity) {
      mask |= 1 << 1;
    }

    // Priority flags occupy bits 2-7 (6 bits): clamp to 0-63, shift left 2.
    mask |= (priorityFlags & 0x3f) << 2;

    return mask & 0xff;
  }
}

export function encodeBucketState(
  bucket: TokenBucket,
  priority: number = 0
): number {
  return bucket.getStateMask(priority);
}
