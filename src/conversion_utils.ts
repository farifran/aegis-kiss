export function mbToKb(megaBytes: number): number {
  return megaBytes * 1024;
}

export function kbToMb(kiloBytes: number): number {
  return kiloBytes / 1024;
}

export function bytesToGigabits(bytes: number): number {
  return bytes / (1024 * 1024 * 1024 * 8);
}
