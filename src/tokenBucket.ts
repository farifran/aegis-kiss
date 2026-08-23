export class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000));
    this._tokens = this._maxTokens;
    this._lastUpdateMs = 0n;
  }

  update(nowMs: bigint | undefined): void {
    const current = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (this._lastUpdateMs > 0n && current > this._lastUpdateMs) {
    const diff = current - this._lastUpdateMs;
    const added = diff * this._rateBitsPerMs;
    this._tokens += added;
    if (this._tokens > this._maxTokens) {
    this._tokens = this._maxTokens;
    }
    }
    this._lastUpdateMs = current;
  }

  consume(bits: bigint): boolean {
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
}
