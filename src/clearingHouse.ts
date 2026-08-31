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

interface ExecutedSettlement {
  readonly sender: AccountState;
  readonly receiver: AccountState;
  readonly amount: bigint;
  readonly fee: bigint;
}

interface OrderExecutionResult {
  readonly status: 'settled' | 'quarantined' | 'rejected';
  readonly amount: bigint;
  readonly fee: bigint;
}

export class ClearingHouse {
  private readonly _accounts: Map<string, AccountState>;
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

  private _computeMerkleRoot(orders: readonly TransferOrder[]): bigint {
    let merkle = 0xcbf29ce484222325n;
    const fnvPrime = 0x100000001b3n;
    for (const ord of orders) {
      merkle = ((merkle ^ ord.amount) * fnvPrime) & 0xFFFFFFFFFFFFFFFFn;
      merkle = ((merkle ^ ord.fee) * fnvPrime) & 0xFFFFFFFFFFFFFFFFn;
    }
    return merkle;
  }

  private _rollbackSettlements(executed: readonly ExecutedSettlement[]): void {
    for (const ex of executed) {
      ex.sender.balance = ex.sender.balance + ex.amount + ex.fee;
      ex.receiver.balance = ex.receiver.balance - ex.amount;
    }
  }

  private _sumBalances(): bigint {
    let sum = 0n;
    for (const acc of this._accounts.values()) {
      sum = sum + acc.balance;
    }
    return sum;
  }

  private _tryProcessOrder(
    ord: TransferOrder,
    now: bigint,
    executed: ExecutedSettlement[]
  ): OrderExecutionResult {
    if (ord.amount <= 0n || ord.fee < 0n) {
      return { status: 'rejected', amount: 0n, fee: 0n };
    }
    const sender = this._accounts.get(ord.senderId);
    const receiver = this._accounts.get(ord.receiverId);
    if (!sender || !receiver || sender.quarantined) {
      return { status: 'rejected', amount: 0n, fee: 0n };
    }

    const requiredBits = (ord.amount + ord.fee) * 8n;
    if (!sender.bucket.consume(requiredBits, now)) {
      sender.quarantined = true;
      return { status: 'quarantined', amount: 0n, fee: 0n };
    }

    const totalDebit = ord.amount + ord.fee;
    if (sender.balance < totalDebit) {
      return { status: 'rejected', amount: 0n, fee: 0n };
    }

    sender.balance = sender.balance - totalDebit;
    receiver.balance = receiver.balance + ord.amount;
    executed.push({ sender, receiver, amount: ord.amount, fee: ord.fee });
    return { status: 'settled', amount: ord.amount, fee: ord.fee };
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

    const initialSum = this._sumBalances();
    let rejectedCount = 0;
    let quarantinedCount = 0;
    let settledVolume = 0n;
    let retainedFees = 0n;
    const validOrders: TransferOrder[] = [];
    const executed: ExecutedSettlement[] = [];

    for (const ord of orders) {
      const res = this._tryProcessOrder(ord, now, executed);
      if (res.status === 'settled') {
        settledVolume = settledVolume + res.amount;
        retainedFees = retainedFees + res.fee;
        validOrders.push(ord);
      } else if (res.status === 'quarantined') {
        quarantinedCount++;
        rejectedCount++;
      } else {
        rejectedCount++;
      }
    }

    const finalSum = retainedFees + this._sumBalances();
    if (initialSum !== finalSum) {
      this._rollbackSettlements(executed);
      this._lastRollback = true;
      return {
        settledCount: 0,
        rejectedCount: orders.length,
        quarantinedCount,
        settledVolume: 0n,
        retainedFees: 0n,
        merkleRoot: 0n,
        rolledBack: true
      };
    }

    const merkle = this._computeMerkleRoot(validOrders);
    this._totalSettledVolume = this._totalSettledVolume + settledVolume;
    this._totalRetainedFees = this._totalRetainedFees + retainedFees;
    this._quarantineCount = quarantinedCount;
    this._rejectedCount = rejectedCount;
    this._lastMerkleRoot = merkle;
    this._globalChecksum = (this._globalChecksum ^ merkle ^ finalSum) & 0xFFFFFFFFFFFFFFFFn;

    return {
      settledCount: validOrders.length,
      rejectedCount,
      quarantinedCount,
      settledVolume,
      retainedFees,
      merkleRoot: merkle,
      rolledBack: false
    };
  }

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
