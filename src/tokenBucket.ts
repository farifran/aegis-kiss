export class TokenBucket {
  private rateMBps: number;
  private refill: bigint;
  private statusMask: number;

  constructor(config: number) {
    this.rateMBps = config;
    this.refill = 0n;
    this.statusMask = 0b00000001; // bit0 empty, bit1 refill active
  }

  consume(bits: bigint, nowMs?: bigint): boolean {
    if (nowMs === undefined) {
      nowMs = BigInt(Date.now());
    }
    this.refill = this.refill + BigInt(this.rateMBps * 1000 / 1024 / 1024 / 1024); // convert MB/s to bits per ms
    if (this.refill >= bits) {
      this.refill -= bits;
      return true;
    } else {
      return false;
    }
  }

  getStatusMask(): number {
    return this.statusMask;
  }
}
