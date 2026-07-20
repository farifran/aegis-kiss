import { TokenBucket } from "./tokenBucket.js";
import type { TokenBucketConfig } from "./tokenBucket.js";

export type GateDecision = {
  nowMs: bigint;
  bits: bigint;
  priority: number;
  allowed: boolean;
  mask: number;
};

export class TokenBucketGate {
  private bucket: TokenBucket;
  private log: GateDecision[];

  constructor(config: TokenBucketConfig) {
    this.bucket = new TokenBucket(config);
    this.log = [];
  }

  private clampPriority(p: number): number {
    return Math.min(Math.max(p, 0), 63);
  }

  tryConsume(bits: bigint, priority: number): GateDecision {
    const now = BigInt(Date.now());
    const pr = this.clampPriority(priority);
    const allowed = this.bucket.consume(bits, now);
    const base = this.bucket.statusMask(now);
    const mask = (base & 3) | ((pr & 63) << 2);
    this.log.push({
      nowMs: now,
      bits,
      priority: pr,
      allowed,
      mask,
    });
    return {
      nowMs: now,
      bits,
      priority: pr,
      allowed,
      mask,
    };
  }

  getLog(): GateDecision[] {
    return [...this.log];
  }
}

export function decisionsSince(log: GateDecision[], sinceMs: bigint): GateDecision[] {
  return log.filter((decision) => decision.nowMs >= sinceMs);
}
