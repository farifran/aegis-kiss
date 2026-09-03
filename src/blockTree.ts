export interface BlockHeader {
  readonly hash: string;
  readonly prevHash: string;
  readonly height: number;
  readonly txids: readonly string[];
  readonly timestampMs: bigint;
}

export interface ReorgResult {
  readonly isReorg: boolean;
  readonly commonAncestorHash: string | null;
  readonly disconnected: readonly BlockHeader[];
  readonly connected: readonly BlockHeader[];
  readonly activeTip: BlockHeader;
}

export class BlockTree {
  private readonly _blocks: Record<string, BlockHeader>;
  private _tipHash: string | null;
  private _tipHeight: number;
  private readonly _maxOrphanDepth: number;
  private _hasOrphans: boolean;

  constructor(maxOrphanDepth: number = 100) {
    if (maxOrphanDepth <= 0) throw new RangeError('maxOrphanDepth must be positive');
    this._blocks = Object.create(null) as Record<string, BlockHeader>;
    this._tipHash = null;
    this._tipHeight = -1;
    this._maxOrphanDepth = maxOrphanDepth;
    this._hasOrphans = false;
  }

  get tipHash(): string | null { return this._tipHash; }
  get tipHeight(): number { return this._tipHeight; }
  get blockCount(): number { return Object.keys(this._blocks).length; }

  get orphanCount(): number {
    let count = 0;
    for (const hash in this._blocks) {
      if (!this.isBlockOnCanonicalChain(hash)) count += 1;
    }
    return count;
  }

  getBlock(hash: string): BlockHeader | null {
    const b = this._blocks[hash];
    return b !== undefined ? b : null;
  }

  hasBlock(hash: string): boolean {
    return this._blocks[hash] !== undefined;
  }

  private _isBetterTip(height: number, hash: string): boolean {
    if (this._tipHash === null) return true;
    if (height > this._tipHeight) return true;
    if (height === this._tipHeight && hash < this._tipHash) return true;
    return false;
  }

  private _getAncestorsChain(startHash: string, stopHash: string | null): BlockHeader[] {
    const chain: BlockHeader[] = [];
    let curr: string | null = startHash;
    while (curr !== null && curr !== stopHash) {
      const b: BlockHeader | undefined = this._blocks[curr];
      if (!b) break;
      chain.push(b);
      curr = b.prevHash === '' ? null : b.prevHash;
    }
    return chain;
  }

  private _findCommonAncestor(hashA: string, hashB: string): string | null {
    const setA: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    let currA: string | null = hashA;
    while (currA !== null) {
      setA[currA] = true;
      const b: BlockHeader | undefined = this._blocks[currA];
      if (!b || b.prevHash === '') break;
      currA = b.prevHash;
    }

    let currB: string | null = hashB;
    while (currB !== null) {
      if (setA[currB]) return currB;
      const b: BlockHeader | undefined = this._blocks[currB];
      if (!b || b.prevHash === '') break;
      currB = b.prevHash;
    }
    return null;
  }

  private _validateBlockTransactions(block: BlockHeader): void {
    if (!Array.isArray(block.txids)) throw new TypeError('block txids must be an array');
    for (let i = 0; i < block.txids.length; i++) {
      const txid = block.txids[i];
      if (!txid || txid.trim() === '') throw new TypeError('block txids cannot contain empty values');
    }
  }

  private _validateBlockParent(block: BlockHeader): void {
    if (block.prevHash === block.hash) throw new Error('block cannot reference itself');
    if (block.prevHash === '') return;
    const parent = this._blocks[block.prevHash];
    if (!parent) throw new Error(`parent block '${block.prevHash}' not found in tree`);
    if (block.height !== parent.height + 1) throw new Error('block height must immediately follow its parent');
  }

  private _validateNewBlock(block: BlockHeader): void {
    if (!block.hash || block.hash.trim() === '') throw new TypeError('block hash cannot be empty');
    if (block.height < 0) throw new RangeError('block height must be non-negative');
    if (block.timestampMs < 0n) throw new RangeError('block timestamp must be non-negative');
    this._validateBlockTransactions(block);
    if (this._blocks[block.hash] !== undefined) {
      throw new Error(`block '${block.hash}' already exists`);
    }
    this._validateBlockParent(block);
  }

  private _computeReorg(prevTipHash: string, newBlock: BlockHeader): ReorgResult {
    const commonAncestor = this._findCommonAncestor(prevTipHash, newBlock.hash);
    const disconnected = this._getAncestorsChain(prevTipHash, commonAncestor);
    const connectedReversed = this._getAncestorsChain(newBlock.hash, commonAncestor);
    const connected = connectedReversed.reverse();

    if (this._hasOrphans) this._pruneOldOrphans();

    return {
      isReorg: true,
      commonAncestorHash: commonAncestor,
      disconnected,
      connected,
      activeTip: newBlock
    };
  }

  addBlock(block: BlockHeader): ReorgResult {
    this._validateNewBlock(block);
    this._blocks[block.hash] = block;

    if (!this._isBetterTip(block.height, block.hash)) {
      const activeTip = this._tipHash ? this._blocks[this._tipHash] : block;
      this._hasOrphans = true;
      this._pruneOldOrphans();
      return {
        isReorg: false,
        commonAncestorHash: null,
        disconnected: [],
        connected: [],
        activeTip: activeTip !== undefined && activeTip !== null ? activeTip : block
      };
    }

    const prevTipHash = this._tipHash;
    this._tipHash = block.hash;
    this._tipHeight = block.height;

    if (prevTipHash === null || block.prevHash === prevTipHash) {
      if (this._hasOrphans) this._pruneOldOrphans();
      return {
        isReorg: false,
        commonAncestorHash: prevTipHash,
        disconnected: [],
        connected: [block],
        activeTip: block
      };
    }

    return this._computeReorg(prevTipHash, block);
  }

  isBlockOnCanonicalChain(blockHash: string): boolean {
    if (this._tipHash === null) return false;
    let curr: string | null = this._tipHash;
    while (curr !== null) {
      if (curr === blockHash) return true;
      const b: BlockHeader | undefined = this._blocks[curr];
      if (!b || b.prevHash === '') break;
      curr = b.prevHash;
    }
    return false;
  }

  getCanonicalConfirmations(blockHash: string): number {
    const b = this._blocks[blockHash];
    if (!b || !this.isBlockOnCanonicalChain(blockHash)) return 0;
    return this._tipHeight - b.height + 1;
  }

  getCanonicalChain(): readonly BlockHeader[] {
    if (this._tipHash === null) return [];
    return this._getAncestorsChain(this._tipHash, null).reverse();
  }

  private _pruneOldOrphans(): void {
    if (!this._hasOrphans) return;
    const minRetainHeight = this._tipHeight - this._maxOrphanDepth;
    const orphanHashes: string[] = [];
    for (const hash in this._blocks) {
      const b = this._blocks[hash];
      if (b && b.height < minRetainHeight && !this.isBlockOnCanonicalChain(hash)) {
        orphanHashes.push(hash);
      }
    }
    orphanHashes.sort((a, b) => this._compareBlockHashes(a, b));

    const allOrphanHashes: string[] = [];
    for (const hash in this._blocks) {
      if (!this.isBlockOnCanonicalChain(hash)) allOrphanHashes.push(hash);
    }
    allOrphanHashes.sort((a, b) => this._compareBlockHashes(a, b));

    const retainedOrphanCount = Math.max(0, this._maxOrphanDepth - orphanHashes.length);
    const overflowCount = Math.max(0, allOrphanHashes.length - retainedOrphanCount);
    for (let i = 0; i < overflowCount; i++) {
      const hash = allOrphanHashes[i];
      if (hash !== undefined) delete this._blocks[hash];
    }
    this._hasOrphans = allOrphanHashes.length > overflowCount;
  }

  private _compareBlockHashes(leftHash: string, rightHash: string): number {
    const left = this._blocks[leftHash];
    const right = this._blocks[rightHash];
    if (!left || !right) {
      if (leftHash < rightHash) return -1;
      return leftHash > rightHash ? 1 : 0;
    }
    if (left.height !== right.height) return left.height - right.height;
    if (leftHash < rightHash) return -1;
    return leftHash > rightHash ? 1 : 0;
  }

  snapshot(): { readonly blocks: Record<string, BlockHeader>; readonly tipHash: string | null; readonly tipHeight: number } {
    const blocks: Record<string, BlockHeader> = Object.create(null) as Record<string, BlockHeader>;
    for (const k in this._blocks) {
      const b = this._blocks[k];
      if (b) blocks[k] = { ...b };
    }
    return {
      blocks,
      tipHash: this._tipHash,
      tipHeight: this._tipHeight
    };
  }

  restore(snap: { readonly blocks: Record<string, BlockHeader>; readonly tipHash: string | null; readonly tipHeight: number }): void {
    for (const k in this._blocks) delete this._blocks[k];
    for (const k in snap.blocks) {
      const b = snap.blocks[k];
      if (b) this._blocks[k] = { ...b };
    }
    this._tipHash = snap.tipHash;
    this._tipHeight = snap.tipHeight;
    this._hasOrphans = false;
    for (const hash in this._blocks) {
      if (!this.isBlockOnCanonicalChain(hash)) {
        this._hasOrphans = true;
        break;
      }
    }
  }
}
