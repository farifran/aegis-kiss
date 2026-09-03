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

function cloneBlock(block: BlockHeader): BlockHeader {
  return { ...block, txids: [...block.txids] };
}

export class BlockTree {
  private readonly _blocks: Record<string, BlockHeader>;
  private _tipHash: string | null;
  private _tipHeight: number;
  private readonly _maxOrphanDepth: number;
  private _hasOrphans: boolean;

  constructor(maxOrphanDepth: number = 100) {
    if (!Number.isInteger(maxOrphanDepth) || maxOrphanDepth <= 0) {
      throw new RangeError('maxOrphanDepth must be a positive integer');
    }
    this._blocks = Object.create(null) as Record<string, BlockHeader>;
    this._tipHash = null;
    this._tipHeight = -1;
    this._maxOrphanDepth = maxOrphanDepth;
    this._hasOrphans = false;
  }

  get tipHash(): string | null { return this._tipHash; }
  get tipHeight(): number { return this._tipHeight; }
  get blockCount(): number { return Object.keys(this._blocks).length; }
  get maxOrphanDepth(): number { return this._maxOrphanDepth; }

  get orphanCount(): number {
    let count = 0;
    for (const hash in this._blocks) {
      if (!this.isBlockOnCanonicalChain(hash)) count += 1;
    }
    return count;
  }

  getBlock(hash: string): BlockHeader | null {
    const block = this._blocks[hash];
    return block !== undefined ? cloneBlock(block) : null;
  }

  hasBlock(hash: string): boolean { return this._blocks[hash] !== undefined; }

  private _isBetterTip(height: number, hash: string): boolean {
    if (this._tipHash === null) return true;
    return height > this._tipHeight || (height === this._tipHeight && hash < this._tipHash);
  }

  private _getAncestorsChain(startHash: string, stopHash: string | null): BlockHeader[] {
    const chain: BlockHeader[] = [];
    let current: string | null = startHash;
    while (current !== null && current !== stopHash) {
      const block: BlockHeader | undefined = this._blocks[current];
      if (!block) break;
      chain.push(cloneBlock(block));
      current = block.prevHash === '' ? null : block.prevHash;
    }
    return chain;
  }

  private _findCommonAncestor(hashA: string, hashB: string): string | null {
    const ancestors: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    let currentA: string | null = hashA;
    while (currentA !== null) {
      ancestors[currentA] = true;
      const block: BlockHeader | undefined = this._blocks[currentA];
      if (!block || block.prevHash === '') break;
      currentA = block.prevHash;
    }

    let currentB: string | null = hashB;
    while (currentB !== null) {
      if (ancestors[currentB]) return currentB;
      const block: BlockHeader | undefined = this._blocks[currentB];
      if (!block || block.prevHash === '') break;
      currentB = block.prevHash;
    }
    return null;
  }

  private _validateBlockShape(block: BlockHeader): void {
    if (!block || typeof block.hash !== 'string' || block.hash.trim() === '') throw new TypeError('block hash cannot be empty');
    if (typeof block.prevHash !== 'string') throw new TypeError('block prevHash must be a string');
    if (!Number.isInteger(block.height) || block.height < 0) throw new RangeError('block height must be a non-negative integer');
    if (typeof block.timestampMs !== 'bigint' || block.timestampMs < 0n) throw new RangeError('block timestamp must be a non-negative bigint');
    if (!Array.isArray(block.txids) || block.txids.some((txid) => typeof txid !== 'string' || txid.trim() === '')) throw new TypeError('block txids must contain only non-empty strings');
  }

  private _validateBlockParent(block: BlockHeader): void {
    if (block.prevHash === block.hash) throw new Error('block cannot reference itself');
    if (this._blocks[block.hash] !== undefined) throw new Error(`block '${block.hash}' already exists`);
    if (block.prevHash !== '') {
      const parent = this._blocks[block.prevHash];
      if (!parent) throw new Error(`parent block '${block.prevHash}' not found in tree`);
      if (block.height !== parent.height + 1) throw new Error('block height must immediately follow its parent');
    }
  }

  private _validateNewBlock(block: BlockHeader): void {
    this._validateBlockShape(block);
    this._validateBlockParent(block);
  }

  private _compareOrphans(leftHash: string, rightHash: string): number {
    const left = this._blocks[leftHash];
    const right = this._blocks[rightHash];
    if (!left || !right) {
      if (leftHash < rightHash) return -1;
      if (leftHash > rightHash) return 1;
      return 0;
    }
    if (left.height !== right.height) return right.height - left.height;
    if (leftHash < rightHash) return -1;
    if (leftHash > rightHash) return 1;
    return 0;
  }

  private _pruneOldOrphans(): void {
    if (!this._hasOrphans) return;
    const orphans: string[] = [];
    for (const hash in this._blocks) {
      if (!this.isBlockOnCanonicalChain(hash)) orphans.push(hash);
    }
    if (orphans.length <= this._maxOrphanDepth) return;
    orphans.sort((left, right) => this._compareOrphans(left, right));
    for (let i = this._maxOrphanDepth; i < orphans.length; i++) {
      const hash = orphans[i];
      if (hash !== undefined) delete this._blocks[hash];
    }
    this._hasOrphans = this.orphanCount > 0;
  }

  private _computeReorg(previousTipHash: string, newBlock: BlockHeader): ReorgResult {
    const commonAncestorHash = this._findCommonAncestor(previousTipHash, newBlock.hash);
    const disconnected = this._getAncestorsChain(previousTipHash, commonAncestorHash);
    const connected = this._getAncestorsChain(newBlock.hash, commonAncestorHash).reverse();
    this._pruneOldOrphans();
    return { isReorg: true, commonAncestorHash, disconnected, connected, activeTip: cloneBlock(newBlock) };
  }

  addBlock(block: BlockHeader): ReorgResult {
    this._validateNewBlock(block);
    const storedBlock = cloneBlock(block);
    this._blocks[storedBlock.hash] = storedBlock;

    if (!this._isBetterTip(storedBlock.height, storedBlock.hash)) {
      this._hasOrphans = true;
      this._pruneOldOrphans();
      const activeTip = this._tipHash ? this._blocks[this._tipHash] : storedBlock;
      return { isReorg: false, commonAncestorHash: null, disconnected: [], connected: [], activeTip: cloneBlock(activeTip ?? storedBlock) };
    }

    const previousTipHash = this._tipHash;
    this._tipHash = storedBlock.hash;
    this._tipHeight = storedBlock.height;

    if (previousTipHash === null || storedBlock.prevHash === previousTipHash) {
      this._pruneOldOrphans();
      return { isReorg: false, commonAncestorHash: previousTipHash, disconnected: [], connected: [cloneBlock(storedBlock)], activeTip: cloneBlock(storedBlock) };
    }
    return this._computeReorg(previousTipHash, storedBlock);
  }

  isBlockOnCanonicalChain(blockHash: string): boolean {
    let current = this._tipHash;
    while (current !== null) {
      if (current === blockHash) return true;
      const block = this._blocks[current];
      if (!block || block.prevHash === '') break;
      current = block.prevHash;
    }
    return false;
  }

  getCanonicalConfirmations(blockHash: string): number {
    const block = this._blocks[blockHash];
    if (!block || !this.isBlockOnCanonicalChain(blockHash)) return 0;
    return this._tipHeight - block.height + 1;
  }

  getCanonicalChain(): readonly BlockHeader[] {
    if (this._tipHash === null) return [];
    return this._getAncestorsChain(this._tipHash, null).reverse();
  }

  snapshot(): { readonly blocks: Record<string, BlockHeader>; readonly tipHash: string | null; readonly tipHeight: number } {
    const blocks: Record<string, BlockHeader> = Object.create(null) as Record<string, BlockHeader>;
    for (const hash in this._blocks) {
      const block = this._blocks[hash];
      if (block) blocks[hash] = cloneBlock(block);
    }
    return { blocks, tipHash: this._tipHash, tipHeight: this._tipHeight };
  }

  restore(snapshot: { readonly blocks: Record<string, BlockHeader>; readonly tipHash: string | null; readonly tipHeight: number }): void {
    for (const hash in this._blocks) delete this._blocks[hash];
    for (const hash in snapshot.blocks) {
      const block = snapshot.blocks[hash];
      if (block) this._blocks[hash] = cloneBlock(block);
    }
    this._tipHash = snapshot.tipHash;
    this._tipHeight = snapshot.tipHeight;
    if ((this._tipHash === null && this._tipHeight !== -1) || (this._tipHash !== null && !this._blocks[this._tipHash])) throw new Error('invalid tree snapshot tip');
    this._hasOrphans = false;
    for (const hash in this._blocks) {
      if (!this.isBlockOnCanonicalChain(hash)) {
        this._hasOrphans = true;
        break;
      }
    }
    this._pruneOldOrphans();
  }
}
