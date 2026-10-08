import { describe, it, expect } from 'vitest';
import { parseWorld } from '../../src/data/load';
import { frontFrame } from '../../src/data/timeline';
import { makeWorld } from '../fixtures/world';

describe('parseWorld', () => {
  it('accepts a well-formed world', () => {
    const w = makeWorld();
    expect(parseWorld(w)).toBe(w);
  });
  it('rejects any schema version other than 2', () => {
    const v1 = makeWorld() as unknown as Record<string, unknown>;
    delete v1.schemaVersion; // schema v1 files carry no version
    expect(() => parseWorld(v1)).toThrow('world.json: unsupported schema version undefined');
    for (const v of [1, 3]) {
      const w = makeWorld();
      w.schemaVersion = v;
      expect(() => parseWorld(w)).toThrow(`world.json: unsupported schema version ${v}`);
    }
  });
  it('throws when a series is shorter than months', () => {
    const w = makeWorld();
    w.series.general.gpt = w.series.general.gpt.slice(0, 2);
    expect(() => parseWorld(w)).toThrow('world.json: months/series length mismatch for general.gpt');
  });
  it('throws when a unit has no series', () => {
    const w = makeWorld();
    delete w.series.general.claude;
    expect(() => parseWorld(w)).toThrow('world.json: units/series mismatch for general.claude');
  });
  it('throws when a series has no unit', () => {
    const w = makeWorld();
    delete w.units.image.nb;
    expect(() => parseWorld(w)).toThrow('world.json: units/series mismatch for image.nb');
  });
  it('throws on a missing front', () => {
    const w = makeWorld() as unknown as { series: Record<string, unknown> };
    delete w.series.music;
    expect(() => parseWorld(w)).toThrow('world.json: missing front music');
  });
  it('throws when there are no months', () => {
    expect(() => parseWorld({})).toThrow('world.json: no months');
    expect(() => parseWorld(null)).toThrow('world.json: no months');
  });
  it('throws (instead of crashing later) when a series is not an array', () => {
    const w = makeWorld() as unknown as { series: Record<string, Record<string, unknown>> };
    w.series.general.gpt = 'oops';
    expect(() => parseWorld(w)).toThrow('world.json: months/series length mismatch for general.gpt');
  });
});

/** The bare minimum the pipeline could emit: months, schema version, units and series — every optional block missing. */
function minimalWorld(): Record<string, unknown> {
  const fronts = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'];
  const units: Record<string, unknown> = Object.fromEntries(fronts.map((f) => [f, {}]));
  const series: Record<string, unknown> = Object.fromEntries(fronts.map((f) => [f, {}]));
  units.general = { gpt: { org: 'openai', name: 'GPT', since: '2025-01' } };
  series.general = { gpt: [{ s: 90, c: 60, q: 'high', qs: 'high', qc: 'high' }, { s: 91, c: 61, q: 'high' }] };
  return { schemaVersion: 2, months: ['2025-01', '2025-02'], units, series };
}

describe('parseWorld defaults (weakly-formed world.json)', () => {
  it('fills every missing optional block with an empty value', () => {
    const w = parseWorld(minimalWorld());
    expect(w.events).toEqual([]);
    expect(w.breakdown).toEqual({});
    expect(w.scaleBreakdown).toEqual({});
    expect(w.sources).toEqual([]);
    expect(w.announcements).toEqual({});
    expect(w.orgs).toEqual({});
    expect(w.generatedAt).toBe('');
    expect(w.partialMonth).toBe('');
    expect(w.dataLicense).toBe('');
    expect(w.dataLicenseJa).toBe('');
  });
  it('defaults missing fronts to all seven, and drops unknown / duplicate / nameless ones', () => {
    expect(parseWorld(minimalWorld()).fronts.map((f) => f.id)).toEqual(['general', 'code', 'agent', 'image', 'video', 'speech', 'music']);
    const raw = minimalWorld();
    raw.fronts = [{ id: 'code', name: { ja: 'コード', en: 'Code' } }, { id: 'nope', name: { ja: 'x', en: 'x' } }, { id: 'code', name: { ja: 'y', en: 'y' } }, 'junk', { id: 'image' }];
    const w = parseWorld(raw);
    expect(w.fronts).toEqual([
      { id: 'code', name: { ja: 'コード', en: 'Code' } },
      { id: 'image', name: { ja: 'image', en: 'image' } },
    ]);
  });
  it('maps unknown or missing confidence values to safe ones (q → estimated, qs / qc → q)', () => {
    const raw = minimalWorld();
    (raw.series as Record<string, Record<string, unknown[]>>).general.gpt = [
      { s: 90, c: 60, q: 'certain', qs: 'wild', qc: 'medium' },
      { s: 91, c: 61, q: 'medium' },
    ];
    const cells = parseWorld(raw).series.general.gpt;
    expect(cells[0]).toMatchObject({ q: 'estimated', qs: 'estimated', qc: 'medium' });
    expect(cells[1]).toMatchObject({ q: 'medium', qs: 'medium', qc: 'medium' });
  });
  it('turns non-numeric strength / scale into 0 and a non-object cell into "no data"', () => {
    const raw = minimalWorld();
    (raw.series as Record<string, Record<string, unknown[]>>).general.gpt = [{ s: 'x', c: null, q: 'high' }, 7];
    const cells = parseWorld(raw).series.general.gpt;
    expect(cells[0]).toMatchObject({ s: 0, c: 0 });
    expect(cells[1]).toBeNull();
  });
  it('maps an unknown breakdown kind to reconstructed and keeps known ones', () => {
    const raw = minimalWorld();
    raw.breakdown = {
      general: {
        gpt: {
          '2025-01': [
            { source: 'a', model: 'm', value: 1, weight: 1, share: 0.5, kind: 'guessed' },
            { source: 'b', model: 'm', value: 2, weight: 1, share: 0.5, kind: 'measured' },
          ],
        },
      },
    };
    const rows = parseWorld(raw).breakdown.general.gpt['2025-01'];
    expect(rows.map((r) => r.kind)).toEqual(['reconstructed', 'measured']);
  });
  it('drops malformed events and repairs their optional parts', () => {
    const raw = minimalWorld();
    raw.events = [
      { month: '2025-01', front: 'general', unit: 'gpt', type: 'custom', major: true, text: { ja: '開戦', en: 'War begins' } },
      { month: '2025-02', front: 'nowhere', unit: 'gpt', type: 'custom', major: true, text: { ja: 'x', en: 'x' } },
      { front: 'general', unit: 'gpt' },
      null,
      { month: '2025-02', front: 'general', unit: 'gpt', type: 'meteor', text: { en: 'Only English' } },
    ];
    const ev = parseWorld(raw).events;
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ type: 'custom', major: false, text: { ja: 'Only English', en: 'Only English' } });
  });
  it('repairs org colours that would not parse and missing org names', () => {
    const raw = minimalWorld();
    raw.orgs = { openai: { name: 'OpenAI', color: '#19c37d' }, bad: { color: 'red' }, junk: 5 };
    const orgs = parseWorld(raw).orgs;
    expect(orgs.openai).toEqual({ name: 'OpenAI', color: '#19c37d' });
    expect(orgs.bad).toEqual({ name: 'bad', color: '#888888' });
    expect(orgs.junk).toEqual({ name: 'junk', color: '#888888' });
  });
  it('a minimal world drives the timeline without NaN', () => {
    const w = parseWorld(minimalWorld());
    for (const t of [0, 0.5, 1]) {
      for (const u of frontFrame(w, 'general', t)) for (const v of [u.s, u.c, u.fog, u.fogBlend, u.presence]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('makeWorld fixture (schema v2)', () => {
  const w = makeWorld();
  it('carries the v2 top-level fields', () => {
    expect(w.schemaVersion).toBe(2);
    expect(w.scaleBreakdown.general).toEqual({});
    expect(w.announcements).toEqual({});
    expect(typeof w.dataLicense).toBe('string');
    expect(typeof w.dataLicenseJa).toBe('string');
    expect(w.sources.every((s) => s.dataThrough === null || typeof s.dataThrough === 'string')).toBe(true);
  });
  it('has qs/qc equal to q and since = first month with data', () => {
    for (const [front, units] of Object.entries(w.units)) {
      for (const [id, u] of Object.entries(units)) {
        const arr = w.series[front as keyof typeof w.series][id];
        const first = arr.findIndex((m) => m !== null);
        expect(u.since).toBe(w.months[first]);
        for (const m of arr) if (m) expect([m.qs, m.qc]).toEqual([m.q, m.q]);
      }
    }
  });
  it('flags only the custom and lead_change events as major', () => {
    expect(w.events.map((e) => [e.type, e.major])).toEqual([
      ['custom', true],
      ['lead_change', true],
      ['new_unit', false],
      ['surge', false],
    ]);
  });
});
