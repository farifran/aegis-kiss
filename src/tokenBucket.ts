export class TokenBucket {
  private readonly _capacity: bigint;
  private readonly _refillPerMs: bigint;
  private _tokens: bigint;
  private _lastUpdateMs: bigint;

  constructor(capacity: bigint, refillPerMs: bigint, initialTokens?: bigint, initialTimeMs: bigint = 0n) {
    if (capacity <= 0n) throw new RangeError('capacity must be positive');
    if (refillPerMs < 0n) throw new RangeError('refillPerMs must be non-negative');
    if (initialTimeMs < 0n) throw new RangeError('initialTimeMs must be non-negative');

    this._capacity = capacity;
    this._refillPerMs = refillPerMs;
    this._lastUpdateMs = initialTimeMs;

    if (initialTokens !== undefined) {
      if (initialTokens < 0n) throw new RangeError('initialTokens must be non-negative');
      this._tokens = initialTokens > capacity ? capacity : initialTokens;
    } else {
      this._tokens = capacity;
    }
  }

  update(nowMs: bigint): void {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    if (nowMs <= this._lastUpdateMs) {
      return; // Monotonic clamp: clock regression or equal time never creates tokens
    }
    const deltaMs = nowMs - this._lastUpdateMs;
    const added = deltaMs * this._refillPerMs;
    const nextTokens = this._tokens + added;
    this._tokens = nextTokens > this._capacity ? this._capacity : nextTokens;
    this._lastUpdateMs = nowMs;
  }

  peekTokens(nowMs: bigint): bigint {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    if (nowMs <= this._lastUpdateMs) {
      return this._tokens;
    }
    const deltaMs = nowMs - this._lastUpdateMs;
    const added = deltaMs * this._refillPerMs;
    const next = this._tokens + added;
    return next > this._capacity ? this._capacity : next;
  }

  consume(amount: bigint, nowMs: bigint): boolean {
    if (amount <= 0n) throw new RangeError('amount must be positive');
    this.update(nowMs);
    if (this._tokens < amount) {
      return false;
    }
    this._tokens -= amount;
    return true;
  }

  snapshot(): { readonly tokens: bigint; readonly lastUpdateMs: bigint } {
    return {
      tokens: this._tokens,
      lastUpdateMs: this._lastUpdateMs
    };
  }

  restore(snap: { readonly tokens: bigint; readonly lastUpdateMs: bigint }): void {
    if (snap.tokens < 0n || snap.tokens > this._capacity) {
      throw new RangeError('invalid snapshot token value');
    }
    if (snap.lastUpdateMs < 0n) {
      throw new RangeError('invalid snapshot lastUpdateMs');
    }
    this._tokens = snap.tokens;
    this._lastUpdateMs = snap.lastUpdateMs;
  }

  get capacity(): bigint { return this._capacity; }
  get refillPerMs(): bigint { return this._refillPerMs; }
  get tokens(): bigint { return this._tokens; }
  get lastUpdateMs(): bigint { return this._lastUpdateMs; }
}
