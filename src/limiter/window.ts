// Seed: sliding window without clamp, eviction, or clear.

export class SlidingWindow {
  private readonly size: number;
  private events: bigint[] = [];

  constructor(size: number) {
    this.size = size;
  }

  public push(ts: bigint): void {
    this.events.push(ts);
  }

  public isFull(): boolean {
    return this.events.length === this.size;
  }
}
