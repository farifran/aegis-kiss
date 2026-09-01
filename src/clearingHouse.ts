import { TokenBucket } from './tokenBucket.js';

export interface TransferOrder {
  readonly id: string;
  readonly senderId: string;
  readonly receiverId: string;
  readonly amount: bigint;
  readonly fee: bigint;
}

export interface AccountState {
  balance: bigint;
  bucket: TokenBucket;
  quarantined: boolean;
}

export interface BatchResult {
  readonly settledCount: number;
  readonly rejectedCount: number;
  readonly quarantinedCount: number;
  readonly settledVolume: bigint;
  readonly retainedFees: bigint;
  readonly merkleRoot: bigint;
  readonly rolledBack: boolean;
}

interface ClearingHouseSnapshot {
  readonly accounts: Map<string, { readonly balance: bigint; readonly quarantined: boolean; readonly bucket: { readonly tokens: bigint; readonly lastUpdateMs: bigint } }>;
  readonly treasuryBalance: bigint;
  readonly quarantineCount: number;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export class ClearingHouse {
  private readonly _accounts: Map<string, AccountState>;
  private _treasuryBalance: bigint;
  private _isLocked: boolean;
  private _lastRollback: boolean;
  private _totalSettledVolume: bigint;
  private _totalRetainedFees: bigint;
  private _quarantineCount: number;
  private _rejectedCount: number;
  private _lastMerkleRoot: bigint;
  private _globalChecksum: bigint;

  constructor() {
    this._accounts = new Map<string, AccountState>();
    this._treasuryBalance = 0n;
    this._isLocked = false;
    this._lastRollback = false;
    this._totalSettledVolume = 0n;
    this._totalRetainedFees = 0n;
    this._quarantineCount = 0;
    this._rejectedCount = 0;
    this._lastMerkleRoot = 0n;
    this._globalChecksum = 0n;
  }

  registerAccount(accountId: string, initialBalance: bigint, maxBytes: bigint, mbps: number): void {
    if (!accountId) throw new TypeError('accountId required');
    if (initialBalance < 0n) throw new RangeError('initialBalance must be non-negative');
    const bucket = new TokenBucket(maxBytes, mbps);
    this._accounts.set(accountId, { balance: initialBalance, bucket, quarantined: false });
    this._globalChecksum = (this._globalChecksum ^ initialBalance) & 0xFFFFFFFFFFFFFFFFn;
  }

  private _hashOrderLeaf(ord: TransferOrder, index: number): bigint {
    let h = FNV_OFFSET;
    h = ((h ^ BigInt(index)) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    h = ((h ^ ord.amount) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    h = ((h ^ ord.fee) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    return h;
  }

  private _hashPair(left: bigint, right: bigint): bigint {
    let h = FNV_OFFSET;
    h = ((h ^ left) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    h = ((h ^ right) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    return h;
  }

  private _computeBinaryMerkleRoot(orders: readonly TransferOrder[]): bigint {
    if (orders.length === 0) return 0n;
    let leaves: bigint[] = [];
    for (let i = 0; i < orders.length; i++) {
      const ord = orders[i];
      if (ord !== undefined) {
        leaves.push(this._hashOrderLeaf(ord, i));
      }
    }

    while (leaves.length > 1) {
      const nextLevel: bigint[] = [];
      for (let i = 0; i < leaves.length; i += 2) {
        const left = leaves[i];
        if (left !== undefined) {
          const right = i + 1 < leaves.length && leaves[i + 1] !== undefined ? (leaves[i + 1] as bigint) : left;
          nextLevel.push(this._hashPair(left, right));
        }
      }
      leaves = nextLevel;
    }

    return leaves[0] ?? 0n;
  }

  private _isOrderAdmitted(
    ord: TransferOrder,
    now: bigint,
    batchQuarantined: Set<string>,
    reservedBits: Map<string, bigint>
  ): boolean {
    if (ord.amount <= 0n || ord.fee < 0n) return false;
    const sender = this._accounts.get(ord.senderId);
    const receiver = this._accounts.get(ord.receiverId);
    if (!sender || !receiver || sender.quarantined || receiver.quarantined || batchQuarantined.has(ord.senderId)) {
      return false;
    }

    const requiredBits = (ord.amount + ord.fee) * 8n;
    const currentReserved = reservedBits.get(ord.senderId) ?? 0n;
    if (sender.bucket.peekTokens(now) < currentReserved + requiredBits) {
      batchQuarantined.add(ord.senderId);
      return false;
    }
    reservedBits.set(ord.senderId, currentReserved + requiredBits);
    return true;
  }

  private _admitOrders(
    orders: readonly TransferOrder[],
    now: bigint,
    batchQuarantined: Set<string>
  ): { admitted: TransferOrder[]; rejectedCount: number } {
    const admitted: TransferOrder[] = [];
    let rejectedCount = 0;
    const reservedBits = new Map<string, bigint>();

    for (const ord of orders) {
      if (this._isOrderAdmitted(ord, now, batchQuarantined, reservedBits)) {
        admitted.push(ord);
      } else {
        rejectedCount++;
      }
    }
    return { admitted, rejectedCount };
  }

  private _computeDeltas(orders: readonly TransferOrder[]): { deltas: Map<string, bigint>; volume: bigint; fees: bigint } {
    const deltas = new Map<string, bigint>();
    let volume = 0n;
    let fees = 0n;

    for (const ord of orders) {
      const sDelta = (deltas.get(ord.senderId) ?? 0n) - (ord.amount + ord.fee);
      const rDelta = (deltas.get(ord.receiverId) ?? 0n) + ord.amount;
      deltas.set(ord.senderId, sDelta);
      deltas.set(ord.receiverId, rDelta);
      volume = volume + ord.amount;
      fees = fees + ord.fee;
    }
    return { deltas, volume, fees };
  }

  private _verifySolvency(deltas: Map<string, bigint>): boolean {
    for (const [accId, delta] of deltas.entries()) {
      const acc = this._accounts.get(accId);
      if (acc && acc.balance + delta < 0n) {
        return false;
      }
    }
    return true;
  }

  private _commitBatch(
    orders: readonly TransferOrder[],
    deltas: Map<string, bigint>,
    batchQuarantined: Set<string>,
    now: bigint
  ): void {
    for (const ord of orders) {
      const sender = this._accounts.get(ord.senderId);
      if (sender) {
        const requiredBits = (ord.amount + ord.fee) * 8n;
        if (!sender.bucket.consume(requiredBits, now)) {
          throw new Error('commit effect rejected: token reservation was not effective');
        }
      }
    }

    for (const [accId, delta] of deltas.entries()) {
      const acc = this._accounts.get(accId);
      if (acc) acc.balance = acc.balance + delta;
    }

    for (const qAccId of batchQuarantined) {
      const acc = this._accounts.get(qAccId);
      if (acc) acc.quarantined = true;
    }
  }

  private _snapshotState(): ClearingHouseSnapshot {
    const accounts = new Map<string, { readonly balance: bigint; readonly quarantined: boolean; readonly bucket: { readonly tokens: bigint; readonly lastUpdateMs: bigint } }>();
    for (const [accountId, account] of this._accounts.entries()) {
      accounts.set(accountId, {
        balance: account.balance,
        quarantined: account.quarantined,
        bucket: account.bucket.snapshot()
      });
    }
    return {
      accounts,
      treasuryBalance: this._treasuryBalance,
      quarantineCount: this._quarantineCount
    };
  }

  private _restoreState(snapshot: ClearingHouseSnapshot): void {
    for (const [accountId, state] of snapshot.accounts.entries()) {
      const account = this._accounts.get(accountId);
      if (account) {
        account.balance = state.balance;
        account.quarantined = state.quarantined;
        account.bucket.restore(state.bucket);
      }
    }
    this._treasuryBalance = snapshot.treasuryBalance;
    this._quarantineCount = snapshot.quarantineCount;
  }

  processBatch(orders: readonly TransferOrder[], nowMs?: bigint): BatchResult {
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    this._lastRollback = false;

    if (this._isLocked) {
      return {
        settledCount: 0,
        rejectedCount: orders.length,
        quarantinedCount: 0,
        settledVolume: 0n,
        retainedFees: 0n,
        merkleRoot: this._lastMerkleRoot,
        rolledBack: false
      };
    }

    let initialSum = this._treasuryBalance;
    for (const acc of this._accounts.values()) initialSum = initialSum + acc.balance;

    const batchQuarantined = new Set<string>();
    const { admitted, rejectedCount } = this._admitOrders(orders, now, batchQuarantined);
    const { deltas, volume, fees } = this._computeDeltas(admitted);

    if (!this._verifySolvency(deltas)) {
      this._lastRollback = true;
      return {
        settledCount: 0,
        rejectedCount: orders.length,
        quarantinedCount: batchQuarantined.size,
        settledVolume: 0n,
        retainedFees: 0n,
        merkleRoot: 0n,
        rolledBack: true
      };
    }

    const snapshot = this._snapshotState();
    try {
      this._commitBatch(admitted, deltas, batchQuarantined, now);
      this._treasuryBalance = this._treasuryBalance + fees;
    } catch {
      this._restoreState(snapshot);
      this._lastRollback = true;
      return {
        settledCount: 0,
        rejectedCount: orders.length,
        quarantinedCount: batchQuarantined.size,
        settledVolume: 0n,
        retainedFees: 0n,
        merkleRoot: 0n,
        rolledBack: true
      };
    }

    let finalSum = this._treasuryBalance;
    for (const acc of this._accounts.values()) finalSum = finalSum + acc.balance;

    if (initialSum !== finalSum) {
      this._restoreState(snapshot);
      this._lastRollback = true;
      return {
        settledCount: 0,
        rejectedCount: orders.length,
        quarantinedCount: batchQuarantined.size,
        settledVolume: 0n,
        retainedFees: 0n,
        merkleRoot: 0n,
        rolledBack: true
      };
    }

    this._totalSettledVolume = this._totalSettledVolume + volume;
    this._totalRetainedFees = this._totalRetainedFees + fees;
    this._quarantineCount = this.activeQuarantineCount;
    this._rejectedCount = rejectedCount;

    const merkle = this._computeBinaryMerkleRoot(admitted);
    this._lastMerkleRoot = merkle;
    this._globalChecksum = (this._globalChecksum ^ merkle ^ finalSum) & 0xFFFFFFFFFFFFFFFFn;

    return {
      settledCount: admitted.length,
      rejectedCount,
      quarantinedCount: batchQuarantined.size,
      settledVolume: volume,
      retainedFees: fees,
      merkleRoot: merkle,
      rolledBack: false
    };
  }

  get activeQuarantineCount(): number {
    let count = 0;
    for (const acc of this._accounts.values()) {
      if (acc.quarantined) count++;
    }
    return count;
  }

  get treasuryBalance(): bigint { return this._treasuryBalance; }
  get isLocked(): boolean { return this._isLocked; }
  get lastRollback(): boolean { return this._lastRollback; }
  get totalSettledVolume(): bigint { return this._totalSettledVolume; }
  get totalRetainedFees(): bigint { return this._totalRetainedFees; }
  get quarantineCount(): number { return this._quarantineCount; }
  get rejectedCount(): number { return this._rejectedCount; }
  get lastMerkleRoot(): bigint { return this._lastMerkleRoot; }
  get globalChecksum(): bigint { return this._globalChecksum; }
}

export function obterClearingHouseBitmask(house: ClearingHouse): bigint {
  let mask = 0n;
  if (house.isLocked) mask = mask | 1n;
  if (house.quarantineCount > 0) mask = mask | 2n;
  if (house.lastRollback) mask = mask | 4n;
  if (house.totalSettledVolume > 10000000n) mask = mask | 8n;
  const q = BigInt(house.quarantineCount > 63 ? 63 : house.quarantineCount);
  mask = mask | ((q & 63n) << 4n);
  const r = BigInt(house.rejectedCount > 63 ? 63 : house.rejectedCount);
  mask = mask | ((r & 63n) << 10n);
  const top16 = (house.lastMerkleRoot >> 48n) & 65535n;
  mask = mask | ((top16 & 65535n) << 16n);
  const low32 = house.globalChecksum & 4294967295n;
  mask = mask | ((low32 & 4294967295n) << 32n);
  return mask;
}
