export class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: number;
  private _tokens: bigint;
  private _lastUpdate: bigint;
  private _refillActive: boolean;
  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n
    this._rateBitsPerMs = mbps * 8000
    this._tokens = this._maxTokens
    this._lastUpdate = BigInt(Date.now())
    this._refillActive = false
  }
  update(): void {
    const now = BigInt(Date.now())
    const timeDiff = Number(now - this._lastUpdate)
    if (timeDiff > 0) {
    const refill = BigInt(Math.floor(timeDiff * this._rateBitsPerMs))
    this._tokens = this._tokens + refill
    if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens }
    this._lastUpdate = now
    this._refillActive = this._tokens < this._maxTokens
    }
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
