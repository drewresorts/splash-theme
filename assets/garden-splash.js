/**
 * Garden splash
 *
 * A top-down garden made like a cut-and-paste collage. Every flower is a
 * roughly scissored asterisk (after the Duet mark) built from scraps of
 * construction paper, halftone print, newsprint, stripes and tissue. Each one
 * grows seed → sprout → leaves → crumpled bud → bloom, stepping along at a
 * stop-motion frame rate, until the scraps overlap and fill the screen. The
 * fuchsia flower in the middle opens last and the logo is pasted on top of it
 * (a DOM element positioned over the canvas).
 *
 * Interaction (mouse, pen and touch share one code path):
 *  - moving through the garden pushes the paper flowers aside
 *  - pressing and dragging "waters" the beds so nearby flowers grow faster
 *  - tapping sends a ripple out; a growing flower blooms immediately and an
 *    open flower throws off its arms and is re-cut from new paper
 */
(function () {
  'use strict';

  if (!window.customElements || customElements.get('garden-splash')) return;

  const TAU = Math.PI * 2;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const range = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
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

  /* ------------------------------------------------------------------ */
  /* Color helpers                                                       */
  /* ------------------------------------------------------------------ */

  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];
  const PAPER = [244, 239, 228];
  const INK = [24, 22, 30];
  const KRAFT = [190, 146, 96];

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
  /* Scissor-cut geometry                                                */
  /* ------------------------------------------------------------------ */

  /* Points between a and b that make a straight cut look hand-scissored. */
  function facetEdge(a, b, rng, amt, out) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const nx = -dy / len;
    const ny = dx / len;
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 1; i <= n; i++) {
      const t = (i + (rng() - 0.5) * 0.5) / (n + 1);
      const o = (rng() - 0.5) * amt * len;
      out.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
    }
  }

  /* Points between a and b that make a ragged, torn edge. */
  function tornEdge(a, b, rng, amp, out) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / (len || 1);
    const ny = dx / (len || 1);
    const steps = Math.max(3, Math.round(len / Math.max(1, amp * 1.5)));
    for (let i = 1; i < steps; i++) {
      const t = (i + (rng() - 0.5) * 0.6) / steps;
      const o = (rng() - 0.5) * 2 * amp;
      out.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
    }
  }

  function roughen(corners, rng, amt) {
    const out = [];
    for (let i = 0; i < corners.length; i++) {
      out.push(corners[i]);
      facetEdge(corners[i], corners[(i + 1) % corners.length], rng, amt, out);
    }
    return out;
  }

  /* A circle cut with scissors: a handful of flat facets. */
  function cutCircle(cx, cy, r, rng, n, jitter) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + (rng() - 0.5) * 0.5) / n) * TAU;
      const rr = r * (1 + (rng() - 0.5) * jitter);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  }

  /* A circle torn out by hand: many small ragged steps. */
  function tornCircle(cx, cy, r, rng, amp) {
    const n = Math.max(20, Math.round((TAU * r) / Math.max(1.5, amp * 1.3)));
    const pts = [];
    let drift = 0;
    for (let i = 0; i < n; i++) {
      drift = drift * 0.7 + (rng() - 0.5) * amp * 0.9;
      const a = ((i + (rng() - 0.5) * 0.4) / n) * TAU;
      const rr = r + drift + (rng() - 0.5) * amp;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  }

  /* One arm of an asterisk: a chunky strip running out from under the middle. */
  function armShape(len, w, rng, torn) {
    const back = -w * lerp(0.3, 0.55, rng());
    const hw0 = (w / 2) * lerp(0.9, 1.06, rng());
    const hw1 = (w / 2) * lerp(0.86, 1.14, rng());
    const cut = (rng() - 0.5) * 0.95;
    const bTop = [back, -hw0];
    const bBot = [back + (rng() - 0.5) * w * 0.3, hw0];
    const tTop = [len + Math.tan(cut) * hw1, -hw1];
    const tBot = [len - Math.tan(cut) * hw1, hw1];

    const head = [bTop];
    facetEdge(bTop, tTop, rng, 0.03, head);
    head.push(tTop);
    const tail = [tBot];
    facetEdge(tBot, bBot, rng, 0.03, tail);
    tail.push(bBot);

    if (!torn) {
      const end = [];
      facetEdge(tTop, tBot, rng, 0.08, end);
      return { poly: head.concat(end, tail), under: null };
    }

    // Torn ends show the white core of the paper beyond the printed face.
    const amp = w * 0.08;
    const e = amp * 1.4;
    const face = [];
    tornEdge(tTop, tBot, rng, amp, face);
    const core = [];
    tornEdge([tTop[0] + e, tTop[1]], [tBot[0] + e, tBot[1]], rng, amp, core);
    return {
      poly: head.concat(face, tail),
      under: head.concat([[tTop[0] + e, tTop[1]]], core, [[tBot[0] + e, tBot[1]]], tail),
    };
  }

  function leafShape(len, w, rng) {
    const top = [];
    const bottom = [];
    const n = 4 + Math.floor(rng() * 2);
    const bulge = lerp(0.6, 0.85, rng());
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const y = (w / 2) * Math.sin(Math.PI * Math.pow(t, bulge));
      top.push([len * t + (rng() - 0.5) * w * 0.15, -y * lerp(0.85, 1.12, rng())]);
      bottom.push([len * t + (rng() - 0.5) * w * 0.15, y * lerp(0.85, 1.12, rng())]);
    }
    return [[0, 0]].concat(top, [[len, (rng() - 0.5) * w * 0.2]], bottom.reverse());
  }

  function bladeShape(len, w, rng) {
    return roughen(
      [
        [0, -w * 0.5],
        [len * lerp(0.7, 0.85, rng()), -w * 0.46],
        [len, (rng() - 0.5) * w * 0.5],
        [len * lerp(0.75, 0.9, rng()), w * 0.46],
        [0, w * 0.5],
      ],
      rng,
      0.03
    );
  }

  function tapeShape(cx, cy, len, w, angle, rng) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const amp = w * 0.09;
    const local = [[-len / 2, -w / 2]];
    local.push([len / 2, -w / 2]);
    tornEdge([len / 2, -w / 2], [len / 2, w / 2], rng, amp, local);
    local.push([len / 2, w / 2], [-len / 2, w / 2]);
    tornEdge([-len / 2, w / 2], [-len / 2, -w / 2], rng, amp, local);
    return local.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }

  /* ------------------------------------------------------------------ */
  /* Paper                                                               */
  /* ------------------------------------------------------------------ */

  const MATERIALS = ['paper', 'paper', 'paper', 'halftone', 'halftone', 'newsprint', 'stripes', 'dots', 'check', 'crayon', 'tissue'];
  const LEAF_MATERIALS = ['paper', 'paper', 'halftone', 'newsprint', 'stripes', 'crayon'];

  function tracePath(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  function bounds(pts) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  function faceColor(material, c) {
    return material === 'newsprint' ? mix(c, PAPER, 0.62) : c;
  }

  /* Print, pattern and grain on a scrap. Assumes it is already clipped to the shape. */
  function texture(g, o, b) {
    const rng = o.rng;
    const c = o.color;
    const c2 = o.color2 || INK;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const R = Math.hypot(b.w, b.h) / 2 + 2;

    g.save();
    g.translate(cx, cy);
    g.rotate(rng() * Math.PI);

    switch (o.material) {
      case 'halftone': {
        const sp = lerp(3.2, 4.8, rng());
        g.fillStyle = rgba(c2, 0.8);
        g.beginPath();
        let row = 0;
        for (let y = -R; y < R; y += sp, row++) {
          for (let x = -R + (row % 2) * (sp / 2); x < R; x += sp) {
            const t = (x + R) / (2 * R);
            const rr = sp * 0.44 * (0.2 + 0.8 * t);
            g.moveTo(x + rr, y);
            g.arc(x, y, rr, 0, TAU);
          }
        }
        g.fill();
        break;
      }
      case 'stripes': {
        const sp = lerp(5, 9, rng());
        g.fillStyle = rgba(c2, 0.88);
        for (let x = -R; x < R; x += sp) g.fillRect(x, -R, sp * lerp(0.35, 0.5, rng()), R * 2);
        break;
      }
      case 'dots': {
        const sp = lerp(7, 10, rng());
        const rr = sp * lerp(0.16, 0.26, rng());
        g.fillStyle = rgba(c2, 0.9);
        g.beginPath();
        let row = 0;
        for (let y = -R; y < R; y += sp, row++) {
          for (let x = -R + (row % 2) * (sp / 2); x < R; x += sp) {
            g.moveTo(x + rr, y);
            g.arc(x, y, rr, 0, TAU);
          }
        }
        g.fill();
        break;
      }
      case 'check': {
        const sp = lerp(5, 8, rng());
        g.fillStyle = rgba(c2, 0.3);
        for (let x = -R; x < R; x += sp * 2) g.fillRect(x, -R, sp, R * 2);
        for (let y = -R; y < R; y += sp * 2) g.fillRect(-R, y, R * 2, sp);
        break;
      }
      case 'crayon': {
        g.strokeStyle = rgba(c2, 0.5);
        g.lineWidth = lerp(1, 1.6, rng());
        g.lineJoin = 'round';
        g.beginPath();
        let side = -1;
        g.moveTo(-R, -R);
        for (let y = -R; y < R; y += lerp(2.2, 3.4, rng())) {
          g.lineTo(side * R * lerp(0.7, 1, rng()), y);
          side = -side;
        }
        g.stroke();
        break;
      }
      case 'newsprint': {
        g.fillStyle = rgba(INK, 0.5);
        for (let y = -R; y < R; y += 2.9) {
          if (rng() < 0.07) {
            g.fillStyle = rgba(c, 0.85);
            g.fillRect(-R, y, R * 2, 4.2);
            g.fillStyle = rgba(INK, 0.5);
            y += 3;
            continue;
          }
          let x = -R + rng() * 3;
          while (x < R) {
            const wl = lerp(1.2, 6.5, rng());
            g.fillRect(x, y, wl, 1.1);
            x += wl + lerp(0.9, 1.7, rng());
          }
        }
        break;
      }
      case 'tissue': {
        g.lineWidth = 0.8;
        for (let i = 0; i < 7; i++) {
          g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.1)';
          g.beginPath();
          g.moveTo((rng() - 0.5) * R * 2, -R);
          g.lineTo((rng() - 0.5) * R * 2, R);
          g.stroke();
        }
        break;
      }
      default:
        break;
    }
    g.restore();

    // Paper grain and the odd fibre.
    const grains = Math.min(520, Math.round((b.w * b.h) / 16));
    const dark = luminance(c) > 0.5 ? 'rgba(40,30,20,0.08)' : 'rgba(255,250,240,0.07)';
    for (let i = 0; i < grains; i++) {
      g.fillStyle = i % 3 ? dark : 'rgba(255,255,255,0.08)';
      const s = lerp(0.5, 1.2, rng());
      g.fillRect(b.x0 + rng() * b.w, b.y0 + rng() * b.h, s, s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 0.5;
    const fibres = Math.min(14, Math.round((b.w * b.h) / 900));
    for (let i = 0; i < fibres; i++) {
      const x = b.x0 + rng() * b.w;
      const y = b.y0 + rng() * b.h;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rng() - 0.5) * 8, y + (rng() - 0.5) * 8, x + (rng() - 0.5) * 12, y + (rng() - 0.5) * 12);
      g.stroke();
    }

    // A fold down the middle: one half catches less light.
    if (o.fold) {
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.fillRect(b.x0 - 2, 0, b.w + 4, b.h + 4);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(b.x0, -0.4);
      g.lineTo(b.x1, -0.4);
      g.stroke();
    }

    // Crumpled paper: creases catching and losing the light.
    if (o.crumple) {
      for (let i = 0; i < 6; i++) {
        const a = rng() * TAU;
        const r = Math.max(b.w, b.h);
        const x = (rng() - 0.5) * b.w * 0.6;
        const y = (rng() - 0.5) * b.h * 0.6;
        const ex = Math.cos(a) * r;
        const ey = Math.sin(a) * r;
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + ex, y + ey);
        g.lineTo(x + Math.cos(a + 0.9) * r, y + Math.sin(a + 0.9) * r);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x - ex, y - ey);
        g.lineTo(x + ex, y + ey);
        g.stroke();
      }
    }
  }

  /*
   * Paints one scrap into a context that is already transformed into the
   * scrap's local units. shadow = [dx, dy] in device pixels of that context.
   */
  function paintScrap(g, o, shadow, deviceScale) {
    g.shadowOffsetX = shadow[0];
    g.shadowOffsetY = shadow[1];
    g.shadowBlur = 2.4 * deviceScale;
    g.shadowColor = o.shadowColor || 'rgba(14,8,4,0.42)';

    if (o.under) {
      tracePath(g, o.under);
      g.fillStyle = rgba(PAPER);
      g.fill();
      g.shadowColor = 'transparent';
    }

    g.globalAlpha = o.alpha || 1;
    tracePath(g, o.poly);
    g.fillStyle = rgba(faceColor(o.material, o.color));
    g.fill();
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = 0;

    g.save();
    tracePath(g, o.poly);
    g.clip();
    texture(g, o, bounds(o.poly));
    g.restore();
    g.globalAlpha = 1;
  }

  /*
   * Cuts a scrap out into its own little canvas. worldAngle is how the scrap
   * will sit on screen, so its baked shadow falls toward the bottom right.
   */
  function makeScrap(o, scale, worldAngle) {
    const b = bounds(o.under ? o.poly.concat(o.under) : o.poly);
    const pad = 5;
    const w = b.w + pad * 2;
    const h = b.h + pad * 2;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * scale));
    c.height = Math.max(1, Math.ceil(h * scale));
    const g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, (pad - b.x0) * scale, (pad - b.y0) * scale);
    const ca = Math.cos(-worldAngle);
    const sa = Math.sin(-worldAngle);
    const sx = 1.5;
    const sy = 2.6;
    paintScrap(g, o, [(sx * ca - sy * sa) * scale, (sx * sa + sy * ca) * scale], scale);
    return { img: c, x: b.x0 - pad, y: b.y0 - pad, w: c.width / scale, h: c.height / scale };
  }

  function paintGround(g, W, H, soil, rng) {
    g.fillStyle = rgba(soil);
    g.fillRect(0, 0, W, H);

    const blobs = Math.round((W * H) / 30000) + 10;
    for (let i = 0; i < blobs; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = 50 + rng() * 170;
      const c = rng() < 0.5 ? tone(soil, 0.12) : tone(soil, -0.3);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(c, 0.3));
      grad.addColorStop(1, rgba(c, 0));
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Torn scraps of brown paper and old newsprint glued down as soil.
    const scraps = Math.round((W * H) / 42000) + 6;
    for (let i = 0; i < scraps; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const sw = 40 + rng() * 140;
      const sh = 30 + rng() * 90;
      const corners = [[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]];
      const poly = [];
      corners.forEach((p, k) => {
        poly.push(p);
        tornEdge(p, corners[(k + 1) % 4], rng, 2.6, poly);
      });
      const news = rng() < 0.25;
      g.save();
      g.translate(x, y);
      g.rotate(rng() * TAU);
      paintScrap(
        g,
        { poly, material: news ? 'newsprint' : 'paper', color: news ? PAPER : tone(soil, rng() < 0.5 ? 0.1 : -0.18), alpha: news ? 0.22 : 0.75, rng },
        [0, 0],
        1
      );
      g.restore();
    }

    const specks = Math.round((W * H) / 90);
    for (let i = 0; i < specks; i++) {
      g.fillStyle = rgba(rng() < 0.6 ? tone(soil, -0.4) : tone(soil, 0.2 + rng() * 0.25), 0.45);
      const s = 0.6 + rng() * 1.6;
      g.fillRect(rng() * W, rng() * H, s, s);
    }

    // A few loose pencil loops, as if someone sketched the beds first.
    g.strokeStyle = rgba(PAPER, 0.1);
    g.lineWidth = 1.2;
    const loops = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < loops; i++) {
      let x = rng() * W;
      let y = rng() * H;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        const nx = x + (rng() - 0.5) * 120;
        const ny = y + (rng() - 0.5) * 120;
        g.quadraticCurveTo(x + (rng() - 0.5) * 80, y + (rng() - 0.5) * 80, nx, ny);
        x = nx;
        y = ny;
      }
      g.stroke();
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
  /* Flowers                                                             */
  /* ------------------------------------------------------------------ */

  /*
   * Asterisk varieties. arms: count range; len/w: arm length and width as a
   * fraction of the flower radius. inner: an optional second, smaller asterisk
   * pasted on top. center: chance of a punched or torn paper dot in the middle.
   */
  const TYPES = {
    aster: { size: 1.06, arms: [5, 5], len: [0.86, 1.04], w: [0.3, 0.4], center: 0.2 },
    spoke: { size: 1, arms: [6, 8], len: [0.84, 1.02], w: [0.18, 0.26], center: 0.55 },
    double: { size: 1.1, arms: [5, 6], len: [0.88, 1.04], w: [0.26, 0.34], inner: [4, 5], innerLen: [0.48, 0.62], innerW: [0.2, 0.28], center: 0.35 },
    burst: { size: 0.98, arms: [9, 12], len: [0.8, 1], w: [0.09, 0.14], center: 1, centerSize: [0.22, 0.3] },
    mini: { size: 1, arms: [4, 5], len: [0.8, 1], w: [0.3, 0.42], center: 0.25 },
    hero: { size: 1, arms: [5, 5], len: [0.98, 1.06], w: [0.32, 0.38], center: 1 },
  };

  const MAIN_TYPES = [
    ['aster', 0.32],
    ['spoke', 0.22],
    ['double', 0.26],
    ['burst', 0.2],
  ];

  const DENSITY = {
    airy: { size: 1.18, spacing: 1.32 },
    lush: { size: 1, spacing: 1.18 },
    overgrown: { size: 0.84, spacing: 1.1 },
  };

  /* Growth milestones on a flower's 0 → 1 progress. */
  const STAGE = {
    seed: [0, 0.07],
    sprout: [0.06, 0.26],
    leaves: [0.18, 0.5],
    bud: [0.42, 0.62],
    open: [0.6, 1],
  };

  /* Stop-motion: growth is shown on "twos and threes", pieces boil in place. */
  const GROWTH_FPS = 12;
  const BOIL_FPS = 7;
  const JITTER = Array.from({ length: 64 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);

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
      this.flowers = [];
      this.particles = [];
      this.confetti = [];
      this.ripples = [];
      this.pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false, id: null, t: 0, sx: 0, sy: 0, st: 0, emit: 0 };
      this.frameTimes = [];
      this.maxDpr = 2;
      this.running = false;
      this.visible = true;
      this.bloomed = false;
      this.growthTick = -1;
      this.boilTick = 0;

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
      this.heroColor = parseColor(d.centerColor) || [240, 78, 98];
      this.heroAccent = parseColor(d.centerAccent) || [166, 39, 73];
      let palette = [];
      try {
        palette = JSON.parse(d.palette || '[]').map(parseColor).filter(Boolean);
      } catch (e) {
        palette = [];
      }
      this.palette = palette.length ? palette : [[166, 39, 73], [102, 164, 200], [25, 31, 107], [185, 229, 251], [244, 239, 228], [26, 24, 30]];
      this.foliage = parseColor(d.foliageColor) || [62, 104, 66];
      this.soil = parseColor(d.soilColor) || [52, 38, 30];
      this.duration = clamp(parseFloat(d.duration) || 12, 2, 60);
      this.density = DENSITY[d.density] || DENSITY.lush;
      this.logoScale = clamp(parseFloat(d.logoScale) || 0.55, 0.2, 1);
      this.leafColors = [tone(this.foliage, -0.18), this.foliage, mix(this.foliage, [150, 170, 80], 0.35)];
      this.sproutColor = mix(this.foliage, [150, 200, 90], 0.45);
      // Second colors printed onto scraps: the palette, plus paper white and ink.
      this.printColors = this.palette.concat([PAPER, PAPER, INK]);
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
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      // Scraps are cut a little under full resolution on big screens to save memory.
      this.scrapScale = clamp(dpr, 1, this.base > 70 ? 1.25 : 1.5);
      this.flowers.forEach((f) => {
        f.parts = null;
        f.leafParts = null;
        f.grounded = false;
      });

      this.ground = document.createElement('canvas');
      this.ground.width = this.canvas.width;
      this.ground.height = this.canvas.height;
      const g = this.ground.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintGround(g, W, H, this.soil, mulberry32(this.seed ^ 0x51ed));

      // Shared little scraps: seeds, sprout leaves and confetti.
      const rng = mulberry32(this.seed ^ 0xc0ffee);
      const s = this.scrapScale;
      this.seedScraps = new Map();
      this.sproutScraps = Array.from({ length: 6 }, () =>
        makeScrap({ poly: leafShape(20, 13, rng), material: rng() < 0.7 ? 'paper' : 'halftone', color: this.sproutColor, color2: tone(this.sproutColor, -0.3), rng }, s * 1.5, rng() * TAU)
      );
      this.confettiScraps = Array.from({ length: 18 }, (_, i) => {
        const color = i % 4 === 3 ? PAPER : pick(rng, this.palette.concat([this.heroColor, this.heroColor]));
        const poly = rng() < 0.5 ? cutCircle(0, 0, 5, rng, 7, 0.25) : roughen([[-5, -3.5], [5, -4], [4.5, 3.5], [-4.5, 4]], rng, 0.1);
        return makeScrap({ poly, material: 'paper', color, rng }, s * 1.5, rng() * TAU);
      });

      // Bake foliage that has already finished growing.
      this.flowers.forEach((f) => this.maybeGround(f));
    }

    seedScrap(color, variant) {
      const key = `${colorKey(color)}|${variant}`;
      let sc = this.seedScraps.get(key);
      if (!sc) {
        const rng = mulberry32(variant * 7919 + color[0] * 31 + color[1] * 7 + color[2]);
        const kraft = variant % 2 === 0;
        sc = makeScrap({ poly: cutCircle(0, 0, 10, rng, 8, 0.2), material: 'paper', color: kraft ? KRAFT : color, rng }, this.scrapScale * 1.2, rng() * TAU);
        this.seedScraps.set(key, sc);
      }
      return sc;
    }

    generate() {
      const { w: W, h: H } = this;
      const rng = mulberry32(this.seed);
      const dens = this.density;
      const base = clamp(Math.sqrt(W * H) * 0.075 * dens.size, 30, 96);
      this.base = base;

      const cx = W / 2;
      const cy = H / 2;
      const heroR = clamp(Math.min(W, H) * 0.24, base * 1.85, base * 2.9);
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
        return 'aster';
      };

      for (const [x, y] of pts) {
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < heroR * 0.8) continue;
        const type = pickType();
        const r = base * TYPES[type].size * lerp(0.84, 1.14, rng());
        const dn = clamp(dist / maxDist, 0, 1);
        // Outer beds start first, the wave closes in on the center.
        const startAt = D * (0.02 + 0.5 * (0.45 * (1 - dn) + 0.55 * rng()));
        flowers.push(this.makeFlower(x, y, r, type, rng, { z: 0.3 + rng() * 0.7, startAt, dur: D * lerp(0.36, 0.5, rng()) }));
      }

      // Small asterisks tucked into whatever gaps are left.
      for (let tries = 0; tries < 3500; tries++) {
        const x = -margin * 0.5 + rng() * (W + margin);
        const y = -margin * 0.5 + rng() * (H + margin);
        const rf = base * lerp(0.36, 0.52, rng());
        if (Math.hypot(x - cx, y - cy) < heroR * 0.95) continue;
        let ok = true;
        for (let i = 0; i < flowers.length; i++) {
          const f = flowers[i];
          const lim = f.r * (f.type === 'mini' ? 1.1 : 0.62) + rf * 0.45;
          const dx = f.x - x;
          const dy = f.y - y;
          if (dx * dx + dy * dy < lim * lim) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        flowers.push(this.makeFlower(x, y, rf, 'mini', rng, { z: rng() * 0.3, startAt: D * lerp(0.4, 0.75, rng()), dur: D * lerp(0.25, 0.35, rng()) }));
      }

      this.center = this.makeFlower(cx, cy, heroR, 'hero', rng, { z: 2, startAt: D * 0.24, dur: D * 0.68, color: this.heroColor });
      flowers.push(this.center);

      flowers.sort((a, b) => a.z - b.z);
      this.flowers = flowers;
      this.bloomed = false;
      this.classList.remove('is-bloomed');
      this.syncProgress();

      if (this.float) this.float.style.setProperty('--garden-logo-size', `${Math.round(heroR * 2 * this.logoScale)}px`);
    }

    makeFlower(x, y, r, type, rng, opts) {
      const f = {
        x,
        y,
        r,
        type,
        def: TYPES[type],
        color: opts.color || pick(rng, this.palette),
        z: opts.z,
        startAt: opts.startAt,
        dur: Math.max(0.5, opts.dur),
        p: 0,
        pd: 0,
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
        j: Math.floor(rng() * 64),
        kickAt: -1,
        kick: null,
        parts: null,
        leafParts: null,
        grounded: false,
        isHero: type === 'hero',
        seedAngle: rng() * TAU,
        seedVariant: Math.floor(rng() * 4),
        partSeed: (rng() * 2 ** 31) | 0,
        rng: mulberry32((rng() * 2 ** 31) | 0),
      };

      const leafCount = type === 'mini' ? 3 : type === 'hero' ? 8 : 3 + Math.floor(rng() * 3);
      f.leaves = [];
      for (let i = 0; i < leafCount; i++) {
        f.leaves.push({
          a: f.rot0 + (i / leafCount) * TAU + (rng() - 0.5) * 0.8,
          len: r * (type === 'hero' ? lerp(1.08, 1.26, rng()) : lerp(1.05, 1.45, rng())),
          w: lerp(0.85, 1.15, rng()),
          delay: (i / leafCount) * 0.35,
        });
      }
      return f;
    }

    syncProgress() {
      const t = this.elapsed;
      this.flowers.forEach((f) => {
        f.p = clamp((t - f.startAt) / f.dur, 0, 1);
        f.pd = f.p;
      });
    }

    replant() {
      this.markInteracted();
      if (this.classList.contains('is-nav-open')) this.toggleNav(false);
      this.seed = (Math.random() * 2 ** 31) | 0;
      this.elapsed = this.reduced ? this.duration * 1.2 : 0;
      this.particles.length = 0;
      this.confetti.length = 0;
      this.ripples.length = 0;
      this.generate();
      this.rebuildGraphics();
      this.start();
    }

    /* ---------------- cutting the paper ---------------- */

    secondColor(rng, c) {
      let c2 = pick(rng, this.printColors);
      if (colorKey(c2) === colorKey(c)) c2 = luminance(c) > 0.6 ? INK : PAPER;
      return c2;
    }

    ensureLeaves(f) {
      if (f.leafParts) return f.leafParts;
      const rng = mulberry32(f.partSeed ^ 0x1eaf);
      const s = f.isHero ? this.dpr : this.scrapScale;
      f.leafParts = f.leaves.map((leaf) => {
        const color = pick(rng, this.leafColors);
        const len = leaf.len;
        const w = f.r * 0.5 * leaf.w;
        const poly = rng() < 0.6 ? leafShape(len, w, rng) : bladeShape(len, w * 0.7, rng);
        return makeScrap(
          { poly, material: pick(rng, LEAF_MATERIALS), color, color2: rng() < 0.5 ? tone(color, -0.35) : PAPER, fold: rng() < 0.5, rng },
          s,
          leaf.a
        );
      });
      return f.leafParts;
    }

    ensureBloom(f) {
      if (f.parts) return f.parts;
      const rng = mulberry32(f.partSeed);
      const def = f.def;
      const r = f.r;
      const s = f.isHero ? this.dpr : this.scrapScale;
      const material = f.isHero ? 'paper' : pick(rng, MATERIALS);
      const color2 = f.isHero ? tone(f.color, -0.3) : this.secondColor(rng, f.color);
      const parts = { arms: [], center: null, tape: [], bud: null };

      const addArms = (count, lenR, wR, color, mat, c2, layer, delay0, spread, angleOff) => {
        const order = Array.from({ length: count }, (_, i) => i).sort(() => rng() - 0.5);
        for (let i = 0; i < count; i++) {
          const a = angleOff + (i / count) * TAU + (rng() - 0.5) * (TAU / count) * spread;
          const len = r * between(rng, lenR);
          const w = r * between(rng, wR);
          const shape = armShape(len, w, rng, rng() < (f.isHero ? 0.15 : 0.22));
          // Now and then one arm is cut from a different scrap.
          const odd = !f.isHero && rng() < 0.14;
          const scrap = makeScrap(
            {
              poly: shape.poly,
              under: shape.under,
              material: odd ? pick(rng, MATERIALS) : mat,
              color,
              color2: c2,
              fold: rng() < 0.16,
              alpha: mat === 'tissue' ? 0.82 : 1,
              rng,
            },
            s,
            f.rot0 + a
          );
          parts.arms.push({ scrap, a, layer, delay: delay0 + (order[i] / count) * 0.4, j: Math.floor(rng() * 64) });
        }
      };

      const count = Math.round(between(rng, def.arms));
      if (f.isHero) {
        // The Duet asterisk, duochrome: wine pasted behind, fuchsia on top.
        addArms(5, [0.9, 0.98], [0.26, 0.32], this.heroAccent, 'halftone', tone(this.heroAccent, -0.35), 0, 0, 0.3, Math.PI / 5);
        addArms(5, def.len, def.w, f.color, 'paper', color2, 1, 0.18, 0.42, 0);
      } else {
        addArms(count, def.len, def.w, f.color, material, color2, 0, 0, 0.45, 0);
        if (def.inner) {
          const c = this.secondColor(rng, f.color);
          addArms(Math.round(between(rng, def.inner)), def.innerLen, def.innerW, c, pick(rng, MATERIALS), this.secondColor(rng, c), 1, 0.25, 0.5, rng() * TAU);
        }
      }

      if (f.isHero) {
        // Torn cream paper for the logo to be pasted onto.
        const dr = r * this.logoScale * 1.12;
        parts.center = makeScrap({ poly: tornCircle(0, 0, dr, rng, Math.max(1.2, r * 0.016)), material: 'paper', color: PAPER, rng }, s, f.rot0);
        for (let i = 0; i < 2; i++) {
          const a = rng() * TAU;
          const poly = tapeShape(Math.cos(a) * dr * 0.92, Math.sin(a) * dr * 0.92, r * 0.36, r * 0.11, a + Math.PI / 2 + (rng() - 0.5) * 0.6, rng);
          parts.tape.push(makeScrap({ poly, material: 'tissue', color: [236, 222, 186], alpha: 0.78, shadowColor: 'rgba(14,8,4,0.18)', rng }, s, f.rot0));
        }
      } else if (rng() < def.center) {
        const cr = r * (def.centerSize ? between(rng, def.centerSize) : lerp(0.14, 0.24, rng()));
        const c = this.secondColor(rng, f.color);
        const poly = rng() < 0.35 ? tornCircle(0, 0, cr, rng, Math.max(0.8, cr * 0.06)) : cutCircle(0, 0, cr, rng, 9 + Math.floor(rng() * 5), 0.12);
        parts.center = makeScrap({ poly, material: rng() < 0.6 ? 'paper' : pick(rng, ['halftone', 'dots', 'newsprint']), color: c, color2: this.secondColor(rng, c), rng }, s, f.rot0);
      }

      if (!f.isHero && f.type !== 'mini' && rng() < 0.12) {
        const poly = tapeShape((rng() - 0.5) * r * 0.6, (rng() - 0.5) * r * 0.6, r * lerp(0.6, 0.9, rng()), r * 0.2, rng() * TAU, rng);
        parts.tape.push(makeScrap({ poly, material: 'tissue', color: [236, 222, 186], alpha: 0.75, shadowColor: 'rgba(14,8,4,0.18)', rng }, s, f.rot0));
      }

      parts.bud = makeScrap(
        { poly: cutCircle(0, 0, r * (f.isHero ? 0.36 : 0.3), rng, 9, 0.3), material: f.isHero ? 'paper' : material, color: f.color, color2, crumple: true, rng },
        s,
        f.rot0
      );

      f.parts = parts;
      return parts;
    }

    /* ---------------- interaction ---------------- */

    hitTest(x, y) {
      for (let i = this.flowers.length - 1; i >= 0; i--) {
        const f = this.flowers[i];
        const reach = f.p >= STAGE.open[0] ? 0.9 : f.p >= STAGE.bud[0] ? 0.4 : 0;
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
        this.burst(f, 8);
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
      // Throw off the old arms...
      if (f.parts && !this.reduced) {
        const rot = f.rot0 + f.rot;
        for (const arm of f.parts.arms) {
          const a = rot + arm.a;
          const speed = lerp(80, 240, f.rng());
          this.particles.push({
            scrap: arm.scrap,
            x: f.x + f.ox,
            y: f.y + f.oy,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            rot: a,
            vrot: (f.rng() - 0.5) * 5,
            life: 0,
            ttl: lerp(0.9, 1.5, f.rng()),
          });
        }
        if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160);
      }

      // ...and cut it again from fresh paper.
      const others = this.palette.filter((c) => colorKey(c) !== colorKey(f.color));
      if (others.length) f.color = pick(f.rng, others);
      f.partSeed = (f.rng() * 2 ** 31) | 0;
      f.parts = null;
      f.p = 0.46;
      f.pd = f.p;
      f.boost = 3.2;
      f.vpulse += 2;
      f.vrot += (f.rng() - 0.5) * 3;
      this.burst(f, 10);
    }

    ripple(x, y, strength) {
      const jit = Array.from({ length: 26 }, () => Math.random() - 0.5);
      this.ripples.push({ x, y, t: 0, s: strength, jit, spin: Math.random() * TAU });
      if (this.ripples.length > 6) this.ripples.shift();
      const reach = this.base * 5.5 * strength;
      const speed = this.base * 9;
      for (const f of this.flowers) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d > reach || d < 1) continue;
        const fall = 1 - d / reach;
        const push = fall * this.base * 5.5 * strength;
        f.kickAt = this.elapsed + d / speed;
        f.kick = { x: (dx / d) * push, y: (dy / d) * push, spin: (Math.random() - 0.5) * 3 * fall, pulse: 1.4 * fall };
        if (f.p < 1 && !f.isHero) {
          f.startAt = Math.min(f.startAt, this.elapsed + d / speed);
          f.boost = Math.max(f.boost, 1 + 3.5 * fall);
        }
      }
    }

    burst(f, n) {
      if (this.reduced || !f) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = lerp(40, 180, Math.random());
        this.addConfetti(f.x + f.ox + Math.cos(a) * f.r * 0.25, f.y + f.oy + Math.sin(a) * f.r * 0.25, Math.cos(a) * sp, Math.sin(a) * sp);
      }
    }

    addConfetti(x, y, vx, vy) {
      this.confetti.push({
        scrap: this.confettiScraps[Math.floor(Math.random() * this.confettiScraps.length)],
        x,
        y,
        vx,
        vy,
        rot: Math.random() * TAU,
        vrot: (Math.random() - 0.5) * 9,
        life: 0,
        ttl: lerp(0.8, 1.6, Math.random()),
        size: lerp(0.5, 1.1, Math.random()),
      });
      if (this.confetti.length > 240) this.confetti.splice(0, this.confetti.length - 240);
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

      // Growth is only shown on stop-motion frames; the scraps boil in between.
      const growthTick = Math.floor(t * GROWTH_FPS);
      const showGrowth = growthTick !== this.growthTick;
      this.growthTick = growthTick;
      if (!reduced) this.boilTick = Math.floor(t * BOIL_FPS);

      if (ptr.active && !ptr.down && ptr.type !== 'mouse') ptr.active = false;
      const decay = Math.exp(-dt * 7);
      ptr.vx *= decay;
      ptr.vy *= decay;

      // Quick strokes leave a trail of paper confetti.
      if (ptr.active && !reduced && speedPtr > 180) {
        ptr.emit += dt * Math.min(60, speedPtr / 12) * (ptr.down ? 1.6 : 1);
        while (ptr.emit > 1) {
          ptr.emit -= 1;
          this.addConfetti(
            ptr.x + (Math.random() - 0.5) * 18,
            ptr.y + (Math.random() - 0.5) * 18,
            ptr.vx * 0.12 + (Math.random() - 0.5) * 50,
            ptr.vy * 0.12 + (Math.random() - 0.5) * 50
          );
        }
      }

      for (const f of this.flowers) {
        if (t >= f.startAt && f.p < 1) {
          f.p = Math.min(1, f.p + (dt / f.dur) * f.boost);
          if (f.p >= 1) f.boost = 1;
        }
        if (showGrowth || reduced) f.pd = f.p;
        this.maybeGround(f);

        let tx = 0;
        let ty = 0;
        let tr = 0;
        const head = range(f.p, STAGE.bud[0], STAGE.open[1]);

        if (!reduced && head > 0) {
          const amp = base * 0.03 * gust * (f.isHero ? 0.35 : 1);
          tx += (Math.sin(t * 0.9 + f.x * 0.006 + f.y * 0.003) * 0.7 + Math.sin(t * 2.1 + f.phase) * 0.3) * amp;
          ty += (Math.cos(t * 0.7 + f.y * 0.005 - f.x * 0.002) * 0.7 + Math.cos(t * 1.8 + f.phase) * 0.3) * amp * 0.8;
          tr += Math.sin(t * 0.8 + f.phase) * 0.04 * gust;
        }

        if (ptr.active && head > 0) {
          const dx = f.x - ptr.x;
          const dy = f.y - ptr.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < reach && !reduced) {
            let fall = 1 - d / reach;
            fall *= fall;
            const give = f.isHero ? 0.25 : 1;
            tx += (dx / d) * fall * base * 0.55 * give;
            ty += (dy / d) * fall * base * 0.55 * give;
            f.vx += ptr.vx * fall * dt * 3 * give;
            f.vy += ptr.vy * fall * dt * 3 * give;
            f.vrot += ((dx * ptr.vy - dy * ptr.vx) / (d * base)) * fall * dt * 0.9 * give;
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
        const drag = Math.exp(-dt * 1.4);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
      }
      this.particles = this.particles.filter((p) => p.life < p.ttl);

      for (const p of this.confetti) {
        p.life += dt;
        const drag = Math.exp(-dt * 2.2);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        p.vrot *= drag;
      }
      this.confetti = this.confetti.filter((p) => p.life < p.ttl);

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
      // Leaves are finished and the seed/sprout are gone: paste them into the ground layer.
      const g = this.ground.getContext('2d');
      this.drawFoliage(g, f, 1, this.dpr, f.x * this.dpr, f.y * this.dpr, 0);
      f.grounded = true;
      f.leafParts = null;
    }

    /* ---------------- drawing ---------------- */

    put(g, sc, k, tx, ty, angle) {
      if (k <= 0.001) return;
      const c = Math.cos(angle) * k;
      const s = Math.sin(angle) * k;
      g.setTransform(c, s, -s, c, tx, ty);
      g.drawImage(sc.img, sc.x, sc.y, sc.w, sc.h);
    }

    boil(index) {
      return this.reduced ? 0 : JITTER[(index + this.boilTick * 7) & 63];
    }

    drawFoliage(g, f, p, k, tx, ty, wobble) {
      const seedIn = range(p, STAGE.seed[0], STAGE.seed[1]);
      if (seedIn <= 0) return;
      const sprout = range(p, STAGE.sprout[0], STAGE.sprout[1]);
      const leaves = range(p, STAGE.leaves[0], STAGE.leaves[1]);
      const r = f.r;

      if (leaves > 0) {
        const parts = this.ensureLeaves(f);
        f.leaves.forEach((leaf, i) => {
          const lp = range(leaves, leaf.delay, leaf.delay + 0.65);
          if (lp <= 0) return;
          this.put(g, parts[i], k * easeOutBack(lp), tx, ty, leaf.a + (1 - lp) * 0.5 + wobble * 0.02 * this.boil(f.j + i));
        });
      }

      // Two little cut-paper seed leaves, later hidden under the rosette.
      if (sprout > 0 && leaves < 1) {
        g.globalAlpha = 1 - range(leaves, 0.55, 1);
        const sc = this.sproutScraps[f.j % this.sproutScraps.length];
        const size = (r * 0.34 * easeOutBack(sprout)) / 20;
        this.put(g, sc, k * size, tx, ty, f.seedAngle);
        this.put(g, sc, k * size, tx, ty, f.seedAngle + Math.PI);
        g.globalAlpha = 1;
      }

      // The seed (a punched paper dot) drops in, then gets pushed aside.
      if (sprout < 0.9) {
        const drop = 1 + 1.6 * (1 - easeOutCubic(seedIn));
        g.globalAlpha = Math.min(1, seedIn * 1.4) * (1 - range(sprout, 0.35, 0.9));
        const sc = this.seedScrap(f.color, f.seedVariant);
        const nudge = sprout * r * 0.12;
        const c = Math.cos(f.seedAngle + Math.PI / 2);
        const s = Math.sin(f.seedAngle + Math.PI / 2);
        this.put(g, sc, k * ((r * 0.13) / 10) * drop, tx + c * nudge * k, ty + s * nudge * k, f.seedAngle + sprout);
        g.globalAlpha = 1;
      }
    }

    drawBloom(g, f, p, k, tx, ty, rot) {
      const budP = range(p, STAGE.bud[0], STAGE.bud[1]);
      if (budP <= 0) return;
      const openP = range(p, STAGE.open[0], STAGE.open[1]);
      const parts = this.ensureBloom(f);

      // A crumpled ball of paper that the arms unfold out of.
      const budS = easeOutBack(budP) * (1 - smooth(range(openP, 0.15, 0.6)));
      if (budS > 0.01) this.put(g, parts.bud, k * budS, tx, ty, rot + (1 - budP) * 1.2);

      for (const arm of parts.arms) {
        const s = easeOutBack(range(openP, arm.delay, arm.delay + 0.45));
        if (s <= 0.01) continue;
        this.put(g, arm.scrap, k * s, tx, ty, rot + arm.a + (1 - Math.min(1, s)) * 0.6 + this.boil(arm.j) * 0.025);
      }

      if (parts.center) {
        const s = easeOutBack(range(openP, f.isHero ? 0.6 : 0.55, f.isHero ? 0.88 : 0.85));
        if (s > 0.01) this.put(g, parts.center, k * s, tx, ty, rot + this.boil(f.j + 3) * 0.02);
      }

      if (parts.tape.length) {
        const s = range(openP, 0.9, 1);
        if (s > 0) {
          g.globalAlpha = s;
          for (const tape of parts.tape) this.put(g, tape, k * lerp(1.3, 1, s), tx, ty, rot);
          g.globalAlpha = 1;
        }
      }
    }

    render() {
      const g = this.ctx;
      const { dpr } = this;

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(this.ground, 0, 0);

      for (const f of this.flowers) {
        if (!f.grounded && f.pd > 0) this.drawFoliage(g, f, f.pd, dpr, f.x * dpr, f.y * dpr, 1);
      }

      for (const f of this.flowers) {
        if (f.pd < STAGE.bud[0]) continue;
        const scale = 1 + f.pulse;
        const nudge = this.boil(f.j) * 0.5 * dpr;
        const x = (f.x + f.ox) * dpr + nudge;
        const y = (f.y + f.oy) * dpr - nudge;
        this.drawBloom(g, f, f.pd, dpr * scale, x, y, f.rot0 + f.rot);
      }

      for (const p of this.particles) {
        const life = p.life / p.ttl;
        g.globalAlpha = 1 - life * life;
        this.put(g, p.scrap, dpr * (1 + life * 0.6), p.x * dpr, p.y * dpr, p.rot);
      }

      for (const p of this.confetti) {
        const life = p.life / p.ttl;
        g.globalAlpha = Math.min(1, (1 - life) * 2.5);
        this.put(g, p.scrap, dpr * p.size, p.x * dpr, p.y * dpr, p.rot);
      }

      // Ripples drawn like a quick loop of white pencil.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = rgba(PAPER);
      g.lineJoin = 'round';
      for (const rp of this.ripples) {
        const life = rp.t / 1.2;
        const rad = this.base * (0.3 + 5.2 * easeOutCubic(life)) * rp.s * dpr;
        const n = rp.jit.length;
        g.globalAlpha = (1 - life) * 0.6;
        g.lineWidth = (1 - life) * 2.6 * dpr + 0.5;
        g.beginPath();
        for (let i = 0; i <= n + 2; i++) {
          const a = rp.spin + (i / n) * TAU;
          const rr = rad * (1 + rp.jit[i % n] * 0.06) * (1 + i * 0.004);
          const x = rp.x * dpr + Math.cos(a) * rr;
          const y = rp.y * dpr + Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;

      if (this.float && this.center) {
        const c = this.center;
        this.float.style.transform = `translate(${c.ox.toFixed(2)}px, ${c.oy.toFixed(2)}px) rotate(${(c.rot * 0.5).toFixed(4)}rad) scale(${(1 + c.pulse * 0.6).toFixed(4)})`;
      }
    }
  }

  customElements.define('garden-splash', GardenSplash);
})();
