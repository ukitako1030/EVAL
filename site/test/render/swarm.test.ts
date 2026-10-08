import { describe, it, expect } from 'vitest';
import {
  ALIVE,
  MAX_UNITS,
  MIN_SHARE,
  RHO_MAX,
  RHO_MIN,
  SECTOR_SAMPLES,
  allocateParticles,
  createSpatialHash,
  createSwarm,
  mulberry32,
  sampleInSector,
  sectorRho,
  unitWeight,
  type Swarm,
  type SwarmUnitIn,
} from '../../src/render/swarm';
import { START_ANGLE, TAU, territories } from '../../src/render/layout';
import type { UnitFrame } from '../../src/data/timeline';

function frame(id: string, c: number, s: number, extra: Partial<UnitFrame> = {}): UnitFrame {
  return { id, front: 'general', org: id, name: id, color: '#123456', s, c, q: 'high', fog: 0, fogBlend: 0, presence: 1, rank: 0, rankDelta: 0, ...extra };
}

const sum = (a: ArrayLike<number>) => Array.from(a).reduce((x, y) => x + y, 0);

describe('allocateParticles / unitWeight', () => {
  it('splits the budget ∝ c × presence and sums to exactly the budget', () => {
    const frames = [frame('gpt', 54.1, 93), frame('gemini', 20.1, 86), frame('claude', 12.6, 97), frame('mistral', 0.5, 55), frame('arriving', 10, 80, { presence: 0.5 })];
    const w = frames.map((u) => unitWeight(u.c, u.presence));
    const out = allocateParticles(w, 2500);
    expect(sum(out)).toBe(2500);
    const W = sum(w);
    frames.forEach((_, i) => expect(Math.abs(out[i] - (2500 * w[i]) / W)).toBeLessThan(1));
    // presence halves an arriving unit's share; a tiny unit is floored at MIN_SHARE so it stays visible
    expect(w[4]).toBeCloseTo(5);
    expect(w[3]).toBeCloseTo(MIN_SHARE);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it('gives nothing to absent, zero or broken units', () => {
    expect(unitWeight(10, 0)).toBe(0);
    expect(unitWeight(NaN, 1)).toBe(0);
    expect(unitWeight(10, NaN)).toBe(0);
    const out = allocateParticles([0, 3, -1, NaN, 1], 900);
    expect(Array.from(out)).toEqual([0, 675, 0, 0, 225]);
    expect(sum(allocateParticles([0, 0], 900))).toBe(0);
    expect(sum(allocateParticles([1, 2], 0))).toBe(0);
  });

  it('hands out the remainder by largest fraction (deterministic) and reuses the output buffer', () => {
    const buf = new Int32Array(3);
    const out = allocateParticles([1, 1, 1], 100, buf);
    expect(out).toBe(buf);
    expect(Array.from(out)).toEqual([34, 33, 33]);
    expect(sum(allocateParticles([1, 1, 1], 1250.7))).toBe(1250);
  });
});

describe('spatial hash', () => {
  it('finds exactly the brute-force neighbours, for any radius and grid size', () => {
    const R = mulberry32(42);
    const n = 1500;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const state = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = R() * 2 - 1;
      y[i] = R() * 2 - 1;
      state[i] = R() < 0.85 ? 1 : 0; // some slots are not live
    }
    for (const G of [1, 7, 37]) {
      const h = createSpatialHash(n, G);
      h.build(x, y, state, 1, n);
      expect(h.start[G * G]).toBe(sum(state));
      const out = new Int32Array(n);
      for (let q = 0; q < 40; q++) {
        const px = R() * 2.2 - 1.1;
        const py = R() * 2.2 - 1.1;
        const r = 0.02 + R() * 0.3;
        const got = Array.from(out.subarray(0, h.query(px, py, r, x, y, out))).sort((a, b) => a - b);
        const want: number[] = [];
        for (let i = 0; i < n; i++) if (state[i] === 1 && (x[i] - px) ** 2 + (y[i] - py) ** 2 <= r * r) want.push(i);
        expect(got).toEqual(want);
      }
    }
  });

  it('puts every live item in the cell of its position', () => {
    const x = Float32Array.from([-1, 1, 0, 0.99, -0.5]);
    const y = Float32Array.from([-1, 1, 0, -0.99, 0.5]);
    const h = createSpatialHash(5, 4);
    h.build(x, y, new Uint8Array([1, 1, 1, 1, 1]), 1, 5);
    for (let i = 0; i < 5; i++) {
      const c = h.cellOf[i];
      expect(c).toBe(h.cell(x[i], y[i]));
      const slice = Array.from(h.items.subarray(h.start[c], h.start[c + 1]));
      expect(slice).toContain(i);
    }
    expect(h.cell(-1, -1)).toBe(0);
    expect(h.cell(1, 1)).toBe(15); // the far edge clamps into the last cell
  });
});

describe('home sectors', () => {
  it('samples points inside the annular sector, spread evenly by area', () => {
    const R = mulberry32(7);
    const [a0, a1, r0, r1] = [0.4, 1.3, 0.25, 0.95];
    let inner = 0;
    const n = 4000;
    const mid = Math.sqrt((r0 * r0 + r1 * r1) / 2); // splits the annulus into equal areas
    for (let i = 0; i < n; i++) {
      const p = sampleInSector(r0, r1, R(), R());
      expect(p.rho).toBeGreaterThanOrEqual(r0);
      expect(p.rho).toBeLessThanOrEqual(r1);
      const a = a0 + p.u * (a1 - a0);
      expect(a).toBeGreaterThanOrEqual(a0);
      expect(a).toBeLessThanOrEqual(a1);
      if (p.rho < mid) inner++;
    }
    expect(inner / n).toBeGreaterThan(0.46);
    expect(inner / n).toBeLessThan(0.54);
  });

  it('sector table radii run from RHO_MIN to RHO_MAX', () => {
    expect(sectorRho(0)).toBeCloseTo(RHO_MIN);
    expect(sectorRho(SECTOR_SAMPLES)).toBeCloseTo(RHO_MAX);
  });
});

// ---------------------------------------------------------------------------------------------
// the simulation

/** fill a swarm's sector table from straight (undisturbed) territory wedges */
function feed(sw: Swarm, frames: UnitFrame[], budget: number, opts?: { warp?: boolean; instant?: boolean }) {
  const wedges = territories(frames);
  const ins: SwarmUnitIn[] = frames.map((u) => ({ id: u.id, s: u.s, c: u.c, presence: u.presence, fog: u.fogBlend, hasSector: wedges.some((w) => w.id === u.id) }));
  sw.sync(ins, budget, opts);
  for (const w of wedges) {
    const slot = sw.slotOf(w.id);
    if (slot < 0) continue;
    for (let j = 0; j <= SECTOR_SAMPLES; j++) {
      const b = slot * (SECTOR_SAMPLES + 1) * 2 + j * 2;
      sw.sectors[b] = wedges.length === 1 ? START_ANGLE : w.a0;
      sw.sectors[b + 1] = wedges.length === 1 ? START_ANGLE + TAU : w.a1;
    }
  }
  return wedges;
}

function run(seed: number, steps: number) {
  const sw = createSwarm({ capacity: 1200, seed });
  const frames = [frame('a', 50, 95), frame('b', 30, 70), frame('c', 20, 80)];
  feed(sw, frames, 1000, { instant: true });
  for (let k = 0; k < steps; k++) {
    feed(sw, frames, 1000);
    sw.step(1 / 60, k / 60);
  }
  return { sw, frames };
}

const counts = (sw: Swarm, slot: number) => {
  let n = 0;
  for (let i = 0; i < sw.capacity; i++) if (sw.owner[i] === slot && (sw.state[i] === ALIVE || sw.state[i] === 3)) n++;
  return n;
};

describe('swarm simulation', () => {
  it('is deterministic for a seed', () => {
    const a = run(11, 90).sw;
    const b = run(11, 90).sw;
    const c = run(12, 90).sw;
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
    expect(Array.from(a.x)).not.toEqual(Array.from(c.x));
  });

  it('allocates swarms ∝ scale and keeps them in their home sectors, inside the planet', () => {
    const { sw, frames } = run(3, 240);
    const wedges = territories(frames);
    const total = sum(frames.map((u) => counts(sw, sw.slotOf(u.id))));
    expect(total).toBe(1000);
    expect(counts(sw, sw.slotOf('a'))).toBe(500);
    expect(counts(sw, sw.slotOf('b'))).toBe(300);
    for (const w of wedges) {
      const slot = sw.slotOf(w.id);
      let inside = 0;
      let n = 0;
      for (let i = 0; i < sw.capacity; i++) {
        if (sw.state[i] !== ALIVE || sw.owner[i] !== slot) continue;
        const r = Math.hypot(sw.x[i], sw.y[i]);
        expect(r).toBeLessThanOrEqual(RHO_MAX + 1e-3);
        expect(r).toBeGreaterThanOrEqual(RHO_MIN - 1e-3);
        let a = Math.atan2(sw.y[i], sw.x[i]);
        while (a < w.a0 - 0.6) a += TAU;
        while (a > w.a0 - 0.6 + TAU) a -= TAU;
        n++;
        if (a >= w.a0 - 0.25 && a <= w.a1 + 0.25) inside++;
      }
      // raiders cross the lines, but most of each swarm holds its own territory
      expect(inside / n).toBeGreaterThan(0.8);
    }
  });

  it('fights at the frontlines, and the stronger side wins most clashes', () => {
    const sw = createSwarm({ capacity: 1200, seed: 5 });
    const frames = [frame('strong', 50, 96), frame('weak', 50, 60)];
    feed(sw, frames, 1000, { instant: true });
    let wins = 0;
    let all = 0;
    const strong = sw.slotOf('strong');
    for (let k = 0; k < 600; k++) {
      feed(sw, frames, 1000);
      sw.step(1 / 60, k / 60);
      for (let q = 0; q < sw.clashes.n; q++) {
        all++;
        if (sw.clashes.win[q] === strong) wins++;
      }
    }
    expect(all).toBeGreaterThan(20);
    expect(wins / all).toBeGreaterThan(0.85);
  });

  it('the stronger swarm pushes the frontline into the weaker territory', () => {
    const sw = createSwarm({ capacity: 1200, seed: 8 });
    const frames = [frame('strong', 50, 96), frame('weak', 50, 62)];
    const wedges = feed(sw, frames, 1000, { instant: true });
    const into = (id: string, other: string) => {
      const w = wedges.find((x) => x.id === other)!;
      const slot = sw.slotOf(id);
      let n = 0;
      let inside = 0;
      for (let i = 0; i < sw.capacity; i++) {
        if (sw.state[i] !== ALIVE || sw.owner[i] !== slot) continue;
        n++;
        let a = Math.atan2(sw.y[i], sw.x[i]);
        while (a < w.a0) a += TAU;
        if (a <= w.a1) inside++;
      }
      return inside / Math.max(1, n);
    };
    let strongIn = 0;
    let weakIn = 0;
    for (let k = 0; k < 900; k++) {
      feed(sw, frames, 1000);
      sw.step(1 / 60, k / 60);
      if (k >= 300 && k % 30 === 0) {
        strongIn += into('strong', 'weak');
        weakIn += into('weak', 'strong');
      }
    }
    expect(strongIn).toBeGreaterThan(weakIn * 1.5);
  });

  it('warps arriving units in and fades leaving units out', () => {
    const sw = createSwarm({ capacity: 800, seed: 9 });
    const base = [frame('a', 60, 90), frame('b', 40, 80)];
    feed(sw, base, 600, { instant: true });
    for (let k = 0; k < 30; k++) sw.step(1 / 60, k / 60);
    const withNew = [...base, frame('new', 30, 85, { presence: 0.4 })];
    feed(sw, withNew, 600, { warp: true });
    expect(sw.arrivals.n).toBe(1);
    expect(sw.arrivals.slot[0]).toBe(sw.slotOf('new'));
    sw.setWarp(sw.slotOf('new'), 0.5, 0, 1);
    sw.step(1 / 60, 0.5);
    // fresh particles of the newcomer start at the beam
    for (let i = 0; i < sw.capacity; i++) if (sw.state[i] === ALIVE && sw.owner[i] === sw.slotOf('new')) expect(Math.hypot(sw.x[i] - 0.5, sw.y[i])).toBeLessThan(0.06);
    // 'b' leaves: its particles fade instead of vanishing
    const left = [frame('a', 60, 90), frame('new', 30, 85)];
    for (let k = 0; k < 4; k++) {
      feed(sw, left, 600);
      sw.step(1 / 60, 1 + k / 60);
    }
    let fading = 0;
    for (let i = 0; i < sw.capacity; i++) if (sw.state[i] === 2 && sw.owner[i] === sw.slotOf('b')) fading++;
    expect(fading).toBeGreaterThan(0);
    for (let k = 0; k < 240; k++) {
      feed(sw, left, 600);
      sw.step(1 / 60, 2 + k / 60);
    }
    expect(counts(sw, sw.slotOf('b'))).toBe(0);
    expect(counts(sw, sw.slotOf('a')) + counts(sw, sw.slotOf('new'))).toBe(600);
  });

  it('picks the swarm under a point and the sector containing it', () => {
    const { sw } = run(21, 120);
    const a = sw.slotOf('a');
    // the first wedge ('a', the largest) starts at 12 o'clock and runs clockwise: (0.6, 0) is inside it
    expect(sw.sectorAt(0.6, 0)).toBe(a);
    expect(sw.sectorAt(2, 0)).toBe(-1);
    let i = 0;
    while (sw.state[i] !== ALIVE) i++;
    expect(sw.pick(sw.x[i], sw.y[i], 0.05)).toBeGreaterThanOrEqual(0);
    expect(sw.pick(5, 5, 0.01)).toBe(-1);
  });

  it('stays finite with real-world strengths (float32 rounding of the weakest unit)', () => {
    const sw = createSwarm({ capacity: 800, seed: 4 });
    const frames = [frame('suno', 87, 80.3), frame('udio', 5.6, 80.3), frame('eleven', 2.1, 44.1), frame('lyria', 2.5, 96.37), frame('stable', 0.3, 82.6)];
    feed(sw, frames, 800, { instant: true });
    for (let k = 0; k < 60; k++) {
      feed(sw, frames, 800);
      sw.step(1 / 60, k / 60);
    }
    for (let i = 0; i < sw.capacity; i++) if (sw.state[i] !== 0) expect(Number.isFinite(sw.x[i] + sw.y[i] + sw.vx[i] + sw.vy[i])).toBe(true);
    for (const u of frames) expect(Number.isFinite(sw.units.cx[sw.slotOf(u.id)])).toBe(true);
  });

  it('never tracks more than MAX_UNITS units', () => {
    const sw = createSwarm({ capacity: 500, seed: 1 });
    const many = Array.from({ length: MAX_UNITS + 5 }, (_, k) => frame('u' + k, 1 + k, 60));
    feed(sw, many, 500, { instant: true });
    sw.step(1 / 60, 0);
    expect(sw.slotOf('u' + (MAX_UNITS + 4))).toBe(-1);
  });
});
