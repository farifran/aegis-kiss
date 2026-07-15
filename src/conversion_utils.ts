export function gigabytesToMegabits(gigabytes: number): number {
  return gigabytes * 8 / (1024 * 1024);
}

export function megabitsToGigabytes(megabits: number): number {
  return megabits / (8 * 1024 * 1024);
}

export function kilobitsToMegabits(kilobits: number): number {
  return kilobits * 8 / (1024);
}

export function bytesToMegabits(bytes: number): number {
  return bytes * 8 / (1024);
}

export function gigabytesToKilobits(gigabytes: number): number {
  return gigabytes * 8 * 1024 / (1024);
}
