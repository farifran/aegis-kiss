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
  | 'committed'
  | 'rejected_invalid'
  | 'blocked_capacity'
  | 'blocked_insolvent'
  | 'aborted';

export interface OperationDecision {
  readonly index: number;
  readonly id: string;
  readonly status: OperationStatus;
  readonly reason?: string;
}

export interface BatchResult {
  readonly committedCount: number;
  readonly rejectedCount: number;
  readonly blockedCount: number;
  readonly abortedCount: number;
  readonly settledVolume: bigint;
  readonly totalFees: bigint;
  readonly rolledBack: boolean;
  readonly rollbackReason?: string;
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
  readonly lastProcessedMs: bigint;
}

interface ProjectedState {
  readonly balances: Record<string, bigint>;
  readonly capacityUsed: Record<string, bigint>;
  readonly decisions: OperationDecision[];
  committedCount: number;
  rejectedCount: number;
  blockedCount: number;
  abortedCount: number;
  batchVolume: bigint;
  batchFees: bigint;
}

interface AbortContext {
  readonly nowMs: bigint;
  readonly snapBefore: EngineSnapshot;
  readonly orders: readonly TransferOrder[];
  readonly reason: string;
}

interface DigestContext {
  readonly nowMs: bigint;
  readonly lastProcessedMs: bigint;
  readonly initTreasury: bigint;
  readonly finalTreasury: bigint;
  readonly rolledBack: boolean;
  readonly rollbackReason?: string;
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
  private _lastProcessedMs: bigint;

  constructor() {
    this._accounts = Object.create(null) as Record<string, InternalAccount>;
    this._treasuryBalance = 0n;
    this._totalSettledVolume = 0n;
    this._totalRetainedFees = 0n;
    this._lastProcessedMs = 0n;
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

    const sortedIds = Object.keys(this._accounts).sort();
    for (let i = 0; i < sortedIds.length; i++) {
      const id = sortedIds[i];
      if (id) {
        const acc = this._accounts[id];
        if (acc) {
          balances[id] = acc.balance;
          bucketStates[id] = acc.bucket.snapshot();
        }
      }
    }

    return {
      balances,
      bucketStates,
      treasuryBalance: this._treasuryBalance,
      totalSettledVolume: this._totalSettledVolume,
      totalRetainedFees: this._totalRetainedFees,
      lastProcessedMs: this._lastProcessedMs
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
    this._lastProcessedMs = snap.lastProcessedMs;
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

  private _projectSingleOrder(ord: TransferOrder, index: number, nowMs: bigint, proj: ProjectedState): void {
    const sender = this._accounts[ord.senderId];
    if (!sender) return;

    const neededCap = ord.capacityCost !== undefined ? ord.capacityCost : (ord.amount + ord.fee);
    const availCap = sender.bucket.peekTokens(nowMs);
    const usedCap = proj.capacityUsed[ord.senderId] ?? 0n;

    if (availCap < usedCap + neededCap) {
      proj.blockedCount++;
      proj.decisions.push({ index, id: ord.id, status: 'blocked_capacity', reason: 'insufficient throughput capacity' });
      return;
    }

    const currentSenderBal = proj.balances[ord.senderId] ?? 0n;
    const totalCost = ord.amount + ord.fee;

    if (currentSenderBal < totalCost) {
      proj.blockedCount++;
      proj.decisions.push({ index, id: ord.id, status: 'blocked_insolvent', reason: 'insufficient projected balance' });
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

    proj.committedCount++;
    proj.batchVolume += ord.amount;
    proj.batchFees += ord.fee;
    proj.decisions.push({ index, id: ord.id, status: 'committed' });
  }

  private _validateGlobalInvariants(snapBefore: EngineSnapshot, proj: ProjectedState): string | null {
    let initialSum = snapBefore.treasuryBalance;
    for (const id in snapBefore.balances) {
      const b = snapBefore.balances[id];
      if (b !== undefined) initialSum += b;
    }

    let projectedSum = snapBefore.treasuryBalance + proj.batchFees;
    for (const id in proj.balances) {
      const bal = proj.balances[id];
      if (bal === undefined || bal < 0n) return 'negative projected balance detected';
      projectedSum += bal;
    }

    if (initialSum !== projectedSum) return 'zero-sum balance conservation violated in projection';
    return null;
  }

  private _validateActualState(snapBefore: EngineSnapshot, proj: ProjectedState): string | null {
    let initialSum = snapBefore.treasuryBalance;
    for (const id in snapBefore.balances) {
      const b = snapBefore.balances[id];
      if (b !== undefined) initialSum += b;
    }

    let actualSum = this._treasuryBalance;
    for (const id in this._accounts) {
      const acc = this._accounts[id];
      if (acc) {
        if (acc.balance < 0n) return 'negative balance detected in actual state';
        if (acc.bucket.tokens < 0n || acc.bucket.tokens > acc.bucket.capacity) {
          return 'bucket tokens out of bounds in actual state';
        }
        actualSum += acc.balance;
      }
    }

    const expectedSum = initialSum;
    if (actualSum !== expectedSum) return 'zero-sum conservation violated in actual state';
    if (this._treasuryBalance !== snapBefore.treasuryBalance + proj.batchFees) {
      return 'treasury balance mismatch in actual state';
    }
    return null;
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
    this._lastProcessedMs = nowMs;
  }

  private _executeProjection(orders: readonly TransferOrder[], nowMs: bigint, proj: ProjectedState): void {
    const seenOrderIds: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

    for (let i = 0; i < orders.length; i++) {
      const ord = orders[i];
      if (!ord) {
        proj.rejectedCount++;
        proj.decisions.push({ index: i, id: '', status: 'rejected_invalid', reason: 'null or undefined order slot' });
        continue;
      }
      const synErr = this._validateSyntax(ord, seenOrderIds);
      if (synErr !== null) {
        proj.rejectedCount++;
        proj.decisions.push({ index: i, id: ord.id, status: 'rejected_invalid', reason: synErr });
        continue;
      }
      const entErr = this._validateEntities(ord);
      if (entErr !== null) {
        proj.rejectedCount++;
        proj.decisions.push({ index: i, id: ord.id, status: 'rejected_invalid', reason: entErr });
        continue;
      }
      this._projectSingleOrder(ord, i, nowMs, proj);
    }
  }

  processBatch(orders: readonly TransferOrder[], nowMs: bigint): BatchResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');

    const snapBefore = this.snapshot();
    if (nowMs < this._lastProcessedMs) {
      return this._buildAbortResult({ nowMs, snapBefore, orders, reason: 'time moved backwards relative to last processed batch' }, []);
    }

    const initBalances: Record<string, bigint> = Object.create(null) as Record<string, bigint>;
    for (const k in snapBefore.balances) {
      const v = snapBefore.balances[k];
      if (v !== undefined) initBalances[k] = v;
    }

    const proj: ProjectedState = {
      balances: initBalances,
      capacityUsed: Object.create(null) as Record<string, bigint>,
      decisions: [],
      committedCount: 0,
      rejectedCount: 0,
      blockedCount: 0,
      abortedCount: 0,
      batchVolume: 0n,
      batchFees: 0n
    };

    this._executeProjection(orders, nowMs, proj);

    const invErr = this._validateGlobalInvariants(snapBefore, proj);
    if (invErr !== null) {
      return this._buildAbortResult({ nowMs, snapBefore, orders, reason: invErr }, proj.decisions);
    }

    try {
      this._commitProjected(proj, nowMs);
    } catch {
      this._restore(snapBefore);
      return this._buildAbortResult({ nowMs, snapBefore, orders, reason: 'commit transaction failure' }, proj.decisions);
    }

    const actualErr = this._validateActualState(snapBefore, proj);
    if (actualErr !== null) {
      this._restore(snapBefore);
      return this._buildAbortResult({ nowMs, snapBefore, orders, reason: actualErr }, proj.decisions);
    }

    const digestCtx: DigestContext = {
      nowMs,
      lastProcessedMs: this._lastProcessedMs,
      initTreasury: snapBefore.treasuryBalance,
      finalTreasury: this._treasuryBalance,
      rolledBack: false
    };
    const digest = this._computeExecutionDigest(digestCtx, proj.decisions, orders);

    return {
      committedCount: proj.committedCount,
      rejectedCount: proj.rejectedCount,
      blockedCount: proj.blockedCount,
      abortedCount: 0,
      settledVolume: proj.batchVolume,
      totalFees: proj.batchFees,
      rolledBack: false,
      executionDigest: digest,
      decisions: proj.decisions
    };
  }

  private _buildAbortResult(
    ctx: AbortContext,
    decisions: OperationDecision[]
  ): BatchResult {
    this._restore(ctx.snapBefore);
    const updatedDecisions: OperationDecision[] = [];

    let rejectedCount = 0;
    let blockedCount = 0;
    let abortedCount = 0;

    for (const d of decisions) {
      if (d.status === 'committed') {
        abortedCount++;
        updatedDecisions.push({ index: d.index, id: d.id, status: 'aborted', reason: `aborted due to batch rollback: ${ctx.reason}` });
      } else {
        if (d.status === 'rejected_invalid') rejectedCount++;
        if (d.status === 'blocked_capacity' || d.status === 'blocked_insolvent') blockedCount++;
        updatedDecisions.push(d);
      }
    }

    const digestCtx: DigestContext = {
      nowMs: ctx.nowMs,
      lastProcessedMs: ctx.snapBefore.lastProcessedMs,
      initTreasury: ctx.snapBefore.treasuryBalance,
      finalTreasury: ctx.snapBefore.treasuryBalance,
      rolledBack: true,
      rollbackReason: ctx.reason
    };
    const digest = this._computeExecutionDigest(digestCtx, updatedDecisions, ctx.orders);

    return {
      committedCount: 0,
      rejectedCount,
      blockedCount,
      abortedCount,
      settledVolume: 0n,
      totalFees: 0n,
      rolledBack: true,
      rollbackReason: ctx.reason,
      executionDigest: digest,
      decisions: updatedDecisions
    };
  }

  private _computeExecutionDigest(
    ctx: DigestContext,
    decisions: readonly OperationDecision[],
    orders: readonly TransferOrder[]
  ): bigint {
    let h = FNV_OFFSET;
    h = fnv1a(h, ctx.nowMs);
    h = fnv1a(h, ctx.lastProcessedMs);
    h = fnv1a(h, ctx.initTreasury);
    h = fnv1a(h, ctx.finalTreasury);
    h = fnv1a(h, ctx.rolledBack ? 1n : 0n);
    if (ctx.rollbackReason) h = stringToHash(h, ctx.rollbackReason);

    for (let i = 0; i < orders.length; i++) {
      const ord = orders[i];
      if (ord) {
        h = fnv1a(h, BigInt(i));
        h = stringToHash(h, ord.id);
        h = stringToHash(h, ord.senderId);
        h = stringToHash(h, ord.receiverId);
        h = fnv1a(h, ord.amount);
        h = fnv1a(h, ord.fee);
        if (ord.capacityCost !== undefined) h = fnv1a(h, ord.capacityCost);
      } else {
        h = fnv1a(h, BigInt(i));
        h = stringToHash(h, '__undefined_order__');
      }
    }

    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      if (d) {
        h = fnv1a(h, BigInt(d.index));
        h = stringToHash(h, d.id);
        h = stringToHash(h, d.status);
        if (d.reason) h = stringToHash(h, d.reason);
      }
    }

    const sortedAccIds = Object.keys(this._accounts).sort();
    for (let i = 0; i < sortedAccIds.length; i++) {
      const accId = sortedAccIds[i];
      if (accId) {
        const acc = this._accounts[accId];
        if (acc) {
          h = stringToHash(h, acc.accountId);
          h = fnv1a(h, acc.balance);
          h = fnv1a(h, acc.bucket.tokens);
        }
      }
    }

    return h;
  }

  get treasuryBalance(): bigint { return this._treasuryBalance; }
  get totalSettledVolume(): bigint { return this._totalSettledVolume; }
  get totalRetainedFees(): bigint { return this._totalRetainedFees; }
  get lastProcessedMs(): bigint { return this._lastProcessedMs; }
  get accountCount(): number { return Object.keys(this._accounts).length; }
}
