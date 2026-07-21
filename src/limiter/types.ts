export const BIT_EMPTY = 1 << 0;
export const BIT_PARTIAL = 1 << 1;
export const BIT_SATURATED = 1 << 2;
export const BIT_CLOCK = 1 << 3;
export const BIT_WINDOW_FULL = 1 << 4;
export const BIT_SOFT = 1 << 5;

export function mbToBits(capacityMB: number): bigint {
  return BigInt(capacityMB) * 8388608n;
}

export function mbpsToBitsPerMs(rateMBps: number): bigint {
  return BigInt(Math.round(rateMBps * 8388.608));
}
