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
    const sorted = [...items].sort((a, b) => (a.atMs < b.atMs ? -1 : a.atMs > b.atMs ? 1 : 0));
    const decisions: GateDecision[] = [];
    for (const it of sorted) {
      decisions.push(this.gate.tryConsume(it.bits, it.priority));
    }
    const allAllowed = decisions.every((d) => d.allowed);
    return { items: sorted, decisions, allAllowed };
  }

  decisionsSinceMs(sinceMs: bigint): GateDecision[] {
    return decisionsSince(this.gate.getLog(), sinceMs);
  }
}
