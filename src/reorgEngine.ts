import { BlockTree, type BlockHeader, type ReorgResult } from './blockTree.js';
import { FileStateWal, type StateWal } from './stateWal.js';

export type AlertEventType = 'CONFIRMED' | 'REORG_REVOKED';

export interface AlertEvent {
  readonly eventId: string;
  readonly type: AlertEventType;
  readonly subscriptionId: string;
  readonly txid: string;
  readonly userId: string;
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly currentConfirmations: number;
  readonly threshold: number;
  readonly timestampMs: bigint;
}

export interface SubscriptionState {
  readonly subscriptionId: string;
  readonly txid: string;
  readonly userId: string;
  readonly threshold: number;
  readonly isAlerted: boolean;
  readonly lastAlertedHeight: number;
}

interface InternalSubscription {
  readonly subscriptionId: string;
  readonly txid: string;
  readonly userId: string;
  readonly threshold: number;
  isAlerted: boolean;
  lastAlertedHeight: number;
}

interface PendingBlock {
  readonly block: BlockHeader;
  readonly nowMs: bigint;
}

export interface ReorgEngineOptions {
  readonly journalPath?: string;
  readonly maxPendingBlocks?: number;
}

export interface InvariantViolation {
  readonly id: string;
  readonly message: string;
}

export interface InvariantReport {
  readonly valid: boolean;
  readonly violations: readonly InvariantViolation[];
}

export interface BlockAdmissionResult {
  readonly acceptedCount: number;
  readonly rejectedInvalidCount: number;
  readonly blockedCapacityCount: number;
  readonly pendingCount: number;
}

export interface EngineBlockResult {
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly isReorg: boolean;
  readonly reorgDetails?: ReorgResult;
  readonly alerts: readonly AlertEvent[];
}

export interface EngineBatchResult {
  readonly processedCount: number;
  readonly committedCount: number;
  readonly rejectedCount: number;
  readonly blockedCapacityCount: number;
  readonly abortedCount: number;
  readonly totalAlerts: number;
  readonly executionDigest: bigint;
  readonly blockResults: readonly EngineBlockResult[];
}

export interface EngineSnapshot {
  readonly treeSnapshot: { readonly blocks: Record<string, BlockHeader>; readonly tipHash: string | null; readonly tipHeight: number };
  readonly subscriptions: Record<string, { readonly subscriptionId: string; readonly txid: string; readonly userId: string; readonly threshold: number; readonly isAlerted: boolean; readonly lastAlertedHeight: number }>;
  readonly txToBlockMap: Record<string, { readonly blockHash: string; readonly height: number }>;
  readonly canonicalHeightToHash: Record<number, string>;
  readonly totalAlertsEmitted: bigint;
  readonly lastProcessedMs: bigint;
  readonly eventSequence: bigint;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a(hash: bigint, value: bigint): bigint {
  let h = hash ^ (value & 0xFFFFFFFFFFFFFFFFn);
  h = (h * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
  return h;
}

function stringToHash(hash: bigint, value: string): bigint {
  let h = hash;
  for (let i = 0; i < value.length; i++) h = fnv1a(h, BigInt(value.charCodeAt(i)));
  return h;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function recordField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function isValidBlockInput(value: unknown): value is BlockHeader {
  if (!isRecord(value)) return false;
  const hash = recordField(value, 'hash');
  const prevHash = recordField(value, 'prevHash');
  const height = recordField(value, 'height');
  const timestampMs = recordField(value, 'timestampMs');
  const txids = recordField(value, 'txids');
  if (typeof hash !== 'string' || hash.trim() === '') return false;
  if (typeof prevHash !== 'string') return false;
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 0) return false;
  if (typeof timestampMs !== 'bigint' || timestampMs < 0n) return false;
  if (!Array.isArray(txids)) return false;
  return txids.every((txid: unknown) => typeof txid === 'string' && txid.trim() !== '');
}

export class ReorgEngine {
  private readonly _tree: BlockTree;
  private readonly _maxOrphanDepth: number;
  private readonly _maxPendingBlocks: number;
  private readonly _journal: StateWal | null;
  private readonly _subscriptions: Record<string, InternalSubscription>;
  private readonly _txToSubs: Record<string, string[]>;
  private readonly _txToBlockMap: Record<string, { readonly blockHash: string; readonly height: number }>;
  private readonly _blockHashToSubs: Record<string, string[]>;
  private readonly _canonicalHeightToHash: Record<number, string>;
  private readonly _pendingBlocks: PendingBlock[];
  private _totalAlertsEmitted: bigint;
  private _lastProcessedMs: bigint;
  private _eventSequence: bigint;

  constructor(maxOrphanDepth: number = 100, options: ReorgEngineOptions = {}) {
    if (!Number.isInteger(maxOrphanDepth) || maxOrphanDepth <= 0) throw new RangeError('maxOrphanDepth must be positive');
    const maxPendingBlocks = options.maxPendingBlocks ?? 4096;
    if (!Number.isInteger(maxPendingBlocks) || maxPendingBlocks <= 0) throw new RangeError('maxPendingBlocks must be positive');

    this._maxOrphanDepth = maxOrphanDepth;
    this._maxPendingBlocks = maxPendingBlocks;
    this._tree = new BlockTree(maxOrphanDepth);
    this._journal = options.journalPath ? new FileStateWal(options.journalPath) : null;
    this._subscriptions = Object.create(null) as Record<string, InternalSubscription>;
    this._txToSubs = Object.create(null) as Record<string, string[]>;
    this._txToBlockMap = Object.create(null) as Record<string, { readonly blockHash: string; readonly height: number }>;
    this._blockHashToSubs = Object.create(null) as Record<string, string[]>;
    this._canonicalHeightToHash = Object.create(null) as Record<number, string>;
    this._pendingBlocks = [];
    this._totalAlertsEmitted = 0n;
    this._lastProcessedMs = 0n;
    this._eventSequence = 0n;

    const recovered = this._journal?.readLatest() ?? null;
    if (recovered) this._restoreState(recovered);
  }

  get tipHash(): string | null { return this._tree.tipHash; }
  get tipHeight(): number { return this._tree.tipHeight; }
  get subscriptionCount(): number { return Object.keys(this._subscriptions).length; }
  get totalAlertsEmitted(): bigint { return this._totalAlertsEmitted; }
  get lastProcessedMs(): bigint { return this._lastProcessedMs; }
  get pendingCount(): number { return this._pendingBlocks.length; }
  get maxPendingBlocks(): number { return this._maxPendingBlocks; }
  get orphanCount(): number { return this._tree.orphanCount; }

  private _validateSubParams(subscriptionId: string, txid: string, userId: string, threshold: number): void {
    if (!subscriptionId || subscriptionId.trim() === '') throw new TypeError('subscriptionId must be a non-empty string');
    if (!txid || txid.trim() === '') throw new TypeError('txid must be a non-empty string');
    if (!userId || userId.trim() === '') throw new TypeError('userId must be a non-empty string');
    if (!Number.isInteger(threshold) || threshold <= 0) throw new RangeError('threshold must be a positive integer');
    if (this._subscriptions[subscriptionId] !== undefined) throw new Error(`subscription '${subscriptionId}' already exists`);
  }

  private _applySubscribe(subscriptionId: string, txid: string, userId: string, threshold: number): void {
    this._validateSubParams(subscriptionId, txid, userId, threshold);
    this._subscriptions[subscriptionId] = {
      subscriptionId,
      txid,
      userId,
      threshold,
      isAlerted: false,
      lastAlertedHeight: -1
    };
    this._rebuildIndexes();
  }

  subscribe(subscriptionId: string, txid: string, userId: string, threshold: number = 4): void {
    const projection = this._projection();
    projection._applySubscribe(subscriptionId, txid, userId, threshold);
    this._commitProjection(projection, this.snapshot());
  }

  private _applyUnsubscribe(subscriptionId: string): boolean {
    if (!this._subscriptions[subscriptionId]) return false;
    delete this._subscriptions[subscriptionId];
    this._rebuildIndexes();
    return true;
  }

  unsubscribe(subscriptionId: string): boolean {
    if (!this._subscriptions[subscriptionId]) return false;
    const projection = this._projection();
    projection._applyUnsubscribe(subscriptionId);
    this._commitProjection(projection, this.snapshot());
    return true;
  }

  getSubscription(subscriptionId: string): SubscriptionState | null {
    const sub = this._subscriptions[subscriptionId];
    if (!sub) return null;
    return { ...sub };
  }

  private _nextEventId(): string {
    this._eventSequence += 1n;
    return `evt_${this._eventSequence}`;
  }

  private _clearMap<T>(map: Record<string, T>): void {
    for (const key in map) delete map[key];
  }

  private _rebuildIndexes(): void {
    this._clearMap(this._txToSubs);
    this._clearMap(this._txToBlockMap);
    this._clearMap(this._blockHashToSubs);
    this._clearMap(this._canonicalHeightToHash);

    const subscriptionIds = Object.keys(this._subscriptions).sort();
    for (let i = 0; i < subscriptionIds.length; i++) {
      const sid = subscriptionIds[i];
      if (!sid) continue;
      const sub = this._subscriptions[sid];
      if (!sub) continue;
      const ids = this._txToSubs[sub.txid] ?? [];
      ids.push(sid);
      this._txToSubs[sub.txid] = ids;
    }

    const canonical = this._tree.getCanonicalChain();
    for (let i = 0; i < canonical.length; i++) {
      const block = canonical[i];
      if (!block) continue;
      this._canonicalHeightToHash[block.height] = block.hash;
      for (let j = 0; j < block.txids.length; j++) {
        const txid = block.txids[j];
        if (!txid) continue;
        if (this._txToBlockMap[txid]) throw new Error(`transaction '${txid}' appears twice on canonical chain`);
        this._txToBlockMap[txid] = { blockHash: block.hash, height: block.height };
        const matching = this._txToSubs[txid];
        if (matching && matching.length > 0) this._blockHashToSubs[block.hash] = [...matching];
      }
    }
  }

  private _indexCanonicalBlock(block: BlockHeader): void {
    this._canonicalHeightToHash[block.height] = block.hash;
    for (let i = 0; i < block.txids.length; i++) {
      const txid = block.txids[i];
      if (!txid) continue;
      const previous = this._txToBlockMap[txid];
      if (previous && previous.blockHash !== block.hash) throw new Error(`transaction '${txid}' appears twice on canonical chain`);
      this._txToBlockMap[txid] = { blockHash: block.hash, height: block.height };
      const matching = this._txToSubs[txid];
      if (matching && matching.length > 0) this._blockHashToSubs[block.hash] = [...matching];
    }
  }

  private _removeCanonicalBlock(block: BlockHeader): void {
    if (this._canonicalHeightToHash[block.height] === block.hash) delete this._canonicalHeightToHash[block.height];
    if (this._blockHashToSubs[block.hash]) delete this._blockHashToSubs[block.hash];
    for (let i = 0; i < block.txids.length; i++) {
      const txid = block.txids[i];
      const location = txid ? this._txToBlockMap[txid] : undefined;
      if (txid && location?.blockHash === block.hash) delete this._txToBlockMap[txid];
    }
  }

  private _handleDisconnectedBlock(block: BlockHeader, alerts: AlertEvent[], nowMs: bigint): void {
    const subIds = this._blockHashToSubs[block.hash];
    if (!subIds) return;
    for (let i = 0; i < subIds.length; i++) {
      const sid = subIds[i];
      const sub = sid ? this._subscriptions[sid] : undefined;
      if (!sub || !sub.isAlerted) continue;
      alerts.push({
        eventId: this._nextEventId(),
        type: 'REORG_REVOKED',
        subscriptionId: sub.subscriptionId,
        txid: sub.txid,
        userId: sub.userId,
        blockHash: block.hash,
        blockHeight: block.height,
        currentConfirmations: 0,
        threshold: sub.threshold,
        timestampMs: nowMs
      });
      sub.isAlerted = false;
      sub.lastAlertedHeight = -1;
      this._totalAlertsEmitted += 1n;
    }
  }

  private _evaluateCanonicalConfirmations(alerts: AlertEvent[], nowMs: bigint): void {
    const subscriptionIds = Object.keys(this._subscriptions).sort();
    for (let i = 0; i < subscriptionIds.length; i++) {
      const sid = subscriptionIds[i];
      if (!sid) continue;
      const sub = this._subscriptions[sid];
      if (!sub || sub.isAlerted) continue;
      const location = this._txToBlockMap[sub.txid];
      if (!location) continue;
      const confs = this._tree.getCanonicalConfirmations(location.blockHash);
      if (confs < sub.threshold) continue;
      alerts.push({
        eventId: this._nextEventId(),
        type: 'CONFIRMED',
        subscriptionId: sub.subscriptionId,
        txid: sub.txid,
        userId: sub.userId,
        blockHash: location.blockHash,
        blockHeight: location.height,
        currentConfirmations: confs,
        threshold: sub.threshold,
        timestampMs: nowMs
      });
      sub.isAlerted = true;
      sub.lastAlertedHeight = location.height;
      this._totalAlertsEmitted += 1n;
    }
  }

  private _applyBlock(block: BlockHeader, nowMs: bigint): EngineBlockResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    const reorgRes = this._tree.addBlock(block);
    const alerts: AlertEvent[] = [];
    if (reorgRes.isReorg) {
      for (let i = 0; i < reorgRes.disconnected.length; i++) {
        const disconnected = reorgRes.disconnected[i];
        if (disconnected) {
          this._handleDisconnectedBlock(disconnected, alerts, nowMs);
          this._removeCanonicalBlock(disconnected);
        }
      }
    }
    for (let i = 0; i < reorgRes.connected.length; i++) {
      const connected = reorgRes.connected[i];
      if (connected) this._indexCanonicalBlock(connected);
    }
    this._evaluateCanonicalConfirmations(alerts, nowMs);
    return {
      blockHash: block.hash,
      blockHeight: block.height,
      isReorg: reorgRes.isReorg,
      reorgDetails: reorgRes,
      alerts
    };
  }

  private _isAncestor(ancestorHash: string, startHash: string): boolean {
    let current: string | null = startHash;
    while (current !== null && current !== '') {
      if (current === ancestorHash) return true;
      const block = this._tree.getBlock(current);
      if (!block || block.prevHash === '') return false;
      current = block.prevHash;
    }
    return false;
  }

  private _preflightBlock(block: BlockHeader): void {
    if (!isValidBlockInput(block)) throw new TypeError('invalid block input');
    if (this._tree.hasBlock(block.hash)) throw new Error(`block '${block.hash}' already exists`);
    if (block.prevHash !== '') {
      const parent = this._tree.getBlock(block.prevHash);
      if (!parent) throw new Error(`parent block '${block.prevHash}' not found in tree`);
      if (block.height !== parent.height + 1) throw new Error('block height must immediately follow its parent');
    }
    const seenTxids: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    for (let i = 0; i < block.txids.length; i++) {
      const txid = block.txids[i];
      if (!txid) continue;
      if (seenTxids[txid]) throw new Error(`transaction '${txid}' is duplicated in block`);
      seenTxids[txid] = true;
      const location = this._txToBlockMap[txid];
      if (location && block.prevHash !== '' && this._isAncestor(location.blockHash, block.prevHash)) {
        throw new Error(`transaction '${txid}' already exists in the shared chain`);
      }
    }
  }

  processBlock(block: BlockHeader, nowMs: bigint): EngineBlockResult {
    if (nowMs < this._lastProcessedMs) throw new RangeError('time moved backwards');
    const before = this.snapshot();
    const projection = this._projection();
    projection._preflightBlock(block);
    const result = projection._applyBlock(block, nowMs);
    projection._lastProcessedMs = nowMs;
    projection._assertInvariants();
    this._commitProjection(projection, before);
    return result;
  }

  processBatch(blocks: readonly BlockHeader[], nowMs: bigint): EngineBatchResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    const before = this.snapshot();
    const admittedCount = Math.min(blocks.length, this._maxPendingBlocks);
    const blockedCapacityCount = blocks.length - admittedCount;
    if (nowMs < this._lastProcessedMs) return this._buildAbortResult(blocks, nowMs, admittedCount, blockedCapacityCount);

    const projection = this._projection();
    const blockResults: EngineBlockResult[] = [];
    let committedCount = 0;
    let rejectedCount = 0;
    let totalAlerts = 0;
    for (let i = 0; i < admittedCount; i++) {
      const block = blocks[i];
      if (!isValidBlockInput(block)) {
        rejectedCount += 1;
        continue;
      }
      try {
        projection._preflightBlock(block);
        const result = projection._applyBlock(block, nowMs);
        committedCount += 1;
        totalAlerts += result.alerts.length;
        blockResults.push(result);
      } catch {
        rejectedCount += 1;
      }
    }
    projection._lastProcessedMs = nowMs;
    projection._assertInvariants();
    const digest = projection._computeDigest(nowMs, blockResults, blocks, false);
    this._commitProjection(projection, before);
    return {
      processedCount: blocks.length,
      committedCount,
      rejectedCount,
      blockedCapacityCount,
      abortedCount: 0,
      totalAlerts,
      executionDigest: digest,
      blockResults
    };
  }

  private _buildAbortResult(
    blocks: readonly BlockHeader[],
    nowMs: bigint,
    admittedCount: number,
    blockedCapacityCount: number
  ): EngineBatchResult {
    return {
      processedCount: blocks.length,
      committedCount: 0,
      rejectedCount: 0,
      blockedCapacityCount,
      abortedCount: admittedCount,
      totalAlerts: 0,
      executionDigest: this._computeDigest(nowMs, [], blocks, true),
      blockResults: []
    };
  }

  enqueueBlocks(blocks: readonly BlockHeader[], nowMs: bigint): BlockAdmissionResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    let acceptedCount = 0;
    let rejectedInvalidCount = 0;
    let blockedCapacityCount = 0;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!isValidBlockInput(block)) rejectedInvalidCount += 1;
      else if (this._pendingBlocks.length < this._maxPendingBlocks) {
        this._pendingBlocks.push({ block: { ...block, txids: [...block.txids] }, nowMs });
        acceptedCount += 1;
      } else blockedCapacityCount += 1;
    }
    return { acceptedCount, rejectedInvalidCount, blockedCapacityCount, pendingCount: this._pendingBlocks.length };
  }

  drainPending(): EngineBatchResult {
    const pending = [...this._pendingBlocks];
    if (pending.length === 0) {
      return {
        processedCount: 0,
        committedCount: 0,
        rejectedCount: 0,
        blockedCapacityCount: 0,
        abortedCount: 0,
        totalAlerts: 0,
        executionDigest: this._computeDigest(this._lastProcessedMs, [], [], false),
        blockResults: []
      };
    }
    const nowMs = pending[pending.length - 1]?.nowMs ?? this._lastProcessedMs;
    const result = this.processBatch(pending.map((item) => item.block), nowMs);
    this._pendingBlocks.splice(0, pending.length);
    return result;
  }

  private _computeDigest(
    nowMs: bigint,
    results: readonly EngineBlockResult[],
    blocks: readonly BlockHeader[],
    rolledBack: boolean
  ): bigint {
    let hash = FNV_OFFSET;
    hash = fnv1a(hash, nowMs);
    hash = fnv1a(hash, this._lastProcessedMs);
    hash = fnv1a(hash, this._totalAlertsEmitted);
    hash = fnv1a(hash, BigInt(this._tree.tipHeight));
    hash = fnv1a(hash, rolledBack ? 1n : 0n);
    if (this._tree.tipHash) hash = stringToHash(hash, this._tree.tipHash);
    hash = this._digestBlocks(hash, blocks);
    hash = this._digestResults(hash, results);
    return this._digestSubscriptions(hash);
  }

  private _digestBlocks(initial: bigint, blocks: readonly BlockHeader[]): bigint {
    let hash = initial;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) continue;
      hash = fnv1a(hash, BigInt(i));
      hash = stringToHash(hash, block.hash);
      hash = stringToHash(hash, block.prevHash);
      hash = fnv1a(hash, BigInt(block.height));
    }
    return hash;
  }

  private _digestResults(initial: bigint, results: readonly EngineBlockResult[]): bigint {
    let hash = initial;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;
      hash = stringToHash(hash, result.blockHash);
      hash = fnv1a(hash, BigInt(result.alerts.length));
      for (let j = 0; j < result.alerts.length; j++) {
        const alert = result.alerts[j];
        if (alert) hash = stringToHash(hash, alert.type);
      }
    }
    return hash;
  }

  private _digestSubscriptions(initial: bigint): bigint {
    let hash = initial;
    const sortedSubs = Object.keys(this._subscriptions).sort();
    for (let i = 0; i < sortedSubs.length; i++) {
      const sid = sortedSubs[i];
      const sub = sid ? this._subscriptions[sid] : undefined;
      if (!sub) continue;
      hash = stringToHash(hash, sub.subscriptionId);
      hash = stringToHash(hash, sub.txid);
      hash = stringToHash(hash, sub.userId);
      hash = fnv1a(hash, BigInt(sub.threshold));
      hash = fnv1a(hash, sub.isAlerted ? 1n : 0n);
      hash = fnv1a(hash, BigInt(sub.lastAlertedHeight));
    }
    return hash;
  }

  snapshot(): EngineSnapshot {
    const subscriptions: EngineSnapshot['subscriptions'] = Object.create(null) as EngineSnapshot['subscriptions'];
    for (const sid in this._subscriptions) {
      const sub = this._subscriptions[sid];
      if (sub) subscriptions[sid] = { ...sub };
    }
    const txToBlockMap: EngineSnapshot['txToBlockMap'] = Object.create(null) as EngineSnapshot['txToBlockMap'];
    for (const txid in this._txToBlockMap) {
      const location = this._txToBlockMap[txid];
      if (location) txToBlockMap[txid] = { ...location };
    }
    const canonicalHeightToHash: EngineSnapshot['canonicalHeightToHash'] = Object.create(null) as EngineSnapshot['canonicalHeightToHash'];
    for (const height in this._canonicalHeightToHash) {
      const hash = this._canonicalHeightToHash[height];
      if (hash) canonicalHeightToHash[height] = hash;
    }
    return {
      treeSnapshot: this._tree.snapshot(),
      subscriptions,
      txToBlockMap,
      canonicalHeightToHash,
      totalAlertsEmitted: this._totalAlertsEmitted,
      lastProcessedMs: this._lastProcessedMs,
      eventSequence: this._eventSequence
    };
  }

  private _restoreState(snapshot: EngineSnapshot): void {
    this._tree.restore(snapshot.treeSnapshot);
    this._clearMap(this._subscriptions);
    for (const sid in snapshot.subscriptions) {
      const sub = snapshot.subscriptions[sid];
      if (sub) this._subscriptions[sid] = { ...sub };
    }
    this._totalAlertsEmitted = snapshot.totalAlertsEmitted;
    this._lastProcessedMs = snapshot.lastProcessedMs;
    this._eventSequence = snapshot.eventSequence;
    this._rebuildIndexes();
  }

  restore(snapshot: EngineSnapshot): void {
    const before = this.snapshot();
    const projection = this._projection();
    projection._restoreState(snapshot);
    projection._assertInvariants();
    try {
      if (this._journal) this._journal.append(projection.snapshot());
      this._restoreState(projection.snapshot());
      this._assertInvariants();
    } catch (error) {
      this._restoreState(before);
      throw error;
    }
  }

  private _projection(): ReorgEngine {
    const projection = new ReorgEngine(this._maxOrphanDepth, { maxPendingBlocks: this._maxPendingBlocks });
    projection._restoreState(this.snapshot());
    return projection;
  }

  private _commitProjection(projection: ReorgEngine, before: EngineSnapshot): void {
    projection._assertInvariants();
    const projectedState = projection.snapshot();
    if (this._journal) this._journal.append(projectedState);
    try {
      this._restoreState(projectedState);
      this._assertInvariants();
    } catch (error) {
      this._restoreState(before);
      throw error;
    }
  }

  private _verifyTip(canonical: readonly BlockHeader[]): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    if (this._tree.tipHash === null && this._tree.tipHeight !== -1) {
      violations.push({ id: 'INV-TIP-001', message: 'empty tree must have tipHeight -1' });
    }
    const tip = canonical[canonical.length - 1];
    if (tip && (tip.hash !== this._tree.tipHash || tip.height !== this._tree.tipHeight)) {
      violations.push({ id: 'INV-TIP-002', message: 'tip does not match canonical chain' });
    }
    return violations;
  }

  private _verifyCanonicalChain(canonical: readonly BlockHeader[]): InvariantViolation[] {
    for (let i = 1; i < canonical.length; i++) {
      const previous = canonical[i - 1];
      const current = canonical[i];
      if (!previous || !current || current.prevHash !== previous.hash || current.height !== previous.height + 1) {
        return [{ id: 'INV-CANONICAL-001', message: 'canonical chain has a broken parent or height transition' }];
      }
    }
    return [];
  }

  private _verifyCanonicalIndex(): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    for (const height in this._canonicalHeightToHash) {
      const hash = this._canonicalHeightToHash[height];
      if (!hash) continue;
      const block = this._tree.getBlock(hash);
      if (!block || block.height !== Number(height) || !this._tree.isBlockOnCanonicalChain(hash)) {
        violations.push({ id: 'INV-CANONICAL-002', message: 'canonical height index points outside the active chain' });
      }
    }
    return violations;
  }

  private _verifyTransactionIndex(): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    for (const txid in this._txToBlockMap) {
      const location = this._txToBlockMap[txid];
      const block = location ? this._tree.getBlock(location.blockHash) : null;
      if (!location || !block || !this._tree.isBlockOnCanonicalChain(location.blockHash) || !block.txids.includes(txid)) {
        violations.push({ id: 'INV-TX-001', message: `transaction index is invalid for '${txid}'` });
      }
    }
    return violations;
  }

  private _verifySubscriptions(): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    for (const sid in this._subscriptions) {
      const sub = this._subscriptions[sid];
      const ids = sub ? this._txToSubs[sub.txid] : undefined;
      if (!sub || !ids || ids.filter((id) => id === sid).length !== 1) {
        violations.push({ id: 'INV-SUB-001', message: `subscription index is invalid for '${sid}'` });
        continue;
      }
      const location = this._txToBlockMap[sub.txid];
      if (sub.isAlerted) {
        const confirmations = location ? this._tree.getCanonicalConfirmations(location.blockHash) : 0;
        if (!location || confirmations < sub.threshold || sub.lastAlertedHeight !== location.height) {
          violations.push({ id: 'INV-ALERT-001', message: `alerted subscription '${sid}' is below its threshold` });
        }
      } else if (sub.lastAlertedHeight !== -1) {
        violations.push({ id: 'INV-ALERT-002', message: `unalerted subscription '${sid}' has an alert height` });
      }
    }
    return violations;
  }

  private _verifyCounters(): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    if (this._totalAlertsEmitted < 0n || this._eventSequence < this._totalAlertsEmitted || this._lastProcessedMs < 0n) {
      violations.push({ id: 'INV-COUNTERS-001', message: 'event counters or temporal cursor are invalid' });
    }
    if (this._tree.orphanCount > this._maxOrphanDepth) {
      violations.push({ id: 'INV-ORPHAN-001', message: 'orphan retention exceeds maxOrphanDepth' });
    }
    return violations;
  }

  verifyInvariants(): InvariantReport {
    const canonical = this._tree.getCanonicalChain();
    const violations = [
      ...this._verifyTip(canonical),
      ...this._verifyCanonicalChain(canonical),
      ...this._verifyCanonicalIndex(),
      ...this._verifyTransactionIndex(),
      ...this._verifySubscriptions(),
      ...this._verifyCounters()
    ];
    return { valid: violations.length === 0, violations };
  }

  private _assertInvariants(): void {
    const report = this.verifyInvariants();
    if (!report.valid) throw new Error(report.violations.map((violation) => `${violation.id}: ${violation.message}`).join('; '));
  }
}
