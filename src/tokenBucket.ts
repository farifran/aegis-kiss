export class TokenBucket {
  private readonly _maxTokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    if (maxBytes <= 0n) throw new RangeError('maxBytes must be positive');
    if (!Number.isFinite(mbps) || mbps <= 0) throw new RangeError('mbps must be positive');
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    this._tokens = this._maxTokens;
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(nowMs?: bigint): void {
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (now <= this._lastUpdateMs) return;
    const timeDiff = now - this._lastUpdateMs;
    const accumulated = timeDiff * this._rateBitsPerMs;
    this._tokens = this._tokens + accumulated;
    if (this._tokens > this._maxTokens) this._tokens = this._maxTokens;
    this._lastUpdateMs = now;
  }

  consume(bits: bigint, nowMs?: bigint): boolean {
    if (bits < 0n) throw new RangeError('bits must be non-negative');
    this.update(nowMs);
    if (this._tokens >= bits) {
    this._tokens = this._tokens - bits;
    return true;
    }
    return false;
  }

  get tokens(): bigint { return this._tokens; }

  get maxTokens(): bigint { return this._maxTokens; }

  get rateBitsPerMs(): bigint { return this._rateBitsPerMs; }

  get lastUpdateMs(): bigint { return this._lastUpdateMs; }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens >= bucket.maxTokens) mask = mask | 1;
  if (bucket.tokens === 0n) mask = mask | 2;
  if (bucket.tokens * 2n >= bucket.maxTokens) mask = mask | 4;
  const pct = Number((bucket.tokens * 63n) / bucket.maxTokens);
  mask = mask | ((pct & 63) << 3);
  return mask;
}
