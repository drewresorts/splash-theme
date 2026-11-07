/**
 * Pollen Dream's world: where the letters are hidden, and what it takes to
 * reach them (assets/pollen-dream.js loads it, after the letters,
 * assets/pollen-dream-cast.js).
 *
 * Out past the garden, three places are shaped into the land, each with
 * its own creatures, a puzzle, and a letter; each puzzle gives the thing
 * the next place needs:
 *
 *   The lake: frogs on the stones by a dock, ducks on the water, and a ship
 *   anchored out in the middle with the U on deck. Ring the bell on the dock
 *   and the four frogs croak in turn; boop them in the same order and lily
 *   pads rise across the water to the ship's gangplank. On deck: a rope
 *   ladder.
 *
 *   The forest: pines all round a clearing with a giant tree, a fort high up
 *   in it with the E, and a mother owl in the way. Her three owlets are lost
 *   in the woods: find them and call them home, and she lets you hang the
 *   rope ladder and climb. In the fort: a chest with a key.
 *
 *   The mountain: a fence round it, goats on its slopes, and on the snowy top
 *   a cabin with the T shut in. The key opens the gate. Three cairns on the
 *   slopes each fly a colored flag over one, two or three stones; ring the
 *   cabin's bells in that order and the door opens.
 *
 * A signpost where the D starts points the way to each. The world runs as a
 * garden explore hook: it shapes the land (garden.setLandFeatures), gives
 * the garden what can be stood on (garden.surfaceAt: decks, the dock, the
 * pads, the fort) and where the letters stand (garden.exploreFloor), keeps
 * the D out of the water, through the fence only at the open gate, and out
 * of tree trunks, and offers what there is to do near the D as a prompt
 * (world.prompt, world.act()).
 */
import * as THREE from './three.module.min.js';

const FLOOR_Z = -45; // the garden's ground plane (garden-splash.js FLOOR_Z)
const TAU = Math.PI * 2;
const STEP = 32; // how far down onto something the D still steps up onto it
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
// A heading as the garden's explorer uses them: forward is (-sin h, cos h).
const headingOf = (dx, dy) => Math.atan2(-dx, dy);

const BELLS = [
  { name: 'coral', color: 0xf04e62 },
  { name: 'teal', color: 0x2fa6a0 },
  { name: 'gold', color: 0xf2b246 },
];
const FROGS = [
  { name: 'coral', color: 0xf04e62 },
  { name: 'teal', color: 0x2fa6a0 },
  { name: 'gold', color: 0xf2b246 },
  { name: 'violet', color: 0x8e6bd8 },
];

const SAY = {
  start: 'Where did everyone go? The signpost might know.',
  lake: 'A lake, a ship out on the water… and frogs by the dock.',
  forest: 'Tall pines. Somewhere up above, something hoots.',
  mountain: 'A fence all round the mountain, and a cabin way up top.',
  frogsListen: 'Listen…',
  frogsGo: 'Your turn. Boop them in the same order.',
  frogsWrong: 'Ribbit! Wrong order. Ring the bell to hear it again.',
  frogsDone: 'The frogs leap in, and lily pads rise across the water!',
  rope: 'A rope ladder! Something tall must need it.',
  owlAsk: 'Hoo! My three owlets are lost in the woods. Bring them home and I’ll let you up.',
  owlet: 'The owlet flaps home. Hoo!',
  owlDone: 'Hoo-hoo! Thank you. Up you go… if you can.',
  noRope: 'Nothing to climb with. A rope ladder would do it.',
  hung: 'The rope ladder hangs down from the fort.',
  key: 'A brass key! It must open something on the mountain.',
  locked: 'Locked tight. There must be a key somewhere.',
  unlocked: 'Click! The gate swings open.',
  bellsWrong: 'Clang! Not that tune. The mountain might hold a clue.',
  bellsDone: 'The door creaks open…',
};

/* A board's lettering, drawn on a canvas. */
function textTexture(text, w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#f4ecdc';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#191f6b';
  g.font = `500 ${Math.round(h * 0.5)}px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const spaced = text.split('').join(String.fromCharCode(8202));
  g.fillText(spaced, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function addWorld(garden, cast) {
  const E0 = garden.explorer;
  if (!E0) return null;
  const span = Math.max(garden.w, garden.h);
  const size = E0.eye * 1.25; // a letter's height
  const cx = garden.w / 2;
  const cy = garden.h / 2;
  const start = E0.to || { x: E0.x, y: E0.y };
  const away = (a, d) => ({ x: cx - Math.sin(a) * span * d, y: cy + Math.cos(a) * span * d });
  const LAKE = Object.assign(away(0.55, 6.2), { r: span * 2 });
  const FOREST = Object.assign(away(-1.0, 6.0), { r: span * 2 });
  const MOUNT = Object.assign(away(Math.PI - 0.25, 7.2), { r: span * 2.3, h: span * 1.8 });
  const lakeBed = -span * 0.16;
  const water = -span * 0.06; // the lake's surface, above FLOOR_Z
  garden.setLandFeatures(
    [
      { x: LAKE.x, y: LAKE.y, r: LAKE.r, h: lakeBed, kind: 'basin' },
      { x: FOREST.x, y: FOREST.y, r: FOREST.r, h: 0, kind: 'flat' },
      { x: MOUNT.x, y: MOUNT.y, r: MOUNT.r, h: MOUNT.h, kind: 'peak' },
    ],
    { water }
  );
  const land = (x, y) => garden.hillAt(x, y, true); // above FLOOR_Z, the land alone
  const inLake = (x, y) => Math.hypot(x - LAKE.x, y - LAKE.y) < LAKE.r && land(x, y) < water;

  const group = new THREE.Group();
  garden.scene.add(group);
  const disposables = [];
  const mat = (color, extra) => {
    const m = garden.makeMaterial(Object.assign({ color }, extra));
    disposables.push(m);
    return m;
  };
  const geo = (g) => {
    disposables.push(g);
    return g;
  };
  const mesh = (g, m, parent = group) => {
    const o = new THREE.Mesh(g, m);
    parent.add(o);
    return o;
  };
  const W = {
    wood: mat(0x8a5a36),
    darkWood: mat(0x5b3a22),
    plank: mat(0xb88a5a),
    // Canvas lit from within a little, so it reads white from either side, not grey in its own shade.
    sail: mat(0xf6f1e6, { side: THREE.DoubleSide, emissive: 0x6a665e }),
    rock: mat(0x8d8f92),
    pine: mat(0x2f5a3a),
    pine2: mat(0x3d6e45),
    trunk: mat(0x6b4a2e),
    leaf: mat(0x4f8a4a),
    pad: mat(0x5e9e4a, { side: THREE.DoubleSide }),
    roof: mat(0xa23b3b),
    white: mat(0xffffff),
    black: mat(0x15151a),
    gold: mat(0xe0b040, { shininess: 80, specular: 0x777777, flatShading: false }),
    owl: mat(0x8b6a4a),
    belly: mat(0xd9c3a0),
    eye: mat(0xf2c230, { flatShading: false }),
    goat: mat(0xf0ece4),
    horn: mat(0x9a8a70),
    duck: mat(0xf7f3ea),
    beak: mat(0xf0a030),
    duckHead: mat(0x2e6b4a),
  };

  /* ---------- what can be stood on, and what is in the way ---------- */

  // Things to stand on: discs and (turned) rectangles, flat or sloping along their length.
  const surfaces = [];
  const disc = (x, y, r, z, on = true) => {
    const S = { kind: 'disc', x, y, r, z, on };
    surfaces.push(S);
    return S;
  };
  const rect = (x, y, ang, hl, hw, z0, z1 = z0, on = true) => {
    const S = { kind: 'rect', x, y, ca: Math.cos(ang), sa: Math.sin(ang), hl, hw, z0, z1, on };
    surfaces.push(S);
    return S;
  };
  const topOf = (S, x, y) => {
    if (S.kind === 'disc') return Math.hypot(x - S.x, y - S.y) <= S.r ? S.z : -Infinity;
    const dx = x - S.x;
    const dy = y - S.y;
    const u = dx * S.ca + dy * S.sa;
    const v = -dx * S.sa + dy * S.ca;
    if (Math.abs(u) > S.hl || Math.abs(v) > S.hw) return -Infinity;
    return lerp(S.z0, S.z1, (u + S.hl) / (2 * S.hl));
  };
  let qz = null; // the height being asked about (feet, above FLOOR_Z); null: the D's
  garden.surfaceAt = (x, y, h) => {
    const ex = garden.explorer;
    const feet = qz !== null ? qz : ex ? ex.z - ex.eye - FLOOR_Z : Infinity;
    let best = h;
    for (const S of surfaces) {
      if (!S.on) continue;
      const t = topOf(S, x, y);
      if (t > best && feet >= t - STEP) best = t;
    }
    return best;
  };
  // Where a letter at height z stands: on what is under it, or wading on the lake.
  garden.exploreFloor = (x, y, z) => {
    qz = z - FLOOR_Z;
    let h = garden.hillAt(x, y);
    qz = null;
    if (inLake(x, y)) h = Math.max(h, water);
    return FLOOR_Z + h;
  };
  // Circles in the way (trunks, the cabin, rocks), up to a height.
  const blocks = [];
  const block = (x, y, r, top = Infinity) => {
    const b = { x, y, r, top };
    blocks.push(b);
    return b;
  };

  /* ---------- the lake ---------- */

  const zw = FLOOR_Z + water;
  const waterMat = mat(0x3f8fb0, { transparent: true, opacity: 0.86, shininess: 90, specular: 0x9ab8c8, flatShading: false });
  const sea = mesh(geo(new THREE.CircleGeometry(LAKE.r * 0.97, 96)), waterMat);
  sea.position.set(LAKE.x, LAKE.y, zw);
  // The dock: from the shore nearest the garden, out into the water.
  const toLake = { x: LAKE.x - start.x, y: LAKE.y - start.y };
  const tl = Math.hypot(toLake.x, toLake.y);
  const dIn = { x: toLake.x / tl, y: toLake.y / tl }; // from the shore toward the middle
  let shoreS = LAKE.r;
  for (let s = LAKE.r * 0.5; s < LAKE.r; s += size * 0.25) {
    if (land(LAKE.x - dIn.x * s, LAKE.y - dIn.y * s) > water + 6) {
      shoreS = s;
      break;
    }
  }
  const shore = { x: LAKE.x - dIn.x * shoreS, y: LAKE.y - dIn.y * shoreS };
  const dockLen = size * 6;
  const dockEnd = { x: shore.x + dIn.x * (dockLen - size), y: shore.y + dIn.y * (dockLen - size) };
  const dockAng = Math.atan2(dIn.y, dIn.x);
  const dockZ = water + 10;
  const dockMid = { x: shore.x + dIn.x * (dockLen / 2 - size), y: shore.y + dIn.y * (dockLen / 2 - size) };
  rect(dockMid.x, dockMid.y, dockAng, dockLen / 2, size * 0.65, dockZ);
  const dock = mesh(geo(new THREE.BoxGeometry(dockLen, size * 1.3, 6)), W.plank);
  dock.position.set(dockMid.x, dockMid.y, FLOOR_Z + dockZ - 3);
  dock.rotation.z = dockAng;
  const postGeo = geo(new THREE.CylinderGeometry(size * 0.08, size * 0.08, size * 1.4, 6));
  for (let k = 0; k < 4; k++) {
    for (const side of [-1, 1]) {
      const along = (k / 3) * dockLen - size;
      const p = mesh(postGeo, W.darkWood);
      p.rotation.x = Math.PI / 2;
      p.position.set(shore.x + dIn.x * along - dIn.y * side * size * 0.6, shore.y + dIn.y * along + dIn.x * side * size * 0.6, FLOOR_Z + dockZ - size * 0.4);
    }
  }
  // The ship, broadside to the dock, a way out.
  const shipL = size * 7;
  const shipB = size * 2.2;
  const deckH = size * 0.9;
  const ship = { x: dockEnd.x + dIn.x * (size * 12 + shipB / 2), y: dockEnd.y + dIn.y * (size * 12 + shipB / 2) };
  const shipAng = dockAng + Math.PI / 2;
  const shipG = new THREE.Group();
  shipG.position.set(ship.x, ship.y, zw);
  shipG.rotation.z = shipAng;
  group.add(shipG);
  const outline = (k) => {
    const sh = new THREE.Shape();
    const L = (shipL / 2) * k;
    const B = (shipB / 2) * k;
    sh.moveTo(-L, -B * 0.85);
    sh.lineTo(L * 0.45, -B);
    sh.quadraticCurveTo(L * 0.9, -B * 0.7, L, 0);
    sh.quadraticCurveTo(L * 0.9, B * 0.7, L * 0.45, B);
    sh.lineTo(-L, B * 0.85);
    sh.lineTo(-L, -B * 0.85);
    return sh;
  };
  const hull = mesh(geo(new THREE.ExtrudeGeometry(outline(1), { depth: size * 1.5, bevelEnabled: false })), W.darkWood, shipG);
  hull.position.z = deckH - size * 1.5;
  const stripe = mesh(geo(new THREE.ExtrudeGeometry(outline(1.01), { depth: size * 0.16, bevelEnabled: false })), W.white, shipG);
  stripe.position.z = deckH - size * 0.42;
  const deckMesh = mesh(geo(new THREE.ShapeGeometry(outline(0.93))), W.plank, shipG);
  deckMesh.position.z = deckH + 0.6;
  const cabinS = mesh(geo(new THREE.BoxGeometry(size * 1.4, shipB * 0.6, size * 0.8)), W.wood, shipG);
  cabinS.position.set(-shipL * 0.32, 0, deckH + size * 0.4);
  const mast = mesh(geo(new THREE.CylinderGeometry(size * 0.07, size * 0.09, size * 5.2, 8)), W.wood, shipG);
  mast.rotation.x = Math.PI / 2;
  mast.position.set(shipL * 0.05, 0, deckH + size * 2.6);
  const sailGeo = geo(new THREE.PlaneGeometry(size * 2.6, size * 3.2, 6, 6));
  {
    const p = sailGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(((p.getX(i) / (size * 2.6)) + 0.5) * Math.PI) * size * 0.35);
    sailGeo.computeVertexNormals();
  }
  const sail = mesh(sailGeo, W.sail, shipG);
  sail.rotation.set(Math.PI / 2, 0, 0);
  sail.rotation.order = 'ZXY';
  sail.position.set(shipL * 0.05 - size * 1.3, size * 0.18, deckH + size * 3.1);
  const flagS = mesh(geo(new THREE.PlaneGeometry(size * 0.8, size * 0.45)), mat(0xf04e62, { side: THREE.DoubleSide }), shipG);
  flagS.rotation.x = Math.PI / 2;
  flagS.position.set(shipL * 0.05 - size * 0.4, 0, deckH + size * 5.05);
  const deckZ = water + deckH;
  rect(ship.x, ship.y, shipAng, (shipL / 2) * 0.8, (shipB / 2) * 0.82, deckZ);
  // The gangplank, down from the deck toward the dock.
  const plankLen = size * 3;
  const gpTop = { x: ship.x - dIn.x * shipB * 0.42, y: ship.y - dIn.y * shipB * 0.42 };
  const gpEnd = { x: gpTop.x - dIn.x * plankLen, y: gpTop.y - dIn.y * plankLen };
  const padZ = water + 5;
  // Low at the pads' end, rising toward the ship (its length runs along dIn, toward the middle of the lake).
  rect((gpTop.x + gpEnd.x) / 2, (gpTop.y + gpEnd.y) / 2, dockAng, plankLen / 2 + size * 0.2, size * 0.55, padZ, deckZ);
  const plankMesh = mesh(geo(new THREE.BoxGeometry(plankLen, size * 1.0, 4)), W.plank);
  plankMesh.position.set((gpTop.x + gpEnd.x) / 2, (gpTop.y + gpEnd.y) / 2, FLOOR_Z + (deckZ + padZ) / 2);
  plankMesh.rotation.order = 'ZYX';
  plankMesh.rotation.set(0, Math.atan2(deckZ - padZ, plankLen), dockAng + Math.PI);
  // The lily pads that will rise from the dock's end to the gangplank.
  const pads = [];
  {
    const from = { x: dockEnd.x + dIn.x * size * 0.8, y: dockEnd.y + dIn.y * size * 0.8 };
    const len = Math.hypot(gpEnd.x - from.x, gpEnd.y - from.y);
    const n = Math.ceil(len / (size * 1.35));
    const padGeo = geo(new THREE.CylinderGeometry(size * 0.85, size * 0.85, 4, 14));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // A little off the straight line, never so far that two pads don't touch.
      const x = lerp(from.x, gpEnd.x, t) + Math.sin(k * 1.7) * size * 0.12 * (k > 0 && k < n ? 1 : 0);
      const y = lerp(from.y, gpEnd.y, t) + Math.cos(k * 2.3) * size * 0.12 * (k > 0 && k < n ? 1 : 0);
      const m = mesh(padGeo, W.pad);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, FLOOR_Z + padZ - 2);
      m.scale.setScalar(0.001);
      m.visible = false;
      pads.push({ m, S: disc(x, y, size * 0.85, padZ, false), at: 0 });
    }
  }
  // A few lily pads about the lake anyway, and the coil of rope on deck.
  for (let k = 0; k < 18; k++) {
    const a = Math.random() * TAU;
    const r = LAKE.r * (0.35 + Math.random() * 0.45);
    const x = LAKE.x + Math.cos(a) * r;
    const y = LAKE.y + Math.sin(a) * r;
    if (!inLake(x, y)) continue;
    const m = mesh(geo(new THREE.CylinderGeometry(size * 0.4, size * 0.4, 2, 10)), W.pad);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, zw + 1);
  }
  const rope = mesh(geo(new THREE.TorusGeometry(size * 0.28, size * 0.07, 6, 16)), mat(0xc9a66b), shipG);
  rope.position.set(-shipL * 0.12, shipB * 0.2, deckH + size * 0.1);
  // The bell at the dock's foot, and the four frogs on their stones.
  const side = { x: -dIn.y, y: dIn.x };
  const bellAt = { x: shore.x - dIn.x * size * 1.2 + side.x * size * 1.4, y: shore.y - dIn.y * size * 1.2 + side.y * size * 1.4 };
  const bellPost = mesh(geo(new THREE.CylinderGeometry(size * 0.06, size * 0.06, size * 1.6, 6)), W.darkWood);
  bellPost.rotation.x = Math.PI / 2;
  bellPost.position.set(bellAt.x, bellAt.y, FLOOR_Z + land(bellAt.x, bellAt.y) + size * 0.8);
  const dinner = mesh(geo(new THREE.ConeGeometry(size * 0.22, size * 0.3, 10, 1, true)), W.gold);
  dinner.rotation.x = -Math.PI / 2;
  dinner.position.set(bellAt.x, bellAt.y, FLOOR_Z + land(bellAt.x, bellAt.y) + size * 1.55);
  const frogs = FROGS.map((F, k) => {
    const a = (k - 1.5) * 0.55;
    const ox = -dIn.x * Math.cos(a) + side.x * Math.sin(a);
    const oy = -dIn.y * Math.cos(a) + side.y * Math.sin(a);
    const x = bellAt.x + ox * size * 2.8;
    const y = bellAt.y + oy * size * 2.8;
    const z = FLOOR_Z + land(x, y);
    const stone = mesh(geo(new THREE.IcosahedronGeometry(size * 0.38, 0)), W.rock);
    stone.scale.set(1.2, 1, 0.55);
    stone.position.set(x, y, z + size * 0.1);
    const g = new THREE.Group();
    g.position.set(x, y, z + size * 0.32);
    g.rotation.z = headingOf(bellAt.x - x, bellAt.y - y) + Math.PI;
    group.add(g);
    const body = mesh(geo(new THREE.IcosahedronGeometry(size * 0.2, 1)), mat(0x5fae4a), g);
    body.scale.set(1.15, 1, 0.75);
    body.position.z = size * 0.12;
    const back = mesh(geo(new THREE.IcosahedronGeometry(size * 0.13, 1)), mat(F.color, { emissive: 0x000000 }), g);
    back.scale.set(1, 1, 0.5);
    back.position.set(0, size * 0.05, size * 0.24);
    for (const s of [-1, 1]) {
      const e = mesh(geo(new THREE.SphereGeometry(size * 0.06, 8, 6)), W.white, g);
      e.position.set(s * size * 0.09, -size * 0.12, size * 0.26);
      const p = mesh(geo(new THREE.SphereGeometry(size * 0.03, 6, 4)), W.black, g);
      p.position.set(s * size * 0.09, -size * 0.17, size * 0.27);
    }
    return { ...F, x, y, z, g, back, base: z + size * 0.32, hop: -1, gone: 0 };
  });
  // Ducks about the lake.
  const ducks = Array.from({ length: 3 }, (_, k) => {
    const g = new THREE.Group();
    group.add(g);
    const b = mesh(geo(new THREE.IcosahedronGeometry(size * 0.22, 1)), W.duck, g);
    b.scale.set(1.4, 0.9, 0.7);
    const h = mesh(geo(new THREE.IcosahedronGeometry(size * 0.12, 1)), W.duckHead, g);
    h.position.set(size * 0.24, 0, size * 0.18);
    const bk = mesh(geo(new THREE.ConeGeometry(size * 0.05, size * 0.12, 6)), W.beak, g);
    bk.rotation.z = -Math.PI / 2;
    bk.position.set(size * 0.36, 0, size * 0.17);
    return { g, r: LAKE.r * (0.3 + k * 0.17), a: Math.random() * TAU, sp: (0.05 + Math.random() * 0.04) * (k % 2 ? 1 : -1) };
  });

  /* ---------- the forest ---------- */

  const toForest = { x: start.x - FOREST.x, y: start.y - FOREST.y };
  const tf = Math.hypot(toForest.x, toForest.y);
  const fOut = { x: toForest.x / tf, y: toForest.y / tf }; // from the fort toward the garden
  const fortZ = FLOOR_Z + land(FOREST.x, FOREST.y);
  const platH = size * 4.2;
  const platHalf = size * 1.75;
  const trees = [];
  {
    const n = 240;
    const trunkGeo = geo(new THREE.CylinderGeometry(size * 0.12, size * 0.18, 1, 6));
    trunkGeo.rotateX(Math.PI / 2);
    trunkGeo.translate(0, 0, 0.5);
    const coneGeo = geo(new THREE.ConeGeometry(1, 1, 7));
    coneGeo.rotateX(Math.PI / 2);
    coneGeo.translate(0, 0, 0.5);
    const trunks = new THREE.InstancedMesh(trunkGeo, W.trunk, n);
    const lower = new THREE.InstancedMesh(coneGeo, W.pine, n);
    const upper = new THREE.InstancedMesh(coneGeo, W.pine2, n);
    const d = new THREE.Object3D();
    let k = 0;
    for (let tries = 0; k < n && tries < n * 6; tries++) {
      const a = Math.random() * TAU;
      const r = FOREST.r * Math.sqrt(Math.random()) * 0.95;
      if (r < size * 6.5) continue;
      const x = FOREST.x + Math.cos(a) * r;
      const y = FOREST.y + Math.sin(a) * r;
      const z = FLOOR_Z + land(x, y);
      const h = size * (3.2 + Math.random() * 2.8);
      const w = h * (0.22 + Math.random() * 0.06);
      d.rotation.set(0, 0, Math.random() * TAU);
      d.position.set(x, y, z);
      d.scale.set(1, 1, h * 0.45);
      d.updateMatrix();
      trunks.setMatrixAt(k, d.matrix);
      d.position.set(x, y, z + h * 0.28);
      d.scale.set(w, w, h * 0.55);
      d.updateMatrix();
      lower.setMatrixAt(k, d.matrix);
      d.position.set(x, y, z + h * 0.58);
      d.scale.set(w * 0.68, w * 0.68, h * 0.42);
      d.updateMatrix();
      upper.setMatrixAt(k, d.matrix);
      trees.push({ x, y, z, h });
      block(x, y, size * 0.22);
      k++;
    }
    for (const m of [trunks, lower, upper]) {
      m.count = k;
      m.frustumCulled = false;
      group.add(m);
      disposables.push(m);
    }
  }
  // The giant tree, its fort, the ladder (not hung yet), the chest.
  const fortG = new THREE.Group();
  fortG.position.set(FOREST.x, FOREST.y, fortZ);
  fortG.rotation.z = headingOf(fOut.x, fOut.y);
  group.add(fortG);
  // Inside fortG: +y faces the garden (the ladder side).
  const big = mesh(geo(new THREE.CylinderGeometry(size * 0.55, size * 0.8, size * 7.5, 9)), W.trunk, fortG);
  big.rotation.x = Math.PI / 2;
  big.position.z = size * 3.75;
  block(FOREST.x, FOREST.y, size * 0.75, size * 7.5 + (fortZ - FLOOR_Z));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    const b = mesh(geo(new THREE.IcosahedronGeometry(size * (1.4 + (k % 2) * 0.4), 1)), W.leaf, fortG);
    b.position.set(Math.cos(a) * size * 1.4, Math.sin(a) * size * 1.4, size * (7.2 + (k % 3) * 0.5));
  }
  mesh(geo(new THREE.IcosahedronGeometry(size * 2, 1)), W.leaf, fortG).position.z = size * 8.4;
  const plat = mesh(geo(new THREE.BoxGeometry(platHalf * 2, platHalf * 2, size * 0.22)), W.plank, fortG);
  plat.position.z = platH - size * 0.11;
  for (const [x, y, w, h] of [[0, -platHalf, platHalf * 2, size * 0.12], [-platHalf, 0, size * 0.12, platHalf * 2], [platHalf, 0, size * 0.12, platHalf * 2], [-platHalf * 0.6, platHalf, platHalf * 0.8, size * 0.12], [platHalf * 0.6, platHalf, platHalf * 0.8, size * 0.12]]) {
    const wall = mesh(geo(new THREE.BoxGeometry(w, h, size * 0.7)), W.wood, fortG);
    wall.position.set(x, y, platH + size * 0.35);
  }
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = mesh(postGeo, W.darkWood, fortG);
    p.rotation.x = Math.PI / 2;
    p.scale.set(1, 1.6, 1);
    p.position.set(x * platHalf * 0.95, y * platHalf * 0.95, platH + size * 1.1);
  }
  const roofF = mesh(geo(new THREE.ConeGeometry(platHalf * 1.6, size * 1.4, 4)), W.roof, fortG);
  roofF.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  roofF.position.z = platH + size * 2.5;
  rect(FOREST.x, FOREST.y, Math.atan2(fOut.y, fOut.x), platHalf, platHalf, fortZ - FLOOR_Z + platH);
  const ladderG = new THREE.Group();
  fortG.add(ladderG);
  ladderG.visible = false;
  for (const s of [-1, 1]) {
    const rail = mesh(geo(new THREE.CylinderGeometry(size * 0.03, size * 0.03, platH, 5)), mat(0xc9a66b), ladderG);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(s * size * 0.3, platHalf + size * 0.1, platH / 2);
  }
  for (let k = 0; k < 12; k++) {
    const rung = mesh(geo(new THREE.BoxGeometry(size * 0.6, size * 0.05, size * 0.05)), W.plank, ladderG);
    rung.position.set(0, platHalf + size * 0.1, (k + 0.6) * (platH / 12));
  }
  const ladderBase = { x: FOREST.x + fOut.x * (platHalf + size * 0.6), y: FOREST.y + fOut.y * (platHalf + size * 0.6) };
  const chest = new THREE.Group();
  fortG.add(chest);
  chest.position.set(-platHalf * 0.55, -platHalf * 0.55, platH);
  mesh(geo(new THREE.BoxGeometry(size * 0.7, size * 0.45, size * 0.4)), W.wood, chest).position.z = size * 0.2;
  const lid = new THREE.Group();
  lid.position.set(0, -size * 0.22, size * 0.4);
  chest.add(lid);
  mesh(geo(new THREE.BoxGeometry(size * 0.72, size * 0.47, size * 0.12)), W.darkWood, lid).position.set(0, size * 0.22, size * 0.04);
  const keyMesh = new THREE.Group();
  chest.add(keyMesh);
  keyMesh.visible = false;
  mesh(geo(new THREE.TorusGeometry(size * 0.09, size * 0.03, 6, 12)), W.gold, keyMesh).position.set(-size * 0.12, 0, 0);
  mesh(geo(new THREE.BoxGeometry(size * 0.28, size * 0.04, size * 0.04)), W.gold, keyMesh).position.set(size * 0.08, 0, 0);
  const chestWorld = () => chest.getWorldPosition(new THREE.Vector3());
  // Owls: the mother on the fort's edge by the ladder, three owlets out in the trees.
  const owl = (s) => {
    const g = new THREE.Group();
    group.add(g);
    const b = mesh(geo(new THREE.IcosahedronGeometry(size * 0.3 * s, 1)), W.owl, g);
    b.scale.set(0.9, 0.85, 1.2);
    const bl = mesh(geo(new THREE.IcosahedronGeometry(size * 0.2 * s, 1)), W.belly, g);
    bl.scale.set(0.9, 0.5, 1.1);
    bl.position.set(0, -size * 0.16 * s, -size * 0.03 * s);
    for (const k of [-1, 1]) {
      const e = mesh(geo(new THREE.SphereGeometry(size * 0.08 * s, 8, 6)), W.eye, g);
      e.position.set(k * size * 0.1 * s, -size * 0.22 * s, size * 0.12 * s);
      const p = mesh(geo(new THREE.SphereGeometry(size * 0.04 * s, 6, 4)), W.black, g);
      p.position.set(k * size * 0.1 * s, -size * 0.29 * s, size * 0.12 * s);
      const t = mesh(geo(new THREE.ConeGeometry(size * 0.05 * s, size * 0.14 * s, 4)), W.owl, g);
      t.rotation.x = Math.PI / 2;
      t.position.set(k * size * 0.15 * s, 0, size * 0.36 * s);
    }
    return g;
  };
  const mother = owl(1.25);
  const fortLocal = (x, y, z) => fortG.localToWorld(new THREE.Vector3(x, y, z));
  const motherAt = fortLocal(size * 0.6, platHalf * 0.9, platH + size * 0.75);
  const motherAside = fortLocal(platHalf * 0.85, platHalf * 0.4, platH + size * 0.75);
  mother.position.copy(motherAt);
  const owlets = [];
  {
    const sorted = trees
      .map((t) => ({ t, d: Math.hypot(t.x - FOREST.x, t.y - FOREST.y), a: Math.atan2(t.y - FOREST.y, t.x - FOREST.x) }))
      .filter((o) => o.d > size * 10 && o.d < size * 24);
    for (let k = 0; k < 3; k++) {
      // One in each third of the forest, round from the fort.
      const want = Math.atan2(fOut.y, fOut.x) + Math.PI * 0.35 + (k * TAU) / 3;
      let best = null;
      for (const o of sorted) {
        const da = Math.abs(Math.atan2(Math.sin(o.a - want), Math.cos(o.a - want)));
        if (!best || da + o.d / (size * 60) < best.score) best = { o, score: da + o.d / (size * 60) };
      }
      const t = best.o.t;
      const g = owl(0.6);
      g.position.set(t.x, t.y, t.z + t.h * 0.42);
      g.rotation.z = headingOf(FOREST.x - t.x, FOREST.y - t.y) + Math.PI;
      owlets.push({ g, tree: t, home: fortLocal(-platHalf * 0.3 + k * size * 0.35, platHalf * 0.85, platH + size * 0.6), flying: -1, done: false, ph: Math.random() * TAU });
    }
  }
  // Fireflies over the forest floor.
  const flies = 140;
  const flyGeo = geo(new THREE.BufferGeometry());
  flyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flies * 3), 3));
  const flyMat = new THREE.PointsMaterial({ color: 0xe8ff8a, size: size * 0.09, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  disposables.push(flyMat);
  const fireflies = new THREE.Points(flyGeo, flyMat);
  fireflies.frustumCulled = false;
  group.add(fireflies);
  const flySeeds = Array.from({ length: flies }, () => ({ a: Math.random() * TAU, r: FOREST.r * 0.9 * Math.sqrt(Math.random()), h: size * (0.4 + Math.random() * 2.5), ph: Math.random() * TAU }));

  /* ---------- the mountain ---------- */

  const toMount = { x: start.x - MOUNT.x, y: start.y - MOUNT.y };
  const tm = Math.hypot(toMount.x, toMount.y);
  const mOut = { x: toMount.x / tm, y: toMount.y / tm };
  const gateAng = Math.atan2(mOut.y, mOut.x);
  const FR = MOUNT.r * 1.02;
  const gateHalf = (size * 1.1) / FR;
  {
    // The fence: posts all round, two rails between them following the ground, and a gap for the gate.
    const n = Math.round((TAU * FR) / (size * 1.5));
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = gateAng + (k / n) * TAU;
      if (Math.abs(Math.atan2(Math.sin(a - gateAng), Math.cos(a - gateAng))) < gateHalf) continue;
      const x = MOUNT.x + Math.cos(a) * FR;
      const y = MOUNT.y + Math.sin(a) * FR;
      pts.push({ x, y, z: FLOOR_Z + land(x, y), a });
    }
    const posts = new THREE.InstancedMesh(postGeo, W.darkWood, pts.length);
    const railGeo = geo(new THREE.BoxGeometry(1, size * 0.07, size * 0.07));
    const rails = new THREE.InstancedMesh(railGeo, W.wood, pts.length * 2);
    const d = new THREE.Object3D();
    let r = 0;
    pts.forEach((p, k) => {
      d.rotation.set(Math.PI / 2, 0, 0);
      d.scale.set(1, 1, 1);
      d.position.set(p.x, p.y, p.z + size * 0.5);
      d.updateMatrix();
      posts.setMatrixAt(k, d.matrix);
      const q = pts[(k + 1) % pts.length];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len > size * 3) return;
      for (const hgt of [0.45, 0.95]) {
        d.rotation.order = 'ZYX';
        d.rotation.set(0, -Math.atan2(q.z - p.z, len), Math.atan2(q.y - p.y, q.x - p.x));
        d.scale.set(Math.hypot(len, q.z - p.z), 1, 1);
        d.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2 + size * hgt);
        d.updateMatrix();
        rails.setMatrixAt(r++, d.matrix);
        d.rotation.order = 'XYZ';
      }
    });
    rails.count = r;
    for (const m of [posts, rails]) {
      m.frustumCulled = false;
      group.add(m);
      disposables.push(m);
    }
  }
  const gateAt = { x: MOUNT.x + mOut.x * FR, y: MOUNT.y + mOut.y * FR };
  const gateZ = FLOOR_Z + land(gateAt.x, gateAt.y);
  const gateG = new THREE.Group();
  gateG.position.set(gateAt.x, gateAt.y, gateZ);
  gateG.rotation.z = gateAng + Math.PI / 2;
  group.add(gateG);
  for (const s of [-1, 1]) {
    const p = mesh(geo(new THREE.CylinderGeometry(size * 0.12, size * 0.12, size * 1.8, 6)), W.darkWood, gateG);
    p.rotation.x = Math.PI / 2;
    p.position.set(s * size * 1.15, 0, size * 0.9);
  }
  const doors = [-1, 1].map((s) => {
    const hinge = new THREE.Group();
    hinge.position.set(s * size * 1.05, 0, 0);
    gateG.add(hinge);
    for (const hgt of [0.35, 0.75, 1.15]) {
      const b = mesh(geo(new THREE.BoxGeometry(size * 1.05, size * 0.08, size * 0.16)), W.plank, hinge);
      b.position.set(-s * size * 0.52, 0, size * hgt);
    }
    return { hinge, s };
  });
  const padlock = mesh(geo(new THREE.BoxGeometry(size * 0.18, size * 0.12, size * 0.2)), W.gold, gateG);
  padlock.position.set(0, -size * 0.08, size * 0.75);
  // The cabin on top, its door toward the gate, the bells by it.
  const topZ = FLOOR_Z + land(MOUNT.x, MOUNT.y);
  const cabG = new THREE.Group();
  cabG.position.set(MOUNT.x, MOUNT.y, topZ);
  cabG.rotation.z = headingOf(mOut.x, mOut.y);
  group.add(cabG);
  // Inside cabG: +y faces the gate (the door side).
  const cw = size * 3.2;
  const cd = size * 2.4;
  mesh(geo(new THREE.BoxGeometry(cw, cd, size * 1.6)), W.wood, cabG).position.z = size * 0.8;
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-cd / 2 - size * 0.3, 0);
  roofShape.lineTo(0, size * 1.1);
  roofShape.lineTo(cd / 2 + size * 0.3, 0);
  roofShape.lineTo(-cd / 2 - size * 0.3, 0);
  const roofC = mesh(geo(new THREE.ExtrudeGeometry(roofShape, { depth: cw + size * 0.4, bevelEnabled: false })), W.roof, cabG);
  roofC.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  roofC.position.set(-cw / 2 - size * 0.2, 0, size * 1.6);
  const chim = mesh(geo(new THREE.BoxGeometry(size * 0.4, size * 0.4, size * 1.2)), W.rock, cabG);
  chim.position.set(cw * 0.3, -cd * 0.15, size * 2.4);
  const doorG = new THREE.Group();
  doorG.position.set(-size * 0.4, cd / 2 + 1, 0);
  cabG.add(doorG);
  mesh(geo(new THREE.BoxGeometry(size * 0.8, size * 0.08, size * 1.25)), W.darkWood, doorG).position.set(size * 0.4, 0, size * 0.62);
  block(MOUNT.x, MOUNT.y, size * 1.75);
  const cabLocal = (x, y, z) => cabG.localToWorld(new THREE.Vector3(x, y, z));
  const bellBeam = mesh(geo(new THREE.BoxGeometry(size * 1.8, size * 0.1, size * 0.1)), W.darkWood, cabG);
  bellBeam.position.set(cw * 0.3, cd / 2 + size * 0.35, size * 1.45);
  const bells = BELLS.map((B, k) => {
    const g = new THREE.Group();
    g.position.set(cw * 0.3 + (k - 1) * size * 0.6, cd / 2 + size * 0.35, size * 1.4);
    cabG.add(g);
    const b = mesh(geo(new THREE.ConeGeometry(size * 0.18, size * 0.32, 10, 1, true)), mat(B.color, { side: THREE.DoubleSide, shininess: 70, specular: 0x666666 }), g);
    b.rotation.x = -Math.PI / 2;
    b.position.z = -size * 0.18;
    return { ...B, g, swing: 0, at: cabLocal(cw * 0.3 + (k - 1) * size * 0.6, cd / 2 + size * 1.0, 0) };
  });
  // Cairns on the slopes: each a flag in one bell's color over 1, 2 or 3 stones. The bells' tune is the stones' order.
  const tune = [0, 1, 2].sort(() => Math.random() - 0.5); // tune[i]: the bell with i + 1 stones
  const cairns = [0, 1, 2].map((i) => {
    const a = gateAng + 1.7 + i * 1.45;
    const s = 0.42 + i * 0.09;
    const x = MOUNT.x + Math.cos(a) * MOUNT.r * s;
    const y = MOUNT.y + Math.sin(a) * MOUNT.r * s;
    const z = FLOOR_Z + land(x, y);
    const B = BELLS[tune[i]];
    for (let k = 0; k <= i; k++) {
      const st = mesh(geo(new THREE.IcosahedronGeometry(size * (0.42 - k * 0.07), 0)), W.rock);
      st.scale.set(1, 1, 0.6);
      st.position.set(x, y, z + size * (0.18 + k * 0.42));
    }
    const pole = mesh(geo(new THREE.CylinderGeometry(size * 0.03, size * 0.03, size * 2.4, 5)), W.darkWood);
    pole.rotation.x = Math.PI / 2;
    pole.position.set(x + size * 0.5, y, z + size * 1.2);
    const flag = mesh(geo(new THREE.PlaneGeometry(size * 0.9, size * 0.55)), mat(B.color, { side: THREE.DoubleSide }));
    flag.rotation.x = Math.PI / 2;
    flag.position.set(x + size * 0.95, y, z + size * 2.1);
    block(x, y, size * 0.45);
    return { x, y, flag, ph: Math.random() * TAU };
  });
  // Goats.
  const goats = Array.from({ length: 5 }, () => {
    const g = new THREE.Group();
    group.add(g);
    const b = mesh(geo(new THREE.BoxGeometry(size * 0.38, size * 0.7, size * 0.36)), W.goat, g);
    b.position.z = size * 0.45;
    const h = mesh(geo(new THREE.BoxGeometry(size * 0.22, size * 0.3, size * 0.24)), W.goat, g);
    h.position.set(0, -size * 0.42, size * 0.68);
    for (const s of [-1, 1]) {
      const horn = mesh(geo(new THREE.ConeGeometry(size * 0.04, size * 0.22, 5)), W.horn, g);
      horn.rotation.x = Math.PI / 2 - 0.5;
      horn.position.set(s * size * 0.07, -size * 0.36, size * 0.86);
      for (const f of [-1, 1]) {
        const leg = mesh(geo(new THREE.BoxGeometry(size * 0.07, size * 0.07, size * 0.3)), W.goat, g);
        leg.position.set(s * size * 0.12, f * size * 0.25, size * 0.15);
      }
    }
    const a = Math.random() * TAU;
    const r = MOUNT.r * (0.2 + Math.random() * 0.55);
    return { g, head: h, x: MOUNT.x + Math.cos(a) * r, y: MOUNT.y + Math.sin(a) * r, tx: null, ty: null, wait: Math.random() * 3, heading: Math.random() * TAU, bleat: 0 };
  });

  /* ---------- the signpost ---------- */

  {
    const sx = start.x + size * 2.2;
    const sy = start.y - size * 1.2;
    const sz = FLOOR_Z + land(sx, sy);
    const post = mesh(geo(new THREE.CylinderGeometry(size * 0.07, size * 0.08, size * 2.4, 6)), W.darkWood);
    post.rotation.x = Math.PI / 2;
    post.position.set(sx, sy, sz + size * 1.2);
    [
      ['lake', LAKE],
      ['forest', FOREST],
      ['mountain', MOUNT],
    ].forEach(([word, P], k) => {
      const g = new THREE.Group();
      g.position.set(sx, sy, sz + size * (2.0 - k * 0.42));
      g.rotation.z = Math.atan2(P.y - sy, P.x - sx);
      group.add(g);
      const tex = textTexture(word);
      disposables.push(tex);
      const m = new THREE.MeshBasicMaterial({ map: tex });
      disposables.push(m);
      const pg = geo(new THREE.PlaneGeometry(size * 1.5, size * 0.36));
      for (const s of [1, -1]) {
        const board = new THREE.Mesh(pg, m);
        board.rotation.set(Math.PI / 2, s > 0 ? 0 : Math.PI, 0);
        board.position.set(size * 0.85, s * size * 0.02, 0);
        g.add(board);
      }
      const tip = mesh(geo(new THREE.ConeGeometry(size * 0.2, size * 0.25, 3)), mat(0xf4ecdc), g);
      tip.rotation.z = -Math.PI / 2;
      tip.position.set(size * 1.72, 0, 0);
    });
    block(sx, sy, size * 0.2);
  }

  /* ---------- the state of things ---------- */

  const state = {
    items: { rope: false, key: false },
    frogSeq: [],
    frogStep: -1, // -1: not listening yet; 0..3: next to boop
    frogsDone: false,
    playing: null,
    owletsHome: 0,
    owlMoved: false,
    hung: false,
    chestOpen: false,
    gateOpen: false,
    bellStep: 0,
    doorOpen: false,
    seen: {},
    clock: 0,
  };
  // places: where everything is, for anything built on top of this world (and for testing it).
  const places = { LAKE, FOREST, MOUNT, shore, dockEnd, ship, bellAt, frogs, ladderBase, gateAt, owlets, cairns, mOut, fOut, dIn };
  // land, block, top: the land's height (above FLOOR_Z), a way to put something in the D's way, and the highest thing to stand on at a point (absolute), for what is added to this world (assets/pollen-dream-treasure.js).
  const world = { group, state, places, size, land, block, top: (x, y) => garden.exploreFloor(x, y, 1e9), prompt: null, act: () => act(), remove: () => remove(), bag: () => bag() };
  const tell = (text, s) => cast && cast.tell && cast.tell(text, s);

  // The letters, put in their places once they are in.
  const homes = {
    U: () => ({ x: ship.x + Math.cos(shipAng) * size * 1.2, y: ship.y + Math.sin(shipAng) * size * 1.2, z: FLOOR_Z + deckZ }),
    E: () => {
      const p = fortLocal(platHalf * 0.4, -platHalf * 0.3, platH);
      return { x: p.x, y: p.y, z: p.z };
    },
    T: () => {
      const p = cabLocal(size * 0.0, cd / 2 + size * 0.9, 0);
      return { x: p.x, y: p.y, z: p.z };
    },
  };

  // Things to do: where, how near, and what (label() null when there is nothing to do there now).
  const doings = [
    {
      at: () => ({ x: bellAt.x, y: bellAt.y, z: FLOOR_Z + land(bellAt.x, bellAt.y) }),
      r: size * 1.6,
      label: () => (state.frogsDone || state.playing ? null : 'Ring the bell'),
      act: () => playFrogs(),
    },
    ...frogs.map((F, k) => ({
      at: () => ({ x: F.x, y: F.y, z: F.z }),
      r: size * 1.3,
      label: () => (state.frogsDone || state.playing || state.frogStep < 0 ? null : `Boop the ${F.name} frog`),
      act: () => boop(k),
    })),
    {
      at: () => {
        const p = rope.getWorldPosition(new THREE.Vector3());
        return { x: p.x, y: p.y, z: FLOOR_Z + deckZ };
      },
      r: size * 1.4,
      label: () => (state.items.rope ? null : 'Take the rope ladder'),
      act: () => {
        state.items.rope = true;
        rope.visible = false;
        tell(SAY.rope);
      },
    },
    {
      at: () => ({ x: ladderBase.x, y: ladderBase.y, z: fortZ }),
      r: size * 1.8,
      label: () => (!state.owlMoved ? 'Talk to the owl' : !state.items.rope ? 'Look up' : !state.hung ? 'Hang the rope ladder' : 'Climb up'),
      act: () => {
        if (!state.owlMoved) tell(SAY.owlAsk, 5);
        else if (!state.items.rope) tell(SAY.noRope);
        else if (!state.hung) {
          state.hung = true;
          ladderG.visible = true;
          tell(SAY.hung);
        } else climb();
      },
    },
    ...owlets.map((O) => ({
      at: () => ({ x: O.tree.x, y: O.tree.y, z: O.tree.z }),
      r: size * 2,
      label: () => (O.done || O.flying >= 0 ? null : 'Call the owlet'),
      act: () => {
        O.flying = 0;
        O.from = O.g.position.clone();
        tell(SAY.owlet, 2.5);
      },
    })),
    {
      at: () => {
        const p = chestWorld();
        return { x: p.x, y: p.y, z: p.z };
      },
      r: size * 1.3,
      label: () => (state.chestOpen ? null : 'Open the chest'),
      act: () => {
        state.chestOpen = true;
        state.items.key = true;
        keyMesh.visible = true;
        tell(SAY.key, 4);
      },
    },
    {
      at: () => ({ x: gateAt.x + mOut.x * size * 0.9, y: gateAt.y + mOut.y * size * 0.9, z: gateZ }),
      r: size * 1.8,
      label: () => (state.gateOpen ? null : state.items.key ? 'Unlock the gate' : 'Try the gate'),
      act: () => {
        if (!state.items.key) return tell(SAY.locked);
        state.gateOpen = true;
        padlock.visible = false;
        tell(SAY.unlocked);
      },
    },
    ...bells.map((B, k) => ({
      at: () => ({ x: B.at.x, y: B.at.y, z: B.at.z }),
      r: size * 0.9,
      label: () => (state.doorOpen ? null : `Ring the ${B.name} bell`),
      act: () => ring(k),
    })),
  ];

  world.doings = doings;

  function playFrogs() {
    state.frogSeq = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    state.frogStep = -1;
    state.playing = { t: -0.8 };
    dinner.userData.swing = 1;
    tell(SAY.frogsListen, 2.5);
  }

  function croak(F) {
    F.hop = 0;
  }

  function boop(k) {
    const F = frogs[k];
    croak(F);
    if (state.frogSeq[state.frogStep] === k) {
      state.frogStep++;
      if (state.frogStep >= 4) {
        state.frogsDone = true;
        state.frogStep = -1;
        tell(SAY.frogsDone, 4);
        frogs.forEach((f, i) => (f.gone = -0.4 - i * 0.25));
        pads.forEach((p, i) => (p.at = -0.6 - i * 0.22));
      }
    } else {
      state.frogStep = -1;
      frogs.forEach((f) => (f.shake = 0.6));
      tell(SAY.frogsWrong, 3.5);
    }
  }

  function ring(k) {
    const B = bells[k];
    B.swing = 1;
    if (tune[state.bellStep] === k) {
      state.bellStep++;
      if (state.bellStep >= 3) {
        state.doorOpen = true;
        tell(SAY.bellsDone, 3);
        const T = cast && cast.letters.T;
        if (T) T.hidden = false;
      }
    } else {
      state.bellStep = 0;
      tell(SAY.bellsWrong, 3.5);
    }
  }

  function climb() {
    const ex = garden.explorer;
    if (!ex) return;
    const top = fortZ + platH;
    const inward = { x: -fOut.x, y: -fOut.y };
    const from = { x: ladderBase.x, y: ladderBase.y, z: ex.z };
    let t = 0;
    ex.mode = 'scripted';
    ex.vx = ex.vy = ex.vz = 0;
    ex.script = (dt, E) => {
      t += dt;
      const up = clamp(t / 2.6, 0, 1);
      const over = clamp((t - 2.6) / 0.5, 0, 1);
      E.x = from.x + inward.x * size * 1.1 * smooth(over);
      E.y = from.y + inward.y * size * 1.1 * smooth(over);
      E.z = lerp(from.z, top + E.eye + 2, smooth(up));
      if (over >= 1) {
        E.script = null;
        E.mode = 'walk';
        E.grounded = true;
      }
    };
  }

  function act() {
    const d = world.near;
    if (d) d.act();
  }

  function bag() {
    const items = [];
    if (state.items.rope && !state.hung) items.push('Rope ladder');
    if (state.items.key && !state.gateOpen) items.push('Brass key');
    return items;
  }

  /* ---------- each frame ---------- */

  let last = null;
  const blockedAt = (x, y, ex) => {
    const feet = ex.z - ex.eye - FLOOR_Z;
    // Out on the lake, where the water is deep and there is nothing to stand on.
    if (inLake(x, y) && garden.hillAt(x, y) <= land(x, y) + 0.01 && land(x, y) < water - 8) return true;
    for (const b of blocks) {
      if (feet < b.top && (x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) return true;
    }
    return false;
  };
  const crossesFence = (x0, y0, x1, y1) => {
    const d0 = Math.hypot(x0 - MOUNT.x, y0 - MOUNT.y);
    const d1 = Math.hypot(x1 - MOUNT.x, y1 - MOUNT.y);
    if (d0 >= FR === d1 >= FR) return false;
    const a = Math.atan2(y1 - MOUNT.y, x1 - MOUNT.x);
    const off = Math.abs(Math.atan2(Math.sin(a - gateAng), Math.cos(a - gateAng)));
    return !(state.gateOpen && off < gateHalf * 0.85);
  };
  garden.exploreBlocked = (x, y) => inLake(x, y) && land(x, y) < water - 8;

  const hook = (dt, ex) => {
    if (!ex || world.removed) return;
    const t = (state.clock += dt);
    const feet = ex.z - ex.eye;

    // Keeping the D where it can be: not in deep water, through the fence only at the open gate, not in a trunk.
    // A jump farther than any step (put somewhere new): that is where it is now.
    if (last && Math.hypot(ex.x - last.x, ex.y - last.y) > size * 3) last = null;
    if (ex.intro >= 1 && ex.mode === 'walk') {
      const bad = blockedAt(ex.x, ex.y, ex) || (last && crossesFence(last.x, last.y, ex.x, ex.y));
      if (bad && last) {
        ex.x = last.x;
        ex.y = last.y;
        if (ex.z < last.z) ex.z = last.z;
        ex.vx = ex.vy = 0;
        if (ex.vz < 0) ex.vz = 0;
      } else if (!bad) last = { x: ex.x, y: ex.y, z: ex.z };
    } else if (ex.mode !== 'walk' && !blockedAt(ex.x, ex.y, ex) && !inLake(ex.x, ex.y)) {
      last = { x: ex.x, y: ex.y, z: ex.z };
    }

    // The letters, in their places.
    if (cast) {
      for (const name of ['U', 'E', 'T']) {
        const L = cast.letters[name];
        if (!L || L.homed) continue;
        const h = homes[name]();
        L.x = h.x;
        L.y = h.y;
        L.z = h.z;
        L.heading = name === 'U' ? headingOf(-dIn.x, -dIn.y) : name === 'E' ? headingOf(fOut.x, fOut.y) : headingOf(mOut.x, mOut.y);
        L.homed = true;
        if (name === 'T' && !state.doorOpen) L.hidden = true;
      }
    }

    // Arriving somewhere for the first time: a word about it.
    if (ex.intro >= 1) {
      if (!state.seen.start && t > 4) {
        state.seen.start = true;
        tell(SAY.start, 4.5);
      }
      for (const [key, P] of [['lake', LAKE], ['forest', FOREST], ['mountain', MOUNT]]) {
        if (!state.seen[key] && Math.hypot(ex.x - P.x, ex.y - P.y) < P.r * 1.12) {
          state.seen[key] = true;
          tell(SAY[key], 4.5);
        }
      }
    }

    // What there is to do near the D.
    let near = null;
    let best = Infinity;
    if (ex.intro >= 1 && ex.mode === 'walk') {
      for (const d of doings) {
        const label = d.label();
        if (!label) continue;
        const p = d.at();
        const dist = Math.hypot(ex.x - p.x, ex.y - p.y);
        if (dist < d.r && Math.abs(feet - p.z) < size * 1.2 && dist < best) {
          best = dist;
          near = { label, act: d.act };
        }
      }
    }
    world.near = near;
    world.prompt = near ? near.label : null;

    // The lake: the water's shimmer, ducks, the bell, the frogs and their tune, the pads rising.
    if (Math.hypot(ex.x - LAKE.x, ex.y - LAKE.y) < LAKE.r * 3) {
      waterMat.color.setHSL(0.55, 0.45, 0.42 + 0.03 * Math.sin(t * 0.7));
      shipG.position.z = zw + Math.sin(t * 0.8) * 2;
      shipG.rotation.x = Math.sin(t * 0.6) * 0.015;
      sail.rotation.y = Math.sin(t * 0.9) * 0.05;
      for (const D of ducks) {
        D.a += D.sp * dt;
        const x = LAKE.x + Math.cos(D.a) * D.r;
        const y = LAKE.y + Math.sin(D.a) * D.r;
        D.g.position.set(x, y, zw + Math.sin(t * 2 + D.r) * 1.5);
        D.g.rotation.z = D.a + (D.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      if (dinner.userData.swing) {
        dinner.userData.swing = Math.max(0, dinner.userData.swing - dt * 0.8);
        dinner.rotation.y = Math.sin(t * 14) * 0.4 * dinner.userData.swing;
      }
      const P = state.playing;
      if (P) {
        const before = P.t;
        P.t += dt;
        for (let i = 0; i < 4; i++) {
          const at = i * 0.95;
          if (before < at && P.t >= at) croak(frogs[state.frogSeq[i]]);
        }
        if (P.t > 4 * 0.95 + 0.4) {
          state.playing = null;
          state.frogStep = 0;
          tell(SAY.frogsGo, 3.5);
        }
      }
      for (const F of frogs) {
        let z = F.base + Math.sin(t * 2 + F.x) * 0.6;
        let glow = 0;
        if (F.hop >= 0) {
          F.hop += dt / 0.55;
          z += Math.sin(Math.PI * Math.min(1, F.hop)) * size * 0.45;
          glow = Math.sin(Math.PI * Math.min(1, F.hop));
          if (F.hop >= 1) F.hop = -1;
        }
        F.back.material.emissive.setHex(F.color).multiplyScalar(glow * 0.7);
        if (F.shake > 0) {
          F.shake -= dt;
          F.g.rotation.y = Math.sin(t * 30) * 0.2 * F.shake;
        }
        if (state.frogsDone) {
          F.gone += dt;
          if (F.gone > 0) {
            // A leap into the water, toward the ship.
            const k = Math.min(1, F.gone / 0.9);
            F.g.position.set(F.x + dIn.x * size * 3 * k, F.y + dIn.y * size * 3 * k, z + Math.sin(Math.PI * k) * size * 1.2 - k * size * 0.6);
            F.g.visible = k < 1;
            continue;
          }
        }
        F.g.position.z = z;
      }
      for (const p of pads) {
        if (!state.frogsDone) continue;
        p.at += dt;
        const k = clamp(p.at / 0.6, 0, 1);
        p.m.visible = k > 0;
        p.m.scale.setScalar(Math.max(0.001, smooth(k)));
        p.S.on = k >= 1;
      }
    }

    // The forest: fireflies, owls.
    if (Math.hypot(ex.x - FOREST.x, ex.y - FOREST.y) < FOREST.r * 2.5) {
      const fp = flyGeo.attributes.position;
      flySeeds.forEach((s, i) => {
        const a = s.a + Math.sin(t * 0.3 + s.ph) * 0.05;
        const x = FOREST.x + Math.cos(a) * s.r + Math.sin(t * 0.7 + s.ph) * size * 0.4;
        const y = FOREST.y + Math.sin(a) * s.r + Math.cos(t * 0.6 + s.ph) * size * 0.4;
        fp.setXYZ(i, x, y, FLOOR_Z + land(x, y) + s.h + Math.sin(t + s.ph) * size * 0.2);
      });
      fp.needsUpdate = true;
      flyMat.opacity = 0.5 + 0.4 * Math.sin(t * 3) ** 2;
      // The mother looks at the D; once her owlets are home she steps aside.
      mother.rotation.z = headingOf(ex.x - mother.position.x, ex.y - mother.position.y) + Math.PI;
      mother.position.lerp(state.owlMoved ? motherAside : motherAt, 1 - Math.exp(-dt * 3));
      mother.scale.z = 1 + 0.04 * Math.sin(t * 3);
      for (const O of owlets) {
        if (O.flying >= 0) {
          O.flying += dt / 2.2;
          const k = smooth(Math.min(1, O.flying));
          O.g.position.lerpVectors(O.from, O.home, k);
          O.g.position.z += Math.sin(Math.PI * k) * size * 2;
          if (O.flying >= 1) {
            O.flying = -1;
            O.done = true;
            state.owletsHome++;
            if (state.owletsHome >= 3 && !state.owlMoved) {
              state.owlMoved = true;
              tell(SAY.owlDone, 4);
            }
          }
        } else {
          // Hooting: a little bob now and then.
          O.g.scale.setScalar(1 + 0.08 * Math.max(0, Math.sin(t * 2.5 + O.ph)) ** 8);
        }
      }
      lid.rotation.x = lerp(lid.rotation.x, state.chestOpen ? -1.8 : 0, 1 - Math.exp(-dt * 5));
      if (keyMesh.visible) {
        keyMesh.position.z = size * (0.7 + 0.08 * Math.sin(t * 3));
        keyMesh.rotation.z += dt * 2;
        if (state.chestOpen && t > (state.keyShownAt || (state.keyShownAt = t)) + 2.5) keyMesh.visible = false;
      }
    }

    // The mountain: the gate, the bells, the door, the flags, the goats.
    if (Math.hypot(ex.x - MOUNT.x, ex.y - MOUNT.y) < MOUNT.r * 3) {
      for (const D of doors) D.hinge.rotation.z = lerp(D.hinge.rotation.z, state.gateOpen ? D.s * 1.6 : 0, 1 - Math.exp(-dt * 3));
      doorG.rotation.z = lerp(doorG.rotation.z, state.doorOpen ? -1.7 : 0, 1 - Math.exp(-dt * 2));
      for (const B of bells) {
        B.swing = Math.max(0, B.swing - dt * 0.9);
        B.g.rotation.x = Math.sin(t * 12) * 0.45 * B.swing;
      }
      for (const C of cairns) C.flag.rotation.z = Math.sin(t * 2 + C.ph) * 0.12;
      for (const G of goats) {
        const dD = Math.hypot(ex.x - G.x, ex.y - G.y);
        if (dD < size * 3) {
          // Startled: off a little way, away from the D.
          const a = Math.atan2(G.y - ex.y, G.x - ex.x);
          G.tx = G.x + Math.cos(a) * size * 4;
          G.ty = G.y + Math.sin(a) * size * 4;
          G.wait = 0;
        }
        if (G.tx === null) {
          G.wait -= dt;
          G.head.position.z = size * (0.68 - 0.18 * Math.max(0, Math.sin(t * 0.8 + G.x)));
          if (G.wait <= 0) {
            const a = Math.random() * TAU;
            const r = MOUNT.r * (0.15 + Math.random() * 0.65);
            G.tx = MOUNT.x + Math.cos(a) * r;
            G.ty = MOUNT.y + Math.sin(a) * r;
          }
        } else {
          const dx = G.tx - G.x;
          const dy = G.ty - G.y;
          const d = Math.hypot(dx, dy);
          const sp = size * (dD < size * 4 ? 3 : 0.8);
          if (d < sp * dt * 2) {
            G.tx = null;
            G.wait = 2 + Math.random() * 5;
          } else {
            G.x += (dx / d) * sp * dt;
            G.y += (dy / d) * sp * dt;
            G.heading = headingOf(dx, dy);
          }
        }
        // Inside the fence, always.
        const r = Math.hypot(G.x - MOUNT.x, G.y - MOUNT.y);
        if (r > FR * 0.95) {
          G.x = MOUNT.x + ((G.x - MOUNT.x) / r) * FR * 0.95;
          G.y = MOUNT.y + ((G.y - MOUNT.y) / r) * FR * 0.95;
          G.tx = null;
        }
        G.g.position.set(G.x, G.y, FLOOR_Z + land(G.x, G.y) + (G.tx !== null ? Math.abs(Math.sin(t * 10)) * size * 0.05 : 0));
        G.g.rotation.z = G.heading;
      }
      // The T comes out onto the porch once the door is open.
      const T = cast && cast.letters.T;
      if (T && T.homed && state.doorOpen && T.state === 'waiting') {
        const out = cabLocal(size * 0.0, cd / 2 + size * 1.6, 0);
        T.x = lerp(T.x, out.x, 1 - Math.exp(-dt * 1.5));
        T.y = lerp(T.y, out.y, 1 - Math.exp(-dt * 1.5));
      }
    }
  };

  function remove() {
    world.removed = true;
    const i = garden.exploreHooks ? garden.exploreHooks.indexOf(hook) : -1;
    if (i >= 0) garden.exploreHooks.splice(i, 1);
    garden.scene.remove(group);
    disposables.forEach((d) => d.dispose && d.dispose());
    garden.surfaceAt = null;
    garden.exploreFloor = null;
    garden.exploreBlocked = null;
    garden.setLandFeatures([]);
    return null;
  }

  garden.exploreHooks.push(hook);
  return world;
}
