// src/auctionEngine.ts
export type TransferIntent = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
};

export type AuctionResult = {
  readonly settledVolume: bigint;
  readonly cycleVolume: bigint;
  readonly fractionalVolume: bigint;
  readonly reversionDelta: bigint;
  readonly settledParticipantsCount: number;
  readonly residualOrdersCount: number;
  readonly merkleRoot: bigint;
  readonly isLocked: boolean;
};

type CycleContext = {
  readonly residuals: BigUint64Array;
  readonly leafHashes: bigint[];
  readonly pMap: Map<string, boolean>;
};

export class AuctionEngine {
  private _isLocked: boolean;
  private readonly _minTolerance: bigint;
  private _totalSettledVolume: bigint;
  private _cycleVolume: bigint;
  private _fractionalVolume: bigint;
  private _reversionDelta: bigint;
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
    this._reversionDelta = 0n;
    this._settledParticipantsCount = 0;
    this._residualOrdersCount = 0;
    this._merkleRoot = 0n;
  }

  private _fnv1a64(str: string): bigint {
    let hash = 14695981039346656037n;
    for (let s = 0; s < str.length; s++) {
      hash = ((hash ^ BigInt(str.charCodeAt(s) & 255)) * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn;
    }
    return hash;
  }

  private _computeMerkleRoot(leaves: readonly bigint[]): bigint {
    if (leaves.length === 0) return 0n;
    let len = leaves.length;
    const tree = new BigUint64Array(len);
    for (let i = 0; i < len; i++) {
      const leaf = leaves[i];
      tree[i] = leaf !== undefined ? leaf : 0n;
    }
    while (len > 1) {
      const nextLen = (len + 1) >> 1;
      for (let i = 0; i < nextLen; i++) {
        const left = tree[i * 2] ?? 0n;
        const rightIdx = i * 2 + 1;
        const right = rightIdx < len ? (tree[rightIdx] ?? left) : left;
        const combined = (((left ^ (right >> 32n)) * 1099511628211n) ^ right) & 0xFFFFFFFFFFFFFFFFn;
        tree[i] = combined;
      }
      len = nextLen;
    }
    return tree[0] ?? 0n;
  }

  private _checkBilateralPair(
    indices: readonly [number, number],
    orders: readonly TransferIntent[],
    ctx: CycleContext
  ): bigint {
    const [i, j] = indices;
    const ordA = orders[i];
    const ordB = orders[j];
    if (ordA === undefined || ordB === undefined) return 0n;
    if (ordA.from !== ordB.to || ordA.to !== ordB.from) return 0n;

    const resA = ctx.residuals[i] ?? 0n;
    const resB = ctx.residuals[j] ?? 0n;
    if (resA <= 0n || resB <= 0n) return 0n;

    const minFlow = resA < resB ? resA : resB;
    if (minFlow <= 0n) return 0n;

    ctx.residuals[i] = resA - minFlow;
    ctx.residuals[j] = resB - minFlow;
    ctx.pMap.set(ordA.from, true);
    ctx.pMap.set(ordA.to, true);
    ctx.leafHashes.push(this._fnv1a64('2cycle:' + ordA.id + '<->' + ordB.id + ':' + minFlow.toString()));
    return minFlow * 2n;
  }

  private _resolveBilateralCycles(
    orders: readonly TransferIntent[],
    residuals: BigUint64Array,
    leafHashes: bigint[],
    pMap: Map<string, boolean>
  ): bigint {
    let cycleVolume = 0n;
    const n = orders.length;
    const ctx: CycleContext = { residuals, leafHashes, pMap };
    for (let i = 0; i < n; i++) {
      const resA = residuals[i] ?? 0n;
      if (resA <= 0n) continue;
      for (let j = i + 1; j < n; j++) {
        cycleVolume += this._checkBilateralPair([i, j], orders, ctx);
      }
    }
    return cycleVolume;
  }

  private _checkTriangularFlow(
    ordA: TransferIntent,
    ordB: TransferIntent,
    ordC: TransferIntent,
    flows: { resA: bigint; resB: bigint; resC: bigint }
  ): bigint {
    if (ordA.to === ordB.from && ordB.to === ordC.from && ordC.to === ordA.from) {
      let minFlow = flows.resA < flows.resB ? flows.resA : flows.resB;
      if (flows.resC < minFlow) minFlow = flows.resC;
      return minFlow;
    }
    return 0n;
  }

  private _checkTriangleAtJK(
    indices: readonly [number, number, number],
    orders: readonly TransferIntent[],
    ctx: CycleContext
  ): bigint {
    const [i, j, k] = indices;
    const ordA = orders[i];
    const ordB = orders[j];
    const ordC = orders[k];
    const resA = ctx.residuals[i] ?? 0n;
    const resB = ctx.residuals[j] ?? 0n;
    const resC = ctx.residuals[k] ?? 0n;
    if (ordA === undefined || ordB === undefined || ordC === undefined || resA <= 0n || resB <= 0n || resC <= 0n) return 0n;
    const minFlow = this._checkTriangularFlow(ordA, ordB, ordC, { resA, resB, resC });
    if (minFlow > 0n) {
      ctx.residuals[i] = resA - minFlow;
      ctx.residuals[j] = resB - minFlow;
      ctx.residuals[k] = resC - minFlow;
      ctx.pMap.set(ordA.from, true);
      ctx.pMap.set(ordA.to, true);
      ctx.pMap.set(ordB.to, true);
      ctx.leafHashes.push(this._fnv1a64('3cycle:' + ordA.id + '->' + ordB.id + '->' + ordC.id + ':' + minFlow.toString()));
      return minFlow * 3n;
    }
    return 0n;
  }

  private _searchTriangleK(
    i: number,
    j: number,
    orders: readonly TransferIntent[],
    ctx: CycleContext
  ): bigint {
    const n = orders.length;
    let volume = 0n;
    for (let k = 0; k < n; k++) {
      if (k === i || k === j) continue;
      volume += this._checkTriangleAtJK([i, j, k], orders, ctx);
    }
    return volume;
  }

  private _searchTriangularRing(
    i: number,
    orders: readonly TransferIntent[],
    ctx: CycleContext
  ): bigint {
    const ordA = orders[i];
    const resA = ctx.residuals[i] ?? 0n;
    if (ordA === undefined || resA <= 0n) return 0n;
    const n = orders.length;
    let volume = 0n;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const ordB = orders[j];
      const resB = ctx.residuals[j] ?? 0n;
      if (ordB === undefined || resB <= 0n || ordA.to !== ordB.from) continue;
      volume += this._searchTriangleK(i, j, orders, ctx);
    }
    return volume;
  }

  private _resolveTriangularCycles(
    orders: readonly TransferIntent[],
    residuals: BigUint64Array,
    leafHashes: bigint[],
    pMap: Map<string, boolean>
  ): bigint {
    let cycleVolume = 0n;
    const ctx: CycleContext = { residuals, leafHashes, pMap };
    for (let i = 0; i < orders.length; i++) {
      cycleVolume += this._searchTriangularRing(i, orders, ctx);
    }
    return cycleVolume;
  }

  private _computeDynamicCapacity(
    orders: readonly TransferIntent[],
    matchedLiquidity: bigint,
    residuals: BigUint64Array
  ): { totalResidual: bigint; effectiveLiquidity: bigint } {
    let totalResidual = 0n;
    const n = orders.length;
    for (let i = 0; i < n; i++) {
      const r = residuals[i] ?? 0n;
      totalResidual += r;
    }
    const effectiveLiquidity = matchedLiquidity < totalResidual ? matchedLiquidity : totalResidual;
    return { totalResidual, effectiveLiquidity };
  }

  private _executePartialFill(
    orders: readonly TransferIntent[],
    matchedLiquidity: bigint,
    residuals: BigUint64Array,
    ctx: { leafHashes: bigint[]; pMap: Map<string, boolean> }
  ): bigint {
    const n = orders.length;
    const { totalResidual, effectiveLiquidity } = this._computeDynamicCapacity(orders, matchedLiquidity, residuals);
    if (totalResidual <= 0n || effectiveLiquidity <= 0n) return 0n;
    let allocated = 0n;
    for (let i = 0; i < n; i++) {
      const r = residuals[i] ?? 0n;
      const ord = orders[i];
      if (r <= 0n || ord === undefined) continue;
      const fill = (r * effectiveLiquidity) / totalResidual;
      if (fill >= this._minTolerance && fill > 0n) {
        residuals[i] = r - fill;
        allocated += fill;
        ctx.pMap.set(ord.from, true);
        ctx.pMap.set(ord.to, true);
        ctx.leafHashes.push(this._fnv1a64('partial:' + ord.id + ':' + fill.toString()));
      }
    }
    return allocated;
  }

  private _prepareBatch(orders: readonly TransferIntent[]): { initialDemand: bigint; residuals: BigUint64Array } {
    const n = orders.length;
    let initialDemand = 0n;
    const residuals = new BigUint64Array(n);
    for (let i = 0; i < n; i++) {
      const ord = orders[i];
      if (ord === undefined) continue;
      if (ord.amount < 0n) throw new RangeError('Order amount must be non-negative');
      residuals[i] = ord.amount;
      initialDemand += ord.amount;
    }
    return { initialDemand, residuals };
  }

  private _countRemainingResiduals(residuals: BigUint64Array): { count: number; sum: bigint } {
    let count = 0;
    let sum = 0n;
    for (let i = 0; i < residuals.length; i++) {
      const r = residuals[i] ?? 0n;
      if (r > 0n) {
        count++;
        sum += r;
      }
    }
    return { count, sum };
  }

  processBatch(orders: readonly TransferIntent[], matchedVolume?: bigint, epochId?: bigint): AuctionResult {
    if (this._isLocked) throw new Error('AuctionEngine is locked');
    const matched = matchedVolume !== undefined ? matchedVolume : 0n;
    if (matched < 0n) throw new RangeError('matchedVolume must be non-negative');
    const ep = epochId !== undefined ? epochId : 0n;
    if (ep < 0n) throw new RangeError('epochId must be non-negative');

    const { initialDemand, residuals } = this._prepareBatch(orders);
    const leafHashes: bigint[] = [];
    const pMap = new Map<string, boolean>();

    const totalCycle = this._resolveBilateralCycles(orders, residuals, leafHashes, pMap) +
                       this._resolveTriangularCycles(orders, residuals, leafHashes, pMap);
    const fractionalVolume = this._executePartialFill(orders, matched, residuals, { leafHashes, pMap });
    const merkleRoot = this._computeMerkleRoot(leafHashes);

    const { count: remainingResidualCount, sum: remainingResidualSum } = this._countRemainingResiduals(residuals);
    const settledVolume = totalCycle + fractionalVolume;
    const reversionDelta = initialDemand - settledVolume;

    this._totalSettledVolume = settledVolume;
    this._cycleVolume = totalCycle;
    this._fractionalVolume = fractionalVolume;
    this._reversionDelta = reversionDelta;
    this._settledParticipantsCount = pMap.size;
    this._residualOrdersCount = remainingResidualCount;
    this._merkleRoot = merkleRoot;

    if (initialDemand !== totalCycle + fractionalVolume + remainingResidualSum) {
      throw new Error('Conservation violation: initial != cycle + partial + residual');
    }

    return {
      settledVolume,
      cycleVolume: totalCycle,
      fractionalVolume,
      reversionDelta,
      settledParticipantsCount: pMap.size,
      residualOrdersCount: remainingResidualCount,
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

  get isLocked(): boolean {
    return this._isLocked;
  }

  get totalSettledVolume(): bigint {
    return this._totalSettledVolume;
  }

  get cycleVolume(): bigint {
    return this._cycleVolume;
  }

  get fractionalVolume(): bigint {
    return this._fractionalVolume;
  }

  get reversionDelta(): bigint {
    return this._reversionDelta;
  }

  get settledParticipantsCount(): number {
    return this._settledParticipantsCount;
  }

  get residualOrdersCount(): number {
    return this._residualOrdersCount;
  }

  get merkleRoot(): bigint {
    return this._merkleRoot;
  }
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
