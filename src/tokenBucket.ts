export class TokenBucket {
  private _tokens: bigint;
  private _maxTokens: bigint;
  private _lastUpdate: bigint;
  private _refillActive: boolean;
  private rateBitsPerMs: bigint;

  constructor(maxTokens: bigint, mbps: number) {
    this._maxTokens = maxTokens
    this._tokens = maxTokens
    this._lastUpdate = BigInt(Date.now())
    this._refillActive = false
    this.rateBitsPerMs = BigInt(mbps * 8000)
  }

  update(): void {
    const now = BigInt(Date.now())
    const timeDiff = now - this._lastUpdate
    if (timeDiff > 0n) {
      this._tokens += timeDiff * this.rateBitsPerMs;
      this._lastUpdate = now;
    }
    if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens }
    this._refillActive = this._tokens < this._maxTokens
  }

  consume(bits: bigint): boolean {
    this.update();
    if (this._tokens >= bits) {
      this._tokens -= bits;
      return true;
    }
    return false;
  }

  get tokens(): bigint { return this._tokens }

  get refillActive(): boolean { return this._refillActive }
}
