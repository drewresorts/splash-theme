/**
 * Garden splash
 *
 * A flower bed seen from straight above, rendered in real 3D the way cheap
 * late-90s CGI looked: a low-resolution render scaled up without smoothing,
 * one harsh light, plastic specular highlights, flat-shaded low-poly
 * geometry, distance fog and vertices that snap to a coarse grid.
 *
 * Flowers grow scattered across the screen (seed → sprout → leaves → bud →
 * bloom). Once every one has bloomed they glide into place and pack together
 * into the shape of the logo. Some flowers open an eyeball that turns in its
 * socket to follow the pointer. Visitors can switch the color scheme.
 *
 * Interaction is utilitarian: crosshair and coordinate readout, hover or
 * tap to inspect, press and drag to speed up growth, tap to recolor a
 * flower (nearby eyes blink).
 */
import * as THREE from './three.module.min.js';

const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const range = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const smooth = (t) => t * t * (3 - 2 * t);
const between = (rng, pair) => lerp(pair[0], pair[1], rng());
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(s);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [+m[1], +m[2], +m[3]];
  }
  return null;
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const POWDER = [185, 229, 251];
const OCEAN = [25, 31, 107];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tone = (c, amt) => (amt >= 0 ? mix(c, WHITE, amt) : mix(c, BLACK, -amt));
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a === undefined ? 1 : a})`;
const colorKey = (c) => `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
const hex = (c) => '#' + c.map((v) => (v | 0).toString(16).padStart(2, '0')).join('').toUpperCase();
const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const toColor = (c) => new THREE.Color(`rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);

/* Species in the bed, how often each appears, and the latin label the inspector shows. */
const SPECIES = [
  ['rose', 0.22],
  ['daisy', 0.2],
  ['tulip', 0.16],
  ['poppy', 0.16],
  ['lily', 0.14],
  ['cluster', 0.12],
];
const LATIN = {
  rose: 'ROSA',
  daisy: 'BELLIS',
  tulip: 'TULIPA',
  poppy: 'PAPAVER',
  lily: 'LILIUM',
  cluster: 'HYDRANGEA',
};
/* Species whose open center can hold an eye instead. */
const EYED = new Set(['daisy', 'poppy', 'rose']);

const DENSITY = {
  airy: { size: 1.18, spacing: 1.32 },
  lush: { size: 1, spacing: 1.18 },
  overgrown: { size: 0.84, spacing: 1.1 },
};

/* Growth milestones on a specimen's 0 → 1 progress. */
const STAGE = {
  seed: [0, 0.08],
  sprout: [0.06, 0.22],
  leaves: [0.16, 0.48],
  bud: [0.4, 0.58],
  open: [0.56, 1],
};

/* Heights above the z = 0 plane, where screen and world units match. */
const FLOOR_Z = -45; // where seeds land and stems start; no ground is drawn
const FOV = 50;
const BLINK = 0.2;
const ARRANGE = 2.4; // seconds for the bed to glide into the logo

/* Flower spacing as a fraction of the logo's letter-stroke width. */
const LOGO_SPACING = { airy: 0.5, lush: 0.36, overgrown: 0.27 };

/* The render is under-resolved on purpose, then scaled up with nearest-neighbour. */
// Narrow screens get more pixels, or the small flowers that spell the logo turn to mush.
const renderScale = (w) => (w < 750 ? 0.85 : 0.5);

/* Bridson's Poisson-disc sampling: evenly spread, never on a grid. */
function poissonDisc(x0, y0, x1, y1, minDist, rng, seedPoint) {
  const cell = minDist / Math.SQRT2;
  const cols = Math.ceil((x1 - x0) / cell);
  const rows = Math.ceil((y1 - y0) / cell);
  const grid = new Int32Array(cols * rows).fill(-1);
  const pts = [];
  const active = [];
  const d2 = minDist * minDist;

  const insert = (p) => {
    const gx = Math.floor((p[0] - x0) / cell);
    const gy = Math.floor((p[1] - y0) / cell);
    grid[gy * cols + gx] = pts.length;
    pts.push(p);
    active.push(p);
  };
  const fits = (x, y) => {
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
    const gx = Math.floor((x - x0) / cell);
    const gy = Math.floor((y - y0) / cell);
    for (let j = Math.max(0, gy - 2); j <= Math.min(rows - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(cols - 1, gx + 2); i++) {
        const idx = grid[j * cols + i];
        if (idx < 0) continue;
        const dx = pts[idx][0] - x;
        const dy = pts[idx][1] - y;
        if (dx * dx + dy * dy < d2) return false;
      }
    }
    return true;
  };

  insert(seedPoint);
  while (active.length) {
    const ai = Math.floor(rng() * active.length);
    const a = active[ai];
    let placed = false;
    for (let k = 0; k < 24; k++) {
      const ang = rng() * TAU;
      const rad = minDist * (1 + rng());
      const x = a[0] + Math.cos(ang) * rad;
      const y = a[1] + Math.sin(ang) * rad;
      if (fits(x, y)) {
        insert([x, y]);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/*
 * A petal as a small, coarse grid: base at the origin, tip at x = 1, full
 * width 1 at its widest, sides cupped up (+z) and the tip curled. Few
 * segments on purpose, so it renders as visible facets.
 */
function petalGeometry(widthAt, cup, curl, fold) {
  const sx = 5;
  const sy = 2;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= sx; i++) {
    const u = i / sx;
    const half = widthAt(u) * 0.5;
    for (let j = -sy; j <= sy; j++) {
      const v = j / sy;
      const z = cup * v * v * half + curl * u * u + (fold ? -fold * Math.abs(v) * half : 0);
      pos.push(u, v * half, z);
    }
  }
  const row = sy * 2 + 1;
  for (let i = 0; i < sx; i++) {
    for (let j = 0; j < row - 1; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const PETALS = {
  // Rose, tulip and poppy: wide and rounded, cupped.
  round: () => petalGeometry((u) => 0.12 + Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92) ** 0.72) * 0.9, 0.55, 0.12),
  // Daisy and gerbera rays: a long strap with a blunt tip.
  ray: () => petalGeometry((u) => 0.26 * (1 - u ** 8) + 0.03, 0.25, 0.04),
  // Lily: pointed, the tip curling back down.
  lily: () => petalGeometry((u) => 0.46 * Math.sin(Math.PI * u) ** 0.8 + 0.02, 0.35, -0.22),
  // Sepals and leaves: pointed and folded along the midrib.
  leaf: () => petalGeometry((u) => 0.5 * Math.sin(Math.PI * u ** 0.85) + 0.01, 0, 0.06, 0.35),
};

/* The eye texture: veined sclera, a ringed iris and the pupil, centred at u = v = 0.5. */
function eyeTexture(iris) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const sclera = g.createLinearGradient(0, 0, 256, 0);
  sclera.addColorStop(0, rgba(mix(POWDER, [240, 78, 98], 0.25)));
  sclera.addColorStop(0.5, rgba(tone(POWDER, 0.7)));
  sclera.addColorStop(1, rgba(mix(POWDER, [240, 78, 98], 0.25)));
  g.fillStyle = sclera;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(166,39,73,0.55)';
  g.lineWidth = 0.8;
  const rng = mulberry32(colorKey(iris).length * 97 + iris[0]);
  for (let i = 0; i < 26; i++) {
    let x = rng() < 0.5 ? rng() * 60 : 196 + rng() * 60;
    let y = rng() * 128;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (128 - x) * 0.18 + (rng() - 0.5) * 10;
      y += (rng() - 0.5) * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const bands = [
    [22, tone(iris, -0.7)],
    [20, tone(iris, -0.35)],
    [15, iris],
    [11, tone(iris, 0.35)],
    [8.5, tone(OCEAN, -0.85)],
  ];
  for (const [r, col] of bands) {
    g.fillStyle = rgba(col);
    g.beginPath();
    g.ellipse(128, 64, r, r, 0, 0, TAU);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/* ------------------------------------------------------------------ */
/* The element                                                         */
/* ------------------------------------------------------------------ */

class GardenSplash extends HTMLElement {
  connectedCallback() {
    this.canvas = this.querySelector('[data-garden-canvas]');
    this.overlay = this.querySelector('[data-garden-overlay]');
    if (!this.canvas || !this.overlay) return;

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
      this.renderer.setClearColor(0x000000, 0);
    } catch (e) {
      // No WebGL: show the logo and controls over the plain background.
      this.classList.add('is-ready', 'is-bloomed', 'is-static');
      return;
    }
    this.octx = this.overlay.getContext('2d');

    this.logo = this.querySelector('[data-garden-logo]');
    this.nav = this.querySelector('[data-garden-nav]');
    this.navToggles = Array.from(this.querySelectorAll('[data-garden-nav-toggle]'));
    this.menuButton = this.querySelector('[data-garden-menu]');
    this.resetButton = this.querySelector('[data-garden-replant]');
    this.bloomReadout = this.querySelector('[data-garden-bloom]');
    this.coordReadout = this.querySelector('[data-garden-coords]');
    this.schemeButtons = Array.from(this.querySelectorAll('[data-garden-scheme]'));

    this.readConfig();
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.motionQuery.matches;

    this.seed = (Math.random() * 2 ** 31) | 0;
    this.elapsed = this.reduced ? this.duration * 1.2 : 0;
    this.flowers = [];
    this.eyes = [];
    this.pings = [];
    this.pointer = { x: 0, y: 0, active: false, down: false, id: null, sx: 0, sy: 0, st: 0, type: 'mouse' };
    this.inspected = null;
    this.inspectUntil = 0;
    this.running = false;
    this.visible = true;
    this.bloomed = false;
    this.lastReadout = -1;

    this.setupScene();
    this.bindEvents();
    this.applyScheme(this.storedScheme());
    this.resize(true);
    // Layout waits for the logo's silhouette, which the flowers will form.
    this.loadMask().then(() => {
      this.maskReady = true;
      this.resize(true);
      this.start();
    });

    // Hide the server-rendered logo without animating it away.
    if (this.logo) this.logo.style.transition = 'none';
    this.classList.add('is-ready');
    if (this.logo) {
      void this.logo.offsetWidth;
      this.logo.style.transition = '';
    }

    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(this);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1].isIntersecting;
      if (this.visible) this.start();
    });
    this.intersectionObserver.observe(this);
    this.start();
  }

  disconnectedCallback() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resizeTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this.unbind) this.unbind();
    if (this.renderer) {
      this.clearMeshes();
      this.renderer.dispose();
    }
  }

  readConfig() {
    const d = this.dataset;
    this.densityName = DENSITY[d.density] ? d.density : 'lush';
    this.heroColor = parseColor(d.centerColor) || [240, 78, 98];
    this.heroAccent = parseColor(d.centerAccent) || [166, 39, 73];
    this.foliage = parseColor(d.foliageColor) || [102, 164, 200];
    this.soil = parseColor(d.soilColor) || OCEAN;
    let palette = [];
    try {
      palette = JSON.parse(d.palette || '[]').map(parseColor).filter(Boolean);
    } catch (e) {
      palette = [];
    }
    // A specimen the same color as the ground would vanish, so leave that color out.
    const ground = colorKey(this.soil);
    palette = palette.filter((c) => colorKey(c) !== ground);
    this.palette = palette.length ? palette : [[166, 39, 73], [102, 164, 200], [185, 229, 251], [240, 78, 98]];
    this.house = { palette: this.palette, foliage: this.foliage, center: this.heroColor, accent: this.heroAccent };
    this.isLight = luminance(this.soil) > 0.6;
    this.ink = this.isLight ? OCEAN : POWDER;
    this.duration = clamp(parseFloat(d.duration) || 12, 2, 60);
    this.density = DENSITY[d.density] || DENSITY.lush;
  }

  /* ---------------- scene ---------------- */

  setupScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    // No background or ground: only the flowers are drawn, over whatever is behind the section.
    this.fogColor = this.isLight ? toColor(WHITE) : toColor(mix(this.soil, POWDER, 0.18));

    // One harsh key light from the top left and a flat ambient fill.
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-0.7, 0.9, 1.2);
    scene.add(key);
    scene.add(new THREE.AmbientLight(toColor(mix(POWDER, this.soil, 0.4)), 0.9));

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 5000);

    // Every vertex snaps to a coarse screen grid, the way early console 3D wobbled.
    this.snap = { value: new THREE.Vector2(160, 90) };
    const snap = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uSnap = this.snap;
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'uniform vec2 uSnap;\nvoid main() {')
          .replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;'
          );
      };
      return mat;
    };
    const plastic = (opts) => snap(new THREE.MeshPhongMaterial(Object.assign({ color: 0xffffff, specular: 0xffffff, shininess: 70, flatShading: true }, opts)));
    this.materials = {
      plastic: plastic({}),
      petal: plastic({ side: THREE.DoubleSide, shininess: 90 }),
      gloss: plastic({ shininess: 140, flatShading: false }),
      foliage: plastic({ shininess: 30, specular: 0x777777, side: THREE.DoubleSide }),
      lid: plastic({ shininess: 50, side: THREE.DoubleSide, flatShading: false }),
    };
    this.makeMaterial = plastic;
    this.snapMaterial = snap;

    this.geometries = {
      round: PETALS.round(),
      ray: PETALS.ray(),
      lily: PETALS.lily(),
      leaf: PETALS.leaf(),
      ball: new THREE.IcosahedronGeometry(1, 1),
      tube: new THREE.CylinderGeometry(1, 1, 1, 5, 1).rotateZ(-Math.PI / 2).translate(0.5, 0, 0),
      stem: new THREE.CylinderGeometry(1, 1, 1, 5, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      eye: new THREE.SphereGeometry(1, 18, 12).rotateY(-Math.PI / 2),
      lidTop: new THREE.SphereGeometry(1.1, 18, 7, 0, TAU, 0, Math.PI / 2),
      lidBottom: new THREE.SphereGeometry(1.1, 18, 7, 0, TAU, Math.PI / 2, Math.PI / 2),
      socket: new THREE.TorusGeometry(1.1, 0.2, 6, 18),
    };

    this.eyeTextures = new Map();
    this.dummy = new THREE.Object3D();
    this.tmp = new THREE.Vector3();
  }

  /* ---------------- color schemes ---------------- */

  /* Scheme 0 is the store's own colors; the others come from the swatch buttons. */
  schemeAt(i) {
    const b = this.schemeButtons[i];
    if (!b || i === 0) return this.house;
    try {
      return {
        palette: JSON.parse(b.dataset.palette).map(parseColor).filter(Boolean),
        foliage: parseColor(b.dataset.foliage) || this.house.foliage,
        center: parseColor(b.dataset.center) || this.house.center,
        accent: parseColor(b.dataset.accent) || this.house.accent,
      };
    } catch (e) {
      return this.house;
    }
  }

  storedScheme() {
    try {
      const i = parseInt(window.localStorage.getItem('garden-splash-scheme'), 10);
      return i >= 0 && i < this.schemeButtons.length ? i : 0;
    } catch (e) {
      return 0;
    }
  }

  applyScheme(i) {
    const sc = this.schemeAt(i);
    this.scheme = i;
    this.palette = sc.palette.length ? sc.palette : this.house.palette;
    this.foliage = sc.foliage;
    this.heroColor = sc.center;
    this.heroAccent = sc.accent;
    this.schemeButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  }

  /* A visitor picked a scheme: recolor every flower in place and remember it. */
  pickScheme(i) {
    this.applyScheme(i);
    try {
      window.localStorage.setItem('garden-splash-scheme', String(i));
    } catch (e) {
      /* private mode: the choice just isn't remembered */
    }
    if (!this.flowers.length) return;
    for (const f of this.flowers) this.sequence(f);
    this.buildMeshes();
  }

  /* ---------------- logo silhouette ---------------- */

  /* Reads the logo's alpha channel; the bloomed flowers arrange themselves into it. */
  loadMask() {
    const src = this.dataset.flowerLogo;
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = window.setTimeout(resolve, 4000);
      img.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onload = () => {
        clearTimeout(timer);
        try {
          const w = 400;
          const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, w, h);
          const data = g.getImageData(0, 0, w, h).data;
          const alpha = new Uint8Array(w * h);
          let x0 = w;
          let y0 = h;
          let x1 = 0;
          let y1 = 0;
          for (let i = 0; i < w * h; i++) {
            alpha[i] = data[i * 4 + 3];
            if (alpha[i] > 127) {
              const x = i % w;
              const y = (i / w) | 0;
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
          if (x1 > x0 && y1 > y0) this.mask = { w, h, alpha, x0, y0, x1: x1 + 1, y1: y1 + 1 };
        } catch (e) {
          // The image can't be read (no CORS): the flowers stay where they grew.
        }
        resolve();
      };
      img.src = src;
    });
  }

  /*
   * Fits the logo to the screen and fills it with evenly spaced spots, one
   * per flower. Spacing follows the letter-stroke width, scaled by density.
   */
  layoutLogo(rng) {
    const m = this.mask;
    const { w: W, h: H } = this;
    const bw = m.x1 - m.x0;
    const bh = m.y1 - m.y0;
    const k = Math.min((W * 0.88) / bw, (H * 0.62) / bh);
    const lw = bw * k;
    const lh = bh * k;
    const ox = (W - lw) / 2;
    const oy = (H - lh) / 2;
    const inside = (x, y) => {
      const mx = Math.floor(m.x0 + (x - ox) / k);
      const my = Math.floor(m.y0 + (y - oy) / k);
      return mx >= 0 && my >= 0 && mx < m.w && my < m.h && m.alpha[my * m.w + mx] > 110;
    };
    // A wide wordmark ends in the asterisk: flowers there take the asterisk color.
    const starFrom = bw / bh > 2 ? 0.74 : 2;
    let spacing = Math.max(7, lh * 0.16 * LOGO_SPACING[this.densityName]);
    let spots = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      spots = poissonDisc(ox, oy, ox + lw, oy + lh, spacing, rng, [ox + lw / 2, oy + lh / 2]).filter(([x, y]) => inside(x, y));
      if (spots.length <= 900) break;
      spacing *= 1.15;
    }
    this.base = spacing;
    this.logoBox = { x: ox, y: oy, w: lw, h: lh };
    return spots.map(([x, y]) => ({ x, y, r: spacing * lerp(0.9, 1.06, rng()), star: (x - ox) / lw > starFrom }));
  }

  eyeMaterial(iris) {
    const key = colorKey(iris);
    if (!this.eyeTextures.has(key)) {
      const m = this.makeMaterial({ map: eyeTexture(iris), shininess: 160, flatShading: false });
      this.eyeTextures.set(key, m);
    }
    return this.eyeTextures.get(key);
  }

  /* ---------------- events ---------------- */

  bindEvents() {
    const local = (e) => {
      const r = this.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const isUi = (e) => e.target instanceof Element && e.target.closest('[data-garden-ui]');

    const onDown = (e) => {
      if (isUi(e) || this.classList.contains('is-nav-open')) return;
      const [x, y] = local(e);
      Object.assign(this.pointer, { x, y, active: true, down: true, id: e.pointerId, sx: x, sy: y, st: e.timeStamp, type: e.pointerType });
      this.markInteracted();
      this.updateCoords();
      try {
        this.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is best-effort */
      }
    };
    const onMove = (e) => {
      const p = this.pointer;
      if (e.pointerType !== 'mouse' && !(p.down && p.id === e.pointerId)) return;
      if (this.classList.contains('is-nav-open')) return;
      if (isUi(e) && !p.down) {
        p.active = false;
        return;
      }
      const [x, y] = local(e);
      p.x = x;
      p.y = y;
      p.active = true;
      p.type = e.pointerType;
      this.updateCoords();
    };
    const onUp = (e) => {
      const p = this.pointer;
      if (!p.down || p.id !== e.pointerId) return;
      const [x, y] = local(e);
      if (Math.hypot(x - p.sx, y - p.sy) < 14 && e.timeStamp - p.st < 450) this.tap(x, y);
      p.down = false;
      if (e.pointerType !== 'mouse') p.active = false;
    };
    const onLeave = (e) => {
      if (e.pointerType === 'mouse' || e.type === 'pointercancel') {
        this.pointer.active = false;
        this.pointer.down = false;
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && this.classList.contains('is-nav-open')) this.toggleNav(false);
    };
    const onToggle = () => this.toggleNav();
    const onReset = () => this.replant();
    const onMotion = () => {
      this.reduced = this.motionQuery.matches;
    };

    this.addEventListener('pointerdown', onDown);
    this.addEventListener('pointermove', onMove);
    this.addEventListener('pointerup', onUp);
    this.addEventListener('pointercancel', onLeave);
    this.addEventListener('pointerleave', onLeave);
    document.addEventListener('keydown', onKey);
    this.navToggles.forEach((el) => el.addEventListener('click', onToggle));
    if (this.resetButton) this.resetButton.addEventListener('click', onReset);
    this.schemeButtons.forEach((b, i) => b.addEventListener('click', () => this.pickScheme(i)));
    this.motionQuery.addEventListener('change', onMotion);

    this.unbind = () => {
      document.removeEventListener('keydown', onKey);
      this.motionQuery.removeEventListener('change', onMotion);
    };
  }

  markInteracted() {
    if (!this.classList.contains('has-interacted')) this.classList.add('has-interacted');
  }

  updateCoords() {
    if (!this.coordReadout) return;
    const p = this.pointer;
    const x = String(Math.round(p.x - this.w / 2)).padStart(5, ' ');
    const y = String(Math.round(this.h / 2 - p.y)).padStart(5, ' ');
    this.coordReadout.textContent = `X${x}  Y${y}`;
  }

  toggleNav(force) {
    if (!this.nav) return;
    const open = typeof force === 'boolean' ? force : !this.classList.contains('is-nav-open');
    this.classList.toggle('is-nav-open', open);
    this.navToggles.forEach((el) => el.setAttribute('aria-expanded', String(open)));
    if (this.menuButton) {
      this.menuButton.textContent = open ? this.menuButton.dataset.closeLabel : this.menuButton.dataset.openLabel;
    }
    this.pointer.active = false;
    this.pointer.down = false;
    if (open) {
      const first = this.nav.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    } else if (this.contains(document.activeElement) && this.menuButton) {
      this.menuButton.focus({ preventScroll: true });
    }
  }

  /* ---------------- layout ---------------- */

  scheduleResize() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.resize(false), 120);
  }

  resize(initial) {
    const rect = this.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    if (!initial && W === this.w && H === this.h) return;
    const relayout = initial || !this.flowers.length || W !== this.w || Math.abs(H - this.h) > 90;
    this.w = W;
    this.h = H;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // The 3D render is drawn small and scaled up by CSS with nearest-neighbour.
    this.rs = renderScale(W);
    this.renderer.setPixelRatio(this.rs);
    this.renderer.setSize(W, H, false);
    this.snap.value.set(W * this.rs * 0.25, H * this.rs * 0.25);

    // Perspective camera looking straight down; the z = 0 plane maps 1:1 to the screen.
    const dist = H / 2 / Math.tan((FOV * Math.PI) / 360);
    this.camDist = dist;
    this.camera.aspect = W / H;
    this.camera.position.set(W / 2, H / 2, dist);
    this.camera.lookAt(W / 2, H / 2, 0);
    this.camera.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(this.fogColor, dist + 30, dist + 320);

    this.overlay.width = Math.round(W * this.dpr);
    this.overlay.height = Math.round(H * this.dpr);

    if (!this.maskReady) return;
    // A small height change (mobile browser chrome) keeps the same field, re-placed.
    if (relayout || !this.flowers.length) this.generate();
    else this.buildMeshes();
    this.project();
  }

  generate() {
    const { w: W, h: H } = this;
    const rng = mulberry32(this.seed);
    const D = this.duration;
    const targets = this.mask ? this.layoutLogo(rng) : null;
    if (!targets) this.base = clamp(Math.sqrt(W * H) * 0.075 * this.density.size, 30, 96);
    const base = this.base;

    // Where the flowers first grow: scattered over the whole screen.
    const count = targets ? targets.length : 0;
    const spread = targets ? Math.sqrt((W * H * 0.62) / Math.max(1, count)) : base * this.density.spacing;
    let starts = poissonDisc(0, 0, W, H, spread, rng, [W / 2, H / 2]);
    for (let i = starts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [starts[i], starts[j]] = [starts[j], starts[i]];
    }
    if (targets) {
      while (starts.length < count) starts.push([rng() * W, rng() * H]);
      starts = starts.slice(0, count);
      // Paired left to right, so the bed glides into the logo without much crossing.
      starts.sort((a, b) => a[0] - b[0]);
      targets.sort((a, b) => a.x - b.x);
    }

    const maxDist = Math.hypot(W / 2, H / 2);
    this.flowers = starts.map(([x, y], i) => {
      const target = targets && targets[i];
      const r = target ? target.r : base * lerp(0.88, 1.16, rng());
      const dn = clamp(Math.hypot(x - W / 2, y - H / 2) / maxDist, 0, 1);
      const startAt = D * (0.02 + 0.5 * (0.45 * (1 - dn) + 0.55 * rng()));
      const f = this.makeFlower(x, y, lerp(-25, 30, rng()), r, rng, { id: i + 1, startAt, dur: D * lerp(0.36, 0.5, rng()), star: target && target.star });
      f.home = [x, y];
      f.dest = target ? [target.x, target.y] : [x, y];
      f.moveDelay = target ? (target.x / W) * 0.7 + rng() * 0.25 : 0;
      f.lift = 0;
      return f;
    });

    this.hasTargets = !!targets;
    this.arrangeAt = -1;
    this.arranged = false;
    this.bloomed = false;
    this.inspected = null;
    this.classList.remove('is-bloomed');
    const t = this.elapsed;
    this.flowers.forEach((f) => (f.p = clamp((t - f.startAt) / f.dur, 0, 1)));
    if (this.reduced) this.settle();
    this.assignEyes(rng);
    this.buildMeshes();
  }

  /* Puts every flower straight into its place in the logo (reduced motion). */
  settle() {
    for (const f of this.flowers) {
      f.p = 1;
      [f.x, f.y] = f.dest;
      f.lift = 0;
      f.shown = -1;
    }
    this.arranged = true;
    this.bloomed = true;
    this.classList.add('is-bloomed');
  }

  makeFlower(x, y, z, r, rng, opts) {
    const f = {
      id: opts.id,
      x,
      y,
      z,
      r,
      star: !!opts.star,
      startAt: opts.startAt,
      dur: Math.max(0.5, opts.dur),
      p: 0,
      shown: -1,
      boost: 1,
      rot: rng() * TAU,
      seedAngle: rng() * TAU,
      partSeed: (rng() * 2 ** 31) | 0,
      colorIndex: Math.floor(rng() * 1000),
      species: 'rose',
    };
    let v = rng();
    for (const [name, weight] of SPECIES) {
      if ((v -= weight) <= 0) {
        f.species = name;
        break;
      }
    }
    if (r < 12) f.species = 'daisy';
    const leafCount = 2 + Math.floor(rng() * 3);
    f.leaves = [];
    for (let i = 0; i < leafCount; i++) {
      f.leaves.push({
        a: f.rot + (i / leafCount) * TAU + (rng() - 0.5) * 0.9,
        len: r * lerp(1.05, 1.4, rng()),
        w: r * lerp(0.36, 0.5, rng()),
        delay: (i / Math.max(1, leafCount)) * 0.35,
      });
    }
    this.sequence(f);
    return f;
  }

  /*
   * Builds a specimen from parts. Each part is placed in the flower's frame:
   * yaw a around the center, an optional offset out along offA, and a pitch
   * that goes from closed (petal standing up, a bud) to open as it blooms.
   *   kind: geometry; sx/sy/sz: full size; grow: which stage drives it.
   */
  sequence(f) {
    // The same seed every time, so a recolor keeps the exact same petals.
    const rng = mulberry32(f.partSeed);
    const r = f.r;
    const parts = [];
    const petal = (kind, color, a, len, w, closed, open, delay, z) =>
      parts.push({ kind, color, a, sx: len, sy: w, sz: w, closed, open, delay, z: z || 0, grow: 'petal' });
    const center = (kind, color, sx, sy, sz, z, extra) => parts.push(Object.assign({ kind, color, a: 0, sx, sy, sz, z, grow: 'center' }, extra));
    const sepals = (n, len) => {
      for (let i = 0; i < n; i++) {
        parts.push({ kind: 'leaf', color: tone(this.foliage, -0.2), a: (i / n) * TAU + 0.3, sx: len, sy: len * 0.45, sz: len * 0.45, closed: 1.2, open: -0.15, delay: 0, z: -4, grow: 'sepal' });
      }
    };
    const ring = (n, kind, color, len, w, closed, open, delay, z, offset) => {
      const off = offset === undefined ? rng() * TAU : offset;
      for (let i = 0; i < n; i++) {
        petal(kind, color, off + (i / n) * TAU + (rng() - 0.5) * (TAU / n) * 0.25, len * lerp(0.92, 1.06, rng()), w * lerp(0.9, 1.08, rng()), closed, open, delay + (i / n) * 0.12, z);
      }
    };

    if (f.star) {
      f.color = this.heroColor;
      f.color2 = this.heroAccent;
    } else {
      const n = this.palette.length;
      f.color = this.palette[f.colorIndex % n];
      f.color2 = n > 1 ? this.palette[(f.colorIndex + 1 + (f.colorIndex >> 3) % (n - 1)) % n] : this.ink;
    }
    const c = f.color;

    switch (f.species) {
      case 'rose': {
        sepals(5, r * 0.8);
        // Rings spiral inward, each tighter and more upright than the last.
        const rings = [
          [5, 1, 0.86, 0.28],
          [5, 0.84, 0.76, 0.55],
          [6, 0.68, 0.62, 0.85],
          [6, 0.52, 0.5, 1.1],
          [5, 0.38, 0.38, 1.3],
          [4, 0.25, 0.26, 1.45],
        ];
        rings.forEach(([n, len, w, open], k) => ring(n, 'round', tone(c, k * 0.05), r * len, r * w, 1.5, open, k * 0.1, k * 2, k * 0.7));
        if (!f.eye) center('ball', tone(c, -0.25), r * 0.1, r * 0.1, r * 0.1, r * 0.3);
        break;
      }
      case 'daisy': {
        sepals(6, r * 0.6);
        const n = 16 + Math.floor(rng() * 6);
        ring(n, 'ray', c, r, r * 0.95, 1.4, 0.06, 0, 0);
        ring(n, 'ray', tone(c, -0.08), r * 0.9, r * 0.9, 1.4, 0.14, 0.1, 1.5, Math.PI / n);
        if (!f.eye) {
          center('ball', f.color2, r * 0.26, r * 0.26, r * 0.12, r * 0.06);
          for (let i = 0; i < 18; i++) center('ball', tone(f.color2, 0.3), r * 0.03, r * 0.03, r * 0.03, r * 0.14, { off: r * 0.2 * Math.sqrt((i + 1) / 18), offA: i * 2.39996 });
        }
        break;
      }
      case 'tulip':
        sepals(3, r * 0.5);
        ring(3, 'round', c, r * 0.95, r * 0.95, 1.5, 0.95, 0, 0);
        ring(3, 'round', tone(c, 0.08), r * 0.9, r * 0.9, 1.5, 1.05, 0.15, 2, Math.PI / 3);
        for (let i = 0; i < 6; i++) parts.push({ kind: 'tube', color: OCEAN, a: (i / 6) * TAU, sx: r * 0.32, sy: r * 0.03, sz: r * 0.03, closed: 1.5, open: 1.05, delay: 0.5, z: 2, grow: 'stamen' });
        center('ball', tone(this.foliage, 0.2), r * 0.08, r * 0.08, r * 0.12, r * 0.08);
        break;
      case 'poppy':
        sepals(2, r * 0.5);
        ring(2, 'round', c, r * 1.05, r * 1.15, 1.5, 0.28, 0, 0);
        ring(2, 'round', tone(c, -0.1), r * 0.98, r * 1.1, 1.5, 0.4, 0.15, 2, Math.PI / 2);
        if (!f.eye) {
          center('ball', f.color2, r * 0.16, r * 0.16, r * 0.14, r * 0.12);
          for (let i = 0; i < 22; i++) parts.push({ kind: 'tube', color: OCEAN, a: (i / 22) * TAU, sx: r * 0.26, sy: r * 0.018, sz: r * 0.018, closed: 1.3, open: 0.55, delay: 0.5, z: 4, grow: 'stamen' });
        }
        break;
      case 'lily':
        sepals(3, r * 0.4);
        ring(3, 'lily', c, r * 1.05, r * 0.55, 1.45, 0.05, 0, 0);
        ring(3, 'lily', tone(c, 0.1), r, r * 0.5, 1.45, 0.12, 0.15, 2, Math.PI / 3);
        for (let i = 0; i < 6; i++) {
          parts.push({ kind: 'tube', color: tone(this.foliage, 0.2), a: (i / 6) * TAU + 0.3, sx: r * 0.55, sy: r * 0.02, sz: r * 0.02, closed: 1.4, open: 0.75, delay: 0.5, z: 3, grow: 'stamen' });
        }
        break;
      default: {
        // A dome of tiny four-petal florets.
        const florets = 7;
        for (let k = 0; k < florets; k++) {
          const off = k === 0 ? 0 : r * 0.42;
          const offA = k === 0 ? 0 : ((k - 1) / (florets - 1)) * TAU;
          const fz = k === 0 ? r * 0.18 : 0;
          const tint = tone(c, (k % 3) * 0.08);
          for (let i = 0; i < 4; i++) {
            parts.push({ kind: 'round', color: tint, a: (i / 4) * TAU + k, sx: r * 0.34, sy: r * 0.36, sz: r * 0.36, closed: 1.4, open: 0.2, delay: k * 0.06, z: fz, grow: 'petal', off, offA });
          }
        }
        break;
      }
    }
    f.parts = parts;
  }

  /* Some specimens open an eye in place of their center, where nothing covers it. */
  assignEyes(rng) {
    const all = this.flowers;
    const irises = [this.foliage, this.heroAccent, this.heroColor].concat(this.palette).filter((c) => colorKey(c) !== colorKey(this.soil));
    for (const f of all) {
      f.eye = null;
      if (!EYED.has(f.species) || f.r < 12 || rng() > 0.4) continue;
      // Judged where the flower ends up, in the logo.
      let hidden = false;
      for (const o of all) {
        if (hidden) break;
        if (o !== f && o.z > f.z && (o.dest[0] - f.dest[0]) ** 2 + (o.dest[1] - f.dest[1]) ** 2 < (o.r * 0.85) ** 2) hidden = true;
      }
      if (hidden) continue;
      f.eye = {
        iris: pick(rng, irises),
        roll: (rng() - 0.5) * 0.4,
        look: new THREE.Vector3(),
        nextBlink: this.elapsed + 2 + rng() * 8,
        blinkAt: -1,
        delay: rng() * 0.05,
      };
      // Rebuilt without its usual center, so the eye sits where it was.
      this.sequence(f);
    }
  }

  /* ---------------- meshes ---------------- */

  clearMeshes() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.material && o.material.ownedByEye) o.material.dispose();
    });
    this.group = null;
  }

  /*
   * Every part of every specimen is drawn from a handful of instanced meshes
   * (one draw call per geometry); the eyes are plain meshes.
   */
  buildMeshes() {
    this.clearMeshes();
    const group = new THREE.Group();
    this.group = group;
    this.scene.add(group);
    const G = this.geometries;
    const M = this.materials;
    const counts = { stem: 0, leaf: 0, ball: 0 };
    const want = (kind) => (counts[kind] = (counts[kind] || 0) + 1);

    for (const f of this.flowers) {
      want('stem');
      want('ball');
      f.leaves.forEach(() => want('leaf'));
      f.parts.forEach((part) => want(part.kind));
    }

    this.meshes = {};
    for (const [kind, count] of Object.entries(counts)) {
      if (!count) continue;
      const mat = kind === 'stem' ? M.foliage : kind === 'leaf' ? M.foliage : kind === 'ball' ? M.plastic : kind === 'tube' ? M.gloss : M.petal;
      const mesh = new THREE.InstancedMesh(G[kind], mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.used = 0;
      group.add(mesh);
      this.meshes[kind] = mesh;
    }

    const color = new THREE.Color();
    const take = (kind, c) => {
      const mesh = this.meshes[kind];
      const i = mesh.used++;
      mesh.setColorAt(i, color.copy(toColor(c)));
      return { mesh, i };
    };

    for (const f of this.flowers) {
      f.slots = {
        stem: take('stem', tone(this.foliage, -0.35)),
        seed: take('ball', this.heroAccent),
        leaves: f.leaves.map(() => take('leaf', this.foliage)),
        parts: f.parts.map((part) => take(part.kind, part.color)),
      };
      f.shown = -1;
    }
    Object.values(this.meshes).forEach((m) => (m.instanceColor.needsUpdate = true));

    // Eyes: an eyeball that turns in its socket, and lids that close over it.
    for (const f of this.flowers) {
      if (!f.eye) continue;
      const e = f.eye;
      const R = f.r * 0.2;
      const eg = new THREE.Group();
      eg.position.set(f.x, this.h - f.y, f.z + f.r * 0.14 + R * 0.4);
      eg.rotation.z = e.roll;
      const lidMat = M.lid.clone();
      lidMat.color = toColor(tone(f.color, -0.1));
      lidMat.onBeforeCompile = M.lid.onBeforeCompile;
      lidMat.ownedByEye = true;
      const socket = new THREE.Mesh(G.socket, lidMat);
      socket.scale.setScalar(R);
      const ball = new THREE.Mesh(G.eye, this.eyeMaterial(e.iris));
      ball.scale.setScalar(R);
      const top = new THREE.Mesh(G.lidTop, lidMat);
      const bottom = new THREE.Mesh(G.lidBottom, lidMat);
      top.scale.setScalar(R);
      bottom.scale.setScalar(R);
      eg.add(socket, ball, top, bottom);
      eg.visible = false;
      group.add(eg);
      Object.assign(e, { group: eg, ball, top, bottom, R });
      e.look.set(f.x, this.h - f.y, this.camDist);
    }
  }

  /* Screen position and size of each head, for inspecting and tapping. */
  project() {
    const v = this.tmp;
    for (const f of this.flowers) {
      v.set(f.x, this.h - f.y, f.z).project(this.camera);
      f.sx = (v.x * 0.5 + 0.5) * this.w;
      f.sy = (-v.y * 0.5 + 0.5) * this.h;
      f.sr = f.r * (this.camDist / (this.camDist - f.z));
    }
  }

  /* Places every part of a specimen for its current growth. */
  shape(f) {
    const p = f.p;
    const S = f.slots;
    const d = this.dummy;
    const X = f.x;
    const Y = this.h - f.y;
    const Z = f.z + f.lift;
    const r = f.r;
    const zero = 1e-4;
    d.rotation.order = 'ZYX';
    const put = (slot, x, y, z, yaw, pitch, sx, sy, sz) => {
      d.position.set(x, y, z);
      d.rotation.set(0, -pitch, yaw);
      d.scale.set(sx || zero, sy || zero, sz || zero);
      d.updateMatrix();
      slot.mesh.setMatrixAt(slot.i, d.matrix);
      slot.mesh.instanceMatrix.needsUpdate = true;
    };

    const seedIn = range(p, STAGE.seed[0], STAGE.seed[1]);
    const sprout = range(p, STAGE.sprout[0], STAGE.sprout[1]);
    const leaves = range(p, STAGE.leaves[0], STAGE.leaves[1]);
    const budP = smooth(range(p, STAGE.bud[0], STAGE.bud[1]));
    const openP = range(p, STAGE.open[0], STAGE.open[1]);

    // The seed drops from near the camera down onto the soil.
    const seedZ = lerp(this.camDist * 0.7, FLOOR_Z + 3, seedIn * seedIn);
    const seedS = seedIn > 0 && sprout < 1 ? 3.5 : 0;
    put(S.seed, X, Y, seedZ, 0, 0, seedS, seedS, seedS);

    // The stem rises from the soil to where the head will be.
    const stemH = (Z - FLOOR_Z) * smooth(Math.max(sprout * 0.25, leaves));
    const stemR = sprout > 0 ? Math.max(1.5, r * 0.05) : 0;
    put(S.stem, X, Y, FLOOR_Z, 0, 0, stemR, stemR, Math.max(zero, stemH));

    f.leaves.forEach((leaf, i) => {
      const lp = smooth(range(leaves, leaf.delay, leaf.delay + 0.65));
      const lz = FLOOR_Z + (Z - 14 - FLOOR_Z) * lp;
      put(S.leaves[i], X, Y, lz, leaf.a, lerp(1.2, 0.1, lp), leaf.len * lp, leaf.w * 2 * lp, leaf.w * 2 * lp);
    });

    // Petals stand closed around each other as a bud, then fall open.
    f.parts.forEach((part, i) => {
      let s = 0;
      let pitch = part.closed || 0;
      if (part.grow === 'petal') {
        const e = smooth(range(openP, part.delay, part.delay + 0.6));
        s = budP * lerp(0.42, 1, e);
        pitch = lerp(part.closed, part.open, e);
      } else if (part.grow === 'sepal') {
        const e = smooth(range(openP, 0, 0.4));
        s = budP;
        pitch = lerp(part.closed, part.open, e);
      } else if (part.grow === 'stamen') {
        const e = smooth(range(openP, 0.45, 0.85));
        s = e;
        pitch = lerp(part.closed, part.open, e);
      } else {
        s = smooth(range(openP, 0.45, 0.85));
        pitch = 0;
      }
      const off = part.off || 0;
      const oa = f.rot + (part.offA || 0);
      put(
        S.parts[i],
        X + Math.cos(oa) * off,
        Y + Math.sin(oa) * off,
        Z + (part.z || 0),
        f.rot + part.a,
        pitch,
        part.sx * s,
        part.sy * s,
        part.sz * s
      );
    });

  }

  replant() {
    if (this.classList.contains('is-nav-open')) this.toggleNav(false);
    this.markInteracted();
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.elapsed = this.reduced ? this.duration * 1.2 : 0;
    this.pings.length = 0;
    this.generate();
    this.project();
    this.start();
  }

  /* ---------------- interaction ---------------- */

  nearest(x, y, reach) {
    let best = null;
    let bd = reach * reach;
    for (const f of this.flowers) {
      const d2 = (x - f.sx) ** 2 + (y - f.sy) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = f;
      }
    }
    return best;
  }

  tap(x, y) {
    this.pings.push({ x, y, t: 0 });
    const f = this.nearest(x, y, this.base * 1.1);
    if (!f) return;
    this.inspected = f;
    this.inspectUntil = this.elapsed + 2.5;

    if (f.p < 1) {
      f.startAt = Math.min(f.startAt, this.elapsed);
      f.boost = Math.max(f.boost, 10);
    } else {
      // Recolor: the next color in the scheme, re-bloomed from the bud.
      const was = colorKey(f.color);
      for (let i = 0; i < 6 && colorKey(f.color) === was; i++) {
        f.colorIndex++;
        this.sequence(f);
      }
      f.p = STAGE.bud[0];
      f.boost = 4;
      this.rebuild = true;
    }
    // Every eye nearby blinks, in a ripple out from the tap.
    for (const o of this.flowers) {
      if (!o.eye) continue;
      const dd = Math.hypot(o.sx - x, o.sy - y);
      if (dd < this.base * 6) o.eye.blinkAt = this.elapsed + dd / (this.base * 14);
    }
  }

  /* ---------------- loop ---------------- */

  start() {
    if (this.running || !this.isConnected || !this.renderer || !this.maskReady) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      if (!this.visible) {
        this.running = false;
        return;
      }
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.drawOverlay();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;
    const ptr = this.pointer;
    const reach = this.base * 2.4;
    let total = 0;

    if (this.rebuild) {
      this.rebuild = false;
      this.buildMeshes();
    }

    // Once the whole bed has bloomed, it glides into the shape of the logo.
    if (this.hasTargets && !this.arranged) {
      if (this.arrangeAt < 0 && this.flowers.length && this.flowers.every((f) => f.p >= 1)) this.arrangeAt = t;
      if (this.arrangeAt >= 0) {
        let done = true;
        for (const f of this.flowers) {
          const k = range(t - this.arrangeAt - f.moveDelay, 0, ARRANGE);
          if (k < 1) done = false;
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          f.x = lerp(f.home[0], f.dest[0], e);
          f.y = lerp(f.home[1], f.dest[1], e);
          f.lift = Math.sin(Math.PI * k) * 70;
          f.shown = -1;
        }
        this.project();
        if (done) {
          this.arranged = true;
          this.bloomed = true;
          this.classList.add('is-bloomed');
        }
      }
    }

    for (const f of this.flowers) {
      // Press and drag to accelerate growth under the pointer.
      if (ptr.down && f.p < 1 && Math.hypot(f.sx - ptr.x, f.sy - ptr.y) < reach) {
        f.startAt = Math.min(f.startAt, t);
        f.boost = Math.max(f.boost, 1 + 5 * (1 - Math.hypot(f.sx - ptr.x, f.sy - ptr.y) / reach));
      }
      if (t >= f.startAt && f.p < 1) {
        f.p = Math.min(1, f.p + (dt / f.dur) * f.boost);
        if (f.p >= 1) f.boost = 1;
      }
      if (f.p !== f.shown) {
        f.shown = f.p;
        this.shape(f);
      }
      total += f.p;
    }

    if (!this.bloomed && !this.hasTargets && this.flowers.length && this.flowers.every((f) => f.p >= 1)) {
      this.bloomed = true;
      this.classList.add('is-bloomed');
    }

    const tick = Math.floor(t * 8);
    if (this.bloomReadout && tick !== this.lastReadout) {
      this.lastReadout = tick;
      const pct = this.flowers.length ? Math.round((total / this.flowers.length) * 100) : 0;
      this.bloomReadout.textContent = String(pct).padStart(3, '0') + '%';
    }

    if (ptr.active && ptr.type === 'mouse' && !ptr.down) {
      this.inspected = this.nearest(ptr.x, ptr.y, this.base * 1.1);
    } else if (this.inspected && t > this.inspectUntil) {
      this.inspected = null;
    }

    this.updateEyes(dt);
    for (const pg of this.pings) pg.t += dt;
    this.pings = this.pings.filter((pg) => pg.t < 0.25);
  }

  /* Where the eyes look: the pointer, otherwise mostly straight up at the viewer. */
  lookTarget(out) {
    const ptr = this.pointer;
    const nav = this.classList.contains('is-nav-open');
    if (!nav && ptr.active) {
      // A point in space under the pointer, between the field and the camera.
      out.set((ptr.x / this.w) * 2 - 1, -(ptr.y / this.h) * 2 + 1, 0.5).unproject(this.camera);
      const dir = out.sub(this.camera.position).normalize();
      const k = (120 - this.camera.position.z) / dir.z;
      return out.copy(this.camera.position).addScaledVector(dir, k);
    }
    if (!nav && this.arranged && this.elapsed % 17 > 12) return out.set(this.w / 2, this.h / 2, 80);
    return null;
  }

  updateEyes(dt) {
    const t = this.elapsed;
    const target = this.lookTarget(this.tmp);
    const k = 1 - Math.exp(-dt * (this.reduced ? 30 : 9));
    for (const f of this.flowers) {
      const e = f.eye;
      if (!e || !e.group) continue;
      const open = smooth(range(f.p, 0.9 + e.delay, 1));
      e.group.visible = f.p > 0.86;
      if (!e.group.visible) continue;
      e.group.position.set(f.x, this.h - f.y, f.z + f.lift + f.r * 0.14 + e.R * 0.4);
      if (t > e.nextBlink) {
        e.blinkAt = t;
        e.nextBlink = t + (Math.random() < 0.15 ? 0.4 : 2.5 + Math.random() * 9);
      }
      let b = 1;
      if (e.blinkAt >= 0 && t >= e.blinkAt) {
        const bt = (t - e.blinkAt) / BLINK;
        if (bt >= 1) e.blinkAt = -1;
        else b = Math.abs(Math.cos(Math.PI * bt));
      }
      const ap = open * b;
      e.top.rotation.x = -1.05 * ap;
      e.bottom.rotation.x = 0.7 * ap;

      const gx = e.group.position.x;
      const gy = e.group.position.y;
      const gz = e.group.position.z;
      if (target) e.look.lerp(target, k);
      else e.look.lerp(this.dummy.position.set(gx, gy, gz + 500), k);
      e.ball.lookAt(e.look);
    }
  }

  /* ---------------- overlay ---------------- */

  drawOverlay() {
    const g = this.octx;
    const { dpr } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = this.ink;
    const ptr = this.pointer;

    // Crosshair across the field at the pointer.
    if (ptr.active && !this.classList.contains('is-nav-open')) {
      g.strokeStyle = rgba(ink, 0.25);
      g.lineWidth = 1;
      g.beginPath();
      const px = Math.round(ptr.x) + 0.5;
      const py = Math.round(ptr.y) + 0.5;
      g.moveTo(px, 0);
      g.lineTo(px, py - 10);
      g.moveTo(px, py + 10);
      g.lineTo(px, this.h);
      g.moveTo(0, py);
      g.lineTo(px - 10, py);
      g.moveTo(px + 10, py);
      g.lineTo(this.w, py);
      g.stroke();
      if (ptr.down) {
        g.setLineDash([3, 4]);
        g.strokeStyle = rgba(ink, 0.6);
        g.beginPath();
        g.arc(ptr.x, ptr.y, this.base * 2.4, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      }
    }

    // Bracket and readout on the inspected specimen.
    const f = this.inspected;
    if (f) {
      const h = f.sr * 1.08;
      const c = Math.min(10, h * 0.4);
      g.strokeStyle = rgba(ink, 0.95);
      g.lineWidth = 1;
      g.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = f.sx + sx * h;
        const cy = f.sy + sy * h;
        g.moveTo(cx - sx * c, cy);
        g.lineTo(cx, cy);
        g.lineTo(cx, cy - sy * c);
      }
      g.stroke();
      const label = [
        `✱${String(f.id).padStart(4, '0')}`,
        LATIN[f.species],
        hex(f.color),
        `Z${String(Math.round(f.z)).padStart(4, ' ')}`,
        `${String(Math.round(f.p * 100)).padStart(3, '0')}%`,
        f.eye ? (this.pointer.active ? 'WATCHING' : 'AWAKE') : f.star ? 'GLYPH' : 'BLIND',
      ].join('  ');
      g.font = '500 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      const tw = g.measureText(label).width;
      const lx = clamp(f.sx - h, 4, this.w - tw - 12);
      const ly = clamp(f.sy + h + 6, 4, this.h - 20);
      g.fillStyle = rgba(this.soil);
      g.fillRect(lx, ly, tw + 8, 15);
      g.fillStyle = rgba(ink);
      g.fillText(label, lx + 4, ly + 11);
    }

    for (const pg of this.pings) {
      const life = pg.t / 0.25;
      g.strokeStyle = rgba(ink, 1 - life);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(pg.x, pg.y, 4 + life * 18, 0, TAU);
      g.stroke();
    }
  }
}

if (!customElements.get('garden-splash')) customElements.define('garden-splash', GardenSplash);
