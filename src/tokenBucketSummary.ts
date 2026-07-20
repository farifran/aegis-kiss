import type { GateDecision } from './tokenBucketGate.js';

export type DecisionSummary = {
  total: number;
  allowed: number;
  denied: number;
  totalBitsAllowed: bigint;
  totalBitsDenied: bigint;
};

export function summarizeDecisions(log: GateDecision[]): DecisionSummary {
  let allowed = 0;
  let denied = 0;
  let totalBitsAllowed = 0n;
  let totalBitsDenied = 0n;
  for (const d of log) {
    if (d.allowed) {
      allowed += 1;
      totalBitsAllowed += d.bits;
    } else {
      denied += 1;
      totalBitsDenied += d.bits;
    }
  }
  return {
    total: log.length,
    allowed,
    denied,
    totalBitsAllowed,
    totalBitsDenied,
  };
}
