export type ClockPolicy = 'monotonic_reject' | 'monotonic_clamp' | 'allow_backward' | 'logical_clock';

export class TokenBucket {
  private readonly _maxTokens: bigint;
  private readonly _rateBitsPerMs: bigint;
  private readonly _clockPolicy: ClockPolicy;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(maxBytes: bigint, mbps: number, clockPolicy: ClockPolicy = 'monotonic_clamp') {
    if (maxBytes < 0n) throw new RangeError('maxBytes must be non-negative');
    if (!Number.isFinite(mbps) || mbps < 0) throw new RangeError('mbps must be a non-negative finite number');
    if (!['monotonic_reject', 'monotonic_clamp', 'allow_backward', 'logical_clock'].includes(clockPolicy)) {
      throw new RangeError('invalid clock policy');
    }
    this._maxTokens = maxBytes * 8n;
    this._rateBitsPerMs = BigInt(Math.round(mbps * 8000));
    this._clockPolicy = clockPolicy;
    this._tokens = this._maxTokens;
    this._lastUpdateMs = BigInt(Date.now());
  }

  update(nowMs?: bigint): void {
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (now < this._lastUpdateMs) {
      if (this._clockPolicy === 'monotonic_reject') throw new RangeError('clock moved backwards');
      if (this._clockPolicy !== 'allow_backward') return;
      this._lastUpdateMs = now;
      return;
    }
    if (now === this._lastUpdateMs) return;
    const timeDiff = now - this._lastUpdateMs;
    this._lastUpdateMs = now;
    if (this._rateBitsPerMs > 0n) {
      const replenished = this._tokens + timeDiff * this._rateBitsPerMs;
      this._tokens = replenished > this._maxTokens ? this._maxTokens : replenished;
    }
  }

  consume(bits: bigint, nowMs?: bigint): boolean {
    if (bits < 0n) throw new RangeError('bits must be non-negative');
    this.update(nowMs);
    if (this._tokens >= bits) {
    this._tokens = this._tokens - bits;
    return true;
    }
    return false;
  }

  peekTokens(nowMs?: bigint): bigint {
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (now < this._lastUpdateMs) {
      if (this._clockPolicy === 'monotonic_reject') throw new RangeError('clock moved backwards');
      return this._tokens;
    }
    if (now === this._lastUpdateMs || this._rateBitsPerMs <= 0n) return this._tokens;
    const timeDiff = now - this._lastUpdateMs;
    const replenished = this._tokens + timeDiff * this._rateBitsPerMs;
    return replenished > this._maxTokens ? this._maxTokens : replenished;
  }

  snapshot(): { readonly tokens: bigint; readonly lastUpdateMs: bigint } {
    return { tokens: this._tokens, lastUpdateMs: this._lastUpdateMs };
  }

  restore(snapshot: { readonly tokens: bigint; readonly lastUpdateMs: bigint }): void {
    if (snapshot.tokens < 0n || snapshot.tokens > this._maxTokens) {
      throw new RangeError('invalid token bucket snapshot');
    }
    this._tokens = snapshot.tokens;
    this._lastUpdateMs = snapshot.lastUpdateMs;
  }

  get tokens(): bigint { return this._tokens; }

  get maxTokens(): bigint { return this._maxTokens; }

  get rateBitsPerMs(): bigint { return this._rateBitsPerMs; }

  get clockPolicy(): ClockPolicy { return this._clockPolicy; }

  get lastUpdateMs(): bigint { return this._lastUpdateMs; }

  get refillActive(): boolean { return this._rateBitsPerMs > 0n && this._tokens < this._maxTokens; }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) mask = mask | 1;
  if (bucket.refillActive) mask = mask | 2;
  return mask;
}
