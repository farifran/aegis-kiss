import { createHash } from 'node:crypto';
import {
  type AccountSnapshot,
  type AccountTable,
  type Transaction,
  applyDoubleEntryTransfer,
  cloneAccount,
  computeTotalBalance,
  createAccount,
  createAccountTable,
  snapshotAccount,
} from './ledger.js';
import {
  checkAndRecordBurst,
  hasAnyIsolatedAccount,
  isAccountIsolated,
  recordAccountFailure,
  recordAccountSuccess,
} from './isolation.js';
import {
  VOLUME_ALERT_THRESHOLD,
  type VolumeRecord,
  calculateFee,
  pruneAndSumRollingVolume,
  sumRollingVolume,
} from './fees.js';
import { computeHealthBitmask } from './health.js';

export type OrderStatus = 'settled' | 'discarded_isolated' | 'rejected_insolvent' | 'rejected_invalid';

export interface OrderDecision {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly fee: bigint;
  readonly reason?: string | undefined;
}

export interface BatchSettlementResult {
  readonly settledCount: number;
  readonly discardedCount: number;
  readonly rejectedCount: number;
  readonly totalVolume: bigint;
  readonly totalFees: bigint;
  readonly healthBitmask: number;
  readonly executionDigest: string;
  readonly decisions: readonly OrderDecision[];
}

interface SettlementStep {
  readonly status: OrderStatus;
  readonly fee: bigint;
  readonly volume: bigint;
  readonly reason?: string | undefined;
}

interface BusState {
  accounts: AccountTable;
  volumeHistory: VolumeRecord[];
  lastTimestamp: bigint;
  globalLock: boolean;
}

interface DigestInput {
  state: BusState;
  orders: readonly Transaction[];
  now: bigint;
  decisions: readonly OrderDecision[];
  totalVolume: bigint;
  totalFees: bigint;
  healthBitmask: number;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function cloneState(state: BusState): BusState {
  const accounts = createAccountTable();
  for (const id of Object.keys(state.accounts)) {
    const account = state.accounts[id];
    if (account !== undefined) accounts[id] = cloneAccount(account);
  }
  return {
    accounts,
    volumeHistory: state.volumeHistory.map((entry) => ({ ...entry })),
    lastTimestamp: state.lastTimestamp,
    globalLock: state.globalLock,
  };
}

function serializableState(state: BusState): object {
  return {
    accounts: Object.keys(state.accounts).sort(compareCodeUnits).map((id) => {
      const account = state.accounts[id];
      if (account === undefined) throw new Error('Invariant violated: missing account');
      return [id, account.balance, account.consecutiveFailures, account.burstCount, account.burstWindowStart, account.isolatedUntil];
    }),
    volumeHistory: state.volumeHistory.map(({ timestamp, volume }) => [timestamp, volume]),
    lastTimestamp: state.lastTimestamp,
    globalLock: state.globalLock,
  };
}

function digestPayload(value: object): string {
  return JSON.stringify(value, (_key, candidate: unknown) => (
    typeof candidate === 'bigint' ? { bigint: candidate.toString() } : candidate
  ));
}

export class OrderBus {
  private state: BusState;
  private readonly treasuryId: string;

  constructor(treasuryId: string = 'treasury', initialTreasuryBalance: bigint = 0n) {
    const treasury = createAccount(treasuryId, initialTreasuryBalance);
    this.treasuryId = treasury.id;
    const accounts = createAccountTable();
    accounts[treasury.id] = treasury;
    this.state = { accounts, volumeHistory: [], lastTimestamp: 0n, globalLock: false };
  }

  public registerAccount(id: string, initialBalance: bigint): AccountSnapshot {
    if (this.state.accounts[id] !== undefined) throw new Error(`Account already exists: ${id}`);
    const projected = cloneState(this.state);
    const account = createAccount(id, initialBalance);
    projected.accounts[id] = account;
    this.assertStateInvariants(projected, computeTotalBalance(projected.accounts));
    this.state = projected;
    return snapshotAccount(account);
  }

  public getAccount(id: string): AccountSnapshot | undefined {
    const account = this.state.accounts[id];
    return account === undefined ? undefined : snapshotAccount(account);
  }

  public getAllAccounts(): Readonly<Record<string, AccountSnapshot>> {
    const snapshots = Object.create(null) as Record<string, AccountSnapshot>;
    for (const id of Object.keys(this.state.accounts).sort(compareCodeUnits)) {
      const account = this.state.accounts[id];
      if (account !== undefined) snapshots[id] = snapshotAccount(account);
    }
    return Object.freeze(snapshots);
  }

  public getTreasuryId(): string {
    return this.treasuryId;
  }

  public setGlobalLock(locked: boolean): void {
    const projected = cloneState(this.state);
    this.state = { ...projected, globalLock: locked };
  }

  public isGlobalLockActive(): boolean {
    return this.state.globalLock;
  }

  public getTotalBalance(): bigint {
    return computeTotalBalance(this.state.accounts);
  }

  public getHealthBitmask(now: bigint): number {
    this.assertReadableTime(now);
    return computeHealthBitmask(
      this.state.globalLock,
      hasAnyIsolatedAccount(this.state.accounts, now),
      sumRollingVolume(this.state.volumeHistory, now) > VOLUME_ALERT_THRESHOLD,
    );
  }

  public processBatch(orders: readonly Transaction[], now: bigint): BatchSettlementResult {
    this.assertReadableTime(now);
    if (now < this.state.lastTimestamp) throw new RangeError('Timestamp cannot regress: ARCH-DETERMINISTIC-TIME');

    const totalBefore = this.getTotalBalance();
    const projected = cloneState(this.state);
    projected.lastTimestamp = now;
    let rollingVolume = pruneAndSumRollingVolume(projected.volumeHistory, now);
    const decisions: OrderDecision[] = [];
    let totalVolume = 0n;
    let totalFees = 0n;

    for (const order of orders) {
      const step = this.settleOrder(projected, order, now, rollingVolume);
      if (step.status === 'settled') {
        projected.volumeHistory.push({ timestamp: now, volume: step.volume });
        rollingVolume += step.volume;
        totalVolume += step.volume;
        totalFees += step.fee;
      }
      decisions.push(Object.freeze({ orderId: order.id, status: step.status, fee: step.fee, reason: step.reason }));
    }

    this.assertStateInvariants(projected, totalBefore);
    const healthBitmask = computeHealthBitmask(
      projected.globalLock,
      hasAnyIsolatedAccount(projected.accounts, now),
      rollingVolume > VOLUME_ALERT_THRESHOLD,
    );
    const frozenDecisions = Object.freeze([...decisions]);
    const result = Object.freeze({
      ...this.deriveAggregates(frozenDecisions, totalVolume, totalFees),
      healthBitmask,
      executionDigest: this.computeDigest({
        state: projected,
        orders,
        now,
        decisions: frozenDecisions,
        totalVolume,
        totalFees,
        healthBitmask,
      }),
      decisions: frozenDecisions,
    });
    this.state = projected;
    return result;
  }

  private assertReadableTime(now: bigint): void {
    if (now < 0n) throw new RangeError('Timestamp cannot be negative');
  }

  private settleOrder(state: BusState, order: Transaction, now: bigint, rollingVolume: bigint): SettlementStep {
    const sender = state.accounts[order.sender];
    const recipient = state.accounts[order.recipient];
    if (order.id.length === 0) return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: 'invalid_order_id' };
    if (order.amount < 0n) return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: 'invalid_amount' };
    if (order.sender === order.recipient) return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: 'self_transfer_disallowed' };
    if (sender === undefined || recipient === undefined) return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: 'account_not_found' };
    if (isAccountIsolated(sender, now) || checkAndRecordBurst(sender, now)) {
      return { status: 'discarded_isolated', fee: 0n, volume: 0n, reason: 'sender_isolated' };
    }
    const treasury = state.accounts[this.treasuryId];
    if (treasury === undefined) return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: 'treasury_missing' };
    const fee = calculateFee(order.amount, rollingVolume);
    const transfer = applyDoubleEntryTransfer({ sender, recipient, treasury }, order.amount, fee);
    if (!transfer.success) {
      recordAccountFailure(sender, now);
      return { status: 'rejected_insolvent', fee: 0n, volume: 0n, reason: transfer.reason };
    }
    recordAccountSuccess(sender);
    return { status: 'settled', fee, volume: order.amount };
  }

  private deriveAggregates(decisions: readonly OrderDecision[], totalVolume: bigint, totalFees: bigint): Omit<BatchSettlementResult, 'healthBitmask' | 'executionDigest' | 'decisions'> {
    let settledCount = 0;
    let discardedCount = 0;
    let rejectedCount = 0;
    for (const decision of decisions) {
      if (decision.status === 'settled') settledCount += 1;
      else if (decision.status === 'discarded_isolated') discardedCount += 1;
      else rejectedCount += 1;
    }
    return { settledCount, discardedCount, rejectedCount, totalVolume, totalFees };
  }

  private assertStateInvariants(state: BusState, expectedTotal: bigint): void {
    if (computeTotalBalance(state.accounts) !== expectedTotal) throw new Error('Invariant violated: balance conservation');
    for (const id of Object.keys(state.accounts)) {
      const account = state.accounts[id];
      if (account === undefined) throw new Error('Invariant violated: missing account');
      if (account.balance < 0n) throw new Error('Invariant violated: negative balance');
      if (account.burstCount < 0 || account.consecutiveFailures < 0) throw new Error('Invariant violated: negative counter');
    }
  }

  private computeDigest(input: DigestInput): string {
    const { state, orders, now, decisions, totalVolume, totalFees, healthBitmask } = input;
    const payload = digestPayload({
      schema: 'aegis.order_bus.transition.v1',
      now,
      orders: orders.map(({ id, sender, recipient, amount }) => [id, sender, recipient, amount]),
      decisions: decisions.map(({ orderId, status, fee, reason }) => [orderId, status, fee, reason ?? null]),
      result: { totalVolume, totalFees, healthBitmask },
      state: serializableState(state),
    });
    return createHash('sha256').update(payload).digest('hex');
  }
}
