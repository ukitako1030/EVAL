/**
 * Frontline combat sparks (mockup A `emitBorderSparks` / `borderBoom`): short streaks that fly off the
 * frontlines — more where the neighbours are evenly matched, mostly into the weaker side — and small
 * skirmish bursts (an expanding ring + a spray of streaks). Bursts are deliberately not light flashes:
 * no glow puff and no white fill, so they never brighten an area (the flash budget stays free for events).
 * One fixed pool of particles on a ParticleContainer; nothing is allocated per frame.
 */
import { Container, Graphics, Particle, ParticleContainer, type Texture } from 'pixi.js';
import { CORE } from './layout';
import type { Planet } from './planet';
import { hexColor } from './color';

export interface Sparks {
  readonly container: Container;
  /** spawn this frame's sparks along a planet's frontlines (`px` = world units per screen pixel) */
  emit(p: Planet, dt: number, px: number, reduced: boolean): void;
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
}

interface Ring {
  x: number;
  y: number;
  r1: number;
  t: number;
  dur: number;
  color: number;
  w: number;
}

const MAX_SPARKS = 520;
const MAX_RINGS = 40;
const STREAK_W = 32;
const STREAK_H = 3;
const PALE = 0xe6f7ff;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createSparks(streak: Texture): Sparks {
  const container = new Container({ label: 'sparks' });
  container.eventMode = 'none';
  const pc = new ParticleContainer({ texture: streak, dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
  pc.blendMode = 'add';
  const rings = new Graphics();
  rings.blendMode = 'add';
  container.addChild(rings, pc);

  const pool: Spark[] = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    const p = new Particle({ texture: streak, anchorX: 1, anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
    pc.addParticle(p);
    pool.push({ p, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, w: 1 });
  }
  let cap = MAX_SPARKS;
  let cursor = 0;
  let alive = 0;
  const ringList: Ring[] = [];
  const acc = new Map<string, { spark: number; boom: number; seen: number }>();
  let frame = 0;

  function spawn(x: number, y: number, vx: number, vy: number, life: number, color: number, w: number) {
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
      s.p.tint = color;
      return;
    }
  }

  function burst(x: number, y: number, color: number, n: number, speed: number, life: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1) * life, Math.random() < 0.3 ? PALE : color, rand(1, 2.4));
    }
  }

  return {
    container,
    emit(planet, dt, px, reduced) {
      const R = planet.slot.r;
      const sizeF = clamp(R / px / 140, 0.15, 2.2);
      const rate = reduced ? 0.15 : 1;
      frame++;
      for (const b of planet.lines) {
        const key = planet.id + ':' + b.key;
        let a = acc.get(key);
        if (!a) {
          a = { spark: Math.random(), boom: Math.random() * 0.5, seen: frame };
          acc.set(key, a);
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
          if (ringList.length < MAX_RINGS) ringList.push({ x, y, r1: sz * 1.7, t: 0, dur: 0.5, color, w: 1.5 });
          burst(x, y, color, 6 + Math.floor(Math.random() * 6), 110 * Math.sqrt(sizeF) * px, 0.6);
        }
      }
      // forget accumulators of frontlines that no longer exist
      if (frame % 120 === 0) for (const [k, v] of acc) if (frame - v.seen > 60) acc.delete(k);
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
          const v = Math.hypot(s.vx, s.vy);
          p.x = s.x;
          p.y = s.y;
          p.rotation = Math.atan2(s.vy, s.vx);
          p.scaleX = Math.max(1.5 * px, v * 0.045) / STREAK_W;
          p.scaleY = (s.w * (0.5 + 0.5 * f) * px) / STREAK_H;
          p.alpha = f;
        }
      }
      rings.clear();
      for (let i = ringList.length - 1; i >= 0; i--) {
        const r = ringList[i];
        r.t += dt;
        const e = r.t / r.dur;
        if (e >= 1) {
          ringList.splice(i, 1);
          continue;
        }
        const ease = 1 - Math.pow(1 - e, 3);
        rings.circle(r.x, r.y, Math.max(0.1 * px, 2 * px + (r.r1 - 2 * px) * ease)).stroke({ width: (r.w * (1 - e) + 0.5) * px, color: r.color, alpha: (1 - e) * 0.75 });
      }
    },
    setScale(scale) {
      cap = clamp(Math.round(MAX_SPARKS * scale), 16, MAX_SPARKS);
      cursor %= cap;
    },
    destroy() {
      acc.clear();
      ringList.length = 0;
      container.destroy({ children: true });
    },
  };
}
