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
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Set() });
    expect(run(pb, { t: 0, playing: true, speed: 1 }, 1.4).s.t).toBeCloseTo(1, 6);
    expect(run(createPlayback({ lastIndex: 40, eventMonths: new Set() }), { t: 0, playing: true, speed: 4 }, 1.4).s.t).toBeCloseTo(4, 6);
  });
  it('stops exactly on an event month and holds before continuing', () => {
    expect(HOLD_SECONDS).toEqual({ 1: 2, 2: 1.5, 4: 0.8 });
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Set([2]) });
    let r = run(pb, { t: 0, playing: true, speed: 1 }, 3.0);
    expect(r.s.t).toBe(2); // reached month 2 at 2.8 s, holding
    expect(r.crossed).toEqual([1, 2]);
    r = run(pb, r.s, 1.7);
    expect(r.s.t).toBe(2); // still holding: 0.2 s of the 2 s hold were spent in the first run
    r = run(pb, r.s, 0.3);
    expect(r.s.t).toBeGreaterThan(2);
  });
  it('holds shorter at 4x', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Set([4]) });
    let r = run(pb, { t: 0, playing: true, speed: 4 }, 1.4); // reaches 4 exactly
    expect(r.s.t).toBe(4);
    r = run(pb, r.s, 0.75);
    expect(r.s.t).toBe(4);
    r = run(pb, r.s, 0.2);
    expect(r.s.t).toBeGreaterThan(4);
  });
  it('stops at the end and turns playing off; does nothing while paused', () => {
    const pb = createPlayback({ lastIndex: 3, eventMonths: new Set() });
    const r = run(pb, { t: 2.5, playing: true, speed: 4 }, 2);
    expect(r.s).toEqual({ t: 3, playing: false, speed: 4 });
    expect(pb.tick(0.5, { t: 1.2, playing: false, speed: 1 })).toEqual({ t: 1.2, playing: false, speed: 1, crossed: [], holding: false });
  });
});
