export function converterMegabitsToGigabytes(megabits: number): number {
  return megabits * 8 / (1024 * 1024 * 1024);
}
