type Order = { id: string; senderId: string; recipientId: string; amount: bigint };
type BatchResult = { settledCount: number; rejectedCount: number; totalVolume: bigint; totalFees: bigint };

export class SettlementBus {
  private readonly _balances: Map<string, bigint>;
  private readonly _isolatedAccounts: Set<string>;
  private readonly _rejectionCounts: Map<string, number>;
  private readonly _maxRejectionsBeforeIsolation: number;
  private _accumulatedVolume: bigint;
  private readonly _baseFeeBps: bigint;
  private _isGlobalLocked: boolean;

  constructor(initialBalances: Record<string, bigint> = {}, baseFeeBps: bigint = 100n, maxRejectionsBeforeIsolation: number = 3) {
    if (baseFeeBps < 0n || baseFeeBps > 10000n) throw new RangeError("baseFeeBps must be between 0 and 10000");
    if (!Number.isFinite(maxRejectionsBeforeIsolation) || maxRejectionsBeforeIsolation <= 0 || !Number.isInteger(maxRejectionsBeforeIsolation)) throw new RangeError("maxRejectionsBeforeIsolation must be a positive integer");
    this._baseFeeBps = baseFeeBps;
    this._maxRejectionsBeforeIsolation = maxRejectionsBeforeIsolation;
    this._accumulatedVolume = 0n;
    this._isGlobalLocked = false;
    this._balances = new Map<string, bigint>();
    this._isolatedAccounts = new Set<string>();
    this._rejectionCounts = new Map<string, number>();
    for (const [acc, bal] of Object.entries(initialBalances)) {
    if (typeof bal !== "bigint" || bal < 0n) throw new RangeError("Initial balance must be a non-negative bigint");
    this._balances.set(acc, bal);
    }
  }

  getBalance(accountId: string): bigint {
    return this._balances.get(accountId) ?? 0n;
  }

  isIsolated(accountId: string): boolean {
    return this._isolatedAccounts.has(accountId);
  }

  setIsolated(accountId: string, isolated: boolean): void {
    if (isolated) this._isolatedAccounts.add(accountId); else this._isolatedAccounts.delete(accountId);
  }

  setGlobalLock(locked: boolean): void {
    this._isGlobalLocked = locked;
  }

  processBatch(orders: Order[]): BatchResult {
    let settled = 0;
    let rejected = 0;
    let batchVol = 0n;
    let batchFees = 0n;
    if (this._isGlobalLocked) {
    return { settledCount: 0, rejectedCount: orders.length, totalVolume: 0n, totalFees: 0n };
    }
    for (const order of orders) {
    if (order.amount <= 0n || order.senderId === order.recipientId || this._isolatedAccounts.has(order.senderId)) {
    rejected += 1;
    continue;
    }
    const senderBal = this.getBalance(order.senderId);
    let currentFeeBps = this._baseFeeBps;
    if (this._accumulatedVolume > 1000000n) {
    const disc = this._baseFeeBps / 2n;
    const clamped = disc < 10n ? 10n : disc;
    currentFeeBps = clamped > this._baseFeeBps ? this._baseFeeBps : clamped;
    }
    const fee = (order.amount * currentFeeBps) / 10000n;
    const totalDebit = order.amount + fee;
    if (senderBal >= totalDebit) {
    this._balances.set(order.senderId, senderBal - totalDebit);
    const recipientBal = this.getBalance(order.recipientId);
    this._balances.set(order.recipientId, recipientBal + order.amount);
    this._accumulatedVolume += order.amount;
    batchVol += order.amount;
    batchFees += fee;
    settled += 1;
    this._rejectionCounts.delete(order.senderId);
    } else {
    rejected += 1;
    const currentRejections = (this._rejectionCounts.get(order.senderId) ?? 0) + 1;
    this._rejectionCounts.set(order.senderId, currentRejections);
    if (currentRejections >= this._maxRejectionsBeforeIsolation) {
    this._isolatedAccounts.add(order.senderId);
    }
    }
    }
    return { settledCount: settled, rejectedCount: rejected, totalVolume: batchVol, totalFees: batchFees };
  }

  get accumulatedVolume(): bigint { return this._accumulatedVolume; }

  get isGlobalLocked(): boolean { return this._isGlobalLocked; }

  get isolatedCount(): number { return this._isolatedAccounts.size; }
}

export function obterSaudeBitmask(bus: SettlementBus): number {
  let mask = 0;
  if (bus.isGlobalLocked) mask |= 1;
  if (bus.isolatedCount > 0) mask |= 2;
  if (bus.accumulatedVolume > 1000000n) mask |= 4;
  return mask;
}
