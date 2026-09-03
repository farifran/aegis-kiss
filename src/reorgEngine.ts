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

interface InternalSubscription extends SubscriptionState {
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
  readonly subscriptions: Record<string, SubscriptionState>;
  readonly txToBlockMap: Record<string, { readonly blockHash: string; readonly height: number }>;
  readonly canonicalHeightToHash: Record<number, string>;
  readonly totalAlertsEmitted: bigint;
  readonly lastProcessedMs: bigint;
  readonly eventSequence: bigint;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a(hash: bigint, value: bigint): bigint {
  return ((hash ^ (value & 0xFFFFFFFFFFFFFFFFn)) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
}

function stringToHash(hash: bigint, value: string): bigint {
  let result = hash;
  for (let i = 0; i < value.length; i++) result = fnv1a(result, BigInt(value.charCodeAt(i)));
  return result;
}

function cloneBlock(block: BlockHeader): BlockHeader {
  return { ...block, txids: [...block.txids] };
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
  return typeof hash === 'string' && hash.trim() !== ''
    && typeof prevHash === 'string'
    && typeof height === 'number' && Number.isInteger(height) && height >= 0
    && typeof timestampMs === 'bigint' && timestampMs >= 0n
    && Array.isArray(txids) && txids.every((txid) => typeof txid === 'string' && txid.trim() !== '');
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
  private readonly _targetHeightToSubs: Record<number, string[]>;
  private readonly _pendingBlocks: PendingBlock[];
  private _totalAlertsEmitted: bigint;
  private _lastProcessedMs: bigint;
  private _eventSequence: bigint;

  constructor(maxOrphanDepth: number = 100, options: ReorgEngineOptions = {}) {
    if (!Number.isInteger(maxOrphanDepth) || maxOrphanDepth <= 0) throw new RangeError('maxOrphanDepth must be a positive integer');
    const maxPendingBlocks = options.maxPendingBlocks ?? 4096;
    if (!Number.isInteger(maxPendingBlocks) || maxPendingBlocks <= 0) throw new RangeError('maxPendingBlocks must be a positive integer');
    this._tree = new BlockTree(maxOrphanDepth);
    this._maxOrphanDepth = maxOrphanDepth;
    this._maxPendingBlocks = maxPendingBlocks;
    this._journal = options.journalPath ? new FileStateWal(options.journalPath) : null;
    this._subscriptions = Object.create(null) as Record<string, InternalSubscription>;
    this._txToSubs = Object.create(null) as Record<string, string[]>;
    this._txToBlockMap = Object.create(null) as Record<string, { readonly blockHash: string; readonly height: number }>;
    this._blockHashToSubs = Object.create(null) as Record<string, string[]>;
    this._canonicalHeightToHash = Object.create(null) as Record<number, string>;
    this._targetHeightToSubs = Object.create(null) as Record<number, string[]>;
    this._pendingBlocks = [];
    this._totalAlertsEmitted = 0n;
    this._lastProcessedMs = 0n;
    this._eventSequence = 0n;
    const recovered = this._journal?.readLatest();
    if (recovered) {
      this._restoreState(recovered);
      this._assertInvariants();
    }
  }

  get tipHash(): string | null { return this._tree.tipHash; }
  get tipHeight(): number { return this._tree.tipHeight; }
  get subscriptionCount(): number { return Object.keys(this._subscriptions).length; }
  get totalAlertsEmitted(): bigint { return this._totalAlertsEmitted; }
  get lastProcessedMs(): bigint { return this._lastProcessedMs; }
  get pendingCount(): number { return this._pendingBlocks.length; }
  get maxPendingBlocks(): number { return this._maxPendingBlocks; }
  get orphanCount(): number { return this._tree.orphanCount; }

  private _clearMap<T>(map: Record<string, T>): void {
    for (const key in map) delete map[key];
  }

  private _validateSubParams(subscriptionId: string, txid: string, userId: string, threshold: number): void {
    if (!subscriptionId || subscriptionId.trim() === '') throw new TypeError('subscriptionId must be a non-empty string');
    if (!txid || txid.trim() === '') throw new TypeError('txid must be a non-empty string');
    if (!userId || userId.trim() === '') throw new TypeError('userId must be a non-empty string');
    if (!Number.isInteger(threshold) || threshold <= 0) throw new RangeError('threshold must be a positive integer');
    if (this._subscriptions[subscriptionId]) throw new Error(`subscription '${subscriptionId}' already exists`);
  }

  private _applySubscribe(subscriptionId: string, txid: string, userId: string, threshold: number): void {
    this._validateSubParams(subscriptionId, txid, userId, threshold);
    this._subscriptions[subscriptionId] = { subscriptionId, txid, userId, threshold, isAlerted: false, lastAlertedHeight: -1 };
    this._rebuildIndexes();
  }

  subscribe(subscriptionId: string, txid: string, userId: string, threshold: number = 4): void {
    const projection = this._projection();
    projection._applySubscribe(subscriptionId, txid, userId, threshold);
    projection._assertInvariants();
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
    projection._assertInvariants();
    this._commitProjection(projection, this.snapshot());
    return true;
  }

  getSubscription(subscriptionId: string): SubscriptionState | null {
    const sub = this._subscriptions[subscriptionId];
    return sub ? { ...sub } : null;
  }

  private _nextEventId(): string {
    this._eventSequence += 1n;
    return `evt_${this._eventSequence}`;
  }

  private _rebuildIndexes(): void {
    this._clearMap(this._txToSubs);
    this._clearMap(this._txToBlockMap);
    this._clearMap(this._blockHashToSubs);
    this._clearMap(this._canonicalHeightToHash);
    this._clearMap(this._targetHeightToSubs);

    this._rebuildSubscriptionIndex();
    this._rebuildCanonicalIndexes();
    this._rebuildTargetIndex();
  }

  private _rebuildSubscriptionIndex(): void {
    for (const subscriptionId of Object.keys(this._subscriptions).sort()) {
      const sub = this._subscriptions[subscriptionId];
      if (!sub) continue;
      const ids = this._txToSubs[sub.txid] ?? [];
      ids.push(subscriptionId);
      this._txToSubs[sub.txid] = ids;
    }
  }

  private _rebuildCanonicalIndexes(): void {
    for (const block of this._tree.getCanonicalChain()) {
      this._canonicalHeightToHash[block.height] = block.hash;
      for (const txid of block.txids) {
        if (this._txToBlockMap[txid]) throw new Error(`transaction '${txid}' appears twice on canonical chain`);
        this._txToBlockMap[txid] = { blockHash: block.hash, height: block.height };
        const matching = this._txToSubs[txid];
        if (matching && matching.length > 0) this._blockHashToSubs[block.hash] = [...matching];
      }
    }
  }

  private _rebuildTargetIndex(): void {
    this._clearMap(this._targetHeightToSubs);
    for (const subscriptionId of Object.keys(this._subscriptions).sort()) {
      const sub = this._subscriptions[subscriptionId];
      const location = sub ? this._txToBlockMap[sub.txid] : undefined;
      if (!sub || sub.isAlerted || !location) continue;
      const targetHeight = location.height + sub.threshold - 1;
      const targets = this._targetHeightToSubs[targetHeight] ?? [];
      targets.push(subscriptionId);
      this._targetHeightToSubs[targetHeight] = targets;
    }
  }

  private _indexCanonicalBlock(block: BlockHeader): void {
    this._canonicalHeightToHash[block.height] = block.hash;
    for (const txid of block.txids) {
      const previous = this._txToBlockMap[txid];
      if (previous && previous.blockHash !== block.hash) throw new Error(`transaction '${txid}' appears twice on canonical chain`);
      this._txToBlockMap[txid] = { blockHash: block.hash, height: block.height };
      const matching = this._txToSubs[txid];
      if (!matching || matching.length === 0) continue;
      this._blockHashToSubs[block.hash] = [...matching];
      for (const subscriptionId of matching) {
        const sub = this._subscriptions[subscriptionId];
        if (!sub || sub.isAlerted) continue;
        const targetHeight = block.height + sub.threshold - 1;
        const targets = this._targetHeightToSubs[targetHeight] ?? [];
        if (!targets.includes(subscriptionId)) targets.push(subscriptionId);
        this._targetHeightToSubs[targetHeight] = targets;
      }
    }
  }

  private _removeCanonicalBlock(block: BlockHeader): void {
    if (this._canonicalHeightToHash[block.height] === block.hash) delete this._canonicalHeightToHash[block.height];
    delete this._blockHashToSubs[block.hash];
    for (const txid of block.txids) {
      const location = this._txToBlockMap[txid];
      if (location?.blockHash === block.hash) delete this._txToBlockMap[txid];
    }
  }

  private _preflightBlock(block: BlockHeader): void {
    if (!isValidBlockInput(block)) throw new TypeError('invalid block input');
    if (this._tree.hasBlock(block.hash)) throw new Error(`block '${block.hash}' already exists`);
    if (block.prevHash !== '') {
      const parent = this._tree.getBlock(block.prevHash);
      if (!parent) throw new Error(`parent block '${block.prevHash}' not found in tree`);
      if (block.height !== parent.height + 1) throw new Error('block height must immediately follow its parent');
    }
    const seen: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    for (const txid of block.txids) {
      if (seen[txid]) throw new Error(`transaction '${txid}' is duplicated in block`);
      seen[txid] = true;
    }
  }

  private _handleDisconnectedBlock(block: BlockHeader, alerts: AlertEvent[], nowMs: bigint): void {
    const subIds = this._blockHashToSubs[block.hash];
    if (!subIds) return;
    for (const subscriptionId of subIds) {
      const sub = this._subscriptions[subscriptionId];
      if (!sub || !sub.isAlerted) continue;
      alerts.push({ eventId: this._nextEventId(), type: 'REORG_REVOKED', subscriptionId: sub.subscriptionId, txid: sub.txid, userId: sub.userId, blockHash: block.hash, blockHeight: block.height, currentConfirmations: 0, threshold: sub.threshold, timestampMs: nowMs });
      sub.isAlerted = false;
      sub.lastAlertedHeight = -1;
      this._totalAlertsEmitted += 1n;
    }
  }

  private _evaluateCanonicalConfirmations(candidateIds: readonly string[], alerts: AlertEvent[], nowMs: bigint): void {
    const unique: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    for (const subscriptionId of candidateIds) {
      if (unique[subscriptionId]) continue;
      unique[subscriptionId] = true;
      const sub = this._subscriptions[subscriptionId];
      const location = sub ? this._txToBlockMap[sub.txid] : undefined;
      if (!sub || sub.isAlerted || !location) continue;
      const confirmations = this._tree.getCanonicalConfirmations(location.blockHash);
      if (confirmations < sub.threshold) continue;
      alerts.push({ eventId: this._nextEventId(), type: 'CONFIRMED', subscriptionId: sub.subscriptionId, txid: sub.txid, userId: sub.userId, blockHash: location.blockHash, blockHeight: location.height, currentConfirmations: confirmations, threshold: sub.threshold, timestampMs: nowMs });
      sub.isAlerted = true;
      sub.lastAlertedHeight = location.height;
      this._totalAlertsEmitted += 1n;
    }
  }

  private _applyBlock(block: BlockHeader, nowMs: bigint): EngineBlockResult {
    const reorgResult = this._tree.addBlock(block);
    const alerts: AlertEvent[] = [];
    if (reorgResult.isReorg) {
      for (const disconnected of reorgResult.disconnected) {
        this._handleDisconnectedBlock(disconnected, alerts, nowMs);
        this._removeCanonicalBlock(disconnected);
      }
      for (const connected of reorgResult.connected) this._indexCanonicalBlock(connected);
      this._rebuildTargetIndex();
    } else {
      for (const connected of reorgResult.connected) this._indexCanonicalBlock(connected);
    }
    const candidates: string[] = [];
    if (reorgResult.isReorg) {
      candidates.push(...Object.keys(this._subscriptions).sort());
    } else {
      for (const connected of reorgResult.connected) {
        for (const txid of connected.txids) {
          const ids = this._txToSubs[txid];
          if (ids) candidates.push(...ids);
        }
      }
      const due = this._targetHeightToSubs[this._tree.tipHeight];
      if (due) candidates.push(...due);
    }
    this._evaluateCanonicalConfirmations(candidates, alerts, nowMs);
    return { blockHash: block.hash, blockHeight: block.height, isReorg: reorgResult.isReorg, reorgDetails: reorgResult, alerts };
  }

  processBlock(block: BlockHeader, nowMs: bigint): EngineBlockResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    if (nowMs < this._lastProcessedMs) throw new RangeError('time moved backwards');
    const before = this.snapshot();
    const projection = this._projection();
    projection._preflightBlock(block);
    const result = projection._applyBlock(cloneBlock(block), nowMs);
    projection._lastProcessedMs = nowMs;
    projection._assertInvariants();
    this._commitProjection(projection, before);
    return result;
  }

  processBatch(blocks: readonly BlockHeader[], nowMs: bigint): EngineBatchResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    const before = this.snapshot();
    if (nowMs < this._lastProcessedMs) return this._buildAbortResult(blocks, nowMs, 0);
    const admittedCount = Math.min(blocks.length, this._maxPendingBlocks);
    const blockedCapacityCount = blocks.length - admittedCount;
    const projection = this._projection();
    const blockResults: EngineBlockResult[] = [];
    let committedCount = 0;
    let rejectedCount = 0;
    let totalAlerts = 0;

    for (let i = 0; i < admittedCount; i++) {
      const block = blocks[i];
      if (!block || !isValidBlockInput(block)) {
        rejectedCount += 1;
        continue;
      }
      try {
        projection._preflightBlock(block);
      } catch {
        rejectedCount += 1;
        continue;
      }
      const result = projection._applyBlock(cloneBlock(block), nowMs);
      committedCount += 1;
      totalAlerts += result.alerts.length;
      blockResults.push(result);
    }

    if (committedCount > 0) projection._lastProcessedMs = nowMs;
    projection._assertInvariants();
    const digest = projection._computeDigest(nowMs, blockResults, blocks, false);
    if (committedCount > 0) this._commitProjection(projection, before);
    return { processedCount: blocks.length, committedCount, rejectedCount, blockedCapacityCount, abortedCount: 0, totalAlerts, executionDigest: digest, blockResults };
  }

  private _buildAbortResult(blocks: readonly BlockHeader[], nowMs: bigint, blockedCapacityCount: number): EngineBatchResult {
    return { processedCount: blocks.length, committedCount: 0, rejectedCount: 0, blockedCapacityCount, abortedCount: blocks.length - blockedCapacityCount, totalAlerts: 0, executionDigest: this._computeDigest(nowMs, [], blocks, true), blockResults: [] };
  }

  enqueueBlocks(blocks: readonly BlockHeader[], nowMs: bigint): BlockAdmissionResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    if (nowMs < this._lastProcessedMs) throw new RangeError('time moved backwards');
    let acceptedCount = 0;
    let rejectedInvalidCount = 0;
    let blockedCapacityCount = 0;
    for (const block of blocks) {
      if (!isValidBlockInput(block)) rejectedInvalidCount += 1;
      else if (this._pendingBlocks.length < this._maxPendingBlocks) {
        this._pendingBlocks.push({ block: cloneBlock(block), nowMs });
        acceptedCount += 1;
      } else blockedCapacityCount += 1;
    }
    return { acceptedCount, rejectedInvalidCount, blockedCapacityCount, pendingCount: this._pendingBlocks.length };
  }

  drainPending(): EngineBatchResult {
    if (this._pendingBlocks.length === 0) return { processedCount: 0, committedCount: 0, rejectedCount: 0, blockedCapacityCount: 0, abortedCount: 0, totalAlerts: 0, executionDigest: this._computeDigest(this._lastProcessedMs, [], [], false), blockResults: [] };
    const pending = [...this._pendingBlocks];
    const nowMs = pending[pending.length - 1]?.nowMs ?? this._lastProcessedMs;
    const result = this.processBatch(pending.map((item) => item.block), nowMs);
    if (result.abortedCount === 0) this._pendingBlocks.splice(0, result.committedCount + result.rejectedCount);
    return result;
  }

  private _computeDigest(nowMs: bigint, results: readonly EngineBlockResult[], blocks: readonly BlockHeader[], rolledBack: boolean): bigint {
    let hash = FNV_OFFSET;
    hash = fnv1a(hash, nowMs);
    hash = fnv1a(hash, this._lastProcessedMs);
    hash = fnv1a(hash, this._totalAlertsEmitted);
    hash = fnv1a(hash, BigInt(this._tree.tipHeight));
    hash = fnv1a(hash, rolledBack ? 1n : 0n);
    if (this._tree.tipHash) hash = stringToHash(hash, this._tree.tipHash);
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) continue;
      hash = fnv1a(hash, BigInt(i));
      hash = stringToHash(hash, block.hash);
      hash = stringToHash(hash, block.prevHash);
      hash = fnv1a(hash, BigInt(block.height));
    }
    for (const result of results) {
      hash = stringToHash(hash, result.blockHash);
      hash = fnv1a(hash, BigInt(result.alerts.length));
    }
    for (const subscriptionId of Object.keys(this._subscriptions).sort()) {
      const sub = this._subscriptions[subscriptionId];
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
    for (const subscriptionId in this._subscriptions) {
      const sub = this._subscriptions[subscriptionId];
      if (sub) subscriptions[subscriptionId] = { ...sub };
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
    return { treeSnapshot: this._tree.snapshot(), subscriptions, txToBlockMap, canonicalHeightToHash, totalAlertsEmitted: this._totalAlertsEmitted, lastProcessedMs: this._lastProcessedMs, eventSequence: this._eventSequence };
  }

  private _restoreState(snapshot: EngineSnapshot): void {
    this._tree.restore(snapshot.treeSnapshot);
    this._clearMap(this._subscriptions);
    for (const subscriptionId in snapshot.subscriptions) {
      const sub = snapshot.subscriptions[subscriptionId];
      if (sub) this._subscriptions[subscriptionId] = { ...sub };
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
    this._commitProjection(projection, before);
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

  private _verifyCanonicalShape(canonical: readonly BlockHeader[]): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    const tip = canonical[canonical.length - 1];
    if ((tip?.hash ?? null) !== this._tree.tipHash || (tip?.height ?? -1) !== this._tree.tipHeight) violations.push({ id: 'INV-TIP-001', message: 'tip does not match canonical chain' });
    for (let i = 1; i < canonical.length; i++) {
      const previous = canonical[i - 1];
      const current = canonical[i];
      if (!previous || !current || current.prevHash !== previous.hash || current.height !== previous.height + 1) violations.push({ id: 'INV-CANONICAL-001', message: 'canonical chain has a broken parent or height transition' });
    }
    return violations;
  }

  private _verifyCanonicalIndexes(canonical: readonly BlockHeader[]): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    const canonicalHashes: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    for (const block of canonical) canonicalHashes[block.hash] = true;
    for (const block of canonical) {
      if (this._canonicalHeightToHash[block.height] !== block.hash) violations.push({ id: 'INV-CANONICAL-002', message: `canonical height index is wrong at ${block.height}` });
    }
    for (const height in this._canonicalHeightToHash) {
      const hash = this._canonicalHeightToHash[height];
      const block = hash ? this._tree.getBlock(hash) : null;
      if (!block || block.height !== Number(height) || !hash || !canonicalHashes[hash]) violations.push({ id: 'INV-CANONICAL-003', message: `canonical index points outside the active chain at ${height}` });
    }
    return violations;
  }

  private _verifyCanonical(): InvariantViolation[] {
    const canonical = this._tree.getCanonicalChain();
    return [...this._verifyCanonicalShape(canonical), ...this._verifyCanonicalIndexes(canonical)];
  }

  private _verifyTransactions(): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    const expected: Record<string, { readonly blockHash: string; readonly height: number }> = Object.create(null) as Record<string, { readonly blockHash: string; readonly height: number }>;
    for (const block of this._tree.getCanonicalChain()) {
      for (const txid of block.txids) {
        if (expected[txid]) violations.push({ id: 'INV-TX-001', message: `transaction '${txid}' appears twice on canonical chain` });
        expected[txid] = { blockHash: block.hash, height: block.height };
      }
    }
    for (const txid of Object.keys(expected)) {
      const actual = this._txToBlockMap[txid];
      if (!actual || actual.blockHash !== expected[txid]?.blockHash || actual.height !== expected[txid]?.height) violations.push({ id: 'INV-TX-002', message: `transaction index is missing '${txid}'` });
    }
    for (const txid in this._txToBlockMap) {
      if (!expected[txid]) violations.push({ id: 'INV-TX-003', message: `transaction index contains non-canonical '${txid}'` });
    }
    return violations;
  }

  private _verifySubscription(subscriptionId: string, sub: InternalSubscription): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    const indexed = this._txToSubs[sub.txid];
    if (!indexed || indexed.filter((id) => id === subscriptionId).length !== 1) violations.push({ id: 'INV-SUB-001', message: `subscription index is invalid for '${subscriptionId}'` });
    const location = this._txToBlockMap[sub.txid];
    const confirmations = location ? this._tree.getCanonicalConfirmations(location.blockHash) : 0;
    if (sub.isAlerted && (!location || confirmations < sub.threshold || sub.lastAlertedHeight !== location.height)) violations.push({ id: 'INV-ALERT-001', message: `alerted subscription '${subscriptionId}' is below its threshold` });
    if (!sub.isAlerted && sub.lastAlertedHeight !== -1) violations.push({ id: 'INV-ALERT-002', message: `unalerted subscription '${subscriptionId}' has an alert height` });
    return violations;
  }

  private _verifySubscriptions(): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    for (const subscriptionId in this._subscriptions) {
      const sub = this._subscriptions[subscriptionId];
      if (sub) violations.push(...this._verifySubscription(subscriptionId, sub));
    }
    return violations;
  }

  verifyInvariants(): InvariantReport {
    const violations = [...this._verifyCanonical(), ...this._verifyTransactions(), ...this._verifySubscriptions()];
    if (this._tree.orphanCount > this._tree.blockCount) violations.push({ id: 'INV-ORPHAN-001', message: 'orphan count exceeds tree size' });
    if (this._tree.orphanCount > this._maxOrphanDepth) violations.push({ id: 'INV-ORPHAN-002', message: 'orphan retention exceeds maxOrphanDepth' });
    if (this._pendingBlocks.length > this._maxPendingBlocks) violations.push({ id: 'INV-CAPACITY-001', message: 'pending blocks exceed configured capacity' });
    if (this._lastProcessedMs < 0n || this._totalAlertsEmitted < 0n || this._eventSequence < this._totalAlertsEmitted) violations.push({ id: 'INV-COUNTERS-001', message: 'event counters or temporal cursor are invalid' });
    return { valid: violations.length === 0, violations };
  }

  private _assertInvariants(): void {
    const report = this.verifyInvariants();
    if (!report.valid) throw new Error(report.violations.map((violation) => `${violation.id}: ${violation.message}`).join('; '));
  }
}
