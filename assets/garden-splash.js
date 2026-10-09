/**
 * Garden splash
 *
 * A top-down garden drawn on a single <canvas>. Every flower grows through
 * seed → sprout → leaves → bud → bloom, the beds fill the screen with
 * overlapping heads, and the coral flower in the middle opens last to reveal
 * the logo (a DOM element positioned over it).
 *
 * Interaction (mouse, pen and touch share one code path):
 *  - moving through the garden parts the flower heads and brushes them along
 *  - pressing and dragging "waters" the beds so nearby flowers grow faster
 *  - tapping sends a ripple out; a growing flower blooms immediately and an
 *    open flower sheds its petals and re-blooms in a new color
 */
(function () {
  'use strict';

  if (!window.customElements || customElements.get('garden-splash')) return;

  const TAU = Math.PI * 2;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const range = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c1 = 1.6;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

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

  /* ------------------------------------------------------------------ */
  /* Color helpers                                                       */
  /* ------------------------------------------------------------------ */

  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

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

  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const tone = (c, amt) => (amt >= 0 ? mix(c, WHITE, amt) : mix(c, BLACK, -amt));
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a === undefined ? 1 : a})`;
  const colorKey = (c) => `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
  const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  /* ------------------------------------------------------------------ */
  /* Shapes (drawn along +x from the base at 0,0 to the tip at L,0)      */
  /* ------------------------------------------------------------------ */

  const SHAPES = {
    round: {
      aspect: 0.74,
      path(g, L, H) {
        g.moveTo(0, 0);
        g.bezierCurveTo(L * 0.1, -H * 0.55, L * 0.35, -H * 1.0, L * 0.62, -H * 0.98);
        g.bezierCurveTo(L * 0.88, -H * 0.95, L, -H * 0.5, L, 0);
        g.bezierCurveTo(L, H * 0.5, L * 0.88, H * 0.95, L * 0.62, H * 0.98);
        g.bezierCurveTo(L * 0.35, H, L * 0.1, H * 0.55, 0, 0);
      },
    },
    long: {
      aspect: 0.2,
      path(g, L, H) {
        g.moveTo(0, 0);
        g.bezierCurveTo(L * 0.15, -H, L * 0.6, -H * 1.05, L * 0.94, -H * 0.85);
        g.quadraticCurveTo(L, -H * 0.6, L * 0.995, -H * 0.25);
        g.lineTo(L * 0.95, 0);
        g.lineTo(L * 0.995, H * 0.25);
        g.quadraticCurveTo(L, H * 0.6, L * 0.94, H * 0.85);
        g.bezierCurveTo(L * 0.6, H * 1.05, L * 0.15, H, 0, 0);
      },
    },
    pointed: {
      aspect: 0.36,
      path(g, L, H) {
        g.moveTo(0, 0);
        g.bezierCurveTo(L * 0.2, -H * 1.1, L * 0.62, -H * 1.05, L, 0);
        g.bezierCurveTo(L * 0.62, H * 1.05, L * 0.2, H * 1.1, 0, 0);
      },
    },
    notched: {
      aspect: 0.84,
      path(g, L, H) {
        g.moveTo(0, 0);
        g.bezierCurveTo(L * 0.1, -H * 0.6, L * 0.4, -H * 1.05, L * 0.7, -H * 0.95);
        g.bezierCurveTo(L * 0.92, -H * 0.85, L, -H * 0.45, L * 0.98, -H * 0.18);
        g.quadraticCurveTo(L * 0.93, -H * 0.02, L * 0.86, 0);
        g.quadraticCurveTo(L * 0.93, H * 0.02, L * 0.98, H * 0.18);
        g.bezierCurveTo(L, H * 0.45, L * 0.92, H * 0.85, L * 0.7, H * 0.95);
        g.bezierCurveTo(L * 0.4, H * 1.05, L * 0.1, H * 0.6, 0, 0);
      },
    },
    leaf: {
      aspect: 0.46,
      path(g, L, H) {
        g.moveTo(0, 0);
        g.bezierCurveTo(L * 0.18, -H * 0.9, L * 0.55, -H * 1.15, L * 0.82, -H * 0.6);
        g.quadraticCurveTo(L * 0.95, -H * 0.3, L, 0);
        g.quadraticCurveTo(L * 0.95, H * 0.3, L * 0.82, H * 0.6);
        g.bezierCurveTo(L * 0.55, H * 1.15, L * 0.18, H * 0.9, 0, 0);
      },
    },
  };

  /*
   * Flower types. rings: [petal count, length (× radius), width (× radius)],
   * outermost first. twist: how far the closed bud is wound before opening.
   */
  const TYPES = {
    peony: {
      shape: 'round', size: 1.08, base: 0.03, center: 'eye', centerSize: 0.16, twist: 0.9, ringTone: 0.06,
      rings: [[9, 1, 0.62], [8, 0.84, 0.6], [8, 0.68, 0.58], [7, 0.53, 0.55], [6, 0.39, 0.52], [5, 0.26, 0.5]],
    },
    daisy: {
      shape: 'long', size: 0.96, base: 0.14, center: 'disc', centerSize: 0.36, twist: 0.3, ringTone: -0.05,
      rings: [[18, 1, 0.17], [17, 0.9, 0.16]],
    },
    anemone: {
      shape: 'round', size: 1, base: 0.04, center: 'stamen', centerSize: 0.5, twist: 0.6, ringTone: 0.07,
      rings: [[6, 1, 0.8], [5, 0.84, 0.72]],
    },
    dahlia: {
      shape: 'pointed', size: 1.06, base: 0.02, center: 'eye', centerSize: 0.1, twist: 0.5, ringTone: 0.045,
      rings: [[13, 1, 0.3], [13, 0.86, 0.3], [12, 0.72, 0.3], [11, 0.58, 0.3], [9, 0.44, 0.3], [7, 0.31, 0.3], [5, 0.19, 0.3]],
    },
    blossom: {
      shape: 'notched', size: 1, base: 0.03, center: 'dots', centerSize: 0.38, twist: 0.8, ringTone: 0,
      rings: [[5, 1, 0.84]],
    },
    hero: {
      shape: 'round', size: 1, base: 0.02, center: null, centerSize: 0, twist: 1.2, ringTone: 0.07,
      rings: [[13, 1, 0.58], [12, 0.89, 0.58], [11, 0.78, 0.57], [10, 0.67, 0.56], [10, 0.56, 0.55], [9, 0.46, 0.53], [8, 0.37, 0.51], [7, 0.28, 0.49], [6, 0.2, 0.47], [5, 0.13, 0.45]],
    },
  };

  const MAIN_TYPES = [
    ['peony', 0.27],
    ['daisy', 0.25],
    ['anemone', 0.2],
    ['dahlia', 0.28],
  ];

  const DENSITY = {
    airy: { size: 1.18, spacing: 1.32 },
    lush: { size: 1, spacing: 1.2 },
    overgrown: { size: 0.84, spacing: 1.12 },
  };

  /* Growth milestones on a flower's 0 → 1 progress. */
  const STAGE = {
    seed: [0, 0.07],
    sprout: [0.06, 0.26],
    leaves: [0.18, 0.5],
    bud: [0.42, 0.62],
    open: [0.6, 1],
  };

  const CACHE_PIXEL_BUDGET = 14e6;

  /* Sprite resolutions are bucketed so flowers of similar size share them. */
  const SIZE_STEPS = [16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];
  const bucket = (n) => SIZE_STEPS.find((s) => s >= n) || 512;

  /* ------------------------------------------------------------------ */
  /* Sprite factory                                                      */
  /* ------------------------------------------------------------------ */

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function makePetalSprite(shapeName, color, S, isLeaf) {
    const shape = SHAPES[shapeName];
    const L = S;
    const H = (S * shape.aspect) / 2;
    const pad = Math.ceil(S * 0.08);
    const canvas = makeCanvas(L + pad * 2, H * 2 + pad * 2);
    const g = canvas.getContext('2d');
    g.translate(pad, pad + H);

    const body = g.createLinearGradient(0, 0, L, 0);
    if (isLeaf) {
      body.addColorStop(0, rgba(tone(color, -0.38)));
      body.addColorStop(0.3, rgba(tone(color, -0.12)));
      body.addColorStop(0.72, rgba(tone(color, 0.06)));
      body.addColorStop(1, rgba(tone(color, -0.12)));
    } else {
      body.addColorStop(0, rgba(tone(color, -0.32)));
      body.addColorStop(0.3, rgba(tone(color, -0.08)));
      body.addColorStop(0.72, rgba(color));
      body.addColorStop(1, rgba(tone(color, 0.18)));
    }

    g.beginPath();
    shape.path(g, L, H);
    g.shadowColor = 'rgba(24, 10, 4, 0.42)';
    g.shadowBlur = S * 0.06;
    g.fillStyle = body;
    g.fill();
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;

    g.save();
    g.clip();

    // Curvature: edges fall away into shade, the spine catches light.
    const cross = g.createLinearGradient(0, -H, 0, H);
    cross.addColorStop(0, 'rgba(0,0,0,0.16)');
    cross.addColorStop(0.42, 'rgba(255,255,255,0.1)');
    cross.addColorStop(0.58, 'rgba(255,255,255,0.1)');
    cross.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = cross;
    g.fillRect(-pad, -H - pad, L + pad * 2, H * 2 + pad * 2);

    g.lineCap = 'round';
    if (isLeaf) {
      g.strokeStyle = rgba(tone(color, 0.4), 0.55);
      g.lineWidth = S * 0.02;
      g.beginPath();
      g.moveTo(L * 0.02, 0);
      g.quadraticCurveTo(L * 0.5, -H * 0.04, L * 0.94, 0);
      g.stroke();
      g.strokeStyle = rgba(tone(color, 0.3), 0.28);
      g.lineWidth = S * 0.01;
      for (let i = 1; i <= 6; i++) {
        const x = L * (0.08 + i * 0.12);
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(x, 0);
          g.quadraticCurveTo(x + L * 0.06, side * H * 0.4, x + L * 0.14, side * H * 0.78);
          g.stroke();
        }
      }
    } else {
      g.strokeStyle = rgba(tone(color, -0.35), 0.13);
      g.lineWidth = Math.max(0.6, S * 0.008);
      for (let k = -3; k <= 3; k++) {
        g.beginPath();
        g.moveTo(L * 0.02, 0);
        g.quadraticCurveTo(L * 0.5, H * k * 0.2, L * 0.9, H * k * 0.27);
        g.stroke();
      }
    }
    g.restore();

    g.beginPath();
    shape.path(g, L, H);
    g.lineWidth = Math.max(0.6, S * 0.012);
    g.strokeStyle = rgba(tone(color, isLeaf ? -0.45 : -0.38), 0.4);
    g.stroke();

    return { img: canvas, S: L, W: H * 2, pad };
  }

  function makeRadialSprite(D, stops) {
    const c = makeCanvas(D, D);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
    stops.forEach(([o, col]) => grad.addColorStop(o, col));
    g.fillStyle = grad;
    g.fillRect(0, 0, D, D);
    return c;
  }

  function makeSeedSprite(S) {
    const w = S;
    const h = S * 0.64;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(w * 0.38, h * 0.36, 0, w * 0.5, h * 0.5, w * 0.5);
    grad.addColorStop(0, '#f0cf98');
    grad.addColorStop(0.45, '#b98549');
    grad.addColorStop(1, '#5a3618');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.46, h * 0.42, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,230,190,0.35)';
    g.lineWidth = S * 0.03;
    g.beginPath();
    g.moveTo(w * 0.14, h * 0.5);
    g.quadraticCurveTo(w * 0.5, h * 0.38, w * 0.86, h * 0.5);
    g.stroke();
    return c;
  }

  function makeCenterSprite(kind, color, D) {
    const c = makeCanvas(D, D);
    const g = c.getContext('2d');
    const R = D / 2;
    g.translate(R, R);

    if (kind === 'disc') {
      const lum = luminance(color);
      const core = lum > 0.72 && color[0] > color[2] + 40 ? [196, 98, 24] : [240, 172, 36];
      g.shadowColor = 'rgba(30,10,0,0.4)';
      g.shadowBlur = R * 0.12;
      const grad = g.createRadialGradient(-R * 0.15, -R * 0.15, 0, 0, 0, R * 0.88);
      grad.addColorStop(0, rgba(tone(core, 0.25)));
      grad.addColorStop(0.7, rgba(core));
      grad.addColorStop(1, rgba(tone(core, -0.35)));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, R * 0.86, 0, TAU);
      g.fill();
      g.shadowColor = 'transparent';
      const N = 170;
      for (let i = 0; i < N; i++) {
        const rr = Math.sqrt(i / N) * R * 0.8;
        const a = i * GOLDEN_ANGLE;
        const dot = R * (0.03 + 0.03 * (rr / R));
        g.fillStyle = rgba(tone(core, i % 2 ? -0.28 : 0.18), 0.85);
        g.beginPath();
        g.arc(Math.cos(a) * rr, Math.sin(a) * rr, dot, 0, TAU);
        g.fill();
      }
    } else if (kind === 'stamen') {
      const ink = [36, 26, 54];
      g.strokeStyle = rgba(ink, 0.8);
      g.lineWidth = R * 0.025;
      g.lineCap = 'round';
      for (let i = 0; i < 34; i++) {
        const a = (i / 34) * TAU + (i % 2) * 0.05;
        const r1 = R * 0.3;
        const r2 = R * (0.68 + (i % 3) * 0.08);
        g.beginPath();
        g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        g.stroke();
        g.fillStyle = rgba(i % 4 === 0 ? [250, 236, 210] : ink);
        g.beginPath();
        g.arc(Math.cos(a) * r2, Math.sin(a) * r2, R * 0.055, 0, TAU);
        g.fill();
      }
      const grad = g.createRadialGradient(-R * 0.08, -R * 0.08, 0, 0, 0, R * 0.42);
      grad.addColorStop(0, '#6c5a8e');
      grad.addColorStop(0.6, '#2b2142');
      grad.addColorStop(1, '#171024');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, R * 0.4, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < 18; i++) {
        const a = i * GOLDEN_ANGLE;
        const rr = Math.sqrt(i / 18) * R * 0.3;
        g.beginPath();
        g.arc(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.025, 0, TAU);
        g.fill();
      }
    } else if (kind === 'dots') {
      g.strokeStyle = rgba(tone(color, -0.25), 0.7);
      g.lineWidth = R * 0.03;
      g.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        const r2 = R * (0.62 + (i % 2) * 0.16);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        g.stroke();
        g.fillStyle = '#f6c443';
        g.beginPath();
        g.arc(Math.cos(a) * r2, Math.sin(a) * r2, R * 0.09, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#b9c46a';
      g.beginPath();
      g.arc(0, 0, R * 0.2, 0, TAU);
      g.fill();
    } else {
      // "eye": a tight knot of stamens at the heart of layered flowers.
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.9);
      grad.addColorStop(0, '#d6d27a');
      grad.addColorStop(0.5, '#e8b844');
      grad.addColorStop(1, 'rgba(232,184,68,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, R * 0.9, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,240,180,0.9)';
      for (let i = 0; i < 26; i++) {
        const a = i * GOLDEN_ANGLE;
        const rr = Math.sqrt(i / 26) * R * 0.62;
        g.beginPath();
        g.arc(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.06, 0, TAU);
        g.fill();
      }
    }
    return c;
  }

  function paintSoil(g, W, H, soil, rng) {
    g.fillStyle = rgba(soil);
    g.fillRect(0, 0, W, H);

    const blobs = Math.round((W * H) / 26000) + 12;
    for (let i = 0; i < blobs; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = 40 + rng() * 160;
      const c = rng() < 0.5 ? tone(soil, 0.1 + rng() * 0.08) : tone(soil, -0.25);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(c, 0.28));
      grad.addColorStop(1, rgba(c, 0));
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const specks = Math.round((W * H) / 70);
    for (let i = 0; i < specks; i++) {
      const v = rng();
      g.fillStyle = rgba(v < 0.55 ? tone(soil, -0.4) : tone(soil, 0.12 + rng() * 0.25), 0.5);
      const s = 0.6 + rng() * 1.8;
      g.fillRect(rng() * W, rng() * H, s, s);
    }

    const pebbles = Math.round((W * H) / 7000);
    for (let i = 0; i < pebbles; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rx = 1.5 + rng() * 3.5;
      const c = tone(soil, 0.18 + rng() * 0.3);
      g.fillStyle = rgba(tone(c, -0.5), 0.5);
      g.beginPath();
      g.ellipse(x + 0.8, y + 1, rx, rx * 0.7, rng() * TAU, 0, TAU);
      g.fill();
      g.fillStyle = rgba(c, 0.85);
      g.beginPath();
      g.ellipse(x, y, rx, rx * 0.7, rng() * TAU, 0, TAU);
      g.fill();
    }
  }

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
  /* The element                                                         */
  /* ------------------------------------------------------------------ */

  class GardenSplash extends HTMLElement {
    connectedCallback() {
      this.canvas = this.querySelector('[data-garden-canvas]');
      if (!this.canvas || !this.canvas.getContext) return;
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return;

      this.float = this.querySelector('[data-garden-float]');
      this.logo = this.querySelector('[data-garden-logo]');
      this.nav = this.querySelector('[data-garden-nav]');
      this.navToggle = this.querySelector('[data-garden-nav-toggle]');
      this.replantButton = this.querySelector('[data-garden-replant]');

      this.readConfig();
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = this.motionQuery.matches;

      this.seed = (Math.random() * 2 ** 31) | 0;
      this.elapsed = this.reduced ? this.duration * 1.2 : 0;
      this.sprites = new Map();
      this.flowers = [];
      this.particles = [];
      this.pollen = [];
      this.ripples = [];
      this.pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false, id: null, t: 0, sx: 0, sy: 0, st: 0, emit: 0 };
      this.frameTimes = [];
      this.maxDpr = 2;
      this.running = false;
      this.visible = true;
      this.bloomed = false;

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

      this.hintTimer = window.setTimeout(() => this.classList.add('has-interacted'), (this.duration + 8) * 1000);
      this.start();
    }

    disconnectedCallback() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.hintTimer);
      clearTimeout(this.resizeTimer);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.intersectionObserver) this.intersectionObserver.disconnect();
      if (this.unbind) this.unbind();
    }

    readConfig() {
      const d = this.dataset;
      this.coral = parseColor(d.centerColor) || [255, 111, 97];
      let palette = [];
      try {
        palette = JSON.parse(d.palette || '[]').map(parseColor).filter(Boolean);
      } catch (e) {
        palette = [];
      }
      this.palette = palette.length ? palette : [[247, 198, 199], [255, 243, 228], [255, 210, 122], [255, 174, 138], [201, 166, 221], [224, 87, 126]];
      this.foliage = parseColor(d.foliageColor) || [63, 107, 58];
      this.soil = parseColor(d.soilColor) || [43, 29, 20];
      this.duration = clamp(parseFloat(d.duration) || 12, 2, 60);
      this.density = DENSITY[d.density] || DENSITY.lush;
      this.logoScale = clamp(parseFloat(d.logoScale) || 0.6, 0.2, 1);
      this.leafColors = [tone(this.foliage, -0.12), this.foliage, mix(this.foliage, [120, 150, 70], 0.35)];
      this.sepalColor = tone(this.foliage, -0.05);
      this.sproutColor = mix(this.foliage, [160, 210, 90], 0.5);
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
        const p = this.pointer;
        Object.assign(p, { x, y, vx: 0, vy: 0, active: true, down: true, id: e.pointerId, t: e.timeStamp, sx: x, sy: y, st: e.timeStamp, type: e.pointerType });
        this.markInteracted();
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
        const [x, y] = local(e);
        const dt = Math.max(8, e.timeStamp - (p.t || e.timeStamp - 16)) / 1000;
        if (p.active) {
          p.vx = lerp(p.vx, (x - p.x) / dt, 0.45);
          p.vy = lerp(p.vy, (y - p.y) / dt, 0.45);
        }
        p.x = x;
        p.y = y;
        p.t = e.timeStamp;
        p.active = true;
        p.type = e.pointerType;
        if (e.pointerType === 'mouse' && Math.hypot(p.vx, p.vy) > 220) this.markInteracted();
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
      const onNavClick = (e) => {
        if (e.target === this.nav) this.toggleNav(false);
      };
      const onToggle = () => this.toggleNav();
      const onReplant = () => this.replant();
      const onMotion = () => {
        this.reduced = this.motionQuery.matches;
      };

      this.addEventListener('pointerdown', onDown);
      this.addEventListener('pointermove', onMove);
      this.addEventListener('pointerup', onUp);
      this.addEventListener('pointercancel', onLeave);
      this.addEventListener('pointerleave', onLeave);
      this.addEventListener('contextmenu', (e) => {
        if (!isUi(e)) e.preventDefault();
      });
      document.addEventListener('keydown', onKey);
      if (this.navToggle) this.navToggle.addEventListener('click', onToggle);
      if (this.nav) this.nav.addEventListener('click', onNavClick);
      if (this.replantButton) this.replantButton.addEventListener('click', onReplant);
      this.motionQuery.addEventListener('change', onMotion);

      this.unbind = () => {
        document.removeEventListener('keydown', onKey);
        this.motionQuery.removeEventListener('change', onMotion);
      };
    }

    markInteracted() {
      if (!this.classList.contains('has-interacted')) this.classList.add('has-interacted');
    }

    toggleNav(force) {
      if (!this.nav || !this.navToggle) return;
      const open = typeof force === 'boolean' ? force : !this.classList.contains('is-nav-open');
      this.classList.toggle('is-nav-open', open);
      this.navToggle.setAttribute('aria-expanded', String(open));
      this.pointer.active = false;
      this.pointer.down = false;
      if (open) {
        const first = this.nav.querySelector('a');
        if (first) window.setTimeout(() => first.focus({ preventScroll: true }), 120);
        this.burst(this.center, 26);
      } else if (this.contains(document.activeElement)) {
        this.navToggle.focus({ preventScroll: true });
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

      // Small height-only changes (mobile browser chrome) keep the same garden.
      const relayout = initial || !this.flowers.length || W !== this.w || Math.abs(H - this.h) > 90;
      const shiftY = relayout ? 0 : (H - this.h) / 2;
      this.w = W;
      this.h = H;
      this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);

      if (relayout) {
        this.generate();
      } else {
        this.flowers.forEach((f) => (f.y += shiftY));
      }
      this.rebuildGraphics();
    }

    rebuildGraphics() {
      const { w: W, h: H, dpr } = this;
      this.cacheScale = Math.min(dpr, 1.5);
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.sprites.clear();
      this.cachePixels = 0;
      this.flowers.forEach((f) => {
        f.cache = null;
        f.grounded = false;
      });

      this.ground = makeCanvas(W * dpr, H * dpr);
      const g = this.ground.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintSoil(g, W, H, this.soil, mulberry32(this.seed ^ 0x51ed));

      this.shadowSprite = makeRadialSprite(64, [[0, 'rgba(12,4,2,0.62)'], [0.55, 'rgba(12,4,2,0.3)'], [1, 'rgba(12,4,2,0)']]);
      this.pollenSprite = makeRadialSprite(32, [[0, 'rgba(255,248,214,1)'], [0.35, 'rgba(255,214,110,0.8)'], [1, 'rgba(255,190,70,0)']]);
      this.dropSprite = makeRadialSprite(32, [[0, 'rgba(235,248,255,0.95)'], [0.4, 'rgba(170,215,255,0.55)'], [1, 'rgba(150,200,255,0)']]);
      this.seedSprite = makeSeedSprite(Math.ceil(this.base * 0.3 * dpr) + 8);

      // Bake foliage that has already finished growing.
      this.flowers.forEach((f) => this.maybeGround(f));
    }

    sprite(key, build) {
      let s = this.sprites.get(key);
      if (!s) {
        s = build();
        this.sprites.set(key, s);
      }
      return s;
    }

    petalSprite(shape, color, S) {
      return this.sprite(`p|${shape}|${colorKey(color)}|${S}`, () => makePetalSprite(shape, color, S, false));
    }

    leafSprite(color, S) {
      return this.sprite(`l|${colorKey(color)}|${S}`, () => makePetalSprite('leaf', color, S, true));
    }

    centerSprite(kind, color, D) {
      return this.sprite(`c|${kind}|${colorKey(color)}|${D}`, () => makeCenterSprite(kind, color, D));
    }

    generate() {
      const { w: W, h: H } = this;
      const rng = mulberry32(this.seed);
      const dens = this.density;
      const base = clamp(Math.sqrt(W * H) * 0.075 * dens.size, 30, 96);
      this.base = base;

      const cx = W / 2;
      const cy = H / 2;
      const heroR = clamp(Math.min(W, H) * 0.22, base * 1.75, base * 2.7);
      this.heroR = heroR;

      const margin = base * 0.7;
      const pts = poissonDisc(-margin, -margin, W + margin, H + margin, base * dens.spacing, rng, [cx + base * 3, cy]);
      const maxDist = Math.hypot(W / 2 + margin, H / 2 + margin);
      const D = this.duration;
      const flowers = [];

      const pickType = () => {
        let v = rng();
        for (const [name, weight] of MAIN_TYPES) {
          if ((v -= weight) <= 0) return name;
        }
        return 'peony';
      };

      for (const [x, y] of pts) {
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < heroR * 0.82) continue;
        const type = pickType();
        const r = base * TYPES[type].size * lerp(0.84, 1.12, rng());
        const dn = clamp(dist / maxDist, 0, 1);
        // Outer beds start first, the wave closes in on the center.
        const startAt = D * (0.02 + 0.5 * (0.45 * (1 - dn) + 0.55 * rng()));
        flowers.push(this.makeFlower(x, y, r, type, rng, { z: 0.3 + rng() * 0.7, startAt, dur: D * lerp(0.36, 0.5, rng()) }));
      }

      // Small blossoms tucked into whatever gaps are left.
      for (let tries = 0; tries < 3500; tries++) {
        const x = -margin * 0.5 + rng() * (W + margin);
        const y = -margin * 0.5 + rng() * (H + margin);
        const rf = base * lerp(0.36, 0.5, rng());
        if (Math.hypot(x - cx, y - cy) < heroR * 0.95) continue;
        let ok = true;
        for (let i = 0; i < flowers.length; i++) {
          const f = flowers[i];
          const lim = f.r * (f.type === 'blossom' ? 1.1 : 0.7) + rf * 0.45;
          const dx = f.x - x;
          const dy = f.y - y;
          if (dx * dx + dy * dy < lim * lim) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        flowers.push(this.makeFlower(x, y, rf, 'blossom', rng, { z: rng() * 0.3, startAt: D * lerp(0.4, 0.75, rng()), dur: D * lerp(0.25, 0.35, rng()) }));
      }

      this.center = this.makeFlower(cx, cy, heroR, 'hero', rng, { z: 2, startAt: D * 0.24, dur: D * 0.68, color: this.coral });
      flowers.push(this.center);

      flowers.sort((a, b) => a.z - b.z);
      this.flowers = flowers;
      this.bloomed = false;
      this.classList.remove('is-bloomed');
      this.syncProgress();

      if (this.float) this.float.style.setProperty('--garden-logo-size', `${Math.round(heroR * 2 * this.logoScale)}px`);
    }

    makeFlower(x, y, r, type, rng, opts) {
      const def = TYPES[type];
      const color = opts.color || this.palette[Math.floor(rng() * this.palette.length)];
      const f = {
        x,
        y,
        r,
        type,
        def,
        color,
        z: opts.z,
        startAt: opts.startAt,
        dur: Math.max(0.5, opts.dur),
        p: 0,
        boost: 1,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        rot0: rng() * TAU,
        rot: 0,
        vrot: 0,
        pulse: 0,
        vpulse: 0,
        phase: rng() * TAU,
        kickAt: -1,
        kick: null,
        cache: null,
        grounded: false,
        isHero: type === 'hero',
        seedAngle: rng() * TAU,
        rng: mulberry32((rng() * 2 ** 31) | 0),
      };

      const leafCount = type === 'blossom' ? 3 : type === 'hero' ? 8 : 4 + Math.floor(rng() * 3);
      f.leaves = [];
      for (let i = 0; i < leafCount; i++) {
        f.leaves.push({
          a: f.rot0 + (i / leafCount) * TAU + (rng() - 0.5) * 0.7,
          len: r * (type === 'hero' ? lerp(1.05, 1.22, rng()) : lerp(1.05, 1.45, rng())),
          w: lerp(0.85, 1.15, rng()),
          tone: Math.floor(rng() * 3),
          delay: (i / leafCount) * 0.35,
        });
      }
      this.shapePetals(f, rng);
      return f;
    }

    shapePetals(f, rng) {
      const def = f.def;
      f.petals = [];
      f.ringColors = [];
      def.rings.forEach(([n0, len, w], k) => {
        const n = f.isHero || def.rings.length > 3 ? n0 : n0 + Math.round((rng() - 0.5) * 2);
        const off = rng() * TAU;
        for (let i = 0; i < n; i++) {
          f.petals.push({
            ring: k,
            a: off + (i / n) * TAU + (rng() - 0.5) * (TAU / n) * 0.22,
            len: len * lerp(0.93, 1.06, rng()),
            w: w * lerp(0.88, 1.1, rng()),
          });
        }
        if (f.isHero) {
          f.ringColors.push(k === 0 ? tone(f.color, -0.08) : mix(f.color, [255, 214, 196], Math.min(0.55, k * 0.07)));
        } else {
          f.ringColors.push(tone(f.color, def.ringTone * k));
        }
      });
      f.ringCount = def.rings.length;
    }

    syncProgress() {
      const t = this.elapsed;
      this.flowers.forEach((f) => {
        f.p = clamp((t - f.startAt) / f.dur, 0, 1);
      });
    }

    replant() {
      this.markInteracted();
      if (this.classList.contains('is-nav-open')) this.toggleNav(false);
      this.seed = (Math.random() * 2 ** 31) | 0;
      this.elapsed = this.reduced ? this.duration * 1.2 : 0;
      this.particles.length = 0;
      this.pollen.length = 0;
      this.ripples.length = 0;
      this.generate();
      this.rebuildGraphics();
      this.start();
    }

    /* ---------------- interaction ---------------- */

    hitTest(x, y) {
      for (let i = this.flowers.length - 1; i >= 0; i--) {
        const f = this.flowers[i];
        const reach = f.p >= STAGE.open[0] ? 0.92 : f.p >= STAGE.bud[0] ? 0.45 : 0;
        if (!reach) continue;
        const dx = x - (f.x + f.ox);
        const dy = y - (f.y + f.oy);
        if (dx * dx + dy * dy < f.r * reach * (f.r * reach)) return f;
      }
      let best = null;
      let bd = this.base * this.base;
      for (const f of this.flowers) {
        const d2 = (x - f.x) ** 2 + (y - f.y) ** 2;
        if (d2 < bd) {
          bd = d2;
          best = f;
        }
      }
      return best;
    }

    tap(x, y) {
      this.ripple(x, y, 1);
      const f = this.hitTest(x, y);
      if (!f) return;
      const t = this.elapsed;

      if (f.p < 1) {
        f.startAt = Math.min(f.startAt, t);
        f.boost = Math.max(f.boost, f.isHero ? 9 : 12);
        f.vpulse += 2.5;
        this.burst(f, 8, true);
        return;
      }

      if (f.isHero) {
        f.vpulse += 3.5;
        f.vrot += 1.2;
        this.burst(f, 30);
        return;
      }

      this.rebloom(f);
    }

    rebloom(f) {
      // Shed the old petals...
      const count = Math.min(14, 6 + Math.round(f.r / 10));
      const sp = this.petalSprite(f.def.shape, f.color, this.petalSize(f));
      for (let i = 0; i < count; i++) {
        const a = f.rng() * TAU;
        const speed = lerp(60, 220, f.rng());
        this.particles.push({
          sp,
          x: f.x + f.ox + Math.cos(a) * f.r * 0.3,
          y: f.y + f.oy + Math.sin(a) * f.r * 0.3,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          rot: a,
          vrot: (f.rng() - 0.5) * 6,
          len: f.r * f.def.rings[0][1] * lerp(0.55, 0.8, f.rng()),
          w: f.r * f.def.rings[0][2] * 0.8,
          life: 0,
          ttl: lerp(1.1, 1.8, f.rng()),
          flutter: f.rng() * TAU,
        });
      }
      if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);

      // ...and come back as a bud in a fresh color.
      const others = this.palette.filter((c) => colorKey(c) !== colorKey(f.color));
      f.color = others.length ? others[Math.floor(f.rng() * others.length)] : f.color;
      this.shapePetals(f, f.rng);
      this.releaseCache(f);
      f.p = 0.46;
      f.boost = 3.2;
      f.vpulse += 2;
      f.vrot += (f.rng() - 0.5) * 3;
      this.burst(f, 10);
    }

    releaseCache(f) {
      if (f.cache) {
        this.cachePixels -= f.cache.width * f.cache.height;
        f.cache = null;
      }
    }

    ripple(x, y, strength) {
      this.ripples.push({ x, y, t: 0, s: strength });
      if (this.ripples.length > 6) this.ripples.shift();
      const reach = this.base * 5.5 * strength;
      const speed = this.base * 9;
      for (const f of this.flowers) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d > reach || d < 1) continue;
        const fall = 1 - d / reach;
        f.kickAt = this.elapsed + d / speed;
        const push = fall * this.base * 5.5 * strength;
        f.kick = { x: (dx / d) * push, y: (dy / d) * push, spin: (Math.random() - 0.5) * 3 * fall, pulse: 1.4 * fall };
        if (f.p < 1 && !f.isHero) {
          f.startAt = Math.min(f.startAt, this.elapsed + d / speed);
          f.boost = Math.max(f.boost, 1 + 3.5 * fall);
        }
      }
    }

    burst(f, n, droplets) {
      if (this.reduced || !f) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = lerp(20, 130, Math.random());
        this.pollen.push({
          x: f.x + f.ox + Math.cos(a) * f.r * 0.25,
          y: f.y + f.oy + Math.sin(a) * f.r * 0.25,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 0,
          ttl: lerp(0.7, 1.6, Math.random()),
          size: lerp(3, 8, Math.random()),
          drop: !!droplets,
        });
      }
      if (this.pollen.length > 260) this.pollen.splice(0, this.pollen.length - 260);
    }

    /* ---------------- loop ---------------- */

    start() {
      if (this.running || !this.isConnected) return;
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
        this.watchPerformance(dt);
        this.update(dt);
        this.render();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    watchPerformance(dt) {
      // Drop to 1× resolution on devices that cannot keep up.
      if (this.dpr <= 1 || this.elapsed < 1.5) return;
      const ft = this.frameTimes;
      ft.push(dt);
      if (ft.length < 90) return;
      const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
      ft.length = 0;
      if (avg > 0.03) {
        this.maxDpr = 1;
        this.dpr = 1;
        this.rebuildGraphics();
      }
    }

    update(dt) {
      this.elapsed += dt;
      const t = this.elapsed;
      const ptr = this.pointer;
      const base = this.base;
      const reduced = this.reduced;
      const reach = base * 2.7;
      const speedPtr = Math.hypot(ptr.vx, ptr.vy);
      const gust = 0.65 + 0.35 * Math.sin(t * 0.23);

      if (ptr.active && !ptr.down && ptr.type !== 'mouse') ptr.active = false;
      const decay = Math.exp(-dt * 7);
      ptr.vx *= decay;
      ptr.vy *= decay;

      // A trail of pollen (or water, while pressing) follows quick strokes.
      if (ptr.active && !reduced && speedPtr > 160) {
        ptr.emit += dt * Math.min(90, speedPtr / 8);
        while (ptr.emit > 1) {
          ptr.emit -= 1;
          this.pollen.push({
            x: ptr.x + (Math.random() - 0.5) * 18,
            y: ptr.y + (Math.random() - 0.5) * 18,
            vx: ptr.vx * 0.12 + (Math.random() - 0.5) * 40,
            vy: ptr.vy * 0.12 + (Math.random() - 0.5) * 40,
            life: 0,
            ttl: lerp(0.5, 1.1, Math.random()),
            size: lerp(2.5, 6, Math.random()),
            drop: ptr.down,
          });
        }
      }

      for (const f of this.flowers) {
        if (t >= f.startAt && f.p < 1) {
          f.p = Math.min(1, f.p + (dt / f.dur) * f.boost);
          if (f.p >= 1) f.boost = 1;
        }
        this.maybeGround(f);

        let tx = 0;
        let ty = 0;
        let tr = 0;
        const head = range(f.p, STAGE.bud[0], STAGE.open[1]);

        if (!reduced && head > 0) {
          const amp = base * 0.04 * gust * (f.isHero ? 0.35 : 1);
          tx += (Math.sin(t * 0.9 + f.x * 0.006 + f.y * 0.003) * 0.7 + Math.sin(t * 2.1 + f.phase) * 0.3) * amp;
          ty += (Math.cos(t * 0.7 + f.y * 0.005 - f.x * 0.002) * 0.7 + Math.cos(t * 1.8 + f.phase) * 0.3) * amp * 0.8;
          tr += Math.sin(t * 0.8 + f.phase) * 0.05 * gust;
        }

        if (ptr.active && head > 0) {
          const dx = f.x - ptr.x;
          const dy = f.y - ptr.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < reach) {
            let fall = 1 - d / reach;
            fall *= fall;
            const give = f.isHero ? 0.25 : 1;
            if (!reduced) {
              tx += (dx / d) * fall * base * 0.55 * give;
              ty += (dy / d) * fall * base * 0.55 * give;
              f.vx += ptr.vx * fall * dt * 3 * give;
              f.vy += ptr.vy * fall * dt * 3 * give;
              f.vrot += ((dx * ptr.vy - dy * ptr.vx) / (d * base)) * fall * dt * 0.9 * give;
            }
          }
        }

        // Watering: pressing and dragging wakes up and hurries the beds.
        if (ptr.down && f.p < 1) {
          const d = Math.hypot(f.x - ptr.x, f.y - ptr.y);
          if (d < reach * 1.1) {
            const fall = 1 - d / (reach * 1.1);
            f.startAt = Math.min(f.startAt, t);
            f.boost = Math.max(f.boost, 1 + 4.5 * fall);
          }
        }

        if (f.kick && t >= f.kickAt) {
          if (!reduced) {
            f.vx += f.kick.x;
            f.vy += f.kick.y;
            f.vrot += f.kick.spin;
            f.vpulse += f.kick.pulse;
          }
          f.kick = null;
        }

        // Springs back toward the resting position.
        const k = f.isHero ? 70 : 55;
        const c = f.isHero ? 11 : 8.5;
        f.vx += ((tx - f.ox) * k - f.vx * c) * dt;
        f.vy += ((ty - f.oy) * k - f.vy * c) * dt;
        f.ox += f.vx * dt;
        f.oy += f.vy * dt;
        const lim = base * 0.95;
        f.ox = clamp(f.ox, -lim, lim);
        f.oy = clamp(f.oy, -lim, lim);
        f.vrot += ((tr - f.rot) * 30 - f.vrot * 6) * dt;
        f.rot += f.vrot * dt;
        f.vpulse += (-f.pulse * 400 - f.vpulse * 12) * dt;
        f.pulse = clamp(f.pulse + f.vpulse * dt, -0.2, 0.35);
      }

      if (!this.bloomed && this.center && this.center.p >= 0.94) this.reveal();

      for (const p of this.particles) {
        p.life += dt;
        const drag = Math.exp(-dt * 1.6);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
      }
      this.particles = this.particles.filter((p) => p.life < p.ttl);

      for (const p of this.pollen) {
        p.life += dt;
        const drag = Math.exp(-dt * 2.2);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.pollen = this.pollen.filter((p) => p.life < p.ttl);

      for (const r of this.ripples) r.t += dt;
      this.ripples = this.ripples.filter((r) => r.t < 1.2);
    }

    reveal() {
      this.bloomed = true;
      this.classList.add('is-bloomed');
      if (this.reduced) return;
      const c = this.center;
      this.ripple(c.x, c.y, 0.8);
      this.burst(c, 46);
    }

    maybeGround(f) {
      if (f.grounded || f.p < STAGE.leaves[1] + 0.02) return;
      // Leaves are finished and the seed/sprout are gone: paint them into the ground layer.
      const g = this.ground.getContext('2d');
      this.drawFoliage(g, f, 1, this.dpr, f.x * this.dpr, f.y * this.dpr);
      f.grounded = true;
    }

    /* ---------------- drawing ---------------- */

    petalSize(f) {
      return bucket(f.r * (f.isHero ? 1 : 1.1) * this.dpr);
    }

    put(g, sp, k, tx, ty, angle, base, len, width) {
      if (len < 0.3 || width < 0.3) return;
      const kx = len / sp.S;
      const ky = width / sp.W;
      const c = Math.cos(angle) * k;
      const s = Math.sin(angle) * k;
      g.setTransform(c, s, -s, c, tx, ty);
      g.drawImage(sp.img, base - sp.pad * kx, -(sp.W / 2 + sp.pad) * ky, sp.img.width * kx, sp.img.height * ky);
    }

    putRound(g, img, k, tx, ty, angle, cx, cy, size) {
      if (size < 0.3) return;
      const c = Math.cos(angle) * k;
      const s = Math.sin(angle) * k;
      g.setTransform(c, s, -s, c, tx, ty);
      g.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    }

    drawFoliage(g, f, p, k, tx, ty) {
      const seedIn = range(p, STAGE.seed[0], STAGE.seed[1]);
      const sprout = range(p, STAGE.sprout[0], STAGE.sprout[1]);
      const leaves = range(p, STAGE.leaves[0], STAGE.leaves[1]);
      if (seedIn <= 0) return;
      const r = f.r;

      // Disturbed soil where the seed went in.
      if (leaves < 1) {
        g.globalAlpha = 0.45 * seedIn * (1 - leaves);
        this.putRound(g, this.shadowSprite, k, tx, ty, 0, 0, 0, r * 0.75);
      }

      // Leaf rosette.
      const leafS = bucket(r * 1.05 * this.dpr);
      for (const leaf of f.leaves) {
        const lp = range(leaves, leaf.delay, leaf.delay + 0.65);
        if (lp <= 0) continue;
        const grow = easeOutBack(lp);
        g.globalAlpha = Math.min(1, lp * 3);
        const sp = this.leafSprite(this.leafColors[leaf.tone], leafS);
        this.put(g, sp, k, tx, ty, leaf.a, r * 0.04, leaf.len * grow, r * 0.52 * leaf.w * lerp(0.55, 1, lp));
      }

      // Seed leaves unfold, then get covered by the rosette.
      if (sprout > 0 && leaves < 1) {
        g.globalAlpha = 1 - range(leaves, 0.55, 1);
        const sp = this.petalSprite('round', this.sproutColor, bucket(r * 0.4 * this.dpr));
        const len = r * 0.34 * easeOutBack(sprout);
        this.put(g, sp, k, tx, ty, f.seedAngle, r * 0.02, len, len * 0.72);
        this.put(g, sp, k, tx, ty, f.seedAngle + Math.PI, r * 0.02, len, len * 0.72);
      }

      // The seed drops in, then splits as the sprout pushes through.
      if (sprout < 0.9) {
        const fade = 1 - range(sprout, 0.35, 0.9);
        const drop = 1 + 1.6 * (1 - easeOutCubic(seedIn));
        g.globalAlpha = Math.min(1, seedIn * 1.4) * fade;
        const s = this.seedSprite;
        const w = r * 0.3 * drop;
        const h = w * (s.height / s.width);
        const split = sprout * r * 0.1;
        const c = Math.cos(f.seedAngle + Math.PI / 2) * k;
        const sn = Math.sin(f.seedAngle + Math.PI / 2) * k;
        g.setTransform(c, sn, -sn, c, tx, ty);
        if (split < 0.5) {
          g.drawImage(s, -w / 2, -h / 2, w, h);
        } else {
          g.drawImage(s, 0, 0, s.width / 2, s.height, -w / 2 - split, -h / 2, w / 2, h);
          g.drawImage(s, s.width / 2, 0, s.width / 2, s.height, split, -h / 2, w / 2, h);
        }
      }
      g.globalAlpha = 1;
    }

    drawBloom(g, f, p, k, tx, ty, rot) {
      const budP = range(p, STAGE.bud[0], STAGE.bud[1]);
      if (budP <= 0) return;
      const openP = range(p, STAGE.open[0], STAGE.open[1]);
      const def = f.def;
      const r = f.r;
      const budScale = easeOutBack(budP);
      const openE = smooth(openP);
      const S = this.petalSize(f);

      // Sepals cradle the bud and stay tucked beneath the petals.
      const sepal = this.petalSprite('pointed', this.sepalColor, bucket(r * 0.5 * this.dpr));
      for (let i = 0; i < 5; i++) {
        const a = rot + (i / 5) * TAU + 0.3;
        this.put(g, sepal, k, tx, ty, a, 0, r * lerp(0.36, 0.6, openE) * budScale, r * 0.2 * budScale);
      }

      const rings = f.ringCount;
      const stagger = rings > 1 ? 0.5 / rings : 0;
      const span = 1 - (rings - 1) * stagger;
      const baseOff = r * def.base * lerp(0.3, 1, openE);
      let lastRing = -1;
      let sp = null;
      let ro = 0;

      for (const pt of f.petals) {
        if (pt.ring !== lastRing) {
          lastRing = pt.ring;
          sp = this.petalSprite(def.shape, f.ringColors[pt.ring], S);
          ro = smooth(range(openP, pt.ring * stagger, pt.ring * stagger + span));
        }
        const closed = r * (0.3 - pt.ring * 0.018);
        const len = lerp(Math.max(closed, r * 0.08), r * pt.len, ro) * budScale;
        const wid = r * pt.w * lerp(0.72, 1, ro) * budScale;
        const angle = rot + pt.a + def.twist * (1 - ro);
        this.put(g, sp, k, tx, ty, angle, baseOff * ro, len, wid);
      }

      if (def.center) {
        const ce = smooth(range(openP, 0.35, 0.85));
        if (ce > 0) {
          const size = r * def.centerSize * 2 * lerp(0.55, 1, ce);
          const D = bucket(r * def.centerSize * 2 * this.dpr);
          g.globalAlpha = ce;
          this.putRound(g, this.centerSprite(def.center, f.color, D), k, tx, ty, rot, 0, 0, size);
          g.globalAlpha = 1;
        }
      }
    }

    drawShadow(g, f, p, k, tx, ty) {
      // Soft shadow the head casts on the beds below (light from the top left).
      const budP = range(p, STAGE.bud[0], STAGE.bud[1]);
      if (budP <= 0) return;
      const r = f.r;
      const head = r * lerp(0.42, 1.02, smooth(range(p, STAGE.open[0], STAGE.open[1]))) * easeOutBack(budP);
      g.globalAlpha = 0.55 * budP;
      this.putRound(g, this.shadowSprite, k, tx, ty, 0, r * 0.07, r * 0.1, head * 2.15);
      g.globalAlpha = 1;
    }

    bloomCache(f) {
      if (f.cache) return f.cache;
      const cs = this.cacheScale;
      const half = f.r * 1.2;
      const size = Math.ceil(half * 2 * cs);
      if (this.cachePixels + size * size > CACHE_PIXEL_BUDGET) return null;
      const c = makeCanvas(size, size);
      const g = c.getContext('2d');
      this.drawBloom(g, f, 1, cs, size / 2, size / 2, 0);
      f.cache = c;
      this.cachePixels += size * size;
      return c;
    }

    render() {
      const g = this.ctx;
      const { dpr, elapsed: t } = this;

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(this.ground, 0, 0);

      for (const f of this.flowers) {
        if (!f.grounded && f.p > 0) this.drawFoliage(g, f, f.p, dpr, f.x * dpr, f.y * dpr);
      }

      for (const f of this.flowers) {
        if (f.p < STAGE.bud[0]) continue;
        const breathe = this.reduced ? 0 : 0.012 * Math.sin(t * 1.4 + f.phase) * range(f.p, 0.8, 1);
        const scale = 1 + f.pulse + breathe;
        const x = (f.x + f.ox) * dpr;
        const y = (f.y + f.oy) * dpr;
        const rot = f.rot0 + f.rot;

        this.drawShadow(g, f, f.p, dpr * scale, x, y);
        const cache = f.p >= 1 && !f.isHero ? this.bloomCache(f) : null;
        if (cache) {
          const k = (dpr * scale) / this.cacheScale;
          const c = Math.cos(rot) * k;
          const s = Math.sin(rot) * k;
          g.setTransform(c, s, -s, c, x, y);
          g.drawImage(cache, -cache.width / 2, -cache.height / 2);
        } else {
          this.drawBloom(g, f, f.p, dpr * scale, x, y, rot);
        }
      }

      for (const p of this.particles) {
        const life = p.life / p.ttl;
        const lift = 1 + life * 0.7;
        g.globalAlpha = (1 - life) * (1 - life);
        const flutter = 0.55 + 0.45 * Math.abs(Math.sin(p.flutter + p.life * 7));
        this.put(g, p.sp, dpr * lift, p.x * dpr, p.y * dpr, p.rot, -p.len * 0.5, p.len, p.w * flutter);
      }

      g.setTransform(1, 0, 0, 1, 0, 0);
      for (const p of this.pollen) {
        const life = p.life / p.ttl;
        g.globalAlpha = Math.sin(Math.PI * Math.min(1, life * 1.4 + 0.1)) * 0.9;
        const s = p.size * dpr * (p.drop ? 1.2 : 1);
        g.drawImage(p.drop ? this.dropSprite : this.pollenSprite, p.x * dpr - s / 2, p.y * dpr - s / 2, s, s);
      }

      for (const rp of this.ripples) {
        const life = rp.t / 1.2;
        const rad = this.base * (0.3 + 5.2 * easeOutCubic(life)) * rp.s * dpr;
        g.globalAlpha = (1 - life) * 0.55;
        g.strokeStyle = 'rgba(255, 248, 238, 1)';
        g.lineWidth = (1 - life) * 3 * dpr + 0.5;
        g.beginPath();
        g.arc(rp.x * dpr, rp.y * dpr, rad, 0, TAU);
        g.stroke();
      }
      g.globalAlpha = 1;

      if (this.float && this.center) {
        const c = this.center;
        this.float.style.transform = `translate(${c.ox.toFixed(2)}px, ${c.oy.toFixed(2)}px) scale(${(1 + c.pulse * 0.6).toFixed(4)})`;
      }
    }
  }

  customElements.define('garden-splash', GardenSplash);
})();
