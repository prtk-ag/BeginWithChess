// game.js — game state: 8x8 board model + FEN parser + move history.
//
// The board is a row-major 2D array indexed [row][col] where row 0 = rank 8
// and col 0 = file 'a'. Pieces are integers: 1..6 = pawn..king,
// positive = white, negative = black, 0 = empty.

export const PIECE = {
  EMPTY: 0,
  PAWN: 1, KNIGHT: 2, BISHOP: 3, ROOK: 4, QUEEN: 5, KING: 6,
};

export class Game {
  constructor() {
    this.board = emptyBoard();
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.sideToMove = 'w';      // 'w' or 'b'
    this.history = [];           // [{ move, san, fenAfter, evalScore, feedback, explain, color }]
    this.lastMove = null;        // { fr, fc, tr, tc }
    this.evalScore = 0;
    this.status = 'NORMAL';
  }

  loadFEN(fen) {
    if (!fen) return;
    this.fen = fen;
    const parts = fen.trim().split(/\s+/);
    const placement = parts[0];
    this.sideToMove = parts[1] || 'w';
    this.board = parseFENPlacement(placement);
  }

  pieceAt(r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return 0;
    return this.board[r][c];
  }

  // ── Square <-> coordinate helpers ────────────────────────
  static sqToRC(sq) {
    // "e2" -> { r: 6, c: 4 }
    if (!sq || sq.length < 2) return null;
    const c = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const r = 8 - parseInt(sq[1], 10);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return { r, c };
  }

  static rcToSq(r, c) {
    return String.fromCharCode('a'.charCodeAt(0) + c) + (8 - r);
  }
}

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(0));
}

function parseFENPlacement(placement) {
  const board = emptyBoard();
  const rows = placement.split('/');
  for (let r = 0; r < 8 && r < rows.length; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        c += parseInt(ch, 10);
      } else {
        board[r][c] = charToPiece(ch);
        c++;
      }
    }
  }
  return board;
}

function charToPiece(ch) {
  const map = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
  const lower = ch.toLowerCase();
  const v = map[lower] || 0;
  return ch === lower ? -v : v;
}
