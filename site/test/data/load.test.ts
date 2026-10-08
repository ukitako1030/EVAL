import { describe, it, expect } from 'vitest';
import { parseWorld } from '../../src/data/load';
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
