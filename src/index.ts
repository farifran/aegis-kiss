export function converter(terabits: number): number {
  return terabits * 125000;
}

export function gigabytesToMegabytes(gigabytes: number): number {
  return gigabytes * 1024;
}

export function terabitsToBytes(terabits: number): bigint {
  return BigInt(terabits) * 125000000000n;
}
