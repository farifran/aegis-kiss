type ClearingOrder = { id: string; senderId: string; recipientId: string; amount: bigint };
type ClearingResult = { processedCount: number; rejectedCount: number; settledVolume: bigint; feeTotal: bigint };
type SettlementBus = { getBalance(accountId: string): bigint; processBatch(orders: ClearingOrder[]): { settledCount: number; rejectedCount: number; totalVolume: bigint; totalFees: bigint }; isGlobalLocked: boolean; isolatedCount: number; accumulatedVolume: bigint };

export class ClearingEngine {
  private readonly _bus: SettlementBus;
  private readonly _accountHits: Map<string, number>;
  private readonly _maxHitsPerWindow: number;
  private _isQuarantineActive: boolean;

  constructor(bus: SettlementBus, maxHitsPerWindow: number = 10) {
    if (!Number.isFinite(maxHitsPerWindow) || maxHitsPerWindow <= 0 || !Number.isInteger(maxHitsPerWindow)) throw new RangeError("maxHitsPerWindow must be a positive integer");
    this._bus = bus;
    this._maxHitsPerWindow = maxHitsPerWindow;
    this._isQuarantineActive = false;
    this._accountHits = new Map<string, number>();
  }

  processClearingBatch(orders: ClearingOrder[]): ClearingResult {
    const validOrders: ClearingOrder[] = [];
    let rejected = 0;
    for (const o of orders) {
    if (o.amount <= 0n || o.senderId === o.recipientId) {
    rejected += 1;
    continue;
    }
    const senderHits = (this._accountHits.get(o.senderId) ?? 0) + 1;
    const recipientHits = (this._accountHits.get(o.recipientId) ?? 0) + 1;
    if (senderHits > this._maxHitsPerWindow || recipientHits > this._maxHitsPerWindow) {
    this._isQuarantineActive = true;
    rejected += 1;
    continue;
    }
    this._accountHits.set(o.senderId, senderHits);
    this._accountHits.set(o.recipientId, recipientHits);
    validOrders.push(o);
    }
    const batchRes = this._bus.processBatch(validOrders);
    return {
    processedCount: batchRes.settledCount,
    rejectedCount: rejected + batchRes.rejectedCount,
    settledVolume: batchRes.totalVolume,
    feeTotal: batchRes.totalFees
    };
  }

  resetHits(): void {
    this._accountHits.clear();
    this._isQuarantineActive = false;
  }

  get bus(): SettlementBus { return this._bus; }

  get isQuarantineActive(): boolean { return this._isQuarantineActive || this._bus.isolatedCount > 0; }

  get activeAccountCount(): number { return this._accountHits.size; }
}

export function obterEstadoCompensacaoBitmask(engine: ClearingEngine): number {
  let mask = 0;
  if (engine.bus.isGlobalLocked) mask |= 1;
  if (engine.isQuarantineActive) mask |= 2;
  if (engine.bus.accumulatedVolume > 1000000n) mask |= 4;
  if (engine.activeAccountCount > 0) mask |= 8;
  return mask;
}
