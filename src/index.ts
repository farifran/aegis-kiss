/**
 * Public entrypoint for the Settlement & Ledger Custody subsystem.
 * Exposes the core state transitions, risk velocity guards, and fee schedule.
 */

export {
  MAX_PENDING_SETTLEMENTS,
  DAILY_SETTLEMENT_LIMIT_CENTS,
  type SettlementItem,
  type SettlementLedgerState,
  type SettlementOutcome,
  createInitialLedgerState,
  enqueueSettlement,
  processSettlementBatch,
  inspectLedgerSnapshot,
} from './ledger/settlement_engine.js';

export {
  MAX_BATCH_REJECTIONS,
  type GuardCode,
  type GuardEvaluationResult,
  evaluateSettlementGuards,
  recordGuardRejection,
  resetGuardRejectionStreak,
} from './risk/velocity_guard.js';

export {
  BASIS_POINTS_FEE,
  MIN_SETTLEMENT_FEE_CENTS,
  MAX_SETTLEMENT_FEE_CENTS,
  calculateSettlementFeeCents,
  verifyFeeScheduleInvariant,
} from './ledger/fee_calculator.js';

export interface SubsystemHealthReport {
  readonly subsystem: 'SETTLEMENT_LEDGER_V1';
  readonly maxPendingCapacity: number;
  readonly dailyLimitCents: number;
  readonly maxBatchRejections: number;
  readonly feeBasisPoints: number;
}

export function getSubsystemHealthReport(): SubsystemHealthReport {
  return {
    subsystem: 'SETTLEMENT_LEDGER_V1',
    maxPendingCapacity: 250,
    dailyLimitCents: 5000000,
    maxBatchRejections: 5,
    feeBasisPoints: 15,
  };
}
