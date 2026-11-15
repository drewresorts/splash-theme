/**
 * Products in 3D: the 3D shop grid (sections/duet-shop-3d.liquid) and the
 * 3D product page (sections/duet-product-3d.liquid).
 *
 * One stage draws every model on the page: a single see-through canvas
 * fixed over the window (it takes no clicks), with each model drawn into
 * the box of the element that holds its place in the page, so any number
 * of products cost one WebGL context. Models are each product's own 3D
 * file (a .glb added to its media in Shopify), lit like a white studio.
 *
 * In the grid each model turns slowly and stops while the pointer is on
 * it. Clicked, the others fade away and the model flies to where the
 * product page shows it, then the page changes under it without a reload
 * (assets/duet-soft-nav.js): the stage stays, and the product page takes
 * over the very same model. With a full page load instead, the product
 * page starts the model where it was in the grid and flies it in from
 * there. On the product page the model turns slowly, and dragging turns
 * it by hand.
 *
 * The stage lives on window, shared by every element on every page of the
 * visit; it stops drawing when nothing is on it or the tab is hidden.
 */
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './three-gltf-loader.js';

const SPIN = 0.32; // radians a second, turning on its own
const TURN = (Math.PI * 2) / 3.2; // raised in the grid: a full turn every 3.2 seconds
const FLY = 0.7; // seconds to fly from the grid into the product page
const HANDOFF_KEY = 'duet-3d-handoff';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/* ---------------- the stage ---------------- */

class Stage {
  constructor() {
    const canvas = document.createElement('canvas');
    canvas.className = 'duet-3d-stage';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setScissorTest(true);

    // A white studio: soft light from all round, a key light high to one side, a cool rim behind.
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe4e8f0, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 1.1);
    rim.position.set(-4, 2, -3);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(0, 0.35, 4.6);
    this.camera.lookAt(0, 0, 0);

    this.views = new Set();
    this.models = new Map();
    this.loader = new GLTFLoader();
    this.handoff = null;
    this.last = 0;
    this.raf = 0;
    document.addEventListener('visibilitychange', () => this.wake());
  }

  /* A product's model, loaded once a visit and shared: centered, scaled to fit a sphere of radius 1. */
  model(url) {
    if (!this.models.has(url)) {
      this.models.set(
        url,
        this.loader.loadAsync(url).then((gltf) => {
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          const fit = new THREE.Group();
          root.position.sub(sphere.center);
          fit.add(root);
          fit.scale.setScalar(1 / Math.max(sphere.radius, 1e-6));
          return fit;
        })
      );
    }
    return this.models.get(url);
  }

  add(view) {
    this.views.add(view);
    this.wake();
    return view;
  }

  remove(view) {
    if (!this.views.delete(view)) return;
    if (view.object) this.scene.remove(view.object);
  }

  wake() {
    if (this.raf || document.hidden || !this.views.size) return;
    this.last = performance.now();
    const loop = (now) => {
      this.raf = 0;
      if (document.hidden || !this.views.size) {
        this.clear();
        return;
      }
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  clear() {
    const r = this.renderer;
    r.setScissor(0, 0, this.canvas.width, this.canvas.height);
    r.clear();
  }

  draw(dt) {
    const r = this.renderer;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.w !== w || this.h !== h) {
      this.w = w;
      this.h = h;
      r.setSize(w, h, false);
    }
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.clear();
    // Models may overlap (the grid lets them bump about): each clears only its depth, not what is drawn under it.
    r.autoClear = false;
    for (const v of this.views) v.step(dt);
    // Back to front: one raised above the rest (z) is drawn over them.
    const order = Array.from(this.views).sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const v of order) {
      if (!v.object || v.alpha <= 0.002) continue;
      const box = v.rect();
      if (!box || box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > h || box.right < 0 || box.left > w) continue;
      for (const o of this.views) if (o.object) o.object.visible = o === v;
      const y = h - box.bottom;
      r.setViewport(box.left, y, box.width, box.height);
      r.setScissor(box.left, y, box.width, box.height);
      this.camera.aspect = box.width / box.height;
      // Wide boxes keep the model's size by height, tall ones by width.
      this.camera.zoom = Math.min(1, this.camera.aspect);
      this.camera.updateProjectionMatrix();
      v.applyAlpha();
      r.clearDepth();
      r.render(this.scene, this.camera);
    }
  }
}

function stage() {
  if (!window.__duet3dStage) window.__duet3dStage = new Stage();
  return window.__duet3dStage;
}

/* ---------------- one model in one place ---------------- */

class View {
  constructor(st, el, url) {
    this.stage = st;
    this.el = el;
    this.url = url;
    this.object = null;
    this.angle = Math.random() * Math.PI * 2;
    this.tilt = 0;
    this.speed = reduced() ? 0 : SPIN;
    this.turning = !reduced();
    this.hold = false;
    this.alpha = 1;
    this.targetAlpha = 1;
    this.flight = null;
    this.materials = [];
    this.place = null; // where to draw instead of its element's box (the grid moves its models about: see DuetTurntable)
    this.boost = 0; // 0 to 1: turning faster, a full turn every few seconds (raised in the grid)
    this.z = 0;
    this.ready = st.model(url).then((template) => {
      if (!st.views.has(this)) return this;
      // Its own copy, with its own materials, so it can fade on its own.
      const obj = template.clone(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          m.userData.opacity = m.opacity;
          m.userData.transparent = m.transparent;
          this.materials.push(m);
        });
      });
      this.object = obj;
      st.scene.add(obj);
      return this;
    });
  }

  /* Where to draw: its element's box, or the box on its way while flying. */
  rect() {
    const f = this.flight;
    if (f) {
      const to = f.to();
      if (!to) return f.from;
      const k = ease(Math.min(1, f.t / f.time));
      return { left: lerp(f.from.left, to.left, k), top: lerp(f.from.top, to.top, k), width: lerp(f.from.width, to.width, k), height: lerp(f.from.height, to.height, k), get right() { return this.left + this.width; }, get bottom() { return this.top + this.height; } };
    }
    if (this.place) return this.place();
    return this.el && this.el.isConnected ? this.el.getBoundingClientRect() : null;
  }

  /* Flies from where it is now to the box that to() gives (read every frame, so it follows scrolling and late layout). */
  flyTo(to, time = FLY) {
    const from = this.rect();
    this.flight = from ? { from: { left: from.left, top: from.top, width: from.width, height: from.height }, to, t: 0, time: reduced() ? 0.01 : time } : null;
    return new Promise((resolve) => (this.landed = resolve));
  }

  step(dt) {
    const want = this.hold || !this.turning ? 0 : SPIN + (TURN - SPIN) * this.boost;
    this.speed += (want - this.speed) * (1 - Math.exp(-dt * 4));
    this.angle += this.speed * dt;
    this.tilt *= Math.exp(-dt * 2);
    this.alpha += (this.targetAlpha - this.alpha) * (1 - Math.exp(-dt * 8));
    if (this.flight) {
      this.flight.t += dt;
      if (this.flight.t >= this.flight.time) {
        this.flight = null;
        if (this.landed) this.landed();
      }
    }
    if (this.object) this.object.rotation.set(this.tilt, this.angle, 0);
  }

  applyAlpha() {
    const a = Math.max(0, Math.min(1, this.alpha));
    for (const m of this.materials) {
      m.opacity = m.userData.opacity * a;
      const see = a < 0.999 || m.userData.transparent;
      // Opaque and see-through materials are drawn by different shaders: rebuild it when that changes.
      if (m.transparent !== see) {
        m.transparent = see;
        m.needsUpdate = true;
      }
      m.depthWrite = a > 0.5;
    }
  }
}

/* ---------------- the grid ---------------- */

/*
 * The grid as an ice rink: each product's model has its place in a loose
 * grid (its card's box, a little off true), but isn't fixed there. Drag one
 * and it follows; let go mid-swipe and it glides off; a fast pass of the
 * pointer pushes what it sweeps through; they bump into each other and
 * bounce, and all the while each drifts slowly back to its place, the way
 * the clouds and stars do in the splash's sky view.
 *
 * Pointing at one raises it above the rest, a little larger, its shadow on
 * the page below, turning a full turn every few seconds, with its name and
 * price called out beside it like a label on a diagram (the words stay in
 * the card for screen readers and search, out of sight). A click (a tap on
 * the raised one, on a phone) opens it. Keyboard focus raises and labels
 * the focused one; Enter opens it.
 *
 * Positions are kept in screen pixels as offsets from each card's place,
 * read afresh every frame, so scrolling and resizing carry everything along.
 */
const RINK = {
  // Heavy, like huge things adrift in space: slow to start, slow to stop, slow home.
  spring: 0.22, // how firmly each is drawn back to its place (a long, lazy drift home)
  friction: 0.62, // how quickly a glide dies away
  bounce: 0.25, // how much of a knock carries into the other (a soft, heavy nudge)
  tether: 5, // how hard a dragged one is pulled toward the pointer (it trails behind)
  tow: 3.6, // how much a dragged one resists being swung about
  drift: 0.3, // top speed adrift, in its own widths a second
  haul: 0.4, // top speed while dragged, in its own widths a second
  range: 0.38, // the soft edge of its patch, in its own widths (it slows to a stop about a quarter of the way into the next one's space)
  wall: 14, // how sharply it slows as it nears that edge
  body: 0.42, // how wide it is for knocks, in its own widths
  heft: 3, // how much heavier a dragged one is than the ones it shoves
  lift: 0.22, // how much larger a raised one grows
  push: 1500, // how fast the pointer must sweep to nudge things aside (pixels a second)
};

class DuetTurntable extends HTMLElement {
  connectedCallback() {
    this.st = stage();
    this.views = [];
    this.items = [];
    this.abort = new AbortController();
    this.callout = this.querySelector('[data-turntable-callout]');
    this.pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0, inside: false, type: 'mouse' };
    this.drag = null;
    this.hover = null;
    this.focus = null;
    this.active = null; // a phone's tapped one, raised until tapped again (opens) or elsewhere
    this.querySelectorAll('[data-turntable-card]').forEach((card, i) => this.card(card, i));
    this.bind();
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!document.hidden) this.step(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    if (this.abort) this.abort.abort();
    for (const v of this.views) if (!v.keep) this.st.remove(v);
    this.views = [];
    this.items = [];
  }

  card(card, i) {
    const url = card.dataset.model;
    const link = card.querySelector('a[href]');
    const place = card.querySelector('[data-turntable-stage]');
    const img = place && place.querySelector('img, svg');
    const shadow = card.querySelector('[data-turntable-shadow]');
    // Off true a little, so the grid reads as loosely laid out.
    const jig = (k) => Math.sin(i * 12.9898 + k * 78.233) * 43758.5453 % 1;
    const item = { card, link, place, img, shadow, view: null, ox: 0, oy: 0, vx: 0, vy: 0, lift: 0, jx: jig(1) * 0.06, jy: jig(2) * 0.06, box: null };
    this.items.push(item);
    if (url && place) {
      const view = this.st.add(new View(this.st, place, url));
      item.view = view;
      this.views.push(view);
      view.place = () => this.boxOf(item);
      view.ready.then(() => view.object && card.classList.add('is-3d')).catch(() => card.classList.add('is-flat'));
    }
    card.addEventListener('focusin', () => (this.focus = item), { signal: this.abort.signal });
    card.addEventListener('focusout', () => this.focus === item && (this.focus = null), { signal: this.abort.signal });
    if (link) {
      // A click on the link itself comes from the keyboard (the pointer is handled on the rink, see bind()).
      link.addEventListener(
        'click',
        (e) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.open(item);
        },
        { signal: this.abort.signal }
      );
    }
  }

  /* An item's place: its card's stage box, set off by its offset, larger and higher as it is raised. */
  home(item) {
    const r = item.place.getBoundingClientRect();
    return { x: r.left + r.width * (0.5 + item.jx), y: r.top + r.height * (0.5 + item.jy), s: r.width };
  }

  boxOf(item) {
    const b = item.box || this.home(item);
    const size = b.s * (1 + RINK.lift * smoothstep(item.lift));
    const cx = b.x + item.ox;
    const cy = b.y + item.oy - b.s * 0.08 * smoothstep(item.lift);
    return { left: cx - size / 2, top: cy - size / 2, width: size, height: size, right: cx + size / 2, bottom: cy + size / 2 };
  }

  /* Which item is under (x, y), the nearest within reach of its middle, or null. */
  hit(x, y) {
    let best = null;
    let bd = Infinity;
    for (const it of this.items) {
      if (!it.box) continue;
      const cx = it.box.x + it.ox;
      const cy = it.box.y + it.oy;
      const d = Math.hypot(x - cx, y - cy);
      const reach = it.box.s * 0.42 * (1 + RINK.lift * it.lift);
      if (d < reach && d < bd) {
        best = it;
        bd = d;
      }
    }
    return best;
  }

  bind() {
    const on = { signal: this.abort.signal };
    const P = this.pointer;
    const move = (e) => {
      const now = performance.now();
      const dt = Math.max(0.001, (now - P.t) / 1000);
      if (P.t) {
        // The pointer's speed, smoothed a little.
        P.vx = lerp(P.vx, (e.clientX - P.x) / dt, 0.5);
        P.vy = lerp(P.vy, (e.clientY - P.y) / dt, 0.5);
      }
      P.x = e.clientX;
      P.y = e.clientY;
      P.t = now;
      P.type = e.pointerType;
      const D = this.drag;
      if (D && e.pointerId === D.id) {
        if (!D.moved && Math.hypot(e.clientX - D.sx, e.clientY - D.sy) > 6) D.moved = true;
        if (D.moved && D.item) {
          // Where the pointer would have it, reined in softly to its patch; it is towed there, not put there.
          const R = D.item.box.s * RINK.range;
          const tx = e.clientX - D.gx - D.item.box.x;
          const ty = e.clientY - D.gy - D.item.box.y;
          const t = Math.hypot(tx, ty);
          const k = t > 1e-3 ? (R * Math.tanh(t / R)) / t : 1;
          D.tx = tx * k;
          D.ty = ty * k;
        }
      }
    };
    window.addEventListener('pointermove', move, on);
    this.addEventListener('pointerenter', () => (P.inside = true), on);
    this.addEventListener('pointerleave', () => {
      P.inside = false;
      P.x = P.y = -1e4;
    }, on);
    this.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || this.opening) return;
        move(e);
        const it = this.hit(e.clientX, e.clientY);
        this.drag = { id: e.pointerId, item: it, sx: e.clientX, sy: e.clientY, moved: false, gx: 0, gy: 0, tx: 0, ty: 0, t: performance.now() };
        if (it) {
          this.drag.gx = e.clientX - (it.box.x + it.ox);
          this.drag.gy = e.clientY - (it.box.y + it.oy);
          this.drag.tx = it.ox;
          this.drag.ty = it.oy;
          // A mouse grab is the rink's; a finger may still be scrolling the page (touch-action leaves it pan-y).
          if (e.pointerType === 'mouse') e.preventDefault();
        }
      },
      on
    );
    const up = (e) => {
      const D = this.drag;
      if (!D || e.pointerId !== D.id) return;
      this.drag = null;
      if (D.moved || !D.item || e.type === 'pointercancel') return;
      const it = D.item;
      // A tap: on a phone the first raises it and calls it out, the second opens it.
      if (e.pointerType !== 'mouse' && this.active !== it) {
        this.active = it;
        return;
      }
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
        if (it.link) window.open(it.link.href, '_blank', 'noopener');
        return;
      }
      this.open(it);
    };
    window.addEventListener('pointerup', up, on);
    window.addEventListener('pointercancel', up, on);
    // A tap anywhere else lets a phone's raised one down.
    document.addEventListener('pointerdown', (e) => !this.contains(e.target) && (this.active = null), on);
  }

  step(dt) {
    const still = reduced();
    const P = this.pointer;
    for (const it of this.items) it.box = it.place.isConnected ? this.home(it) : null;
    const items = this.items.filter((it) => it.box);
    // Who is raised: the dragged one, else the one pointed at, the one with focus, or a phone's tapped one.
    const pointed = P.inside && P.type === 'mouse' && !this.drag ? this.hit(P.x, P.y) : null;
    const raised = this.opening ? null : (this.drag && this.drag.moved && this.drag.item) || pointed || this.focus || this.active;
    this.raised = raised;
    this.classList.toggle('is-pointing', !!pointed);
    const fast = Math.hypot(P.vx, P.vy) > RINK.push;
    for (const it of items) {
      const dragging = this.drag && this.drag.moved && this.drag.item === it;
      it.lift += ((it === raised ? 1 : 0) - it.lift) * (1 - Math.exp(-dt * 4));
      if (still) {
        it.ox = it.oy = it.vx = it.vy = 0;
        continue;
      }
      if (dragging) {
        // Towed toward the pointer: it lags, and gathers speed slowly.
        const D = this.drag;
        it.vx += (RINK.tether * (D.tx - it.ox) - RINK.tow * it.vx) * dt;
        it.vy += (RINK.tether * (D.ty - it.oy) - RINK.tow * it.vy) * dt;
      } else {
        // Drawn back toward its place, drifting.
        it.vx += (-RINK.spring * it.ox - RINK.friction * it.vx) * dt;
        it.vy += (-RINK.spring * it.oy - RINK.friction * it.vy) * dt;
        // Nudged a little by a fast pass of the pointer.
        if (fast && P.inside && !this.drag && it !== raised) {
          const cx = it.box.x + it.ox;
          const cy = it.box.y + it.oy;
          const d = Math.hypot(P.x - cx, P.y - cy);
          const reach = it.box.s * 0.5;
          if (d < reach) {
            const k = (1 - d / reach) * 0.5 * dt;
            it.vx += P.vx * k;
            it.vy += P.vy * k;
          }
        }
      }
      // Too heavy to move fast, however hard it is thrown.
      const top = it.box.s * (dragging ? RINK.haul : RINK.drift);
      const v = Math.hypot(it.vx, it.vy);
      if (v > top) {
        it.vx *= top / v;
        it.vy *= top / v;
      }
      // Slower and slower as it nears the edge of its patch, going outward.
      const R = it.box.s * RINK.range;
      const o = Math.hypot(it.ox, it.oy);
      if (o > 1e-3) {
        const nx = it.ox / o;
        const ny = it.oy / o;
        const out = it.vx * nx + it.vy * ny;
        if (out > 0) {
          const q = o / R;
          const keep = Math.exp(-dt * RINK.wall * q * q);
          it.vx -= out * (1 - keep) * nx;
          it.vy -= out * (1 - keep) * ny;
        }
      }
      it.ox += it.vx * dt;
      it.oy += it.vy * dt;
      // Never so far that it is lost.
      const max = R * 1.08;
      const far = Math.hypot(it.ox, it.oy);
      if (far > max) {
        it.ox *= max / far;
        it.oy *= max / far;
        const out = (it.vx * it.ox + it.vy * it.oy) / max;
        if (out > 0) {
          it.vx -= (out * it.ox) / max;
          it.vy -= (out * it.oy) / max;
        }
      }
    }
    // Knocks: none overlaps another; each takes some of the other's speed along the line between them.
    if (!still) {
      for (let a = 0; a < items.length; a++) {
        for (let b = a + 1; b < items.length; b++) {
          const A = items[a];
          const B = items[b];
          const ax = A.box.x + A.ox;
          const ay = A.box.y + A.oy;
          const bx = B.box.x + B.ox;
          const by = B.box.y + B.oy;
          const ra = A.box.s * RINK.body * (1 + RINK.lift * A.lift);
          const rb = B.box.s * RINK.body * (1 + RINK.lift * B.lift);
          const dx = bx - ax;
          const dy = by - ay;
          const d = Math.hypot(dx, dy);
          if (d >= ra + rb || d < 1e-3) continue;
          const nx = dx / d;
          const ny = dy / d;
          const over = ra + rb - d;
          // A dragged one is heavier: it shoves the others more than they shove it.
          const held = this.drag && this.drag.moved && this.drag.item;
          const ma = held === A ? RINK.heft : 1;
          const mb = held === B ? RINK.heft : 1;
          const share = mb / (ma + mb);
          A.ox -= nx * over * share;
          A.oy -= ny * over * share;
          B.ox += nx * over * (1 - share);
          B.oy += ny * over * (1 - share);
          const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
          if (rel < 0) {
            const j = (-(1 + RINK.bounce) * rel) / (1 / ma + 1 / mb);
            A.vx -= (j / ma) * nx;
            A.vy -= (j / ma) * ny;
            B.vx += (j / mb) * nx;
            B.vy += (j / mb) * ny;
          }
        }
      }
    }
    // What goes with each: its turning, its order, its shadow on the page, a photo standing in for a model.
    for (const it of items) {
      const k = smoothstep(it.lift);
      const box = this.boxOf(it);
      const cx = box.left + box.width / 2;
      if (it.view) {
        it.view.boost = still ? 0 : k;
        it.view.z = k;
      }
      if (it.shadow) {
        const r = it.place.getBoundingClientRect();
        const sx = cx - (r.left + r.width / 2);
        const sy = it.box.y + it.oy + it.box.s * 0.4 - (r.top + r.height / 2);
        it.shadow.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${(0.75 + 0.45 * k).toFixed(3)})`;
        it.shadow.style.opacity = (0.15 + 0.6 * k).toFixed(3);
      }
      if (!it.view && it.img) {
        it.img.style.transform = `translate(${(it.ox + it.box.s * it.jx).toFixed(1)}px, ${(it.oy + it.box.s * it.jy - it.box.s * 0.08 * k).toFixed(1)}px) scale(${(1 + RINK.lift * k).toFixed(3)})`;
        it.img.style.zIndex = k > 0.05 ? 2 : '';
      }
    }
    this.callOut(raised);
  }

  /*
   * The raised one's name and price beside it, like a label on a diagram:
   * a dot at its edge, a line out and up, the words along the line's end.
   * To its right, or to its left near the right edge of the screen.
   */
  callOut(it) {
    const C = this.callout;
    if (!C) return;
    if (!it || !it.box || it.lift < 0.25) {
      if (this.calledOut) {
        C.classList.remove('is-on');
        this.calledOut = null;
      }
      return;
    }
    if (this.calledOut !== it) {
      this.calledOut = it;
      const info = it.card.querySelector('[data-turntable-info]');
      const title = info && info.querySelector('[data-turntable-title]');
      const price = info && info.querySelector('[data-turntable-price]');
      const badge = info && info.querySelector('[data-turntable-badge]');
      C.querySelector('[data-callout-title]').textContent = title ? title.textContent.trim() : '';
      C.querySelector('[data-callout-price]').innerHTML = price ? price.innerHTML : '';
      const b = C.querySelector('[data-callout-badge]');
      b.textContent = badge ? badge.textContent.trim() : '';
      b.hidden = !badge;
      C.classList.remove('is-on');
      void C.offsetWidth;
      C.classList.add('is-on');
    }
    const box = this.boxOf(it);
    const host = this.getBoundingClientRect();
    const left = box.right + 220 > window.innerWidth;
    // No room above it within the grid (the top row): the line runs down instead.
    const below = box.top + box.height * 0.3 - host.top < 90;
    C.classList.toggle('is-left', left);
    C.classList.toggle('is-below', below);
    const ax = (left ? box.left + box.width * 0.18 : box.right - box.width * 0.18) - host.left;
    const ay = (below ? box.top + box.height * 0.62 : box.top + box.height * 0.3) - host.top;
    C.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px)`;
  }

  /* Opens a product: the others fade into the page, its model flies to where the product page shows it. */
  open(item) {
    if (this.opening || !item) return;
    const view = item.view;
    const href = item.link ? item.link.href : null;
    if (!href) return;
    this.opening = true;
    this.classList.add('is-opening');
    item.card.classList.add('is-chosen');
    for (const v of this.views) if (v !== view) v.targetAlpha = 0;
    const go = () => {
      if (!(window.duetSoftNav && window.duetSoftNav.go(href))) window.location.assign(href);
    };
    if (!view || !view.object) {
      window.setTimeout(go, reduced() ? 0 : 280);
      return;
    }
    view.keep = true;
    view.hold = false;
    this.st.handoff = { url: view.url, view };
    // For a full page load: where it was, so the product page can fly it in from there.
    try {
      const r = view.rect();
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ url: view.url, angle: view.angle, at: Date.now(), rect: r && { left: r.left, top: r.top, width: r.width, height: r.height } }));
    } catch (err) {
      /* private mode: the product page simply fades the model in */
    }
    view.flyTo(() => productMediaBox(), FLY);
    // From here on it is the flight's, then the product page's: no longer the rink's.
    view.place = null;
    view.boost = 0;
    // The page starts changing while it flies; the product page takes it over where it lands.
    window.setTimeout(go, reduced() ? 0 : FLY * 600);
  }
}

/*
 * Where the product page shows its model, before that page is here: the
 * same box sections/duet-product-3d.liquid lays out (keep the two in step).
 * The product page then takes the model over at its real box.
 */
function productMediaBox() {
  const w = window.innerWidth;
  const header = document.querySelector('.duet-header__bar, .section-header');
  const top = (header ? header.getBoundingClientRect().bottom : 0) + (w >= 990 ? 32 : 16);
  if (w >= 990) {
    const page = Math.min(w, 1360) - 80;
    const left = (w - page) / 2;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const size = Math.min(page * 0.56, window.innerHeight - 13 * rem);
    return { left, top, width: size, height: size };
  }
  const size = Math.min(w - 32, window.innerHeight * 0.6);
  return { left: (w - size) / 2, top, width: size, height: size };
}

/* ---------------- the product page ---------------- */

class DuetProduct3d extends HTMLElement {
  connectedCallback() {
    this.st = stage();
    const url = this.dataset.model;
    this.place = this.querySelector('[data-p3d-stage]');
    const section = this.closest('.duet-p3d');
    // The page's details come up out of the background as the model arrives.
    if (section) requestAnimationFrame(() => section.classList.add('is-in'));
    this.abort = new AbortController();
    this.bindThumbs();
    if (!url || !this.place) return;

    const h = this.st.handoff;
    if (h && h.url === url && this.st.views.has(h.view)) {
      // Straight from the grid: the very same model, flown on to its place here.
      this.view = h.view;
      this.view.keep = false;
      this.view.el = this.place;
      this.view.flyTo(() => this.place.getBoundingClientRect(), 0.45);
      this.st.handoff = null;
      // Already drawn: the photo standing in for it never shows.
      this.classList.add('is-3d', 'is-handed');
    } else {
      this.view = this.st.add(new View(this.st, this.place, url));
      let from = null;
      try {
        const saved = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
        if (saved && saved.url === url && Date.now() - saved.at < 15000) {
          from = saved.rect;
          this.view.angle = saved.angle;
        }
        sessionStorage.removeItem(HANDOFF_KEY);
      } catch (err) {
        /* no handoff */
      }
      if (from) {
        // After a full page load from the grid: from where it was there.
        this.view.flight = { from, to: () => this.place.getBoundingClientRect(), t: 0, time: reduced() ? 0.01 : 0.6 };
      } else {
        this.view.alpha = 0;
      }
    }
    this.view.ready.then(() => this.classList.add('is-3d')).catch(() => this.classList.add('is-flat'));
    this.drag();
  }

  disconnectedCallback() {
    if (this.view && !this.view.keep) this.st.remove(this.view);
    if (this.abort) this.abort.abort();
  }

  /* Dragging turns it by hand: sideways round, a little up and down; let go and it turns on its own again. */
  drag() {
    const on = { signal: this.abort.signal };
    let last = null;
    this.place.addEventListener(
      'pointerdown',
      (e) => {
        last = { x: e.clientX, y: e.clientY, id: e.pointerId };
        this.view.hold = true;
        this.place.setPointerCapture(e.pointerId);
      },
      on
    );
    this.place.addEventListener(
      'pointermove',
      (e) => {
        if (!last || e.pointerId !== last.id) return;
        this.view.angle += (e.clientX - last.x) * 0.012;
        this.view.tilt = Math.max(-0.6, Math.min(0.6, this.view.tilt + (e.clientY - last.y) * 0.008));
        last.x = e.clientX;
        last.y = e.clientY;
      },
      on
    );
    const end = (e) => {
      if (!last || e.pointerId !== last.id) return;
      last = null;
      this.view.hold = false;
    };
    this.place.addEventListener('pointerup', end, on);
    this.place.addEventListener('pointercancel', end, on);
    // Arrow keys turn it too, once it has focus.
    this.place.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        this.view.angle += e.key === 'ArrowLeft' ? -0.3 : 0.3;
      },
      on
    );
  }

  /* The photos under the model: one shows in its place; the 3D button brings the model back. */
  bindThumbs() {
    const photo = this.querySelector('[data-p3d-photo]');
    const thumbs = this.querySelectorAll('[data-p3d-thumb]');
    thumbs.forEach((b) =>
      b.addEventListener(
        'click',
        () => {
          const is3d = b.dataset.p3dThumb === '3d';
          thumbs.forEach((t) => t.setAttribute('aria-pressed', String(t === b)));
          if (photo) {
            photo.hidden = is3d;
            if (!is3d) {
              photo.src = b.dataset.src;
              photo.srcset = b.dataset.srcset || '';
              photo.alt = b.dataset.alt || '';
            }
          }
          if (this.view) this.view.targetAlpha = is3d ? 1 : 0;
        },
        { signal: this.abort.signal }
      )
    );
  }
}

/* ---------------- choosing a variant ---------------- */

/*
 * The option buttons on the 3D product page: picking a value finds the
 * matching variant (from the product's JSON beside them), and updates the
 * form's variant, the price, the button (sold out or not) and the address,
 * without reloading.
 */
class DuetVariantPicker extends HTMLElement {
  connectedCallback() {
    const data = this.querySelector('script[type="application/json"]');
    if (!data) return;
    this.variants = JSON.parse(data.textContent);
    this.section = this.closest('.duet-p3d');
    this.addEventListener('change', () => this.update());
  }

  update() {
    const chosen = Array.from(this.querySelectorAll('fieldset')).map((f) => {
      const c = f.querySelector('input:checked');
      return c ? c.value : null;
    });
    const v = this.variants.find((x) => x.options.every((o, i) => o === chosen[i]));
    const s = this.section;
    const input = s.querySelector('form input[name="id"]');
    const button = s.querySelector('.duet-p3d__add');
    const label = button && button.querySelector('span');
    if (!v) {
      if (button) button.setAttribute('aria-disabled', 'true');
      if (label) label.textContent = this.dataset.unavailable;
      return;
    }
    if (input) input.value = v.id;
    const price = s.querySelector('[data-p3d-price]');
    const was = s.querySelector('[data-p3d-compare]');
    if (price) price.textContent = v.price;
    if (was) {
      was.textContent = v.compare || '';
      was.hidden = !v.compare;
    }
    if (button) {
      if (v.available) button.removeAttribute('aria-disabled');
      else button.setAttribute('aria-disabled', 'true');
    }
    if (label) label.textContent = v.available ? this.dataset.add : this.dataset.soldOut;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', v.id);
    history.replaceState(history.state, '', url.toString());
  }
}

if (!customElements.get('duet-turntable')) customElements.define('duet-turntable', DuetTurntable);
if (!customElements.get('duet-product-3d')) customElements.define('duet-product-3d', DuetProduct3d);
if (!customElements.get('duet-variant-picker')) customElements.define('duet-variant-picker', DuetVariantPicker);
