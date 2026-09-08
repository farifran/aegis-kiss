/**
 * Módulo de Taxas Dinâmicas e Controle de Janela de Volume (Aegis Product Core).
 * Implementação determinística sem ponto flutuante, operando inteiramente em BigInt.
 */

export const BASE_FEE_BPS = 10n; // 0,10%
export const ELEVATED_FEE_BPS = 25n; // 0,25%
export const VOLUME_ALERT_THRESHOLD = 1_000_000n;
export const RECENT_WINDOW_MS = 60_000n;
export const BPS_DENOMINATOR = 10_000n;

export interface VolumeRecord {
  timestamp: bigint;
  volume: bigint;
}

/**
 * Calcula a taxa da ordem baseada no volume acumulado na janela recente.
 * Aritmética determinística com truncamento inteiro: (amount * bps) / 10000n.
 */
export function calculateFee(amount: bigint, currentRollingVolume: bigint): bigint {
  if (amount <= 0n) return 0n;
  const feeBps = currentRollingVolume > VOLUME_ALERT_THRESHOLD ? ELEVATED_FEE_BPS : BASE_FEE_BPS;
  return (amount * feeBps) / BPS_DENOMINATOR;
}

/**
 * Poda registros com mais de 60 segundos de idade in-place (Zero-GC) e calcula o volume acumulado.
 */
export function pruneAndSumRollingVolume(history: VolumeRecord[], now: bigint): bigint {
  const minTimestamp = now > RECENT_WINDOW_MS ? now - RECENT_WINDOW_MS : 0n;
  let sum = 0n;
  let writeIdx = 0;

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry !== undefined && entry.timestamp >= minTimestamp) {
      history[writeIdx] = entry;
      writeIdx++;
      sum += entry.volume;
    }
  }

  history.length = writeIdx;
  return sum;
}

/** Consulta sem mutação para observabilidade fora da fronteira de publicação. */
export function sumRollingVolume(history: readonly VolumeRecord[], now: bigint): bigint {
  const minTimestamp = now > RECENT_WINDOW_MS ? now - RECENT_WINDOW_MS : 0n;
  let sum = 0n;
  for (const entry of history) {
    if (entry.timestamp >= minTimestamp) sum += entry.volume;
  }
  return sum;
}
