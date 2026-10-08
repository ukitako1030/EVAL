/**
 * Fog of war over uncertain territory: a pale veil over each wedge whose data is estimated, plus soft
 * puffs that drift inside the wedge. Opacity ∝ the unit's `fogBlend` (0 = measured … 0.8 = estimated).
 */
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Wedge } from './layout';

export interface FogLayer {
  readonly container: Container;
  /** after a geometry rebuild: the planet's wedges and their outline polygons (local coords), by index */
  rebuild(wedges: readonly Wedge[], polys: readonly (number[] | null)[]): void;
  /** per frame: drift the puffs inside their (moving) wedges; `rangeAt` gives wedge k's angles at radius fraction rho */
  update(time: number, R: number, rangeAt: (k: number, rho: number) => [number, number], reduced: boolean): void;
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
}

// murky blue-grey: fog mutes a territory's colour instead of painting it white
const VEIL = 0x5d6f8c;
const PUFF = 0x9fb0c9;
const VEIL_ALPHA = 0.36;
const PUFF_ALPHA = 0.5;
const DEG = Math.PI / 180;

export function createFog(cloud: Texture): FogLayer {
  const container = new Container({ label: 'fog' });
  container.eventMode = 'none';
  const veil = new Graphics();
  const puffLayer = new Container({ label: 'fog-puffs' });
  container.addChild(veil, puffLayer);
  const banks = new Map<string, Bank>();
  const pool: Sprite[] = [];
  let seed = 1;

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
    rebuild(wedges, polys) {
      veil.clear();
      const live = new Set<string>();
      wedges.forEach((w, k) => {
        if (w.fogBlend <= 0.01) return;
        const poly = polys[k];
        if (poly && poly.length >= 6) veil.poly(poly).fill({ color: VEIL, alpha: VEIL_ALPHA * w.fogBlend });
        live.add(w.id);
        const span = w.a1 - w.a0;
        const want = span < 7 * DEG ? 0 : Math.min(6, 1 + Math.round(span / (34 * DEG)));
        let b = banks.get(w.id);
        if (!b) {
          b = { k, fog: w.fogBlend, puffs: [] };
          banks.set(w.id, b);
        }
        b.k = k;
        b.fog = w.fogBlend;
        while (b.puffs.length > want) release(b.puffs.pop()!);
        while (b.puffs.length < want) {
          const i = b.puffs.length;
          b.puffs.push({ sprite: takeSprite(), u: (i + 0.5) / want, rho: 0.38 + rnd() * 0.42, ph: rnd() * Math.PI * 2, sp: 0.6 + rnd() * 0.8, size: 0.85 + rnd() * 0.4 });
        }
        // spread evenly again when the count changed
        b.puffs.forEach((p, j) => (p.u = (j + 0.5) / b!.puffs.length));
      });
      for (const [id, b] of banks) {
        if (live.has(id)) continue;
        b.puffs.forEach(release);
        banks.delete(id);
      }
    },
    update(time, R, rangeAt, reduced) {
      const t = reduced ? 0 : time;
      for (const b of banks.values()) {
        for (const p of b.puffs) {
          const rho = Math.min(0.86, Math.max(0.3, p.rho + 0.06 * Math.sin(t * 0.09 * p.sp + p.ph * 1.7)));
          const [a0, a1] = rangeAt(b.k, rho);
          const n = b.puffs.length;
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
      container.destroy({ children: true });
    },
  };
}
