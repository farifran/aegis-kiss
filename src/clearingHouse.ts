import { TokenBucket } from './tokenBucket.js';

export interface TransferOrder {
  readonly id: string;
  readonly senderId: string;
  readonly receiverId: string;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly capacityCost?: bigint;
}

export type OperationStatus =
  | 'accepted'
  | 'rejected_invalid'
  | 'blocked_capacity'
  | 'blocked_insolvent';

export interface OperationDecision {
  readonly id: string;
  readonly status: OperationStatus;
  readonly reason?: string;
}

export interface BatchResult {
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly blockedCount: number;
  readonly settledVolume: bigint;
  readonly totalFees: bigint;
  readonly rolledBack: boolean;
  readonly executionDigest: bigint;
  readonly decisions: readonly OperationDecision[];
}

export interface AccountState {
  readonly accountId: string;
  readonly balance: bigint;
  readonly capacity: bigint;
  readonly availableCapacity: bigint;
}

interface InternalAccount {
  readonly accountId: string;
  balance: bigint;
  readonly bucket: TokenBucket;
}

export interface EngineSnapshot {
  readonly balances: Record<string, bigint>;
  readonly bucketStates: Record<string, { readonly tokens: bigint; readonly lastUpdateMs: bigint }>;
  readonly treasuryBalance: bigint;
  readonly totalSettledVolume: bigint;
  readonly totalRetainedFees: bigint;
}

interface ProjectedState {
  readonly balances: Record<string, bigint>;
  readonly capacityUsed: Record<string, bigint>;
  readonly decisions: OperationDecision[];
  acceptedCount: number;
  rejectedCount: number;
  blockedCount: number;
  batchVolume: bigint;
  batchFees: bigint;
}

interface DigestContext {
  readonly nowMs: bigint;
  readonly initTreasury: bigint;
  readonly finalTreasury: bigint;
  readonly rolledBack: boolean;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a(hash: bigint, value: bigint): bigint {
  let h = hash ^ (value & 0xFFFFFFFFFFFFFFFFn);
  h = (h * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
  return h;
}

function stringToHash(hash: bigint, str: string): bigint {
  let h = hash;
  for (let i = 0; i < str.length; i++) {
    const code = BigInt(str.charCodeAt(i));
    h = fnv1a(h, code);
  }
  return h;
}

export class ClearingHouse {
  private readonly _accounts: Record<string, InternalAccount>;
  private _treasuryBalance: bigint;
  private _totalSettledVolume: bigint;
  private _totalRetainedFees: bigint;

  constructor() {
    this._accounts = Object.create(null) as Record<string, InternalAccount>;
    this._treasuryBalance = 0n;
    this._totalSettledVolume = 0n;
    this._totalRetainedFees = 0n;
  }

  registerAccount(
    accountId: string,
    initialBalance: bigint,
    capacity: bigint,
    refillPerMs: bigint
  ): void {
    if (!accountId || accountId.trim() === '') {
      throw new TypeError('accountId must be a non-empty string');
    }
    if (this._accounts[accountId] !== undefined) {
      throw new Error(`account '${accountId}' already exists`);
    }
    if (initialBalance < 0n) {
      throw new RangeError('initialBalance must be non-negative');
    }

    const bucket = new TokenBucket(capacity, refillPerMs, capacity, 0n);
    this._accounts[accountId] = {
      accountId,
      balance: initialBalance,
      bucket
    };
  }

  getAccount(accountId: string, nowMs: bigint = 0n): AccountState | null {
    const acc = this._accounts[accountId];
    if (!acc) return null;
    return {
      accountId: acc.accountId,
      balance: acc.balance,
      capacity: acc.bucket.capacity,
      availableCapacity: acc.bucket.peekTokens(nowMs)
    };
  }

  snapshot(): EngineSnapshot {
    const balances: Record<string, bigint> = Object.create(null) as Record<string, bigint>;
    const bucketStates: Record<string, { readonly tokens: bigint; readonly lastUpdateMs: bigint }> = Object.create(null) as Record<string, { readonly tokens: bigint; readonly lastUpdateMs: bigint }>;

    for (const id in this._accounts) {
      const acc = this._accounts[id];
      if (acc) {
        balances[id] = acc.balance;
        bucketStates[id] = acc.bucket.snapshot();
      }
    }

    return {
      balances,
      bucketStates,
      treasuryBalance: this._treasuryBalance,
      totalSettledVolume: this._totalSettledVolume,
      totalRetainedFees: this._totalRetainedFees
    };
  }

  private _restore(snap: EngineSnapshot): void {
    for (const id in snap.balances) {
      const acc = this._accounts[id];
      const bal = snap.balances[id];
      if (acc && bal !== undefined) {
        acc.balance = bal;
      }
    }
    for (const id in snap.bucketStates) {
      const acc = this._accounts[id];
      const bState = snap.bucketStates[id];
      if (acc && bState !== undefined) {
        acc.bucket.restore(bState);
      }
    }
    this._treasuryBalance = snap.treasuryBalance;
    this._totalSettledVolume = snap.totalSettledVolume;
    this._totalRetainedFees = snap.totalRetainedFees;
  }

  private _validateSyntax(ord: TransferOrder, seen: Record<string, boolean>): string | null {
    if (!ord || !ord.id || ord.id.trim() === '') return 'empty order id';
    if (seen[ord.id]) return 'duplicate order id in batch';
    seen[ord.id] = true;
    if (!ord.senderId || !ord.receiverId) return 'invalid sender or receiver id';
    if (ord.amount <= 0n || ord.fee < 0n) return 'invalid amount or fee';
    return null;
  }

  private _validateEntities(ord: TransferOrder): string | null {
    if (!this._accounts[ord.senderId] || !this._accounts[ord.receiverId]) {
      return 'sender or receiver entity does not exist';
    }
    const neededCap = ord.capacityCost !== undefined ? ord.capacityCost : (ord.amount + ord.fee);
    if (neededCap < 0n) return 'negative capacity cost';
    return null;
  }

  private _projectSingleOrder(ord: TransferOrder, nowMs: bigint, proj: ProjectedState): void {
    const sender = this._accounts[ord.senderId];
    if (!sender) return;

    const neededCap = ord.capacityCost !== undefined ? ord.capacityCost : (ord.amount + ord.fee);
    const availCap = sender.bucket.peekTokens(nowMs);
    const usedCap = proj.capacityUsed[ord.senderId] ?? 0n;

    if (availCap < usedCap + neededCap) {
      proj.blockedCount++;
      proj.decisions.push({ id: ord.id, status: 'blocked_capacity', reason: 'insufficient capacity' });
      return;
    }

    const currentSenderBal = proj.balances[ord.senderId] ?? 0n;
    const totalCost = ord.amount + ord.fee;

    if (currentSenderBal < totalCost) {
      proj.blockedCount++;
      proj.decisions.push({ id: ord.id, status: 'blocked_insolvent', reason: 'insufficient balance' });
      return;
    }

    proj.capacityUsed[ord.senderId] = usedCap + neededCap;

    if (ord.senderId === ord.receiverId) {
      proj.balances[ord.senderId] = currentSenderBal - ord.fee;
    } else {
      proj.balances[ord.senderId] = currentSenderBal - totalCost;
      const currentRecvBal = proj.balances[ord.receiverId] ?? 0n;
      proj.balances[ord.receiverId] = currentRecvBal + ord.amount;
    }

    proj.acceptedCount++;
    proj.batchVolume += ord.amount;
    proj.batchFees += ord.fee;
    proj.decisions.push({ id: ord.id, status: 'accepted' });
  }

  private _verifyConservation(snapBefore: EngineSnapshot, proj: ProjectedState): boolean {
    let initialSum = snapBefore.treasuryBalance;
    for (const id in snapBefore.balances) {
      const b = snapBefore.balances[id];
      if (b !== undefined) initialSum += b;
    }

    let projectedSum = snapBefore.treasuryBalance + proj.batchFees;
    for (const id in proj.balances) {
      const bal = proj.balances[id];
      if (bal === undefined || bal < 0n) return false;
      projectedSum += bal;
    }

    return initialSum === projectedSum;
  }

  private _commitProjected(proj: ProjectedState, nowMs: bigint): void {
    for (const senderId in proj.capacityUsed) {
      const usedCap = proj.capacityUsed[senderId];
      if (usedCap !== undefined && usedCap > 0n) {
        const acc = this._accounts[senderId];
        if (acc && !acc.bucket.consume(usedCap, nowMs)) {
          throw new Error(`capacity consume failed for ${senderId}`);
        }
      }
    }

    for (const accId in proj.balances) {
      const newBal = proj.balances[accId];
      const acc = this._accounts[accId];
      if (acc && newBal !== undefined) {
        acc.balance = newBal;
      }
    }

    this._treasuryBalance += proj.batchFees;
    this._totalSettledVolume += proj.batchVolume;
    this._totalRetainedFees += proj.batchFees;
  }

  processBatch(orders: readonly TransferOrder[], nowMs: bigint): BatchResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');

    const snapBefore = this.snapshot();
    const seenOrderIds: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

    const initBalances: Record<string, bigint> = Object.create(null) as Record<string, bigint>;
    for (const k in snapBefore.balances) {
      const v = snapBefore.balances[k];
      if (v !== undefined) initBalances[k] = v;
    }

    const proj: ProjectedState = {
      balances: initBalances,
      capacityUsed: Object.create(null) as Record<string, bigint>,
      decisions: [],
      acceptedCount: 0,
      rejectedCount: 0,
      blockedCount: 0,
      batchVolume: 0n,
      batchFees: 0n
    };

    for (const ord of orders) {
      const synErr = this._validateSyntax(ord, seenOrderIds);
      if (synErr !== null) {
        proj.rejectedCount++;
        proj.decisions.push({ id: ord?.id ?? '', status: 'rejected_invalid', reason: synErr });
        continue;
      }
      const entErr = this._validateEntities(ord);
      if (entErr !== null) {
        proj.rejectedCount++;
        proj.decisions.push({ id: ord.id, status: 'rejected_invalid', reason: entErr });
        continue;
      }
      this._projectSingleOrder(ord, nowMs, proj);
    }

    if (!this._verifyConservation(snapBefore, proj)) {
      return this._buildAbortResult(nowMs, snapBefore, proj.decisions, orders);
    }

    try {
      this._commitProjected(proj, nowMs);
    } catch {
      this._restore(snapBefore);
      return this._buildAbortResult(nowMs, snapBefore, proj.decisions, orders);
    }

    const digestCtx: DigestContext = {
      nowMs,
      initTreasury: snapBefore.treasuryBalance,
      finalTreasury: this._treasuryBalance,
      rolledBack: false
    };
    const digest = this._computeExecutionDigest(digestCtx, proj.decisions, orders);

    return {
      acceptedCount: proj.acceptedCount,
      rejectedCount: proj.rejectedCount,
      blockedCount: proj.blockedCount,
      settledVolume: proj.batchVolume,
      totalFees: proj.batchFees,
      rolledBack: false,
      executionDigest: digest,
      decisions: proj.decisions
    };
  }

  private _buildAbortResult(
    nowMs: bigint,
    snapBefore: EngineSnapshot,
    decisions: OperationDecision[],
    orders: readonly TransferOrder[]
  ): BatchResult {
    this._restore(snapBefore);
    const digestCtx: DigestContext = {
      nowMs,
      initTreasury: snapBefore.treasuryBalance,
      finalTreasury: snapBefore.treasuryBalance,
      rolledBack: true
    };
    const digest = this._computeExecutionDigest(digestCtx, decisions, orders);

    let rejectedCount = 0;
    let blockedCount = 0;
    for (const d of decisions) {
      if (d.status === 'rejected_invalid') rejectedCount++;
      if (d.status === 'blocked_capacity' || d.status === 'blocked_insolvent') blockedCount++;
    }

    return {
      acceptedCount: 0,
      rejectedCount,
      blockedCount,
      settledVolume: 0n,
      totalFees: 0n,
      rolledBack: true,
      executionDigest: digest,
      decisions
    };
  }

  private _computeExecutionDigest(
    ctx: DigestContext,
    decisions: readonly OperationDecision[],
    orders: readonly TransferOrder[]
  ): bigint {
    let h = FNV_OFFSET;
    h = fnv1a(h, ctx.nowMs);
    h = fnv1a(h, ctx.initTreasury);
    h = fnv1a(h, ctx.finalTreasury);
    h = fnv1a(h, ctx.rolledBack ? 1n : 0n);

    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      const ord = orders[i];
      if (d) {
        h = stringToHash(h, d.id);
        h = stringToHash(h, d.status);
      }
      if (ord) {
        h = stringToHash(h, ord.senderId);
        h = stringToHash(h, ord.receiverId);
        h = fnv1a(h, ord.amount);
        h = fnv1a(h, ord.fee);
      }
    }

    return h;
  }

  get treasuryBalance(): bigint { return this._treasuryBalance; }
  get totalSettledVolume(): bigint { return this._totalSettledVolume; }
  get totalRetainedFees(): bigint { return this._totalRetainedFees; }
  get accountCount(): number { return Object.keys(this._accounts).length; }
}
