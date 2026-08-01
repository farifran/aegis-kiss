class TokenBucket {
  tokens: bigint;
  lastUpdate: bigint;

  constructor(tokens: bigint, lastUpdate: number) {
    this.tokens = tokens;
    this.lastUpdate = BigInt(lastUpdate);
  }
}

export function obterEstadoBitmask(bucket: TokenBucket): number {
  let mask = 0;
  if (bucket.tokens === 0n) {
    mask |= 1;
  }
  if (BigInt(Date.now()) - bucket.lastUpdate < 1000n) {
    mask |= 2;
  }
  return mask;
}
