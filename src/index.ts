export function converterBitsToBytes(bits: number): number {
  return bits / 8;
}

export function converterMegabitsToGigabytes(megabits: number): number {
  return megabits * 8 / (1024 * 1024 * 1024);
}

export function converterBitsToBytesExact(bits: number): number {
  return Math.floor(bits / 8);
}
