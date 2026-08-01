// src/index.ts
import { TokenBucket, obterEstadoBitmask } from './tokenBucket.js';

export { TokenBucket, obterEstadoBitmask };

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
