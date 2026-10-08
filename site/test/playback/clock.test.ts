import { describe, it, expect } from 'vitest';
import { createPlayback, cappedHoldCount, newsAfterChange, BASE_SECONDS_PER_MONTH, HOLD_SECONDS, MAX_HOLD_SECONDS } from '../../src/playback/clock';

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
  it('drops the hold when the user moves away from the held month', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[2, 1]]) });
    const held = run(pb, { t: 0, playing: true, speed: 1 }, 3.0);
    expect(held.s.t).toBe(2);
    expect(pb.tick(0.05, held.s).holding).toBe(true);
    // scrubbed forward: playback carries on from the new position instead of waiting out the old hold
    const fwd = pb.tick(0.05, { t: 10, playing: true, speed: 1 });
    expect(fwd.holding).toBe(false);
    expect(fwd.t).toBeGreaterThan(10);
    // stepped back one month: same
    const pb2 = createPlayback({ lastIndex: 40, eventMonths: new Map([[2, 1]]) });
    const held2 = run(pb2, { t: 0, playing: true, speed: 1 }, 3.0);
    const back = pb2.tick(0.05, { ...held2.s, t: 1 });
    expect(back.holding).toBe(false);
    expect(back.t).toBeGreaterThan(1);
    // and the event month holds again when playback reaches it afresh
    const again = run(pb2, { t: back.t, playing: true, speed: 1 }, 2.0);
    expect(again.s.t).toBe(2);
    expect(again.crossed).toEqual([2]);
  });
  it('never holds on the last month', () => {
    const pb = createPlayback({ lastIndex: 3, eventMonths: new Map([[3, 2]]) });
    const r = run(pb, { t: 2.5, playing: true, speed: 1 }, 1.0);
    expect(r.s).toEqual({ t: 3, playing: false, speed: 1 });
    expect(r.crossed).toEqual([3]);
    const last = pb.tick(0.05, { t: 2.99, playing: true, speed: 1 });
    expect(last).toMatchObject({ t: 3, playing: false, holding: false });
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
  it('caps a month with many banners at maxHoldSeconds by clamping the banner count', () => {
    expect(MAX_HOLD_SECONDS).toBe(6);
    expect(cappedHoldCount(5, 1, 6)).toBe(3); // 3 × 2 s = 6 s
    expect(cappedHoldCount(5, 2, 6)).toBe(4); // 4 × 1.5 s = 6 s
    expect(cappedHoldCount(10, 4, 6)).toBe(7); // 7 × 0.8 s = 5.6 s
    expect(cappedHoldCount(2, 1, 6)).toBe(2);
    expect(cappedHoldCount(0, 1, 6)).toBe(0);
    expect(cappedHoldCount(4, 1)).toBe(4); // no cap
    expect(cappedHoldCount(3, 1, 0.5)).toBe(1); // a month with news always pauses at least one banner long
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[2, 9]]), maxHoldSeconds: MAX_HOLD_SECONDS });
    let r = run(pb, { t: 0, playing: true, speed: 1 }, 2.8);
    expect(r.s.t).toBe(2);
    r = run(pb, r.s, 5.9);
    expect(r.s.t).toBe(2);
    r = run(pb, r.s, 0.2);
    expect(r.s.t).toBeGreaterThan(2); // 6 s, not 18 s
  });
  it('holdAt starts a hold on a month playback did not cross (the intro on month 0)', () => {
    const pb = createPlayback({ lastIndex: 40, eventMonths: new Map([[0, 1], [3, 1]]), maxHoldSeconds: MAX_HOLD_SECONDS });
    pb.holdAt(0, 1);
    let r = run(pb, { t: 0, playing: true, speed: 1 }, 1.9);
    expect(r.s.t).toBe(0);
    r = run(pb, r.s, 0.2);
    expect(r.s.t).toBeGreaterThan(0);
    // months without banners and the last month never hold
    const pb2 = createPlayback({ lastIndex: 3, eventMonths: new Map([[3, 1]]) });
    pb2.holdAt(1, 1);
    expect(pb2.tick(0.05, { t: 1, playing: true, speed: 1 }).t).toBeGreaterThan(1);
    pb2.holdAt(3, 1);
    expect(pb2.tick(0.05, { t: 3, playing: true, speed: 1 }).holding).toBe(false);
  });
});

describe('newsAfterChange (a store change the playback tick did not make)', () => {
  const st = (t: number, playing: boolean, front: 'general' | null = null) => ({ t, playing, front });
  it('pressing play while paused at month 0 starts from the top (opening news + hold)', () => {
    expect(newsAfterChange(st(0, true), st(0, false), false)).toEqual({ clear: false, fromTop: true });
    expect(newsAfterChange(st(0.4, true), st(0.4, false), false)).toEqual({ clear: false, fromTop: true });
  });
  it('pressing play elsewhere just resumes', () => {
    expect(newsAfterChange(st(5, true), st(5, false), false)).toEqual({ clear: false, fromTop: false });
  });
  it('moving t clears stale news; landing on month 0 while playing starts from the top ("play again")', () => {
    expect(newsAfterChange(st(7, false), st(3, false), false)).toEqual({ clear: true, fromTop: false });
    expect(newsAfterChange(st(0, true), st(46, false), false)).toEqual({ clear: true, fromTop: true });
    expect(newsAfterChange(st(0, false), st(4, false), false)).toEqual({ clear: true, fromTop: false });
  });
  it('ignores the playback tick, front switches and pausing', () => {
    expect(newsAfterChange(st(0.1, true), st(0, true), true)).toEqual({ clear: false, fromTop: false });
    expect(newsAfterChange(st(0, true, 'general'), st(0, false), false)).toEqual({ clear: false, fromTop: false });
    expect(newsAfterChange(st(0, false), st(0, true), false)).toEqual({ clear: false, fromTop: false });
  });
});
