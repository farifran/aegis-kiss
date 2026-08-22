export class TokenBucket {
  private _maxTokens: bigint;
  private _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastTs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this._maxTokens = maxBytes * 8n
    this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000))
    this._tokens = this._maxTokens
    this._lastTs = BigInt(Date.now())
  }

  update(): void {
    const now = BigInt(Date.now())
    const timeDiff = now - this._lastTs
    if (timeDiff > 0n) {
    const refill = timeDiff * this._rateBitsPerMs
    let newTokens = this._tokens + refill
    if (newTokens > this._maxTokens) newTokens = this._maxTokens
    this._tokens = newTokens
    this._lastTs = now
    }
  }

  consume(bits: bigint): boolean {
    this.update()
    if (bits < 0n) throw new Error("bits must be non-negative")
    if (this._tokens >= bits) {
    this._tokens -= bits
    return true
    }
    return false
  }

  get tokens(): bigint { return this._tokens }

  get maxTokens(): bigint { return this._maxTokens }

  get rateBitsPerMs(): bigint { return this._rateBitsPerMs }
}
