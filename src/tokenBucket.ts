class TokenBucket {
  private readonly refillInterval: number;
  private refillTimestamp: bigint;
  private state: number;

  constructor(refillInterval: number) {
    this.refillInterval = refillInterval;
    this.refillTimestamp = BigInt(Math.floor(Date.now() / 1000));
    this.state = 0b00000001; // bit0 empty, bit1 refill active
  }

  public encodeState(): number {
    return this.state;
  }

  public consume(): boolean {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= this.refillTimestamp) {
      this.refillTimestamp = this.refillTimestamp + BigInt(this.refillInterval);
      this.state = 0b00000010; // bit1 refill active
    }
    if (this.state & 0b00000001) { // bit0 empty
      this.state = 0b00000000; // bit0 empty, bit1 refill active
      return true;
    }
    return false;
  }
}

export { TokenBucket };
