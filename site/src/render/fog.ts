/**
 * Fog of war over uncertain territory: a pale veil over each wedge whose data is estimated, plus soft
 * puffs that drift inside the wedge. Opacity ∝ the unit's `fogBlend` (0 = measured … 0.8 = estimated).
 * The veil is a dynamic mesh refilled with the planet's geometry; puffs are pooled sprites — nothing is
 * allocated per frame.
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import { TAU, type Wedge } from './layout';
import { createDynMesh } from './dynMesh';
import { fillWedge } from './planetDraw';
import { rgba } from './meshBuild';

export interface FogLayer {
  readonly container: Container;
  /**
   * after a geometry rebuild: the planet's wedges and their sampled borders (`ang[k]` = frontline k at NS + 1 radius
   * samples, planet radius R; null when the planet has a single territory)
   */
  rebuild(wedges: readonly Wedge[], ang: readonly Float64Array[] | null, NS: number, R: number, step?: number): void;
  /** per frame: drift the puffs inside their (moving) wedges; `start` / `end` give wedge k's angles at radius fraction rho */
  update(time: number, R: number, start: (k: number, rho: number) => number, end: (k: number, rho: number) => number, reduced: boolean): void;
  destroy(): void;
}

interface Puff {
  sprite: Sprite;
  u: number;
  rho: number;
  ph: number;
  sp: number;
  size: number;
}

interface Bank {
  k: number;
  fog: number;
  puffs: Puff[];
  seen: number;
}

// neutral cool grey: fog desaturates a territory (no hue shift, no white-out)
const VEIL = 0x737b8c;
const PUFF = 0xb9c1cf;
const VEIL_ALPHA = 0.3;
const PUFF_ALPHA = 0.42;
const DEG = Math.PI / 180;

export function createFog(cloud: Texture): FogLayer {
  const container = new Container({ label: 'fog' });
  container.eventMode = 'none';
  const veil = createDynMesh({ label: 'fog-veil' });
  const puffLayer = new Container({ label: 'fog-puffs' });
  container.addChild(veil.mesh, puffLayer);
  const banks = new Map<string, Bank>();
  const pool: Sprite[] = [];
  let seed = 1;
  let gen = 0;

  const rnd = () => {
    // tiny deterministic LCG: fog placement is decoration, but stable across reloads
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  function takeSprite(): Sprite {
    const s = pool.pop() ?? new Sprite({ texture: cloud, anchor: 0.5 });
    s.tint = PUFF;
    s.visible = true;
    puffLayer.addChild(s);
    return s;
  }
  function release(p: Puff) {
    p.sprite.visible = false;
    puffLayer.removeChild(p.sprite);
    pool.push(p.sprite);
  }

  return {
    container,
    rebuild(wedges, ang, NS, R, step = 0.08) {
      veil.begin();
      gen++;
      const n = wedges.length;
      for (let k = 0; k < n; k++) {
        const w = wedges[k];
        if (w.fogBlend <= 0.01) continue;
        if (ang && n >= 2) fillWedge(veil.buf, ang[k], ang[(k + 1) % n], k === n - 1 ? TAU : 0, NS, R, rgba(VEIL, VEIL_ALPHA * w.fogBlend), step);
        const span = w.a1 - w.a0;
        const want = span < 7 * DEG ? 0 : Math.min(6, 1 + Math.round(span / (34 * DEG)));
        let b = banks.get(w.id);
        if (!b) {
          b = { k, fog: w.fogBlend, puffs: [], seen: gen };
          banks.set(w.id, b);
        }
        b.k = k;
        b.fog = w.fogBlend;
        b.seen = gen;
        const had = b.puffs.length;
        while (b.puffs.length > want) release(b.puffs.pop()!);
        while (b.puffs.length < want) {
          const i = b.puffs.length;
          b.puffs.push({ sprite: takeSprite(), u: (i + 0.5) / want, rho: 0.38 + rnd() * 0.42, ph: rnd() * Math.PI * 2, sp: 0.6 + rnd() * 0.8, size: 0.85 + rnd() * 0.4 });
        }
        // spread evenly again when the count changed
        if (b.puffs.length !== had) for (let j = 0; j < b.puffs.length; j++) b.puffs[j].u = (j + 0.5) / b.puffs.length;
      }
      veil.end();
      for (const [id, b] of banks) {
        if (b.seen === gen) continue;
        for (const p of b.puffs) release(p);
        banks.delete(id);
      }
    },
    update(time, R, start, end, reduced) {
      const t = reduced ? 0 : time;
      for (const b of banks.values()) {
        const n = b.puffs.length;
        for (let j = 0; j < n; j++) {
          const p = b.puffs[j];
          const rho = Math.min(0.86, Math.max(0.3, p.rho + 0.06 * Math.sin(t * 0.09 * p.sp + p.ph * 1.7)));
          const a0 = start(b.k, rho);
          const a1 = end(b.k, rho);
          const u = Math.min(0.85, Math.max(0.15, p.u + (0.35 / n) * Math.sin(t * 0.11 * p.sp + p.ph)));
          const a = a0 + (a1 - a0) * u;
          const chord = Math.max(0, a1 - a0) * rho * R;
          const r = Math.min(0.34 * R, (1 - rho) * R + 0.12 * R, (0.62 * chord) / Math.max(1, n * 0.7)) * p.size;
          const s = p.sprite;
          s.position.set(Math.cos(a) * rho * R, Math.sin(a) * rho * R);
          s.width = s.height = Math.max(2, r * 2.6);
          s.rotation = p.ph + t * 0.05 * (p.sp - 1);
          s.alpha = PUFF_ALPHA * b.fog * (0.75 + 0.25 * Math.sin(t * 0.5 * p.sp + p.ph));
        }
      }
    },
    destroy() {
      for (const b of banks.values()) b.puffs.forEach(release);
      banks.clear();
      for (const s of pool) s.destroy();
      pool.length = 0;
      veil.destroy();
      container.destroy({ children: true });
    },
  };
}
