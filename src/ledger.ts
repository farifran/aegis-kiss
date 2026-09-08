/** Contabilidade determinística de dupla entrada. */

export interface Account {
  id: string;
  balance: bigint;
  consecutiveFailures: number;
  burstCount: number;
  burstWindowStart: bigint | null;
  isolatedUntil: bigint;
}

export interface AccountSnapshot {
  readonly id: string;
  readonly balance: bigint;
  readonly consecutiveFailures: number;
  readonly burstCount: number;
  readonly burstWindowStart: bigint | null;
  readonly isolatedUntil: bigint;
}

export type AccountTable = Record<string, Account>;

export function createAccountTable(): AccountTable {
  return Object.create(null) as AccountTable;
}

export interface Transaction {
  id: string;
  sender: string;
  recipient: string;
  amount: bigint;
}

export interface TransferResult {
  success: boolean;
  fee: bigint;
  reason?: string | undefined;
}

export interface DoubleEntryParties {
  sender: Account;
  recipient: Account;
  treasury: Account;
}

export function createAccount(id: string, initialBalance: bigint): Account {
  if (id.length === 0) throw new RangeError('Account id cannot be empty');
  if (initialBalance < 0n) throw new RangeError('Initial balance cannot be negative');
  return {
    id,
    balance: initialBalance,
    consecutiveFailures: 0,
    burstCount: 0,
    burstWindowStart: null,
    isolatedUntil: 0n,
  };
}

export function cloneAccount(account: Account): Account {
  return { ...account };
}

export function snapshotAccount(account: Account): AccountSnapshot {
  return Object.freeze({ ...account });
}

export function applyDoubleEntryTransfer(
  parties: DoubleEntryParties,
  amount: bigint,
  fee: bigint,
): TransferResult {
  if (amount < 0n) return { success: false, fee: 0n, reason: 'amount_cannot_be_negative' };
  if (fee < 0n) return { success: false, fee: 0n, reason: 'fee_cannot_be_negative' };
  const totalDebit = amount + fee;
  if (parties.sender.balance < totalDebit) return { success: false, fee: 0n, reason: 'insufficient_funds' };

  parties.sender.balance -= totalDebit;
  parties.recipient.balance += amount;
  parties.treasury.balance += fee;
  return { success: true, fee };
}

export function computeTotalBalance(accounts: AccountTable): bigint {
  let total = 0n;
  for (const id of Object.keys(accounts)) {
    const account = accounts[id];
    if (account !== undefined) total += account.balance;
  }
  return total;
}
