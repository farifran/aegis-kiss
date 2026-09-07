/**
 * Módulo de Sumário Binário Compacto de Saúde (Aegis Product Core).
 * Codificação determinística em bitmask para consulta instantânea do estado operacional.
 */

export const BIT_GLOBAL_LOCK = 1 << 0; // 0x01: Trava global de emergência ativa
export const BIT_ISOLATED_ACCOUNTS = 1 << 1; // 0x02: Ao menos uma conta sob isolamento temporário
export const BIT_VOLUME_ALERT = 1 << 2; // 0x04: Volume acumulado na janela recente superou limiar
export const BIT_HIGH_FAILURE_RATE = 1 << 3; // 0x08: Alta taxa de rejeição observada no lote (> 50%)

/**
 * Codifica o sumário binário de saúde do subsistema em um único inteiro (bitmask).
 */
export function computeHealthBitmask(
  globalLock: boolean,
  hasIsolated: boolean,
  volumeAlert: boolean,
  highFailureRate: boolean = false,
): number {
  let mask = 0;
  if (globalLock) mask |= BIT_GLOBAL_LOCK;
  if (hasIsolated) mask |= BIT_ISOLATED_ACCOUNTS;
  if (volumeAlert) mask |= BIT_VOLUME_ALERT;
  if (highFailureRate) mask |= BIT_HIGH_FAILURE_RATE;
  return mask;
}

/**
 * Utilitário de inspeção de bit individual no sumário compacto.
 */
export function isBitSet(bitmask: number, bit: number): boolean {
  return (bitmask & bit) === bit;
}
