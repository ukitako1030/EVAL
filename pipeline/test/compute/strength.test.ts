import { describe, it, expect } from 'vitest';
import { winProb, computeStrength, fillEstimatedStrength, type StrengthCell } from '../../src/compute/strength';
import { assignSeries, type SeriesTable, type AssignedPoint } from '../../src/compute/assign';
import type { KindParams } from '../../src/config/schemas';
import type { CompiledUnit } from '../../src/config/load';
import { monthRange } from '../../src/core/months';

const K: KindParams = { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } };

const table = (
  group: string,
  series: string,
  priority: number,
  kind: SeriesTable['kind'],
  pts: Record<string, Record<string, number | [number, boolean]>>,
  /** month → freshness (a month without an entry counts as fully fresh) */
  fresh: Record<string, number> = {},
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
  freshness: new Map(Object.entries(fresh)),
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

describe('computeStrength — fading sources', () => {
  const months = monthRange('2025-01', '2025-12');
  const units: CompiledUnit[] = ['a', 'b'].map((id) => ({ id, front: 'general', org: id, name: id, since: '2022-11', regexes: [new RegExp(`^${id}-`)], scale: {} }));
  // a release benchmark that published only in 2025-01: a leads it, b is far behind
  const bench = assignSeries({
    front: 'general',
    group: 'bench',
    priority: 1,
    observations: [
      { series: 'bench', kind: 'percent', model: 'a-1', date: '2025-01-10', dateKind: 'release', value: 80 },
      { series: 'bench', kind: 'percent', model: 'b-1', date: '2025-01-12', dateKind: 'release', value: 40 },
    ],
    units,
    months,
    releases: [],
    params: { snapshotMaxAgeDays: 92, releaseActiveMonths: 3, fadeMonths: 6 },
  });
  // an arena that stays fresh all year: b leads it
  const arena = table('arena', 'arena', 1, 'elo', {
    a: Object.fromEntries(months.map((m) => [m, 1200])),
    b: Object.fromEntries(months.map((m) => [m, 1300])),
  });
  const w = 0.5;
  const cells = computeStrength({ tables: [bench, arena], unitIds: ['a', 'b'], months, weights: { bench: w, arena: 0.5 }, kinds: K, minUnits: 2 });
  const benchWeight = (m: string) => cells.get('a')!.get(m)!.breakdown.find((g) => g.group === 'bench')?.weight;

  it('a release series whose last observation is 2025-01 contributes weight w until 2025-04, then w·6/7, w·5/7, … and nothing from 2025-11', () => {
    for (const m of ['2025-01', '2025-02', '2025-03', '2025-04']) expect(benchWeight(m), m).toBe(w);
    const fading: [string, number][] = [
      ['2025-05', 6 / 7],
      ['2025-06', 5 / 7],
      ['2025-07', 4 / 7],
      ['2025-08', 3 / 7],
      ['2025-09', 2 / 7],
      ['2025-10', 1 / 7],
    ];
    for (const [m, f] of fading) expect(benchWeight(m), m).toBeCloseTo(w * f, 12);
    expect(benchWeight('2025-11')).toBeUndefined();
    expect(benchWeight('2025-12')).toBeUndefined();
    expect(cells.get('a')!.get('2025-11')!.breakdown.map((g) => g.group)).toEqual(['arena']);
  });
  it('uses the effective weights in the weighted mean, so the unit score moves smoothly', () => {
    const s = (m: string) => cells.get('a')!.get(m)!.s!;
    const arenaA = 200 / (1 + 10 ** 0.25);
    expect(s('2025-04')).toBeCloseTo((100 + arenaA) / 2, 6);
    expect(s('2025-06')).toBeCloseTo(((5 / 7) * 100 + arenaA) / (5 / 7 + 1), 6);
    expect(s('2025-11')).toBeCloseTo(arenaA, 6);
    // the whole ~14-point move is spread over 7 months: no single month moves by the surge threshold
    const steps = months.slice(1).map((m, i) => Math.abs(s(m) - s(months[i])));
    expect(s('2025-04') - s('2025-11')).toBeGreaterThan(13);
    expect(Math.max(...steps)).toBeLessThan(5);
  });
  it('sorts the breakdown by effective weight', () => {
    const c = computeStrength({ tables: [bench, arena], unitIds: ['a', 'b'], months, weights: { bench: 0.6, arena: 0.4 }, kinds: K, minUnits: 2 });
    expect(c.get('a')!.get('2025-03')!.breakdown.map((g) => g.group)).toEqual(['bench', 'arena']);
    expect(c.get('a')!.get('2025-07')!.breakdown.map((g) => g.group)).toEqual(['arena', 'bench']); // 0.6 · 4/7 < 0.4
  });

  it('prefers a fresh series over a fading one of higher priority (the fresh one keeps the full weight)', () => {
    const tables = [
      table('arena', 'legacy', 3, 'elo', { a: { '2025-12': 1000 }, b: { '2025-12': 1400 } }, { '2025-12': 3 / 7 }),
      table('arena', 'style', 2, 'elo', { a: { '2025-12': 1300 }, b: { '2025-12': 1300 } }),
    ];
    const c = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-12'], weights: { arena: 0.5 }, kinds: K, minUnits: 2 });
    const a = c.get('a')!.get('2025-12')!;
    expect(a.s).toBe(100);
    expect(a.breakdown[0].weight).toBe(0.5);
  });
  it('still uses the highest priority when every series of the group is fading', () => {
    const tables = [
      table('arena', 'legacy', 3, 'elo', { a: { '2025-12': 1000 }, b: { '2025-12': 1400 } }, { '2025-12': 3 / 7 }),
      table('arena', 'style', 2, 'elo', { a: { '2025-12': 1300 }, b: { '2025-12': 1300 } }, { '2025-12': 5 / 7 }),
    ];
    const c = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-12'], weights: { arena: 0.5 }, kinds: K, minUnits: 2 });
    expect(c.get('b')!.get('2025-12')!.s).toBe(100);
    expect(c.get('b')!.get('2025-12')!.breakdown[0].weight).toBeCloseTo(0.5 * (3 / 7), 12);
  });
  it('blends series of equal priority by freshness and weights the group by the freshest series the unit has', () => {
    // x: old split, fading (2/7); y: new split, fresh. a is in both, c only in the old one, b only in the new one.
    const tables = [
      table('tau', 'x', 1, 'percent', { a: { '2025-12': 50 }, b0: { '2025-12': 60 }, c: { '2025-12': 40 } }, { '2025-12': 2 / 7 }),
      table('tau', 'y', 1, 'percent', { a: { '2025-12': 80 }, b: { '2025-12': 70 } }),
    ];
    const c = computeStrength({ tables, unitIds: ['a', 'b', 'c'], months: ['2025-12'], weights: { tau: 0.2 }, kinds: K, minUnits: 2 });
    const g = (u: string) => c.get(u)!.get('2025-12')!.breakdown[0];
    const sx = (v: number) => 200 * winProb('percent', v, 60, K);
    const sy = (v: number) => 200 * winProb('percent', v, 80, K);
    expect(g('a').score).toBeCloseTo(((2 / 7) * sx(50) + sy(80)) / (2 / 7 + 1), 10);
    expect(g('a').weight).toBe(0.2);
    expect(g('a').model).toBe('a-model'); // the freshest hit's model
    expect(g('b').weight).toBe(0.2);
    expect(g('c').score).toBeCloseTo(sx(40), 10);
    expect(g('c').weight).toBeCloseTo(0.2 * (2 / 7), 12);
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
