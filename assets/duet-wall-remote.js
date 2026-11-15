/*
 * <duet-wall-remote>: the hidden remote for the shop wall
 * (sections/duet-wall-remote.liquid).
 *
 * Press and hold the trigger (the blog page's title) and a beam of light
 * grows from it; hold on and the remote opens. It loads the wall's setup
 * from the wall page, shows the wall live (<duet-wall data-role="preview">)
 * and sends the visitor's choices to the relay. The relay decides what is
 * allowed; this only reflects what it answers.
 */
const HOLD_MS = 1300;

class DuetWallRemote extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector('[data-panel]');
    this.viewSlot = this.querySelector('[data-view]');
    this.statusEl = this.querySelector('[data-status]');
    this.waitEl = this.querySelector('[data-wait]');
    this.clipsEl = this.querySelector('[data-clips]');
    this.until = 0;
    this.querySelector('[data-close]').addEventListener('click', () => this.close());
    this.addEventListener('keydown', (e) => this.onKey(e));
    this.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) this.act(b);
    });
    this.bindTrigger();
  }

  /* ---------------- the hidden way in ---------------- */

  bindTrigger() {
    const target = document.querySelector(this.dataset.trigger || '#MainContent h1');
    if (!target) return;
    this.trigger = target;
    target.classList.add('wall-remote-trigger');
    let timer = null;
    let start = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      target.classList.remove('is-charging');
    };
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.isOpen) return;
      start = { x: e.clientX, y: e.clientY };
      target.classList.add('is-charging');
      timer = setTimeout(() => {
        cancel();
        target.classList.add('is-lit');
        setTimeout(() => target.classList.remove('is-lit'), 900);
        this.open();
      }, HOLD_MS);
    });
    target.addEventListener('pointermove', (e) => {
      if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) cancel();
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) target.addEventListener(type, cancel);
    // A long press on a phone would otherwise open the text menu.
    target.addEventListener('contextmenu', (e) => {
      if (timer || this.isOpen) e.preventDefault();
    });
  }

  /* ---------------- opening ---------------- */

  async open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement;
    this.hidden = false;
    document.documentElement.classList.add('wall-remote-open');
    requestAnimationFrame(() => this.classList.add('is-open'));
    this.panel.focus();
    if (!this.config) await this.load();
    if (this.config && !this.wall) this.mount();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.classList.remove('is-open');
    document.documentElement.classList.remove('wall-remote-open');
    // The preview stops when closed: no video or connection left running.
    if (this.wall) {
      this.wall.remove();
      this.wall = null;
    }
    setTimeout(() => {
      if (!this.isOpen) this.hidden = true;
    }, 300);
    if (this.returnFocus && this.returnFocus.focus) this.returnFocus.focus();
  }

  onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...this.panel.querySelectorAll('button:not([disabled]), [href], [tabindex="0"]')].filter((el) => el.offsetParent);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* The wall page's own section carries the clips, the relay and the wall's look. */
  async load() {
    this.setStatus('Connecting to the shop…');
    try {
      const url = `${this.dataset.wallUrl}${this.dataset.wallUrl.includes('?') ? '&' : '?'}section_id=wall`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      this.config = JSON.parse(doc.querySelector('[data-wall-config]').textContent);
      this.relay = (this.config.relay || '').replace(/\/+$/, '');
    } catch (e) {
      this.config = null;
      this.setStatus("The wall isn't set up yet");
      this.setControls(false);
      return;
    }
    this.buildClips();
    await import(this.dataset.wallModule);
  }

  mount() {
    const wall = document.createElement('duet-wall');
    wall.dataset.role = 'preview';
    wall.config = this.config;
    wall.className = 'wall-remote__wall';
    wall.addEventListener('wall:state', (e) => this.onState(e.detail));
    wall.addEventListener('wall:status', (e) => this.onStatus(e.detail));
    wall.addEventListener('wall:clip', (e) => this.markClip(e.detail));
    wall.addEventListener('click', (e) => {
      const r = wall.getBoundingClientRect();
      this.send({ kind: 'moment', value: 'bloom', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    });
    this.viewSlot.prepend(wall);
    this.wall = wall;
    if (!this.relay) this.onStatus('offline');
  }

  buildClips() {
    const clips = (this.config.clips || []).filter((c) => c && c.src);
    const group = this.querySelector('[data-group="clip"]');
    this.clipsEl.textContent = '';
    if (clips.length < 2) return;
    clips.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wall-remote__chip';
      b.dataset.act = 'clip';
      b.dataset.value = String(i);
      b.setAttribute('aria-pressed', 'false');
      b.textContent = c.title || `Clip ${i + 1}`;
      this.clipsEl.append(b);
    });
    group.hidden = false;
  }

  /* ---------------- what the relay says ---------------- */

  onStatus(s) {
    if (s === 'offline') {
      this.setStatus(this.relay ? "Can't reach the shop right now" : 'Showing the wall (the remote is off)');
      this.dataset.state = 'offline';
      this.setControls(false);
    } else if (s === 'connecting' && this.dataset.state !== 'live') {
      this.setStatus('Connecting to the shop…');
    }
  }

  onState(snap) {
    this.snap = snap;
    const s = snap.state;
    if (s.locked) {
      this.dataset.state = 'locked';
      this.setStatus('Live in the shop · the remote is resting');
    } else if (!snap.open) {
      this.dataset.state = 'closed';
      this.setStatus('Live in the shop · closed for now, the remote works in opening hours');
    } else {
      this.dataset.state = 'live';
      this.setStatus('Live in the shop now');
    }
    this.setControls(this.dataset.state === 'live');
    // Mark what is showing: the visitors' choice where one stands, else the wall's own.
    const d = this.config.defaults || {};
    const pick = (v, x) => (v === null || v === undefined ? x : v);
    const theme = pick(s.theme, d.theme || 'house');
    const weather = pick(s.weather, d.weather || 'none');
    for (const b of this.querySelectorAll('[data-act="theme"]')) b.setAttribute('aria-pressed', String(b.dataset.value === theme));
    for (const b of this.querySelectorAll('[data-act="weather"]')) b.setAttribute('aria-pressed', String(b.dataset.value === weather));
    for (const b of this.querySelectorAll('[data-act="look"]')) {
      const on = !!pick(s.look && s.look[b.dataset.value], d.look && d.look[b.dataset.value]);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  markClip(i) {
    for (const b of this.querySelectorAll('[data-act="clip"]')) b.setAttribute('aria-pressed', String(b.dataset.value === String(i)));
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  setControls(on) {
    this.enabled = on;
    const waiting = Date.now() < this.until;
    for (const b of this.querySelectorAll('[data-act]')) b.disabled = !on || waiting;
    this.classList.toggle('is-disabled', !on);
  }

  /* ---------------- sending ---------------- */

  act(b) {
    const kind = b.dataset.act;
    const value = b.dataset.value;
    if (kind === 'look') this.send({ kind, value, on: b.getAttribute('aria-pressed') !== 'true' });
    else if (kind === 'clip') this.send({ kind, value: Number(value) });
    else this.send({ kind, value });
  }

  async send(act) {
    if (!this.relay || !this.enabled || Date.now() < this.until) return;
    this.cooldown(1500); // until the relay answers
    let res;
    let body = {};
    try {
      res = await fetch(`${this.relay}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(act),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      this.until = 0;
      this.waitEl.textContent = "That didn't reach the shop. Try again in a moment.";
      this.setControls(this.enabled);
      return;
    }
    if (res.ok || res.status === 429) {
      this.cooldown(body.retryIn || 20000);
    } else {
      this.until = 0;
      this.setControls(this.enabled);
      if (res.status === 423) this.waitEl.textContent = 'The remote is resting right now.';
    }
  }

  cooldown(ms) {
    this.until = Date.now() + ms;
    this.setControls(this.enabled);
    clearInterval(this.waitTimer);
    const tick = () => {
      const left = Math.ceil((this.until - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(this.waitTimer);
        this.waitEl.textContent = '';
        this.setControls(this.enabled);
        return;
      }
      this.waitEl.textContent = ms > 2000 ? `Sent to the shop. Ready again in ${left}s` : 'Sending…';
    };
    tick();
    this.waitTimer = setInterval(tick, 500);
  }
}

if (!customElements.get('duet-wall-remote')) customElements.define('duet-wall-remote', DuetWallRemote);
