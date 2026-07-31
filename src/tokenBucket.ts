export class TokenBucket {
  private maxBytes: bigint;
  private mbps: number;
  private rateBitsPerMs: bigint;
  private timeDiff: number;
  private currentTokens: bigint;

  constructor(maxBytes: bigint, mbps: number) {
    this.maxBytes = maxBytes;
    this.mbps = mbps;
    this.rateBitsPerMs = BigInt(mbps) * 8000n;
    this.timeDiff = 0;
    this.currentTokens = 0n;
  }

  update(timeDiff: number) {
    this.currentTokens += BigInt(timeDiff) * this.rateBitsPerMs;
  }

  obterEstadoBitmask(): number {
    return Number(this.currentTokens);
  }
}
