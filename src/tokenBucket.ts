export class TokenBucket {
  private readonly _maxTokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    if (maxBytes < 0n) throw new RangeError('maxBytes must be non-negative');
    if (!Number.isFinite(mbps) || mbps < 0) throw new RangeError('mbps must be a non-negative finite number');
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    this._tokens = this._maxTokens;
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(nowMs?: bigint): void {
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (now <= this._lastUpdateMs) return;
    const timeDiff = now - this._lastUpdateMs;
    this._lastUpdateMs = now;
    if (this._rateBitsPerMs > 0n) {
    const replenished = this._tokens + timeDiff * this._rateBitsPerMs;
    this._tokens = replenished > this._maxTokens ? this._maxTokens : replenished;
    }
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

  get refillActive(): boolean { return this._tokens < this._maxTokens; }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) mask = mask | 1;
  if (bucket.refillActive) mask = mask | 2;
  return mask;
}
