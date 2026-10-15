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
const CHAIN_R = 680; // buds this close to a pollinated flower wake up
const HARVEST_TIME = 0.9; // seconds in a flower's light to gather its pollen
const PLAYER_R = 10;
const MOVE = { accel: 720, damp: 2.4, max: 240, boost: 1.75 };
const LOOK = { mouse: 0.0022, drag: 0.004, touch: 0.006 };
const OCEAN = [25, 31, 107];
const POWDER = [185, 229, 251];
const POLLEN = [255, 214, 120];

const STRINGS = {
  title: 'Pollen Dream',
  eyebrow: 'Duet',
  intro: 'You are very small, and the garden is very large. Find the glowing flowers and fly into their light to gather pollen. Every flower you pollinate wakes the sleeping buds around it.',
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
  rise: 'Rise',
  sink: 'Sink',
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
    this.holds = { up: false, down: false };
    this.sound = true;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    this.returnFocus = opts.returnFocus || document.activeElement;
    this.disposables = [];
  }

  /* ---------------- open & close ---------------- */

  async open() {
    this.buildDom();
    window.dispatchEvent(new CustomEvent('duet:world-pause'));
    document.documentElement.classList.add('pollen-dream-open');
    this.bindUi();
    this.show('loading');

    const [garden] = await Promise.all([import(this.opts.gardenUrl), this.loadCss()]);
    if (this.closed) return;
    this.G = garden;
    this.THREE = garden.THREE;
    this.setupRenderer();
    this.setupWorld();
    this.generate((Math.random() * 2 ** 31) | 0);
    this.bindInput();
    this.resize();
    this.show('title');
    this.loop();
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
      ? `<li><b>Left thumb</b> move</li><li><b>Right thumb</b> look around</li><li><b>${S.rise} / ${S.sink}</b> fly up and down</li>`
      : `<li><b>W A S D</b> or <b>arrows</b> fly</li><li><b>Mouse</b> look around</li><li><b>Space</b> rise · <b>C</b> sink</li><li><b>Shift</b> dash</li><li><b>Esc</b> pause · <b>Esc</b> again to leave</li>`;
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
          <button type="button" class="pollen-dream__hold" data-hold="up">${S.rise}</button>
          <button type="button" class="pollen-dream__hold" data-hold="down">${S.sink}</button>
        </div>
      </div>
      <p class="pollen-dream__sr" role="status" aria-live="polite" data-announce></p>
      <section class="pollen-dream__screen" data-screen="loading" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <p class="pollen-dream__lead">${S.loading}</p>
      </section>
      <section class="pollen-dream__screen" data-screen="title" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <h2 class="pollen-dream__title" id="PollenDreamTitle">${S.title}</h2>
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
        <p class="pollen-dream__eyebrow">${S.title}</p>
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
    const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ControlLeft'];

    window.addEventListener(
      'keydown',
      (e) => {
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
        if (MOVE_KEYS.includes(e.code)) {
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

    // Mouse look: pointer lock once the visitor presses Start, dragging otherwise.
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
        if (this.state !== 'play' || !this.locked) return;
        this.turn(e.movementX * LOOK.mouse, e.movementY * LOOK.mouse);
      },
      on
    );

    // Touch and pen: a thumbstick on the left, look by dragging anywhere else.
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
          if (this.locked) return;
        }
        if (this.lookDrag.id !== null) return;
        this.lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
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
        const k = d.type === 'touch' ? LOOK.touch : LOOK.drag;
        this.turn((e.clientX - d.x) * k, (e.clientY - d.y) * k);
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
    // Without a lock (refused, or in the theme editor's frame) the mouse drags to look instead.
    if (this.touch || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) {
      /* dragging still works */
    }
  }

  clearInput() {
    this.keys.clear();
    this.holds.up = this.holds.down = false;
    this.stick = { id: null, x: 0, y: 0 };
    this.lookDrag.id = null;
    if (this.ui) this.ui.knob.style.transform = '';
  }

  turn(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - dy));
  }

  /* ---------------- game states ---------------- */

  play() {
    if (this.state === 'title') {
      this.placePlayer();
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
    const src = document.querySelector('garden-splash') || { dataset: {} };
    let palette = [];
    try {
      palette = JSON.parse(src.dataset.palette || '[]');
    } catch (e) {
      palette = [];
    }
    const bed = G.createBed({
      palette,
      foliage: src.dataset.foliageColor,
      center: src.dataset.centerColor,
      accent: src.dataset.centerAccent,
      soil: '#191F6B',
      reduced: this.reduced,
      camDist: 1500,
    });
    // Every part of the world is looked at by a bee, so the eyes follow the camera.
    bed.lookTarget = (out) => out.copy(this.camera.position);
    this.bed = bed;
    const scene = bed.scene;
    this.scene = scene;

    const horizon = G.mix(bed.heroColor, POWDER, 0.55);
    const zenith = OCEAN;
    this.horizon = horizon;
    scene.fog = new THREE.Fog(G.toColor(horizon), 320, 2500);
    scene.background = G.toColor(horizon);

    this.camera = new THREE.PerspectiveCamera(72, 1, 1, 7000);
    this.camera.up.set(0, 0, 1);

    // Sky: a dome from the horizon color up to deep ocean blue.
    const skyGeo = new THREE.SphereGeometry(5500, 24, 12);
    const pos = skyGeo.attributes.position;
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 5500);
      const c = G.mix(horizon, zenith, Math.pow(t, 0.6));
      colors.push(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    skyGeo.rotateX(Math.PI / 2); // its pole points up the world's z axis
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    scene.add(sky);
    this.sky = sky;
    this.disposables.push(skyGeo, skyMat);

    // Ground: low, faceted hills in the leaf color, snapped like the flowers.
    const rng = G.mulberry32(7);
    const size = BOUND * 3;
    const groundGeo = new THREE.PlaneGeometry(size, size, 28, 28);
    const gp = groundGeo.attributes.position;
    const gc = [];
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const y = gp.getY(i);
      gp.setZ(i, G.FLOOR_Z - 8 + Math.sin(x * 0.004) * Math.cos(y * 0.005) * 6 + (rng() - 0.5) * 6);
      const c = G.mix(G.tone(bed.foliage, -0.45), bed.foliage, rng() * 0.5);
      gc.push(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
    groundGeo.computeVertexNormals();
    const groundMat = bed.makeMaterial({ vertexColors: true, shininess: 10, specular: 0x222222 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    scene.add(ground);
    this.disposables.push(groundGeo, groundMat);

    // Grass: the bed's own leaf petal, standing up, giant at this scale.
    const blades = this.touch ? 170 : 300;
    const grass = new THREE.InstancedMesh(bed.geometries.leaf, bed.materials.foliage, blades);
    const d = new THREE.Object3D();
    d.rotation.order = 'ZYX';
    const col = new THREE.Color();
    for (let i = 0; i < blades; i++) {
      const a = rng() * TAU;
      const rad = Math.sqrt(rng()) * BOUND * 1.1;
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

    // Dust drifting in the dusk light.
    const motes = this.touch ? 140 : 260;
    const mp = new Float32Array(motes * 3);
    for (let i = 0; i < motes; i++) {
      const a = rng() * TAU;
      const rad = Math.sqrt(rng()) * BOUND;
      mp.set([Math.cos(a) * rad, Math.sin(a) * rad, G.lerp(G.FLOOR_Z, 700, rng())], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const dustMat = new THREE.PointsMaterial({ size: 5, map: this.glowTex, color: G.toColor(POWDER), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dust = new THREE.Points(dustGeo, dustMat);
    scene.add(this.dust);
    this.disposables.push(dustGeo, dustMat);

    // A burst of pollen flies to the player on every gather.
    const BURST = 60;
    const bp = new Float32Array(BURST * 3);
    const burstGeo = new THREE.BufferGeometry();
    burstGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    const burstMat = new THREE.PointsMaterial({ size: 9, map: this.glowTex, color: G.toColor(POLLEN), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.burst = { points: new THREE.Points(burstGeo, burstMat), vel: new Float32Array(BURST * 3), age: 1 };
    this.burst.points.frustumCulled = false;
    scene.add(this.burst.points);
    this.disposables.push(burstGeo, burstMat);

    this.time = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
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

    const want = this.touch ? 46 : 68;
    let pts = G.poissonDisc(-WORLD_R, -WORLD_R, WORLD_R, WORLD_R, 245, rng, [rng() * 200, WORLD_R * 0.6]).filter(
      ([x, y]) => Math.hypot(x, y) < WORLD_R && Math.hypot(x, y) > HEART_CLEAR
    );
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    pts = pts.slice(0, want);

    bed.elapsed = 0;
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

    // The glowing flowers are spread far apart (farthest-point picking).
    const total = Math.min(this.touch ? 7 : 9, bed.flowers.length);
    const chosen = [bed.flowers[0]];
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
      // Glowing flowers and about a third of the rest are open; the others sleep as buds.
      if (!f.pollen && rng() > 0.34) {
        f.p = 0.57;
        f.asleep = true;
      }
    }
    bed.assignEyes(rng);
    bed.buildMeshes();
    this.buildPollen(chosen);

    this.total = total;
    this.count = 0;
    this.playTime = 0;
    this.complete = false;
    this.ui.goal.textContent = `Gather pollen from all ${total} glowing flowers.`;
    this.updateMeter();
  }

  /* Each glowing flower: a halo you can see from far away, and a swirl of pollen grains over it. */
  buildPollen(flowers) {
    const THREE = this.THREE;
    const G = this.G;
    this.pollen = flowers.map((f, k) => {
      const n = 34;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ size: 8, map: this.glowTex, color: G.toColor(POLLEN), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      const haloMat = new THREE.SpriteMaterial({ map: this.glowTex, color: G.toColor(G.mix(POLLEN, f.color, 0.35)), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const halo = new THREE.Sprite(haloMat);
      this.scene.add(points, halo);
      const grains = [];
      for (let i = 0; i < n; i++) grains.push({ a: (i / n) * TAU * 3, rad: f.r * (0.15 + 0.5 * ((i * 37) % n) / n), h: (i % 7) * 0.12, s: 0.5 + ((i * 13) % 10) / 10 });
      return { f, points, halo, grains, fade: 1, k };
    });
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

  placePlayer() {
    this.pos.set(0, -WORLD_R - 120, 150);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI / 2;
    this.pitch = -0.08;
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
    } else if (this.state === 'title' || this.state === 'loading') {
      // A slow drift around the garden behind the title.
      const a = t * 0.05 - Math.PI / 2;
      this.pos.set(Math.cos(a) * 1250, Math.sin(a) * 1250, 260);
      this.yaw = a + Math.PI;
      this.pitch = -0.12;
    }

    // Look direction (z is up).
    const cp = Math.cos(this.pitch);
    this.fwd.set(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch));
    const bob = this.state === 'play' && !this.reduced ? Math.sin(t * 9) * 0.8 : 0;
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z + bob);
    this.camera.lookAt(this.tmp.copy(this.camera.position).add(this.fwd));
    this.sky.position.copy(this.camera.position);

    // Flowers sway a little; woken buds bloom with the garden's own growth animation.
    const sway = this.reduced ? 0 : 1;
    for (const f of bed.flowers) {
      if (f.bloomAt !== undefined && t >= f.bloomAt && f.p < 1) f.p = Math.min(1, f.p + dt / (f.heart ? 7 : 1.8));
      f.rot = f.rot0 + Math.sin(t * 0.7 + f.phase) * 0.06 * sway;
      f.lift = Math.sin(t * 0.9 + f.phase) * 5 * sway;
      bed.shape(f);
      f.shown = f.p;
    }
    bed.updateEyes(dt);

    this.updatePollen(dt);
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
  fly(dt) {
    const k = this.keys;
    const s = this.stick;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - s.y;
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + s.x;
    const u = (k.has('Space') || k.has('KeyE') || this.holds.up ? 1 : 0) - (k.has('KeyC') || k.has('KeyQ') || k.has('ControlLeft') || this.holds.down ? 1 : 0);
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? MOVE.boost : 1;

    const wish = this.tmp.set(0, 0, 0);
    wish.addScaledVector(this.fwd, f);
    wish.x += Math.sin(this.yaw) * r;
    wish.y -= Math.cos(this.yaw) * r;
    wish.z += u;
    if (wish.lengthSq() > 1) wish.normalize();

    this.vel.addScaledVector(wish, MOVE.accel * boost * dt);
    this.vel.multiplyScalar(Math.exp(-MOVE.damp * dt));
    const max = MOVE.max * boost;
    if (this.vel.length() > max) this.vel.setLength(max);
    this.pos.addScaledVector(this.vel, dt);

    // Ground, sky and the edge of the dream.
    const floor = this.G.FLOOR_Z + PLAYER_R + 6;
    if (this.pos.z < floor) {
      this.pos.z = floor;
      this.vel.z = Math.max(0, this.vel.z);
    }
    if (this.pos.z > CEILING) {
      this.pos.z = CEILING;
      this.vel.z = Math.min(0, this.vel.z);
    }
    const out = Math.hypot(this.pos.x, this.pos.y) - BOUND;
    if (out > 0) {
      const a = Math.atan2(this.pos.y, this.pos.x);
      this.vel.x -= Math.cos(a) * out * 6 * dt;
      this.vel.y -= Math.sin(a) * out * 6 * dt;
    }

    // Stems and flower heads are solid; the player slides around them.
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
      // An open head is a wide, flat disc of petals: the player is pushed out
      // the shorter way, over or under it, or around its rim.
      if (fl.p < 0.5) continue;
      const rim = fl.r * 0.95 * fl.g + PLAYER_R;
      const half = fl.r * 0.22 * fl.g + PLAYER_R;
      const dz = this.pos.z - (headZ + fl.r * 0.08);
      if (dxy < rim && Math.abs(dz) < half) {
        const vertical = half - Math.abs(dz);
        const radial = rim - dxy;
        if (vertical < radial) {
          this.pos.z += Math.sign(dz || 1) * vertical;
          if (this.vel.z * Math.sign(dz || 1) < 0) this.vel.z = 0;
        } else {
          this.pos.x = X + (dx / dxy) * rim;
          this.pos.y = Y + (dy / dxy) * rim;
        }
      }
    }

    this.gather(dt);
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
    const f = bed.makeFlower(0, 0, 300, 210, rng, { id: 999, startAt: 0, dur: 1, grow: 1, star: true });
    f.species = 'daisy';
    f.home = [0, 0];
    f.dest = [0, 0];
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
      o.bloomAt = this.time + 1 + Math.hypot(o.x, o.y) / 600;
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
      p.halo.material.opacity = 0.8 * p.fade;
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
    else if (this.state === 'play' && this.inside) prompt = STRINGS.gathering;
    else if (this.state === 'play' && n && this.nearD < 650) prompt = STRINGS.near;
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
