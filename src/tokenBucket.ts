export class TokenBucket {
  private readonly _maxTokens: bigint;
  private _tokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private _lastUpdate: bigint;

  constructor(maxTokensBytes: bigint, megaBytesPerSec: number) {
    this._maxTokens = maxTokensBytes * 8000000n;
    this._tokens = this._maxTokens;
    this._rateBitsPerMs = BigInt(Math.floor(megaBytesPerSec * 8000));
    this._lastUpdate = BigInt(Date.now());
  }

  public update(): void {
    const now = BigInt(Date.now());
    const timeDiff = now - this._lastUpdate;
    if (timeDiff > 0n) {
      const tokensToAdd = timeDiff * this._rateBitsPerMs;
      this._tokens = this._tokens + tokensToAdd;
      if (this._tokens > this._maxTokens) {
        this._tokens = this._maxTokens;
      }
      this._lastUpdate = now;
    }
  }

  public consume(bitsAmount: bigint): boolean {
    this.update();
    if (this._tokens >= bitsAmount) {
      this._tokens -= bitsAmount;
      return true;
    }
    return false;
  }

  public get tokens(): bigint {
    return this._tokens;
  }

  public get lastUpdate(): bigint {
    return this._lastUpdate;
  }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
    mask |= 1 << 0; // Bit 0: esgotado
  }
  const now = BigInt(Date.now());
  if (now - bucket.lastUpdate < 1000n) {
    mask |= 1 << 1; // Bit 1: refil ativo
  }
  return mask;
}
