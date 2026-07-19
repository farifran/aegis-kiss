export type TokenBucketConfig = {
  rateMBps: number;
  capacityBits?: bigint;
};

export class TokenBucket {
  private rateBitsPerMs: bigint;
  private capacityBits: bigint;
  private tokens: bigint;
  private lastMs: bigint;

  constructor(config: TokenBucketConfig) {
    this.rateBitsPerMs = BigInt(
      Math.floor((config.rateMBps * 1024 * 1024 * 8) / 1000),
    );
    this.capacityBits =
      config.capacityBits !== undefined
        ? config.capacityBits
        : this.rateBitsPerMs * 1000n;
    this.tokens = this.capacityBits;
    this.lastMs = 0n;
  }

  private refill(nowMs: bigint): void {
    if (this.lastMs === 0n) {
      this.lastMs = nowMs;
      return;
    }
    const dt = nowMs - this.lastMs;
    if (dt <= 0n) {
      return;
    }
    this.tokens += this.rateBitsPerMs * dt;
    if (this.tokens > this.capacityBits) {
      this.tokens = this.capacityBits;
    }
    this.lastMs = nowMs;
  }

  consume(bits: bigint, nowMs?: bigint): boolean {
    this.refill(nowMs !== undefined ? nowMs : BigInt(Date.now()));
    if (this.tokens >= bits) {
      this.tokens -= bits;
      return true;
    }
    return false;
  }

  statusMask(nowMs?: bigint): number {
    this.refill(nowMs !== undefined ? nowMs : BigInt(Date.now()));
    let mask = 0;
    if (this.tokens === 0n) {
      mask |= 0b00000001;
    }
    if (this.tokens < this.capacityBits) {
      mask |= 0b00000010;
    }
    return mask & 0xff;
  }
}

export function encodeBucketStatus(
  empty: boolean,
  refillActive: boolean,
): number {
  let mask = 0;
  if (empty) {
    mask |= 0b00000001;
  }
  if (refillActive) {
    mask |= 0b00000010;
  }
  return mask & 0xff;
}
