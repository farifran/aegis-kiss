/** Isolamento temporal de contas anômalas. */
import type { Account, AccountTable } from './ledger.js';

export const MAX_CONSECUTIVE_FAILURES = 3;
export const BURST_LIMIT = 10;
export const BURST_WINDOW_MS = 10_000n;
export const ISOLATION_DURATION_MS = 30_000n;

export function isAccountIsolated(account: Account, now: bigint): boolean {
  return account.isolatedUntil > now;
}

export function recordAccountFailure(account: Account, now: bigint): void {
  account.consecutiveFailures += 1;
  if (account.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    account.isolatedUntil = now + ISOLATION_DURATION_MS;
  }
}

export function recordAccountSuccess(account: Account): void {
  account.consecutiveFailures = 0;
}

export function checkAndRecordBurst(account: Account, now: bigint): boolean {
  if (account.burstWindowStart === null || now - account.burstWindowStart >= BURST_WINDOW_MS) {
    account.burstWindowStart = now;
    account.burstCount = 1;
    return false;
  }
  account.burstCount += 1;
  if (account.burstCount > BURST_LIMIT) {
    account.isolatedUntil = now + ISOLATION_DURATION_MS;
    return true;
  }
  return false;
}

export function hasAnyIsolatedAccount(accounts: AccountTable, now: bigint): boolean {
  for (const id of Object.keys(accounts)) {
    const account = accounts[id];
    if (account !== undefined && account.isolatedUntil > now) return true;
  }
  return false;
}
