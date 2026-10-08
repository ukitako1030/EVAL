/**
 * Battle effects inside the zoomed planet (planet-local world units, normalised inputs × R):
 *  - shockwave: coloured rings + radial glints expanding from a swarm, and a soft coloured glow whose
 *    brightness is whatever the flash budget granted (0 = no glow, rings only, dimmer). Never white.
 *  - warp-in: a converging ring, a vertical beam and a horizontal lens streak in the unit's colour
 *    (pale tint at most); the bright part again scales with the granted flash intensity.
 *  - selection reticle around the selected swarm.
 * The caller asks the flash budget; this module only draws what it is told.
 */
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { colorGain, mixColor } from './color';
import { createDynMesh } from './dynMesh';
import { rgba, strokeArc, strokeCircle, strokeSegment } from './meshBuild';

export interface BattleFx {
  readonly container: Container;
  /** shockwave at a normalised point; `grant` = flash intensity granted by the budget (0..maxIntensity) */
  shock(x: number, y: number, color: number, grant: number): void;
  /** warp-in beam at a normalised point */
  warp(x: number, y: number, color: number, grant: number): void;
  update(dt: number, v: FxView): void;
  clear(): void;
  destroy(): void;
}

export interface FxView {
  /** planet radius (world) and world units per screen pixel */
  R: number;
  px: number;
  /** 0..1 overall opacity */
  vis: number;
  time: number;
  reduced: boolean;
  /** selected swarm: normalised centroid, its colour and normalised radius */
  selected: { x: number; y: number; color: number; r: number } | null;
}

interface Fx {
  kind: 'shock' | 'warp';
  x: number;
  y: number;
  color: number;
  pale: number;
  /** < 1 for pale org colours (xAI, Luma…), which would otherwise read as white */
  gain: number;
  grant: number;
  t: number;
  dur: number;
  glow: Sprite;
  beam: Sprite | null;
  flare: Sprite | null;
}

const MAX_FX = 12;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** ring growth; under reduced motion rings appear at their final size and only fade */
const grow = (q: number, reduced: boolean) => (reduced ? 0.6 : easeOut(q));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** soft vertical beam: bright along the centre line, fading to both ends and to the sides */
function beamTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    for (let y = 0; y < 128; y++) {
      const v = 1 - Math.abs(y - 63.5) / 64;
      const a = v * v;
      const gr = g.createLinearGradient(0, 0, 16, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, y, 16, 1);
    }
  }
  return new Texture({ source: new CanvasSource({ resource: c, resolution: 1 }) });
}

export function createBattleFx(glow: Texture): BattleFx {
  const container = new Container({ label: 'battle-fx' });
  container.eventMode = 'none';
  const lines = createDynMesh({ label: 'battle-fx-lines', blendMode: 'add' });
  const sprites = new Container();
  container.addChild(sprites, lines.mesh);
  let drawn = false;
  const beamTex = beamTexture();
  const list: Fx[] = [];
  const spritePool: Sprite[] = [];

  const take = (tex: Texture): Sprite => {
    const s = spritePool.pop() ?? new Sprite({ anchor: 0.5 });
    s.texture = tex;
    s.blendMode = 'add';
    s.rotation = 0;
    s.visible = true;
    sprites.addChild(s);
    return s;
  };
  const give = (s: Sprite | null) => {
    if (!s) return;
    s.visible = false;
    sprites.removeChild(s);
    spritePool.push(s);
  };
  function drop(i: number) {
    const f = list[i];
    give(f.glow);
    give(f.beam);
    give(f.flare);
    list.splice(i, 1);
  }
  function add(kind: Fx['kind'], x: number, y: number, color: number, grant: number) {
    if (list.length >= MAX_FX) drop(0);
    const g = clamp(Number.isFinite(grant) ? grant : 0, 0, 1);
    const f: Fx = {
      kind,
      x,
      y,
      color,
      pale: mixColor(color, 0xffffff, 0.25),
      gain: colorGain(color),
      grant: g,
      t: 0,
      dur: kind === 'shock' ? 1.6 : 1.5,
      glow: take(glow),
      beam: kind === 'warp' ? take(beamTex) : null,
      flare: kind === 'warp' ? take(beamTex) : null,
    };
    // the colours are fixed for the effect's life: tint once (the setters normalise a Color per call)
    f.glow.tint = f.color;
    if (f.beam) f.beam.tint = f.pale;
    if (f.flare) f.flare.tint = f.pale;
    list.push(f);
  }

  return {
    container,
    shock: (x, y, color, grant) => add('shock', x, y, color, grant),
    warp: (x, y, color, grant) => add('warp', x, y, color, grant),
    update(dt, v) {
      const { R, px, vis } = v;
      if (!list.length && !(v.selected && vis > 0.01)) {
        // nothing to draw: leave the (empty) mesh alone
        if (drawn) {
          lines.begin();
          lines.end();
          drawn = false;
        }
        return;
      }
      drawn = true;
      lines.begin();
      const m = lines.buf;
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        f.t += dt;
        const p = f.t / f.dur;
        if (p >= 1) {
          drop(i);
          continue;
        }
        const cx = f.x * R;
        const cy = f.y * R;
        // without a flash grant the effect still reads, but only as thin, dim lines
        const base = (f.grant > 0 ? 1 : 0.4) * f.gain * vis;
        // reduced motion: rings appear at their final size and only fade (no expansion)
        if (f.kind === 'shock') {
          for (let r = 0; r < 3; r++) {
            const d = r * 0.12;
            const pp = clamp((p - d) / (1 - d), 0, 1);
            if (pp <= 0) continue;
            const rad = grow(pp, v.reduced) * R * (0.8 - r * 0.15);
            const w = ((1 - pp) * (r === 0 ? 6 : 2) + 0.6) * px;
            strokeCircle(m, cx, cy, Math.max(px, rad), w, rgba(r === 1 ? f.pale : f.color, (1 - pp) * 0.85 * base));
          }
          const rr = grow(p, v.reduced) * R * 0.7;
          const glint = rgba(f.pale, (1 - p) * 0.6 * base);
          for (let q = 0; q < 16; q++) {
            const a = (q / 16) * Math.PI * 2 + f.x * 7;
            strokeSegment(m, cx + Math.cos(a) * rr * 0.75, cy + Math.sin(a) * rr * 0.75, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, px, glint);
          }
          // the flash: a local, coloured glow at the granted intensity
          f.glow.position.set(cx, cy);
          f.glow.width = f.glow.height = R * (0.35 + 0.5 * grow(p, v.reduced));
          f.glow.alpha = f.grant * (1 - p) * (1 - p) * f.gain * vis;
        } else {
          const q = 1 - p;
          const rad = (1 - easeOut(Math.min(1, p * 1.6))) * R * 0.5;
          strokeCircle(m, cx, cy, rad + 2 * px, 2 * px, rgba(f.color, q * 0.9 * base));
          const beamA = (f.grant > 0 ? 0.3 + 2 * f.grant : 0.18) * q * f.gain * vis;
          if (f.beam) {
            f.beam.position.set(cx, cy);
            f.beam.width = (4 + 10 * q) * px;
            f.beam.height = R * 1.8 * Math.sqrt(q);
            f.beam.alpha = Math.min(1, beamA);
          }
          if (f.flare) {
            f.flare.position.set(cx, cy);
            f.flare.rotation = Math.PI / 2;
            f.flare.width = 5 * px;
            f.flare.height = R * 1.2 * q;
            f.flare.alpha = Math.min(1, beamA * 0.8);
          }
          f.glow.position.set(cx, cy);
          f.glow.width = f.glow.height = R * 0.24 * (0.5 + q);
          f.glow.alpha = f.grant * q * f.gain * vis;
        }
      }
      const s = v.selected;
      if (s && vis > 0.01) {
        const cx = s.x * R;
        const cy = s.y * R;
        const rr = s.r * R + 14 * px;
        const t = v.reduced ? 0 : v.time;
        const col = mixColor(s.color, 0xffffff, 0.4);
        const arc = rgba(col, 0.95 * vis);
        for (let i = 0; i < 4; i++) {
          const a = t * 0.9 + (i * Math.PI) / 2;
          strokeArc(m, cx, cy, rr, a, a + 0.6, 2 * px, arc);
        }
        strokeCircle(m, cx, cy, rr + 7 * px, px, rgba(col, 0.35 * vis));
      }
      lines.end();
    },
    clear() {
      for (let i = list.length - 1; i >= 0; i--) drop(i);
      lines.begin();
      lines.end();
      drawn = false;
    },
    destroy() {
      list.length = 0;
      lines.destroy();
      container.destroy({ children: true });
      for (const s of spritePool) s.destroy();
      spritePool.length = 0;
      beamTex.destroy(true);
    },
  };
}
