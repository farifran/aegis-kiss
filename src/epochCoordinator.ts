// src/epochCoordinator.ts
import { AuctionEngine } from './auctionEngine.js';
import type { TransferIntent, AuctionResult } from './auctionEngine.js';

export type EpochResult = {
  readonly settledVolume: bigint;
  readonly reversionDelta: bigint;
  readonly quarantinedOrdersCount: number;
  readonly cycleVolume: bigint;
  readonly fractionalVolume: bigint;
  readonly rollbackOccurred: boolean;
  readonly merkleRoot: bigint;
  readonly historicalMerkleRoot: bigint;
  readonly isLocked: boolean;
};

type CleanBatchContext = {
  readonly cleanOrders: TransferIntent[];
  readonly quarantinedOrdersCount: number;
  readonly cleanInitialDemand: bigint;
};

export class EpochClearingCoordinator {
  private _isLocked: boolean;
  private readonly _engine: AuctionEngine;
  private readonly _quarantinedAccounts: Map<string, boolean>;
  private _treasuryBalance: bigint;
  private _totalEpochsProcessed: number;
  private _totalAccumulatedVolume: bigint;
  private _lastResidualOrdersCount: number;
  private _lastRollbackOccurred: boolean;
  private readonly _merkleHistory: BigUint64Array;
  private _merkleHistoryIndex: number;

  constructor(engine?: AuctionEngine, initialTreasury?: bigint) {
    const treas = initialTreasury !== undefined ? initialTreasury : 0n;
    if (treas < 0n) throw new RangeError('initialTreasury must be non-negative');
    this._isLocked = false;
    this._engine = engine !== undefined ? engine : new AuctionEngine(1n);
    this._quarantinedAccounts = new Map<string, boolean>();
    this._treasuryBalance = treas;
    this._totalEpochsProcessed = 0;
    this._totalAccumulatedVolume = 0n;
    this._lastResidualOrdersCount = 0;
    this._lastRollbackOccurred = false;
    this._merkleHistory = new BigUint64Array(16);
    this._merkleHistoryIndex = 0;
  }

  quarantineAccount(account: string): void {
    this._quarantinedAccounts.set(account, true);
  }

  unquarantineAccount(account: string): void {
    this._quarantinedAccounts.delete(account);
  }

  isAccountQuarantined(account: string): boolean {
    return this._quarantinedAccounts.get(account) === true;
  }

  isolateAccount(account: string): void {
    this.quarantineAccount(account);
  }

  unisolateAccount(account: string): void {
    this.unquarantineAccount(account);
  }

  isAccountIsolated(account: string): boolean {
    return this.isAccountQuarantined(account);
  }

  depositTreasury(amount: bigint): void {
    if (amount < 0n) throw new RangeError('Deposit amount must be non-negative');
    this._treasuryBalance += amount;
  }

  private _filterCleanOrders(orders: readonly TransferIntent[]): CleanBatchContext {
    const cleanOrders: TransferIntent[] = [];
    let quarantinedOrdersCount = 0;
    let cleanInitialDemand = 0n;

    for (let i = 0; i < orders.length; i++) {
      const ord = orders[i];
      if (ord === undefined) continue;
      if (this.isAccountQuarantined(ord.from) || this.isAccountQuarantined(ord.to)) {
        quarantinedOrdersCount++;
      } else {
        cleanOrders.push(ord);
        cleanInitialDemand += ord.amount;
      }
    }
    return { cleanOrders, quarantinedOrdersCount, cleanInitialDemand };
  }

  private _chainMerkleRoot(batchMerkleRoot: bigint): bigint {
    const prevIdx = (this._merkleHistoryIndex + 15) % 16;
    const prevRoot = this._merkleHistory[prevIdx] ?? 0n;
    const currRoot = batchMerkleRoot;
    const chainedRoot = (((prevRoot ^ (currRoot >> 32n)) * 1099511628211n) ^ currRoot) & 0xFFFFFFFFFFFFFFFFn;
    this._merkleHistory[this._merkleHistoryIndex] = chainedRoot;
    this._merkleHistoryIndex = (this._merkleHistoryIndex + 1) % 16;
    return chainedRoot;
  }

  private _recordSuccessfulEpoch(batchRes: AuctionResult): bigint {
    this._lastRollbackOccurred = false;
    this._totalEpochsProcessed++;
    this._totalAccumulatedVolume += batchRes.settledVolume;
    this._lastResidualOrdersCount = batchRes.residualOrdersCount;
    return this._chainMerkleRoot(batchRes.merkleRoot);
  }

  processEpoch(orders: readonly TransferIntent[], availableLiquidity?: bigint, epochId?: bigint): EpochResult {
    if (this.isLocked) {
      throw new Error('EpochClearingCoordinator or internal engine is locked');
    }
    const ep = epochId !== undefined ? epochId : 0n;
    if (ep < 0n) throw new RangeError('epochId must be non-negative');
    const avLiquidity = availableLiquidity !== undefined ? availableLiquidity : this._treasuryBalance;
    if (avLiquidity < 0n) throw new RangeError('availableLiquidity must be non-negative');

    // Stage 1: Pre-filtering and Quarantine Isolation
    const { cleanOrders, quarantinedOrdersCount, cleanInitialDemand } = this._filterCleanOrders(orders);

    if (cleanOrders.length === 0) {
      this._lastResidualOrdersCount = 0;
      this._lastRollbackOccurred = false;
      return {
        settledVolume: 0n,
        reversionDelta: 0n,
        quarantinedOrdersCount,
        cycleVolume: 0n,
        fractionalVolume: 0n,
        rollbackOccurred: false,
        merkleRoot: 0n,
        historicalMerkleRoot: 0n,
        isLocked: this.isLocked
      };
    }

    // Stage 2 & 3: Graph Cycle Decongestion & Dynamic Fractional Auction
    const matched = avLiquidity < cleanInitialDemand ? avLiquidity : cleanInitialDemand;
    const batchRes: AuctionResult = this._engine.processBatch(cleanOrders, matched, ep);

    // Stage 4: Multilateral Net Settlement & Atomic State Commit
    const chainedRoot = this._recordSuccessfulEpoch(batchRes);

    return {
      settledVolume: batchRes.settledVolume,
      reversionDelta: batchRes.reversionDelta,
      quarantinedOrdersCount,
      cycleVolume: batchRes.cycleVolume,
      fractionalVolume: batchRes.fractionalVolume,
      rollbackOccurred: false,
      merkleRoot: chainedRoot,
      historicalMerkleRoot: chainedRoot,
      isLocked: this.isLocked
    };
  }

  lock(): void {
    this._isLocked = true;
  }

  unlock(): void {
    this._isLocked = false;
  }

  get isLocked(): boolean {
    return this._isLocked || this._engine.isLocked;
  }

  get engine(): AuctionEngine {
    return this._engine;
  }

  get quarantinedAccountsCount(): number {
    return this._quarantinedAccounts.size;
  }

  get isolatedAccountsCount(): number {
    return this.quarantinedAccountsCount;
  }

  get treasuryBalance(): bigint {
    return this._treasuryBalance;
  }

  get totalEpochsProcessed(): number {
    return this._totalEpochsProcessed;
  }

  get totalAccumulatedVolume(): bigint {
    return this._totalAccumulatedVolume;
  }

  get lastResidualOrdersCount(): number {
    return this._lastResidualOrdersCount;
  }

  get lastRollbackOccurred(): boolean {
    return this._lastRollbackOccurred;
  }

  get latestHistoricalMerkleRoot(): bigint {
    const prevIdx = (this._merkleHistoryIndex + 15) % 16;
    return this._merkleHistory[prevIdx] ?? 0n;
  }
}

export function obterEpochCoordinatorBitmask(coordinator: EpochClearingCoordinator): number {
  let mask = 0;
  if (coordinator.isLocked) mask = mask | 1;
  if (coordinator.lastRollbackOccurred) mask = mask | 2;
  if (coordinator.quarantinedAccountsCount > 0) mask = mask | 4;
  if (coordinator.totalAccumulatedVolume > 50000000n) mask = mask | 8;
  const ep = coordinator.totalEpochsProcessed % 64;
  mask = mask | ((ep & 63) << 4);
  const r = coordinator.lastResidualOrdersCount > 63 ? 63 : coordinator.lastResidualOrdersCount;
  mask = mask | ((r & 63) << 10);
  const top16 = Number((coordinator.latestHistoricalMerkleRoot >> 48n) & 65535n);
  mask = mask | ((top16 & 65535) << 16);
  return mask;
}
