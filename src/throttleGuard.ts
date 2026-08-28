type ThrottleRecord = { count: number; lastSeenMs: bigint };

export class ThrottleGuard {
  private readonly _records: Map<string, ThrottleRecord>;
  private readonly _maxHits: number;
  private readonly _ttlMs: bigint;
  private readonly _maxEntries: number;
  private _isLocked: boolean;

  constructor(maxHits: number = 10, ttlMs: bigint = 60000n, maxEntries: number = 1000) {
    if (!Number.isFinite(maxHits) || maxHits <= 0 || !Number.isInteger(maxHits)) throw new RangeError("maxHits must be a positive integer");
    if (ttlMs <= 0n) throw new RangeError("ttlMs must be a positive bigint");
    if (!Number.isFinite(maxEntries) || maxEntries <= 0 || !Number.isInteger(maxEntries)) throw new RangeError("maxEntries must be a positive integer");
    this._maxHits = maxHits;
    this._ttlMs = ttlMs;
    this._maxEntries = maxEntries;
    this._isLocked = false;
    this._records = new Map<string, ThrottleRecord>();
  }

  allow(id: string, nowMs: bigint = BigInt(Date.now())): boolean {
    if (this._isLocked) return false;
    const rec = this._records.get(id);
    if (!rec) {
    if (this._records.size >= this._maxEntries) return false;
    this._records.set(id, { count: 1, lastSeenMs: nowMs });
    return true;
    }
    if (nowMs < rec.lastSeenMs) return false;
    const timeDiff = nowMs - rec.lastSeenMs;
    if (timeDiff > this._ttlMs) {
    rec.count = 1;
    rec.lastSeenMs = nowMs;
    return true;
    }
    if (rec.count >= this._maxHits) return false;
    rec.count += 1;
    rec.lastSeenMs = nowMs;
    return true;
  }

  setLock(locked: boolean): void {
    this._isLocked = locked;
  }

  getRecord(id: string): ThrottleRecord | undefined {
    return this._records.get(id);
  }

  reset(): void {
    this._records.clear();
    this._isLocked = false;
  }

  get isLocked(): boolean { return this._isLocked; }

  get size(): number { return this._records.size; }
}

export function obterStatusBitmask(guard: ThrottleGuard): number {
  let mask = 0;
  if (guard.isLocked) mask |= 1;
  if (guard.size > 0) mask |= 2;
  return mask;
}
