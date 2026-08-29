import { SettlementBus } from "./settlementBus.js";
import { ClearinghouseCore } from "./clearinghouseCore.js";

type CycleOrder = { id: string; senderId: string; recipientId: string; amount: bigint };
type CycleResolutionResult = { resolvedCycles: number; totalObliterated: bigint; residualOrders: CycleOrder[]; checksum64: bigint };

export class LiquidityResolver {
  private readonly _bus: SettlementBus;
  private readonly _core: ClearinghouseCore;
  private readonly _maxHeapAccounts: number;
  private readonly _quarantinedAccounts: Set<string>;
  private _lastResolvedCycles: number;
  private _totalObliteratedVolume: bigint;
  private _lastChecksum: bigint;
  private _conservationViolations: number;
  private _residualOrdersCount: number;

  constructor(bus: SettlementBus, core: ClearinghouseCore, maxHeapAccounts: number = 500) {
    if (!Number.isFinite(maxHeapAccounts) || maxHeapAccounts <= 0 || !Number.isInteger(maxHeapAccounts)) throw new RangeError("maxHeapAccounts must be a positive integer");
    this._bus = bus;
    this._core = core;
    this._maxHeapAccounts = maxHeapAccounts;
    this._quarantinedAccounts = new Set<string>();
    this._lastResolvedCycles = 0;
    this._totalObliteratedVolume = 0n;
    this._lastChecksum = 0n;
    this._conservationViolations = 0;
    this._residualOrdersCount = 0;
  }

  _isValid(o: CycleOrder): boolean {
    if (o.amount <= 0n || o.senderId === o.recipientId) return false;
    if (this._quarantinedAccounts.has(o.senderId) || this._quarantinedAccounts.has(o.recipientId)) return false;
    return true;
  }

  _resolve3Way(valid: CycleOrder[]): bigint {
    if (valid.length < 3) return 0n;
    const o1 = valid[0];
    const o2 = valid[1];
    const o3 = valid[2];
    if (!o1 || !o2 || !o3) return 0n;
    if (o1.recipientId !== o2.senderId || o2.recipientId !== o3.senderId || o3.recipientId !== o1.senderId) return 0n;
    let min = o1.amount;
    if (o2.amount < min) min = o2.amount;
    if (o3.amount < min) min = o3.amount;
    if (min <= 0n) return 0n;
    o1.amount -= min;
    o2.amount -= min;
    o3.amount -= min;
    return min;
  }

  _computeChecksum(orders: CycleOrder[], obliterated: bigint): bigint {
    let chk = 14695981039346656037n;
    chk = (chk ^ (obliterated & 0xFFFFFFFFFFFFFFFFn)) * 1099511628211n;
    for (const o of orders) {
    chk = (chk ^ (o.amount & 0xFFFFFFFFFFFFFFFFn)) * 1099511628211n;
    }
    return chk & 0xFFFFFFFFFFFFFFFFn;
  }

  resolveDeadlocks(orders: CycleOrder[]): CycleResolutionResult {
    const valid: CycleOrder[] = [];
    for (const o of orders) {
    if (this._isValid(o)) valid.push({ id: o.id, senderId: o.senderId, recipientId: o.recipientId, amount: o.amount });
    }
    const obliterated = this._resolve3Way(valid);
    const cyclesResolved = obliterated > 0n ? 1 : 0;
    const residuals: CycleOrder[] = [];
    for (const o of valid) {
    if (o.amount > 0n) residuals.push(o);
    }
    const chk = this._computeChecksum(residuals, obliterated);
    this._lastResolvedCycles = cyclesResolved;
    this._totalObliteratedVolume += obliterated;
    this._residualOrdersCount = residuals.length;
    this._lastChecksum = chk;
    return { resolvedCycles: cyclesResolved, totalObliterated: obliterated, residualOrders: residuals, checksum64: chk };
  }

  resetQuarantine(): void {
    this._quarantinedAccounts.clear();
    this._conservationViolations = 0;
    this._lastResolvedCycles = 0;
    this._residualOrdersCount = 0;
  }

  get bus(): SettlementBus { return this._bus; }

  get core(): ClearinghouseCore { return this._core; }

  get isQuarantineActive(): boolean { return this._quarantinedAccounts.size > 0 || this._bus.isolatedCount > 0 || this._core.isQuarantineActive; }

  get lastResolvedCycles(): number { return this._lastResolvedCycles; }

  get totalObliteratedVolume(): bigint { return this._totalObliteratedVolume; }

  get lastChecksum(): bigint { return this._lastChecksum; }

  get conservationViolations(): number { return this._conservationViolations; }

  get residualOrdersCount(): number { return this._residualOrdersCount; }
}

export function obterLiquidityResolverBitmask(resolver: LiquidityResolver): number {
  let mask = 0;
  if (resolver.bus.isGlobalLocked) mask |= 1;
  if (resolver.lastResolvedCycles > 0) mask |= 2;
  if (resolver.conservationViolations > 0) mask |= 4;
  let q = resolver.isQuarantineActive ? 1 : 0;
  if (q > 31) q = 31;
  mask |= (q & 0x1F) << 3;
  let res = resolver.residualOrdersCount;
  if (res > 255) res = 255;
  if (res < 0) res = 0;
  mask |= (res & 0xFF) << 8;
  const low16 = Number(resolver.lastChecksum & 0xFFFFn);
  mask |= (low16 & 0xFFFF) << 16;
  return mask >>> 0;
}
