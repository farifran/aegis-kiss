export class TokenBucket {
  private _maxTokens: bigint;
  private _tokens: bigint;
  private _lastUpdate: bigint;
  private _rateBitsPerMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes;
    this._tokens = maxBytes;
    this._lastUpdate = BigInt(Date.now());
    this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000));
  }

  update(): void {
    const now = BigInt(Date.now());
    const timeDiff = now - this._lastUpdate;

    if (timeDiff > 0n) {
      this._tokens += timeDiff * this._rateBitsPerMs;
      this._lastUpdate = now;
    }

    if (this._tokens > this._maxTokens) {
      this._tokens = this._maxTokens;
    }
  }

  consume(bits: bigint): boolean {
    if (bits < 0n) {
      return false;
    }

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

  get refillActive(): boolean {
    return this._tokens < this._maxTokens;
  }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
    mask |= 1;
  }
  if (bucket.refillActive) {
    mask |= 2;
  }
  return mask;
}
