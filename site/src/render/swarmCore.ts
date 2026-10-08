/**
 * State of the swarm battle (./swarm) as one struct of typed arrays — shared by the public API (./swarm: sync,
 * picking) and the particle loop (./swarmStep) — plus the helpers both use: squad placement inside the home
 * sectors, spawning, releasing, keeping each swarm at its target size and resolving clashes.
 */
import { TAU } from './layout';
import {
  ALIVE,
  DEAD,
  FADING,
  FREE,
  MAX_CLASHES,
  MAX_SQUADS,
  MAX_UNITS,
  OVERLAP,
  RHO_MAX,
  RHO_MIN,
  SECTOR_SAMPLES,
  areaRho,
  clamp,
  createSpatialHash,
  mulberry32,
  type SpatialHash,
} from './swarmMath';

/** floats per unit in the sector table: SECTOR_SAMPLES + 1 pairs (a0, a1) */
export const ROW = (SECTOR_SAMPLES + 1) * 2;

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

export interface SwarmCore {
  readonly N: number;
  rnd: () => number;
  // particles
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly alpha: Float32Array;
  /** seconds until a DEAD particle respawns */
  readonly life: Float32Array;
  readonly charge: Float32Array;
  readonly seed: Float32Array;
  /** random squad pick (taken modulo the unit's squad count) */
  readonly squad: Uint8Array;
  readonly state: Uint8Array;
  readonly owner: Uint8Array;
  /** slot a charging particle is after */
  readonly tgt: Uint8Array;
  readonly free: Int32Array;
  freeTop: number;
  // units (per slot)
  readonly units: SwarmUnits;
  readonly hasSector: Uint8Array;
  readonly was: Uint8Array;
  readonly nSq: Uint8Array;
  readonly sig: Float32Array;
  readonly sqX: Float32Array;
  readonly sqY: Float32Array;
  readonly raid: Float32Array;
  readonly share: Float32Array;
  /** particles a unit has (alive + waiting to respawn) */
  readonly count: Int32Array;
  readonly sumX: Float32Array;
  readonly sumY: Float32Array;
  readonly ccInit: Uint8Array;
  readonly removeLeft: Int32Array;
  readonly t1: Int16Array;
  readonly t2: Int16Array;
  /** MAX_UNITS² pair coefficients: > 0 pushes F away from E, < 0 pulls F in */
  readonly coef: Float32Array;
  readonly weights: Float64Array;
  readonly alloc: Int32Array;
  readonly sectors: Float64Array;
  readonly slots: Map<string, number>;
  readonly clashes: SwarmClashes;
  readonly arrivals: { n: number; readonly slot: Int32Array };
  readonly hash: SpatialHash;
  instantFill: boolean;
  visible: number;
}

export function createCore(capacity: number, seed: number): SwarmCore {
  const N = Math.max(1, Math.floor(capacity));
  const M = MAX_UNITS;
  const f32 = (n: number) => new Float32Array(n);
  const c: SwarmCore = {
    N,
    rnd: mulberry32(seed),
    x: f32(N),
    y: f32(N),
    vx: f32(N),
    vy: f32(N),
    alpha: f32(N),
    life: f32(N),
    charge: f32(N),
    seed: f32(N),
    squad: new Uint8Array(N),
    state: new Uint8Array(N),
    owner: new Uint8Array(N),
    tgt: new Uint8Array(N),
    free: new Int32Array(N),
    freeTop: 0,
    units: {
      id: new Array<string | null>(M).fill(null),
      present: new Uint8Array(M),
      s: f32(M),
      sN: f32(M),
      aggr: f32(M),
      vmax: f32(M),
      trail: f32(M),
      bright: f32(M),
      fog: f32(M),
      cx: f32(M),
      cy: f32(M),
      alive: new Int32Array(M),
      target: new Int32Array(M),
      warpX: f32(M),
      warpY: f32(M),
      warpT: f32(M),
    },
    hasSector: new Uint8Array(M),
    was: new Uint8Array(M),
    nSq: new Uint8Array(M).fill(1),
    sig: f32(M).fill(0.2),
    sqX: f32(M * MAX_SQUADS),
    sqY: f32(M * MAX_SQUADS),
    raid: f32(M),
    share: f32(M),
    count: new Int32Array(M),
    sumX: f32(M),
    sumY: f32(M),
    ccInit: new Uint8Array(M),
    removeLeft: new Int32Array(M),
    t1: new Int16Array(M).fill(-1),
    t2: new Int16Array(M).fill(-1),
    coef: f32(M * M),
    weights: new Float64Array(M),
    alloc: new Int32Array(M),
    sectors: new Float64Array(M * ROW),
    slots: new Map(),
    clashes: { n: 0, x: f32(MAX_CLASHES), y: f32(MAX_CLASHES), win: new Uint8Array(MAX_CLASHES), lose: new Uint8Array(MAX_CLASHES), close: f32(MAX_CLASHES) },
    arrivals: { n: 0, slot: new Int32Array(M) },
    hash: createSpatialHash(N, 8),
    instantFill: false,
    visible: 0,
  };
  clearCore(c);
  return c;
}

/** every particle free, no units */
export function clearCore(c: SwarmCore): void {
  c.state.fill(FREE);
  c.freeTop = 0;
  for (let i = c.N - 1; i >= 0; i--) c.free[c.freeTop++] = i;
  c.slots.clear();
  const u = c.units;
  u.id.fill(null);
  u.present.fill(0);
  u.alive.fill(0);
  u.target.fill(0);
  u.warpT.fill(0);
  c.count.fill(0);
  c.ccInit.fill(0);
  c.hasSector.fill(0);
  c.clashes.n = 0;
  c.arrivals.n = 0;
  c.visible = 0;
}

/** angle at fraction u across a slot's home sector at radius rho (with the overlap margin past both edges) */
export function anchorAngle(c: SwarmCore, slot: number, rho: number, u: number): number {
  const f = clamp(((rho - RHO_MIN) / (RHO_MAX - RHO_MIN)) * SECTOR_SAMPLES, 0, SECTOR_SAMPLES);
  const j = Math.min(SECTOR_SAMPLES - 1, Math.floor(f));
  const t = f - j;
  const sec = c.sectors;
  const b = slot * ROW + j * 2;
  const a0 = sec[b] + (sec[b + 2] - sec[b]) * t;
  const a1 = sec[b + 1] + (sec[b + 3] - sec[b + 1]) * t;
  const span = a1 - a0;
  if (span >= TAU - 1e-6) return a0 + u * TAU;
  const m = Math.min(OVERLAP / Math.max(rho, 0.1), span * 0.5);
  return a0 - m + u * (span + 2 * m);
}

/** squad centres of every unit with territory at time t (they drift slowly inside the sector) */
export function placeSquads(c: SwarmCore, t: number): void {
  const lo = RHO_MIN + 0.07;
  const hi = RHO_MAX - 0.07;
  for (let s = 0; s < MAX_UNITS; s++) {
    if (c.units.id[s] === null || !c.hasSector[s]) continue;
    const ns = c.nSq[s];
    for (let q = 0; q < ns; q++) {
      // radius: golden-ratio sequence (area-uniform); angle: stratified across the sector
      const g = (0.5 + q * 0.6180339887) % 1;
      const rho0 = Math.sqrt(lo * lo + (hi * hi - lo * lo) * g);
      const rho = clamp(rho0 + 0.04 * Math.sin(t * 0.11 + q * 1.7 + s), lo, hi);
      const u = clamp((q + 0.5) / ns + (0.22 / ns) * Math.sin(t * 0.13 + q * 2.3 + s * 0.7), 0.04, 0.96);
      const a = anchorAngle(c, s, rho, u);
      c.sqX[s * MAX_SQUADS + q] = Math.cos(a) * rho;
      c.sqY[s * MAX_SQUADS + q] = Math.sin(a) * rho;
    }
  }
}

/** (re)start particle i for `slot`: in one of its squads, or bursting out of the warp beam while it warps in */
export function spawn(c: SwarmCore, i: number, slot: number): void {
  const { rnd, units } = c;
  c.owner[i] = slot;
  c.state[i] = ALIVE;
  c.alpha[i] = c.instantFill ? rnd() * 0.4 : 0;
  c.charge[i] = 0;
  c.seed[i] = rnd();
  c.squad[i] = Math.floor(rnd() * 256);
  if (units.warpT[slot] > 0) {
    const a = rnd() * TAU;
    const sp = units.vmax[slot] * (1.5 + rnd() * 2);
    c.x[i] = units.warpX[slot] + Math.cos(a) * 0.015;
    c.y[i] = units.warpY[slot] + Math.sin(a) * 0.015;
    c.vx[i] = Math.cos(a) * sp;
    c.vy[i] = Math.sin(a) * sp;
    return;
  }
  const q = c.squad[i] % c.nSq[slot];
  const r = areaRho(0, c.sig[slot] * 0.8, rnd());
  const a = rnd() * TAU;
  c.x[i] = c.sqX[slot * MAX_SQUADS + q] + Math.cos(a) * r;
  c.y[i] = c.sqY[slot * MAX_SQUADS + q] + Math.sin(a) * r;
  c.vx[i] = (rnd() - 0.5) * 0.06;
  c.vy[i] = (rnd() - 0.5) * 0.06;
}

export function release(c: SwarmCore, i: number): void {
  c.state[i] = FREE;
  c.free[c.freeTop++] = i;
}

/** grow swarms toward their target (a few per frame, all at once after `instant`), fade out the surplus */
export function enforceCounts(c: SwarmCore): void {
  const { units, count, removeLeft, state, owner, N } = c;
  let need = false;
  for (let s = 0; s < MAX_UNITS; s++) {
    removeLeft[s] = 0;
    if (units.id[s] === null) continue;
    const diff = units.target[s] - count[s];
    if (diff > 0 && c.hasSector[s]) {
      const n = c.instantFill ? diff : Math.min(diff, Math.max(4, Math.ceil(diff * 0.08)));
      for (let k = 0; k < n && c.freeTop > 0; k++) {
        spawn(c, c.free[--c.freeTop], s);
        count[s]++;
      }
    } else if (diff < 0) {
      removeLeft[s] = c.instantFill ? -diff : Math.min(-diff, Math.max(4, Math.ceil(-diff * 0.1)));
      need = true;
    }
  }
  c.instantFill = false;
  if (!need) return;
  const from = Math.floor(c.rnd() * N);
  for (let q = 0; q < N; q++) {
    const i = (from + q) % N;
    const st = state[i];
    if (st !== ALIVE && st !== DEAD) continue;
    const s = owner[i];
    if (removeLeft[s] <= 0) continue;
    removeLeft[s]--;
    count[s]--;
    if (st === DEAD) release(c, i);
    else state[i] = FADING;
  }
}

/** a clash between enemies i and j: the loser (odds by strength) drops out to respawn later. Returns the loser. */
export function clash(c: SwarmCore, i: number, j: number): number {
  const { units, owner, x, y, clashes } = c;
  const si = units.s[owner[i]];
  const sj = units.s[owner[j]];
  const r = Math.pow(Math.max(1, sj) / Math.max(1, si), 8);
  const loser = c.rnd() < r / (1 + r) ? i : j;
  const winner = loser === i ? j : i;
  if (clashes.n < MAX_CLASHES) {
    const k = clashes.n++;
    clashes.x[k] = (x[i] + x[j]) * 0.5;
    clashes.y[k] = (y[i] + y[j]) * 0.5;
    clashes.win[k] = owner[winner];
    clashes.lose[k] = owner[loser];
    clashes.close[k] = 1 - clamp(Math.abs(si - sj) / 12, 0, 1);
  }
  c.state[loser] = DEAD;
  c.life[loser] = 0.25 + c.rnd() * 0.9;
  c.alpha[loser] = 0;
  c.charge[loser] = 0;
  const dx = x[winner] - x[loser];
  const dy = y[winner] - y[loser];
  const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
  const kick = units.vmax[owner[winner]] * 0.9;
  c.vx[winner] += (dx / d) * kick;
  c.vy[winner] += (dy / d) * kick;
  return loser;
}
