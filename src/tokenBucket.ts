export class TokenBucket {
  private _tokens: bigint;
  private _maxTokens: bigint;
  private _lastUpdate: bigint;
  private _rateBitsPerMs: bigint;
  private _refillActive: boolean;

  constructor(maxTokens: bigint, rateBitsPerMs: bigint) {
    this._maxTokens = maxTokens;
    this._tokens = maxTokens;
    this._lastUpdate = BigInt(Date.now());
    this._rateBitsPerMs = rateBitsPerMs;
    this._refillActive = false;
  }

  update(): void {
    const now = BigInt(Date.now());
    const timeDiff = now - this._lastUpdate;
    if (timeDiff > 0n) {
      const refill = timeDiff * this._rateBitsPerMs;
      if (this._tokens + refill <= this._maxTokens) {
        this._tokens += refill;
      } else {
        this._tokens = this._maxTokens;
      }
      this._lastUpdate = now;
      this._refillActive = this._tokens < this._maxTokens;
    }
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

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) mask |= 1;
  if (bucket.refillActive) mask |= 2;
  return mask;
}
