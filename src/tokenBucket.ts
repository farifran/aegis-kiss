// src/tokenBucket.ts
export class TokenBucket {
  private readonly rate: number;
  private readonly capacity: number;

  constructor(capacity: number, rate: number) {
    this.capacity = capacity;
    this.rate = rate;
    this.tokens = 0;
  }

  public async acquire(): Promise<number> {
    if (this.tokens >= this.rate) {
      this.tokens -= this.rate;
      return this.rate;
    } else {
      return 0;
    }
  }

  public async refill(): Promise<void> {
    this.tokens = this.capacity;
  }
  private tokens: number = 0;
}
