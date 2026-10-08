/**
 * Particle-swarm battle simulation (ported from mockups/c-swarm.html §3) — pure maths, no PixiJS.
 *
 * Coordinates are planet-local and normalised (the planet disc has radius 1, angles as in ./layout: y down).
 * Every unit gets a swarm whose size ∝ c × presence, split into squads (∝ its territory) whose centres are spread
 * over the unit's home sector — the planet's territory wedge, fed per frame through `sectors` — so the swarms fill
 * the same territories the overview shows and follow the animated frontlines. Boids-style steering (cohesion to the
 * squad + a swirl around it, alignment, separation, a noise field) keeps them organic; enemies within reach push or
 * pull by the strength balance (the stronger swarm leans into the weaker one), raiders charge across the frontline
 * (aggression ∝ s) and close contacts clash: the loser (odds by strength) drops out and respawns at home.
 * Speed, brightness and trail length ∝ s. All state lives in typed arrays (./swarmCore), the neighbour search uses a
 * uniform-grid spatial hash rebuilt every step (./swarmMath) and the particle loop (./swarmStep) allocates nothing.
 * Randomness comes from a seeded generator, so a run is reproducible from its seed and inputs.
 */
import { TAU } from './layout';
import { ALIVE, MAX_SQUADS, MAX_UNITS, RHO_MAX, RHO_MIN, allocateParticles, clamp, mulberry32, unitWeight, type SpatialHash } from './swarmMath';
import { anchorAngle, clearCore, createCore, type SwarmClashes, type SwarmUnits } from './swarmCore';
import { stepSwarm } from './swarmStep';

export * from './swarmMath';
export type { SwarmClashes, SwarmUnits } from './swarmCore';

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
  /** the unit has territory: its row in `sectors` is filled */
  hasSector: boolean;
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
  /** per slot, SECTOR_SAMPLES + 1 pairs (a0, a1) at `sectorRho(j)`; a1 ≥ a0. Fill after `sync`, before `step`. */
  readonly sectors: Float64Array;
  readonly hash: SpatialHash;
  /** clashes of the last step */
  readonly clashes: SwarmClashes;
  /** slots that arrived in the last `sync` (with `warp`) */
  readonly arrivals: { n: number; readonly slot: Int32Array };
  /** particles currently drawn (alive + fading) */
  readonly visible: number;
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
}

export function createSwarm(opts: { capacity: number; seed: number }): Swarm {
  const c = createCore(opts.capacity, opts.seed);
  const { N, units, slots, was, weights, alloc, share, count, hasSector, coef, t1, t2, arrivals, x, y, vx, vy, state, owner, hash } = c;
  const M = MAX_UNITS;

  /** a slot for a new unit id: never used, or its unit is gone along with all its particles */
  function freeSlot(list: readonly SwarmUnitIn[]): number {
    for (let q = 0; q < M; q++) {
      const id = units.id[q];
      if (id === null || (!was[q] && count[q] === 0 && !list.some((v) => v.id === id))) return q;
    }
    return -1;
  }

  return {
    capacity: N,
    x,
    y,
    vx,
    vy,
    alpha: c.alpha,
    state,
    owner,
    seed: c.seed,
    charge: c.charge,
    units,
    sectors: c.sectors,
    hash,
    clashes: c.clashes,
    arrivals,
    get visible() {
      return c.visible;
    },
    slotOf(id) {
      return slots.get(id) ?? -1;
    },
    sync(list, budget, o = {}) {
      arrivals.n = 0;
      if (o.instant) c.instantFill = true;
      was.set(units.present);
      units.present.fill(0);
      weights.fill(0);
      let minS = Infinity;
      let maxS = -Infinity;
      let np = 0;
      let W = 0;
      for (const u of list) {
        let s = slots.get(u.id);
        if (s === undefined) {
          s = freeSlot(list);
          if (s < 0) continue;
          const old = units.id[s];
          if (old !== null) slots.delete(old);
          slots.set(u.id, s);
          units.id[s] = u.id;
          c.ccInit[s] = 0;
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
        c.nSq[s] = clamp(Math.round(share[s] * 9), 1, MAX_SQUADS);
        c.sig[s] = clamp(0.62 * Math.sqrt(area / c.nSq[s]), 0.05, 0.4);
        // strength → speed, glow, trail and aggression (mockup C `updateFactions`)
        const absN = clamp((units.s[s] - 50) / 47, 0, 1);
        // clamped: units.s is float32, minS / maxS were taken from the float64 values
        const relN = np > 1 ? clamp((units.s[s] - minS) / (maxS - minS + 4), 0, 1) : 0.5;
        units.sN[s] = absN;
        units.aggr[s] = 0.12 + 0.88 * Math.pow(0.45 * absN + 0.55 * relN, 1.3);
        units.vmax[s] = 0.075 + 0.2 * Math.pow(absN, 1.2);
        units.trail[s] = 0.03 + 0.09 * absN * absN;
        units.bright[s] = Math.min(1, 0.45 + 0.55 * Math.pow(absN, 1.4));
        c.raid[s] = np > 1 ? 0.075 * units.aggr[s] * units.aggr[s] : 0;
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
      stepSwarm(c, dt, time, !!o.reduced);
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
          const cell = gy * G + gx;
          for (let k = hash.start[cell], e = hash.start[cell + 1]; k < e; k++) {
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
        const a0 = anchorAngle(c, s, rho, 0);
        const a1 = anchorAngle(c, s, rho, 1);
        let a = ang;
        while (a < a0) a += TAU;
        while (a >= a0 + TAU) a -= TAU;
        if (a <= a1) return s;
      }
      return -1;
    },
    reset(seed) {
      c.rnd = mulberry32(seed);
      clearCore(c);
    },
  };
}
