// src/tokenBucket.ts
class TokenBucket {
  private maxBytes: bigint;
  private mbps: number;
  private rateBits: bigint;
  private tokens: bigint;
  private lastUpdate: number;

  constructor(maxBytes: bigint, mbps: number) {
    this.maxBytes = maxBytes;
    this.mbps = mbps;
    this.rateBits = BigInt(mbps * 1000000);
    this.tokens = BigInt(Date.now());
    this.lastUpdate = Date.now();
  }

  public getTokens(): bigint {
    return this.tokens;
  }

  public getRateBits(): bigint {
    return this.rateBits;
  }

  public updateTokens(): void {
    const now = Date.now();
    const timeDiff = now - this.lastUpdate;
    this.tokens += this.rateBits * BigInt(timeDiff / 1000);
    this.lastUpdate = now;
  }

  public isRefillActive(): boolean {
    return this.tokens < this.maxBytes;
  }
}

export { TokenBucket };
