import { TokenBucketGate, decisionsSince } from "./tokenBucketGate.js";
import type { GateDecision } from "./tokenBucketGate.js";
import type { TokenBucketConfig } from "./tokenBucket.js";

export type PlanItem = { bits: bigint; priority: number; atMs: bigint };
export type PlanResult = { items: PlanItem[]; decisions: GateDecision[]; allAllowed: boolean };

export class TokenBucketPlan {
  private gate: TokenBucketGate;

  constructor(config: TokenBucketConfig) {
    this.gate = new TokenBucketGate(config);
  }

  simulate(items: PlanItem[]): PlanResult {
    const sorted = [...items].sort((a, b) => {
      if (a.atMs < b.atMs) return -1;
      if (a.atMs > b.atMs) return 1;
      return 0;
    });
    const decisions: GateDecision[] = [];
    for (const it of sorted) {
      // Offline batch: drive the gate clock from item.atMs (not wall clock).
      decisions.push(this.gate.tryConsume(it.bits, it.priority, it.atMs));
    }
    const allAllowed = decisions.every((d) => d.allowed);
    return { items: sorted, decisions, allAllowed };
  }

  decisionsSinceMs(sinceMs: bigint): GateDecision[] {
    return decisionsSince(this.gate.getLog(), sinceMs);
  }
}
