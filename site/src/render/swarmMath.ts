/**
 * Pure maths of the swarm battle (./swarm): constants, the seeded generator, particle allocation between units,
 * area-uniform sampling inside a home sector and the uniform-grid spatial hash used for neighbour queries.
 */
import { CORE } from './layout';

/** most units one swarm battle tracks (a front has ≤ 8 today) */
export const MAX_UNITS = 24;
/** radial samples per unit in the sector table */
export const SECTOR_SAMPLES = 8;
/** particles live between these radius fractions: outside the planet core, inside the rim */
export const RHO_MIN = CORE + 0.05;
export const RHO_MAX = 0.955;
/** a unit's share of the swarm never drops below this (so a 0.1 % unit is still a visible, clickable swarm) */
export const MIN_SHARE = 0.8;
/** a swarm is split into up to this many squads — swirling sub-clusters spread over its territory */
export const MAX_SQUADS = 10;

/** particle states */
export const FREE = 0;
export const ALIVE = 1;
/** leaving: fades out where it is */
export const FADING = 2;
/** lost a clash: waits, then respawns at home */
export const DEAD = 3;

/** clashes per close enemy contact per second */
export const HIT_RATE = 2.4;
/** clashes recorded per step */
export const MAX_CLASHES = 256;
/** squads may sit this far (normalised distance) past their territory edge, so the swarms meet */
export const OVERLAP = 0.03;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// allocation

/** Allocation weight of a unit: its scale share (floored at MIN_SHARE) × presence; 0 for broken or absent units. */
export function unitWeight(c: number, presence: number): number {
  if (!(presence > 0) || !Number.isFinite(c)) return 0;
  return Math.max(c, MIN_SHARE) * Math.min(1, presence);
}

let fracScratch = new Float64Array(MAX_UNITS);

/**
 * Split `budget` particles between units ∝ `weights` (largest remainder): the result sums to exactly
 * floor(budget) whenever some weight is > 0; zero, negative and non-finite weights get nothing.
 */
export function allocateParticles(weights: ArrayLike<number>, budget: number, out: Int32Array = new Int32Array(weights.length)): Int32Array {
  const n = weights.length;
  const B = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  out.fill(0, 0, n);
  let W = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (w > 0 && Number.isFinite(w)) W += w;
  }
  if (!(W > 0) || B === 0) return out;
  if (fracScratch.length < n) fracScratch = new Float64Array(n);
  let used = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!(w > 0 && Number.isFinite(w))) {
      fracScratch[i] = -1;
      continue;
    }
    const exact = (B * w) / W;
    const base = Math.floor(exact);
    out[i] = base;
    used += base;
    fracScratch[i] = exact - base;
  }
  // hand out the remainder to the largest fractional parts (ties: lower index first)
  for (let r = B - used; r > 0; r--) {
    let best = -1;
    for (let i = 0; i < n; i++) if (fracScratch[i] >= 0 && (best < 0 || fracScratch[i] > fracScratch[best])) best = i;
    if (best < 0) break;
    out[best]++;
    fracScratch[best] = -0.5; // at most one extra each (the remainder is < the number of units)
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// home sectors

/** radius fraction of sector-table sample j */
export const sectorRho = (j: number) => RHO_MIN + ((RHO_MAX - RHO_MIN) * j) / SECTOR_SAMPLES;

/**
 * A point spread evenly (by area) over the annular sector [a0, a1] × [r0, r1], from two uniform numbers
 * in [0, 1): returns the radius and the fraction `u` across the sector (angle = a0 + u (a1 − a0)).
 */
export function sampleInSector(r0: number, r1: number, u1: number, u2: number): { rho: number; u: number } {
  return { rho: areaRho(r0, r1, u1), u: clamp(u2, 0, 1) };
}

/** the radius part of `sampleInSector` (no allocation): area-uniform between r0 and r1 for uniform u in [0, 1) */
export function areaRho(r0: number, r1: number, u: number): number {
  const lo = Math.max(0, Math.min(r0, r1));
  const hi = Math.max(0, Math.max(r0, r1));
  return Math.sqrt(lo * lo + (hi * hi - lo * lo) * clamp(u, 0, 1));
}

// ---------------------------------------------------------------------------------------------
// spatial hash

export interface SpatialHash {
  /** cells per side over the square [−1, 1]² */
  readonly G: number;
  /** items of cell c are `items[start[c] .. start[c + 1])` */
  readonly start: Int32Array;
  readonly items: Int32Array;
  /** cell of item i, or −1 when it was not inserted */
  readonly cellOf: Int32Array;
  cell(x: number, y: number): number;
  /** insert every i < n with `state[i] === want` */
  build(x: ArrayLike<number>, y: ArrayLike<number>, state: ArrayLike<number>, want: number, n: number): void;
  /** indices of inserted items within `r` of (px, py), written to `out`; returns how many (≤ out.length) */
  query(px: number, py: number, r: number, x: ArrayLike<number>, y: ArrayLike<number>, out: Int32Array): number;
  setGrid(G: number): void;
}

export function createSpatialHash(capacity: number, G0: number): SpatialHash {
  let G = Math.max(1, Math.floor(G0));
  let start = new Int32Array(G * G + 1);
  let cursor = new Int32Array(G * G);
  const items = new Int32Array(capacity);
  const cellOf = new Int32Array(capacity).fill(-1);
  const cellXY = (v: number) => {
    const c = Math.floor((v + 1) * 0.5 * G);
    return c < 0 ? 0 : c >= G ? G - 1 : c;
  };
  const hash: SpatialHash = {
    get G() {
      return G;
    },
    get start() {
      return start;
    },
    items,
    cellOf,
    cell: (x, y) => cellXY(y) * G + cellXY(x),
    setGrid(next) {
      const g = Math.max(1, Math.floor(next));
      if (g === G) return;
      G = g;
      start = new Int32Array(G * G + 1);
      cursor = new Int32Array(G * G);
    },
    build(x, y, state, want, n) {
      const cells = G * G;
      cursor.fill(0);
      const m = Math.min(n, capacity);
      for (let i = 0; i < m; i++) {
        if (state[i] !== want) {
          cellOf[i] = -1;
          continue;
        }
        const c = cellXY(y[i]) * G + cellXY(x[i]);
        cellOf[i] = c;
        cursor[c]++;
      }
      start[0] = 0;
      for (let c = 0; c < cells; c++) start[c + 1] = start[c] + cursor[c];
      for (let c = 0; c < cells; c++) cursor[c] = start[c];
      for (let i = 0; i < m; i++) {
        const c = cellOf[i];
        if (c >= 0) items[cursor[c]++] = i;
      }
    },
    query(px, py, r, x, y, out) {
      const r2 = r * r;
      const x0 = cellXY(px - r);
      const x1 = cellXY(px + r);
      const y0 = cellXY(py - r);
      const y1 = cellXY(py + r);
      let n = 0;
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const c = gy * G + gx;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const j = items[k];
            const dx = x[j] - px;
            const dy = y[j] - py;
            if (dx * dx + dy * dy <= r2 && n < out.length) out[n++] = j;
          }
        }
      }
      return n;
    },
  };
  return hash;
}
