import { describe, it, expect } from 'vitest';
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
const params = { snapshotMaxAgeDays: 92, releaseActiveMonths: 3 };
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
