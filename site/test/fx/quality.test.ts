import { describe, it, expect } from 'vitest';
import { createQualityGovernor } from '../../src/fx/quality';

// dt values are exact binary fractions so window boundaries are exact
const windows = (g: ReturnType<typeof createQualityGovernor>, fps: number, n: number) => {
  for (let i = 0; i < fps * n; i++) g.frame(0, 1 / fps);
};

describe('quality governor', () => {
  it('steps down one level per two consecutive slow windows, never back up, max 3', () => {
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    windows(g, 64, 3); // startup window + 2 fast windows
    expect(g.level).toBe(0);
    windows(g, 32, 1); // 1 slow window (< 64 × 0.85): not enough on its own
    expect(g.level).toBe(0);
    windows(g, 32, 1); // 2nd consecutive slow window
    expect(g.level).toBe(1);
    windows(g, 32, 5); // 5 more slow windows → 2 more steps, capped at 3
    expect(g.level).toBe(3);
    windows(g, 64, 5); // fast again → never steps back up
    expect(g.level).toBe(3);
  });

  it('ignores the first window after creation (startup is always slow)', () => {
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    windows(g, 32, 1); // slow startup window: ignored entirely
    windows(g, 32, 1); // first counted slow window
    expect(g.level).toBe(0);
    windows(g, 32, 1);
    expect(g.level).toBe(1);
  });

  it('a fast window resets the slow streak', () => {
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    windows(g, 64, 1); // startup
    windows(g, 32, 1);
    windows(g, 64, 1); // fast: streak back to 0
    windows(g, 32, 1);
    expect(g.level).toBe(0);
    windows(g, 32, 1);
    expect(g.level).toBe(1);
  });

  it('a single long frame (tab switch, GC pause) neither counts as a slow window nor steps down', () => {
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    windows(g, 64, 1); // startup
    windows(g, 32, 1); // one slow window already on the books
    g.frame(0, 2); // a 2 s hitch would be a (very) slow window if it were counted
    expect(g.level).toBe(0);
    windows(g, 64, 2);
    expect(g.level).toBe(0);
  });

  it('a long frame restarts the window it interrupts', () => {
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    windows(g, 64, 1); // startup
    for (let i = 0; i < 30; i++) g.frame(0, 1 / 32); // almost a slow window ...
    g.frame(0, 2); // ... interrupted: those 30 frames are forgotten
    for (let i = 0; i < 2; i++) g.frame(0, 1 / 32); // would have completed the slow window
    expect(g.level).toBe(0);
    windows(g, 32, 1); // streak is still 0 → one slow window is not enough
    expect(g.level).toBe(0);
    windows(g, 32, 1);
    expect(g.level).toBe(1);
  });

  describe('display-limited frame rates (work time measured)', () => {
    /** `n` windows of frames at `fps`, each frame's update + render work taking `workMs` */
    const run = (g: ReturnType<typeof createQualityGovernor>, fps: number, workMs: number, n: number) => {
      for (let i = 0; i < fps * n; i++) g.frame(0, 1 / fps, workMs / 1000);
    };
    it('a steady 50 Hz monitor with cheap frames never downgrades', () => {
      const g = createQualityGovernor({ targetFps: 60, window: 2 });
      run(g, 50, 4, 20);
      expect(g.level).toBe(0);
    });
    it('a steady 30 fps cap with cheap frames never downgrades', () => {
      const g = createQualityGovernor({ targetFps: 60, window: 2 });
      run(g, 30, 6, 20);
      expect(g.level).toBe(0);
    });
    it('a steady low rate with busy frames (the app is the bottleneck) still steps down', () => {
      const g = createQualityGovernor({ targetFps: 60, window: 2 });
      run(g, 30, 30, 2); // startup window
      run(g, 30, 30, 4); // two slow windows
      expect(g.level).toBe(1);
      const h = createQualityGovernor({ targetFps: 60, window: 2 });
      run(h, 50, 17, 6);
      expect(h.level).toBe(1);
    });
    it('cheap but irregular frames on a 60 Hz display (GPU-bound: dropped vsyncs) still step down', () => {
      const g = createQualityGovernor({ targetFps: 60, window: 2 });
      // every other frame misses a vsync: 16.7 / 33.3 ms → 40 fps, CPU work tiny
      for (let i = 0; i < 40 * 6; i++) g.frame(0, i % 2 ? 2 / 60 : 1 / 60, 0.003);
      expect(g.level).toBeGreaterThanOrEqual(1);
    });
    it('without a work measurement it judges by frame rate alone (as before)', () => {
      const g = createQualityGovernor({ targetFps: 60, window: 2 });
      for (let i = 0; i < 30 * 6; i++) g.frame(0, 1 / 30);
      expect(g.level).toBe(1);
    });
  });

  it('ignores a non-finite dt without poisoning the window', () => {
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    windows(g, 64, 1); // startup
    g.frame(0, NaN);
    g.frame(0, Infinity);
    expect(g.level).toBe(0);
    windows(g, 32, 2); // the governor still evaluates windows afterwards
    expect(g.level).toBe(1);
  });
});
