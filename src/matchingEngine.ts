import { OrderBook, type OrderSide, type BookOrder, type MatchResult, type MatchTrade } from './orderBook.js';

export interface AccountBalance {
  baseAvailable: bigint;
  baseLocked: bigint;
  quoteAvailable: bigint;
  quoteLocked: bigint;
}

export interface UserAccountState {
  readonly userId: string;
  readonly baseAvailable: bigint;
  readonly baseLocked: bigint;
  readonly quoteAvailable: bigint;
  readonly quoteLocked: bigint;
}

export interface OrderCommand {
  readonly id: string;
  readonly userId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly price: bigint;
  readonly quantity: bigint;
}

export type OrderExecutionStatus =
  | 'COMMITTED'
  | 'REJECTED_INVALID'
  | 'REJECTED_INSUFFICIENT_FUNDS'
  | 'REJECTED_DUPLICATE'
  | 'ABORTED';

export interface ExecutionReport {
  readonly index: number;
  readonly orderId: string;
  readonly status: OrderExecutionStatus;
  readonly reason?: string;
  readonly matchResult?: MatchResult;
}

export interface EngineBatchResult {
  readonly processedCount: number;
  readonly committedCount: number;
  readonly rejectedCount: number;
  readonly abortedCount: number;
  readonly tradesCount: number;
  readonly totalBaseVolume: bigint;
  readonly totalQuoteVolume: bigint;
  readonly executionDigest: bigint;
  readonly reports: readonly ExecutionReport[];
}

export interface EngineSnapshot {
  readonly accounts: Record<string, { readonly baseAvailable: bigint; readonly baseLocked: bigint; readonly quoteAvailable: bigint; readonly quoteLocked: bigint }>;
  readonly books: Record<string, { readonly bids: readonly BookOrder[]; readonly asks: readonly BookOrder[] }>;
  readonly seenOrders: Record<string, boolean>;
  readonly totalBaseVolume: bigint;
  readonly totalQuoteVolume: bigint;
  readonly lastProcessedMs: bigint;
  readonly tradeSequence: bigint;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a(hash: bigint, value: bigint): bigint {
  let h = hash ^ (value & 0xFFFFFFFFFFFFFFFFn);
  h = (h * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
  return h;
}

function stringToHash(hash: bigint, str: string): bigint {
  let h = hash;
  for (let i = 0; i < str.length; i++) {
    const code = BigInt(str.charCodeAt(i));
    h = fnv1a(h, code);
  }
  return h;
}

export class MatchingEngine {
  private readonly _accounts: Record<string, AccountBalance>;
  private readonly _books: Record<string, OrderBook>;
  private readonly _seenOrders: Record<string, boolean>;
  private _totalBaseVolume: bigint;
  private _totalQuoteVolume: bigint;
  private _lastProcessedMs: bigint;
  private _tradeSequence: bigint;

  constructor() {
    this._accounts = Object.create(null) as Record<string, AccountBalance>;
    this._books = Object.create(null) as Record<string, OrderBook>;
    this._seenOrders = Object.create(null) as Record<string, boolean>;
    this._totalBaseVolume = 0n;
    this._totalQuoteVolume = 0n;
    this._lastProcessedMs = 0n;
    this._tradeSequence = 0n;
  }

  registerUser(userId: string, initialBase: bigint = 0n, initialQuote: bigint = 0n): void {
    if (!userId || userId.trim() === '') throw new TypeError('userId must be a non-empty string');
    if (this._accounts[userId] !== undefined) throw new Error(`user '${userId}' already exists`);
    if (initialBase < 0n || initialQuote < 0n) throw new RangeError('initial balances must be non-negative');

    this._accounts[userId] = {
      baseAvailable: initialBase,
      baseLocked: 0n,
      quoteAvailable: initialQuote,
      quoteLocked: 0n
    };
  }

  registerSymbol(symbol: string): void {
    if (!symbol || symbol.trim() === '') throw new TypeError('symbol must be a non-empty string');
    if (this._books[symbol] !== undefined) throw new Error(`symbol '${symbol}' already exists`);
    this._books[symbol] = new OrderBook(symbol);
  }

  getUser(userId: string): UserAccountState | null {
    const acc = this._accounts[userId];
    if (!acc) return null;
    return {
      userId,
      baseAvailable: acc.baseAvailable,
      baseLocked: acc.baseLocked,
      quoteAvailable: acc.quoteAvailable,
      quoteLocked: acc.quoteLocked
    };
  }

  deposit(userId: string, baseAmount: bigint, quoteAmount: bigint): void {
    const acc = this._accounts[userId];
    if (!acc) throw new Error(`user '${userId}' does not exist`);
    if (baseAmount < 0n || quoteAmount < 0n) throw new RangeError('deposit amounts must be non-negative');
    acc.baseAvailable += baseAmount;
    acc.quoteAvailable += quoteAmount;
  }

  private _nextTradeId(): string {
    this._tradeSequence += 1n;
    return `tr_${this._tradeSequence}`;
  }

  private _validateOrder(cmd: OrderCommand): string | null {
    if (!cmd || !cmd.id || cmd.id.trim() === '') return 'empty order id';
    if (!cmd.userId || !this._accounts[cmd.userId]) return 'user does not exist';
    if (!cmd.symbol || !this._books[cmd.symbol]) return 'symbol does not exist';
    if (cmd.side !== 'BUY' && cmd.side !== 'SELL') return 'invalid order side';
    if (cmd.price <= 0n || cmd.quantity <= 0n) return 'price and quantity must be positive';
    return null;
  }

  private _lockFunds(cmd: OrderCommand, acc: AccountBalance): boolean {
    if (cmd.side === 'BUY') {
      const neededQuote = cmd.price * cmd.quantity;
      if (acc.quoteAvailable < neededQuote) return false;
      acc.quoteAvailable -= neededQuote;
      acc.quoteLocked += neededQuote;
    } else {
      if (acc.baseAvailable < cmd.quantity) return false;
      acc.baseAvailable -= cmd.quantity;
      acc.baseLocked += cmd.quantity;
    }
    return true;
  }

  private _settleTrade(trade: MatchTrade, cmd: OrderCommand): void {
    const buyer = this._accounts[trade.buyerId];
    const seller = this._accounts[trade.sellerId];
    if (!buyer || !seller) return;

    buyer.quoteLocked -= trade.quoteVolume;
    buyer.baseAvailable += trade.quantity;

    seller.baseLocked -= trade.quantity;
    seller.quoteAvailable += trade.quoteVolume;

    // Price improvement for buyer if matched below limit price
    if (trade.buyOrderId === cmd.id && cmd.side === 'BUY' && cmd.price > trade.price) {
      const priceDiff = (cmd.price - trade.price) * trade.quantity;
      buyer.quoteLocked -= priceDiff;
      buyer.quoteAvailable += priceDiff;
    }

    this._totalBaseVolume += trade.quantity;
    this._totalQuoteVolume += trade.quoteVolume;
  }

  private _processSingleOrder(cmd: OrderCommand, index: number, nowMs: bigint): ExecutionReport {
    const err = this._validateOrder(cmd);
    if (err !== null) {
      return { index, orderId: cmd?.id ?? '', status: 'REJECTED_INVALID', reason: err };
    }
    if (this._seenOrders[cmd.id]) {
      return { index, orderId: cmd.id, status: 'REJECTED_DUPLICATE', reason: 'duplicate order id' };
    }

    const acc = this._accounts[cmd.userId];
    if (!acc || !this._lockFunds(cmd, acc)) {
      return { index, orderId: cmd.id, status: 'REJECTED_INSUFFICIENT_FUNDS', reason: 'insufficient funds' };
    }

    this._seenOrders[cmd.id] = true;
    const book = this._books[cmd.symbol];
    if (!book) {
      return { index, orderId: cmd.id, status: 'REJECTED_INVALID', reason: 'symbol book not found' };
    }

    const bookOrder: BookOrder = {
      id: cmd.id,
      userId: cmd.userId,
      side: cmd.side,
      price: cmd.price,
      quantity: cmd.quantity,
      filledQuantity: 0n,
      timestampMs: nowMs
    };

    const matchRes = book.match(bookOrder, nowMs, () => this._nextTradeId());
    for (let i = 0; i < matchRes.trades.length; i++) {
      const tr = matchRes.trades[i];
      if (tr) {
        this._settleTrade(tr, cmd);
      }
    }

    return { index, orderId: cmd.id, status: 'COMMITTED', matchResult: matchRes };
  }

  private _validateActualState(): string | null {
    for (const userId in this._accounts) {
      const acc = this._accounts[userId];
      if (acc) {
        if (acc.baseAvailable < 0n || acc.baseLocked < 0n || acc.quoteAvailable < 0n || acc.quoteLocked < 0n) {
          return `negative balance detected on user ${userId}`;
        }
      }
    }
    return null;
  }

  processBatch(orders: readonly OrderCommand[], nowMs: bigint): EngineBatchResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    const snapBefore = this.snapshot();

    if (nowMs < this._lastProcessedMs) {
      return this._buildAbortResult(orders, nowMs, snapBefore, 'time moved backwards');
    }

    const reports: ExecutionReport[] = [];
    let committedCount = 0;
    let rejectedCount = 0;
    let tradesCount = 0;

    for (let i = 0; i < orders.length; i++) {
      const cmd = orders[i];
      if (!cmd) {
        rejectedCount++;
        reports.push({ index: i, orderId: '', status: 'REJECTED_INVALID', reason: 'null or undefined order slot' });
        continue;
      }
      const rep = this._processSingleOrder(cmd, i, nowMs);
      if (rep.status === 'COMMITTED') {
        committedCount++;
        if (rep.matchResult) tradesCount += rep.matchResult.trades.length;
      } else {
        rejectedCount++;
      }
      reports.push(rep);
    }

    const postErr = this._validateActualState();
    if (postErr !== null) {
      this.restore(snapBefore);
      return this._buildAbortResult(orders, nowMs, snapBefore, postErr);
    }

    this._lastProcessedMs = nowMs;
    const digest = this._computeDigest(nowMs, reports, orders, false);

    return {
      processedCount: orders.length,
      committedCount,
      rejectedCount,
      abortedCount: 0,
      tradesCount,
      totalBaseVolume: this._totalBaseVolume,
      totalQuoteVolume: this._totalQuoteVolume,
      executionDigest: digest,
      reports
    };
  }

  private _buildAbortResult(
    orders: readonly OrderCommand[],
    nowMs: bigint,
    snapBefore: EngineSnapshot,
    reason: string
  ): EngineBatchResult {
    this.restore(snapBefore);
    const reports: ExecutionReport[] = [];
    for (let i = 0; i < orders.length; i++) {
      reports.push({ index: i, orderId: orders[i]?.id ?? '', status: 'ABORTED', reason: `batch aborted: ${reason}` });
    }
    const digest = this._computeDigest(nowMs, reports, orders, true);
    return {
      processedCount: orders.length,
      committedCount: 0,
      rejectedCount: 0,
      abortedCount: orders.length,
      tradesCount: 0,
      totalBaseVolume: snapBefore.totalBaseVolume,
      totalQuoteVolume: snapBefore.totalQuoteVolume,
      executionDigest: digest,
      reports
    };
  }

  private _computeDigest(
    nowMs: bigint,
    reports: readonly ExecutionReport[],
    orders: readonly OrderCommand[],
    rolledBack: boolean
  ): bigint {
    let h = FNV_OFFSET;
    h = fnv1a(h, nowMs);
    h = fnv1a(h, this._lastProcessedMs);
    h = fnv1a(h, this._totalBaseVolume);
    h = fnv1a(h, this._totalQuoteVolume);
    h = fnv1a(h, rolledBack ? 1n : 0n);

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o) {
        h = fnv1a(h, BigInt(i));
        h = stringToHash(h, o.id);
        h = stringToHash(h, o.userId);
        h = stringToHash(h, o.symbol);
        h = stringToHash(h, o.side);
        h = fnv1a(h, o.price);
        h = fnv1a(h, o.quantity);
      }
    }

    for (let i = 0; i < reports.length; i++) {
      const r = reports[i];
      if (r) {
        h = fnv1a(h, BigInt(r.index));
        h = stringToHash(h, r.orderId);
        h = stringToHash(h, r.status);
      }
    }

    const sortedUsers = Object.keys(this._accounts).sort();
    for (let i = 0; i < sortedUsers.length; i++) {
      const u = sortedUsers[i];
      if (u) {
        const acc = this._accounts[u];
        if (acc) {
          h = stringToHash(h, u);
          h = fnv1a(h, acc.baseAvailable);
          h = fnv1a(h, acc.baseLocked);
          h = fnv1a(h, acc.quoteAvailable);
          h = fnv1a(h, acc.quoteLocked);
        }
      }
    }

    return h;
  }

  snapshot(): EngineSnapshot {
    const accounts: Record<string, { readonly baseAvailable: bigint; readonly baseLocked: bigint; readonly quoteAvailable: bigint; readonly quoteLocked: bigint }> = Object.create(null) as Record<string, { readonly baseAvailable: bigint; readonly baseLocked: bigint; readonly quoteAvailable: bigint; readonly quoteLocked: bigint }>;
    for (const u in this._accounts) {
      const a = this._accounts[u];
      if (a) {
        accounts[u] = {
          baseAvailable: a.baseAvailable,
          baseLocked: a.baseLocked,
          quoteAvailable: a.quoteAvailable,
          quoteLocked: a.quoteLocked
        };
      }
    }

    const books: Record<string, { readonly bids: readonly BookOrder[]; readonly asks: readonly BookOrder[] }> = Object.create(null) as Record<string, { readonly bids: readonly BookOrder[]; readonly asks: readonly BookOrder[] }>;
    for (const s in this._books) {
      const b = this._books[s];
      if (b) {
        books[s] = b.snapshot();
      }
    }

    const seenOrders: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    for (const id in this._seenOrders) {
      const val = this._seenOrders[id];
      if (val !== undefined) seenOrders[id] = val;
    }

    return {
      accounts,
      books,
      seenOrders,
      totalBaseVolume: this._totalBaseVolume,
      totalQuoteVolume: this._totalQuoteVolume,
      lastProcessedMs: this._lastProcessedMs,
      tradeSequence: this._tradeSequence
    };
  }

  restore(snap: EngineSnapshot): void {
    for (const u in snap.accounts) {
      const a = snap.accounts[u];
      if (a) {
        this._accounts[u] = {
          baseAvailable: a.baseAvailable,
          baseLocked: a.baseLocked,
          quoteAvailable: a.quoteAvailable,
          quoteLocked: a.quoteLocked
        };
      }
    }

    for (const s in snap.books) {
      const bSnap = snap.books[s];
      const targetBook = this._books[s];
      if (bSnap && targetBook) {
        targetBook.restore(bSnap);
      }
    }

    for (const id in snap.seenOrders) {
      const val = snap.seenOrders[id];
      if (val !== undefined) this._seenOrders[id] = val;
    }

    this._totalBaseVolume = snap.totalBaseVolume;
    this._totalQuoteVolume = snap.totalQuoteVolume;
    this._lastProcessedMs = snap.lastProcessedMs;
    this._tradeSequence = snap.tradeSequence;
  }

  get totalBaseVolume(): bigint { return this._totalBaseVolume; }
  get totalQuoteVolume(): bigint { return this._totalQuoteVolume; }
  get lastProcessedMs(): bigint { return this._lastProcessedMs; }
  get userCount(): number { return Object.keys(this._accounts).length; }
}
