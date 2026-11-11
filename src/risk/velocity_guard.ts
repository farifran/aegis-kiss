/**
 * Risk and Velocity Guard evaluation module for batch settlements.
 * Defines linear guard precedence and bounded rejection counters.
 */

export const MAX_BATCH_REJECTIONS = 5;

export type GuardCode =
  | 'GUARD_ACCOUNT_FROZEN'
  | 'GUARD_DAILY_LIMIT_EXCEEDED';

export interface GuardEvaluationInput {
  readonly accountFrozen: boolean;
  readonly disputeHoldActive: boolean;
  readonly currentDailySettledCents: number;
  readonly proposedBatchAmountCents: number;
  readonly dailyLimitCents: number;
}

export interface GuardEvaluationResult {
  readonly allowed: boolean;
  readonly rejectionCode: GuardCode | null;
  readonly evaluatedOrder: readonly GuardCode[];
}

export const ACTIVE_GUARD_PRECEDENCE: readonly GuardCode[] = [
  'GUARD_ACCOUNT_FROZEN',
  'GUARD_DAILY_LIMIT_EXCEEDED',
];

/**
 * Evaluates settlement batch guards in strict linear order:
 * 1. GUARD_ACCOUNT_FROZEN
 * 2. GUARD_DAILY_LIMIT_EXCEEDED
 */
export function evaluateSettlementGuards(
  input: GuardEvaluationInput,
): GuardEvaluationResult {
  if (input.accountFrozen) {
    return {
      allowed: false,
      rejectionCode: 'GUARD_ACCOUNT_FROZEN',
      evaluatedOrder: ACTIVE_GUARD_PRECEDENCE,
    };
  }

  if (input.currentDailySettledCents + input.proposedBatchAmountCents > input.dailyLimitCents) {
    return {
      allowed: false,
      rejectionCode: 'GUARD_DAILY_LIMIT_EXCEEDED',
      evaluatedOrder: ACTIVE_GUARD_PRECEDENCE,
    };
  }

  return {
    allowed: true,
    rejectionCode: null,
    evaluatedOrder: ACTIVE_GUARD_PRECEDENCE,
  };
}

/**
 * Increments the consecutive batch rejection counter, saturating at MAX_BATCH_REJECTIONS = 5.
 */
export function recordGuardRejection(currentStreak: number): number {
  const sanitized = Math.max(0, Math.trunc(currentStreak));
  return Math.min(MAX_BATCH_REJECTIONS, sanitized + 1);
}

/**
 * Resets the consecutive batch rejection counter after a successful batch settlement.
 */
export function resetGuardRejectionStreak(): number {
  return 0;
}

export function isRejectionStreakSaturated(currentStreak: number): boolean {
  return currentStreak >= MAX_BATCH_REJECTIONS;
}
