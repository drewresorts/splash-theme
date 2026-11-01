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
 * Interaction is utilitarian: an ordinary pointer and a coordinate readout, hover or
 * tap to inspect, press and drag to speed up growth, tap to recolor a
 * flower (nearby eyes blink). The menu opens from the menu button, not the logo.
 * The splash can be zoomed into, with no controls shown: scroll or pinch on
 * a trackpad, pinch on a touchscreen, or press and hold then slide up/down.
 * Zoomed in, dragging moves around and the render sharpens. Now and then a
 * bee flies through, sometimes landing on a flower for a moment. Tracing the
 * letter d over the logo's d lies the visitor down on their back in the
 * flowers, looking up at a night sky whose white stars gather into the logo.
 * The splash's weather follows the real season (see the seasons section).
 *
 * Modes (data-mode):
 *   (none)      the splash: grows, forms the logo, then stays as the
 *               page's living backdrop with a slow drift of camera and light.
 *   world       the same arrangement, already formed, fixed behind every
 *               other page of the store (snippets/garden-world.liquid).
 *   background  the bloomed bed, scattered and waving (garden-background).
 *
 * The opening plays once per visit: the seed and "already entered" are kept
 * in sessionStorage, so later pages show the same composition without replaying it.
 */
import * as THREE from './three.module.min.js';
import { SCHEMES } from './duet-schemes.js';

const TAU = Math.PI * 2;

/*
 * The letter d as people write it, in a unit square (y down): the stem on
 * the right from top to bottom, the bowl to its left in the lower part.
 * Bowl then stem (up, or up and back down), stem then bowl, and the bowl
 * drawn either way round.
 */
const D_STROKES = (() => {
  const bowl = (dir) => Array.from({ length: 25 }, (_, i) => {
    const a = -0.25 + dir * (i / 24) * Math.PI * 2;
    return [0.52 + 0.4 * Math.cos(a), 0.7 + 0.28 * Math.sin(a)];
  });
  const line = (x0, y0, x1, y1, n = 10) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);
  const ways = [];
  for (const dir of [-1, 1]) {
    const o = bowl(dir);
    ways.push(o.concat(line(0.92, 0.7, 0.92, 0)));
    ways.push(o.concat(line(0.92, 0.7, 0.92, 0), line(0.92, 0, 0.92, 1)));
    ways.push(line(0.92, 0, 0.92, 1).concat(line(0.92, 1, 0.92, 0.62, 4), o));
  }
  return ways.map(normalizeStroke);
})();

/* A stroke as 32 evenly spaced points, stretched to fill the unit square. */
function normalizeStroke(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const n = 32;
  const step = len / (n - 1) || 1;
  const out = [pts[0].slice()];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let cur = pts[i];
    let d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + d >= step && out.length < n) {
      const k = (step - acc) / d;
      const q = [prev[0] + (cur[0] - prev[0]) * k, prev[1] + (cur[1] - prev[1]) * k];
      out.push(q);
      prev = q;
      d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push(pts[pts.length - 1].slice());
  const xs = out.map((p) => p[0]);
  const ys = out.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = Math.max(...xs) - x0 || 1;
  const sy = Math.max(...ys) - y0 || 1;
  return out.map(([x, y]) => [(x - x0) / sx, (y - y0) / sy]);
}

/* How far apart two normalized strokes are: the mean distance between matching points. */
function strokeDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  return sum / a.length;
}

/*
 * The moon's age in days since the last new moon, and how much of its disc
 * is lit (0 new, 1 full), from a known new moon (6 January 2000, 18:14 UTC)
 * and the mean length of a lunar month. Close enough to the real phase to
 * the hour.
 */
const SYNODIC = 29.530588853;
function lunarPhase(date) {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  return { age, lit: (1 - Math.cos((age / SYNODIC) * Math.PI * 2)) / 2 };
}

/*
 * Where the sun and the moon are in the sky (altitude above the horizon and
 * azimuth from north through east, in degrees) at a moment, for a place.
 * The usual low-precision formulas: within a degree or so, plenty for a sky
 * drawn in big pixels.
 */
const RAD = Math.PI / 180;
function daysSince2000(date) {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}
/* The color of the air in the sky view: what the renderer clears to, and the sky fades into at its edges. */
function skyAir(time) {
  return mix(mix([3, 4, 18], [96, 156, 220], time.light), time.evening ? [214, 120, 140] : [236, 160, 140], time.warm * 0.7);
}

function horizontal(ra, dec, d, lat, lon) {
  // Local sidereal time, then the hour angle.
  const lst = (280.46061837 + 360.98564736629 * d + lon) % 360;
  const H = (lst - ra) * RAD;
  const phi = lat * RAD;
  const dl = dec * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dl) + Math.cos(phi) * Math.cos(dl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dl) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { alt: alt / RAD, az: ((az / RAD) + 360) % 360 };
}
function equatorial(lambda, beta, d) {
  const e = (23.439 - 0.0000004 * d) * RAD;
  const l = lambda * RAD;
  const b = beta * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) / RAD;
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) / RAD;
  return { ra, dec };
}
function sunPosition(date, lat, lon) {
  const d = daysSince2000(date);
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const { ra, dec } = equatorial(L, 0, d);
  return horizontal(ra, dec, d, lat, lon);
}
function moonPosition(date, lat, lon) {
  const d = daysSince2000(date);
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.22935 * d) * RAD;
  const { ra, dec } = equatorial(L + 6.289 * Math.sin(M), 5.128 * Math.sin(F), d);
  return horizontal(ra, dec, d, lat, lon);
}

/* What the world behind other pages copies from the splash (dataset keys). */
const LOOK_KEY = 'duet-garden-look';
const LOOK = ['palette', 'foliageColor', 'centerColor', 'centerAccent', 'soilColor', 'density', 'flowerLogo', 'flowerLogoMobile', 'weather', 'season', 'hemisphere'];

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

/*
 * OKLCH, a perceptual color space: turning a color's hue here keeps how
 * light and how saturated it looks, so a rotated palette keeps the
 * original's relationships. Colors are [r, g, b] in 0-255.
 */
const toLinear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklch(c) {
  const [r, g, b] = c.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToLinear(L, C, h) {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/* Turns a color's hue by deg, giving up chroma only where the new hue can't hold it on screen. */
function rotateHue(c, deg) {
  const [L, C, h0] = toOklch(c);
  const h = h0 + (deg * Math.PI) / 180;
  const fits = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let rgb = oklchToLinear(L, C, h);
  if (!fits(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear(L, lo, h);
  }
  return rgb.map((v) => Math.round(clamp(fromLinear(clamp(v, 0, 1)), 0, 255)));
}
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
  // Packed: the most flowers, slightly larger than their spacing, overlapping so the logo reads solid.
  packed: { size: 0.78, spacing: 0.95 },
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
const EYE = 62; // eye height above the ground, walking: the flower heads come up to about the chest (see startExplore)
const LOOK_LIMIT = 1.55; // up and down, all but straight overhead and underfoot

/*
 * How the visitor moves while exploring (see startExplore): each mode moves
 * the explorer E one frame from E.input ({ f, r, turn, up, jump, run }: f
 * forward/back and r right/left from -1 to 1, up for flying, jump and run
 * held). Walking is the default; add a mode here and switch to it with
 * setExploreMode().
 */
const EXPLORE_MODES = {
  walk(G, E, dt, span) {
    const inp = E.input;
    // A smaller garden (a phone's) is crossed at a slower pace.
    const speed = (inp.run ? 300 : 125) * clamp(span / 1280, 0.6, 1.2);
    const fx = -Math.sin(E.yaw);
    const fy = Math.cos(E.yaw);
    const rx = fy;
    const ry = -fx;
    let wx = fx * inp.f + rx * inp.r;
    let wy = fy * inp.f + ry * inp.r;
    const m = Math.hypot(wx, wy);
    if (m > 1) {
      wx /= m;
      wy /= m;
    }
    // Quick to start and stop on the ground, little control in the air.
    const k = 1 - Math.exp(-dt * (E.grounded ? 10 : 1.5));
    E.vx += (wx * speed - E.vx) * k;
    E.vy += (wy * speed - E.vy) * k;
    E.x += E.vx * dt;
    E.y += E.vy * dt;
    const ground = FLOOR_Z + G.hillAt(E.x, E.y) + E.eye;
    if (E.grounded && inp.jump) {
      E.vz = 330;
      E.grounded = false;
    }
    if (E.grounded && E.z - ground < 18) {
      // Following the ground up and down the hills.
      E.z = ground;
      E.vz = 0;
    } else {
      E.vz -= 950 * dt;
      E.z += E.vz * dt;
      E.grounded = false;
      if (E.z <= ground) {
        E.z = ground;
        E.vz = 0;
        E.grounded = true;
      }
    }
    // A gentle bob with each stride.
    const pace = Math.hypot(E.vx, E.vy);
    E.stride += pace * dt * 0.055;
    const bob = E.grounded && !G.reduced ? Math.sin(E.stride * 2) * Math.min(1, pace / 125) * 1.8 : 0;
    E.bob += (bob - E.bob) * (1 - Math.exp(-dt * 12));
  },

  fly(G, E, dt, span) {
    const inp = E.input;
    // Fly where you look; strafe level; rise and sink straight up and down.
    const speed = span * (inp.run ? 1.5 : 0.45);
    const cp = Math.cos(E.pitch);
    const fx = -Math.sin(E.yaw) * cp;
    const fy = Math.cos(E.yaw) * cp;
    const fz = Math.sin(E.pitch);
    const rx = Math.cos(E.yaw);
    const ry = Math.sin(E.yaw);
    const k = 1 - Math.exp(-dt * 2.4);
    E.vx += ((fx * inp.f + rx * inp.r) * speed - E.vx) * k;
    E.vy += ((fy * inp.f + ry * inp.r) * speed - E.vy) * k;
    E.vz += ((fz * inp.f + inp.up) * speed - E.vz) * k;
    E.x += E.vx * dt;
    E.y += E.vy * dt;
    E.z += E.vz * dt;
    E.bob = 0;
    // Held in by the land below and the clouds above.
    const floor = FLOOR_Z + G.hillAt(E.x, E.y) + 6;
    const top = G.sky ? G.sky.eye.z + G.sky.D * 1.25 : span * 4;
    if (E.z < floor) {
      E.z = floor;
      E.vz = Math.max(0, E.vz);
    } else if (E.z > top) {
      E.z = lerp(E.z, top, 1 - Math.exp(-dt * 3));
      E.vz = Math.min(0, E.vz);
    }
  },
};
const FOV = 50;
const BLINK = 0.2;
const ARRANGE = 2.4; // seconds for the bed to glide into the logo

/* Flower spacing as a fraction of the logo's letter-stroke width. */
const LOGO_SPACING = { airy: 0.5, lush: 0.36, overgrown: 0.27, packed: 0.21 };
/* How big each flower is against its spacing in the logo; packed ones overlap. */
const LOGO_FILL = { airy: 1, lush: 1, overgrown: 1, packed: 1.4 };
/* The most flowers a logo is filled with before the spacing opens up. */
const LOGO_MAX = { airy: 900, lush: 900, overgrown: 900, packed: 1300 };

/* The render is under-resolved on purpose, then scaled up with nearest-neighbour. */
// Narrow screens get more pixels, or the small flowers that spell the logo turn to mush.
const renderScale = (w) => (w < 750 ? 0.85 : 0.5);
// The splash itself is drawn sharp (up to 1.25x on desktop, 1.5x on phones),
// as long as the device keeps up (see adapt()).
const splashScale = (w, dpr) => Math.max(renderScale(w), Math.min(dpr, w < 750 ? 1.5 : 1.25));
// PS1 style: a low internal resolution, scaled up with hard pixels.
const ps1Scale = (w) => (w < 750 ? 0.9 : 0.6);

/*
 * The seasons, by the visitor's real date. Meteorological seasons:
 * December-February is winter in the north (summer in the south), and so
 * on. Returns the season and how far through it today is (0 to 1).
 */
const SCHEME_KEY = 'garden-splash-scheme';

const SEASON_NAMES = ['winter', 'spring', 'summer', 'autumn'];
function seasonOf(date, south) {
  const m = date.getMonth();
  const k = (m + 1) % 12;
  let i = Math.floor(k / 3);
  if (south) i = (i + 2) % 4;
  const start = new Date(date.getFullYear(), m - (k % 3), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
  return { name: SEASON_NAMES[i], p: (date - start) / (end - start) };
}

/* Each season's light, and how often the wind gusts and the bees visit (seconds; no bees in winter). */
const SEASON_LOOK = {
  winter: { key: 2.3, keyColor: [212, 226, 255], amb: 1.0, ambTint: [205, 220, 255], gusts: [10, 18], bees: null },
  spring: { key: 2.5, keyColor: [255, 255, 250], amb: 0.9, ambTint: null, gusts: [7, 14], bees: [12, 26] },
  summer: { key: 2.8, keyColor: [255, 241, 216], amb: 0.95, ambTint: [255, 240, 220], gusts: [9, 16], bees: [6, 14] },
  autumn: { key: 2.4, keyColor: [255, 226, 192], amb: 0.9, ambTint: [240, 214, 190], gusts: [3, 7], bees: [22, 40] },
};

/* 15-bit color with a 4x4 Bayer dither, as on the PlayStation. */
/* The same 4x4 ordered-dither matrix, for textures made in JavaScript. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const DITHER_GLSL = `
uniform float uDither;
const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
vec3 psxColor(vec3 c) {
  if (uDither < 0.5) return c;
  ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
  float b = BAYER[p.y * 4 + p.x] / 16.0;
  return floor(clamp(c, 0.0, 1.0) * 31.0 + b) / 31.0;
}
`;

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

/*
 * A white texture whose transparency is computed here, pixel by pixel.
 * Painting it on a canvas instead lets the browser dither the gradients a
 * little differently in each color channel, and where the image is nearly
 * transparent the GPU magnifies that into bright red, green and blue
 * specks. alpha(u, v) is 0..1 over the square; dither > 0 cuts it into that
 * many steps with a 4x4 ordered dither, the PS1 way.
 */
function alphaTexture(n, alpha, dither, shade) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      const b = BAYER4[(y & 3) * 4 + (x & 3)] / 16;
      let a = clamp(alpha(u, v), 0, 1);
      if (dither) a = Math.floor(a * dither + b) / dither;
      const i = (y * n + x) * 4;
      // Shading, if any, is stepped with the same dither, a little more finely.
      const c = shade ? shade(u, v) : null;
      const steps = Math.max(6, Math.round(dither * 1.5));
      for (let k = 0; k < 3; k++) {
        const ch = c ? clamp(c[k], 0, 1) : 1;
        data[i + k] = Math.round((dither ? Math.floor(ch * steps + b) / steps : ch) * 255);
      }
      data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  const filter = dither ? THREE.NearestFilter : THREE.LinearFilter;
  tex.magFilter = filter;
  tex.minFilter = filter;
  tex.needsUpdate = true;
  return tex;
}

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

/*
 * The Duet wordmark's silhouette, 400 x 143: run lengths in base 36,
 * alternating empty and filled, row by row. Built in so the default logo
 * needs no download before the flowers can form it.
 */
const WORDMARK = { w: 400, h: 143, runs: '27.1.am.j.a6.y.a6.y.a6.y.a6.x.a7.x.ad.r.af.p.ag.o.ah.n.ah.n.ah.n.ai.m.ai.m.ai.m.51.8.59.m.50.9.59.m.4z.a.59.m.4z.a.59.m.4z.a.59.m.4z.a.59.m.4z.a.59.m.4z.a.59.m.4y.b.59.m.4y.b.59.m.4y.b.59.m.4y.b.59.m.4y.b.59.m.4x.c.59.m.4x.c.22.1.36.m.4x.c.1z.5.35.m.4w.d.1w.8.35.m.4w.d.1t.b.35.m.4w.d.1q.f.34.m.4v.e.1n.i.34.m.4v.e.1k.l.34.m.4u.f.1j.m.34.m.4t.g.1k.m.33.m.4s.h.1k.m.33.m.3c.d.12.i.1l.l.33.m.2a.1.w.n.w.j.1l.l.2e.a.f.m.k.8.14.f.s.u.s.k.1l.m.28.j.b.m.8.k.s.r.q.y.o.m.1m.l.12.2.11.p.8.1e.m.x.n.i.4.h.j.p.1m.l.11.3.z.t.6.1e.m.x.l.g.b.g.d.1h.z.l.z.5.w.x.4.1e.m.x.k.f.f.g.6.1m.z.l.y.7.u.z.3.1e.m.x.i.g.h.g.5.1m.z.l.w.a.r.i.9.b.2.1e.m.x.h.g.j.h.3.1m.10.k.v.c.p.h.d.a.1.1e.s.r.g.g.l.h.2.1m.10.l.t.d.o.h.f.w.2.q.u.p.f.g.n.24.11.k.s.f.l.i.h.v.3.p.v.o.d.h.o.1s.1d.k.r.h.j.i.j.u.4.o.w.n.c.i.p.i.a.n.1q.k.p.j.i.h.l.t.4.o.w.n.c.h.q.i.a.n.1q.k.o.l.g.h.n.s.5.n.w.n.b.i.r.i.9.n.1q.k.m.n.f.i.n.s.5.n.x.m.a.i.s.j.8.n.1r.j.l.p.d.i.p.r.5.m.y.m.9.j.t.j.7.n.1r.k.j.r.c.i.q.q.5.m.y.m.8.j.u.j.7.n.1s.j.i.t.a.i.r.q.5.m.y.m.8.j.u.k.6.n.1s.j.h.v.8.j.r.q.5.m.y.m.7.j.v.k.6.n.1s.j.g.w.8.j.s.p.5.m.y.m.6.k.w.k.5.n.1t.j.d.w.9.j.t.p.5.m.y.m.6.k.w.k.5.n.1t.j.c.v.b.j.u.o.5.m.y.m.5.l.w.l.4.n.1u.i.b.v.b.k.u.o.5.m.y.m.5.k.x.l.4.n.1u.j.9.u.d.k.u.o.5.m.y.m.4.l.y.k.4.n.1v.i.8.u.d.k.v.o.5.m.y.m.4.l.y.l.3.n.1v.i.7.u.e.k.w.n.5.m.y.m.3.l.z.l.3.n.1v.i.5.u.g.k.w.n.5.m.y.m.3.l.z.l.3.n.1w.i.3.t.h.l.w.n.5.m.y.m.3.l.z.m.2.n.1w.i.2.t.i.k.x.n.5.m.y.m.2.m.z.m.2.n.1x.h.1.t.j.k.x.n.5.m.y.m.2.m.10.l.2.n.1x.19.k.l.y.m.5.m.y.m.2.m.10.l.2.n.1x.18.l.l.y.m.5.m.y.m.1.m.11.l.2.n.t.2.13.15.n.l.y.m.5.m.y.m.1.m.11.m.1.n.s.m.k.14.n.m.y.m.5.m.y.m.1.m.11.m.1.n.s.12.4.12.p.m.y.m.5.m.y.19.11.m.1.n.s.27.q.m.y.m.5.m.y.19.11.m.1.n.s.25.s.l.z.m.5.m.y.19.11.m.1.n.s.24.t.l.10.l.5.m.y.19.11.m.1.n.s.22.u.m.10.l.5.m.y.19.11.m.1.n.s.21.v.m.10.l.5.m.y.19.11.m.1.n.s.1z.x.m.10.l.5.m.y.19.11.1a.s.1y.y.m.10.l.5.m.y.3k.s.1w.10.m.10.l.5.m.y.3k.s.1x.z.m.10.l.5.m.y.3k.s.1y.y.m.10.l.5.m.y.3k.s.20.w.m.10.l.5.m.y.3k.s.21.v.m.10.l.5.m.y.1j.1e.n.s.23.s.n.10.l.5.m.y.18.1p.n.s.24.r.n.10.l.5.m.y.18.1p.n.s.26.p.n.10.l.5.m.y.18.1p.n.s.27.o.n.10.l.5.m.y.18.1p.n.s.w.b.12.m.n.10.l.6.l.y.18.1p.n.s.h.p.14.l.n.10.l.6.l.y.18.1p.n.1y.16.j.n.10.l.6.l.y.19.1o.n.1x.18.i.n.10.l.6.l.y.19.1o.n.1x.1a.g.n.10.l.6.l.y.19.1o.n.1x.h.1.t.f.n.10.l.6.l.y.19.1o.n.1w.i.3.t.d.n.10.l.6.l.y.19.1o.n.1w.i.4.t.c.n.10.l.6.l.y.19.1o.n.1v.i.6.u.a.n.10.l.6.l.y.19.1o.n.1v.i.7.u.a.m.10.l.6.l.y.19.1o.n.1u.j.8.v.8.m.10.l.6.l.y.19.1o.n.1u.j.9.v.7.m.10.l.6.l.y.19.1o.n.1u.i.c.v.5.m.10.l.6.l.y.1a.1n.n.1t.j.d.v.4.n.z.l.6.l.y.1a.1n.n.1t.j.e.w.2.n.z.l.6.l.y.1a.1n.n.1s.j.g.w.1.n.y.n.5.l.y.1a.1n.n.1s.j.h.v.1.n.y.n.5.l.x.1b.1o.m.1s.j.i.t.3.m.y.n.5.l.x.n.1.o.1n.m.1r.k.j.r.4.m.y.n.5.l.x.n.1.o.1n.m.1r.j.m.o.5.m.y.n.5.l.x.n.2.n.1n.m.1q.k.n.m.6.m.y.n.5.l.w.o.2.n.1m.n.1q.k.o.k.7.m.y.n.5.l.w.o.2.o.1l.n.1q.j.q.j.7.n.w.o.5.m.v.o.3.n.1h.2.2.n.1p.k.r.h.9.m.w.o.5.m.v.o.3.n.1g.s.1p.k.s.f.a.m.w.o.5.m.u.p.3.o.1f.s.1o.l.u.c.b.m.w.o.5.m.u.p.4.n.1e.t.1o.k.w.a.d.l.w.o.5.m.t.q.4.o.1c.u.1n.l.x.9.d.m.u.p.5.m.t.q.5.n.1c.u.1n.l.y.7.e.m.u.p.5.m.t.q.5.o.1a.7.1.n.1n.l.z.5.g.l.u.p.5.m.s.r.6.n.19.7.2.n.1m.l.11.3.h.l.t.q.6.m.q.s.7.n.18.7.2.o.1l.l.1m.l.s.q.6.m.q.5.2.m.6.n.17.7.4.n.1k.m.1m.l.s.q.6.m.p.6.2.m.7.n.15.8.4.n.1k.l.1o.k.r.r.6.n.n.6.3.m.8.n.13.8.5.n.1j.m.1o.l.q.r.6.n.n.6.3.m.8.o.11.8.6.n.1j.m.1p.k.p.s.7.n.l.6.4.m.9.o.z.8.7.n.1j.m.1p.l.o.s.7.o.i.8.4.m.a.o.x.8.8.o.1i.l.1r.k.n.t.7.o.h.8.5.m.b.o.u.a.8.o.1j.k.1s.j.m.9.1.k.8.p.e.8.6.n.b.o.s.a.a.o.1l.h.1s.k.l.9.1.l.7.q.a.a.7.n.c.o.p.a.c.o.m.3.10.d.1t.k.j.9.2.l.8.t.3.d.7.o.c.p.l.b.d.p.j.5.12.a.1v.k.h.9.3.m.7.18.8.p.c.q.h.c.f.p.g.8.15.6.1w.k.f.9.4.n.7.16.9.r.c.s.9.f.g.r.c.a.18.3.1x.k.c.a.5.q.5.14.a.u.a.1e.i.t.6.c.3a.l.8.b.7.t.2.11.c.u.c.1a.l.19.3d.11.8.t.3.z.d.u.e.16.n.17.3g.z.9.t.5.w.e.u.g.12.q.15.3j.v.b.t.6.t.g.s.k.y.u.11.3n.r.d.l.h.n.k.b.13.s.y.y.3r.n.f.7.x.j.24.k.14.t.3y.g.1s.6.42.n.al.e.3e' };

function wordmarkAlpha() {
  const alpha = new Uint8Array(WORDMARK.w * WORDMARK.h);
  let i = 0;
  let on = false;
  for (const run of WORDMARK.runs.split('.')) {
    const n = parseInt(run, 36);
    if (on) alpha.fill(255, i, i + n);
    i += n;
    on = !on;
  }
  return alpha;
}

/*
 * The visit's garden: one seed for every page, so the arrangement is the
 * same everywhere, and whether the opening has already been seen.
 */
const VISIT_KEY = 'duet-garden-visit';

function readVisit() {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(VISIT_KEY));
    return v && typeof v.seed === 'number' ? v : null;
  } catch (e) {
    return null;
  }
}

function writeVisit(v) {
  try {
    window.sessionStorage.setItem(VISIT_KEY, JSON.stringify(v));
  } catch (e) {
    /* private mode: every page simply starts fresh */
  }
}

/* A reload is a deliberate return to the start, so the opening plays again. */
function isReload() {
  const nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  return !!nav && nav.type === 'reload';
}

/* ------------------------------------------------------------------ */
/* The element                                                         */
/* ------------------------------------------------------------------ */

class GardenSplash extends HTMLElement {
  connectedCallback() {
    this.shareLook();
    this.canvas = this.querySelector('[data-garden-canvas]');
    this.overlay = this.querySelector('[data-garden-overlay]');
    if (!this.canvas || !this.overlay) return;
    // One garden per page: the world behind it steps aside for a page's own.
    if (this.dataset.mode === 'world' && document.querySelector('garden-splash:not([data-mode="world"])')) {
      document.body.classList.remove('has-garden-world');
      this.remove();
      return;
    }
    try {
      this.init();
    } catch (e) {
      this.fail(e);
    }
  }

  /*
   * The flowers behind other pages match the splash: the splash keeps its
   * look (colors, logo shapes, density, weather) for the browser, and the
   * world behind other pages takes it on before it starts. Until the
   * splash has been seen, the world uses its own settings (Theme settings
   * → Garden motif).
   */
  shareLook() {
    const d = this.dataset;
    try {
      if (!d.mode) {
        const look = {};
        for (const k of LOOK) if (d[k] !== undefined) look[k] = d[k];
        localStorage.setItem(LOOK_KEY, JSON.stringify(look));
      } else if (d.mode === 'world' || d.mode === 'blossoms') {
        const look = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null');
        if (look) for (const k of LOOK) if (typeof look[k] === 'string') d[k] = look[k];
      }
    } catch (e) {
      // No storage (private browsing): each keeps its own settings.
    }
  }

  /*
   * The splash kept running behind another page after a seamless page
   * change (assets/duet-soft-nav.js): it takes no part in the page, any
   * night sky or zoom is put away, and it stays as the page's backdrop.
   */
  setBehind(on) {
    this.behind = !!on;
    if (this.behind) {
      if (this.night) this.endNight();
      if (this.view) this.resetView(true);
      this.inspected = null;
      if (this.pointer) Object.assign(this.pointer, { active: false, down: false });
      if (this.toggleNav && this.classList.contains('is-nav-open')) this.toggleNav(false);
    }
    this.start();
  }

  /*
   * Anything going wrong with the 3D garden leaves the plain logo and the
   * menu (wired up by the section's own script) over the page background.
   */
  fail(e) {
    if (this.failed) return;
    this.failed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.classList.remove('is-nav-open');
    this.classList.add('is-ready', 'is-bloomed', 'is-static');
    if (e) console.error('garden-splash:', e);
  }

  isBackdropEl() {
    const m = this.dataset.mode;
    return m === 'world' || m === 'background';
  }

  /* How fine the vertex-snapping grid is: coarse behind pages (the wobble), per render pixel on the splash. */
  snapTo(rs) {
    // PS1 style snaps to every other render pixel: the wobble shows without shaking the logo apart.
    const k = this.backdrop ? 0.25 : this.ps1 ? 0.5 : 1;
    this.snap.value.set(this.w * rs * k, this.h * rs * k);
  }

  init() {
    // The splash is drawn crisp, with smoothed edges; behind other pages the bed stays coarse and light.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.isBackdropEl() && this.dataset.style === 'smooth', alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.octx = this.overlay.getContext('2d');

    this.logo = this.querySelector('[data-garden-logo]');
    this.logoTrigger = this.querySelector('[data-garden-logo-trigger]');
    this.nav = this.querySelector('[data-garden-nav]');
    this.schemeButtons = Array.from(this.querySelectorAll('[data-garden-scheme]'));
    this.schemeLabel = this.querySelector('[data-garden-scheme-name]');
    this.followScheme = this.dataset.followScheme === 'true';

    this.readConfig();
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.motionQuery.matches;

    // Every page of a visit draws the same garden. The splash plays its
    // opening on the first visit (and on a reload, or in the theme editor);
    // after that it, like the world behind other pages, starts already formed.
    const visit = readVisit();
    this.seed = visit ? visit.seed : (Math.random() * 2 ** 31) | 0;
    const editor = !!(window.Shopify && window.Shopify.designMode);
    this.skipOpening = !this.backdrop && !!(visit && visit.entered) && !isReload() && !editor;
    if (!visit) writeVisit({ seed: this.seed, entered: false });
    // The shop's blossoms grow in a bed that is already formed.
    this.formed = this.world || this.blossoms || this.skipOpening;

    // A background bed starts fully grown unless it is set to grow in.
    this.elapsed = this.reduced || this.formed || (this.background && this.dataset.growIn !== 'true') ? this.duration * 1.2 : 0;
    this.flowers = [];
    this.eyes = [];
    this.pings = [];
    this.pointer = { x: 0, y: 0, active: false, down: false, id: null, sx: 0, sy: 0, st: 0, type: 'mouse' };
    this.inspected = null;
    this.inspectUntil = 0;
    this.running = false;
    this.visible = true;
    this.bloomed = false;

    this.setupScene();
    this.bindEvents();
    this.bindEgg();
    if (!this.backdrop && !this.blossoms) {
      this.bindZoom();
      this.bindNight();
    }
    if (this.backdrop) {
      // The bed sits behind the page, so the eyes follow the pointer across it.
      this.onWindowPointer = (e) => {
        if (e.pointerType !== 'mouse') return;
        Object.assign(this.pointer, { x: e.clientX, y: e.clientY, active: true, type: 'mouse' });
      };
      window.addEventListener('pointermove', this.onWindowPointer, { passive: true });
    }
    this.paintSwatches();
    this.applyScheme(this.storedScheme());
    this.resize(true);
    // Layout waits for the logo's silhouette, which the flowers will form.
    this.loadMask().then(() => {
      if (this.failed) return;
      try {
        this.maskReady = true;
        this.resize(true);
        this.start();
        if (this.blossoms && this.dataset.blossomsModule) {
          import(this.dataset.blossomsModule)
            .then((m) => m.attach(this, HELPERS))
            .catch((e) => console.error('garden blossoms:', e));
        }
      } catch (e) {
        this.fail(e);
      }
    });

    // A phone can drop the GL context under memory pressure; wait briefly for it to come back.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.lostTimer = window.setTimeout(() => this.fail(new Error('WebGL context lost')), 3000);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      clearTimeout(this.lostTimer);
      if (!this.failed) this.start();
    });

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(this);
    } else {
      window.addEventListener('resize', () => this.scheduleResize());
    }
    if (window.IntersectionObserver) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].isIntersecting;
        if (this.visible) this.start();
      });
      this.intersectionObserver.observe(this);
    }

    // Nothing is drawn in a hidden tab, or while the Pollen Dream game has
    // the screen: only one garden renders at a time.
    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    this.onWorldPause = () => {
      this.paused = true;
      this.stop();
    };
    this.onWorldResume = () => {
      this.paused = false;
      this.start();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('duet:world-pause', this.onWorldPause);
    window.addEventListener('duet:world-resume', this.onWorldResume);
    this.start();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /* The server-rendered logo stays up until the first 3D frame is on screen. */
  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    if (this.logo) this.logo.style.transition = 'none';
    this.classList.add('is-ready');
    if (this.logo) {
      void this.logo.offsetWidth;
      this.logo.style.transition = '';
    }
  }

  disconnectedCallback() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resizeTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this.unbind) this.unbind();
    if (this.onWindowPointer) window.removeEventListener('pointermove', this.onWindowPointer);
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.onWorldPause) window.removeEventListener('duet:world-pause', this.onWorldPause);
    if (this.onWorldResume) window.removeEventListener('duet:world-resume', this.onWorldResume);
    if (this.onEggClick) document.removeEventListener('click', this.onEggClick);
    if (this.terrain) this.terrain.parts.forEach((x) => x.dispose());
    if (this.bee) {
      this.bee.materials.forEach((m) => m.dispose());
      this.bee = null;
    }
    if (this.weather) {
      this.weather.disposables.forEach((x) => x.dispose());
      this.weather = null;
    }
    if (this.onNightKey) document.removeEventListener('keydown', this.onNightKey);
    document.documentElement.classList.remove('garden-night');
    if (this.sky) {
      this.sky.disposables.forEach((d) => d.dispose());
      this.sky = null;
    }
    if (this.renderer) {
      this.clearMeshes();
      this.renderer.dispose();
    }
  }

  readConfig() {
    const d = this.dataset;
    // Background mode: a bloomed bed that keeps waving behind a page's content.
    this.background = d.mode === 'background';
    // World mode: the formed logo arrangement, fixed behind another page.
    this.world = d.mode === 'world';
    // Blossoms mode: the shop, its products growing in the formed bed (assets/garden-blossoms.js).
    this.blossoms = d.mode === 'blossoms';
    // Either way it sits behind a page: no overlay, no inspecting, fewer frames.
    this.backdrop = this.background || this.world;
    // Weather and light follow the real season on the splash, unless turned off or fixed to one.
    this.weatherOn = !this.background && d.weather !== 'false';
    this.seasonSetting = d.season || 'auto';
    this.south = d.hemisphere === 'south';
    this.skySetting = d.sky || 'auto';
    // The splash's graphics style: PS1 (low resolution, wobble, dither) or smooth.
    this.ps1 = this.backdrop || d.style !== 'smooth';
    this.classList.toggle('is-ps1', this.ps1);
    this.waveSpeed = clamp(parseFloat(d.waveSpeed) || 1, 0.2, 3);
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
    this.keyLight = key;
    this.ambient = new THREE.AmbientLight(toColor(mix(POWDER, this.soil, 0.4)), 0.9);
    scene.add(this.ambient);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 5000);

    // Every vertex snaps to a coarse screen grid, the way early console 3D wobbled.
    this.snap = { value: new THREE.Vector2(160, 90) };
    // And, like the PlayStation, colors are cut to 32 levels per channel with
    // a 4x4 ordered dither (uDither 1), except in the smooth graphics style.
    this.dither = { value: this.ps1 === false ? 0 : 1 };
    const snap = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uSnap = this.snap;
        shader.uniforms.uDither = this.dither;
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'uniform vec2 uSnap;\nvoid main() {')
          .replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;'
          );
        shader.fragmentShader = shader.fragmentShader.replace('void main() {', DITHER_GLSL + 'void main() {').replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb = psxColor(gl_FragColor.rgb);');
      };
      return mat;
    };
    // A satin finish: soft, dim highlights (the eyes alone stay glossy).
    const plastic = (opts) => snap(new THREE.MeshPhongMaterial(Object.assign({ color: 0xffffff, specular: 0x2a2a2a, shininess: 14, flatShading: true }, opts)));
    this.materials = {
      plastic: plastic({}),
      petal: plastic({ side: THREE.DoubleSide, shininess: 16 }),
      gloss: plastic({ shininess: 30, specular: 0x444444, flatShading: false }),
      foliage: plastic({ shininess: 10, specular: 0x1e1e1e, side: THREE.DoubleSide }),
      lid: plastic({ shininess: 18, side: THREE.DoubleSide, flatShading: false }),
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

  /*
   * Swatch 0 is the store's own colors; the others name a theme in SCHEMES
   * (data-scheme). A page without swatches (the world behind other pages,
   * a background bed) takes the theme the visitor last picked, if any.
   */
  schemeAt(i) {
    const b = this.schemeButtons[i];
    return this.schemeNamed(b ? b.dataset.scheme : 'house');
  }

  schemeNamed(name) {
    const t = SCHEMES[name];
    if (!t) return this.house;
    return {
      palette: t.palette.map(parseColor),
      foliage: parseColor(t.foliage),
      center: parseColor(t.center),
      accent: parseColor(t.accent),
    };
  }

  /* Each swatch shows its theme's main colors; the CSS gives some a pattern of their own. */
  paintSwatches() {
    this.schemeButtons.forEach((b, i) => {
      const sc = this.schemeAt(i);
      b.style.setProperty('--s1', hex(sc.center));
      b.style.setProperty('--s2', hex(sc.palette[1 % sc.palette.length]));
      b.style.setProperty('--s3', hex(sc.palette[2 % sc.palette.length]));
      b.style.setProperty('--s4', hex(sc.foliage));
    });
  }

  storedName() {
    try {
      return window.localStorage.getItem(SCHEME_KEY) || 'house';
    } catch (e) {
      return 'house';
    }
  }

  storedScheme() {
    const name = this.storedName();
    const i = this.schemeButtons.findIndex((b) => b.dataset.scheme === name);
    return i > 0 ? i : 0;
  }

  applyScheme(i) {
    const sc = this.schemeButtons.length || !this.followScheme ? this.schemeAt(i) : this.schemeNamed(this.storedName());
    this.scheme = i;
    this.palette = sc.palette.length ? sc.palette : this.house.palette;
    this.foliage = sc.foliage;
    this.heroColor = sc.center;
    this.heroAccent = sc.accent;
    this.schemeButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    if (this.schemeLabel && this.schemeButtons[i]) this.schemeLabel.textContent = this.schemeButtons[i].title || '';
  }

  /* A visitor picked a scheme: recolor every flower in place and remember it. */
  pickScheme(i) {
    this.applyScheme(i);
    try {
      const b = this.schemeButtons[i];
      window.localStorage.setItem(SCHEME_KEY, (b && b.dataset.scheme) || 'house');
    } catch (e) {
      /* private mode: the choice just isn't remembered */
    }
    if (!this.flowers.length) return;
    for (const f of this.flowers) this.sequence(f);
    this.buildMeshes();
  }

  /* ---------------- logo silhouette ---------------- */

  /* Bounds of the opaque part of an alpha mask, or null if it is empty. */
  setMask(w, h, alpha) {
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < w * h; i++) {
      if (alpha[i] <= 127) continue;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    this.mask = x1 > x0 && y1 > y0 ? { w, h, alpha, x0, y0, x1: x1 + 1, y1: y1 + 1 } : null;
    return !!this.mask;
  }

  /*
   * The silhouette the bloomed flowers arrange into: the built-in wordmark,
   * or the alpha channel of a logo chosen in the theme editor.
   * data-garden-mask records which, for debugging on a live store.
   */
  /* The logo shape for this screen: a phone version below 750px wide, if one is set. */
  maskSource() {
    const d = this.dataset;
    return (this.w && this.w < 750 && d.flowerLogoMobile) || d.flowerLogo || '';
  }

  loadMask() {
    const src = this.maskSource();
    this.maskSrc = src;
    if (!src) {
      this.setMask(WORDMARK.w, WORDMARK.h, wordmarkAlpha());
      this.dataset.gardenMask = 'builtin';
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      // A slow logo doesn't hold the garden back: it starts growing, and the
      // logo is laid out when it arrives (see onLateMask).
      let late = false;
      const timer = window.setTimeout(() => {
        late = true;
        this.dataset.gardenMask = 'waiting';
        resolve();
      }, 4000);
      const done = (ok) => {
        clearTimeout(timer);
        this.dataset.gardenMask = ok ? 'loaded' : 'failed';
        if (!ok) console.warn('garden-splash: could not read the logo shape from', src);
        if (late) {
          if (ok) this.onLateMask();
        } else resolve();
      };
      img.onerror = () => done(false);
      img.onload = () => {
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
          for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
          done(this.setMask(w, h, alpha));
        } catch (e) {
          // The image can't be read (no CORS).
          done(false);
        }
      };
      img.src = src;
    });
  }

  /* The logo arrived after the garden started: replant it to form the logo. */
  onLateMask() {
    // A garden already formed without it (a later page of the visit) is replanted too.
    if (this.failed || !this.maskReady || (this.arranged && this.hasTargets)) return;
    this.resize(true);
  }

  /*
   * Fits the logo to the screen and fills it with evenly spaced spots, one
   * per flower. Spacing follows the letter-stroke width, scaled by density.
   */
  layoutLogo(rng) {
    const m = this.mask;
    const { w: W, h: H } = this;
    // Tight bounds of the logo between two source columns.
    const bounds = (cx0, cx1) => {
      let x0 = m.w;
      let y0 = m.h;
      let x1 = 0;
      let y1 = 0;
      for (let y = m.y0; y < m.y1; y++) {
        for (let x = cx0; x < cx1; x++) {
          if (m.alpha[y * m.w + x] <= 110) continue;
          if (x < x0) x0 = x;
          if (x >= x1) x1 = x + 1;
          if (y < y0) y0 = y;
          if (y >= y1) y1 = y + 1;
        }
      }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
    };
    // A wide wordmark ends in the asterisk: flowers there take the asterisk color.
    const wide = (m.x1 - m.x0) / (m.y1 - m.y0) > 2;
    const split = Math.round(m.x0 + (m.x1 - m.x0) * 0.74);
    let pieces;
    if (wide && W / H < 0.8) {
      // On a tall screen the asterisk sits under the word, so the letters can be larger.
      const word = bounds(m.x0, split);
      const star = bounds(split, m.x1);
      star.star = true;
      const gap = word.h * 0.14;
      const k = Math.min((W * 0.9) / Math.max(word.w, star.w), (H * 0.66) / (word.h + gap + star.h));
      const top = (H - (word.h + gap + star.h) * k) / 2;
      word.ox = (W - word.w * k) / 2;
      word.oy = top;
      star.ox = (W - star.w * k) / 2;
      star.oy = top + (word.h + gap) * k;
      pieces = [word, star];
      pieces.k = k;
    } else {
      const all = bounds(m.x0, m.x1);
      const k = Math.min((W * 0.88) / all.w, (H * 0.62) / all.h);
      all.ox = (W - all.w * k) / 2;
      all.oy = (H - all.h * k) / 2;
      all.starFrom = wide ? split : m.w;
      pieces = [all];
      pieces.k = k;
    }
    const k = pieces.k;
    pieces.forEach((pc) => {
      pc.sw = pc.w * k;
      pc.sh = pc.h * k;
    });
    // Which piece a screen point falls on, if any, and whether it is part of the asterisk.
    const hit = (x, y) => {
      for (const pc of pieces) {
        if (x < pc.ox || y < pc.oy || x >= pc.ox + pc.sw || y >= pc.oy + pc.sh) continue;
        const mx = Math.floor(pc.x0 + (x - pc.ox) / k);
        const my = Math.floor(pc.y0 + (y - pc.oy) / k);
        if (m.alpha[my * m.w + mx] > 110) return { star: !!pc.star || mx >= (pc.starFrom || m.w) };
      }
      return null;
    };
    const bx0 = Math.min(...pieces.map((pc) => pc.ox));
    const by0 = Math.min(...pieces.map((pc) => pc.oy));
    const bx1 = Math.max(...pieces.map((pc) => pc.ox + pc.sw));
    const by1 = Math.max(...pieces.map((pc) => pc.oy + pc.sh));
    // Spacing follows the height of the letters, scaled by density.
    let spacing = Math.max(7, pieces[0].sh * 0.16 * LOGO_SPACING[this.densityName]);
    let spots = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      spots = poissonDisc(bx0, by0, bx1, by1, spacing, rng, [(bx0 + bx1) / 2, (by0 + by1) / 2])
        .map(([x, y]) => ({ x, y, h: hit(x, y) }))
        .filter((sp) => sp.h);
      if (spots.length <= LOGO_MAX[this.densityName]) break;
      spacing *= 1.15;
    }
    this.base = spacing;
    this.logoBox = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
    const fill = LOGO_FILL[this.densityName];
    return spots.map((sp) => ({ x: sp.x, y: sp.y, r: spacing * fill * lerp(0.9, 1.06, rng()), star: sp.h.star }));
  }

  eyeMaterial(iris) {
    const key = colorKey(iris);
    if (!this.eyeTextures.has(key)) {
      const m = this.makeMaterial({ map: eyeTexture(iris), specular: 0xbbbbbb, shininess: 120, flatShading: false });
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
    // The formed logo is a button over the flowers (for the hidden game): the
    // pointer over it is still over the bed, so it brushes the flowers.
    const onLogo = (e) => e.target instanceof Element && !!e.target.closest('[data-garden-logo-trigger]');
    const isUi = (e) => e.target instanceof Element && e.target.closest('[data-garden-ui]') && !onLogo(e);

    const onDown = (e) => {
      if (isUi(e) || this.classList.contains('is-nav-open')) return;
      const [x, y] = local(e);
      Object.assign(this.pointer, { x, y, active: true, down: true, id: e.pointerId, sx: x, sy: y, st: e.timeStamp, type: e.pointerType, logo: onLogo(e) });
      this.markInteracted();
      // Not on the logo: holding the pointer there would take the click from its button.
      if (this.pointer.logo) return;
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
    };
    const onUp = (e) => {
      const p = this.pointer;
      if (!p.down || p.id !== e.pointerId) return;
      const [x, y] = local(e);
      // A tap on the logo is its button's (the menu, or the asterisk's game), not a recolor.
      if (!this.gestured && !p.logo && Math.hypot(x - p.sx, y - p.sy) < 14 && e.timeStamp - p.st < 450) this.tap(x, y);
      p.down = false;
      if (e.pointerType !== 'mouse') p.active = false;
    };
    const onLeave = (e) => {
      if (e.pointerType === 'mouse' || e.type === 'pointercancel') {
        this.pointer.active = false;
        this.pointer.down = false;
      }
    };
    const onMotion = () => {
      this.reduced = this.motionQuery.matches;
    };

    this.addEventListener('pointerdown', onDown);
    this.addEventListener('pointermove', onMove);
    this.addEventListener('pointerup', onUp);
    this.addEventListener('pointercancel', onLeave);
    this.addEventListener('pointerleave', onLeave);
    this.schemeButtons.forEach((b, i) => b.addEventListener('click', () => this.pickScheme(i)));
    if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', onMotion);

    this.unbind = () => {
      if (this.motionQuery.removeEventListener) this.motionQuery.removeEventListener('change', onMotion);
    };
  }

  /*
   * The hidden way into the Pollen Dream game: tapping the flowers of the
   * logo's asterisk. Each tap makes them jump and spin a little more; the
   * fifth (within a second and a half of the last) opens the game, which
   * dives into this very arrangement. On the splash the taps land on the
   * logo button; behind other pages, on any empty part of the page.
   */
  bindEgg() {
    if (this.logoTrigger) {
      // Taps on the asterisk count toward the hidden game.
      this.logoTrigger.addEventListener(
        'click',
        (e) => {
          if (!e.detail || !this.eggHit(e.clientX, e.clientY)) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          this.eggTap(e.clientX, e.clientY);
        },
        true
      );
    }
    if (this.world) {
      this.onEggClick = (e) => {
        const t = e.target;
        if (!(t instanceof Element) || t.closest('a, button, input, select, textarea, label, summary, [role="button"], [tabindex], dialog')) return;
        if (this.eggHit(e.clientX, e.clientY)) this.eggTap(e.clientX, e.clientY);
      };
      document.addEventListener('click', this.onEggClick);
    }
  }

  eggEnabled() {
    const header = document.querySelector('[data-duet-header]');
    const access = header ? header.dataset.gameAccess : 'menu';
    return access !== 'off' && typeof window.pollenDream === 'function';
  }

  /* Whether a point on screen is on one of the asterisk's flowers. */
  eggHit(cx, cy) {
    if (!this.arranged || !this.hasTargets || this.failed || this.night || !this.eggEnabled()) return false;
    const r = this.getBoundingClientRect();
    const x = cx - r.left;
    const y = cy - r.top;
    this.project();
    // A logo that is only the asterisk has no separate asterisk part: all of it counts.
    const any = !this.flowers.some((f) => f.star);
    for (const f of this.flowers) {
      if ((f.star || any) && Math.hypot(f.sx - x, f.sy - y) < Math.max(this.base * 1.3, f.sr)) return true;
    }
    return false;
  }

  eggTap(cx, cy) {
    const now = performance.now();
    const egg = this.egg || (this.egg = { taps: 0, last: 0, pulse: 0 });
    if (now - egg.last > 1500) egg.taps = 0;
    egg.last = now;
    egg.taps++;
    egg.pulse = 1;
    const r = this.getBoundingClientRect();
    if (!this.backdrop) this.pings.push({ x: cx - r.left, y: cy - r.top, t: 0 });
    for (const f of this.flowers) if (f.star && f.eye) f.eye.blinkAt = this.elapsed + Math.random() * 0.15;
    if (egg.taps >= 5) {
      egg.taps = 0;
      egg.pulse = 1.6;
      window.dispatchEvent(new CustomEvent('duet:egg', { detail: { garden: this } }));
    }
    this.start();
  }

  /* The asterisk's flowers jump and spin, more with every tap. */
  eggReact(dt) {
    const egg = this.egg;
    egg.pulse = Math.max(0, egg.pulse - dt * 1.2);
    const level = (egg.taps || 5) / 5;
    const k = this.reduced ? 0 : smooth(Math.min(1, egg.pulse));
    const t = this.elapsed;
    const any = !this.flowers.some((f) => f.star);
    for (const f of this.flowers) {
      if (!f.star && !any) continue;
      if (f.rot0 === undefined) f.rot0 = f.rot;
      f.lift = k * (14 + 46 * level) * (0.6 + 0.4 * Math.sin(f.id * 1.7 + t * 12));
      f.rot = f.rot0 + k * Math.sin(t * (10 + 10 * level) + f.id) * (0.15 + 0.3 * level);
      f.shown = -1;
    }
  }

  markInteracted() {
    if (!this.classList.contains('has-interacted')) this.classList.add('has-interacted');
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
    if (this.explorer && !initial) {
      // Exploring, the garden fills the screen: only the picture changes size, the bed stays as it is.
      this.renderer.setSize(W, H, false);
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
      return;
    }
    if (!initial && W === this.w && H === this.h) return;
    const relayout = initial || !this.flowers.length || W !== this.w || Math.abs(H - this.h) > 90;
    this.w = W;
    this.h = H;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Behind other pages the bed is drawn small and scaled up with hard pixels;
    // the splash is drawn at full sharpness and steps down only if it must.
    this.rsFloor = renderScale(W);
    this.rs = this.backdrop ? this.rsFloor : Math.min(this.rsCap || 9, this.ps1 ? ps1Scale(W) : splashScale(W, this.dpr));
    this.renderer.setPixelRatio(this.rs);
    this.rsNow = this.rs;
    this.renderer.setSize(W, H, false);
    this.snapTo(this.rs);

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

    this.camBase = this.camera.position.clone();
    if (this.view) this.resetView(true);
    if (this.night) this.endNight();

    if (!this.maskReady) return;
    // Crossing the phone width with a separate phone logo: load that shape, then lay it out.
    if (this.maskSource() !== this.maskSrc) {
      this.loadMask().then(() => !this.failed && this.resize(true));
      return;
    }
    // A small height change (mobile browser chrome) keeps the same field, re-placed.
    if (relayout || !this.flowers.length) this.generate();
    else this.buildMeshes();
    this.project();
    if (this.arranged) this.placeLogoTrigger();
    // A still garden (reduced motion) is drawn again at the new size.
    this.start();
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
      // Small letters make small flowers: while scattered they grow to fill
      // the screen, and shrink to fit as they glide into the logo.
      const grow = target ? clamp((spread * 0.8) / r, 1, 4) : 1;
      const f = this.makeFlower(x, y, lerp(-25, 30, rng()), r, rng, { id: i + 1, startAt, dur: D * lerp(0.36, 0.5, rng()), star: target && target.star, grow });
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
    if ((this.reduced || this.formed) && !this.background) this.settle();
    this.assignEyes(rng);
    this.buildMeshes();
  }

  /* Puts every flower straight into its place in the logo (reduced motion). */
  settle() {
    for (const f of this.flowers) {
      f.p = 1;
      [f.x, f.y] = f.dest;
      f.lift = 0;
      f.g = 1;
      f.shown = -1;
    }
    this.onArranged();
  }

  /*
   * The logo is formed: the splash becomes the page's backdrop. It is
   * remembered for the visit, so other pages and later visits to the
   * splash start from here instead of replaying the opening.
   */
  onArranged() {
    this.arranged = true;
    this.bloomed = true;
    // From now on a resize re-lays the logo straight into place.
    this.formed = true;
    this.calmFrom = this.elapsed;
    this.classList.add('is-bloomed');
    this.placeLogoTrigger();
    if (!this.backdrop) writeVisit({ seed: this.seed, entered: true });
  }

  /* The formed logo is a button for the hidden game: it covers the logo's box. */
  placeLogoTrigger() {
    const btn = this.logoTrigger;
    if (!btn || !this.logoBox) return;
    const b = this.logoBox;
    const pad = Math.max(8, this.base || 0);
    btn.style.setProperty('--gs-trigger-x', `${Math.round(b.x - pad)}px`);
    btn.style.setProperty('--gs-trigger-y', `${Math.round(b.y - pad)}px`);
    btn.style.setProperty('--gs-trigger-w', `${Math.round(b.w + pad * 2)}px`);
    btn.style.setProperty('--gs-trigger-h', `${Math.round(b.h + pad * 2)}px`);
    // The menu opens out of the logo.
    this.style.setProperty('--gs-origin-x', `${Math.round(b.x + b.w / 2)}px`);
    this.style.setProperty('--gs-origin-y', `${Math.round(b.y + b.h / 2)}px`);
    btn.hidden = false;
  }

  makeFlower(x, y, z, r, rng, opts) {
    const f = {
      id: opts.id,
      x,
      y,
      z,
      r,
      g: opts.grow || 1,
      grow: opts.grow || 1,
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
    if (r * f.grow < 12) f.species = 'daisy';
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
      if (!EYED.has(f.species) || f.r * f.grow < 12 || rng() > 0.4) continue;
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
        neck: take('stem', tone(this.foliage, -0.35)),
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
      f.sr = f.r * f.g * (this.camDist / (this.camera.position.z - f.z));
    }
  }

  /* Where the stem bends: a little way below the head, at most halfway down. */
  knee(f, Z) {
    return Z - Math.min((Z - FLOOR_Z) * 0.5, f.r * 2.2);
  }

  /*
   * The swing of the head about the bend, from the flower's tilt (bx: toward
   * +x, by: toward +y, in radians), or null when it stands straight. Kept on
   * the flower so the eye can follow the head.
   */
  bendMatrix(f, X, Y, knee) {
    if (Math.abs(f.bx || 0) < 1e-4 && Math.abs(f.by || 0) < 1e-4) {
      f.bent = null;
      return null;
    }
    const m = f.bent || (f.bent = new THREE.Matrix4());
    const rot = (this.bendRot || (this.bendRot = new THREE.Matrix4())).makeRotationFromEuler(
      (this.bendEuler || (this.bendEuler = new THREE.Euler())).set(-(f.by || 0), f.bx || 0, 0)
    );
    m.makeTranslation(X, Y, knee).multiply(rot);
    const back = (this.bendBack || (this.bendBack = new THREE.Matrix4())).makeTranslation(-X, -Y, -knee);
    return m.multiply(back);
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
    const g = f.g;
    const zero = 1e-4;
    d.rotation.order = 'ZYX';
    // The stem bends at a point below the head: everything above it (the
    // neck and the head) swings about that point as one.
    const knee = this.knee(f, Z);
    const bend = this.bendMatrix(f, X, Y, knee);
    // Every part is placed at the flower's own size, then scaled about its center by g.
    const put = (slot, x, y, z, yaw, pitch, sx, sy, sz, keepZ, bent) => {
      d.position.set(X + (x - X) * g, Y + (y - Y) * g, keepZ ? z : Z + (z - Z) * g);
      d.rotation.set(0, -pitch, yaw);
      d.scale.set(sx * g || zero, sy * g || zero, keepZ ? sz || zero : sz * g || zero);
      d.updateMatrix();
      if (bent && bend) d.matrix.premultiply(bend);
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
    put(S.seed, X, Y, seedZ, 0, 0, seedS / g, seedS / g, seedS, true);

    // The stem rises from the soil to where the head will be.
    const stemH = (Z - FLOOR_Z) * smooth(Math.max(sprout * 0.25, leaves));
    const stemR = sprout > 0 ? Math.max(1.5, r * 0.05) : 0;
    const lowH = Math.min(stemH, knee - FLOOR_Z);
    put(S.stem, X, Y, FLOOR_Z, 0, 0, stemR, stemR, Math.max(zero, lowH), true);
    put(S.neck, X, Y, knee, 0, 0, stemR, stemR, Math.max(zero, stemH - lowH), true, true);

    f.leaves.forEach((leaf, i) => {
      const lp = smooth(range(leaves, leaf.delay, leaf.delay + 0.65));
      const lz = FLOOR_Z + (Z - 14 - FLOOR_Z) * lp;
      put(S.leaves[i], X, Y, lz, leaf.a, lerp(1.2, 0.1, lp), leaf.len * lp, leaf.w * 2 * lp, leaf.w * 2 * lp * g, true);
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
        part.sz * s,
        false,
        true
      );
    });

  }

  /* ---------------- interaction ---------------- */

  /* How much larger than their final size the flowers are drawn right now. */
  scaleNow() {
    const n = this.flowers.length;
    if (!n) return 1;
    let sum = 0;
    for (const f of this.flowers) sum += f.g;
    // Zoomed in, flowers are bigger on screen, so reaches grow with them.
    return (sum / n) * (this.view ? this.view.z : 1);
  }

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
    if (this.blossomTap && this.blossomTap(x, y)) return;
    this.pings.push({ x, y, t: 0 });
    const k = this.scaleNow();
    const f = this.nearest(x, y, this.base * 1.1 * k);
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
      if (dd < this.base * 6 * k) o.eye.blinkAt = this.elapsed + dd / (this.base * 14 * k);
    }
  }

  /* ---------------- loop ---------------- */

  start() {
    if (this.running || this.failed || this.paused || document.hidden || !this.isConnected || !this.renderer || !this.maskReady) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      if (!this.visible) {
        this.running = false;
        return;
      }
      // Behind a page the bed only needs about 30 frames a second.
      if (this.backdrop && now - this.last < 30) {
        this.raf = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      if (!this.backdrop) this.adapt(now - this.last);
      this.last = now;
      try {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
        if (!this.backdrop) this.drawOverlay();
      } catch (e) {
        this.fail(e);
        return;
      }
      this.reveal();
      // With reduced motion the formed world behind a page is a still picture.
      if (this.world && this.reduced) {
        this.running = false;
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /*
   * Keeps the splash smooth: once the logo has formed (growing is the
   * busiest moment and passes), if frames keep taking too long the render
   * resolution steps down a quarter at a time, never below the original
   * coarse look, and stays down for the visit to this page.
   */
  adapt(ms) {
    if (ms <= 0 || ms > 250 || !this.arranged || this.elapsed - (this.calmFrom || 0) < 1.5) return;
    const q = this.quality || (this.quality = { avg: 16, since: 0 });
    q.avg += (ms - q.avg) * 0.05;
    q.since += ms;
    if (q.since < 2500) return;
    q.since = 0;
    if (q.avg > 28 && this.rs > this.rsFloor + 0.01) {
      this.rs = Math.max(this.rsFloor, Math.round((this.rs - 0.25) * 20) / 20);
      this.rsCap = this.rs;
      this.rsNow = 0;
      if (this.view && this.view.z > 1.02) this.sharpen();
      else this.applyScale(this.rs);
    }
  }

  applyScale(rs) {
    this.rsNow = rs;
    this.renderer.setPixelRatio(rs);
    this.renderer.setSize(this.w, this.h, false);
    this.snapTo(rs);
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;
    const ptr = this.pointer;
    const reach = this.base * 2.4 * this.scaleNow();

    if (this.rebuild) {
      this.rebuild = false;
      this.buildMeshes();
    }

    // Once the whole bed has bloomed, it glides into the shape of the logo.
    // A background bed is laid out the same way, so its flowers match the
    // splash's in size and number, but it stays scattered and waves instead.
    if (this.hasTargets && !this.arranged && !this.background) {
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
          f.g = lerp(f.grow, 1, e);
          f.shown = -1;
        }
        this.project();
        if (done) this.onArranged();
      }
    }

    if (this.background && !this.reduced) this.wave(t);
    if (!this.background) this.drift(t, dt);
    if (this.blossomUpdate) this.blossomUpdate(t, dt);
    if (this.weatherOn) this.updateWeather(t, dt);
    this.brushStep(dt);
    if (this.arranged && !this.background && !this.reduced) {
      // At night no gusts come, but heads still swinging come to rest.
      if (!this.night || this.explorer) this.blow(t);
      else this.sway(dt, () => 0);
    }
    if (this.arranged && !this.backdrop && !this.reduced) {
      if (!this.night || this.explorer) this.flyBee(t, dt);
      else if (this.bee) this.bee.group.visible = false;
    }
    if (this.egg && this.egg.pulse > 0) this.eggReact(dt);

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
    }

    if (!this.bloomed && !this.hasTargets && this.flowers.length && this.flowers.every((f) => f.p >= 1)) {
      this.bloomed = true;
      this.classList.add('is-bloomed');
    }

    if (this.viewDirty) {
      this.viewDirty = false;
      this.project();
    }
    if (this.backdrop) {
      this.inspected = null;
    } else if (ptr.active && ptr.type === 'mouse' && !ptr.down) {
      this.inspected = this.nearest(ptr.x, ptr.y, this.base * 1.1 * this.scaleNow());
    } else if (this.inspected && t > this.inspectUntil) {
      this.inspected = null;
    }

    this.updateEyes(dt);
    for (const pg of this.pings) pg.t += dt;
    this.pings = this.pings.filter((pg) => pg.t < 0.25);
  }

  /*
   * Background mode: the fully populated bed, exactly as on the splash just
   * before it forms the logo, rolls in a slow wave that travels
   * across the screen, each flower rising toward the viewer and swaying,
   * like the glide on the splash page but without end.
   */
  wave(t) {
    const k = t * this.waveSpeed;
    for (const f of this.flowers) {
      if (f.rot0 === undefined) f.rot0 = f.rot;
      const phase = k * 1.1 - f.home[0] * 0.006 - f.home[1] * 0.0025;
      const s = Math.sin(phase);
      f.lift = (0.5 + 0.5 * s) * 46;
      f.x = f.home[0] + Math.cos(phase * 0.8) * 6;
      f.y = f.home[1] + Math.sin(phase * 0.6) * 4;
      f.rot = f.rot0 + s * 0.14;
      f.shown = -1;
    }
  }

  /*
   * The formed logo as a living backdrop. The flowers stay exactly where
   * they are; only the camera sways a little over the bed (the flowers
   * stand at different heights, so they shift in depth against each other)
   * and the light slowly circles. It eases in after the arrangement, so
   * nothing jumps. While the menu is open the camera leans in toward the logo.
   */
  drift(t, dt) {
    if (!this.camBase) return;
    if (this.night) this.updateNight(t, dt);
    if (this.explorer) this.updateExplore(dt);
    if (this.night && this.night.t > 0) return;
    const v = this.view;
    if (v) this.easeView(dt);
    const Z = v ? v.z : 1;
    const cx = v ? v.cx : this.w / 2;
    const cy = v ? this.h - v.cy : this.h / 2;
    const motion = this.reduced || !this.arranged ? 0 : smooth(range(t - (this.calmFrom || 0), 0, 3));
    const nav = this.classList.contains('is-nav-open') && !this.reduced ? 1 : 0;
    this.navLean = lerp(this.navLean || 0, nav, 1 - Math.exp(-dt * 5));
    const k = t * 0.12;
    const sway = (this.camDist * 0.035 * motion) / Z;
    const c = this.camera;
    c.position.set(cx + Math.sin(k) * sway, cy + Math.sin(k * 0.77 + 1) * sway * 0.7, (this.camBase.z / Z) * (1 - 0.06 * this.navLean));
    const look = this.logoBox ? [this.logoBox.x + this.logoBox.w / 2, this.h - (this.logoBox.y + this.logoBox.h / 2)] : [this.w / 2, this.h / 2];
    c.lookAt(lerp(cx, look[0], this.navLean), lerp(cy, look[1], this.navLean), 0);
    if (this.keyLight) {
      // The light circles slowly. Motion eases between its resting place and
      // where the circle has got to, never scaling the angle itself: that
      // would sweep it round many times whenever the logo re-forms late in a
      // visit (a resize, or a phone's address bar showing).
      // Once circling, it keeps circling through a re-form instead of jumping back.
      const m = this.reduced ? 0 : (this.lightMotion = Math.max(this.lightMotion || 0, motion));
      const a = k * 0.6;
      const ox = -0.7 * Math.cos(a) - 0.5 * Math.sin(a);
      const oy = 0.9 * Math.cos(a * 0.8);
      this.keyLight.position.set(lerp(-0.7, ox, m), lerp(0.9, oy, m), 1.2);
    }
  }

  /* ---------------- the bee ---------------- */

  /*
   * A small bee in the same plastic, vertex-snapped style as the flowers:
   * a banded gold and ocean body, a head, a sting and two clear wings on
   * hinges. Built once, on its first visit, and reused. Faces +x.
   */
  buildBee() {
    const G = this.geometries;
    const mat = (color, extra) => this.makeMaterial(Object.assign({ color, shininess: 110 }, extra));
    const gold = mat(0xf2a834);
    const ink = mat(0x191f6b);
    const wing = this.makeMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, shininess: 160, depthWrite: false, flatShading: false });
    const group = new THREE.Group();
    const part = (geo, m, x, y, z, sx, sy, sz) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      group.add(o);
      return o;
    };
    // Body: overlapping bands, tapering toward the sting.
    [
      [-0.05, 0.5, gold],
      [-0.45, 0.47, ink],
      [-0.82, 0.43, gold],
      [-1.15, 0.34, ink],
      [-1.42, 0.22, gold],
    ].forEach(([x, r, m]) => part(G.ball, m, x, 0, 0, r * 0.95, r, r));
    part(G.ball, ink, 0.55, 0, 0.05, 0.36, 0.38, 0.36);
    part(G.tube, ink, -1.55, 0, 0, 0.3, 0.05, 0.05).rotation.z = Math.PI;
    // Two feelers.
    [-1, 1].forEach((side) => {
      const f = part(G.tube, ink, 0.75, 0.12 * side, 0.2, 0.42, 0.025, 0.025);
      f.rotation.set(0, -0.5, 0.45 * side);
    });
    // Wings hinge along the body's back and flap about it.
    const wings = [-1, 1].map((side) => {
      const hinge = new THREE.Group();
      hinge.position.set(-0.2, 0.12 * side, 0.38);
      const w = new THREE.Mesh(this.geometries.round, wing);
      w.rotation.z = (side * Math.PI) / 2 - side * 0.35;
      w.scale.set(1.15, 0.7, 0.4);
      hinge.add(w);
      group.add(hinge);
      return { hinge, side };
    });
    group.visible = false;
    this.scene.add(group);
    this.bee = { group, wings, materials: [gold, ink, wing], phase: 'away', recent: [] };
  }

  /* A point just off screen, in a random direction from the center. */
  beeEdge(angle) {
    const R = Math.hypot(this.w, this.h) / 2 + this.base * 3;
    return new THREE.Vector3(this.w / 2 + Math.cos(angle) * R, this.h / 2 + Math.sin(angle) * R, lerp(140, 230, Math.random()));
  }

  /* A flight along a gentle curve, from a to b, swinging to one side. */
  beeLeg(a, b, speed) {
    const mid = a.clone().lerp(b, 0.5);
    const d = a.distanceTo(b);
    const side = (Math.random() - 0.5) * 0.9 * d;
    const n = new THREE.Vector3(-(b.y - a.y), b.x - a.x, 0).normalize();
    mid.addScaledVector(n, side);
    mid.z = Math.max(a.z, b.z) + 30;
    return { a, c: mid, b, t: 0, dur: clamp(d / speed, 1.2, 6) };
  }

  /* Picks a flower to land on: an open one on screen, not one used lately. */
  beeTarget() {
    const recent = this.bee.recent;
    const m = this.base;
    const ok = this.flowers.filter((f) => f.p >= 1 && !recent.includes(f.id) && f.dest[0] > m && f.dest[0] < this.w - m && f.dest[1] > m * 2 && f.dest[1] < this.h - m);
    if (!ok.length) return null;
    const f = ok[Math.floor(Math.random() * ok.length)];
    recent.push(f.id);
    if (recent.length > 12) recent.shift();
    return f;
  }

  /* Where the bee sits on a flower: on top of its petals. */
  beeSeat(f) {
    return new THREE.Vector3(f.dest[0], this.h - f.dest[1], f.z + f.r * 0.6 * f.g + this.base * 0.35);
  }

  /*
   * The bee's visit: in from a random direction, then either down onto a
   * flower for a moment and away in another random direction, or (about one
   * time in four) straight past. Positions are in the bed's own space,
   * like the flowers: x right, y up, z toward the viewer.
   */
  flyBee(t, dt) {
    if (!this.bee) {
      // No bees in winter.
      if (this.seasonNow && !SEASON_LOOK[this.seasonNow.name].bees) return;
      if (this.nextBee === undefined) this.nextBee = t + 5 + Math.random() * 6;
      if (t < this.nextBee) return;
      this.buildBee();
    }
    const bee = this.bee;
    const g = bee.group;
    const speed = Math.max(220, this.w * 0.32);
    const toScreen = (v) => new THREE.Vector3(v.x, this.h - v.y, v.z);

    if (bee.phase === 'away') {
      if (this.nextBee !== undefined && t < this.nextBee) return;
      const inAngle = Math.random() * TAU;
      const start = toScreen(this.beeEdge(inAngle));
      bee.outAngle = inAngle + Math.PI + (Math.random() - 0.5) * 2.4;
      bee.flower = Math.random() < 0.75 ? this.beeTarget() : null;
      g.scale.setScalar(this.base * 0.75);
      g.visible = true;
      if (bee.flower) {
        const seat = this.beeSeat(bee.flower);
        bee.hover = seat.clone().setZ(seat.z + this.base * 1.4);
        bee.leg = this.beeLeg(start, bee.hover, speed);
        bee.phase = 'in';
      } else {
        bee.leg = this.beeLeg(start, toScreen(this.beeEdge(bee.outAngle)), speed);
        bee.phase = 'past';
      }
      bee.yaw = Math.atan2(bee.leg.b.y - start.y, bee.leg.b.x - start.x);
      g.position.copy(start);
    }

    const flap = (rate, amount) => {
      bee.flapT = (bee.flapT || 0) + dt * rate;
      for (const w of bee.wings) w.hinge.rotation.x = w.side * (0.15 + amount * (0.5 + 0.5 * Math.sin(bee.flapT)));
    };
    const along = (leg) => {
      leg.t = Math.min(1, leg.t + dt / leg.dur);
      const e = smooth(leg.t);
      const u = 1 - e;
      const p = new THREE.Vector3()
        .addScaledVector(leg.a, u * u)
        .addScaledVector(leg.c, 2 * u * e)
        .addScaledVector(leg.b, e * e);
      // A bee's flight wobbles.
      p.z += Math.sin(t * 7) * this.base * 0.12;
      p.x += Math.sin(t * 3.3) * this.base * 0.15;
      return p;
    };
    const head = (to, k) => {
      const want = Math.atan2(to.y - g.position.y, to.x - g.position.x);
      let d = want - bee.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      bee.yaw += d * Math.min(1, dt * k);
    };

    if (bee.phase === 'in' || bee.phase === 'out' || bee.phase === 'past') {
      const p = along(bee.leg);
      if (p.distanceToSquared(g.position) > 1e-4) head(p, 8);
      g.position.copy(p);
      flap(55, 1);
      if (bee.leg.t >= 1) {
        if (bee.phase === 'in') {
          bee.phase = 'land';
          bee.k = 0;
        } else {
          g.visible = false;
          bee.phase = 'away';
          const gap = this.seasonNow ? SEASON_LOOK[this.seasonNow.name].bees : [14, 30];
          this.nextBee = gap ? t + lerp(gap[0], gap[1], Math.random()) : Infinity;
        }
      }
    } else if (bee.phase === 'land' || bee.phase === 'up') {
      // Down onto the petals, or back up off them.
      bee.k = Math.min(1, bee.k + dt / 0.8);
      const seat = this.beeSeat(bee.flower);
      const e = smooth(bee.k);
      const from = bee.phase === 'land' ? bee.hover : seat;
      const to = bee.phase === 'land' ? seat : bee.hover;
      g.position.lerpVectors(from, to, e);
      flap(bee.phase === 'land' ? lerp(55, 20, e) : 55, bee.phase === 'land' ? lerp(1, 0.4, e) : 1);
      if (bee.k >= 1) {
        if (bee.phase === 'land') {
          bee.phase = 'rest';
          bee.restUntil = t + 1.6 + Math.random() * 2.2;
          bee.dip = 1;
        } else {
          bee.leg = this.beeLeg(g.position.clone(), toScreen(this.beeEdge(bee.outAngle)), speed);
          bee.phase = 'out';
        }
      }
    } else if (bee.phase === 'rest') {
      // A moment on the flower: wings flick now and then, the bee turns a little.
      const f = bee.flower;
      g.position.copy(this.beeSeat(f));
      bee.yaw += Math.sin(t * 1.3) * dt * 0.6;
      const flick = Math.sin(t * 2.1) > 0.6;
      flap(flick ? 40 : 4, flick ? 0.8 : 0.2);
      if (t > bee.restUntil) {
        bee.phase = 'up';
        bee.k = 0;
        bee.hover = this.beeSeat(f).setZ(this.beeSeat(f).z + this.base * 1.4);
      }
    }

    // The flower gives a little under the bee as it lands.
    if (bee.dip > 0 && bee.flower) {
      bee.dip = Math.max(0, bee.dip - dt / 0.7);
      const f = bee.flower;
      if (!this.gust) {
        f.lift = -Math.sin(Math.PI * (1 - bee.dip)) * this.base * 0.18;
        f.shown = -1;
      }
    }

    // Leaning into turns, nose slightly down in flight.
    const flying = bee.phase !== 'rest';
    g.rotation.set(0, flying ? 0.15 : 0, bee.yaw, 'ZYX');
  }

  /* ---------------- the night sky ---------------- */

  /*
   * The hidden night: tracing the letter d over the flowers of the logo's d
   * (a finger, or the mouse held down) turns the view over. The camera sinks down onto
   * the bed, just above the flower heads, and tips back until it looks
   * straight up, as if lying on your back on the flowers: only the night
   * sky in view. Up there the white stars, one for each flower, gather
   * into the logo the way the flowers did, among faint
   * constellations, twinkling, with a shooting star now and then. A
   * circle drawn round the middle, Escape, or the menu brings the day back.
   */
  bindNight() {
    let path = null;
    this.addEventListener(
      'pointerdown',
      (e) => {
        if (this.classList.contains('is-nav-open') || !this.arranged || this.failed) return;
        path = { id: e.pointerId, a: null, sum: 0, t0: e.timeStamp, n: 0, pts: [] };
      },
      true
    );
    this.addEventListener(
      'pointermove',
      (e) => {
        if (!path || e.pointerId !== path.id) return;
        if ((this.view && this.view.tz > 1.02) || (this.skyView && this.skyView.tz > 1.02)) {
          path = null;
          return;
        }
        const r = this.getBoundingClientRect();
        if (!this.night) {
          // By day, the stroke is kept to read as a letter when the finger lifts.
          const x = e.clientX - r.left;
          const y = e.clientY - r.top;
          const last = path.pts[path.pts.length - 1];
          if (!last || Math.hypot(x - last[0], y - last[1]) > 3) path.pts.push([x, y]);
          this.trace = path.pts;
          return;
        }
        const b = this.logoBox || { x: 0, y: 0, w: this.w, h: this.h };
        const dx = e.clientX - r.left - (b.x + b.w / 2);
        const dy = e.clientY - r.top - (b.y + b.h / 2);
        if (Math.hypot(dx, dy) < 40) return;
        const a = Math.atan2(dy, dx);
        if (path.a !== null) {
          let d = a - path.a;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          path.sum += d;
        }
        path.a = a;
        if (Math.abs(path.sum) > TAU * 0.92 && e.timeStamp - path.t0 < 8000) {
          path = null;
          this.pointer.down = false;
          this.gestured = true;
          this.toggleNight();
        }
      },
      true
    );
    const end = (e) => {
      if (!path || e.pointerId !== path.id) return;
      const done = path;
      path = null;
      this.trace = null;
      if (e.type === 'pointerup' && !this.night && e.timeStamp - done.t0 < 7000 && this.tracedD(done.pts, e.pointerType !== 'mouse')) {
        this.pointer.down = false;
        this.gestured = true;
        this.toggleNight();
      }
    };
    this.addEventListener('pointerup', end, true);
    this.addEventListener('pointercancel', end, true);
    this.onNightKey = (e) => {
      if (e.key === 'Escape' && this.night && this.night.dir > 0 && !this.explorer) this.toggleNight();
    };
    document.addEventListener('keydown', this.onNightKey);
  }

  /*
   * Where the logo's d is on screen: the first letter of the flowers (the
   * asterisk aside), found as the first run of flowers from the left
   * before a gap. With no letters (a logo that is only the asterisk, as on
   * phones: anything not much wider than tall), the whole logo.
   */
  letterD() {
    const key = `${this.w}x${this.h}:${this.flowers.length}`;
    if (this.dBox && this.dBox.key === key) return this.dBox;
    const pts = this.flowers.filter((f) => !f.star).map((f) => f.dest);
    const b = this.logoBox || { x: 0, y: 0, w: this.w, h: this.h };
    let box = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
    const word = b.w > b.h * 1.8;
    if (word && pts.length > 6) {
      const bin = Math.max(4, (this.base || 20) * 0.6);
      const x0 = Math.min(...pts.map((p) => p[0]));
      const cols = new Set(pts.map((p) => Math.floor((p[0] - x0) / bin)));
      let end = 0;
      while (cols.has(end + 1) || cols.has(end + 2)) end += cols.has(end + 1) ? 1 : 2;
      let x1 = x0 + (end + 1) * bin;
      // Letters that run together: take the first quarter of the word.
      const xmax = Math.max(...pts.map((p) => p[0]));
      if (x1 - x0 > (xmax - x0) * 0.45) x1 = x0 + (xmax - x0) * 0.25;
      const inD = pts.filter((p) => p[0] <= x1);
      box = { x0, x1, y0: Math.min(...inD.map((p) => p[1])), y1: Math.max(...inD.map((p) => p[1])) };
    }
    const pad = (this.base || 20) * 0.8;
    this.dBox = { key, x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
    return this.dBox;
  }

  /*
   * Whether a stroke is the letter d, traced over the logo's d: mostly
   * inside it, about its height, taller than wide, and close in shape to
   * one of the ways a d is written (bowl then stem, stem then bowl, the
   * bowl either way round). The shapes are compared as 32 evenly spaced
   * points, each stretched to fill a square.
   */
  tracedD(pts, touch) {
    if (!pts || pts.length < 10) return false;
    const box = this.letterD();
    // A finger is broad and the letter small on a phone: room around it, and a looser match.
    const pad = touch ? Math.min(this.w, this.h) * 0.08 : 0;
    const inside = pts.filter(([x, y]) => x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad).length;
    if (inside < pts.length * (touch ? 0.6 : 0.7)) return false;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (h < (box.y1 - box.y0) * (touch ? 0.3 : 0.35) || h < w * (touch ? 0.8 : 0.9)) return false;
    const shape = normalizeStroke(pts);
    return D_STROKES.some((tpl) => strokeDistance(shape, tpl) < (touch ? 0.2 : 0.17));
  }

  /* Whether a screen point is over the logo's d (where a traced d counts), with a finger's margin. */
  overLetterD(x, y) {
    if (!this.arranged || this.night) return false;
    const box = this.letterD();
    const pad = Math.min(this.w, this.h) * 0.08;
    return x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad;
  }

  toggleNight() {
    if (!this.night) {
      if (!this.logoBox || !this.flowers.length) return;
      if (this.view) this.resetView(true);
      this.skyTime = this.skyNow();
      this.buildSky();
      this.night = { t: 0, dir: 1, since: 0, nextShoot: 3 + Math.random() * 4 };
      this.skyView = { z: 1, tz: 1, ax: 0, ay: 0, tax: 0, tay: 0 };
      this.classList.add('is-night');
    } else {
      this.night.dir = -this.night.dir;
    }
    this.start();
  }

  endNight() {
    this.night = null;
    this.skyView = null;
    if (this.renderer && this.rsNow !== this.rs) this.applyScale(this.rs);
    this.classList.remove('is-night');
    document.documentElement.classList.remove('garden-night');
    if (this.sky) this.sky.group.visible = false;
    this.renderer.setClearColor(0x000000, 0);
    this.camera.fov = FOV;
    this.camera.updateProjectionMatrix();
    this.applyDayLight();
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.near = this.camDist + 30;
    this.scene.fog.far = this.camDist + 320;
  }

  /* ---------------- explore ---------------- */

  /*
   * Exploring the whole garden in the first person (opened by
   * assets/pollen-dream.js, which reads the controls): the bed in its logo
   * on the land, and overhead the sky of the sky view, all at once, at the
   * visitor's time of day, with the bee, the weather, the planes, the
   * blimp, the birds, the sun and the moon carrying on as usual.
   *
   * The visitor (this.explorer) moves in a mode: 'walk', the default, on
   * foot across the fields with gravity and a jump; 'fly', free flight up
   * to the clouds. A mode is a function in EXPLORE_MODES that moves the
   * visitor each frame from explorer.input, so new ways of moving slot in
   * beside them. Functions in this.exploreHooks run every frame after the
   * move (hook(dt, explorer, garden)): the place for things to find and do.
   * Only the splash's own formed garden can be explored.
   */
  canExplore() {
    return !!(this.renderer && !this.failed && !this.backdrop && !this.background && this.arranged && this.logoBox && this.flowers.length && this.camBase);
  }

  startExplore(mode = 'walk') {
    if (this.explorer) return true;
    if (!this.canExplore()) return false;
    if (this.view) this.resetView(true);
    if (!this.night) {
      this.skyTime = this.skyNow();
      this.buildSky();
      this.night = { t: 1, dir: 1, since: 0, nextShoot: 3 + Math.random() * 4 };
    }
    Object.assign(this.night, { t: 1, dir: 1 });
    this.skyView = { z: 1, tz: 1, ax: 0, ay: 0, tax: 0, tay: 0 };
    // The land: hills rolling away from the bed, meadow, grass (see buildLand).
    if (!this.terrain) this.buildLand();
    this.dressLand();
    this.terrain.group.visible = true;
    const b = this.camBase;
    // Where the walk begins: on the grass just below the logo, facing it.
    const box = this.logoBox;
    const sx = box.x + box.w / 2;
    const sy = this.h - (box.y + box.h) - Math.max(this.w, this.h) * 0.22;
    // Eye height: a phone's flowers are slighter on the same stems, so the visitor stands a little taller among them.
    const eye = EYE * Math.sqrt(clamp(23 / (this.base || 23), 1, 1.6));
    this.explorer = {
      mode: EXPLORE_MODES[mode] ? mode : 'walk',
      eye,
      x: b.x,
      y: b.y,
      z: b.z,
      yaw: 0,
      pitch: -Math.PI / 2 + 1e-3,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: false,
      stride: 0,
      bob: 0,
      intro: 0,
      from: b.clone(),
      to: { x: sx, y: sy, z: FLOOR_Z + this.hillAt(sx, sy) + eye, pitch: -0.12 },
      aim: null,
      input: { f: 0, r: 0, turn: 0, up: 0, jump: false, run: false },
    };
    this.exploreHooks = this.exploreHooks || [];
    this.camera.rotation.order = 'ZXY';
    Object.assign(this.pointer, { down: false, active: false });
    this.classList.add('is-exploring');
    this.start();
    return true;
  }

  /* Switches how the visitor moves ('walk' or 'fly'); flying down to the ground lands on foot. */
  setExploreMode(mode) {
    const E = this.explorer;
    if (!E || !EXPLORE_MODES[mode] || E.mode === mode) return;
    E.mode = mode;
    E.grounded = false;
  }

  /*
   * The land around the garden while exploring. Past the bed the ground rolls
   * away into low hills, meadow-colored in patches; grass grows everywhere
   * (a field of clumps around the visitor that comes with them, so it never
   * ends), swaying in the wind, with now and then a tiny wildflower. The
   * season colors it: fresh in spring, rich in summer, gold in autumn,
   * frosted in winter. Everything fades into the air with distance.
   */
  buildLand() {
    const span = Math.max(this.w, this.h);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const u = {
      uCam: { value: new THREE.Vector2() },
      uNear: { value: 2000 },
      uFar: { value: 8000 },
      uAir: { value: new THREE.Color() },
      uCenter: { value: new THREE.Vector2(this.w / 2, this.h / 2) },
      uFlat: { value: span * 1.1 },
      uAmp: { value: span * 0.45 },
      uS: { value: 1 / span },
      uFloor: { value: FLOOR_Z },
      uSoilC: { value: new THREE.Color() },
      uMeadow: { value: new THREE.Color() },
      uGrassBase: { value: new THREE.Color() },
      uGrassTip: { value: new THREE.Color() },
      uR: { value: 1400 },
      uTime: { value: 0 },
      uWind: { value: 0 },
    };
    const HILL = `
uniform vec2 uCenter; uniform float uFlat; uniform float uAmp; uniform float uS; uniform float uFloor;
uniform vec2 uCam; uniform float uNear; uniform float uFar; uniform vec3 uAir;
float hillAt(vec2 p) {
  float amp = smoothstep(uFlat, uFlat * 3.0, length(p - uCenter)) * uAmp;
  vec2 q = p * uS;
  float h = sin(q.x * 0.8 + 1.3) * cos(q.y * 0.65 - 0.7) + 0.5 * sin((q.x + q.y) * 1.4 + 2.1) + 0.25 * cos(q.x * 2.9 - q.y * 2.3);
  return amp * (h * 0.5 + 0.35);
}
`;
    const FADE = '#include <dithering_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uAir, smoothstep(uNear, uFar, distance(vGroundXY, uCam)));';

    // The ground: flat under the bed, hills beyond, faceted like everything else.
    const groundGeo = new THREE.PlaneGeometry(span * 70, span * 70, touch ? 160 : 240, touch ? 160 : 240);
    const groundMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 3, specular: 0x0a0a0a, flatShading: true, fog: false });
    groundMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', HILL + 'varying vec2 vGroundXY;\nvarying float vHill;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vec2 gW = (modelMatrix * vec4(transformed, 1.0)).xy;\n  float gHill = hillAt(gW);\n  transformed.z += gHill;\n  vGroundXY = gW;\n  vHill = gHill / max(uAmp, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec2 uCam; uniform float uNear; uniform float uFar; uniform vec3 uAir; uniform float uS;\nuniform vec3 uSoilC; uniform vec3 uMeadow;\nvarying vec2 vGroundXY;\nvarying float vHill;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n  vec2 gq = vGroundXY * uS;\n  float gn = sin(gq.x * 1.9 + 0.4 + sin(gq.y * 1.3)) * sin(gq.y * 1.6 - 1.1 + sin(gq.x * 1.1)) + 0.4 * sin(gq.x * 3.3 - gq.y * 2.6 + 2.0 * sin(gq.y * 0.9 + gq.x * 0.4));\n  diffuseColor.rgb = mix(uSoilC, uMeadow, clamp(0.55 + 0.22 * gn + 0.45 * vHill, 0.0, 1.0));'
        )
        .replace('#include <dithering_fragment>', FADE);
    };
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.renderOrder = -2;

    // Grass: clumps of three blades, laid out over a square around the visitor that wraps as they move.
    const N = touch ? 12000 : 24000;
    const blade = { pos: [], blade: [], idx: [] };
    const T = [0, 0.35, 0.7, 1];
    const Wd = [1, 0.75, 0.45, 0];
    for (let k = 0; k < 3; k++) {
      const first = blade.pos.length / 3;
      const ang = k * 2.1 + Math.random() * 0.8;
      const ox = (Math.random() - 0.5) * 7;
      const oy = (Math.random() - 0.5) * 7;
      const hf = k === 0 ? 1.2 : 0.7 + Math.random() * 0.35;
      for (let j = 0; j < 4; j++) {
        if (j < 3) {
          blade.pos.push(-Wd[j] * 0.5, T[j], ang, Wd[j] * 0.5, T[j], ang);
          blade.blade.push(ox, oy, hf, k === 0 ? 1 : 0, ox, oy, hf, k === 0 ? 1 : 0);
        } else {
          blade.pos.push(0, 1, ang);
          blade.blade.push(ox, oy, hf, k === 0 ? 1 : 0);
        }
      }
      const v = (i) => first + i;
      blade.idx.push(v(0), v(1), v(2), v(1), v(3), v(2), v(2), v(3), v(4), v(3), v(5), v(4), v(4), v(5), v(6));
    }
    const grassGeo = new THREE.InstancedBufferGeometry();
    grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(blade.pos, 3));
    grassGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(blade.pos.length).fill(0), 3));
    grassGeo.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade.blade, 4));
    grassGeo.setIndex(blade.idx);
    const R = u.uR.value;
    const aPos = new Float32Array(N * 2);
    const aRnd = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      aPos[i * 2] = (Math.random() * 2 - 1) * R;
      aPos[i * 2 + 1] = (Math.random() * 2 - 1) * R;
      aRnd[i * 4] = Math.random() * TAU;
      aRnd[i * 4 + 1] = 3 + Math.random() * 2.5;
      aRnd[i * 4 + 2] = 13 + Math.random() * 17;
      aRnd[i * 4 + 3] = Math.random();
    }
    grassGeo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 2));
    grassGeo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
    grassGeo.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4));
    grassGeo.instanceCount = N;
    const grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
    grassMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          HILL +
            'attribute vec2 aPos; attribute vec4 aRnd; attribute vec4 aCol; attribute vec4 aBlade;\nuniform float uR; uniform float uTime; uniform float uWind; uniform vec3 uGrassBase; uniform vec3 uGrassTip;\nvarying vec2 vGroundXY;\nvarying vec3 vGrass;\nvoid main() {'
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 0.0, 1.0);')
        .replace(
          '#include <begin_vertex>',
          [
            'vec2 gBase = uCam + mod(aPos - uCam + uR, 2.0 * uR) - uR;',
            'float gFade = 1.0 - smoothstep(uR * 0.5, uR * 0.95, distance(gBase, uCam));',
            'float gc = cos(aRnd.x); float gs = sin(aRnd.x);',
            'vec2 gOff = vec2(aBlade.x * gc - aBlade.y * gs, aBlade.x * gs + aBlade.y * gc);',
            'float gRot = aRnd.x + position.z;',
            'vec2 gAcross = vec2(cos(gRot), sin(gRot));',
            'vec2 gLean = vec2(-gAcross.y, gAcross.x);',
            'float gT = position.y;',
            'float gH = aRnd.z * aBlade.z * gFade;',
            'float gSway = sin(uTime * (1.3 + aRnd.w) + gBase.x * 0.006 + gBase.y * 0.004) * 0.3 + uWind;',
            'vec2 gp = gBase + gOff + gAcross * position.x * aRnd.y * gFade + (gLean * 0.3 + vec2(gSway, gSway * 0.3)) * gT * gT * gH;',
            'vec3 transformed = vec3(gp, uFloor + hillAt(gBase) - 1.0 + gT * gH);',
            'vGroundXY = gp;',
            'vec3 gTip = (aCol.w > 0.5 && aBlade.w > 0.5) ? aCol.rgb : uGrassTip * (0.8 + 0.4 * aRnd.w);',
            'vGrass = mix(uGrassBase, gTip, (aCol.w > 0.5 && aBlade.w > 0.5) ? smoothstep(0.6, 1.0, gT) : gT);',
          ].join('\n  ')
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec2 uCam; uniform float uNear; uniform float uFar; uniform vec3 uAir;\nvarying vec2 vGroundXY;\nvarying vec3 vGrass;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = vGrass;')
        // Both sides of a blade lit alike.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);')
        .replace('#include <dithering_fragment>', FADE);
    };
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.frustumCulled = false;
    const group = new THREE.Group();
    group.add(ground, grass);
    group.visible = false;
    this.scene.add(group);
    this.terrain = { group, ground, grass, u, N, parts: [groundGeo, groundMat, grassGeo, grassMat] };
  }

  /* The land's colors for this garden and season, and where it sits under the bed. */
  dressLand() {
    const L = this.terrain;
    const u = L.u;
    const span = Math.max(this.w, this.h);
    u.uCenter.value.set(this.w / 2, this.h / 2);
    u.uFlat.value = span * 1.1;
    u.uAmp.value = span * 0.45;
    u.uS.value = 1 / span;
    L.ground.position.set(this.w / 2, this.h / 2, FLOOR_Z - 1);
    const season = (this.seasonNow && this.seasonNow.name) || this.season().name;
    const look = {
      spring: { tip: [150, 206, 118], base: [30, 66, 46], meadow: [58, 112, 66], soil: [28, 52, 42], blooms: 0.09 },
      summer: { tip: [128, 184, 84], base: [26, 60, 38], meadow: [52, 100, 54], soil: [26, 48, 36], blooms: 0.05 },
      autumn: { tip: [204, 164, 82], base: [70, 66, 36], meadow: [120, 104, 56], soil: [62, 50, 34], blooms: 0.012 },
      winter: { tip: [214, 224, 236], base: [74, 96, 98], meadow: [206, 216, 230], soil: [150, 164, 184], blooms: 0 },
    }[season] || null;
    const k = look || { tip: [128, 184, 84], base: [26, 60, 38], meadow: [52, 100, 54], soil: [26, 48, 36], blooms: 0.05 };
    // A touch of the garden's own foliage and soil in all of it, so the land belongs with the flowers.
    u.uGrassTip.value.copy(toColor(mix(k.tip, this.foliage, 0.25)));
    u.uGrassBase.value.copy(toColor(mix(k.base, this.foliage, 0.15)));
    u.uMeadow.value.copy(toColor(mix(k.meadow, this.foliage, 0.15)));
    u.uSoilC.value.copy(toColor(mix(k.soil, this.soil, 0.3)));
    // Wildflowers: a few clumps carry a tiny bloom in the garden's colors.
    const col = L.grass.geometry.attributes.aCol;
    const c = new THREE.Color();
    for (let i = 0; i < L.N; i++) {
      if (Math.random() < k.blooms) {
        c.copy(toColor(pick(Math.random, this.palette)));
        col.setXYZW(i, c.r, c.g, c.b, 1);
      } else col.setXYZW(i, 0, 0, 0, 0);
    }
    col.needsUpdate = true;
  }

  /* The height of the land at (x, y), as the ground's shader works it out. */
  hillAt(x, y) {
    const L = this.terrain;
    if (!L) return 0;
    const u = L.u;
    const d = Math.hypot(x - u.uCenter.value.x, y - u.uCenter.value.y);
    const e = clamp((d - u.uFlat.value) / (u.uFlat.value * 2), 0, 1);
    const amp = e * e * (3 - 2 * e) * u.uAmp.value;
    const qx = x * u.uS.value;
    const qy = y * u.uS.value;
    const h = Math.sin(qx * 0.8 + 1.3) * Math.cos(qy * 0.65 - 0.7) + 0.5 * Math.sin((qx + qy) * 1.4 + 2.1) + 0.25 * Math.cos(qx * 2.9 - qy * 2.3);
    return amp * (h * 0.5 + 0.35);
  }

  stopExplore() {
    if (!this.explorer) return;
    this.explorer = null;
    if (this.terrain) this.terrain.group.visible = false;
    this.classList.remove('is-exploring');
    const c = this.camera;
    c.rotation.order = 'XYZ';
    c.near = 10;
    c.far = 5000;
    c.aspect = this.w / this.h;
    this.renderer.setSize(this.w, this.h, false);
    this.endNight();
    c.position.copy(this.camBase);
    c.lookAt(this.w / 2, this.h / 2, 0);
    this.viewDirty = true;
    this.start();
  }

  /* Turns the view by dx across and dy up and down, in radians: all the way round, and up and down to straight overhead and underfoot. */
  exploreLook(dx, dy) {
    const E = this.explorer;
    if (!E || E.intro < 1) return;
    E.yaw -= dx;
    E.pitch = clamp(E.pitch - dy, -LOOK_LIMIT, LOOK_LIMIT);
  }

  /* Points the view at (yaw, pitch), eased (the phone's own movement steers this way); null lets go. */
  exploreAim(yaw, pitch) {
    const E = this.explorer;
    if (!E) return;
    E.aim = yaw === null ? null : { yaw, pitch: clamp(pitch, -LOOK_LIMIT, LOOK_LIMIT) };
  }

  updateExplore(dt) {
    const E = this.explorer;
    const c = this.camera;
    const span = Math.max(this.w, this.h);
    if (E.intro < 1) {
      // From the page's own view straight down on the logo, gliding down to stand in the grass before it.
      E.intro = Math.min(1, E.intro + dt / (this.reduced ? 0.05 : 3.2));
      const e = smooth(E.intro);
      const drop = smooth(smooth(E.intro));
      E.x = lerp(E.from.x, E.to.x, e);
      E.y = lerp(E.from.y, E.to.y, e);
      E.z = lerp(E.from.z, E.to.z, drop);
      E.pitch = lerp(-Math.PI / 2 + 1e-3, E.to.pitch, e);
      if (E.intro >= 1) E.grounded = E.mode === 'walk';
    } else {
      if (E.aim) {
        // Eased the short way round toward where the phone points.
        const k = 1 - Math.exp(-dt * 18);
        E.yaw += Math.atan2(Math.sin(E.aim.yaw - E.yaw), Math.cos(E.aim.yaw - E.yaw)) * k;
        E.pitch += (E.aim.pitch - E.pitch) * k;
      }
      E.yaw -= E.input.turn * 2 * dt;
      EXPLORE_MODES[E.mode](this, E, dt, span);
      // Out past the edge of the land the air turns the visitor gently back.
      const ox = E.x - this.w / 2;
      const oy = E.y - this.h / 2;
      const d = Math.hypot(ox, oy);
      const R = span * 18;
      if (d > R) {
        const back = (d - R) * (1 - Math.exp(-dt * 2));
        E.x -= (ox / d) * back;
        E.y -= (oy / d) * back;
      }
      for (const hook of this.exploreHooks) hook(dt, E, this);
    }
    c.position.set(E.x, E.y, E.z + E.bob);
    c.rotation.set(Math.PI / 2 + E.pitch, 0, E.yaw);
    c.fov = lerp(FOV, E.mode === 'walk' ? 75 : 72, smooth(E.intro));
    c.near = 2;
    c.far = 400000;
    c.updateProjectionMatrix();
    // Far off, everything fades into the color of the air. The soil fades sooner, by its distance
    // from the visitor across the ground, so it never ends in a line against the sky (and the
    // clouds overhead stay clear). Higher up, the haze lies farther off.
    this.scene.fog.near = span * 2.5;
    this.scene.fog.far = span * 60;
    const L = this.terrain;
    if (L) {
      const u = L.u;
      u.uCam.value.set(E.x, E.y);
      u.uNear.value = span * 0.9 + Math.max(0, E.z) * 2;
      u.uFar.value = span * 3.5 + Math.max(0, E.z) * 10;
      // Mixed in after the shaders' own conversion for the screen, so converted the same way.
      u.uAir.value.copy(this.scene.fog.color).convertLinearToSRGB();
      u.uTime.value = this.elapsed;
      u.uWind.value = clamp((this.weather ? this.weather.wind : 10) / 120, -0.6, 0.6) + (this.gust ? this.gust.dir * 0.25 * this.gust.strength : 0);
      // Grass only matters near the ground.
      L.grass.visible = E.z - FLOOR_Z - this.hillAt(E.x, E.y) < 1400;
    }
  }

  /* A clearing in the logo to lie down in: flowers close all round, none right overhead. */
  clearing() {
    const b = this.logoBox;
    const step = Math.max(10, this.base * 0.6);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let best = null;
    let bestScore = Infinity;
    for (let y = b.y; y <= b.y + b.h; y += step) {
      for (let x = b.x; x <= b.x + b.w; x += step) {
        let near = Infinity;
        for (const f of this.flowers) near = Math.min(near, Math.hypot(f.dest[0] - x, f.dest[1] - y) - f.r * f.g);
        if (near < this.base * 0.35 || near > this.base * 1.8) continue;
        const score = Math.hypot(x - cx, y - cy) - near * 2;
        if (score < bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
    return best || [cx, b.y + b.h + this.base];
  }

  /*
   * The sky overhead at the visitor's own time of day (or the one chosen in
   * the theme editor): light 0 at night to 1 by day, and warm, the glow of
   * sunrise or sunset, peaking as the sun is low.
   */
  skyNow() {
    const fixed = { day: [1, 0], sunrise: [0.6, 1], sunset: [0.55, 1], night: [0, 0] }[this.skySetting];
    let light;
    let warm;
    let evening;
    if (fixed) {
      [light, warm] = fixed;
      evening = this.skySetting === 'sunset';
    } else {
      const now = new Date();
      const h = now.getHours() + now.getMinutes() / 60;
      light = smooth(range(h, 5.5, 8)) * (1 - smooth(range(h, 17.5, 20.5)));
      const bump = (c, w) => Math.max(0, 1 - Math.abs(h - c) / w);
      warm = Math.max(bump(6.8, 1.6), bump(19.2, 1.8));
      evening = h > 12;
    }
    return { light, warm, evening, clouds: light >= 0.4, dark: light < 0.4 };
  }

  /*
   * Four puffs of cumulus, side by side in one texture (2 x 2): each a heap
   * of round bumps over a flat base, never the same twice. Shaded for body:
   * the heap's height is its density, lit from the upper left, so the slopes
   * toward the sun are bright and the far slopes, the base and the folds
   * between bumps fall into blue-grey. In the PS1 style the texels are
   * chunky and the shading stepped with the ordered dither.
   */
  cloudAtlas() {
    const rng = mulberry32(7919);
    const shapes = [0, 1, 2, 3].map(() => {
      const blobs = [[0.5, 0.42, 0.25 + rng() * 0.04]];
      const bumps = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < bumps; i++) {
        const a = Math.PI * (0.08 + (0.84 * (i + rng() * 0.6)) / bumps);
        const d = 0.17 + rng() * 0.08;
        blobs.push([0.5 + Math.cos(a) * d * 1.15, 0.42 + Math.sin(a) * d, 0.11 + rng() * 0.09]);
      }
      // A couple of small turrets on top.
      for (let i = 0; i < 2; i++) blobs.push([0.38 + rng() * 0.24, 0.66 + rng() * 0.08, 0.07 + rng() * 0.05]);
      return blobs;
    });
    const alphaOf = (blobs) => (u, v) => {
      let clear = 1;
      for (const [x, y, r] of blobs) {
        const t = Math.hypot(u - x, v - y) / r;
        if (t < 1) clear *= 1 - (t < 0.55 ? 0.95 : 0.95 * (1 - (t - 0.55) / 0.45));
      }
      // The base is flatter, as cumulus sit on a level.
      return (1 - clear) * smooth(clamp((v - 0.16) / 0.14, 0, 1));
    };
    const light = [-0.5, 0.6, 0.62];
    const dark = [0.42, 0.47, 0.66];
    const e = 1 / 80;
    const shadeOf = (alpha) => {
      const height = (u, v) => smooth(clamp(alpha(u, v) * 1.3, 0, 1));
      return (u, v) => {
        const dx = (height(u + e, v) - height(u - e, v)) / (2 * e);
        const dy = (height(u, v + e) - height(u, v - e)) / (2 * e);
        const nx = -dx * 0.4;
        const ny = -dy * 0.4;
        const diffuse = Math.max(0, (nx * light[0] + ny * light[1] + light[2]) / Math.hypot(nx, ny, 1));
        const k = clamp(-0.1 + diffuse * 0.9 + (v - 0.45) * 0.7 + (height(u, v) - 0.5) * 0.25, 0, 1);
        return mix(dark, [1, 1, 1], k);
      };
    };
    const n = this.ps1 ? 48 : 96;
    const cells = shapes.map((blobs) => {
      const alpha = alphaOf(blobs);
      return { alpha, shade: shadeOf(alpha) };
    });
    // One texture, 2n square: cell k at column k % 2, row k / 2.
    return alphaTexture(n * 2, (u, v) => {
      const cx = Math.min(1, Math.floor(u * 2));
      const cy = Math.min(1, Math.floor(v * 2));
      return cells[cy * 2 + cx].alpha(u * 2 - cx, v * 2 - cy);
    }, this.ps1 ? 8 : 0, (u, v) => {
      const cx = Math.min(1, Math.floor(u * 2));
      const cy = Math.min(1, Math.floor(v * 2));
      return cells[cy * 2 + cx].shade(u * 2 - cx, v * 2 - cy);
    });
  }

  /*
   * Points drawn as puffs from the atlas, each with its own size (CSS
   * pixels), shape (0-3), turn, color and transparency: clouds and contrails.
   */
  puffPoints(n, map, group, disposables) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('variant', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('rot', new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uZoom: { value: 1 }, uScale: { value: 1 }, uOpacity: { value: 1 }, uDither: this.dither },
      vertexShader: `
        attribute vec3 color;
        attribute float size;
        attribute float alpha;
        attribute float variant;
        attribute float rot;
        uniform float uZoom;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vVariant;
        varying float vRot;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vVariant = variant;
          vRot = rot;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uZoom * uScale;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vVariant;
        varying float vRot;
        ${DITHER_GLSL}
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot);
          float s = sin(vRot);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
          if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
          vec2 cell = vec2(mod(vVariant, 2.0), floor(vVariant / 2.0));
          vec4 t = texture2D(map, (clamp(vec2(p.x, 1.0 - p.y), 0.02, 0.98) + cell) * 0.5);
          float a = t.a * vAlpha * uOpacity;
          // PS1 style: the fade is an ordered dither, in white.
          if (uDither > 0.5) {
            ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
            a = floor(a * 6.0 + BAYER[q.y * 4 + q.x] / 16.0) / 6.0;
          }
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb * vColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -1;
    pts.count = n;
    group.add(pts);
    disposables.push(geo, mat);
    return pts;
  }

  /* Writes one puff's look (its position is set each frame). */
  setPuff(pts, i, size, alpha, variant, rot, col) {
    const g = pts.geometry.attributes;
    g.size.setX(i, size);
    g.alpha.setX(i, alpha);
    g.variant.setX(i, variant);
    g.rot.setX(i, rot);
    if (col) {
      const lin = toColor(col);
      g.color.setXYZ(i, lin.r, lin.g, lin.b);
    }
  }

  /* A round glow: bright in the middle, fading to nothing at the edge. */
  glowTexture() {
    return alphaTexture(32, (u, v) => {
      const t = Math.hypot(u - 0.5, v - 0.5) / 0.5;
      return t < 0.3 ? 1 - (t / 0.3) * 0.3 : t < 1 ? 0.7 * (1 - (t - 0.3) / 0.7) : 0;
    }, 0);
  }

  /* The sky and its stars, laid out for this screen and this clearing. */
  buildSky() {
    if (this.sky) {
      this.scene.remove(this.sky.group);
      this.sky.disposables.forEach((d) => d.dispose());
    }
    const group = new THREE.Group();
    const disposables = [];
    const tex = this.glowTexture();
    const atlas = this.cloudAtlas();
    disposables.push(tex, atlas);
    const time = this.skyTime || this.skyNow();
    // Sunlit clouds by day; at sunrise and sunset they take the sky's glow.
    const cloudLit = mix(WHITE, time.evening ? [255, 168, 150] : [255, 196, 160], time.warm * 0.75);
    const cloudShade = mix(mix([196, 210, 232], [150, 120, 170], time.warm * 0.6), [70, 80, 120], 1 - time.light);
    const [gx, gy] = this.clearing();
    // Lying just above the flower heads, looking straight up: nothing but sky in view.
    const top = this.flowers.reduce((m, f) => Math.max(m, f.z + f.r * 0.6), 0);
    const eye = new THREE.Vector3(gx, this.h - gy, top + 30);
    const fov = 72;
    const D = 2600;
    const viewW = 2 * D * Math.tan((fov * Math.PI) / 360) * (this.w / this.h);
    const viewH = 2 * D * Math.tan((fov * Math.PI) / 360);
    const b = this.logoBox;
    const S = Math.min((0.62 * viewW) / b.w, (0.45 * viewH) / b.h);
    const lcx = b.x + b.w / 2;
    const lcy = b.y + b.h / 2;
    // Looking up with the view turned over, screen right is +x and screen up is -y.
    const skyPoint = (sx, sy, z) => new THREE.Vector3(eye.x + (sx - lcx) * S, eye.y + (sy - lcy) * S, eye.z + z);

    const points = (n, size) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      // Sizes in screen pixels (three scales them by the pixel ratio).
      // PS1 style: hard square pixels; smooth style: soft round glows.
      const mat = new THREE.PointsMaterial({ size: this.ps1 ? Math.max(1, Math.round(size * 0.25)) / (this.rs || 1) : size, sizeAttenuation: false, map: this.ps1 ? null : tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = -1;
      group.add(pts);
      disposables.push(geo, mat);
      return pts;
    };

    // One white star for each flower (by day, a little cumulus), starting scattered across the sky.
    const logo = this.flowers.map((f, i) => {
      const to = skyPoint(f.dest[0], f.dest[1], D);
      const from = new THREE.Vector3(eye.x + (Math.random() - 0.5) * viewW * 1.1, eye.y + (Math.random() - 0.5) * viewH * 1.1, eye.z + D);
      return { from, to, col: WHITE, delay: 0.3 + ((f.dest[0] - b.x) / b.w) * 1.2 + Math.random() * 0.4, tw: 1.5 + Math.random() * 3, ph: Math.random() * TAU, i };
    });
    const pxPerUnit = (S * this.w) / viewW;
    const logoPts = time.clouds ? null : points(logo.length, 8);
    // Low-poly clouds seen from straight below: lumpy lobes of flat-shaded
    // facets in blue-grey to periwinkle, their flat bases toward the viewer
    // (who is toward -z). The sun is above the clouds, so the thick middle of
    // a base is a deeper blue-grey and its thin edges let the light through,
    // the same all round: nothing reads as a top or a bottom. The light is
    // baked into each facet's color, and three lobe shapes are turned and
    // stretched so no two clouds match.
    const cloudMat = time.light > 0.2 ? new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }) : null;
    if (cloudMat) disposables.push(cloudMat);
    const lobe = (seed, detail) => {
      const rng = mulberry32(seed);
      const geo = new THREE.IcosahedronGeometry(1, detail);
      const pos = geo.attributes.position;
      // Every corner moved a little, the same way wherever faces share it.
      const moved = new Map();
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
        if (!moved.has(key)) {
          const k = 1 + (rng() - 0.5) * 0.36;
          const w = v.clone().multiplyScalar(k);
          // A flat base, facing the viewer below.
          w.z = Math.max(w.z, -0.45);
          moved.set(key, w);
        }
        const w = moved.get(key);
        pos.setXYZ(i, w.x, w.y, w.z);
      }
      // Each facet one color: the base (facing straight down at the viewer)
      // deepest, the facets turning toward the edge lighter, with a little
      // variety facet to facet.
      const lit = mix([238, 242, 252], cloudLit, time.warm * 0.6);
      const mid = mix([196, 207, 232], [214, 168, 184], time.warm * 0.55);
      const dark = mix([160, 174, 208], [160, 122, 168], time.warm * 0.55);
      const a = new THREE.Vector3();
      const b2 = new THREE.Vector3();
      const c = new THREE.Vector3();
      const cols = [];
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b2.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        const nrm = b2.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const k = clamp(0.32 + (1 - Math.abs(nrm.z)) * 0.75 + (rng() - 0.5) * 0.14, 0, 1);
        const col = toColor(k < 0.5 ? mix(dark, mid, k / 0.5) : mix(mid, lit, (k - 0.5) / 0.5));
        for (let j = 0; j < 3; j++) cols.push(col.r, col.g, col.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      disposables.push(geo);
      return geo;
    };
    // A set of instanced meshes, one per lobe shape; each lobe goes in one of them.
    const lobeSet = (detail, items, seedBase) => {
      const counts = [0, 0, 0];
      for (const q of items) {
        q.v = (Math.random() * 3) | 0;
        q.slot = counts[q.v]++;
      }
      return counts.map((n, k) => {
        if (!n) return null;
        const m = new THREE.InstancedMesh(lobe(seedBase + k * 101, detail), cloudMat, n);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        group.add(m);
        return m;
      });
    };
    const puffs = [];
    let logoPuffs = null;
    if (time.clouds) {
      const R = this.base * S;
      logo.forEach((s, i) => {
        // One lumpy lobe per flower, and now and then a smaller one on its sunny side.
        puffs.push({ flower: i, off: new THREE.Vector3(0, 0, 0), r: R * (1.3 + Math.random() * 0.25), sq: [1.1, 1, 0.55], rot: Math.random() * TAU });
        if (Math.random() < 0.45) {
          const a = Math.random() * TAU;
          puffs.push({ flower: i, off: new THREE.Vector3(Math.cos(a) * 0.55 * R, Math.sin(a) * 0.55 * R, 0.2 * R), r: R * (0.65 + Math.random() * 0.2), sq: [1, 1, 0.55], rot: Math.random() * TAU });
        }
      });
      logoPuffs = lobeSet(1, puffs, 11);
    }

    // By day, clouds drifting across the sky, each like the reference: a
    // big squat lobe, a smaller one beside it, and a flat slab along the
    // base. Two layers: nearer clouds, and smaller, bluer ones higher up
    // that move slower. A few big ones sit around the logo at first: the
    // logo's little clouds come out of them, and they drift on afterwards.
    const drift = [];
    const heaps = [];
    if (time.light > 0.2) {
      const unit = viewW / this.w; // world units per CSS pixel at the clouds' depth, near enough
      const heap = (cx, cy, big, depth, far, source) => {
        const z = eye.z + D * depth;
        const rb = big * 0.5 * unit * depth;
        const first = drift.length;
        const add = (x, y, dz, r, sq) => drift.push({ p: new THREE.Vector3(x, y, z + dz), r, sq, rot: Math.random() * TAU, speed: far ? 0.55 : 1, far });
        // Seen from below, a cloud is spread out flat: a big main lobe, and
        // smaller ones around it in any direction, all with their bases toward us.
        const along = Math.random() * TAU;
        add(cx, cy, 0, rb * (1.05 + Math.random() * 0.2), [1.35, 1.05, 0.5]);
        const more = 2 + Math.floor(Math.random() * 3) + (source ? 1 : 0);
        for (let j = 0; j < more; j++) {
          // Mostly strung out along one direction, the way clouds stretch in the wind.
          const a = along + (j % 2 ? Math.PI : 0) + (Math.random() - 0.5) * 1.6;
          const d = rb * (0.9 + Math.random() * 0.6);
          add(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, rb * 0.1, rb * (0.5 + Math.random() * 0.3), [1.2, 1, 0.5]);
        }
        const h = { cx, cy, z, rx: rb * 1.4, ry: rb * 1.1, speed: far ? 0.55 : 1, first, last: drift.length, source, far, scale: 0.5 * unit * depth };
        heaps.push(h);
        for (let i = first; i < drift.length; i++) drift[i].cloud = h;
        // A source cloud's own lobes melt away as it becomes the logo.
        if (source) for (let i = first; i < drift.length; i++) drift[i].heap = h;
      };
      // The big clouds the logo comes out of, around it.
      const sources = this.w < 750 ? [[-0.25, -0.36], [0.25, 0.36], [0.22, -0.34]] : [[-0.36, -0.3], [0.34, -0.32], [-0.3, 0.33], [0.35, 0.3]];
      for (const [fx, fy] of sources) heap(eye.x + fx * viewW, eye.y + fy * viewH, clamp(this.w * 0.12, 54, 170), 1.2, false, true);
      this.logoSources = heaps.length;
      // Near clouds, the rest of the sky over.
      for (let k = 0; k < 22; k++) {
        const cx = eye.x + (Math.random() - 0.5) * viewW * 1.8;
        const cy = eye.y + (Math.random() - 0.5) * viewH * 1.7;
        // Away from the logo in the middle.
        if (Math.abs(cx - eye.x) < viewW * 0.34 && Math.abs(cy - eye.y) < viewH * 0.28) continue;
        heap(cx, cy, clamp(this.w * 0.085, 34, 120) * (0.6 + Math.random() * 0.7), 1.2, false, false);
      }
      // Far clouds, higher up.
      for (let k = 0; k < 16; k++) {
        heap(eye.x + (Math.random() - 0.5) * viewW * 2.6, eye.y + (Math.random() - 0.5) * viewH * 2.4, clamp(this.w * 0.065, 30, 90) * (0.7 + Math.random() * 0.5), 1.4, true, false);
      }
    }
    // By day the big clouds around the logo become it. Each is made of the
    // lobes of the part of the logo nearest it, packed into a cloud with
    // their places kept (left stays left, top stays top, loosened a
    // little), so when the time comes the whole mass moves as one: it
    // stretches, bends and flows into the letters.
    if (time.clouds && heaps.length) {
      const sources = heaps.slice(0, this.logoSources || 0);
      for (const h of sources) {
        h.parts = [];
        h.delay = 0.6 + Math.random() * 1.2;
      }
      logo.forEach((s) => {
        let best = sources[0];
        for (const h of sources) if (Math.hypot(h.cx - s.to.x, h.cy - s.to.y) < Math.hypot(best.cx - s.to.x, best.cy - s.to.y)) best = h;
        s.source = best;
        best.parts.push(s);
      });
      for (const h of sources) {
        if (!h.parts.length) continue;
        const xs = h.parts.map((s) => s.to.x);
        const ys = h.parts.map((s) => s.to.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const far = Math.max(...h.parts.map((s) => Math.hypot(s.to.x - h.cx, s.to.y - h.cy)));
        // Where its part of the logo is: the cloud leans and slides that way as it goes.
        h.tx = xs.reduce((a, b) => a + b, 0) / xs.length;
        h.ty = ys.reduce((a, b) => a + b, 0) / ys.length;
        for (const s of h.parts) {
          // Where it sits in its part of the logo, squeezed into the cloud's oval.
          let u = x1 > x0 ? ((s.to.x - x0) / (x1 - x0)) * 2 - 1 : 0;
          let v = y1 > y0 ? ((s.to.y - y0) / (y1 - y0)) * 2 - 1 : 0;
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random());
          u = lerp(u, Math.cos(a) * r, 0.35);
          v = lerp(v, Math.sin(a) * r, 0.35);
          const m = Math.hypot(u, v);
          if (m > 1) {
            u /= m;
            v /= m;
          }
          // Tucked up behind the cloud's base until it moves.
          s.inside = new THREE.Vector3(u * h.rx * 0.8, v * h.ry * 0.8, h.rx * 0.3);
          // The whole cloud goes together; the part that has farthest to go leads a little.
          s.delay = h.delay + (1 - Math.hypot(s.to.x - h.cx, s.to.y - h.cy) / far) * 0.5 + Math.random() * 0.25;
        }
      }
    }
    // Far clouds take on a little of the sky's blue.
    let driftPts = null;
    if (drift.length) {
      driftPts = lobeSet(1, drift, 23);
      const haze = new THREE.Color();
      drift.forEach((c) => driftPts[c.v].setColorAt(c.slot, c.far ? haze.copy(toColor([222, 230, 250])) : haze.setRGB(1, 1, 1)));
      driftPts.forEach((m) => m && m.instanceColor && (m.instanceColor.needsUpdate = true));
    }

    // The far sky: many faint stars, and a few brighter ones grouped in constellations.
    const field = [];
    // Well past the view too, so tipping up to it the stars don't stop at an edge.
    for (let i = 0; i < 2000; i++) {
      const u = Math.random() - 0.5;
      const v = Math.random() - 0.5;
      // Past the view they dim away to nothing, as stars low in a hazy sky do.
      const fade = 1 - smooth(clamp((Math.max(Math.abs(u), Math.abs(v)) * 2.4 - 0.5) / 0.65, 0, 1));
      field.push({
        p: new THREE.Vector3(eye.x + u * viewW * 2.4, eye.y + v * viewH * 2.4, eye.z + D * 1.3),
        col: WHITE.map((c) => c * (0.35 + Math.random() * 0.5) * fade),
        tw: 0.8 + Math.random() * 4,
        ph: Math.random() * TAU,
      });
    }
    for (let k = 0; k < 7; k++) {
      // Around the edges of the view, away from the logo.
      const a = Math.random() * TAU;
      const c = new THREE.Vector3(eye.x + Math.cos(a) * viewW * 0.42, eye.y + Math.sin(a) * viewH * 0.4, eye.z + D * 1.3);
      let prev = null;
      const n = 4 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * viewW * 0.16, (Math.random() - 0.5) * viewH * 0.16, 0));
        field.push({ p, col: WHITE, tw: 0.6 + Math.random(), ph: Math.random() * TAU, bright: true });
        prev = p;
      }
    }
    const fieldPts = points(field.length, 2.6);
    const fp = fieldPts.geometry.attributes.position;
    field.forEach((s, i) => fp.setXYZ(i, s.p.x, s.p.y, s.p.z));
    fp.needsUpdate = true;
    // The sky itself: a coarse grid of colors, all deep navy, with patches a
    // shade lighter or darker, dithered in banded steps the PS1 way.
    // Reaching far past the view, so the camera tipping up never sees its edge:
    // beyond the view it fades into the air color the renderer clears to.
    const skyGeo = new THREE.PlaneGeometry(viewW * 12, viewH * 12, 50, 36);
    const air = skyAir(time);
    const sc = [];
    const sp = skyGeo.attributes.position;
    const blobs = [[14, 22, 72], [3, 5, 22], [10, 18, 60]].map((c) => [c, Math.random() * TAU, 0.2 + Math.random() * 0.25]);
    // Low sun: warm toward one side of the sky, the side the sun is on.
    const sunA = time.evening ? Math.PI * 0.85 : Math.PI * 0.15;
    for (let i = 0; i < sp.count; i++) {
      const u = sp.getX(i) / (viewW * 1.2);
      const v = sp.getY(i) / (viewH * 1.2);
      const mid = Math.max(0, 1 - Math.hypot(u, v) * 0.9);
      let c = mix([2, 3, 14], [7, 11, 38], mid);
      for (const [tint, a, r] of blobs) {
        const d = Math.hypot(u - Math.cos(a) * 0.45, v - Math.sin(a) * 0.4);
        c = mix(c, tint, Math.max(0, 1 - d / r) * 0.55);
      }
      // Day: clear blue, paler toward the middle of the view.
      const day = mix([62, 128, 206], [150, 202, 242], mid);
      c = mix(c, day, time.light);
      // Sunrise and sunset: gold low on the sun's side, through rose, to violet away from it.
      if (time.warm > 0) {
        const toward = 0.5 + 0.5 * (u * Math.cos(sunA) + v * Math.sin(sunA));
        const glow = toward > 0.6 ? mix([255, 120, 140], [255, 196, 120], (toward - 0.6) / 0.4) : mix([84, 64, 140], [255, 120, 140], toward / 0.6);
        c = mix(c, glow, time.warm * 0.85);
      }
      const edge = smooth(clamp((Math.max(Math.abs(u), Math.abs(v)) - 0.85) / 1.6, 0, 1));
      c = mix(c, air, edge);
      // Vertex colors are linear, like everything three.js shades. Out at the edge it
      // thins away too, leaving just the air: no line where it ends.
      const lin = toColor(c);
      sc.push(lin.r, lin.g, lin.b, 1 - edge);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 4));
    // The PS1 dither suits the dark night sky; on a light, smooth sky it breaks
    // into a grid of red, green and blue dots, so a day sky is left smooth.
    const skyBase = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const skyMat = time.clouds ? skyBase : this.snapMaterial(skyBase);
    const skyPlane = new THREE.Mesh(skyGeo, skyMat);
    skyPlane.position.set(eye.x, eye.y, eye.z + D * 1.45);
    skyPlane.renderOrder = -3;
    group.add(skyPlane);
    disposables.push(skyGeo, skyMat);
    const glows = [skyPlane];

    // A shooting star: a short line, bright at its head, fading along its tail.
    const shootGeo = new THREE.BufferGeometry();
    shootGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    shootGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0, 0, 0]), 3));
    const shootMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const shoot = new THREE.Line(shootGeo, shootMat);
    shoot.frustumCulled = false;
    shoot.visible = false;
    group.add(shoot);
    disposables.push(shootGeo, shootMat);

    group.visible = false;
    this.scene.add(group);
    // Things that look back. An eye made for the sky: unlit, so it reads the
    // same by day or night, turned to face down at the one lying below.
    const skyEye = (R, lid, iris) => {
      const grp = new THREE.Group();
      grp.rotation.x = Math.PI;
      const eyeTex = eyeTexture(iris);
      const ballMat = this.snapMaterial(new THREE.MeshBasicMaterial({ map: eyeTex, fog: false }));
      const lidMat = this.snapMaterial(new THREE.MeshBasicMaterial({ color: toColor(lid), side: THREE.DoubleSide, fog: false }));
      const ball = new THREE.Mesh(this.geometries.eye, ballMat);
      const top = new THREE.Mesh(this.geometries.lidTop, lidMat);
      const bottom = new THREE.Mesh(this.geometries.lidBottom, lidMat);
      [ball, top, bottom].forEach((m) => {
        m.scale.setScalar(R);
        m.renderOrder = 1;
      });
      grp.add(ball, top, bottom);
      group.add(grp);
      disposables.push(eyeTex, ballMat, lidMat);
      return { group: grp, ball, top, bottom, R, open: 0, blinkAt: -1, nextBlink: 0 };
    };

    // By day, things live in the clouds: eyes that push out of a puff, look
    // about, and sink back in. Their lids are cloud, so closed they vanish into it.
    const peekR = this.base * S * 0.42;
    const peekers = time.clouds
      ? [0, 1, 2, 3].map(() => {
          const e = skyEye(peekR, mix(cloudShade, cloudLit, 0.75), mix(this.heroColor, [40, 40, 60], 0.2));
          e.group.visible = false;
          return e;
        })
      : [];

    // At night, now and then, lights that don't move the way anything should.
    const orbs = [];
    if (!time.clouds) {
      const sprite = (color, blend) => {
        const m = new THREE.SpriteMaterial({ map: tex, color: toColor(color), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: blend });
        const sp = new THREE.Sprite(m);
        sp.renderOrder = 0;
        sp.visible = false;
        group.add(sp);
        disposables.push(m);
        return sp;
      };
      for (let i = 0; i < 3; i++) {
        orbs.push({
          aura: sprite([150, 255, 214], THREE.AdditiveBlending),
          halo: sprite([150, 255, 214], THREE.AdditiveBlending),
          core: sprite([255, 255, 255], THREE.AdditiveBlending),
          ghosts: Array.from({ length: 7 }, () => sprite([150, 255, 214], THREE.AdditiveBlending)),
          trail: [],
          pos: new THREE.Vector3(),
        });
      }
    }

    this.sky = {
      group, disposables, time, eye, fov, D, viewW, viewH, logo, logoPts, puffs, logoPuffs, cloudMat, fpos: new Float32Array(logo.length * 3), field, fieldPts, drift, driftPts, glows, shoot,
      heaps, planes: this.buildPlanes(group, disposables, atlas, tex, time, D), nextPlane: this.elapsed + 9 + Math.random() * 10,
      birds: this.buildBirds(group, disposables, time), nextBirds: this.elapsed + 7 + Math.random() * 6,
      blimp: time.dark ? this.buildBlimp(group, disposables) : null,
      banner: time.dark ? null : this.buildBanner(group, disposables),
      nextBlimp: this.elapsed + 25 + Math.random() * 35,
      peekers, nextPeek: this.elapsed + 5 + Math.random() * 4, orbs, encounter: null, nextEncounter: this.elapsed + 5 + Math.random() * 15,
      ...this.buildSunAndMoon(group, disposables, tex, eye, D, viewW, viewH, time),
      gaze: new THREE.Vector3(gx, this.h - gy, eye.z + D),
    };
  }

  /*
   * A cloud that has drifted off one side and comes back on the other is a
   * new cloud: a fresh size, a fresh spread of lobes round a big one (some
   * of its lobes left out), a new height in the sky. A cloud the logo came
   * out of becomes an ordinary one.
   */
  reshapeCloud(h, sky) {
    const big = (h.far ? clamp(this.w * 0.065, 30, 90) * (0.7 + Math.random() * 0.5) : clamp(this.w * 0.085, 34, 120) * (0.6 + Math.random() * 0.7)) * (h.source ? 1.2 : 1);
    const rb = big * h.scale;
    h.cy = sky.eye.y + (Math.random() - 0.5) * sky.viewH * (h.far ? 2.4 : 1.7);
    h.rx = rb * 1.4;
    h.ry = rb * 1.1;
    h.source = false;
    const along = Math.random() * TAU;
    for (let i = h.first; i < h.last; i++) {
      const c = sky.drift[i];
      c.heap = null;
      c.rot = Math.random() * TAU;
      if (i === h.first) {
        c.p.set(h.cx, h.cy, h.z);
        c.r = rb * (1.05 + Math.random() * 0.2);
        c.sq = [1.2 + Math.random() * 0.3, 0.95 + Math.random() * 0.2, 0.45 + Math.random() * 0.1];
        continue;
      }
      // Some lobes left out, so clouds differ in how many they have, not only where.
      if (Math.random() < 0.25) {
        c.r = 1e-3;
        continue;
      }
      const a = along + (i % 2 ? Math.PI : 0) + (Math.random() - 0.5) * 1.8;
      const d = rb * (0.8 + Math.random() * 0.8);
      c.p.set(h.cx + Math.cos(a) * d, h.cy + Math.sin(a) * d * (0.6 + Math.random() * 0.4), h.z + rb * 0.1);
      c.r = rb * (0.4 + Math.random() * 0.45);
      c.sq = [1 + Math.random() * 0.4, 0.9 + Math.random() * 0.2, 0.45 + Math.random() * 0.1];
    }
  }

  /* A ball's placement off to the side in the wide sky view, squeezed back across the line of sight so it reads round. */
  roundAt(eye, at) {
    const away = at.clone().sub(eye).normalize();
    const outward = new THREE.Vector3(at.x - eye.x, at.y - eye.y, 0).addScaledVector(away, -(at.x - eye.x) * away.x - (at.y - eye.y) * away.y);
    if (outward.lengthSq() < 1e-8) return new THREE.Matrix4().makeTranslation(at.x, at.y, at.z);
    outward.normalize();
    const across = new THREE.Vector3().crossVectors(away, outward);
    const basis = new THREE.Matrix4().makeBasis(outward, across, away);
    return new THREE.Matrix4()
      .makeTranslation(at.x, at.y, at.z)
      .multiply(basis)
      .multiply(new THREE.Matrix4().makeScale(Math.max(0.45, away.z), 1, 1))
      .multiply(basis.clone().transpose());
  }

  /* A point of the sky view from a place (nx, ny in half view heights from the middle; ny up), at depth k. */
  skyPoint(place, eye, D, viewH, k) {
    return new THREE.Vector3(eye.x + place.nx * viewH * 0.5 * k, eye.y - place.ny * viewH * 0.5 * k, eye.z + D * k);
  }

  /*
   * Where something at altitude alt and azimuth az (degrees; az from north
   * through east) is in the sky view. Lying on your back with your head to
   * the north and looking straight up: the zenith in the middle, north up,
   * east to the left, the horizon a little beyond the edges of the view.
   * Null below the horizon.
   */
  skyPlace(alt, az) {
    if (alt < -1) return null;
    const rad = Math.PI / 180;
    const rn = ((90 - alt) / 90) * 1.25;
    return { nx: -Math.sin(az * rad) * rn, ny: Math.cos(az * rad) * rn };
  }

  /*
   * The sun and the moon where they really are now, for the visitor (their
   * longitude guessed from their time zone, latitude from the hemisphere
   * setting), or, with the sky set to a fixed time of day, where they would
   * be at such a time. Each only when above the horizon.
   */
  buildSunAndMoon(group, disposables, glow, eye, D, viewW, viewH, time) {
    let sunAt;
    let moonAt;
    const fixed = this.skySetting !== 'auto';
    if (!fixed) {
      const now = new Date();
      const lat = this.south ? -33 : 40;
      const lon = -now.getTimezoneOffset() / 4;
      const sp = sunPosition(now, lat, lon);
      const mp = moonPosition(now, lat, lon);
      sunAt = this.skyPlace(sp.alt, sp.az);
      moonAt = this.skyPlace(mp.alt, mp.az);
    } else {
      const s = this.south ? 180 : 0;
      sunAt = { day: this.skyPlace(58, 160 + s), sunrise: this.skyPlace(5, 95), sunset: this.skyPlace(5, 265) }[this.skySetting] || null;
      moonAt = this.skySetting === 'night' ? this.skyPlace(52, 140 + s) : null;
    }
    // The moon only where it can be seen against the sky: not in a bright day sky's glare near the sun.
    const moon = moonAt ? this.buildMoon(group, disposables, glow, eye, D, viewW, viewH, moonAt) : null;
    const sun = sunAt && (time.light > 0.05 || time.warm > 0.05) ? this.buildSun(group, disposables, glow, eye, D, viewW, viewH, sunAt, time) : null;
    return { moon, sun };
  }

  /* The sun: a low-poly ball of light, with a glow and a wide soft wash round it, warmer low in the sky. */
  buildSun(group, disposables, glow, eye, D, viewW, viewH, place, time) {
    const k = 1.42;
    const r = Math.min(viewW, viewH) * 0.045 * k;
    const at = this.skyPoint(place, eye, D, viewH, k);
    const color = mix([255, 246, 214], [255, 170, 96], time.warm);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: toColor(color), transparent: true, opacity: 0, depthWrite: false, fog: false });
    disposables.push(geo, mat);
    const ball = new THREE.Mesh(geo, mat);
    ball.matrixAutoUpdate = false;
    ball.matrix.copy(this.roundAt(eye, at)).multiply(new THREE.Matrix4().makeScale(r, r, r));
    ball.renderOrder = -2;
    group.add(ball);
    const sprite = (scale, tint) => {
      const m = new THREE.SpriteMaterial({ map: glow, color: toColor(tint), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      disposables.push(m);
      const sp = new THREE.Sprite(m);
      sp.position.copy(at);
      sp.position.z += 1;
      sp.scale.setScalar(r * scale);
      sp.renderOrder = -2;
      group.add(sp);
      return sp;
    };
    const halo = sprite(5, mix(color, [255, 255, 255], 0.3));
    const wash = sprite(16, color);
    return { ball, mat, halo, wash };
  }

  /*
   * The moon, in its real phase for today: lit from the right as it waxes
   * and from the left as it wanes (the other way round in the southern
   * hemisphere), the dark part in deep shadow that fades into the sky at
   * its edge. A low-poly ball like the clouds: each flat facet takes one
   * shade, from the sun's angle and the grey of the ground there (darker
   * seas, pale crater rims). Up in a corner of the sky away from the logo,
   * with a faint glow that grows toward full.
   */
  buildMoon(group, disposables, glow, eye, D, viewW, viewH, place) {
    const { age, lit } = lunarPhase(new Date());
    const theta = (age / SYNODIC) * TAU;
    // Where it is in the sky (see skyPlace), behind the logo's stars and in front of the far field.
    const k = 1.2;
    const wide = viewW > viewH;
    const r = Math.min(viewW, viewH) * (wide ? 0.06 : 0.09) * k;
    const at = this.skyPoint(place, eye, D, viewH, k);
    // Lit as the viewer lying below sees it: the sun is behind the moon at new, behind the viewer at full,
    // and off to screen right (+x) as it waxes.
    const toViewer = eye.clone().sub(at).normalize();
    const away = toViewer.clone().negate();
    const right = new THREE.Vector3(1, 0, 0).addScaledVector(away, -away.x).normalize();
    const screenRight = right.clone();
    const screenUp = new THREE.Vector3(0, -1, 0).addScaledVector(away, away.y).normalize();
    const sun = right.multiplyScalar((this.south ? -1 : 1) * Math.sin(theta)).addScaledVector(away, Math.cos(theta)).normalize();
    const rng = mulberry32(1969);
    const dir = () => {
      const d = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      return d.dot(toViewer) < 0.2 ? d.addScaledVector(toViewer, 1.2).normalize() : d;
    };
    const seas = Array.from({ length: 6 }, () => [dir(), 0.25 + rng() * 0.3]);
    const craters = Array.from({ length: 14 }, () => [dir(), 0.08 + rng() * 0.12]);
    // Facets small enough for a round iris, still plainly faceted.
    const geo = new THREE.IcosahedronGeometry(1, 9).toNonIndexed();
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 4);
    // For the eye: how lit each facet is, and which way it faces (its center).
    const litOf = new Float32Array(pos.count);
    const midOf = new Float32Array(pos.count * 3);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const mid = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      mid.copy(a).add(b).add(c).normalize();
      nrm.copy(c).sub(b).cross(a.clone().sub(b)).normalize();
      if (nrm.dot(mid) < 0) nrm.negate();
      // The ground: grey, darker in the seas, crater floors dark and rims pale.
      let g = 0.8 + (rng() - 0.5) * 0.1;
      for (const [d, r] of seas) if (mid.angleTo(d) < r) g -= 0.15;
      for (const [d, r] of craters) {
        const k = mid.angleTo(d) / r;
        if (k < 0.7) g -= 0.1;
        else if (k < 1) g += 0.08;
      }
      const light = smooth(clamp((nrm.dot(sun) + 0.08) / 0.16, 0, 1));
      const day = [0.96, 0.95, 0.88].map((v) => v * (0.55 + 0.55 * g));
      const shade = [0.02, 0.025, 0.06].map((v) => v * (0.7 + 0.3 * g));
      // In shadow, the facets fade toward the rim, into the sky behind.
      const facing = clamp(nrm.dot(toViewer), 0, 1);
      const alpha = lerp(0.6 * smooth(clamp(facing / 0.75, 0, 1)), 1, light);
      for (let v = 0; v < 3; v++) {
        const o = (i + v) * 4;
        for (let ch = 0; ch < 3; ch++) colors[o + ch] = lerp(shade[ch], day[ch], light);
        colors[o + 3] = alpha;
        litOf[i + v] = light;
        midOf.set([mid.x, mid.y, mid.z], (i + v) * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geo.setAttribute('aLit', new THREE.BufferAttribute(litOf, 1));
    geo.setAttribute('aMid', new THREE.BufferAttribute(midOf, 3));

    /*
     * The moon is the eye: an iris and pupil on its own surface, facet by
     * facet, wherever uGaze points. Lit like the ground under it, so in
     * the shadowed part the iris goes dark with the rest, and only the
     * bright part shows it plainly.
     */
    const iris = mix(this.heroColor, [40, 40, 60], 0.2);
    const eyeUniforms = { uGaze: { value: toViewer.clone().negate() }, uEye: { value: 0 }, uIris: { value: new THREE.Color().setRGB(iris[0] / 255, iris[1] / 255, iris[2] / 255) }, uShadow: { value: 1 } };
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, eyeUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aLit;\nattribute vec3 aMid;\nvarying float vLit;\nvarying vec3 vMid;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLit = aLit;\n  vMid = aMid;');
      shader.fragmentShader = shader.fragmentShader
.replace('void main() {', 'uniform vec3 uGaze;\nuniform float uEye;\nuniform vec3 uIris;\nuniform float uShadow;\nvarying float vLit;\nvarying vec3 vMid;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            '  float ang = acos(clamp(dot(normalize(vMid), uGaze), -1.0, 1.0));',
            // Iris with a dark outer ring, a black pupil, and a pale glint up and to the left.
            '  vec3 ring = uIris * 0.35;',
            '  vec3 eyeCol = ang < 0.16 ? vec3(0.02) : ang < 0.34 ? uIris : ang < 0.4 ? ring : diffuseColor.rgb;',
            '  float inEye = step(ang, 0.4) * uEye;',
            '  vec3 shadeCol = vec3(0.02, 0.025, 0.06);',
            '  diffuseColor.rgb = mix(diffuseColor.rgb, mix(shadeCol, eyeCol, vLit), inEye);',
            // By day the shadowed part is simply not there: only the lit part shows against the blue.
            '  diffuseColor.a *= mix(uShadow, 1.0, vLit);',
          ].join('\n')
        );
    };
    disposables.push(geo, mat);
    const disc = new THREE.Mesh(geo, mat);
    const squeeze = this.roundAt(eye, at);
    disc.matrixAutoUpdate = false;
    disc.matrix.copy(squeeze).multiply(new THREE.Matrix4().makeScale(r, r, r));
    disc.renderOrder = -1;
    group.add(disc);
    const haloMat = new THREE.SpriteMaterial({ map: glow, color: toColor([220, 230, 255]), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    disposables.push(haloMat);
    const halo = new THREE.Sprite(haloMat);
    halo.position.copy(at);
    halo.position.z += r * 1.5;
    halo.scale.setScalar(r * 4.5);
    halo.renderOrder = -2;
    group.add(halo);
    const frame = { toViewer, right: screenRight, up: screenUp };
    return { disc, halo, mat, lit, eye: eyeUniforms, frame, eyeAt: -1, nextEye: this.elapsed + 12 + Math.random() * 14 };
  }

  /*
   * Every minute or so the moon is an eye: a pupil rolls round from the far
   * side, over the edge, to look straight down at the one lying below;
   * glances about, and rolls away round the other side. It starts and ends
   * out of sight on the back of the moon, so nothing pops in or out.
   * Not with reduced motion, and only with the sky in view.
   */
  moonEye(t, show) {
    const m = this.sky.moon;
    const u = m.eye;
    if (m.eyeAt < 0) {
      u.uEye.value = 0;
      if (t < m.nextEye || show < 0.95 || this.reduced) return;
      m.eyeAt = t;
      const { toViewer, right, up } = m.frame;
      const side = (sx, sy) => right.clone().multiplyScalar(sx).addScaledVector(up, sy).normalize();
      const enter = Math.random() * Math.PI * 2;
      const leave = enter + Math.PI * (0.6 + Math.random() * 0.8);
      const glance = () => side(Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.55).add(toViewer).normalize();
      // The path, as [time, direction]: from the back, over the edge, to the front; a few glances; away round the other side.
      const edgeIn = side(Math.cos(enter), Math.sin(enter));
      const edgeOut = side(Math.cos(leave), Math.sin(leave));
      m.path = [
        [0, edgeIn.clone().sub(toViewer).normalize()],
        [0.7, edgeIn],
        [1.5, toViewer.clone()],
        [2.4, toViewer.clone()],
        [2.55, glance()],
        [3.3, glance()],
        [3.45, glance()],
        [4.2, toViewer.clone()],
        [4.8, toViewer.clone()],
        [5.6, edgeOut],
        [6.3, edgeOut.clone().sub(toViewer).normalize()],
      ];
    }
    const a = t - m.eyeAt;
    const path = m.path;
    if (a >= path[path.length - 1][0]) {
      m.eyeAt = -1;
      m.nextEye = t + 45 + Math.random() * 45;
      u.uEye.value = 0;
      return;
    }
    let k = 0;
    while (k < path.length - 2 && a > path[k + 1][0]) k++;
    const [t0, from] = path[k];
    const [t1, to] = path[k + 1];
    const e = smooth(clamp((a - t0) / Math.max(1e-3, t1 - t0), 0, 1));
    u.uGaze.value.copy(from).lerp(to, e).normalize();
    u.uEye.value = 1;
  }

  /* Turning over, lying there, and turning back. */
  updateNight(t, dt) {
    const n = this.night;
    const sky = this.sky;
    n.t = clamp(n.t + (dt / (this.reduced ? 0.4 : 3.6)) * n.dir, 0, 1);
    if (n.t <= 0 && n.dir < 0) {
      this.endNight();
      return;
    }
    if (this.classList.contains('is-nav-open') && n.dir > 0) n.dir = -1;
    const p = n.t;
    sky.group.visible = true;

    // The camera: across to the clearing, down into it, tipping back to look up.
    // Exploring (see startExplore), the visitor steers it instead.
    const c = this.camera;
    if (!this.explorer) {
    // Sinking into the flowers first, then falling back to look up.
    const across = smooth(range(p, 0, 0.5));
    const down = smooth(range(p, 0.05, 0.75));
    const tip = smooth(range(p, 0.5, 1));
    c.position.set(lerp(this.camBase.x, sky.eye.x, across), lerp(this.camBase.y, sky.eye.y, across), lerp(this.camBase.z, sky.eye.z, down));
    c.quaternion.setFromEuler(new THREE.Euler(Math.PI * tip, 0, 0));
    // Zoomed into the sky: a narrower view, turned toward where it was zoomed.
    const sv = this.skyView;
    if (sv) {
      if (n.dir < 0) Object.assign(sv, { tz: 1, tax: 0, tay: 0 });
      const ease = 1 - Math.exp(-dt * 12);
      sv.z += (sv.tz - sv.z) * ease;
      sv.ax += (sv.tax - sv.ax) * ease;
      sv.ay += (sv.tay - sv.ay) * ease;
      c.rotateY(-sv.ax * tip);
      c.rotateX(sv.ay * tip);
    }
    c.fov = lerp(FOV, sky.fov / (sv ? sv.z : 1), down);
    // Tipping up, the camera looks along the sky: draw all of it, or it is cut off in a hard line where the horizon would be.
    c.far = lerp(5000, 80000, smooth(range(p, 0, 0.3)));
    c.updateProjectionMatrix();
    }

    // The sky comes in behind everything, and the light turns to the sky's:
    // moonlight at night, sun and blue sky by day, low gold at sunrise and sunset.
    const dark = smooth(range(p, 0.1, 0.8));
    const time = sky.time;
    const air = skyAir(time);
    this.renderer.setClearColor(toColor(air), dark);
    const day = this.dayLight();
    const skyKey = lerp(0.7, day.key * 0.95, time.light);
    const skyKeyColor = mix(mix(POWDER, day.keyColor, time.light), [255, 186, 140], time.warm * 0.6);
    const skyAmb = lerp(0.45, day.amb, time.light);
    const skyAmbColor = mix(mix(OCEAN, day.ambColor, time.light), mix(day.ambColor, [255, 190, 170], 0.4), time.warm * 0.5);
    this.keyLight.intensity = lerp(day.key, skyKey, dark);
    this.keyLight.color.copy(toColor(mix(day.keyColor, skyKeyColor, dark)));
    this.ambient.intensity = lerp(day.amb, skyAmb, dark);
    this.ambient.color.copy(toColor(mix(day.ambColor, skyAmbColor, dark * 0.7)));
    this.scene.fog.color.copy(this.fogColor).lerp(toColor(air), dark);
    // The haze that softens the bed from above would swallow it as the camera turns: push it away.
    const haze = smooth(range(p, 0, 0.3));
    this.scene.fog.near = this.camDist + 30 + haze * 5000;
    this.scene.fog.far = this.camDist + 320 + haze * 9000;
    // Only a dark sky turns the page's logo light; a day sky leaves it as it is.
    document.documentElement.classList.toggle('garden-night', dark > 0.5 && time.dark);

    // Stars: lying down, they gather into the logo; twinkling all the while.
    if (n.dir > 0 && p >= 1) n.since += dt;
    const since = n.dir > 0 ? n.since : n.since * p;
    const show = smooth(range(p, 0.45, 1));
    const unit = (sky.viewW / this.w) * 2;
    const fp = sky.fpos;
    // Where the drifting clouds have got to: they move right, coming round again.
    const span = sky.viewW * 1.8;
    const left = sky.eye.x - span / 2;
    const move = this.reduced ? 0 : t * sky.viewW * 0.006;
    const driftX = (x, speed) => left + ((((x - left + move * speed) % span) + span) % span);
    if (sky.heaps) for (const h of sky.heaps) h.sum = h.n = 0;
    // A fresh press in the sky (not on its buttons) bursts the stars round it apart, once.
    const ptr = this.pointer;
    this.skyBurst = null;
    if (ptr.down && ptr.st !== this.skyPressAt && n.dir > 0 && p >= 1) {
      this.skyPressAt = ptr.st;
      this.skyBurst = { x: ptr.sx, y: ptr.sy };
    }
    for (const s of sky.logo) {
      // By day, each lobe rides in its big cloud until the cloud flows into the logo.
      const k = this.reduced ? 1 : smooth(smooth(range(since - s.delay, 0, s.source ? 4.2 : 2.8)));
      if (s.source) {
        s.source.sum = (s.source.sum || 0) + k;
        s.source.n = (s.source.n || 0) + 1;
      }
      if (s.source) s.from.set(driftX(s.source.cx, s.source.speed) + s.inside.x, s.source.cy + s.inside.y, s.source.z + s.inside.z);
      let x = lerp(s.from.x, s.to.x, k);
      let y = lerp(s.from.y, s.to.y, k);
      const lift = Math.sin(Math.PI * k) * (s.source ? 60 : 120);
      // Formed, the clouds keep billowing a little.
      if (time.clouds && !this.reduced) {
        x += Math.sin(t * 0.35 + s.ph) * unit * k;
        y += Math.cos(t * 0.27 + s.ph * 1.3) * unit * 0.6 * k;
      }
      const z = lerp(s.from.z, s.to.z, k) - lift;
      // Pushed about by the pointer, floating back into the logo.
      if (!this.reduced && n.dir > 0) {
        this.skyFloat(s, x, y, z, dt);
        if (s.ox || s.oy) {
          const per = ((sky.viewW / this.w) * ((z - sky.eye.z) / sky.D)) / (this.skyView ? this.skyView.z : 1);
          x += s.ox * per;
          y += s.oy * per;
        }
      }
      fp[s.i * 3] = x;
      fp[s.i * 3 + 1] = y;
      fp[s.i * 3 + 2] = z;
      s.k = k;
    }
    if (sky.logoPts) {
      const lp = sky.logoPts.geometry.attributes.position;
      const lc = sky.logoPts.geometry.attributes.color;
      for (const s of sky.logo) {
        lp.setXYZ(s.i, fp[s.i * 3], fp[s.i * 3 + 1], fp[s.i * 3 + 2]);
        const tw = (this.reduced ? 1 : 0.85 + 0.25 * Math.sin(t * s.tw + s.ph)) * show * 1.15;
        lc.setXYZ(s.i, (s.col[0] / 255) * tw, (s.col[1] / 255) * tw, (s.col[2] / 255) * tw);
      }
      lp.needsUpdate = true;
      lc.needsUpdate = true;
    }
    const zoom = this.skyView ? this.skyView.z : 1;
    const d = this.dummy;
    if (sky.logoPuffs) {
      sky.puffs.forEach((q) => {
        const f = q.flower * 3;
        // Lobes swell a little on the way, so the moving mass stays joined up.
        const sz = q.r * (1 + 0.3 * Math.sin(Math.PI * (sky.logo[q.flower].k || 0)));
        d.position.set(fp[f] + q.off.x, fp[f + 1] + q.off.y, fp[f + 2] + q.off.z);
        d.rotation.set(0, 0, q.rot);
        d.scale.set(sz * q.sq[0], sz * q.sq[1], sz * q.sq[2]);
        d.updateMatrix();
        sky.logoPuffs[q.v].setMatrixAt(q.slot, d.matrix);
      });
      sky.logoPuffs.forEach((m) => m && (m.instanceMatrix.needsUpdate = true));
    }
    // The clouds fade in as the view turns up to them.
    if (sky.cloudMat) {
      const fading = show < 0.999;
      if (sky.cloudMat.transparent !== fading) {
        sky.cloudMat.transparent = fading;
        sky.cloudMat.needsUpdate = true;
      }
      sky.cloudMat.opacity = show;
    }
    // Contrail puffs are sized in CSS pixels, grow with the zoom, and follow the render resolution.
    const trail = sky.planes && sky.planes.trail;
    if (trail) {
      const u = trail.material.uniforms;
      u.uZoom.value = zoom;
      u.uScale.value = this.rsNow || this.rs || 1;
      u.uOpacity.value = show;
    }
    // A cloudy sky is drawn at a finer resolution than the PS1 flowers: soft
    // shapes suffer most from big pixels. Back to the bed's once the sky goes.
    if (sky.time.clouds && this.ps1 && !this.backdrop) {
      const fine = Math.min(Math.max(this.dpr || 1, 1), 2, this.rs * 1.6);
      const want = dark > 0.5 ? fine : this.rs;
      if (Math.abs(want - (this.rsNow || this.rs)) > 0.01) this.applyScale(Math.round(want * 8) / 8);
    }
    // Stars fade out as the sky lightens; a few linger at dawn and dusk.
    const stars = clamp(1 - time.light * 1.6, 0, 1);
    const fc = sky.fieldPts.geometry.attributes.color;
    sky.field.forEach((s, i) => {
      const tw = (this.reduced ? 0.8 : 0.5 + 0.5 * Math.sin(t * s.tw + s.ph) ** 2) * show * stars * (s.bright ? 1.3 : 1);
      fc.setXYZ(i, (s.col[0] / 255) * tw, (s.col[1] / 255) * tw, (s.col[2] / 255) * tw);
    });
    fc.needsUpdate = true;
    if (sky.moon) {
      this.moonEye(t, show * stars);
      // By day a pale moon, its shadowed side gone; at night the full thing.
      sky.moon.mat.opacity = show * Math.max(stars, 0.6 * time.light);
      sky.moon.eye.uShadow.value = stars;
      sky.moon.halo.material.opacity = show * stars * (0.04 + 0.1 * sky.moon.lit);
    }
    if (sky.sun) {
      const up = show * clamp(time.light * 1.4 + time.warm, 0, 1);
      sky.sun.mat.opacity = up;
      sky.sun.halo.material.opacity = up * 0.55;
      sky.sun.wash.material.opacity = up * 0.22;
    }
    // Clouds drift slowly across; each that goes off one side comes back on the other as a new cloud.
    if (sky.driftPts) {
      for (const h of sky.heaps) {
        const hx = driftX(h.cx, h.speed);
        if (h.wx !== undefined && hx < h.wx - span * 0.5) this.reshapeCloud(h, sky);
        h.wx = hx;
      }
      sky.drift.forEach((c) => {
        // A cloud's lobes move as one with it, so it wraps round whole.
        const H = c.cloud;
        c.x = H ? driftX(H.cx, H.speed) + (c.p.x - H.cx) : driftX(c.p.x, c.speed);
        d.position.set(c.x, c.p.y, c.p.z);
        d.rotation.set(0, 0, c.rot);
        let r = c.r;
        let stretch = 1;
        const h = c.heap;
        if (h && h.n && h.tx !== undefined) {
          // A source cloud bends and slides toward its part of the logo,
          // drawn out along the way, and thins away as its lobes arrive.
          const prog = h.sum / h.n;
          const hx = driftX(h.cx, h.speed);
          const pull = smooth(clamp(prog * 1.4, 0, 1));
          d.position.set(lerp(c.x, h.tx + (c.x - hx) * 0.6, pull * 0.8), lerp(c.p.y, h.ty + (c.p.y - h.cy) * 0.6, pull * 0.8), c.p.z);
          stretch = 1 + Math.sin(Math.PI * clamp(prog * 1.2, 0, 1)) * 0.6;
          r = Math.max(1e-3, c.r * (1 - smooth(clamp((prog - 0.15) * 1.6, 0, 1))));
          d.rotation.z = c.rot + Math.atan2(h.ty - h.cy, h.tx - hx) * 0.25 * pull;
        }
        if (!this.reduced && n.dir > 0) {
          // World units per screen pixel at this cloud's depth.
          const per = ((sky.viewW / this.w) * ((d.position.z - sky.eye.z) / sky.D)) / (this.skyView ? this.skyView.z : 1);
          this.skyFloat(c, d.position.x, d.position.y, d.position.z, dt, (r * c.sq[0] * stretch) / per);
          if (c.ox || c.oy) {
            d.position.x += c.ox * per;
            d.position.y += c.oy * per;
          }
        }
        d.scale.set(r * c.sq[0] * stretch, r * c.sq[1], r * c.sq[2]);
        d.updateMatrix();
        sky.driftPts[c.v].setMatrixAt(c.slot, d.matrix);
      });
      sky.driftPts.forEach((m) => m && (m.instanceMatrix.needsUpdate = true));
    }
    this.flyPlanes(t, dt, show, p);
    this.flyBirds(t, dt, show, p);
    this.flyBlimp(t, dt, show, p);
    this.flyBanner(t, dt, show, p);
    sky.glows.forEach((g) => (g.material.opacity = dark));

    // Now and then a shooting star, like the bees by day.
    if (!this.reduced && p >= 1 && stars > 0.5) {
      n.nextShoot -= dt;
      if (n.nextShoot <= 0 && !n.shot) {
        const a = Math.random() * TAU;
        const from = new THREE.Vector3(sky.eye.x + (Math.random() - 0.5) * sky.viewW * 0.9, sky.eye.y + (Math.random() - 0.5) * sky.viewH * 0.9, sky.eye.z + sky.D * 1.25);
        n.shot = { from, dir: new THREE.Vector3(Math.cos(a), Math.sin(a), 0), len: sky.viewW * (0.08 + Math.random() * 0.08), speed: sky.viewW * (0.6 + Math.random() * 0.4), age: 0 };
      }
    }
    const sh = n.shot;
    if (sh) {
      sh.age += dt;
      const life = 1.1;
      const head = sh.from.clone().addScaledVector(sh.dir, sh.speed * sh.age);
      const tail = head.clone().addScaledVector(sh.dir, -sh.len * Math.min(1, sh.age * 4));
      const pos = sky.shoot.geometry.attributes.position;
      pos.setXYZ(0, head.x, head.y, head.z);
      pos.setXYZ(1, tail.x, tail.y, tail.z);
      pos.needsUpdate = true;
      const fade = Math.sin(Math.PI * Math.min(1, sh.age / life)) * show;
      sky.shoot.geometry.attributes.color.setXYZ(0, fade, fade, fade);
      sky.shoot.geometry.attributes.color.needsUpdate = true;
      sky.shoot.visible = true;
      if (sh.age > life) {
        n.shot = null;
        sky.shoot.visible = false;
        n.nextShoot = 5 + Math.random() * 9;
      }
    }

    this.skyEyes(t, dt, show, p);

    // Flower eyes look up at the sky too.
    this.viewDirty = true;
  }

  /* Where the one lying below is looking: the pointer if there is one, else straight up. */
  skyGazePoint(out) {
    const c = this.camera;
    const ptr = this.pointer;
    if (ptr.active && ptr.type === 'mouse') out.set((ptr.x / this.w) * 2 - 1, -(ptr.y / this.h) * 2 + 1, 0.5).unproject(c);
    else out.set(0, 0, 0.5).unproject(c);
    // A point a little way out along that line: close by, so the eyes look right at the viewer.
    return out.sub(c.position).normalize().multiplyScalar(60).add(c.position);
  }

  /* An eye's lids for how open it is (0..1), with a blink now and then. */
  lids(e, open, t) {
    if (t > e.nextBlink) {
      e.blinkAt = t;
      e.nextBlink = t + 3 + Math.random() * 6;
    }
    let b = 1;
    if (e.blinkAt >= 0 && t >= e.blinkAt) {
      const bt = (t - e.blinkAt) / (BLINK * 1.6);
      if (bt >= 1) e.blinkAt = -1;
      else b = Math.abs(Math.cos(Math.PI * bt));
    }
    const ap = open * b;
    e.top.rotation.x = -1.05 * ap;
    e.bottom.rotation.x = 0.7 * ap;
  }

  /*
   * The logo as a grid of cells, for signs: which cells of a cols x rows
   * grid over the logo's box have a flower of the logo in them.
   */
  logoCells(cols, rows) {
    const box = this.logoBox;
    const lit = new Uint8Array(cols * rows);
    for (const f of this.flowers) {
      const u = (f.dest[0] - box.x) / box.w;
      const v = (f.dest[1] - box.y) / box.h;
      const ru = (f.r * 0.85) / box.w;
      const rv = (f.r * 0.85) / box.h;
      for (let r = Math.max(0, Math.floor((v - rv) * rows)); r <= Math.min(rows - 1, Math.floor((v + rv) * rows)); r++) {
        for (let c = Math.max(0, Math.floor((u - ru) * cols)); c <= Math.min(cols - 1, Math.floor((u + ru) * cols)); c++) {
          const du = ((c + 0.5) / cols - u) / ru;
          const dv = ((r + 0.5) / rows - v) / rv;
          if (du * du + dv * dv <= 1) lit[r * cols + c] = 1;
        }
      }
    }
    return lit;
  }

  /*
   * At night, rarely, a blimp: a silver airship drifting slowly across
   * below the clouds, after the one in Scarface, with digital screens built
   * into both flanks of the envelope, curving with it: on one, the logo in
   * LED pixels scrolling across like a ticker; on the other, the logo's
   * asterisk in coral, bouncing across like a ball. Built at unit size (2 long, nose along +x) and
   * scaled when it flies.
   */
  buildBlimp(group, disposables) {
    const box = this.logoBox;
    if (!box || !this.flowers.length) return null;
    const holder = new THREE.Group();
    holder.visible = false;
    group.add(holder);
    // The body turns to face its way; the screen underneath never mirrors, so it always reads.
    const body = new THREE.Group();
    holder.add(body);
    // Silver, glowing a little of its own so it reads against the dark sky.
    const silver = [70, 76, 96];
    const skin = this.makeMaterial({ color: toColor(silver), emissive: toColor(tone(silver, -0.45)), shininess: 40, specular: 0x666666 });
    const trim = this.makeMaterial({ color: toColor(tone(silver, -0.3)), emissive: toColor(tone(silver, -0.7)) });
    const envelopeGeo = new THREE.SphereGeometry(1, 40, 20);
    const finGeo = new THREE.BoxGeometry(0.3, 0.02, 0.22);
    const gondolaGeo = new THREE.BoxGeometry(0.18, 0.08, 0.06);
    disposables.push(skin, trim, envelopeGeo, finGeo, gondolaGeo);
    const envelope = new THREE.Mesh(envelopeGeo, skin);
    envelope.scale.set(1, 0.3, 0.3);
    body.add(envelope);
    for (const [y, z, flat] of [[0, 0.24, false], [0, -0.24, false], [0.24, 0, true], [-0.24, 0, true]]) {
      const fin = new THREE.Mesh(finGeo, trim);
      fin.position.set(-0.86, y, z);
      if (flat) fin.rotation.x = Math.PI / 2;
      body.add(fin);
    }
    const gondola = new THREE.Mesh(gondolaGeo, trim);
    // Up toward the nose, clear of the screen.
    gondola.position.set(0.72, 0, -0.22);
    body.add(gondola);

    // The screen: a grid of LEDs, 4:1, the logo's lit cells scrolling through it.
    const rows = 30;
    const cols = 120;
    const logoRows = rows - 6;
    const aspect = box.w / Math.max(1, box.h);
    const logoCols = Math.max(8, Math.round(logoRows * aspect * 1.1));
    const lit = this.logoCells(logoCols, logoRows);
    // One pass of the ticker: the logo, then dark screen as wide as the screen, so it slides fully through.
    const strip = logoCols + cols;
    const px = 4;
    const canvas = document.createElement('canvas');
    canvas.width = strip * px;
    canvas.height = rows * px;
    const g = canvas.getContext('2d');
    g.fillStyle = '#06070c';
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < strip; c++) {
        const lr = r - 3;
        const on = c < logoCols && lr >= 0 && lr < logoRows && lit[lr * logoCols + c];
        g.fillStyle = on ? '#eef4ff' : '#161a26';
        g.fillRect(c * px + 1, r * px + 1, px - 1, px - 1);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(cols / strip, 1);
    // The screens are part of the envelope itself: a band of its own curved skin on each flank,
    // turned a little down toward the ground, with a dark bezel round it, so the logo scrolls
    // across the airship's side as on the real thing. Each reads left to right from its own side.
    const RX = 1;
    const RYZ = 0.3;
    // flip: the -y flank, where the band's first row (j = 0) is its bottom edge, not its top.
    const band = (center, span, xs, lift, mirror, flip) => {
      const nx = 36;
      const na = 10;
      const pos = [];
      const uv = [];
      const idx = [];
      for (let j = 0; j <= na; j++) {
        // From the band's top edge (j = 0) to its bottom.
        const th = center + span / 2 - (span * j) / na;
        for (let i = 0; i <= nx; i++) {
          const sx = -xs + (2 * xs * i) / nx;
          const r = Math.sqrt(Math.max(0, 1 - sx * sx)) * RYZ * lift;
          pos.push(sx * RX, Math.cos(th) * r, Math.sin(th) * r);
          uv.push(mirror ? 1 - i / nx : i / nx, flip ? j / na : 1 - j / na);
        }
      }
      for (let j = 0; j < na; j++) {
        for (let i = 0; i < nx; i++) {
          const a0 = j * (nx + 1) + i;
          const a1 = a0 + 1;
          const b0 = a0 + nx + 1;
          const b1 = b0 + 1;
          idx.push(a0, a1, b0, a1, b1, b0);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      disposables.push(geo);
      return geo;
    };
    const screenMat = new THREE.MeshBasicMaterial({ map: tex, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const frameMat = new THREE.MeshBasicMaterial({ color: toColor([12, 13, 20]), fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    disposables.push(tex, screenMat, frameMat);

    // The other flank: the logo's asterisk in coral, bouncing across the screen like a ball,
    // squashing as it lands and rolling as it goes. Redrawn each frame while the blimp is up.
    // Its shape, finely, in an S x S grid; drawn N LEDs across on the screen.
    const S = 40;
    const N = 20;
    const star = new Uint8Array(S * S);
    const starFlowers = this.flowers.filter((f) => f.star);
    if (starFlowers.length) {
      // The asterisk the flowers make in the logo, fitted into a square.
      const xs = starFlowers.map((f) => f.dest[0]);
      const ys = starFlowers.map((f) => f.dest[1]);
      const rr = starFlowers.reduce((a, f) => a + f.r, 0) / starFlowers.length;
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + rr * 2;
      for (const f of starFlowers) {
        const u = ((f.dest[0] - cx) / size + 0.5) * S;
        const v = ((f.dest[1] - cy) / size + 0.5) * S;
        const rad = (f.r * 0.9 * S) / size;
        for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (Math.hypot(c + 0.5 - u, r + 0.5 - v) <= rad) star[r * S + c] = 1;
      }
    } else {
      // No asterisk in the logo: a drawn one, six arms.
      for (let r = 0; r < S; r++) {
        for (let c = 0; c < S; c++) {
          const dx = c + 0.5 - S / 2;
          const dy = r + 0.5 - S / 2;
          const d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const arm = Math.abs(Math.sin(3 * a)) * d;
          if (d < S / 2 && (arm < S * 0.085 || d < S * 0.12)) star[r * S + c] = 1;
        }
      }
    }
    const bounceCanvas = document.createElement('canvas');
    bounceCanvas.width = cols * px;
    bounceCanvas.height = rows * px;
    // The unlit screen, drawn once; each frame starts from it.
    const dark = document.createElement('canvas');
    dark.width = bounceCanvas.width;
    dark.height = bounceCanvas.height;
    const dg = dark.getContext('2d');
    dg.fillStyle = '#06070c';
    dg.fillRect(0, 0, dark.width, dark.height);
    dg.fillStyle = '#161a26';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dg.fillRect(c * px + 1, r * px + 1, px - 1, px - 1);
    const bounceTex = new THREE.CanvasTexture(bounceCanvas);
    bounceTex.colorSpace = THREE.SRGBColorSpace;
    bounceTex.magFilter = THREE.NearestFilter;
    bounceTex.minFilter = THREE.LinearFilter;
    const bounceMat = new THREE.MeshBasicMaterial({ map: bounceTex, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    disposables.push(bounceTex, bounceMat);
    const coral = this.heroColor || [240, 78, 98];
    const bounce = { g: bounceCanvas.getContext('2d'), dark, tex: bounceTex, star, S, N, rows, cols, px, color: `rgb(${coral.map((v) => Math.round(v)).join(',')})` };

    // Angles round the long axis: 0 is the +y flank, PI the -y flank; a little below each, toward the ground.
    // The logo on the +y flank; the bouncing asterisk on the -y flank.
    const tilt = 0.45;
    const span = 1.05;
    for (const [center, mirror, flip, mat] of [[Math.PI + tilt, false, true, bounceMat], [-tilt, true, false, screenMat]]) {
      holder.add(new THREE.Mesh(band(center, span + 0.14, 0.62, 1.004, mirror, flip), frameMat));
      holder.add(new THREE.Mesh(band(center, span, 0.56, 1.008, mirror, flip), mat));
    }
    return { holder, body, tex, strip, cols, bounce, active: null };
  }

  flyBlimp(t, dt, show, p) {
    const sky = this.sky;
    const B = sky.blimp;
    const n = this.night;
    if (!B) return;
    const depth = sky.D * 0.62;
    const k = depth / sky.D;
    if (!B.active && !this.reduced && n.dir > 0 && p >= 1 && t > sky.nextBlimp) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const reach = sky.viewW * k * 0.85;
      B.active = { x: sky.eye.x - dir * reach, y: sky.eye.y + (Math.random() - 0.5) * sky.viewH * k * 0.5, dir, speed: (reach * 2) / (45 + Math.random() * 20), reach, ph: Math.random() * TAU };
    }
    const A = B.active;
    B.holder.visible = !!A && show > 0.05;
    if (!A) return;
    A.x += A.dir * A.speed * dt;
    if ((A.x - sky.eye.x) * A.dir > A.reach) {
      B.active = null;
      B.holder.visible = false;
      sky.nextBlimp = t + 120 + Math.random() * 120;
      return;
    }
    // About a quarter of the view long, bobbing a little as it goes.
    const half = sky.viewW * k * 0.14;
    B.holder.position.set(A.x, A.y + Math.sin(t * 0.4 + A.ph) * half * 0.04, sky.eye.z + depth + Math.sin(t * 0.3 + A.ph) * half * 0.05);
    B.holder.scale.setScalar(half);
    B.body.scale.x = A.dir;
    B.holder.rotation.z = Math.sin(t * 0.25 + A.ph) * 0.03;
    // The ticker: the logo slides in from the right and out to the left, about a screen's width every 3 seconds.
    B.tex.offset.x = (t * (B.cols / B.strip) / 3) % 1;
    if (B.holder.visible) this.bounceStar(B.bounce, t);
  }

  /* The coral asterisk on the blimp's other screen, one frame: bouncing across like a ball. */
  bounceStar(K, t) {
    const { g, star, S, N, rows, cols, px } = K;
    g.drawImage(K.dark, 0, 0);
    // A bounce every 1.1 seconds: a parabola from the bottom row to near the top, squashing as it lands.
    const ph = (t / 1.1) % 1;
    const air = 4 * ph * (1 - ph);
    const edge = Math.min(ph, 1 - ph);
    const squash = edge < 0.07 ? 1 - 0.32 * (1 - edge / 0.07) : 1;
    const sy = squash;
    const sx = 1 / Math.sqrt(squash);
    // Sliding left across the screen (as the logo does on the other side), right round again.
    const travel = cols + N * 2;
    const cx = cols + N - ((t * cols) / 3.4) % travel;
    const floor = rows - 0.5;
    const cy = floor - (N / 2) * sy - air * (rows - N - 1.5);
    // Rolling as it goes.
    const a = (cx / (N / 2)) * 0.9;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.fillStyle = K.color;
    const reach = Math.ceil(N * 0.8);
    const k = S / N;
    for (let r = Math.max(0, Math.floor(cy - reach)); r <= Math.min(rows - 1, Math.ceil(cy + reach)); r++) {
      for (let c = Math.max(0, Math.floor(cx - reach)); c <= Math.min(cols - 1, Math.ceil(cx + reach)); c++) {
        // Back from this LED into the asterisk's own cells: undo the squash, then the roll.
        const u = (c + 0.5 - cx) / sx;
        const v = (r + 0.5 - cy) / sy;
        const su = (ca * u + sa * v) * k + S / 2;
        const sv = (-sa * u + ca * v) * k + S / 2;
        if (su < 0 || sv < 0 || su >= S || sv >= S) continue;
        if (star[Math.floor(sv) * S + Math.floor(su)]) g.fillRect(c * px + 1, r * px + 1, px - 1, px - 1);
      }
    }
    K.tex.needsUpdate = true;
  }

  /*
   * By day, rarely, a biplane towing a banner: red wings, propeller
   * spinning, and behind it on a line a long white banner printed with the
   * logo, hung on edge as real tow banners fly, rippling in the wind, more
   * the further from the plane. It reads the right way round from either
   * side. Built at unit size (the plane 1 long, nose +x).
   */
  buildBanner(group, disposables) {
    const box = this.logoBox;
    if (!box || !this.flowers.length) return null;
    const holder = new THREE.Group();
    holder.visible = false;
    group.add(holder);
    const plane = new THREE.Group();
    holder.add(plane);
    const keep = (x) => (disposables.push(x), x);
    const red = [200, 42, 54];
    const cream = [240, 232, 210];
    const navy = [25, 31, 107];
    // Lit by the sun but never murky: a little of their own light.
    const mat = (c, k = 0.4) => keep(this.makeMaterial({ color: toColor(c), emissive: toColor(tone(c, -1 + k)), shininess: 30 }));
    const wingMat = mat(red);
    const bodyMat = mat(cream);
    const trimMat = mat(navy, 0.3);
    const darkMat = mat([46, 42, 48], 0.2);
    const part = (geo, m, x, y, z, parent = plane) => {
      const o = new THREE.Mesh(keep(geo), m);
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    // A little biplane, nose along +x, seen mostly from below: a rounded body tapering to the tail,
    // two staggered wings (both show from underneath), struts, wheels, roundels and a spinning propeller.
    const body = part(new THREE.CylinderGeometry(0.075, 0.032, 0.82, 10), bodyMat, -0.02, 0, 0);
    body.rotation.z = -Math.PI / 2;
    const cowl = part(new THREE.CylinderGeometry(0.088, 0.08, 0.1, 10), trimMat, 0.42, 0, 0);
    cowl.rotation.z = -Math.PI / 2;
    part(new THREE.BoxGeometry(0.2, 1.16, 0.022), wingMat, 0.19, 0, 0.13);
    part(new THREE.BoxGeometry(0.18, 1.02, 0.022), wingMat, 0.1, 0, -0.07);
    for (const y of [-0.42, 0.42]) {
      // Roundels under the lower wing, in the garden's colors.
      const outer = part(new THREE.CircleGeometry(0.07, 16), bodyMat, 0.1, y, -0.083);
      outer.rotation.x = Math.PI;
      const inner = part(new THREE.CircleGeometry(0.042, 16), trimMat, 0.1, y, -0.084);
      inner.rotation.x = Math.PI;
      part(new THREE.BoxGeometry(0.018, 0.018, 0.2), darkMat, 0.15, y * 0.8, 0.03);
    }
    part(new THREE.BoxGeometry(0.14, 0.4, 0.016), wingMat, -0.4, 0, 0.01);
    part(new THREE.BoxGeometry(0.15, 0.016, 0.17), wingMat, -0.41, 0, 0.09);
    for (const y of [-0.11, 0.11]) {
      part(new THREE.BoxGeometry(0.016, 0.016, 0.13), darkMat, 0.22, y, -0.12);
      const wheel = part(new THREE.CylinderGeometry(0.045, 0.045, 0.028, 12), darkMat, 0.22, y, -0.19);
      wheel.rotation.x = 0;
    }
    const prop = new THREE.Group();
    prop.position.set(0.485, 0, 0);
    plane.add(prop);
    const blurMat = keep(new THREE.MeshBasicMaterial({ color: toColor([60, 56, 60]), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    const blur = part(new THREE.CircleGeometry(0.19, 20), blurMat, 0, 0, 0, prop);
    blur.rotation.y = Math.PI / 2;
    part(new THREE.BoxGeometry(0.015, 0.38, 0.03), darkMat, 0.004, 0, 0, prop);

    // The banner: white cloth printed with the logo itself, sized to the logo with a margin all
    // round, hung on edge from a spreader bar at the front, the way real tow banners fly, so it is
    // read from the side. Printed on both faces, so it reads the right way round from either side.
    const m = this.mask;
    const aspect = m ? (m.x1 - m.x0) / (m.y1 - m.y0) : box.w / box.h;
    const H = 0.68;
    const L = clamp(H * 0.66 * aspect + H * 0.5, 1.5, 4.2);
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = Math.round(2048 * (H / L));
    const g = canvas.getContext('2d');
    const lh = canvas.height * 0.66;
    const lw = lh * aspect;
    const lx = (canvas.width - lw) / 2;
    const ly = (canvas.height - lh) / 2;
    const ink = '#191f6b';
    // Prints the logo from any image of it (navy wherever it is opaque), cropped to its shape.
    const print = (img, sx, sy, sw, sh) => {
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(lw));
      tmp.height = Math.max(1, Math.round(lh));
      const tg = tmp.getContext('2d');
      tg.imageSmoothingEnabled = true;
      tg.imageSmoothingQuality = 'high';
      tg.drawImage(img, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = ink;
      tg.fillRect(0, 0, tmp.width, tmp.height);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(tmp, lx, ly);
    };
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (m) {
      // First from the logo shape the garden already has.
      const mw = m.x1 - m.x0;
      const mh = m.y1 - m.y0;
      const sc = document.createElement('canvas');
      sc.width = mw;
      sc.height = mh;
      const sg = sc.getContext('2d');
      const img = sg.createImageData(mw, mh);
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) img.data[(y * mw + x) * 4 + 3] = m.alpha[(y + m.y0) * m.w + x + m.x0];
      }
      sg.putImageData(img, 0, 0);
      print(sc, 0, 0, mw, mh);
    } else {
      const fit = Math.min(lw / box.w, lh / box.h);
      g.fillStyle = ink;
      for (const f of this.flowers) {
        g.beginPath();
        g.arc(lx + (f.dest[0] - box.x) * fit, ly + (f.dest[1] - box.y) * fit, Math.max(1.5, f.r * fit * 0.9), 0, TAU);
        g.fill();
      }
    }
    const tex = keep(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // The other face: the same print, turned round so it reads from that side too.
    const back = keep(tex.clone());
    back.wrapS = THREE.RepeatWrapping;
    back.repeat.x = -1;
    back.offset.x = 1;
    // Then sharp, from the logo image itself at full size (as large as the uploaded file allows).
    const src = this.maskSource();
    if (m && src) {
      const hd = new Image();
      hd.crossOrigin = 'anonymous';
      hd.onload = () => {
        const k = hd.naturalWidth / m.w;
        try {
          print(hd, m.x0 * k, m.y0 * k, (m.x1 - m.x0) * k, (m.y1 - m.y0) * k);
          tex.needsUpdate = true;
          back.needsUpdate = true;
        } catch (e) {
          /* keeps the first print */
        }
      };
      hd.src = /[?&]width=\d+/.test(src) ? src.replace(/([?&])width=\d+/, '$1width=2400') : src;
    }
    const clothGeo = keep(new THREE.PlaneGeometry(L, H, 40, 8));
    // Mostly its own light (the white stays white), with the folds still shaded by the sun.
    const clothMat = keep(this.makeMaterial({ map: tex, emissiveMap: tex, emissive: toColor([200, 200, 200]), side: THREE.FrontSide, shininess: 6, flatShading: false }));
    const backMat = keep(this.makeMaterial({ map: back, emissiveMap: back, emissive: toColor([200, 200, 200]), side: THREE.BackSide, shininess: 6, flatShading: false }));
    // On edge: the cloth's face turned to the side (-y), its top edge up.
    const cloth = new THREE.Group();
    cloth.rotation.x = Math.PI / 2;
    cloth.add(new THREE.Mesh(clothGeo, clothMat), new THREE.Mesh(clothGeo, backMat));
    holder.add(cloth);
    const bar = part(new THREE.BoxGeometry(0.02, 0.02, H * 1.04), darkMat, 0, 0, 0, holder);
    const rest = Float32Array.from(clothGeo.attributes.position.array);
    // The tow line from the tail to a ring, and a bridle from the ring to both ends of the bar.
    const lineGeo = keep(new THREE.BufferGeometry());
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    const lineMat = keep(new THREE.LineBasicMaterial({ color: toColor([60, 60, 70]), fog: false }));
    const line = new THREE.LineSegments(lineGeo, lineMat);
    line.frustumCulled = false;
    holder.add(line);
    return { holder, plane, prop, cloth, clothGeo, bar, rest, line, L, H, active: null };
  }

  flyBanner(t, dt, show, p) {
    const sky = this.sky;
    const B = sky.banner;
    const n = this.night;
    if (!B) return;
    const depth = sky.D * 0.55;
    const k = depth / sky.D;
    if (!B.active && !this.reduced && n.dir > 0 && p >= 1 && t > sky.nextBlimp) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const reach = sky.viewW * k * 1.15;
      B.active = { x: sky.eye.x - dir * reach, y: sky.eye.y + (Math.random() - 0.5) * sky.viewH * k * 0.5, dir, speed: (reach * 2) / (24 + Math.random() * 8), reach, ph: Math.random() * TAU };
    }
    const A = B.active;
    B.holder.visible = !!A && show > 0.05;
    if (!A) return;
    A.x += A.dir * A.speed * dt;
    if ((A.x - sky.eye.x) * A.dir > A.reach) {
      B.active = null;
      B.holder.visible = false;
      sky.nextBlimp = t + 120 + Math.random() * 120;
      return;
    }
    const size = sky.viewW * k * 0.11;
    const bob = Math.sin(t * 0.7 + A.ph);
    B.holder.position.set(A.x, A.y + bob * size * 0.06, sky.eye.z + depth);
    B.holder.scale.setScalar(size);
    B.plane.scale.x = A.dir;
    // A gentle rock of the wings and a nod with the bob.
    B.plane.rotation.x = Math.sin(t * 0.9 + A.ph) * 0.14;
    B.plane.rotation.y = -Math.cos(t * 0.7 + A.ph) * 0.05 * A.dir;
    B.prop.rotation.x = t * 45;
    // The banner trails on its line; it ripples in waves running back from the bar, the loose end hardest.
    const gap = 0.6;
    const front = -A.dir * (0.5 + gap);
    const cx = front - A.dir * (B.L / 2);
    // Hanging a little below the tow line.
    const drop = -B.H * 0.12;
    B.cloth.position.set(cx, 0, drop);
    const pos = B.clothGeo.attributes.position;
    const sway = Math.sin(t * 1.3 + A.ph) * 0.03;
    for (let i = 0; i < pos.count; i++) {
      const x = B.rest[i * 3];
      const y = B.rest[i * 3 + 1];
      // How far along from the bar (0) to the loose end (1).
      const s = A.dir > 0 ? (B.L / 2 - x) / B.L : (x + B.L / 2) / B.L;
      const run = s * 12 - t * 11 + A.ph;
      const amp = 0.015 + s * 0.11;
      const z = amp * Math.sin(run) + s * 0.035 * Math.sin(y * 9 + s * 15 - t * 14) + sway * s;
      // The cloth gathers a little where it folds, the bottom edge trails a touch behind, and the loose end lifts and drops.
      const trail = A.dir * (B.H / 2 - y) * 0.08 * s;
      pos.setXYZ(i, x + A.dir * s * 0.03 * (1 - Math.cos(run)) - trail, y + s * 0.045 * Math.sin(s * 6 - t * 5 + A.ph), z);
    }
    pos.needsUpdate = true;
    B.clothGeo.computeVertexNormals();
    B.bar.position.set(front, 0, drop);
    const ring = front + A.dir * 0.22;
    const lp = B.line.geometry.attributes.position;
    lp.setXYZ(0, -A.dir * 0.47, 0, 0.01);
    lp.setXYZ(1, ring, 0, 0);
    lp.setXYZ(2, ring, 0, 0);
    lp.setXYZ(3, front, 0, drop + B.H * 0.5);
    lp.setXYZ(4, ring, 0, 0);
    lp.setXYZ(5, front, 0, drop - B.H * 0.5);
    lp.needsUpdate = true;
  }

  /*
   * A plane now and then, high up and small, crossing in a straight line:
   * by day (and at sunrise and sunset) its two contrails stream out behind
   * it, widen and fade; at night only its lights show, red and green at the
   * wingtips and a white strobe.
   */
  buildPlanes(group, disposables, atlas, tex, time, D) {
    // Seen from below: a swept-wing silhouette, nose along +x.
    const half = [
      [0.5, 0], [0.43, 0.045], [0.12, 0.055], [-0.1, 0.5], [-0.2, 0.5], [-0.08, 0.06],
      [-0.36, 0.05], [-0.44, 0.19], [-0.52, 0.19], [-0.49, 0.03], [-0.53, 0],
    ];
    const shape = new THREE.Shape();
    const pts = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
    shape.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
    const geo = new THREE.ShapeGeometry(shape);
    const body = time.dark ? [16, 18, 40] : mix([150, 158, 178], time.evening ? [190, 140, 150] : [200, 170, 160], time.warm * 0.5);
    const mat = this.snapMaterial(new THREE.MeshBasicMaterial({ color: toColor(body), side: THREE.DoubleSide, fog: false }));
    const plane = new THREE.Mesh(geo, mat);
    plane.renderOrder = 0;
    plane.visible = false;
    group.add(plane);
    disposables.push(geo, mat);
    const light = (color) => {
      const m = new THREE.SpriteMaterial({ map: tex, color: toColor(color), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
      const sp = new THREE.Sprite(m);
      sp.visible = false;
      group.add(sp);
      disposables.push(m);
      return sp;
    };
    const lights = time.dark ? { red: light([255, 60, 60]), green: light([80, 255, 120]), strobe: light([255, 255, 255]) } : null;
    // Contrails: puffs laid down behind each engine.
    const trail = time.light > 0.2 ? this.puffPoints(320, atlas, group, disposables) : null;
    if (trail) {
      for (let i = 0; i < 320; i++) this.setPuff(trail, i, 0, 0, i % 4, Math.random() * TAU, mix(WHITE, [255, 200, 180], time.warm * 0.5));
      trail.renderOrder = -1;
    }
    return { plane, lights, trail, puffs: Array.from({ length: 320 }, () => ({ age: -1 })), next: 0, active: null, depth: D * 1.1 };
  }

  /*
   * Birds, now and then, by day: a small flock crossing far below the
   * clouds, so they look bigger and quicker than anything up there. Dark
   * against the bright sky, wings beating and now and then held in a glide.
   */
  buildBirds(group, disposables, time) {
    if (time.light <= 0.2) return null;
    const color = mix([46, 52, 78], time.evening ? [70, 44, 66] : [84, 56, 70], time.warm * 0.6);
    const mat = this.snapMaterial(new THREE.MeshBasicMaterial({ color: toColor(color), side: THREE.DoubleSide, fog: false }));
    // Seen from below, nose along +x: a slim body and a swept wing (made for the right side, mirrored for the left).
    const bodyShape = new THREE.Shape();
    [[0.32, 0], [0.18, 0.05], [-0.22, 0.045], [-0.42, 0.13], [-0.36, 0], [-0.42, -0.13], [-0.22, -0.045], [0.18, -0.05]].forEach(([x, y], i) => (i ? bodyShape.lineTo(x, y) : bodyShape.moveTo(x, y)));
    const wingShape = new THREE.Shape();
    [[0.1, 0], [0.06, 0.2], [-0.04, 0.38], [-0.2, 0.5], [-0.1, 0.3], [-0.12, 0.12], [-0.1, 0]].forEach(([x, y], i) => (i ? wingShape.lineTo(x, y) : wingShape.moveTo(x, y)));
    const bodyGeo = new THREE.ShapeGeometry(bodyShape);
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    disposables.push(mat, bodyGeo, wingGeo);
    const birds = [];
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat);
      const right = new THREE.Mesh(wingGeo, mat);
      const left = new THREE.Mesh(wingGeo, mat);
      left.scale.y = -1;
      b.add(body, right, left);
      b.visible = false;
      group.add(b);
      birds.push({ g: b, right, left, phase: Math.random() * TAU, rate: 7 + Math.random() * 3, glideAt: 0, gliding: false });
    }
    return { birds, flock: null };
  }

  flyBirds(t, dt, show, p) {
    const sky = this.sky;
    const B = sky.birds;
    const n = this.night;
    if (!B) return;
    // Well below the clouds: about a third of the way up to them.
    const depth = sky.D * 0.35;
    const k = depth / sky.D;
    const unit = (sky.viewW / this.w) * k;
    const cx = sky.eye.x;
    const cy = sky.eye.y;
    if (!B.flock && !this.reduced && n.dir > 0 && p >= 1 && t > sky.nextBirds) {
      const count = 3 + Math.floor(Math.random() * 6);
      const a = Math.random() * TAU;
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const R0 = sky.viewW * k * 0.7;
      const side = (Math.random() - 0.5) * sky.viewH * k * 0.6;
      const span = (26 + Math.random() * 14) * unit;
      const vee = Math.random() < 0.5;
      // A loose V, or a ragged straggle.
      const slots = Array.from({ length: count }, (_, i) => {
        const rank = Math.ceil(i / 2);
        const wing = i % 2 ? 1 : -1;
        return vee
          ? new THREE.Vector2(-rank * span * 0.9, wing * rank * span * 0.75)
          : new THREE.Vector2(-(Math.random() * 3) * span, (Math.random() - 0.5) * 4 * span);
      });
      B.flock = {
        pos: new THREE.Vector2(cx - dir.x * R0 - dir.y * side, cy - dir.y * R0 + dir.x * side),
        dir, speed: (R0 * 2) / (6 + Math.random() * 3), R0, span, slots, t0: t, wobble: Math.random() * TAU,
      };
    }
    const F = B.flock;
    B.birds.forEach((b, i) => {
      if (!F || i >= F.slots.length || n.dir < 0) {
        b.g.visible = false;
        return;
      }
      const heading = Math.atan2(F.dir.y, F.dir.x) + Math.sin((t - F.t0) * 0.6 + F.wobble) * 0.12;
      const c = Math.cos(heading);
      const s2 = Math.sin(heading);
      const sl = F.slots[i];
      // Each bird keeps its place loosely, bobbing a little out of step.
      const bob = Math.sin(t * 1.3 + i * 1.7) * F.span * 0.15;
      b.g.position.set(F.pos.x + c * sl.x - s2 * (sl.y + bob), F.pos.y + s2 * sl.x + c * (sl.y + bob), sky.eye.z + depth);
      b.g.rotation.set(0, 0, heading);
      b.g.scale.setScalar(F.span);
      b.g.visible = show > 0.05;
      // Beat, beat, beat... and now and then a glide on still wings.
      if (t > b.glideAt) {
        b.gliding = !b.gliding && Math.random() < 0.4;
        b.glideAt = t + (b.gliding ? 0.6 + Math.random() * 0.8 : 1 + Math.random() * 2);
      }
      b.phase += dt * (b.gliding ? 0 : b.rate);
      const flap = b.gliding ? 0.15 : Math.sin(b.phase) * 0.85;
      b.right.rotation.x = flap;
      b.left.rotation.x = -flap;
    });
    if (F) {
      F.pos.addScaledVector(F.dir, F.speed * dt);
      const away = new THREE.Vector2(F.pos.x - cx, F.pos.y - cy);
      if (away.length() > F.R0 * 1.25 && away.dot(F.dir) > 0) {
        B.flock = null;
        sky.nextBirds = t + 15 + Math.random() * 20;
      }
      if (n.dir < 0) B.flock = null;
    }
  }

  flyPlanes(t, dt, show, p) {
    const sky = this.sky;
    const P = sky.planes;
    const n = this.night;
    if (!P) return;
    const k = P.depth / sky.D;
    const unit = (sky.viewW / this.w) * k;
    const cx = sky.eye.x;
    const cy = sky.eye.y;
    if (!P.active && !this.reduced && n.dir > 0 && p >= 1 && t > sky.nextPlane) {
      const a = Math.random() * TAU;
      const R0 = sky.viewW * k * 0.75;
      const side = (Math.random() - 0.5) * sky.viewH * k * 0.7;
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const from = new THREE.Vector2(cx - dir.x * R0 - dir.y * side, cy - dir.y * R0 + dir.x * side);
      P.active = { pos: from, dir, speed: (R0 * 2) / (14 + Math.random() * 8), R0, len: (30 + Math.random() * 10) * unit, sinceTrail: 0, wing: 0 };
    }
    const A = P.active;
    if (A) {
      A.pos.addScaledVector(A.dir, A.speed * dt);
      const heading = Math.atan2(A.dir.y, A.dir.x);
      const z = sky.eye.z + P.depth;
      P.plane.position.set(A.pos.x, A.pos.y, z);
      P.plane.rotation.set(0, 0, heading);
      P.plane.scale.setScalar(A.len);
      P.plane.visible = !sky.time.dark && show > 0.05;
      const across = (x, y) => new THREE.Vector3(A.pos.x + Math.cos(heading) * x * A.len - Math.sin(heading) * y * A.len, A.pos.y + Math.sin(heading) * x * A.len + Math.cos(heading) * y * A.len, z - 2);
      if (P.lights) {
        const L = P.lights;
        const px = unit * 7;
        L.red.position.copy(across(-0.18, -0.5));
        L.green.position.copy(across(-0.18, 0.5));
        L.strobe.position.copy(across(-0.5, 0));
        [L.red, L.green].forEach((sp) => {
          sp.visible = true;
          sp.scale.setScalar(px);
          sp.material.opacity = 0.9 * show * (0.75 + 0.25 * Math.sin(t * 3));
        });
        const flash = (t % 1.3) < 0.07 ? 1 : 0;
        L.strobe.visible = flash > 0;
        L.strobe.scale.setScalar(px * 1.8);
        L.strobe.material.opacity = flash * show;
      }
      // Two engines, a little in from the wingtips, each leaving its trail.
      if (P.trail) {
        A.sinceTrail += dt;
        while (A.sinceTrail > 0.07) {
          A.sinceTrail -= 0.07;
          for (const y of [-0.27, 0.27]) {
            const q = P.puffs[P.next];
            P.next = (P.next + 1) % P.puffs.length;
            q.age = 0;
            q.pos = across(-0.15, y);
            q.pos.z += 6;
            q.drift = new THREE.Vector2(-Math.sin(heading) * y, Math.cos(heading) * y).multiplyScalar(unit * 6);
          }
        }
      }
      if (A.pos.distanceTo(new THREE.Vector2(cx, cy)) > A.R0 * 1.15 && A.dir.dot(new THREE.Vector2(A.pos.x - cx, A.pos.y - cy)) > 0) {
        P.active = null;
        P.plane.visible = false;
        if (P.lights) Object.values(P.lights).forEach((sp) => (sp.visible = false));
        sky.nextPlane = t + 25 + Math.random() * 30;
      }
    }
    if (n.dir < 0 && P.active) {
      P.active = null;
      P.plane.visible = false;
      if (P.lights) Object.values(P.lights).forEach((sp) => (sp.visible = false));
    }
    // The trails: thin and bright where the plane just was, spreading and fading behind it.
    if (P.trail) {
      const g = P.trail.geometry.attributes;
      const life = 9;
      P.puffs.forEach((q, i) => {
        if (q.age < 0) return;
        q.age += dt;
        if (q.age > life) {
          q.age = -1;
          g.alpha.setX(i, 0);
          return;
        }
        const f = q.age / life;
        q.pos.x += q.drift.x * dt;
        q.pos.y += q.drift.y * dt;
        g.position.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
        g.size.setX(i, lerp(4, 30, Math.sqrt(f)));
        g.alpha.setX(i, 0.85 * (1 - f) ** 1.6);
      });
      g.position.needsUpdate = true;
      g.size.needsUpdate = true;
      g.alpha.needsUpdate = true;
    }
  }

  /* By day, eyes in the clouds; at night, the lights. */
  skyEyes(t, dt, show, p) {
    if (this.reduced) return;
    if (this.sky.time.clouds) this.cloudEyes(t, show, p);
    else this.nightLights(t, dt, show, p);
  }

  /* Where a puff of cloud is now: one of the logo's, or one drifting across the sky. */
  puffAt(host, out) {
    const sky = this.sky;
    if (host.drift) {
      const c = sky.drift[host.i];
      return out.set(c.x === undefined ? c.p.x : c.x, c.p.y, c.p.z);
    }
    const fp = sky.fpos;
    return out.set(fp[host.i * 3], fp[host.i * 3 + 1], fp[host.i * 3 + 2]);
  }

  /*
   * Something in the clouds: one eye, or two or three together, push out of
   * a puff, glance about, settle on the viewer, blink, and sink back in.
   * Coming out they are drawn beneath the cloud, so it veils them; once out,
   * over it.
   */
  cloudEyes(t, show, p) {
    const sky = this.sky;
    const n = this.night;
    const gaze = this.skyGazePoint(this.tmp);
    if (n.dir > 0 && p >= 1 && n.since > 3 && t > sky.nextPeek) {
      const free = sky.peekers.filter((e) => !e.live);
      const want = Math.random() < 0.3 ? Math.min(free.length, 2 + (Math.random() < 0.4 ? 1 : 0)) : Math.min(free.length, 1);
      if (want) {
        // A drifting cloud that is on screen now, or else one of the logo's puffs.
        let host = null;
        if (sky.drift.length && Math.random() < 0.5) {
          for (let k = 0; k < 12 && !host; k++) {
            const i = (Math.random() * sky.drift.length) | 0;
            const c = sky.drift[i];
            if (!c.far && !c.heap && Math.abs((c.x === undefined ? c.p.x : c.x) - sky.eye.x) < sky.viewW * 0.42 && Math.abs(c.p.y - sky.eye.y) < sky.viewH * 0.4) host = { drift: true, i, r: c.r };
          }
        }
        if (!host) {
          const q = sky.puffs[(Math.random() * sky.puffs.length) | 0];
          host = { i: q ? q.flower : 0, r: q ? q.r : this.base };
        }
        const inDrift = !!host.drift;
        const t0 = t;
        const life = 4.5 + Math.random() * 2.5;
        // Drifting clouds are bigger: so are what live in them.
        const size = inDrift ? 1.8 + Math.random() * 0.5 : 0.9 + Math.random() * 0.25;
        free.slice(0, want).forEach((e, k) => {
          const a = Math.random() * TAU;
          const spread = k ? host.r * 0.55 : 0;
          Object.assign(e, {
            live: true, host, t0: t0 + k * (0.2 + Math.random() * 0.5), life, size,
            off: new THREE.Vector3(Math.cos(a) * spread, Math.sin(a) * spread * 0.6, 0),
            nextBlink: t0 + 1.8 + Math.random() * 1.5, blinkAt: -1, darting: null, dartAt: 0,
          });
        });
      }
      sky.nextPeek = t + 5 + Math.random() * 8;
    }
    const at = new THREE.Vector3();
    for (const e of sky.peekers) {
      if (!e.live) continue;
      const age = t - e.t0;
      if (age < 0) continue;
      const out = smooth(range(age, 0, 0.9)) * (1 - smooth(range(age, e.life - 0.8, e.life)));
      this.puffAt(e.host, at).add(e.off);
      // Out through the lobe's surface toward the viewer, and back in.
      at.z -= lerp(e.host.r * 0.3, e.host.r * 0.92, out);
      e.group.position.copy(at);
      e.group.scale.setScalar(e.size * lerp(0.6, 1, out));
      e.group.visible = show > 0.05;
      const open = smooth(range(age, 0.5, 1.2)) * (1 - smooth(range(age, e.life - 1.3, e.life - 0.7)));
      this.lids(e, open, t);
      // First it looks about, darting; then it finds the viewer and stays on them.
      if (age < e.life * 0.45) {
        if (t > e.dartAt) {
          e.darting = new THREE.Vector3((Math.random() - 0.5) * sky.viewW, (Math.random() - 0.5) * sky.viewH, sky.eye.z);
          e.dartAt = t + 0.35 + Math.random() * 0.6;
        }
        e.ball.lookAt(e.darting);
      } else e.ball.lookAt(gaze);
      if (age > e.life || n.dir < 0) {
        e.live = false;
        e.group.visible = false;
      }
    }
  }

  /*
   * Lights in the night sky, easy to miss. One (now and then two) blinks on
   * somewhere at random, faint and small, maybe makes one instant
   * right-angle jump, and almost as soon as it has been noticed shoots off
   * into the distance in a smear of light and is gone.
   */
  nightLights(t, dt, show, p) {
    const sky = this.sky;
    const n = this.night;
    const plane = sky.D * 1.05;
    const world = (nx, ny, depth) => {
      const k = depth / sky.D;
      return new THREE.Vector3(sky.eye.x + nx * sky.viewW * 0.5 * k, sky.eye.y - ny * sky.viewH * 0.5 * k, sky.eye.z + depth);
    };
    if (!sky.encounter && n.dir > 0 && p >= 1 && n.since > 4 && t > sky.nextEncounter) {
      const count = Math.random() < 0.8 ? 1 : 2;
      // Anywhere in view; at most one sudden hop before it leaves.
      const hops = [];
      const x0 = (Math.random() - 0.5) * 1.6;
      const y0 = (Math.random() - 0.5) * 1.5;
      let x = x0;
      let y = y0;
      const moves = Math.random() < 0.5 ? 0 : 1;
      let time0 = 0.25;
      for (let i = 0; i < moves; i++) {
        const hold = 0.4 + Math.random() * 0.8;
        // Mostly straight across or straight up and down: right angles.
        if (Math.random() < 0.5) x = clamp(x + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.5), -0.85, 0.85);
        else y = clamp(y + (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.4), -0.8, 0.8);
        hops.push({ at: time0 + hold, x, y, dur: 0.07 + Math.random() * 0.12 });
        time0 += hold + 0.2;
      }
      const a = Math.random() * TAU;
      sky.encounter = {
        t0: t, hops, start: [x0, y0],
        exitAt: time0 + 0.35 + Math.random() * 0.9, exitDir: [Math.cos(a), Math.sin(a)],
        glow: 0.55 + Math.random() * 0.45,
        formation: [0, 1].slice(0, count).map((i) => ({ dx: (i - (count - 1) / 2) * 0.05, dy: (i % 2) * 0.04, rogue: false })),
        hue: Math.random() < 0.5 ? [150, 255, 214] : [170, 200, 255],
      };
    }
    const enc = sky.encounter;
    sky.orbs.forEach((o, i) => {
      const f = enc && enc.formation[i];
      if (!f || n.dir < 0) {
        o.aura.visible = o.halo.visible = o.core.visible = false;
        o.ghosts.forEach((g) => (g.visible = false));
        o.trail.length = 0;
        return;
      }
      const age = t - enc.t0;
      // Where the route has got to: a still hold, or an instant hop with no easing in or out.
      let [x, y] = enc.start;
      for (const h of enc.hops) {
        if (age >= h.at + h.dur) [x, y] = [h.x, h.y];
        else if (age >= h.at) {
          const k = (age - h.at) / h.dur;
          x = lerp(x, h.x, k);
          y = lerp(y, h.y, k);
          break;
        } else break;
      }
      // The rogue breaks away to one side for a while, then snaps back into place.
      let bx = f.dx;
      let by = f.dy;
      if (f.rogue && enc.hops.length && age > enc.hops[0].at + 0.3 && age < enc.exitAt - 1.2) bx += Math.sin(age * 1.7) > 0.4 ? 0.22 : 0;
      // Hanging still, but never quite still.
      const jit = 0.004;
      x += bx + Math.sin(t * 13 + i * 2) * jit;
      y += by + Math.cos(t * 11 + i * 3) * jit;
      let depth = plane;
      let fade = smooth(range(age, 0, 0.22)) * enc.glow;
      const out = age - enc.exitAt;
      if (out > 0) {
        // Gone: off into the distance faster than the eye can follow.
        const k = out / 0.4;
        depth = plane * (1 + k * k * 9);
        x += enc.exitDir[0] * k * k * 1.6;
        y += enc.exitDir[1] * k * k * 1.6;
        fade *= 1 - smooth(range(k, 0.55, 1));
      }
      const pos = world(x, y, depth);
      o.trail.unshift(pos.clone());
      if (o.trail.length > 8) o.trail.pop();
      const px = (sky.viewW / this.w) * (depth / sky.D);
      const pulse = 1 + 0.18 * Math.sin(t * 7.5 + i);
      o.aura.position.copy(pos);
      o.halo.position.copy(pos);
      o.core.position.copy(pos);
      // A wide faint aura that breathes, a bright halo, a hard white core.
      o.aura.scale.setScalar(80 * px * (1 + 0.25 * Math.sin(t * 2.3 + i)));
      o.halo.scale.setScalar(34 * px * pulse);
      o.core.scale.setScalar(10 * px);
      o.aura.material.color.copy(toColor(enc.hue));
      o.halo.material.color.copy(toColor(enc.hue));
      o.aura.material.opacity = 0.1 * fade * show;
      o.halo.material.opacity = 0.55 * fade * show;
      o.core.material.opacity = 0.9 * fade * show;
      o.aura.visible = o.halo.visible = o.core.visible = fade > 0.01;
      // A smear behind it while it moves fast; none while it hangs still.
      const prev = o.trail[1];
      const speed = prev ? pos.distanceTo(prev) / Math.max(1e-3, dt) / (sky.viewW * (depth / sky.D)) : 0;
      const smear = clamp((speed - 0.6) / 3, 0, 1);
      o.ghosts.forEach((g, k) => {
        const q = o.trail[k + 1];
        g.visible = !!q && smear > 0.02 && fade > 0.01;
        if (!g.visible) return;
        g.position.copy(q);
        g.scale.setScalar(26 * px * (1 - k / 9));
        g.material.color.copy(toColor(enc.hue));
        g.material.opacity = 0.35 * smear * fade * show * (1 - k / 7);
      });
    });
    if (enc && t - enc.t0 > enc.exitAt + 0.5) {
      sky.encounter = null;
      sky.nextEncounter = t + 8 + Math.random() * 30;
    }
    if (n.dir < 0) sky.encounter = null;
  }

  /*
   * Two fingers swiped across the flowers: up starts the hidden game, down
   * lies back to look at the sky. In the sky, swiping up gets back up.
   */
  twoFingerSwipe(dir) {
    if (this.classList.contains('is-nav-open') || !this.arranged || this.failed) return;
    this.gestured = true;
    if (this.night) {
      if (dir === 'up' && this.night.dir > 0) this.toggleNight();
      return;
    }
    if (dir === 'down') {
      this.toggleNight();
      return;
    }
    if (this.eggEnabled()) {
      if (this.egg) this.egg.taps = 0;
      window.dispatchEvent(new CustomEvent('duet:egg', { detail: { garden: this } }));
    }
  }

  /* ---------------- zooming in the sky ---------------- */

  /* Lying on the bed, looking up, and not on the way in or out. */
  lyingDown() {
    return !!(this.night && this.night.dir > 0 && this.night.t >= 1 && this.sky);
  }

  /* Zooms the sky view to z, keeping the sky under the screen point (sx, sy) in place. */
  skyZoomTo(z, sx, sy) {
    const sv = this.skyView;
    const fov0 = (this.sky.fov * Math.PI) / 180;
    const aspect = this.w / this.h;
    const tv = (zz) => Math.tan(fov0 / 2 / zz);
    const nx = (sx / this.w) * 2 - 1;
    const ny = 1 - (sy / this.h) * 2;
    const ax = sv.tax + Math.atan(nx * tv(sv.tz) * aspect);
    const ay = sv.tay + Math.atan(ny * tv(sv.tz));
    sv.tz = clamp(z, 1, 6);
    sv.tax = ax - Math.atan(nx * tv(sv.tz) * aspect);
    sv.tay = ay - Math.atan(ny * tv(sv.tz));
    this.clampSkyView();
  }

  skyPan(dx, dy) {
    const sv = this.skyView;
    const k = (2 * Math.atan(Math.tan((this.sky.fov * Math.PI) / 360 / sv.tz))) / this.h;
    sv.tax -= dx * k;
    sv.tay += dy * k;
    this.clampSkyView();
  }

  /* Keeps the zoomed view inside the sky first seen. */
  clampSkyView() {
    const sv = this.skyView;
    const fov0 = (this.sky.fov * Math.PI) / 180;
    const aspect = this.w / this.h;
    const lim = (k) => Math.atan(Math.tan(fov0 / 2) * k) - Math.atan((Math.tan(fov0 / 2) * k) / sv.tz);
    sv.tax = clamp(sv.tax, -lim(aspect), lim(aspect));
    sv.tay = clamp(sv.tay, -lim(1), lim(1));
    this.start();
  }

  /* ---------------- seasons and weather ---------------- */

  /*
   * The season now (by the visitor's date, or the one chosen in the theme
   * editor) and how much of each kind of weather it brings, rising to a
   * peak mid-season and shading into the next one at its end: the last
   * weeks of autumn bring the first snow, early spring the last of it,
   * late summer the first falling leaves.
   */
  season() {
    const fixed = SEASON_NAMES.includes(this.seasonSetting);
    const s = fixed ? { name: this.seasonSetting, p: 0.5 } : seasonOf(new Date(), this.south);
    const peak = 0.45 + 0.55 * Math.sin(Math.PI * s.p);
    const w = { snow: 0, rain: 0, leaves: 0, petals: 0, pollen: 0 };
    if (s.name === 'winter') {
      w.snow = peak;
    } else if (s.name === 'spring') {
      w.rain = 0.9 * peak;
      w.petals = 0.6;
      w.snow = Math.max(0, 0.25 - s.p) * 1.6;
    } else if (s.name === 'summer') {
      w.pollen = peak;
      w.leaves = Math.max(0, s.p - 0.8) * 2;
    } else {
      w.leaves = peak;
      w.snow = Math.max(0, s.p - 0.75) * 1.6;
    }
    return Object.assign(s, { weights: w });
  }

  dayLight() {
    const look = SEASON_LOOK[(this.seasonNow && this.seasonNow.name) || 'spring'];
    const base = mix(POWDER, this.soil, 0.4);
    const wet = this.weather ? this.weather.wet : 0;
    return {
      key: look.key * (1 - 0.18 * wet),
      keyColor: look.keyColor,
      amb: look.amb,
      ambColor: look.ambTint ? mix(base, look.ambTint, 0.3) : base,
    };
  }

  applyDayLight() {
    if (!this.keyLight || !this.ambient || this.night) return;
    const day = this.dayLight();
    this.keyLight.intensity = day.key;
    this.keyLight.color.copy(toColor(day.keyColor));
    this.ambient.intensity = day.amb;
    this.ambient.color.copy(toColor(day.ambColor));
  }

  /*
   * The weather, made once; each frame only as much is drawn as the season
   * calls for. Snow, rain, leaves and petals come down from above the camera
   * toward the ground (seen from straight above, they drift in from the edges
   * and close in as they fall) and land: on the soil, or on a flower head.
   * What lands stays and builds up: a blanket of snow, puddles and beads of
   * water, drifts of leaves and petals. Out of season it melts, dries or
   * wilts away again. Pollen still rises off the flowers.
   */
  buildWeather() {
    const group = new THREE.Group();
    const disposables = [];
    const add = (o, ...extra) => {
      o.frustumCulled = false;
      group.add(o);
      disposables.push(...extra);
      return o;
    };
    const instanced = (n, geo, mat, colors) => {
      const o = add(new THREE.InstancedMesh(geo, mat, n));
      o.count = 0;
      o.colors = colors;
      if (colors) {
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) o.setColorAt(i, c.copy(toColor(pick(Math.random, colors))));
      }
      disposables.push(o);
      return o;
    };
    const flake = new THREE.IcosahedronGeometry(1, 0);
    const ring = new THREE.RingGeometry(0.72, 1, 10);
    const disc = new THREE.CircleGeometry(1, 10);
    disposables.push(flake, ring, disc);
    const snowColor = [214, 224, 240];
    const snowMat = new THREE.MeshBasicMaterial({ color: toColor(snowColor), fog: false });
    // Settled snow a shade bluer than the page when the page is light, so the blanket still reads.
    const pileMat = this.snapMaterial(new THREE.MeshLambertMaterial({ color: toColor(this.isLight ? [204, 216, 236] : [236, 241, 250]), flatShading: true }));
    const water = mix(POWDER, OCEAN, 0.25);
    // Puddles: darker than light ground, a sheen on dark ground.
    const puddleMat = new THREE.MeshBasicMaterial({ color: toColor(this.isLight ? tone(mix(this.soil, OCEAN, 0.45), -0.25) : mix(this.soil, POWDER, 0.5)), transparent: true, opacity: 0.32, depthWrite: false });
    const splashMat = new THREE.MeshBasicMaterial({ color: toColor(water), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const beadMat = this.makeMaterial({ color: toColor(tone(water, 0.3)), shininess: 60, specular: 0x888888 });
    disposables.push(snowMat, pileMat, puddleMat, splashMat, beadMat);
    const leafColors = [[166, 39, 73], [201, 104, 52], [222, 150, 60], [140, 70, 40], [240, 78, 98]];
    const petalColors = [[255, 255, 255], [255, 210, 220], [240, 78, 98], [185, 229, 251]];

    const pollenGeo = new THREE.BufferGeometry();
    pollenGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(140 * 3), 3));
    pollenGeo.setDrawRange(0, 0);
    const pollenMat = new THREE.PointsMaterial({ color: toColor([242, 178, 70]), size: 2 / Math.max(0.5, this.rs || 1), sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(260 * 6), 3));
    rainGeo.setDrawRange(0, 0);
    const rainMat = new THREE.LineBasicMaterial({ color: toColor(water), transparent: true, opacity: 0.55, depthWrite: false, fog: false });

    // Each kind in the air, and what it leaves where it lands (with how much of it there can be).
    const kinds = {
      snow: { n: 420, o: instanced(420, flake, snowMat), pile: 'snow' },
      rain: { n: 260, o: add(new THREE.LineSegments(rainGeo, rainMat), rainGeo, rainMat) },
      leaves: { n: 70, o: instanced(70, this.geometries.leaf, this.materials.foliage, leafColors), pile: 'leaves' },
      petals: { n: 60, o: instanced(60, this.geometries.round, this.materials.petal, petalColors), pile: 'petals' },
      pollen: { n: 140, o: add(new THREE.Points(pollenGeo, pollenMat), pollenGeo, pollenMat) },
    };
    for (const k of Object.values(kinds)) k.p = Array.from({ length: k.n }, () => ({ x: 0, y: 0, z: -1e6, s: Math.random(), ph: Math.random() * TAU, spin: Math.random() * TAU, live: false }));
    const piles = {
      snow: { o: instanced(1500, flake, pileMat), items: [] },
      leaves: { o: instanced(480, this.geometries.leaf, this.materials.foliage, leafColors), items: [] },
      petals: { o: instanced(300, this.geometries.round, this.materials.petal, petalColors), items: [] },
      puddles: { o: instanced(40, disc, puddleMat), items: [] },
      splashes: { o: instanced(90, ring, splashMat), items: [] },
      beads: { o: instanced(220, flake, beadMat), items: [] },
    };
    for (const p of Object.values(piles)) p.cap = p.o.instanceMatrix.count;
    piles.puddles.o.renderOrder = -1;
    group.renderOrder = 5;
    this.scene.add(group);
    this.weather = { group, disposables, kinds, piles, wet: 0, wind: 0, shower: Math.random() * TAU, flurry: Math.random() * TAU, dummy: new THREE.Object3D(), v: new THREE.Vector3() };
  }

  /* Where a point at height z can be and still be on screen: the view narrows toward the camera. */
  weatherBox(z) {
    const k = (this.camDist - z) / this.camDist;
    return { x0: this.w / 2 - (this.w / 2) * k, x1: this.w / 2 + (this.w / 2) * k, y0: this.h / 2 - (this.h / 2) * k, y1: this.h / 2 + (this.h / 2) * k };
  }

  /* How hard the passing gust pushes at screen x (signed by its direction), 0 with none. */
  gustPush(x) {
    const g = this.gust;
    if (!g || this.gustFront === undefined) return 0;
    const behind = (this.gustFront - x) * g.dir;
    const k = behind < 0 ? Math.exp(-((behind / (g.width * 0.35)) ** 2)) : Math.exp(-behind / g.width) * (1 + 0.25 * Math.sin(behind * 0.05));
    return g.dir * k * g.strength;
  }

  /* The open flower whose head is under (x, y), the highest if heads overlap, or null. */
  headUnder(x, y) {
    let best = null;
    for (const f of this.flowers) {
      if (f.p < STAGE.bud[1] || f.g < 0.3) continue;
      const r = f.r * f.g * 0.8;
      const dx = x - f.x;
      const dy = y - (this.h - f.y);
      if (dx * dx + dy * dy < r * r && (!best || f.z > best.z)) best = f;
    }
    return best;
  }

  /* Puts something down where a particle landed, on the pile of its kind; a full pile gives up its oldest. */
  layDown(pile, item) {
    const W = this.weather;
    const P = W.piles[pile];
    if (P.items.length >= P.cap) this.pickUp(P, 0);
    item.i = P.items.length;
    item.c = P.o.colors ? pick(Math.random, P.o.colors) : null;
    if (item.f) item.f.wl = (item.f.wl || 0) + 1;
    P.items.push(item);
    if (item.c) {
      P.o.setColorAt(item.i, toColor(item.c));
      P.o.instanceColor.needsUpdate = true;
    }
    return item;
  }

  pickUp(P, i) {
    const items = P.items;
    const gone = items[i];
    if (gone.f) gone.f.wl = Math.max(0, (gone.f.wl || 0) - 1);
    // Keep the oldest first: shift down rather than swap, so the pile gives up its oldest next time too.
    items.splice(i, 1);
    if (P.o.colors) {
      for (let k = i; k < items.length; k++) P.o.setColorAt(k, toColor(items[k].c));
      P.o.instanceColor.needsUpdate = true;
    }
  }

  updateWeather(t, dt) {
    if (!this.camDist || !this.w) return;
    // The season is looked at again every minute, so a visit across a season's turn still follows it.
    if (!this.seasonNow || t - (this.seasonAt || 0) > 60) {
      this.seasonNow = this.season();
      this.seasonAt = t;
      this.applyDayLight();
    }
    if (!this.weather) this.buildWeather();
    const W = this.weather;
    const quiet = this.reduced;
    W.group.visible = !quiet;
    if (quiet) return;
    const w = this.seasonNow.weights;

    // A new layout, or new flowers: what had settled no longer lines up, so it is cleared.
    const layout = this.w + 'x' + this.h;
    if (W.layout !== layout || W.flowers !== this.flowers) {
      if (W.layout !== layout) for (const P of Object.values(W.piles)) P.items.length = 0;
      else for (const P of Object.values(W.piles)) P.items = P.items.filter((it) => !it.f);
      for (const P of Object.values(W.piles)) if (P.o.colors) P.items.forEach((it, i) => P.o.setColorAt(i, toColor(it.c)));
      W.layout = layout;
      W.flowers = this.flowers;
      // Leaves and petals sized to the flowers they fall among.
      const radii = this.flowers.map((f) => f.r).sort((a, b) => a - b);
      W.r = radii.length ? radii[radii.length >> 1] : 20;
    }

    // How hard it is coming down right now: snow in flurries, rain in passing showers.
    const flurry = 0.55 + 0.45 * Math.sin(t * 0.05 + W.flurry);
    const shower = smooth(clamp((Math.sin((t * TAU) / 80 + W.shower) - 0.1) * 2, 0, 1));
    const level = {
      snow: w.snow * flurry,
      rain: w.rain * shower,
      leaves: w.leaves * (0.7 + 0.3 * Math.sin(t * 0.07)),
      // Petals drift between showers.
      petals: w.petals * (1 - shower),
      pollen: w.pollen,
    };
    const wetBefore = W.wet;
    W.wet = lerp(W.wet, level.rain > 0.05 ? 1 : 0, 1 - Math.exp(-dt * 0.8));
    if (Math.abs(W.wet - wetBefore) > 0.002) this.applyDayLight();

    // The wind: a light drift, pushed hard while a gust sweeps through.
    const gust = this.gust ? this.gust.dir * 140 * this.gust.strength : 0;
    W.wind = lerp(W.wind, (this.seasonNow.name === 'autumn' ? 25 : 10) + gust, 1 - Math.exp(-dt * 2));
    const d = W.dummy;
    // In the sky view the bed's weather keeps falling (and building up) out of sight, from where it would above the bed.
    const camZ = this.night ? this.camBase.z : this.camera.position.z;
    // Things come into view from well above the flowers, below the camera.
    const top = FLOOR_Z + (camZ - FLOOR_Z) * 0.62;
    const ground = this.weatherBox(FLOOR_Z);
    let heads = FLOOR_Z;
    for (const f of this.flowers) heads = Math.max(heads, f.z + f.lift);
    heads += 8;
    // On a flower head there is room for only so much before the rest slides off onto the soil.
    const room = { snow: 16, rain: 5, leaves: 2, petals: 3 };

    for (const [name, kind] of Object.entries(W.kinds)) {
      const want = Math.round(kind.n * clamp(level[name], 0, 1));
      let shown = 0;
      for (let i = 0; i < kind.n; i++) {
        const q = kind.p[i];
        const rising = name === 'pollen';
        if (!q.live) {
          if (i >= want) continue;
          q.live = true;
          q.checked = false;
          q.on = null;
          if (rising) {
            // Pollen: anywhere in view at first, after that up off the flowers.
            q.z = lerp(30, this.camDist * 0.45, Math.random());
            const b = this.weatherBox(q.z);
            q.x = lerp(b.x0 - 40, b.x1 + 40, Math.random());
            q.y = q.first ? b.y0 - 10 : lerp(b.y0, b.y1, Math.random());
          } else {
            // Anywhere from the top down when the weather first starts, from the top after that.
            q.z = q.first ? top : lerp(heads, top, Math.random());
            // Aim for anywhere on the ground in view, starting upwind of it.
            const fall = (q.z - FLOOR_Z) / (name === 'rain' ? 1200 : name === 'snow' ? 80 : 75);
            const drift = W.wind * (name === 'rain' ? 1.5 : name === 'snow' ? 0.6 : 1.4) * fall;
            q.x = lerp(ground.x0 - 30, ground.x1 + 30, Math.random()) - drift;
            q.y = lerp(ground.y0 - 30, ground.y1 + 30, Math.random());
          }
          q.first = true;
        }
        // Each kind falls (or rises) in its own way. World y is up the screen, z up toward the camera.
        const sway = Math.sin(t * (1.1 + q.s) + q.ph);
        const sway2 = Math.cos(t * (0.9 + q.s) + q.ph * 1.7);
        let vx = 0;
        let vy = 0;
        let vz = 0;
        if (name === 'snow') {
          vz = -(55 + 50 * q.s);
          vx = W.wind * 0.6 + sway * 14;
          vy = sway2 * 10;
        } else if (name === 'rain') {
          vz = -(1050 + 300 * q.s);
          vx = W.wind * 1.5;
        } else if (name === 'leaves' || name === 'petals') {
          // Falling leaf: slips sideways and checks its fall as it swings.
          vz = -((name === 'leaves' ? 60 : 40) + 30 * q.s) * (0.75 + 0.45 * Math.abs(sway));
          vx = W.wind * 1.4 + sway * 38;
          vy = sway2 * 24;
          q.spin += dt * (1.5 + q.s * 2);
        } else {
          vy = 8 + 10 * q.s;
          vx = W.wind * 0.4 + sway * 10;
        }
        q.x += vx * dt;
        q.y += vy * dt;
        q.z += vz * dt;

        if (rising) {
          const b = this.weatherBox(q.z);
          if (q.y > b.y1 + 40 || q.x < b.x0 - 120 || q.x > b.x1 + 120) q.live = false;
          else kind.o.geometry.attributes.position.setXYZ(shown++, q.x, q.y, q.z);
          continue;
        }

        // Once down among the flowers: is there a head under it with room left?
        if (!q.checked && q.z < heads) {
          q.checked = true;
          const f = this.headUnder(q.x, q.y);
          q.on = f && (f.wl || 0) < room[name] * (name === 'snow' ? f.r / 30 : 1) ? f : null;
        }
        const landZ = q.on ? q.on.z + q.on.lift + 3 : FLOOR_Z + 0.5;
        if (q.z <= landZ) {
          this.land(name, q, t);
          q.live = false;
          continue;
        }
        if (q.x < ground.x0 - 400 || q.x > ground.x1 + 400) {
          q.live = false;
          continue;
        }

        if (name === 'rain') {
          // A streak along its fall: seen from above, longest close to the camera.
          const pos = kind.o.geometry.attributes.position;
          pos.setXYZ(shown * 2, q.x, q.y, q.z);
          pos.setXYZ(shown * 2 + 1, q.x - vx * 0.04, q.y, q.z + 60);
        } else if (name === 'snow') {
          const size = 1.6 + q.s * 1.4;
          d.position.set(q.x, q.y, q.z);
          d.rotation.set(q.ph, q.spin, 0);
          d.scale.setScalar(size);
          d.updateMatrix();
          kind.o.setMatrixAt(shown, d.matrix);
        } else {
          const size = W.r * (name === 'leaves' ? 2.2 : 1.1);
          d.position.set(q.x, q.y, q.z);
          d.rotation.set(Math.sin(q.spin) * 1.2, q.spin * 0.7, q.spin + q.ph);
          d.scale.set(size, size * 0.6, size * 0.6);
          d.updateMatrix();
          kind.o.setMatrixAt(shown, d.matrix);
        }
        shown++;
      }
      if (kind.o.isInstancedMesh) {
        kind.o.count = shown;
        kind.o.instanceMatrix.needsUpdate = true;
      } else {
        kind.o.geometry.setDrawRange(0, name === 'rain' ? shown * 2 : shown);
        kind.o.geometry.attributes.position.needsUpdate = true;
      }
    }
    this.updatePiles(t, dt, w, level);
    for (const kind of Object.values(W.kinds)) kind.o.visible = !this.night || !!this.explorer;
    if (this.night || W.sky) this.skyWeather(t, dt, level);
  }

  /*
   * The same weather, seen lying on your back in the flowers (the sky view).
   * It comes down out of the sky straight at you: specks far off that grow
   * and spread outward as they near, rain as streaks bursting out from the
   * middle. Now and then something lands right on you: a flake that melts,
   * or a raindrop that slides and dries. Leaves and petals tumble past and
   * sweep out of view.
   */
  buildSkyWeather() {
    const W = this.weather;
    const group = new THREE.Group();
    const disposables = W.disposables;
    const instanced = (n, geo, mat, colors) => {
      const o = new THREE.InstancedMesh(geo, mat, n);
      o.count = 0;
      o.frustumCulled = false;
      if (colors) {
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) o.setColorAt(i, c.copy(toColor(colors[i % colors.length])));
      }
      group.add(o);
      disposables.push(o);
      return o;
    };
    const flake = new THREE.IcosahedronGeometry(1, 0);
    const disc = new THREE.CircleGeometry(1, 12);
    disposables.push(flake, disc);
    const water = mix(POWDER, OCEAN, 0.25);
    const snowMat = new THREE.MeshBasicMaterial({ color: toColor([232, 238, 250]), fog: false });
    const rainMat = new THREE.LineBasicMaterial({ color: toColor(tone(water, 0.25)), transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    const pollenMat = new THREE.MeshBasicMaterial({ color: toColor([242, 178, 70]), fog: false });
    // On the lens: always in front of everything.
    const lens = { transparent: true, depthTest: false, depthWrite: false, fog: false };
    const meltMat = new THREE.MeshBasicMaterial(Object.assign({ color: toColor([240, 245, 255]), opacity: 0.85 }, lens));
    const dropMat = new THREE.MeshBasicMaterial(Object.assign({ color: toColor(tone(water, 0.5)), opacity: 0.28 }, lens));
    const glintMat = new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff, opacity: 0.75 }, lens));
    const leafMat = this.makeMaterial({ shininess: 10, specular: 0x1e1e1e, side: THREE.DoubleSide, depthTest: false });
    const petalMat = this.makeMaterial({ shininess: 16, side: THREE.DoubleSide, depthTest: false });
    disposables.push(snowMat, rainMat, pollenMat, meltMat, dropMat, glintMat, leafMat, petalMat);
    const leafColors = [[166, 39, 73], [201, 104, 52], [222, 150, 60], [140, 70, 40], [240, 78, 98]];
    const petalColors = [[255, 255, 255], [255, 210, 220], [240, 78, 98], [185, 229, 251]];

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300 * 6), 3));
    rainGeo.setDrawRange(0, 0);
    disposables.push(rainGeo);
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    group.add(rain);

    // How far up each kind comes from, and how often one is aimed right at the viewer.
    const kinds = {
      snow: { n: 600, o: instanced(600, flake, snowMat), far: 1000, aim: 0.08 },
      rain: { n: 300, o: rain, far: 1600, aim: 0.08 },
      // Leaves and petals come from the trees and flowers round about, not the clouds: close, and plainly passing in front.
      leaves: { n: 60, o: instanced(60, this.geometries.leaf, this.materials.foliage, leafColors), far: 360, aim: 0 },
      petals: { n: 50, o: instanced(50, this.geometries.round, this.materials.petal, petalColors), far: 320, aim: 0 },
      pollen: { n: 120, o: instanced(120, flake, pollenMat), far: 420, aim: 0 },
    };
    for (const k of Object.values(kinds)) k.p = Array.from({ length: k.n }, () => ({ live: false, s: Math.random(), ph: Math.random() * TAU, spin: Math.random() * TAU }));
    const on = {
      melt: { o: instanced(60, flake, meltMat), items: [] },
      drops: { o: instanced(80, disc, dropMat), items: [] },
      glints: { o: instanced(80, disc, glintMat), items: [] },
      leaves: { o: instanced(6, this.geometries.leaf, leafMat, leafColors), items: [] },
      petals: { o: instanced(6, this.geometries.round, petalMat, petalColors), items: [] },
    };
    for (const L of Object.values(on)) {
      L.cap = L.o.instanceMatrix.count;
      L.o.renderOrder = 60;
    }
    on.glints.o.renderOrder = 61;
    group.renderOrder = 6;
    group.visible = false;
    this.scene.add(group);
    W.sky = { group, kinds, on, mats: { snow: snowMat, rain: rainMat, drop: dropMat }, q: new THREE.Quaternion(), z: new THREE.Quaternion(), axis: new THREE.Vector3(0, 0, 1) };
  }

  skyWeather(t, dt, level) {
    const W = this.weather;
    const sky = this.sky;
    const n = this.night;
    if (!W.sky) this.buildSkyWeather();
    const S = W.sky;
    const live = !!(n && sky) && n.t > 0.35 && !this.explorer;
    S.group.visible = live;
    if (!live) {
      for (const k of Object.values(S.kinds)) k.p.forEach((q) => (q.live = false));
      for (const L of Object.values(S.on)) L.items.length = 0;
      return;
    }
    const eye = sky.eye;
    const aspect = this.w / this.h;
    // Spread at each height: the whole sky view, unzoomed, a little wider.
    const tan0 = Math.tan((sky.fov * Math.PI) / 360);
    const lensAt = 16;
    const appear = smooth(range(n.t, 0.5, 1)) * (n.dir > 0 ? 1 : n.t);
    const d = W.dummy;
    const r = W.r || 20;
    // Against a bright sky, snow and rain seen from below are grey shapes; at night they catch the light, pale.
    const light = sky.time ? sky.time.light : 0;
    S.mats.snow.color.copy(toColor(mix([236, 240, 250], [128, 138, 162], light)));
    S.mats.rain.color.copy(toColor(mix([200, 214, 236], [96, 116, 150], light)));
    S.mats.rain.opacity = lerp(0.6, 0.7, light);
    S.mats.drop.opacity = lerp(0.3, 0.4, light);

    for (const [name, kind] of Object.entries(S.kinds)) {
      const want = Math.round(kind.n * clamp(level[name], 0, 1) * appear);
      const rising = name === 'pollen';
      let shown = 0;
      for (let i = 0; i < kind.n; i++) {
        const q = kind.p[i];
        if (!q.live) {
          if (i >= want) continue;
          q.live = true;
          if (rising) {
            // Pollen lifts off the flowers round the viewer and floats away up.
            q.z = eye.z + lerp(lensAt, 140, Math.random());
          } else {
            // Out of the far sky (anywhere in the column at first).
            q.z = eye.z + (q.seen ? kind.far : lerp(60, kind.far, Math.random()));
          }
          const depth = q.z - eye.z;
          q.aimed = Math.random() < kind.aim;
          q.x = eye.x + (Math.random() * 2 - 1) * tan0 * aspect * depth * 1.15;
          q.y = eye.y + (Math.random() * 2 - 1) * tan0 * depth * 1.15;
          // Where on the view an aimed one will come down.
          q.tx = eye.x + (Math.random() * 2 - 1) * 0.85 * tan0 * aspect * lensAt;
          q.ty = eye.y + (Math.random() * 2 - 1) * 0.85 * tan0 * lensAt;
          q.ox = q.x - q.tx;
          q.oy = q.y - q.ty;
          q.d0 = depth;
          q.seen = true;
        }
        const sway = Math.sin(t * (1.1 + q.s) + q.ph);
        const sway2 = Math.cos(t * (0.9 + q.s) + q.ph * 1.7);
        let vx = 0;
        let vy = 0;
        let vz = 0;
        if (name === 'snow') {
          vz = -(55 + 50 * q.s);
          vx = W.wind * 0.6 + sway * 14;
          vy = sway2 * 10;
        } else if (name === 'rain') {
          vz = -(1050 + 300 * q.s);
          vx = W.wind * 1.5;
        } else if (name === 'leaves' || name === 'petals') {
          vz = -((name === 'leaves' ? 60 : 40) + 30 * q.s) * (0.75 + 0.45 * Math.abs(sway));
          // Seen from below a leaf mostly slips sideways as it tumbles, each drifting its own way.
          vx = W.wind * 1.4 + sway * 70 + (q.s - 0.5) * 90;
          vy = sway2 * 50 + (q.ph / Math.PI - 1) * 40;
          // Close by, it is falling past the viewer, not onto them: it sweeps out past the edge of the view.
          const near = 1 - clamp((q.z - eye.z - lensAt) / 140, 0, 1);
          if (near > 0) {
            const ox = q.x - eye.x;
            const oy = q.y - eye.y;
            const m = Math.hypot(ox, oy) || 1;
            const out = near * near * 260;
            vx += (ox / m) * out;
            vy += (oy / m) * out;
            vz *= 1 - near * 0.6;
          }
          q.spin += dt * (1.5 + q.s * 2);
        } else {
          vz = 14 + 12 * q.s;
          vx = W.wind * 0.3 + sway * 6;
          vy = sway2 * 6;
        }
        q.x += vx * dt;
        q.y += vy * dt;
        q.z += vz * dt;
        if (q.aimed) {
          // Straight down onto its spot on the viewer: seen from below, it hangs there and grows.
          const k = clamp((q.z - eye.z - lensAt) / Math.max(1, q.d0 - lensAt), 0, 1);
          q.x = q.tx + q.ox * k;
          q.y = q.ty + q.oy * k;
        }
        const depth = q.z - eye.z;
        // Where it is across the view at its height: -1 to 1 edge to edge.
        const nx = (q.x - eye.x) / (tan0 * aspect * Math.max(1, depth));
        const ny = (q.y - eye.y) / (tan0 * Math.max(1, depth));
        if (depth < lensAt) {
          // Reached the viewer: if it is in view, it lands on them (a leaf or petal just goes by).
          if (Math.abs(nx) < 1 && Math.abs(ny) < 1 && name !== 'leaves' && name !== 'petals') this.landOnViewer(name, nx, -ny, t);
          q.live = false;
          continue;
        }
        if (Math.abs(nx) > 1.6 || Math.abs(ny) > 1.6 || depth > kind.far * 1.05) {
          q.live = false;
          continue;
        }
        if (name === 'rain') {
          // A streak along its fall: from below, longest as it rushes past.
          const pos = kind.o.geometry.attributes.position;
          pos.setXYZ(shown * 2, q.x, q.y, q.z);
          pos.setXYZ(shown * 2 + 1, q.x - vx * 0.03, q.y, q.z + 34);
        } else {
          d.position.set(q.x, q.y, q.z);
          if (name === 'snow' || name === 'pollen') {
            d.rotation.set(q.ph, q.spin, 0);
            // Never bigger than a soft fleck, however close it passes.
            d.scale.setScalar(Math.min(name === 'snow' ? 2.2 + q.s * 1.8 : 0.8 + q.s * 0.6, depth * 0.05));
          } else {
            const size = Math.min(r * (name === 'leaves' ? 2.2 : 1.1), depth * 0.3);
            d.rotation.set(Math.sin(q.spin) * 1.2, q.spin * 0.7, q.spin + q.ph);
            d.scale.set(size, size * 0.6, size * 0.6);
          }
          d.updateMatrix();
          kind.o.setMatrixAt(shown, d.matrix);
        }
        shown++;
      }
      if (kind.o.isInstancedMesh) {
        kind.o.count = shown;
        kind.o.instanceMatrix.needsUpdate = true;
      } else {
        kind.o.geometry.setDrawRange(0, shown * 2);
        kind.o.geometry.attributes.position.needsUpdate = true;
      }
    }
    this.updateLens(t, dt);
  }

  /* Something has come down right onto the viewer, at (x, y) across the view (-1 to 1, y up). */
  landOnViewer(name, x, y, t) {
    const S = this.weather.sky;
    const put = (L, item) => {
      if (L.items.length >= L.cap) L.items.shift();
      L.items.push(Object.assign({ x, y, t0: t, yaw: Math.random() * TAU, ph: Math.random() }, item));
    };
    if (name === 'snow') put(S.on.melt, { s: 0.7 + Math.random() * 0.6, life: 1.6 + Math.random() * 1.8 });
    else if (name === 'rain') put(S.on.drops, { s: 0.5 + Math.random() * 0.8, life: 3 + Math.random() * 4, vy: 0 });
    else if (name === 'leaves' || name === 'petals') {
      const colors = name === 'leaves' ? [[166, 39, 73], [201, 104, 52], [222, 150, 60], [140, 70, 40]] : [[255, 255, 255], [255, 210, 220], [240, 78, 98]];
      put(S.on[name], { s: 1, life: 0.7 + Math.random() * 1.2, vx: 0, tip: (Math.random() - 0.5) * 0.6, color: pick(Math.random, colors) });
    }
  }

  /* What has landed on the viewer, drawn just in front of the camera so it stays put as the view turns. */
  updateLens(t, dt) {
    const W = this.weather;
    const S = W.sky;
    const c = this.camera;
    c.updateMatrixWorld();
    const near = 14;
    const hh = near * Math.tan((c.fov * Math.PI) / 360);
    const hw = hh * (this.w / this.h);
    const d = W.dummy;
    const place = (it, lx, ly, spin, sx, sy, sz) => {
      d.position.set(lx * hw, ly * hh, -near).applyMatrix4(c.matrixWorld);
      d.quaternion.copy(c.quaternion).multiply(S.z.setFromAxisAngle(S.axis, spin));
      d.scale.set(sx, sy, sz);
      d.updateMatrix();
    };
    const run = (L, fn) => {
      let i = 0;
      for (const it of L.items) {
        if (fn(it, t - it.t0) === false) continue;
        L.o.setMatrixAt(i++, d.matrix);
      }
      L.items = L.items.filter((it) => !it.gone);
      L.o.count = i;
      L.o.instanceMatrix.needsUpdate = true;
    };
    // Flakes: a white star on the glass that shrinks to nothing.
    run(S.on.melt, (it, age) => {
      const k = 1 - age / it.life;
      if (k <= 0) {
        it.gone = true;
        return false;
      }
      const s = hh * 0.022 * it.s * Math.sqrt(k);
      place(it, it.x, it.y, it.yaw, s, s, s * 0.2);
    });
    // Raindrops: a bead of water that slowly runs down, with a glint, and dries.
    let g = 0;
    const glints = S.on.glints;
    run(S.on.drops, (it, age) => {
      const k = 1 - age / it.life;
      if (k <= 0) {
        it.gone = true;
        return false;
      }
      it.vy = Math.min(0.05, it.vy + dt * 0.004 * it.s);
      it.y -= it.vy * dt;
      const s = hh * 0.045 * it.s * Math.min(1, k * 3);
      place(it, it.x + s * 0.3 / hw, it.y + s * 0.3 / hh, 0, s * 0.28, s * 0.28, 1);
      glints.o.setMatrixAt(g++, d.matrix);
      place(it, it.x, it.y, it.yaw, s, s * 1.08, 1);
    });
    glints.o.count = g;
    glints.o.instanceMatrix.needsUpdate = true;
    // A leaf or petal: lands on the viewer, sits a moment, then the wind takes it off.
    for (const name of ['leaves', 'petals']) {
      const L = S.on[name];
      const size = hh * (name === 'leaves' ? 0.34 : 0.18);
      const dir = W.wind >= 0 ? 1 : -1;
      let i = 0;
      const keep = [];
      L.items.forEach((it) => {
        const age = t - it.t0;
        if (age > it.life) {
          it.vx += dir * dt * 3.2;
          it.x += it.vx * dt;
          it.y += it.vx * dt * it.tip;
        }
        if (Math.abs(it.x) > 1.8) return;
        const land = smooth(Math.min(1, age / 0.18));
        place(it, it.x, it.y, it.yaw + Math.sin(age * 3 + it.ph) * 0.05 + it.vx * 0.4, size * lerp(1.5, 1, land), size * 0.6 * lerp(1.5, 1, land), size * 0.12);
        L.o.setMatrixAt(i, d.matrix);
        L.o.setColorAt(i, toColor(it.color));
        keep.push(it);
        i++;
      });
      L.items = keep;
      if (L.o.instanceColor) L.o.instanceColor.needsUpdate = true;
      L.o.count = i;
      L.o.instanceMatrix.needsUpdate = true;
    }
  }

  /* A particle has come down: it joins what has built up there. */
  land(name, q, t) {
    const W = this.weather;
    const f = q.on;
    const at = f ? { f, dx: q.x - f.x, dy: q.y - (this.h - f.y), z: 0 } : { f: null, x: q.x, y: q.y, z: FLOOR_Z };
    if (name === 'snow') {
      const P = W.piles.snow;
      // On a full pile, the flake thickens the snow already there instead.
      if (P.items.length >= P.cap) {
        const it = P.items[(Math.random() * P.items.length) | 0];
        it.max = Math.min(it.max + 0.4, f ? 6 : 15);
        return;
      }
      this.layDown('snow', Object.assign(at, { s: 1.4, max: f ? 2.5 + Math.random() * 2.5 : 5 + Math.random() * 6, yaw: Math.random() * TAU, ph: Math.random() }));
    } else if (name === 'rain') {
      this.layDown('splashes', Object.assign({}, at, { t0: t, yaw: Math.random() * TAU }));
      if (f) {
        this.layDown('beads', Object.assign(at, { s: 0.9 + Math.random() * 1.1, yaw: Math.random() * TAU, ph: Math.random() }));
        return;
      }
      // Into a puddle, which spreads; now and then the start of a new one.
      const P = W.piles.puddles;
      const hit = P.items.find((p) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < (p.s + 12) ** 2);
      if (hit) hit.max = Math.min(hit.max + 0.25, hit.cap);
      else if (Math.random() < 0.04) this.layDown('puddles', Object.assign(at, { s: 2, max: 6, cap: 26 + Math.random() * 46, sq: 0.55 + Math.random() * 0.45, yaw: Math.random() * TAU, ph: Math.random() }));
    } else {
      // Lying flat, a little tipped, settling onto whatever is under it.
      const P = W.piles[name];
      const stack = f ? 1.5 + (f.wl || 0) * 0.8 : 0.6 + (P.items.length % 7) * 0.35;
      this.layDown(name, Object.assign(at, { z: (at.z || 0) + stack, yaw: q.spin + q.ph, tx: (Math.random() - 0.5) * 0.5, ty: (Math.random() - 0.5) * 0.5, s: 1, ph: Math.random(), vx: 0 }));
    }
  }

  /* Everything that has landed: built up while its weather lasts, melting, drying or wilting away after. */
  updatePiles(t, dt, w, level) {
    const W = this.weather;
    const d = W.dummy;
    const v = W.v;
    const at = (it) => {
      if (!it.f) return v.set(it.x, it.y, it.z);
      const f = it.f;
      v.set(f.x + it.dx, this.h - f.y + it.dy, f.z + f.lift + 3 + it.z);
      if (f.bent) v.applyMatrix4(f.bent);
      return v;
    };
    const draw = (P, fn) => {
      // Near full, the oldest give way gradually rather than vanishing when a new one lands.
      const over = P.items.length - Math.floor(P.cap * 0.85);
      for (let k = 0; k < over; k++) P.items[k].old = true;
      let i = 0;
      while (i < P.items.length) {
        const it = P.items[i];
        if (it.old && it.s !== undefined) it.s -= dt * (P === W.piles.snow ? 1.5 : 0.4);
        if (fn(it) === false) {
          this.pickUp(P, i);
          continue;
        }
        d.updateMatrix();
        P.o.setMatrixAt(i, d.matrix);
        i++;
      }
      P.o.count = P.items.length;
      P.o.instanceMatrix.needsUpdate = true;
    };

    // Snow: each clump spreads while it snows; out of season it melts away, unevenly.
    const snowing = level.snow > 0.02;
    const melt = w.snow < 0.03;
    draw(W.piles.snow, (it) => {
      if (snowing && !it.old) it.s = Math.min(it.max, it.s + dt * (0.25 + level.snow * 0.6));
      if (melt) it.s -= dt * (0.05 + it.ph * 0.12);
      if (it.s < 0.3) return false;
      d.position.copy(at(it));
      d.rotation.set(0, 0, it.yaw);
      d.scale.set(it.s, it.s * 0.85, it.s * 0.3);
    });

    // Rain: rings where drops hit, puddles that spread while it rains and dry up after, beads on the petals.
    draw(W.piles.splashes, (it) => {
      const age = t - it.t0;
      if (age > 0.32) return false;
      const k = age / 0.32;
      const s = 1.5 + k * 6;
      d.position.copy(at(it));
      d.position.z += 0.4;
      d.rotation.set(0, 0, it.yaw);
      d.scale.set(s * (1 - k * 0.5), s * (1 - k * 0.5), 1);
    });
    const raining = level.rain > 0.05;
    draw(W.piles.puddles, (it) => {
      it.s = raining && !it.old ? Math.min(it.max, it.s + dt * 6) : it.s - dt * (0.6 + it.ph * 0.8);
      if (it.s < 0.5) return false;
      d.position.set(it.x, it.y, FLOOR_Z + 0.2);
      d.rotation.set(0, 0, it.yaw);
      d.scale.set(it.s, it.s * it.sq, 1);
    });
    draw(W.piles.beads, (it) => {
      if (!raining) it.s -= dt * (0.04 + it.ph * 0.06);
      if (it.s < 0.2) return false;
      d.position.copy(at(it));
      d.rotation.set(it.ph * 3, 0, it.yaw);
      d.scale.setScalar(it.s);
    });

    // Leaves and petals: lie where they fell; a gust skitters the ones on the ground along; out of season they wither.
    for (const name of ['leaves', 'petals']) {
      const size = W.r * (name === 'leaves' ? 2.2 : 1.1);
      const wilt = w[name] < 0.03;
      draw(W.piles[name], (it) => {
        if (wilt) it.s -= dt * (0.01 + it.ph * 0.03);
        if (it.s < 0.05) return false;
        if (!it.f) {
          const push = this.gustPush(it.x);
          if (Math.abs(push) * (0.4 + it.ph) > 0.35) it.vx = lerp(it.vx, push * (name === 'leaves' ? 90 : 120), 1 - Math.exp(-dt * 6));
          it.vx *= Math.exp(-dt * 2.5);
          it.x += it.vx * dt;
          it.yaw += it.vx * dt * 0.02;
        }
        d.position.copy(at(it));
        d.rotation.set(it.tx, it.ty, it.yaw);
        const s = size * it.s;
        d.scale.set(s, s * 0.6, s * 0.6);
      });
    }
  }

  /* ---------------- zoom ---------------- */

  /*
   * The view: zoom z (1 = the whole logo, as laid out) and the screen point
   * cx, cy (y down) at the center of the view. Gestures set the targets; the
   * view eases to them. At zoom z one screen pixel covers 1/z of the bed.
   */
  resetView(now) {
    const v = this.view || (this.view = {});
    v.tz = 1;
    v.tcx = this.w / 2;
    v.tcy = this.h / 2;
    if (now || v.z === undefined) Object.assign(v, { z: 1, cx: v.tcx, cy: v.tcy });
    this.classList.remove('is-zoomed');
  }

  maxZoom() {
    // Close enough that one flower fills much of the screen, never inside the petals.
    return Math.max(1, Math.min(8, this.camDist / 120));
  }

  /* Zooms to z, keeping the bed point (wx, wy) under the screen point (sx, sy). */
  zoomTo(z, wx, wy, sx, sy) {
    const v = this.view;
    v.tz = clamp(z, 1, this.maxZoom());
    v.tcx = wx - (sx - this.w / 2) / v.tz;
    v.tcy = wy - (sy - this.h / 2) / v.tz;
    this.clampView();
  }

  /* The bed point under a screen point, for the target view. */
  bedAt(sx, sy) {
    const v = this.view;
    return [v.tcx + (sx - this.w / 2) / v.tz, v.tcy + (sy - this.h / 2) / v.tz];
  }

  /* Keeps the view inside the bed as laid out on screen. */
  clampView() {
    const v = this.view;
    const hw = this.w / 2 / v.tz;
    const hh = this.h / 2 / v.tz;
    // The shop's camera goes wherever its blossoms are.
    if (!this.blossoms) {
      v.tcx = clamp(v.tcx, hw, this.w - hw);
      v.tcy = clamp(v.tcy, hh, this.h - hh);
    }
    const zoomed = v.tz > 1.02;
    if (zoomed !== this.classList.contains('is-zoomed')) this.classList.toggle('is-zoomed', zoomed);
    this.start();
  }

  easeView(dt) {
    const v = this.view;
    if (this.classList.contains('is-nav-open') && v.tz !== 1) this.resetView();
    // The shop's camera glides between blossoms; elsewhere a zoom follows the fingers closely.
    const f = 1 - Math.exp(-dt * (this.blossoms ? 3.2 : 14));
    const moving = Math.abs(v.tz - v.z) > 1e-4 || Math.abs(v.tcx - v.cx) > 0.01 || Math.abs(v.tcy - v.cy) > 0.01;
    if (!moving) return;
    v.z += (v.tz - v.z) * f;
    v.cx += (v.tcx - v.cx) * f;
    v.cy += (v.tcy - v.cy) * f;
    if (Math.abs(v.tz - v.z) < 1e-3) v.z = v.tz;
    // Taps and the inspector use on-screen positions, which a zoom moves.
    this.viewDirty = true;
    clearTimeout(this.detailTimer);
    this.detailTimer = window.setTimeout(() => this.sharpen(), 160);
  }

  /*
   * Once the view settles, the low-resolution render sharpens with the zoom,
   * so the flowers' detail shows instead of bigger pixels.
   */
  sharpen() {
    if (!this.renderer || !this.view) return;
    const Z = this.view.z;
    const most = Math.max(this.rs, Math.min(this.dpr || 1, 2));
    const rs = Math.round(Math.min(most, this.rs * (1 + (Z - 1) * 0.6)) * 8) / 8;
    if (rs === this.rsNow) return;
    this.applyScale(rs);
    this.start();
  }

  /*
   * The gestures a visitor would try without being told, and no others:
   *   scroll wheel or trackpad: zoom toward the cursor (a trackpad pinch
   *     arrives as a wheel event with ctrlKey; Safari sends gesture events);
   *   two fingers: pinch to zoom, and move together to pan;
   *   one finger held still, then slid: up zooms in, down zooms out;
   *   zoomed in, one finger or the mouse drags the view.
   * A gesture never also counts as a tap, so it doesn't open the menu,
   * recolor a flower or count toward the hidden game.
   */
  bindZoom() {
    this.resetView(true);
    const local = (e) => {
      const r = this.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    // In the sky the same gestures zoom and look around the sky instead of the bed.
    const navOpen = () => this.classList.contains('is-nav-open') || (!!this.night && !this.lyingDown());
    const zoomNow = () => (this.lyingDown() ? this.skyView.tz : this.view.tz);
    const anchor = (x, y) => (this.lyingDown() ? [x, y] : this.bedAt(x, y));
    const zoomAt = (z, w, sx, sy) => (this.lyingDown() ? this.skyZoomTo(z, sx, sy) : this.zoomTo(z, w[0], w[1], sx, sy));
    const pts = new Map();
    let g = null;
    let holdTimer = 0;

    this.addEventListener(
      'wheel',
      (e) => {
        if (navOpen() || !this.renderer || this.failed) return;
        e.preventDefault();
        const [x, y] = local(e);
        const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        zoomAt(zoomNow() * Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0025)), anchor(x, y), x, y);
        this.markInteracted();
      },
      { passive: false }
    );

    let safari = null;
    this.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      safari = { z0: zoomNow(), x, y, w: anchor(x, y) };
    });
    this.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (safari) zoomAt(safari.z0 * e.scale, safari.w, safari.x, safari.y);
    });
    this.addEventListener('gestureend', (e) => {
      e.preventDefault();
      safari = null;
    });

    const endGrowth = () => {
      this.pointer.down = false;
      this.gestured = true;
    };
    this.addEventListener(
      'pointerdown',
      (e) => {
        if (navOpen() || (e.pointerType === 'mouse' && e.button !== 0)) return;
        this.gestured = false;
        const [x, y] = local(e);
        pts.set(e.pointerId, { x, y });
        clearTimeout(holdTimer);
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          g = { mode: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: zoomNow(), w: anchor(mx, my), mx, my, t0: e.timeStamp };
          endGrowth();
        } else if (pts.size === 1) {
          g = { mode: null, id: e.pointerId, sx: x, sy: y, lx: x, ly: y };
          if (e.pointerType !== 'mouse') {
            holdTimer = window.setTimeout(() => {
              if (!g || g.mode !== null || g.id !== e.pointerId) return;
              // A finger resting on the d before tracing it is not asking to zoom.
              if (this.overLetterD(g.sx, g.sy)) return;
              g.mode = 'hold';
              g.z0 = zoomNow();
              g.w = anchor(g.lx, g.ly);
              g.hx = g.lx;
              g.hy = g.ly;
              endGrowth();
              if (navigator.vibrate) navigator.vibrate(8);
            }, 320);
          }
        }
      },
      true
    );
    this.addEventListener(
      'pointermove',
      (e) => {
        const pt = pts.get(e.pointerId);
        if (!pt || !g) return;
        const [x, y] = local(e);
        pt.x = x;
        pt.y = y;
        if ((g.mode === 'pinch' || g.mode === 'swipe') && pts.size >= 2) {
          const [a, b] = [...pts.values()];
          const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
          const my = (a.y + b.y) / 2;
          // Two fingers moving up or down together, still the same distance
          // apart, are a swipe, not a pinch: the zoom goes back to where it was.
          if (g.mode === 'pinch' && Math.abs(d / g.d0 - 1) < 0.15 && Math.abs(my - g.my) > 45) {
            g.mode = 'swipe';
            zoomAt(g.z0, g.w, g.mx, g.my);
          }
          g.dy = my - g.my;
          if (g.mode === 'pinch') zoomAt((g.z0 * d) / g.d0, g.w, (a.x + b.x) / 2, (a.y + b.y) / 2);
        } else if (g.mode === 'hold' && e.pointerId === g.id) {
          // Slide up to zoom in, down to zoom out, around the point first held.
          zoomAt(g.z0 * Math.exp((g.hy - y) * 0.012), g.w, g.hx, g.hy);
        } else if (g.mode === 'pan' && e.pointerId === g.id) {
          if (this.lyingDown()) this.skyPan(x - g.lx, y - g.ly);
          else {
            const v = this.view;
            v.tcx -= (x - g.lx) / v.tz;
            v.tcy -= (y - g.ly) / v.tz;
            this.clampView();
          }
        } else if (g.mode === null && e.pointerId === g.id && Math.hypot(x - g.sx, y - g.sy) > 10) {
          clearTimeout(holdTimer);
          if (zoomNow() > 1.02) {
            g.mode = 'pan';
            endGrowth();
            try {
              this.setPointerCapture(e.pointerId);
            } catch (err) {
              /* best effort */
            }
          } else {
            g.mode = 'none';
          }
        }
        g.lx = x;
        g.ly = y;
      },
      true
    );
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      clearTimeout(holdTimer);
      if (g && g.mode === 'swipe') {
        const quick = e.timeStamp - g.t0 < 1200;
        if (quick && Math.abs(g.dy) > 70) this.twoFingerSwipe(g.dy < 0 ? 'up' : 'down');
        g.mode = 'done';
      }
      // Lifting one finger of a pinch doesn't start a pan with the other.
      if (pts.size === 0) g = null;
      else if (g) g.mode = 'done';
    };
    this.addEventListener('pointerup', up, true);
    this.addEventListener('pointercancel', up, true);
    // The click that ends a zoom or pan gesture isn't a tap.
    this.addEventListener(
      'click',
      (e) => {
        if (!this.gestured) return;
        this.gestured = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
    this.addEventListener('contextmenu', (e) => e.pointerType !== 'mouse' && e.preventDefault());
  }

  /*
   * Now and then, once the logo has formed, a gust of wind runs through it:
   * a front sweeps across the screen, and the flowers it passes lean with
   * it, lift and turn a little, then settle back exactly where they were.
   * Between gusts nothing moves, so the composition stays put.
   */
  blow(t) {
    const dt = Math.min(0.1, Math.max(0, t - (this.blownAt === undefined ? t : this.blownAt)));
    this.blownAt = t;
    if (!this.gust) {
      if (this.nextGust === undefined) this.nextGust = t + 2.5 + Math.random() * 3;
      if (t >= this.nextGust) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        const width = Math.max(120, this.w * 0.22);
        this.gust = { t0: t, dir, width, strength: 0.7 + Math.random() * 0.5, speed: this.w / (2.2 + Math.random()) };
      }
    }
    const g = this.gust;
    let front = 0;
    let done = true;
    if (g) {
      const start = g.dir > 0 ? -g.width : this.w + g.width;
      front = start + g.dir * g.speed * (t - g.t0);
      done = g.dir > 0 ? front > this.w + g.width * 2.5 : front < -g.width * 2.5;
    }
    this.gustFront = g && !done ? front : undefined;
    // Each flower is pushed by how far behind the front it is: a quick push as the front reaches it, easing out over a longer tail.
    this.sway(dt, (f) => this.gustPush(f.dest[0]));
    if (g && done) {
      this.gust = null;
      const gap = this.seasonNow ? SEASON_LOOK[this.seasonNow.name].gusts : [7, 15];
      this.nextGust = t + lerp(gap[0], gap[1], Math.random());
    }
  }

  /*
   * Each head on its stem is a damped spring: the wind pushes it over, it
   * swings back past upright and rocks to rest. Lighter (smaller) flowers
   * rock faster. push(f) is the wind on the flower, -1..1 along x.
   */
  /*
   * Something in the sky (a star or a puff of the logo, a drifting cloud)
   * given a lazy shove by the pointer dragging past (mouse button held, or
   * a finger on the screen), or burst away from where it is pressed. Each
   * goes its own way, so they part like loose stars rather than one sheet:
   * it floats off as if weightless, and a very soft spring eases it back
   * into place over a few seconds. Its offset is kept in screen pixels
   * (ox, oy) and returned the same way.
   */
  skyFloat(o, x, y, z, dt, size = 0) {
    const b = this.brush;
    const burst = this.skyBurst;
    // Every star its own: how much it takes the push, which way it veers, how fast it comes home.
    if (o.veer === undefined) {
      o.veer = (Math.random() - 0.5) * 1.4;
      o.give = 0.5 + Math.random() * 1.1;
      o.pull = 0.9 + Math.random() * 1.1;
    }
    let ax = 0;
    let ay = 0;
    let kickX = 0;
    let kickY = 0;
    // Only while pressed: the mouse button held, or a finger on the screen.
    const dragging = b && this.pointer.down && (Math.abs(b.vx) > 20 || Math.abs(b.vy) > 20);
    if (dragging || burst) {
      const v = this.tmp.set(x, y, z).project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * this.w;
      const sy = (-v.y * 0.5 + 0.5) * this.h;
      // Reached from its edge, not its middle: a big puff of cloud is touched anywhere on it.
      const reach = Math.min(this.w, this.h) * 0.14 + size;
      if (v.z < 1 && dragging) {
        const dx = sx - b.x;
        const dy = sy - b.y;
        const d = Math.hypot(dx, dy);
        if (d < reach) {
          const w = (1 - d / reach) ** 2 * 1.4 * o.give;
          // The pointer's way, turned a little to this star's own side...
          const c = Math.cos(o.veer);
          const sn = Math.sin(o.veer);
          ax = (b.vx * c - b.vy * sn) * w;
          ay = (b.vx * sn + b.vy * c) * w;
          // ...and parted outward from the pointer, so they scatter rather than move as one.
          const speed = Math.hypot(b.vx, b.vy);
          ax += (dx / (d || 1)) * speed * w * 0.7;
          ay += (dy / (d || 1)) * speed * w * 0.7;
        }
      }
      if (v.z < 1 && burst) {
        // A press: the stars round it burst apart, each off its own way.
        const dx = sx - burst.x;
        const dy = sy - burst.y;
        const d = Math.hypot(dx, dy);
        const r = reach * 1.2;
        if (d < r) {
          const a = Math.atan2(dy, dx) + o.veer * 0.5;
          const k = (1 - d / r) * 140 * o.give;
          kickX = Math.cos(a) * k;
          kickY = Math.sin(a) * k;
        }
      }
    }
    if (!ax && !ay && !kickX && !kickY && !o.ox && !o.oy && !o.fx && !o.fy) return;
    // Hardly any drag and a soft pull home, slower or quicker star by star: a floating return.
    const K = 1.4 * o.pull;
    const C = 1.3 * Math.sqrt(o.pull);
    o.fx = (o.fx || 0) + kickX + (ax - K * (o.ox || 0) - C * (o.fx || 0)) * dt;
    o.fy = (o.fy || 0) + kickY + (ay - K * (o.oy || 0) - C * (o.fy || 0)) * dt;
    o.ox = (o.ox || 0) + o.fx * dt;
    o.oy = (o.oy || 0) + o.fy * dt;
    if (!ax && !ay && Math.abs(o.ox) < 0.05 && Math.abs(o.oy) < 0.05 && Math.abs(o.fx) < 0.05 && Math.abs(o.fy) < 0.05) o.ox = o.oy = o.fx = o.fy = 0;
  }

  /*
   * The pointer brushing through the bed (or across the sky): where it is
   * and how fast it is moving (screen pixels a second, smoothed), while a
   * mouse moves over the splash or a finger drags across it. Nothing behind
   * other pages, with the menu open, or with reduced motion.
   */
  brushStep(dt) {
    const ptr = this.pointer;
    const on = dt > 0 && ptr.active && !this.backdrop && !this.reduced && !this.classList.contains('is-nav-open');
    if (!on) {
      this.brush = null;
      this.brushLast = null;
      return;
    }
    const last = this.brushLast;
    this.brushLast = { x: ptr.x, y: ptr.y };
    if (!last) return;
    const k = 1 - Math.exp(-dt * 18);
    const b = this.brush || (this.brush = { vx: 0, vy: 0 });
    b.x = ptr.x;
    b.y = ptr.y;
    b.vx = lerp(b.vx, (ptr.x - last.x) / dt, k);
    b.vy = lerp(b.vy, (ptr.y - last.y) / dt, k);
  }

  /* How hard the brushing pointer shoves this flower's head (radians a second squared, toward +x and +y), or 0. */
  brushPush(f) {
    const b = this.brush;
    if (!b || this.night || f.sx === undefined || (Math.abs(b.vx) < 20 && Math.abs(b.vy) < 20)) return null;
    const reach = Math.max(70, (f.sr || 0) * 3);
    const d = Math.hypot(f.sx - b.x, f.sy - b.y);
    if (d >= reach) return null;
    const w = (1 - d / reach) ** 2 * 0.075;
    // Screen y runs down; the bed's y runs up the screen.
    return [b.vx * w, -b.vy * w];
  }

  sway(dt, push) {
    if (!dt) return;
    const LEAN = 0.42;
    for (const f of this.flowers) {
      const wind = push(f);
      // A brushing pointer shoves the head the way it is moving; the spring brings it back.
      const shove = this.brushPush(f);
      if (!wind && !shove && !f.bx && !f.bvx && !f.by && !f.bvy) continue;
      const ax = shove ? shove[0] : 0;
      const ay = shove ? shove[1] : 0;
      if (f.spring === undefined) {
        const r = (((Math.sin(f.id * 12.9898) * 43758.5453) % 1) + 1) % 1;
        f.spring = 26 + 30 * r;
      }
      const K = f.spring * clamp(this.base / Math.max(1, f.r), 0.7, 1.4);
      const C = 2 * 0.22 * Math.sqrt(K);
      // A little sideways give, different for every flower.
      const side = 0.22 * Math.sin(f.id * 2.3);
      const tx = wind * LEAN;
      const ty = wind * LEAN * side;
      // Small steps keep the spring steady at low frame rates.
      const n = Math.ceil(dt / 0.02);
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        f.bvx = (f.bvx || 0) + (K * (tx - (f.bx || 0)) - C * (f.bvx || 0) + ax) * h;
        f.bvy = (f.bvy || 0) + (K * (ty - (f.by || 0)) - C * (f.bvy || 0) + ay) * h;
        f.bx = clamp((f.bx || 0) + f.bvx * h, -0.9, 0.9);
        f.by = clamp((f.by || 0) + f.bvy * h, -0.9, 0.9);
      }
      if (!wind && !shove && Math.abs(f.bx) < 2e-4 && Math.abs(f.by) < 2e-4 && Math.abs(f.bvx) < 2e-3 && Math.abs(f.bvy) < 2e-3) {
        f.bx = f.by = f.bvx = f.bvy = 0;
      }
      f.shown = -1;
    }
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
    // Otherwise they watch the bee, if one is about.
    if (!nav && this.bee && this.bee.group.visible) return out.copy(this.bee.group.position);
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
      e.group.position.set(f.x, this.h - f.y, f.z + f.lift + (f.r * 0.14 + e.R * 0.4) * f.g);
      if (f.bent) e.group.position.applyMatrix4(f.bent);
      e.group.scale.setScalar(f.g);
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

    // The letter being traced, faintly, so the finger can see its line.
    if (this.trace && this.trace.length > 1) {
      g.strokeStyle = rgba(ink, 0.35);
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      this.trace.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
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

/*
 * The garden's own building blocks, for the Pollen Dream game: the same
 * scene setup, plastic materials, petal geometry, eyes and growth code,
 * without the element around them. The bed it returns has the element's
 * methods for flowers (makeFlower, sequence, assignEyes, buildMeshes,
 * shape, updateEyes, clearMeshes); config supplies the colors and sizes
 * readConfig would normally read from data attributes.
 */
export function createBed(config) {
  const bed = Object.create(GardenSplash.prototype);
  // Colors as '#hex' strings or [r, g, b] arrays (a page garden's own, scheme applied).
  const col = (c) => (Array.isArray(c) ? c : parseColor(c));
  const palette = (config.palette || []).map(col).filter(Boolean);
  Object.assign(bed, {
    palette: palette.length ? palette : [[166, 39, 73], [102, 164, 200], [185, 229, 251], [240, 78, 98]],
    foliage: col(config.foliage) || [102, 164, 200],
    heroColor: col(config.center) || [240, 78, 98],
    heroAccent: col(config.accent) || [166, 39, 73],
    soil: col(config.soil) || OCEAN,
    flowers: [],
    elapsed: 0,
    reduced: !!config.reduced,
    h: 0,
    camDist: config.camDist || 1000,
  });
  bed.isLight = luminance(bed.soil) > 0.6;
  bed.ink = bed.isLight ? OCEAN : POWDER;
  bed.setupScene();
  return bed;
}

/* What the shop's blossoms (assets/garden-blossoms.js) build with: handed over, so that file never imports this one a second time. */
const HELPERS = { THREE, FLOOR_Z, STAGE, clamp, lerp, range, smooth, mix, tone, toColor, parseColor, mulberry32 };

export { THREE, STAGE, FLOOR_Z, mulberry32, poissonDisc, parseColor, mix, tone, toColor, rgba, clamp, lerp, range, smooth, alphaTexture };
