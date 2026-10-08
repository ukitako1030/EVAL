import { describe, it, expect } from 'vitest';
import {
  FLEET_CAP_DESKTOP,
  FLEET_CAP_MOBILE,
  Leg,
  ORBIT_SQUASH,
  advance,
  allocateFleets,
  arcPoint,
  fleetBudget,
  fleetCap,
  fleetPeak,
  fleetWeight,
  legU,
  nextLeg,
  orbitPoint,
  pickWeighted,
  rand01,
  shipSeed,
  shortArc,
} from '../../src/render/fleetMath';
import { orgDeployment } from '../../src/data/timeline';
import { makeWorld } from '../fixtures/world';

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe('fleet allocation', () => {
  it('weighs an org by fronts × summed share', () => {
    expect(fleetWeight({ fronts: ['general', 'code', 'image'], totalShare: 40 })).toBe(120);
    expect(fleetWeight({ fronts: ['music'], totalShare: 87 })).toBe(87);
    expect(fleetWeight({ fronts: [], totalShare: 0 })).toBe(0);
    expect(fleetWeight({ fronts: ['code'], totalShare: Number.NaN })).toBe(0);
  });

  it('caps 140 ships on desktop and 60 on phones, scaled by the quality level', () => {
    expect(fleetCap(false, 1)).toBe(FLEET_CAP_DESKTOP);
    expect(FLEET_CAP_DESKTOP).toBe(140);
    expect(fleetCap(true, 1)).toBe(FLEET_CAP_MOBILE);
    expect(FLEET_CAP_MOBILE).toBe(60);
    expect(fleetCap(false, 0.5)).toBe(70);
    expect(fleetCap(true, 0.5)).toBe(30);
    expect(fleetCap(false, Number.NaN)).toBe(140);
  });

  it('gives the full cap at the peak and proportionally fewer ships while the war is smaller', () => {
    expect(fleetBudget(3000, 3000, 140)).toBe(140);
    expect(fleetBudget(1500, 3000, 140)).toBe(70);
    expect(fleetBudget(4000, 3000, 140)).toBe(140);
    expect(fleetBudget(0, 3000, 140)).toBe(0);
    expect(fleetBudget(100, 0, 60)).toBe(60);
    expect(fleetBudget(100, 3000, 0)).toBe(0);
  });

  it('splits the budget ∝ weight, sums exactly to it and gives every deployed org at least one ship', () => {
    // last-month-like shape: two empires, a few mid orgs and a long tail
    const w = [1344, 1128, 164, 114, 87, 54, 48, 38, 30, 20, 9, 9, 8, 6, 4, 3, 2, 2, 1, 1, 1, 1, 1, 0.4];
    const a = allocateFleets(w, 140);
    expect(sum(a)).toBe(140);
    for (const n of a) expect(n).toBeGreaterThanOrEqual(1);
    // ordered like the weights
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThanOrEqual(a[i - 1]);
    // the share above the 1-ship floor follows the weights within one ship
    const rest = 140 - w.length;
    const W = sum(w);
    w.forEach((wi, i) => expect(Math.abs(a[i] - 1 - (rest * wi) / W)).toBeLessThan(1));
    expect(a[0]).toBeGreaterThan(a[1]);
    expect(a[1]).toBeGreaterThan(5 * a[2]);
  });

  it('gives nothing to orgs without weight and handles tight budgets heaviest-first', () => {
    expect(allocateFleets([10, 0, 5, Number.NaN, -3], 9)).toEqual([6, 0, 3, 0, 0]);
    expect(allocateFleets([1, 5, 3], 2)).toEqual([0, 1, 1]);
    expect(allocateFleets([2, 2, 2], 1)).toEqual([1, 0, 0]);
    expect(allocateFleets([4, 4], 0)).toEqual([0, 0]);
    expect(allocateFleets([], 10)).toEqual([]);
    expect(allocateFleets([0, 0], 10)).toEqual([0, 0]);
  });

  it('is deterministic, breaks ties by index and reuses the output array', () => {
    const out: number[] = [9, 9, 9, 9, 9];
    const a = allocateFleets([1, 1, 1], 5, out);
    expect(a).toBe(out);
    expect(a).toEqual([2, 2, 1]);
    expect(allocateFleets([1, 1, 1], 5)).toEqual([2, 2, 1]);
  });

  it('measures the peak over whole months of a world', () => {
    const world = makeWorld();
    const peak = fleetPeak(world);
    let best = 0;
    for (let m = 0; m < world.months.length; m++) best = Math.max(best, sum(orgDeployment(world, m).map(fleetWeight)));
    expect(peak).toBe(best);
    expect(peak).toBeGreaterThan(0);
  });
});

describe('ship randomness', () => {
  it('seeds every ship of an org differently but stably', () => {
    expect(shipSeed('google', 3)).toBe(shipSeed('google', 3));
    const seeds = new Set<number>();
    for (const org of ['google', 'openai', 'suno']) for (let k = 0; k < 60; k++) seeds.add(shipSeed(org, k));
    expect(seeds.size).toBe(180);
    for (const s of seeds) expect(s).toBeGreaterThan(0);
  });

  it('draws a reproducible stream in [0, 1)', () => {
    const a = { rng: shipSeed('openai', 0) };
    const b = { rng: shipSeed('openai', 0) };
    const xs = Array.from({ length: 200 }, () => rand01(a));
    expect(Array.from({ length: 200 }, () => rand01(b))).toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const mean = sum(xs) / xs.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it('picks ∝ weight + bias and never the excluded index', () => {
    const w = [1, 0, 3];
    expect(pickWeighted(w, 3, -1, 0)).toBe(0);
    expect(pickWeighted(w, 3, -1, 0.24)).toBe(0);
    expect(pickWeighted(w, 3, -1, 0.26)).toBe(2);
    expect(pickWeighted(w, 3, -1, 0.999)).toBe(2);
    for (let r = 0; r < 1; r += 0.05) expect(pickWeighted(w, 3, 2, r)).toBe(0);
    // with a bias, empty fronts can be picked too
    expect(pickWeighted([0, 0], 2, 0, 0.5)).toBe(1);
    expect(pickWeighted([0, 10], 2, -1, 0.01, 1)).toBe(0);
    expect(pickWeighted([5], 1, 0, 0.5)).toBe(-1);
    expect(pickWeighted([], 0, -1, 0.5)).toBe(-1);
  });
});

describe('ship paths', () => {
  const HUB = 0;

  it('routes every trip through the hub along the data streams', () => {
    // satellite 3 → satellite 5
    const legs: Leg[] = [Leg.Loiter];
    for (let i = 0; i < 5; i++) legs.push(nextLeg(legs[legs.length - 1], 3, 5, HUB));
    expect(legs).toEqual([Leg.Loiter, Leg.ToExit, Leg.Out, Leg.HubArc, Leg.In, Leg.Loiter]);
    // satellite → hub: stop at the hub after the outbound stream
    expect(nextLeg(Leg.Loiter, 2, HUB, HUB)).toBe(Leg.ToExit);
    expect(nextLeg(Leg.Out, 2, HUB, HUB)).toBe(Leg.Loiter);
    // hub → satellite: round the hub, then the inbound stream
    expect(nextLeg(Leg.Loiter, HUB, 4, HUB)).toBe(Leg.HubArc);
    expect(nextLeg(Leg.HubArc, HUB, 4, HUB)).toBe(Leg.In);
    expect(nextLeg(Leg.Orbit, 1, 1, HUB)).toBe(Leg.Orbit);
  });

  it('maps leg progress onto the stream: outbound 0 → 1 (planet → hub), inbound 1 → 0', () => {
    expect(legU(Leg.Out, 0)).toBe(0);
    expect(legU(Leg.Out, 1)).toBe(1);
    expect(legU(Leg.Out, 0.25)).toBe(0.25);
    expect(legU(Leg.In, 0)).toBe(1);
    expect(legU(Leg.In, 1)).toBe(0);
    expect(legU(Leg.In, 0.25)).toBe(0.75);
    expect(legU(Leg.Out, 1.7)).toBe(1);
    expect(legU(Leg.In, -1)).toBe(1);
  });

  it('takes the short way round between two angles', () => {
    expect(shortArc(0, 1)).toBeCloseTo(1);
    expect(shortArc(0, -1)).toBeCloseTo(-1);
    expect(shortArc(3, -3)).toBeCloseTo(-3 + Math.PI * 2);
    expect(shortArc(-3, 3)).toBeCloseTo(3 - Math.PI * 2);
    expect(shortArc(10, 0)).toBeCloseTo(4 * Math.PI);
    for (let a = -7; a < 7; a += 0.37) for (let b = -7; b < 7; b += 0.41) expect(Math.abs(shortArc(a, b) - a)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it('puts arc points on the circle', () => {
    const out = { x: 0, y: 0 };
    expect(arcPoint(10, 20, 5, 0, out)).toBe(out);
    expect(out.x).toBeCloseTo(15);
    expect(out.y).toBeCloseTo(20);
    arcPoint(10, 20, 5, Math.PI / 2, out);
    expect(out.x).toBeCloseTo(10);
    expect(out.y).toBeCloseTo(25);
  });

  it('flies orbits on the tilted, squashed ring plane, behind the planet for half a turn', () => {
    const out = { x: 0, y: 0 };
    let minR = Infinity;
    let maxR = 0;
    let behind = 0;
    const N = 360;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      if (orbitPoint(100, 50, 40, a, out)) behind++;
      const r = Math.hypot(out.x - 100, out.y - 50);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    expect(maxR).toBeCloseTo(40, 3);
    expect(minR).toBeCloseTo(40 * ORBIT_SQUASH, 3);
    expect(behind).toBe(N / 2 - 1);
    // the far half (upper, y < centre once untilted) is the one behind
    expect(orbitPoint(0, 0, 10, -Math.PI / 2, out)).toBe(true);
    expect(orbitPoint(0, 0, 10, Math.PI / 2, out)).toBe(false);
  });

  it('advances progress by distance over length', () => {
    expect(advance(0, 100, 0.5, 200)).toBeCloseTo(0.25);
    expect(advance(0.9, 100, 0.5, 200)).toBeCloseTo(1.15);
    expect(advance(0.2, 100, -1, 200)).toBe(0.2);
    expect(advance(0, 100, 0.016, 0)).toBe(1);
  });
});
