export function kilobytesToBits(kilobytes: number): number {
  return kilobytes * 1024;
}

export function megabytesToBits(megabytes: number): number {
  return megabytes * 1024 * 1024 * 8;
}

export function megabytesToKilobits(megabytes: number): number {
  return megabytes * 1024;
}

export function kilobitsToGigabytes(kilobits: number): number {
  return kilobits / 1024 / 1024;
}

export function pentabytesToKilobits(pentabytes: number): number {
  return pentabytes * 1024 * 1024 * 1024 * 1024;
}
