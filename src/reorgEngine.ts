import { BlockTree, type BlockHeader, type ReorgResult } from './blockTree.js';

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

function stringToHash(hash: bigint, str: string): bigint {
  let h = hash;
  for (let i = 0; i < str.length; i++) {
    const code = BigInt(str.charCodeAt(i));
    h = fnv1a(h, code);
  }
  return h;
}

export class ReorgEngine {
  private readonly _tree: BlockTree;
  private readonly _subscriptions: Record<string, InternalSubscription>;
  private readonly _txToSubs: Record<string, string[]>;
  private readonly _txToBlockMap: Record<string, { readonly blockHash: string; readonly height: number }>;
  private readonly _blockHashToSubs: Record<string, string[]>;
  private readonly _canonicalHeightToHash: Record<number, string>;
  private _totalAlertsEmitted: bigint;
  private _lastProcessedMs: bigint;
  private _eventSequence: bigint;

  constructor(maxOrphanDepth: number = 100) {
    this._tree = new BlockTree(maxOrphanDepth);
    this._subscriptions = Object.create(null) as Record<string, InternalSubscription>;
    this._txToSubs = Object.create(null) as Record<string, string[]>;
    this._txToBlockMap = Object.create(null) as Record<string, { readonly blockHash: string; readonly height: number }>;
    this._blockHashToSubs = Object.create(null) as Record<string, string[]>;
    this._canonicalHeightToHash = Object.create(null) as Record<number, string>;
    this._totalAlertsEmitted = 0n;
    this._lastProcessedMs = 0n;
    this._eventSequence = 0n;
  }

  get tipHash(): string | null { return this._tree.tipHash; }
  get tipHeight(): number { return this._tree.tipHeight; }
  get subscriptionCount(): number { return Object.keys(this._subscriptions).length; }
  get totalAlertsEmitted(): bigint { return this._totalAlertsEmitted; }
  get lastProcessedMs(): bigint { return this._lastProcessedMs; }

  private _validateSubParams(subscriptionId: string, txid: string, userId: string, threshold: number): void {
    if (!subscriptionId || subscriptionId.trim() === '') throw new TypeError('subscriptionId must be a non-empty string');
    if (!txid || txid.trim() === '') throw new TypeError('txid must be a non-empty string');
    if (!userId || userId.trim() === '') throw new TypeError('userId must be a non-empty string');
    if (threshold <= 0) throw new RangeError('threshold must be positive');
    if (this._subscriptions[subscriptionId] !== undefined) {
      throw new Error(`subscription '${subscriptionId}' already exists`);
    }
  }

  subscribe(subscriptionId: string, txid: string, userId: string, threshold: number = 4): void {
    this._validateSubParams(subscriptionId, txid, userId, threshold);

    const sub: InternalSubscription = {
      subscriptionId,
      txid,
      userId,
      threshold,
      isAlerted: false,
      lastAlertedHeight: -1
    };

    this._subscriptions[subscriptionId] = sub;
    const subsArr = this._txToSubs[txid] ?? [];
    subsArr.push(subscriptionId);
    this._txToSubs[txid] = subsArr;

    const loc = this._txToBlockMap[txid];
    if (loc) {
      const bArr = this._blockHashToSubs[loc.blockHash] ?? [];
      bArr.push(subscriptionId);
      this._blockHashToSubs[loc.blockHash] = bArr;
    }
  }

  unsubscribe(subscriptionId: string): boolean {
    const sub = this._subscriptions[subscriptionId];
    if (!sub) return false;

    delete this._subscriptions[subscriptionId];
    const arr = this._txToSubs[sub.txid];
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === subscriptionId) {
          arr.splice(i, 1);
          break;
        }
      }
      if (arr.length === 0) {
        delete this._txToSubs[sub.txid];
      }
    }
    return true;
  }

  getSubscription(subscriptionId: string): SubscriptionState | null {
    const sub = this._subscriptions[subscriptionId];
    if (!sub) return null;
    return {
      subscriptionId: sub.subscriptionId,
      txid: sub.txid,
      userId: sub.userId,
      threshold: sub.threshold,
      isAlerted: sub.isAlerted,
      lastAlertedHeight: sub.lastAlertedHeight
    };
  }

  private _nextEventId(): string {
    this._eventSequence += 1n;
    return `evt_${this._eventSequence}`;
  }

  private _indexBlockTransactions(block: BlockHeader): void {
    const bSubs: string[] = this._blockHashToSubs[block.hash] ?? [];
    for (let i = 0; i < block.txids.length; i++) {
      const tx = block.txids[i];
      if (tx) {
        this._txToBlockMap[tx] = { blockHash: block.hash, height: block.height };
        this._appendMatchingSubs(tx, bSubs);
      }
    }
    this._blockHashToSubs[block.hash] = bSubs;
  }

  private _appendMatchingSubs(tx: string, bSubs: string[]): void {
    const matchingSubs = this._txToSubs[tx];
    if (matchingSubs) {
      for (let j = 0; j < matchingSubs.length; j++) {
        const sid = matchingSubs[j];
        if (sid) bSubs.push(sid);
      }
    }
  }

  private _handleDisconnectedBlock(block: BlockHeader, alerts: AlertEvent[], nowMs: bigint): void {
    delete this._canonicalHeightToHash[block.height];
    const subIds = this._blockHashToSubs[block.hash];
    if (!subIds) return;

    for (let i = 0; i < subIds.length; i++) {
      const sid = subIds[i];
      const sub = sid ? this._subscriptions[sid] : undefined;
      if (sub && sub.isAlerted) {
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
  }

  private _evaluateBlockConfirmations(blockHash: string, alerts: AlertEvent[], nowMs: bigint): void {
    const subIds = this._blockHashToSubs[blockHash];
    if (!subIds) return;

    const confs = this._tree.getCanonicalConfirmations(blockHash);
    for (let i = 0; i < subIds.length; i++) {
      const sid = subIds[i];
      const sub = sid ? this._subscriptions[sid] : undefined;
      if (sub && !sub.isAlerted && confs >= sub.threshold) {
        alerts.push({
          eventId: this._nextEventId(),
          type: 'CONFIRMED',
          subscriptionId: sub.subscriptionId,
          txid: sub.txid,
          userId: sub.userId,
          blockHash,
          blockHeight: this._tree.tipHeight - confs + 1,
          currentConfirmations: confs,
          threshold: sub.threshold,
          timestampMs: nowMs
        });
        sub.isAlerted = true;
        sub.lastAlertedHeight = this._tree.tipHeight - confs + 1;
        this._totalAlertsEmitted += 1n;
      }
    }
  }

  private _updateCanonicalHeightMap(connected: readonly BlockHeader[], alerts: AlertEvent[], nowMs: bigint): void {
    for (let i = 0; i < connected.length; i++) {
      const b = connected[i];
      if (b) {
        this._canonicalHeightToHash[b.height] = b.hash;
      }
    }

    const tipHeight = this._tree.tipHeight;
    for (let h = Math.max(0, tipHeight - 10); h <= tipHeight; h++) {
      const bHash = this._canonicalHeightToHash[h];
      if (bHash) {
        this._evaluateBlockConfirmations(bHash, alerts, nowMs);
      }
    }
  }

  processBlock(block: BlockHeader, nowMs: bigint): EngineBlockResult {
    this._indexBlockTransactions(block);
    const reorgRes = this._tree.addBlock(block);
    const alerts: AlertEvent[] = [];

    if (reorgRes.isReorg) {
      for (let i = 0; i < reorgRes.disconnected.length; i++) {
        const discBlock = reorgRes.disconnected[i];
        if (discBlock) {
          this._handleDisconnectedBlock(discBlock, alerts, nowMs);
        }
      }
    }

    if (reorgRes.connected.length > 0) {
      this._updateCanonicalHeightMap(reorgRes.connected, alerts, nowMs);
    }

    return {
      blockHash: block.hash,
      blockHeight: block.height,
      isReorg: reorgRes.isReorg,
      reorgDetails: reorgRes,
      alerts
    };
  }

  processBatch(blocks: readonly BlockHeader[], nowMs: bigint): EngineBatchResult {
    if (nowMs < 0n) throw new RangeError('nowMs must be non-negative');
    const snapBefore = this.snapshot();

    if (nowMs < this._lastProcessedMs) {
      return this._buildAbortResult(blocks, nowMs, snapBefore, 'time moved backwards');
    }

    const blockResults: EngineBlockResult[] = [];
    let committedCount = 0;
    let rejectedCount = 0;
    let totalAlerts = 0;

    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      if (!blk || !blk.hash || blk.hash.trim() === '') {
        rejectedCount++;
        continue;
      }

      try {
        const res = this.processBlock(blk, nowMs);
        committedCount++;
        totalAlerts += res.alerts.length;
        blockResults.push(res);
      } catch {
        rejectedCount++;
      }
    }

    this._lastProcessedMs = nowMs;
    const digest = this._computeDigest(nowMs, blockResults, blocks, false);

    return {
      processedCount: blocks.length,
      committedCount,
      rejectedCount,
      abortedCount: 0,
      totalAlerts,
      executionDigest: digest,
      blockResults
    };
  }

  private _buildAbortResult(
    blocks: readonly BlockHeader[],
    nowMs: bigint,
    snapBefore: EngineSnapshot,
    _reason: string
  ): EngineBatchResult {
    this.restore(snapBefore);
    const digest = this._computeDigest(nowMs, [], blocks, true);
    return {
      processedCount: blocks.length,
      committedCount: 0,
      rejectedCount: 0,
      abortedCount: blocks.length,
      totalAlerts: 0,
      executionDigest: digest,
      blockResults: []
    };
  }

  private _computeDigest(
    nowMs: bigint,
    results: readonly EngineBlockResult[],
    blocks: readonly BlockHeader[],
    rolledBack: boolean
  ): bigint {
    let h = FNV_OFFSET;
    h = fnv1a(h, nowMs);
    h = fnv1a(h, this._lastProcessedMs);
    h = fnv1a(h, this._totalAlertsEmitted);
    if (this._tree.tipHeight >= 0) {
      h = fnv1a(h, BigInt(this._tree.tipHeight));
    }
    h = fnv1a(h, rolledBack ? 1n : 0n);

    if (this._tree.tipHash) {
      h = stringToHash(h, this._tree.tipHash);
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b) {
        h = fnv1a(h, BigInt(i));
        h = stringToHash(h, b.hash);
        h = stringToHash(h, b.prevHash);
        h = fnv1a(h, BigInt(b.height));
      }
    }

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r) {
        h = stringToHash(h, r.blockHash);
        h = fnv1a(h, BigInt(r.alerts.length));
      }
    }

    const sortedSubs = Object.keys(this._subscriptions).sort();
    for (let i = 0; i < sortedSubs.length; i++) {
      const sid = sortedSubs[i];
      if (sid) {
        const sub = this._subscriptions[sid];
        if (sub) {
          h = stringToHash(h, sub.subscriptionId);
          h = stringToHash(h, sub.txid);
          h = stringToHash(h, sub.userId);
          h = fnv1a(h, BigInt(sub.threshold));
          h = fnv1a(h, sub.isAlerted ? 1n : 0n);
        }
      }
    }

    return h;
  }

  snapshot(): EngineSnapshot {
    const subs: Record<string, { readonly subscriptionId: string; readonly txid: string; readonly userId: string; readonly threshold: number; readonly isAlerted: boolean; readonly lastAlertedHeight: number }> = Object.create(null) as Record<string, { readonly subscriptionId: string; readonly txid: string; readonly userId: string; readonly threshold: number; readonly isAlerted: boolean; readonly lastAlertedHeight: number }>;
    for (const sid in this._subscriptions) {
      const s = this._subscriptions[sid];
      if (s) {
        subs[sid] = {
          subscriptionId: s.subscriptionId,
          txid: s.txid,
          userId: s.userId,
          threshold: s.threshold,
          isAlerted: s.isAlerted,
          lastAlertedHeight: s.lastAlertedHeight
        };
      }
    }

    const txMap: Record<string, { readonly blockHash: string; readonly height: number }> = Object.create(null) as Record<string, { readonly blockHash: string; readonly height: number }>;
    for (const tx in this._txToBlockMap) {
      const item = this._txToBlockMap[tx];
      if (item) {
        txMap[tx] = { blockHash: item.blockHash, height: item.height };
      }
    }

    const heightMap: Record<number, string> = Object.create(null) as Record<number, string>;
    for (const h in this._canonicalHeightToHash) {
      const val = this._canonicalHeightToHash[h];
      if (val) heightMap[h] = val;
    }

    return {
      treeSnapshot: this._tree.snapshot(),
      subscriptions: subs,
      txToBlockMap: txMap,
      canonicalHeightToHash: heightMap,
      totalAlertsEmitted: this._totalAlertsEmitted,
      lastProcessedMs: this._lastProcessedMs,
      eventSequence: this._eventSequence
    };
  }

  private _restoreSubscriptions(snapSubs: Record<string, { readonly subscriptionId: string; readonly txid: string; readonly userId: string; readonly threshold: number; readonly isAlerted: boolean; readonly lastAlertedHeight: number }>): void {
    for (const sid in snapSubs) {
      const s = snapSubs[sid];
      if (s) {
        this._subscriptions[sid] = {
          subscriptionId: s.subscriptionId,
          txid: s.txid,
          userId: s.userId,
          threshold: s.threshold,
          isAlerted: s.isAlerted,
          lastAlertedHeight: s.lastAlertedHeight
        };
        const arr = this._txToSubs[s.txid] ?? [];
        arr.push(s.subscriptionId);
        this._txToSubs[s.txid] = arr;
      }
    }
  }

  private _restoreTxMap(snapTxMap: Record<string, { readonly blockHash: string; readonly height: number }>): void {
    for (const tx in snapTxMap) {
      const item = snapTxMap[tx];
      if (item) {
        this._txToBlockMap[tx] = { blockHash: item.blockHash, height: item.height };
        const bArr = this._blockHashToSubs[item.blockHash] ?? [];
        this._appendMatchingSubs(tx, bArr);
        this._blockHashToSubs[item.blockHash] = bArr;
      }
    }
  }

  restore(snap: EngineSnapshot): void {
    this._tree.restore(snap.treeSnapshot);

    for (const sid in this._subscriptions) delete this._subscriptions[sid];
    for (const tx in this._txToSubs) delete this._txToSubs[tx];
    for (const tx in this._txToBlockMap) delete this._txToBlockMap[tx];
    for (const b in this._blockHashToSubs) delete this._blockHashToSubs[b];
    for (const h in this._canonicalHeightToHash) delete this._canonicalHeightToHash[h];

    this._restoreSubscriptions(snap.subscriptions);
    this._restoreTxMap(snap.txToBlockMap);

    for (const h in snap.canonicalHeightToHash) {
      const val = snap.canonicalHeightToHash[h];
      if (val) this._canonicalHeightToHash[h] = val;
    }

    this._totalAlertsEmitted = snap.totalAlertsEmitted;
    this._lastProcessedMs = snap.lastProcessedMs;
    this._eventSequence = snap.eventSequence;
  }
}
