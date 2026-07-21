// All methods named. Holes: no clamp, no eviction, clear is no-op.

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

  public clear(): void {
    return;
  }
}
