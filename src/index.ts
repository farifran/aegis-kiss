import { TokenBucket } from './tokenBucket.js';
export { TokenBucket };
export function converterGigabitsEmTerabits(gigabits: bigint): bigint {
  return gigabits * 1024n;
}

export function converterKilobitsEmTerabits(kilobits: bigint): bigint {
  return kilobits * 1024n;
}

export function converterMegabitsEmTerabits(megabits: bigint): bigint {
  return megabits * 1024n;
}

export function converterGigabitsEmKilobits(gigabits: bigint): bigint {
  return gigabits / 1024n;
}

export function obterEstadoBitmask(): number {
  const tb = new TokenBucket(100, 1);
  return tb.obterEstadoBitmask();
}
