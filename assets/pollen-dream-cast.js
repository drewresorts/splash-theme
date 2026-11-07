/**
 * Pollen Dream's characters: the letters of DUET.
 *
 * The visitor plays the D, seen from behind (the garden's camera rides
 * behind it: explorer.third, see garden-splash.js updateExplore). The U,
 * the E and the T are out in the fields, a short walk from where the D
 * starts, each idling, turning to watch the D come near and now and then
 * waving. Walk up to one and say hi (assets/pollen-dream.js shows the
 * prompt: the E key, or the Say hi button): it waves, says something, and
 * joins the D, following along behind. With all three found, the four line
 * up as D U E T and wave.
 *
 * The models are the letters' own .glb files beside this one, each a
 * letter one unit tall standing on its feet, rigged, with Idle, Walk, Wave
 * and Jump animations. Everything here runs as a garden explore hook, so
 * it moves with the garden's own frame; addCast() returns the cast, with
 * what the screen needs to show (prompt, say) and talk() for saying hi.
 */
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './three-gltf-loader.js';

const FILES = { D: 'pollen-dream-letter-d.glb', U: 'pollen-dream-letter-u.glb', E: 'pollen-dream-letter-e.glb', T: 'pollen-dream-letter-t.glb' };
const ORDER = ['D', 'U', 'E', 'T'];
// Where the others wait, from where the D starts, when nothing else puts them anywhere (the world,
// assets/pollen-dream-world.js, hides them in its places): [angle off straight ahead (radians, left positive), distance in garden spans].
const PLACES = { U: [0.75, 0.75], E: [-1.15, 0.95], T: [2.7, 1.25] };
// What each says on being found: the first line, or the second if it is the last of the three.
const LINES = {
  U: ['Ahoy, D! You found me. I’m coming with you.', 'Ahoy, D! That’s all of us. Now we can spell something.'],
  E: ['You climbed all the way up here? Let’s go!', 'You climbed all the way up! Now we can spell something.'],
  T: ['That was the right tune. Let’s go!', 'The right tune! That’s all of us. Now we can spell something.'],
};
const DONE = 'D · U · E · T';
const REACH = 1.6; // how near (in letter heights) to say hi
const FLOOR_Z = -45; // the garden's ground plane (garden-splash.js FLOOR_Z)

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const turn = (from, to, k) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
// A heading as the garden's explorer uses them: forward is (-sin h, cos h).
const headingOf = (dx, dy) => Math.atan2(-dx, dy);

/* One letter in the world: its model, its animations, where it stands and which way it faces. */
class Letter {
  constructor(name, gltf, size, garden) {
    this.name = name;
    this.size = size;
    this.root = new THREE.Group();
    // Turned to its heading last, so a lean (rotation.x) tips it forward whichever way it faces.
    this.root.rotation.order = 'ZXY';
    const model = gltf.scene;
    // The file is Y-up with the letter's face toward +Z; the garden is Z-up. Stood up, its face is toward -Y,
    // so a half turn more points it along the heading (see place()).
    model.rotation.x = Math.PI / 2;
    model.scale.setScalar(size);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      // Lit like the garden's own flowers (its plastic, shiny material), in the letter's own colors: its
      // painted texture where it has one (kept, not disposed, with the old material), else its flat color.
      if (garden && garden.makeMaterial) {
        const old = o.material;
        o.material = garden.makeMaterial({ color: old.color.clone(), map: old.map || null, shininess: 60, specular: 0x333333, flatShading: false });
        old.map = null;
        old.dispose();
      }
    });
    this.root.add(model);
    // A soft shadow on the ground under it, so it stands on the land rather than floating over it.
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(size * 0.42, 20), new THREE.MeshBasicMaterial({ color: 0x0b1a12, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.renderOrder = 1;
    this.shadow = shadow;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    if (this.actions.Wave) {
      this.actions.Wave.setLoop(THREE.LoopOnce, 1);
      this.actions.Wave.clampWhenFinished = false;
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.actions.Wave) this.waving = false;
    });
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.heading = 0;
    this.current = null;
    this.play('Idle', 0);
  }

  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || this.current === next) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  wave() {
    const w = this.actions.Wave;
    if (!w) return;
    const prev = this.current;
    this.waving = true;
    w.reset().setEffectiveWeight(1).play();
    if (prev && prev !== w) w.crossFadeFrom(prev, 0.2, false);
    this.current = w;
  }

  /* Its pose for this frame: walking at a pace (0 standing), up in the air or not. */
  pose(pace, airborne, dt) {
    if (!this.waving) {
      if (airborne) this.play('Jump', 0.2);
      else if (pace > 12) this.play('Walk', 0.2);
      else this.play('Idle', 0.35);
    }
    if (this.actions.Walk) this.actions.Walk.timeScale = clamp(pace / (this.size * 1.6), 0.6, 2.4);
    this.mixer.update(dt);
  }

  place(groundZ) {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.z = this.heading + Math.PI;
    this.shadow.position.set(this.x, this.y, groundZ + 0.6);
    const lift = clamp((this.z - groundZ) / (this.size * 6), 0, 1);
    this.shadow.material.opacity = 0.22 * (1 - lift);
    this.shadow.scale.setScalar(1 - lift * 0.5);
  }
}

/*
 * Loads the letters and puts them in the garden while exploring. Resolves
 * to the cast once the D is in; the others join as they load.
 */
export async function addCast(garden, base) {
  const loader = new GLTFLoader();
  const url = (f) => new URL(f, base).href;
  const loads = Object.fromEntries(ORDER.map((n) => [n, loader.loadAsync(url(FILES[n]))]));
  const E = garden.explorer;
  if (!E) return null;
  const size = E.eye * 1.25;
  const group = new THREE.Group();
  garden.scene.add(group);
  const ground = (x, y) => FLOOR_Z + garden.hillAt(x, y);
  // Where something at height z stands at (x, y): on whatever is under it there (the world's own decks and
  // platforms, or the water, which the letters wade on), else the land.
  const floorAt = (x, y, z) => (garden.exploreFloor ? garden.exploreFloor(x, y, z) : ground(x, y));
  const span = Math.max(garden.w, garden.h);
  // Where the D starts (the end of the glide down from the page), and straight ahead from there.
  const start = E.to || { x: E.x, y: E.y };
  const cast = {
    group,
    letters: {},
    prompt: null,
    say: null,
    found: [],
    done: false,
    lineup: 0,
    talk: () => talk(),
    remove: () => remove(),
    // A line on screen for a few seconds (the world's hints and puzzles use it too).
    tell: (text, seconds = 3.5, who = '') => {
      cast.say = { who, text, until: clock + seconds };
    },
  };

  const add = (name, gltf) => {
    const L = new Letter(name, gltf, size, garden);
    group.add(L.root, L.shadow);
    cast.letters[name] = L;
    return L;
  };

  const D = add('D', await loads.D);
  if (!garden.explorer) return remove();
  // From now on the camera rides behind the D, a little above; it looks down on it a touch to begin with.
  // A tall, narrow screen (a phone) shows little side to side: the camera stands farther back there.
  const portrait = garden.w < garden.h;
  const third = size * 2.9 * (portrait ? 1.45 : 1);
  E.third = third;
  if (E.intro < 1 && E.to) E.to.pitch = -0.24;
  D.heading = E.yaw;

  for (const name of ['U', 'E', 'T']) {
    loads[name]
      .then((gltf) => {
        if (!garden.explorer || cast.removed) return;
        const L = add(name, gltf);
        const [a, d] = PLACES[name];
        const h = (start.yaw || 0) + a;
        L.x = start.x - Math.sin(h) * span * d;
        L.y = start.y + Math.cos(h) * span * d;
        L.z = ground(L.x, L.y);
        L.heading = headingOf(start.x - L.x, start.y - L.y);
        L.state = 'waiting';
        L.nextWave = 2 + Math.random() * 4;
        L.place(L.z);
      })
      .catch((e) => console.error('pollen-dream: the letter ' + name + ' could not load', e));
  }

  let clock = 0;
  let lastX = E.x;
  let lastY = E.y;

  const hook = (dt, ex) => {
    if (!ex || cast.removed) return;
    clock += dt;
    // The D: on the visitor's feet, turned toward where it is going.
    const feet = ex.z - ex.eye;
    const gz = ground(ex.x, ex.y);
    const vx = (ex.x - lastX) / Math.max(dt, 1e-4);
    const vy = (ex.y - lastY) / Math.max(dt, 1e-4);
    lastX = ex.x;
    lastY = ex.y;
    const pace = ex.intro < 1 ? 0 : Math.hypot(vx, vy);
    const airborne = ex.mode !== 'walk' ? ex.mode === 'lift' || ex.mode === 'fly' : !ex.grounded && feet - gz > size * 0.15;
    if (pace > 12 && ex.mode !== 'lift') D.heading = turn(D.heading, headingOf(vx, vy), 1 - Math.exp(-dt * 10));
    else if (cast.lineup > 0) D.heading = turn(D.heading, ex.yaw + Math.PI, 1 - Math.exp(-dt * 6));
    D.x = ex.x;
    D.y = ex.y;
    D.z = feet;
    D.root.visible = ex.intro > 0.55;
    D.shadow.visible = D.root.visible;
    D.pose(ex.mode === 'glide' ? 0 : pace, airborne, dt);
    // Gliding down, it leans into the air a little.
    D.root.rotation.x = ex.mode === 'glide' ? 0.18 : 0;
    D.place(gz);

    // Lining up, the camera slides along to the middle of the word, and back after.
    cast.panK = lerp(cast.panK || 0, cast.lineup > 0 ? 1 : 0, 1 - Math.exp(-dt * 2));
    const panBy = size * 1.25 * 1.5 * cast.panK;
    ex.pan = cast.panK > 0.001 ? { x: Math.cos(ex.yaw) * panBy, y: Math.sin(ex.yaw) * panBy } : null;
    // And steps back to fit the four in (a long way on a phone).
    ex.third = third * (1 + cast.panK * (portrait ? 1.3 : 0.15));

    // The others.
    let near = null;
    const followers = cast.found.map((n) => cast.letters[n]);
    if (cast.lineup > 0) cast.lineup -= dt;
    for (const name of ['U', 'E', 'T']) {
      const L = cast.letters[name];
      if (!L) continue;
      const dx = D.x - L.x;
      const dy = D.y - L.y;
      const dist = Math.hypot(dx, dy);
      // Only what is at about the same height counts as near (not a letter up on a platform overhead).
      const level = Math.abs(D.z - L.z) < size * 0.9;
      let lpace = 0;
      // Hidden away (shut in somewhere, see the world): not seen, not met.
      L.root.visible = !L.hidden;
      L.shadow.visible = !L.hidden;
      if (L.hidden) {
        L.mixer.update(dt);
        continue;
      }
      if (L.state === 'waiting') {
        // Turns to watch the D come near, and waves now and then once it is close.
        if (dist < span * 0.7) L.heading = turn(L.heading, headingOf(dx, dy), 1 - Math.exp(-dt * 3));
        L.nextWave -= dt;
        if (dist < span * 0.4 && L.nextWave <= 0 && !L.waving) {
          L.wave();
          L.nextWave = 5 + Math.random() * 4;
        }
        if (level && dist < size * REACH && ex.intro >= 1 && (!near || dist < near.dist)) near = { name, dist };
        // Nobody walks through anybody.
        const min = size * 0.75;
        if (level && dist < min && dist > 1e-3) {
          ex.x = L.x + (dx / dist) * min;
          ex.y = L.y + (dy / dist) * min;
        }
      } else {
        // With the D: in a line behind it (or, all found, beside it to show the word), catching up if left behind.
        const slot = followers.indexOf(L) + 1;
        let tx;
        let ty;
        let face = null;
        if (cast.lineup > 0) {
          // Lined up across the view from the D, in order, all facing the camera: D U E T.
          const k = ORDER.indexOf(name);
          const rx = Math.cos(ex.yaw);
          const ry = Math.sin(ex.yaw);
          tx = D.x + rx * size * 1.25 * k;
          ty = D.y + ry * size * 1.25 * k;
          face = ex.yaw + Math.PI;
        } else {
          const back = D.heading;
          tx = D.x + Math.sin(back) * size * 1.3 * slot;
          ty = D.y - Math.cos(back) * size * 1.3 * slot;
        }
        const ox = tx - L.x;
        const oy = ty - L.y;
        const gap = Math.hypot(ox, oy);
        if (gap > span * 1.4 && ex.mode === 'walk') {
          // Left far behind (the D flew off on the wind): it turns up behind again, out of the way.
          L.x = tx - Math.sin(D.heading + Math.PI) * size;
          L.y = ty + Math.cos(D.heading + Math.PI) * size;
        } else if (gap > size * 0.2) {
          // Hurrying into the line-up; otherwise keeping pace with the D, faster when far behind.
          const speed = Math.min(gap * (cast.lineup > 0 ? 5 : 3), size * (gap > span * 0.3 ? 9 : cast.lineup > 0 ? 7 : 4.5));
          L.x += (ox / gap) * speed * dt;
          L.y += (oy / gap) * speed * dt;
          lpace = speed;
          L.heading = turn(L.heading, headingOf(ox, oy), 1 - Math.exp(-dt * 8));
        }
        if (face !== null && gap < size * 0.9) L.heading = turn(L.heading, face, 1 - Math.exp(-dt * 7));
      }
      L.z = floorAt(L.x, L.y, L.z);
      L.pose(lpace, false, dt);
      L.place(L.z);
    }
    cast.prompt = near ? near.name : null;
    if (cast.say && clock > cast.say.until) cast.say = null;
    // All found: once they have caught up, the line-up.
    if (!cast.done && cast.found.length === 3) {
      const caught = followers.every((L) => Math.hypot(L.x - D.x, L.y - D.y) < size * 5);
      // After the last one has had its say.
      if (caught && ex.mode === 'walk' && !cast.say) {
        cast.done = true;
        cast.lineup = 7;
        cast.say = { who: '', text: DONE, until: clock + 7, done: true };
        window.setTimeout(() => {
          if (cast.removed) return;
          for (const n of ORDER) cast.letters[n] && cast.letters[n].wave();
        }, 1400);
      }
    }
  };

  function talk() {
    const name = cast.prompt;
    const L = name && cast.letters[name];
    if (!L || L.state !== 'waiting') return false;
    L.state = 'with';
    L.wave();
    D.wave();
    cast.found.push(name);
    const lines = LINES[name];
    const last = cast.found.length === 3;
    cast.say = { who: name, text: last ? lines[1] : lines[0], until: clock + 3.2 };
    cast.prompt = null;
    return true;
  }

  function remove() {
    cast.removed = true;
    const i = garden.exploreHooks ? garden.exploreHooks.indexOf(hook) : -1;
    if (i >= 0) garden.exploreHooks.splice(i, 1);
    garden.scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material)
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
    });
    if (garden.explorer) {
      garden.explorer.third = 0;
      garden.explorer.pan = null;
    }
    return null;
  }

  garden.exploreHooks.push(hook);
  return cast;
}
