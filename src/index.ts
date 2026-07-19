export function converterMegabitsToGigabytes(megabits: number): number {
  return megabits * 8 / (1024 * 1024 * 1024);
}

export function megabytesToBits(megabytes: number): number {
  return megabytes * 1024 * 1024 * 8;
}
