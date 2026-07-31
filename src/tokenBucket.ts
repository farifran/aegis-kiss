class TokenBucket {
  private maxBytes: bigint;
  private maxTokens: bigint;
  private rateBitsPerMs: bigint;
  private timeDiff: bigint;

  constructor(maxBytes: bigint, mbps: bigint) {
    this.maxBytes = maxBytes;
    this.maxTokens = mbps * 8000n;
    this.rateBitsPerMs = mbps * 8000n;
    this.timeDiff = BigInt(Math.floor(Date.now() / 1000));
  }

  update() {
    this.timeDiff = BigInt(Math.floor(Date.now() / 1000)) - this.timeDiff;
    this.maxTokens = this.maxTokens + this.timeDiff * this.rateBitsPerMs;
  }

  obterEstadoBitmask(): bigint {
    return this.maxTokens;
  }
}

export { TokenBucket };
