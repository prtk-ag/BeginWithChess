// main.js — Three.js scene, camera, board, picking, animation, UI glue.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Engine } from './engine.js';
import { Game } from './game.js';
import { makePiece, makeMaterials } from './pieces.js';

// ─────────────────────────────────────────────────────────────
//  Scene globals
// ─────────────────────────────────────────────────────────────

const SQUARE = 1.0;        // unit width of one square
const BOARD_SIZE = 8 * SQUARE;
const FRAME_W = 0.5;       // wood frame thickness around the squares
const BOARD_THICKNESS = 0.40;

let renderer, scene, camera, controls, raycaster, mouseVec;
let boardGroup, pieceGroup, highlightGroup;
let materials;
let canvasHost;
let pieceMeshes = {};   // key "r,c" -> mesh, mirrors current board

// State
const game = new Game();
let engine;
let busy = false;            // true during an animation or engine call
let humanColor = 'w';        // 'w' or 'b' — which side the human plays
let aiDepth = 3;
let boardFlipped = false;    // set once when user picks black; tracks orientation
let selectedSquare = null;   // {r, c} when a piece is picked up
let legalDestSquares = [];   // ['e4', ...] for currently selected piece
let hoveredSquare = null;    // {r, c}
let gameOver = false;

// Pending promotion state
let pendingPromotion = null;   // { fr, fc, tr, tc, resolve }

// ─────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────

function init() {
  canvasHost = document.getElementById('canvas-host');

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.appendChild(renderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1612);

  // Subtle fog for depth
  scene.fog = new THREE.Fog(0x1a1612, 14, 28);

  // Environment map for nice reflections (PMREMGenerator + RoomEnvironment)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // Camera — looks down at the board from a 3/4 angle
  const aspect = canvasHost.clientWidth / canvasHost.clientHeight;
  camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 200);
  camera.position.set(0, 9.0, 9.5);
  camera.lookAt(0, 0, 0);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 7;
  controls.maxDistance = 18;
  controls.minPolarAngle = Math.PI * 0.10;       // never go fully top-down
  controls.maxPolarAngle = Math.PI * 0.46;       // can't go below the table
  controls.enablePan = false;
  controls.rotateSpeed = 0.5;

  // Materials
  materials = makeMaterials();

  // Board + pieces groups
  boardGroup = new THREE.Group();
  scene.add(boardGroup);

  pieceGroup = new THREE.Group();
  scene.add(pieceGroup);

  highlightGroup = new THREE.Group();
  scene.add(highlightGroup);

  // Build the board
  buildBoard();
  setupLights();

  // Picking
  raycaster = new THREE.Raycaster();
  mouseVec = new THREE.Vector2();

  // Listeners
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);

  resize();

  // Wire up UI
  setupUI();

  // Connect engine — fetch config first to learn the WS port
  fetch('/config.json')
    .then(r => r.ok ? r.json() : { ws_port: 8765 })
    .catch(() => ({ ws_port: 8765 }))
    .then(cfg => {
      const wsPort = cfg.ws_port || 8765;
      engine = new Engine(`ws://${location.hostname}:${wsPort}/`);
      engine.onStatus(updateConnBadge);
      engine.connect()
        .then(startGame)
        .catch(err => {
          console.error('engine connect failed', err);
          setCoach("Couldn't reach the engine. Make sure chess_server.py is running, then refresh.", 'bad');
        });
    });

  // Render loop
  renderer.setAnimationLoop(animate);
}

// ─────────────────────────────────────────────────────────────
//  Lights
// ─────────────────────────────────────────────────────────────

function setupLights() {
  // Soft ambient
  const amb = new THREE.AmbientLight(0xfff2dc, 0.25);
  scene.add(amb);

  // Hemisphere for natural variation between top and ground
  const hemi = new THREE.HemisphereLight(0xfff2dc, 0x2a1f15, 0.4);
  scene.add(hemi);

  // Key light — overhead, slightly toward the player, casts shadows
  const key = new THREE.DirectionalLight(0xfff0d6, 1.6);
  key.position.set(-5, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.left   = -7;
  key.shadow.camera.right  =  7;
  key.shadow.camera.top    =  7;
  key.shadow.camera.bottom = -7;
  key.shadow.camera.near = 1;
  key.shadow.camera.far  = 30;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);

  // Fill — softer, opposite side
  const fill = new THREE.DirectionalLight(0xa8b0c8, 0.35);
  fill.position.set(6, 7, -3);
  scene.add(fill);

  // Warm rim from behind to give pieces a glow on their back edge
  const rim = new THREE.DirectionalLight(0xff9b5a, 0.4);
  rim.position.set(0, 4, -8);
  scene.add(rim);
}

// ─────────────────────────────────────────────────────────────
//  Board geometry
// ─────────────────────────────────────────────────────────────

function buildBoard() {
  // Wooden frame — a slightly larger plate beneath the squares
  const frameGeom = new THREE.BoxGeometry(
    BOARD_SIZE + FRAME_W * 2, BOARD_THICKNESS, BOARD_SIZE + FRAME_W * 2
  );
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a2a1c,
    roughness: 0.55,
    metalness: 0.04,
    clearcoat: 0.25,
    clearcoatRoughness: 0.6,
  });
  const frame = new THREE.Mesh(frameGeom, frameMat);
  frame.position.y = -BOARD_THICKNESS / 2;
  frame.castShadow = true;
  frame.receiveShadow = true;
  boardGroup.add(frame);

  // Subtle inner darker bevel where squares meet the frame
  const bevelGeom = new THREE.BoxGeometry(BOARD_SIZE + 0.06, 0.02, BOARD_SIZE + 0.06);
  const bevelMat = new THREE.MeshStandardMaterial({
    color: 0x1a1108, roughness: 0.9,
  });
  const bevel = new THREE.Mesh(bevelGeom, bevelMat);
  bevel.position.y = 0.005;
  bevel.receiveShadow = true;
  boardGroup.add(bevel);

  // Squares
  const lightMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8d4a8,
    roughness: 0.62,
    metalness: 0.02,
    clearcoat: 0.15,
    clearcoatRoughness: 0.7,
  });
  const darkMat = new THREE.MeshPhysicalMaterial({
    color: 0x6b4226,
    roughness: 0.55,
    metalness: 0.03,
    clearcoat: 0.18,
    clearcoatRoughness: 0.7,
  });

  // Procedural wood-grain bumps via a noise canvas, applied as bumpMap
  const grainTex = makeWoodGrainTexture();
  lightMat.bumpMap = grainTex;
  lightMat.bumpScale = 0.035;
  darkMat.bumpMap = grainTex;
  darkMat.bumpScale = 0.045;

  // Each square is a thin tile slightly above the frame
  const tileGeom = new THREE.BoxGeometry(SQUARE * 0.998, 0.04, SQUARE * 0.998);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = ((r + c) & 1) === 0;
      const mat = isLight ? lightMat : darkMat;
      const tile = new THREE.Mesh(tileGeom, mat);
      tile.position.set(...squareCenter(r, c, 0.02));
      tile.receiveShadow = true;
      tile.userData.square = { r, c };
      boardGroup.add(tile);
    }
  }

  // Rank/file labels (a-h, 1-8) on the frame as small thin rectangles
  // (We'll draw text via a canvas texture for crispness.)
  addBoardLabels();
}

/** A small CanvasTexture used as a bump map for the wood squares. */
function makeWoodGrainTexture() {
  const sz = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = sz;
  const ctx = cv.getContext('2d');
  // Base grey
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, sz, sz);
  // Horizontal grain streaks
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * sz;
    const len = sz * (0.6 + Math.random() * 0.4);
    const x = Math.random() * sz;
    const grey = 70 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
    const h = 1 + Math.random() * 2;
    ctx.fillRect(x, y, len, h);
  }
  // A few darker knots
  for (let i = 0; i < 6; i++) {
    const cx = Math.random() * sz;
    const cy = Math.random() * sz;
    const rr = 4 + Math.random() * 8;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    grad.addColorStop(0, '#333');
    grad.addColorStop(1, '#888');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

function addBoardLabels() {
  // Use a single canvas texture per side, one for files, one for ranks,
  // applied to thin meshes on the frame.
  const fileTex = labelTexture('abcdefgh', 'horizontal');
  const rankTex = labelTexture('12345678', 'vertical');

  const labelMat = (tex) => new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.85,
  });

  const fileGeomBottom = new THREE.PlaneGeometry(BOARD_SIZE, FRAME_W * 0.7);
  const fileBottom = new THREE.Mesh(fileGeomBottom, labelMat(fileTex));
  fileBottom.rotation.x = -Math.PI / 2;
  fileBottom.position.set(0, 0.025, BOARD_SIZE / 2 + FRAME_W * 0.5);
  boardGroup.add(fileBottom);

  const rankGeomLeft = new THREE.PlaneGeometry(FRAME_W * 0.7, BOARD_SIZE);
  const rankLeft = new THREE.Mesh(rankGeomLeft, labelMat(rankTex));
  rankLeft.rotation.x = -Math.PI / 2;
  rankLeft.position.set(-BOARD_SIZE / 2 - FRAME_W * 0.5, 0.025, 0);
  boardGroup.add(rankLeft);
}

function labelTexture(chars, orient) {
  const W = orient === 'horizontal' ? 1024 : 128;
  const H = orient === 'horizontal' ? 128 : 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#c2956a';
  ctx.font = `italic 600 56px "Cormorant Garamond", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (orient === 'horizontal') {
    const step = W / 8;
    for (let i = 0; i < 8; i++) {
      ctx.fillText(chars[i], step * (i + 0.5), H / 2);
    }
  } else {
    const step = H / 8;
    for (let i = 0; i < 8; i++) {
      // Ranks read 8..1 from top to bottom (white at the bottom)
      ctx.fillText(chars[7 - i], W / 2, step * (i + 0.5));
    }
  }
  return new THREE.CanvasTexture(cv);
}

// ─────────────────────────────────────────────────────────────
//  Piece placement / sync
// ─────────────────────────────────────────────────────────────

/** World coordinates of a square's center. */
function squareCenter(r, c, y = 0) {
  // Board is centred at origin. Without flip: r=0 is at +Z (back/top), c=0 is at -X (left).
  // Actually let's choose: r=0 (rank 8) at -Z (away from camera), r=7 (rank 1) at +Z (near camera).
  // c=0 (file 'a') at -X, c=7 (file 'h') at +X.
  let dr = r, dc = c;
  if (boardFlipped) {
    dr = 7 - r;
    dc = 7 - c;
  }
  const x = (dc - 3.5) * SQUARE;
  const z = (dr - 3.5) * SQUARE;
  return [x, y, z];
}

/** Rebuild every piece mesh from the current board state.
 *  Called after FEN load / undo. For simple moves we use animated transitions instead. */
function rebuildPieces() {
  pieceGroup.clear();
  pieceMeshes = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = game.pieceAt(r, c);
      if (p === 0) continue;
      const mesh = makePiece(p, materials);
      const [x, _, z] = squareCenter(r, c, 0);
      mesh.position.set(x, 0.04, z);
      pieceGroup.add(mesh);
      pieceMeshes[`${r},${c}`] = mesh;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Highlights
// ─────────────────────────────────────────────────────────────

function clearHighlights() {
  highlightGroup.clear();
}

function addSquareHighlight(r, c, color, opacity = 0.45) {
  const geom = new THREE.PlaneGeometry(SQUARE * 0.94, SQUARE * 0.94);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
  });
  const m = new THREE.Mesh(geom, mat);
  const [x, _, z] = squareCenter(r, c);
  m.position.set(x, 0.045, z);
  m.rotation.x = -Math.PI / 2;
  m.userData.highlight = true;
  highlightGroup.add(m);
}

function addLegalDot(r, c, capture = false) {
  const radius = capture ? 0.42 : 0.16;
  const geom = capture
    ? new THREE.RingGeometry(0.40, 0.46, 32)
    : new THREE.CircleGeometry(0.16, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: capture ? 0xc75450 : 0x809f6c,
    transparent: true, opacity: capture ? 0.7 : 0.65, depthWrite: false,
  });
  const m = new THREE.Mesh(geom, mat);
  const [x, _, z] = squareCenter(r, c);
  m.position.set(x, 0.046, z);
  m.rotation.x = -Math.PI / 2;
  highlightGroup.add(m);
}

function refreshHighlights() {
  clearHighlights();
  // Last move
  if (game.lastMove) {
    const { fr, fc, tr, tc } = game.lastMove;
    addSquareHighlight(fr, fc, 0xd9b07f, 0.32);
    addSquareHighlight(tr, tc, 0xd9b07f, 0.45);
  }
  // Selected
  if (selectedSquare) {
    addSquareHighlight(selectedSquare.r, selectedSquare.c, 0x809f6c, 0.55);
  }
  // Legal dests
  for (const sq of legalDestSquares) {
    const rc = Game.sqToRC(sq);
    if (!rc) continue;
    const tgt = game.pieceAt(rc.r, rc.c);
    addLegalDot(rc.r, rc.c, tgt !== 0);
  }
  // Hover cursor (subtle)
  if (hoveredSquare && !selectedSquare) {
    const p = game.pieceAt(hoveredSquare.r, hoveredSquare.c);
    if (p !== 0 && Math.sign(p) === (humanColor === 'w' ? 1 : -1)) {
      addSquareHighlight(hoveredSquare.r, hoveredSquare.c, 0xc2956a, 0.22);
    }
  }
  // Check glow
  if (game.status === 'CHECK' || game.status === 'CHECKMATE') {
    const kingPiece = (game.sideToMove === 'w' ? 6 : -6);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (game.pieceAt(r, c) === kingPiece) {
          addSquareHighlight(r, c, 0xc75450, 0.55);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Picking & input
// ─────────────────────────────────────────────────────────────

function pickSquareAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseVec, camera);
  // Intersect against everything in the board group; the squares carry userData.square.
  const intersects = raycaster.intersectObjects(boardGroup.children, false);
  for (const hit of intersects) {
    if (hit.object.userData && hit.object.userData.square) {
      return hit.object.userData.square;
    }
  }
  // Otherwise, intersect against the pieceGroup and convert position back to a square.
  const pi = raycaster.intersectObjects(pieceGroup.children, true);
  if (pi.length > 0) {
    const p = pi[0].point;
    return worldToSquare(p.x, p.z);
  }
  return null;
}

function worldToSquare(x, z) {
  const c = Math.round(x / SQUARE + 3.5);
  const r = Math.round(z / SQUARE + 3.5);
  let rr = r, cc = c;
  if (boardFlipped) {
    rr = 7 - rr;
    cc = 7 - cc;
  }
  if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return null;
  return { r: rr, c: cc };
}

function onPointerMove(ev) {
  if (busy || gameOver) return;
  const sq = pickSquareAt(ev.clientX, ev.clientY);
  const same = sq && hoveredSquare && sq.r === hoveredSquare.r && sq.c === hoveredSquare.c;
  if (!same) {
    hoveredSquare = sq;
    refreshHighlights();
  }
}

async function onPointerDown(ev) {
  if (ev.button !== 0) return;
  if (busy || gameOver) return;
  if (game.sideToMove !== humanColor) return;        // not your turn

  const sq = pickSquareAt(ev.clientX, ev.clientY);
  if (!sq) return;

  const piece = game.pieceAt(sq.r, sq.c);
  const myColor = humanColor === 'w' ? 1 : -1;

  if (selectedSquare) {
    // Try to move from selectedSquare -> sq
    if (sq.r === selectedSquare.r && sq.c === selectedSquare.c) {
      // Clicked the same square: deselect
      selectedSquare = null;
      legalDestSquares = [];
      refreshHighlights();
      return;
    }
    const fromSq = Game.rcToSq(selectedSquare.r, selectedSquare.c);
    const toSq = Game.rcToSq(sq.r, sq.c);
    if (legalDestSquares.includes(toSq)) {
      // Check for promotion: pawn moving to first/last rank
      const movingPiece = game.pieceAt(selectedSquare.r, selectedSquare.c);
      const promoRank = (movingPiece > 0) ? 0 : 7;
      const isPromotion = Math.abs(movingPiece) === 1 && sq.r === promoRank;
      if (isPromotion) {
        // Show the promotion picker; await user choice
        const promo = await askPromotion();
        await tryHumanMove(fromSq + toSq + promo);
      } else {
        await tryHumanMove(fromSq + toSq);
      }
      return;
    }
    // If they clicked one of their own pieces, switch selection
    if (piece !== 0 && Math.sign(piece) === myColor) {
      await selectSquare(sq);
      return;
    }
    // Otherwise: deselect
    selectedSquare = null;
    legalDestSquares = [];
    refreshHighlights();
    return;
  }

  // Nothing selected yet — pick up a piece
  if (piece !== 0 && Math.sign(piece) === myColor) {
    await selectSquare(sq);
  }
}

async function selectSquare(sq) {
  selectedSquare = sq;
  // Ask engine for legal moves from this square
  try {
    const sqStr = Game.rcToSq(sq.r, sq.c);
    legalDestSquares = await engine.legalFrom(sqStr);
  } catch (e) {
    console.error(e);
    legalDestSquares = [];
  }
  refreshHighlights();
}

// ─────────────────────────────────────────────────────────────
//  Move execution + animation
// ─────────────────────────────────────────────────────────────

async function tryHumanMove(moveStr) {
  busy = true;
  selectedSquare = null;
  legalDestSquares = [];
  refreshHighlights();

  // Send to engine
  let res;
  try {
    res = await engine.move(moveStr);
  } catch (e) {
    setCoach('Engine connection lost.', 'bad');
    busy = false;
    return;
  }
  if (!res.ok) {
    setCoach('Illegal move: ' + (res.error || 'unknown'), 'warn');
    busy = false;
    return;
  }

  // Animate the human's move on screen using engine-confirmed FEN
  const fr = parseInt(8 - parseInt(moveStr[1], 10), 10);
  const fc = moveStr.charCodeAt(0) - 'a'.charCodeAt(0);
  const tr = parseInt(8 - parseInt(moveStr[3], 10), 10);
  const tc = moveStr.charCodeAt(2) - 'a'.charCodeAt(0);
  const promoChar = moveStr.length >= 5 ? moveStr[4] : null;

  await animateMove(fr, fc, tr, tc, promoChar);

  // Sync game state from FEN (handles castling, en passant, etc.)
  game.loadFEN(res.fen);
  game.lastMove = { fr, fc, tr, tc };
  game.evalScore = res.evalScore;
  rebuildPieces();
  refreshHighlights();
  updateEvalUI(res.evalScore);
  if (res.feedback) {
    setCoach(res.feedback, classifyFeedback(res.feedback));
  } else if (res.explain) {
    setCoach(res.explain, 'good');
  }
  pushMoveHistory(moveStr, 'w' === game.sideToMove ? 'b' : 'w');

  // Check for end-of-game
  if (await checkGameStatus()) {
    busy = false;
    return;
  }

  // Now ask AI for its move
  setCoachTag('thinking…', 'warn');
  await sleep(80);
  let ai;
  try {
    ai = await engine.aiMove(aiDepth);
  } catch (e) {
    setCoach('Engine connection lost.', 'bad');
    busy = false;
    return;
  }
  if (!ai.ok) {
    setCoach('Engine error: ' + ai.error, 'bad');
    busy = false;
    return;
  }
  // Decode the AI move and animate it
  const aFr = 8 - parseInt(ai.move[1], 10);
  const aFc = ai.move.charCodeAt(0) - 'a'.charCodeAt(0);
  const aTr = 8 - parseInt(ai.move[3], 10);
  const aTc = ai.move.charCodeAt(2) - 'a'.charCodeAt(0);
  const aPromo = ai.move.length >= 5 ? ai.move[4] : null;
  await animateMove(aFr, aFc, aTr, aTc, aPromo);
  game.loadFEN(ai.fen);
  game.lastMove = { fr: aFr, fc: aFc, tr: aTr, tc: aTc };
  game.evalScore = ai.score;
  rebuildPieces();
  refreshHighlights();
  updateEvalUI(ai.score);
  setCoach(ai.explain || 'Engine made its move.', 'good');
  pushMoveHistory(ai.move, 'b' === game.sideToMove ? 'w' : 'b');

  // Check for end-of-game again
  await checkGameStatus();
  busy = false;
}

/** Animate a piece sliding from (fr,fc) to (tr,tc) with a small lift arc.
 *  Updates the in-memory pieceMeshes map but DOES NOT update game.board —
 *  that's done after by rebuildPieces() from the engine FEN. */
function animateMove(fr, fc, tr, tc, promoChar) {
  return new Promise(resolve => {
    const key = `${fr},${fc}`;
    const tkey = `${tr},${tc}`;
    const mover = pieceMeshes[key];
    if (!mover) { resolve(); return; }
    const captured = pieceMeshes[tkey];

    const [sx, , sz] = squareCenter(fr, fc, 0);
    const [ex, , ez] = squareCenter(tr, tc, 0);
    const startY = 0.04;
    const liftY = 0.6;
    const endY = 0.04;

    const T = 380; // ms
    const t0 = performance.now();

    // Captured piece fades out and sinks
    const capStartY = captured ? captured.position.y : 0;

    function step(now) {
      const t = Math.min(1, (now - t0) / T);
      // Ease in/out for smoothness
      const e = t * t * (3 - 2 * t);
      // Position
      mover.position.x = sx + (ex - sx) * e;
      mover.position.z = sz + (ez - sz) * e;
      // Arc: rises and falls
      const arc = Math.sin(Math.PI * e);
      mover.position.y = startY + arc * (liftY - startY) + (endY - startY) * e;
      // Slight rotation tilt during travel
      mover.rotation.z = -arc * 0.10 * Math.sign(ex - sx);

      // Captured: fade and sink
      if (captured) {
        const c = 1 - t;
        captured.position.y = capStartY - t * 0.3;
        captured.traverse(o => {
          if (o.material && 'opacity' in o.material) {
            o.material.transparent = true;
            o.material.opacity = c;
          }
        });
        if (t >= 1) {
          pieceGroup.remove(captured);
        }
      }

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        mover.position.set(ex, endY, ez);
        mover.rotation.z = 0;
        // Update the live mesh map
        delete pieceMeshes[key];
        if (captured) delete pieceMeshes[tkey];
        pieceMeshes[tkey] = mover;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

async function checkGameStatus() {
  const s = await engine.status();
  game.status = s.state;
  refreshHighlights();
  if (s.state === 'CHECKMATE') {
    gameOver = true;
    const winner = game.sideToMove === 'w' ? 'Black' : 'White';
    showModal('Checkmate', `${winner} wins.`);
    setCoach(`Checkmate — ${winner} wins.`, 'good');
    return true;
  }
  if (s.state === 'STALEMATE') {
    gameOver = true;
    showModal('Stalemate', 'The game is drawn.');
    setCoach('Stalemate — the game is drawn.', 'warn');
    return true;
  }
  if (s.state === 'CHECK') {
    setCoachTag('check', 'warn');
  } else {
    setCoachTag('ready', 'good');
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
//  UI integration
// ─────────────────────────────────────────────────────────────

function setupUI() {
  document.getElementById('btn-new').onclick = newGame;
  document.getElementById('btn-undo').onclick = undoMove;
  document.getElementById('btn-flip').onclick = flipBoard;
  document.getElementById('modal-new').onclick = () => {
    hideModal(); newGame();
  };

  // Difficulty
  const segDiff = document.getElementById('seg-diff');
  segDiff.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      segDiff.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aiDepth = parseInt(btn.dataset.val, 10);
    };
  });

  // Side
  const segSide = document.getElementById('seg-side');
  segSide.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      if (busy) return;
      segSide.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      humanColor = btn.dataset.val === 'white' ? 'w' : 'b';
      await newGame();
    };
  });

  // Promotion picker buttons
  document.querySelectorAll('#promo button[data-promo]').forEach(b => {
    b.onclick = () => {
      const choice = b.dataset.promo;
      hidePromotionPicker();
      if (pendingPromotion) {
        const r = pendingPromotion.resolve;
        pendingPromotion = null;
        r(choice);
      }
    };
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'u' || e.key === 'U') undoMove();
    if (e.key === 'n' || e.key === 'N') newGame();
    if (e.key === 'f' || e.key === 'F') flipBoard();
  });
}

async function newGame() {
  if (!engine || !engine.connected) return;
  busy = true;
  gameOver = false;
  hideModal();
  selectedSquare = null;
  legalDestSquares = [];
  hoveredSquare = null;
  game.history = [];
  game.lastMove = null;
  document.getElementById('moves').innerHTML = '';
  document.getElementById('move-count').textContent = '0';
  setCoach("New game. Make your move when you're ready.", 'good');
  setCoachTag('ready', 'good');

  try {
    const r = await engine.newGame();
    if (r.ok) {
      game.loadFEN(r.fen);
      // Apply flip based on which side the human plays
      boardFlipped = (humanColor === 'b');
      rebuildPieces();
      refreshHighlights();
      updateTurnPill();
      updateEvalUI(0);
      // If user is black, AI plays first
      if (humanColor === 'b') {
        await sleep(120);
        const ai = await engine.aiMove(aiDepth);
        if (ai.ok) {
          const aFr = 8 - parseInt(ai.move[1], 10);
          const aFc = ai.move.charCodeAt(0) - 'a'.charCodeAt(0);
          const aTr = 8 - parseInt(ai.move[3], 10);
          const aTc = ai.move.charCodeAt(2) - 'a'.charCodeAt(0);
          await animateMove(aFr, aFc, aTr, aTc);
          game.loadFEN(ai.fen);
          game.lastMove = { fr: aFr, fc: aFc, tr: aTr, tc: aTc };
          rebuildPieces();
          refreshHighlights();
          setCoach(ai.explain || 'Engine moved.', 'good');
          pushMoveHistory(ai.move, 'w');
          updateEvalUI(ai.score);
        }
      }
    }
  } catch (e) {
    console.error(e);
    setCoach('Engine connection lost.', 'bad');
  }
  updateTurnPill();
  busy = false;
}

async function undoMove() {
  if (busy || !engine.connected) return;
  busy = true;
  // Undo the last AI move and the last human move so it's the human's turn again
  try {
    let r1 = await engine.undo();
    if (!r1.ok) { busy = false; return; }
    if (game.history.length >= 2) {
      // Also undo the human's previous move so we land back on the human's turn
      const r2 = await engine.undo();
      if (r2.ok) {
        game.history.pop();
        game.history.pop();
      } else {
        game.history.pop();
      }
    } else {
      game.history.pop();
    }
    // Reload board from latest engine state
    const latest = await engine.send('BOARD');
    if (latest.startsWith('BOARD ')) {
      game.loadFEN(latest.slice(6).trim());
    }
    game.lastMove = null;
    gameOver = false;
    hideModal();
    rebuildPieces();
    refreshHighlights();
    updateTurnPill();
    rebuildMovesList();
    setCoach('Move taken back.', 'good');
  } catch (e) {
    console.error(e);
  }
  busy = false;
}

function flipBoard() {
  boardFlipped = !boardFlipped;
  rebuildPieces();
  refreshHighlights();
  // Also rotate the camera around to the other side
  controls.target.set(0, 0, 0);
  // Mirror the camera angle around the Z axis
  const p = camera.position;
  camera.position.set(-p.x, p.y, -p.z);
}

function startGame() {
  // initial connection success — kick off a new game in default config
  return newGame();
}

function setCoach(text, kind = 'good') {
  const el = document.getElementById('coach-text');
  el.textContent = text;
  el.classList.remove('flash');
  // re-trigger animation
  void el.offsetWidth;
  el.classList.add('flash');
  setCoachTag(kind === 'bad' ? 'mistake' : kind === 'warn' ? 'careful' : 'ready',
              kind);
}

function setCoachTag(text, kind = 'good') {
  const tag = document.getElementById('coach-tag');
  tag.textContent = text;
  tag.classList.remove('tag-good', 'tag-warn', 'tag-bad');
  tag.classList.add(kind === 'bad' ? 'tag-bad' : kind === 'warn' ? 'tag-warn' : 'tag-good');
}

function classifyFeedback(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('blunder') || lower.includes('mistake')) return 'bad';
  if (lower.includes('inaccuracy')) return 'warn';
  if (lower.includes('excellent') || lower.includes('good move')) return 'good';
  return 'good';
}

function updateConnBadge(s) {
  const el = document.getElementById('conn-badge');
  el.classList.remove('online', 'offline', 'error');
  if (s.state === 'online') {
    el.classList.add('online');
    el.textContent = 'engine online';
  } else if (s.state === 'error') {
    el.classList.add('error');
    el.textContent = s.msg || 'engine error';
  } else {
    el.classList.add('offline');
    el.textContent = 'engine offline';
  }
}

function updateEvalUI(score) {
  const el = document.getElementById('eval-value');
  const cp = score / 100;
  el.textContent = (cp >= 0 ? '+' : '') + cp.toFixed(2);
  // Map -10..+10 cp to 0..100% fill (clamped)
  const fill = Math.max(0, Math.min(100, 50 + (cp / 10) * 50));
  document.getElementById('eval-fill').style.width = fill + '%';
}

function updateTurnPill() {
  document.getElementById('turn-pill').textContent =
    game.sideToMove === 'w' ? 'White' : 'Black';
}

function pushMoveHistory(moveStr, color) {
  game.history.push({ moveStr, color });
  rebuildMovesList();
}

function rebuildMovesList() {
  const list = document.getElementById('moves');
  list.innerHTML = '';
  // Pair white+black moves into one row each
  for (let i = 0; i < game.history.length; i += 2) {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = (i / 2 + 1) + '.';
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = game.history[i] ? prettyMove(game.history[i].moveStr) : '';
    const b = document.createElement('span');
    b.className = 'b';
    b.textContent = game.history[i + 1] ? prettyMove(game.history[i + 1].moveStr) : '';
    li.appendChild(num);
    li.appendChild(w);
    li.appendChild(b);
    if (i + 2 >= game.history.length) li.classList.add('last');
    list.appendChild(li);
  }
  document.getElementById('move-count').textContent =
    Math.ceil(game.history.length / 2);
  list.scrollTop = list.scrollHeight;
}

function prettyMove(uci) {
  // Just format e2e4 -> e2-e4 for readability
  if (!uci || uci.length < 4) return uci || '';
  const promo = uci.length >= 5 ? '=' + uci[4].toUpperCase() : '';
  return uci.slice(0, 2) + '–' + uci.slice(2, 4) + promo;
}

function showModal(title, msg) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('modal').classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modal').classList.add('hidden');
}

function askPromotion() {
  document.getElementById('promo').classList.remove('hidden');
  return new Promise(resolve => {
    pendingPromotion = { resolve };
  });
}

function hidePromotionPicker() {
  document.getElementById('promo').classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
//  Resize / animate
// ─────────────────────────────────────────────────────────────

function onResize() { resize(); }

function resize() {
  const w = canvasHost.clientWidth;
  const h = canvasHost.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function animate() {
  controls.update();
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);
