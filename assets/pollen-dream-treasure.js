/**
 * Pollen Dream's treasure: coins to collect, and the giant stars standing
 * about the land (assets/pollen-dream.js loads it after the world,
 * assets/pollen-dream-world.js).
 *
 * The stars: Duet's coral asterisk star, as tall as a big tree several
 * times over, standing on one point here and there across the fields,
 * turning slowly: landmarks to steer by.
 *
 * The coins: Duet's gold coin, hovering and turning, laid out the way a
 * platform game lays them out: in trails leading off from the start toward
 * each place, along the dock and over the water to the ship, round the
 * deck's mast, round the giant tree and up in its fort, by the owlets'
 * trees, zigzagging up the mountain, at the cairns and round the summit,
 * in rings round the stars, and one on top of each star, for whoever
 * glides down onto it on a gust. Touch one and it pops up and is counted.
 * The count decides the reward at the end (see assets/pollen-dream.js).
 *
 * Near coins are drawn as the full model, far ones as a plain gold disc,
 * and the farthest not at all, so a hundred and more of them cost little.
 */
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './three-gltf-loader.js';

const FLOOR_Z = -45;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/* The same layout every visit: a seeded random. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Every mesh of a loaded model, as geometry in the model's own frame with its material's color. */
function parts(gltf) {
  const out = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    out.push({ geo: g, color: o.material.color.clone() });
  });
  return out;
}

export async function addTreasure(garden, cast, world, base) {
  const loader = new GLTFLoader();
  const url = (f) => new URL(f, base).href;
  const [starGltf, coinGltf] = await Promise.all([loader.loadAsync(url('pollen-dream-star.glb')), loader.loadAsync(url('pollen-dream-coin.glb'))]);
  const E0 = garden.explorer;
  if (!E0 || world.removed) return null;
  const span = Math.max(garden.w, garden.h);
  const size = world.size;
  const P = world.places;
  const land = world.land;
  const ground = (x, y) => FLOOR_Z + land(x, y);
  const rnd = seeded(20261107);
  const group = new THREE.Group();
  garden.scene.add(group);
  const disposables = [];
  const keep = (d) => {
    disposables.push(d);
    return d;
  };
  const start = E0.to || { x: E0.x, y: E0.y };
  const cx = garden.w / 2;
  const cy = garden.h / 2;
  const coins = [];
  const coin = (x, y, z) => coins.push({ x, y, z, got: false, pop: -1, ph: rnd() * TAU });
  const onGround = (x, y) => coin(x, y, ground(x, y) + size * 0.55);
  const onTop = (x, y) => coin(x, y, world.top(x, y) + size * 0.55);

  /* ---------- the stars ---------- */

  const starPart = parts(starGltf)[0];
  const starGeo = keep(starPart.geo);
  // Stood up on end: its face toward -y, its points up and round; resting on its lowest point.
  starGeo.rotateX(Math.PI / 2);
  starGeo.computeBoundingBox();
  {
    const b = starGeo.boundingBox;
    starGeo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
  }
  starGeo.computeBoundingBox();
  const starH = starGeo.boundingBox.max.z;
  /*
   * Its shape for colliding: the triangles of its front face, flat in its own
   * plane (x across, z up), and how thick it is (y). Anything inside the
   * outline and within the thickness is inside the star.
   */
  const outline = [];
  const thick = { lo: starGeo.boundingBox.min.y, hi: starGeo.boundingBox.max.y };
  {
    const pos = starGeo.attributes.position;
    const idx = starGeo.index;
    const n = idx ? idx.count : pos.count;
    const at = (i) => (idx ? idx.getX(i) : i);
    const front = thick.lo + (thick.hi - thick.lo) * 0.01;
    for (let i = 0; i < n; i += 3) {
      const a = at(i);
      const b = at(i + 1);
      const c = at(i + 2);
      if (pos.getY(a) > front || pos.getY(b) > front || pos.getY(c) > front) continue;
      outline.push([pos.getX(a), pos.getZ(a), pos.getX(b), pos.getZ(b), pos.getX(c), pos.getZ(c)]);
    }
  }
  const inTri = (x, z, t) => {
    const d1 = (x - t[2]) * (t[1] - t[3]) - (t[0] - t[2]) * (z - t[3]);
    const d2 = (x - t[4]) * (t[3] - t[5]) - (t[2] - t[4]) * (z - t[5]);
    const d3 = (x - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (z - t[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const inOutline = (x, z) => outline.some((t) => inTri(x, z, t));
  /* A star as something solid: its own shape, turning as it turns. */
  const starCollider = (S) => {
    // A point (x, y, absolute z) in the star's own frame, its scale taken out.
    const local = (x, y, z) => {
      const k = S.m.scale.x;
      const a = S.m.rotation.z;
      const dx = x - S.x;
      const dy = y - S.y;
      return [(dx * Math.cos(a) + dy * Math.sin(a)) / k, (-dx * Math.sin(a) + dy * Math.cos(a)) / k, (z - S.z) / k];
    };
    return {
      revert: true,
      push(px, py, feet, rad) {
        const reachR = S.H * 0.65;
        if (Math.abs(px - S.x) > reachR || Math.abs(py - S.y) > reachR) return null;
        const k = S.m.scale.x;
        const r = rad / k;
        const mid = (thick.lo + thick.hi) / 2;
        const half = (thick.hi - thick.lo) / 2 + r;
        // The body at its feet, its middle and its head, and a little to either side of each.
        for (const h of [0.1, 0.5, 0.9]) {
          const [lx, ly, lz] = local(px, py, FLOOR_Z + feet + world.BODY * h);
          if (Math.abs(ly - mid) >= half) continue;
          if (inOutline(lx, lz) || inOutline(lx - r, lz) || inOutline(lx + r, lz)) {
            // Out of the face it is nearer (what a turning arm does to whoever is in its way).
            const ny = mid + (ly < mid ? -half : half);
            const a = S.m.rotation.z;
            const ox = (lx * Math.cos(a) - ny * Math.sin(a)) * k;
            const oy = (lx * Math.sin(a) + ny * Math.cos(a)) * k;
            return [S.x + ox, S.y + oy];
          }
        }
        return null;
      },
      hits(px, py, z) {
        const [lx, ly, lz] = local(px, py, z);
        return ly > thick.lo && ly < thick.hi && inOutline(lx, lz);
      },
    };
  };
  const starMat = keep(garden.makeMaterial({ color: starPart.color, shininess: 60, specular: 0x553338 }));
  const stars = [];
  {
    const avoid = [
      { x: P.LAKE.x, y: P.LAKE.y, r: P.LAKE.r * 1.25 + size * 6 },
      { x: P.FOREST.x, y: P.FOREST.y, r: P.FOREST.r * 1.2 + size * 6 },
      { x: P.MOUNT.x, y: P.MOUNT.y, r: P.MOUNT.r * 1.15 + size * 6 },
      { x: cx, y: cy, r: span * 2.4 },
    ];
    for (let tries = 0; stars.length < 12 && tries < 600; tries++) {
      const a = rnd() * TAU;
      const r = span * (2.6 + rnd() * 12);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (avoid.some((o) => Math.hypot(x - o.x, y - o.y) < o.r)) continue;
      if (stars.some((s) => Math.hypot(x - s.x, y - s.y) < size * 30)) continue;
      const H = size * (9 + rnd() * 6);
      const m = new THREE.Mesh(starGeo, starMat);
      m.scale.setScalar(H / starH);
      const z = ground(x, y) - H * 0.03;
      m.position.set(x, y, z);
      m.rotation.z = rnd() * TAU;
      group.add(m);
      const S = { x, y, z, H, m, spin: (0.04 + rnd() * 0.08) * (rnd() < 0.5 ? -1 : 1) };
      stars.push(S);
      if (world.addCollider) world.addCollider(starCollider(S));
      else world.block(x, y, size * 0.7);
    }
  }

  /* ---------- where the coins are ---------- */

  // Trails leading off from the start toward each place.
  for (const T of [P.LAKE, P.FOREST, P.MOUNT]) {
    const dx = T.x - start.x;
    const dy = T.y - start.y;
    const d = Math.hypot(dx, dy);
    for (let k = 0; k < 9; k++) {
      const s = size * 8 + (d * 0.45 - size * 8) * (k / 8);
      const wob = Math.sin(k * 0.9) * size * 1.5;
      onGround(start.x + (dx / d) * s - (dy / d) * wob, start.y + (dy / d) * s + (dx / d) * wob);
    }
  }
  // The lake: along the dock, over the water where the pads will be, round the mast.
  for (let k = 0; k < 4; k++) {
    const t = (k + 0.5) / 4;
    const x = lerp(P.shore.x, P.dockEnd.x, t);
    const y = lerp(P.shore.y, P.dockEnd.y, t);
    onTop(x, y);
  }
  for (let k = 1; k <= 6; k++) {
    const t = k / 7;
    const x = lerp(P.dockEnd.x, P.ship.x, t * 0.82);
    const y = lerp(P.dockEnd.y, P.ship.y, t * 0.82);
    coin(x, y, world.top(x, y) + size * 0.75);
  }
  // Round the deck, along the ship (it lies across the way from the dock).
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    const along = Math.cos(a) * size * 1.6;
    const side = Math.sin(a) * size * 0.45;
    onTop(P.ship.x - P.dIn.y * along + P.dIn.x * side, P.ship.y + P.dIn.x * along + P.dIn.y * side);
  }
  // The forest: round the giant tree's foot, up in the fort, by each owlet's tree.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    onGround(P.FOREST.x + Math.cos(a) * size * 2.6, P.FOREST.y + Math.sin(a) * size * 2.6);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    onTop(P.FOREST.x + Math.cos(a) * size * 1.35, P.FOREST.y + Math.sin(a) * size * 1.35);
  }
  for (const O of P.owlets) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.4;
      onGround(O.tree.x + Math.cos(a) * size * 1.6, O.tree.y + Math.sin(a) * size * 1.6);
    }
  }
  // The mountain: zigzagging up from the gate, at the cairns, round the summit.
  {
    const gx = P.gateAt.x;
    const gy = P.gateAt.y;
    const dx = P.MOUNT.x - gx;
    const dy = P.MOUNT.y - gy;
    const d = Math.hypot(dx, dy);
    for (let k = 0; k < 14; k++) {
      const t = 0.06 + (k / 13) * 0.82;
      const wob = Math.sin(k * 1.1) * size * 3;
      onGround(gx + dx * t - (dy / d) * wob, gy + dy * t + (dx / d) * wob);
    }
    for (const C of P.cairns || []) {
      onGround(C.x + size * 1.2, C.y);
      onGround(C.x - size * 1.2, C.y);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      onGround(P.MOUNT.x + Math.cos(a) * size * 3.3, P.MOUNT.y + Math.sin(a) * size * 3.3);
    }
  }
  // Round each star, and one on top of it for a glider.
  for (const S of stars) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + S.m.rotation.z;
      onGround(S.x + Math.cos(a) * size * 3.4, S.y + Math.sin(a) * size * 3.4);
    }
    coin(S.x, S.y, S.z + S.H + size * 0.9);
  }

  /* ---------- the coin, near and far ---------- */

  const coinParts = parts(coinGltf);
  const bb = new THREE.Box3();
  for (const p of coinParts) {
    p.geo.computeBoundingBox();
    bb.union(p.geo.boundingBox);
  }
  const across = bb.max.x - bb.min.x;
  const k = (size * 0.6) / across;
  const fit = new THREE.Matrix4()
    .makeRotationX(Math.PI / 2)
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2));
  const NEAR = 48;
  const near = coinParts.map((p) => {
    p.geo.applyMatrix4(fit);
    keep(p.geo);
    const m = new THREE.InstancedMesh(p.geo, keep(garden.makeMaterial({ color: p.color, shininess: 90, specular: 0x8a7a40, emissive: p.color.clone().multiplyScalar(0.42), flatShading: false })), NEAR);
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
    keep(m);
    return m;
  });
  // Far off: a plain gold disc, its face upright like the coin's (a cylinder's axis is y: across the ground).
  const disc = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(size * 0.3, size * 0.3, size * 0.06, 18)), keep(garden.makeMaterial({ color: coinParts[0] ? coinParts[0].color : new THREE.Color(0xe9c560), shininess: 80, specular: 0x8a7a40, emissive: 0x5a4818 })), coins.length);
  disc.frustumCulled = false;
  disc.count = 0;
  group.add(disc);
  keep(disc);

  const treasure = { group, coins, stars, count: 0, total: coins.length, remove: () => remove() };
  const d = new THREE.Object3D();
  let clock = 0;

  const hook = (dt, ex) => {
    if (!ex || treasure.removed) return;
    const t = (clock += dt);
    for (const S of stars) S.m.rotation.z += S.spin * dt;
    // Picking up: the D's middle touching a coin.
    const feet = ex.z - ex.eye;
    const mx = ex.x;
    const my = ex.y;
    const mz = feet + size * 0.5;
    const reach = size * 0.8;
    let n = 0;
    let f = 0;
    for (const C of coins) {
      if (C.got && C.pop < 0) continue;
      if (!C.got && ex.intro >= 1 && Math.abs(C.x - mx) < reach && Math.abs(C.y - my) < reach && Math.hypot(C.x - mx, C.y - my, C.z - mz) < reach) {
        C.got = true;
        C.pop = 0;
        treasure.count++;
      }
      let z = C.z + Math.sin(t * 2.2 + C.ph) * size * 0.06;
      let spin = t * 2.4 + C.ph;
      let scale = 1;
      if (C.pop >= 0) {
        // Up it pops, spinning fast, and is gone.
        C.pop += dt / 0.45;
        z += Math.sin(Math.min(1, C.pop) * Math.PI * 0.5) * size * 1.3;
        spin += C.pop * 14;
        scale = Math.max(0.001, 1 - C.pop * C.pop);
        if (C.pop >= 1) {
          C.pop = -1;
          continue;
        }
      }
      const dist = Math.hypot(C.x - mx, C.y - my);
      if (dist > span * 4) continue;
      d.position.set(C.x, C.y, z);
      d.rotation.set(0, 0, spin);
      d.scale.setScalar(scale);
      d.updateMatrix();
      if (dist < size * 14 && n < NEAR) {
        for (const m of near) m.setMatrixAt(n, d.matrix);
        n++;
      } else disc.setMatrixAt(f++, d.matrix);
    }
    for (const m of near) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    disc.count = f;
    disc.instanceMatrix.needsUpdate = true;
  };

  function remove() {
    treasure.removed = true;
    const i = garden.exploreHooks ? garden.exploreHooks.indexOf(hook) : -1;
    if (i >= 0) garden.exploreHooks.splice(i, 1);
    garden.scene.remove(group);
    disposables.forEach((x) => x.dispose && x.dispose());
    return null;
  }

  garden.exploreHooks.push(hook);
  return treasure;
}
