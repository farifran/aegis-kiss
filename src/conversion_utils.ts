export function gigabytesToTerabits(gigabytes: number): number {
  return gigabytes * 8 / (1024 * 1024 * 1024);
}

export function gigabytesToMegabits(gigabytes: number): number {
  return gigabytes * 8 * 1024 * 1024 / (1024 * 1024);
}