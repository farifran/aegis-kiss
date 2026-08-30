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

  private static _fnv1a64(str: string): bigint {
    let hash = 14695981039346656037n;
    for (let s = 0; s < str.length; s++) {
      hash = ((hash ^ BigInt(str.charCodeAt(s) & 255)) * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn;
    }
    return hash;
  }

  private static _computeMerkleRoot(leaves: readonly bigint[]): bigint {
    if (leaves.length === 0) return 0n;
    let len = leaves.length;
    const tree = new BigUint64Array(len);
    for (let i = 0; i < len; i++) {
      const leaf = leaves[i];
      if (leaf !== undefined) tree[i] = leaf;
    }

    while (len > 1) {
      let nextLen = 0;
      for (let i = 0; i < len; i += 2) {
        const left = tree[i] ?? 0n;
        const right = i + 1 < len ? (tree[i + 1] ?? left) : left;
        const combined = (((left ^ (right >> 32n)) * 1099511628211n) ^ right) & 0xFFFFFFFFFFFFFFFFn;
        tree[nextLen] = combined;
        nextLen++;
      }
      len = nextLen;
    }
    return tree[0] ?? 0n;
  }

  private _matchBilateralLeg(
    ordA: TransferIntent,
    ordB: TransferIntent,
    resA: bigint,
    resB: bigint
  ): bigint {
    if (ordA.from !== ordB.to || ordA.to !== ordB.from) return 0n;
    return resA < resB ? resA : resB;
  }

  private _resolveBilateralCycles(
    orders: readonly TransferIntent[],
    residuals: BigInt64Array,
    leafHashes: bigint[],
    pMap: Map<string, boolean>
  ): bigint {
    let cycleVolume = 0n;
    const n = orders.length;
    for (let i = 0; i < n; i++) {
      const ordA = orders[i];
      const resA = residuals[i] ?? 0n;
      if (ordA === undefined || resA <= 0n) continue;

      for (let j = i + 1; j < n; j++) {
        const ordB = orders[j];
        const resB = residuals[j] ?? 0n;
        if (ordB === undefined || resB <= 0n) continue;

        const minFlow = this._matchBilateralLeg(ordA, ordB, resA, resB);
        if (minFlow > 0n) {
          residuals[i] = resA - minFlow;
          residuals[j] = resB - minFlow;
          cycleVolume += minFlow * 2n;
          pMap.set(ordA.from, true);
          pMap.set(ordA.to, true);
          leafHashes.push(AuctionEngine._fnv1a64(`2cycle:${ordA.id}->${ordB.id}:${minFlow}`));
        }
      }
    }
    return cycleVolume;
  }

  private _checkTriangularFlow(
    ordA: TransferIntent,
    ordB: TransferIntent,
    ordC: TransferIntent,
    res: { resA: bigint; resB: bigint; resC: bigint }
  ): bigint {
    if (ordA.to !== ordB.from || ordB.to !== ordC.from || ordC.to !== ordA.from) return 0n;
    let minFlow = res.resA;
    if (res.resB < minFlow) minFlow = res.resB;
    if (res.resC < minFlow) minFlow = res.resC;
    return minFlow;
  }

  private _checkTriangleAtJK(
    idx: [number, number, number],
    orders: readonly TransferIntent[],
    ctx: { residuals: BigInt64Array; leafHashes: bigint[]; pMap: Map<string, boolean> }
  ): bigint {
    const i = idx[0];
    const j = idx[1];
    const k = idx[2];
    const ordA = orders[i];
    const ordB = orders[j];
    const ordC = orders[k];
    const resA = ctx.residuals[i] ?? 0n;
    const resB = ctx.residuals[j] ?? 0n;
    const resC = ctx.residuals[k] ?? 0n;
    if (ordA === undefined || ordB === undefined || ordC === undefined || resA <= 0n || resB <= 0n || resC <= 0n) {
      return 0n;
    }
    const minFlow = this._checkTriangularFlow(ordA, ordB, ordC, { resA, resB, resC });
    if (minFlow > 0n) {
      ctx.residuals[i] = resA - minFlow;
      ctx.residuals[j] = resB - minFlow;
      ctx.residuals[k] = resC - minFlow;
      ctx.pMap.set(ordA.from, true);
      ctx.pMap.set(ordA.to, true);
      ctx.pMap.set(ordB.to, true);
      ctx.leafHashes.push(AuctionEngine._fnv1a64(`3cycle:${ordA.id}->${ordB.id}->${ordC.id}:${minFlow}`));
      return minFlow * 3n;
    }
    return 0n;
  }

  private _searchTriangleK(
    i: number,
    j: number,
    orders: readonly TransferIntent[],
    ctx: { residuals: BigInt64Array; leafHashes: bigint[]; pMap: Map<string, boolean> }
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
    ctx: { residuals: BigInt64Array; leafHashes: bigint[]; pMap: Map<string, boolean> }
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
    residuals: BigInt64Array,
    leafHashes: bigint[],
    pMap: Map<string, boolean>
  ): bigint {
    let cycleVolume = 0n;
    const ctx = { residuals, leafHashes, pMap };
    for (let i = 0; i < orders.length; i++) {
      cycleVolume += this._searchTriangularRing(i, orders, ctx);
    }
    return cycleVolume;
  }

  private _executePartialFill(
    orders: readonly TransferIntent[],
    matchedVolume: bigint,
    residuals: BigInt64Array,
    ctx: { leafHashes: bigint[]; pMap: Map<string, boolean> }
  ): bigint {
    let totalResidualDemand = 0n;
    const n = orders.length;
    for (let i = 0; i < n; i++) {
      totalResidualDemand += residuals[i] ?? 0n;
    }

    let fractionalVolume = 0n;
    for (let i = 0; i < n; i++) {
      const ord = orders[i];
      if (ord === undefined) continue;
      const res = residuals[i] ?? 0n;
      if (res <= 0n) continue;

      let fill = 0n;
      if (matchedVolume >= totalResidualDemand) {
        fill = res;
      } else if (matchedVolume > 0n && totalResidualDemand > 0n) {
        fill = (res * matchedVolume) / totalResidualDemand;
      }

      if (fill >= this._minTolerance) {
        residuals[i] = res - fill;
        fractionalVolume += fill;
        ctx.pMap.set(ord.from, true);
        ctx.pMap.set(ord.to, true);
        ctx.leafHashes.push(AuctionEngine._fnv1a64(`partial:${ord.id}:${ord.from}->${ord.to}:${fill}`));
      }
    }
    return fractionalVolume;
  }

  processBatch(orders: readonly TransferIntent[], matchedVolume?: bigint): AuctionResult {
    if (this._isLocked) throw new Error('AuctionEngine is locked');
    const matched = matchedVolume !== undefined ? matchedVolume : 0n;
    if (matched < 0n) throw new RangeError('matchedVolume must be non-negative');

    const n = orders.length;
    const residuals = new BigInt64Array(n);
    let initialDemand = 0n;
    for (let i = 0; i < n; i++) {
      const ord = orders[i];
      if (ord === undefined) continue;
      if (ord.amount < 0n) throw new RangeError('Order amount must be non-negative');
      residuals[i] = ord.amount;
      initialDemand += ord.amount;
    }

    const leafHashes: bigint[] = [];
    const pMap = new Map<string, boolean>();

    const biCycle = this._resolveBilateralCycles(orders, residuals, leafHashes, pMap);
    const triCycle = this._resolveTriangularCycles(orders, residuals, leafHashes, pMap);
    const totalCycle = biCycle + triCycle;

    const fractionalVolume = this._executePartialFill(orders, matched, residuals, { leafHashes, pMap });
    const merkleRoot = AuctionEngine._computeMerkleRoot(leafHashes);

    let remainingResidualCount = 0;
    let remainingResidualSum = 0n;
    for (let i = 0; i < n; i++) {
      const r = residuals[i] ?? 0n;
      if (r > 0n) {
        remainingResidualCount++;
        remainingResidualSum += r;
      }
    }

    const settledVolume = totalCycle + fractionalVolume;
    this._totalSettledVolume = settledVolume;
    this._cycleVolume = totalCycle;
    this._fractionalVolume = fractionalVolume;
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
