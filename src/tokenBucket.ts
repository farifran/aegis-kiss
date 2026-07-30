class TokenBucket {
  private readonly _maxTokens: number;
  private _tokens: number;
  private readonly _interval: number;
  private _lastUpdate: number;

  constructor(maxTokens: number, interval: number) {
    this._maxTokens = maxTokens;
    this._tokens = 0;
    this._interval = interval;
    this._lastUpdate = 0;
  }

  public update(timestamp: number): void {
    const timeDiff = timestamp - this._lastUpdate;
    const tokensToAdd = timeDiff * this._interval;
    this._tokens += tokensToAdd;
    this._lastUpdate = timestamp;
  }

  public consume(amount: number): boolean {
    if (this._tokens >= amount) {
      this._tokens -= amount;
      return true;
    }
    return false;
  }
}

export { TokenBucket };
