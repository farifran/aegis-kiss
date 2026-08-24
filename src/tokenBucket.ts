export class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdate: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    const rate = BigInt(Math.trunc(mbps * 8000));
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = rate > 0n ? rate : 1n;
    this._tokens = this._maxTokens;
    this._lastUpdate = BigInt(Date.now());
  }

  update(): void {
    const now = BigInt(Date.now());
    const elapsed = now - this._lastUpdate;
    if (elapsed > 0n) {
    const refill = elapsed * this._rateBitsPerMs;
    const next = this._tokens + refill;
    this._tokens = next > this._maxTokens ? this._maxTokens : next;
    this._lastUpdate = now;
    }
  }

  consume(bits: bigint): boolean {
    this.update();
    if (bits <= 0n) {
    return true;
    }
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

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
  mask = mask | 1;
  }
  if (bucket.rateBitsPerMs > 0n) {
  mask = mask | 2;
  }
  return mask;
}
