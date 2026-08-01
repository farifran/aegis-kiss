class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdate: bigint;
  private _refillActive: boolean;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(mbps) * 8000n;
    this._tokens = this._maxTokens;
    this._lastUpdate = BigInt(Date.now());
    this._refillActive = false;
  }

  update(): void {
    const now = BigInt(Date.now());
    const timeDiff = now - this._lastUpdate;
    this._lastUpdate = now;
    let newTokens = this._tokens + BigInt(timeDiff * this._rateBitsPerMs);
    if (newTokens > this._maxTokens) { newTokens = this._maxTokens }
    this._refillActive = newTokens > this._tokens;
    this._tokens = newTokens;
  }

  consume(bits: bigint): boolean {
    this.update();
    if (this._tokens >= bits) { this._tokens -= bits; return true }
    return false;
  }

  get tokens(): bigint { return this._tokens }
  get refillActive(): boolean { return this._refillActive }
}

export { TokenBucket };

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0
  if (bucket.tokens === 0n) { mask |= 1 }
  if (bucket.refillActive) { mask |= 2 }
  return mask
}
