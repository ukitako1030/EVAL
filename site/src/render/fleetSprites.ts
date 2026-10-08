/**
 * How a fleet ship looks (mockup A `drawFleets`): an org-coloured arrowhead with a soft glow and a short engine
 * trail, drawn additively. A fixed pool of particles — one trail / glow / body set behind the planets and one in
 * front — indexed by ship slot; trails come from a small per-slot ring buffer of past positions. Allocation-free
 * per frame.
 */
import { CanvasSource, Container, Particle, ParticleContainer, Texture } from 'pixi.js';
import type { Galaxy } from './galaxy';
import { glowTexture } from './bgTextures';

export interface ShipView {
  x: number;
  y: number;
  /** heading (any length) */
  hx: number;
  hy: number;
  /** on the far side of its planet: drawn behind it, dimmer */
  behind: boolean;
  /** fade 0..1 */
  alpha: number;
}

export interface FleetSprites {
  /** forget slot `i`'s trail (the ship jumped) */
  resetTrail(i: number): void;
  /** record where slot `i` is now (call every frame it moves) */
  track(i: number, x: number, y: number, dt: number): void;
  /** `emph` = org highlight multiplier, `px` = world units per screen pixel, `sz` = ship size (world units) */
  draw(i: number, s: ShipView, color: number, gain: number, emph: number, px: number, sz: number): void;
  hide(i: number): void;
  destroy(): void;
}

const HN = 8;
const HIST_DT = 0.022;
const DART_W = 32;
const DART_H = 20;
const STREAK_W = 32;
const STREAK_H = 4;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  draw(g);
  return new Texture({ source: new CanvasSource({ resource: c, resolution: 1 }) });
}

export function createFleetSprites(galaxy: Galaxy, n: number): FleetSprites {
  // arrowhead pointing +x (mockup A ship: nose 1.4 sz ahead, notched tail 1 sz behind)
  const dart = canvasTexture(DART_W, DART_H, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(31, 10);
    g.lineTo(1, 1);
    g.lineTo(9.5, 10);
    g.lineTo(1, 19);
    g.closePath();
    g.fill();
  });
  // engine trail: transparent tail → bright head at the right edge
  const streak = canvasTexture(STREAK_W, STREAK_H, (g) => {
    const gr = g.createLinearGradient(0, 0, STREAK_W, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 1, STREAK_W, 2);
  });
  const glow = glowTexture();
  const GLOW_W = glow.width;
  const textures = [streak, glow, dart];
  const anchors = [1, 0.5, 0.42];

  const layer = (label: string) => {
    const c = new Container({ label });
    c.eventMode = 'none';
    const pcs = textures.map((texture) => {
      const pc = new ParticleContainer({ texture, dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
      pc.blendMode = 'add';
      c.addChild(pc);
      return pc;
    });
    return { c, pcs };
  };
  const back = layer('fleets-behind');
  const front = layer('fleets');
  galaxy.layers.behind.addChild(back.c);
  galaxy.layers.front.addChild(front.c);

  /** parts[i * 6 + layer * 3 + j]: layer 0 behind / 1 front; j = trail, glow, body */
  const parts: Particle[] = [];
  for (let i = 0; i < n; i++)
    for (const L of [back, front])
      L.pcs.forEach((pc, j) => {
        const p = new Particle({ texture: textures[j], anchorX: anchors[j], anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
        pc.addParticle(p);
        parts.push(p);
      });
  /** lit layer per slot (−1 none) and the colour its particles carry */
  const lit = new Int8Array(n).fill(-1);
  const tint = new Float64Array(n).fill(-1);
  const hist = new Float32Array(n * HN * 2);
  const hi = new Uint8Array(n);
  const hn = new Uint8Array(n);
  const hacc = new Float64Array(n);

  function hide(i: number) {
    const L = lit[i];
    if (L >= 0) for (let j = 0; j < 3; j++) parts[i * 6 + L * 3 + j].alpha = 0;
    lit[i] = -1;
  }

  return {
    resetTrail(i) {
      hn[i] = 0;
      hacc[i] = 0;
    },
    track(i, x, y, dt) {
      hacc[i] += dt;
      if (hacc[i] < HIST_DT && hn[i] > 0) return;
      hacc[i] = hn[i] === 0 ? 0 : hacc[i] % HIST_DT;
      const k = (i * HN + hi[i]) * 2;
      hist[k] = x;
      hist[k + 1] = y;
      hi[i] = (hi[i] + 1) % HN;
      hn[i] = Math.min(HN, hn[i] + 1);
    },
    draw(i, s, color, gain, emph, px, sz) {
      const L = s.behind ? 0 : 1;
      if (L !== lit[i] || tint[i] !== color) {
        hide(i);
        for (let j = 0; j < 3; j++) parts[i * 6 + L * 3 + j].tint = color;
        lit[i] = L;
        tint[i] = color;
      }
      const boost = Math.max(0, emph - 1);
      const a = s.alpha * (s.behind ? 0.45 : 1) * Math.min(1, emph);
      const trail = parts[i * 6 + L * 3];
      const halo = parts[i * 6 + L * 3 + 1];
      const body = parts[i * 6 + L * 3 + 2];
      body.x = halo.x = trail.x = s.x;
      body.y = halo.y = trail.y = s.y;
      body.rotation = Math.atan2(s.hy, s.hx);
      body.scaleX = (2.4 * sz * (1 + 0.2 * boost)) / DART_W;
      body.scaleY = (1.5 * sz * (1 + 0.2 * boost)) / DART_H;
      body.alpha = a * (0.6 + 0.4 * gain);
      halo.scaleX = halo.scaleY = (5.6 * sz * (1 + 0.4 * boost)) / GLOW_W;
      halo.alpha = 0.6 * a * gain * (1 + 1.2 * boost);
      if (hn[i] > 1) {
        const k = (i * HN + ((hi[i] - hn[i] + HN) % HN)) * 2;
        const dx = s.x - hist[k];
        const dy = s.y - hist[k + 1];
        const len = Math.sqrt(dx * dx + dy * dy);
        trail.rotation = Math.atan2(dy, dx);
        trail.scaleX = len / STREAK_W;
        trail.scaleY = ((1.6 + 0.6 * boost) * px) / (STREAK_H / 2);
        trail.alpha = len > 0.6 * px ? 0.8 * a * (0.6 + 0.4 * gain) : 0;
      } else trail.alpha = 0;
    },
    hide,
    destroy() {
      back.c.destroy({ children: true });
      front.c.destroy({ children: true });
      for (const t of textures) t.destroy(true);
    },
  };
}
