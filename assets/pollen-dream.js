/**
 * Pollen Dream
 *
 * Free first-person flight through the splash's own garden: the flowers in
 * their logo on the soil, and overhead the sky of the sky view (the "d"
 * easter egg), all of it one world, at the visitor's time of day. The bee,
 * the season's weather, the planes, the blimp, the birds, the sun and the
 * moon all carry on as they do on the page. There is nothing to win: just
 * fly about.
 *
 * The world is the page's garden itself (garden-splash.js startFlight());
 * this file only adds the controls and the screens over it. Opened from the
 * menu, a #pollen-dream link or the asterisk's hidden taps
 * (snippets/pollen-dream-launcher.liquid). On a page without the splash it
 * goes to the home page and opens there.
 */

const LOOK = { mouse: 0.0024, drag: 0.005, touch: 0.006 };

const STRINGS = {
  title: 'Pollen Dream',
  eyebrow: 'Duet',
  intro: 'Fly anywhere in the garden: down among the flowers, up into the sky and back again.',
  start: 'Fly',
  resume: 'Keep flying',
  exit: 'Back to Duet',
  pause: 'Pause',
  paused: 'Paused',
  loading: 'Waiting for the flowers…',
  failed: 'The garden can’t fly here.',
  failedHelp: 'Flying needs the garden on the home page, with WebGL turned on.',
  up: 'Up',
  down: 'Down',
  fast: 'Fast',
};

let current = null;

/* Opens the flight, or brings the open one back into focus. */
export async function openPollenDream(opts) {
  if (current) {
    current.focusScreen();
    return current;
  }
  current = new Flight(opts || {});
  try {
    await current.open();
  } catch (e) {
    console.error('pollen-dream:', e);
    if (current) current.showError();
  }
  return current;
}

/* The splash's garden on this page, once it has formed its logo, or null. */
function splashGarden(preferred) {
  const all = Array.from(document.querySelectorAll('garden-splash'));
  if (preferred && !all.includes(preferred)) all.unshift(preferred);
  return all.find((g) => typeof g.canFly === 'function' && g.canFly()) || null;
}

/* A splash garden that is still growing: worth waiting for. */
function growingGarden() {
  return Array.from(document.querySelectorAll('garden-splash')).find((g) => typeof g.canFly === 'function' && !g.failed && !g.backdrop && !g.background && !g.arranged) || null;
}

function homeUrl() {
  const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  return root + '#pollen-dream';
}

function onHome() {
  const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  return location.pathname === root || location.pathname === root.replace(/\/$/, '');
}

class Flight {
  constructor(opts) {
    this.opts = opts;
    this.state = 'loading';
    this.abort = new AbortController();
    this.keys = new Set();
    this.stick = { id: null, x: 0, y: 0 };
    this.drag = { id: null, x: 0, y: 0 };
    this.holds = { up: false, down: false, fast: false };
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    this.returnFocus = opts.returnFocus || document.activeElement;
    this.title = String(opts.title || STRINGS.title).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  /* ---------------- open & close ---------------- */

  async open() {
    let garden = splashGarden(this.opts.source);
    if (!garden && !growingGarden() && !onHome()) {
      // The world to fly in is the home page's garden.
      current = null;
      window.location.assign(homeUrl());
      return;
    }
    await this.loadCss();
    this.buildDom();
    document.documentElement.classList.add('pollen-dream-open');
    this.bindUi();
    this.show('loading');
    // Arriving on the home page, the flowers may still be growing into the logo.
    const until = performance.now() + 20000;
    while (!garden && !this.closed && growingGarden() && performance.now() < until) {
      await new Promise((r) => window.setTimeout(r, 250));
      garden = splashGarden();
    }
    if (this.closed) return;
    if (!garden || !garden.startFlight()) {
      this.showError();
      return;
    }
    this.garden = garden;
    this.bindInput();
    this.show('title');
    this.tick();
  }

  loadCss() {
    if (!this.opts.cssUrl || document.querySelector('link[data-pollen-dream-css]')) return Promise.resolve();
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = this.opts.cssUrl;
      link.dataset.pollenDreamCss = '';
      link.onload = link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.state = 'closed';
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    if (document.pointerLockElement === this.surface) document.exitPointerLock();
    if (this.garden) this.garden.stopFlight();
    if (this.root) this.root.remove();
    document.documentElement.classList.remove('pollen-dream-open');
    current = null;
    const back = this.returnFocus;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  /* ---------------- DOM ---------------- */

  buildDom() {
    const S = STRINGS;
    const root = document.createElement('div');
    root.className = 'pollen-dream';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'PollenDreamTitle');
    root.tabIndex = -1;
    const controls = this.touch
      ? `<li><b>Left thumb</b> fly forward and back, turn</li><li><b>Drag</b> anywhere to look around: you fly where you look</li><li><b>${S.up}</b> and <b>${S.down}</b> rise and sink · hold <b>${S.fast}</b> to speed up</li>`
      : `<li><b>Mouse</b> look around: you fly where you look</li><li><b>W S</b> or <b>↑ ↓</b> forward and back</li><li><b>A D</b> sideways · <b>← →</b> turn</li><li><b>Space</b> or <b>E</b> rise · <b>Q</b> or <b>C</b> sink</li><li><b>Shift</b> fast · <b>Esc</b> pause</li>`;
    root.innerHTML = `
      <div class="pollen-dream__surface" data-surface aria-hidden="true"></div>
      <div class="pollen-dream__hud" data-hud hidden>
        <button type="button" class="pollen-dream__chip" data-action="pause">${S.pause}</button>
        <button type="button" class="pollen-dream__chip" data-action="exit">${S.exit}</button>
      </div>
      <div class="pollen-dream__touch" data-touch hidden>
        <div class="pollen-dream__stick" data-stick aria-hidden="true"><span data-knob></span></div>
        <div class="pollen-dream__holds">
          <button type="button" class="pollen-dream__hold" data-hold="up">${S.up}</button>
          <button type="button" class="pollen-dream__hold" data-hold="fast">${S.fast}</button>
          <button type="button" class="pollen-dream__hold" data-hold="down">${S.down}</button>
        </div>
      </div>
      <section class="pollen-dream__screen" data-screen="loading" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <p class="pollen-dream__lead">${S.loading}</p>
      </section>
      <section class="pollen-dream__screen" data-screen="title" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <h2 class="pollen-dream__title" id="PollenDreamTitle">${this.title}</h2>
        <p>${S.intro}</p>
        <ul class="pollen-dream__controls">${controls}</ul>
        <div class="pollen-dream__actions">
          <button type="button" class="pollen-dream__button pollen-dream__button--primary" data-action="start">${S.start}</button>
          <button type="button" class="pollen-dream__button" data-action="exit">${S.exit}</button>
        </div>
      </section>
      <section class="pollen-dream__screen" data-screen="paused" hidden>
        <h2 class="pollen-dream__title">${S.paused}</h2>
        <ul class="pollen-dream__controls">${controls}</ul>
        <div class="pollen-dream__actions">
          <button type="button" class="pollen-dream__button pollen-dream__button--primary" data-action="resume">${S.resume}</button>
          <button type="button" class="pollen-dream__button" data-action="exit">${S.exit}</button>
        </div>
      </section>
      <section class="pollen-dream__screen" data-screen="error" hidden>
        <h2 class="pollen-dream__title">${S.failed}</h2>
        <p>${S.failedHelp}</p>
        <div class="pollen-dream__actions">
          <button type="button" class="pollen-dream__button pollen-dream__button--primary" data-action="exit">${S.exit}</button>
        </div>
      </section>`;
    document.body.appendChild(root);
    this.root = root;
    const q = (s) => root.querySelector(s);
    this.surface = q('[data-surface]');
    this.ui = { hud: q('[data-hud]'), touch: q('[data-touch]'), stick: q('[data-stick]'), knob: q('[data-knob]') };
  }

  show(state) {
    this.state = state;
    this.root.dataset.state = state;
    this.root.querySelectorAll('[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== state));
    const flying = state === 'fly';
    this.ui.hud.hidden = !flying;
    this.ui.touch.hidden = !(flying && this.touch);
    if (!flying) this.clearInput();
    this.focusScreen();
  }

  /* Focus goes to the first button of whatever screen is showing. */
  focusScreen() {
    const screen = this.root && this.root.querySelector(`[data-screen="${this.state}"]`);
    const target = screen && screen.querySelector('button');
    if (target) target.focus({ preventScroll: true });
    else if (this.root) this.root.focus({ preventScroll: true });
  }

  showError() {
    if (!this.root) return;
    this.show('error');
  }

  bindUi() {
    const on = { signal: this.abort.signal };
    this.root.addEventListener(
      'click',
      (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const act = b.dataset.action;
        if (act === 'start' || act === 'resume') this.fly();
        else if (act === 'pause') this.pause();
        else if (act === 'exit') this.close();
      },
      on
    );
    // Keyboard users stay inside the screens until they leave.
    this.root.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Tab') return;
        const items = Array.from(this.root.querySelectorAll('button')).filter((b) => b.offsetParent !== null);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        e.preventDefault();
        items[next].focus();
      },
      on
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (this.state === 'fly') this.pause();
        else if (this.state === 'paused') this.fly();
        else this.close();
      },
      { signal: this.abort.signal, capture: true }
    );
    window.addEventListener('pagehide', () => this.close(), on);
  }

  /* ---------------- input ---------------- */

  bindInput() {
    const on = { signal: this.abort.signal };
    const capture = { signal: this.abort.signal, capture: true };
    const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyC', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.state !== 'fly' || !KEYS.includes(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        this.keys.add(e.code);
      },
      capture
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), capture);
    window.addEventListener('blur', () => this.state === 'fly' && this.pause(), on);
    document.addEventListener('visibilitychange', () => document.hidden && this.state === 'fly' && this.pause(), on);

    // Mouse: captured after Fly, moving it looks around (Esc lets it go and pauses).
    // Where it can't be captured, dragging looks around instead.
    document.addEventListener(
      'pointerlockchange',
      () => {
        const locked = document.pointerLockElement === this.surface;
        if (!locked && this.locked && this.state === 'fly') this.pause();
        this.locked = locked;
        this.root.classList.toggle('is-locked', locked);
      },
      on
    );
    document.addEventListener(
      'mousemove',
      (e) => {
        if (this.state === 'fly' && this.locked) this.garden.flyLook(e.movementX * LOOK.mouse, e.movementY * LOOK.mouse);
      },
      on
    );
    const s = this.surface;
    s.addEventListener(
      'pointerdown',
      (e) => {
        if (this.state !== 'fly') return;
        if (e.pointerType === 'touch' && !this.touch) {
          this.touch = true;
          this.ui.touch.hidden = false;
        }
        if (e.pointerType === 'mouse' && !this.locked && this.lock()) return;
        if (this.drag.id !== null) return;
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, k: e.pointerType === 'mouse' ? LOOK.drag : LOOK.touch };
        try {
          s.setPointerCapture(e.pointerId);
        } catch (err) {
          /* best effort */
        }
      },
      on
    );
    s.addEventListener(
      'pointermove',
      (e) => {
        const d = this.drag;
        if (e.pointerId !== d.id) return;
        this.garden.flyLook((e.clientX - d.x) * d.k, (e.clientY - d.y) * d.k);
        d.x = e.clientX;
        d.y = e.clientY;
      },
      on
    );
    const endDrag = (e) => {
      if (e.pointerId === this.drag.id) this.drag.id = null;
    };
    s.addEventListener('pointerup', endDrag, on);
    s.addEventListener('pointercancel', endDrag, on);

    const stick = this.ui.stick;
    stick.addEventListener(
      'pointerdown',
      (e) => {
        if (this.stick.id !== null) return;
        const r = stick.getBoundingClientRect();
        this.stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, rad: r.width / 2, x: 0, y: 0 };
        stick.setPointerCapture(e.pointerId);
        this.moveStick(e);
      },
      on
    );
    stick.addEventListener('pointermove', (e) => this.moveStick(e), on);
    const endStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { id: null, x: 0, y: 0 };
      this.ui.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', endStick, on);
    stick.addEventListener('pointercancel', endStick, on);

    this.root.querySelectorAll('[data-hold]').forEach((b) => {
      const key = b.dataset.hold;
      const set = (v) => (e) => {
        e.preventDefault();
        this.holds[key] = v;
      };
      b.addEventListener('pointerdown', set(true), on);
      b.addEventListener('pointerup', set(false), on);
      b.addEventListener('pointercancel', set(false), on);
      b.addEventListener('pointerleave', set(false), on);
      b.addEventListener('contextmenu', (e) => e.preventDefault(), on);
    });
  }

  moveStick(e) {
    const s = this.stick;
    if (e.pointerId !== s.id) return;
    let dx = (e.clientX - s.cx) / s.rad;
    let dy = (e.clientY - s.cy) / s.rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    s.x = dx;
    s.y = dy;
    this.ui.knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
  }

  /* Captures the mouse for looking around. False where it can't be (touch, or the theme editor's frame). */
  lock() {
    if (this.touch || !this.surface.requestPointerLock) return false;
    try {
      const r = this.surface.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  clearInput() {
    this.keys.clear();
    Object.keys(this.holds).forEach((k) => (this.holds[k] = false));
    this.stick = { id: null, x: 0, y: 0 };
    this.drag.id = null;
    if (this.ui) this.ui.knob.style.transform = '';
    this.send();
  }

  /* What the controls say now, handed to the garden every frame. */
  send() {
    const F = this.garden && this.garden.flight;
    if (!F) return;
    const k = this.keys;
    const has = (...codes) => codes.some((c) => k.has(c));
    const on = this.state === 'fly';
    const st = this.stick;
    const dead = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    F.input.f = on ? (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) - dead(st.y) : 0;
    F.input.r = on ? (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0) : 0;
    F.input.turn = on ? (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) + dead(st.x) : 0;
    F.input.u = on ? (has('Space', 'KeyE') || this.holds.up ? 1 : 0) - (has('KeyQ', 'KeyC') || this.holds.down ? 1 : 0) : 0;
    F.input.fast = on && (has('ShiftLeft', 'ShiftRight') || this.holds.fast);
  }

  tick() {
    if (this.closed) return;
    this.send();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  /* ---------------- states ---------------- */

  fly() {
    this.show('fly');
    this.root.focus({ preventScroll: true });
    if (!this.touch) this.lock();
  }

  pause() {
    if (document.pointerLockElement === this.surface) document.exitPointerLock();
    this.show('paused');
  }
}
