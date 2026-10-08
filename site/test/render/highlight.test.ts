import { describe, it, expect } from 'vitest';
import {
  DIM_GAIN,
  FADE_S,
  HOVER_GAIN,
  PULSE_DEPTH,
  PULSE_HZ,
  emphasisTarget,
  pulse,
  pulseWave,
  retarget,
  stepPulse,
  stepTween,
  tween,
  wedgeIndexAt,
} from '../../src/render/emphasis';
import { CORE, START_ANGLE, TAU } from '../../src/render/layout';
import { createFlashBudget, FLASH_WINDOW_SECONDS } from '../../src/fx/flashBudget';

describe('org emphasis', () => {
  it('lights the hovered org ×1.6 and dims everyone else to 35 %', () => {
    expect(HOVER_GAIN).toBe(1.6);
    expect(DIM_GAIN).toBe(0.35);
    expect(emphasisTarget('google', null)).toBe(1);
    expect(emphasisTarget('google', 'google')).toBe(HOVER_GAIN);
    expect(emphasisTarget('openai', 'google')).toBe(DIM_GAIN);
  });

  it('eases to a new level in 200 ms, smoothly and monotonically', () => {
    const t = tween();
    retarget(t, HOVER_GAIN, FADE_S);
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) xs.push(stepTween(t, 1 / 60));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(xs[0] - 1).toBeLessThan(0.02); // eased start, no jump
    expect(xs[11]).toBe(HOVER_GAIN); // 12 frames = 200 ms
    expect(t.p).toBe(1);
  });

  it('retargets from wherever it is, without jumping', () => {
    const t = tween();
    retarget(t, DIM_GAIN, FADE_S);
    stepTween(t, 0.1);
    const mid = t.value;
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(DIM_GAIN);
    retarget(t, 1, FADE_S);
    expect(stepTween(t, 0)).toBe(mid);
    stepTween(t, FADE_S);
    expect(t.value).toBe(1);
    // retargeting to the same level keeps the running transition
    retarget(t, DIM_GAIN, FADE_S);
    stepTween(t, 0.05);
    const p = t.p;
    retarget(t, DIM_GAIN, FADE_S);
    expect(t.p).toBe(p);
  });
});

describe('highlight pulse', () => {
  it('is a raised cosine', () => {
    expect(pulseWave(0)).toBeCloseTo(0);
    expect(pulseWave(0.5)).toBeCloseTo(1);
    expect(pulseWave(1)).toBeCloseTo(0);
  });

  it('pulses at most once a second and asks for one grant per cycle', () => {
    expect(PULSE_HZ).toBeLessThanOrEqual(1);
    const p = pulse();
    let grants = 0;
    let peaks = 0;
    let prev = 0;
    let rising = false;
    for (let i = 0; i < 600; i++) {
      const v = stepPulse(p, 1 / 60, () => (grants++, 0.2));
      if (v < prev && rising) peaks++;
      rising = v > prev;
      prev = v;
      expect(v).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    // 10 s at 0.8 Hz after a 0.5 s delay
    expect(grants).toBeGreaterThanOrEqual(7);
    expect(grants).toBeLessThanOrEqual(8);
    expect(peaks).toBeLessThanOrEqual(10);
  });

  it('stays dark for a cycle the flash budget refuses, and never takes two budget slots at once', () => {
    const budget = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    const p = pulse();
    let now = 0;
    const granted: number[] = [];
    // two other effects keep requesting every frame: the pulse must still fit the 3-per-window rule
    let max = 0;
    for (let i = 0; i < 1200; i++) {
      now += 1 / 60;
      const v = stepPulse(p, 1 / 60, () => {
        const g = budget.request(1, now);
        if (g > 0) granted.push(now);
        return g * PULSE_DEPTH;
      });
      max = Math.max(max, v);
    }
    expect(max).toBeLessThanOrEqual(0.35 * PULSE_DEPTH + 1e-9);
    for (let i = 1; i < granted.length; i++) expect(granted[i] - granted[i - 1]).toBeGreaterThan(FLASH_WINDOW_SECONDS);

    const refused = pulse();
    let seen = 0;
    for (let i = 0; i < 300; i++) seen = Math.max(seen, stepPulse(refused, 1 / 60, () => 0));
    expect(seen).toBe(0);
  });
});

describe('wedgeIndexAt', () => {
  // three wedges: [−90°, 30°), [30°, 150°), [150°, 270°) — straight borders
  const borders = [START_ANGLE, START_ANGLE + TAU / 3, START_ANGLE + (2 * TAU) / 3];
  const rangeAt = (k: number): [number, number] => [borders[k], k === 2 ? borders[0] + TAU : borders[k + 1]];
  const at = (deg: number, rho: number, R = 50) => {
    const a = (deg * Math.PI) / 180;
    return wedgeIndexAt(Math.cos(a) * rho * R, Math.sin(a) * rho * R, R, 3, rangeAt);
  };

  it('finds the wedge under a point from its angle (screen orientation, y down)', () => {
    expect(at(-60, 0.6)).toBe(0); // up-right
    expect(at(0, 0.6)).toBe(0);
    expect(at(90, 0.6)).toBe(1); // down
    expect(at(180, 0.6)).toBe(2); // left
    expect(at(-100, 0.6)).toBe(2); // just left of 12 o'clock
    expect(at(260, 0.6)).toBe(2);
  });

  it('ignores the core and anything beyond the rim', () => {
    expect(at(0, CORE * 0.9)).toBe(-1);
    expect(at(0, 1.05)).toBe(-1);
    expect(at(0, 1)).toBe(0);
    expect(wedgeIndexAt(0, 0, 50, 3, rangeAt)).toBe(-1);
  });

  it('follows bulging frontlines (ranges that depend on the radius)', () => {
    // the 0|1 border leans by +0.3 rad at the rim
    const bent = (k: number, rho: number): [number, number] => {
      const b1 = borders[1] + 0.3 * rho;
      return k === 0 ? [borders[0], b1] : k === 1 ? [b1, borders[2]] : [borders[2], borders[0] + TAU];
    };
    const a = borders[1] + 0.2; // inside wedge 1 near the core, inside wedge 0 at the rim
    const p = (rho: number) => wedgeIndexAt(Math.cos(a) * rho * 50, Math.sin(a) * rho * 50, 50, 3, bent);
    expect(p(0.3)).toBe(1);
    expect(p(0.95)).toBe(0);
  });

  it('handles planets with one or no territories', () => {
    expect(wedgeIndexAt(10, 10, 50, 1, () => [0, TAU])).toBe(0);
    expect(wedgeIndexAt(10, 10, 50, 0, () => [0, 0])).toBe(-1);
    expect(wedgeIndexAt(10, 10, 0, 3, rangeAt)).toBe(-1);
  });
});
