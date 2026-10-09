/**
 * Garden splash
 *
 * A top-down field of abstract specimens plotted on a grid. Each specimen is
 * an asterisk (after the Duet mark) drawn in one of several notations: solid,
 * outline, line, dot-matrix or orbital. Each grows seed → sprout → leaves →
 * bud → bloom, arms plotted outward, until the specimens overlap and fill the
 * screen. The center specimen resolves last and the logo appears on it.
 *
 * Motion is kept to the growth itself. Interaction is utilitarian: a
 * crosshair readout, hover to inspect a specimen, press and drag to
 * accelerate growth, tap to resequence a specimen.
 */
(function () {
  'use strict';

  if (!window.customElements || customElements.get('garden-splash')) return;

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

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a === undefined ? 1 : a})`;
  const colorKey = (c) => `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
  const hex = (c) => '#' + c.map((v) => (v | 0).toString(16).padStart(2, '0')).join('').toUpperCase();
  const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const tone = (c, amt) => (amt >= 0 ? mix(c, WHITE, amt) : mix(c, BLACK, -amt));

  const POWDER = [185, 229, 251];
  const OCEAN = [25, 31, 107];

  /*
   * The field is rendered under-resolved and scaled up without smoothing,
   * like an old 3D render: stair-stepped edges, banded shading, hard shadows.
   */
  const renderScale = (w) => (w < 750 ? 0.75 : 0.5);

  /* A gradient whose color stops are hard bands instead of smooth blends. */
  function banded(grad, bands) {
    let from = 0;
    for (const [to, color] of bands) {
      grad.addColorStop(from, color);
      grad.addColorStop(to, color);
      from = to;
    }
    return grad;
  }

  /* A plastic sphere lit from the top left, with a hard drop shadow. */
  function sphere(g, x, y, r, c, shadow) {
    if (r < 0.4) return;
    if (shadow !== false) {
      g.fillStyle = 'rgba(0,0,0,0.42)';
      g.beginPath();
      g.ellipse(x + r * 0.45, y + r * 0.6, r, r * 0.85, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = banded(g.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.1, y - r * 0.1, r * 1.15), [
      [0.14, rgba(tone(c, 0.85))],
      [0.36, rgba(tone(c, 0.3))],
      [0.66, rgba(c)],
      [0.86, rgba(tone(c, -0.35))],
      [1, rgba(tone(c, -0.62))],
    ]);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  /* A shaded tube between two points: shadow, body, and a specular line. */
  function tube(g, path, c, w) {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.save();
    g.translate(w * 0.6, w * 0.8);
    path();
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    g.lineWidth = w;
    g.stroke();
    g.restore();
    path();
    g.strokeStyle = rgba(tone(c, -0.45));
    g.lineWidth = w;
    g.stroke();
    g.strokeStyle = rgba(c);
    g.lineWidth = w * 0.6;
    g.stroke();
    g.save();
    g.translate(-w * 0.16, -w * 0.16);
    path();
    g.strokeStyle = rgba(tone(c, 0.75));
    g.lineWidth = Math.max(0.6, w * 0.2);
    g.stroke();
    g.restore();
  }

  const BLINK = 0.2;

  /* Notations a specimen can be drawn in, with how often each appears. */
  const STYLES = [
    ['solid', 0.4],
    ['outline', 0.15],
    ['line', 0.16],
    ['dots', 0.15],
    ['orbit', 0.14],
  ];
  const STYLE_CODE = { solid: 'SOL', outline: 'OUT', line: 'LIN', dots: 'DOT', orbit: 'ORB', hero: 'D✱' };

  const DENSITY = {
    airy: { size: 1.18, spacing: 1.32 },
    lush: { size: 1, spacing: 1.18 },
    overgrown: { size: 0.84, spacing: 1.1 },
  };

  /* Growth milestones on a specimen's 0 → 1 progress. */
  const STAGE = {
    seed: [0, 0.06],
    sprout: [0.05, 0.22],
    leaves: [0.16, 0.48],
    bud: [0.4, 0.58],
    open: [0.56, 1],
  };

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

  class GardenSplash extends HTMLElement {
    connectedCallback() {
      this.canvas = this.querySelector('[data-garden-canvas]');
      if (!this.canvas || !this.canvas.getContext) return;
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return;

      this.logo = this.querySelector('[data-garden-logo]');
      this.nav = this.querySelector('[data-garden-nav]');
      this.navToggles = Array.from(this.querySelectorAll('[data-garden-nav-toggle]'));
      this.menuButton = this.querySelector('[data-garden-menu]');
      this.resetButton = this.querySelector('[data-garden-replant]');
      this.bloomReadout = this.querySelector('[data-garden-bloom]');
      this.filmCanvas = this.querySelector('[data-garden-film]');
      this.grainLayer = this.querySelector('[data-garden-grain]');
      this.coordReadout = this.querySelector('[data-garden-coords]');

      this.readConfig();
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = this.motionQuery.matches;

      this.seed = (Math.random() * 2 ** 31) | 0;
      this.elapsed = this.reduced ? this.duration * 1.2 : 0;
      this.flowers = [];
      this.pings = [];
      this.pointer = { x: 0, y: 0, active: false, down: false, id: null, sx: 0, sy: 0, st: 0, type: 'mouse' };
      this.inspected = null;
      this.inspectUntil = 0;
      this.dirty = true;
      this.running = false;
      this.visible = true;
      this.bloomed = false;
      this.lastReadout = -1;

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
      // Linework, grid and readouts: whichever brand tone reads against the ground.
      this.isLight = luminance(this.soil) > 0.6;
      this.ink = this.isLight ? OCEAN : POWDER;
      // Distance fog, the way old renderers faked depth.
      this.fog = this.isLight ? WHITE : mix(this.soil, POWDER, 0.2);
      this.duration = clamp(parseFloat(d.duration) || 12, 2, 60);
      this.density = DENSITY[d.density] || DENSITY.lush;
      this.logoScale = clamp(parseFloat(d.logoScale) || 0.55, 0.2, 1);
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

      // Small height-only changes (mobile browser chrome) keep the same field.
      const relayout = initial || !this.flowers.length || W !== this.w || Math.abs(H - this.h) > 90;
      const shiftY = relayout ? 0 : (H - this.h) / 2;
      this.w = W;
      this.h = H;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (relayout) this.generate();
      else this.flowers.forEach((f) => (f.y += shiftY));

      this.canvas.width = Math.round(W * this.dpr);
      this.canvas.height = Math.round(H * this.dpr);
      this.rs = renderScale(W);
      const layer = () => {
        const c = document.createElement('canvas');
        c.width = Math.ceil(W * this.rs);
        c.height = Math.ceil(H * this.rs);
        return c;
      };
      this.scene = layer();
      this.low = layer();
      this.paintGround();
      this.paintFilm();
      this.dirty = true;
    }

    /* The default floor of a 3D scene: a checkerboard, centered on the middle specimen. */
    paintGround() {
      const { w: W, h: H, rs } = this;
      this.ground = document.createElement('canvas');
      this.ground.width = this.scene.width;
      this.ground.height = this.scene.height;
      const g = this.ground.getContext('2d');
      g.setTransform(rs, 0, 0, rs, 0, 0);
      g.fillStyle = rgba(this.soil);
      g.fillRect(0, 0, W, H);
      const step = 40;
      const ox = ((W / 2) % (step * 2)) - step * 2;
      const oy = ((H / 2) % (step * 2)) - step * 2;
      g.fillStyle = rgba(tone(this.soil, this.isLight ? -0.06 : 0.08));
      for (let y = oy, row = 0; y < H; y += step, row++) {
        for (let x = ox + (row % 2) * step; x < W; x += step * 2) g.fillRect(x, y, step, step);
      }
      g.strokeStyle = rgba(this.ink, 0.12);
      g.lineWidth = 1;
      g.beginPath();
      for (let x = ox; x < W; x += step) {
        g.moveTo(x, 0);
        g.lineTo(x, H);
      }
      for (let y = oy; y < H; y += step) {
        g.moveTo(0, y);
        g.lineTo(W, y);
      }
      g.stroke();
    }

    /* Film finish over the field: soft flash from above, vignette, scanlines, grain. */
    paintFilm() {
      const { w: W, h: H, dpr } = this;
      const light = luminance(this.soil) > 0.6;
      // Painted once into its own layer above the field; the browser composites it.
      const film = this.filmCanvas || document.createElement('canvas');
      film.width = this.canvas.width;
      film.height = this.canvas.height;
      const g = film.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const flash = g.createRadialGradient(W * 0.5, H * 0.08, 0, W * 0.5, H * 0.08, Math.max(W, H) * 0.7);
      flash.addColorStop(0, rgba(POWDER, light ? 0 : 0.12));
      flash.addColorStop(1, rgba(POWDER, 0));
      g.fillStyle = flash;
      g.fillRect(0, 0, W, H);

      const dark = light ? OCEAN : tone(this.soil, -0.8);
      const vig = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.22, W / 2, H * 0.48, Math.hypot(W, H) * 0.62);
      vig.addColorStop(0, rgba(dark, 0));
      vig.addColorStop(1, rgba(dark, light ? 0.32 : 0.82));
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);

      g.fillStyle = 'rgba(0,0,0,0.07)';
      for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);

      // A tile of film grain, shifted every few frames.
      const size = 160;
      const tile = document.createElement('canvas');
      tile.width = size;
      tile.height = size;
      const tg = tile.getContext('2d');
      const img = tg.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 22;
      }
      tg.putImageData(img, 0, 0);
      if (this.grainLayer && !this.grainLayer.style.backgroundImage) {
        this.grainLayer.style.backgroundImage = `url(${tile.toDataURL()})`;
      }
    }

    generate() {
      const { w: W, h: H } = this;
      const rng = mulberry32(this.seed);
      const dens = this.density;
      const base = clamp(Math.sqrt(W * H) * 0.075 * dens.size, 30, 96);
      this.base = base;

      const cx = W / 2;
      const cy = H / 2;
      const heroR = clamp(Math.min(W, H) * 0.22, base * 1.8, base * 2.8);
      this.heroR = heroR;

      const margin = base * 0.7;
      const pts = poissonDisc(-margin, -margin, W + margin, H + margin, base * dens.spacing, rng, [cx + base * 3, cy]);
      const maxDist = Math.hypot(W / 2 + margin, H / 2 + margin);
      const D = this.duration;
      const flowers = [];
      let id = 1;

      for (const [x, y] of pts) {
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < heroR * 1.05) continue;
        // Some specimens sit deeper in the field, out of focus.
        const far = rng() < 0.38;
        const r = base * lerp(0.88, 1.16, rng()) * (far ? 0.86 : 1);
        const dn = clamp(dist / maxDist, 0, 1);
        // Outer field starts first, the wave closes in on the center.
        const startAt = D * (0.02 + 0.5 * (0.45 * (1 - dn) + 0.55 * rng()));
        const f = this.makeFlower(x, y, r, rng, { id: id++, z: far ? rng() * 0.25 - 1 : 0.3 + rng() * 0.7, startAt, dur: D * lerp(0.36, 0.5, rng()) });
        f.far = far;
        flowers.push(f);
      }

      // Small specimens in whatever gaps are left.
      for (let tries = 0; tries < 3500; tries++) {
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
        flowers.push(this.makeFlower(x, y, rf, rng, { id: id++, small: true, z: rng() * 0.3, startAt: D * lerp(0.4, 0.75, rng()), dur: D * lerp(0.25, 0.35, rng()) }));
      }

      this.center = this.makeFlower(cx, cy, heroR, rng, { id: 0, hero: true, z: 2, startAt: D * 0.24, dur: D * 0.68 });
      flowers.push(this.center);

      flowers.sort((a, b) => a.z - b.z);
      this.flowers = flowers;
      this.assignEyes(rng);
      this.bloomed = false;
      this.inspected = null;
      this.classList.remove('is-bloomed');
      const t = this.elapsed;
      flowers.forEach((f) => (f.p = clamp((t - f.startAt) / f.dur, 0, 1)));

      this.style.setProperty('--garden-logo-size', `${Math.round(heroR * 2 * this.logoScale)}px`);
    }

    /*
     * Some specimens open an eye where their center would be. Only ones whose
     * middle is not covered by a higher specimen (or the center) get one.
     */
    assignEyes(rng) {
      this.eyes = [];
      const near = this.flowers.filter((f) => !f.far && !f.isHero);
      const irises = [this.foliage, this.heroAccent, this.heroColor].concat(this.palette).filter((c) => colorKey(c) !== colorKey(this.soil));
      for (const f of near) {
        f.eye = null;
        if (f.small || rng() > 0.55) continue;
        let hidden = Math.hypot(f.x - this.center.x, f.y - this.center.y) < this.heroR * 1.3;
        for (const o of near) {
          if (hidden) break;
          if (o !== f && o.z > f.z && (o.x - f.x) ** 2 + (o.y - f.y) ** 2 < (o.r * 0.85) ** 2) hidden = true;
        }
        if (hidden) continue;
        f.eye = {
          w: f.r * 0.33,
          h: f.r * 0.18,
          rot: (rng() - 0.5) * 0.3,
          iris: pick(rng, irises),
          px: 0,
          py: 0,
          pupil: 0.5,
          delay: rng() * 0.05,
          nextBlink: this.elapsed + 2 + rng() * 8,
          blinkAt: -1,
        };
        f.center = null;
        this.eyes.push(f);
      }
    }

    makeFlower(x, y, r, rng, opts) {
      const f = {
        id: opts.id,
        x,
        y,
        r,
        z: opts.z,
        small: !!opts.small,
        isHero: !!opts.hero,
        startAt: opts.startAt,
        dur: Math.max(0.5, opts.dur),
        p: 0,
        boost: 1,
        rot: rng() * TAU,
        seedAngle: rng() * TAU,
        rng: mulberry32((rng() * 2 ** 31) | 0),
      };

      const leafCount = f.isHero ? 0 : f.small ? 2 : 2 + Math.floor(rng() * 3);
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

    /* Decides how a specimen is drawn: notation, color and arm geometry. */
    sequence(f, rng) {
      const r = f.r;
      if (f.isHero) {
        f.style = 'hero';
        f.color = this.heroColor;
        f.arms = this.solidArms(5, r, [0.98, 1.06], [0.32, 0.38], rng, 0, 0.42);
        f.backArms = this.solidArms(5, r, [0.9, 0.98], [0.26, 0.32], rng, Math.PI / 5, 0.3);
        f.n = 5;
        return;
      }

      let v = rng();
      f.style = 'solid';
      for (const [name, weight] of STYLES) {
        if ((v -= weight) <= 0) {
          f.style = name;
          break;
        }
      }
      if (f.small && (f.style === 'orbit' || f.style === 'line')) f.style = 'solid';

      f.color = pick(rng, this.palette);
      const alt = this.palette.filter((p) => colorKey(p) !== colorKey(f.color));
      f.color2 = alt.length ? pick(rng, alt) : this.ink;
      f.center = rng() < 0.5 ? pick(rng, ['dot', 'ring', 'cross']) : null;

      switch (f.style) {
        case 'solid':
        case 'outline':
          f.n = rng() < 0.7 ? 5 : pick(rng, [4, 6]);
          f.arms = this.solidArms(f.n, r, [0.86, 1.04], [0.28, 0.4], rng, 0, 0.42);
          break;
        case 'line':
          f.n = 8 + Math.floor(rng() * 9);
          f.arms = this.evenArms(f.n, r, [0.82, 1.02], rng);
          break;
        case 'dots':
          f.n = 6 + Math.floor(rng() * 5);
          f.arms = this.evenArms(f.n, r, [0.84, 1.02], rng);
          f.dotStep = r * lerp(0.1, 0.13, rng());
          break;
        case 'orbit':
          f.n = 3 + Math.floor(rng() * 3);
          f.arms = this.evenArms(f.n, r, [0.92, 1.04], rng);
          f.ring = r * lerp(0.5, 0.68, rng());
          break;
        default:
          break;
      }
    }

    solidArms(n, r, lenR, wR, rng, offset, spread) {
      const arms = [];
      for (let i = 0; i < n; i++) {
        const w = r * between(rng, wR);
        arms.push({
          a: offset + (i / n) * TAU + (rng() - 0.5) * (TAU / n) * spread,
          len: r * between(rng, lenR),
          back: -w * lerp(0.3, 0.5, rng()),
          hw0: (w / 2) * lerp(0.92, 1.05, rng()),
          hw1: (w / 2) * lerp(0.88, 1.12, rng()),
          cut: (rng() - 0.5) * 0.9,
          skew: (rng() - 0.5) * w * 0.25,
          delay: (i / n) * 0.35,
        });
      }
      return arms;
    }

    evenArms(n, r, lenR, rng) {
      const arms = [];
      for (let i = 0; i < n; i++) {
        arms.push({ a: (i / n) * TAU, len: r * between(rng, lenR), delay: (i / n) * 0.3 });
      }
      return arms;
    }

    replant() {
      if (this.classList.contains('is-nav-open')) this.toggleNav(false);
      this.markInteracted();
      this.seed = (Math.random() * 2 ** 31) | 0;
      this.elapsed = this.reduced ? this.duration * 1.2 : 0;
      this.pings.length = 0;
      this.generate();
      this.paintGround();
      this.dirty = true;
      this.start();
    }

    /* ---------------- interaction ---------------- */

    nearest(x, y, reach) {
      let best = null;
      let bd = reach * reach;
      for (const f of this.flowers) {
        if (f.isHero && this.bloomed) continue;
        const d2 = (x - f.x) ** 2 + (y - f.y) ** 2;
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
        // Resequence: new notation and color, replotted from the bud.
        const was = colorKey(f.color);
        for (let i = 0; i < 6 && colorKey(f.color) === was; i++) this.sequence(f, f.rng);
        if (f.eye) f.center = null;
        f.p = STAGE.bud[0];
        f.boost = 4;
      }
      // Every eye nearby flinches, in a ripple out from the tap.
      for (const o of this.eyes) {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < this.base * 6) o.eye.blinkAt = this.elapsed + d / (this.base * 14);
      }
      this.dirty = true;
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
        this.update(dt);
        this.render();
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
      let growing = false;

      for (const f of this.flowers) {
        // Press and drag to accelerate growth under the pointer.
        if (ptr.down && f.p < 1) {
          const d = Math.hypot(f.x - ptr.x, f.y - ptr.y);
          if (d < reach) {
            f.startAt = Math.min(f.startAt, t);
            f.boost = Math.max(f.boost, 1 + 5 * (1 - d / reach));
          }
        }
        if (t >= f.startAt && f.p < 1) {
          f.p = Math.min(1, f.p + (dt / f.dur) * f.boost);
          if (f.p >= 1) f.boost = 1;
          this.dirty = true;
          growing = true;
        }
        total += f.p;
      }
      this.growing = growing;
      this.updateEyes(dt);

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

      for (const pg of this.pings) pg.t += dt;
      this.pings = this.pings.filter((pg) => pg.t < 0.25);
    }

    /* Where the eyes look: the pointer, otherwise mostly straight at the viewer. */
    lookTarget(t) {
      const ptr = this.pointer;
      if (this.classList.contains('is-nav-open')) return null;
      if (ptr.active) return ptr;
      if (this.bloomed && t % 17 > 12) return this.center;
      return null;
    }

    updateEyes(dt) {
      const t = this.elapsed;
      const target = this.lookTarget(t);
      const ptr = this.pointer;
      const k = 1 - Math.exp(-dt * (this.reduced ? 30 : 9));
      for (const f of this.eyes) {
        const e = f.eye;
        if (t > e.nextBlink) {
          e.blinkAt = t;
          e.nextBlink = t + (Math.random() < 0.15 ? 0.4 : 2.5 + Math.random() * 9);
        }
        let tx = 0;
        let ty = 0;
        if (target) {
          const dx = target.x - f.x;
          const dy = target.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          const m = Math.min(1, d / (this.base * 4));
          tx = (dx / d) * m;
          ty = (dy / d) * m;
        }
        e.px += (tx - e.px) * k;
        e.py += (ty - e.py) * k;
        const close = ptr.active && Math.hypot(ptr.x - f.x, ptr.y - f.y) < this.base * 1.4;
        e.pupil += ((close ? 0.28 : 0.52) - e.pupil) * k;
      }
    }

    /* ---------------- drawing ---------------- */

    render() {
      const now = performance.now();

      // The field is only redrawn while something is growing, at most ~22 times a second.
      if (this.dirty && (!this.growing || now - (this.lastScene || 0) > 45)) {
        this.dirty = false;
        this.lastScene = now;
        this.drawScene();
      }

      const lo = this.low.getContext('2d');
      lo.setTransform(1, 0, 0, 1, 0, 0);
      lo.drawImage(this.scene, 0, 0);
      lo.setTransform(this.rs, 0, 0, this.rs, 0, 0);
      this.drawEyes(lo);

      // Scaled up with no smoothing: every edge stair-steps.
      const g = this.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawOverlay(g);
    }

    drawScene() {
      const s = this.scene.getContext('2d');
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalAlpha = 1;
      s.drawImage(this.ground, 0, 0);
      s.setTransform(this.rs, 0, 0, this.rs, 0, 0);

      const far = this.flowers.filter((f) => f.far && f.p > 0);
      const near = this.flowers.filter((f) => !f.far && f.p > 0);
      for (const f of far) this.drawFoliage(s, f, f.p);
      for (const f of far) if (f.p > STAGE.bud[0]) this.drawBloom(s, f, f.p);
      s.fillStyle = rgba(this.fog, 0.5);
      s.fillRect(0, 0, this.w, this.h);

      for (const f of near) this.drawFoliage(s, f, f.p);
      for (const f of near) if (f.p > STAGE.bud[0]) this.drawBloom(s, f, f.p);

      if (this.bloomed && !this.isLight) this.drawFlare(s);
    }

    /* Low-poly leaves: two flat-shaded faces split along the midrib. */
    drawFoliage(g, f, p) {
      const seedIn = range(p, STAGE.seed[0], STAGE.seed[1]);
      const sprout = range(p, STAGE.sprout[0], STAGE.sprout[1]);
      const leaves = range(p, STAGE.leaves[0], STAGE.leaves[1]);
      const { x, y, r } = f;
      const c = this.foliage;

      for (const leaf of f.leaves) {
        const lp = smooth(range(leaves, leaf.delay, leaf.delay + 0.65));
        if (lp <= 0) continue;
        const len = leaf.len * lp;
        const w = leaf.w * lp * 0.8;
        const ax = Math.cos(leaf.a);
        const ay = Math.sin(leaf.a);
        const tx = x + ax * len;
        const ty = y + ay * len;
        const mx = x + ax * len * 0.42;
        const my = y + ay * len * 0.42;
        const L = [mx - ay * w, my + ax * w];
        const R = [mx + ay * w, my - ax * w];
        const face = (pts, fill) => {
          g.beginPath();
          g.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
          g.closePath();
          g.fillStyle = fill;
          g.fill();
        };
        g.save();
        g.translate(3, 4);
        face([[x, y], L, [tx, ty], R], 'rgba(0,0,0,0.32)');
        g.restore();
        face([[x, y], L, [tx, ty]], rgba(tone(c, 0.2)));
        face([[x, y], [tx, ty], R], rgba(tone(c, -0.3)));
        g.strokeStyle = rgba(tone(c, 0.55));
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(tx, ty);
        g.stroke();
      }

      if (sprout > 0 && leaves < 1) {
        const len = r * 0.22 * sprout;
        for (const off of [-0.5, 0.5]) {
          const ex = x + Math.cos(f.seedAngle + off) * len;
          const ey = y + Math.sin(f.seedAngle + off) * len;
          tube(g, () => {
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(ex, ey);
          }, c, 2.4);
        }
      }

      if (seedIn > 0 && leaves < 1) sphere(g, x, y, 3.2 * seedIn, this.heroAccent);
    }

    armPath(g, f, arm, e, ox, oy) {
      const L = Math.max(arm.back + 1, arm.len * e);
      const k = Math.tan(arm.cut);
      const c = Math.cos(f.rot + arm.a);
      const s = Math.sin(f.rot + arm.a);
      const dx = ox || 0;
      const dy = oy || 0;
      const pts = [
        [arm.back, -arm.hw0],
        [L + k * arm.hw1, -arm.hw1],
        [L - k * arm.hw1, arm.hw1],
        [arm.back + arm.skew, arm.hw0],
      ];
      g.beginPath();
      pts.forEach(([px, py], i) => {
        const X = f.x + dx + px * c - py * s;
        const Y = f.y + dy + px * s + py * c;
        if (i) g.lineTo(X, Y);
        else g.moveTo(X, Y);
      });
      g.closePath();
      return pts.map(([px, py]) => [f.x + dx + px * c - py * s, f.y + dy + px * s + py * c]);
    }

    /* Arms extruded into thick plastic: hard shadow, stacked sides, glossy top. */
    extrudeArms(g, f, arms, color, reach, depth) {
      const d = depth || f.r * 0.07;
      const live = arms.map((arm) => [arm, reach(arm)]).filter(([, e]) => e > 0);
      g.fillStyle = 'rgba(0,0,0,0.38)';
      for (const [arm, e] of live) {
        this.armPath(g, f, arm, e, d * 2.2, d * 2.8);
        g.fill();
      }
      for (let k = 4; k >= 1; k--) {
        g.fillStyle = rgba(tone(color, -0.35 - k * 0.06));
        for (const [arm, e] of live) {
          this.armPath(g, f, arm, e, (d * k) / 4, (d * k * 1.3) / 4);
          g.fill();
        }
      }
      for (const [arm, e] of live) {
        const a = f.rot + arm.a;
        const L = Math.max(1, arm.len * e);
        this.armPath(g, f, arm, e);
        g.fillStyle = banded(g.createLinearGradient(f.x, f.y, f.x + Math.cos(a) * L, f.y + Math.sin(a) * L), [
          [0.22, rgba(tone(color, -0.32))],
          [0.56, rgba(color)],
          [0.64, rgba(tone(color, 0.62))],
          [0.9, rgba(tone(color, 0.12))],
          [1, rgba(tone(color, -0.12))],
        ]);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.4)';
        g.lineWidth = 1;
        g.stroke();
      }
    }

    drawBloom(g, f, p) {
      const budP = range(p, STAGE.bud[0], STAGE.bud[1]);
      const openP = range(p, STAGE.open[0], STAGE.open[1]);
      const { x, y, r } = f;
      const reach = (arm) => smooth(range(openP, arm.delay, arm.delay + 0.6));

      // Bud: a plastic ball the arms push out from under.
      const budR = r * 0.2 * smooth(budP) * (1 - smooth(range(openP, 0.2, 0.7)));
      if (budR > 0.5) sphere(g, x, y, budR, f.color);
      if (openP <= 0) return;

      switch (f.style) {
        case 'hero':
          this.drawHero(g, f, openP, reach);
          return;
        case 'solid':
          this.extrudeArms(g, f, f.arms, f.color, reach);
          break;
        case 'outline': {
          // A wireframe pass: polygon edges, triangulation and vertices.
          g.strokeStyle = rgba(f.color);
          g.fillStyle = rgba(f.color, 0.1);
          g.lineWidth = 1;
          for (const arm of f.arms) {
            const e = reach(arm);
            if (e <= 0) continue;
            const pts = this.armPath(g, f, arm, e);
            g.fill();
            g.moveTo(pts[0][0], pts[0][1]);
            g.lineTo(pts[2][0], pts[2][1]);
            g.moveTo((pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2);
            g.lineTo((pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2);
            g.stroke();
            g.fillStyle = rgba(tone(f.color, 0.5));
            for (const [px, py] of pts) g.fillRect(px - 1.5, py - 1.5, 3, 3);
            g.fillStyle = rgba(f.color, 0.1);
          }
          break;
        }
        case 'line':
          for (const arm of f.arms) {
            const e = reach(arm);
            if (e <= 0) continue;
            const c = Math.cos(f.rot + arm.a);
            const s = Math.sin(f.rot + arm.a);
            const ex = x + c * arm.len * e;
            const ey = y + s * arm.len * e;
            tube(g, () => {
              g.beginPath();
              g.moveTo(x + c * r * 0.08, y + s * r * 0.08);
              g.lineTo(ex, ey);
            }, f.color, 3.4);
            sphere(g, ex, ey, 3.4, f.color, false);
          }
          break;
        case 'dots':
          for (const arm of f.arms) {
            const e = reach(arm);
            const m = Math.floor(arm.len / f.dotStep);
            const c = Math.cos(f.rot + arm.a);
            const s = Math.sin(f.rot + arm.a);
            for (let j = 1; j <= m; j++) {
              if (j * f.dotStep > arm.len * e) break;
              sphere(g, x + c * j * f.dotStep, y + s * j * f.dotStep, f.dotStep * 0.42 * (1 - (j / m) * 0.5), f.color);
            }
          }
          break;
        case 'orbit': {
          const ring = smooth(range(openP, 0, 0.7));
          tube(g, () => {
            g.beginPath();
            g.arc(x, y, f.ring, f.rot, f.rot + TAU * ring);
          }, f.color, 4);
          for (const arm of f.arms) {
            const e = reach(arm);
            if (e <= 0) continue;
            const c = Math.cos(f.rot + arm.a) * arm.len * e;
            const s = Math.sin(f.rot + arm.a) * arm.len * e;
            tube(g, () => {
              g.beginPath();
              g.moveTo(x - c, y - s);
              g.lineTo(x + c, y + s);
            }, f.color, 3);
            sphere(g, x + c, y + s, 3.6, f.color, false);
            sphere(g, x - c, y - s, 3.6, f.color, false);
          }
          sphere(g, x, y, r * 0.1 * openP, f.color2);
          break;
        }
        default:
          break;
      }

      const ce = range(openP, 0.6, 0.9);
      if (f.center && ce > 0) {
        const cr = r * 0.12 * ce;
        if (f.center === 'dot') {
          sphere(g, x, y, cr, f.color2);
        } else if (f.center === 'ring') {
          tube(g, () => {
            g.beginPath();
            g.arc(x, y, cr * 1.3, 0, TAU);
          }, f.color2, 3);
        } else {
          tube(g, () => {
            g.beginPath();
            g.moveTo(x - cr * 1.4, y);
            g.lineTo(x + cr * 1.4, y);
            g.moveTo(x, y - cr * 1.4);
            g.lineTo(x, y + cr * 1.4);
          }, f.color2, 3);
        }
      }
    }

    drawHero(g, f, openP, reach) {
      const { x, y, r } = f;

      // A chrome dial ring around the center specimen.
      const dial = smooth(range(openP, 0, 0.8));
      const R1 = r * 1.16;
      tube(g, () => {
        g.beginPath();
        g.arc(x, y, R1, -Math.PI / 2, -Math.PI / 2 + TAU * dial);
      }, POWDER, 6);
      g.strokeStyle = rgba(this.ink, 0.8);
      g.lineWidth = 1;
      g.beginPath();
      const ticks = Math.floor(72 * dial);
      for (let i = 0; i < ticks; i++) {
        const a = -Math.PI / 2 + (i / 72) * TAU;
        const len = i % 6 === 0 ? 10 : 5;
        g.moveTo(x + Math.cos(a) * (R1 + 5), y + Math.sin(a) * (R1 + 5));
        g.lineTo(x + Math.cos(a) * (R1 + 5 + len), y + Math.sin(a) * (R1 + 5 + len));
      }
      g.stroke();

      this.extrudeArms(g, f, f.backArms, this.heroAccent, reach, r * 0.08);
      this.extrudeArms(g, f, f.arms, f.color, reach, r * 0.1);

      // A thick plastic disc for the logo to sit on.
      const disc = smooth(range(openP, 0.55, 0.9));
      if (disc > 0) {
        const dr = r * this.logoScale * 1.02 * disc;
        const d = r * 0.06;
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.beginPath();
        g.arc(x + d * 2.2, y + d * 2.8, dr, 0, TAU);
        g.fill();
        for (let k = 4; k >= 1; k--) {
          g.fillStyle = rgba(tone(f.color, -0.35 - k * 0.06));
          g.beginPath();
          g.arc(x + (d * k) / 4, y + (d * k * 1.3) / 4, dr, 0, TAU);
          g.fill();
        }
        g.fillStyle = banded(g.createRadialGradient(x - dr * 0.4, y - dr * 0.45, 0, x - dr * 0.1, y - dr * 0.1, dr * 1.2), [
          [0.1, rgba(tone(f.color, 0.7))],
          [0.32, rgba(tone(f.color, 0.18))],
          [0.72, rgba(f.color)],
          [1, rgba(tone(f.color, -0.3))],
        ]);
        g.beginPath();
        g.arc(x, y, dr, 0, TAU);
        g.fill();
      }
    }

    /* A cheap lens flare from a light off the top left, through the center. */
    drawFlare(g) {
      const lx = this.w * 0.16;
      const ly = this.h * 0.1;
      const dx = this.w / 2 - lx;
      const dy = this.h / 2 - ly;
      g.save();
      g.globalCompositeOperation = 'lighter';
      const glow = g.createRadialGradient(lx, ly, 0, lx, ly, 120);
      glow.addColorStop(0, 'rgba(255,255,255,0.75)');
      glow.addColorStop(0.15, rgba(POWDER, 0.35));
      glow.addColorStop(1, rgba(POWDER, 0));
      g.fillStyle = glow;
      g.fillRect(lx - 120, ly - 120, 240, 240);
      g.strokeStyle = rgba(POWDER, 0.3);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.2;
        const len = i % 2 ? 60 : 150;
        g.moveTo(lx, ly);
        g.lineTo(lx + Math.cos(a) * len, ly + Math.sin(a) * len);
      }
      g.stroke();
      const parts = [
        [0.3, 14, POWDER, 0.22, 'disc'],
        [0.55, 32, this.foliage, 0.14, 'hex'],
        [0.78, 8, this.heroColor, 0.3, 'disc'],
        [1.3, 70, POWDER, 0.1, 'ring'],
        [1.5, 22, this.heroAccent, 0.2, 'hex'],
        [1.85, 46, this.foliage, 0.1, 'disc'],
      ];
      for (const [k, rad, c, a, shape] of parts) {
        const px = lx + dx * k;
        const py = ly + dy * k;
        g.beginPath();
        if (shape === 'hex') {
          for (let i = 0; i < 6; i++) {
            const t = (i / 6) * TAU;
            g[i ? 'lineTo' : 'moveTo'](px + Math.cos(t) * rad, py + Math.sin(t) * rad);
          }
          g.closePath();
        } else {
          g.arc(px, py, rad, 0, TAU);
        }
        if (shape === 'ring') {
          g.strokeStyle = rgba(c, a);
          g.lineWidth = 4;
          g.stroke();
        } else {
          g.fillStyle = rgba(c, a);
          g.fill();
        }
      }
      g.restore();
    }

    drawEyes(g) {
      const t = this.elapsed;
      for (const f of this.eyes) {
        if (f.p < 0.9) continue;
        const e = f.eye;
        let b = 1;
        if (e.blinkAt >= 0 && t >= e.blinkAt) {
          const bt = (t - e.blinkAt) / BLINK;
          if (bt >= 1) e.blinkAt = -1;
          else b = Math.abs(Math.cos(Math.PI * bt));
        }
        this.drawEye(g, f, e, smooth(range(f.p, 0.9 + e.delay, 1)) * b);
      }
    }

    /* A CGI eyeball: banded plastic shading and a hard square window reflection. */
    drawEye(g, f, e, open) {
      const { w, h } = e;
      const skin = f.color;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(e.rot);

      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.ellipse(w * 0.15, h * 0.35, w * 1.22, h * 1.8, 0, 0, TAU);
      g.fill();
      g.fillStyle = banded(g.createRadialGradient(-w * 0.4, -h * 0.8, 0, 0, 0, w * 1.3), [
        [0.3, rgba(tone(skin, 0.25))],
        [0.7, rgba(tone(skin, -0.15))],
        [1, rgba(tone(skin, -0.5))],
      ]);
      g.beginPath();
      g.ellipse(0, 0, w * 1.2, h * 1.75, 0, 0, TAU);
      g.fill();

      const lid = (ap) => {
        g.beginPath();
        g.moveTo(-w, 0);
        g.bezierCurveTo(-w * 0.45, -h * 1.4 * ap, w * 0.45, -h * 1.4 * ap, w, 0);
        g.bezierCurveTo(w * 0.45, h * 1.15 * ap, -w * 0.45, h * 1.15 * ap, -w, 0);
        g.closePath();
      };

      if (open < 0.06) {
        g.strokeStyle = rgba(tone(skin, -0.75));
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(-w, 0);
        g.quadraticCurveTo(0, h * 0.4, w, 0);
        for (let i = 1; i < 6; i++) {
          const lx = -w + (i / 6) * w * 2;
          const ly = h * 0.4 * (1 - Math.abs(lx / w) ** 2);
          g.moveTo(lx, ly);
          g.lineTo(lx * 1.1, ly + h * 0.35);
        }
        g.stroke();
        g.restore();
        return;
      }

      lid(open);
      g.save();
      g.clip();
      g.fillStyle = banded(g.createRadialGradient(-w * 0.3, -h * 0.5, 0, 0, 0, w * 1.05), [
        [0.18, rgba(WHITE)],
        [0.5, rgba(tone(POWDER, 0.45))],
        [0.8, rgba(POWDER)],
        [1, rgba(mix(POWDER, OCEAN, 0.45))],
      ]);
      g.fillRect(-w, -h * 2, w * 2, h * 4);

      const ir = h * 1.05;
      const ix = e.px * w * 0.55;
      const iy = e.py * h * 0.6;
      g.fillStyle = banded(g.createRadialGradient(ix, iy, 0, ix, iy, ir), [
        [0.3, rgba(tone(e.iris, 0.35))],
        [0.7, rgba(e.iris)],
        [0.9, rgba(tone(e.iris, -0.35))],
        [1, rgba(tone(e.iris, -0.7))],
      ]);
      g.beginPath();
      g.arc(ix, iy, ir, 0, TAU);
      g.fill();
      g.fillStyle = rgba(tone(OCEAN, -0.8));
      g.beginPath();
      g.arc(ix, iy, ir * e.pupil, 0, TAU);
      g.fill();

      // The studio window reflected in every eye.
      const q = ir * 0.17;
      const wx = ix - ir * 0.62;
      const wy = iy - ir * 0.66;
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fillRect(wx, wy, q, q);
      g.fillRect(wx + q * 1.25, wy, q, q);
      g.fillRect(wx, wy + q * 1.25, q, q);
      g.fillRect(wx + q * 1.25, wy + q * 1.25, q, q);

      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.fillRect(-w, -h * 2, w * 2, h * 2 - h * 0.7 * open);
      g.restore();

      lid(open);
      g.strokeStyle = rgba(tone(skin, -0.7));
      g.lineWidth = 1.6;
      g.stroke();
      g.restore();
    }

    drawOverlay(g) {
      const ink = this.ink;
      const ptr = this.pointer;

      // Crosshair across the field at the pointer.
      if (ptr.active && !this.classList.contains('is-nav-open')) {
        g.strokeStyle = rgba(ink, 0.22);
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
        const h = f.r * 1.08;
        const c = Math.min(10, h * 0.4);
        g.strokeStyle = rgba(ink, 0.95);
        g.lineWidth = 1;
        g.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const cx = f.x + sx * h;
          const cy = f.y + sy * h;
          g.moveTo(cx - sx * c, cy);
          g.lineTo(cx, cy);
          g.lineTo(cx, cy - sy * c);
        }
        g.stroke();

        const label = [
          `✱${String(f.id).padStart(4, '0')}`,
          `${STYLE_CODE[f.style]}-${f.n}`,
          hex(f.color),
          `${String(Math.round(f.p * 100)).padStart(3, '0')}%`,
          f.eye ? (this.pointer.active ? 'WATCHING' : 'AWAKE') : f.isHero ? 'PRIMARY' : 'BLIND',
        ].join('  ');
        g.font = '500 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
        const tw = g.measureText(label).width;
        const lx = clamp(f.x - h, 4, this.w - tw - 12);
        const ly = clamp(f.y + h + 6, 4, this.h - 20);
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

  customElements.define('garden-splash', GardenSplash);
})();
