export function kilobytesToBits(kilobytes: number): number {
  return kilobytes * 1024 * 8;
}

export function bytesToBits(bytes: number): number {
  return bytes * 8;
}

export function bytesToKilobits(bytes: number): number {
  return bytesToBits(bytes) / 1024;
}
