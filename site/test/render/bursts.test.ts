// @vitest-environment jsdom
// Frontline booms (./sparks) and battle bursts (./swarmView) go through the flash budget: a granted request keeps the
// bright look, a denied one still happens but dim — no near-white, at most 40 % of the alpha, a smaller ring / spread.
import { describe, it, expect } from 'vitest';
import { Texture, type Mesh, type ParticleContainer } from 'pixi.js';
import { AMBIENT_RESERVE } from '../../src/fx/flashBudget';
import { BOOM_BRIGHT, BOOM_DIM, createSparks } from '../../src/render/sparks';
import { BURST_DIM_ALPHA, createSwarmView } from '../../src/render/swarmView';
import { MAX_UNITS, createSwarm } from '../../src/render/swarm';
import type { Planet } from '../../src/render/planet';

const alphaByte = (c: number) => c >>> 24;

function fakePlanet(): Planet {
  return {
    id: 'general',
    slot: { r: 140 },
    x: 0,
    y: 0,
    lines: [{ k: 0, key: 'a|b', prev: { color: '#ff3030' }, cur: { color: '#3050ff' }, fierce: 1, push: 0 }],
    borderAt: () => 0,
  } as unknown as Planet;
}

/** runs the frontline sparks for `seconds`, returns the budget calls and the brightest ring vertex alpha seen */
function runSparks(grant: number, seconds: number) {
  const calls: [number, number, number][] = [];
  const budget = {
    request(i: number, now: number, reserve = 0) {
      calls.push([i, now, reserve]);
      return grant;
    },
  };
  const sp = createSparks(Texture.WHITE, budget);
  const rings = sp.container.children[0] as Mesh;
  const p = fakePlanet();
  let now = 0;
  let maxAlpha = 0;
  for (let i = 0; i < seconds * 60; i++) {
    now += 1 / 60;
    sp.emit(p, 1 / 60, 1, false, now);
    sp.update(1 / 60, 1);
    const col = rings.geometry.getBuffer('aColor').data as Uint32Array;
    for (let v = 0; v < col.length; v++) maxAlpha = Math.max(maxAlpha, alphaByte(col[v]));
  }
  sp.destroy();
  return { calls, maxAlpha };
}

describe('frontline booms and the flash budget', () => {
  it('every boom asks the budget as an ambient flash (leaving room for news)', () => {
    const { calls } = runSparks(0.35, 6);
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(c[2]).toBe(AMBIENT_RESERVE);
  });
  it('denied booms still happen, with rings at most 40 % as bright', () => {
    const denied = runSparks(0, 6);
    const granted = runSparks(0.35, 6);
    expect(denied.calls.length).toBeGreaterThan(2); // the battle stays lively: booms keep coming
    expect(denied.maxAlpha).toBeGreaterThan(0);
    expect(denied.maxAlpha).toBeLessThanOrEqual(Math.ceil(0.4 * 0.75 * 255));
    expect(granted.maxAlpha).toBeGreaterThan(Math.ceil(0.4 * 0.75 * 255));
  });
  it('the dim look has no near-white sparks, ≤ 40 % alpha and a smaller ring', () => {
    expect(BOOM_DIM.pale).toBe(0);
    expect(BOOM_DIM.alpha).toBeLessThanOrEqual(0.4);
    expect(BOOM_DIM.ring).toBeLessThan(BOOM_BRIGHT.ring);
    expect(BOOM_BRIGHT.alpha).toBe(1);
  });
});

describe('battle bursts (shockwave / warp-in sparks)', () => {
  function burstColors(bright: boolean) {
    const view = createSwarmView(64, { streak: Texture.WHITE, glow: Texture.WHITE });
    const sim = createSwarm({ capacity: 64, seed: 1 });
    const look = { color: new Uint32Array(MAX_UNITS), vis: 1, reduced: false };
    view.burst(0, 0, 0xff3030, 40, 300, 0.8, bright);
    view.draw(sim, 100, 1, look, 1 / 60);
    const pc = view.container.children[3] as ParticleContainer;
    const out = pc.particleChildren.map((p) => p.color);
    view.destroy();
    return out;
  }
  // particle colours are 0xAABBGGRR; the burst colour 0xff3030 is BGR 0x3030ff
  const tint = (c: number) => c & 0xffffff;
  it('a granted burst keeps its pale heads', () => {
    const cols = burstColors(true);
    expect(cols.length).toBe(40);
    expect(cols.some((c) => tint(c) !== 0x3030ff)).toBe(true);
  });
  it('a denied burst uses only the unit colour, at ≤ 40 % of the alpha', () => {
    const cols = burstColors(false);
    expect(cols.length).toBe(40);
    for (const c of cols) {
      expect(tint(c)).toBe(0x3030ff);
      expect(alphaByte(c)).toBeLessThanOrEqual(Math.ceil(BURST_DIM_ALPHA * 0.8 * 255));
    }
    expect(BURST_DIM_ALPHA).toBeLessThanOrEqual(0.4);
  });
});
