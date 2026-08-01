export class TokenBucket {
  private _tokens: bigint;
  private _maxTokens: bigint;
  private _rateBitsPerMs: number;
  private _lastUpdate: bigint;
  private _refillActive: boolean;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n
    this._tokens = this._maxTokens
    this._rateBitsPerMs = mbps * 8000
    this._lastUpdate = BigInt(Date.now())
    this._refillActive = false
  }

  update(): void {
    const now = BigInt(Date.now())
    const timeDiff = now - this._lastUpdate
    if (timeDiff > 0n) { this._tokens += BigInt(Math.floor(Number(timeDiff) * this._rateBitsPerMs)); this._lastUpdate = now }
    if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens }
    this._refillActive = this._tokens < this._maxTokens
  }

  consume(bits: bigint): boolean {
    this.update()
    if (this._tokens >= bits) { this._tokens -= bits; return true }
    return false
  }

  get tokens(): bigint { return this._tokens }

  get refillActive(): boolean { return this._refillActive }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0
  if (bucket.tokens === 0n) { mask |= 1 }
  if (bucket.refillActive) { mask |= 2 }
  return mask
}
