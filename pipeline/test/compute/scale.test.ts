import { describe, it, expect } from 'vitest';
import { scaleMonth, computeScale } from '../../src/compute/scale';
import type { SignalTable } from '../../src/compute/signals';

const method = {
  smoothingMonths: 1,
  announcementStaleMonths: 6,
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 },
  floorFactor: 0.5,
  components: {
    users: { weight: 0.5, signals: ['announcements' as const] },
    attention: { weight: 0.5, signals: ['wikipedia' as const] },
  },
  base: ['attention'],
};

const tbl = (data: Record<string, Record<string, Record<string, number>>>): SignalTable =>
  new Map(
    Object.entries(data).map(([sig, byUnit]) => [
      sig as never,
      new Map(Object.entries(byUnit).map(([u, byM]) => [u, new Map(Object.entries(byM))])),
    ]),
  );

describe('scaleMonth', () => {
  it('uses base shares when only base data exists', () => {
    const r = scaleMonth(['a', 'b'], '2025-01', tbl({ wikipedia: { a: { '2025-01': 300 }, b: { '2025-01': 100 } } }), method);
    expect(r.get('a')!.share).toBeCloseTo(0.75, 10);
    expect(r.get('b')!.share).toBeCloseTo(0.25, 10);
    expect(r.get('a')!.components).toBe(1);
  });
  it('redistributes a partial component only among the units that have it', () => {
    // base: a .5, b .25, c .25 ; users known for a and b only (a:b = 1:3)
    const r = scaleMonth(
      ['a', 'b', 'c'],
      '2025-01',
      tbl({
        wikipedia: { a: { '2025-01': 2 }, b: { '2025-01': 1 }, c: { '2025-01': 1 } },
        announcements: { a: { '2025-01': 10 }, b: { '2025-01': 30 } },
      }),
      method,
    );
    // users implied: a = .75*.25, b = .75*.75, c = base .25
    expect(r.get('a')!.share).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.1875, 10);
    expect(r.get('b')!.share).toBeCloseTo(0.5 * 0.25 + 0.5 * 0.5625, 10);
    expect(r.get('c')!.share).toBeCloseTo(0.25, 10);
    expect(r.get('c')!.components).toBe(1);
  });
  it('carries a signal value forward up to 2 months (current month often has no data yet)', () => {
    const r = scaleMonth(['a', 'b'], '2025-03', tbl({ wikipedia: { a: { '2025-01': 3 }, b: { '2025-03': 1 } } }), method);
    expect(r.get('a')!.share).toBeCloseTo(0.75, 10);
    const r2 = scaleMonth(['a', 'b'], '2025-04', tbl({ wikipedia: { a: { '2025-01': 3 }, b: { '2025-04': 1 } } }), method);
    expect(r2.get('a')!.components).toBe(0);
  });
  it('gives units without any base signal a floor and uniform shares when no data at all', () => {
    const r = scaleMonth(['a', 'b'], '2025-01', tbl({ wikipedia: { a: { '2025-01': 1 } } }), method);
    expect(r.get('b')!.share).toBeCloseTo(1 / 3, 10); // floor 0.5 of a's 1.0 → 1 : 0.5
    expect(r.get('b')!.components).toBe(0);
    const u = scaleMonth(['a', 'b'], '2025-01', tbl({}), method);
    expect(u.get('a')!.share).toBe(0.5);
  });
});

describe('scaleMonth: per-signal redistribution', () => {
  // attention is the base component and carries two signals
  const twoSigMethod = {
    ...method,
    components: {
      users: { weight: 0.5, signals: ['announcements' as const] },
      attention: { weight: 0.5, signals: ['wikipedia' as const, 'itunes' as const] },
    },
  };
  it('a base signal covering few units cannot inflate them (wikipedia 40/30/20/10 + itunes for d only)', () => {
    const r = scaleMonth(
      ['a', 'b', 'c', 'd'],
      '2025-01',
      tbl({
        wikipedia: { a: { '2025-01': 40 }, b: { '2025-01': 30 }, c: { '2025-01': 20 }, d: { '2025-01': 10 } },
        itunes: { d: { '2025-01': 5 } },
      }),
      twoSigMethod,
    );
    expect(r.get('a')!.share).toBeCloseTo(0.4, 9);
    expect(r.get('b')!.share).toBeCloseTo(0.3, 9);
    expect(r.get('c')!.share).toBeCloseTo(0.2, 9);
    expect(r.get('d')!.share).toBeCloseTo(0.1, 9);
  });
  it('a non-base signal covering 2 of 3 units redistributes only those two units base mass', () => {
    const r = scaleMonth(
      ['a', 'b', 'c'],
      '2025-01',
      tbl({
        wikipedia: { a: { '2025-01': 2 }, b: { '2025-01': 1 }, c: { '2025-01': 1 } },
        announcements: { a: { '2025-01': 10 }, b: { '2025-01': 30 } },
      }),
      method,
    );
    const total = [...r.values()].reduce((t, x) => t + x.share, 0);
    expect(total).toBeCloseTo(1, 12);
    // base a .5 b .25 c .25 → users implied: a .1875, b .5625 (mass .75), c .25 (untouched)
    expect(r.get('a')!.share + r.get('b')!.share).toBeCloseTo(0.5 * 0.75 + 0.5 * 0.75, 12);
    expect(r.get('c')!.share).toBeCloseTo(0.25, 12);
  });
  it('signals inside one component are each confined to the units they cover, then averaged', () => {
    const m = {
      ...method,
      components: {
        users: { weight: 0.5, signals: ['announcements' as const, 'statcounter' as const] },
        attention: { weight: 0.5, signals: ['wikipedia' as const] },
      },
    };
    const r = scaleMonth(
      ['a', 'b', 'c'],
      '2025-01',
      tbl({
        wikipedia: { a: { '2025-01': 2 }, b: { '2025-01': 1 }, c: { '2025-01': 1 } },
        announcements: { a: { '2025-01': 10 }, b: { '2025-01': 30 } }, // implied a .1875 b .5625 c .25
        statcounter: { b: { '2025-01': 1 }, c: { '2025-01': 1 } }, // implied a .5 b .25 c .25
      }),
      m,
    );
    // users implied = mean → a .34375 b .40625 c .25 ; combined with base (.5,.25,.25) at 50/50
    expect(r.get('a')!.share).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.34375, 12);
    expect(r.get('b')!.share).toBeCloseTo(0.5 * 0.25 + 0.5 * 0.40625, 12);
    expect(r.get('c')!.share).toBeCloseTo(0.25, 12);
    expect(r.get('a')!.components).toBe(2);
    expect(r.get('c')!.components).toBe(2);
  });
});

describe('computeScale', () => {
  it('smooths over the window, renormalises and returns 0–100; null when the unit does not exist', () => {
    const signals = tbl({
      wikipedia: {
        a: { '2025-01': 1, '2025-02': 3 },
        b: { '2025-01': 1, '2025-02': 1 },
      },
    });
    const out = computeScale({
      unitIds: ['a', 'b'],
      months: ['2025-01', '2025-02'],
      exists: () => true,
      signals,
      method: { ...method, smoothingMonths: 2 },
    });
    expect(out.get('a')!.get('2025-01')!.c).toBeCloseTo(50, 10);
    // raw Feb: a .75 b .25 ; smoothed a (.5+.75)/2=.625, b (.5+.25)/2=.375 → sum 1
    expect(out.get('a')!.get('2025-02')!.c).toBeCloseTo(62.5, 10);
    const gone = computeScale({ unitIds: ['a', 'b'], months: ['2025-01'], exists: (u) => u === 'a', signals, method });
    expect(gone.get('b')!.get('2025-01')).toBeNull();
    expect(gone.get('a')!.get('2025-01')!.c).toBe(100);
  });
});
