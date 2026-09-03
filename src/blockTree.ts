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

  constructor(maxOrphanDepth: number = 100) {
    if (maxOrphanDepth <= 0) throw new RangeError('maxOrphanDepth must be positive');
    this._blocks = Object.create(null) as Record<string, BlockHeader>;
    this._tipHash = null;
    this._tipHeight = -1;
    this._maxOrphanDepth = maxOrphanDepth;
  }

  get tipHash(): string | null { return this._tipHash; }
  get tipHeight(): number { return this._tipHeight; }
  get blockCount(): number { return Object.keys(this._blocks).length; }

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

  private _validateNewBlock(block: BlockHeader): void {
    if (!block.hash || block.hash.trim() === '') throw new TypeError('block hash cannot be empty');
    if (block.height < 0) throw new RangeError('block height must be non-negative');
    if (this._blocks[block.hash] !== undefined) {
      throw new Error(`block '${block.hash}' already exists`);
    }
    if (block.height > 0 && block.prevHash !== '' && !this._blocks[block.prevHash]) {
      throw new Error(`parent block '${block.prevHash}' not found in tree`);
    }
  }

  private _computeReorg(prevTipHash: string, newBlock: BlockHeader): ReorgResult {
    const commonAncestor = this._findCommonAncestor(prevTipHash, newBlock.hash);
    const disconnected = this._getAncestorsChain(prevTipHash, commonAncestor);
    const connectedReversed = this._getAncestorsChain(newBlock.hash, commonAncestor);
    const connected = connectedReversed.reverse();

    this._pruneOldOrphans();

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
      this._pruneOldOrphans();
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

  private _pruneOldOrphans(): void {
    if (this._tipHeight <= this._maxOrphanDepth) return;
    const minRetainHeight = this._tipHeight - this._maxOrphanDepth;
    for (const hash in this._blocks) {
      const b = this._blocks[hash];
      if (b && b.height < minRetainHeight && !this.isBlockOnCanonicalChain(hash)) {
        delete this._blocks[hash];
      }
    }
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
  }
}
