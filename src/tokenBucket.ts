/**
 * Token Bucket algorithm for high-precision offline-first control.
 *
 * @author [Your Name]
 * @since [Current Date]
 */

export class TokenBucket {
  private _tokens: bigint;
  private _rate: bigint;
  private _time: bigint;

  constructor(tokens: bigint, rate: bigint) {
    this._tokens = tokens;
    this._rate = rate;
    this._time = BigInt(Date.now());
  }

  public getTokens(): bigint {
    return this._tokens;
  }

  public getRate(): bigint {
    return this._rate;
  }

  public getTime(): bigint {
    return this._time;
  }

  public update(): void {
    const now = BigInt(Date.now());
    const elapsed = now - this._time;
    this._tokens = this._tokens + this._rate * elapsed;
    this._time = now;
  }
}

function updateTokenBucket(tokenBucket: TokenBucket): void {
  tokenBucket.update();
}

export { updateTokenBucket };
