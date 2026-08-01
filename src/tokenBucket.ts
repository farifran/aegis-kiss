class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdate: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000));
    this._tokens = this._maxTokens;
    this._lastUpdate = BigInt(Date.now());
  }

  update(): void {
    const now = BigInt(Date.now());
    const timeDiff = now - this._lastUpdate;
    this._lastUpdate = now;
    let newTokens = this._tokens + timeDiff * this._rateBitsPerMs;
    if (newTokens > this._maxTokens) {
      newTokens = this._maxTokens;
    }
    this._tokens = newTokens;
  }

  consume(bits: bigint): boolean {
    this.update();
    if (this._tokens >= bits) {
      this._tokens -= bits;
      return true;
    }
    return false;
  }

  get tokens(): bigint {
    return this._tokens;
  }

  get maxTokens(): bigint {
    return this._maxTokens;
  }

  get lastUpdate(): bigint {
    return this._lastUpdate;
  }
}

export { TokenBucket };
