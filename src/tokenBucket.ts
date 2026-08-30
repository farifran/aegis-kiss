export class TokenBucket {
  private readonly _maxTokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    if (maxBytes <= 0n) throw new RangeError('maxBytes must be positive');
    if (!Number.isFinite(mbps) || mbps <= 0) throw new RangeError('mbps must be positive finite number');
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    if (this._rateBitsPerMs <= 0n) throw new RangeError('rateBitsPerMs underflow');
    this._tokens = this._maxTokens;
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(nowMs?: bigint): void {
    const currentNow = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (currentNow <= this._lastUpdateMs) return;
    const timeDiff = currentNow - this._lastUpdateMs;
    const toAdd = timeDiff * this._rateBitsPerMs;
    this._tokens = this._tokens + toAdd;
    if (this._tokens > this._maxTokens) {
    this._tokens = this._maxTokens;
    }
    this._lastUpdateMs = currentNow;
  }

  consume(bits: bigint): boolean {
    if (bits <= 0n) throw new RangeError('Bits must be positive');
    this.update();
    if (this._tokens >= bits) {
    this._tokens = this._tokens - bits;
    return true;
    }
    return false;
  }

  get tokens(): bigint { return this._tokens; }

  get maxTokens(): bigint { return this._maxTokens; }

  get rateBitsPerMs(): bigint { return this._rateBitsPerMs; }

  get refillActive(): boolean { return this._tokens < this._maxTokens; }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
  mask = mask | 1;
  }
  if (bucket.tokens < bucket.maxTokens) {
  mask = mask | 2;
  }
  return mask;
}
