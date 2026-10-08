/**
 * Draws a swarm simulation (./swarm) inside a planet: every particle is a short additive streak along its
 * velocity (length ∝ speed × the unit's trail, so strong units leave longer tails — no fade layer, no
 * full-screen white), elite particles and raiders get a soft glow, each swarm sits on a faint nebula of
 * its colour, and clashes throw sparks in both sides' colours. Pixel sizes are converted with `px`
 * (world units per screen pixel); positions are planet-local world units (normalised × R).
 * Fixed pools on ParticleContainers, typed arrays for the sparks: nothing is allocated per frame.
 */
import { Container, Particle, ParticleContainer, Sprite, type Texture } from 'pixi.js';
import { MAX_UNITS, ALIVE, FADING, mulberry32, type Swarm } from './swarm';
import { colorGain, mixColor } from './color';

export interface SwarmLook {
  /** org colour per slot */
  readonly color: Uint32Array;
  /** 0..1 overall opacity (fades with the camera) */
  vis: number;
  /** under prefers-reduced-motion: fewer sparks */
  reduced: boolean;
}

export interface SwarmView {
  readonly container: Container;
  draw(sim: Swarm, R: number, px: number, look: SwarmLook, dt: number): void;
  /** a spray of sparks at a normalised point (shockwaves, warp-ins) */
  burst(x: number, y: number, color: number, n: number, speedPx: number, life: number): void;
  /** forget all sparks (the battle moved to another planet) */
  clear(): void;
  destroy(): void;
}

const STREAK_W = 32;
const STREAK_H = 3; // the bright core of the 32 × 8 streak texture
const GLOW = 64;
const MAX_SPARKS = 1400;
const GLOW_SHARE = 0.3;
/** tails are drawn this much longer than the mockup's (speed × trail) — reads better at planet scale */
const TAIL = 1.3;

export function createSwarmView(capacity: number, tex: { streak: Texture; glow: Texture }): SwarmView {
  const container = new Container({ label: 'swarm' });
  container.eventMode = 'none';
  const nebula = new Container({ label: 'swarm-nebula' });
  const streaks = new ParticleContainer({ texture: tex.streak, dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
  const glows = new ParticleContainer({ texture: tex.glow, dynamicProperties: { position: true, rotation: false, vertex: true, color: true } });
  const sparkPc = new ParticleContainer({ texture: tex.streak, dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
  for (const pc of [streaks, glows, sparkPc]) pc.blendMode = 'add';
  container.addChild(nebula, streaks, glows, sparkPc);

  const parts: Particle[] = [];
  for (let i = 0; i < capacity; i++) {
    const p = new Particle({ texture: tex.streak, anchorX: 1, anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
    streaks.addParticle(p);
    parts.push(p);
  }
  const glowN = Math.ceil(capacity * GLOW_SHARE);
  const glowParts: Particle[] = [];
  for (let i = 0; i < glowN; i++) {
    const p = new Particle({ texture: tex.glow, anchorX: 0.5, anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
    glows.addParticle(p);
    glowParts.push(p);
  }
  let glowUsed = 0;
  const clouds: Sprite[] = [];
  for (let s = 0; s < MAX_UNITS; s++) {
    const sp = new Sprite({ texture: tex.glow, anchor: 0.5 });
    sp.blendMode = 'add';
    sp.visible = false;
    nebula.addChild(sp);
    clouds.push(sp);
  }

  // sparks: typed-array ring buffer (normalised coords / s), drawn on fixed particles
  const sx = new Float32Array(MAX_SPARKS);
  const sy = new Float32Array(MAX_SPARKS);
  const svx = new Float32Array(MAX_SPARKS);
  const svy = new Float32Array(MAX_SPARKS);
  const sl = new Float32Array(MAX_SPARKS);
  const sml = new Float32Array(MAX_SPARKS);
  const sw = new Float32Array(MAX_SPARKS);
  const sparks: Particle[] = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    const p = new Particle({ texture: tex.streak, anchorX: 1, anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
    sparkPc.addParticle(p);
    sparks.push(p);
  }
  let head = 0;
  let sparkLive = 0;
  const rnd = mulberry32(0x5a4c);
  // per-slot cached colours (lit streak / pale spark head), recomputed only when the colour or strength moves
  const litKey = new Float32Array(MAX_UNITS).fill(-1);
  const litCol = new Uint32Array(MAX_UNITS);
  const raidCol = new Uint32Array(MAX_UNITS);
  const paleCol = new Uint32Array(MAX_UNITS);
  /** pale org colours (xAI, Luma…) would read as white: their particles are drawn fainter */
  const gain = new Float32Array(MAX_UNITS).fill(1);
  const colKey = new Uint32Array(MAX_UNITS);
  /** normalised units per screen pixel of the last draw (spark speeds are given in px/s) */
  let unitPx = 0.004;

  function addSpark(x: number, y: number, vx: number, vy: number, life: number, color: number, w: number) {
    const k = head;
    head = (head + 1) % MAX_SPARKS;
    if (sl[k] <= 0) sparkLive++;
    sx[k] = x;
    sy[k] = y;
    svx[k] = vx;
    svy[k] = vy;
    sl[k] = sml[k] = life;
    sw[k] = w;
    sparks[k].tint = color;
  }

  function burst(x: number, y: number, color: number, n: number, speedPx: number, life: number) {
    const pale = mixColor(color, 0xffffff, 0.45);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const v = (0.35 + rnd() * 0.65) * speedPx * unitPx;
      addSpark(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.5 + rnd() * 0.5), k % 3 === 0 ? pale : color, 1 + rnd());
    }
  }

  function updateColors(sim: Swarm, look: SwarmLook) {
    const u = sim.units;
    for (let s = 0; s < MAX_UNITS; s++) {
      if (u.id[s] === null) continue;
      const c = look.color[s];
      const key = Math.round(u.sN[s] * 50);
      if (litKey[s] === key && colKey[s] === c) continue;
      litKey[s] = key;
      colKey[s] = c;
      const sN = u.sN[s];
      litCol[s] = mixColor(c, 0xffffff, 0.12 + 0.3 * sN * sN);
      raidCol[s] = mixColor(c, 0xffffff, 0.45);
      paleCol[s] = mixColor(c, 0xffffff, 0.4);
      gain[s] = colorGain(c);
    }
  }

  return {
    container,
    burst,
    draw(sim, R, px, look, dt) {
      const u = sim.units;
      const vis = look.vis;
      unitPx = px / Math.max(1e-6, R);
      updateColors(sim, look);
      const sr = R / px;
      const lw = Math.min(2.2, Math.max(1.1, sr / 170)); // streak width in screen px
      const minLen = 3 * px;
      // clash sparks of the last step (mockup C `clash`): colours of both sides, a pale head — never white
      const cl = sim.clashes;
      const rate = look.reduced ? 0.25 : 1;
      const sc = Math.min(1.1, Math.max(0.4, sr / 300));
      for (let q = 0; q < cl.n; q++) {
        if (rnd() > rate) continue;
        const n = 2 + Math.floor(rnd() * (2 + cl.close[q] * 5));
        const wc = look.color[cl.win[q]];
        const lc = look.color[cl.lose[q]];
        for (let k = 0; k < n; k++) {
          const a = rnd() * Math.PI * 2;
          const v = (40 + rnd() * 150) * sc * unitPx;
          addSpark(cl.x[q], cl.y[q], Math.cos(a) * v, Math.sin(a) * v, 0.22 + rnd() * 0.35, k === 0 ? paleCol[cl.win[q]] : k & 1 ? lc : wc, 1.1);
        }
      }

      // particles
      const n = sim.capacity;
      glowUsed = 0;
      for (let i = 0; i < n; i++) {
        const p = parts[i];
        const st = sim.state[i];
        if ((st !== ALIVE && st !== FADING) || vis <= 0.001) {
          if (p.alpha !== 0) {
            p.alpha = 0;
            p.scaleX = p.scaleY = 0;
          }
          continue;
        }
        const s = sim.owner[i];
        const vx = sim.vx[i];
        const vy = sim.vy[i];
        const v = Math.sqrt(vx * vx + vy * vy);
        const raid = st === ALIVE && sim.charge[i] > 0 && sim.alpha[i] > 0.5;
        const bright = u.bright[s];
        const fogDim = 1 - 0.5 * u.fog[s];
        const a = sim.alpha[i] * fogDim * gain[s] * vis;
        p.x = sim.x[i] * R;
        p.y = sim.y[i] * R;
        p.rotation = Math.atan2(vy, vx);
        p.scaleX = Math.max(minLen, v * u.trail[s] * TAIL * (raid ? 2.4 : 1) * R) / STREAK_W;
        p.scaleY = (lw * (raid ? 1.4 : 1) * px) / STREAK_H;
        p.tint = raid ? raidCol[s] : litCol[s];
        p.alpha = Math.min(1, (raid ? 1.25 : 1.05) * bright) * a;
        // elites and raiders glow (mockup: seed < 9 %)
        if ((raid || sim.seed[i] < 0.09) && glowUsed < glowN) {
          const g = glowParts[glowUsed++];
          g.x = p.x;
          g.y = p.y;
          g.scaleX = g.scaleY = (2 * lw * (raid ? 5.5 : 3.5 + 5 * u.sN[s]) * px) / GLOW;
          g.tint = look.color[s];
          g.alpha = a * bright * (raid ? 0.7 : 0.42);
        }
      }
      for (let k = glowUsed; k < glowN; k++) {
        const g = glowParts[k];
        if (g.alpha === 0) break; // the tail of the pool is already hidden
        g.alpha = 0;
        g.scaleX = g.scaleY = 0;
      }

      // nebula: a faint cloud of the unit's colour around each swarm
      for (let s = 0; s < MAX_UNITS; s++) {
        const c = clouds[s];
        const alive = u.alive[s];
        if (!u.present[s] || alive < 3 || vis <= 0.001) {
          c.visible = false;
          continue;
        }
        c.visible = true;
        c.position.set(u.cx[s] * R, u.cy[s] * R);
        const spread = Math.min(0.75, 0.16 + Math.sqrt(alive / Math.max(1, sim.visible)) * 0.62);
        c.width = c.height = spread * R * 2.4;
        c.tint = look.color[s];
        c.alpha = (0.1 + 0.14 * u.sN[s]) * (1 - 0.5 * u.fog[s]) * gain[s] * vis;
      }

      // sparks
      const drag = Math.exp(-2.8 * dt);
      if (sparkLive > 0) {
        sparkLive = 0;
        for (let k = 0; k < MAX_SPARKS; k++) {
          const p = sparks[k];
          if (sl[k] <= 0) continue;
          sl[k] -= dt;
          if (sl[k] <= 0 || vis <= 0.001) {
            sl[k] = 0;
            p.alpha = 0;
            p.scaleX = p.scaleY = 0;
            continue;
          }
          sparkLive++;
          sx[k] += svx[k] * dt;
          sy[k] += svy[k] * dt;
          svx[k] *= drag;
          svy[k] *= drag;
          const f = sl[k] / sml[k];
          const v = Math.sqrt(svx[k] * svx[k] + svy[k] * svy[k]) * R;
          p.x = sx[k] * R;
          p.y = sy[k] * R;
          p.rotation = Math.atan2(svy[k], svx[k]);
          p.scaleX = Math.max(1.5 * px, v * 0.035) / STREAK_W;
          p.scaleY = (sw[k] * (0.5 + 0.5 * f) * px) / STREAK_H;
          p.alpha = (f > 0.55 ? 0.8 : 0.5 + 0.55 * f) * f * vis;
        }
      }
    },
    clear() {
      for (let k = 0; k < MAX_SPARKS; k++) {
        sl[k] = 0;
        sparks[k].alpha = 0;
        sparks[k].scaleX = sparks[k].scaleY = 0;
      }
      sparkLive = 0;
      for (const c of clouds) c.visible = false;
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
