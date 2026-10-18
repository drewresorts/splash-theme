/*
 * The shop as a flower bed (sections/garden-shop.liquid, Products as:
 * blossoms). Each product grows as a tall plant of its own among the
 * logo's flowers: a stem rises, a bud swells and its petals fall open to
 * unveil the product's main image (or its 3D model) at the heart of the
 * flower, held there and swaying with the wind like the rest of the bed.
 *
 * The camera comes in on the first blossom as the page opens, with its
 * neighbors in view at the sides. Tapping one of them (or the arrows, the
 * arrow keys, or a sideways swipe) glides the camera over to it; tapping
 * the blossom in focus opens its product page.
 *
 * Loaded by assets/garden-splash.js in blossoms mode, which hands over the
 * 3D library and helpers (attach), so this file imports nothing itself.
 */

const GROW = 2.6; // seconds from seed to open blossom
const STAGGER = 0.35; // seconds between one plant starting and the next

export function attach(garden, G) {
  const { THREE, FLOOR_Z, clamp, lerp, range, smooth, mix, tone, toColor, mulberry32 } = G;
  const data = garden.querySelector('[data-blossom-products]');
  let products = [];
  try {
    products = JSON.parse(data ? data.textContent : '[]');
  } catch (e) {
    products = [];
  }
  if (!products.length) return;

  const ui = {
    title: garden.querySelector('[data-blossom-title]'),
    price: garden.querySelector('[data-blossom-price]'),
    link: garden.querySelector('[data-blossom-link]'),
    count: garden.querySelector('[data-blossom-count]'),
    prev: garden.querySelector('[data-blossom-prev]'),
    next: garden.querySelector('[data-blossom-next]'),
  };

  const group = new THREE.Group();
  garden.scene.add(group);
  const disposables = [];
  const rng = mulberry32((garden.seed || 1) ^ 0x5eed);
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  // Shared shapes: petals and leaves from the bed's own set, the image on a disc in a thin ring.
  const disc = new THREE.CircleGeometry(1, 48);
  const ring = new THREE.TorusGeometry(1, 0.045, 4, 48);
  disposables.push(disc, ring);
  const plastic = (color, opts) => {
    const m = garden.makeMaterial(Object.assign({ color: toColor(color) }, opts));
    disposables.push(m);
    return m;
  };
  const stemMat = plastic(tone(garden.foliage, -0.3), {});
  const leafMat = plastic(garden.foliage, { side: THREE.DoubleSide });
  const ringMat = plastic(garden.heroAccent, { shininess: 30 });

  const plants = products.map((p, i) => {
    const plant = new THREE.Group();
    const head = new THREE.Group();
    plant.add(head);
    group.add(plant);

    const stem = new THREE.Mesh(garden.geometries.stem, stemMat);
    plant.add(stem);
    const leaves = [0, 1].map((k) => {
      const leaf = new THREE.Mesh(garden.geometries.leaf, leafMat);
      leaf.rotation.order = 'ZYX';
      leaf.userData.yaw = rng() * Math.PI * 2 + k * Math.PI;
      plant.add(leaf);
      return leaf;
    });

    // Two rings of petals in the house colors, the outer a little darker.
    const outer = garden.palette[i % garden.palette.length];
    const inner = garden.palette[(i + 2) % garden.palette.length];
    const petals = [];
    // Each ring stands round the image's edge (r0, in blossom radii), so the open petals frame it.
    const ringOf = (n, color, len, wid, z, closed, open, turn, r0) => {
      const mat = plastic(color, { side: THREE.DoubleSide, shininess: 16 });
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(garden.geometries.round, mat);
        m.rotation.order = 'ZYX';
        Object.assign(m.userData, { yaw: (k / n) * Math.PI * 2 + turn, len, wid, z, closed, open, r0, delay: (k / n) * 0.12 });
        head.add(m);
        petals.push(m);
      }
    };
    ringOf(10, tone(outer, -0.08), 1.0, 0.75, -1.5, 1.3, -0.1, 0, 0.92);
    ringOf(10, inner, 0.7, 0.55, -0.5, 1.45, 0.08, Math.PI / 10, 0.9);

    // The product's image, unveiled from the center as the petals open.
    const imageMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    disposables.push(imageMat);
    const face = new THREE.Mesh(disc, imageMat);
    // Just above the petals' base (the head is scaled to the blossom's radius).
    face.position.z = 0.06;
    head.add(face);
    const frame = new THREE.Mesh(ring, ringMat);
    frame.position.z = 0.07;
    head.add(frame);
    if (p.image) {
      loader.load(
        p.image,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          // Cover the disc: the middle of the picture, never stretched.
          const a = tex.image.width / tex.image.height || 1;
          if (a > 1) {
            tex.repeat.set(1 / a, 1);
            tex.offset.set((1 - 1 / a) / 2, 0);
          } else {
            tex.repeat.set(1, a);
            tex.offset.set(0, (1 - a) / 2);
          }
          imageMat.map = tex;
          imageMat.needsUpdate = true;
          disposables.push(tex);
        },
        undefined,
        () => {}
      );
    }

    return { p, i, plant, head, stem, leaves, petals, face, frame, imageMat, startAt: 0, bx: 0, by: 0, vx: 0, vy: 0, ph: rng() * Math.PI * 2 };
  });

  // The camera moves through the garden's own view (zoom and center), which it may not have made yet.
  if (!garden.view) garden.resetView(true);

  /*
   * A product with a 3D model (uploaded to the product's media as a .glb)
   * shows that in the blossom instead of its image: fitted to the flower,
   * repainted in the bed's own plastic, low-poly look, and turning slowly.
   */
  let gltf = null;
  const modelLoader = () => {
    if (!gltf) gltf = import(garden.dataset.gltfLoader).then((m) => new m.GLTFLoader());
    return gltf;
  };
  function loadModel(pl) {
    if (!pl.p.model || !garden.dataset.gltfLoader) return;
    modelLoader()
      .then((loader) => loader.loadAsync(pl.p.model))
      .then((file) => {
        const model = file.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.traverse((o) => {
          if (!o.isMesh) return;
          const restyle = (m) => {
            const n = garden.makeMaterial({ color: m.color ? m.color.clone() : 0xffffff, map: m.map || null, side: m.side, transparent: !!m.transparent, opacity: m.opacity === undefined ? 1 : m.opacity });
            disposables.push(n);
            if (m.map) disposables.push(m.map);
            m.dispose();
            return n;
          };
          o.material = Array.isArray(o.material) ? o.material.map(restyle) : restyle(o.material);
          disposables.push(o.geometry);
        });
        // About as wide as the image it replaces, resting on the flower's heart, its front to the camera.
        const holder = new THREE.Group();
        holder.add(model);
        pl.modelK = 1.6 / Math.max(size.x, size.y, size.z, 1e-6);
        holder.position.z = 0.1 + (size.z * pl.modelK) / 2;
        pl.head.add(holder);
        pl.model = holder;
        pl.imageMat.map = null;
        pl.imageMat.color.copy(toColor(mix(garden.soil, [255, 255, 255], 0.6)));
        pl.imageMat.needsUpdate = true;
      })
      .catch((e) => console.warn('garden blossoms: 3D model', pl.p.model, e));
  }
  plants.forEach(loadModel);

  const state = { focus: 0, layoutKey: '', R: 40, S: 120, Zh: 60, t0: garden.elapsed, w: 0, h: 0 };
  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();

  /* Where the plants stand: a row through the middle of the logo, the first on the left. */
  function layout() {
    const W = garden.w;
    const H = garden.h;
    const box = garden.logoBox || { x: W * 0.2, y: H * 0.4, w: W * 0.6, h: H * 0.2 };
    const n = plants.length;
    const short = Math.min(W, H);
    const S = clamp(n > 1 ? box.w / (n - 1) : short, short * 0.32, short * 0.6);
    const R = S * 0.3;
    let top = FLOOR_Z;
    for (const f of garden.flowers) top = Math.max(top, f.z);
    const Zh = top + 26;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    plants.forEach((pl, i) => {
      const x = cx + (i - (n - 1) / 2) * S;
      pl.x = x;
      pl.y = cy;
      pl.plant.position.set(x, H - cy, FLOOR_Z);
      pl.leaves.forEach((leaf, k) => {
        leaf.position.set(0, 0, 2 + k);
        leaf.rotation.set(0, -0.12, leaf.userData.yaw);
        leaf.scale.set(R * 1.9, R * 0.9, R * 0.9);
      });
    });
    Object.assign(state, { R, S, Zh, w: W, h: H });
  }

  /* The camera on blossom i: big in the middle of the screen, its neighbors showing at the sides. */
  function focus(i, instant) {
    state.focus = clamp(i, 0, plants.length - 1);
    const pl = plants[state.focus];
    const v = garden.view;
    if (!v || pl.x === undefined) return;
    const W = garden.w;
    const H = garden.h;
    const D = garden.camDist;
    const side = W > H ? 0.42 : 0.62;
    // Screen pixels per world unit wanted at the blossom's height.
    const k = Math.min((0.56 * Math.min(W, H)) / (2 * state.R), (side * W) / state.S);
    // The camera height that gives it: the blossom is k times bigger than the ground plane.
    const camZ = Math.max(state.Zh + 80, state.Zh + D / k);
    v.tz = clamp(D / camZ, 1, 40);
    v.tcx = pl.x;
    v.tcy = pl.y;
    if (instant) Object.assign(v, { z: v.tz, cx: v.tcx, cy: v.tcy });
    garden.clampView();
    showLabel();
  }

  function showLabel() {
    const p = products[state.focus];
    if (ui.title) ui.title.textContent = p.title || '';
    if (ui.price) ui.price.textContent = p.price || '';
    if (ui.link) {
      ui.link.href = p.url;
      ui.link.setAttribute('aria-label', p.title || '');
    }
    if (ui.count) ui.count.textContent = `${state.focus + 1} / ${plants.length}`;
    if (ui.prev) ui.prev.disabled = state.focus === 0;
    if (ui.next) ui.next.disabled = state.focus === plants.length - 1;
    garden.classList.add('has-blossom-focus');
  }

  /* Where a blossom's heart is on screen, and how big it is there. */
  function onScreen(pl) {
    pl.head.getWorldPosition(v3);
    v3b.copy(v3);
    v3b.x += state.R * pl.head.scale.x;
    v3.project(garden.camera);
    v3b.project(garden.camera);
    const x = (v3.x * 0.5 + 0.5) * garden.w;
    const y = (-v3.y * 0.5 + 0.5) * garden.h;
    const r = Math.abs((v3b.x - v3.x) * 0.5 * garden.w);
    return { x, y, r };
  }

  function hit(x, y) {
    let best = null;
    let bd = Infinity;
    for (const pl of plants) {
      if (pl.open < 0.3) continue;
      const s = onScreen(pl);
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.r * 1.35 && d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best;
  }

  garden.blossomTap = (x, y) => {
    const pl = hit(x, y);
    if (!pl) return false;
    if (pl.i === state.focus) window.location.assign(pl.p.url);
    else focus(pl.i);
    return true;
  };

  // A pointer over a blossom shows it can be clicked.
  garden.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = garden.getBoundingClientRect();
    garden.classList.toggle('is-over-blossom', !!hit(e.clientX - r.left, e.clientY - r.top));
  });

  // A sideways swipe moves along the row.
  let swipe = null;
  garden.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-garden-ui]')) return;
    swipe = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  garden.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.timeStamp - swipe.t < 800) {
      garden.gestured = true;
      focus(state.focus + (dx < 0 ? 1 : -1));
      window.setTimeout(() => (garden.gestured = false), 0);
    }
    swipe = null;
  });
  if (ui.prev) ui.prev.addEventListener('click', () => focus(state.focus - 1));
  if (ui.next) ui.next.addEventListener('click', () => focus(state.focus + 1));
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'ArrowRight') focus(state.focus + 1);
    else if (e.key === 'ArrowLeft') focus(state.focus - 1);
  });

  /* Every frame: growth, the wind, and the camera following the focus through a resize. */
  garden.blossomUpdate = (t, dt) => {
    const key = `${garden.w}x${garden.h}:${garden.flowers.length}`;
    if (key !== state.layoutKey && garden.flowers.length) {
      const first = !state.layoutKey;
      state.layoutKey = key;
      layout();
      if (first) {
        // The plants come up in order from the first; the camera is already on its way.
        plants.forEach((pl, i) => (pl.startAt = t + 0.3 + i * STAGGER));
        focus(0, !!garden.reduced);
      } else focus(state.focus, true);
    }
    const R = state.R;
    const Zh = state.Zh - FLOOR_Z;
    for (const pl of plants) {
      const p = garden.reduced ? 1 : clamp((t - pl.startAt) / GROW, 0, 1);
      const stemP = smooth(range(p, 0, 0.38));
      const budP = smooth(range(p, 0.2, 0.5));
      const openP = range(p, 0.45, 0.92);
      const reveal = smooth(range(p, 0.55, 1));
      pl.open = openP;

      // The wind: the gusts that move the bed, and a slow idle sway of its own.
      const push = garden.gustPush ? garden.gustPush(pl.x) : 0;
      const idle = 0.035 * Math.sin(t * 0.9 + pl.ph) + 0.02 * Math.sin(t * 1.7 + pl.ph * 2);
      const tx = push * 0.16 + idle;
      const ty = 0.025 * Math.sin(t * 0.7 + pl.ph * 1.3);
      // A damped spring, like the flowers' heads.
      pl.vx += ((tx - pl.bx) * 30 - pl.vx * 5) * dt;
      pl.vy += ((ty - pl.by) * 30 - pl.vy * 5) * dt;
      pl.bx += pl.vx * dt;
      pl.by += pl.vy * dt;
      pl.plant.rotation.set(-pl.by * stemP, pl.bx * stemP, 0);

      const height = Math.max(0.01, Zh * stemP);
      pl.stem.scale.set(R * 0.07, R * 0.07, height);
      pl.leaves.forEach((leaf) => leaf.scale.setScalar(Math.max(1e-3, R * 1.4 * smooth(range(p, 0.1, 0.45)))));
      pl.head.position.set(0, 0, height);
      const g = Math.max(1e-3, budP);
      pl.head.scale.setScalar(R * lerp(0.45, 1, g));

      pl.petals.forEach((m) => {
        const u = m.userData;
        const e = smooth(range(openP, u.delay, u.delay + 0.75));
        // Standing closed around each other as a bud, then falling open.
        // Closed, the bases draw in to a tight bud; open, they ring the image.
        const r0 = u.r0 * lerp(0.35, 1, e);
        m.position.set(Math.cos(u.yaw) * r0, Math.sin(u.yaw) * r0, u.z * 0.05);
        m.rotation.set(0, -lerp(u.closed, u.open, e), u.yaw);
        m.scale.set(u.len * g, u.wid * g, u.wid * g);
      });
      // The image grows out from the heart of the flower and comes up to full strength.
      const s = Math.max(1e-3, reveal);
      pl.face.scale.set(s, s, 1);
      pl.imageMat.opacity = reveal;
      pl.frame.scale.set(Math.max(1e-3, reveal * 1.04), Math.max(1e-3, reveal * 1.04), 1);
      pl.frame.visible = reveal > 0.01;
      if (pl.model) {
        pl.model.scale.setScalar(pl.modelK * Math.max(1e-3, reveal));
        pl.model.rotation.y = t * 0.45 + pl.ph;
      }
    }
    // The page's own label waits for the first blossom to open.
    garden.classList.toggle('is-blossom-open', plants[state.focus].open > 0.6);
  };

  garden.blossomKit = { plants, focus, dispose: () => disposables.forEach((d) => d.dispose && d.dispose()) };
  garden.start();
}
