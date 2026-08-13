export function converterKilobitsEmTerabits(kb: number): number {
  return kb / 1e12
}

export function converterMegabitsEmTerabits(megabits: number): number {
  return megabits / 1000
}

export function bitsEmTerabytes(bits: bigint): bigint {
  return bits / BigInt(1024n) ** 40n;
}
