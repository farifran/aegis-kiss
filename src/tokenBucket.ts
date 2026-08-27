export class TokenBucket {
  private _maxTokens: bigint;
  private _tokens: bigint;
  private _rateBitsPerMs: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    if (maxBytes < 0n) throw new RangeError("maxBytes must be non-negative");
    if (mbps < 0) throw new RangeError("mbps must be non-negative");
    this._maxTokens = maxBytes * 8n;
    this._tokens = this._maxTokens;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(nowMs: bigint | undefined): void {
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (now < this._lastUpdateMs) { this._lastUpdateMs = now; return; }
    const timeDiff = now - this._lastUpdateMs;
    this._lastUpdateMs = now;
    if (timeDiff > 0n && this._rateBitsPerMs > 0n) {
    const replenished = this._tokens + (timeDiff * this._rateBitsPerMs);
    this._tokens = replenished > this._maxTokens ? this._maxTokens : replenished;
    }
  }

  consume(bits: bigint): boolean {
    if (bits < 0n) throw new RangeError("bits must be non-negative");
    this.update(undefined);
    if (this._tokens >= bits) {
    this._tokens -= bits;
    return true;
    }
    return false;
  }

  get tokens(): bigint { return this._tokens; }

  get maxTokens(): bigint { return this._maxTokens; }

  get rateBitsPerMs(): bigint { return this._rateBitsPerMs; }

  get lastUpdateMs(): bigint { return this._lastUpdateMs; }

  get refillActive(): boolean { return this._tokens < this._maxTokens; }
}
