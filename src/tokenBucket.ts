/**
 * High-precision offline-first Token Bucket rate limiter.
 * Public config in MB/s; internal accumulation in bit/ms.
 * Lazy refill with BigInt timestamps.
 * 8-bit state bitmask (bit0 empty, bit1 refill active, bits2-7 reserved).
 */
export class TokenBucket {
  private readonly rateConfig: bigint;
  private accumulation: bigint;
  private refillTimestamp: bigint;
  public state: number;

  constructor(rateConfig: number) {
    this.rateConfig = BigInt(rateConfig);
    this.accumulation = 0n;
    this.refillTimestamp = 0n;
    this.state = 0;
  }

  public refill(): void {
    const now = BigInt(Date.now());
    this.accumulation = (now - this.refillTimestamp) * this.rateConfig;
    this.refillTimestamp = now;
    this.state = 1; // refill active
  }

  public consume(): void {
    if (this.state === 1) {
      this.refill();
    }
    this.accumulation -= 1n;
    if (this.accumulation < 0n) {
      this.accumulation = 0n;
    }
    if (this.accumulation === 0n) {
      this.state = 0; // empty
    }
  }

  public encodeState(): number {
    if (this.accumulation > 0n) {
      return 0x01; // empty
    } else if (this.state === 1) {
      return 0x02; // refill active
    } else {
      return 0xfc; // reserved
    }
  }
}
