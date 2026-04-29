// engine.js — WebSocket client for the C++ chess engine
//
// Wraps the line-oriented protocol (NEW, MOVE, AI, EVAL, UNDO, STATUS, LEGAL)
// in a promise-based API. Each command sent waits for the next engine response
// line, since the engine is strictly request/response.

export class Engine {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.queue = [];        // pending [{resolve, reject}] for command responses
    this.statusListeners = [];
    this.connected = false;
    this.connecting = false;
  }

  onStatus(fn) { this.statusListeners.push(fn); }

  _emit(s) { this.statusListeners.forEach(fn => fn(s)); }

  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.connecting = false;
        this._emit({ state: 'online' });
        resolve();
      };
      ws.onerror = (e) => {
        this.connecting = false;
        this._emit({ state: 'error', msg: 'connection failed' });
        reject(e);
      };
      ws.onclose = () => {
        this.connected = false;
        this._emit({ state: 'offline' });
        // Reject any pending commands
        while (this.queue.length) {
          const { reject } = this.queue.shift();
          reject(new Error('connection closed'));
        }
      };
      ws.onmessage = (ev) => this._onMessage(ev);
    });
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); }
    catch { msg = { type: 'engine', line: String(ev.data) }; }

    if (msg.type === 'error') {
      this._emit({ state: 'error', msg: msg.msg || 'engine error' });
      return;
    }
    if (msg.type === 'engine') {
      const line = msg.line;
      if (this.queue.length) {
        const { resolve } = this.queue.shift();
        resolve(line);
      } else {
        // unsolicited — log
        console.warn('Unexpected engine output:', line);
      }
    }
  }

  /** Send a command and resolve with the engine's response line. */
  send(cmd) {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error('not connected'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.ws.send(JSON.stringify({ type: 'cmd', cmd }));
    });
  }

  // ── High-level commands ───────────────────────────────────

  async newGame() {
    const line = await this.send('NEW');
    return parseOK(line);    // { fen }
  }

  async loadFEN(fen) {
    const line = await this.send(`FEN ${fen}`);
    return parseOK(line);
  }

  /** Apply a move. moveStr like "e2e4" or "e7e8q" */
  async move(moveStr) {
    const line = await this.send(`MOVE ${moveStr}`);
    return parseMoveResponse(line);
  }

  /** Ask engine for its best move at given depth. */
  async aiMove(depth) {
    const line = await this.send(`AI ${depth}`);
    return parseBestMove(line);
  }

  async eval() {
    const line = await this.send('EVAL');
    if (line.startsWith('EVAL ')) {
      return { score: parseInt(line.slice(5), 10) || 0 };
    }
    return { score: 0 };
  }

  async undo() {
    const line = await this.send('UNDO');
    return parseOK(line);
  }

  async status() {
    const line = await this.send('STATUS');
    if (line.startsWith('STATUS ')) {
      return { state: line.slice(7).trim() };
    }
    return { state: 'NORMAL' };
  }

  async legalFrom(square) {
    const line = await this.send(`LEGAL ${square}`);
    if (line.startsWith('LEGAL')) {
      const parts = line.slice(5).trim().split(/\s+/).filter(Boolean);
      return parts;
    }
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  Response parsers
// ─────────────────────────────────────────────────────────────

function parseOK(line) {
  // "OK <fen>"
  if (!line || !line.startsWith('OK')) {
    return { ok: false, error: line || 'empty response' };
  }
  return { ok: true, fen: line.slice(3).trim() };
}

function parseMoveResponse(line) {
  // "OK <fen> EVAL n FEEDBACK text EXPLAIN text"
  // or "ERROR ..."
  if (!line) return { ok: false, error: 'empty response' };
  if (line.startsWith('ERROR')) {
    return { ok: false, error: line.slice(5).trim() };
  }
  if (!line.startsWith('OK')) {
    return { ok: false, error: line };
  }
  const rest = line.slice(3); // after "OK "
  // FEN is always the first token-block before " EVAL "
  const evalIdx     = rest.indexOf(' EVAL ');
  const feedbackIdx = rest.indexOf(' FEEDBACK ');
  const explainIdx  = rest.indexOf(' EXPLAIN ');

  let fen = rest, evalScore = 0, feedback = '', explain = '';
  if (evalIdx >= 0) {
    fen = rest.slice(0, evalIdx).trim();
    const afterEval = rest.slice(evalIdx + 6);
    let evalEnd = afterEval.length;
    if (feedbackIdx >= 0) evalEnd = Math.min(evalEnd, feedbackIdx - evalIdx - 6);
    if (explainIdx >= 0)  evalEnd = Math.min(evalEnd, explainIdx  - evalIdx - 6);
    evalScore = parseInt(afterEval.slice(0, evalEnd).trim(), 10) || 0;
  }
  if (feedbackIdx >= 0) {
    const afterFb = rest.slice(feedbackIdx + 10);
    let fbEnd = afterFb.length;
    if (explainIdx > feedbackIdx) fbEnd = explainIdx - feedbackIdx - 10;
    feedback = afterFb.slice(0, fbEnd).trim();
  }
  if (explainIdx >= 0) {
    explain = rest.slice(explainIdx + 9).trim();
  }
  return { ok: true, fen, evalScore, feedback, explain };
}

function parseBestMove(line) {
  // "BESTMOVE <move> <fen> SCORE n NODES n EXPLAIN text"
  // or "ERROR ..."
  if (!line) return { ok: false, error: 'empty response' };
  if (line.startsWith('ERROR')) {
    return { ok: false, error: line.slice(5).trim() };
  }
  if (!line.startsWith('BESTMOVE ')) {
    return { ok: false, error: line };
  }
  const rest = line.slice(9);
  // Format: "<move> <fen-with-spaces> SCORE n NODES n EXPLAIN text"
  const sp = rest.indexOf(' ');
  if (sp < 0) return { ok: false, error: 'malformed BESTMOVE' };
  const move = rest.slice(0, sp);
  const after = rest.slice(sp + 1);

  const scoreIdx   = after.indexOf(' SCORE ');
  const nodesIdx   = after.indexOf(' NODES ');
  const explainIdx = after.indexOf(' EXPLAIN ');

  let fen = after, score = 0, nodes = 0, explain = '';
  if (scoreIdx >= 0) {
    fen = after.slice(0, scoreIdx).trim();
    const afterScore = after.slice(scoreIdx + 7);
    let end = afterScore.length;
    if (nodesIdx > scoreIdx)   end = Math.min(end, nodesIdx - scoreIdx - 7);
    if (explainIdx > scoreIdx) end = Math.min(end, explainIdx - scoreIdx - 7);
    score = parseInt(afterScore.slice(0, end).trim(), 10) || 0;
  }
  if (nodesIdx >= 0) {
    const afterNodes = after.slice(nodesIdx + 7);
    let end = afterNodes.length;
    if (explainIdx > nodesIdx) end = explainIdx - nodesIdx - 7;
    nodes = parseInt(afterNodes.slice(0, end).trim(), 10) || 0;
  }
  if (explainIdx >= 0) {
    explain = after.slice(explainIdx + 9).trim();
  }
  return { ok: true, move, fen, score, nodes, explain };
}
