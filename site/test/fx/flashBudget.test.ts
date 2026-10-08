import { describe, it, expect } from 'vitest';
import { createFlashBudget, logFlashes } from '../../src/fx/flashBudget';

describe('flash budget', () => {
  it('grants at most 3 flashes per rolling second and caps intensity', () => {
    const b = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    expect(b.request(1, 0)).toBe(0.35);
    expect(b.request(0.2, 0.1)).toBe(0.2);
    expect(b.request(0.5, 0.2)).toBe(0.35);
    expect(b.request(0.5, 0.3)).toBe(0); // 4th within 1 s denied
    expect(b.request(0.5, 1.05)).toBe(0); // t=0 is still inside the 1.2 s window
    expect(b.request(0.5, 1.25)).toBe(0.35); // the first grant (t=0) left the window
  });

  it('never lets a 4th flash fall inside a closed 1 s interval (1.2 s window)', () => {
    const b = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    expect(b.request(1, 0)).toBeGreaterThan(0);
    expect(b.request(1, 0.1)).toBeGreaterThan(0);
    expect(b.request(1, 0.2)).toBeGreaterThan(0);
    expect(b.request(1, 1.0)).toBe(0); // [0, 1.0] is a closed 1 s interval: a 4th grant here would be 4 flashes in it
    expect(b.request(1, 1.25)).toBeGreaterThan(0);
  });

  it('holds the limit for any closed 1 s interval under a steady stream of requests', () => {
    const b = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    const granted: number[] = [];
    for (let k = 0; k <= 400; k++) {
      const now = k * 0.05;
      if (b.request(1, now) > 0) granted.push(now);
    }
    expect(granted.length).toBeGreaterThan(10);
    for (const g of granted) expect(granted.filter((x) => x >= g && x <= g + 1 + 1e-9).length).toBeLessThanOrEqual(3);
  });

  it('returns 0 for a non-finite time or a non-positive / non-finite intensity without using a slot', () => {
    const b = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    for (const now of [NaN, Infinity, -Infinity]) expect(b.request(1, now), String(now)).toBe(0);
    for (const i of [0, -1, NaN, -Infinity]) expect(b.request(i, 0), String(i)).toBe(0);
    // none of the above consumed a slot: three real flashes still fit
    expect(b.request(1, 0)).toBe(0.35);
    expect(b.request(1, 0.1)).toBe(0.35);
    expect(b.request(1, 0.2)).toBe(0.35);
    expect(b.request(1, 0.3)).toBe(0);
  });

  it('does not let a denied request extend the window', () => {
    const b = createFlashBudget({ maxPerSecond: 1, maxIntensity: 1 });
    expect(b.request(1, 0)).toBe(1);
    for (let k = 1; k <= 20; k++) expect(b.request(1, k * 0.05)).toBe(0);
    expect(b.request(1, 1.25)).toBe(1);
  });
});

describe('flash log (?debugFlash)', () => {
  it('passes requests through, logs grants per second and tracks the busiest 1 s window', () => {
    let clock = 0;
    const lines: string[] = [];
    const { budget, stats } = logFlashes(createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 }), { clock: () => clock, log: (m) => lines.push(m) });
    for (const t of [0.1, 0.2, 0.3, 0.4, 1.5, 1.6]) {
      clock = t;
      budget.request(1, t);
    }
    expect(stats).toMatchObject({ granted: 5, denied: 1, maxPerSecond: 3 });
    expect(stats.perSecond).toEqual([[0, 3]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('3 granted, 1 denied');
  });
});
