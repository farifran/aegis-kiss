type SettlementAccountState = { accountId: string; balance: bigint; totalDebited: bigint };
type SettlementReport = { accounts: SettlementAccountState[]; totalDebited: bigint; totalFees: bigint; processedCount: number; rejectedCount: number };
type SettlementTransactionInput = { accountId: string; amount: bigint; feeBps: number };

export class SettlementEngine {
  private _balances: Map<string, bigint>;
  private _totalDebited: bigint;
  private _totalFees: bigint;
  private _processedCount: number;
  private _rejectedCount: number;

  constructor() {
    this._balances = new Map<string, bigint>();
    this._totalDebited = 0n;
    this._totalFees = 0n;
    this._processedCount = 0;
    this._rejectedCount = 0;
  }

  allocate(accountId: string, initialBalance: bigint): void {
    if (initialBalance < 0n) throw new RangeError('initialBalance must be non-negative');
    this._balances.set(accountId, initialBalance);
  }

  settleBatch(transactions: SettlementTransactionInput[]): SettlementReport {
    const report: SettlementReport = { accounts: [], totalDebited: 0n, totalFees: 0n, processedCount: 0, rejectedCount: 0 };
    for (const tx of transactions) {
      if (tx.amount < 0n || tx.feeBps < 0) {
        this._rejectedCount++;
        report.rejectedCount++;
        continue;
      }
      const currentBalance = this._balances.get(tx.accountId);
      if (currentBalance === undefined) {
        this._rejectedCount++;
        report.rejectedCount++;
        continue;
      }
      const fee = (tx.amount * BigInt(tx.feeBps)) / 10000n;
      const totalDebit = tx.amount + fee;
      if (currentBalance < totalDebit) {
        this._rejectedCount++;
        report.rejectedCount++;
        continue;
      }
      const newBalance = currentBalance - totalDebit;
      this._balances.set(tx.accountId, newBalance);
      this._totalDebited += totalDebit;
      this._totalFees += fee;
      this._processedCount++;
      report.totalDebited += totalDebit;
      report.totalFees += fee;
      report.processedCount++;
    }
    for (const [accountId, balance] of this._balances) {
      report.accounts.push({ accountId, balance, totalDebited: 0n });
    }
    return report;
  }

  getBalance(accountId: string): bigint | undefined {
    return this._balances.get(accountId);
  }

  get totalDebited(): bigint { return this._totalDebited; }

  get totalFees(): bigint { return this._totalFees; }

  get processedCount(): number { return this._processedCount; }

  get rejectedCount(): number { return this._rejectedCount; }
}
