/**
 * Particle-swarm battle simulation (ported from mockups/c-swarm.html §3) — pure maths, no PixiJS.
 *
 * Coordinates are planet-local and normalised (the planet disc has radius 1, angles as in ./layout: y down).
 * Every unit gets a swarm whose size ∝ c × presence, split into squads (∝ its territory) whose centres are spread
 * over the unit's home sector — the planet's territory wedge, fed per frame through `sectors` — so the swarms fill
 * the same territories the overview shows and follow the animated frontlines. Boids-style steering (cohesion to the
 * squad + a swirl around it, alignment, separation, a noise field) keeps them organic; enemies within reach push or pull by the
 * strength balance (the stronger swarm leans into the weaker one), raiders charge across the frontline
 * (aggression ∝ s) and close contacts clash: the loser (odds by strength) drops out and respawns at home.
 * Speed, brightness and trail length ∝ s. All state lives in typed arrays and the neighbour search uses a
 * uniform-grid spatial hash rebuilt every step; nothing is allocated per particle or per frame. Randomness
 * comes from a seeded generator, so a run is reproducible from its seed and inputs.
 */
import { CORE, TAU } from './layout';

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

const HIT_RATE = 2.4; // clashes per close enemy contact per second
const MAX_CLASHES = 256; // per step
const OVERLAP = 0.03; // anchors may sit this far (normalised distance) past their territory edge, so the swarms meet
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

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
  const lo = Math.max(0, Math.min(r0, r1));
  const hi = Math.max(0, Math.max(r0, r1));
  return { rho: Math.sqrt(lo * lo + (hi * hi - lo * lo) * clamp(u1, 0, 1)), u: clamp(u2, 0, 1) };
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

// ---------------------------------------------------------------------------------------------
// simulation

export interface SwarmUnitIn {
  id: string;
  /** strength 0..100 */
  s: number;
  /** scale share 0..100 */
  c: number;
  /** 0..1 while arriving / leaving */
  presence: number;
  /** 0 clear … 1 thick fog (the frame's `fogBlend`) */
  fog: number;
  /** row of the unit's home sector in `sectors` was filled (the unit has territory) */
  hasSector: boolean;
}

export interface SwarmUnits {
  /** unit id per slot (null = slot unused) */
  readonly id: (string | null)[];
  readonly present: Uint8Array;
  /** strength, its 0..1 normalisation, and the derived looks / behaviour */
  readonly s: Float32Array;
  readonly sN: Float32Array;
  readonly aggr: Float32Array;
  readonly vmax: Float32Array;
  readonly trail: Float32Array;
  readonly bright: Float32Array;
  readonly fog: Float32Array;
  /** smoothed centroid of the swarm (normalised coords) and how many particles are alive in it */
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly alive: Int32Array;
  readonly target: Int32Array;
  /** where the unit warped in (normalised) and the seconds left of its warp-in */
  readonly warpX: Float32Array;
  readonly warpY: Float32Array;
  readonly warpT: Float32Array;
}

export interface SwarmClashes {
  n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly win: Uint8Array;
  readonly lose: Uint8Array;
  /** 0..1: how evenly matched the two sides are */
  readonly close: Float32Array;
}

export interface Swarm {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly alpha: Float32Array;
  readonly state: Uint8Array;
  readonly owner: Uint8Array;
  /** 0..1 per particle: < 0.09 marks an "elite" that gets a glow */
  readonly seed: Float32Array;
  /** > 0 while the particle is charging an enemy (seconds left) */
  readonly charge: Float32Array;
  readonly units: SwarmUnits;
  /** per slot, SECTOR_SAMPLES + 1 pairs (a0, a1) at `sectorRho(j)`; a1 ≥ a0. Fill before `step`. */
  readonly sectors: Float64Array;
  readonly hash: SpatialHash;
  /** clashes of the last step */
  readonly clashes: SwarmClashes;
  /** slots that arrived in the last `sync` (with `warp`) */
  readonly arrivals: { n: number; readonly slot: Int32Array };
  slotOf(id: string): number;
  /**
   * Set this frame's units (≤ MAX_UNITS; extra ones are ignored) and the particle budget. `warp`: units that
   * were absent before warp in at their sector (reported in `arrivals`); `instant`: fill to the targets at once.
   */
  sync(units: readonly SwarmUnitIn[], budget: number, opts?: { warp?: boolean; instant?: boolean }): void;
  /** where a unit's warp-in starts (normalised) — call after `sync`, before `step` */
  setWarp(slot: number, x: number, y: number, seconds: number): void;
  step(dt: number, time: number, opts?: { reduced?: boolean }): void;
  /** blast particles away from (x, y): enemies of `slot` strongly, its own lightly */
  shock(slot: number, x: number, y: number, power: number): void;
  /** slot whose living particle is nearest (x, y) within r, else −1 */
  pick(x: number, y: number, r: number): number;
  /** slot whose home sector contains (x, y), else −1 */
  sectorAt(x: number, y: number): number;
  /** all particles gone, fresh random sequence */
  reset(seed: number): void;
  /** particles currently drawn (alive + fading) */
  readonly visible: number;
}

const ROW = (SECTOR_SAMPLES + 1) * 2;

export function createSwarm(opts: { capacity: number; seed: number }): Swarm {
  const N = Math.max(1, Math.floor(opts.capacity));
  let rnd = mulberry32(opts.seed);
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const alpha = new Float32Array(N);
  const life = new Float32Array(N);
  const charge = new Float32Array(N);
  const seed = new Float32Array(N);
  const squad = new Uint8Array(N);
  const state = new Uint8Array(N);
  const owner = new Uint8Array(N);
  const tgt = new Uint8Array(N);
  const free = new Int32Array(N);
  let freeTop = 0;
  const M = MAX_UNITS;
  const units: SwarmUnits = {
    id: new Array<string | null>(M).fill(null),
    present: new Uint8Array(M),
    s: new Float32Array(M),
    sN: new Float32Array(M),
    aggr: new Float32Array(M),
    vmax: new Float32Array(M),
    trail: new Float32Array(M),
    bright: new Float32Array(M),
    fog: new Float32Array(M),
    cx: new Float32Array(M),
    cy: new Float32Array(M),
    alive: new Int32Array(M),
    target: new Int32Array(M),
    warpX: new Float32Array(M),
    warpY: new Float32Array(M),
    warpT: new Float32Array(M),
  };
  const hasSector = new Uint8Array(M);
  const was = new Uint8Array(M);
  const nSq = new Uint8Array(M).fill(1);
  const sig = new Float32Array(M).fill(0.2);
  const sqX = new Float32Array(M * MAX_SQUADS);
  const sqY = new Float32Array(M * MAX_SQUADS);
  const raid = new Float32Array(M);
  const share = new Float32Array(M);
  const count = new Int32Array(M);
  const sumX = new Float32Array(M);
  const sumY = new Float32Array(M);
  const ccInit = new Uint8Array(M);
  const removeLeft = new Int32Array(M);
  const t1 = new Int16Array(M).fill(-1);
  const t2 = new Int16Array(M).fill(-1);
  const coef = new Float32Array(M * M);
  const weights = new Float64Array(M);
  const alloc = new Int32Array(M);
  const sectors = new Float64Array(M * ROW);
  const slots = new Map<string, number>();
  const clashes: SwarmClashes = { n: 0, x: new Float32Array(MAX_CLASHES), y: new Float32Array(MAX_CLASHES), win: new Uint8Array(MAX_CLASHES), lose: new Uint8Array(MAX_CLASHES), close: new Float32Array(MAX_CLASHES) };
  const arrivals = { n: 0, slot: new Int32Array(M) };
  const hash = createSpatialHash(N, 8);
  let instantFill = false;
  let visible = 0;
  let rn = 0.1;

  function clearAll() {
    state.fill(FREE);
    freeTop = 0;
    for (let i = N - 1; i >= 0; i--) free[freeTop++] = i;
    slots.clear();
    units.id.fill(null);
    units.present.fill(0);
    units.alive.fill(0);
    units.target.fill(0);
    units.warpT.fill(0);
    count.fill(0);
    ccInit.fill(0);
    hasSector.fill(0);
    clashes.n = 0;
    arrivals.n = 0;
    visible = 0;
  }
  clearAll();

  /** angle of a home anchor: fraction u across the slot's sector at radius rho (with the overlap margin) */
  function anchorAngle(slot: number, rho: number, u: number): number {
    const f = clamp(((rho - RHO_MIN) / (RHO_MAX - RHO_MIN)) * SECTOR_SAMPLES, 0, SECTOR_SAMPLES);
    const j = Math.min(SECTOR_SAMPLES - 1, Math.floor(f));
    const t = f - j;
    const b = slot * ROW + j * 2;
    const a0 = sectors[b] + (sectors[b + 2] - sectors[b]) * t;
    const a1 = sectors[b + 1] + (sectors[b + 3] - sectors[b + 1]) * t;
    const span = a1 - a0;
    if (span >= TAU - 1e-6) return a0 + u * TAU;
    const m = Math.min(OVERLAP / Math.max(rho, 0.1), span * 0.5);
    return a0 - m + u * (span + 2 * m);
  }

  /** squad centres of every unit with territory at time t (they drift slowly inside the sector) */
  function placeSquads(t: number) {
    const lo = RHO_MIN + 0.07;
    const hi = RHO_MAX - 0.07;
    for (let s = 0; s < M; s++) {
      if (units.id[s] === null || !hasSector[s]) continue;
      const ns = nSq[s];
      for (let q = 0; q < ns; q++) {
        // radius: golden-ratio sequence (area-uniform); angle: stratified across the sector
        const g = (0.5 + q * 0.6180339887) % 1;
        const rho0 = Math.sqrt(lo * lo + (hi * hi - lo * lo) * g);
        const rho = clamp(rho0 + 0.04 * Math.sin(t * 0.11 + q * 1.7 + s), lo, hi);
        const u = clamp((q + 0.5) / ns + (0.22 / ns) * Math.sin(t * 0.13 + q * 2.3 + s * 0.7), 0.04, 0.96);
        const a = anchorAngle(s, rho, u);
        sqX[s * MAX_SQUADS + q] = Math.cos(a) * rho;
        sqY[s * MAX_SQUADS + q] = Math.sin(a) * rho;
      }
    }
  }

  function spawn(i: number, slot: number) {
    owner[i] = slot;
    state[i] = ALIVE;
    alpha[i] = instantFill ? rnd() * 0.4 : 0;
    charge[i] = 0;
    seed[i] = rnd();
    squad[i] = Math.floor(rnd() * 256);
    if (units.warpT[slot] > 0) {
      // warp-in: appear at the beam and burst outward toward the anchors
      const a = rnd() * TAU;
      const sp = units.vmax[slot] * (1.5 + rnd() * 2);
      x[i] = units.warpX[slot] + Math.cos(a) * 0.015;
      y[i] = units.warpY[slot] + Math.sin(a) * 0.015;
      vx[i] = Math.cos(a) * sp;
      vy[i] = Math.sin(a) * sp;
      return;
    }
    const q = squad[i] % nSq[slot];
    const p = sampleInSector(0, sig[slot] * 0.8, rnd(), rnd());
    const ja = p.u * TAU;
    x[i] = sqX[slot * MAX_SQUADS + q] + Math.cos(ja) * p.rho;
    y[i] = sqY[slot * MAX_SQUADS + q] + Math.sin(ja) * p.rho;
    vx[i] = (rnd() - 0.5) * 0.06;
    vy[i] = (rnd() - 0.5) * 0.06;
  }

  function release(i: number) {
    state[i] = FREE;
    free[freeTop++] = i;
  }

  function enforceCounts() {
    let need = false;
    for (let s = 0; s < M; s++) {
      removeLeft[s] = 0;
      if (units.id[s] === null) continue;
      const diff = units.target[s] - count[s];
      if (diff > 0 && hasSector[s]) {
        const n = instantFill ? diff : Math.min(diff, Math.max(4, Math.ceil(diff * 0.08)));
        for (let k = 0; k < n && freeTop > 0; k++) {
          spawn(free[--freeTop], s);
          count[s]++;
        }
      } else if (diff < 0) {
        removeLeft[s] = instantFill ? -diff : Math.min(-diff, Math.max(4, Math.ceil(-diff * 0.1)));
        need = true;
      }
    }
    instantFill = false;
    if (!need) return;
    const from = Math.floor(rnd() * N);
    for (let q = 0; q < N; q++) {
      const i = (from + q) % N;
      const st = state[i];
      if (st !== ALIVE && st !== DEAD) continue;
      const s = owner[i];
      if (removeLeft[s] <= 0) continue;
      removeLeft[s]--;
      count[s]--;
      if (st === DEAD) release(i);
      else state[i] = FADING;
    }
  }

  /** the loser of a clash between i and j (odds by strength); records the clash. Returns the loser. */
  function clash(i: number, j: number): number {
    const si = units.s[owner[i]];
    const sj = units.s[owner[j]];
    const r = Math.pow(Math.max(1, sj) / Math.max(1, si), 8);
    const loser = rnd() < r / (1 + r) ? i : j;
    const winner = loser === i ? j : i;
    if (clashes.n < MAX_CLASHES) {
      const k = clashes.n++;
      clashes.x[k] = (x[i] + x[j]) * 0.5;
      clashes.y[k] = (y[i] + y[j]) * 0.5;
      clashes.win[k] = owner[winner];
      clashes.lose[k] = owner[loser];
      clashes.close[k] = 1 - clamp(Math.abs(si - sj) / 12, 0, 1);
    }
    state[loser] = DEAD;
    life[loser] = 0.25 + rnd() * 0.9;
    alpha[loser] = 0;
    charge[loser] = 0;
    const dx = x[winner] - x[loser];
    const dy = y[winner] - y[loser];
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
    const kick = units.vmax[owner[winner]] * 0.9;
    vx[winner] += (dx / d) * kick;
    vy[winner] += (dy / d) * kick;
    return loser;
  }

  const swarm: Swarm = {
    capacity: N,
    x,
    y,
    vx,
    vy,
    alpha,
    state,
    owner,
    seed,
    charge,
    units,
    sectors,
    hash,
    clashes,
    arrivals,
    get visible() {
      return visible;
    },
    slotOf(id) {
      return slots.get(id) ?? -1;
    },
    sync(list, budget, o = {}) {
      arrivals.n = 0;
      if (o.instant) instantFill = true;
      was.set(units.present);
      units.present.fill(0);
      weights.fill(0);
      let minS = Infinity;
      let maxS = -Infinity;
      let np = 0;
      let W = 0;
      for (let k = 0; k < list.length; k++) {
        const u = list[k];
        let s = slots.get(u.id);
        if (s === undefined) {
          // a free slot: never used, or its unit is gone and all its particles too
          s = -1;
          for (let q = 0; q < M; q++) {
            if (units.id[q] === null || (!was[q] && count[q] === 0 && !list.some((v) => v.id === units.id[q]))) {
              s = q;
              break;
            }
          }
          if (s < 0) continue;
          const old = units.id[s];
          if (old !== null) slots.delete(old);
          slots.set(u.id, s);
          units.id[s] = u.id;
          ccInit[s] = 0;
          count[s] = 0;
        }
        const w = unitWeight(u.c, u.presence);
        if (w <= 0) continue;
        units.present[s] = 1;
        hasSector[s] = u.hasSector ? 1 : 0;
        weights[s] = u.hasSector ? w : 0;
        W += weights[s];
        const sv = Number.isFinite(u.s) ? u.s : 0;
        units.s[s] = sv;
        units.fog[s] = clamp(Number.isFinite(u.fog) ? u.fog : 0, 0, 1);
        minS = Math.min(minS, sv);
        maxS = Math.max(maxS, sv);
        np++;
        if (!was[s] && o.warp) arrivals.slot[arrivals.n++] = s;
      }
      allocateParticles(weights, Math.min(N, budget), alloc);
      for (let s = 0; s < M; s++) {
        units.target[s] = units.present[s] ? alloc[s] : 0;
        share[s] = W > 0 ? weights[s] / W : 0;
        if (!units.present[s]) continue;
        // squads ∝ territory; each about as wide as its share of the sector
        const area = share[s] * Math.PI * (RHO_MAX * RHO_MAX - RHO_MIN * RHO_MIN);
        nSq[s] = clamp(Math.round(share[s] * 9), 1, MAX_SQUADS);
        sig[s] = clamp(0.62 * Math.sqrt(area / nSq[s]), 0.05, 0.4);
        // strength → speed, glow, trail and aggression (mockup C `updateFactions`)
        const absN = clamp((units.s[s] - 50) / 47, 0, 1);
        // clamped: units.s is float32, minS / maxS were taken from the float64 values
        const relN = np > 1 ? clamp((units.s[s] - minS) / (maxS - minS + 4), 0, 1) : 0.5;
        units.sN[s] = absN;
        units.aggr[s] = 0.12 + 0.88 * Math.pow(0.45 * absN + 0.55 * relN, 1.3);
        units.vmax[s] = 0.075 + 0.2 * Math.pow(absN, 1.2);
        units.trail[s] = 0.03 + 0.09 * absN * absN;
        units.bright[s] = Math.min(1, 0.45 + 0.55 * Math.pow(absN, 1.4));
        raid[s] = np > 1 ? 0.075 * units.aggr[s] * units.aggr[s] : 0;
      }
      // pair coefficients: > 0 pushes F away from E, < 0 pulls F in (the stronger side leans into the weaker)
      for (let f = 0; f < M; f++) {
        if (!units.present[f]) continue;
        for (let e = 0; e < M; e++) {
          if (e === f || !units.present[e]) continue;
          coef[f * M + e] = (units.sN[e] / (units.sN[f] + units.sN[e] + 0.05)) * 1.5 - units.aggr[f] * 0.95;
        }
      }
      // raid targets: weak, near and big enemies first
      for (let f = 0; f < M; f++) {
        t1[f] = t2[f] = -1;
        if (!units.present[f]) continue;
        let b1 = -1;
        let b2 = -1;
        let s1 = 0;
        let s2 = 0;
        for (let e = 0; e < M; e++) {
          if (e === f || !units.present[e] || units.alive[e] < 3) continue;
          const d = Math.hypot(units.cx[e] - units.cx[f], units.cy[e] - units.cy[f]);
          const sc = (Math.exp((units.s[f] - units.s[e]) / 7) * (0.25 + share[e])) / (0.25 + d);
          if (sc > s1) {
            s2 = s1;
            b2 = b1;
            s1 = sc;
            b1 = e;
          } else if (sc > s2) {
            s2 = sc;
            b2 = e;
          }
        }
        t1[f] = b1;
        t2[f] = b2 < 0 ? b1 : b2;
      }
    },
    setWarp(s, wx, wy, seconds) {
      if (s < 0 || s >= M) return;
      units.warpX[s] = wx;
      units.warpY[s] = wy;
      units.warpT[s] = seconds;
    },
    step(dt, time, o = {}) {
      clashes.n = 0;
      if (!(dt > 0)) return;
      const reduced = !!o.reduced;
      placeSquads(time);
      enforceCounts();
      for (let s = 0; s < M; s++) {
        sumX[s] = 0;
        sumY[s] = 0;
        units.alive[s] = 0;
        count[s] = 0;
        if (units.warpT[s] > 0) units.warpT[s] = Math.max(0, units.warpT[s] - dt);
      }
      // neighbour radius ~ 1.5 × the mean particle spacing; the grid cell equals it
      let live = 0;
      for (let i = 0; i < N; i++) if (state[i] === ALIVE) live++;
      const G = Math.max(6, Math.floor(2 / (1.5 * Math.sqrt(Math.PI / Math.max(60, live)))));
      hash.setGrid(G);
      rn = 2 / G;
      hash.build(x, y, state, ALIVE, N);
      const { start, items } = hash;
      const speedK = reduced ? 0.25 : 1;
      const steer = 1 - Math.exp(-3.4 * dt);
      const fadeDrag = Math.exp(-2 * dt);
      const pHit = 1 - Math.exp(-HIT_RATE * (reduced ? 0.15 : 1) * dt);
      const rn2 = rn * rn;
      const rs = rn * 0.42;
      const rs2 = rs * rs;
      const rh = rn * 0.36;
      const rh2 = rh * rh;
      const irn = 1 / rn;
      const rMin2 = RHO_MIN * RHO_MIN;
      const rMax2 = RHO_MAX * RHO_MAX;
      visible = 0;

      for (let i = 0; i < N; i++) {
        const st = state[i];
        if (st === FREE) continue;
        const f = owner[i];
        if (st === DEAD) {
          count[f]++;
          life[i] -= dt;
          if (life[i] <= 0) {
            if (units.present[f] && hasSector[f]) spawn(i, f);
            else {
              release(i);
              count[f]--;
            }
          }
          continue;
        }
        if (st === FADING) {
          const al = alpha[i] - dt * 1.7;
          if (al <= 0) {
            release(i);
            continue;
          }
          alpha[i] = al;
          vx[i] *= fadeDrag;
          vy[i] *= fadeDrag;
          x[i] += vx[i] * dt;
          y[i] += vy[i] * dt;
          visible++;
          continue;
        }

        // ---- alive ----
        count[f]++;
        units.alive[f]++;
        visible++;
        let px = x[i];
        let py = y[i];
        sumX[f] += px;
        sumY[f] += py;
        if (alpha[i] < 1) alpha[i] = Math.min(1, alpha[i] + dt * 1.5);
        const vmax = units.vmax[f] * speedK;
        let dvx = 0;
        let dvy = 0;
        let lim = 1.15;

        // the particle's squad in the home sector (follows the animated territory edges)
        const q = squad[i] % nSq[f];
        let hx = sqX[f * MAX_SQUADS + q] - px;
        let hy = sqY[f * MAX_SQUADS + q] - py;
        const hd = Math.sqrt(hx * hx + hy * hy) + 1e-6;
        hx /= hd;
        hy /= hd;
        const rel = hd / sig[f];

        let chg = charge[i];
        if (chg > 0) {
          chg -= dt;
          const e = tgt[i];
          if (chg <= 0 || !units.present[e]) charge[i] = 0;
          else {
            const tx = units.cx[e] - px;
            const ty = units.cy[e] - py;
            const td = Math.sqrt(tx * tx + ty * ty) + 1e-6;
            if (td < 0.05) charge[i] = 0;
            else {
              charge[i] = chg;
              dvx += (tx / td) * vmax * 1.7;
              dvy += (ty / td) * vmax * 1.7;
              lim = 1.8;
            }
          }
        }
        if (charge[i] <= 0) {
          // cohesion to the squad + a swirl around it (neighbouring squads turn opposite ways)
          const pull = rel < 1 ? 0.14 * rel : 0.14 + (rel - 1) * 1.6;
          const pm = (pull > 2.4 ? 2.4 : pull) * vmax;
          dvx += hx * pm;
          dvy += hy * pm;
          const sw = vmax * 0.8 * (rel < 1 ? rel : 1 / rel) * ((q + f) & 1 ? 1 : -1);
          dvx -= hy * sw;
          dvy += hx * sw;
          if (!reduced && raid[f] > 0 && t1[f] >= 0 && alpha[i] > 0.9 && rnd() < raid[f] * dt) {
            charge[i] = 0.9 + rnd() * 1.5;
            tgt[i] = rnd() < 0.7 ? t1[f] : t2[f];
          }
        }
        // noise field (organic wobble)
        const sd = seed[i];
        const na = Math.sin(px * 4.7 + time * 0.31 + sd * 9) * 2.6 + Math.cos(py * 4.1 - time * 0.27 + sd * 5) * 2.6;
        const nz = vmax * 0.38;
        dvx += Math.cos(na) * nz;
        dvy += Math.sin(na) * nz;

        // neighbours: alignment + separation with friends, push / pull and clashes with enemies
        const cl = hash.cellOf[i];
        const gx = cl % G;
        const gy = (cl / G) | 0;
        const myAl = alpha[i];
        const cb = f * M;
        let sepx = 0;
        let sepy = 0;
        let alx = 0;
        let aly = 0;
        let aln = 0;
        let enx = 0;
        let eny = 0;
        let killed = false;
        const yA = gy > 0 ? gy - 1 : 0;
        const yB = gy < G - 1 ? gy + 1 : G - 1;
        const xA = gx > 0 ? gx - 1 : 0;
        const xB = gx < G - 1 ? gx + 1 : G - 1;
        for (let yy = yA; yy <= yB && !killed; yy++) {
          for (let xx = xA; xx <= xB; xx++) {
            const c = yy * G + xx;
            for (let k = start[c], e = start[c + 1]; k < e; k++) {
              const j = items[k];
              if (j === i || state[j] !== ALIVE) continue;
              const ddx = px - x[j];
              const ddy = py - y[j];
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 > rn2 || d2 < 1e-12) continue;
              if (owner[j] === f) {
                alx += vx[j];
                aly += vy[j];
                aln++;
                if (d2 < rs2) {
                  const d = Math.sqrt(d2);
                  const w = (rs - d) / (rs * d);
                  sepx += ddx * w;
                  sepy += ddy * w;
                }
              } else {
                const net = coef[cb + owner[j]] * (1 / Math.sqrt(d2) - irn);
                enx += ddx * net;
                eny += ddy * net;
                if (d2 < rh2 && myAl > 0.6 && alpha[j] > 0.6 && rnd() < pHit && clash(i, j) === i) {
                  killed = true;
                  break;
                }
              }
            }
            if (killed) break;
          }
        }
        if (killed) {
          units.alive[f]--;
          sumX[f] -= px;
          sumY[f] -= py;
          visible--;
          continue;
        }
        if (aln > 0) {
          dvx += (alx / aln) * 0.35;
          dvy += (aly / aln) * 0.35;
        }
        dvx += sepx * vmax * 0.9 + enx * vmax * 0.7;
        dvy += sepy * vmax * 0.9 + eny * vmax * 0.7;

        // walls: the rim and the planet core
        const r2 = px * px + py * py;
        if (r2 > RHO_MAX * RHO_MAX * 0.94) {
          const r = Math.sqrt(r2);
          const k = (r - RHO_MAX * 0.97) * 25 * vmax;
          dvx -= (px / r) * k;
          dvy -= (py / r) * k;
        } else if (r2 < rMin2 * 1.3) {
          const r = Math.sqrt(r2) + 1e-6;
          const k = (RHO_MIN * 1.14 - r) * 25 * vmax;
          dvx += (px / r) * k;
          dvy += (py / r) * k;
        }

        const dm = Math.sqrt(dvx * dvx + dvy * dvy);
        const mx = vmax * lim;
        if (dm > mx) {
          dvx *= mx / dm;
          dvy *= mx / dm;
        }
        let nvx = vx[i] + (dvx - vx[i]) * steer;
        let nvy = vy[i] + (dvy - vy[i]) * steer;
        px += nvx * dt;
        py += nvy * dt;
        const rr = px * px + py * py;
        if (rr > rMax2 || rr < rMin2) {
          // hard walls: back inside, bounce the radial velocity
          const r = Math.sqrt(rr) + 1e-9;
          const nx = px / r;
          const ny = py / r;
          const lim2 = rr > rMax2 ? RHO_MAX : RHO_MIN;
          px = nx * lim2;
          py = ny * lim2;
          const vr = nvx * nx + nvy * ny;
          if ((rr > rMax2 && vr > 0) || (rr < rMin2 && vr < 0)) {
            nvx -= vr * nx * 1.6;
            nvy -= vr * ny * 1.6;
          }
        }
        if (px !== px || py !== py || nvx !== nvx || nvy !== nvy) {
          spawn(i, f); // never let a NaN poison the centroids (bad input data): start over at home
          continue;
        }
        x[i] = px;
        y[i] = py;
        vx[i] = nvx;
        vy[i] = nvy;
      }

      // smoothed centroids
      const kS = 1 - Math.exp(-dt * 5);
      for (let s = 0; s < M; s++) {
        const n = units.alive[s];
        if (n > 0) {
          const tx = sumX[s] / n;
          const ty = sumY[s] / n;
          if (!ccInit[s]) {
            units.cx[s] = tx;
            units.cy[s] = ty;
            ccInit[s] = 1;
          } else {
            units.cx[s] += (tx - units.cx[s]) * kS;
            units.cy[s] += (ty - units.cy[s]) * kS;
          }
        } else if (!units.present[s]) ccInit[s] = 0;
      }
    },
    shock(slot, sx, sy, power) {
      const rad = 0.75 * power;
      for (let i = 0; i < N; i++) {
        if (state[i] !== ALIVE) continue;
        const dx = x[i] - sx;
        const dy = y[i] - sy;
        const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
        if (d > rad) continue;
        const k = (1 - d / rad) * (owner[i] === slot ? 0.22 : 0.62) * power;
        vx[i] += (dx / d) * k;
        vy[i] += (dy / d) * k;
      }
    },
    pick(px, py, r) {
      let best = -1;
      let bd = r * r;
      const G = hash.G;
      const c0x = Math.max(0, Math.floor((px - r + 1) * 0.5 * G));
      const c1x = Math.min(G - 1, Math.floor((px + r + 1) * 0.5 * G));
      const c0y = Math.max(0, Math.floor((py - r + 1) * 0.5 * G));
      const c1y = Math.min(G - 1, Math.floor((py + r + 1) * 0.5 * G));
      for (let gy = c0y; gy <= c1y; gy++)
        for (let gx = c0x; gx <= c1x; gx++) {
          const c = gy * G + gx;
          for (let k = hash.start[c], e = hash.start[c + 1]; k < e; k++) {
            const j = hash.items[k];
            if (state[j] !== ALIVE) continue;
            const d = (x[j] - px) ** 2 + (y[j] - py) ** 2;
            if (d <= bd) {
              bd = d;
              best = owner[j];
            }
          }
        }
      return best;
    },
    sectorAt(px, py) {
      const rho = Math.hypot(px, py);
      if (rho > 1) return -1;
      const ang = Math.atan2(py, px);
      for (let s = 0; s < M; s++) {
        if (!units.present[s] || !hasSector[s]) continue;
        const a0 = anchorAngle(s, rho, 0);
        const a1 = anchorAngle(s, rho, 1);
        let a = ang;
        while (a < a0) a += TAU;
        while (a >= a0 + TAU) a -= TAU;
        if (a <= a1) return s;
      }
      return -1;
    },
    reset(next) {
      rnd = mulberry32(next);
      clearAll();
    },
  };
  return swarm;
}
