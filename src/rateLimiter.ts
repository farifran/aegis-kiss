export class RateLimiter {
  private _limit: number;
  private _windowMs: number;
  private _count: number;
  private _windowStart: bigint;

  constructor(limit: number, windowMs: number) {
    this._limit = limit
    this._windowMs = windowMs
    this._count = 0
    this._windowStart = BigInt(Date.now())
  }

  _advance(nowMs: bigint): void {
    const windowMs = BigInt(this._windowMs)
    let start = this._windowStart
    while (start + windowMs <= nowMs) { start += windowMs; this._count = 0 }
    this._windowStart = start
  }

  allow(nowMs?: bigint): boolean {
    const now = nowMs ?? BigInt(Date.now())
    this._advance(now)
    if (this._count < this._limit) { this._count += 1; return true }
    return false
  }

  reset(): void { this._count = 0; this._windowStart = BigInt(Date.now()) }

  get remaining(): number { return this._limit - this._count }

  get windowMs(): number { return this._windowMs }

  get windowStart(): bigint { return this._windowStart }
}

export function estimateBackoffMs(limiter: RateLimiter, nowMs: bigint): bigint {
  const windowMs = BigInt(limiter.windowMs)
  const position = (nowMs - limiter.windowStart) % windowMs
  if (position < 0n) return 0n
  return windowMs - position
}
