/**
 * Frontline combat sparks (mockup A `emitBorderSparks` / `borderBoom`): short streaks that fly off the
 * frontlines — more where the neighbours are evenly matched, mostly into the weaker side — and small
 * skirmish booms (an expanding ring + a spray of streaks). No glow puff and no white fill, but a boom's ring and
 * pale streak heads are bright, so every boom asks the flash budget as an ambient flash (`AMBIENT_RESERVE`: news
 * flashes always keep a slot): granted → the bright look (`BOOM_BRIGHT`), denied → the same boom, dim
 * (`BOOM_DIM`: unit colours only, ≤ 40 % alpha, a smaller ring). The booms never stop, so the battle stays alive.
 * One fixed pool of particles on a ParticleContainer, pooled rings drawn into a dynamic mesh; nothing is
 * allocated per frame.
 */
import { Container, Particle, ParticleContainer, type Texture } from 'pixi.js';
import { AMBIENT_RESERVE, type FlashBudget } from '../fx/flashBudget';
import { CORE } from './layout';
import type { Planet } from './planet';
import { colorGain, hexColor } from './color';
import { createDynMesh } from './dynMesh';
import { rgba, strokeCircle } from './meshBuild';

export interface Sparks {
  readonly container: Container;
  /** spawn this frame's sparks along a planet's frontlines (`px` = world units per screen pixel, `now` = flash-budget clock) */
  emit(p: Planet, dt: number, px: number, reduced: boolean, now: number): void;
  update(dt: number, px: number): void;
  /** total pool size multiplier (quality level 3 halves particles) */
  setScale(scale: number): void;
  destroy(): void;
}

interface Spark {
  p: Particle;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  w: number;
  /** alpha multiplier (dim booms) */
  a: number;
}

interface Ring {
  x: number;
  y: number;
  r1: number;
  t: number;
  dur: number;
  color: number;
  w: number;
  /** alpha multiplier (dim booms) */
  a: number;
}

/** How a boom looks: ring radius (× its size), alpha multiplier, share of pale streaks, spray speed multiplier. */
export interface BoomStyle {
  ring: number;
  alpha: number;
  pale: number;
  spread: number;
}
/** a boom the flash budget granted */
export const BOOM_BRIGHT: Readonly<BoomStyle> = { ring: 1.7, alpha: 1, pale: 0.3, spread: 1 };
/** a denied boom: still there, but no near-white, ≤ 40 % of the alpha, a smaller ring and spray */
export const BOOM_DIM: Readonly<BoomStyle> = { ring: 1.1, alpha: 0.4, pale: 0, spread: 0.7 };

const MAX_SPARKS = 520;
const MAX_RINGS = 40;
const STREAK_W = 32;
const STREAK_H = 3;
const PALE = 0xe6f7ff;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** `flashes`: the app-wide flash budget (booms ask it as ambient flashes); null = every boom dim */
export function createSparks(streak: Texture, flashes: Pick<FlashBudget, 'request'> | null = null): Sparks {
  const container = new Container({ label: 'sparks' });
  container.eventMode = 'none';
  const pc = new ParticleContainer({ texture: streak, dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
  pc.blendMode = 'add';
  const rings = createDynMesh({ label: 'spark-rings', blendMode: 'add' });
  container.addChild(rings.mesh, pc);

  const pool: Spark[] = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    const p = new Particle({ texture: streak, anchorX: 1, anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
    pc.addParticle(p);
    pool.push({ p, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, w: 1, a: 1 });
  }
  let cap = MAX_SPARKS;
  let cursor = 0;
  let alive = 0;
  const ringList: Ring[] = [];
  const ringPool: Ring[] = [];
  /** spark / boom accumulators per planet, per frontline key */
  const acc = new Map<string, Map<string, { spark: number; boom: number; seen: number }>>();
  let frame = 0;
  let ringsShown = false;

  function spawn(x: number, y: number, vx: number, vy: number, life: number, color: number, w: number, a = 1) {
    // round-robin over the pool: when full, the oldest spark is recycled
    for (let n = 0; n < cap; n++) {
      const s = pool[cursor];
      cursor = (cursor + 1) % cap;
      if (s.life > 0 && n < cap - 1) continue;
      if (s.life <= 0) alive++;
      s.x = x;
      s.y = y;
      s.vx = vx;
      s.vy = vy;
      s.life = s.max = life;
      s.w = w;
      s.a = a;
      s.p.tint = color;
      return;
    }
  }

  function burst(x: number, y: number, color: number, n: number, speed: number, life: number, look: Readonly<BoomStyle>, alpha: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed * look.spread;
      spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1) * life, Math.random() < look.pale ? PALE : color, rand(1, 2.4), alpha);
    }
  }

  return {
    container,
    emit(planet, dt, px, reduced, now) {
      const R = planet.slot.r;
      const sizeF = clamp(R / px / 140, 0.15, 2.2);
      const rate = reduced ? 0.15 : 1;
      frame++;
      let pa = acc.get(planet.id);
      if (!pa) {
        pa = new Map();
        acc.set(planet.id, pa);
      }
      for (const b of planet.lines) {
        let a = pa.get(b.key);
        if (!a) {
          a = { spark: Math.random(), boom: Math.random() * 0.5, seen: frame };
          pa.set(b.key, a);
        }
        a.seen = frame;
        const prevC = hexColor(b.prev.color);
        const curC = hexColor(b.cur.color);
        a.spark += (1.5 + 22 * b.fierce * b.fierce) * sizeF * dt * rate * (cap / MAX_SPARKS);
        while (a.spark >= 1) {
          a.spark -= 1;
          const rho = rand(CORE + 0.05, 0.99);
          const ang = planet.borderAt(b.k, rho);
          const x = planet.x + Math.cos(ang) * rho * R;
          const y = planet.y + Math.sin(ang) * rho * R;
          const dir = Math.random() < 0.5 + 0.38 * b.push ? 1 : -1; // mostly into the weaker side
          const tx = -Math.sin(ang) * dir;
          const ty = Math.cos(ang) * dir;
          const sp = rand(25, 120) * px * Math.sqrt(sizeF);
          const j = rand(-0.9, 0.9);
          const r = Math.random();
          spawn(x, y, (tx + Math.cos(ang) * j) * sp, (ty + Math.sin(ang) * j) * sp, rand(0.2, 0.6), r < 0.4 ? prevC : r < 0.8 ? curC : PALE, rand(0.8, 2));
        }
        if (reduced) continue;
        a.boom += (0.12 + 0.9 * b.fierce) * Math.sqrt(sizeF) * dt;
        if (a.boom >= 1) {
          a.boom = -Math.random() * 0.8;
          const rho = rand(0.3, 0.95);
          const ang = planet.borderAt(b.k, rho);
          const x = planet.x + Math.cos(ang) * rho * R;
          const y = planet.y + Math.sin(ang) * rho * R;
          const color = Math.random() < 0.5 ? prevC : curC;
          const sz = rand(9, 20) * Math.sqrt(sizeF) * px;
          // the bright part of a boom is a flash: ask the budget, and boom dimly when it says no
          const look = flashes && flashes.request(1, now, AMBIENT_RESERVE) > 0 ? BOOM_BRIGHT : BOOM_DIM;
          // pale org colours (xAI, Luma…) would read as near-white: a dim boom of theirs is fainter still
          const alpha = look === BOOM_DIM ? look.alpha * colorGain(color) : look.alpha;
          if (ringList.length < MAX_RINGS) {
            const r = ringPool.pop() ?? { x: 0, y: 0, r1: 0, t: 0, dur: 0.5, color: 0, w: 1.5, a: 1 };
            r.x = x;
            r.y = y;
            r.r1 = sz * look.ring;
            r.t = 0;
            r.dur = 0.5;
            r.color = color;
            r.w = look === BOOM_DIM ? 1.2 : 1.5;
            r.a = alpha;
            ringList.push(r);
          }
          burst(x, y, color, 6 + Math.floor(Math.random() * 6), 110 * Math.sqrt(sizeF) * px, 0.6, look, alpha);
        }
      }
      // forget accumulators of frontlines that no longer exist
      if (frame % 120 === 0) for (const m of acc.values()) for (const [k, v] of m) if (frame - v.seen > 60) m.delete(k);
    },
    update(dt, px) {
      const damp = 1 - Math.min(1, dt * 2.6);
      if (alive > 0) {
        alive = 0;
        for (let i = 0; i < pool.length; i++) {
          const s = pool[i];
          const p = s.p;
          if (s.life <= 0) {
            if (p.alpha !== 0) {
              p.alpha = 0;
              p.scaleX = p.scaleY = 0;
            }
            continue;
          }
          s.life -= dt;
          if (s.life <= 0 || i >= cap) {
            s.life = 0;
            p.alpha = 0;
            p.scaleX = p.scaleY = 0;
            continue;
          }
          alive++;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.vx *= damp;
          s.vy *= damp;
          const f = s.life / s.max;
          const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
          p.x = s.x;
          p.y = s.y;
          p.rotation = Math.atan2(s.vy, s.vx);
          p.scaleX = Math.max(1.5 * px, v * 0.045) / STREAK_W;
          p.scaleY = (s.w * (0.5 + 0.5 * f) * px) / STREAK_H;
          p.alpha = f * s.a;
        }
      }
      if (!ringList.length && !ringsShown) return;
      rings.begin();
      for (let i = ringList.length - 1; i >= 0; i--) {
        const r = ringList[i];
        r.t += dt;
        const e = r.t / r.dur;
        if (e >= 1) {
          ringPool.push(r);
          ringList[i] = ringList[ringList.length - 1];
          ringList.pop();
          continue;
        }
        const ease = 1 - Math.pow(1 - e, 3);
        strokeCircle(rings.buf, r.x, r.y, Math.max(0.1 * px, 2 * px + (r.r1 - 2 * px) * ease), (r.w * (1 - e) + 0.5) * px, rgba(r.color, (1 - e) * 0.75 * r.a));
      }
      rings.end();
      ringsShown = ringList.length > 0;
    },
    setScale(scale) {
      cap = clamp(Math.round(MAX_SPARKS * scale), 16, MAX_SPARKS);
      cursor %= cap;
    },
    destroy() {
      acc.clear();
      ringList.length = 0;
      rings.destroy();
      container.destroy({ children: true });
    },
  };
}
