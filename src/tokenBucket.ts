export class TokenBucket {
  private _maxBytes: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastRefill: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxBytes = maxBytes;
    this._rateBitsPerMs = BigInt(mbps * 8000);
    this._tokens = 0n;
    this._lastRefill = BigInt(Date.now());
  }

  get maxBytes(): bigint {
    return this._maxBytes;
  }

  get tokens(): bigint {
    return this._tokens;
  }

  update(): void {
    const now = BigInt(Date.now());
    const elapsed = now - this._lastRefill;
    if (elapsed > 0n) {
      this._tokens += elapsed * this._rateBitsPerMs / 1000n;
      if (this._tokens > this.maxBytes) this._tokens = this.maxBytes;
    }
    this._lastRefill = now;
  }

  consume(bits: bigint): boolean {
    this.update();
    if (this.tokens < bits) return false;
    this._tokens -= bits;
    return true;
  }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) mask |= 1;
  mask |= 2;
  return mask;
}
