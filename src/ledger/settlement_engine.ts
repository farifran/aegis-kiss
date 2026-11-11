import {
  evaluateSettlementGuards,
  recordGuardRejection,
  resetGuardRejectionStreak,
  type GuardCode,
} from '../risk/velocity_guard.js';
import { calculateSettlementFeeCents } from './fee_calculator.js';

export const MAX_PENDING_SETTLEMENTS = 250;
export const DAILY_SETTLEMENT_LIMIT_CENTS = 5000000;

export interface SettlementItem {
  readonly settlementId: string;
  readonly merchantId: string;
  readonly grossAmountCents: number;
  readonly netAmountCents: number;
}

export interface SettlementLedgerState {
  readonly accountId: string;
  readonly accountFrozen: boolean;
  readonly disputeHoldActive: boolean;
  readonly pendingQueue: readonly SettlementItem[];
  readonly pendingCount: number;
  readonly settledBalanceCents: number;
  readonly dailySettledCents: number;
  readonly consecutiveBatchRejections: number;
}

export type SettlementStatus =
  | 'ENQUEUED'
  | 'QUEUE_FULL_REJECTED'
  | 'BATCH_SETTLED'
  | 'BATCH_EMPTY_NOOP'
  | GuardCode;

export interface SettlementOutcome {
  readonly status: SettlementStatus;
  readonly state: SettlementLedgerState;
  readonly processedCount: number;
  readonly settledBatchAmountCents: number;
}

export function createInitialLedgerState(accountId: string): SettlementLedgerState {
  return {
    accountId,
    accountFrozen: false,
    disputeHoldActive: false,
    pendingQueue: [],
    pendingCount: 0,
    settledBalanceCents: 0,
    dailySettledCents: 0,
    consecutiveBatchRejections: 0,
  };
}

/**
 * Registers a new settlement item into the bounded in-memory pending queue.
 * Enforces MAX_PENDING_SETTLEMENTS = 250 with explicit rejection on saturation.
 */
export function enqueueSettlement(
  state: SettlementLedgerState,
  settlementId: string,
  merchantId: string,
  grossAmountCents: number,
): SettlementOutcome {
  if (state.pendingCount >= MAX_PENDING_SETTLEMENTS) {
    return {
      status: 'QUEUE_FULL_REJECTED',
      state,
      processedCount: 0,
      settledBatchAmountCents: 0,
    };
  }

  const feeCents = calculateSettlementFeeCents(grossAmountCents);
  const netAmountCents = Math.max(0, grossAmountCents - feeCents);
  const nextItem: SettlementItem = {
    settlementId,
    merchantId,
    grossAmountCents,
    netAmountCents,
  };

  const nextQueue = [...state.pendingQueue, nextItem];
  const nextState: SettlementLedgerState = {
    ...state,
    pendingQueue: nextQueue,
    pendingCount: Math.min(MAX_PENDING_SETTLEMENTS, state.pendingCount + 1),
  };

  return {
    status: 'ENQUEUED',
    state: nextState,
    processedCount: 1,
    settledBatchAmountCents: 0,
  };
}

/**
 * Executes batch settlement of all pending items in FIFO order.
 * Currently evaluates GUARD_ACCOUNT_FROZEN and GUARD_DAILY_LIMIT_EXCEEDED via velocity_guard.
 * NOTE: Does not yet check GUARD_DISPUTE_HOLD_ACTIVE or support reverseSettlement.
 */
export function processSettlementBatch(
  state: SettlementLedgerState,
): SettlementOutcome {
  if (state.pendingCount === 0) {
    return {
      status: 'BATCH_EMPTY_NOOP',
      state,
      processedCount: 0,
      settledBatchAmountCents: 0,
    };
  }

  const batchTotalCents = state.pendingQueue.reduce(
    (acc, item) => acc + item.netAmountCents,
    0,
  );

  const guardVerdict = evaluateSettlementGuards({
    accountFrozen: state.accountFrozen,
    disputeHoldActive: state.disputeHoldActive,
    currentDailySettledCents: state.dailySettledCents,
    proposedBatchAmountCents: batchTotalCents,
    dailyLimitCents: DAILY_SETTLEMENT_LIMIT_CENTS,
  });

  if (!guardVerdict.allowed && guardVerdict.rejectionCode !== null) {
    const updatedRejections = recordGuardRejection(state.consecutiveBatchRejections);
    return {
      status: guardVerdict.rejectionCode,
      state: {
        ...state,
        consecutiveBatchRejections: updatedRejections,
      },
      processedCount: 0,
      settledBatchAmountCents: 0,
    };
  }

  const nextDailySettled = Math.min(
    DAILY_SETTLEMENT_LIMIT_CENTS,
    state.dailySettledCents + batchTotalCents,
  );
  const nextSettledBalance = state.settledBalanceCents + batchTotalCents;

  const nextState: SettlementLedgerState = {
    ...state,
    pendingQueue: [],
    pendingCount: 0,
    settledBalanceCents: nextSettledBalance,
    dailySettledCents: nextDailySettled,
    consecutiveBatchRejections: resetGuardRejectionStreak(),
  };

  return {
    status: 'BATCH_SETTLED',
    state: nextState,
    processedCount: state.pendingCount,
    settledBatchAmountCents: batchTotalCents,
  };
}

export interface LedgerObservableSnapshot {
  readonly accountId: string;
  readonly pendingCount: number;
  readonly settledBalanceCents: number;
  readonly dailySettledCents: number;
  readonly remainingDailyQuotaCents: number;
  readonly consecutiveBatchRejections: number;
}

export function inspectLedgerSnapshot(
  state: SettlementLedgerState,
): LedgerObservableSnapshot {
  return {
    accountId: state.accountId,
    pendingCount: state.pendingCount,
    settledBalanceCents: state.settledBalanceCents,
    dailySettledCents: state.dailySettledCents,
    remainingDailyQuotaCents: Math.max(0, DAILY_SETTLEMENT_LIMIT_CENTS - state.dailySettledCents),
    consecutiveBatchRejections: state.consecutiveBatchRejections,
  };
}
