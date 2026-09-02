export type OrderSide = 'BUY' | 'SELL';

export interface BookOrder {
  readonly id: string;
  readonly userId: string;
  readonly side: OrderSide;
  readonly price: bigint;
  readonly quantity: bigint;
  filledQuantity: bigint;
  readonly timestampMs: bigint;
}

export interface MatchTrade {
  readonly tradeId: string;
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly price: bigint;
  readonly quantity: bigint;
  readonly quoteVolume: bigint;
  readonly timestampMs: bigint;
}

export interface MatchResult {
  readonly incomingOrderId: string;
  readonly status: 'FILLED' | 'PARTIALLY_FILLED' | 'RESTING';
  readonly executedQuantity: bigint;
  readonly remainingQuantity: bigint;
  readonly trades: readonly MatchTrade[];
}

export class OrderBook {
  private readonly _symbol: string;
  private _bids: BookOrder[];
  private _asks: BookOrder[];

  constructor(symbol: string) {
    if (!symbol || symbol.trim() === '') throw new TypeError('symbol must be a non-empty string');
    this._symbol = symbol;
    this._bids = [];
    this._asks = [];
  }

  get symbol(): string { return this._symbol; }
  get bidDepth(): number { return this._bids.length; }
  get askDepth(): number { return this._asks.length; }

  getBestBid(): BookOrder | null {
    const first = this._bids[0];
    return first !== undefined ? first : null;
  }

  getBestAsk(): BookOrder | null {
    const first = this._asks[0];
    return first !== undefined ? first : null;
  }

  private _insertBid(order: BookOrder): void {
    let inserted = false;
    for (let i = 0; i < this._bids.length; i++) {
      const b = this._bids[i];
      if (b && (order.price > b.price || (order.price === b.price && order.timestampMs < b.timestampMs))) {
        this._bids.splice(i, 0, order);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this._bids.push(order);
    }
  }

  private _insertAsk(order: BookOrder): void {
    let inserted = false;
    for (let i = 0; i < this._asks.length; i++) {
      const a = this._asks[i];
      if (a && (order.price < a.price || (order.price === a.price && order.timestampMs < a.timestampMs))) {
        this._asks.splice(i, 0, order);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this._asks.push(order);
    }
  }

  addRestingOrder(order: BookOrder): void {
    if (order.side === 'BUY') {
      this._insertBid(order);
    } else {
      this._insertAsk(order);
    }
  }

  cancelOrder(orderId: string): BookOrder | null {
    for (let i = 0; i < this._bids.length; i++) {
      const b = this._bids[i];
      if (b && b.id === orderId) {
        const removed = this._bids.splice(i, 1);
        return removed[0] ?? null;
      }
    }
    for (let i = 0; i < this._asks.length; i++) {
      const a = this._asks[i];
      if (a && a.id === orderId) {
        const removed = this._asks.splice(i, 1);
        return removed[0] ?? null;
      }
    }
    return null;
  }

  private _matchBuy(incoming: BookOrder, nowMs: bigint, nextTradeId: () => string, trades: MatchTrade[]): bigint {
    let remaining = incoming.quantity - incoming.filledQuantity;
    while (remaining > 0n && this._asks.length > 0) {
      const bestAsk = this._asks[0];
      if (!bestAsk || incoming.price < bestAsk.price) break;

      const askRemaining = bestAsk.quantity - bestAsk.filledQuantity;
      const matchQty = remaining < askRemaining ? remaining : askRemaining;
      const tradePrice = bestAsk.price;
      const quoteVol = matchQty * tradePrice;

      bestAsk.filledQuantity += matchQty;
      incoming.filledQuantity += matchQty;
      remaining -= matchQty;

      trades.push({
        tradeId: nextTradeId(),
        buyOrderId: incoming.id,
        sellOrderId: bestAsk.id,
        buyerId: incoming.userId,
        sellerId: bestAsk.userId,
        price: tradePrice,
        quantity: matchQty,
        quoteVolume: quoteVol,
        timestampMs: nowMs
      });

      if (bestAsk.filledQuantity === bestAsk.quantity) {
        this._asks.shift();
      }
    }
    return remaining;
  }

  private _matchSell(incoming: BookOrder, nowMs: bigint, nextTradeId: () => string, trades: MatchTrade[]): bigint {
    let remaining = incoming.quantity - incoming.filledQuantity;
    while (remaining > 0n && this._bids.length > 0) {
      const bestBid = this._bids[0];
      if (!bestBid || incoming.price > bestBid.price) break;

      const bidRemaining = bestBid.quantity - bestBid.filledQuantity;
      const matchQty = remaining < bidRemaining ? remaining : bidRemaining;
      const tradePrice = bestBid.price;
      const quoteVol = matchQty * tradePrice;

      bestBid.filledQuantity += matchQty;
      incoming.filledQuantity += matchQty;
      remaining -= matchQty;

      trades.push({
        tradeId: nextTradeId(),
        buyOrderId: bestBid.id,
        sellOrderId: incoming.id,
        buyerId: bestBid.userId,
        sellerId: incoming.userId,
        price: tradePrice,
        quantity: matchQty,
        quoteVolume: quoteVol,
        timestampMs: nowMs
      });

      if (bestBid.filledQuantity === bestBid.quantity) {
        this._bids.shift();
      }
    }
    return remaining;
  }

  match(incoming: BookOrder, nowMs: bigint, nextTradeId: () => string): MatchResult {
    const trades: MatchTrade[] = [];
    const remaining = incoming.side === 'BUY'
      ? this._matchBuy(incoming, nowMs, nextTradeId, trades)
      : this._matchSell(incoming, nowMs, nextTradeId, trades);

    if (remaining > 0n) {
      this.addRestingOrder(incoming);
    }

    let status: 'FILLED' | 'PARTIALLY_FILLED' | 'RESTING' = 'RESTING';
    if (remaining === 0n) {
      status = 'FILLED';
    } else if (incoming.filledQuantity > 0n) {
      status = 'PARTIALLY_FILLED';
    }

    return {
      incomingOrderId: incoming.id,
      status,
      executedQuantity: incoming.filledQuantity,
      remainingQuantity: remaining,
      trades
    };
  }

  snapshot(): { readonly bids: readonly BookOrder[]; readonly asks: readonly BookOrder[] } {
    const bids: BookOrder[] = [];
    for (let i = 0; i < this._bids.length; i++) {
      const b = this._bids[i];
      if (b) bids.push({ ...b });
    }
    const asks: BookOrder[] = [];
    for (let i = 0; i < this._asks.length; i++) {
      const a = this._asks[i];
      if (a) asks.push({ ...a });
    }
    return { bids, asks };
  }

  restore(snap: { readonly bids: readonly BookOrder[]; readonly asks: readonly BookOrder[] }): void {
    this._bids = [];
    for (let i = 0; i < snap.bids.length; i++) {
      const b = snap.bids[i];
      if (b) this._bids.push({ ...b });
    }
    this._asks = [];
    for (let i = 0; i < snap.asks.length; i++) {
      const a = snap.asks[i];
      if (a) this._asks.push({ ...a });
    }
  }
}
