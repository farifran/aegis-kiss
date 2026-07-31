export class TokenBucket {
  private maxBytes: bigint;
  private mbps: bigint;
  private rateBitsPerMs: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this.maxBytes = maxBytes;
    this.mbps = BigInt(mbps);
    this.rateBitsPerMs = this.mbps * BigInt(8000);
  }

  public getRateBitsPerMs(): bigint {
    return this.rateBitsPerMs;
  }
}

export function obterEstadoBitmask(tokenBucket: TokenBucket): bigint {
  return tokenBucket.getRateBitsPerMs();
}
