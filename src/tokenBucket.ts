export class TokenBucket {
  private readonly _maxTokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdate: bigint;

  public constructor(maxBytes: bigint, mbps: number, initialTime: bigint = 0n) {
    if (typeof maxBytes !== 'bigint' || maxBytes < 0n) {
      throw new RangeError('maxBytes must be a non-negative bigint');
    }
    const rateBitsPerMs = mbps * 8000;
    if (typeof mbps !== 'number' || !Number.isFinite(mbps) || mbps < 0 || !Number.isSafeInteger(rateBitsPerMs)) {
      throw new RangeError('mbps must produce a non-negative safe-integer rate');
    }
    if (typeof initialTime !== 'bigint') {
      throw new RangeError('initialTime must be a bigint');
    }

    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(rateBitsPerMs);
    this._tokens = this._maxTokens;
    this._lastUpdate = initialTime;
  }

  public get tokens(): bigint {
    return this._tokens;
  }

  public get maxTokens(): bigint {
    return this._maxTokens;
  }

  public get rateBitsPerMs(): bigint {
    return this._rateBitsPerMs;
  }

  public get lastUpdate(): bigint {
    return this._lastUpdate;
  }

  public update(now: bigint): void {
    if (typeof now !== 'bigint' || now < this._lastUpdate) {
      throw new RangeError('now must be a monotonic bigint');
    }
    if (now > this._lastUpdate) {
      const timeDiff = now - this._lastUpdate;
      const accumulated = timeDiff * this._rateBitsPerMs;
      this._tokens += accumulated;
      if (this._tokens > this._maxTokens) {
        this._tokens = this._maxTokens;
      }
      this._lastUpdate = now;
    }
  }

  public consume(bits: bigint, now: bigint): boolean {
    if (typeof bits !== 'bigint' || bits < 0n) {
      throw new RangeError('bits must be a non-negative bigint');
    }
    this.update(now);
    if (this._tokens >= bits) {
      this._tokens -= bits;
      return true;
    }
    return false;
  }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
    mask |= 1;
  }
  if (bucket.rateBitsPerMs > 0n) {
    mask |= 2;
  }
  return mask;
}
