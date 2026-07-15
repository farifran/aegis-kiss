export function gigabytesToTerabits(gigabytes: number): number {
  return gigabytes * 8 / 1024;
}

export function terabitsToGigabytes(terabits: number): number {
  return terabits * 1024 / 8;
}
