import { describe, it, expect } from 'vitest';
import {
  CORE,
  START_ANGLE,
  TAU,
  borderAngle,
  frontlines,
  followGlow,
  galaxyLayout,
  isPortrait,
  territories,
  wedgeBrightness,
  type Frontline,
  type PlanetSlot,
  type Wedge,
} from '../../src/render/layout';
import { frontlinesInto, territoriesInto } from '../../src/render/territoryBuf';
import { GALAXY_EXTENT } from '../../src/render/camera';
import { createFlashBudget } from '../../src/fx/flashBudget';
import { FRONT_IDS } from '../../src/data/types';
import type { UnitFrame } from '../../src/data/timeline';

const FRONTS = FRONT_IDS.map((id) => ({ id }));

function unit(id: string, c: number, s: number, extra: Partial<UnitFrame> = {}): UnitFrame {
  return { id, front: 'general', org: id + '-org', name: id.toUpperCase(), color: '#123456', s, c, q: 'high', fog: 0, fogBlend: 0, presence: 1, rank: 0, rankDelta: 0, ...extra };
}

const overlaps = (a: PlanetSlot, b: PlanetSlot, margin: number) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + margin;

describe('galaxyLayout (landscape)', () => {
  const L = galaxyLayout(GALAXY_EXTENT, FRONTS);

  it('puts the general front at the centre as the largest planet and the others around it in world.fronts order', () => {
    expect(L.portrait).toBe(false);
    expect(L.hub).toBe('general');
    expect(L.planets.map((p) => p.id)).toEqual([...FRONT_IDS]);
    const hub = L.planets[0];
    expect(hub).toMatchObject({ id: 'general', x: 0, y: 0, hub: true });
    for (const p of L.planets.slice(1)) {
      expect(p.hub).toBe(false);
      expect(p.r).toBeLessThan(hub.r * 0.6);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(hub.r + p.r);
    }
  });

  it('runs the satellites clockwise around the centre, starting top-left', () => {
    const ang = L.planets.slice(1).map((p) => Math.atan2(p.y, p.x));
    // unwrap from the first (top-left, ≈ −150°) so the sequence is monotonically increasing
    const un = ang.map((a) => (a < ang[0] ? a + TAU : a));
    for (let i = 1; i < un.length; i++) expect(un[i]).toBeGreaterThan(un[i - 1]);
    expect(L.planets[1].x).toBeLessThan(0);
    expect(L.planets[1].y).toBeLessThan(0);
  });

  it('keeps every planet inside the extent and apart from the others', () => {
    for (const p of L.planets) {
      expect(Math.abs(p.x) + p.r).toBeLessThanOrEqual(GALAXY_EXTENT.w / 2);
      expect(Math.abs(p.y) + p.r).toBeLessThanOrEqual(GALAXY_EXTENT.h / 2);
    }
    for (let i = 0; i < L.planets.length; i++)
      for (let j = i + 1; j < L.planets.length; j++) expect(overlaps(L.planets[i], L.planets[j], 40)).toBe(false);
  });

  it('labels planets above the upper half and below the lower half', () => {
    for (const p of L.planets.slice(1)) expect(p.labelSide).toBe(p.y > 20 ? 'below' : 'above');
    expect(L.planets[0].labelSide).toBe('above');
  });

  it('scales positions and radii with the area it is given', () => {
    const L2 = galaxyLayout({ w: GALAXY_EXTENT.w * 2, h: GALAXY_EXTENT.h * 2 }, FRONTS);
    expect(L2.extent).toEqual({ w: GALAXY_EXTENT.w * 2, h: GALAXY_EXTENT.h * 2 });
    L2.planets.forEach((p, i) => {
      expect(p.r).toBeCloseTo(L.planets[i].r * 2, 9);
      expect(p.x).toBeCloseTo(L.planets[i].x * 2, 9);
      expect(p.y).toBeCloseTo(L.planets[i].y * 2, 9);
    });
    // a wider-than-960:590 area keeps the aspect: the limiting side wins
    const wide = galaxyLayout({ w: 3000, h: 590 }, FRONTS);
    expect(wide.planets[0].r).toBeCloseTo(L.planets[0].r, 9);
  });

  it('ignores the focus in landscape (general stays the hub)', () => {
    expect(galaxyLayout(GALAXY_EXTENT, FRONTS, { focus: 'music' }).hub).toBe('general');
  });
});

describe('galaxyLayout (portrait)', () => {
  const phone = { w: 390, h: 760 };

  it('detects portrait viewports narrower than 768 px', () => {
    expect(isPortrait(phone)).toBe(true);
    expect(isPortrait({ w: 1080, h: 900 })).toBe(false);
    expect(isPortrait({ w: 700, h: 500 })).toBe(false);
    expect(isPortrait({ w: 900, h: 1200 })).toBe(false);
  });

  it('makes only the focused planet large, at the centre, with the rest in two rows', () => {
    const L = galaxyLayout(phone, FRONTS, { focus: 'video' });
    expect(L.portrait).toBe(true);
    expect(L.hub).toBe('video');
    expect(L.extent.h).toBeGreaterThan(L.extent.w);
    const hub = L.planets.find((p) => p.hub)!;
    expect(hub).toMatchObject({ id: 'video', x: 0, y: 0 });
    const others = L.planets.filter((p) => !p.hub);
    expect(others).toHaveLength(6);
    for (const p of others) expect(p.r).toBeLessThan(hub.r * 0.45);
    expect(others.filter((p) => p.y < 0)).toHaveLength(3);
    expect(others.filter((p) => p.y > 0)).toHaveLength(3);
    for (const p of L.planets) {
      expect(Math.abs(p.x) + p.r).toBeLessThanOrEqual(L.extent.w / 2);
      expect(Math.abs(p.y) + p.r).toBeLessThanOrEqual(L.extent.h / 2);
    }
    for (let i = 0; i < L.planets.length; i++)
      for (let j = i + 1; j < L.planets.length; j++) expect(overlaps(L.planets[i], L.planets[j], 20)).toBe(false);
    // planets keep world.fronts order in the returned list
    expect(L.planets.map((p) => p.id)).toEqual([...FRONT_IDS]);
  });

  it('defaults the portrait hub to the general front', () => {
    expect(galaxyLayout(phone, FRONTS).hub).toBe('general');
  });
});

describe('territories', () => {
  it('returns nothing for an empty front', () => {
    expect(territories([])).toEqual([]);
  });

  it('gives a lone unit the whole planet, starting at −90°', () => {
    const [w] = territories([unit('a', 40, 80)]);
    expect(w.a0).toBeCloseTo(START_ANGLE, 12);
    expect(w.a1).toBeCloseTo(START_ANGLE + TAU, 12);
    expect(w.share).toBe(1);
  });

  it('orders wedges by scale, contiguous from −90°, with angles ∝ c × presence', () => {
    const ws = territories([unit('small', 10, 90), unit('big', 50, 70), unit('arriving', 80, 99, { presence: 0.25 }), unit('mid', 20, 60)]);
    // weights: big 50, arriving 80 × 0.25 = 20, mid 20, small 10 → total 100
    expect(ws.map((w) => w.id)).toEqual(['big', 'arriving', 'mid', 'small']);
    expect(ws[0].a0).toBeCloseTo(START_ANGLE, 12);
    for (let i = 1; i < ws.length; i++) expect(ws[i].a0).toBeCloseTo(ws[i - 1].a1, 12);
    expect(ws.at(-1)!.a1).toBeCloseTo(START_ANGLE + TAU, 12);
    expect(ws.map((w) => +(w.a1 - w.a0).toFixed(9))).toEqual([0.5, 0.2, 0.2, 0.1].map((f) => +(f * TAU).toFixed(9)));
    expect(ws.map((w) => w.share)).toEqual([0.5, 0.2, 0.2, 0.1]);
  });

  it('carries strength, colour, fog and identity for drawing', () => {
    const [w] = territories([unit('gpt', 60, 92, { color: '#19c37d', org: 'openai', name: 'GPT', fog: 0.5, fogBlend: 0.4, rank: 2 })]);
    expect(w).toMatchObject({ id: 'gpt', org: 'openai', name: 'GPT', color: '#19c37d', s: 92, c: 60, fog: 0.5, fogBlend: 0.4, presence: 1, rank: 2 });
  });

  it('splits the planet evenly when no unit has any scale yet', () => {
    const ws = territories([unit('a', 0, 50), unit('b', 0, 60)]);
    expect(ws.map((w) => w.share)).toEqual([0.5, 0.5]);
  });

  it('drops units without territory (left, zero or broken scale) while others hold ground', () => {
    const ws = territories([unit('gone', 30, 50, { presence: 0 }), unit('nan', Number.NaN, 50), unit('zero', 0, 50), unit('ok', 10, 50)]);
    expect(ws.map((w) => w.id)).toEqual(['ok']);
    expect(ws[0].share).toBe(1);
  });
});

describe('frontlines', () => {
  const ws = territories([unit('strong', 50, 95), unit('weak', 30, 60), unit('even', 20, 94)]);
  const bs = frontlines(ws);

  it('puts one frontline at the start of every wedge, between it and the previous one', () => {
    expect(bs.map((b) => [b.prev.id, b.cur.id])).toEqual([
      ['even', 'strong'],
      ['strong', 'weak'],
      ['weak', 'even'],
    ]);
    bs.forEach((b, k) => expect(b.base).toBeCloseTo(ws[k].a0, 12));
    expect(frontlines(territories([unit('solo', 1, 1)]))).toEqual([]);
  });

  it('is fiercer when the neighbours are evenly matched', () => {
    expect(bs[0].fierce).toBeGreaterThan(bs[1].fierce); // 94 vs 95 is closer than 95 vs 60
    expect(bs[1].push).toBe(1); // strong pushes into weak at full pressure
    expect(bs[2].push).toBe(-1); // even (94) pushes back into weak (60)
  });

  it('bulges toward the weaker side and stays inside both wedges', () => {
    const b = bs[1]; // strong → weak: the line moves into the weak wedge (larger angles)
    for (const t of [0, 1.3, 7.7]) {
      const mid = borderAngle(b, 0.6, t);
      expect(mid).toBeGreaterThan(b.base);
      for (const rho of [CORE, 0.3, 0.6, 0.9, 1]) {
        const a = borderAngle(b, rho, t);
        expect(a).toBeLessThanOrEqual(b.base + b.maxR + 1e-12);
        expect(a).toBeGreaterThanOrEqual(b.base - b.maxL - 1e-12);
      }
    }
    const back = bs[2]; // even (after) is stronger than weak (before) → pushes toward smaller angles
    expect(borderAngle(back, 0.6, 0)).toBeLessThan(back.base);
  });

  it('wobbles more when the neighbours are close, and barely at all with amplitude 0', () => {
    const close = { ...bs[0], push: 0 };
    const far = { ...bs[0], push: 0, fierce: 0.12 };
    const swing = (b: typeof close, amp = 1) => {
      let m = 0;
      for (let t = 0; t < 10; t += 0.37) for (const rho of [0.4, 0.6, 0.8]) m = Math.max(m, Math.abs(borderAngle(b, rho, t, amp) - b.base));
      return m;
    };
    expect(swing(close)).toBeGreaterThan(swing(far) * 1.5);
    expect(swing(close, 0)).toBe(0);
  });
});

describe('territoriesInto / frontlinesInto (no per-frame objects)', () => {
  const setA = [unit('strong', 50, 95), unit('weak', 30, 60), unit('even', 20, 94), unit('gone', 5, 50, { presence: 0 })];
  const setB = [unit('weak', 45, 61), unit('strong', 41, 96), unit('even', 25, 93), unit('new', 3, 70, { presence: 0.4 })];

  it('writes exactly what territories / frontlines return', () => {
    const ws: Wedge[] = [];
    const bs: Frontline[] = [];
    for (const set of [setA, setB, setA, [unit('solo', 1, 1)], [], setB]) {
      expect(territoriesInto(set, ws)).toBe(ws);
      expect(ws).toEqual(territories(set));
      expect(frontlinesInto(ws, bs)).toBe(bs);
      expect(bs).toEqual(frontlines(territories(set)));
    }
  });

  it('reuses its objects from frame to frame', () => {
    const ws: Wedge[] = [];
    const bs: Frontline[] = [];
    territoriesInto(setA, ws);
    frontlinesInto(ws, bs);
    const w0 = ws[0];
    const b1 = bs[1];
    territoriesInto(setB, ws);
    frontlinesInto(ws, bs);
    expect(ws[0]).toBe(w0);
    expect(bs[1]).toBe(b1);
    expect(b1.prev).toBe(ws[0]);
    expect(b1.cur).toBe(ws[1]);
  });

  it('ignores non-finite values like territories does', () => {
    const ws: Wedge[] = [];
    const set = [unit('nan', Number.NaN, 50), unit('zero', 0, 50), unit('ok', 10, Number.NaN)];
    territoriesInto(set, ws);
    expect(ws).toEqual(territories(set));
    for (const w of ws) for (const v of [w.a0, w.a1, w.s, w.c, w.share]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('wedgeBrightness', () => {
  it('grows with strength and stays in (0, 1]', () => {
    expect(wedgeBrightness(40)).toBeGreaterThan(0);
    expect(wedgeBrightness(70)).toBeGreaterThan(wedgeBrightness(60));
    expect(wedgeBrightness(100)).toBe(1);
    expect(wedgeBrightness(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('followGlow', () => {
  it('falls quickly and rises slowly without a flash grant', () => {
    expect(followGlow(1, 0.2, 0.1, null, 0)).toBeLessThan(0.75);
    const up = followGlow(0.2, 1, 0.1, null, 0);
    expect(up).toBeGreaterThan(0.2);
    expect(up).toBeLessThanOrEqual(0.2 + 0.1 * 0.8 + 1e-12);
  });

  it('routes a sudden rise through the flash budget and never exceeds the target', () => {
    const budget = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    const a = followGlow(0.1, 0.9, 1 / 60, budget, 0);
    expect(a).toBeGreaterThan(0.4); // granted jump of up to 0.35
    expect(a).toBeLessThanOrEqual(0.9);
    // the budget is spent after 3 grants inside a second: the 4th sudden rise only creeps up
    followGlow(0.1, 0.9, 1 / 60, budget, 0.1);
    followGlow(0.1, 0.9, 1 / 60, budget, 0.2);
    expect(followGlow(0.1, 0.9, 1 / 60, budget, 0.3)).toBeLessThan(0.15);
    expect(followGlow(0.5, 0.52, 1, budget, 5)).toBe(0.52);
  });
});
