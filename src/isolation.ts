/**
 * Módulo de Detecção de Anomalias e Isolamento Temporário de Contas (Aegis Product Core).
 */
import type { Account } from './ledger.js';

export const MAX_CONSECUTIVE_FAILURES = 3;
export const BURST_LIMIT = 10;
export const BURST_WINDOW_MS = 10_000n;
export const ISOLATION_DURATION_MS = 30_000n;

/**
 * Verifica se a conta está sob isolamento temporário no instante temporal `now`.
 */
export function isAccountIsolated(account: Account, now: bigint): boolean {
  return account.isolatedUntil > now;
}

/**
 * Registra uma tentativa falha por saldo insuficiente na conta.
 * Isola imediatamente a conta por 30.000 ms se atingir o limiar de 3 falhas consecutivas.
 */
export function recordAccountFailure(account: Account, now: bigint): void {
  account.consecutiveFailures += 1;
  if (account.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    account.isolatedUntil = now + ISOLATION_DURATION_MS;
  }
}

/**
 * Registra sucesso em operação, reiniciando o contador de falhas consecutivas da conta.
 */
export function recordAccountSuccess(account: Account): void {
  account.consecutiveFailures = 0;
}

/**
 * Registra tentativa de ordem para controle de taxa de disparo (burst).
 * Retorna true se o limite for excedido e a conta for isolada.
 */
export function checkAndRecordBurst(account: Account, now: bigint): boolean {
  if (account.burstWindowStart === 0n || now - account.burstWindowStart >= BURST_WINDOW_MS) {
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

/**
 * Varre as contas em memória e verifica se existe ao menos uma conta em isolamento ativo no instante `now`.
 */
export function hasAnyIsolatedAccount(accounts: Record<string, Account>, now: bigint): boolean {
  const keys = Object.keys(accounts);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== undefined) {
      const acc = accounts[key];
      if (acc !== undefined && acc.isolatedUntil > now) {
        return true;
      }
    }
  }
  return false;
}
