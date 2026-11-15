/*
 * Shop wall relay: the go-between for the projected wall in the shop
 * (theme page "wall", assets/duet-wall.js) and the hidden remote on the
 * blog page (sections/duet-wall-remote.liquid).
 *
 * Visitors send small, validated changes (POST /act); the wall and every
 * open remote hear about them at once (GET /events, server-sent events).
 * Nobody can send text, files or anything outside the fixed lists below.
 * Each visitor may make one change per COOLDOWN_SECONDS, every change wears
 * off after CHANGE_MINUTES, and control only works during OPEN_HOURS unless
 * staff lock it from /admin.
 *
 * No dependencies: `node server.mjs`. Settings come from environment
 * variables (see streaming/README.md).
 */
import http from 'node:http';
import crypto from 'node:crypto';

const env = process.env;
const PORT = Number(env.PORT) || 8787;
const ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const ADMIN_TOKEN = env.ADMIN_TOKEN || '';
const COOLDOWN = (Number(env.COOLDOWN_SECONDS) || 20) * 1000;
const HOLD = (Number(env.CHANGE_MINUTES) || 4) * 60 * 1000;
const TIMEZONE = env.SHOP_TIMEZONE || 'UTC';
const HOURS = parseHours(env.OPEN_HOURS || '');
const MAX_STREAMS = Number(env.MAX_VIEWERS) || 3000;
const MAX_STREAMS_PER_IP = 6;

/* What visitors may choose from. The theme uses the same names. */
const THEMES = ['house', 'camo', 'cotton-candy', 'circus', 'neon', 'tropical', 'noir'];
const LOOKS = ['ps1', 'dither', 'mirror', 'trails'];
const WEATHER = ['none', 'petals', 'snow', 'pollen', 'rain'];
const MOMENTS = ['bloom', 'bee', 'gust'];
const MAX_CLIPS = 60;

/* null means "the wall's own setting". */
const fresh = () => ({
  theme: null,
  look: { ps1: null, dither: null, mirror: null, trails: null },
  weather: null,
  clip: 0,
  clipStart: Date.now(),
  locked: false,
  last: null,
});
let state = fresh();
const expires = new Map(); // 'theme' | 'weather' | 'look.ps1' ... -> time it wears off

/* ---------------- opening hours ---------------- */

/*
 * "mon-fri 10:00-18:00, sat 11:00-17:00, sun 12:00-16:00", in SHOP_TIMEZONE.
 * Empty means always open.
 */
function parseHours(text) {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const rules = [];
  for (const part of text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const m = part.match(/^([a-z]{3})(?:-([a-z]{3}))?\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!m || !days.includes(m[1]) || (m[2] && !days.includes(m[2]))) {
      console.warn(`OPEN_HOURS: can't read "${part}", ignoring it`);
      continue;
    }
    const from = days.indexOf(m[1]);
    const to = m[2] ? days.indexOf(m[2]) : from;
    const set = new Set();
    for (let d = from; ; d = (d + 1) % 7) {
      set.add(d);
      if (d === to) break;
    }
    rules.push({ days: set, start: +m[3] * 60 + +m[4], end: +m[5] * 60 + +m[6] });
  }
  return rules;
}

const clock = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function isOpen(now = new Date()) {
  if (!HOURS.length) return true;
  const parts = Object.fromEntries(clock.formatToParts(now).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const minutes = +parts.hour * 60 + +parts.minute;
  return HOURS.some((r) => r.days.has(day) && minutes >= r.start && minutes < r.end);
}

/* ---------------- broadcasting ---------------- */

const streams = new Set();
const streamsByIp = new Map();

function snapshot() {
  return { state, open: isOpen(), cooldown: COOLDOWN, hold: HOLD, now: Date.now() };
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of streams) send(res, event, data);
}

const publish = () => broadcast('state', snapshot());

/* Changes wear off; opening and closing are announced as they happen. */
let wasOpen = isOpen();
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [key, at] of expires) {
    if (at > now) continue;
    expires.delete(key);
    if (key.startsWith('look.')) state.look[key.slice(5)] = null;
    else state[key] = null;
    changed = true;
  }
  const open = isOpen();
  if (open !== wasOpen) {
    wasOpen = open;
    changed = true;
  }
  if (changed) publish();
}, 2000);

/* Keeps idle connections alive through proxies. */
setInterval(() => {
  for (const res of streams) res.write(': ping\n\n');
}, 25000);

/* ---------------- requests ---------------- */

function clientIp(req) {
  const direct = req.socket.remoteAddress || '';
  const local = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  const forwarded = local && req.headers['x-forwarded-for'];
  return forwarded ? String(forwarded).split(',')[0].trim() : direct;
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (!ORIGINS.length || ORIGINS.includes(origin)) return origin;
  return null;
}

function cors(req, res) {
  const origin = allowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2048) {
        req.destroy();
        resolve(null);
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const lastAction = new Map(); // ip -> time
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN;
  for (const [ip, at] of lastAction) if (at < cutoff) lastAction.delete(ip);
}, 60000);

const LABELS = {
  house: 'house colors',
  camo: 'Camo Fatigues',
  'cotton-candy': 'Cotton Candy',
  circus: 'Circus',
  neon: 'Neon',
  tropical: 'Tropical',
  noir: 'Noir',
  ps1: 'PS1',
  dither: 'dither',
  mirror: 'mirror',
  trails: 'trails',
  none: 'clear skies',
  petals: 'petals',
  snow: 'snow',
  pollen: 'pollen',
  rain: 'rain',
  bloom: 'a bloom',
  bee: 'a bee',
  gust: 'a gust of wind',
};

/* Checks one visitor action and applies it. Returns an error string or null. */
function apply(act) {
  if (!act || typeof act !== 'object') return 'bad request';
  const { kind, value } = act;
  const now = Date.now();
  let label = '';
  if (kind === 'theme') {
    if (!THEMES.includes(value)) return 'unknown theme';
    state.theme = value;
    expires.set('theme', now + HOLD);
    label = LABELS[value];
  } else if (kind === 'look') {
    if (!LOOKS.includes(value) || typeof act.on !== 'boolean') return 'unknown look';
    state.look[value] = act.on;
    expires.set(`look.${value}`, now + HOLD);
    label = `${LABELS[value]} ${act.on ? 'on' : 'off'}`;
  } else if (kind === 'weather') {
    if (!WEATHER.includes(value)) return 'unknown weather';
    state.weather = value;
    expires.set('weather', now + HOLD);
    label = LABELS[value];
  } else if (kind === 'clip') {
    if (!Number.isInteger(value) || value < 0 || value >= MAX_CLIPS) return 'unknown clip';
    state.clip = value;
    state.clipStart = now;
    label = 'clip';
  } else if (kind === 'moment') {
    if (!MOMENTS.includes(value)) return 'unknown moment';
    const x = Number(act.x);
    const y = Number(act.y);
    const at = { kind: value, at: now };
    if (value === 'bloom') {
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return 'bad position';
      at.x = Math.round(x * 1000) / 1000;
      at.y = Math.round(y * 1000) / 1000;
    }
    broadcast('moment', at);
    label = LABELS[value];
  } else {
    return 'unknown action';
  }
  state.last = { kind, value: kind === 'clip' ? value : value, label, at: now };
  publish();
  return null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Wall controls</title>
<style>body{font:15px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#191f6b;max-width:30rem;margin:2rem auto;padding:0 1rem}button,input{font:inherit;padding:.6rem .9rem;border:1px solid currentColor;background:#fff;color:inherit}button{cursor:pointer;margin:.3rem .3rem 0 0}input{width:100%;box-sizing:border-box}#s{margin-top:1rem;white-space:pre-wrap}</style></head>
<body><h1>WALL CONTROLS</h1><p>Staff only. Lock stops visitors changing the wall; reset puts it back to its own settings.</p>
<label>Staff password<br><input id="t" type="password" autocomplete="current-password"></label>
<div><button data-a="lock">Lock</button><button data-a="unlock">Unlock</button><button data-a="reset">Reset</button></div><div id="s"></div>
<script>
const t=document.getElementById('t'),s=document.getElementById('s');
try{t.value=localStorage.getItem('wall-admin')||''}catch(e){}
const show=()=>fetch('state').then(r=>r.json()).then(d=>{s.textContent=(d.state.locked?'LOCKED':'Visitors can change the wall')+(d.open?'':' (outside opening hours)')});
document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{try{localStorage.setItem('wall-admin',t.value)}catch(e){}
const r=await fetch('admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t.value,action:b.dataset.a})});
if(!r.ok){s.textContent='Wrong password';return}show()});show();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://relay');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && path === '/health') return reply(res, 200, { ok: true });

  if (req.method === 'GET' && path === '/state') return reply(res, 200, snapshot());

  if (req.method === 'GET' && path === '/events') {
    const ip = clientIp(req);
    const mine = streamsByIp.get(ip) || 0;
    if (streams.size >= MAX_STREAMS || mine >= MAX_STREAMS_PER_IP) return reply(res, 503, { error: 'busy' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    send(res, 'state', snapshot());
    streams.add(res);
    streamsByIp.set(ip, mine + 1);
    req.on('close', () => {
      streams.delete(res);
      const n = (streamsByIp.get(ip) || 1) - 1;
      if (n > 0) streamsByIp.set(ip, n);
      else streamsByIp.delete(ip);
    });
    return;
  }

  if (req.method === 'POST' && path === '/act') {
    if (ORIGINS.length && !allowedOrigin(req)) return reply(res, 403, { error: 'origin' });
    if (state.locked) return reply(res, 423, { error: 'locked' });
    if (!isOpen()) return reply(res, 423, { error: 'closed' });
    const ip = clientIp(req);
    const since = Date.now() - (lastAction.get(ip) || 0);
    if (since < COOLDOWN) return reply(res, 429, { error: 'wait', retryIn: COOLDOWN - since });
    const act = await readJson(req);
    const error = apply(act);
    if (error) return reply(res, 400, { error });
    lastAction.set(ip, Date.now());
    return reply(res, 200, { ok: true, retryIn: COOLDOWN });
  }

  if (req.method === 'GET' && path === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(ADMIN_PAGE);
  }

  if (req.method === 'POST' && path === '/admin') {
    const body = await readJson(req);
    if (!ADMIN_TOKEN || !body || !safeEqual(body.token, ADMIN_TOKEN)) return reply(res, 403, { error: 'password' });
    if (body.action === 'lock') state.locked = true;
    else if (body.action === 'unlock') state.locked = false;
    else if (body.action === 'reset') {
      const { clip, clipStart, locked } = state;
      state = Object.assign(fresh(), { clip, clipStart, locked });
      expires.clear();
    } else return reply(res, 400, { error: 'action' });
    publish();
    return reply(res, 200, { ok: true });
  }

  reply(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`wall relay on :${PORT}; origins: ${ORIGINS.join(', ') || 'any'}; hours: ${env.OPEN_HOURS || 'always'} (${TIMEZONE})`);
  if (!ADMIN_TOKEN) console.warn('ADMIN_TOKEN is not set: the staff lock is disabled');
});
