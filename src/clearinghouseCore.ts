import { SettlementBus } from "./settlementBus.js";

type NettingOrder = { id: string; senderId: string; recipientId: string; amount: bigint };
type NettingParticipant = { accountId: string; netBalance: bigint; grossDebits: bigint; grossCredits: bigint; fees: bigint };
type ClearinghouseEnvelope = { cycleId: string; participants: NettingParticipant[]; totalVolume: bigint; totalFees: bigint; checksum64: bigint };

export class ClearinghouseCore {
  private readonly _bus: SettlementBus;
  private readonly _maxConsecutiveFailures: number;
  private readonly _maxHeapAccounts: number;
  private readonly _failureCounts: Map<string, number>;
  private readonly _quarantinedAccounts: Set<string>;
  private _totalVolume: bigint;
  private _lastChecksum: bigint;
  private _consecutiveRejections: number;

  constructor(bus: SettlementBus, maxConsecutiveFailures: number = 3, maxHeapAccounts: number = 500) {
    if (!Number.isFinite(maxConsecutiveFailures) || maxConsecutiveFailures <= 0 || !Number.isInteger(maxConsecutiveFailures)) throw new RangeError("maxConsecutiveFailures must be a positive integer");
    if (!Number.isFinite(maxHeapAccounts) || maxHeapAccounts <= 0 || !Number.isInteger(maxHeapAccounts)) throw new RangeError("maxHeapAccounts must be a positive integer");
    this._bus = bus;
    this._maxConsecutiveFailures = maxConsecutiveFailures;
    this._maxHeapAccounts = maxHeapAccounts;
    this._failureCounts = new Map<string, number>();
    this._quarantinedAccounts = new Set<string>();
    this._totalVolume = 0n;
    this._lastChecksum = 0n;
    this._consecutiveRejections = 0;
  }

  _isValidOrder(o: NettingOrder): boolean {
    if (o.amount <= 0n || o.senderId === o.recipientId) return false;
    if (this._quarantinedAccounts.has(o.senderId) || this._quarantinedAccounts.has(o.recipientId)) return false;
    if (this._failureCounts.size >= this._maxHeapAccounts && !this._failureCounts.has(o.senderId) && !this._failureCounts.has(o.recipientId)) return false;
    return true;
  }

  _computeChecksum(participants: NettingParticipant[]): bigint {
    let chk = 14695981039346656037n;
    for (const p of participants) {
    chk = (chk ^ (p.netBalance & 0xFFFFFFFFFFFFFFFFn)) * 1099511628211n;
    chk = chk & 0xFFFFFFFFFFFFFFFFn;
    }
    return chk;
  }

  processNettingBatch(cycleId: string, orders: NettingOrder[]): ClearinghouseEnvelope {
    const debits = new Map<string, bigint>();
    const credits = new Map<string, bigint>();
    let vol = 0n;
    let rejected = 0;
    for (const o of orders) {
    if (!this._isValidOrder(o)) {
    rejected += 1;
    const cur = (this._failureCounts.get(o.senderId) ?? 0) + 1;
    this._failureCounts.set(o.senderId, cur);
    if (cur >= this._maxConsecutiveFailures) this._quarantinedAccounts.add(o.senderId);
    continue;
    }
    debits.set(o.senderId, (debits.get(o.senderId) ?? 0n) + o.amount);
    credits.set(o.recipientId, (credits.get(o.recipientId) ?? 0n) + o.amount);
    vol += o.amount;
    }
    const participants: NettingParticipant[] = [];
    const allAccounts = new Set<string>([...debits.keys(), ...credits.keys()]);
    let totalFees = 0n;
    for (const acc of allAccounts) {
    const d = debits.get(acc) ?? 0n;
    const c = credits.get(acc) ?? 0n;
    const fee = (d * 10n) / 10000n;
    totalFees += fee;
    const net = c - (d + fee);
    participants.push({ accountId: acc, netBalance: net, grossDebits: d, grossCredits: c, fees: fee });
    }
    const chk = this._computeChecksum(participants);
    this._totalVolume += vol;
    this._lastChecksum = chk;
    if (rejected > 0) {
    this._consecutiveRejections = this._consecutiveRejections + rejected;
    if (this._consecutiveRejections > 15) this._consecutiveRejections = 15;
    } else {
    this._consecutiveRejections = 0;
    }
    return { cycleId, participants, totalVolume: vol, totalFees, checksum64: chk };
  }

  resetQuarantine(): void {
    this._quarantinedAccounts.clear();
    this._failureCounts.clear();
    this._consecutiveRejections = 0;
  }

  get bus(): SettlementBus { return this._bus; }

  get isQuarantineActive(): boolean { return this._quarantinedAccounts.size > 0 || this._bus.isolatedCount > 0; }

  get activeAccountsCount(): number { return this._failureCounts.size; }

  get totalVolume(): bigint { return this._totalVolume; }

  get lastChecksum(): bigint { return this._lastChecksum; }

  get consecutiveRejections(): number { return this._consecutiveRejections; }
}

export function obterClearinghouseBitmask(core: ClearinghouseCore): number {
  let mask = 0;
  if (core.bus.isGlobalLocked) mask |= 1;
  if (core.isQuarantineActive) mask |= 2;
  if (core.totalVolume > 1000000n) mask |= 4;
  if (core.activeAccountsCount > 500) mask |= 8;
  let rej = core.consecutiveRejections;
  if (rej > 15) rej = 15;
  if (rej < 0) rej = 0;
  mask |= (rej & 0xF) << 4;
  const highByte = Number((core.lastChecksum >> 56n) & 0xFFn);
  mask |= (highByte & 0xFF) << 8;
  return mask;
}
