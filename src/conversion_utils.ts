export function gigabytesToMegabits(gigabytes: number): number {
  return gigabytes * 8 / (1024 * 1024);
}

export function megabitsToGigabytes(megabits: number): number {
  return megabits / (8 * 1024 * 1024);
}

export function kilobytesToMegabits(kilobytes: number): number {
  return kilobytes * 8 / (1024);
}

export function bytesToMegabits(bytes: number): number {
  return bytes * 8 / (1024);
}