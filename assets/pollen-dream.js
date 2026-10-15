/**
 * Pollen Dream
 *
 * A small first-person game inside the garden. The visitor is a tiny
 * pollinator in a garden grown from the splash's own flowers: the same
 * petal geometry, plastic materials, vertex-snapped "bad CGI" look, eyes
 * and growth animation, built through garden-splash.js's createBed().
 *
 * Fly into the light of the glowing flowers to gather their pollen. Every
 * flower pollinated wakes the closed buds around it, which bloom in a
 * ripple. Gather from all of them and the heart of the garden grows from a
 * seed falling out of the sky.
 *
 * When the page shows the flowers formed into the logo (opts.source), the
 * game is that very arrangement at insect scale: it opens on the same
 * overhead view as the page, dives down into the asterisk and begins there.
 *
 * Loaded only when a visitor opens it (snippets/pollen-dream-launcher.liquid).
 * While it runs, the page's own garden pauses ("duet:world-pause"), so only
 * one garden renders at a time. Closing it removes every listener, frees the
 * GPU resources and hands the page back as it was.
 */

const TAU = Math.PI * 2;
const WORLD_R = 1700; // flowers grow inside this radius
const BOUND = 2150; // the dream gently pushes back beyond this
const CEILING = 1150;
const HEART_CLEAR = 260; // the center is kept free for the heart of the garden
const DIVE = 3.6; // seconds from the overhead view of the logo down into its flowers
const CHAIN_R = 680; // buds this close to a pollinated flower wake up
const HARVEST_TIME = 0.9; // seconds in a flower's light to gather its pollen
const PLAYER_R = 10;
// Flight: the player always moves the way they look. Flapping is fast, gliding
// slow; climbing under their own power is weak and they slowly sink, so height
// comes from the rising gusts of wind.
const FLIGHT = { flap: 210, dash: 330, glide: 85, brake: 20, sink: 55, climb: 0.3, ease: 2.6 };
const TURN = { rate: 2.2, pitch: 1.3, ease: 10 };
const LOOK = { mouse: 0.003, touch: 0.007, steer: 2.4, smooth: 22 };
const UPDRAFT = { top: 760, lift: 400 };
const OCEAN = [25, 31, 107];
const POWDER = [185, 229, 251];
const POLLEN = [242, 168, 52];
const WIND = [102, 164, 200];
const WHITE = [255, 255, 255];

const STRINGS = {
  title: 'Pollen Dream',
  eyebrow: 'Duet',
  intro: 'You are very small, and the garden is very large. You can’t climb on your own: rising gusts of wind, the swirling blue columns, lift you, and you can rest on any open flower. Ride the wind from flower to flower to reach the glowing ones and gather their pollen. Every flower you pollinate wakes the sleeping buds around it.',
  start: 'Start',
  resume: 'Resume',
  restart: 'Restart',
  again: 'Play again',
  explore: 'Keep exploring',
  exit: 'Back to Duet',
  pause: 'Pause',
  sound: 'Sound',
  paused: 'Paused',
  loading: 'Growing the garden…',
  failed: 'The garden can’t grow in this browser.',
  failedHelp: 'Pollen Dream needs WebGL, which is turned off or unavailable here.',
  meter: 'Pollen',
  near: 'Fly into the glow',
  gathering: 'Gathering pollen…',
  heart: 'The heart of the garden is blooming',
  doneTitle: 'The garden is awake',
  fly: 'Fly',
  rising: 'Riding the wind',
  resting: 'Resting on a flower',
  carried: 'The wind carries you back to your last flower',
};

let current = null;

/* Opens the game, or brings the open one back into focus. */
export async function openPollenDream(opts) {
  if (current) {
    current.focusScreen();
    return current;
  }
  current = new PollenDream(opts || {});
  try {
    await current.open();
  } catch (e) {
    console.error('pollen-dream:', e);
    if (current) current.showError();
  }
  return current;
}

class PollenDream {
  constructor(opts) {
    this.opts = opts;
    this.state = 'loading';
    this.abort = new AbortController();
    this.keys = new Set();
    this.move = { f: 0, r: 0, u: 0, boost: false };
    this.stick = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
    this.lookDrag = { id: null, x: 0, y: 0 };
    this.holds = { fly: false };
    this.cursor = { x: 0, y: 0, active: false };
    this.sound = true;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    this.returnFocus = opts.returnFocus || document.activeElement;
    this.title = String(opts.title || STRINGS.title).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    this.disposables = [];
  }

  /* ---------------- open & close ---------------- */

  async open() {
    this.buildDom();
    window.dispatchEvent(new CustomEvent('duet:world-pause'));
    document.documentElement.classList.add('pollen-dream-open');
    this.bindUi();
    // Arriving from the logo, the page stays in view until the garden is ready to take over.
    const src = this.opts.source;
    if (src) this.root.classList.add('is-arriving');
    this.show('loading');

    const [garden] = await Promise.all([import(this.opts.gardenUrl), this.loadCss()]);
    if (this.closed) return;
    this.G = garden;
    this.THREE = garden.THREE;
    this.logo = src ? this.measureLogo(src) : null;
    this.bound = this.logo ? this.logo.bound : BOUND;
    this.setupRenderer();
    this.setupWorld();
    this.generate((Math.random() * 2 ** 31) | 0);
    this.bindInput();
    this.resize();
    if (this.logo) this.startDive();
    else this.show('title');
    this.loop();
  }

  /*
   * Where the page's logo arrangement sits and how big it becomes: its
   * flowers are scaled up so a typical one is about the size of the
   * insect-scale garden's flowers, centered on the world's origin.
   */
  measureLogo(src) {
    const rs = src.flowers.map((f) => f.r).sort((a, b) => a - b);
    const S = 72 / Math.max(1, rs[rs.length >> 1]);
    const box = src.logoBox || { x: 0, y: 0, w: src.w, h: src.h };
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const stars = src.flowers.filter((f) => f.star);
    const star = stars.length ? stars.reduce((a, f) => [a[0] + f.dest[0] / stars.length, a[1] + f.dest[1] / stars.length], [0, 0]) : [cx, cy];
    return {
      src,
      S,
      cx,
      cy,
      // The heart grows in the asterisk; the player arrives there too (bed coordinates: y down).
      star: [(star[0] - cx) * S, (star[1] - cy) * S],
      bound: (Math.max(box.w, box.h) / 2) * S + 900,
      view: { w: src.w, h: src.h, dist: src.camDist },
    };
  }

  /* The camera starts exactly where the page's camera looks down on the logo. */
  startDive() {
    const THREE = this.THREE;
    const L = this.logo;
    const S = L.S;
    const v = L.view;
    const p0 = new THREE.Vector3((v.w / 2 - L.cx) * S, (L.cy - v.h / 2) * S, v.dist * S + 200);
    const cam = new THREE.PerspectiveCamera();
    cam.up.set(0, 1, 0);
    cam.position.copy(p0);
    cam.lookAt(p0.x, p0.y, 0);
    const q0 = cam.quaternion.clone();
    this.placePlayer();
    const p1 = this.pos.clone();
    cam.up.set(0, 0, 1);
    cam.position.copy(p1);
    const cp = Math.cos(this.pitch);
    cam.lookAt(p1.x + cp * Math.cos(this.yaw), p1.y + cp * Math.sin(this.yaw), p1.z + Math.sin(this.pitch));
    this.dive = { t: this.reduced ? 1 : 0, p0, p1, q0, q1: cam.quaternion.clone() };
    this.root.classList.add('is-diving');
    this.show('dive');
  }

  /* Down from the overhead view into the asterisk, leveling out among the flowers. */
  updateDive(dt) {
    const THREE = this.THREE;
    const d = this.dive;
    d.t = Math.min(1, d.t + dt / DIVE);
    const t = d.t;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const level = this.G.smooth(this.G.range(t, 0.45, 1));
    const c = this.camera;
    c.position.lerpVectors(d.p0, d.p1, e);
    c.quaternion.slerpQuaternions(d.q0, d.q1, level);
    c.fov = this.G.lerp(50, 72, level);
    // The fog and the depth range follow the altitude, so the logo is clear from high up.
    const alt = Math.max(0, c.position.z);
    c.near = Math.max(1, alt * 0.004);
    c.far = Math.max(7000, alt * 3);
    c.updateProjectionMatrix();
    this.scene.fog.far = Math.max(2500, alt * 2.4);
    this.scene.fog.near = Math.min(320, this.scene.fog.far * 0.3);
    if (t >= 1) this.endDive();
  }

  endDive() {
    const c = this.camera;
    c.fov = 72;
    c.near = 1;
    c.far = 7000;
    c.updateProjectionMatrix();
    this.scene.fog.near = 320;
    this.scene.fog.far = 2500;
    this.dive = null;
    this.root.classList.remove('is-arriving', 'is-diving');
    // The garden falls asleep as the visitor arrives: the buds close.
    for (const f of this.bed.flowers) if (f.asleep) f.folding = true;
    this.show('title');
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
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.audio) this.audio.close().catch(() => {});
    this.dispose();
    this.root.remove();
    document.documentElement.classList.remove('pollen-dream-open');
    window.dispatchEvent(new CustomEvent('duet:world-resume'));
    current = null;
    const back = this.returnFocus;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  /* Frees everything the game put on the GPU. The page's own garden is untouched. */
  dispose() {
    const bed = this.bed;
    if (bed) {
      bed.clearMeshes();
      Object.values(bed.geometries).forEach((g) => g.dispose());
      Object.values(bed.materials).forEach((m) => m.dispose());
      bed.eyeTextures.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
    this.clearPollen();
    this.clearUpdrafts();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
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
      ? `<li><b>Left thumb</b> steer: you fly where you look</li><li><b>Hold ${S.fly}</b> to flap forward</li><li><b>Drag</b> anywhere to look around</li>`
      : `<li><b>Mouse</b> look: you fly where you look</li><li><b>W</b> or <b>Space</b> flap forward · <b>S</b> slow down</li><li><b>A D</b> or <b>← →</b> turn · <b>↑ ↓</b> look up and down</li><li><b>Shift</b> dash</li><li><b>Esc</b> pause · <b>Esc</b> again to leave</li>`;
    root.innerHTML = `
      <canvas class="pollen-dream__canvas" aria-hidden="true"></canvas>
      <div class="pollen-dream__hud" data-hud hidden>
        <div class="pollen-dream__meter">
          <span>${S.meter}</span>
          <span class="pollen-dream__bar"><span data-fill></span></span>
          <span data-count>0 / 0</span>
        </div>
        <div class="pollen-dream__hud-buttons">
          <button type="button" class="pollen-dream__chip" data-action="sound" aria-pressed="true">${S.sound}</button>
          <button type="button" class="pollen-dream__chip" data-action="pause">${S.pause}</button>
        </div>
        <div class="pollen-dream__compass" data-compass aria-hidden="true"><span></span></div>
        <div class="pollen-dream__reticle" data-reticle aria-hidden="true"></div>
        <p class="pollen-dream__prompt" data-prompt></p>
      </div>
      <div class="pollen-dream__touch" data-touch hidden>
        <div class="pollen-dream__stick" data-stick aria-hidden="true"><span data-knob></span></div>
        <div class="pollen-dream__holds">
          <button type="button" class="pollen-dream__hold" data-hold="fly">${S.fly}</button>
        </div>
      </div>
      <p class="pollen-dream__sr" role="status" aria-live="polite" data-announce></p>
      <section class="pollen-dream__screen" data-screen="loading" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <p class="pollen-dream__lead">${S.loading}</p>
      </section>
      <section class="pollen-dream__screen" data-screen="title" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <h2 class="pollen-dream__title" id="PollenDreamTitle">${this.title}</h2>
        <p>${S.intro}</p>
        <p class="pollen-dream__goal" data-goal></p>
        <ul class="pollen-dream__controls">${controls}</ul>
        <div class="pollen-dream__actions">
          <button type="button" class="pollen-dream__button pollen-dream__button--primary" data-action="start">${S.start}</button>
          <button type="button" class="pollen-dream__button" data-action="exit">${S.exit}</button>
        </div>
      </section>
      <section class="pollen-dream__screen" data-screen="paused" hidden>
        <h2 class="pollen-dream__title">${S.paused}</h2>
        <p data-progress></p>
        <div class="pollen-dream__actions">
          <button type="button" class="pollen-dream__button pollen-dream__button--primary" data-action="resume">${S.resume}</button>
          <button type="button" class="pollen-dream__button" data-action="restart">${S.restart}</button>
          <button type="button" class="pollen-dream__button" data-action="exit">${S.exit}</button>
        </div>
      </section>
      <section class="pollen-dream__screen" data-screen="done" hidden>
        <p class="pollen-dream__eyebrow">${this.title}</p>
        <h2 class="pollen-dream__title">${S.doneTitle}</h2>
        <p data-result></p>
        <div class="pollen-dream__actions">
          <button type="button" class="pollen-dream__button pollen-dream__button--primary" data-action="explore">${S.explore}</button>
          <button type="button" class="pollen-dream__button" data-action="restart">${S.again}</button>
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
    this.canvas = q('.pollen-dream__canvas');
    this.ui = {
      hud: q('[data-hud]'),
      fill: q('[data-fill]'),
      count: q('[data-count]'),
      compass: q('[data-compass]'),
      reticle: q('[data-reticle]'),
      prompt: q('[data-prompt]'),
      touch: q('[data-touch]'),
      stick: q('[data-stick]'),
      knob: q('[data-knob]'),
      announce: q('[data-announce]'),
      goal: q('[data-goal]'),
      progress: q('[data-progress]'),
      result: q('[data-result]'),
      sound: q('[data-action="sound"]'),
    };
  }

  show(state) {
    this.state = state;
    this.root.dataset.state = state;
    this.root.querySelectorAll('[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== state));
    const playing = state === 'play';
    this.ui.hud.hidden = !(playing || state === 'done');
    this.ui.touch.hidden = !(playing && this.touch);
    if (!playing) this.clearInput();
    this.focusScreen();
  }

  /* Focus goes to the first button of whatever screen is showing. */
  focusScreen() {
    const screen = this.root.querySelector(`[data-screen="${this.state}"]`);
    const target = screen && screen.querySelector('button');
    if (target) target.focus({ preventScroll: true });
    else this.root.focus({ preventScroll: true });
  }

  announce(text) {
    this.ui.announce.textContent = text;
  }

  showError() {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
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
        if (act === 'start' || act === 'resume' || act === 'explore') this.play();
        else if (act === 'pause') this.pause();
        else if (act === 'restart') this.restart();
        else if (act === 'exit') this.close();
        else if (act === 'sound') {
          this.sound = !this.sound;
          b.setAttribute('aria-pressed', String(this.sound));
        }
      },
      on
    );
    // Keyboard users stay inside the game's screens until they leave it.
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
    window.addEventListener('pagehide', () => this.close(), on);
  }

  /* ---------------- input ---------------- */

  bindInput() {
    const on = { signal: this.abort.signal };
    const capture = { signal: this.abort.signal, capture: true };
    const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.dive) {
          e.stopPropagation();
          this.dive.t = 1;
          return;
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (this.state === 'play') this.pause();
          else if (this.state === 'done') this.play();
          else this.close();
          return;
        }
        if (this.state !== 'play') return;
        if (e.code === 'KeyP') {
          this.pause();
          return;
        }
        if (KEYS.includes(e.code)) {
          e.preventDefault();
          e.stopPropagation();
          this.keys.add(e.code);
        }
      },
      capture
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), capture);
    window.addEventListener('blur', () => this.state === 'play' && this.pause(), on);
    document.addEventListener('visibilitychange', () => document.hidden && this.state === 'play' && this.pause(), on);
    window.addEventListener('resize', () => this.resize(), on);

    // Mouse: with the pointer captured (after Start) moving it looks around;
    // where it can't be captured, the cursor's distance from the center of
    // the screen steers instead, like a flight stick. No dragging needed.
    document.addEventListener(
      'pointerlockchange',
      () => {
        const locked = document.pointerLockElement === this.canvas;
        if (!locked && this.locked && this.state === 'play') this.pause();
        this.locked = locked;
        this.root.classList.toggle('is-locked', locked);
      },
      on
    );
    document.addEventListener(
      'mousemove',
      (e) => {
        if (this.state !== 'play') return;
        if (this.locked) {
          this.turn(e.movementX * LOOK.mouse, e.movementY * LOOK.mouse);
        } else {
          this.cursor.x = (e.clientX / window.innerWidth) * 2 - 1;
          this.cursor.y = (e.clientY / window.innerHeight) * 2 - 1;
          this.cursor.active = e.target === this.canvas;
        }
      },
      on
    );

    // Touch: a steering stick on the left, a Fly button on the right, and dragging anywhere else looks around.
    const c = this.canvas;
    c.addEventListener(
      'pointerdown',
      (e) => {
        if (this.state !== 'play') return;
        if (e.pointerType === 'touch' && !this.touch) {
          this.touch = true;
          this.ui.touch.hidden = false;
        }
        if (e.pointerType === 'mouse') {
          if (!this.locked) this.requestLock();
          return;
        }
        if (this.lookDrag.id !== null) return;
        this.lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try {
          c.setPointerCapture(e.pointerId);
        } catch (err) {
          /* best effort */
        }
      },
      on
    );
    c.addEventListener(
      'pointermove',
      (e) => {
        const d = this.lookDrag;
        if (e.pointerId !== d.id) return;
        this.turn((e.clientX - d.x) * LOOK.touch, (e.clientY - d.y) * LOOK.touch);
        d.x = e.clientX;
        d.y = e.clientY;
      },
      on
    );
    const endLook = (e) => {
      if (e.pointerId === this.lookDrag.id) this.lookDrag.id = null;
    };
    c.addEventListener('pointerup', endLook, on);
    c.addEventListener('pointercancel', endLook, on);
    c.addEventListener('mouseleave', () => (this.cursor.active = false), on);

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

  requestLock() {
    // Without a lock (refused, or in the theme editor's frame) the cursor steers instead.
    if (this.touch || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) {
      /* steering still works */
    }
  }

  clearInput() {
    this.keys.clear();
    this.holds.fly = false;
    this.cursor.active = false;
    this.stick = { id: null, x: 0, y: 0 };
    this.lookDrag.id = null;
    this.turnVel = 0;
    if (this.ui) this.ui.knob.style.transform = '';
  }

  /* Look input moves where the view is heading; the view follows it smoothly (see steer()). */
  turn(dx, dy) {
    this.aimYaw -= dx;
    this.aimPitch = Math.max(-1.3, Math.min(1.3, this.aimPitch - dy));
  }

  /*
   * Turning and looking: keys and the stick turn at a steady rate that eases
   * in and out, the free cursor steers from the screen's center, and the view
   * glides to where the input points, so it feels quick but never jerky.
   */
  steer(dt) {
    const k = this.keys;
    const s = this.stick;
    let yawIn = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - s.x;
    let pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0) - s.y;
    if (this.cursor.active && !this.locked && !this.touch) {
      const dead = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      yawIn -= dead(this.cursor.x) * Math.abs(dead(this.cursor.x)) * (LOOK.steer / TURN.rate);
      this.aimPitch = this.G.lerp(this.aimPitch, -this.cursor.y * 1.1, 1 - Math.exp(-dt * 4));
    }
    this.turnVel = this.G.lerp(this.turnVel || 0, yawIn * TURN.rate, 1 - Math.exp(-dt * TURN.ease));
    this.aimYaw += this.turnVel * dt;
    this.aimPitch = Math.max(-1.3, Math.min(1.3, this.aimPitch + pitchIn * TURN.pitch * dt));
    const f = 1 - Math.exp(-dt * LOOK.smooth);
    this.yaw += (this.aimYaw - this.yaw) * f;
    this.pitch += (this.aimPitch - this.pitch) * f;
  }

  /* ---------------- game states ---------------- */

  play() {
    if (this.state === 'title') {
      if (!this.logo) this.placePlayer();
      this.startedAt = this.time;
    }
    this.ensureAudio();
    this.show('play');
    this.root.focus({ preventScroll: true });
    if (!this.touch) this.requestLock();
    this.loop();
  }

  pause() {
    if (this.state !== 'play') return;
    this.ui.progress.textContent = this.progressText();
    this.show('paused');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  restart() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.generate((Math.random() * 2 ** 31) | 0);
    this.placePlayer();
    this.state = 'title';
    this.play();
  }

  progressText() {
    return `${this.count} of ${this.total} flowers pollinated · ${this.clock(this.playTime)}`;
  }

  clock(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  /* ---------------- rendering setup ---------------- */

  setupRenderer() {
    const THREE = this.THREE;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
      throw new Error('WebGL unavailable');
    }
    this.canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        if (!this.closed) this.showError();
      },
      { signal: this.abort.signal }
    );
  }

  /* The garden's own scene, materials and geometry, set at insect scale under a dusk sky. */
  setupWorld() {
    const THREE = this.THREE;
    const G = this.G;
    // The colors of the garden the visitor came from, with any color scheme they picked.
    const live = this.logo && this.logo.src;
    const src = live || document.querySelector('garden-splash') || { dataset: {} };
    let palette = [];
    try {
      palette = live ? src.palette : JSON.parse(src.dataset.palette || '[]');
    } catch (e) {
      palette = [];
    }
    const bed = G.createBed({
      palette,
      foliage: live ? src.foliage : src.dataset.foliageColor,
      center: live ? src.heroColor : src.dataset.centerColor,
      accent: live ? src.heroAccent : src.dataset.centerAccent,
      // The same ground color as the page, so the light on the flowers matches too.
      soil: live ? src.soil : WHITE,
      reduced: this.reduced,
      camDist: 1500,
    });
    // Every part of the world is looked at by a bee, so the eyes follow the camera.
    bed.lookTarget = (out) => out.copy(this.camera.position);
    this.bed = bed;
    const scene = bed.scene;
    this.scene = scene;

    // All white, like the page the garden lives on: only the flowers have color.
    this.horizon = WHITE;
    scene.fog = new THREE.Fog(G.toColor(WHITE), 320, 2500);
    scene.background = G.toColor(WHITE);

    this.camera = new THREE.PerspectiveCamera(72, 1, 1, 7000);
    this.camera.up.set(0, 0, 1);
    this.sky = new THREE.Object3D();

    // The ground is white too; a soft shadow under the player shows how high they are.
    const rng = G.mulberry32(7);
    const size = this.bound * 3;
    const groundGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    groundGeo.translate(0, 0, G.FLOOR_Z - 6);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    scene.add(new THREE.Mesh(groundGeo, groundMat));
    this.disposables.push(groundGeo, groundMat);
    const shadowGeo = new THREE.CircleGeometry(16, 20);
    const shadowMat = new THREE.MeshBasicMaterial({ color: G.toColor(OCEAN), transparent: true, opacity: 0.18, depthWrite: false });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    scene.add(this.shadow);
    this.disposables.push(shadowGeo, shadowMat);

    // Grass: the bed's own leaf petal, standing up, giant at this scale.
    const blades = Math.round((this.touch ? 170 : 300) * Math.min(2, this.bound / BOUND));
    const grass = new THREE.InstancedMesh(bed.geometries.leaf, bed.materials.foliage, blades);
    const d = new THREE.Object3D();
    d.rotation.order = 'ZYX';
    const col = new THREE.Color();
    for (let i = 0; i < blades; i++) {
      const a = rng() * TAU;
      const rad = Math.sqrt(rng()) * this.bound * 1.1;
      d.position.set(Math.cos(a) * rad, Math.sin(a) * rad, G.FLOOR_Z - 4);
      d.rotation.set(0, -G.lerp(1.05, 1.45, rng()), rng() * TAU);
      const len = G.lerp(50, 150, rng());
      d.scale.set(len, len * 0.32, len * 0.32);
      d.updateMatrix();
      grass.setMatrixAt(i, d.matrix);
      grass.setColorAt(i, col.copy(G.toColor(G.tone(bed.foliage, G.lerp(-0.35, 0.15, rng())))));
    }
    scene.add(grass);
    this.disposables.push(grass);

    // A soft round glow, for the pollen, its halos and the dust in the air.
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    const g = glow.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(glow);
    this.disposables.push(this.glowTex);

    // Specks of pollen drifting in the air.
    const motes = this.touch ? 140 : 260;
    const mp = new Float32Array(motes * 3);
    for (let i = 0; i < motes; i++) {
      const a = rng() * TAU;
      const rad = Math.sqrt(rng()) * this.bound;
      mp.set([Math.cos(a) * rad, Math.sin(a) * rad, G.lerp(G.FLOOR_Z, 700, rng())], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const dustMat = new THREE.PointsMaterial({ size: 4, map: this.glowTex, color: G.toColor(G.mix(WIND, WHITE, 0.3)), transparent: true, opacity: 0.45, depthWrite: false });
    this.dust = new THREE.Points(dustGeo, dustMat);
    scene.add(this.dust);
    this.disposables.push(dustGeo, dustMat);

    // A burst of pollen flies to the player on every gather.
    const BURST = 60;
    const bp = new Float32Array(BURST * 3);
    const burstGeo = new THREE.BufferGeometry();
    burstGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    const burstMat = new THREE.PointsMaterial({ size: 9, map: this.glowTex, color: G.toColor(POLLEN), transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.burst = { points: new THREE.Points(burstGeo, burstMat), vel: new Float32Array(BURST * 3), age: 1 };
    this.burst.points.frustumCulled = false;
    scene.add(this.burst.points);
    this.disposables.push(burstGeo, burstMat);

    this.time = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.face(0, 0);
  }

  /* ---------------- the garden ---------------- */

  /*
   * Plants the garden: flowers spread evenly over a wide disc, some already
   * open, most still closed buds. A handful glow with pollen: the objective.
   */
  generate(seed) {
    const G = this.G;
    const bed = this.bed;
    const rng = G.mulberry32(seed);
    this.clearPollen();
    if (this.heart) this.heart = null;

    bed.elapsed = 0;
    if (this.logo) this.plantLogo(rng);
    else this.plantField(rng);
    this.heartAt = this.logo ? this.logo.star : [0, 0];

    // The glowing flowers are spread far apart (farthest-point picking).
    const total = Math.min(this.touch ? 7 : 9, bed.flowers.length);
    const chosen = [bed.flowers[Math.floor(rng() * bed.flowers.length)]];
    while (chosen.length < total) {
      let best = null;
      let bestD = -1;
      for (const f of bed.flowers) {
        if (chosen.includes(f)) continue;
        const d = Math.min(...chosen.map((c) => Math.hypot(c.x - f.x, c.y - f.y)));
        if (d > bestD) {
          bestD = d;
          best = f;
        }
      }
      chosen.push(best);
    }
    for (const f of bed.flowers) {
      f.pollen = chosen.includes(f);
      f.harvest = 0;
      // Glowing flowers and about a third of the rest stay open; the others sleep as buds.
      // In the logo they close once the visitor has arrived (endDive).
      if (!f.pollen && rng() > 0.34) {
        f.asleep = true;
        if (!this.logo) f.p = 0.57;
        else if (this.state !== 'loading') f.folding = true;
      }
    }
    // The logo's flowers keep the eyes they had on the page.
    if (!this.logo) bed.assignEyes(rng);
    bed.buildMeshes();
    this.buildPollen(chosen);
    this.buildUpdrafts(rng, chosen);

    this.total = total;
    this.count = 0;
    this.playTime = 0;
    this.complete = false;
    this.ui.goal.textContent = `Gather pollen from all ${total} glowing flowers.`;
    this.updateMeter();
  }

  /* The page's logo arrangement, flower for flower, at insect scale. */
  plantLogo(rng) {
    const G = this.G;
    const L = this.logo;
    const bed = this.bed;
    bed.flowers = L.src.flowers.map((s, i) => {
      const x = (s.dest[0] - L.cx) * L.S;
      const y = (s.dest[1] - L.cy) * L.S;
      // Taller than on the page, so there is height to glide down from.
      const z = 80 + G.clamp((s.z + 25) / 55, 0, 1) * 380;
      const f = bed.makeFlower(x, y, z, s.r * L.S, rng, { id: i + 1, startAt: 0, dur: 1, grow: 1, star: s.star });
      f.species = s.species;
      f.colorIndex = s.colorIndex;
      f.rot = s.rot0 === undefined ? s.rot : s.rot0;
      f.partSeed = s.partSeed;
      if (s.eye) f.eye = { iris: s.eye.iris, roll: s.eye.roll, look: new this.THREE.Vector3(), nextBlink: 2 + rng() * 8, blinkAt: -1, delay: s.eye.delay };
      bed.sequence(f);
      f.home = [x, y];
      f.dest = [x, y];
      f.lift = 0;
      f.rot0 = f.rot;
      f.phase = rng() * TAU;
      f.p = 1;
      return f;
    });
  }

  /* Without a logo on the page: flowers spread evenly over a wide disc. */
  plantField(rng) {
    const G = this.G;
    const bed = this.bed;
    const want = this.touch ? 46 : 68;
    let pts = G.poissonDisc(-WORLD_R, -WORLD_R, WORLD_R, WORLD_R, 245, rng, [rng() * 200, WORLD_R * 0.6]).filter(
      ([x, y]) => Math.hypot(x, y) < WORLD_R && Math.hypot(x, y) > HEART_CLEAR
    );
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    pts = pts.slice(0, want);

    bed.flowers = pts.map(([x, y], i) => {
      const r = G.lerp(48, 124, rng());
      const z = G.lerp(60, 400, Math.pow(rng(), 1.4));
      const f = bed.makeFlower(x, -y, z, r, rng, { id: i + 1, startAt: 0, dur: 1, grow: 1 });
      f.home = [x, -y];
      f.dest = [x, -y];
      f.lift = 0;
      f.rot0 = f.rot;
      f.phase = rng() * TAU;
      f.p = 1;
      return f;
    });
  }

  /* Each glowing flower: a halo you can see from far away, and a swirl of pollen grains over it. */
  buildPollen(flowers) {
    const THREE = this.THREE;
    const G = this.G;
    this.pollen = flowers.map((f, k) => {
      const n = 34;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ size: 8, map: this.glowTex, color: G.toColor(POLLEN), transparent: true, depthWrite: false, fog: false });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      const haloMat = new THREE.SpriteMaterial({ map: this.glowTex, color: G.toColor(G.mix(POLLEN, f.color, 0.25)), transparent: true, opacity: 0.5, depthWrite: false, fog: false });
      const halo = new THREE.Sprite(haloMat);
      this.scene.add(points, halo);
      const grains = [];
      for (let i = 0; i < n; i++) grains.push({ a: (i / n) * TAU * 3, rad: f.r * (0.15 + 0.5 * ((i * 37) % n) / n), h: (i % 7) * 0.12, s: 0.5 + ((i * 13) % 10) / 10 });
      return { f, points, halo, grains, fade: 1, k };
    });
  }

  /*
   * Rising gusts: one near each glowing flower and more spread through the
   * garden, never right under a flower head. Each is drawn as a swirl of
   * specks rising faster as it surges, and a ring on the ground.
   */
  buildUpdrafts(rng, glowing) {
    const THREE = this.THREE;
    const G = this.G;
    this.clearUpdrafts();
    const flowers = this.bed.flowers;
    const free = (x, y, rad) => flowers.every((f) => Math.hypot(f.x - x, -f.y - y) > rad * 0.7 + f.r * 0.9);
    const list = [];
    const add = (x, y) => {
      const rad = G.lerp(95, 140, rng());
      if (Math.hypot(x, y) > this.bound - 200 || !free(x, y, rad)) return false;
      if (list.some((u) => Math.hypot(u.x - x, u.y - y) < u.rad + rad + 80)) return false;
      list.push({ x, y, rad, top: G.lerp(620, 900, rng()), power: G.lerp(0.85, 1.15, rng()), period: G.lerp(5, 9, rng()), phase: rng() * TAU, rise: rng() * 1000 });
      return true;
    };
    for (const f of glowing) {
      for (let k = 0; k < 12; k++) {
        const a = rng() * TAU;
        const d = f.r * G.lerp(1.5, 2.6, rng()) + 70;
        if (add(f.x + Math.cos(a) * d, -f.y + Math.sin(a) * d)) break;
      }
    }
    const reach = this.bound - 250;
    const field = G.poissonDisc(-reach, -reach, reach, reach, 620, rng, [0, 0]);
    for (const [x, y] of field) {
      if (list.length >= 44) break;
      add(x, y);
    }
    this.updrafts = list;

    const per = 18;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * per * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 7, map: this.glowTex, color: G.toColor(WIND), transparent: true, opacity: 0.7, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    const ringGeo = new THREE.RingGeometry(0.82, 1, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: G.toColor(WIND), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, Math.max(1, list.length));
    const d = new THREE.Object3D();
    list.forEach((u, i) => {
      d.position.set(u.x, u.y, G.FLOOR_Z - 4);
      d.scale.setScalar(u.rad);
      d.updateMatrix();
      rings.setMatrixAt(i, d.matrix);
    });
    rings.count = list.length;
    this.scene.add(points, rings);
    this.wind = { points, rings, per };
  }

  clearUpdrafts() {
    if (!this.wind) return;
    const w = this.wind;
    this.scene.remove(w.points, w.rings);
    w.points.geometry.dispose();
    w.points.material.dispose();
    w.rings.geometry.dispose();
    w.rings.material.dispose();
    w.rings.dispose();
    this.wind = null;
    this.updrafts = [];
  }

  updateWind(dt) {
    const w = this.wind;
    if (!w) return;
    const pos = w.points.geometry.attributes.position;
    const floor = this.G.FLOOR_Z;
    let i = 0;
    for (const u of this.updrafts) {
      const g = this.gust(u);
      u.rise += dt * (70 + 260 * g);
      const h = u.top - floor;
      for (let k = 0; k < w.per; k++) {
        const z = floor + ((u.rise + (k * h) / w.per) % h);
        const a = u.phase + k * 2.39996 + (z / h) * 3 + this.time * 0.8;
        const r = u.rad * (0.25 + 0.55 * (((k * 7) % w.per) / w.per));
        pos.setXYZ(i++, u.x + Math.cos(a) * r, u.y + Math.sin(a) * r, z);
      }
    }
    pos.needsUpdate = true;
  }

  clearPollen() {
    if (!this.pollen) return;
    for (const p of this.pollen) {
      this.scene.remove(p.points, p.halo);
      p.points.geometry.dispose();
      p.points.material.dispose();
      p.halo.material.dispose();
    }
    this.pollen = null;
  }

  /* Sets where the player looks, at once (no easing). */
  face(yaw, pitch) {
    this.yaw = this.aimYaw = yaw;
    this.pitch = this.aimPitch = pitch;
    this.turnVel = 0;
  }

  /*
   * The player starts resting on a flower: in the logo, the tallest one in
   * the asterisk; elsewhere, one at the edge of the garden. They face the
   * nearest glowing flower.
   */
  placePlayer() {
    this.vel.set(0, 0, 0);
    this.carry = null;
    const flowers = this.bed.flowers.filter((f) => !f.heart);
    let start;
    if (this.logo) {
      const [sx, sy] = this.logo.star;
      const near = flowers.filter((f) => f.star && Math.hypot(f.x - sx, f.y - sy) < 900);
      start = (near.length ? near : flowers).reduce((a, f) => (f.z > a.z ? f : a));
    } else {
      start = flowers.reduce((a, f) => (Math.hypot(f.x, f.y + WORLD_R) < Math.hypot(a.x, a.y + WORLD_R) ? f : a));
    }
    if (start.p < 1) start.p = 1;
    start.asleep = false;
    start.folding = false;
    this.perch = start;
    this.pos.copy(this.perchSpot(start));
    const target = (this.pollen || []).map((p) => p.f).filter((f) => f !== start && !f.pollinated).reduce((a, f) => (!a || Math.hypot(f.x - start.x, f.y - start.y) < Math.hypot(a.x - start.x, a.y - start.y) ? f : a), null);
    this.face(target ? Math.atan2(-target.y + start.y, target.x - start.x) : Math.PI / 2, -0.15);
  }

  /* Where the player sits on top of a flower. */
  perchSpot(f) {
    return this.tmp2.set(f.x, -f.y, f.z + f.lift + f.r * 0.12 + f.r * 0.5 * f.g + PLAYER_R + 2);
  }

  /* ---------------- loop ---------------- */

  loop() {
    if (this.raf || this.closed) return;
    this.last = performance.now();
    const frame = (now) => {
      this.raf = 0;
      if (this.closed || this.state === 'paused' || this.state === 'error') return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      try {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
      } catch (e) {
        console.error('pollen-dream:', e);
        this.showError();
        return;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  resize() {
    if (!this.renderer) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Drawn small and scaled up with hard pixels, like the splash.
    const rs = W < 750 ? 0.8 : 0.6;
    this.renderer.setPixelRatio(rs);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    // Finer vertex snapping than the splash: the wobble stays, without the seasickness.
    // With reduced motion the grid is too fine to see.
    if (this.reduced) this.bed.snap.value.set(4096, 4096);
    else this.bed.snap.value.set(W * rs * 0.5, H * rs * 0.5);
  }

  update(dt) {
    const G = this.G;
    const bed = this.bed;
    this.time += dt;
    bed.elapsed = this.time;
    const t = this.time;

    if (this.state === 'play') {
      this.playTime += dt;
      this.fly(dt);
    } else if ((this.state === 'title' || this.state === 'loading') && !this.logo) {
      // A slow drift around the garden behind the title.
      const a = t * 0.05 - Math.PI / 2;
      this.pos.set(Math.cos(a) * 1250, Math.sin(a) * 1250, 260);
      this.face(a + Math.PI, -0.12);
    }

    // Look direction (z is up).
    const cp = Math.cos(this.pitch);
    this.fwd.set(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch));
    if (this.dive) {
      this.updateDive(dt);
    } else {
      const bob = this.state === 'play' && !this.reduced ? Math.sin(t * 9) * 0.8 : 0;
      this.camera.position.set(this.pos.x, this.pos.y, this.pos.z + bob);
      this.camera.lookAt(this.tmp.copy(this.camera.position).add(this.fwd));
    }
    this.sky.position.copy(this.camera.position);

    // Flowers near the player sway a little; buds close as the visitor arrives
    // and bloom again when woken, with the garden's own growth animation.
    // Only flowers that move are re-placed, so a logo of hundreds stays cheap.
    const sway = this.reduced || this.dive ? 0 : 1;
    const px = this.camera.position.x;
    const py = this.camera.position.y;
    for (const f of bed.flowers) {
      if (f.bloomAt !== undefined && t >= f.bloomAt && f.p < 1) {
        f.folding = false;
        f.p = Math.min(1, f.p + dt / (f.heart ? 7 : 1.8));
      } else if (f.folding && f.p > 0.57) {
        f.p = Math.max(0.57, f.p - dt / 1.4);
      }
      const near = sway && (f.x - px) ** 2 + (-f.y - py) ** 2 < 900 * 900;
      if (near) {
        f.rot = f.rot0 + Math.sin(t * 0.7 + f.phase) * 0.06;
        f.lift = Math.sin(t * 0.9 + f.phase) * 5;
      }
      if (near || f.p !== f.shown) {
        bed.shape(f);
        f.shown = f.p;
      }
    }
    bed.updateEyes(dt);

    this.updatePollen(dt);
    this.updateWind(dt);
    this.shadow.position.set(this.pos.x, this.pos.y, this.G.FLOOR_Z - 5);
    const height = Math.max(0, this.pos.z - this.G.FLOOR_Z);
    this.shadow.scale.setScalar(1 + height / 500);
    this.shadow.material.opacity = 0.22 / (1 + height / 300);
    this.shadow.visible = !this.dive;
    this.updateBurst(dt);
    this.updateDust(dt);
    if (this.state === 'play' || this.state === 'done') this.updateHud();

    // The heart flower finished blooming: the dream is complete.
    if (this.heart && !this.complete && this.heart.p >= 1) {
      this.complete = true;
      this.chord();
      this.ui.result.textContent = `You pollinated all ${this.total} flowers in ${this.clock(this.playTime)}, and the heart of the garden opened its eye.`;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.show('done');
    }
  }

  /* Flight: accelerate toward where you look, glide to a stop, never through a flower. */
  /*
   * Flight. The player moves the way they look: flapping (W, Space, Fly)
   * fast, otherwise gliding slowly, always sinking a little. Their own climb
   * is weak, so height comes from the rising gusts. They can land and rest on
   * any open flower; drifting down to the ground, the wind carries them back
   * to the last flower they rested on.
   */
  fly(dt) {
    const G = this.G;
    if (this.carry) {
      this.updateCarry(dt);
      return;
    }
    this.steer(dt);
    const k = this.keys;
    const flap = k.has('KeyW') || k.has('Space') || this.holds.fly;
    const dash = flap && (k.has('ShiftLeft') || k.has('ShiftRight'));
    const brake = k.has('KeyS');
    const resting = this.resting && !flap;
    const speed = resting ? 0 : dash ? FLIGHT.dash : flap ? FLIGHT.flap : brake ? FLIGHT.brake : FLIGHT.glide;

    const want = this.tmp.copy(this.fwd).multiplyScalar(speed);
    if (want.z > 0) want.z *= FLIGHT.climb;
    want.z -= FLIGHT.sink;
    this.lift = this.updraftAt(this.pos);
    want.z += this.lift;
    this.vel.lerp(want, 1 - Math.exp(-dt * FLIGHT.ease));
    this.pos.addScaledVector(this.vel, dt);

    // The sky and the edge of the dream push back gently.
    if (this.pos.z > CEILING) {
      this.pos.z = CEILING;
      this.vel.z = Math.min(0, this.vel.z);
    }
    const out = Math.hypot(this.pos.x, this.pos.y) - this.bound;
    if (out > 0) {
      const a = Math.atan2(this.pos.y, this.pos.x);
      this.vel.x -= Math.cos(a) * out * 6 * dt;
      this.vel.y -= Math.sin(a) * out * 6 * dt;
    }

    // Stems and flower heads are solid; the player slides around them and can land on top.
    this.resting = false;
    for (const fl of this.bed.flowers) {
      const X = fl.x;
      const Y = -fl.y;
      const headZ = fl.z + fl.lift;
      const dx = this.pos.x - X;
      const dy = this.pos.y - Y;
      const dxy = Math.hypot(dx, dy) || 1e-3;
      if (this.pos.z < headZ - fl.r * 0.2) {
        const stem = Math.max(1.5, fl.r * 0.05) + PLAYER_R;
        if (dxy < stem) {
          this.pos.x = X + (dx / dxy) * stem;
          this.pos.y = Y + (dy / dxy) * stem;
        }
      }
      // A head is a flat disc of petals (a closed bud a narrower one): the
      // player is pushed out the shorter way, over or under it, or around its rim.
      if (fl.p < 0.5) continue;
      const rim = fl.r * (fl.p < 0.75 ? 0.45 : 0.95) * fl.g + PLAYER_R;
      // Thick enough that a player resting on top sits above the cupped petals, with a view.
      const half = fl.r * 0.5 * fl.g + PLAYER_R;
      const dz = this.pos.z - (headZ + fl.r * 0.12);
      if (dxy < rim && Math.abs(dz) < half) {
        const vertical = half - Math.abs(dz);
        const radial = rim - dxy;
        if (vertical < radial) {
          this.pos.z += Math.sign(dz || 1) * vertical;
          if (this.vel.z * Math.sign(dz || 1) < 0) this.vel.z = 0;
          if (dz > 0) {
            // Landed on top: rest here, and remember it.
            this.resting = true;
            this.perch = fl;
            const stop = Math.exp(-dt * 8);
            this.vel.x *= stop;
            this.vel.y *= stop;
          }
        } else {
          this.pos.x = X + (dx / dxy) * rim;
          this.pos.y = Y + (dy / dxy) * rim;
        }
      }
    }

    // Down on the ground: the wind carries the player back to their last flower.
    if (this.pos.z < G.FLOOR_Z + PLAYER_R + 8 && this.perch) {
      this.carry = { t: 0, from: this.pos.clone(), to: this.perchSpot(this.perch).clone() };
      this.vel.set(0, 0, 0);
      this.announce(STRINGS.carried);
      return;
    }

    this.gather(dt);
  }

  /* An arc up and over, back onto the last flower. */
  updateCarry(dt) {
    const c = this.carry;
    c.t = Math.min(1, c.t + dt / 1.8);
    const e = this.G.smooth(c.t);
    this.pos.lerpVectors(c.from, c.to, e);
    this.pos.z += Math.sin(Math.PI * c.t) * 160;
    if (c.t >= 1) {
      this.carry = null;
      this.resting = true;
    }
  }

  /*
   * Rising gusts of wind: columns that always lift a little and, every few
   * seconds, surge. Inside one the lift is strongest at its center and fades
   * near its top. Returns the upward speed they give at a point.
   */
  updraftAt(p) {
    let lift = 0;
    for (const u of this.updrafts || []) {
      const d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d > u.rad || p.z > u.top) continue;
      const across = 1 - (d / u.rad) ** 2;
      const below = Math.min(1, (u.top - p.z) / 160);
      lift += UPDRAFT.lift * u.power * across * below * this.gust(u);
    }
    return Math.min(lift, UPDRAFT.lift * 1.2);
  }

  /* How strongly a column blows right now: a steady breath, and a surge every few seconds. */
  gust(u) {
    const w = 0.5 + 0.5 * Math.sin((this.time * TAU) / u.period + u.phase);
    return 0.4 + 0.6 * w * w;
  }

  /* Hovering in a glowing flower's light gathers its pollen. */
  gather(dt) {
    let inside = null;
    let nearD = Infinity;
    this.nearest = null;
    for (const p of this.pollen || []) {
      const f = p.f;
      if (f.pollinated) continue;
      // The light sits over the open flower: hover just above its petals.
      const d = this.pos.distanceTo(this.tmp.set(f.x, -f.y, f.z + f.lift + f.r * 0.6));
      if (d < nearD) {
        nearD = d;
        this.nearest = p;
      }
      if (d < f.r * 0.85 + 45) inside = p;
      else f.harvest = Math.max(0, f.harvest - dt * 1.5);
    }
    this.nearD = nearD;
    this.inside = inside;
    if (inside) {
      inside.f.harvest += dt / HARVEST_TIME;
      if (inside.f.harvest >= 1) this.collect(inside);
    }
  }

  collect(p) {
    const f = p.f;
    f.pollinated = true;
    f.harvest = 0;
    this.count++;
    this.updateMeter();
    this.chime(this.count);
    this.announce(`Pollen gathered: ${this.count} of ${this.total}.`);
    this.spray(this.tmp.set(f.x, -f.y, f.z + f.lift + f.r * 0.3));
    if (this.ui.count) {
      this.ui.count.parentElement.classList.remove('is-bumped');
      void this.ui.count.offsetWidth;
      this.ui.count.parentElement.classList.add('is-bumped');
    }
    // Every eye that can see it blinks.
    for (const o of this.bed.flowers) if (o.eye) o.eye.blinkAt = this.time + Math.random() * 0.3;
    // The sleeping buds around it wake and bloom, in a ripple out from it.
    for (const o of this.bed.flowers) {
      if (!o.asleep) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < CHAIN_R) {
        o.asleep = false;
        o.bloomAt = this.time + 0.2 + d / 520;
      }
    }
    if (this.count >= this.total) window.setTimeout(() => this.growHeart(), 900);
  }

  /*
   * The rare flower: once every glowing flower is pollinated, a seed falls
   * out of the sky at the center and grows into a giant asterisk-colored
   * bloom with one great eye. When it is open, the dream is complete.
   */
  growHeart() {
    if (this.closed || this.heart || this.count < this.total) return;
    const bed = this.bed;
    const G = this.G;
    const rng = G.mulberry32(99);
    const [hx, hy] = this.heartAt;
    const f = bed.makeFlower(hx, hy, this.logo ? 560 : 300, this.logo ? 240 : 210, rng, { id: 999, startAt: 0, dur: 1, grow: 1, star: true });
    f.species = 'daisy';
    f.home = [hx, hy];
    f.dest = [hx, hy];
    f.lift = 0;
    f.rot0 = f.rot;
    f.phase = 0;
    f.p = 0;
    f.heart = true;
    f.bloomAt = this.time;
    f.eye = { iris: OCEAN, roll: 0, look: new this.THREE.Vector3(), nextBlink: this.time + 9, blinkAt: -1, delay: 0 };
    bed.sequence(f);
    bed.flowers.push(f);
    bed.buildMeshes();
    this.heart = f;
    // Any buds still asleep bloom with it.
    for (const o of bed.flowers) {
      if (!o.asleep) continue;
      o.asleep = false;
      o.bloomAt = this.time + 1 + Math.hypot(o.x - hx, o.y - hy) / 600;
    }
    this.announce(STRINGS.heart);
  }

  updatePollen(dt) {
    const t = this.time;
    for (const p of this.pollen || []) {
      const f = p.f;
      if (f.pollinated) p.fade = Math.max(0, p.fade - dt * 1.6);
      const cx = f.x;
      const cy = -f.y;
      const cz = f.z + f.lift + f.r * 0.25;
      const pulse = 1 + Math.sin(t * 2.2 + p.k) * 0.12 + f.harvest * 0.5;
      p.halo.position.set(cx, cy, cz + f.r * 0.2);
      p.halo.scale.setScalar(f.r * 2.6 * pulse * p.fade);
      p.halo.material.opacity = 0.5 * p.fade;
      p.halo.visible = p.fade > 0;
      p.points.visible = p.fade > 0;
      if (!p.points.visible) continue;
      p.points.material.opacity = p.fade;
      const pos = p.points.geometry.attributes.position;
      // Grains swirl over the flower, and toward the player while being gathered.
      const pull = f.harvest;
      p.grains.forEach((g, i) => {
        const a = g.a + t * g.s;
        let x = cx + Math.cos(a) * g.rad;
        let y = cy + Math.sin(a) * g.rad;
        let z = cz + g.h * f.r + Math.sin(t * 1.7 + i) * 6;
        x += (this.pos.x - x) * pull * 0.6;
        y += (this.pos.y - y) * pull * 0.6;
        z += (this.pos.z - 8 - z) * pull * 0.6;
        pos.setXYZ(i, x, y, z);
      });
      pos.needsUpdate = true;
    }
  }

  spray(at) {
    const b = this.burst;
    const pos = b.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, at.x, at.y, at.z);
      const a = Math.random() * TAU;
      const e = (Math.random() - 0.3) * 1.4;
      const sp = 60 + Math.random() * 140;
      b.vel.set([Math.cos(a) * Math.cos(e) * sp, Math.sin(a) * Math.cos(e) * sp, Math.sin(e) * sp], i * 3);
    }
    pos.needsUpdate = true;
    b.age = 0;
  }

  updateBurst(dt) {
    const b = this.burst;
    if (b.age >= 1) {
      b.points.visible = false;
      return;
    }
    b.age += dt / 1.1;
    b.points.visible = true;
    b.points.material.opacity = 1 - b.age;
    const pos = b.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Each grain flies out, then is drawn in to the player.
      const k = Math.min(1, b.age * 1.4);
      const x = pos.getX(i) + b.vel[i * 3] * dt;
      const y = pos.getY(i) + b.vel[i * 3 + 1] * dt;
      const z = pos.getZ(i) + b.vel[i * 3 + 2] * dt;
      pos.setXYZ(i, x + (this.pos.x - x) * k * 0.12, y + (this.pos.y - y) * k * 0.12, z + (this.pos.z - z) * k * 0.12);
    }
    pos.needsUpdate = true;
  }

  updateDust(dt) {
    if (this.reduced) return;
    const pos = this.dust.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let z = pos.getZ(i) + dt * (6 + (i % 5) * 2);
      if (z > 720) z = this.G.FLOOR_Z;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
  }

  updateMeter() {
    if (!this.ui) return;
    this.ui.count.textContent = `${this.count} / ${this.total}`;
    this.ui.fill.style.width = `${(this.total ? this.count / this.total : 0) * 100}%`;
  }

  /* Compass to the nearest glow, the gathering ring, and the prompt. */
  updateHud() {
    const ui = this.ui;
    // Toward the nearest glow, or to the heart of the garden once it is growing.
    const n = this.heart || (this.nearest && this.nearest.f);
    if (n && !this.complete && this.state === 'play') {
      const f = n;
      const a = Math.atan2(-f.y - this.pos.y, f.x - this.pos.x);
      let rel = a - this.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      ui.compass.hidden = false;
      ui.compass.style.setProperty('--turn', `${-rel}rad`);
    } else {
      ui.compass.hidden = true;
    }
    const h = this.inside ? this.inside.f.harvest : 0;
    ui.reticle.style.setProperty('--p', h.toFixed(3));
    ui.reticle.classList.toggle('is-gathering', h > 0);
    let prompt = '';
    if (this.heart && !this.complete) prompt = STRINGS.heart;
    else if (this.state === 'play' && this.carry) prompt = STRINGS.carried;
    else if (this.state === 'play' && this.inside) prompt = STRINGS.gathering;
    else if (this.state === 'play' && this.lift > 60) prompt = STRINGS.rising;
    else if (this.state === 'play' && n && this.nearD < 650) prompt = STRINGS.near;
    else if (this.state === 'play' && this.resting) prompt = STRINGS.resting;
    if (ui.prompt.textContent !== prompt) ui.prompt.textContent = prompt;
  }

  /* ---------------- sound ---------------- */

  ensureAudio() {
    if (this.audio || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      this.audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.audio = null;
    }
  }

  tone(freq, at, len, gain) {
    const ctx = this.audio;
    if (!ctx || !this.sound) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + len + 0.05);
  }

  /* A rising pentatonic chime: each flower a step higher. */
  chime(n) {
    const scale = [0, 2, 4, 7, 9];
    const step = (n - 1) % 10;
    const semis = scale[step % 5] + 12 * Math.floor(step / 5);
    const f = 523.25 * Math.pow(2, semis / 12);
    this.tone(f, 0, 0.9, 0.1);
    this.tone(f * 1.5, 0.08, 0.7, 0.05);
  }

  chord() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.12, 1.8, 0.07));
  }
}
