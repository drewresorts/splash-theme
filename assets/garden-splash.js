/**
 * Garden splash
 *
 * A garden seen from straight above, rendered in real 3D the way cheap
 * late-90s CGI looked: a low-resolution render scaled up without smoothing,
 * one harsh light, plastic specular highlights, flat-shaded low-poly
 * geometry, distance fog and vertices that snap to a coarse grid.
 *
 * Each specimen is a Duet asterisk on a stem. It grows seed → sprout →
 * leaves → bud → bloom until the heads overlap and fill the screen. Many
 * specimens open an eyeball that turns in its socket to follow the
 * pointer. The center specimen opens last and the logo (a DOM element)
 * appears on it.
 *
 * Interaction is utilitarian: crosshair and coordinate readout, hover or
 * tap to inspect, press and drag to speed up growth, tap to resequence a
 * specimen (nearby eyes blink).
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
  hero: 'GERBERA D✱',
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
const FLOOR_Z = -140; // where seeds land and stems start; no ground is drawn
const FOV = 50;
const BLINK = 0.2;

/* The render is under-resolved on purpose, then scaled up with nearest-neighbour. */
const renderScale = (w) => (w < 750 ? 0.6 : 0.5);

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
/* Animated GIF playback                                               */
/* ------------------------------------------------------------------ */

/*
 * Canvas drawImage() only ever shows the first frame of an animated GIF, so
 * the logo GIF is decoded here (LZW) and played frame by frame instead.
 */
function lzwDecode(minCode, data, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCode + 1;
  let mask = (1 << size) - 1;
  let next = eoi + 1;
  let old = -1;
  let first = 0;
  let bits = 0;
  let acc = 0;
  let dp = 0;
  let op = 0;
  while (op < count) {
    while (bits < size) {
      if (dp >= data.length) return out;
      acc |= data[dp++] << bits;
      bits += 8;
    }
    let code = acc & mask;
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCode + 1;
      mask = (1 << size) - 1;
      next = eoi + 1;
      old = -1;
      continue;
    }
    if (code === eoi) break;
    if (old === -1) {
      out[op++] = suffix[code];
      old = code;
      first = code;
      continue;
    }
    const incoming = code;
    let sp = 0;
    if (code >= next) {
      stack[sp++] = first;
      code = old;
    }
    while (code > eoi) {
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[sp++] = first;
    while (sp && op < count) out[op++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if (next > mask && size < 12) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    old = incoming;
  }
  return out;
}

function decodeGif(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) throw new Error('not a gif');
  let p = 6;
  const u16 = () => {
    const v = b[p] | (b[p + 1] << 8);
    p += 2;
    return v;
  };
  const W = u16();
  const H = u16();
  const flags = b[p++];
  p += 2;
  const table = (n) => {
    const t = b.subarray(p, p + 3 * n);
    p += 3 * n;
    return t;
  };
  const global = flags & 0x80 ? table(1 << ((flags & 7) + 1)) : null;
  const blocks = () => {
    const parts = [];
    let total = 0;
    let len;
    while ((len = b[p++])) {
      parts.push(b.subarray(p, p + len));
      total += len;
      p += len;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of parts) {
      out.set(part, o);
      o += part.length;
    }
    return out;
  };
  const frames = [];
  let control = { delay: 100, disposal: 0, transparent: -1 };
  while (p < b.length) {
    const block = b[p++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = b[p++];
      if (label === 0xf9) {
        p++;
        const packed = b[p++];
        const delay = u16();
        const index = b[p++];
        p++;
        control = { delay: Math.max(20, (delay || 10) * 10), disposal: (packed >> 2) & 7, transparent: packed & 1 ? index : -1 };
      } else {
        blocks();
      }
      continue;
    }
    if (block !== 0x2c) break;
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const f = b[p++];
    const local = f & 0x80 ? table(1 << ((f & 7) + 1)) : null;
    const minCode = b[p++];
    let pixels = lzwDecode(minCode, blocks(), w * h);
    if (f & 0x40) {
      const rows = new Uint8Array(w * h);
      let src = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
        for (let row = start; row < h; row += step) {
          rows.set(pixels.subarray(src, src + w), row * w);
          src += w;
        }
      }
      pixels = rows;
    }
    frames.push(Object.assign({ x, y, w, h, colors: local || global, pixels }, control));
    control = { delay: 100, disposal: 0, transparent: -1 };
  }
  return { W, H, frames };
}

/* Plays decoded GIF frames onto a canvas, honouring each frame's delay and disposal. */
class GifPlayer {
  constructor(gif) {
    this.gif = gif;
    this.canvas = document.createElement('canvas');
    this.canvas.width = gif.W;
    this.canvas.height = gif.H;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.index = -1;
    this.wait = 0;
    this.step();
  }

  step() {
    const { frames } = this.gif;
    const g = this.g;
    const prev = frames[this.index];
    if (prev) {
      if (prev.disposal === 2) g.clearRect(prev.x, prev.y, prev.w, prev.h);
      if (prev.disposal === 3 && this.saved) g.putImageData(this.saved, 0, 0);
    }
    this.index = (this.index + 1) % frames.length;
    if (this.index === 0) g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const f = frames[this.index];
    if (f.disposal === 3) this.saved = g.getImageData(0, 0, this.canvas.width, this.canvas.height);
    if (f.w && f.h) {
      const img = g.getImageData(f.x, f.y, f.w, f.h);
      const d = img.data;
      for (let i = 0; i < f.pixels.length; i++) {
        const c = f.pixels[i];
        if (c === f.transparent || !f.colors) continue;
        d[i * 4] = f.colors[c * 3];
        d[i * 4 + 1] = f.colors[c * 3 + 1];
        d[i * 4 + 2] = f.colors[c * 3 + 2];
        d[i * 4 + 3] = 255;
      }
      g.putImageData(img, f.x, f.y);
    }
    this.wait = f.delay / 1000;
  }

  /* Advances by dt seconds; returns true when the picture changed. */
  advance(dt) {
    if (this.gif.frames.length < 2) return false;
    this.wait -= dt;
    let changed = false;
    while (this.wait <= 0) {
      this.step();
      changed = true;
    }
    return changed;
  }
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
    this.resize(true);

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
    this.isLight = luminance(this.soil) > 0.6;
    this.ink = this.isLight ? OCEAN : POWDER;
    this.duration = clamp(parseFloat(d.duration) || 12, 2, 60);
    this.density = DENSITY[d.density] || DENSITY.lush;
    this.logoScale = clamp(parseFloat(d.logoScale) || 0.55, 0.2, 1);
  }

  /* ---------------- scene ---------------- */

  setupScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    // No background or ground: only the flowers are drawn, over whatever is behind the section.
    this.fogColor = this.isLight ? toColor(WHITE) : toColor(mix(this.soil, POWDER, 0.18));

    // One harsh key light from the top left, a flat ambient fill, and the center's own glow.
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-0.7, 0.9, 1.2);
    scene.add(key);
    scene.add(new THREE.AmbientLight(toColor(mix(POWDER, this.soil, 0.4)), 0.9));
    this.heroLight = new THREE.PointLight(toColor(this.heroColor), 0, 0, 0);
    scene.add(this.heroLight);

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

    this.setupLogo();
    this.eyeTextures = new Map();
    this.dummy = new THREE.Object3D();
    this.tmp = new THREE.Vector3();
  }

  /*
   * The logo is painted into a texture on the center flower's disc, so the
   * petals literally close over it and unfold to reveal it. The page's own
   * logo image is reloaded with CORS so WebGL may use it; animated GIFs keep
   * playing because the texture is repainted a few times a second.
   */
  setupLogo() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    this.logoCanvas = c;
    this.logoTexture = new THREE.CanvasTexture(c);
    this.logoTexture.colorSpace = THREE.SRGBColorSpace;
    // Unlit, so the logo keeps its true colors under the harsh key light.
    this.logoMaterial = this.snapMaterial(new THREE.MeshBasicMaterial({ map: this.logoTexture }));
    this.paintLogo();

    // The flower's own logo setting (or the bundled wordmark), else the page logo.
    const source = this.logo && this.logo.querySelector('img');
    const src = this.dataset.flowerLogo || (source && (source.currentSrc || source.src));
    if (!src) return;
    const url = new URL(src, window.location.href);
    const useImage = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.logoImage = img;
        if (this.paintLogo()) this.classList.add('has-3d-logo');
      };
      img.src = url.href;
    };
    if (!/\.gif$/i.test(url.pathname)) {
      useImage();
      return;
    }
    // Animated logos: a smaller rendition is plenty for a texture this size.
    if (url.searchParams.has('width')) url.searchParams.set('width', '360');
    fetch(url.href, { mode: 'cors' })
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.arrayBuffer();
      })
      .then((buf) => {
        this.logoGif = new GifPlayer(decodeGif(buf));
        this.logoImage = this.logoGif.canvas;
        if (this.paintLogo()) this.classList.add('has-3d-logo');
      })
      .catch(useImage);
  }

  paintLogo() {
    const g = this.logoCanvas.getContext('2d');
    const S = this.logoCanvas.width;
    g.clearRect(0, 0, S, S);
    // The disc is the center color, like the brand's circle-bound logo.
    g.fillStyle = rgba(this.heroColor);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, TAU);
    g.fill();
    const img = this.logoImage;
    const iw = img && (img.naturalWidth || img.width);
    const ih = img && (img.naturalHeight || img.height);
    if (img && iw) {
      // A wide wordmark's corners still land inside the circle at 94% of its width.
      const box = S * 0.94;
      const k = Math.min(box / iw, box / ih);
      const w = iw * k;
      const h = ih * k;
      try {
        g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        // Reading a pixel back throws if the image is unusable (no CORS); check once.
        if (this.logoChecked !== img) {
          g.getImageData(0, 0, 1, 1);
          this.logoChecked = img;
        }
      } catch (e) {
        // The image could not be used (no CORS): keep the page's own logo instead.
        this.logoImage = null;
        g.fillStyle = rgba(this.heroColor);
        g.fillRect(0, 0, S, S);
        this.logoTexture.needsUpdate = true;
        return false;
      }
    } else if (!img) {
      const text = this.querySelector('.garden-splash__logo-text');
      if (text) {
        g.fillStyle = rgba(OCEAN);
        g.font = `600 ${S * 0.16}px ui-monospace, Menlo, monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text.textContent.trim().toLowerCase(), S / 2, S / 2, S * 0.85);
      }
    }
    this.logoTexture.needsUpdate = true;
    return true;
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

    // A small height change (mobile browser chrome) keeps the same field, re-placed.
    if (relayout) this.generate();
    else this.buildMeshes();
    this.project();
  }

  generate() {
    const { w: W, h: H } = this;
    const rng = mulberry32(this.seed);
    const dens = this.density;
    const base = clamp(Math.sqrt(W * H) * 0.075 * dens.size, 30, 96);
    this.base = base;

    const cx = W / 2;
    const cy = H / 2;
    const heroR = clamp(Math.min(W, H) * 0.21, base * 1.8, base * 2.7);
    this.heroR = heroR;

    // The field extends past the edges because the lower layers shrink with distance.
    const margin = base * 1.6;
    const pts = poissonDisc(-margin, -margin, W + margin, H + margin, base * dens.spacing, rng, [cx + base * 3, cy]);
    const maxDist = Math.hypot(W / 2 + margin, H / 2 + margin);
    const D = this.duration;
    const flowers = [];
    let id = 1;

    for (const [x, y] of pts) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < heroR * 1.05) continue;
      // Some specimens sit deeper in the bed, down in the fog.
      const far = rng() < 0.38;
      const r = base * lerp(0.88, 1.16, rng()) * (far ? 0.9 : 1);
      const dn = clamp(dist / maxDist, 0, 1);
      const startAt = D * (0.02 + 0.5 * (0.45 * (1 - dn) + 0.55 * rng()));
      const z = far ? lerp(-105, -70, rng()) : lerp(-25, 30, rng());
      flowers.push(this.makeFlower(x, y, z, r, rng, { id: id++, far, startAt, dur: D * lerp(0.36, 0.5, rng()) }));
    }

    for (let tries = 0; tries < 3000; tries++) {
      const x = -margin * 0.5 + rng() * (W + margin);
      const y = -margin * 0.5 + rng() * (H + margin);
      const rf = base * lerp(0.36, 0.52, rng());
      if (Math.hypot(x - cx, y - cy) < heroR * 1.2) continue;
      let ok = true;
      for (let i = 0; i < flowers.length; i++) {
        const f = flowers[i];
        const lim = f.r * (f.small ? 1.1 : 0.62) + rf * 0.45;
        if ((f.x - x) ** 2 + (f.y - y) ** 2 < lim * lim) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      flowers.push(this.makeFlower(x, y, lerp(-50, -30, rng()), rf, rng, { id: id++, small: true, startAt: D * lerp(0.4, 0.75, rng()), dur: D * lerp(0.25, 0.35, rng()) }));
    }

    this.center = this.makeFlower(cx, cy, 60, heroR, rng, { id: 0, hero: true, startAt: D * 0.24, dur: D * 0.68 });
    flowers.push(this.center);

    this.flowers = flowers;
    this.bloomed = false;
    this.inspected = null;
    this.classList.remove('is-bloomed');
    const t = this.elapsed;
    flowers.forEach((f) => (f.p = clamp((t - f.startAt) / f.dur, 0, 1)));
    this.assignEyes(rng);
    this.buildMeshes();

    // The logo sits on the center's disc; size it to the disc as projected.
    const scale = this.camDist / (this.camDist - (this.center.z + this.center.r * 0.2));
    this.style.setProperty('--garden-logo-size', `${Math.round(heroR * 2 * this.logoScale * scale)}px`);
  }

  makeFlower(x, y, z, r, rng, opts) {
    const f = {
      id: opts.id,
      x,
      y,
      z,
      r,
      far: !!opts.far,
      small: !!opts.small,
      isHero: !!opts.hero,
      startAt: opts.startAt,
      dur: Math.max(0.5, opts.dur),
      p: 0,
      shown: -1,
      boost: 1,
      rot: rng() * TAU,
      seedAngle: rng() * TAU,
      rng: mulberry32((rng() * 2 ** 31) | 0),
    };
    const leafCount = f.isHero ? 6 : f.small ? 2 : 2 + Math.floor(rng() * 3);
    f.leaves = [];
    for (let i = 0; i < leafCount; i++) {
      f.leaves.push({
        a: f.rot + (i / leafCount) * TAU + (rng() - 0.5) * 0.9,
        len: r * lerp(1.05, 1.4, rng()),
        w: r * lerp(0.36, 0.5, rng()),
        delay: (i / Math.max(1, leafCount)) * 0.35,
      });
    }
    this.sequence(f, rng);
    return f;
  }

  /*
   * Builds a specimen from parts. Each part is placed in the flower's frame:
   * yaw a around the center, an optional offset out along offA, and a pitch
   * that goes from closed (petal standing up, a bud) to open as it blooms.
   *   kind: geometry; sx/sy/sz: full size; grow: which stage drives it.
   */
  sequence(f, rng) {
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

    if (f.isHero) {
      f.species = 'hero';
      f.color = this.heroColor;
      f.color2 = this.heroAccent;
      // The petals grow from the rim of the logo disc and start curled shut
      // over it; the outer rings open first and the inner ring uncovers the logo.
      const dr = r * this.logoScale * 1.04;
      f.disc = dr;
      sepals(8, r * 0.7);
      ring(26, 'ray', f.color, r * 1.02 - dr * 0.4, r * 1.0, 2.35, 0.06, 0, 0, 0);
      ring(24, 'ray', tone(f.color, 0.12), r * 0.86 - dr * 0.4, r * 0.9, 2.45, 0.16, 0.12, 2, Math.PI / 24);
      ring(20, 'ray', this.heroAccent, Math.max(dr * 2.2, r * 0.68 - dr * 0.4), r * 0.7, 2.55, 0.3, 0.3, 4, 0);
      parts.forEach((part) => {
        if (part.grow !== 'petal') return;
        part.off = dr * 0.92;
        part.offA = part.a;
      });
      for (let i = 0; i < 30; i++) {
        center('ball', tone(this.heroColor, 0.3), r * 0.035, r * 0.035, r * 0.035, r * 0.16, { off: dr * 1.02, offA: (i / 30) * TAU });
      }
      f.parts = parts;
      return;
    }

    // A specimen with an eye keeps its species when it is rebuilt.
    if (!(f.eye && f.species)) {
      let v = rng();
      f.species = 'rose';
      for (const [name, weight] of SPECIES) {
        if ((v -= weight) <= 0) {
          f.species = name;
          break;
        }
      }
    }
    if (f.small) f.species = 'cluster';
    f.color = pick(rng, this.palette);
    const alt = this.palette.filter((p) => colorKey(p) !== colorKey(f.color));
    f.color2 = alt.length ? pick(rng, alt) : this.ink;
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
    const near = this.flowers.filter((f) => !f.far && !f.isHero);
    const irises = [this.foliage, this.heroAccent, this.heroColor].concat(this.palette).filter((c) => colorKey(c) !== colorKey(this.soil));
    for (const f of near) {
      f.eye = null;
      if (f.small || !EYED.has(f.species) || rng() > 0.55) continue;
      let hidden = Math.hypot(f.x - this.center.x, f.y - this.center.y) < this.heroR * 1.35;
      for (const o of near) {
        if (hidden) break;
        if (o !== f && o.z > f.z && (o.x - f.x) ** 2 + (o.y - f.y) ** 2 < (o.r * 0.9) ** 2) hidden = true;
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
      this.sequence(f, f.rng);
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

    const hero = this.center;
    this.heroDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.logoMaterial);
    this.heroDisc.position.set(hero.x, this.h - hero.y, hero.z + 3);
    this.heroDisc.scale.setScalar(1e-4);
    group.add(this.heroDisc);
    this.heroLight.position.set(hero.x, this.h - hero.y, hero.z + 160);
    this.heroLight.distance = hero.r * 9;

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
    const stemH = (f.z - FLOOR_Z) * smooth(Math.max(sprout * 0.25, leaves));
    const stemR = sprout > 0 ? Math.max(1.5, r * 0.05) : 0;
    put(S.stem, X, Y, FLOOR_Z, 0, 0, stemR, stemR, Math.max(zero, stemH));

    f.leaves.forEach((leaf, i) => {
      const lp = smooth(range(leaves, leaf.delay, leaf.delay + 0.65));
      const lz = FLOOR_Z + (f.z - 14 - FLOOR_Z) * lp;
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
        f.z + (part.z || 0),
        f.rot + part.a,
        pitch,
        part.sx * s,
        part.sy * s,
        part.sz * s
      );
    });

    if (f.isHero) {
      // The logo disc only appears once the bud is fully formed, under the still-closed petals.
      this.heroDisc.scale.setScalar(Math.max(zero, f.disc * smooth(range(openP, 0, 0.18))));
      this.heroLight.intensity = 2 * openP;
    }
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
      if (f.isHero && this.bloomed) continue;
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
    } else if (!f.isHero) {
      // Resequence: new notation and color, rebuilt from the bud.
      const was = colorKey(f.color);
      for (let i = 0; i < 6 && colorKey(f.color) === was; i++) this.sequence(f, f.rng);
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
    if (this.running || !this.isConnected || !this.renderer) return;
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

    if (!this.bloomed && this.center && this.center.p >= 0.96) {
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
    if (this.logoGif && this.center && this.center.p > STAGE.bud[0] && this.logoGif.advance(dt)) this.paintLogo();
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
    if (!nav && this.bloomed && this.elapsed % 17 > 12) return out.set(this.center.x, this.h - this.center.y, this.center.z + 60);
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
        f.eye ? (this.pointer.active ? 'WATCHING' : 'AWAKE') : f.isHero ? 'PRIMARY' : 'BLIND',
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
