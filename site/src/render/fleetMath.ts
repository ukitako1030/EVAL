/**
 * Pure fleet maths (no PixiJS): how many ships each org gets (spec §7.1: ∝ fronts × scale), deterministic
 * per-ship random streams, and the pieces of path ships fly — rim arcs, tilted orbits and data-stream legs.
 * Everything here is allocation-free on the per-frame paths (callers pass `out` objects).
 */
import { orgDeployment, type OrgDeployment } from '../data/timeline';
import type { World } from '../data/types';
import { TAU } from './layout';

/** total ships at the busiest month, desktop / phones (× `renderer.particleScale`) */
export const FLEET_CAP_DESKTOP = 140;
export const FLEET_CAP_MOBILE = 60;
/** ring / orbit plane tilt (radians) — the same as the planets' rings (planetDecor TILT) */
export const ORBIT_TILT = -0.28;
/** orbits are the ring plane seen at an angle: y squashed by this */
export const ORBIT_SQUASH = 0.3;
/** stream ends sit this far out from a planet's centre (× r), see galaxy `updateStreams` */
export const RIM_SAT = 1.1;
export const RIM_HUB = 1.14;

export interface Vec {
  x: number;
  y: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------------------------
// allocation

/** an org's deployment weight: fronts it fights on × its summed share (「展開戦線数 × 規模」) */
export function fleetWeight(d: Pick<OrgDeployment, 'fronts' | 'totalShare'>): number {
  const w = d.fronts.length * d.totalShare;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** ship cap for the device class and quality level */
export function fleetCap(mobile: boolean, particleScale: number): number {
  const s = Number.isFinite(particleScale) ? clamp(particleScale, 0, 1) : 1;
  return Math.round((mobile ? FLEET_CAP_MOBILE : FLEET_CAP_DESKTOP) * s);
}

/** the largest total weight of any whole month: the war at its biggest gets the full cap */
export function fleetPeak(world: World): number {
  let peak = 0;
  for (let m = 0; m < world.months.length; m++) {
    let sum = 0;
    for (const d of orgDeployment(world, m)) sum += fleetWeight(d);
    peak = Math.max(peak, sum);
  }
  return peak;
}

/** ships on screen: the cap, scaled down while the war is smaller than at its peak */
export function fleetBudget(totalWeight: number, peakWeight: number, cap: number): number {
  if (!(cap > 0) || !(totalWeight > 0)) return 0;
  const f = peakWeight > 0 ? Math.min(1, totalWeight / peakWeight) : 1;
  return Math.round(cap * f);
}

/**
 * Split `budget` ships over orgs ∝ weight. Every org with weight > 0 gets one ship first (heaviest first while the
 * budget lasts), the rest is shared ∝ weight by largest remainder. Deterministic: ties go to the earlier index.
 * Writes into `out` (resized to `weights.length`) when given.
 */
export function allocateFleets(weights: readonly number[], budget: number, out: number[] = []): number[] {
  const n = weights.length;
  out.length = n;
  out.fill(0);
  const B = Math.floor(Number.isFinite(budget) ? budget : 0);
  const w = (i: number) => (Number.isFinite(weights[i]) && weights[i] > 0 ? weights[i] : 0);
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (w(i) > 0) order.push(i);
  if (B <= 0 || !order.length) return out;
  order.sort((a, b) => w(b) - w(a) || a - b);
  if (B <= order.length) {
    for (let j = 0; j < B; j++) out[order[j]] = 1;
    return out;
  }
  let total = 0;
  for (const i of order) total += w(i);
  const rest = B - order.length;
  let given = 0;
  const frac: number[] = [];
  for (const i of order) {
    const q = (rest * w(i)) / total;
    const base = Math.floor(q + 1e-9);
    out[i] = 1 + base;
    given += base;
    frac[i] = q - base;
  }
  const byFrac = order.slice().sort((a, b) => frac[b] - frac[a] || w(b) - w(a) || a - b);
  for (let j = 0; given < rest; j = (j + 1) % byFrac.length, given++) out[byFrac[j]]++;
  return out;
}

// ---------------------------------------------------------------------------------------------
// deterministic randomness

/** stable 32-bit seed of ship `k` of `org` (FNV-1a), never 0 */
export function shipSeed(org: string, k: number): number {
  const s = `${org}#${k}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

export interface Rng {
  rng: number;
}

/** next value in [0, 1) of a ship's own random stream (mulberry32 on `s.rng`) */
export function rand01(s: Rng): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randIn = (s: Rng, a: number, b: number) => a + rand01(s) * (b - a);

/**
 * Index into `weights[0..n)` picked by `r` ∈ [0, 1) ∝ weight + `bias`, never `exclude` (pass −1 for none).
 * −1 when nothing can be picked.
 */
export function pickWeighted(weights: ArrayLike<number>, n: number, exclude: number, r: number, bias = 0): number {
  let total = 0;
  for (let i = 0; i < n; i++) if (i !== exclude) total += Math.max(0, weights[i] || 0) + bias;
  if (!(total > 0)) {
    for (let i = 0; i < n; i++) if (i !== exclude) return i;
    return -1;
  }
  let x = clamp(r, 0, 1) * total;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (i === exclude) continue;
    const wi = Math.max(0, weights[i] || 0) + bias;
    if (wi <= 0) continue;
    last = i;
    x -= wi;
    if (x < 0) return i;
  }
  return last;
}

// ---------------------------------------------------------------------------------------------
// paths

/**
 * A ship's route between fronts always runs through the hub (the data streams are spokes):
 * Loiter (arc round its planet) → ToExit (arc to the stream mouth) → Out (stream to the hub) →
 * HubArc (round the hub to the next stream) → In (stream out to the destination) → Loiter.
 * Orbit is the single-front org's endless tilted orbit.
 */
export const Leg = { Loiter: 0, ToExit: 1, Out: 2, HubArc: 3, In: 4, Orbit: 5 } as const;
export type Leg = (typeof Leg)[keyof typeof Leg];

/** the leg after `leg` for a ship at `at` heading for `dest` (both front indices; `hub` = the hub's index) */
export function nextLeg(leg: Leg, at: number, dest: number, hub: number): Leg {
  switch (leg) {
    case Leg.Loiter:
      return at === hub ? Leg.HubArc : Leg.ToExit;
    case Leg.ToExit:
      return Leg.Out;
    case Leg.Out:
      return dest === hub ? Leg.Loiter : Leg.HubArc;
    case Leg.HubArc:
      return Leg.In;
    case Leg.In:
      return Leg.Loiter;
    default:
      return Leg.Orbit;
  }
}

/** data-stream parameter (0 = at the front's planet, 1 = at the hub) at progress `s` of a leg */
export function legU(leg: Leg, s: number): number {
  const p = clamp(s, 0, 1);
  return leg === Leg.In ? 1 - p : p;
}

/** `a1` shifted by whole turns so the arc `a0 → a1` goes the short way round (|a1 − a0| ≤ π) */
export function shortArc(a0: number, a1: number): number {
  let d = (a1 - a0 + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return a0 + d - Math.PI;
}

/** point at angle `a` on the circle (`cx`, `cy`, `r`) */
export function arcPoint(cx: number, cy: number, r: number, a: number, out: Vec): Vec {
  out.x = cx + Math.cos(a) * r;
  out.y = cy + Math.sin(a) * r;
  return out;
}

/** point at angle `a` of a tilted orbit of radius `rr` round (`cx`, `cy`); returns true while it is behind the planet */
export function orbitPoint(cx: number, cy: number, rr: number, a: number, out: Vec): boolean {
  const ex = Math.cos(a) * rr;
  const ey = Math.sin(a) * rr * ORBIT_SQUASH;
  const c = Math.cos(ORBIT_TILT);
  const s = Math.sin(ORBIT_TILT);
  out.x = cx + ex * c - ey * s;
  out.y = cy + ex * s + ey * c;
  return Math.sin(a) < 0;
}

/** progress after flying `speed × dt` along a piece of length `len` (a degenerate piece completes at once) */
export function advance(s: number, speed: number, dt: number, len: number): number {
  return len > 1e-6 ? s + (speed * Math.max(0, dt)) / len : 1;
}
