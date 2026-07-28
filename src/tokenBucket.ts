export interface TokenBucketConfig {
  capacityMegabytes: number;
  refillRateMegabytesPerSecond: number;
}

const BITS_PER_BYTE = 8n;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const MILLISECONDS_PER_SECOND = 1_000n;

declare const process: {
  hrtime: {
    bigint(): bigint;
  };
};

export class TokenBucket {
  private capacityBits: bigint;
  private refillRateBitsPerMillisecond: bigint;
  private tokens: bigint;
  private lastRefillNanoseconds: bigint;

  constructor(config: TokenBucketConfig) {
    this.capacityBits = BigInt(Math.round(config.capacityMegabytes * 1_000_000)) * BITS_PER_BYTE;
    const refillRateBitsPerSecond = BigInt(Math.round(config.refillRateMegabytesPerSecond * 1_000_000)) * BITS_PER_BYTE;
    this.refillRateBitsPerMillisecond = refillRateBitsPerSecond / MILLISECONDS_PER_SECOND;
    this.tokens = this.capacityBits;
    this.lastRefillNanoseconds = process.hrtime.bigint();
  }

  private refill(currentNanoseconds: bigint): void {
    const elapsedNanoseconds = currentNanoseconds - this.lastRefillNanoseconds;
    if (elapsedNanoseconds <= 0n) {
      return;
    }
    const elapsedMilliseconds = elapsedNanoseconds / NANOSECONDS_PER_MILLISECOND;
    const tokensToAdd = elapsedMilliseconds * this.refillRateBitsPerMillisecond;
    this.tokens += tokensToAdd;
    if (this.tokens > this.capacityBits) {
      this.tokens = this.capacityBits;
    }
    this.lastRefillNanoseconds = currentNanoseconds;
  }

  public consume(bits: bigint): boolean {
    const currentNanoseconds = process.hrtime.bigint();
    this.refill(currentNanoseconds);
    if (this.tokens >= bits) {
      this.tokens -= bits;
      return true;
    }
    return false;
  }

  public getTokens(): bigint {
    return this.tokens;
  }

  public getCapacityBits(): bigint {
    return this.capacityBits;
  }

  public isExhausted(): boolean {
    return this.tokens <= 0n;
  }

  public isActiveRefill(): boolean {
    return this.tokens < this.capacityBits;
  }
}

export function codificarBucketState(bucket: TokenBucket): number {
  const isExhausted = bucket.isExhausted() ? 1 : 0;
  const isActiveRefill = bucket.isActiveRefill() ? 2 : 0;
  const reservedPriorityFlags = 0;
  return isExhausted | isActiveRefill | reservedPriorityFlags;
}
