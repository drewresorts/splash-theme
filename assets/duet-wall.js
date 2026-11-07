/*
 * <duet-wall>: the shop wall. Plays the playlist of prerecorded clips with
 * the visitors' changes drawn over it: a color theme (gradient-mapped onto
 * the video), looks (PS1, dither, mirror, trails), weather, and moments
 * (a bloom where they tapped, a bee crossing, a gust of wind).
 *
 * The same element runs in two places:
 * - data-role="wall": the projector page (sections/duet-wall.liquid).
 * - data-role="preview": the window in the hidden remote on the blog page
 *   (sections/duet-wall-remote.liquid), which shows what is on the wall now.
 * Both follow the relay (streaming/wall-relay) and compute the playlist
 * position from the same anchor, so the preview matches the wall without
 * any video being streamed.
 *
 * Config (JSON in a child <script type="application/json" data-wall-config>,
 * or set as element.config before it connects):
 *   relay: 'https://wall.example.com' or ''
 *   clips: [{ title, src, duration (seconds), poster }]
 *   defaults: { theme, weather, look: { ps1, dither, mirror, trails } }
 *   sound: bool (wall only)
 *
 * Events: 'wall:state' (detail: relay snapshot), 'wall:status'
 * (detail: 'connecting' | 'live' | 'offline').
 */
import { SCHEMES } from './duet-schemes.js';

const HOUSE = ['#191F6B', '#A62749', '#F04E62', '#66A4C8', '#B9E5FB'];
const LOOKS = ['ps1', 'dither', 'mirror', 'trails'];
const TINT = 0.6;
const TRAIL = 0.8;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - (1 - t) ** 3;

/* A theme's colors: the flower colors, and four steps dark to light for the gradient map. */
function themeColors(name) {
  const t = SCHEMES[name];
  const flowers = (t ? [t.center, ...t.palette] : HOUSE).map(rgb);
  const all = t ? [...flowers, rgb(t.foliage), rgb(t.accent)] : flowers;
  const sorted = all.slice().sort((a, b) => luma(a) - luma(b));
  const pick = (f) => sorted[Math.round(f * (sorted.length - 1))];
  return { flowers, steps: [pick(0), pick(0.35), pick(0.7), pick(1)], tint: t ? TINT : 0 };
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uOver;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform vec2 uCover;
uniform float uHasVideo;
uniform float uPs1;
uniform float uDither;
uniform float uMirror;
uniform float uTrail;
uniform float uTint;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

vec3 gradient(float l) {
  l = clamp(l, 0.0, 1.0) * 3.0;
  if (l < 1.0) return mix(uC0, uC1, l);
  if (l < 2.0) return mix(uC1, uC2, l - 1.0);
  return mix(uC2, uC3, l - 2.0);
}

void main() {
  vec2 grid = uPs1 > 0.5 ? vec2(320.0, floor(320.0 * uRes.y / uRes.x)) : uRes;
  vec2 cell = floor(vUv * grid) + 0.5;
  vec2 uv = cell / grid;
  vec2 vuv = uv;
  if (uMirror > 0.5) vuv.x = vuv.x < 0.5 ? vuv.x : 1.0 - vuv.x;
  vuv = (vuv - 0.5) * uCover + 0.5;
  vec3 col = uHasVideo > 0.5 ? texture2D(uVideo, vec2(vuv.x, 1.0 - vuv.y)).rgb : vec3(1.0);
  if (uTint > 0.0) col = mix(col, gradient(dot(col, vec3(0.299, 0.587, 0.114))), uTint);
  vec4 over = texture2D(uOver, vec2(uv.x, 1.0 - uv.y));
  col = col * (1.0 - over.a) + over.rgb;
  if (uDither > 0.5) {
    vec2 p = uPs1 > 0.5 ? cell : floor(gl_FragCoord.xy / 2.0);
    col = floor(col * 5.0 + bayer4(p)) / 5.0;
  } else if (uPs1 > 0.5) {
    col = floor(col * 31.0 + 0.5) / 31.0;
  }
  col = mix(col, texture2D(uPrev, vUv).rgb, uTrail);
  gl_FragColor = vec4(col, 1.0);
}`;

const COPY = `
precision mediump float;
uniform sampler2D uPrev;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uPrev, vUv); }`;

class DuetWall extends HTMLElement {
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    let cfg = this.config;
    if (!cfg) {
      try {
        cfg = JSON.parse(this.querySelector('[data-wall-config]').textContent);
      } catch (e) {
        cfg = {};
      }
    }
    this.role = this.dataset.role === 'preview' ? 'preview' : 'wall';
    this.relay = (cfg.relay || '').replace(/\/+$/, '');
    this.clips = (cfg.clips || []).filter((c) => c && c.src);
    this.defaults = Object.assign({ theme: 'house', weather: 'none' }, cfg.defaults);
    this.defaults.look = Object.assign({ ps1: false, dither: false, mirror: false, trails: false }, cfg.defaults && cfg.defaults.look);
    this.sound = this.role === 'wall' && !!cfg.sound;
    this.remote = { theme: null, weather: null, look: {}, clip: 0, clipStart: Date.now(), last: null };
    this.offset = 0; // server clock minus ours
    this.durations = this.clips.map((c) => (c.duration > 0 ? c.duration : 0));
    this.current = -1;
    this.particles = [];
    this.moments = [];
    this.gust = 0;
    this.seenLast = 0;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.build();
    this.applyLook();
    this.connect();
    this.syncTimer = setInterval(() => this.sync(), 1000);
    this.sync();
    this.last = performance.now();
    this.frame = requestAnimationFrame((t) => this.tick(t));
    if (this.role === 'wall') this.bindWall();
  }

  disconnectedCallback() {
    this.started = false;
    cancelAnimationFrame(this.frame);
    clearInterval(this.syncTimer);
    clearTimeout(this.retry);
    if (this.source) this.source.close();
    if (this.resizer) this.resizer.disconnect();
    if (this.video) this.video.removeAttribute('src');
  }

  /* ---------------- setup ---------------- */

  build() {
    this.classList.add('duet-wall');
    const video = document.createElement('video');
    video.className = 'duet-wall__video';
    video.muted = !this.sound;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    video.addEventListener('ended', () => this.sync(true));
    // A host that doesn't allow its video to be drawn with effects refuses the
    // request outright: play it plain instead.
    video.addEventListener('error', () => {
      if (!video.hasAttribute('crossorigin') || !video.currentSrc) return;
      console.warn('duet-wall: this video host does not allow effects; playing it plain');
      video.removeAttribute('crossorigin');
      this.plain();
      const at = this.position();
      this.current = -1;
      if (at) this.sync();
    });
    video.addEventListener('loadedmetadata', () => {
      if (this.current >= 0 && !this.durations[this.current]) this.durations[this.current] = video.duration || 30;
    });
    this.video = video;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'duet-wall__canvas';
    this.over = document.createElement('canvas');
    this.over.className = 'duet-wall__over';
    this.octx = this.over.getContext('2d');
    this.note = document.createElement('p');
    this.note.className = 'duet-wall__note';
    this.note.setAttribute('aria-live', 'polite');
    this.append(video, this.canvas, this.over, this.note);

    this.gl = this.setupGL();
    this.toggleAttribute('data-css', !this.gl);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this);
    this.resize();
  }

  setupGL() {
    const gl = this.canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = (frag) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i).name;
        u[name] = gl.getUniformLocation(p, name);
      }
      return { p, u };
    };
    try {
      this.main = program(FRAG);
      this.copy = program(COPY);
    } catch (e) {
      console.warn('duet-wall: falling back to plain video', e);
      return null;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const texture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      return t;
    };
    this.tVideo = texture();
    this.tOver = texture();
    this.targets = [0, 1].map(() => ({ tex: texture(), fbo: gl.createFramebuffer() }));
    this.pingpong = 0;
    return gl;
  }

  resize() {
    const w = Math.max(1, this.clientWidth);
    const h = Math.max(1, this.clientHeight);
    const scale = Math.min(window.devicePixelRatio || 1, this.role === 'wall' ? 1 : 1.5);
    const cw = Math.min(1920, Math.round(w * scale));
    const ch = Math.round((cw * h) / w);
    this.canvas.width = cw;
    this.canvas.height = ch;
    // Moments and weather are drawn small: they go through the same pixel look as the video.
    this.over.width = Math.min(640, cw);
    this.over.height = Math.round((this.over.width * h) / w);
    const gl = this.gl;
    if (!gl) return;
    for (const t of this.targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* The projector: click once for full screen (and sound, if it is on); the cursor hides. */
  bindWall() {
    const go = () => {
      if (this.sound) this.video.muted = false;
      this.video.play().catch(() => {});
      if (!document.fullscreenElement && this.requestFullscreen) this.requestFullscreen().catch(() => {});
    };
    this.addEventListener('click', go);
    let idle;
    this.addEventListener('pointermove', () => {
      this.classList.add('is-pointing');
      clearTimeout(idle);
      idle = setTimeout(() => this.classList.remove('is-pointing'), 2000);
    });
  }

  /* ---------------- relay ---------------- */

  connect() {
    if (!this.relay || !window.EventSource) return this.status('offline');
    this.status('connecting');
    const source = new EventSource(`${this.relay}/events`);
    this.source = source;
    source.addEventListener('state', (e) => {
      let snap;
      try {
        snap = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      this.offset = snap.now - Date.now();
      this.remote = snap.state;
      this.snapshot = snap;
      this.status('live');
      this.applyLook();
      this.sync();
      this.announce(snap.state.last);
      this.dispatchEvent(new CustomEvent('wall:state', { detail: snap }));
    });
    source.addEventListener('moment', (e) => {
      try {
        this.moment(JSON.parse(e.data));
      } catch (err) {
        /* ignore a malformed message */
      }
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        this.status('offline');
        this.retry = setTimeout(() => this.connect(), 15000);
      } else this.status('connecting');
    };
  }

  status(s) {
    if (this.connection === s) return;
    this.connection = s;
    this.dataset.status = s;
    this.dispatchEvent(new CustomEvent('wall:status', { detail: s }));
  }

  /* What is showing: the visitors' choice where one is in force, else the wall's own. */
  applyLook() {
    const r = this.remote || {};
    const pick = (v, d) => (v === null || v === undefined ? d : v);
    this.theme = pick(r.theme, this.defaults.theme);
    this.weather = pick(r.weather, this.defaults.weather);
    this.look = {};
    for (const k of LOOKS) this.look[k] = !!pick(r.look && r.look[k], this.defaults.look[k]);
    this.colors = themeColors(this.theme);
    if (!this.gl) {
      // Plain video: the closest a CSS filter gets.
      const f = [];
      if (this.theme === 'noir') f.push('grayscale(1) contrast(1.15)');
      else if (this.theme === 'neon') f.push('saturate(2) contrast(1.2)');
      else if (this.theme === 'cotton-candy') f.push('saturate(0.7) brightness(1.1)');
      else if (this.theme === 'camo') f.push('sepia(0.6) hue-rotate(40deg) saturate(0.8)');
      this.video.style.filter = f.join(' ');
    }
  }

  /* A line on the wall when a visitor online changes something. */
  announce(last) {
    if (!last || last.at <= this.seenLast) return;
    const first = !this.seenLast;
    this.seenLast = last.at;
    if (first && Date.now() + this.offset - last.at > 8000) return;
    if (this.role !== 'wall') return;
    const what = {
      theme: `chose ${last.label}`,
      weather: `chose ${last.label}`,
      look: `turned ${last.label}`,
      clip: 'picked this clip',
      moment: `sent ${last.label}`,
    }[last.kind];
    if (!what) return;
    this.note.textContent = `A visitor online ${what}`;
    this.note.classList.add('is-shown');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.note.classList.remove('is-shown'), 6000);
  }

  /* ---------------- playlist ---------------- */

  /* Which clip, and how far in, the anchor puts us at now. */
  position() {
    const n = this.clips.length;
    if (!n) return null;
    const d = (i) => this.durations[i] || 30;
    let i = (this.remote.clip || 0) % n;
    let t = Math.max(0, (Date.now() + this.offset - (this.remote.clipStart || 0)) / 1000);
    let total = 0;
    for (let k = 0; k < n; k++) total += d(k);
    t %= total;
    for (let guard = 0; t >= d(i) && guard < n * 2; guard++) {
      t -= d(i);
      i = (i + 1) % n;
    }
    return { i, t };
  }

  sync(force) {
    const at = this.position();
    if (!at) return;
    const v = this.video;
    if (at.i !== this.current) {
      this.current = at.i;
      const clip = this.clips[at.i];
      v.poster = clip.poster || '';
      v.src = clip.src;
      const start = () => {
        if (at.t > 0.5 && at.t < (v.duration || Infinity) - 0.5) v.currentTime = at.t;
        v.play().catch(() => {});
      };
      v.addEventListener('loadedmetadata', start, { once: true });
      this.dataset.clip = String(at.i);
      this.dispatchEvent(new CustomEvent('wall:clip', { detail: at.i }));
      return;
    }
    if (v.readyState < 1 || v.seeking) return;
    // Keep to the shared timeline: the preview drifts more than the wall.
    const drift = Math.abs(v.currentTime - at.t);
    if (drift > (this.role === 'wall' ? 3 : 2) && at.t < (v.duration || Infinity) - 1) v.currentTime = at.t;
    if (v.paused || force) v.play().catch(() => {});
  }

  /* ---------------- moments and weather ---------------- */

  moment(m) {
    if (!m || !m.kind) return;
    const now = performance.now();
    if (m.kind === 'gust') {
      this.gust = 1;
      return;
    }
    if (m.kind === 'bloom') {
      const n = 10 + ((Math.random() * 6) | 0);
      this.moments.push({ kind: 'bloom', x: m.x, y: m.y, t0: now, life: 3200, n, spin: Math.random() * Math.PI, colors: this.colors.flowers });
      return;
    }
    if (m.kind === 'bee') {
      const fromLeft = Math.random() < 0.5;
      this.moments.push({ kind: 'bee', t0: now, life: 7000, fromLeft, y: 0.25 + Math.random() * 0.5, wobble: Math.random() * 6 });
    }
  }

  /* Bloom at a point, as a visitor's own tap does in the preview before the relay echoes it. */
  bloomAt(x, y) {
    this.moment({ kind: 'bloom', x, y });
  }

  spawnWeather(dt) {
    const kind = this.weather;
    const rates = { petals: 10, snow: 40, pollen: 22, rain: 120 };
    const rate = rates[kind] || 0;
    if (!rate || this.reduced) return;
    const W = this.over.width;
    const H = this.over.height;
    let count = rate * dt * (W / 640);
    while (count > 0 && this.particles.length < 600) {
      if (count < 1 && Math.random() > count) break;
      count -= 1;
      const c = this.colors.flowers[(Math.random() * this.colors.flowers.length) | 0];
      this.particles.push({
        kind,
        x: Math.random() * W * 1.2 - W * 0.1,
        y: -10,
        vx: kind === 'rain' ? -40 : (Math.random() - 0.5) * 20,
        vy: { petals: 28, snow: 30, pollen: 10, rain: 420 }[kind] * (0.7 + Math.random() * 0.6),
        r: { petals: 3.2, snow: 1.6, pollen: 1, rain: 1 }[kind] * (0.7 + Math.random() * 0.6),
        a: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 3,
        color: kind === 'snow' ? [1, 1, 1] : kind === 'pollen' ? [0.95, 0.66, 0.2] : c,
      });
    }
  }

  drawOverlay(dt, now) {
    const ctx = this.octx;
    const W = this.over.width;
    const H = this.over.height;
    ctx.clearRect(0, 0, W, H);
    this.gust = Math.max(0, this.gust - dt * 0.45);
    const wind = this.gust * 260;

    this.spawnWeather(dt);
    const keep = [];
    for (const p of this.particles) {
      p.x += (p.vx + wind * (p.kind === 'rain' ? 0.4 : 1)) * dt;
      p.y += p.vy * dt + (p.kind === 'pollen' ? Math.sin(now / 700 + p.a) * 6 * dt : 0);
      p.a += p.spin * dt;
      if (p.y > H + 12 || p.x > W + 40) continue;
      keep.push(p);
      if (p.kind === 'rain') {
        ctx.strokeStyle = 'rgba(200,214,236,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 3, p.y - 10);
        ctx.stroke();
      } else if (p.kind === 'petals') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = css(p.color, 0.95);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.6, p.r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = css(p.color, p.kind === 'snow' ? 0.95 : 0.85);
        ctx.fillRect(p.x, p.y, p.r * 2, p.r * 2);
      }
    }
    this.particles = keep;

    // A gust shows as a few streaks across the frame.
    if (this.gust > 0.05) {
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * this.gust})`;
      ctx.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const y = ((k * 0.137 + 0.08) % 1) * H;
        const x = ((now / 3 + k * 211) % (W + 200)) - 100;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 40, y - 6, x + 90, y);
        ctx.stroke();
      }
    }

    const alive = [];
    for (const m of this.moments) {
      const t = (now - m.t0) / m.life;
      if (t >= 1) continue;
      alive.push(m);
      if (m.kind === 'bloom') this.drawBloom(ctx, m, t, W, H);
      else if (m.kind === 'bee') this.drawBee(ctx, m, t, W, H, now);
    }
    this.moments = alive;
  }

  drawBloom(ctx, m, t, W, H) {
    const cx = m.x * W;
    const cy = m.y * H;
    const R = Math.min(W, H) * 0.09;
    const grow = ease(clamp(t / 0.35, 0, 1));
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    const r = R * grow;
    for (let k = 0; k < m.n; k++) {
      const a = m.spin + (k / m.n) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
      ctx.rotate(a);
      ctx.fillStyle = css(m.colors[k % m.colors.length], fade);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = css(m.colors[0], fade);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18 + 1, 0, Math.PI * 2);
    ctx.fill();
    // Pollen thrown outward as it opens.
    ctx.fillStyle = `rgba(242,168,52,${fade})`;
    for (let k = 0; k < 8; k++) {
      const a = m.spin * 2 + k * 0.785;
      const d = R * (0.6 + ease(t) * 0.9);
      ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2);
    }
  }

  drawBee(ctx, m, t, W, H, now) {
    const s = Math.min(W, H) * 0.035;
    const x = m.fromLeft ? -s * 3 + t * (W + s * 6) : W + s * 3 - t * (W + s * 6);
    const y = m.y * H + Math.sin(t * 9 + m.wobble) * H * 0.05;
    ctx.save();
    ctx.translate(x, y);
    if (!m.fromLeft) ctx.scale(-1, 1);
    const flap = Math.sin(now / 25) > 0 ? 1 : 0.4;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.2, -s * 0.9, s * 0.45, s * 0.75 * flap, -0.4, 0, Math.PI * 2);
    ctx.ellipse(s * 0.3, -s * 0.85, s * 0.4, s * 0.65 * flap, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F2A834';
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#191F6B';
    for (const bx of [-0.35, 0.15]) ctx.fillRect(bx * s, -s * 0.6, s * 0.22, s * 1.2);
    ctx.beginPath();
    ctx.arc(s * 0.95, 0, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* Plain video with weather and moments drawn over it: no WebGL effects. */
  plain() {
    this.gl = null;
    this.setAttribute('data-css', '');
    this.applyLook();
  }

  /* ---------------- drawing ---------------- */

  tick(t) {
    this.frame = requestAnimationFrame((n) => this.tick(n));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.role === 'preview' && document.hidden) return;
    this.drawOverlay(dt, t);
    if (this.gl) this.render();
  }

  render() {
    const gl = this.gl;
    const v = this.video;
    const W = this.canvas.width;
    const H = this.canvas.height;
    let hasVideo = 0;
    if (v.readyState >= 2 && v.videoWidth) {
      gl.bindTexture(gl.TEXTURE_2D, this.tVideo);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        hasVideo = 1;
      } catch (e) {
        // The video's host doesn't allow it to be drawn into WebGL: show it plain instead.
        console.warn('duet-wall: video cannot be drawn with effects', e);
        this.plain();
        return;
      }
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.tOver);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.over);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const prev = this.targets[this.pingpong];
    const next = this.targets[1 - this.pingpong];
    this.pingpong = 1 - this.pingpong;

    const { p, u } = this.main;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tVideo);
    gl.uniform1i(u.uVideo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tOver);
    gl.uniform1i(u.uOver, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(u.uPrev, 2);
    const va = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : W / H;
    const ca = W / H;
    gl.uniform2f(u.uCover, va > ca ? ca / va : 1, va > ca ? 1 : va / ca);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uHasVideo, hasVideo);
    gl.uniform1f(u.uPs1, this.look.ps1 ? 1 : 0);
    gl.uniform1f(u.uDither, this.look.dither ? 1 : 0);
    gl.uniform1f(u.uMirror, this.look.mirror ? 1 : 0);
    gl.uniform1f(u.uTrail, this.look.trails && !this.reduced ? TRAIL : 0);
    gl.uniform1f(u.uTint, this.colors.tint);
    const [c0, c1, c2, c3] = this.colors.steps;
    gl.uniform3fv(u.uC0, c0);
    gl.uniform3fv(u.uC1, c1);
    gl.uniform3fv(u.uC2, c2);
    gl.uniform3fv(u.uC3, c3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(this.copy.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.uniform1i(this.copy.u.uPrev, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

if (!customElements.get('duet-wall')) customElements.define('duet-wall', DuetWall);

export { DuetWall, themeColors };
