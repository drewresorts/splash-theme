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
const FLY = 0.7; // seconds to fly from the grid into the product page
const HANDOFF_KEY = 'duet-3d-handoff';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

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
    for (const v of this.views) v.step(dt);
    for (const v of this.views) {
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
    return this.el && this.el.isConnected ? this.el.getBoundingClientRect() : null;
  }

  /* Flies from where it is now to the box that to() gives (read every frame, so it follows scrolling and late layout). */
  flyTo(to, time = FLY) {
    const from = this.rect();
    this.flight = from ? { from: { left: from.left, top: from.top, width: from.width, height: from.height }, to, t: 0, time: reduced() ? 0.01 : time } : null;
    return new Promise((resolve) => (this.landed = resolve));
  }

  step(dt) {
    const want = this.hold || !this.turning ? 0 : SPIN;
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

class DuetTurntable extends HTMLElement {
  connectedCallback() {
    this.st = stage();
    this.views = [];
    this.querySelectorAll('[data-turntable-card]').forEach((card) => this.card(card));
  }

  disconnectedCallback() {
    for (const v of this.views) if (!v.keep) this.st.remove(v);
    this.views = [];
  }

  card(card) {
    const url = card.dataset.model;
    const link = card.querySelector('a[href]');
    const place = card.querySelector('[data-turntable-stage]');
    let view = null;
    if (url && place) {
      view = this.st.add(new View(this.st, place, url));
      this.views.push(view);
      view.ready.then(() => view.object && card.classList.add('is-3d')).catch(() => card.classList.add('is-flat'));
      card.addEventListener('pointerenter', () => (view.hold = true));
      card.addEventListener('pointerleave', () => (view.hold = false));
      card.addEventListener('focusin', () => (view.hold = true));
      card.addEventListener('focusout', () => (view.hold = false));
    }
    if (!link) return;
    link.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.open(card, view, link.href);
    });
  }

  /* Opens a product: the others fade into the page, its model flies to where the product page shows it. */
  open(card, view, href) {
    if (this.opening) return;
    this.opening = true;
    this.classList.add('is-opening');
    card.classList.add('is-chosen');
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
