/**
 * Stateless drawing helpers for a planet's territories (ported from mockups/a-galaxy.html
 * `territoryPath` / `drawFrontlines` / `drawChevrons` / `drawTerritory` / `drawSurface`).
 * Everything is in planet-local world units; `px` = world units per screen pixel. They write triangles into the
 * planet's dynamic meshes (./meshBuild, ./dynMesh) — the strokes are the ones `Graphics.stroke()` produced before,
 * without allocating per frame.
 */
import { CORE, START_ANGLE, TAU, type Frontline, type Wedge } from './layout';
import { colorGain, hexColor, mixColor } from './color';
import { CAP_ROUND, JOIN_MITER, JOIN_ROUND, CAP_BUTT, createPath, fillRect, fillSector, pathPush, pathReset, rgba, strokeArc, strokePath, type MeshBuf } from './meshBuild';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** radius fraction of border sample i of NS */
export const sampleRho = (i: number, NS: number) => CORE + ((1 - CORE) * i) / NS;

/**
 * Fill the territory between two sampled frontlines (`bs` starts it, `be` ends it; `wrap` = 2π for the last wedge):
 * the region bounded by `bs` from the core to the rim, the rim arc, `be` back down and the core arc.
 */
export function fillWedge(b: MeshBuf, bs: Float64Array, be: Float64Array, wrap: number, NS: number, R: number, color: number, step = 0.08): void {
  fillSector(b, bs, be, wrap, NS, R, CORE, color, step);
}

/**
 * Angular step for territory fills on a planet of `sr` screen px: 0.08 rad (the overview's original polygon), coarser on
 * small planets as long as the rim arc stays within 0.25 px of a true circle (and under the rim stroke anyway).
 */
export function fillStep(sr: number): number {
  return Math.max(0.08, 2 * Math.sqrt(0.5 / Math.max(1, sr)));
}

/** rim start angle of wedge k from the sampled frontlines */
export function rimStart(ang: readonly Float64Array[], k: number, n: number, NS: number): number {
  return n < 2 ? START_ANGLE : ang[k][NS];
}
/** rim end angle of wedge k from the sampled frontlines */
export function rimEnd(ang: readonly Float64Array[], k: number, n: number, NS: number): number {
  return n < 2 ? START_ANGLE + TAU : ang[(k + 1) % n][NS] + (k === n - 1 ? TAU : 0);
}

const path = createPath(64);
// miter joins: the lines bend gently, and round joins / caps would multiply the triangles
const FRONT_MITER = 2;

// the current frontline's sample angles as cos / sin (computed once per line, used by all five of its paths)
let ca = new Float64Array(32);
let sa = new Float64Array(32);

function linePath(NS: number, R: number): void {
  pathReset(path);
  for (let i = 0; i <= NS; i++) {
    const r = Math.min(0.995, sampleRho(i, NS)) * R;
    pathPush(path, ca[i] * r, sa[i] * r);
  }
}

/** the line offset into one side's territory (prev lies at smaller angles), kept inside narrow wedges, tapered at the core */
function bandPath(NS: number, R: number, side: number, off: number, narrow: number): void {
  pathReset(path);
  for (let i = 0; i <= NS; i++) {
    const r = Math.min(0.995, sampleRho(i, NS)) * R;
    const d = side * Math.min(off, r * 0.35 * narrow);
    pathPush(path, ca[i] * r - sa[i] * d, sa[i] * r + ca[i] * d);
  }
}

function sideGlow(m: MeshBuf, NS: number, R: number, px: number, sr: number, side: number, w: Wedge, level: number, thin: number, room: number, narrow: number) {
  const col = hexColor(w.color);
  const lv = level * colorGain(col);
  if (lv <= 0.004) return;
  // the wide soft band only shows on big planets
  if (sr >= 95) {
    bandPath(NS, R, side, R * 0.045 * thin, narrow);
    strokePath(m, path, R * 0.09 * thin, rgba(col, (0.05 + 0.14 * lv) * room), false, JOIN_MITER, CAP_BUTT, FRONT_MITER);
  }
  bandPath(NS, R, side, R * 0.016 * thin, narrow);
  strokePath(m, path, Math.max(1.2 * px, R * 0.03 * thin), rgba(col, (0.1 + 0.26 * lv) * Math.sqrt(room)), false, JOIN_MITER, CAP_BUTT, FRONT_MITER);
}

/**
 * Frontline: each side's territory glows along its edge in its own colour (∝ that side's brightness,
 * the mockup's inner territory stroke), then a soft glow in the stronger side's colour, a mixed mid
 * line and a white core.
 */
export function drawFrontline(m: MeshBuf, b: Frontline, a: Float64Array, NS: number, R: number, px: number, sr: number, levelPrev: number, levelCur: number): void {
  const wS = clamp(sr / 140, 0.5, 2.2);
  const strong = b.push >= 0 ? b.prev : b.cur;
  const weak = strong === b.prev ? b.cur : b.prev;
  const sc = hexColor(strong.color);
  const mc = mixColor(sc, hexColor(weak.color), 0.35);
  const narrow = Math.min(b.prev.a1 - b.prev.a0, b.cur.a1 - b.cur.a0);
  // slivers get thinner lines so their own colour still shows between them
  const spanPx = narrow * sr * 0.6;
  const thin = clamp(spanPx / 22, 0.3, 1);
  // additive glows pile up between close frontlines: fade them where the territories are narrow
  const room = clamp(spanPx / 40, 0.12, 1);
  if (ca.length < NS + 1) {
    ca = new Float64Array(NS + 1);
    sa = new Float64Array(NS + 1);
  }
  for (let i = 0; i <= NS; i++) {
    ca[i] = Math.cos(a[i]);
    sa[i] = Math.sin(a[i]);
  }
  sideGlow(m, NS, R, px, sr, -1, b.prev, levelPrev, thin, room, narrow);
  sideGlow(m, NS, R, px, sr, 1, b.cur, levelCur, thin, room, narrow);
  linePath(NS, R);
  strokePath(m, path, 10 * wS * px * thin, rgba(sc, (0.06 + 0.13 * b.fierce) * room), false, JOIN_MITER, CAP_BUTT, FRONT_MITER);
  strokePath(m, path, 3.2 * wS * px * thin, rgba(mc, (0.25 + 0.3 * b.fierce) * Math.sqrt(room)), false, JOIN_MITER, CAP_BUTT, FRONT_MITER);
  strokePath(m, path, 1.1 * wS * px * Math.max(0.6, thin), rgba(0xffffff, (0.35 + 0.5 * b.fierce) * (0.5 + 0.5 * room)), false, JOIN_MITER, CAP_BUTT, FRONT_MITER);
}

/** additive inner rim glow of one territory (mockup: strokes inside the territory edge), ∝ brightness */
export function drawRimGlow(m: MeshBuf, color: number, o0: number, o1: number, R: number, px: number, lv: number): void {
  const level = lv * colorGain(color);
  if (o1 - o0 < 0.004 || level <= 0.004) return;
  strokeArc(m, 0, 0, R * 0.955, o0, o1, R * 0.09, rgba(color, 0.05 + 0.15 * level));
  strokeArc(m, 0, 0, R * 0.975, o0, o1, Math.max(1.5 * px, R * 0.035), rgba(color, 0.1 + 0.28 * level));
}

export interface PulseView {
  wedges: readonly Wedge[];
  lines: readonly Frontline[];
  /** displayed brightness 0..1 of a unit */
  bright(id: string): number;
  emph: ((org: string) => number) | null;
  /** wedge k's start / end angle at radius fraction rho */
  rangeStart(k: number, rho: number): number;
  rangeEnd(k: number, rho: number): number;
  borderAt(k: number, rho: number): number;
  R: number;
  px: number;
  sr: number;
  t: number;
  ph: number;
}

const CHEVRON_RHO = [0.48, 0.76] as const;
const SCAN = [0.015, 0.045, 0.08, 0.08, 0.045, 0.015] as const;

/** per-frame motion: offensive pulses, push chevrons and the hologram scan band */
export function drawPulses(m: MeshBuf, v: PulseView): void {
  const { R, px, sr, t } = v;
  // offensive pulses: arcs running from the core to the rim, faster and brighter with strength
  for (let k = 0; k < v.wedges.length; k++) {
    const w = v.wedges[k];
    const b = Math.min(1, v.bright(w.id));
    const e = v.emph ? v.emph(w.org) : 1;
    const sp = 0.08 + 0.32 * b;
    const col = hexColor(w.color);
    for (let j = 0; j < 3; j++) {
      const ph = (t * sp + j / 3 + k * 0.17) % 1;
      const alpha = 0.3 * b * Math.sin(ph * Math.PI) * e * w.presence;
      if (alpha < 0.012) continue;
      const rho = CORE + (1 - CORE) * ph;
      const a0 = v.rangeStart(k, rho);
      const a1 = v.rangeEnd(k, rho);
      if (a1 - a0 < 0.01) continue;
      strokeArc(m, 0, 0, rho * R, a0, a1, (1 + 2.5 * ph * (sr / 140)) * px, rgba(col, alpha));
    }
  }
  // push chevrons on big planets: arrows into the weaker side (only where both sides are wide enough)
  if (sr > 80) {
    const wS = clamp(sr / 140, 0.5, 2.2);
    for (const b of v.lines) {
      if (Math.abs(b.push) <= 0.2 || Math.min(b.prev.a1 - b.prev.a0, b.cur.a1 - b.cur.a0) < 0.14) continue;
      const dir = b.push > 0 ? 1 : -1;
      const strong = hexColor((b.push > 0 ? b.prev : b.cur).color);
      const am = Math.min(1, Math.abs(b.push) * 1.5);
      for (let r = 0; r < CHEVRON_RHO.length; r++) {
        const rho = CHEVRON_RHO[r];
        const ang = v.borderAt(b.k, rho);
        const tx = -Math.sin(ang) * dir;
        const ty = Math.cos(ang) * dir;
        for (let j = 0; j < 2; j++) {
          const ph = (t * 0.9 + j * 0.5 + rho) % 1;
          const d = (ph * 0.09 - 0.02) * R;
          const cx = Math.cos(ang) * rho * R + tx * d;
          const cy = Math.sin(ang) * rho * R + ty * d;
          const s = 4.5 * wS * px;
          pathReset(path);
          pathPush(path, cx - tx * s - ty * s, cy - ty * s + tx * s);
          pathPush(path, cx, cy);
          pathPush(path, cx - tx * s + ty * s, cy - ty * s - tx * s);
          strokePath(m, path, 1.6 * wS * px, rgba(strong, 0.9 * Math.sin(ph * Math.PI) * am), false, JOIN_ROUND, CAP_ROUND);
        }
      }
    }
  }
  // hologram scan band sweeping down the sphere (strips clipped to the disc, no mask needed)
  const band = -R + ((t * 0.22 + v.ph) % 1) * R * 2.4;
  const hh = R * 0.08;
  for (let i = 0; i < SCAN.length; i++) {
    const y0 = band - hh + (i * 2 * hh) / SCAN.length;
    const ym = y0 + hh / SCAN.length;
    if (Math.abs(ym) >= R) continue;
    const half = Math.sqrt(R * R - ym * ym);
    fillRect(m, -half, y0, 2 * half, (2 * hh) / SCAN.length, rgba(0x8ce6ff, SCAN[i]));
  }
}
