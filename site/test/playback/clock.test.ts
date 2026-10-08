import { describe, it, expect } from 'vitest';
import { createPlayback, BASE_SECONDS_PER_MONTH, HOLD_SECONDS } from '../../src/playback/clock';

const run = (pb: ReturnType<typeof createPlayback>, st: { t: number; playing: boolean; speed: 1 | 2 | 4 }, seconds: number, dt = 0.05) => {
  let s = { ...st };
  const crossed: number[] = [];
  for (let x = 0; x < seconds - 1e-9; x += dt) {
    const r = pb.tick(dt, s);
    crossed.push(...r.crossed);
    s = { t: r.t, playing: r.playing, speed: r.speed };
  }
  return { s, crossed };
};

describe('playback clock', () => {
  it('uses 1.4 s per month at 1x and scales with speed', () => {
    expect(BASE_SECONDS_PER_MONTH).toBe(1.4);
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map() });
    expect(run(pb, { t: 0, playing: true, speed: 1 }, 1.4).s.t).toBeCloseTo(1, 6);
    expect(run(createPlayback({ lastIndex: 40, eventMonths: new Map() }), { t: 0, playing: true, speed: 4 }, 1.4).s.t).toBeCloseTo(4, 6);
  });
  it('stops exactly on an event month and holds before continuing', () => {
    expect(HOLD_SECONDS).toEqual({ 1: 2, 2: 1.5, 4: 0.8 });
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[2, 1]]) });
    let r = run(pb, { t: 0, playing: true, speed: 1 }, 3.0);
    expect(r.s.t).toBe(2); // reached month 2 at 2.8 s, holding
    expect(r.crossed).toEqual([1, 2]);
    r = run(pb, r.s, 1.7);
    expect(r.s.t).toBe(2); // still holding: 0.2 s of the 2 s hold were spent in the first run
    r = run(pb, r.s, 0.3);
    expect(r.s.t).toBeGreaterThan(2);
  });
  it('holds HOLD_SECONDS × the number of banners in that month', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[2, 3]]) });
    let r = run(pb, { t: 0, playing: true, speed: 1 }, 2.8); // reaches month 2 at 2.8 s
    expect(r.s.t).toBe(2);
    r = run(pb, r.s, 5.5); // 6 s hold, 0 s spent so far on the reaching tick
    expect(r.s.t).toBe(2);
    r = run(pb, r.s, 0.7);
    expect(r.s.t).toBeGreaterThan(2);
    // 4x: 0.8 s per banner
    const fast = createPlayback({ lastIndex: 40, eventMonths: new Map([[4, 2]]) });
    r = run(fast, { t: 0, playing: true, speed: 4 }, 1.4);
    expect(r.s.t).toBe(4);
    r = run(fast, r.s, 1.5); // 1.6 s hold
    expect(r.s.t).toBe(4);
    r = run(fast, r.s, 0.2);
    expect(r.s.t).toBeGreaterThan(4);
  });
  it('holds shorter at 4x', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[4, 1]]) });
    let r = run(pb, { t: 0, playing: true, speed: 4 }, 1.4); // reaches 4 exactly
    expect(r.s.t).toBe(4);
    r = run(pb, r.s, 0.75);
    expect(r.s.t).toBe(4);
    r = run(pb, r.s, 0.2);
    expect(r.s.t).toBeGreaterThan(4);
  });
  it('stops at the end and turns playing off; does nothing while paused', () => {
    const pb = createPlayback({ lastIndex: 3, eventMonths: new Map() });
    const r = run(pb, { t: 2.5, playing: true, speed: 4 }, 2);
    expect(r.s).toEqual({ t: 3, playing: false, speed: 4 });
    expect(pb.tick(0.5, { t: 1.2, playing: false, speed: 1 })).toEqual({ t: 1.2, playing: false, speed: 1, crossed: [], holding: false });
  });
  it('ignores a dt that is not finite or not positive', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map() });
    const st = { t: 5.5, playing: true, speed: 2 as const };
    for (const dt of [NaN, Infinity, -Infinity, -0.1, 0]) {
      expect(pb.tick(dt, st), String(dt)).toEqual({ ...st, crossed: [], holding: false });
    }
  });
  it('caps dt at 0.25 s so a long stall cannot skip months', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map() });
    const r = pb.tick(30, { t: 0, playing: true, speed: 1 });
    expect(r.t).toBeCloseTo(0.25 / BASE_SECONDS_PER_MONTH, 10);
    expect(r.crossed).toEqual([]);
  });
  it('a bad dt does not shorten an ongoing hold', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[1, 1]]) });
    let r = run(pb, { t: 0, playing: true, speed: 1 }, 1.5); // reaches month 1 at 1.4 s, holding
    expect(r.s.t).toBe(1);
    expect(pb.tick(NaN, { ...r.s }).holding).toBe(true);
    r = run(pb, r.s, 1.8); // 0.1 s of the 2 s hold already spent
    expect(r.s.t).toBe(1);
    r = run(pb, r.s, 0.3);
    expect(r.s.t).toBeGreaterThan(1);
  });
});
