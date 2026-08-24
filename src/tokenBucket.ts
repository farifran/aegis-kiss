export class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    if (maxBytes < 0n) throw new Error('maxBytes must be non-negative');
    if (mbps < 0) throw new Error('mbps must be non-negative');
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    this._tokens = this._maxTokens;
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(): void {
    const nowMs = BigInt(Date.now());
    const timeDiff = nowMs - this._lastUpdateMs;
    if (timeDiff > 0n) {
    const added = (timeDiff * this._rateBitsPerMs) / 1000n;
    this._tokens += added;
    if (this._tokens > this._maxTokens) this._tokens = this._maxTokens;
    this._lastUpdateMs = nowMs;
    }
  }

  consume(bits: bigint): boolean {
    if (bits < 0n) throw new Error('bits must be non-negative');
    this.update();
    if (this._tokens < bits) return false;
    this._tokens -= bits;
    return true;
  }

  get tokens(): bigint { return this._tokens }

  get maxTokens(): bigint { return this._maxTokens }

  get refillActive(): boolean { return this._tokens < this._maxTokens }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) mask |= 1;
  if (bucket.refillActive) mask |= 2;
  return mask;
}
