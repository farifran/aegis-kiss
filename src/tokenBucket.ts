// src/tokenBucket.ts
export class TokenBucket {
  private _maxTokens: bigint;
  private _tokens: bigint;
  private _rateBitsPerMs: bigint;
  private _lastUpdate: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8000000n;
    this._tokens = this._maxTokens;
    this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000));
    this._lastUpdate = BigInt(Date.now());
  }

  update(): void {
    const now = BigInt(Date.now());
    const delta = now - this._lastUpdate;
    if (delta > 0n) {
      this._tokens = this._tokens + delta * this._rateBitsPerMs;
      if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens; }
      this._lastUpdate = now;
    }
  }

  consume(bits: bigint): boolean {
    this.update();
    if (this._tokens >= bits) { this._tokens = this._tokens - bits; return true; }
    return false;
  }

  get tokens(): bigint { return this._tokens; }
  get lastUpdate(): bigint { return this._lastUpdate; }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0
  if (bucket.tokens === 0n) mask |= 1
  if (BigInt(Date.now()) - bucket.lastUpdate < 1000n) mask |= 2
  return mask
}
