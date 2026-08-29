type ChessMove = { from: number; to: number; promotion?: number; isEnPassant?: boolean; isCastling?: boolean };
type SearchResult = { bestMove: ChessMove | null; score: number };

export class ChessIntelligence {
  private _pieces: bigint[];
  private _sideToMove: number;
  private _castlingRights: number;
  private _enPassantSquare: number;
  private _zobristHash: bigint;
  private _history: bigint[];
  private readonly _zobristTable: bigint[];
  private readonly _stateStack: { pieces: bigint[]; side: number; castling: number; ep: number; hash: bigint }[];
  private _stateSp: number;
  private readonly _pstPawn: number[];
  private readonly _pstKnight: number[];

  constructor() {
    this._pieces = [0x000000000000FF00n, 0x0000000000000042n, 0x0000000000000024n, 0x0000000000000081n, 0x0000000000000008n, 0x0000000000000010n, 0x00FF000000000000n, 0x4200000000000000n, 0x2400000000000000n, 0x8100000000000000n, 0x0800000000000000n, 0x1000000000000000n];
    this._sideToMove = 0;
    this._castlingRights = 15;
    this._enPassantSquare = -1;
    this._zobristHash = 0n;
    this._history = [];
    this._stateSp = 0;
    const stack: { pieces: bigint[]; side: number; castling: number; ep: number; hash: bigint }[] = [];
    for (let i = 0; i < 256; i++) {
    stack.push({ pieces: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], side: 0, castling: 0, ep: -1, hash: 0n });
    }
    this._stateStack = stack;
    this._pstPawn = [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0];
    this._pstKnight = [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50];
    const table: bigint[] = [];
    let state = 0x123456789abcdef0n;
    for (let i = 0; i < 12 * 64 + 1 + 16 + 65; i++) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    table.push(state);
    }
    this._zobristTable = table;
    this.resetBoard();
  }

  resetBoard(): void {
    this._pieces = [0x000000000000FF00n, 0x0000000000000042n, 0x0000000000000024n, 0x0000000000000081n, 0x0000000000000008n, 0x0000000000000010n, 0x00FF000000000000n, 0x4200000000000000n, 0x2400000000000000n, 0x8100000000000000n, 0x0800000000000000n, 0x1000000000000000n];
    this._sideToMove = 0;
    this._castlingRights = 15;
    this._enPassantSquare = -1;
    this._history = [];
    this._stateSp = 0;
    this._recomputeZobrist();
  }

  _recomputeZobrist(): void {
    let hash = 0n;
    for (let p = 0; p < 12; p++) {
    const bb = this._pieces[p];
    if (bb !== undefined) {
    let temp = bb;
    while (temp > 0n) {
    const lsb = temp & -temp;
    const sq = this._bitScanForward(lsb);
    const key = this._zobristTable[p * 64 + sq];
    if (key !== undefined) hash = hash ^ key;
    temp = temp & (temp - 1n);
    }
    }
    }
    if (this._sideToMove === 1) {
    const sideKey = this._zobristTable[12 * 64];
    if (sideKey !== undefined) hash = hash ^ sideKey;
    }
    const castleKey = this._zobristTable[12 * 64 + 1 + this._castlingRights];
    if (castleKey !== undefined) hash = hash ^ castleKey;
    const epIdx = this._enPassantSquare >= 0 ? this._enPassantSquare : 64;
    const epKey = this._zobristTable[12 * 64 + 1 + 16 + epIdx];
    if (epKey !== undefined) hash = hash ^ epKey;
    this._zobristHash = hash;
  }

  _bitScanForward(bb: bigint): number {
    if (bb === 0n) return -1;
    let count = 0;
    let val = bb;
    if ((val & 0xFFFFFFFFn) === 0n) { count += 32; val = val >> 32n; }
    if ((val & 0xFFFFn) === 0n) { count += 16; val = val >> 16n; }
    if ((val & 0xFFn) === 0n) { count += 8; val = val >> 8n; }
    if ((val & 0xFn) === 0n) { count += 4; val = val >> 4n; }
    if ((val & 0x3n) === 0n) { count += 2; val = val >> 2n; }
    if ((val & 0x1n) === 0n) { count += 1; }
    return count;
  }

  getOccupancy(side: number): bigint {
    let occ = 0n;
    const start = side === 1 ? 6 : (side === 0 ? 0 : 0);
    const end = side === 1 ? 12 : (side === 0 ? 6 : 12);
    for (let i = start; i < end; i++) {
    const bb = this._pieces[i];
    if (bb !== undefined) occ = occ | bb;
    }
    return occ;
  }

  isSquareAttacked(square: number, attackingSide: number): boolean {
    const targetBit = 1n << BigInt(square);
    const allOcc = this.getOccupancy(-1);
    const pOffset = attackingSide === 0 ? 0 : 6;
    const pawns = this._pieces[pOffset + 0];
    if (pawns !== undefined) {
    const pawnAttacks = attackingSide === 0
    ? ((pawns & 0x7F7F7F7F7F7F7F7Fn) << 9n) | ((pawns & 0xFEFEFEFEFEFEFEFEn) << 7n)
    : ((pawns & 0xFEFEFEFEFEFEFEFEn) >> 9n) | ((pawns & 0x7F7F7F7F7F7F7F7Fn) >> 7n);
    if ((pawnAttacks & targetBit) !== 0n) return true;
    }
    const knights = this._pieces[pOffset + 1];
    if (knights !== undefined && (this._getKnightAttacks(square) & knights) !== 0n) return true;
    const king = this._pieces[pOffset + 5];
    if (king !== undefined && (this._getKingAttacks(square) & king) !== 0n) return true;
    const bishops = (this._pieces[pOffset + 2] ?? 0n) | (this._pieces[pOffset + 4] ?? 0n);
    if ((this._getBishopAttacks(square, allOcc) & bishops) !== 0n) return true;
    const rooks = (this._pieces[pOffset + 3] ?? 0n) | (this._pieces[pOffset + 4] ?? 0n);
    if ((this._getRookAttacks(square, allOcc) & rooks) !== 0n) return true;
    return false;
  }

  _getKnightAttacks(sq: number): bigint {
    const b = 1n << BigInt(sq);
    let attacks = 0n;
    attacks = attacks | ((b << 17n) & 0xFEFEFEFEFEFEFEFEn);
    attacks = attacks | ((b << 15n) & 0x7F7F7F7F7F7F7F7Fn);
    attacks = attacks | ((b << 10n) & 0xFCFCFCFCFCFCFCFCn);
    attacks = attacks | ((b << 6n) & 0x3F3F3F3F3F3F3F3Fn);
    attacks = attacks | ((b >> 17n) & 0x7F7F7F7F7F7F7F7Fn);
    attacks = attacks | ((b >> 15n) & 0xFEFEFEFEFEFEFEFEn);
    attacks = attacks | ((b >> 10n) & 0x3F3F3F3F3F3F3F3Fn);
    attacks = attacks | ((b >> 6n) & 0xFCFCFCFCFCFCFCFCn);
    return attacks & 0xFFFFFFFFFFFFFFFFn;
  }

  _getKingAttacks(sq: number): bigint {
    const b = 1n << BigInt(sq);
    let attacks = 0n;
    attacks = attacks | (b << 8n);
    attacks = attacks | (b >> 8n);
    attacks = attacks | ((b << 1n) & 0xFEFEFEFEFEFEFEFEn);
    attacks = attacks | ((b >> 1n) & 0x7F7F7F7F7F7F7F7Fn);
    attacks = attacks | ((b << 9n) & 0xFEFEFEFEFEFEFEFEn);
    attacks = attacks | ((b << 7n) & 0x7F7F7F7F7F7F7F7Fn);
    attacks = attacks | ((b >> 7n) & 0xFEFEFEFEFEFEFEFEn);
    attacks = attacks | ((b >> 9n) & 0x7F7F7F7F7F7F7F7Fn);
    return attacks & 0xFFFFFFFFFFFFFFFFn;
  }

  _getRookAttacks(sq: number, occ: bigint): bigint {
    let attacks = 0n;
    const r = Math.floor(sq / 8);
    const f = sq % 8;
    for (let nr = r + 1; nr < 8; nr++) { const s = nr * 8 + f; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    for (let nr = r - 1; nr >= 0; nr--) { const s = nr * 8 + f; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    for (let nf = f + 1; nf < 8; nf++) { const s = r * 8 + nf; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    for (let nf = f - 1; nf >= 0; nf--) { const s = r * 8 + nf; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    return attacks;
  }

  _getBishopAttacks(sq: number, occ: bigint): bigint {
    let attacks = 0n;
    const r = Math.floor(sq / 8);
    const f = sq % 8;
    for (let nr = r + 1, nf = f + 1; nr < 8 && nf < 8; nr++, nf++) { const s = nr * 8 + nf; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    for (let nr = r + 1, nf = f - 1; nr < 8 && nf >= 0; nr++, nf--) { const s = nr * 8 + nf; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    for (let nr = r - 1, nf = f + 1; nr >= 0 && nf < 8; nr--, nf++) { const s = nr * 8 + nf; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    for (let nr = r - 1, nf = f - 1; nr >= 0 && nf >= 0; nr--, nf--) { const s = nr * 8 + nf; attacks = attacks | (1n << BigInt(s)); if ((occ & (1n << BigInt(s))) !== 0n) break; }
    return attacks;
  }

  isInCheck(side: number): boolean {
    const targetSide = side === 0 || side === 1 ? side : this._sideToMove;
    const kingPiece = targetSide === 0 ? 5 : 11;
    const kingBB = this._pieces[kingPiece];
    if (kingBB === undefined || kingBB === 0n) return false;
    const sq = this._bitScanForward(kingBB);
    return this.isSquareAttacked(sq, targetSide === 0 ? 1 : 0);
  }

  generateLegalMoves(): ChessMove[] {
    const pseudo = this._sideToMove === 0 ? this._generateWhiteMoves() : this._generateBlackMoves();
    const legal: ChessMove[] = [];
    for (const m of pseudo) {
    if (this.makeMove(m)) {
    legal.push(m);
    this.undoMove();
    }
    }
    return legal;
  }

  _generateWhiteMoves(): ChessMove[] {
    const moves: ChessMove[] = [];
    const ownOcc = this.getOccupancy(0);
    const enemyOcc = this.getOccupancy(1);
    const allOcc = ownOcc | enemyOcc;
    let p = this._pieces[0] ?? 0n;
    while (p > 0n) {
    const lsb = p & -p;
    const from = this._bitScanForward(lsb);
    p = p & (p - 1n);
    const oneStep = from + 8;
    if (oneStep < 64 && (allOcc & (1n << BigInt(oneStep))) === 0n) {
    if (oneStep >= 56) { moves.push({ from, to: oneStep, promotion: 4 }); moves.push({ from, to: oneStep, promotion: 3 }); moves.push({ from, to: oneStep, promotion: 2 }); moves.push({ from, to: oneStep, promotion: 1 }); }
    else { moves.push({ from, to: oneStep }); if (from >= 8 && from <= 15 && (allOcc & (1n << BigInt(from + 16))) === 0n) moves.push({ from, to: from + 16 }); }
    }
    const leftCap = from + 7; if (from % 8 > 0 && leftCap < 64) { if ((enemyOcc & (1n << BigInt(leftCap))) !== 0n) { if (leftCap >= 56) { moves.push({ from, to: leftCap, promotion: 4 }); moves.push({ from, to: leftCap, promotion: 3 }); moves.push({ from, to: leftCap, promotion: 2 }); moves.push({ from, to: leftCap, promotion: 1 }); } else moves.push({ from, to: leftCap }); } else if (leftCap === this._enPassantSquare) moves.push({ from, to: leftCap, isEnPassant: true }); }
    const rightCap = from + 9; if (from % 8 < 7 && rightCap < 64) { if ((enemyOcc & (1n << BigInt(rightCap))) !== 0n) { if (rightCap >= 56) { moves.push({ from, to: rightCap, promotion: 4 }); moves.push({ from, to: rightCap, promotion: 3 }); moves.push({ from, to: rightCap, promotion: 2 }); moves.push({ from, to: rightCap, promotion: 1 }); } else moves.push({ from, to: rightCap }); } else if (rightCap === this._enPassantSquare) moves.push({ from, to: rightCap, isEnPassant: true }); }
    }
    this._addPieceMoves(1, ownOcc, allOcc, moves, (sq) => this._getKnightAttacks(sq));
    this._addPieceMoves(2, ownOcc, allOcc, moves, (sq, occ) => this._getBishopAttacks(sq, occ));
    this._addPieceMoves(3, ownOcc, allOcc, moves, (sq, occ) => this._getRookAttacks(sq, occ));
    this._addPieceMoves(4, ownOcc, allOcc, moves, (sq, occ) => this._getBishopAttacks(sq, occ) | this._getRookAttacks(sq, occ));
    this._addPieceMoves(5, ownOcc, allOcc, moves, (sq) => this._getKingAttacks(sq));
    const whiteRooks = this._pieces[3] ?? 0n;
    if ((this._castlingRights & 1) !== 0 && (whiteRooks & (1n << 7n)) !== 0n && (allOcc & 0x60n) === 0n && !this.isSquareAttacked(4, 1) && !this.isSquareAttacked(5, 1) && !this.isSquareAttacked(6, 1)) moves.push({ from: 4, to: 6, isCastling: true });
    if ((this._castlingRights & 2) !== 0 && (whiteRooks & (1n << 0n)) !== 0n && (allOcc & 0x0En) === 0n && !this.isSquareAttacked(4, 1) && !this.isSquareAttacked(3, 1) && !this.isSquareAttacked(2, 1)) moves.push({ from: 4, to: 2, isCastling: true });
    return moves;
  }

  _generateBlackMoves(): ChessMove[] {
    const moves: ChessMove[] = [];
    const ownOcc = this.getOccupancy(1);
    const enemyOcc = this.getOccupancy(0);
    const allOcc = ownOcc | enemyOcc;
    let p = this._pieces[6] ?? 0n;
    while (p > 0n) {
    const lsb = p & -p;
    const from = this._bitScanForward(lsb);
    p = p & (p - 1n);
    const oneStep = from - 8;
    if (oneStep >= 0 && (allOcc & (1n << BigInt(oneStep))) === 0n) {
    if (oneStep <= 7) { moves.push({ from, to: oneStep, promotion: 10 }); moves.push({ from, to: oneStep, promotion: 9 }); moves.push({ from, to: oneStep, promotion: 8 }); moves.push({ from, to: oneStep, promotion: 7 }); }
    else { moves.push({ from, to: oneStep }); if (from >= 48 && from <= 55 && (allOcc & (1n << BigInt(from - 16))) === 0n) moves.push({ from, to: from - 16 }); }
    }
    const leftCap = from - 9; if (from % 8 > 0 && leftCap >= 0) { if ((enemyOcc & (1n << BigInt(leftCap))) !== 0n) { if (leftCap <= 7) { moves.push({ from, to: leftCap, promotion: 10 }); moves.push({ from, to: leftCap, promotion: 9 }); moves.push({ from, to: leftCap, promotion: 8 }); moves.push({ from, to: leftCap, promotion: 7 }); } else moves.push({ from, to: leftCap }); } else if (leftCap === this._enPassantSquare) moves.push({ from, to: leftCap, isEnPassant: true }); }
    const rightCap = from - 7; if (from % 8 < 7 && rightCap >= 0) { if ((enemyOcc & (1n << BigInt(rightCap))) !== 0n) { if (rightCap <= 7) { moves.push({ from, to: rightCap, promotion: 10 }); moves.push({ from, to: rightCap, promotion: 9 }); moves.push({ from, to: rightCap, promotion: 8 }); moves.push({ from, to: rightCap, promotion: 7 }); } else moves.push({ from, to: rightCap }); } else if (rightCap === this._enPassantSquare) moves.push({ from, to: rightCap, isEnPassant: true }); }
    }
    this._addPieceMoves(7, ownOcc, allOcc, moves, (sq) => this._getKnightAttacks(sq));
    this._addPieceMoves(8, ownOcc, allOcc, moves, (sq, occ) => this._getBishopAttacks(sq, occ));
    this._addPieceMoves(9, ownOcc, allOcc, moves, (sq, occ) => this._getRookAttacks(sq, occ));
    this._addPieceMoves(10, ownOcc, allOcc, moves, (sq, occ) => this._getBishopAttacks(sq, occ) | this._getRookAttacks(sq, occ));
    this._addPieceMoves(11, ownOcc, allOcc, moves, (sq) => this._getKingAttacks(sq));
    const blackRooks = this._pieces[9] ?? 0n;
    if ((this._castlingRights & 4) !== 0 && (blackRooks & (1n << 63n)) !== 0n && (allOcc & 0x6000000000000000n) === 0n && !this.isSquareAttacked(60, 0) && !this.isSquareAttacked(61, 0) && !this.isSquareAttacked(62, 0)) moves.push({ from: 60, to: 62, isCastling: true });
    if ((this._castlingRights & 8) !== 0 && (blackRooks & (1n << 56n)) !== 0n && (allOcc & 0x0E00000000000000n) === 0n && !this.isSquareAttacked(60, 0) && !this.isSquareAttacked(59, 0) && !this.isSquareAttacked(58, 0)) moves.push({ from: 60, to: 58, isCastling: true });
    return moves;
  }

  _addPieceMoves(pieceIdx: number, ownOcc: bigint, allOcc: bigint, moves: ChessMove[], getAttacks: (sq: number, occ: bigint) => bigint): void {
    let bb = this._pieces[pieceIdx] ?? 0n;
    while (bb > 0n) {
    const lsb = bb & -bb;
    const from = this._bitScanForward(lsb);
    bb = bb & (bb - 1n);
    let att = getAttacks(from, allOcc) & ~ownOcc;
    while (att > 0n) {
    const attLsb = att & -att;
    const to = this._bitScanForward(attLsb);
    att = att & (att - 1n);
    moves.push({ from, to });
    }
    }
  }

  makeMove(m: ChessMove): boolean {
    const movingSide = this._sideToMove;
    const sp = this._stateSp;
    const frame = this._stateStack[sp];
    if (frame !== undefined) {
    for (let p = 0; p < 12; p++) frame.pieces[p] = this._pieces[p] ?? 0n;
    frame.side = this._sideToMove;
    frame.castling = this._castlingRights;
    frame.ep = this._enPassantSquare;
    frame.hash = this._zobristHash;
    this._stateSp++;
    }
    this._history.push(this._zobristHash);
    let movingPiece = -1;
    const fromBit = 1n << BigInt(m.from);
    const toBit = 1n << BigInt(m.to);
    const startP = movingSide === 0 ? 0 : 6;
    const endP = movingSide === 0 ? 6 : 12;
    for (let p = startP; p < endP; p++) {
    const bb = this._pieces[p];
    if (bb !== undefined && (bb & fromBit) !== 0n) { movingPiece = p; break; }
    }
    if (movingPiece === -1) { this.undoMove(); return false; }
    this._pieces[movingPiece] = (this._pieces[movingPiece] ?? 0n) ^ fromBit;
    if (m.isEnPassant) {
    const capSq = movingSide === 0 ? m.to - 8 : m.to + 8;
    const capP = movingSide === 0 ? 6 : 0;
    this._pieces[capP] = (this._pieces[capP] ?? 0n) ^ (1n << BigInt(capSq));
    } else {
    const oppStart = movingSide === 0 ? 6 : 0;
    const oppEnd = movingSide === 0 ? 12 : 6;
    for (let p = oppStart; p < oppEnd; p++) {
    const bb = this._pieces[p];
    if (bb !== undefined && (bb & toBit) !== 0n) { this._pieces[p] = bb ^ toBit; break; }
    }
    }
    const finalPiece = m.promotion !== undefined ? m.promotion : movingPiece;
    this._pieces[finalPiece] = (this._pieces[finalPiece] ?? 0n) | toBit;
    if (m.isCastling) {
    if (m.to === 6) this._pieces[3] = (this._pieces[3] ?? 0n) ^ (1n << 7n) | (1n << 5n);
    else if (m.to === 2) this._pieces[3] = (this._pieces[3] ?? 0n) ^ (1n << 0n) | (1n << 3n);
    else if (m.to === 62) this._pieces[9] = (this._pieces[9] ?? 0n) ^ (1n << 63n) | (1n << 61n);
    else if (m.to === 58) this._pieces[9] = (this._pieces[9] ?? 0n) ^ (1n << 56n) | (1n << 59n);
    }
    if (movingPiece === 5) this._castlingRights = this._castlingRights & ~3;
    if (movingPiece === 11) this._castlingRights = this._castlingRights & ~12;
    if (m.from === 0 || m.to === 0) this._castlingRights = this._castlingRights & ~2;
    if (m.from === 7 || m.to === 7) this._castlingRights = this._castlingRights & ~1;
    if (m.from === 56 || m.to === 56) this._castlingRights = this._castlingRights & ~8;
    if (m.from === 63 || m.to === 63) this._castlingRights = this._castlingRights & ~4;
    if (movingPiece === 0 && m.to - m.from === 16) this._enPassantSquare = m.from + 8;
    else if (movingPiece === 6 && m.from - m.to === 16) this._enPassantSquare = m.from - 8;
    else this._enPassantSquare = -1;
    this._sideToMove = 1 - movingSide;
    this._recomputeZobrist();
    if (this.isInCheck(movingSide)) { this.undoMove(); return false; }
    return true;
  }

  undoMove(): void {
    if (this._stateSp <= 0) return;
    this._stateSp--;
    const frame = this._stateStack[this._stateSp];
    if (frame === undefined) return;
    for (let p = 0; p < 12; p++) this._pieces[p] = frame.pieces[p] ?? 0n;
    this._sideToMove = frame.side;
    this._castlingRights = frame.castling;
    this._enPassantSquare = frame.ep;
    this._zobristHash = frame.hash;
    this._history.pop();
  }

  isThreefoldRepetition(): boolean {
    let count = 0;
    for (const h of this._history) {
    if (h === this._zobristHash) count++;
    }
    return count >= 2;
  }

  evaluatePosition(): number {
    const pieceValues = [100, 320, 330, 500, 900, 20000, 100, 320, 330, 500, 900, 20000];
    let whiteScore = 0;
    let blackScore = 0;
    for (let p = 0; p < 6; p++) {
    let bb = this._pieces[p] ?? 0n;
    const val = pieceValues[p] ?? 0;
    while (bb > 0n) {
    const lsb = bb & -bb;
    const sq = this._bitScanForward(lsb);
    whiteScore += val + (p === 0 ? (this._pstPawn[63 - sq] ?? 0) : (p === 1 ? (this._pstKnight[63 - sq] ?? 0) : 0));
    bb = bb & (bb - 1n);
    }
    }
    for (let p = 6; p < 12; p++) {
    let bb = this._pieces[p] ?? 0n;
    const val = pieceValues[p] ?? 0;
    while (bb > 0n) {
    const lsb = bb & -bb;
    const sq = this._bitScanForward(lsb);
    blackScore += val + (p === 6 ? (this._pstPawn[sq] ?? 0) : (p === 7 ? (this._pstKnight[sq] ?? 0) : 0));
    bb = bb & (bb - 1n);
    }
    }
    const evalScore = whiteScore - blackScore;
    return this._sideToMove === 0 ? evalScore : -evalScore;
  }

  searchBestMove(depth: number): SearchResult {
    if (depth <= 0) return { bestMove: null, score: this.evaluatePosition() };
    const legalMoves = this.generateLegalMoves();
    if (legalMoves.length === 0) {
    if (this.isInCheck(this._sideToMove)) return { bestMove: null, score: -100000 - depth };
    return { bestMove: null, score: 0 };
    }
    let bestMove: ChessMove | null = legalMoves[0] ?? null;
    let bestScore = -1000000;
    for (const m of legalMoves) {
    if (this.makeMove(m)) {
    const score = this.isThreefoldRepetition() ? 0 : -this._alphaBeta(depth - 1, -1000000, -bestScore);
    this.undoMove();
    if (score > bestScore) {
    bestScore = score;
    bestMove = m;
    }
    }
    }
    return { bestMove, score: bestScore };
  }

  _alphaBeta(depth: number, alpha: number, beta: number): number {
    if (this.isThreefoldRepetition()) return 0;
    if (depth <= 0) return this.evaluatePosition();
    const legalMoves = this.generateLegalMoves();
    if (legalMoves.length === 0) {
    if (this.isInCheck(this._sideToMove)) return -100000 - depth;
    return 0;
    }
    let a = alpha;
    for (const m of legalMoves) {
    if (this.makeMove(m)) {
    const score = -this._alphaBeta(depth - 1, -beta, -a);
    this.undoMove();
    if (score >= beta) return beta;
    if (score > a) a = score;
    }
    }
    return a;
  }

  get sideToMove(): number { return this._sideToMove; }

  get castlingRights(): number { return this._castlingRights; }

  get enPassantSquare(): number { return this._enPassantSquare; }

  get zobristHash(): bigint { return this._zobristHash; }

  get pieces(): readonly bigint[] { return this._pieces; }

  get isCheckmate(): boolean { return this.isInCheck(this._sideToMove) && this.generateLegalMoves().length === 0; }

  get isDraw(): boolean { return (!this.isInCheck(this._sideToMove) && this.generateLegalMoves().length === 0) || this.isThreefoldRepetition(); }
}

export function compileChessTelemetryMask(engine: ChessIntelligence): number {
  let mask = 0;
  if (engine.sideToMove === 1) mask = mask | 1;
  if (engine.isInCheck(engine.sideToMove)) mask = mask | (1 << 1);
  if (engine.isCheckmate) mask = mask | (1 << 2);
  if (engine.isDraw) mask = mask | (1 << 3);
  mask = mask | ((engine.castlingRights & 0xF) << 4);
  const ep = engine.enPassantSquare;
  const epFile = ep >= 0 ? (ep % 8) + 1 : 0;
  mask = mask | ((epFile & 0xF) << 8);
  const upperHash = Number((engine.zobristHash >> 48n) & 0xFFFFn);
  mask = mask | ((upperHash & 0xFFFF) << 16);
  return mask >>> 0;
}
