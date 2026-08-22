export type MempoolEntry = {
  offset: number;
  txId: bigint;
  timestamp: bigint;
  payload: bigint;
  hash: bigint;
};

export type LazyPredicate = (txId: bigint, hash: bigint, termId: bigint) => boolean;

export class EdgeConsensusEngine {
  private _buffer: ArrayBuffer;
  private _view: DataView;
  private _i32View: Int32Array;
  private _mempoolHead: number;
  private _mempoolTail: number;
  private _mempoolCount: number;
  private _ledgerOffset: number;
  private _ledgerCount: number;
  private _maxMempoolBytes: number;
  private _lazyPredicates: LazyPredicate[];

  constructor(totalBytes: number) {
    if (totalBytes < 1024) throw new Error("totalBytes must be at least 1024");
    this._buffer = new ArrayBuffer(totalBytes);
    this._view = new DataView(this._buffer);
    this._i32View = new Int32Array(this._buffer);
    this._maxMempoolBytes = Math.floor(totalBytes / 2);
    this._mempoolHead = 0;
    this._mempoolTail = 0;
    this._mempoolCount = 0;
    this._ledgerOffset = this._maxMempoolBytes;
    this._ledgerCount = 0;
    this._lazyPredicates = [];
  }

  appendMempool(txId: bigint, timestamp: bigint, payload: bigint, hash: bigint): number {
    if (this._mempoolCount * 40 >= this._maxMempoolBytes) return -1;

    const offset = this._mempoolTail;
    this._view.setBigInt64(offset, txId, true);
    this._view.setBigInt64(offset + 8, timestamp, true);
    this._view.setBigInt64(offset + 16, payload, true);
    this._view.setBigInt64(offset + 24, hash, true);

    const lockIndex = (offset + 32) >> 2;
    Atomics.store(this._i32View, lockIndex, 0);
    this._view.setInt32(offset + 36, -1, true);

    this._mempoolTail = (this._mempoolTail + 40) % this._maxMempoolBytes;
    this._mempoolCount++;
    return offset;
  }

  acquireSpinLock(offset: number): boolean {
    if (offset < 0 || offset + 40 > this._maxMempoolBytes) return false;
    const lockIndex = (offset + 32) >> 2;
    return Atomics.compareExchange(this._i32View, lockIndex, 0, 1) === 0;
  }

  releaseSpinLock(offset: number): void {
    if (offset >= 0 && offset + 40 <= this._maxMempoolBytes) {
      const lockIndex = (offset + 32) >> 2;
      Atomics.store(this._i32View, lockIndex, 0);
    }
  }

  addValidationPredicate(predicate: LazyPredicate): void {
    this._lazyPredicates.push(predicate);
  }

  commitConsensusBlock(termId: bigint, minQuorum: number, votes: number): boolean {
    if (votes < minQuorum) return false;
    if (this._mempoolCount === 0) return false;
    if (this._ledgerOffset + 32 > this._buffer.byteLength) return false;

    const txOffset = this._mempoolHead;
    const txId = this._view.getBigInt64(txOffset, true);
    const txHash = this._view.getBigInt64(txOffset + 24, true);

    for (const pred of this._lazyPredicates) {
      if (!pred(txId, txHash, termId)) return false;
    }

    const rootHash = txHash ^ termId ^ BigInt(this._ledgerCount);
    const targetOffset = this._ledgerOffset;
    this._view.setBigInt64(targetOffset, termId, true);
    this._view.setBigInt64(targetOffset + 8, BigInt(this._ledgerCount), true);
    this._view.setBigInt64(targetOffset + 16, txId, true);
    this._view.setBigInt64(targetOffset + 24, rootHash, true);

    this._ledgerOffset += 32;
    this._ledgerCount++;
    this._mempoolHead = (this._mempoolHead + 40) % this._maxMempoolBytes;
    this._mempoolCount--;
    return true;
  }

  get mempoolCount(): number {
    return this._mempoolCount;
  }

  get ledgerLength(): number {
    return this._ledgerCount;
  }

  get bufferByteLength(): number {
    return this._buffer.byteLength;
  }
}
