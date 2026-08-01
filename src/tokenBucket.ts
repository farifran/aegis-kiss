// src/tokenBucket.ts
export class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: number;
  private _tokens: bigint;
  private _lastUpdate: bigint;
  private _refillActive: boolean;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = mbps * 8000;
    this._tokens = this._maxTokens;
    this._lastUpdate = BigInt(Date.now());
    this._refillActive = true;
  }

  update(): void {
    let now = BigInt(Date.now());
    let timeDiff = now - this._lastUpdate;
    this._lastUpdate = now;
    let refill = timeDiff * BigInt(this._rateBitsPerMs);
    this._tokens = this._tokens + refill;
    if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens; }
  }

  consume(bits: bigint): boolean {
    this.update();
    if (this._tokens >= bits) { this._tokens -= bits; return true; }
    return false;
  }

  get tokens(): bigint { return this._tokens; }
  get refillActive(): boolean { return this._refillActive; }
}
