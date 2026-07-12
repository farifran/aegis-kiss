export function mbToKb(megaBytes: number): number {
  return megaBytes * 1024;
}

export function kbToMb(kiloBytes: number): number {
  return kiloBytes / 1024;
}

export function bytesToGigabits(bytes: number): number {
  return bytes / (1024 * 1024 * 1024 * 8);
}

export function bitsToKilobits(bits: number): number {
  return bits / (8 * 1024);
}

export function bitsToTerabits(bits: number): number {
  return bits / (8 * 1024 * 1024 * 1024 * 1024);
}
