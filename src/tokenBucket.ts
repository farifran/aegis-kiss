import { BigInt } from '@graphprotocol/graph-ts';

export class TokenBucket {
  private bucket: BigInt;
  private refillTimestamp: BigInt;
  private refillInterval: BigInt;
  private refillCount: BigInt;
  private refillBitmask: number;

  constructor(refillInterval: BigInt, refillCount: BigInt) {
    this.bucket = BigInt.fromI64(0);
    this.refillTimestamp = BigInt.fromI64(0);
    this.refillInterval = refillInterval;
    this.refillCount = refillCount;
    this.refillBitmask = 0b00000001; // bit 0: esgotado, bit 1: em refil ativo
  }

  public consume(bits: BigInt): boolean {
    const now = BigInt.fromI64(Date.now());
    if (this.refillTimestamp > now) {
      return false;
    }

    const refillNeeded = this.bucket < bits;
    if (refillNeeded) {
      this.refill();
    }

    this.bucket = this.bucket.add(bits);
    return true;
  }

  private refill(): void {
    const now = BigInt.fromI64(Date.now());
    const refillIntervalMs = this.refillInterval.toI64();
    const refillCountMs = this.refillCount.toI64();
    const refillIntervalNs = BigInt.fromI64(refillIntervalMs * 1e6);
    const refillCountNs = BigInt.fromI64(refillCountMs * 1e6);

    this.refillTimestamp = now.add(refillIntervalNs);
    this.refillCount = this.refillCount.add(refillCountNs);
    this.refillBitmask = 0b00000001; // reset refill bitmask
  }

  public getBucket(): BigInt {
    return this.bucket;
  }

  public getRefillTimestamp(): BigInt {
    return this.refillTimestamp;
  }

  public getRefillInterval(): BigInt {
    return this.refillInterval;
  }

  public getRefillCount(): BigInt {
    return this.refillCount;
  }

  public getRefillBitmask(): number {
    return this.refillBitmask;
  }
}

export function createTokenBucket(refillInterval: BigInt, refillCount: BigInt): TokenBucket {
  return new TokenBucket(refillInterval, refillCount);
}
