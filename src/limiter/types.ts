// INTENTIONAL HOLES (adversarial seed):
// - missing BIT_WINDOW_FULL and BIT_SOFT
// - mbpsToBitsPerMs uses a magic constant (no /1000n factor chain)
// - no mbToBits factor chain with 1024n*1024n*8n

export const BIT_EMPTY = 1 << 0;
export const BIT_PARTIAL = 1 << 1;
export const BIT_SATURATED = 1 << 2;
export const BIT_CLOCK = 1 << 3;
// HOLE: BIT_WINDOW_FULL and BIT_SOFT absent

export function mbToBits(capacityMB: number): bigint {
  // HOLE: single magic, not explicit 1024n * 1024n * 8n
  return BigInt(capacityMB) * 8388608n;
}

export function mbpsToBitsPerMs(rateMBps: number): bigint {
  // HOLE: no /1000n chain
  return BigInt(Math.round(rateMBps * 8388.608));
}
