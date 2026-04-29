// pieces.js — procedural Staunton chess piece geometry.
//
// Each piece (except the knight) is a body of revolution: we define a 2D
// silhouette (an array of [radius, height] points) and use THREE.LatheGeometry
// to spin it around the Y axis. This produces beautifully smooth, real 3D
// pieces with proper lighting in WebGL — the same technique used by serious
// chess apps. The knight is a custom mesh built from box & sphere primitives,
// shaped to read as a horse head in profile.

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
//  Shared constants
// ─────────────────────────────────────────────────────────────

// Piece heights (game units). Square = 1.0 unit wide.
export const PIECE_HEIGHTS = {
  pawn:   0.95,
  knight: 1.05,
  bishop: 1.20,
  rook:   1.00,
  queen:  1.30,
  king:   1.40,
};

const LATHE_SEGMENTS = 48;   // segments around Y axis — high = smooth

// ─────────────────────────────────────────────────────────────
//  Profile helpers
// ─────────────────────────────────────────────────────────────

/** Build a smooth profile from waypoints by linear interpolation + Catmull-Rom subdivision.
 *  pts: array of [r, y] (radius, height-from-bottom)
 *  subdiv: how many segments between each pair of waypoints (controls smoothness)
 */
function buildProfile(pts, subdiv = 6) {
  // Use Catmull-Rom interpolation to round out the profile
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([r, y]) => new THREE.Vector3(r, y, 0)),
    false, 'catmullrom', 0.0
  );
  const samples = curve.getPoints((pts.length - 1) * subdiv);
  // Convert to 2D Vector2s for LatheGeometry
  return samples.map(p => new THREE.Vector2(Math.max(0.001, p.x), p.y));
}

function lathe(profile, segments = LATHE_SEGMENTS) {
  const g = new THREE.LatheGeometry(profile, segments);
  g.computeVertexNormals();
  return g;
}

// ─────────────────────────────────────────────────────────────
//  Materials
// ─────────────────────────────────────────────────────────────

export function makeMaterials() {
  // White: warm ivory with subtle clearcoat
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xe6dcc4,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    sheen: 0.2,
    sheenColor: 0xffe6c0,
    sheenRoughness: 0.6,
  });

  // Black: deep obsidian-ish material
  const black = new THREE.MeshPhysicalMaterial({
    color: 0x1a1612,
    roughness: 0.38,
    metalness: 0.08,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    sheen: 0.3,
    sheenColor: 0x664433,
    sheenRoughness: 0.5,
  });

  return { white, black };
}

// ─────────────────────────────────────────────────────────────
//  Piece silhouettes  ([radius, y] from bottom up)
//  All radii in board-units; pieces are roughly 0.8 wide on a 1.0 square.
// ─────────────────────────────────────────────────────────────

const PROFILE_PAWN = [
  [0.32, 0.00],   // bottom of base
  [0.34, 0.02],
  [0.36, 0.06],   // base disc
  [0.34, 0.08],
  [0.30, 0.10],   // base top
  [0.20, 0.12],   // taper into stem
  [0.17, 0.16],
  [0.20, 0.22],   // small ring above stem
  [0.18, 0.26],
  [0.15, 0.32],
  [0.13, 0.46],   // narrow neck — single smooth taper to neck
  [0.16, 0.52],   // collar (subtle)
  [0.14, 0.56],
  [0.10, 0.62],   // narrowest point right under head
  [0.20, 0.72],   // head sphere bottom — bigger jump for cleaner sphere
  [0.22, 0.78],
  [0.20, 0.84],
  [0.14, 0.90],
  [0.06, 0.94],
  [0.00, 0.95],
];

const PROFILE_ROOK = [
  [0.34, 0.00],
  [0.36, 0.02],
  [0.38, 0.05],   // base disc
  [0.36, 0.08],
  [0.32, 0.11],
  [0.27, 0.14],   // taper
  [0.24, 0.18],
  [0.27, 0.22],   // ring
  [0.24, 0.26],
  [0.23, 0.30],
  [0.24, 0.40],   // tower body
  [0.25, 0.55],
  [0.26, 0.68],   // tower bulge
  [0.30, 0.74],   // top platform
  [0.31, 0.78],
  [0.30, 0.82],
  [0.30, 0.92],   // crenellation outer
  [0.30, 0.96],
  [0.27, 1.00],
];

const PROFILE_BISHOP = [
  [0.32, 0.00],
  [0.34, 0.02],
  [0.36, 0.05],   // base
  [0.34, 0.08],
  [0.30, 0.11],
  [0.24, 0.14],   // taper
  [0.20, 0.18],
  [0.23, 0.22],   // collar
  [0.20, 0.26],
  [0.18, 0.30],
  [0.16, 0.40],
  [0.18, 0.55],   // body bulge
  [0.20, 0.65],
  [0.20, 0.75],
  [0.18, 0.86],
  [0.14, 0.93],   // top of body
  [0.08, 0.99],
  [0.06, 1.04],   // stem
  [0.10, 1.10],   // ball finial
  [0.12, 1.13],
  [0.10, 1.16],
  [0.06, 1.19],
  [0.00, 1.20],
];

const PROFILE_QUEEN = [
  [0.36, 0.00],
  [0.38, 0.02],
  [0.40, 0.05],   // wide base
  [0.38, 0.08],
  [0.34, 0.11],
  [0.27, 0.14],
  [0.23, 0.18],
  [0.26, 0.22],   // collar
  [0.23, 0.26],
  [0.22, 0.30],
  [0.21, 0.40],
  [0.23, 0.55],   // body
  [0.25, 0.68],   // hips
  [0.24, 0.80],
  [0.21, 0.90],
  [0.20, 0.96],
  [0.26, 1.02],   // crown band bottom
  [0.28, 1.06],   // crown band top
  [0.27, 1.12],
  [0.20, 1.18],
  [0.14, 1.24],
  [0.06, 1.28],
  [0.00, 1.30],
];

const PROFILE_KING = [
  [0.38, 0.00],
  [0.40, 0.02],
  [0.42, 0.05],   // wider than queen
  [0.40, 0.08],
  [0.36, 0.11],
  [0.29, 0.14],
  [0.25, 0.18],
  [0.28, 0.22],   // collar
  [0.25, 0.26],
  [0.24, 0.30],
  [0.23, 0.40],
  [0.25, 0.55],   // body
  [0.27, 0.68],   // hips
  [0.26, 0.80],
  [0.23, 0.92],
  [0.22, 1.00],
  [0.28, 1.06],   // crown band
  [0.30, 1.10],
  [0.28, 1.16],
  [0.18, 1.20],   // narrows to support cross
];

// ─────────────────────────────────────────────────────────────
//  Piece factories
// ─────────────────────────────────────────────────────────────

export function makePawn(material) {
  const profile = buildProfile(PROFILE_PAWN);
  const mesh = new THREE.Mesh(lathe(profile), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function makeBishop(material) {
  const group = new THREE.Group();
  const profile = buildProfile(PROFILE_BISHOP);
  const body = new THREE.Mesh(lathe(profile), material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Diagonal slit cut (suggested with a thin dark inset disc)
  // Build a small dark sliver disk that tilts and intersects the mitre.
  const slitGeom = new THREE.BoxGeometry(0.34, 0.02, 0.04);
  const slitMat  = new THREE.MeshStandardMaterial({
    color: 0x100a06, roughness: 0.9, metalness: 0,
  });
  const slit = new THREE.Mesh(slitGeom, slitMat);
  slit.position.y = 0.92;
  slit.rotation.z = -Math.PI * 0.15;
  slit.castShadow = false;
  group.add(slit);

  return group;
}

export function makeQueen(material) {
  const group = new THREE.Group();
  const profile = buildProfile(PROFILE_QUEEN);
  const body = new THREE.Mesh(lathe(profile), material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Crown — 8 tapered spikes around the top, each with a small ball finial
  const spikeGeom = new THREE.ConeGeometry(0.045, 0.12, 12, 1, false);
  const ballGeom  = new THREE.SphereGeometry(0.05, 20, 16);
  const N = 8;
  const ringR = 0.20;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + Math.PI / N; // offset for symmetry
    const x = Math.cos(angle) * ringR;
    const z = Math.sin(angle) * ringR;
    // Spike (cone)
    const spike = new THREE.Mesh(spikeGeom, material);
    spike.position.set(x, 1.10, z);
    spike.castShadow = true;
    group.add(spike);
    // Pearl on top of spike
    const ball = new THREE.Mesh(ballGeom, material);
    ball.position.set(x, 1.18, z);
    ball.castShadow = true;
    group.add(ball);
  }
  // Center spike — taller and capped with a slightly larger pearl
  const centerSpike = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.14, 14, 1, false), material);
  centerSpike.position.set(0, 1.13, 0);
  centerSpike.castShadow = true;
  group.add(centerSpike);
  const centerBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 22, 18), material);
  centerBall.position.set(0, 1.22, 0);
  centerBall.castShadow = true;
  group.add(centerBall);

  return group;
}

export function makeKing(material) {
  const group = new THREE.Group();
  const profile = buildProfile(PROFILE_KING);
  const body = new THREE.Mesh(lathe(profile), material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Cross on top — vertical bar
  const vBarGeom = new THREE.BoxGeometry(0.06, 0.18, 0.06);
  const vBar = new THREE.Mesh(vBarGeom, material);
  vBar.position.y = 1.30;
  vBar.castShadow = true;
  group.add(vBar);

  // Horizontal bar
  const hBarGeom = new THREE.BoxGeometry(0.16, 0.05, 0.05);
  const hBar = new THREE.Mesh(hBarGeom, material);
  hBar.position.y = 1.30;
  hBar.castShadow = true;
  group.add(hBar);

  // Tiny ball at the very top of the cross
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 14), material);
  ball.position.y = 1.42;
  ball.castShadow = true;
  group.add(ball);

  return group;
}

export function makeRook(material) {
  const group = new THREE.Group();
  const profile = buildProfile(PROFILE_ROOK);
  const body = new THREE.Mesh(lathe(profile), material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Battlements: 4 notches cut into the top — implemented as 4 small boxes
  // sitting on top of the platform.
  const notchGeom = new THREE.BoxGeometry(0.10, 0.10, 0.10);
  const notchPositions = [
    [ 0.18,  1.06,  0.00],
    [-0.18,  1.06,  0.00],
    [ 0.00,  1.06,  0.18],
    [ 0.00,  1.06, -0.18],
  ];
  notchPositions.forEach(([x, y, z]) => {
    const n = new THREE.Mesh(notchGeom, material);
    n.position.set(x, y, z);
    n.castShadow = true;
    n.receiveShadow = true;
    group.add(n);
  });

  return group;
}

// ─────────────────────────────────────────────────────────────
//  Knight — custom mesh, not a body of revolution
//  Built from a torso (shoulder of a body-of-revolution) + a sculpted
//  horse head made from primitive solids stretched and rotated.
// ─────────────────────────────────────────────────────────────

const PROFILE_KNIGHT_BASE = [
  [0.34, 0.00],
  [0.36, 0.02],
  [0.38, 0.05],
  [0.36, 0.08],
  [0.32, 0.11],
  [0.27, 0.14],
  [0.24, 0.18],
  [0.27, 0.22],
  [0.24, 0.26],
  [0.22, 0.30],
  [0.20, 0.35],
];

export function makeKnight(material) {
  const group = new THREE.Group();

  // Base
  const base = new THREE.Mesh(lathe(buildProfile(PROFILE_KNIGHT_BASE)), material);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Neck — tapering cylinder rising from the base, leaning forward (toward +X)
  const neckGeom = new THREE.CylinderGeometry(0.16, 0.22, 0.50, 28, 4, false);
  const neck = new THREE.Mesh(neckGeom, material);
  neck.position.set(0.04, 0.58, 0);
  neck.rotation.z = -0.22;
  neck.castShadow = true;
  group.add(neck);

  // Head crown — a small ovoid (sphere stretched in X) sitting on the neck
  const crownGeom = new THREE.SphereGeometry(0.18, 24, 18);
  const crown = new THREE.Mesh(crownGeom, material);
  crown.position.set(0.06, 0.96, 0);
  crown.scale.set(1.0, 0.9, 0.85);
  crown.castShadow = true;
  group.add(crown);

  // Long muzzle — extends forward (+X) from the head
  // Use a tapering cylinder rotated so its axis points along +X
  const muzGeom = new THREE.CylinderGeometry(0.10, 0.13, 0.36, 24, 1, false);
  const muz = new THREE.Mesh(muzGeom, material);
  muz.position.set(0.30, 0.84, 0);
  muz.rotation.z = -Math.PI / 2 - 0.18;   // axis along +X, slight downward tilt
  muz.castShadow = true;
  group.add(muz);

  // Muzzle tip cap — tiny rounded end
  const tipGeom = new THREE.SphereGeometry(0.10, 18, 14);
  const tip = new THREE.Mesh(tipGeom, material);
  tip.position.set(0.46, 0.78, 0);
  tip.scale.set(1.0, 0.85, 0.85);
  tip.castShadow = true;
  group.add(tip);

  // Forehead bevel between crown and muzzle (smooths the transition)
  const foreGeom = new THREE.SphereGeometry(0.14, 18, 14);
  const fore = new THREE.Mesh(foreGeom, material);
  fore.position.set(0.18, 0.94, 0);
  fore.scale.set(0.9, 0.7, 0.85);
  fore.castShadow = true;
  group.add(fore);

  // Two ears — pointed cones pointing up-and-back
  const earGeom = new THREE.ConeGeometry(0.04, 0.13, 14);
  const earL = new THREE.Mesh(earGeom, material);
  earL.position.set(-0.02, 1.10, 0.10);
  earL.rotation.set(0.10, 0, -0.30);
  earL.castShadow = true;
  group.add(earL);
  const earR = earL.clone();
  earR.position.z = -0.10;
  earR.rotation.set(-0.10, 0, -0.30);
  group.add(earR);

  // Mane — slab on the back of the neck, slightly darker
  const maneGeom = new THREE.BoxGeometry(0.10, 0.55, 0.26);
  const maneMat = material.clone();
  if (maneMat.color) {
    const c = maneMat.color.clone();
    c.multiplyScalar(0.78);
    maneMat.color = c;
  }
  const mane = new THREE.Mesh(maneGeom, maneMat);
  mane.position.set(-0.20, 0.62, 0);
  mane.rotation.z = 0.20;
  mane.castShadow = true;
  group.add(mane);

  // Top of mane — small tuft above the crown
  const tuftGeom = new THREE.BoxGeometry(0.06, 0.10, 0.20);
  const tuft = new THREE.Mesh(tuftGeom, maneMat);
  tuft.position.set(-0.07, 1.04, 0);
  tuft.rotation.z = 0.30;
  tuft.castShadow = true;
  group.add(tuft);

  // Eyes — small dark spheres
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x080604, roughness: 0.2, metalness: 0.4,
  });
  const eyeGeom = new THREE.SphereGeometry(0.025, 12, 10);
  const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
  eyeL.position.set(0.18, 0.96, 0.13);
  group.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.z = -0.13;
  group.add(eyeR);

  // Nostrils
  const nostGeom = new THREE.SphereGeometry(0.018, 10, 8);
  const nostL = new THREE.Mesh(nostGeom, eyeMat);
  nostL.position.set(0.46, 0.74, 0.05);
  group.add(nostL);
  const nostR = nostL.clone();
  nostR.position.z = -0.05;
  group.add(nostR);

  // Mouth line — thin dark bar across the muzzle tip
  const mouthGeom = new THREE.BoxGeometry(0.02, 0.018, 0.12);
  const mouth = new THREE.Mesh(mouthGeom, eyeMat);
  mouth.position.set(0.50, 0.74, 0);
  mouth.rotation.z = -0.30;
  group.add(mouth);

  return group;
}

// ─────────────────────────────────────────────────────────────
//  Build a piece by name
// ─────────────────────────────────────────────────────────────

export function makePiece(typeCode, materials) {
  // typeCode: 1..6 = pawn..king. Sign indicates color (positive=white).
  const isWhite = typeCode > 0;
  const t = Math.abs(typeCode);
  const mat = isWhite ? materials.white : materials.black;
  let mesh;
  switch (t) {
    case 1: mesh = makePawn(mat);   break;
    case 2: mesh = makeKnight(mat); break;
    case 3: mesh = makeBishop(mat); break;
    case 4: mesh = makeRook(mat);   break;
    case 5: mesh = makeQueen(mat);  break;
    case 6: mesh = makeKing(mat);   break;
    default: throw new Error('Unknown piece type: ' + typeCode);
  }
  // Black knights face -X (toward white side). Rotate other black pieces too
  // for visual symmetry — none of them are asymmetric except the knight.
  if (!isWhite && t === 2) {
    mesh.rotation.y = Math.PI;
  }
  // Tag for picking
  mesh.userData.pieceType = typeCode;
  // Each child too — so raycaster can find them
  mesh.traverse(o => {
    o.userData.pieceType = typeCode;
  });
  return mesh;
}
