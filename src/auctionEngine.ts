type TransferIntent = { id: string; from: string; to: string; amount: bigint; };
type AuctionResult = { settledVolume: bigint; cycleVolume: bigint; fractionalVolume: bigint; settledParticipantsCount: number; residualOrdersCount: number; merkleRoot: bigint; isLocked: boolean; };

export class AuctionEngine {
  private _isLocked: boolean;
  private readonly _minTolerance: bigint;
  private _totalSettledVolume: bigint;
  private _cycleVolume: bigint;
  private _fractionalVolume: bigint;
  private _settledParticipantsCount: number;
  private _residualOrdersCount: number;
  private _merkleRoot: bigint;

  constructor(minTolerance?: bigint) {
    const tol = minTolerance !== undefined ? minTolerance : 1n;
    if (tol < 0n) throw new RangeError('minTolerance must be non-negative');
    this._isLocked = false;
    this._minTolerance = tol;
    this._totalSettledVolume = 0n;
    this._cycleVolume = 0n;
    this._fractionalVolume = 0n;
    this._settledParticipantsCount = 0;
    this._residualOrdersCount = 0;
    this._merkleRoot = 0n;
  }

  _fnv1a64(str: string): bigint {
    let hash = 14695981039346656037n;
    for (let s = 0; s < str.length; s++) {
    hash = ((hash ^ BigInt(str.charCodeAt(s) & 255)) * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn;
    }
    return hash;
  }

  _computeMerkleRoot(leafHashes: bigint[]): bigint {
    if (leafHashes.length === 0) return 0n;
    let current = leafHashes.slice();
    while (current.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < current.length; i += 2) {
    const left = current[i];
    if (left === undefined) continue;
    const right = i + 1 < current.length && current[i + 1] !== undefined ? current[i + 1] : left;
    if (right !== undefined) {
    const combined = (((left ^ (right >> 32n)) * 1099511628211n) ^ right) & 0xFFFFFFFFFFFFFFFFn;
    nextLevel.push(combined);
    }
    }
    current = nextLevel;
    }
    const top = current[0];
    return top !== undefined ? top : 0n;
  }

  _buildEdgeMap(orders: readonly TransferIntent[], residualMap: Map<string, bigint>): Map<string, Map<string, bigint>> {
    const edgeMap = new Map<string, Map<string, bigint>>();
    for (let i = 0; i < orders.length; i++) {
    const ord = orders[i];
    if (ord === undefined) continue;
    if (ord.amount < 0n) throw new RangeError('Order amount must be non-negative');
    residualMap.set(ord.id, ord.amount);
    if (ord.from === ord.to || ord.amount === 0n) continue;
    if (!edgeMap.has(ord.from)) edgeMap.set(ord.from, new Map());
    const dests = edgeMap.get(ord.from);
    if (dests !== undefined) {
    const prev = dests.get(ord.to);
    dests.set(ord.to, (prev !== undefined ? prev : 0n) + ord.amount);
    }
    }
    return edgeMap;
  }

  _deductEdgeOrders(from: string, to: string, amountToDeduct: bigint, ctx: { orders: readonly TransferIntent[]; residualMap: Map<string, bigint> }): void {
    let remaining = amountToDeduct;
    for (let i = 0; i < ctx.orders.length && remaining > 0n; i++) {
    const ord = ctx.orders[i];
    if (ord === undefined || ord.from !== from || ord.to !== to) continue;
    const curResidual = ctx.residualMap.get(ord.id) ?? 0n;
    if (curResidual <= 0n) continue;
    const deduct = curResidual < remaining ? curResidual : remaining;
    ctx.residualMap.set(ord.id, curResidual - deduct);
    remaining = remaining - deduct;
    }
  }

  _resolveSingleCycle(a: string, b: string, c: string, edgeMap: Map<string, Map<string, bigint>>): bigint {
    const bMap = edgeMap.get(a);
    const cMap = edgeMap.get(b);
    const aMap = edgeMap.get(c);
    if (bMap === undefined || cMap === undefined || aMap === undefined) return 0n;
    if (!aMap.has(a)) return 0n;
    const vAB = bMap.get(b);
    const vBC = cMap.get(c);
    const vCA = aMap.get(a);
    if (vAB === undefined || vBC === undefined || vCA === undefined) return 0n;
    let minFlow = vAB;
    if (vBC < minFlow) minFlow = vBC;
    if (vCA < minFlow) minFlow = vCA;
    if (minFlow <= 0n) return 0n;
    bMap.set(b, vAB - minFlow);
    cMap.set(c, vBC - minFlow);
    aMap.set(a, vCA - minFlow);
    return minFlow;
  }

  _resolveDirectCycles(edgeMap: Map<string, Map<string, bigint>>, orders: readonly TransferIntent[], residualMap: Map<string, bigint>, participants: Set<string>): bigint {
    let totalCycle = 0n;
    const ctx = { orders, residualMap };
    const nodes = Array.from(edgeMap.keys());
    for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a === undefined) continue;
    const bMap = edgeMap.get(a);
    if (bMap === undefined) continue;
    const bKeys = Array.from(bMap.keys());
    for (let j = 0; j < bKeys.length; j++) {
    const b = bKeys[j];
    if (b === undefined) continue;
    const cMap = edgeMap.get(b);
    if (cMap === undefined) continue;
    const cKeys = Array.from(cMap.keys());
    for (let k = 0; k < cKeys.length; k++) {
    const c = cKeys[k];
    if (c === undefined) continue;
    const minFlow = this._resolveSingleCycle(a, b, c, edgeMap);
    if (minFlow > 0n) {
    this._deductEdgeOrders(a, b, minFlow, ctx);
    this._deductEdgeOrders(b, c, minFlow, ctx);
    this._deductEdgeOrders(c, a, minFlow, ctx);
    totalCycle = totalCycle + (minFlow * 3n);
    participants.add(a);
    participants.add(b);
    participants.add(c);
    }
    }
    }
    }
    return totalCycle;
  }

  _executePartialFill(orders: readonly TransferIntent[], matchedVolume: bigint, residualMap: Map<string, bigint>, ctx: { participants: Set<string>; leafHashes: bigint[] }): bigint {
    let totalResidualDemand = 0n;
    for (let i = 0; i < orders.length; i++) {
    const ord = orders[i];
    if (ord !== undefined) totalResidualDemand = totalResidualDemand + (residualMap.get(ord.id) ?? 0n);
    }
    let totalFractional = 0n;
    for (let i = 0; i < orders.length; i++) {
    const ord = orders[i];
    if (ord === undefined) continue;
    const residual = residualMap.get(ord.id) ?? 0n;
    if (residual === 0n) continue;
    let fillAmount = residual;
    if (totalResidualDemand > 0n && matchedVolume > 0n && matchedVolume < totalResidualDemand) {
    fillAmount = (residual * matchedVolume) / totalResidualDemand;
    }
    if (fillAmount >= this._minTolerance) {
    totalFractional = totalFractional + fillAmount;
    ctx.participants.add(ord.from);
    ctx.participants.add(ord.to);
    const str = ord.id + ':' + ord.from + '->' + ord.to + ':' + fillAmount.toString();
    ctx.leafHashes.push(this._fnv1a64(str));
    } else {
    this._residualOrdersCount = this._residualOrdersCount + 1;
    }
    }
    return totalFractional;
  }

  processBatch(orders: readonly TransferIntent[], matchedVolume?: bigint): AuctionResult {
    if (this._isLocked) throw new Error('AuctionEngine is locked');
    const matched = matchedVolume !== undefined ? matchedVolume : 0n;
    if (matched < 0n) throw new RangeError('matchedVolume must be non-negative');
    this._residualOrdersCount = 0;
    const participants = new Set<string>();
    const leafHashes: bigint[] = [];
    const residualMap = new Map<string, bigint>();
    const edgeMap = this._buildEdgeMap(orders, residualMap);
    const totalCycle = this._resolveDirectCycles(edgeMap, orders, residualMap, participants);
    const totalFractional = this._executePartialFill(orders, matched, residualMap, { participants, leafHashes });
    const merkleRoot = this._computeMerkleRoot(leafHashes);
    const settledVolume = totalCycle + totalFractional;
    this._totalSettledVolume = settledVolume;
    this._cycleVolume = totalCycle;
    this._fractionalVolume = totalFractional;
    this._settledParticipantsCount = participants.size;
    this._merkleRoot = merkleRoot;
    return {
    settledVolume,
    cycleVolume: totalCycle,
    fractionalVolume: totalFractional,
    settledParticipantsCount: participants.size,
    residualOrdersCount: this._residualOrdersCount,
    merkleRoot,
    isLocked: this._isLocked
    };
  }

  lock(): void {
    this._isLocked = true;
  }

  unlock(): void {
    this._isLocked = false;
  }

  get isLocked(): boolean { return this._isLocked; }

  get totalSettledVolume(): bigint { return this._totalSettledVolume; }

  get cycleVolume(): bigint { return this._cycleVolume; }

  get fractionalVolume(): bigint { return this._fractionalVolume; }

  get settledParticipantsCount(): number { return this._settledParticipantsCount; }

  get residualOrdersCount(): number { return this._residualOrdersCount; }

  get merkleRoot(): bigint { return this._merkleRoot; }
}

export function compileAuctionBitmask(engine: AuctionEngine): number {
  let mask = 0;
  if (engine.isLocked) mask = mask | 1;
  if (engine.cycleVolume > 0n) mask = mask | 2;
  if (engine.fractionalVolume > 0n) mask = mask | 4;
  if (engine.totalSettledVolume > 10000000n) mask = mask | 8;
  const p = engine.settledParticipantsCount > 63 ? 63 : engine.settledParticipantsCount;
  mask = mask | ((p & 63) << 4);
  const r = engine.residualOrdersCount > 63 ? 63 : engine.residualOrdersCount;
  mask = mask | ((r & 63) << 10);
  const top16 = Number((engine.merkleRoot >> 48n) & 65535n);
  mask = mask | ((top16 & 65535) << 16);
  return mask;
}
