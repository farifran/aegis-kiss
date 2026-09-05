export class TokenBucket {
  private readonly _maxTokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdate: bigint;

  public constructor(maxBytes: bigint, mbps: number) {
    if (typeof maxBytes !== 'bigint' || maxBytes < 0n) {
      throw new RangeError('maxBytes must be a non-negative bigint');
    }
    if (typeof mbps !== 'number' || !Number.isFinite(mbps) || mbps < 0) {
      throw new RangeError('mbps must be a non-negative finite number');
    }

    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000));
    this._tokens = this._maxTokens;
    this._lastUpdate = BigInt(Date.now());
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

  public update(now?: bigint): void {
    const currentTime = now !== undefined ? now : BigInt(Date.now());
    if (currentTime > this._lastUpdate) {
      const timeDiff = currentTime - this._lastUpdate;
      const accumulated = timeDiff * this._rateBitsPerMs;
      this._tokens += accumulated;
      if (this._tokens > this._maxTokens) {
        this._tokens = this._maxTokens;
      }
      this._lastUpdate = currentTime;
    }
  }

  public consume(bits: bigint, now?: bigint): boolean {
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
