/**
 * Pollen Dream
 *
 * Exploring the splash's own garden as the D of DUET, seen from just behind
 * it (the letters: assets/pollen-dream-cast.js): on foot through
 * the grass and the flowers of the logo, across the hills, under the sky
 * of the sky view (the "d" easter egg), all of it one world at the
 * visitor's time of day. The bee, the season's weather, the planes, the
 * blimp, the birds, the sun and the moon carry on as they do on the page.
 *
 * No instructions: the controls are the ones every first-person game uses.
 *   Computer: click to look with the mouse (Esc lets go and pauses), or drag,
 *   or swipe two fingers on a trackpad; W A S D or the arrows to walk, Space
 *   to jump, Shift to run.
 *   Phone: move the phone itself to look round (where the phone allows it),
 *   or drag anywhere; the thumb stick walks (pushed all the way, runs); Jump.
 *
 * Out in the fields wait the U, the E and the T. Walk up to one and say hi
 * (the E key, or the Say hi button): it joins you. Find all three and they
 * line up beside you: D U E T.
 *
 * Now and then a gust of wind rises nearby (garden-splash.js updateGusts):
 * a note at the top says so and an arrow points the way. Walk into it and
 * it carries you up above the clouds, to glide back down, steering.
 *
 * The world is the page's garden itself (garden-splash.js startExplore());
 * this file reads the controls and draws the few buttons over it. New ways
 * of moving are modes in garden-splash.js (EXPLORE_MODES); new things to do
 * hook in through garden.exploreHooks. Opened from the menu, a #pollen-dream
 * link or the hidden color combination (snippets/pollen-dream-launcher.liquid);
 * on a page without the splash it goes to the home page and opens there.
 */

const LOOK = { mouse: 0.0022, drag: 0.005, touch: 0.0065, wheel: 0.0035 };

const STRINGS = {
  title: 'Pollen Dream',
  eyebrow: 'Duet',
  resume: 'Keep going',
  exit: 'Back to Duet',
  pause: 'Pause',
  paused: 'Paused',
  loading: 'Waiting for the flowers…',
  failed: 'The garden can’t open here.',
  failedHelp: 'Exploring needs the garden on the home page, with WebGL turned on.',
  jump: 'Jump',
  motion: 'Tilt to look',
  gust: 'Wind rising nearby',
  lifted: 'Carried up on the wind',
  gliding: 'Gliding down',
  sayHi: 'Say hi',
};

let current = null;

/* Opens the garden to explore, or brings the open one back into focus. */
export async function openPollenDream(opts) {
  if (current) {
    current.focusScreen();
    return current;
  }
  current = new Explore(opts || {});
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
  return all.find((g) => typeof g.canExplore === 'function' && g.canExplore()) || null;
}

/* A splash garden that is still growing: worth waiting for. */
function growingGarden() {
  return Array.from(document.querySelectorAll('garden-splash')).find((g) => typeof g.canExplore === 'function' && !g.failed && !g.backdrop && !g.background && !g.arranged) || null;
}

function rootPath() {
  return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
}

function onHome() {
  const root = rootPath();
  return location.pathname === root || location.pathname === root.replace(/\/$/, '');
}

/*
 * Where the phone is pointing, from its orientation (degrees, as
 * deviceorientation gives them) and the screen's rotation: the direction
 * out of the back of the screen as { yaw, pitch } in radians. yaw turns to
 * the left as it grows; pitch is up from level. The same sums as three.js's
 * old DeviceOrientationControls, without three.js.
 */
function phoneAim(alpha, beta, gamma, screenAngle) {
  const r = Math.PI / 180;
  const x = beta * r;
  const y = alpha * r;
  const z = -gamma * r;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  // Euler YXZ to a quaternion.
  let q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  const mul = (a, b) => [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  // Looking out of the back of the phone, not its top edge; then the screen's own turn.
  q = mul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const o = (-screenAngle * r) / 2;
  q = mul(q, [0, 0, Math.sin(o), Math.cos(o)]);
  // The view's forward direction, (0, 0, -1) turned by q.
  const v = [0, 0, -1];
  const t = [2 * (q[1] * v[2] - q[2] * v[1]), 2 * (q[2] * v[0] - q[0] * v[2]), 2 * (q[0] * v[1] - q[1] * v[0])];
  const f = [v[0] + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]), v[1] + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]), v[2] + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0])];
  return { yaw: Math.atan2(-f[0], -f[2]), pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))) };
}

class Explore {
  constructor(opts) {
    this.opts = opts;
    this.state = 'loading';
    this.abort = new AbortController();
    this.keys = new Set();
    this.stick = { id: null, x: 0, y: 0 };
    this.drag = { id: null, x: 0, y: 0 };
    this.holds = { jump: false };
    // Looking by moving the phone: on once it is allowed and the phone reports it.
    this.motion = { on: false, wanted: true, allowed: false, seen: false, yaw: 0, pitch: 0, offYaw: null, offPitch: 0 };
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    this.returnFocus = opts.returnFocus || document.activeElement;
  }

  /* ---------------- open & close ---------------- */

  async open() {
    // Asked for at once, while the tap that opened this still counts (iPhones only ask on a tap).
    const asked = this.touch ? this.askMotion() : null;
    let garden = splashGarden(this.opts.source);
    if (!garden && !growingGarden() && !onHome()) {
      // The world to explore is the home page's garden.
      current = null;
      window.location.assign(rootPath() + '#pollen-dream');
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
    if (!garden || !garden.startExplore('walk')) {
      this.showError();
      return;
    }
    this.garden = garden;
    this.loadCast();
    this.bindInput();
    if (asked) asked.then((ok) => !this.closed && this.motionReady(ok));
    // No instructions: straight in. The controls are the usual ones, there to be found.
    this.play();
    this.tick();
  }

  /* The letters (assets/pollen-dream-cast.js): the D to play, and the others to find. Without them it stays first person. */
  loadCast() {
    import('./pollen-dream-cast.js')
      .then((m) => m.addCast(this.garden, import.meta.url))
      .then((cast) => {
        if (!cast) return;
        if (this.closed) cast.remove();
        else this.cast = cast;
      })
      .catch((e) => console.error('pollen-dream: the letters could not load', e));
  }

  /* Says hi to the letter the D is next to, if any. */
  talk() {
    if (this.state !== 'play' || !this.cast) return;
    this.cast.talk();
  }

  /* The Say hi prompt beside a letter, and what the letters say. */
  castNote() {
    const C = this.cast;
    const ui = this.ui;
    const prompt = C && this.state === 'play' ? C.prompt : null;
    if (prompt !== this.promptShown) {
      this.promptShown = prompt;
      ui.talk.hidden = !prompt;
      if (prompt) {
        ui.talkText.textContent = `${STRINGS.sayHi} · ${prompt}`;
        ui.talkKey.hidden = this.touch;
      }
    }
    const say = C && C.say;
    const key = say ? say.who + say.text : '';
    if (key !== this.sayShown) {
      this.sayShown = key;
      ui.say.hidden = !say;
      ui.say.classList.toggle('is-done', !!(say && say.done));
      ui.sayWho.textContent = say && say.who ? say.who : '';
      ui.sayWho.hidden = !(say && say.who);
      ui.sayText.textContent = say ? say.text : '';
    }
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
    if (this.cast) this.cast.remove();
    this.cast = null;
    if (this.garden) this.garden.stopExplore();
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
    root.setAttribute('aria-label', String(this.opts.title || S.title));
    root.tabIndex = -1;
    root.innerHTML = `
      <div class="pollen-dream__surface" data-surface aria-hidden="true"></div>
      <button type="button" class="pollen-dream__talk" data-action="talk" hidden><kbd class="pollen-dream__key" data-talk-key>E</kbd><span data-talk-text></span></button>
      <p class="pollen-dream__say" data-say role="status" hidden><span class="pollen-dream__say-who" data-say-who></span><span data-say-text></span></p>
      <p class="pollen-dream__alert" data-alert role="status" hidden><span class="pollen-dream__alert-arrow" data-alert-arrow aria-hidden="true"></span><span data-alert-text></span></p>
      <div class="pollen-dream__hud" data-hud hidden>
        <button type="button" class="pollen-dream__chip" data-action="motion" aria-pressed="false" hidden>${S.motion}</button>
        <button type="button" class="pollen-dream__chip" data-action="pause">${S.pause}</button>
        <button type="button" class="pollen-dream__chip" data-action="exit">${S.exit}</button>
      </div>
      <div class="pollen-dream__touch" data-touch hidden>
        <div class="pollen-dream__stick" data-stick aria-hidden="true"><span data-knob></span></div>
        <div class="pollen-dream__holds">
          <button type="button" class="pollen-dream__hold" data-hold="jump">${S.jump}</button>
        </div>
      </div>
      <section class="pollen-dream__screen" data-screen="loading" hidden>
        <p class="pollen-dream__eyebrow">${S.eyebrow}</p>
        <p class="pollen-dream__lead">${S.loading}</p>
      </section>
      <section class="pollen-dream__screen" data-screen="paused" hidden>
        <h2 class="pollen-dream__title">${S.paused}</h2>
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
    this.ui = { talk: q('[data-action="talk"]'), talkText: q('[data-talk-text]'), talkKey: q('[data-talk-key]'), say: q('[data-say]'), sayWho: q('[data-say-who]'), sayText: q('[data-say-text]'), alert: q('[data-alert]'), alertText: q('[data-alert-text]'), alertArrow: q('[data-alert-arrow]'), hud: q('[data-hud]'), touch: q('[data-touch]'), stick: q('[data-stick]'), knob: q('[data-knob]'), motion: q('[data-action="motion"]') };
  }

  show(state) {
    this.state = state;
    this.root.dataset.state = state;
    this.root.querySelectorAll('[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== state));
    const playing = state === 'play';
    this.ui.hud.hidden = !playing;
    this.ui.touch.hidden = !(playing && this.touch);
    if (!playing) this.clearInput();
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
        if (act === 'resume') this.play();
        else if (act === 'pause') this.pause();
        else if (act === 'exit') this.close();
        else if (act === 'motion') this.toggleMotion();
        else if (act === 'talk') this.talk();
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
        if (this.state === 'play') this.pause();
        else if (this.state === 'paused') this.play();
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
    const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyC'];
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.state !== 'play' || !KEYS.includes(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'KeyE' && !e.repeat) this.talk();
        this.keys.add(e.code);
      },
      capture
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), capture);
    window.addEventListener('blur', () => this.state === 'play' && this.pause(), on);
    document.addEventListener('visibilitychange', () => document.hidden && this.state === 'play' && this.pause(), on);

    // Mouse: a click captures it and moving it looks round, as in any first-person game (Esc lets go and pauses).
    // Dragging looks round too, captured or not (the capture can be refused, as in the theme editor's preview);
    // and on a trackpad, so does swiping with two fingers.
    document.addEventListener(
      'pointerlockchange',
      () => {
        const locked = document.pointerLockElement === this.surface;
        if (!locked && this.locked && this.state === 'play') this.pause();
        this.locked = locked;
        this.root.classList.toggle('is-locked', locked);
      },
      on
    );
    document.addEventListener(
      'mousemove',
      (e) => {
        if (this.state === 'play' && this.locked) this.look(e.movementX * LOOK.mouse, e.movementY * LOOK.mouse);
      },
      on
    );
    const s = this.surface;
    s.addEventListener(
      'pointerdown',
      (e) => {
        if (this.state !== 'play') return;
        if (e.pointerType === 'touch' && !this.touch) {
          this.touch = true;
          this.ui.touch.hidden = false;
        }
        if (e.pointerType === 'mouse' && !this.locked) this.lock();
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
        // Captured, the mouse already looks round on its own (see mousemove).
        if (this.locked) {
          d.x = e.clientX;
          d.y = e.clientY;
          return;
        }
        this.look((e.clientX - d.x) * d.k, (e.clientY - d.y) * d.k);
        d.x = e.clientX;
        d.y = e.clientY;
      },
      on
    );
    s.addEventListener(
      'wheel',
      (e) => {
        // Two-finger swipes on a trackpad (and a mouse wheel) look round; a pinch (ctrl + wheel) is left alone.
        if (this.state !== 'play' || e.ctrlKey) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        this.look(e.deltaX * unit * LOOK.wheel, e.deltaY * unit * LOOK.wheel);
      },
      { signal: this.abort.signal, passive: false }
    );
    document.addEventListener('pointerlockerror', () => (this.noLock = true), on);
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

    // The phone's own movement.
    window.addEventListener('deviceorientation', (e) => this.onOrient(e), on);
  }

  /* Looks round by dx across and dy up and down (radians). With the phone steering, it shifts where the phone's aim points. */
  look(dx, dy) {
    const M = this.motion;
    if (M.on && M.offYaw !== null) {
      M.offYaw -= dx;
      M.offPitch -= dy;
      this.aim();
    } else this.garden.exploreLook(dx, dy);
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

  /* Captures the mouse for looking round. False where it can't be (touch, or the theme editor's frame). */
  lock() {
    if (this.touch || this.noLock || !this.surface.requestPointerLock) return false;
    try {
      const r = this.surface.requestPointerLock();
      if (r && r.catch) r.catch(() => (this.noLock = true));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- looking by moving the phone ---------------- */

  /* Asks to read the phone's movement where that needs asking (iPhone). Resolves true if it may be read. */
  askMotion() {
    const D = window.DeviceOrientationEvent;
    if (!D) return Promise.resolve(false);
    if (typeof D.requestPermission !== 'function') return Promise.resolve(true);
    try {
      return D.requestPermission()
        .then((r) => r === 'granted')
        .catch(() => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* Whether it may be read. Where it must be asked and wasn't allowed yet, the Tilt to look button asks again on a tap. */
  motionReady(ok) {
    const M = this.motion;
    M.allowed = M.allowed || ok;
    if (!M.allowed && window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      M.wanted = false;
      this.ui.motion.hidden = false;
      this.syncMotion();
    }
  }

  toggleMotion() {
    const M = this.motion;
    if (!M.allowed) {
      this.askMotion().then((ok) => {
        M.allowed = ok;
        M.wanted = ok;
        M.offYaw = null;
        this.syncMotion();
      });
      return;
    }
    M.wanted = !M.wanted;
    M.offYaw = null;
    if (!M.wanted) {
      M.on = false;
      this.garden.exploreAim(null);
    }
    this.syncMotion();
  }

  syncMotion() {
    const M = this.motion;
    this.ui.motion.setAttribute('aria-pressed', String(!!(M.wanted && M.allowed)));
  }

  onOrient(e) {
    const M = this.motion;
    if (e.alpha === null || e.beta === null) return;
    if (!M.seen) {
      // The phone does report its movement: offer the switch, and use it from now on.
      M.seen = true;
      M.allowed = true;
      this.ui.motion.hidden = false;
      this.syncMotion();
    }
    if (!M.wanted || this.state !== 'play') return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const a = phoneAim(e.alpha, e.beta, e.gamma, angle);
    M.yaw = a.yaw;
    M.pitch = a.pitch;
    if (M.offYaw === null) {
      // Starting: whichever way the phone faces now is straight ahead in the garden.
      const E = this.garden.explorer;
      if (!E || E.intro < 1) return;
      M.offYaw = E.yaw - a.yaw;
      M.offPitch = 0;
    }
    M.on = true;
    this.aim();
  }

  aim() {
    const M = this.motion;
    this.garden.exploreAim(M.yaw + M.offYaw, M.pitch + M.offPitch);
  }

  /* ---------------- each frame ---------------- */

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
    const E = this.garden && this.garden.explorer;
    if (!E) return;
    const k = this.keys;
    const has = (...codes) => codes.some((c) => k.has(c));
    const on = this.state === 'play';
    const st = this.stick;
    const dead = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const push = Math.hypot(st.x, st.y);
    const inp = E.input;
    inp.f = on ? (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) - dead(st.y) : 0;
    inp.r = on ? (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0) + dead(st.x) : 0;
    inp.turn = on ? (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) : 0;
    inp.jump = on && (has('Space') || this.holds.jump);
    inp.up = on ? (has('Space', 'KeyE') ? 1 : 0) - (has('KeyQ', 'KeyC') ? 1 : 0) : 0;
    inp.run = on && (has('ShiftLeft', 'ShiftRight') || push > 0.92);
    inp.paused = !on;
  }

  /*
   * The note at the top about the wind: a gust rising nearby, with an arrow
   * pointing which way it is from where the visitor faces (straight up is
   * straight ahead); then, carried up, and gliding down for a moment.
   */
  windNote() {
    const g = this.garden;
    const E = g && g.explorer;
    const G = g && g.updraft;
    let msg = '';
    let arrow = null;
    if (E && this.state === 'play' && E.intro >= 1) {
      if (E.mode === 'lift') msg = STRINGS.lifted;
      else if (E.mode === 'glide') {
        if (!this.glideAt) this.glideAt = performance.now();
        if (performance.now() - this.glideAt < 4000) msg = STRINGS.gliding;
      } else if (G && !G.rider && G.age < G.life && G.out > 0) {
        msg = STRINGS.gust;
        const toward = Math.atan2(G.y - E.y, G.x - E.x);
        const ahead = E.yaw + Math.PI / 2;
        arrow = Math.atan2(Math.sin(toward - ahead), Math.cos(toward - ahead));
      }
      if (E.mode !== 'glide') this.glideAt = 0;
    }
    const ui = this.ui;
    if (msg !== this.noteShown) {
      this.noteShown = msg;
      ui.alert.hidden = !msg;
      ui.alertText.textContent = msg;
    }
    ui.alertArrow.hidden = arrow === null;
    // Turning left (counterclockwise seen from above) is a turn to the left on screen.
    if (arrow !== null) ui.alertArrow.style.transform = `rotate(${(-arrow * 180) / Math.PI}deg)`;
  }

  tick() {
    if (this.closed) return;
    this.send();
    this.windNote();
    this.castNote();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  /* ---------------- states ---------------- */

  play() {
    this.show('play');
    this.root.focus({ preventScroll: true });
    // The mouse is captured by a click in the garden, so Back to Duet stays in reach until then.
  }

  pause() {
    if (document.pointerLockElement === this.surface) document.exitPointerLock();
    this.show('paused');
  }
}
