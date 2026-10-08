/**
 * Stateless drawing helpers for a planet's territories (ported from mockups/a-galaxy.html
 * `territoryPath` / `drawFrontlines` / `drawChevrons` / `drawTerritory` / `drawSurface`).
 * Everything is in planet-local world units; `px` = world units per screen pixel.
 */
import type { Graphics } from 'pixi.js';
import { CORE, START_ANGLE, TAU, type Frontline, type Wedge } from './layout';
import { mixColor } from './planetDecor';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function hexColor(s: string): number {
  const n = parseInt(String(s).slice(1, 7), 16);
  return Number.isFinite(n) ? n : 0x888888;
}

/** start a fresh sub-path at the arc's first point (PixiJS would otherwise join it to the last point) */
export function arcPath(g: Graphics, r: number, a0: number, a1: number): Graphics {
  return g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1);
}

/** radius fraction of border sample i of NS */
export const sampleRho = (i: number, NS: number) => CORE + ((1 - CORE) * i) / NS;

/**
 * Outline of the territory between two sampled frontlines (`bs` starts it, `be` ends it; `wrap` = 2π for
 * the last wedge): along `bs` from the core to the rim, the rim arc, back down `be`, and the core arc.
 * Returns a fresh array (PixiJS keeps a reference until it tessellates).
 */
export function wedgePolygon(bs: Float64Array, be: Float64Array, wrap: number, NS: number, R: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const r = sampleRho(i, NS) * R;
    pts.push(Math.cos(bs[i]) * r, Math.sin(bs[i]) * r);
  }
  const o0 = bs[NS];
  const o1 = be[NS] + wrap;
  const so = Math.max(1, Math.ceil((o1 - o0) / 0.08));
  for (let j = 1; j < so; j++) {
    const a = o0 + ((o1 - o0) * j) / so;
    pts.push(Math.cos(a) * R, Math.sin(a) * R);
  }
  for (let i = NS; i >= 0; i--) {
    const r = sampleRho(i, NS) * R;
    pts.push(Math.cos(be[i] + wrap) * r, Math.sin(be[i] + wrap) * r);
  }
  const c0 = be[0] + wrap;
  const c1 = bs[0];
  const si = Math.max(1, Math.ceil((c0 - c1) / 0.15));
  for (let j = 1; j < si; j++) {
    const a = c0 + ((c1 - c0) * j) / si;
    pts.push(Math.cos(a) * CORE * R, Math.sin(a) * CORE * R);
  }
  return pts;
}

/** rim angles of wedge k from the sampled frontlines */
export function rimRange(ang: readonly Float64Array[], k: number, n: number, NS: number): [number, number] {
  if (n < 2) return [START_ANGLE, START_ANGLE + TAU];
  return [ang[k][NS], ang[(k + 1) % n][NS] + (k === n - 1 ? TAU : 0)];
}

/** frontline: soft glow in the stronger side's colour, a mixed mid line and a white core */
export function drawFrontline(g: Graphics, b: Frontline, a: Float64Array, NS: number, R: number, px: number, sr: number): void {
  g.clear();
  const wS = clamp(sr / 140, 0.5, 2.2);
  const strong = b.push >= 0 ? b.prev : b.cur;
  const weak = strong === b.prev ? b.cur : b.prev;
  const sc = hexColor(strong.color);
  const mc = mixColor(sc, hexColor(weak.color), 0.35);
  // slivers get thinner lines so their own colour still shows between them
  const spanPx = Math.min(b.prev.a1 - b.prev.a0, b.cur.a1 - b.cur.a0) * sr * 0.6;
  const thin = clamp(spanPx / 22, 0.3, 1);
  const path = () => {
    for (let i = 0; i <= NS; i++) {
      const r = Math.min(0.995, sampleRho(i, NS)) * R;
      if (i === 0) g.moveTo(Math.cos(a[i]) * r, Math.sin(a[i]) * r);
      else g.lineTo(Math.cos(a[i]) * r, Math.sin(a[i]) * r);
    }
    return g;
  };
  const style = { cap: 'round', join: 'round' } as const;
  path().stroke({ ...style, width: 10 * wS * px * thin, color: sc, alpha: 0.06 + 0.13 * b.fierce });
  path().stroke({ ...style, width: 3.2 * wS * px * thin, color: mc, alpha: 0.25 + 0.3 * b.fierce });
  path().stroke({ ...style, width: 1.1 * wS * px * Math.max(0.6, thin), color: 0xffffff, alpha: 0.35 + 0.5 * b.fierce });
}

/** additive inner rim glow of one territory (mockup: strokes inside the territory edge), ∝ brightness */
export function drawRimGlow(g: Graphics, color: number, o0: number, o1: number, R: number, px: number, level: number): void {
  if (o1 - o0 < 0.004 || level <= 0.004) return;
  arcPath(g, R * 0.955, o0, o1).stroke({ width: R * 0.09, color, alpha: 0.05 + 0.15 * level });
  arcPath(g, R * 0.975, o0, o1).stroke({ width: Math.max(1.5 * px, R * 0.035), color, alpha: 0.1 + 0.28 * level });
}

export interface PulseView {
  wedges: readonly Wedge[];
  lines: readonly Frontline[];
  /** displayed brightness 0..1 of a unit */
  bright(id: string): number;
  emph: ((org: string) => number) | null;
  rangeAt(k: number, rho: number): [number, number];
  borderAt(k: number, rho: number): number;
  R: number;
  px: number;
  sr: number;
  t: number;
  ph: number;
}

/** per-frame motion: offensive pulses, push chevrons and the hologram scan band */
export function drawPulses(g: Graphics, v: PulseView): void {
  const { R, px, sr, t } = v;
  // offensive pulses: arcs running from the core to the rim, faster and brighter with strength
  v.wedges.forEach((w, k) => {
    const b = Math.min(1, v.bright(w.id));
    const e = v.emph ? v.emph(w.org) : 1;
    const sp = 0.08 + 0.32 * b;
    const col = hexColor(w.color);
    for (let j = 0; j < 3; j++) {
      const ph = (t * sp + j / 3 + k * 0.17) % 1;
      const alpha = 0.3 * b * Math.sin(ph * Math.PI) * e * w.presence;
      if (alpha < 0.012) continue;
      const rho = CORE + (1 - CORE) * ph;
      const [a0, a1] = v.rangeAt(k, rho);
      if (a1 - a0 < 0.01) continue;
      arcPath(g, rho * R, a0, a1).stroke({ width: (1 + 2.5 * ph * (sr / 140)) * px, color: col, alpha });
    }
  });
  // push chevrons on big planets: arrows into the weaker side (only where both sides are wide enough)
  if (sr > 80) {
    const wS = clamp(sr / 140, 0.5, 2.2);
    for (const b of v.lines) {
      if (Math.abs(b.push) <= 0.2 || Math.min(b.prev.a1 - b.prev.a0, b.cur.a1 - b.cur.a0) < 0.14) continue;
      const dir = b.push > 0 ? 1 : -1;
      const strong = hexColor((b.push > 0 ? b.prev : b.cur).color);
      const am = Math.min(1, Math.abs(b.push) * 1.5);
      for (const rho of [0.48, 0.76]) {
        const ang = v.borderAt(b.k, rho);
        const tx = -Math.sin(ang) * dir;
        const ty = Math.cos(ang) * dir;
        for (let j = 0; j < 2; j++) {
          const ph = (t * 0.9 + j * 0.5 + rho) % 1;
          const d = (ph * 0.09 - 0.02) * R;
          const cx = Math.cos(ang) * rho * R + tx * d;
          const cy = Math.sin(ang) * rho * R + ty * d;
          const s = 4.5 * wS * px;
          g.moveTo(cx - tx * s - ty * s, cy - ty * s + tx * s)
            .lineTo(cx, cy)
            .lineTo(cx - tx * s + ty * s, cy - ty * s - tx * s)
            .stroke({ width: 1.6 * wS * px, color: strong, alpha: 0.9 * Math.sin(ph * Math.PI) * am, cap: 'round', join: 'round' });
        }
      }
    }
  }
  // hologram scan band sweeping down the sphere (strips clipped to the disc, no mask needed)
  const band = -R + ((t * 0.22 + v.ph) % 1) * R * 2.4;
  const hh = R * 0.08;
  const prof = [0.015, 0.045, 0.08, 0.08, 0.045, 0.015];
  prof.forEach((al, i) => {
    const y0 = band - hh + (i * 2 * hh) / prof.length;
    const ym = y0 + hh / prof.length;
    if (Math.abs(ym) >= R) return;
    const half = Math.sqrt(R * R - ym * ym);
    g.rect(-half, y0, 2 * half, (2 * hh) / prof.length).fill({ color: 0x8ce6ff, alpha: al });
  });
}
