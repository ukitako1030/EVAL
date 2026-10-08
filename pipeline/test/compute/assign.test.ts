import { describe, it, expect, vi } from 'vitest';
import { assignSeries, matchUnit } from '../../src/compute/assign';
import type { CompiledUnit, CompiledRelease } from '../../src/config/load';
import type { Observation } from '../../src/core/types';
import { monthRange } from '../../src/core/months';

const unit = (id: string, since: string, match: string[], extra: Partial<CompiledUnit> = {}): CompiledUnit => ({
  id,
  front: 'general',
  org: id,
  name: id,
  since,
  regexes: match.map((m) => new RegExp(m, 'i')),
  scale: {},
  ...extra,
});
const UNITS = [unit('gpt', '2022-11', ['^gpt']), unit('claude', '2023-03', ['^claude'])];
const params = { snapshotMaxAgeDays: 92, releaseActiveMonths: 3, fadeMonths: 0 };
const ob = (o: Partial<Observation>): Observation => ({
  series: 's',
  kind: 'elo',
  model: 'gpt-4',
  date: '2023-05-10',
  dateKind: 'snapshot',
  value: 1000,
  ...o,
});

describe('matchUnit', () => {
  it('matches first unit whose regex hits; respects orgRegex', () => {
    expect(matchUnit(UNITS, { model: 'Claude-3-Opus' })?.id).toBe('claude');
    expect(matchUnit(UNITS, { model: 'llama-3' })).toBeNull();
    const withOrg = [unit('x', '2022-11', ['.*'], { orgRegex: /^acme$/i })];
    expect(matchUnit(withOrg, { model: 'm', org: 'Other' })).toBeNull();
    expect(matchUnit(withOrg, { model: 'm', org: 'ACME' })?.id).toBe('x');
    expect(matchUnit(withOrg, { model: 'm' })?.id).toBe('x'); // source without org info → model regex only
    expect(matchUnit(withOrg, { model: 'm', org: '' })?.id).toBe('x'); // empty org string counts as unknown
  });
  it('returns null when an exclude regex matches the model, even if a unit would match', () => {
    const exclude = [/nemotron/i, / \+ /];
    expect(matchUnit(UNITS, { model: 'gpt-4' }, exclude)?.id).toBe('gpt');
    expect(matchUnit(UNITS, { model: 'gpt-oss-nemotron' }, exclude)).toBeNull();
    expect(matchUnit(UNITS, { model: 'Claude-3-NEMOTRON' }, exclude)).toBeNull(); // case-insensitive regexes stay case-insensitive
    expect(matchUnit(UNITS, { model: 'claude-3-5-sonnet + gpt-4o' }, exclude)).toBeNull();
    // default: no exclusions
    expect(matchUnit(UNITS, { model: 'gpt-oss-nemotron' })?.id).toBe('gpt');
    expect(matchUnit(UNITS, { model: 'gpt-oss-nemotron' }, [])?.id).toBe('gpt');
  });
  it('tests exclusions against the model only, not the org', () => {
    expect(matchUnit(UNITS, { model: 'gpt-4', org: 'nemotron' }, [/nemotron/i])?.id).toBe('gpt');
  });
});

describe('assignSeries — release type', () => {
  const obs = [
    ob({ model: 'gpt-4', date: '2023-03-14', value: 60, kind: 'percent', dateKind: 'release' }),
    ob({ model: 'gpt-4o', date: '2024-05-13', value: 70, kind: 'percent', dateKind: 'release' }),
    ob({ model: 'claude-3', date: '2024-03-04', value: 65, kind: 'percent', dateKind: 'release' }),
  ];
  const t = assignSeries({
    front: 'general',
    group: 'g',
    priority: 1,
    observations: obs,
    units: UNITS,
    months: monthRange('2023-01', '2024-10'),
    releases: [],
    params,
  });
  it('carries the best released value forward', () => {
    expect(t.points.get('gpt')?.get('2023-02')).toBeUndefined(); // before series start
    expect(t.points.get('gpt')?.get('2023-03')?.value).toBe(60);
    expect(t.points.get('gpt')?.get('2024-04')?.value).toBe(60);
    expect(t.points.get('gpt')?.get('2024-05')).toEqual({ value: 70, model: 'gpt-4o', reconstructed: false });
    expect(t.points.get('claude')?.get('2024-03')?.value).toBe(65);
  });
  it('stops after the active window (last obs month + 3)', () => {
    expect(t.points.get('gpt')?.get('2024-08')?.value).toBe(70);
    expect(t.points.get('gpt')?.get('2024-09')).toBeUndefined();
  });
  it('records kind and series', () => {
    expect(t.kind).toBe('percent');
    expect(t.series).toBe('s');
  });
});

describe('assignSeries — snapshot type', () => {
  const obs = [
    ob({ model: 'gpt-4', date: '2025-01-05', value: 1200 }),
    ob({ model: 'gpt-4o', date: '2025-01-05', value: 1250 }),
    ob({ model: 'claude-3', date: '2025-01-05', value: 1240 }),
    ob({ model: 'gpt-4o', date: '2025-06-20', value: 1260 }),
    ob({ model: 'claude-3', date: '2025-06-20', value: 1270 }),
  ];
  const releases: CompiledRelease[] = [
    { regex: /^gpt-4$/i, release: '2023-03' },
    { regex: /^gpt-4o/i, release: '2024-05' },
    { regex: /^claude-3/i, release: '2024-03' },
  ];
  const t = assignSeries({
    front: 'general',
    group: 'g',
    priority: 1,
    observations: obs,
    units: UNITS,
    months: monthRange('2023-01', '2025-12'),
    releases,
    params,
  });
  it('uses best model of the latest snapshot ≤ month end', () => {
    expect(t.points.get('gpt')?.get('2025-01')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: false });
    expect(t.points.get('claude')?.get('2025-03')?.value).toBe(1240);
    expect(t.points.get('claude')?.get('2025-06')?.value).toBe(1270);
  });
  it('drops stale snapshots (> 92 days old)', () => {
    expect(t.points.get('gpt')?.get('2025-05')).toBeUndefined(); // 2025-01-05 → 2025-05-31 is 146 days
    expect(t.points.get('gpt')?.get('2025-08')?.value).toBe(1260); // 2025-06-20 → 2025-08-31 is 72 days
    expect(t.points.get('gpt')?.get('2025-09')).toBeUndefined(); // 2025-06-20 → 2025-09-30 is 102 days
  });
  it('reconstructs months before the first snapshot using release months', () => {
    expect(t.points.get('gpt')?.get('2023-02')).toBeUndefined(); // no model released yet
    expect(t.points.get('gpt')?.get('2023-06')).toEqual({ value: 1200, model: 'gpt-4', reconstructed: true });
    expect(t.points.get('gpt')?.get('2024-06')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: true });
    expect(t.points.get('claude')?.get('2024-02')).toBeUndefined();
    expect(t.points.get('claude')?.get('2024-03')?.reconstructed).toBe(true);
  });
});

describe('assignSeries — fading (fadeMonths)', () => {
  const fade = { ...params, fadeMonths: 6 };
  const months = monthRange('2024-10', '2026-06');

  describe('release type', () => {
    const obs = [
      ob({ model: 'gpt-4o', date: '2024-11-10', value: 70, kind: 'percent', dateKind: 'release' }),
      ob({ model: 'claude-3', date: '2025-01-20', value: 65, kind: 'percent', dateKind: 'release' }),
    ];
    const t = assignSeries({ front: 'general', group: 'g', priority: 1, observations: obs, units: UNITS, months, releases: [], params: fade });

    it('is fully fresh from the first observation until the end of the active window (last obs 2025-01 + 3)', () => {
      expect(t.freshness.get('2024-10')).toBeUndefined(); // before the series starts
      for (const m of ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03', '2025-04']) expect(t.freshness.get(m), m).toBe(1);
    });
    it('then fades linearly over fadeMonths months (1 − k/(fadeMonths+1)) and stops', () => {
      const expected: [string, number][] = [
        ['2025-05', 6 / 7],
        ['2025-06', 5 / 7],
        ['2025-07', 4 / 7],
        ['2025-08', 3 / 7],
        ['2025-09', 2 / 7],
        ['2025-10', 1 / 7],
      ];
      for (const [m, f] of expected) expect(t.freshness.get(m), m).toBeCloseTo(f, 12);
      expect(t.freshness.has('2025-11')).toBe(false);
      expect(t.freshness.has('2026-01')).toBe(false);
    });
    it('keeps the points (the best released value) while fading, and drops them once freshness reaches 0', () => {
      expect(t.points.get('gpt')?.get('2025-04')?.value).toBe(70);
      expect(t.points.get('gpt')?.get('2025-10')).toEqual({ value: 70, model: 'gpt-4o', reconstructed: false });
      expect(t.points.get('claude')?.get('2025-10')?.value).toBe(65);
      expect(t.points.get('gpt')?.get('2025-11')).toBeUndefined();
      expect(t.points.get('claude')?.get('2025-11')).toBeUndefined();
    });
  });

  describe('snapshot type', () => {
    const obs = [
      ob({ model: 'gpt-4o', date: '2025-01-05', value: 1250 }),
      ob({ model: 'claude-3', date: '2025-01-05', value: 1240 }),
      ob({ model: 'gpt-4o', date: '2025-06-20', value: 1260 }),
      ob({ model: 'claude-3', date: '2025-06-20', value: 1270 }),
    ];
    const releases: CompiledRelease[] = [{ regex: /^gpt-4o/i, release: '2024-05' }, { regex: /^claude-3/i, release: '2024-03' }];
    const t = assignSeries({ front: 'general', group: 'g', priority: 1, observations: obs, units: UNITS, months, releases, params: fade });

    it('is fully fresh while the latest snapshot is at most snapshotMaxAgeDays old, and for reconstructed months', () => {
      expect(t.freshness.get('2024-12')).toBe(1); // reconstructed (before the first snapshot)
      expect(t.points.get('gpt')?.get('2024-12')?.reconstructed).toBe(true);
      expect(t.freshness.get('2025-01')).toBe(1);
      expect(t.freshness.get('2025-03')).toBe(1); // 2025-01-05 → 2025-03-31: 85 days
      expect(t.freshness.get('2025-06')).toBe(1); // new snapshot
      expect(t.freshness.get('2025-08')).toBe(1); // 2025-06-20 → 2025-08-31: 72 days
    });
    it('keeps using a stale snapshot for fadeMonths months beyond the age limit, with decreasing freshness', () => {
      // 2025-01-05 is too old from 2025-04 on (115 days) until the next snapshot arrives in 2025-06
      expect(t.freshness.get('2025-04')).toBeCloseTo(6 / 7, 12);
      expect(t.freshness.get('2025-05')).toBeCloseTo(5 / 7, 12);
      expect(t.points.get('gpt')?.get('2025-05')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: false });
      // 2025-06-20 is too old from 2025-09 on (102 days): six fading months, then nothing
      const expected: [string, number][] = [
        ['2025-09', 6 / 7],
        ['2025-10', 5 / 7],
        ['2025-11', 4 / 7],
        ['2025-12', 3 / 7],
        ['2026-01', 2 / 7],
        ['2026-02', 1 / 7],
      ];
      for (const [m, f] of expected) expect(t.freshness.get(m), m).toBeCloseTo(f, 12);
      expect(t.points.get('claude')?.get('2026-02')).toEqual({ value: 1270, model: 'claude-3', reconstructed: false });
      expect(t.freshness.has('2026-03')).toBe(false);
      expect(t.points.get('claude')?.get('2026-03')).toBeUndefined();
      expect(t.points.get('gpt')?.get('2026-06')).toBeUndefined();
    });
  });

  it('fadeMonths 0 keeps the old cut-off (no fading months)', () => {
    const t = assignSeries({
      front: 'general',
      group: 'g',
      priority: 1,
      observations: [ob({ model: 'gpt-4o', date: '2025-01-05', value: 1250 }), ob({ model: 'claude-3', date: '2025-01-05', value: 1240 })],
      units: UNITS,
      months,
      releases: [],
      params,
    });
    expect(t.freshness.get('2025-03')).toBe(1);
    expect(t.freshness.has('2025-04')).toBe(false);
    expect(t.points.get('gpt')?.get('2025-04')).toBeUndefined();
  });
});

describe('assignSeries — input hygiene', () => {
  const run = (observations: Observation[]) =>
    assignSeries({
      front: 'general',
      group: 'g',
      priority: 1,
      observations,
      units: UNITS,
      months: monthRange('2024-04', '2025-03'),
      releases: [],
      params,
    });

  it('drops non-finite values (a leading NaN must not wipe the unit) and warns once with the count', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const t = run([
        ob({ model: 'gpt-4', date: '2025-01-05', value: NaN }),
        ob({ model: 'gpt-4o', date: '2025-01-05', value: 1250 }),
        ob({ model: 'gpt-4-turbo', date: '2025-01-05', value: Infinity }),
        ob({ model: 'claude-3', date: '2025-01-05', value: 1240 }),
      ]);
      expect(t.points.get('gpt')?.get('2025-01')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: false });
      expect(t.points.get('claude')?.get('2025-01')?.value).toBe(1240);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('2');
    } finally {
      warn.mockRestore();
    }
  });
  it('does not warn when every value is finite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      run([ob({ model: 'gpt-4o', date: '2025-01-05', value: 1250 })]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it('returns an empty table (with a warning) when every value is non-finite, so one broken source cannot crash the run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const t = run([ob({ value: NaN }), ob({ model: 'claude-3', value: Infinity })]);
      expect(t.points.size).toBe(0);
      expect(t.series).toBe('s');
      expect(t.kind).toBe('elo');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
  it('normalises dates with a time part to YYYY-MM-DD (release type)', () => {
    const t = run([ob({ model: 'gpt-4o', date: '2024-05-31T12:00:00Z', value: 70, kind: 'percent', dateKind: 'release' })]);
    expect(t.points.get('gpt')?.get('2024-04')).toBeUndefined();
    expect(t.points.get('gpt')?.get('2024-05')).toEqual({ value: 70, model: 'gpt-4o', reconstructed: false });
  });
  it('normalises dates with a time part to YYYY-MM-DD (snapshot type)', () => {
    const t = run([
      ob({ model: 'gpt-4o', date: '2024-05-31T12:00:00Z', value: 1250 }),
      ob({ model: 'claude-3', date: '2024-05-31T12:00:00Z', value: 1240 }),
    ]);
    expect(t.points.get('gpt')?.get('2024-05')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: false });
    expect(t.points.get('claude')?.get('2024-05')?.value).toBe(1240);
  });
  it('does not mutate the caller observations', () => {
    const o = ob({ model: 'gpt-4o', date: '2024-05-31T12:00:00Z', value: 1250 });
    run([o]);
    expect(o.date).toBe('2024-05-31T12:00:00Z');
  });
  it('throws on mixed series, kind or dateKind', () => {
    expect(() => run([ob({}), ob({ series: 'other' })])).toThrow(/mixed series\/kind\/dateKind/);
    expect(() => run([ob({}), ob({ kind: 'percent' })])).toThrow(/mixed series\/kind\/dateKind/);
    expect(() => run([ob({}), ob({ dateKind: 'release' })])).toThrow(/mixed series\/kind\/dateKind/);
  });
});

describe('assignSeries — exclude', () => {
  const exclude = [/nemotron/i, / \+ /];
  const run = (observations: Observation[], ex?: RegExp[]) =>
    assignSeries({
      front: 'general',
      group: 'g',
      priority: 1,
      observations,
      units: UNITS,
      months: monthRange('2023-01', '2024-10'),
      releases: [],
      params,
      ...(ex ? { exclude: ex } : {}),
    });

  it('does not assign an excluded fine-tune or combined row (snapshot series)', () => {
    const obs = [
      ob({ model: 'gpt-4o', value: 1250 }),
      ob({ model: 'gpt-4o-nemotron-ft', value: 1400 }), // would otherwise be the best gpt model
      ob({ model: 'claude-3-5-sonnet + gpt-4o', value: 1500 }), // would otherwise be the best claude model
      ob({ model: 'claude-3', value: 1240 }),
    ];
    const t = run(obs, exclude);
    expect(t.points.get('gpt')?.get('2023-05')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: false });
    expect(t.points.get('claude')?.get('2023-05')).toEqual({ value: 1240, model: 'claude-3', reconstructed: false });
  });

  it('does not assign an excluded fine-tune (release series)', () => {
    const obs = [
      ob({ model: 'gpt-4o', date: '2024-05-13', value: 70, kind: 'percent', dateKind: 'release' }),
      ob({ model: 'gpt-4o-nemotron', date: '2024-06-01', value: 90, kind: 'percent', dateKind: 'release' }),
    ];
    const t = run(obs, exclude);
    expect(t.points.get('gpt')?.get('2024-07')).toEqual({ value: 70, model: 'gpt-4o', reconstructed: false });
  });

  it('leaves a unit with no point when all of its models are excluded', () => {
    const t = run([ob({ model: 'gpt-nemotron', value: 1400 }), ob({ model: 'claude-3', value: 1240 })], exclude);
    expect(t.points.has('gpt')).toBe(false);
    expect(t.points.get('claude')?.get('2023-05')?.value).toBe(1240);
  });

  it('assigns everything when no exclude is given', () => {
    const t = run([ob({ model: 'gpt-4o', value: 1250 }), ob({ model: 'gpt-4o-nemotron-ft', value: 1400 })]);
    expect(t.points.get('gpt')?.get('2023-05')?.model).toBe('gpt-4o-nemotron-ft');
  });
});
