type TokenBucketConfig = { capacity: bigint; refillRatePerSec: bigint; initialTokens?: bigint; initialTimeMs?: bigint };

export class TokenBucketRateLimiter {
  private readonly _capacity: bigint;
  private readonly _refillRatePerSec: bigint;
  private _tokens: bigint;
  private _lastRefillMs: bigint;

  constructor(config: TokenBucketConfig) {
    if (config.capacity <= 0n) throw new RangeError('Capacity must be positive');
    if (config.refillRatePerSec <= 0n) throw new RangeError('Refill rate must be positive');
    this._capacity = config.capacity;
    this._refillRatePerSec = config.refillRatePerSec;
    const init = config.initialTokens !== undefined ? config.initialTokens : config.capacity;
    if (init < 0n || init > config.capacity) throw new RangeError('Initial tokens out of bounds');
    this._tokens = init;
    this._lastRefillMs = config.initialTimeMs !== undefined ? config.initialTimeMs : 0n;
  }

  refill(nowMs: bigint): void {
    if (nowMs <= this._lastRefillMs) return;
    const elapsedMs = nowMs - this._lastRefillMs;
    const tokensToAdd = (elapsedMs * this._refillRatePerSec) / 1000n;
    if (tokensToAdd > 0n) {
    this._tokens = this._tokens + tokensToAdd;
    if (this._tokens > this._capacity) {
    this._tokens = this._capacity;
    }
    this._lastRefillMs = nowMs;
    }
  }

  consume(amount: bigint, nowMs: bigint): boolean {
    if (amount <= 0n) throw new RangeError('Consume amount must be positive');
    this.refill(nowMs);
    if (this._tokens >= amount) {
    this._tokens = this._tokens - amount;
    return true;
    }
    return false;
  }

  canConsume(amount: bigint, nowMs: bigint): boolean {
    if (amount <= 0n) return false;
    let currentTokens = this._tokens;
    if (nowMs > this._lastRefillMs) {
    const elapsedMs = nowMs - this._lastRefillMs;
    const tokensToAdd = (elapsedMs * this._refillRatePerSec) / 1000n;
    currentTokens = currentTokens + tokensToAdd;
    if (currentTokens > this._capacity) {
    currentTokens = this._capacity;
    }
    }
    return currentTokens >= amount;
  }

  reset(tokens: bigint, nowMs: bigint): void {
    if (tokens < 0n || tokens > this._capacity) throw new RangeError('Tokens out of bounds');
    this._tokens = tokens;
    this._lastRefillMs = nowMs;
  }

  get tokens(): bigint { return this._tokens; }

  get capacity(): bigint { return this._capacity; }

  get refillRatePerSec(): bigint { return this._refillRatePerSec; }

  get refillActive(): boolean { return this._tokens < this._capacity; }
}
