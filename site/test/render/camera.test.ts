import { describe, it, expect } from 'vitest';
import { cameraFor, ease, easeInOutCubic, worldTransform, GALAXY_EXTENT, PLANET_FILL, PLANET_SIDE_FILL, type Camera, type Viewport } from '../../src/render/camera';

const desktop: Viewport = { x: 0, y: 0, w: 1440, h: 900 };
const phone: Viewport = { x: 0, y: 0, w: 390, h: 844 };
const close = (a: Camera, b: Camera) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.scale).toBeCloseTo(b.scale, 9);
};

describe('easeInOutCubic', () => {
  it('starts at 0, ends at 1 and passes through 0.5 at the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
  });
  it('is slow at both ends and symmetric', () => {
    expect(easeInOutCubic(0.1)).toBeCloseTo(0.004, 12);
    expect(easeInOutCubic(0.9)).toBeCloseTo(0.996, 12);
    for (const p of [0.13, 0.3, 0.42]) expect(easeInOutCubic(p) + easeInOutCubic(1 - p)).toBeCloseTo(1, 12);
  });
  it('clamps outside [0, 1]', () => {
    expect(easeInOutCubic(-2)).toBe(0);
    expect(easeInOutCubic(3)).toBe(1);
    expect(easeInOutCubic(Number.NaN)).toBe(0);
  });
});

describe('cameraFor', () => {
  it('fits the whole galaxy extent into the viewport, centred on the origin', () => {
    const c = cameraFor({ kind: 'galaxy' }, desktop);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.scale).toBeCloseTo(Math.min(1440 / GALAXY_EXTENT.w, 900 / GALAXY_EXTENT.h), 12);
    // the limiting axis is filled exactly, the other one has room to spare
    expect(GALAXY_EXTENT.w * c.scale).toBeLessThanOrEqual(1440 + 1e-9);
    expect(GALAXY_EXTENT.h * c.scale).toBeLessThanOrEqual(900 + 1e-9);
  });
  it('lets the caller override the galaxy extent (portrait layouts)', () => {
    const c = cameraFor({ kind: 'galaxy', extent: { w: 400, h: 800 } }, phone);
    expect(c.scale).toBeCloseTo(Math.min(390 / 400, 844 / 800), 12);
  });
  it('zooms a planet so its radius fills a fixed share of the shorter viewport side', () => {
    const c = cameraFor({ kind: 'planet', x: 356, y: -168, r: 66 }, desktop);
    expect(c.scale).toBeCloseTo((PLANET_FILL * 900) / 66, 12);
    expect(c.x).toBe(356);
    // centred slightly below the planet centre so the title above it stays clear
    expect(c.y).toBeGreaterThan(-168);
    expect(c.y).toBeLessThan(-168 + 66 * 0.1);
    const p = cameraFor({ kind: 'planet', x: 0, y: 0, r: 138 }, phone);
    expect(p.scale).toBeCloseTo((PLANET_FILL * 390) / 138, 12);
  });
  it('keeps room beside the planet for label columns in a narrow landscape frame (a side panel open)', () => {
    const narrow: Viewport = { x: 444, y: 104, w: 658, h: 646 };
    const c = cameraFor({ kind: 'planet', x: 0, y: 0, r: 100 }, narrow);
    expect(c.scale).toBeCloseTo((PLANET_SIDE_FILL * 658) / 100, 12);
    expect(c.scale * 100).toBeLessThan(PLANET_FILL * 646);
    // a wide frame is still limited by its height, a portrait one by its width
    expect(cameraFor({ kind: 'planet', x: 0, y: 0, r: 100 }, { x: 0, y: 0, w: 1102, h: 646 }).scale).toBeCloseTo((PLANET_FILL * 646) / 100, 12);
    expect(cameraFor({ kind: 'planet', x: 0, y: 0, r: 100 }, { x: 0, y: 0, w: 390, h: 400 }).scale).toBeCloseTo((PLANET_FILL * 390) / 100, 12);
  });
  it('a planet is always closer than the galaxy overview', () => {
    for (const vp of [desktop, phone]) {
      const g = cameraFor({ kind: 'galaxy' }, vp);
      for (const r of [56, 66, 138]) expect(cameraFor({ kind: 'planet', x: 0, y: 0, r }, vp).scale).toBeGreaterThan(g.scale);
    }
  });
  it('never returns a zero or negative scale for degenerate viewports', () => {
    expect(cameraFor({ kind: 'galaxy' }, { x: 0, y: 0, w: 0, h: 0 }).scale).toBeGreaterThan(0);
    expect(cameraFor({ kind: 'planet', x: 0, y: 0, r: 0 }, desktop).scale).toBeGreaterThan(0);
  });
});

describe('ease', () => {
  const from: Camera = { x: 0, y: 0, scale: 1.5 };
  const to: Camera = { x: 356, y: -164, scale: 4.9 };

  it('returns the endpoints at p = 0 and p = 1 and clamps beyond', () => {
    close(ease(from, to, 0), from);
    close(ease(from, to, 1), to);
    close(ease(from, to, -1), from);
    close(ease(from, to, 2), to);
  });
  it('interpolates the zoom geometrically (equal ratios per step, not equal differences)', () => {
    const mid = ease(from, to, 0.5);
    expect(mid.scale).toBeCloseTo(Math.sqrt(from.scale * to.scale), 9);
  });
  it('zooms monotonically', () => {
    let prev = from.scale;
    for (let i = 1; i <= 20; i++) {
      const s = ease(from, to, i / 20).scale;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
  it('moves the target point across the screen in a straight line', () => {
    const vp = desktop;
    // screen position of the destination's centre, as seen through the camera at progress p
    const screenOfTarget = (p: number) => {
      const t = worldTransform(ease(from, to, p), vp);
      return { x: t.x + to.x * t.scale, y: t.y + to.y * t.scale };
    };
    const a = screenOfTarget(0);
    const b = screenOfTarget(1);
    for (const p of [0.2, 0.5, 0.8]) {
      const m = screenOfTarget(p);
      const e = easeInOutCubic(p);
      expect(m.x).toBeCloseTo(a.x + (b.x - a.x) * e, 6);
      expect(m.y).toBeCloseTo(a.y + (b.y - a.y) * e, 6);
    }
  });
  it('a pure pan (same scale) is a plain eased lerp', () => {
    const m = ease({ x: 0, y: 10, scale: 2 }, { x: 100, y: 30, scale: 2 }, 0.5);
    close(m, { x: 50, y: 20, scale: 2 });
  });
});

describe('worldTransform', () => {
  it('puts the camera point at the centre of the viewport rectangle', () => {
    const vp: Viewport = { x: 20, y: 90, w: 1000, h: 600 };
    const cam: Camera = { x: 40, y: -10, scale: 2 };
    const t = worldTransform(cam, vp);
    expect(t.scale).toBe(2);
    expect(t.x + cam.x * t.scale).toBe(vp.x + vp.w / 2);
    expect(t.y + cam.y * t.scale).toBe(vp.y + vp.h / 2);
  });
});
