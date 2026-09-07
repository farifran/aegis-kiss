/**
 * Módulo de Contabilidade em Memória e Dupla Entrada (Aegis Product Core).
 * Implementação determinística com BigInt e estruturas de dados planas (Zero-GC).
 */

export interface Account {
  id: string;
  balance: bigint;
  consecutiveFailures: number;
  burstCount: number;
  burstWindowStart: bigint;
  isolatedUntil: bigint;
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

/**
 * Cria uma nova conta em memória com saldo inicial validado.
 */
export function createAccount(id: string, initialBalance: bigint): Account {
  if (initialBalance < 0n) {
    throw new RangeError('Initial balance cannot be negative');
  }
  return {
    id,
    balance: initialBalance,
    consecutiveFailures: 0,
    burstCount: 0,
    burstWindowStart: 0n,
    isolatedUntil: 0n,
  };
}

/**
 * Aplica transferência de dupla entrada com dedução de taxa para a tesouraria.
 * Invariante: Débito Total (A) = Crédito (B) + Taxa (Treasury).
 * Se a conta de origem falhar por saldo insuficiente, nenhuma alteração parcial é realizada.
 */
export function applyDoubleEntryTransfer(
  parties: DoubleEntryParties,
  amount: bigint,
  fee: bigint,
): TransferResult {
  if (amount <= 0n) {
    return { success: false, fee: 0n, reason: 'amount_must_be_positive' };
  }
  if (fee < 0n) {
    return { success: false, fee: 0n, reason: 'fee_cannot_be_negative' };
  }
  const totalDebit = amount + fee;
  if (parties.sender.balance < totalDebit) {
    return { success: false, fee: 0n, reason: 'insufficient_funds' };
  }

  parties.sender.balance -= totalDebit;
  parties.recipient.balance += amount;
  parties.treasury.balance += fee;

  return { success: true, fee };
}

/**
 * Calcula o saldo somado de todas as contas para verificação da invariante de conservação de valor.
 */
export function computeTotalBalance(accounts: Record<string, Account>): bigint {
  let total = 0n;
  const keys = Object.keys(accounts);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== undefined) {
      const acc = accounts[key];
      if (acc !== undefined) {
        total += acc.balance;
      }
    }
  }
  return total;
}
