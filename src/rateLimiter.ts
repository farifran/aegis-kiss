export class RateLimiter {
  private _windowMs: bigint;
  private _lastUpdate: bigint;
  private _remaining: bigint;
  private _maxRequests: bigint;

  constructor(windowMs: bigint, maxRequests: bigint) {
    this._windowMs = windowMs
    this._lastUpdate = BigInt(Date.now())
    this._remaining = maxRequests
    this._maxRequests = maxRequests
  }

  allow(nowMs: bigint): boolean {
    const timeDiff = nowMs - this._lastUpdate
    if (timeDiff > 0n) {
      this._remaining -= 1n;
      this._lastUpdate = nowMs;
      if (this._remaining <= 0n) { return false; }
    }
    return true;
  }

  reset(): void {
    this._remaining = this._maxRequests;
    this._lastUpdate = BigInt(Date.now())
  }

  get remaining(): bigint { return this._remaining; }
  get lastUpdate(): bigint { return this._lastUpdate; }
  get windowMs(): bigint { return this._windowMs; }
}

export function estimateBackoffMs(limiter: RateLimiter, nowMs: bigint): bigint {
  const timeDiff = nowMs - limiter.lastUpdate;
  if (timeDiff > 0n) {
    return limiter.windowMs - timeDiff;
  }
  return 0n;
}
