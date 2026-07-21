// INTENTIONAL HOLES:
// - no size clamp to >= 1
// - push never evicts when over capacity
// - clear() missing

export class SlidingWindow {
  private readonly size: number;
  private events: bigint[] = [];

  constructor(size: number) {
    // HOLE: no clamp if size < 1
    this.size = size;
  }

  public push(ts: bigint): void {
    this.events.push(ts);
    // HOLE: never drop oldest when length > size
  }

  public isFull(): boolean {
    return this.events.length === this.size;
  }

  // HOLE: clear() missing
}
