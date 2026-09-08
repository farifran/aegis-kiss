/**
 * Barramento Rápido de Liquidação em Lote (Aegis Forensic State Transition Core).
 * Implementação KISS sem dependências externas, Zero-GC em caminhos quentes,
 * integridade de dupla entrada e determinismo temporal estrito.
 */
import { createHash } from 'node:crypto';
import {
  type Account,
  type Transaction,
  createAccount,
  applyDoubleEntryTransfer,
  computeTotalBalance,
} from './ledger.js';
import {
  isAccountIsolated,
  recordAccountFailure,
  recordAccountSuccess,
  checkAndRecordBurst,
  hasAnyIsolatedAccount,
} from './isolation.js';
import {
  calculateFee,
  pruneAndSumRollingVolume,
  VOLUME_ALERT_THRESHOLD,
  type VolumeRecord,
} from './fees.js';
import { computeHealthBitmask } from './health.js';

export type OrderStatus =
  | 'settled'
  | 'discarded_isolated'
  | 'rejected_insolvent'
  | 'rejected_invalid'
  | 'blocked_global_lock';

export interface OrderDecision {
  orderId: string;
  status: OrderStatus;
  fee: bigint;
  reason?: string | undefined;
}

export interface BatchSettlementResult {
  settledCount: number;
  discardedCount: number;
  rejectedCount: number;
  totalVolume: bigint;
  totalFees: bigint;
  healthBitmask: number;
  executionDigest: string;
  decisions: readonly OrderDecision[];
}

interface SettlementStep {
  status: OrderStatus;
  fee: bigint;
  volume: bigint;
  reason?: string | undefined;
}

export class OrderBus {
  private readonly accounts: Record<string, Account> = Object.create(null);
  private readonly treasuryId: string;
  private globalLock: boolean = false;
  private readonly volumeHistory: VolumeRecord[] = [];
  private lastTimestamp: bigint = 0n;

  constructor(treasuryId: string = 'treasury', initialTreasuryBalance: bigint = 0n) {
    this.treasuryId = treasuryId;
    this.accounts[treasuryId] = createAccount(treasuryId, initialTreasuryBalance);
  }

  public registerAccount(id: string, initialBalance: bigint): Account {
    if (this.accounts[id] !== undefined) {
      throw new Error(`Account already exists: ${id}`);
    }
    const acc = createAccount(id, initialBalance);
    this.accounts[id] = acc;
    return acc;
  }

  public getAccount(id: string): Account | undefined {
    return this.accounts[id];
  }

  public getAllAccounts(): Record<string, Account> {
    return this.accounts;
  }

  public getTreasuryId(): string {
    return this.treasuryId;
  }

  public setGlobalLock(locked: boolean): void {
    this.globalLock = locked;
  }

  public isGlobalLockActive(): boolean {
    return this.globalLock;
  }

  public getTotalBalance(): bigint {
    return computeTotalBalance(this.accounts);
  }

  public getHealthBitmask(now: bigint): number {
    const currentVolume = pruneAndSumRollingVolume(this.volumeHistory, now);
    const hasIsolated = hasAnyIsolatedAccount(this.accounts, now);
    const volumeAlert = currentVolume > VOLUME_ALERT_THRESHOLD;
    return computeHealthBitmask(this.globalLock, hasIsolated, volumeAlert);
  }

  private validateOrder(order: Transaction, sender?: Account, recipient?: Account): string | null {
    if (!order.id || order.id.length === 0) return 'invalid_order_id';
    if (order.amount <= 0n) return 'invalid_amount';
    if (order.sender === order.recipient) return 'self_transfer_disallowed';
    if (!sender) return 'sender_not_found';
    if (!recipient) return 'recipient_not_found';
    return null;
  }

  private settleSingleOrder(order: Transaction, now: bigint, currentVolume: bigint): SettlementStep {
    const sender = this.accounts[order.sender];
    const recipient = this.accounts[order.recipient];
    const validationError = this.validateOrder(order, sender, recipient);
    if (validationError !== null || !sender || !recipient) {
      return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: validationError ?? 'account_missing' };
    }

    if (isAccountIsolated(sender, now)) {
      return { status: 'discarded_isolated', fee: 0n, volume: 0n, reason: 'sender_isolated' };
    }

    if (checkAndRecordBurst(sender, now)) {
      return { status: 'discarded_isolated', fee: 0n, volume: 0n, reason: 'burst_limit_exceeded' };
    }

    const treasury = this.accounts[this.treasuryId];
    if (!treasury) {
      return { status: 'rejected_invalid', fee: 0n, volume: 0n, reason: 'treasury_missing' };
    }

    const fee = calculateFee(order.amount, currentVolume);
    const transferResult = applyDoubleEntryTransfer({ sender, recipient, treasury }, order.amount, fee);
    if (!transferResult.success) {
      recordAccountFailure(sender, now);
      return { status: 'rejected_insolvent', fee: 0n, volume: 0n, reason: transferResult.reason ?? 'transfer_failed' };
    }

    recordAccountSuccess(sender);
    return { status: 'settled', fee, volume: order.amount };
  }

  private computeDigest(
    decisions: readonly OrderDecision[],
    totalVolume: bigint,
    totalFees: bigint,
    healthBitmask: number,
  ): string {
    const hash = createHash('sha256');
    const keys = Object.keys(this.accounts).sort();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k !== undefined) {
        const acc = this.accounts[k];
        if (acc !== undefined) {
          hash.update(`${k}:${acc.balance}:${acc.isolatedUntil};`);
        }
      }
    }
    hash.update(`volume:${totalVolume};fees:${totalFees};mask:${healthBitmask};`);
    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      if (d !== undefined) {
        hash.update(`${d.orderId}:${d.status}:${d.fee};`);
      }
    }
    return hash.digest('hex');
  }

  /**
   * Liquida sequencialmente um lote de ordens em memória.
   * Aplica partidas dobradas, taxas dinâmicas, descarte de contas isoladas e bitmask de saúde.
   */
  public processBatch(orders: readonly Transaction[], now: bigint): BatchSettlementResult {
    if (now < this.lastTimestamp) {
      throw new RangeError('Timestamp cannot regress: ARCH-DETERMINISTIC-TIME');
    }
    this.lastTimestamp = now;

    let currentVolume = pruneAndSumRollingVolume(this.volumeHistory, now);
    const decisions: OrderDecision[] = [];
    let settledCount = 0;
    let discardedCount = 0;
    let rejectedCount = 0;
    let totalVolume = 0n;
    let totalFees = 0n;

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (order === undefined) continue;

      if (this.globalLock) {
        decisions.push({ orderId: order.id, status: 'blocked_global_lock', fee: 0n, reason: 'global_lock_active' });
        rejectedCount++;
        continue;
      }

      const step = this.settleSingleOrder(order, now, currentVolume);
      if (step.status === 'settled') {
        this.volumeHistory.push({ timestamp: now, volume: step.volume });
        currentVolume += step.volume;
        totalVolume += step.volume;
        totalFees += step.fee;
        settledCount++;
      } else if (step.status === 'discarded_isolated') {
        discardedCount++;
      } else {
        rejectedCount++;
      }

      decisions.push({ orderId: order.id, status: step.status, fee: step.fee, reason: step.reason });
    }

    const hasIsolated = hasAnyIsolatedAccount(this.accounts, now);
    const volumeAlert = currentVolume > VOLUME_ALERT_THRESHOLD;
    const highFailureRate = orders.length > 0 && ((rejectedCount + discardedCount) * 100) / orders.length > 50;
    const healthBitmask = computeHealthBitmask(this.globalLock, hasIsolated, volumeAlert, highFailureRate);

    const executionDigest = this.computeDigest(decisions, totalVolume, totalFees, healthBitmask);

    return {
      settledCount,
      discardedCount,
      rejectedCount,
      totalVolume,
      totalFees,
      healthBitmask,
      executionDigest,
      decisions,
    };
  }
}
