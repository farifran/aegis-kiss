export function kilobytesToPentabits(kilobytes: number): number {
  return kilobytes * 1024 * 1024 * 1024 * 1024;
}

export function kilobytesToBits(kilobytes: number): number {
  return kilobytes * 1024;
}

export function bytesToBits(bytes: number): number {
  return bytes * 8;
}

export function bytesToKilobits(bytes: number): number {
  return bytesToBits(bytes) / 1024;
}

export function terabitsToMegabits(terabits: number): number {
  return terabits * 1024 * 1024;
}

export function bytesToGigabits(bytes: number): number {
  return bytesToBits(bytes) / (1024 * 1024 * 1024);
}

export function bytesToPentabits(bytes: number): number {
  return bytesToBits(bytes) / (1024 * 1024 * 1024 * 1024);
}
