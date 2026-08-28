export class TokenBucket {
  private readonly _maxTokens: bigint;
  private _tokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    if (maxBytes < 0n) throw new RangeError("maxBytes must be non-negative");
    if (!Number.isFinite(mbps) || mbps < 0 || mbps * 8000 > Number.MAX_SAFE_INTEGER || (mbps > 0 && Math.round(mbps * 8000) === 0)) {
      throw new RangeError("mbps must be a non-negative safe number with representable rate");
    }
    this._maxTokens = maxBytes * 8n;
    this._tokens = this._maxTokens;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(nowMs: bigint = BigInt(Date.now())): void {
    if (nowMs <= this._lastUpdateMs) return;
    const timeDiff = nowMs - this._lastUpdateMs;
    this._lastUpdateMs = nowMs;
    if (this._rateBitsPerMs > 0n) {
    const replenished = this._tokens + (timeDiff * this._rateBitsPerMs);
    this._tokens = replenished > this._maxTokens ? this._maxTokens : replenished;
    }
  }

  consume(bits: bigint): boolean {
    if (bits < 0n) throw new RangeError("bits must be non-negative");
    this.update();
    if (this._tokens >= bits) {
    this._tokens -= bits;
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
  if (bucket.tokens === 0n) mask |= 1;
  if (bucket.refillActive) mask |= 2;
  return mask;
}
