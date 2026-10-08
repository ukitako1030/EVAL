import { describe, it, expect } from 'vitest';
import { winProb, computeStrength, fillEstimatedStrength, type StrengthCell } from '../../src/compute/strength';
import type { SeriesTable, AssignedPoint } from '../../src/compute/assign';
import type { KindParams } from '../../src/config/schemas';

const K: KindParams = { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } };

const table = (
  group: string,
  series: string,
  priority: number,
  kind: SeriesTable['kind'],
  pts: Record<string, Record<string, number | [number, boolean]>>,
): SeriesTable => ({
  front: 'general',
  group,
  series,
  priority,
  kind,
  points: new Map(
    Object.entries(pts).map(([u, byM]) => [
      u,
      new Map(
        Object.entries(byM).map(([m, v]): [string, AssignedPoint] => {
          const [value, reconstructed] = Array.isArray(v) ? v : [v, false];
          return [m, { value, model: `${u}-model`, reconstructed }];
        }),
      ),
    ]),
  ),
});

describe('winProb', () => {
  it('is 0.5 for the leader itself and decreases with the gap', () => {
    expect(winProb('elo', 1300, 1300, K)).toBe(0.5);
    expect(winProb('elo', 1200, 1300, K)).toBeCloseTo(1 / (1 + 10 ** 0.25), 10);
    expect(winProb('percent', 50, 75, K)).toBeCloseTo(0.25, 10); // odds 1 vs 3
    expect(winProb('minutes', 30, 60, K)).toBeCloseTo(1 / (1 + Math.E), 10); // log2 gap −1
    expect(winProb('eci', 142, 150, K)).toBeCloseTo(1 / (1 + Math.E), 10);
  });
  it('scales the percent logit gap when percent.scale is set (default 1)', () => {
    const k2: KindParams = { ...K, percent: { ...K.percent, scale: 0.5 } };
    expect(winProb('percent', 50, 75, k2)).toBeCloseTo(1 / (1 + Math.exp(0.5 * Math.log(3))), 10);
    expect(winProb('percent', 50, 75, K)).toBeCloseTo(0.25, 10);
  });
  it('clamps percent at the edges', () => {
    expect(Number.isFinite(winProb('percent', 0, 100, K))).toBe(true);
  });
});

describe('computeStrength', () => {
  it('normalises each series to its monthly leader (=100) and weight-averages groups', () => {
    const tables = [
      table('arena', 'arena', 1, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1200 } }),
      table('eci', 'eci', 1, 'eci', { a: { '2025-01': 142 }, b: { '2025-01': 150 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 0.5, eci: 0.5 }, kinds: K, minUnits: 2 });
    const a = cells.get('a')!.get('2025-01')!;
    const b = cells.get('b')!.get('2025-01')!;
    const bArena = 200 / (1 + 10 ** 0.25);
    const aEci = 200 / (1 + Math.E);
    expect(a.s).toBeCloseTo((100 + aEci) / 2, 6);
    expect(b.s).toBeCloseTo((bArena + 100) / 2, 6);
    expect(a.measured).toBe(2);
    expect(a.breakdown.map((g) => g.group).sort()).toEqual(['arena', 'eci']);
  });
  it('skips series-months with fewer than minUnits units', () => {
    const tables = [table('arena', 'arena', 1, 'elo', { a: { '2025-01': 1300 } })];
    const cells = computeStrength({ tables, unitIds: ['a'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    expect(cells.get('a')!.get('2025-01')!.s).toBeNull();
  });
  it('uses only the highest-priority series of a group, averaging ties', () => {
    const tables = [
      table('arena', 'plain', 1, 'elo', { a: { '2025-01': 1000 }, b: { '2025-01': 1400 } }),
      table('arena', 'style', 2, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1300 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    expect(cells.get('a')!.get('2025-01')!.s).toBe(100);
    expect(cells.get('b')!.get('2025-01')!.s).toBe(100);
  });
  it('does not average a measured series with a reconstructed one of equal priority', () => {
    const tables = [
      table('arena', 'x', 1, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1200 } }),
      table('arena', 'y', 1, 'elo', { a: { '2025-01': [1200, true] }, b: { '2025-01': [1300, true] } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    const a = cells.get('a')!.get('2025-01')!;
    const b = cells.get('b')!.get('2025-01')!;
    expect(a.s).toBeCloseTo(100, 10);
    expect(b.s).toBeCloseTo(200 / (1 + 10 ** 0.25), 10);
    expect(a.measured).toBe(1);
    expect(a.reconstructed).toBe(0);
    expect(b.measured).toBe(1);
    expect(b.reconstructed).toBe(0);
  });
  it('does not let a higher-priority reconstructed series override a measured one', () => {
    const tables = [
      table('arena', 'plain', 1, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1200 } }),
      table('arena', 'style', 2, 'elo', { a: { '2025-01': [1200, true] }, b: { '2025-01': [1300, true] } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    const a = cells.get('a')!.get('2025-01')!;
    expect(a.s).toBeCloseTo(100, 10);
    expect(a.measured).toBe(1);
    expect(a.reconstructed).toBe(0);
  });
  it('still uses a higher-priority series when it is measured', () => {
    const tables = [
      table('arena', 'plain', 1, 'elo', { a: { '2025-01': [1000, true] }, b: { '2025-01': [1400, true] } }),
      table('arena', 'style', 2, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1300 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    expect(cells.get('a')!.get('2025-01')!.s).toBe(100);
    expect(cells.get('a')!.get('2025-01')!.measured).toBe(1);
  });
  it('flags reconstructed groups and ignores groups without weight', () => {
    const tables = [
      table('arena', 'arena', 1, 'elo', { a: { '2024-01': [1300, true] }, b: { '2024-01': [1300, true] } }),
      table('unweighted', 'u', 1, 'elo', { a: { '2024-01': 1 }, b: { '2024-01': 2 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2024-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    const a = cells.get('a')!.get('2024-01')!;
    expect(a.measured).toBe(0);
    expect(a.reconstructed).toBe(1);
    expect(a.breakdown).toHaveLength(1);
  });
});

describe('fillEstimatedStrength', () => {
  const empty = (): StrengthCell => ({ s: null, measured: 0, reconstructed: 0, estimated: false, breakdown: [], bestModel: null });
  it('gives never-measured units the median strength of the measured units (neutral prior)', () => {
    const cells = new Map([
      ['a', new Map([['2025-01', { ...empty(), s: 100, measured: 1 }]])],
      ['b', new Map([['2025-01', { ...empty(), s: 80, measured: 1 }]])],
      ['c', new Map([['2025-01', { ...empty(), s: 60, measured: 1 }]])],
      ['x', new Map([['2025-01', empty()]])],
    ]);
    const shares = new Map([
      ['a', new Map([['2025-01', 50]])],
      ['b', new Map([['2025-01', 10]])],
      ['c', new Map([['2025-01', 5]])],
      ['x', new Map([['2025-01', 49]])], // close to the leader's share, but it must NOT inherit the leader's 100
    ]);
    fillEstimatedStrength({ cells, shares, months: ['2025-01'], exists: () => true, floor: 60, step: 6 });
    const x = cells.get('x')!.get('2025-01')!;
    expect(x.s).toBe(80);
    expect(x.estimated).toBe(true);
  });
  it('carries the last measured strength forward for up to 6 months before falling back', () => {
    const months = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'];
    const a = new Map(months.map((m) => [m, { ...empty(), s: 100, measured: 1 }]));
    const x = new Map(months.map((m, i) => [m, i === 0 ? { ...empty(), s: 70, measured: 1 } : empty()]));
    const cells = new Map([['a', a], ['x', x]]);
    const shares = new Map([['a', new Map(months.map((m) => [m, 50]))], ['x', new Map(months.map((m) => [m, 49]))]]);
    fillEstimatedStrength({ cells, shares, months, exists: () => true, floor: 60, step: 6 });
    expect(cells.get('x')!.get('2025-02')).toMatchObject({ s: 70, estimated: true });
    expect(cells.get('x')!.get('2025-07')!.s).toBe(70); // 6 months after the last measurement
    expect(cells.get('x')!.get('2025-08')!.s).toBe(100); // carry expired → median of the measured units (only a)
  });
  it('ranks by scale when nothing is measured', () => {
    const cells = new Map([
      ['a', new Map([['2023-01', empty()]])],
      ['b', new Map([['2023-01', empty()]])],
    ]);
    const shares = new Map([
      ['a', new Map([['2023-01', 30]])],
      ['b', new Map([['2023-01', 70]])],
    ]);
    fillEstimatedStrength({ cells, shares, months: ['2023-01'], exists: () => true, floor: 60, step: 6 });
    expect(cells.get('b')!.get('2023-01')!.s).toBe(100);
    expect(cells.get('a')!.get('2023-01')!.s).toBe(94);
  });
});
