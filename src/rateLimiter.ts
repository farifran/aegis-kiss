export class RateLimiter {
  private _limit: number;
  private _windowMs: bigint;
  private _windowStart: bigint;
  private _count: number;

  constructor(limit: number, windowMs: number) {
    this._limit = limit
    this._windowMs = BigInt(windowMs)
    this._windowStart = 0n
    this._count = 0
  }

  allow(now: bigint): boolean {
    const end = this._windowStart + this._windowMs
    if (now >= end) { this._windowStart = now; this._count = 0 }
    if (this._count < this._limit) { this._count++; return true }
    return false
  }

  reset(): void {
    this._windowStart = 0n
    this._count = 0
  }

  get windowStart(): bigint { return this._windowStart }

  get windowMs(): number { return Number(this._windowMs) }

  get remaining(): number { return this._limit - this._count }
}
