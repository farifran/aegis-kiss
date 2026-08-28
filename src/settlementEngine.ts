type Transaction = { id: string; accountId: string; amount: bigint };
type SettlementReport = { accountId: string; finalBalance: bigint; totalDebited: bigint; processedCount: number; rejectedCount: number };

export class SettlementEngine {
  private readonly _balances: Map<string, bigint>;
  private readonly _feeBasisPoints: bigint;

  constructor(initialBalances: Record<string, bigint> = {}, feeBasisPoints: bigint = 0n) {
    if (feeBasisPoints < 0n || feeBasisPoints > 10000n) throw new RangeError("feeBasisPoints must be between 0 and 10000 (0% to 100%)");
    this._feeBasisPoints = feeBasisPoints;
    this._balances = new Map<string, bigint>();
    for (const [acc, bal] of Object.entries(initialBalances)) {
    if (typeof bal !== "bigint" || bal < 0n) throw new RangeError("Initial balance must be a non-negative bigint");
    this._balances.set(acc, bal);
    }
  }

  getBalance(accountId: string): bigint {
    return this._balances.get(accountId) ?? 0n;
  }

  setBalance(accountId: string, amount: bigint): void {
    if (amount < 0n) throw new RangeError("Balance cannot be negative");
    this._balances.set(accountId, amount);
  }

  processBatch(transactions: Transaction[]): SettlementReport[] {
    const stats = new Map<string, { debited: bigint; processed: number; rejected: number }>();
    for (const tx of transactions) {
    if (!stats.has(tx.accountId)) {
    stats.set(tx.accountId, { debited: 0n, processed: 0, rejected: 0 });
    }
    const s = stats.get(tx.accountId);
    if (!s) continue;
    if (tx.amount <= 0n) {
    s.rejected += 1;
    continue;
    }
    const currentBal = this.getBalance(tx.accountId);
    const fee = (tx.amount * this._feeBasisPoints) / 10000n;
    const totalNeeded = tx.amount + fee;
    if (currentBal >= totalNeeded) {
    this._balances.set(tx.accountId, currentBal - totalNeeded);
    s.debited += totalNeeded;
    s.processed += 1;
    } else {
    s.rejected += 1;
    }
    }
    const reports: SettlementReport[] = [];
    for (const [accountId, s] of stats.entries()) {
    reports.push({
    accountId,
    finalBalance: this.getBalance(accountId),
    totalDebited: s.debited,
    processedCount: s.processed,
    rejectedCount: s.rejected
    });
    }
    return reports;
  }

  get feeBasisPoints(): bigint { return this._feeBasisPoints; }
}

export function calcularTaxaDinamica(volume: bigint, baseFeeBps: bigint): bigint {
  if (volume < 0n || baseFeeBps < 0n) throw new RangeError("Volume and baseFeeBps must be non-negative");
  if (volume > 1000000n) {
  const discount = baseFeeBps / 2n;
  const clamped = discount < 10n ? 10n : discount;
  return clamped > baseFeeBps ? baseFeeBps : clamped;
  }
  return baseFeeBps;
}
